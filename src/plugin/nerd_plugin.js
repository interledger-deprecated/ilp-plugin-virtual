'use strict'

const EventEmitter = require('events')

const Balance = require('../model/balance')
const Connection = require('../model/connection')
const Transfer = require('../model/transfer')
const TransferLog = require('../model/transferlog').TransferLog
const log = require('../util/log')('plugin')

const cc = require('five-bells-condition')

class NerdPluginVirtual extends EventEmitter {

  /* LedgerPlugin API */

  /**
  * Create a PluginVirtual
  * @param {object} opts contains PluginOptions for PluginVirtual.
  *
  * @param {object} opts.store methods for persistance
  * @param {function} opts.store.get get an element by key
  * @param {function} opts.store.put store an element by key, value
  * @param {function} opts.store.del delete an elemeny by key
  *
  * @param {object} opts.auth ledger-specific information
  * @param {string} opts.auth.account name of your PluginVirtual (can be anything)
  * @param {string} opts.auth.room room to connect to in signalling server
  * @param {string} opts.auth.limit numeric string representing credit limit
  * @param {string} opts.auth.max numeric string representing maximum balance
  * @param {string} opts.auth.host hostname of signalling server with port
  */
  constructor (opts) {
    super()

    let that = this
    this._handle = (err) => {
      that.emit('exception', err)
    }
    
    this.auth = opts.auth
    this.store = opts.store

    this.transferLog = new TransferLog(opts.store)

    this.connected = false
    this.connectionConfig = opts.auth
    this.connection = new Connection(this.connectionConfig)
    this.connection.on('receive', (obj) => {
      this._receive(obj).catch(this._handle)
    })

    this.balance = new Balance({
      store: opts.store,
      limit: opts.auth.limit,
      max: opts.auth.max
    })
    this.balance.on('_balanceChanged', (balance) => {
      this._log('balance changed to ' + balance)
      this.emit('_balanceChanged', balance)
    })
  }

  connect () {
    this.connection.connect()
    return new Promise((resolve) => {
      this.connection.on('connect', () => {
        this.emit('connect')
        this.connected = true
        resolve(null)
      })
    })
  }

  disconnect () {
    return this.connection.disconnect().then(() => {
      this.emit('disconnect')
      this.connected = false
      return Promise.resolve(null)
    })
  }

  isConnected () {
    return this.connected
  }
  
  getConnectors () {
    // the connection is only between two plugins for now, so the connector
    // name can be literally anything
    return Promise.resolve(['x'])
  }

  send (outgoingTransfer) {
    this._log('sending out a Transfer with tid: ' + outgoingTransfer.id)
    return this._syncOutgoing(outgoingTransfer).then(() => {
      return this.connection.send({
        type: 'transfer',
        transfer: outgoingTransfer
      })
    }).catch(this._handle)
  }

  _syncOutgoing (transfer) {
    return this.connection.sendOverRecv({
      type: 'sync',
      transfer: transfer
    }).then(() => {
      this._log('sending out a sync message for tid: ' + transfer.id)
      return new Promise((resolve) => {
        let synced = false
        this.on('_sync', (sTransfer) => {
          if (!synced) {
            synced = (sTransfer.id === transfer.id)
          }
          if (synced) {
            resolve() 
          }
        })
      })
    }).catch(this.handle)
  }

  getInfo () {
    return Promise.resolve({
      /* placeholder values */
      // TODO: Q what should these be
      precision: 'inf',
      scale: 'inf',
      currencyCode: 'GBP',
      currencySymbol: '$'
    })
  }

  fulfillCondition(transferId, fulfillmentBuffer) {
    let fulfillment = fulfillmentBuffer.toString()
    let transfer = null
    this._log('fulfilling: ' + fulfillment)
    return this.transferLog.getId(transferId).then((storedTransfer) => {
      transfer = storedTransfer
      return this._fulfillConditionLocal(transfer, fulfillment)
    }).catch(this._handle)
  }

  _validate (fulfillment, condition) {
    try {
      return cc.validateFulfillment(fulfillment, condition)
    } catch (err) {
      return false
    }
  }
  
