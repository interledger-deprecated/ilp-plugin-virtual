'use strict'

const EventEmitter2 = require('eventemitter2')
const co = require('co')
const cc = require('five-bells-condition')
const Connection = require('../model/connection')

const JsonRpc1 = require('../model/rpc')
const Validator = require('../util/validator')
const TransferLog = require('../model/transferlog')
const log = require('debug')('ilp-plugin-virtual')

// for logging purposes
let n = 1

module.exports = class PluginVirtual extends EventEmitter2 {

  constructor (opts) {
    super()

    // TODO: verify options

    this._publicKey = opts.publicKey
    this._token = opts.token
    this._store = opts.store
    this._id = n++
    this._balance = new Balance({ maximum: opts.maximum })

    this._prefix = 'peer.' + this._token.substring(0, 5) + '.'
    this._account = this._prefix + this._publicKey

    this._validate = new Validator()
    this._transfers = new TransferLog()
    this._connected = false
    this._connection = new Connection({
      name: this._id,
      token: opts.token,
      host: opts.broker 
    })

    // register RPC methods
    this._rpc = new JsonRpc1(this.connection, this)
    this._rpc.addMethod('sendMessage', this._handleMessage)
    this._rpc.addMethod('sendTransfer', this._handleTransfer)
    this._rpc.addMethod('fulfillCondition', this._handleFulfillCondition)
    this._rpc.addMethod('rejectIncomingTransfer', this._handleRejectIncomingTransfer)

    // wrap around generator methods
    this.connect = co.wrap(this._connect).bind(this)
    this.disconnect = co.wrap(this._disconnect).bind(this)
    this.sendMessage = co.wrap(this._sendMessage).bind(this)
    this.sendTransfer = co.wrap(this._sendTransfer).bind(this)
    this.getBalance = co.wrap(this._getBalance).bind(this)

    // simple getters
    this.isConnected = () => (this._connected)
    this.getPrefix = () => Promise.resolve(this._prefix)
    this.getAccount = () => Promise.resolve(this._account)
  }
  
  * _connect () {
    yield this.connection.connect()
    this._connected = true
    this.emitAsync('connect')
  }

  * _disconnect () {
    yield this.connection.disconnect()
    this._connected = false
    this.emitAsync('disconnect')
  }

  * _sendMessage (message) {
    this._validator.validate(message, 'message')
    yield this._rpc.call('sendMessage', message)
    this.emitAsync('outgoing_message', message)
  }

  * _handleMessage (message) {
    this._validator.validate(message, 'message')
    this.emitAsync('incoming_message') 
    return true
  }

  * _sendTransfer (transfer) {
    this._validator.validate(transfer, 'transfer')
    yield this._rpc.call('sendTransfer', Object.assign({},
      transfer,
      { account: this._account })

    yield this._balance.subtract(transfer.amount) 
    this._transferLog.store(transfer)

    this.emitAsync('outgoing_' +
      transfer.executionCondition? 'prepare':'transfer', transfer)
  }

  * _handleTransfer (transfer) {
    this._validator.validate(transfer, 'transfer')
    yield this._balance.validate(transfer.amount)    
    
    if (transfer.executionCondition) {
      yield this._balance.addEscrow(transfer.amount)
    } else {
      yield this._balance.add(transfer.amount)
    }

    yield this._transferLog.store(transfer)
    this.emitAsync('incoming_' +
      transfer.executionCondition? 'prepare':'transfer', transfer)

    return true
  }

  * _fulfillCondition (transferId, fulfillment) {
    this._validator.validate(fulfillment, 'fulfillment')

    yield this._transferLog.assertIncoming(transferId)
    yield this._transferLog.assertFulfillable(transferId)
    const transfer = yield this._transferLog.get(transferId)

    cc.validateFulfillment(fulfillment, transfer.executionCondition)
    yield this._transferLog.fulfill(transferId)
    yield this._balance.subEscrow(transfer.amount)
    yield this._balance.add(transfer.amount)

    this.emitAsync('incoming_fulfill', transfer, fulfillment)

    // let the other person know after we've already fulfilled, because they
    // don't have to edit their database.
    yield this._rpc.call('fulfillCondition', transferId, fulfillment)
  }

  * _handleFulfillCondition (transferId, fulfillment) {
    this._validator.validate(fulfillment, 'fulfillment')

    yield this._transferLog.assertOutgoing(transferId)
    yield this._transferLog.assertFulfillable(transferId)
    const transfer = yield this._transferLog.get(transferId)

    cc.validateFulfillment(fulfillment, transfer.executionCondition)
    yield this._transferLog.fulfill(transferId)

    this.emitAsync('outgoing_fulfill', transfer, fulfillment)
    return true
  }

  * _rejectIncomingTransfer (transferId) {
    yield this._transferLog.cancel(transferId) // must be conditional, unfulfilled, and incoming
    const transfer = yield this._transferLog.get(transferId)

    this._balance.subEscrow(transfer.amount)
    yield this._rpc.call('rejectIncomingTransfer', transferId)
  }

  * _handleRejectIncomingTransfer (transferId, reason) {
    yield this._transferLog.cancel(transferId)
    const transfer = yield this._transferLog.get(transferId)

    this.emitAsync('outgoing_reject', transfer, reason)
    return true
  }

  * _handleCancelTransfer (transferId) {
    yield this._transferLog.cancel(transferId)
    const transfer = yield this._transferLog.get(transferId)

    this.emitAsync('outgoing_cancel', transfer)
    return true
  }

  * _getBalance () {
    return yield this._balance.get()
  }
}
