'use strict'

const EventEmitter = require('events')

const Connection = require('../model/connection')
const JsonRpc1 = require('../model/rpc')
const log = require('../util/log')('ilp-plugin-virtual')
const uuid = require('uuid4')

// stricter string -> number parsing
const num = require('../util/num')

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

    this.id = opts.id // not used but required for compatability with five
                      // bells connector.
    this._account = opts.account
    this._prefix = null

    this.connected = false

    // establish connections
    this.connection = new Connection(opts)
    this.rpc = new JsonRpc1(this.connection, this)

    // set up the settler
    this.settler = opts._optimisticPlugin
    if (typeof opts._optimisticPlugin === 'string') {
      const Plugin = require(opts._optimisticPlugin)
      this.settler = new Plugin(opts._optimisticPluginOpts)
    }
    this.settleAddress = opts.settleAddress
    this.settlePercent = opts.settlePercent || '0.5'
    this.settling = false

    // register callbacks for the settler
    if (this.settler) {
      this.settler.on('incoming_transfer', (transfer) => {
        if (transfer.account !== this.settleAddress) return
        this._log('got incoming transfer for ' + transfer.amount)
        this.rpc.call('settled', [transfer])
      })
    }

    // add handlers to rpc
    this.rpc.addMethod('settle', (address, balance, max) => {
      this.settleAddress = address || this.settleAddress
      if (!this.settleAddress || this.settling) return

      this.settling = true
      this.settler.send({
        account: this.settleAddress,
        amount: this._getSettleAmount(balance, max),
        id: uuid()
      }).catch((e) => {
        this.settling = false
      })

      return Promise.resolve(null)
    })

    this.rpc.addMethod('settled', () => {
      this.settling = false
    })

    this.rpc.addMethod('send', (transfer, settleAddress) => {
      if (settleAddress) {
        this.settleAddress = settleAddress
      }

      if (transfer.executionCondition) {
        this.emit('incoming_prepare', transfer)
      } else {
        this.emit('incoming_transfer', transfer)
      }

      return Promise.resolve(true)
    })

    this.rpc.addMethod('cancel', (transfer, message, direction) => {
      this.emit(direction + '_cancel', transfer, message)
      return Promise.resolve(true)
    })

    this.rpc.addMethod('fulfill', (transfer, direction) => {
      this.emit(direction + '_fulfill', transfer)
      return Promise.resolve(true)
    })

    this.rpc.addMethod('rejectIncomingTransfer', (transfer) => {
      this.emit('outgoing_reject', transfer)
      return Promise.resolve(true)
    })

    this.rpc.addMethod('replyToTransfer', (transfer, message) => {
      this.emit('reply', transfer, message)
      return Promise.resolve(true)
    })

    this.rpc.on('notification', (obj) => {
      this._log('got notification of type ' + obj.type)
      switch (obj.type) {
        case 'balance': this.emit('balance', obj.balance)
      }
    })
  }

  _getSettleAmount (balance, max) {
    const balanceNumber = num(balance)
    const maxNumber = num(max)
    const settlePercentNumber = num(this.settlePercent)

    // amount that balance must increase by
    const amount = ((maxNumber - balanceNumber) * settlePercentNumber) + ''
    this._log('going to settle for ' + amount)
    return amount
  }

  _log (msg) {
    log.log(this._account + ': ' + msg)
  }

  getPrefix () {
    this._log('requesting prefix')
    return this.rpc.call('getPrefix', [])
  }

  connect () {
    return new Promise((resolve) => {
      this.connection.on('connect', () => {
        this.connected = true
        this.emit('connect')
        resolve(null)
      })
      this.connection.connect()
    }).then(() => {
      if (this.settler) {
        this.settler.connect()
      }
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
    this._log('requesting connectors')
    return this.rpc.call('getConnectors', [])
  }

  send (outgoingTransfer) {
    this._log('sending out a Transfer with tid: ' + outgoingTransfer.id)
    return this.getPrefix().then((prefix) => {
      outgoingTransfer.ledger = prefix
      if (this.settler) {
        return this.settler.getAccount()
      }
    }).then((account) => {
      return this.rpc.call('send', [
        Object.assign({}, outgoingTransfer, {account: this._account}),
        account
      ])
    }).then((res) => {
      if (!res) return Promise.resolve(null)

      if (outgoingTransfer.executionCondition) {
        this.emit('outgoing_prepare', outgoingTransfer)
      } else {
        this.emit('outgoing_transfer', outgoingTransfer)
      }

      return Promise.resolve(null)
    })
  }

  getBalance () {
    this._log('requesting balance')
    return this.rpc.call('getBalance', [])
      .then((balance) => {
        this.emit('balance', balance)
        return Promise.resolve(balance)
      })
  }

  getInfo () {
    this._log('requesting info')
    return this.rpc.call('getInfo', [])
  }

  fulfillCondition (transferId, fulfillment) {
    this._log('fulfilling condition of ' + transferId)
    return this.rpc.call('fulfillCondition', [transferId, fulfillment])
      .then((res) => {
        if (!res) return Promise.resolve(null)

        this.emit(res.direction + '_fulfill', res.transfer, fulfillment)
      })
  }

  replyToTransfer (transferId, replyMessage) {
    this._log('replying to transfer: ' + transferId)
    return this.rpc.call('replyToTransfer', [transferId, replyMessage])
  }

  getFulfillment (transferId) {
    this._log('requesting fulfillment for ' + transferId)
    return this.rpc.call('getFulfillment', [transferId])
  }

  rejectIncomingTransfer (transferId, message) {
    this._log('sending out a manual reject on tid: ' + transferId)
    return this.rpc.call('rejectIncomingTransfer', [transferId, message])
      .then((transfer) => {
        if (transfer) {
          this.emit('incoming_reject', transfer, message)
        }
      })
  }

  getAccount () {
    return this.getPrefix().then((prefix) => {
      return Promise.resolve(prefix + this._account)
    })
  }

  getSettleAddress () {
    return this.rpc.call('getSettleAddress', [])
      .then((address) => {
        this.settleAddress = address
        return Promise.resolve(address)
      })
  }
}
module.exports = NoobPluginVirtual