  _fulfillConditionLocal(transfer, fulfillment) {
    if (!transfer) {
      throw new Error('got transfer ID for nonexistant transfer')
    } else if (!transfer.executionCondition) {
      throw new Error('got transfer ID for OTP transfer')        
    }

    return this.transferLog.isFulfilled(transfer).then((fulfilled) => {
      if (fulfilled) {
        throw new Error('this transaction has already been fulfilled') 
      } else {
        return Promise.resolve(null)
      }
    }).then(() => {
      let execute = transfer.executionCondition
      let cancel = transfer.cancellationCondition  
      let action = Promise.resolve(null)
    
      // TODO: Q should the timeout be activated automatically?
      let time = new Date()
      let expiresAt = new Date(transfer.expiresAt)
      let timedOut = (time > expiresAt)

      if (this._validate(fulfillment, execute) && !timedOut) {
        return this._executeTransfer(transfer, fulfillment)
      } else if ((cancel && this._validate(fulfillment, cancel)) || timedOut) {
        return this._cancelTransfer(transfer, fulfillment)
      } else {
        throw new Error('invalid fulfillment')
      }
    }).catch(this._handle)
  }

  _executeTransfer(transfer, fulfillment) {
    let fulfillmentBuffer = new Buffer(fulfillment)
    this.emit('fulfill_execution_condition', transfer, fulfillmentBuffer)
    // because there is only one balance, kept, money is not _actually_ kept
    // in escrow (although it behaves as though it were). So there is nothing
    // to do for the execution condition.
    return this.transferLog.getType(transfer).then((type) => {
      if (type === this.transferLog.outgoing) {
        return this.balance.add(transfer.amount)
      } else if (type === this.transferLog.incoming) {
        return this.balance.sub(transfer.amount) 
      }
    }).then(() => {
      return this.transferLog.fulfill(transfer)
    }).then(() => {
      return this.connection.send({
        type: 'fulfill_execution_condition',
        transfer: transfer,
        fulfillment: fulfillment
      })
    })
  }
  

  _cancelTransfer (transfer, fulfillment) {
    let fulfillmentBuffer = new Buffer(fulfillment)
    this.emit('fulfill_cancellation_condition', transfer, fulfillmentBuffer)
    // a cancellation on an outgoing transfer means nothing because
    // balances aren't affected until it executes
    return this.transferLog.getType(transfer).then((type) => {
      if (type === this.transferLog.incoming) {
        return this.balance.add(transfer.amount) 
      }
    }).then(() => {
      return this.transferLog.fulfill(transfer)
    }).then(() => {
      return this.connection.send({
        type: 'fulfill_cancellation_condition',
        transfer: transfer,
        fulfillment: fulfillment
      })
    })
  }

  getBalance () {
    return this.balance.get()
  }

  addBalance (amount) {
    return this.balance.add(amount)
  }

  replyToTransfer (transferId, replyMessage) {
    return this.transferLog.getId(transferId).then((storedTransfer) => {
      return this.connection.send({
        type: 'reply',
        transfer: storedTransfer,
        message: replyMessage
      })
    })
  }

  _receive (obj) {
    if (obj.type === 'transfer') {
      this._log('received a Transfer with tid: ' + obj.transfer.id)
      this.emit('receive', obj.transfer)
      return this._handleTransfer(obj.transfer)
    } else if (obj.type === 'acknowledge') {
      this._log('received an ACK on tid: ' + obj.transfer.id)
      // TODO: Q should accept be fullfill execution condition even in OTP?
      this.emit('accept', obj.transfer, new Buffer(obj.message))
      return this._handleAcknowledge(obj.transfer)
    } else if (obj.type === 'reject') {
      this._log('received a reject on tid: ' + obj.transfer.id)
      this.emit('reject', obj.transfer, new Buffer(obj.message))
      return this._completeTransfer(obj.transfer)
    } else if (obj.type === 'reply') {
      this._log('received a reply on tid: ' + obj.transferId)
      return this.transferLog.getId(obj.transferId).then((transfer) => {
        this.emit('reply', transfer, new Buffer(obj.message))
        return Promise.resolve(null)
      })
    } else if (obj.type === 'fulfillment') {
      this._log('received a fulfillment for tid: ' + obj.transferId)
      return this.transferLog.getId(obj.transferId).then((transfer) => {
        this.emit('fulfillment', transfer, new Buffer(obj.fulfillment))
        return this._fulfillConditionLocal(transfer, obj.fulfillment)
      })
    } else if (obj.type === 'balance') {
      return this._sendBalance() 
    } else if (obj.type === 'sync') {
      this._log('received a sync message for tid: ' + obj.transfer.id)
      return this._handleSync(obj.transfer)
    } else {
      this._handle(new Error('Invalid message received'))
    }
  }

