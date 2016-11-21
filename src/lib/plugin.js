'use strict'

const EventEmitter2 = require('eventemitter2')
const co = require('co')
const cc = require('five-bells-condition')
const Connection = require('../model/connection')

const JsonRpc1 = require('../model/rpc')
const Validator = require('../util/validator')
const TransferLog = require('../model/transferlog')
const Balance = require('../model/balance')
const debug = require('debug')('ilp-plugin-virtual')

module.exports = class PluginVirtual extends EventEmitter2 {

  constructor (opts) {
    super()

    // TODO: verify options

    this._publicKey = opts.publicKey
    this._token = opts.token
    this._store = opts._store
    this._info = opts.info
    this._balance = new Balance({ 
      store: this._store,
      maximum: opts.maxBalance
    })

    this._prefix = 'peer.' + this._token.substring(0, 5) + '.'
    this._account = this._prefix + this._publicKey

    this._validator = new Validator()
    this._transfers = new TransferLog({
      store: this._store
    })
    this._connected = false
  /*  this._connection = new Connection({
      name: '',
      token: opts.token,
      host: opts.broker 
    }) */
    this._connection = new Connection(opts)

    // register RPC methods
    this._rpc = new JsonRpc1(this._connection, this)
    this._rpc.addMethod('sendMessage', this._handleMessage)
    this._rpc.addMethod('sendTransfer', this._handleTransfer)
    this._rpc.addMethod('fulfillCondition', this._handleFulfillCondition)
    this._rpc.addMethod('rejectIncomingTransfer', this._handleRejectIncomingTransfer)
    this._rpc.addMethod('expireTransfer', this._handleExpireTransfer)

    // wrap around generator methods
    this.connect = co.wrap(this._connect).bind(this)
    this.disconnect = co.wrap(this._disconnect).bind(this)
    this.sendMessage = co.wrap(this._sendMessage).bind(this)
    this.sendTransfer = co.wrap(this._sendTransfer).bind(this)
    this.getBalance = co.wrap(this._getBalance).bind(this)
    this.fulfillCondition = co.wrap(this._fulfillCondition).bind(this)
    this.rejectIncomingTransfer = co.wrap(this._rejectIncomingTransfer).bind(this)
    this.getFulfillment = co.wrap(this._getFulfillment).bind(this)
    this.getInfo = co.wrap(this._getInfo).bind(this)

    // simple getters
    this.isConnected = () => (this._connected)
    this.getPrefix = () => Promise.resolve(this._prefix)
    this.getAccount = () => Promise.resolve(this._account)
  }
  
  * _connect () {
    yield this._connection.connect()
    this._connected = true
    this.emitAsync('connect')
  }

  * _disconnect () {
    yield this._connection.disconnect()
    this._connected = false
    this.emitAsync('disconnect')
  }

  * _sendMessage (message) {
    this._validator.validateMessage(message)
    yield this._rpc.call('sendMessage', [message.account ?
      Object.assign({}, message, { account: this._account }) :
      message])

    this.emitAsync('outgoing_message', message)
  }

  * _handleMessage (message) {
    this._validator.validateMessage(message)
    this.emitAsync('incoming_message', message) 
    return true
  }

  * _sendTransfer (preTransfer) {
    const transfer = Object.assign({}, preTransfer, { ledger: this._prefix })
    this._validator.validateTransfer(transfer)

    // apply the transfer before the other plugin can
    // emit any events about it
    yield this._applyOutgoingTransfer(transfer)

    try {
      yield this._rpc.call('sendTransfer', [Object.assign({},
        transfer,
        { account: this._account })])
    } catch (e) {

      // roll this back, because the other plugin didn't acknowledge
      // the transfer.
      debug(e.name + ' during transfer ' + transfer.id)
      yield this._cancelOutgoingTransfer(transfer)
      throw e
    }

    debug('transfer acknowledged ' + transfer.id)
    if (transfer.executionCondition) {
      yield this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }

    this.emitAsync('outgoing_' +
      (transfer.executionCondition? 'prepare':'transfer'), transfer)
  }

  * _handleTransfer (transfer) {
    this._validator.validateTransfer(transfer)

    // balance is added on incoming transfers, regardless of condition
    yield this._balance.add(transfer.amount)

    yield this._transfers.storeIncoming(transfer)
    this.emitAsync('incoming_' +
      (transfer.executionCondition? 'prepare':'transfer'), transfer)

    // set up expiry here too, so both sides can send the expiration message
    if (transfer.executionCondition) {
      yield this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }

    debug('acknowledging transfer id ', transfer.id)
    return true
  }

  * _fulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)

    yield this._transfers.assertIncoming(transferId)
    yield this._transfers.assertAllowedChange(transferId, 'executed')
    const transfer = yield this._transfers.get(transferId)

    cc.validateFulfillment(fulfillment, transfer.executionCondition)
    if (yield this._transfers.fulfill(transferId, fulfillment)) {
      this.emitAsync('incoming_fulfill', transfer, fulfillment)
    }

    // let the other person know after we've already fulfilled, because they
    // don't have to edit their database.
    yield this._rpc.call('fulfillCondition', [transferId, fulfillment])
  }

  * _handleFulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)

    yield this._transfers.assertOutgoing(transferId)
    yield this._transfers.assertAllowedChange(transferId, 'executed')
    const transfer = yield this._transfers.get(transferId)

    cc.validateFulfillment(fulfillment, transfer.executionCondition)
    yield this._balance.sub(transfer.amount)
    if (yield this._transfers.fulfill(transferId, fulfillment)) {
      this.emitAsync('outgoing_fulfill', transfer, fulfillment)
    }

    return true
  }

  * _rejectIncomingTransfer (transferId, reason) {
    const transfer = yield this._transfers.get(transferId)
    debug('going to reject ' + transferId)

    yield this._transfers.assertIncoming(transferId)
    if (yield this._transfers.cancel(transferId)) {
      this.emitAsync('incoming_reject', transfer, reason)
    }
    debug('rejected ' + transferId)

    yield this._balance.sub(transfer.amount)
    yield this._rpc.call('rejectIncomingTransfer', [transferId, reason])
  }

  * _handleRejectIncomingTransfer (transferId, reason) {
    const transfer = yield this._transfers.get(transferId)

    yield this._transfers.assertOutgoing(transferId)
    if (yield this._transfers.cancel(transferId)) {
      this.emitAsync('outgoing_reject', transfer, reason)
    }

    return true
  }

  * _handleCancelTransfer (transferId) {
    const transfer = yield this._transfers.get(transferId)
    if (yield this._transfer.cancel(transferId)) {
      this.emitAsync('outgoing_cancel', transfer)
    }

    return true
  }

  * _getBalance () {
    return yield this._balance.get()
  }

  * _getFulfillment (transferId) {
    return yield this._transfers.getFulfillment(transferId)
  }

  * _applyOutgoingTransfer (transfer) {
    if (!transfer.executionCondition) {
      yield this._balance.sub(transfer.amount) 
    }
    yield this._transfers.storeOutgoing(transfer)
  }

  * _cancelOutgoingTransfer (transfer) {
    if (!transfer.executionCondition) {
      yield this._balance.add(transfer.amount) 
    }
    yield this._transfers.drop(transfer.id)
  }

  * _setupTransferExpiry (transferId, expiresAt) {
    const expiry = Date.parse(expiresAt)
    const now = new Date()

    const that = this
    setTimeout(co.wrap(function * () {
      debug('going to time out ' + transferId)

      const packaged = yield that._transfers._getPackaged(transferId)

      // don't cancel again if it's already cancelled
      if (!(yield that._transfers.cancel(transferId))) {
        debug(transferId + ' has already cancelled')
        return
      }

      yield that._balance.sub(packaged.transfer.amount)
      yield that._rpc.call('expireTransfer', [transferId]).catch(() => {})
      that.emitAsync((packaged.isIncoming? 'incoming':'outgoing') + '_cancel',
        packaged.transfer)

    }), (expiry - now))
  }

  * _handleExpireTransfer (transferId) {
    const transfer = yield this._transfers.get(transferId)
    const now = new Date()

    // only expire the transfer if you agree that it's supposed to be expired
    if (now.getTime() < Date.parse(transfer.expiresAt).getTime()) {
      throw new Error(transferId + ' doesn\'t expire until ' + transfer.expiresAt +
        ' (current time is ' + now.toISOString() + ')')
    }

    if (yield this._transfers.cancel(transferId)) {
      this.emitAsync('outgoing_cancel', transfer)
    }

    return true
  }

  * _getInfo () {
    return this._info
  }
}
