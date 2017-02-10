'use strict'

const EventEmitter2 = require('eventemitter2')
const co = require('co')
const cc = require('five-bells-condition')

const HttpRpc = require('../model/rpc')
const Validator = require('../util/validator')
const TransferLog = require('../model/transferlog')
const Balance = require('../model/balance')
const debug = require('debug')('ilp-plugin-virtual')
const Token = require('../util/token')

const errors = require('../util/errors')
const NotAcceptedError = errors.NotAcceptedError
const InvalidFieldsError = errors.InvalidFieldsError

const assertOptionType = (opts, field, type) => {
  const val = opts[field]
  if (!val || typeof val !== type) {
    throw new InvalidFieldsError('invalid "' + field + '"; got ' + val)
  }
}

module.exports = class PluginVirtual extends EventEmitter2 {

  constructor (opts) {
    super()

    assertOptionType(opts, 'currency', 'string')
    assertOptionType(opts, 'maxBalance', 'string')
    assertOptionType(opts, 'secret', 'string')
    assertOptionType(opts, 'peerPublicKey', 'string')
    assertOptionType(opts, '_store', 'object')
    assertOptionType(opts, 'rpcUri', 'string')

    this._currency = opts.currency.toLowerCase()
    this._secret = opts.secret
    this._peerPublicKey = opts.peerPublicKey
    this._publicKey = Token.publicKey(this._secret)

    this._store = opts._store
    this._maxBalance = opts.maxBalance
    this._balance = new Balance({
      store: this._store,
      maximum: this._maxBalance
    })

    // give a 'balance' event on balance change
    this._balance.on('balance', (balance) => {
      this.emit('balance', balance)
    })

    // Token uses ECDH to get the ledger prefix from secret and public key
    this._prefix = Token.prefix({
      secretKey: this._secret,
      peerPublicKey: this._peerPublicKey,
      currency: this._currency
    })

    this._info = Object.assign({}, (opts.info || {}), { prefix: this._prefix })
    this._account = this._prefix + this._publicKey

    if (opts.prefix && opts.prefix !== this._prefix) {
      throw new InvalidFieldsError('invalid prefix. got "' + opts.prefix + '", expected "' + this._prefix + '"')
    }

    this._validator = new Validator({
      account: this._account,
      peer: this._prefix + this._peerPublicKey,
      prefix: this._prefix
    })
    this._transfers = new TransferLog({
      store: this._store
    })
    this._connected = false

    // register RPC methods
    this._rpc = new HttpRpc(opts.rpcUri, this)
    this._rpc.addMethod('send_message', this._handleMessage)
    this._rpc.addMethod('send_transfer', this._handleTransfer)
    this._rpc.addMethod('fulfill_condition', this._handleFulfillCondition)
    this._rpc.addMethod('reject_incoming_transfer', this._handleRejectIncomingTransfer)
    this._rpc.addMethod('expire_transfer', this._handleExpireTransfer)
    this._rpc.addMethod('get_limit', this._handleGetLimit)

    // wrap around generator methods
    this.receive = co.wrap(this._rpc.receive).bind(this._rpc)
    this.connect = co.wrap(this._connect).bind(this)
    this.disconnect = co.wrap(this._disconnect).bind(this)
    this.sendMessage = co.wrap(this._sendMessage).bind(this)
    this.sendTransfer = co.wrap(this._sendTransfer).bind(this)
    this.getBalance = co.wrap(this._getBalance).bind(this)
    this.fulfillCondition = co.wrap(this._fulfillCondition).bind(this)
    this.rejectIncomingTransfer = co.wrap(this._rejectIncomingTransfer).bind(this)
    this.getFulfillment = co.wrap(this._getFulfillment).bind(this)
    this.getLimit = co.wrap(this._getLimit).bind(this)

    // simple getters
    this.getInfo = () => JSON.parse(JSON.stringify(this._info))
    this.isConnected = () => this._connected
    this.getAccount = () => this._account
  }

  * _connect () {
    this._connected = true
    yield this.emitAsync('connect')
  }

  * _disconnect () {
    this._connected = false
    yield this.emitAsync('disconnect')
  }

  * _sendMessage (message) {
    this._validator.validateOutgoingMessage(message)
    yield this._rpc.call('send_message', this._prefix, [message])

    yield this.emitAsync('outgoing_message', message)
  }

  * _handleMessage (message) {
    this._validator.validateIncomingMessage(message)

    // assign legacy account field
    yield this.emitAsync('incoming_message', Object.assign({},
      message,
      { account: this._prefix + this._peerPublicKey }))
    return true
  }

  * _sendTransfer (preTransfer) {
    const transfer = Object.assign({}, preTransfer, { ledger: this._prefix })
    this._validator.validateOutgoingTransfer(transfer)

    // apply the transfer before the other plugin can
    // emit any events about it.

    const repeat = !(yield this._transfers.storeOutgoing(transfer))
    if (!transfer.executionCondition && !repeat) {
      yield this._balance.sub(transfer.amount)
    }

    try {
      yield this._rpc.call('send_transfer', this._prefix, [Object.assign({},
        transfer,
        // erase our note to self
        { noteToSelf: undefined })])

      // end now, so as not to duplicate any effects
      if (repeat) return
    } catch (e) {
      // don't roll back, because nothing happened
      if (repeat) return

      // roll this back, because the other plugin didn't acknowledge
      // the transfer.
      debug(e.name + ' during transfer ' + transfer.id)
      if (!transfer.executionCondition) {
        yield this._balance.add(transfer.amount)
      }
      yield this._transfers.drop(transfer.id)
      throw e
    }

    debug('transfer acknowledged ' + transfer.id)
    if (transfer.executionCondition) {
      yield this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }

    yield this.emitAsync('outgoing_' +
      (transfer.executionCondition ? 'prepare' : 'transfer'), transfer)
  }

  * _handleTransfer (transfer) {
    this._validator.validateIncomingTransfer(transfer)
    if (!(yield this._transfers.storeIncoming(transfer))) {
      // return if this transfer has already been stored
      return true
    }

    // balance is added on incoming transfers, regardless of condition
    yield this._balance.add(transfer.amount)

    yield this.emitAsync('incoming_' +
      (transfer.executionCondition ? 'prepare' : 'transfer'), transfer)

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

    yield this._validateFulfillment(fulfillment, transfer.executionCondition)
    if (yield this._transfers.fulfill(transferId, fulfillment)) {
      yield this.emitAsync('incoming_fulfill', transfer, fulfillment)
    }

    // let the other person know after we've already fulfilled, because they
    // don't have to edit their database.
    yield this._rpc.call('fulfill_condition', this._prefix, [transferId, fulfillment])
  }

  * _handleFulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)

    yield this._transfers.assertOutgoing(transferId)
    yield this._transfers.assertAllowedChange(transferId, 'executed')
    const transfer = yield this._transfers.get(transferId)

    yield this._validateFulfillment(fulfillment, transfer.executionCondition)
    if (yield this._transfers.fulfill(transferId, fulfillment)) {
      yield this._balance.sub(transfer.amount)
      yield this.emitAsync('outgoing_fulfill', transfer, fulfillment)
    }

    return true
  }

  * _rejectIncomingTransfer (transferId, reason) {
    const transfer = yield this._transfers.get(transferId)
    debug('going to reject ' + transferId)

    yield this._transfers.assertIncoming(transferId)
    if (yield this._transfers.cancel(transferId)) {
      yield this.emitAsync('incoming_reject', transfer, reason)
    }
    debug('rejected ' + transferId)

    yield this._balance.sub(transfer.amount)
    yield this._rpc.call('reject_incoming_transfer', this._prefix, [transferId, reason])
  }

  * _handleRejectIncomingTransfer (transferId, reason) {
    const transfer = yield this._transfers.get(transferId)

    yield this._transfers.assertOutgoing(transferId)
    if (yield this._transfers.cancel(transferId)) {
      yield this.emitAsync('outgoing_reject', transfer, reason)
    }

    return true
  }

  * _handleCancelTransfer (transferId) {
    const transfer = yield this._transfers.get(transferId)
    try {
      if (yield this._transfer.cancel(transferId)) {
        yield this.emitAsync('outgoing_cancel', transfer)
      }
    } catch (e) {
      debug(e.message)
    }

    return true
  }

  * _getBalance () {
    return yield this._balance.get()
  }

  * _getFulfillment (transferId) {
    return yield this._transfers.getFulfillment(transferId)
  }

  * _setupTransferExpiry (transferId, expiresAt) {
    const expiry = Date.parse(expiresAt)
    const now = new Date()

    const that = this
    setTimeout(
      co.wrap(this._expireTransfer).bind(this, transferId),
      (expiry - now))
  }

  * _expireTransfer (transferId) {
    debug('checking time out on ' + transferId)

    const packaged = yield this._transfers._getPackaged(transferId)

    // don't cancel again if it's already cancelled/executed
    try {
      if (!(yield this._transfers.cancel(transferId))) {
        debug(transferId + ' is already cancelled')
        return
      }
    } catch (e) {
      debug(e.message)
      return
    }

    yield this._balance.sub(packaged.transfer.amount)
    yield this._rpc.call('expire_transfer', this._prefix, [transferId]).catch(() => {})
    yield this.emitAsync((packaged.isIncoming ? 'incoming' : 'outgoing') + '_cancel',
      packaged.transfer)
  }

  * _handleExpireTransfer (transferId) {
    const transfer = yield this._transfers.get(transferId)
    const now = new Date()

    // only expire the transfer if you agree that it's supposed to be expired
    if (now.getTime() < Date.parse(transfer.expiresAt)) {
      throw new Error(transferId + ' doesn\'t expire until ' + transfer.expiresAt +
        ' (current time is ' + now.toISOString() + ')')
    }

    if (yield this._transfers.cancel(transferId)) {
      yield this.emitAsync('outgoing_cancel', transfer)
    }

    return true
  }

  * _handleGetLimit () {
    return this._maxBalance
  }

  * _getLimit () {
    // rpc.call turns the balance into a number for some reason, so we turn it back to string
    const peerMaxBalance = String(yield this._rpc.call('get_limit', this._prefix, []))
    if (isNaN(+peerMaxBalance)) {
      throw new Error('peer returned invalid limt: ' + peerMaxBalance)
    } else if (peerMaxBalance.charAt(0) === '-') {
      return peerMaxBalance.substring(1)
    } else {
      return '-' + peerMaxBalance
    }
  }

  * _validateFulfillment (fulfillment, condition) {
    try {
      cc.validateFulfillment(fulfillment, condition)
    } catch (e) {
      throw new NotAcceptedError(e.message)
    }
  }
}
