'use strict'

const EventEmitter = require('events')

const Connection = require('../model/connection')
const log = require('../util/log')('plugin')

class NoobPluginVirtual extends EventEmitter {

  /**
  * Create a PluginVirtual
  * @param {object} opts contains PluginOptions for PluginVirtual.
  *
  * @param {object} opts.store methods for persistance (not used here)
  *
  * @param {object} opts.auth ledger-specific information
  * @param {string} opts.auth.account name of your PluginVirtual (can be anything)
  * @param {string} opts.auth.token room to connect to in signalling server
  * @param {string} opts.auth.host hostname of MQTT server with port
  */
  constructor (opts) {
    super()

    let that = this
    this._handle = (err) => {
      that.emit('exception', err)
    }

    this.auth = opts.auth

    this.connected = false
    this.connectionConfig = opts.auth
    this.connection = new Connection(this.connectionConfig)
    this.connection.on('receive', (obj) => {
      this._receive(obj).catch(this._handle)
    })

    this._expects = {}
    this._seen = {}
    this._fulfilled = {}
  }

  _log (msg) {
    log.log(this.auth.account + ': ' + msg)
  }

  // These functions prevent messages from being
  // processed more than once
  _expectResponse (tid) {
    this._expects[tid] = true
  }
  _expectedResponse (tid) {
    return !!(this._expects[tid])
  }
  _receiveResponse (tid) {
    this._expects[tid] = false
  }
  _seeTransfer (tid) {
    this._seen[tid] = true
  }
  _seenTransfer (tid) {
    return !!(this._seen[tid])
  }
  _fulfilledTransfer (tid) {
    return !!(this._fulfilled[tid])
  }
  _fulfillTransfer (tid) {
    this._fulfilled[tid] = true
  }

  // callback for incoming messages
  _receive (obj) {
    if (obj.type === 'transfer' && !this._seenTransfer(obj.transfer.id)) {
      this._seeTransfer(obj.transfer.id)
      this._log('received a Transfer with tid: ' + obj.transfer.id)
      this.emit('receive', obj.transfer)
      return this.connection.send({
        type: 'acknowledge',
        transfer: obj.transfer,
        message: 'transfer accepted'
      })
    } else if (obj.type === 'acknowledge' &&
    this._expectedResponse(obj.transfer.id)) {
      this._receiveResponse(obj.transfer.id)
      this._log('received an ACK on tid: ' + obj.transfer.id)
      // TODO: Q should accept be fullfill execution condition even in OTP?
      this.emit('accept', obj.transfer, new Buffer(obj.message))
      return Promise.resolve(null)
    } else if (obj.type === 'fulfill_execution_condition' &&
    !this._fulfilledTransfer(obj.transfer.id)) {
      this.emit(
        'fulfill_execution_condition',
        obj.transfer,
        new Buffer(obj.fulfillment)
      )
      this._fulfillTransfer(obj.transfer.id)
      return Promise.resolve(null)
    } else if (obj.type === 'fulfill_cancellation_condition' &&
    !this._fulfilledTransfer(obj.transfer.id)) {
      this.emit(
        'fulfill_cancellation_condition',
        obj.transfer,
        new Buffer(obj.fulfillment)
      )
      this._fulfillTransfer(obj.transfer.id)
      return Promise.resolve(null)
    } else if (obj.type === 'reject' &&
    this._expectedResponse(obj.transfer.id)) {
      this._log('received a reject on tid: ' + obj.transfer.id)
      this.emit('reject', obj.transfer, new Buffer(obj.message))
      return Promise.resolve(null)
    } else if (obj.type === 'reply') {
      this._log('received a reply on tid: ' + obj.transfer.id)
      this.emit('reply', obj.transfer, new Buffer(obj.message))
      return Promise.resolve(null)
    } else if (obj.type === 'balance') {
      this._log('received balance: ' + obj.balance)
      this.emit('_balance', obj.balance)
      return Promise.resolve(null)
    } else if (obj.type === 'info') {
      this._log('received info.')
      this.emit('_info', obj.info)
      return Promise.resolve(null)
    } else {
      this._handle(new Error('Invalid message received'))
      return Promise.resolve(null)
    }
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
    return Promise.resolve(['x'])
  }

  send (outgoingTransfer) {
    this._log('sending out a Transfer with tid: ' + outgoingTransfer.id)
    this._expectResponse(outgoingTransfer.id)
    return this.connection.send({
      type: 'transfer',
      transfer: outgoingTransfer
    }).catch(this._handle())
  }

  getBalance () {
    this._log('sending balance query...')
    this.connection.send({
      type: 'balance'
    })
    return new Promise((resolve) => {
      this.once('_balance', (balance) => {
        resolve(balance)
      })
    })
  }

  getInfo () {
    this._log('sending getInfo query...')
    this.connection.send({
      type: 'info'
    })
    return new Promise((resolve) => {
      this.once('_info', (info) => {
        resolve(info)
      })
    })
  }

  fulfillCondition (transferId, fulfillment) {
    return this.connection.send({
      type: 'fulfillment',
      // TODO: change the main plugin to use IDs in messages for fulfillment
      transferId: transferId,
      fulfillment: fulfillment
    })
  }

  replyToTransfer (transferId, replyMessage) {
    return this.connection.send({
      type: 'reply',
      // TODO: change the main plugin to use IDs in messages for reply
      transferId: transferId,
      message: replyMessage
    })
  }
}
module.exports = NoobPluginVirtual
