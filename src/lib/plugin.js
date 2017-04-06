'use strict'

const EventEmitter2 = require('eventemitter2')
const co = require('co')
const crypto = require('crypto')
const base64url = require('base64url')

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

    assertOptionType(opts, 'currencyCode', 'string')
    assertOptionType(opts, 'currencyScale', 'number')
    assertOptionType(opts, 'maxBalance', 'string')
    assertOptionType(opts, 'secret', 'string')
    assertOptionType(opts, 'peerPublicKey', 'string')
    assertOptionType(opts, '_store', 'object')
    assertOptionType(opts, 'rpcUri', 'string')

    this._secret = opts.secret
    this._peerPublicKey = opts.peerPublicKey
    this._publicKey = Token.publicKey(this._secret)
    this._currencyCode = opts.currencyCode.toUpperCase()
    this._currencyScale = opts.currencyScale

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
      currencyCode: this._currencyCode,
      currencyScale: this._currencyScale
    })

    this._info = Object.assign({}, (opts.info || {}), {
      currencyCode: this._currencyCode,
      currencyScale: this._currencyScale,
      prefix: this._prefix
    })
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
    this._rpc.addMethod('get_balance', this._getBalance)

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
    this.getPeerBalance = co.wrap(this._getPeerBalance).bind(this)

    // simple getters
    this.getInfo = () => JSON.parse(JSON.stringify(this._info))
    this.isConnected = () => this._connected
    this.getAccount = () => this._account
  }

  // don't throw errors even if the event handler throws
  // this is especially important in plugin virtual because
  // errors can prevent the balance from being updated correctly
  _safeEmit () {
    try {
      this.emit.apply(this, arguments)
    } catch (err) {
      debug('error in handler for event', arguments, err)
    }
  }

  * _connect () {
    this._connected = true
    this._safeEmit('connect')
  }

  * _disconnect () {
    this._connected = false
    this._safeEmit('disconnect')
  }

  * _sendMessage (message) {
    this._validator.validateOutgoingMessage(message)
    yield this._rpc.call('send_message', this._prefix, [message])

    this._safeEmit('outgoing_message', message)
  }

  * _handleMessage (message) {
    this._validator.validateIncomingMessage(message)

    // assign legacy account field
    this._safeEmit('incoming_message', Object.assign({},
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

      debug('transfer acknowledged ' + transfer.id)

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
        // only roll back if the transfer is not conditional.  if the receiver
        // somehow found out about the transfer but failed to respond, they
        // still have a chance to fulfill before the timeout is reached
        yield this._transfers.drop(transfer.id)
        throw e
      }
    }

    if (transfer.executionCondition) {
      yield this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }

    this._safeEmit('outgoing_' +
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

    this._safeEmit('incoming_' +
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
      this._safeEmit('incoming_fulfill', transfer, fulfillment)
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
      this._safeEmit('outgoing_fulfill', transfer, fulfillment)
    }

    return true
  }

  * _rejectIncomingTransfer (transferId, reason) {
    const transfer = yield this._transfers.get(transferId)
    debug('going to reject ' + transferId)

    yield this._transfers.assertIncoming(transferId)
    if (yield this._transfers.cancel(transferId)) {
      this._safeEmit('incoming_reject', transfer, reason)
    }
    debug('rejected ' + transferId)

    yield this._balance.sub(transfer.amount)
    yield this._rpc.call('reject_incoming_transfer', this._prefix, [transferId, reason])
  }

  * _handleRejectIncomingTransfer (transferId, reason) {
    const transfer = yield this._transfers.get(transferId)

    yield this._transfers.assertOutgoing(transferId)
    if (yield this._transfers.cancel(transferId)) {
      this._safeEmit('outgoing_reject', transfer, reason)
    }

    return true
  }

  * _handleCancelTransfer (transferId) {
    const transfer = yield this._transfers.get(transferId)
    try {
      if (yield this._transfer.cancel(transferId)) {
        this._safeEmit('outgoing_cancel', transfer)
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

    if (packaged.isIncoming) {
      // the balance was only affected when the transfer was incoming.  in the
      // outgoing case, the balance isn't affected until the transfer is
      // fulfilled.
      yield this._balance.sub(packaged.transfer.amount)
    }

    yield this._rpc.call('expire_transfer', this._prefix, [transferId]).catch(() => {})
    this._safeEmit((packaged.isIncoming ? 'incoming' : 'outgoing') + '_cancel',
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
      this._safeEmit('outgoing_cancel', transfer)
    }

    return true
  }

  * _handleGetLimit () {
    return this._maxBalance
  }

  _stringNegate (num) {
    if (isNaN(+num)) {
      throw new Error('invalid number: ' + num)
    } else if (num.charAt(0) === '-') {
      return num.substring(1)
    } else {
      return '-' + num
    }
  }

  * _getLimit () {
    // rpc.call turns the balance into a number for some reason, so we turn it back to string
    const peerMaxBalance = String(yield this._rpc.call('get_limit', this._prefix, []))
    return this._stringNegate(peerMaxBalance)
  }

  * _getPeerBalance () {
    const peerBalance = String(yield this._rpc.call('get_balance', this._prefix, []))
    return this._stringNegate(peerBalance)
  }

  * _validateFulfillment (fulfillment, condition) {
    this._validator.validateFulfillment(fulfillment)
    const hash = crypto.createHash('sha256')
    hash.update(fulfillment, 'base64')
    if (base64url(hash.digest()) !== condition) {
      throw new NotAcceptedError('Fulfillment does not match the condition')
    }
  }
}