  _handleSync (transfer) {
    return this.transferLog.storeOutgoing(transfer).then(() => {
      this.emit('_sync', transfer)
    })
  }

  _sendBalance () {
    return this.balance.get().then((balance) => {
      return this.connection.send({
        type: 'balance',
        balance: balance
      })
    })
  }

  _handleTransfer (transfer) {
    return this.transferLog.get(transfer).then((storedTransfer) => {
      if (storedTransfer) {
        this.emit('_repeatTransfer', transfer)
        return this._rejectTransfer(transfer, 'repeat transfer id').then(() => {
          throw new Error('repeat transfer id')
        })
      } else {
        return Promise.resolve(null)
      }
    }).then(() => {
      return this.transferLog.storeIncoming(transfer)
    }).then(() => {
      return this.balance.isValidIncoming(transfer.amount)
    }).then((valid) => {
      if (valid) {
        return this.balance.sub(transfer.amount).then(() => {
          this._handleTimer(transfer)
          this._acceptTransfer(transfer)
        })
      } else {
        return this._rejectTransfer(transfer, 'invalid transfer amount')
      }
    }).catch(this._handle)
  }

  _handleAcknowledge (transfer) {
    return this.transferLog.get(transfer).then((storedTransfer) => {
      if (Transfer.equals(storedTransfer, transfer)) {
        return this.transferLog.isComplete(transfer)
      } else {
        this._falseAcknowledge(transfer)
      }
    }).then((isComplete) => {
      if (isComplete) {
        this._falseAcknowledge(transfer)
      // don't add to the balance yet if it's a UTP/ATP transfer
      } else if (!transfer.executionCondition) {
        this.balance.add(transfer.amount)
      }
    }).then(() => {
      this._handleTimer(transfer)
      this._completeTransfer(transfer)
    })
  }

  _falseAcknowledge (transfer) {
    this.emit('_falseAcknowledge', transfer)
    throw new Error('Recieved false acknowledge for tid: ' + transfer.id)
  }

  _handleTimer (transfer) {
    if (transfer.expiresAt) {
      let now = new Date()
      let expiry = new Date(transfer.expiresAt)
      setTimeout(() => {
        this.transferLog.isFulfilled(transfer).then((isFulfilled) => {
          if (!isFulfilled) {
            // TODO: Q what should the event be on a timeout?
            this._cancelTransfer(transfer, 'timed out')
            this._log('automatic time out on tid: ' + transfer.id)
          }
        }).catch(this._handle)
      }, expiry - now)
    }
  }

  _acceptTransfer (transfer) {
    this._log('sending out an ACK for tid: ' + transfer.id)
    return this.connection.send({
      type: 'acknowledge',
      transfer: transfer,
      message: 'transfer accepted'
    })
  }

  _rejectTransfer (transfer, reason) {
    this._log('sending out a reject for tid: ' + transfer.id)
    this._completeTransfer(transfer)
    return this.connection.send({
      type: 'reject',
      transfer: transfer,
      message: reason
    })
  }

  _completeTransfer (transfer) {
    let promises = [this.transferLog.complete(transfer)]
    if (!transfer.executionCondition) {
      promises.push(this.transferLog.fulfill(transfer))
    }
    return Promise.all(promises)
  }

  _log (msg) {
    log.log(this.auth.account + ': ' + msg)
  }
}

module.exports = NerdPluginVirtual
