'use strict'

const EventEmitter = require('events')
const BigNumber = require('bignumber.js')

const Connection = require('./model/connection').Connection
const Transfer = require('./model/transfer').Transfer
const TransferLog = require('./model/transferlog').TransferLog
const log = require('./util/log')('plugin')

const cc = require('five-bells-condition')

class PluginVirtual extends EventEmitter {

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
  * @param {string} opts.auth.host hostname of signalling server with port
  */
  constructor (opts) {
    super()

    this.connected = false
    this.auth = opts.auth
    this.store = opts.store

    this.myAccount = '1'
    this.otherAccount = '2'
    this.limit = opts.auth.limit
    this.transferLog = new TransferLog(this.store)

    this.connectionConfig = opts.auth
    this.connection = new Connection(this.connectionConfig)

    this.connection.on('receive', (obj) => {
      this._receive(obj).catch((err) => {
        this.emit('exception', err)
      })
    })
  }

  static canConnectToLedger (auth) {
    // TODO: Q test the server?
    return true
  }

  static get typeEscrow () {
    return 'e'
  }
  static get typeAccount () { 
    return 'a'
  }
  static getType(transfer) {
    let type = PluginVirtual.typeAccount
    if (transfer.executionCondition) {
      type = PluginVirtual.typeEscrow
    }
    return type
  }


