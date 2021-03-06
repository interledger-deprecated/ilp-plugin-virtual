'use strict'

const EventEmitter2 = require('eventemitter2')
const crypto = require('crypto')
const base64url = require('base64url')
const IlpPacket = require('ilp-packet')

const HttpRpc = require('../model/rpc')
const Validator = require('../util/validator')
const TransferLog = require('../model/transferlog')
const Balance = require('../model/balance')
const debug = require('debug')('ilp-plugin-virtual')
const Token = require('../util/token')

const errors = require('../util/errors')
const NotAcceptedError = errors.NotAcceptedError
const InvalidFieldsError = errors.InvalidFieldsError
const RequestHandlerAlreadyRegisteredError = errors.RequestHandlerAlreadyRegisteredError

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
      maximum: this._maxBalance,
      store: this._store
    })

    // give a 'balance' event on balance change
    this._balance.on('balance', (balance) => {
      this.emit('balance', balance)
    })

    // Token uses ECDH to get the ledger prefix from secret and public key
    this._authToken = Token.authToken({
      secretKey: this._secret,
      peerPublicKey: this._peerPublicKey
    })

    this._prefix = Token.prefix({
      secretKey: this._secret,
      peerPublicKey: this._peerPublicKey,
      currencyCode: this._currencyCode,
      currencyScale: this._currencyScale
    })

    this._info = Object.assign({}, (opts.info || {}), {
      currencyCode: this._currencyCode,
      currencyScale: this._currencyScale,
      maxBalance: this._maxBalance,
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
    this._requestHandler = null

    // register RPC methods
    this._rpc = new HttpRpc({
      rpcUri: opts.rpcUri,
      plugin: this,
      authToken: this._authToken
    })

    this._rpc.addMethod('send_transfer', this._handleTransfer)
    this._rpc.addMethod('send_message', this._handleMessage)
    this._rpc.addMethod('send_request', this._handleRequest)
    this._rpc.addMethod('fulfill_condition', this._handleFulfillCondition)
    this._rpc.addMethod('reject_incoming_transfer', this._handleRejectIncomingTransfer)
    this._rpc.addMethod('expire_transfer', this._handleExpireTransfer)
    this._rpc.addMethod('get_limit', this._handleGetLimit)
    this._rpc.addMethod('get_balance', this.getBalance)
    this.receive = this._rpc.receive.bind(this._rpc)

    // simple getters
    this.getInfo = () => JSON.parse(JSON.stringify(this._info))
    this.isConnected = () => this._connected
    this.getAccount = () => this._account
    this.isAuthorized = (authToken) => (authToken === this._authToken)
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

  registerRequestHandler (handler) {
    if (this._requestHandler) {
      throw new RequestHandlerAlreadyRegisteredError('requestHandler is already registered')
    }

    if (typeof handler !== 'function') {
      throw new InvalidFieldsError('requestHandler must be a function')
    }

    this._requestHandler = handler
  }

  deregisterRequestHandler () {
    this._requestHandler = null
  }

  async connect () {
    // read in from the store and write the balance
    await this._balance.connect()

    this._connected = true
    this._safeEmit('connect')
  }

  async disconnect () {
    this._connected = false
    this._safeEmit('disconnect')
  }

  async sendMessage (message) {
    this._validator.validateOutgoingMessage(message)
    await this._rpc.call('send_message', this._prefix, [message])
    this._safeEmit('outgoing_message', message)
  }

  async _handleMessage (message) {
    this._validator.validateIncomingMessage(message)

    // assign legacy account field
    this._safeEmit('incoming_message', Object.assign({},
      message,
      { account: this._prefix + this._peerPublicKey }))
    return true
  }

  async sendRequest (message) {
    this._validator.validateOutgoingMessage(message)
    this._safeEmit('outgoing_request', message)

    const response = await this._rpc.call('send_request', this._prefix, [message])
    this._validator.validateIncomingMessage(response)
    this._safeEmit('incoming_response', response)

    return response
  }

  async _handleRequest (message) {
    this._validator.validateIncomingMessage(message)
    this._safeEmit('incoming_request', message)

    if (!this._requestHandler) {
      throw new NotAcceptedError('no request handler registered')
    }

    const response = await this._requestHandler(message)
      .catch((e) => ({
        ledger: message.ledger,
        to: message.from,
        from: this.getAccount(),
        ilp: base64url(IlpPacket.serializeIlpError({
          code: 'F00',
          name: 'Bad Request',
          triggeredBy: this.getAccount(),
          forwardedBy: [],
          triggeredAt: new Date(),
          data: JSON.stringify({ message: e.message })
        }))
      }))

    this._validator.validateOutgoingMessage(response)
    this._safeEmit('outgoing_response', response)

    return response
  }

  async sendTransfer (preTransfer) {
    const transfer = Object.assign({}, preTransfer, { ledger: this._prefix })
    this._validator.validateOutgoingTransfer(transfer)

    // apply the transfer before the other plugin can
    // emit any events about it.

    // one synchronous check and one asynchronous check allows us to first make
    // sure that other functions in the event loop can't apply this transfer
    // (because there's now an entry in the cache that can be checked
    // synchronously) while also checking the long-term store to see if this
    // transfer was added in the past.
    const noRepeat = (this._transfers.cacheOutgoing(transfer) &&
      (await this._transfers.notInStore(transfer)))

    if (!transfer.executionCondition && noRepeat) {
      debug('marking unconditional payment', transfer.id, 'as fulfilled')
      this._transfers.fulfill(transfer.id)
      await this._balance.sub(transfer.amount)
    }

    try {
      await this._rpc.call('send_transfer', this._prefix, [Object.assign({},
        transfer,
        // erase our note to self
        { noteToSelf: undefined })])

      debug('transfer acknowledged ' + transfer.id)

      // end now, so as not to duplicate any effects
      if (!noRepeat) return
    } catch (e) {
      // don't roll back, because nothing happened
      if (!noRepeat) return

      // roll this back, because the other plugin didn't acknowledge
      // the transfer.
      debug(e.name + ' during transfer ' + transfer.id)
      if (!transfer.executionCondition) {
        // only roll back if the transfer is not conditional.  if the receiver
        // somehow found out about the transfer but failed to respond, they
        // still have a chance to fulfill before the timeout is reached
        this._transfers.drop(transfer.id)
        await this._balance.add(transfer.amount)
        throw e
      }
    }

    if (transfer.executionCondition) {
      this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }

    this._safeEmit('outgoing_' +
      (transfer.executionCondition ? 'prepare' : 'transfer'), transfer)
  }

  async _handleTransfer (transfer) {
    this._validator.validateIncomingTransfer(transfer)

    const repeat = !(this._transfers.cacheIncoming(transfer) &&
      (await this._transfers.notInStore(transfer)))

    if (repeat) {
      // return if this transfer has already been stored
      return true
    }

    // balance is added on incoming transfers, but if it fails then the
    // transfer is cancelled so that it can't be rolled back twice
    try {
      await this._balance.add(transfer.amount)
    } catch (e) {
      this._transfers.cancel(transfer.id)
      throw e
    }

    this._safeEmit('incoming_' +
      (transfer.executionCondition ? 'prepare' : 'transfer'), transfer)

    // set up expiry here too, so both sides can send the expiration message
    if (transfer.executionCondition) {
      this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    } else {
      debug('marking unconditional payment', transfer.id, 'as fulfilled')
      this._transfers.fulfill(transfer.id)
    }

    debug('acknowledging transfer id ', transfer.id)
    return true
  }

  async fulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)

    const error = this._transfers.assertAllowedChange(transferId, 'executed')
    if (error) {
      await error
      // if there wasn't an error thrown but the transfer is not able to be executed,
      // forward the RPC call to the other end anyways. They might not have gotten it
      // the first time.
      await this._rpc.call('fulfill_condition', this._prefix, [transferId, fulfillment])
      return
    }

    this._transfers.assertIncoming(transferId)
    const transfer = this._transfers.get(transferId)

    this._validateFulfillment(fulfillment, transfer.executionCondition)
    this._transfers.fulfill(transferId, fulfillment)
    this._safeEmit('incoming_fulfill', transfer, fulfillment)

    // let the other person know after we've already fulfilled, because they
    // don't have to edit their database.
    await this._rpc.call('fulfill_condition', this._prefix, [transferId, fulfillment])
  }

  async _handleFulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)

    const error = this._transfers.assertAllowedChange(transferId, 'executed')
    if (error) {
      await error
      return true
    }

    this._transfers.assertOutgoing(transferId)
    const transfer = this._transfers.get(transferId)

    this._validateFulfillment(fulfillment, transfer.executionCondition)
    this._transfers.fulfill(transferId, fulfillment)
    this._safeEmit('outgoing_fulfill', transfer, fulfillment)
    await this._balance.sub(transfer.amount)

    return true
  }

  async rejectIncomingTransfer (transferId, reason) {
    const transfer = this._transfers.get(transferId)
    debug('going to reject ' + transferId)

    const error = this._transfers.assertAllowedChange(transferId, 'cancelled')
    if (error) {
      await error
      // send another notification to our peer if the error wasn't thrown
      await this._rpc.call('reject_incoming_transfer', this._prefix, [transferId, reason])
      return
    }

    this._transfers.assertIncoming(transferId)

    debug('rejected ' + transferId)
    this._transfers.cancel(transferId)
    this._safeEmit('incoming_reject', transfer, reason)
    await this._balance.sub(transfer.amount)
    await this._rpc.call('reject_incoming_transfer', this._prefix, [transferId, reason])
  }

  async _handleRejectIncomingTransfer (transferId, reason) {
    const transfer = this._transfers.get(transferId)

    const error = this._transfers.assertAllowedChange(transferId, 'cancelled')
    if (error) {
      await error
      return true
    }

    this._transfers.assertOutgoing(transferId)
    this._transfers.cancel(transferId)
    this._safeEmit('outgoing_reject', transfer, reason)
    return true
  }

  async getBalance () {
    return Promise.resolve(this._balance.get())
  }

  async getFulfillment (transferId) {
    return await this._transfers.getFulfillment(transferId)
  }

  _setupTransferExpiry (transferId, expiresAt) {
    const expiry = Date.parse(expiresAt)
    const now = new Date()

    setTimeout(
      this._expireTransfer.bind(this, transferId),
      (expiry - now))
  }

  async _expireTransfer (transferId) {
    debug('checking time out on ' + transferId)

    // don't cancel again if it's already cancelled/executed
    try {
      const error = this._transfers.assertAllowedChange(transferId, 'cancelled')
      if (error) {
        await error
        return
      }
    } catch (e) {
      debug(e.message)
      return
    }

    const cached = this._transfers._getCachedTransferWithInfo(transferId)
    this._transfers.cancel(transferId)

    if (cached.isIncoming) {
      // the balance was only affected when the transfer was incoming.  in the
      // outgoing case, the balance isn't affected until the transfer is
      // fulfilled.
      await this._balance.sub(cached.transfer.amount)
    }

    await this._rpc.call('expire_transfer', this._prefix, [transferId]).catch(() => {})
    this._safeEmit((cached.isIncoming ? 'incoming' : 'outgoing') + '_cancel',
      cached.transfer)
  }

  async _handleExpireTransfer (transferId) {
    const transfer = this._transfers.get(transferId)
    const now = new Date()

    // only expire the transfer if you agree that it's supposed to be expired
    if (now.getTime() < Date.parse(transfer.expiresAt)) {
      throw new Error(transferId + ' doesn\'t expire until ' + transfer.expiresAt +
        ' (current time is ' + now.toISOString() + ')')
    }

    const error = this._transfers.assertAllowedChange(transferId, 'cancelled')
    if (error) {
      await error
      return true
    }

    this._transfers.cancel(transferId)
    this._safeEmit('outgoing_cancel', transfer)

    return true
  }

  async _handleGetLimit () {
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

  async getLimit () {
    // rpc.call turns the balance into a number for some reason, so we turn it back to string
    const peerMaxBalance = String(await this._rpc.call('get_limit', this._prefix, []))
    return this._stringNegate(peerMaxBalance)
  }

  async getPeerBalance () {
    const peerBalance = String(await this._rpc.call('get_balance', this._prefix, []))
    return this._stringNegate(peerBalance)
  }

  _validateFulfillment (fulfillment, condition) {
    this._validator.validateFulfillment(fulfillment)
    const hash = crypto.createHash('sha256')
    hash.update(fulfillment, 'base64')
    if (base64url(hash.digest()) !== condition) {
      throw new NotAcceptedError('Fulfillment does not match the condition')
    }
  }
}
