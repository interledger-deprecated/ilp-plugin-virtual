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
  * @param {string} opts.auth.token channel to connect to in MQTT server
  * @param {string} opts.auth.limit numeric string representing credit limit
  * @param {string} opts.auth.balance numeric string representing starting balance
  * @param {string} opts.auth.host hostname of MQTT server
  */
  constructor (opts) {
    super()

    let that = this
    this._handle = (err) => {
      that.emit('exception', err)
      throw err
    }

    this.id = opts.id // not used but required for compatability with five
                      // bells connector.
    this.auth = opts.auth
    this.store = opts.store
    this.timers = {}

    this.info = opts.auth.info || {
      precision: opts.auth.precision || 15,
      scale: opts.auth.scale || 15,
      currencyCode: opts.auth.currencyCode || '???',
      currencySymbol: opts.auth.currencySymbol || '?'
    }

    this.transferLog = new TransferLog(opts.store)

    this.prefix = opts.auth.prefix

    this.connected = false
    this.connectionConfig = opts.auth

    const MockConnection = opts.auth.mockConnection
    this.connection = MockConnection
      ? (new MockConnection(this.connectionConfig))
      : (new Connection(this.connectionConfig))
    this.connection.on('receive', (obj) => {
      this._receive(obj).catch(this._handle)
    })

    this.balance = new Balance({
      store: opts.store,
      limit: opts.auth.limit,
      balance: opts.auth.balance
    })
    this.balance.on('_balanceChanged', (balance) => {
      this._log('balance changed to ' + balance)
      this.emit('_balanceChanged', balance)
      this._sendBalance()
    })
    this.balance.on('settlement', (balance) => {
      this._log('you should settle your balance of ' + balance)
      this.emit('settlement', balance)
      this._sendSettle()
    })
  }

  getAccount () {
    return this.auth.account
  }

  connect () {
    return new Promise((resolve) => {
      this.connection.on('connect', () => {
        this.connected = true
        this.emit('connect')
        resolve(null)
      })
      this.connection.connect()
    })
  }

  disconnect () {
    return this.connection.disconnect().then(() => {
      this.connected = false
      this.emit('disconnect')
      return Promise.resolve(null)
    })
  }

  isConnected () {
    return this.connected
  }

  getConnectors () {
    // the connection is only between two plugins for now, so the
    // list is empty
    return Promise.resolve([])
  }

  send (transfer) {
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
      return this.transferLog.storeOutgoing(transfer)
    }).then(() => {
      return this.balance.isValidIncoming(transfer.amount)
    }).then((valid) => {
      const validAmount = (typeof transfer.amount === 'string' &&
        !isNaN(transfer.amount - 0))
      const validAccount = (typeof transfer.account === 'string')
      if (valid && validAmount && validAccount) {
        this._log('sending out a Transfer with tid: ' + transfer.id)
        return this._sendAndWait(transfer)
      } else {
        this._log('rejecting invalid transfer with tid: ' + transfer.id)
        throw new Error('invalid amount in transfer with id ' + transfer.id)
      }
    }).catch(this._handle)
  }

  _sendAndWait (outgoingTransfer) {
    return new Promise((resolve, reject) => {
      let resolved = false

      this.on('_accepted', (transfer) => {
        if (!resolved && transfer.id === outgoingTransfer.id) {
          resolved = true
          resolve(null)
        }
      })

      this.on('_rejected', (transfer) => {
        if (!resolved && transfer.id === outgoingTransfer.id) {
          resolved = true
          reject(new Error('transfer was invalid'))
        }
      })

      this.connection.send({
        type: 'transfer',
        transfer: Object.assign({}, outgoingTransfer, { ledger: this.prefix })
      }).catch(this._handle)
    })
  }

  getInfo () {
    return Promise.resolve(this.info)
  }

  fulfillCondition (transferId, fulfillmentBuffer) {
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

  _fulfillConditionLocal (transfer, fulfillment) {
    if (!transfer) {
      throw new Error('got transfer ID for nonexistant transfer')
    } else if (!transfer.executionCondition) {
      throw new Error('got transfer ID for OTP transfer')
    }

    return this.transferLog.isFulfilled(transfer).then((fulfilled) => {
      if (fulfilled) {
        throw new Error('this transfer has already been fulfilled')
      } else {
        return Promise.resolve(null)
      }
    }).then(() => {
      const execute = transfer.executionCondition

      const time = new Date()
      const expiresAt = new Date(transfer.expiresAt)
      const timedOut = (time > expiresAt)

      if (this._validate(fulfillment, execute) && !timedOut) {
        return this._executeTransfer(transfer, fulfillment)
      } else if (timedOut) {
        return this._timeOutTransfer(transfer)
      } else {
        throw new Error('invalid fulfillment')
      }
    }).catch(this._handle)
  }

  _executeTransfer (transfer, fulfillment) {
    let fulfillmentBuffer = new Buffer(fulfillment)
    // because there is only one balance, kept, money is not _actually_ kept
    // in escrow (although it behaves as though it were). So there is nothing
    // to do for the execution condition.
    return this.transferLog.getType(transfer).then((type) => {
      if (type === this.transferLog.outgoing) {
        this.emit('outgoing_fulfill', transfer, fulfillmentBuffer)
        return this.balance.add(transfer.amount)
      } else { // if (type === this.transferLog.incoming)
        this.emit('incoming_fulfill', transfer, fulfillmentBuffer)
        return Promise.resolve(null)
      }
    }).then(() => {
      return this.transferLog.fulfill(transfer)
    }).then(() => {
      return this.transferLog.getType(transfer)
    }).then((type) => {
      return this.connection.send({
        type: 'fulfill_execution_condition',
        toNerd: (type === this.transferLog.incoming),
        transfer: transfer,
        fulfillment: fulfillment
      })
    })
  }

  _timeOutTransfer (transfer) {
    let transactionType = null
    return this.transferLog.getType(transfer).then((type) => {
      transactionType = type
      if (type === this.transferLog.incoming) {
        this.emit('incoming_cancel', transfer, 'timed out')
        return this.balance.add(transfer.amount)
      } else {
        this.emit('outgoing_cancel', transfer, 'timed out')
      }
    }).then(() => {
      return this.transferLog.fulfill(transfer)
    }).then(() => {
      return this.connection.send({
        type: 'reject',
        toNerd: (transactionType === this.transferLog.incoming),
        transfer: transfer,
        message: 'timed out'
      })
    })
  }

  getPrefix () {
    return Promise.resolve(this.prefix)
  }

  _sendPrefix () {
    return this.getPrefix().then((prefix) => {
      return this.connection.send({
        type: 'prefix',
        prefix: prefix
      })
    })
  }

  getBalance () {
    return this.balance.get()
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

      return this._handleTransfer(obj.transfer)
    } else if (obj.type === 'acknowledge') {
      this._log('received an ACK on tid: ' + obj.transfer.id)

      this.emit('_accepted', obj.transfer)
      if (obj.transfer.executionCondition) {
        this.emit('outgoing_prepare', obj.transfer, new Buffer(obj.message))
      } else {
        this.emit('outgoing_transfer', obj.transfer, new Buffer(obj.message))
      }

      return this._handleAcknowledge(obj.transfer)
    } else if (obj.type === 'reject') {
      this._log('received a reject on tid: ' + obj.transfer.id)

      this.emit('_rejected', obj.transfer)
      this.emit('outgoing_cancel', obj.transfer, new Buffer(obj.message))

      return this._handleReject(obj.transfer)
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
      this._log('received a query for the balance...')
      return this._sendBalance()
    } else if (obj.type === 'info') {
      return this._sendInfo()
    } else if (obj.type === 'prefix') {
      return this._sendPrefix()
    } else {
      this._handle(new Error('Invalid message received'))
    }
  }

  _handleReject (transfer) {
    return this.transferLog.exists(transfer).then((exists) => {
      if (exists) {
        this._completeTransfer(transfer)
      } else {
        this.emit('_falseReject', transfer) // event for debugging
      }
    })
  }

  _sendBalance () {
    return this.balance.get().then((balance) => {
      this._log('sending balance: ' + balance)
      return this.connection.send({
        type: 'balance',
        balance: balance
      })
    })
  }

  _sendSettle () {
    return this.balance.get().then((balance) => {
      this._log('sending settlement notification: ' + balance)
      return this.connection.send({
        type: 'settlement',
        balance: balance
      })
    })
  }

  _sendInfo () {
    return this.getInfo().then((info) => {
      return this.connection.send({
        type: 'info',
        info: info
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
      const validAmount = (typeof transfer.amount === 'string' &&
        !isNaN(transfer.amount - 0))
      const validAccount = (typeof transfer.account === 'string')
      if (valid && validAmount && validAccount) {
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
      this.timers[transfer.id] = setTimeout(() => {
        this.transferLog.isFulfilled(transfer).then((isFulfilled) => {
          if (!isFulfilled) {
            this._timeOutTransfer(transfer)
            this._log('automatic time out on tid: ' + transfer.id)
          }
        }).catch(this._handle)
      }, expiry - now)
      // for debugging purposes
      this.emit('_timing', transfer.id)
    }
  }

  _acceptTransfer (transfer) {
    this._log('sending out an ACK for tid: ' + transfer.id)

    return this.transferLog.getType(transfer).then((direction) => {
      const dir = (direction === this.transferLog.incoming)
        ? 'incoming' : 'outgoing'
      const type = (transfer.executionCondition) ? 'prepare' : 'transfer'
      this.emit(dir + '_' + type, transfer)

      return this.connection.send({
        type: 'acknowledge',
        transfer: transfer,
        message: 'transfer accepted'
      })
    })
  }

  _rejectTransfer (transfer, reason) {
    this._log('sending out a reject for tid: ' + transfer.id)
    this._completeTransfer(transfer)
    return this.connection.send({
      type: 'reject',
      toNerd: true,
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
