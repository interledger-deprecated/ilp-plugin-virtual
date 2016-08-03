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
      throw err
    }

    this.id = opts.id // not used but required for compatability with five
                      // bells connector.
    this.auth = opts.auth

    this.connected = false
    this.connectionConfig = opts.auth

    const MockConnection = opts.auth.MockConnection
    this.connection = MockConnection
      ? (new MockConnection(this.connectionConfig))
      : (new Connection(this.connectionConfig))
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

      if (obj.transfer.executionCondition) {
        this.emit('incoming_prepare', obj.transfer)
      } else {
        this.emit('incoming_transfer', obj.transfer)
      }

      return this.connection.send({
        type: 'acknowledge',
        transfer: obj.transfer,
        message: 'transfer accepted'
      })
    } else if (obj.type === 'acknowledge' &&
    this._expectedResponse(obj.transfer.id)) {
      this._receiveResponse(obj.transfer.id)
      this._log('received an ACK on tid: ' + obj.transfer.id)

      this.emit('_accepted', obj.transfer)
      if (obj.transfer.executionCondition) {
        this.emit('outgoing_prepare', obj.transfer)
      } else {
        this._log('GOT AN OUTGOING TRANSFER ACCEPTED')
        this.emit('outgoing_transfer', obj.transfer)
      }

      return Promise.resolve(null)
    } else if (obj.type === 'fulfill_execution_condition' &&
    !this._fulfilledTransfer(obj.transfer.id)) {
      this._fulfillTransfer(obj.transfer.id)

      this.emit(
        obj.toNerd ? 'outgoing_fulfill' : 'incoming_fulfill',
        obj.transfer,
        new Buffer(obj.fulfillment)
      )

      return Promise.resolve(null)
    } else if (obj.type === 'reject' &&
    !this._fulfilledTransfer(obj.transfer.id)) {
      this._log('received a reject on tid: ' + obj.transfer.id)

      this.emit('_rejected', obj.transfer)
      this.emit(
        obj.toNerd ? 'outgoing_cancel' : 'incoming_cancel',
        obj.transfer,
        new Buffer(obj.message)
      )

      return Promise.resolve(null)
    } else if (obj.type === 'reply') {
      this._log('received a reply on tid: ' + obj.transfer.id)

      this.emit('reply', obj.transfer, new Buffer(obj.message))

      return Promise.resolve(null)
    } else if (obj.type === 'balance') {
      this._log('received balance: ' + obj.balance)

      this.emit('balance', obj.balance)

      return Promise.resolve(null)
    } else if (obj.type === 'info') {
      this._log('received info.')

      this.emit('_info', obj.info)

      return Promise.resolve(null)
    } else if (obj.type === 'settlement') {
      this._log('received settlement notification.')

      this.emit('settlement', obj.balance)

      return Promise.resolve(null)
    } else if (obj.type === 'prefix') {
      this._log('received prefix.')

      this._emit('_prefix', obj.prefix)
    } else {
      this._handle(new Error('Invalid message received'))
      return Promise.resolve(null)
    }
  }

  getPrefix () {
    this._log('sending prefix query...')
    return new Promise((resolve) => {
      this.on('_prefix', (prefix) => {
        resolve(prefix)
      })
      this.connection.send({
        type: 'prefix'
      })
    })
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

  send (outgoingTransfer) {
    this._log('sending out a Transfer with tid: ' + outgoingTransfer.id)
    this._expectResponse(outgoingTransfer.id)
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
        transfer: outgoingTransfer
      }).catch(this._handle)
    })
  }

  getBalance () {
    this._log('sending balance query...')
    this.connection.send({
      type: 'balance'
    })
    return new Promise((resolve) => {
      this.once('balance', (balance) => {
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
      transferId: transferId,
      fulfillment: fulfillment
    })
  }

  replyToTransfer (transferId, replyMessage) {
    return this.connection.send({
      type: 'reply',
      transferId: transferId,
      message: replyMessage
    })
  }
}
module.exports = NoobPluginVirtual
