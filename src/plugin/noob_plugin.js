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
  * @param {string} opts.auth.room room to connect to in signalling server
  * @param {string} opts.auth.limit numeric string representing credit limit
  * @param {string} opts.auth.max numeric string representing maximum balance
  * @param {string} opts.auth.host hostname of signalling server with port
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
  }

  _log (msg) {
    log.log(this.auth.account + ': ' + msg)
  }

  _receive (obj) {
    if (obj.type === 'transfer') {
      this._log('received a Transfer with tid: ' + obj.transfer.id)
      this.emit('receive', obj.transfer)
      return this.connection.send({
        type: 'acknowledge',
        transfer: obj.transfer,
        message: 'transfer accepted'
      })
    } else if (obj.type === 'acknowledge') {
      this._log('received an ACK on tid: ' + obj.transfer.id)
      // TODO: Q should accept be fullfill execution condition even in OTP?
      this.emit('accept', obj.transfer, new Buffer(obj.message))
      return Promise.resolve(null)
    } else if (obj.type === 'fulfill_execution_condition') {
      this.emit(
        'fulfill_execution_condition',
        obj.transfer, 
        new Buffer(obj.fulfillment)
      )
      return Promise.resolve(null)
    } else if (obj.type === 'fulfill_cancellation_condition') {
      this.emit(
        'fulfill_cancellation_condition',
        obj.transfer, 
        new Buffer(obj.fulfillment)
      )
      return Promise.resolve(null)
    } else if (obj.type === 'reject') {
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
    } else {
      this._handle(new Error('Invalid message received'))
      return Promise.resolve(null)
    }
  }

  static canConnectToLedger (auth) {
    return true
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
    return this.connection.send({
      type: 'transfer',
      transfer: outgoingTransfer
    }).catch(this._handle())
  }

  getBalance () {
    this._log('sending balance query...')
    this.connection.send({
      type: 'balance',
    })
    return new Promise((resolve) => {
      this.once('_balance', (balance) => {
        resolve(balance)
      })
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
      transfer: transferId,
      message: replyMessage
    })
  }
}
module.exports = NoobPluginVirtual