  connect () {
    return new Promise((resolve) => {
      this.connection.on('connect', () => {
        this.emit('connect')
        this.connected = true
        resolve(null)
      })
      this.connection.connect()
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

  getBalance () {
    return this.store.get(PluginVirtual.typeAccount + this.myAccount)
    .then((balance) => {
      // TODO: Q figure out what the store does when a key doesn't exist
      if (!balance) {
        return this.store.put(PluginVirtual.typeAccount + this.myAccount, '0')
        .then(() => {
          return Promise.resolve('0')
        })
      }
      return Promise.resolve(balance)
    })
  }
  _getBalanceFloat () {
    return this.getBalance().then((balance) => {
      return Promise.resolve(new BigNumber(balance))
    })
  }

  getConnectors () {
    // the connection is only between two plugins for now, so the connector
    // name can be literally anything
    return Promise.resolve([this.otherAccount])
  }

  send (outgoingTransfer) {
    this._log('sending out a Transfer with tid: ' + outgoingTransfer.id)
    return this.connection.send({
      type: 'transfer',
      transfer: (new Transfer(outgoingTransfer)).serialize()
    }).then(() => {
      return this.transferLog.storeOutgoing(outgoingTransfer)
    }).catch((err) => {
      this.emit('exception', err)
    })
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
    return this.transferLog.getId(transferId).then((transfer) => {
      if (!transfer) {
        throw new Error('got transfer ID for nonexistant transfer')
      }
      if (!transfer.executionCondition) {
        throw new Error('got transfer ID for OTP tranfer')        
      }
      return Promise.resolve(transfer)
    }).then((transfer) => {
      let execute = transfer.executionCondition
      let cancel = transfer.cancellationCondition  
      let action = Promise.resolve(null)

      if (cc.validateFulfillment(fulfillment, execute)) {
        action = this._executeTranfer(transfer)
      } else if (cancel && cc.validateFulfillment(fulfillment, cancel)) {
        action = this._cancelTransfer(transfer)
      } else {
        throw new Error('invalid fulfillment')
      }
      return action.then(() => { sendFulfillment(transfer, fulfillment) })
    })
  }

  _executeTransfer(transferObj, fulfillment) {
    let transfer = new Transfer(transferObj)
    let fulfillmentBuffer = new Buffer(fulfillment)
    this.emit('fulfill_cancellation_condition', transfer, fulfillmentBuffer)
    if (this.transferLog.getType(transfer) === this.transferLog.incoming) {
      // money goes through to your account now
      return this._addBalance(transfer.amount)
    } else if (this.transferLog.getType(transfer) === this.transfer.log.outgoing
    ) {
      // removes the escrowed money because it's gone now
      return this._addEscrow(transfer.amount.negated())
    }
  }

  _cancelTransfer (transferObj, fulfillment) {
    let transfer = new Transfer(transferObj)
    let fulfillmentBuffer = new Buffer(fulfillment)
    this.emit('fulfill_execution_condition', transfer, fulfillmentBuffer)
    // if the transfer was incoming, then a cancellation means nothing because
    // balances aren't affected until it executes
    if (this.transferLog.getType(transfer) == this.transferLog.outgoing) {
      return this._addEscrow(transfer.amount.negated()).then(() => {
        return this._addBalance(transfer.amount)
      })
    } 
  }

  _sendFulfillment(transfer, fulfillment) {
    return this.connection.send({
      type: 'fulfillment',
      transfer: transfer,
      fulfillment: fulfillment
    })
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

  /* Private Functions */
  _receive (obj) {
    if (obj.type === 'transfer') {
      this._log('received a Transfer with tid: ' + obj.transfer.id)
      this.emit('incoming', obj.transfer)
      return this._handleTransfer(new Transfer(obj.transfer))
    } else if (obj.type === 'acknowledge') {
      this._log('received a ACK on tid: ' + obj.transfer.id)
      // TODO: Q should accept be fullfill execution condition even in OTP?
      this.emit('accept', obj.transfer, new Buffer(obj.message)) // TODO: Q can obj.message be null?
      return this._handleAcknowledge(new Transfer(obj.transfer))
    } else if (obj.type === 'reject') {
      this._log('received a reject on tid: ' + obj.transfer.id)
      this.emit('reject', obj.transfer, new Buffer(obj.message))
      return this.transferLog.complete(obj.transfer)
    } else if (obj.type === 'reply') {
      this._log('received a reply on tid: ' + obj.transfer.id)
      this.emit('reply', obj.transfer, new Buffer(obj.message))
      return Promise.resolve(null)
    } else if (obj.type === 'fulfillment') {
      this._log('received a fulfillment for tid: ' + obj.transfer.id)
      this.emit('fulfillment', obj.transfer, new Buffer(obj.fulfillment))
      return this.fulfillCondition(obj.transfer.id, obj.fulfillment)
    } else {
      this.emit('exception', new Error('Invalid message received'))
    }
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
      return this.transferLog.storeIncoming(transfer.serialize())
    }).then(() => {
      return this._getBalanceFloat()
    }).then((balance) => {
      if (transfer.amount.isNaN()) {
        return this._rejectTransfer(transfer, 'amount is not a number')
      } else if (transfer.amount.lte(new BigNumber(0))) {
        return this._rejectTransfer(transfer, 'invalid amount')
      // TODO: have the limit take escrow into account
      } else if ((balance.add(transfer.amount).lessThanOrEqualTo(this.limit))) {
        // actually apply the transfer because it has passed the validation.
        // this will send an acknowledgement to the sender
        return this._applyTransfer(transfer)
      } else {
        return this._rejectTransfer(transfer, 'credit limit exceeded')
      }
    }).catch((err) => {
      this.emit('exception', err)
    })
  }

  _applyTransfer (transfer) {
    // support for UTP and ATP; if the transfer's condition fields have something
    // in them then 
    let type = PluginVirtual.getType(transfer)
    let changeBalance = Promise.resolve(null)
    this._log('4')
    
    // the balance is only added to your account when the type is
    // OTP; when it's an escrowed transfer then you wait for the fulfillment
    // to credit your account
    if (type === PluginVirtual.typeAccount) {
      changeBalance = this._addBalance(this.myAccount, transfer.amount)
    }

    return changeBalance.then(() => { this._acceptTransfer(transfer) })
  }

  _handleAcknowledge (transfer) {
    // subtract the transfer amount because it's ackowledging a sent transaction
    var pv = this
    return this.transferLog.get(transfer).then((storedTransfer) => {
      if (transfer.equals(new Transfer(storedTransfer))) {
        return this.transferLog.isComplete(transfer).then((isComplete) => {
          if (isComplete) {
            this._falseAcknowledge(transfer)
          } else {
            // apply your transfer
            this._applyAcknowledgedTransfer(transfer)
          }
        })
      } else {
        this._falseAcknowledge(transfer)
      }
    })
  }

  _applyAcknowledgedTransfer (transfer) {
    // support for UTP and ATP; if the transfer's condition fields have something
    // in them then 
    let type = PluginVirtual.getType(transfer)
    let changeBalance = null

    if (type === PluginVirtual.typeEscrow) {
      // putInEscrow both adds escrow and removes balance from the account's
      // normal balance
      changeBalance = this._putInEscrow(this.myAccount, transfer.amount)
    } else if (type === PluginVirtual.typeAccount) {
      changeBalance = this._addBalance(this.myAccount, transfer.amount.negated())
    }

    return this.transferLog.complete(transfer).then(() => {
      return pv._addBalance(pv.myAccount, transfer.amount.negated(), type)
    })
  }

  _falseAcknowledge (transfer) {
    this.emit('_falseAcknowledge', transfer)
    this.emit(
      'exception',
      new Error('Recieved false acknowledge for tid: ' + transfer.id)
    )
  }

  _putInEscrow (account, amt) {
    return this._addBalance(account, amt, PluginVirtual.typeEscrow).then(() => {
      return this._addBalance(account, amt.negated(), PluginVirtual.typeAccount) 
    })
  }
  
  _addEscrow (account, amt) {
    return this._addBalance(account, amt, PluginVirtual.typeEscrow)
  }

  _addBalance (account, amt, type) {
    if (!type) {
      // type is normally typeAccount, for account. However, if there is
      // escrow then the account will be a typeEscrow
      type = PluginVirtual.typeAccount
    }
    return this._getBalanceFloat().then((balance) => {
      this._log(balance + ' changed by ' + amt)
      let newBalance = balance.add(amt).toString()
      return this.store.put(type + account, balance.add(amt).toString())
      .then(() => {
        return Promise.resolve(newBalance)
      })
    }).then((newBalance) => {
      // event for debugging
      this.emit('_balanceChanged', newBalance, type)
      return Promise.resolve(null)
    })
  }

  _acceptTransfer (transfer) {
    this._log('sending out an ACK for tid: ' + transfer.id)
    return this.connection.send({
      type: 'acknowledge',
      transfer: transfer.serialize(),
      message: 'transfer accepted'
    })
  }
  _rejectTransfer (transfer, reason) {
    this._log('sending out a reject for tid: ' + transfer.id)
    this.transferLog.complete(transfer)
    return this.connection.send({
      type: 'reject',
      transfer: transfer.serialize(),
      message: reason
    })
  }

  _log (msg) {
    log.log(this.auth.account + ': ' + msg)
  }
}

exports.PluginVirtual = PluginVirtual
exports.Connection = Connection
