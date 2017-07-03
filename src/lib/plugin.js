'use strict'

const EventEmitter2 = require('eventemitter2')
const crypto = require('crypto')
const base64url = require('base64url')
const IlpPacket = require('ilp-packet')

const HttpRpc = require('../model/rpc')
const Validator = require('../util/validator')
const getBackend = require('../util/backend')
const debug = require('debug')('ilp-plugin-virtual')

const errors = require('../util/errors')
const NotAcceptedError = errors.NotAcceptedError
const InvalidFieldsError = errors.InvalidFieldsError
const AlreadyRejectedError = errors.AlreadyRejectedError
const AlreadyFulfilledError = errors.AlreadyFulfilledError
const RequestHandlerAlreadyRegisteredError = errors.RequestHandlerAlreadyRegisteredError

const assertOptionType = (opts, field, type) => {
  const val = opts[field]
  if (!val || typeof val !== type) {
    throw new InvalidFieldsError('invalid "' + field + '"; got ' + val)
  }
}

module.exports = class PluginPaymentChannel extends EventEmitter2 {
  constructor (paymentChannelBackend, opts) {
    super()
    const Backend = getBackend(opts._store)

    this._opts = opts
    this._stateful = !!(opts._backend || opts._store)

    if (this._stateful) {
      assertOptionType(opts, 'maxBalance', 'string')
      if (opts.minBalance) assertOptionType(opts, 'minBalance', 'string')

      this._backend = opts._backend || Backend
      this._maxBalance = opts.maxBalance
      this._minBalance = opts.minBalance

      this._transfers = this._backend.getTransferLog({
        maximum: this._maxBalance || 'Infinity',
        minimum: this._minBalance || '-Infinity',
        store: (opts._backend ? undefined : opts._store)
      })
    } else {
      this._transfers = Backend.getTransferLog({
        maximum: 'Infinity',
        minimum: '-Infinity'
      })
    }

    if (opts.rpcUris) {
      assertOptionType(opts, 'rpcUris', 'object')
      this._rpcUris = opts.rpcUris
    } else {
      assertOptionType(opts, 'rpcUri', 'string')
      this._rpcUris = [ opts.rpcUri ]
    }

    this._connected = false
    this._requestHandler = null

    // register RPC methods
    this._rpc = new HttpRpc({
      rpcUris: this._rpcUris,
      plugin: this,
      tolerateFailure: opts.tolerateRpcFailure
    })

    this._rpc.addMethod('send_transfer', this._handleTransfer)
    this._rpc.addMethod('send_message', this._handleMessage)
    this._rpc.addMethod('send_request', this._handleRequest)
    this._rpc.addMethod('fulfill_condition', this._handleFulfillCondition)
    this._rpc.addMethod('reject_incoming_transfer', this._handleRejectIncomingTransfer)
    this._rpc.addMethod('expire_transfer', this._handleExpireTransfer)

    if (this._stateful && paymentChannelBackend) {
      this._rpc.addMethod('get_limit', this._handleGetLimit)
      this._rpc.addMethod('get_balance', this._getLowestBalance)
      this._rpc.addMethod('get_info', () => Promise.resolve(this.getInfo))

      this._paychan = paymentChannelBackend || {}
      this._paychanContext = {
        state: {},
        rpc: this._rpc,
        backend: this._backend,
        transferLog: this._transfers,
        plugin: this
      }

      this._paychan.constructor(this._paychanContext, opts)
      this.getInfo = () => this._paychan.getInfo(this._paychanContext)
      this.getAccount = () => this._paychan.getAccount(this._paychanContext)
      this.getPeerAccount = () => this._paychan.getPeerAccount(this._paychanContext)
      this._getAuthToken = () => this._paychan.getAuthToken(this._paychanContext)
    } else {
      assertOptionType(opts, 'token', 'string')
      assertOptionType(opts, 'prefix', 'string')

      this._info = opts.info
      this._peerAccountName = this._stateful ? 'client' : 'server'
      this._accountName = this._stateful ? 'server' : 'client'
      this._prefix = opts.prefix

      // payment channels aren't used in the asymmetric case so it's stubbed out
      this._paychanContext = {}
      this._paychan = {
        connect: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        handleIncomingPrepare: () => Promise.resolve(),
        createOutgoingClaim: () => Promise.resolve(),
        handleIncomingClaim: () => Promise.resolve()
      }

      this.getInfo = () => JSON.parse(JSON.stringify(this._info))
      this.getAccount = () => (this._prefix + this._accountName)
      this.getPeerAccount = () => (this._prefix + this._peerAccountName)
      this._getAuthToken = () => opts.token
    }

    this.receive = this._rpc.receive.bind(this._rpc)
    this.isConnected = () => this._connected
    this.isAuthorized = (authToken) => (authToken === this._getAuthToken())
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
    if (!this._stateful) {
      this._info = await this._rpc.call('get_info', this._prefix, [])
    }

    await this._paychan.connect(this._paychanContext)

    this._prefix = this.getInfo().prefix
    this._validator = new Validator({
      account: this.getAccount(),
      peer: this.getPeerAccount(),
      prefix: this.getInfo().prefix
    })

    this._connected = true
    this._safeEmit('connect')
  }

  async disconnect () {
    await this._paychan.disconnect(this._paychanContext)

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
      { account: this._prefix + this._peerAccountName }))
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
    // emit any events about it. isIncoming = false.
    await this._transfers.prepare(transfer, false)

    try {
      await this._rpc.call('send_transfer', this._prefix, [Object.assign({},
        transfer,
        // erase our note to self
        { noteToSelf: undefined })])

      debug('transfer acknowledged ' + transfer.id)
    } catch (e) {
      debug(e.name + ' during transfer ' + transfer.id)
      if (!this._stateful) {
        throw e
      }
    }

    this._safeEmit('outgoing_prepare', transfer)
    if (this._stateful) {
      this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }
  }

  async _handleTransfer (transfer) {
    this._validator.validateIncomingTransfer(transfer)
    await this._transfers.prepare(transfer, true)

    try {
      await this._paychan.handleIncomingPrepare(this._paychanContext, transfer)
    } catch (e) {
      debug('plugin backend rejected incoming prepare:', e.message)
      await this._transfers.cancel(transfer.id)
      throw e
    }

    // set up expiry here too, so both sides can send the expiration message
    this._safeEmit('incoming_prepare', transfer)
    if (this._stateful) {
      this._setupTransferExpiry(transfer.id, transfer.expiresAt)
    }

    debug('acknowledging transfer id ', transfer.id)
    return true
  }

  async fulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)
    const transferInfo = await this._transfers.get(transferId)

    if (transferInfo.state === 'cancelled') {
      throw new AlreadyRejectedError(transferId + ' has already been cancelled: ' +
        JSON.stringify(transferInfo))
    }

    if (!transferInfo.isIncoming) {
      throw new Error(transferId + ' is outgoing; cannot fulfill')
    }

    if (new Date(transferInfo.transfer.expiresAt).getTime() < Date.now()) {
      throw new AlreadyRejectedError(transferId + ' has already expired: ' +
        JSON.stringify(transferInfo))
    }

    this._validateFulfillment(fulfillment, transferInfo.transfer.executionCondition)
    await this._transfers.fulfill(transferId, fulfillment)
    this._safeEmit('incoming_fulfill', transferInfo.transfer, fulfillment)
    const result = await this._rpc.call('fulfill_condition', this._prefix, [transferId, fulfillment])

    try {
      await this._paychan.handleIncomingClaim(this._paychanContext, result)
    } catch (e) {
      debug('error handling incoming claim:', e)
    }
  }

  async _handleFulfillCondition (transferId, fulfillment) {
    this._validator.validateFulfillment(fulfillment)
    const transferInfo = await this._transfers.get(transferId)

    if (transferInfo.state === 'cancelled') {
      throw new AlreadyRejectedError(transferId + ' has already been cancelled: ' +
        JSON.stringify(transferInfo))
    }

    if (transferInfo.isIncoming) {
      throw new Error(transferId + ' is incoming; refusing to fulfill.')
    }

    if (new Date(transferInfo.transfer.expiresAt).getTime() < Date.now()) {
      throw new AlreadyRejectedError(transferId + ' has already expired: ' +
        JSON.stringify(transferInfo))
    }

    this._validateFulfillment(fulfillment, transferInfo.transfer.executionCondition)
    await this._transfers.fulfill(transferId, fulfillment)
    this._safeEmit('outgoing_fulfill', transferInfo.transfer, fulfillment)

    let result = true
    try {
      result = await this._paychan.createOutgoingClaim(
        this._paychanContext,
        await this._transfers.getOutgoingFulfilled())
    } catch (e) {
      debug('error creating outgoing claim:', e)
    }

    return result
  }

  async rejectIncomingTransfer (transferId, reason) {
    debug('going to reject ' + transferId)
    const transferInfo = await this._transfers.get(transferId)

    if (transferInfo.state === 'fulfilled') {
      throw new AlreadyFulfilledError(transferId + ' has already been fulfilled: ' +
        JSON.stringify(transferInfo))
    }

    if (!transferInfo.isIncoming) {
      throw new Error(transferId + ' is outgoing; cannot reject.')
    }

    // TODO: add rejectionReason to interface
    await this._transfers.cancel(transferId, reason)
    debug('rejected ' + transferId)

    this._safeEmit('incoming_reject', transferInfo.transfer, reason)
    await this._rpc.call('reject_incoming_transfer', this._prefix, [transferId, reason])
  }

  async _handleRejectIncomingTransfer (transferId, reason) {
    debug('handling rejection of ' + transferId)
    const transferInfo = await this._transfers.get(transferId)

    if (transferInfo.state === 'fulfilled') {
      throw new AlreadyFulfilledError(transferId + ' has already been fulfilled: ' +
        JSON.stringify(transferInfo))
    }

    if (transferInfo.isIncoming) {
      throw new Error(transferId + ' is incoming; peer cannot reject.')
    }

    // TODO: add rejectionReason to interface
    await this._transfers.cancel(transferId, reason)
    debug('peer rejected ' + transferId)

    this._safeEmit('outgoing_reject', transferInfo.transfer, reason)
    return true
  }

  async getBalance () {
    if (this._stateful) {
      return await this._transfers.getBalance()
    } else {
      return await this.getPeerBalance()
    }
  }

  _getLowestBalance () {
    return Promise.resolve(this._lowestBalance.get())
  }

  async getFulfillment (transferId) {
    if (this._stateful) {
      return await this._transfers.getFulfillment(transferId)
    } else {
      return await this._rpc.call('get_fulfillment', this._prefix, [ transferId ])
    }
  }

  _setupTransferExpiry (transferId, expiresAt) {
    const expiry = Date.parse(expiresAt)
    const now = new Date()

    setTimeout(
      this._expireTransfer.bind(this, transferId),
      (expiry - now))
  }

  async _expireTransfer (transferId) {
    const transferInfo = await this._transfers.get(transferId)
    if (!transferInfo || transferInfo.state !== 'prepared') return

    debug('timing out ' + transferId)
    try {
      await this._transfers.cancel(transferId, 'expired')
    } catch (e) {
      debug('error expiring ' + transferId + ': ' + e.message)
      return
    }

    await this._rpc.call('expire_transfer', this._prefix, [transferId]).catch(() => {})
    this._safeEmit((transferInfo.isIncoming ? 'incoming' : 'outgoing') + '_cancel',
      transferInfo.transfer)
  }

  async _handleExpireTransfer (transferId) {
    const transferInfo = await this._transfers.get(transferId)
    if (transferInfo.state !== 'prepared') return true

    if (Date.now() < Date.parse(transferInfo.transfer.expiresAt)) {
      throw new Error(transferId + ' doesn\'t expire until ' +
        transferInfo.transfer.expiresAt + ' (current time is ' +
        new Date(Date.now()).toISOString() + ')')
    }

    debug('timing out ' + transferId)
    try {
      await this._transfers.cancel(transferId, 'expired')
    } catch (e) {
      debug('error expiring ' + transferId + ': ' + e.message)
      return true
    }

    this._safeEmit((transferInfo.isIncoming ? 'incoming' : 'outgoing') + '_cancel',
      transferInfo.transfer)
    return true
  }

  async _handleGetLimit () {
    return await this._transfers.getMaximum()
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
