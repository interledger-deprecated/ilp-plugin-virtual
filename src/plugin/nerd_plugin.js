'use strict'

const Errors = require('../util/errors')
const InvalidFieldsError = Errors.InvalidFieldsError
const TransferNotFoundError = Errors.TransferNotFoundError
const MissingFulfillmentError = Errors.MissingFulfillmentError
const RepeatError = Errors.RepeatError
const NotAcceptedError = Errors.NotAcceptedError

const EventEmitter = require('events')
const co = require('co')

const Balance = require('../model/balance')
const Connection = require('../model/connection')
const JsonRpc1 = require('../model/rpc')
const TransferLog = require('../model/transferlog').TransferLog
const log = require('../util/log')('ilp-plugin-virtual')
const uuid = require('uuid4')
const base64url = require('base64url')

const cc = require('five-bells-condition')

class NerdPluginVirtual extends EventEmitter {

  /* LedgerPlugin API */

  /**
  * Create a PluginVirtual
  * @param {object} opts contains PluginOptions for PluginVirtual.
  *
  * @param {object} opts._store methods for persistance
  * @param {function} opts._store.get get an element by key
  * @param {function} opts._store.put store an element by key, value
  * @param {function} opts._store.del delete an elemeny by key
  *
  * @param {string} opts.account name of your PluginVirtual (can be anything)
  * @param {string} opts.prefix ilp address of this ledger
  * @param {string} opts.token channel to connect to in MQTT server
  * @param {string} opts.initialBalance numeric string representing starting balance
  * @param {string} opts.minBalance numeric string representing lowest balance
  * @param {string} opts.maxBalance numeric string representing highest balance
  * @param {string} opts.settleIfUnder if a transfer would put balance under this amount, settle is emitted
  * @param {string} opts.settleIfOver if a transfer would put balance over this amount, settle is emitted
  * @param {string} opts.host hostname of MQTT server
  * @param {object} opts.info object to be returned by getInfo
  */
  constructor (opts) {
    super()

    this.id = opts.id // not used but required for compatability with five
                      // bells connector.
    this.auth = opts
    this._account = opts.account
    this.store = opts._store
    this.timers = {}

    this.info = opts.info || {
      precision: 15,
      scale: 15,
      currencyCode: '???',
      currencySymbol: '?'
    }

    this.transferLog = new TransferLog(opts._store)

    this.prefix = opts.prefix
    this.connector = opts.connector

    if (typeof opts.prefix !== 'string') {
      throw new TypeError('Expected opts.prefix to be a string, received: ' +
        typeof opts.prefix)
    }

    let connectionOpts = Object.assign({}, opts)
    if (typeof opts.token === 'object') {
      const tokenBlob = base64url(JSON.stringify(opts.token))
      this._log('token object encoded as: ' + tokenBlob)
      connectionOpts.token = tokenBlob
    }

    this.connected = false

    this.connection = new Connection(connectionOpts)
    this.rpc = new JsonRpc1(this.connection, this)

    this.settler = opts._optimisticPlugin
    if (typeof opts._optimisticPlugin === 'string') {
      const Plugin = require(opts._optimisticPlugin)
      this.settler = new Plugin(opts._optimisticPluginOpts)
    }

    this.settleAddress = opts.settleAddress
    this.maxBalance = opts.maxBalance
    this.minBalance = opts.minBalance

    this.settleIfOver = opts.settleIfOver
    this.settleIfUnder = opts.settleIfUnder
    this.settlePercent = opts.settlePercent || '0.5'

    this.balance = new Balance({
      store: opts._store,
      min: this.minBalance,
      max: this.maxBalance,
      settleIfUnder: this.settleIfUnder,
      settleIfOver: this.settleIfOver,
      initialBalance: opts.initialBalance
    })

    this.balance.on('_balanceChanged', (balance) => {
      this._log('balance changed to ' + balance)
      this.emit('_balanceChanged', balance)
      this.rpc.notify({ type: 'balance', balance: balance })
    })

    this.balance.on('under', (balance) => {
      return co.wrap(this._settle).call(this, balance)
    })

    this.balance.on('over', (balance) => {
      this._log('settling your balance of ' + balance)
      if (!this.settleAddress || !this.settler) {
        this._log('settlement address and/or optimistic plugin are missing')
        return
      }

      this.settler.send({
        account: this.settleAddress,
        amount: this._getSettleAmount(balance),
        id: uuid()
      })
    })

    if (this.settler) {
      this.settler.on('incoming_transfer', (transfer) => {
        if (transfer.account !== this.settleAddress) return
        this._log('received a settlement for ' + transfer.amount)
        this.balance.add(transfer.amount).then(() => {
          return this.rpc.call('settled', [])
        })
      })
    }

    this.rpc.addMethod('getPrefix', () => {
      return this.getPrefix()
    })

    this.rpc.addMethod('getConnectors', () => {
      return this.getConnectors()
    })

    this.rpc.addMethod('send', (transfer, settleAddress) => {
      return co.wrap(this._handleSend).call(this, transfer, settleAddress)
    })

    this.rpc.addMethod('getBalance', () => {
      return this.getBalance()
    })

    this.rpc.addMethod('getInfo', () => {
      return this.getInfo()
    })

    this.rpc.addMethod('fulfillCondition', (transfer, fulfillment) => {
      return co.wrap(this._fulfillConditionLocal).call(this, transfer, fulfillment)
    })

    this.rpc.addMethod('getFulfillment', (transferId) => {
      return this.getFulfillment(transferId)
    })

    this.rpc.addMethod('rejectIncomingTransfer', (transferId, message) => {
      return co.wrap(this._handleReject).call(this, transferId, message)
    })

    this.rpc.addMethod('replyToTransfer', (transferId, message) => {
      return co.wrap(this._handleReply).call(this, transferId, message)
    })

    this.rpc.addMethod('settled', (transfer) => {
      this._log('confirmed a settlement for ' + transfer.amount)
      return this.balance.sub(transfer.amount).then(() => {
        return Promise.resolve(true)
      })
    })
  }

  getAccount () {
    return Promise.resolve(this.prefix + this._account)
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
      return Promise.resolve(null)
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
    return Promise.resolve([this.connector])
  }

  send (transfer) {
    return co.wrap(this._send).call(this, transfer)
  }

  * _send (transfer) {
    transfer.ledger = this.prefix

    const stored = yield this.transferLog.get(transfer.id)
    if (stored) {
      throw new RepeatError('repeat transfer id')
    }

    yield this.transferLog.storeOutgoing(transfer)

    const valid = yield this.balance.checkAndSettleOutgoing(transfer.amount)
    const validAmount = (typeof transfer.amount === 'string' &&
      !isNaN(transfer.amount - 0) && (transfer.amount - 0 >= 0))
    const validAccount = (typeof transfer.account === 'string')

    if (!validAmount || !validAccount) {
      throw new InvalidFieldsError('missing amount or account')
    }

    if (!valid) {
      throw new NotAcceptedError('amount not valid with current balance')
    }

    const settleAddress = this.settler && (yield this.settler.getAccount())
    yield this.rpc.call('send', [transfer, settleAddress])

    if (!transfer.executionCondition) {
      yield this.balance.add(transfer.amount)
      this.emit('outgoing_transfer', transfer)
    } else {
      this.emit('outgoing_prepare', transfer)
    }

    yield this._completeTransfer(transfer)
    this._handleTimer(transfer)

    return Promise.resolve(null)
  }

  getInfo () {
    return Promise.resolve(this.info)
  }

  getFulfillment (transferId) {
    return co.wrap(this._getFulfillment).call(this, transferId)
  }

  * _getFulfillment (transferId) {
    const stored = yield this.transferLog.get(transferId)
    if (!stored) {
      throw new TransferNotFoundError(transferId + ' not found')
    }

    const fulfilled = yield this.transferLog.isFulfilled(transferId)
    const fulfillment = yield this.transferLog.getFulfillment(transferId)

    if (!fulfillment && fulfilled) {
      throw new TimedOutError(trasferId + ' has been cancelled')
    } else if (!fulfillment) {
      throw new MissingFulfillmentError(transferId + ' has not been fulfilled')
    }

    return fulfillment
  }

  fulfillCondition (transferId, fulfillmentBuffer) {
    let fulfillment = fulfillmentBuffer.toString()
    this._log('fulfilling: ' + fulfillment)

    return co.wrap(this._fulfillConditionLocal).call(this, transferId, fulfillment)
      .then((res) => {
        this.rpc.call('fulfill', [res.transfer, res.direction])
        return Promise.resolve(null)
      })
  }

  * _fulfillConditionLocal (transferId, fulfillment) {
    const transfer = yield this.transferLog.get(transferId)

    if (!transfer || !transfer.executionCondition) {
      throw new TransferNotFoundError('no conditional transfer exists with the given id')
    }

    try {
      cc.fromFulfillmentUri(fulfillment)
    } catch (e) {
      throw new InvalidFieldsError('malformed fulfillment')
    }

    const execute = transfer.executionCondition
    const time = new Date()
    const expiresAt = new Date(transfer.expiresAt)
    const timedOut = (time > expiresAt)

    if (this._validate(fulfillment, execute) && !timedOut) {
      const fulfilled = yield this.transferLog.isFulfilled(transfer.id)
      if (fulfilled) {
        this._log(transferId + ' has already been fulfilled')
        return true
      }

      return yield this._executeTransfer(transfer, fulfillment)
    } else if (timedOut) {
      yield this._timeOutTransfer(transfer)
      throw new TimedOutError('this transfer has already timed out')
    }

    throw new NotAcceptedError('invalid fulfillment')
  }

  rejectIncomingTransfer (transferId, message) {
    return co.wrap(this._rejectIncomingTransfer).call(this, transferId, message)
  }

  * _rejectIncomingTransfer (transferId, message) {
    this._log('rejecting incoming transfer: ' + transferId)

    const transfer = yield this.transferLog.get(transferId)
    if (!transfer || !transfer.executionCondition) {
      throw new TransferNotFoundError('no conditional transfer found with that id')
    }

    const incoming = yield this.transferLog.isIncoming(transfer.id)
    if (!incoming) {
      throw new NotAcceptedError('transfer must be incoming')
    }

    const fulfilled = yield this.transferLog.isFulfilled(transferId)
    if (fulfilled) {
      throw new RepeatError('transfer is already complete')
    }

    yield this.balance.add(transfer.amount)
    yield this.transferLog.fulfill(transfer.id, undefined)

    this.emit('incoming_reject', transfer, 'manually rejected')
    this.rpc.call('rejectIncomingTransfer', [transfer, message])
  }

  _validate (fulfillment, condition) {
    try {
      return cc.validateFulfillment(fulfillment, condition)
    } catch (err) {
      return false
    }
  }

  * _executeTransfer (transfer, fulfillment) {
    let fulfillmentBuffer = new Buffer(fulfillment)
    // because there is only one balance, kept, money is not _actually_ kept
    // in escrow (although it behaves as though it were). So there is nothing
    // to do for the execution condition.

    yield this.transferLog.fulfill(transfer.id, fulfillment)

    const incoming = yield this.transferLog.isIncoming(transfer.id)
    if (!incoming) {
      this.emit('outgoing_fulfill', transfer, fulfillmentBuffer)
      yield this.balance.add(transfer.amount)
    } else { // if (incoming)
      this.emit('incoming_fulfill', transfer, fulfillmentBuffer)
    }

    return {
      transfer: transfer,
      // switch the direction
      direction: (incoming) ? 'outgoing' : 'incoming'
    }
  }

  * _timeOutTransfer (transfer) {
    const incoming = yield this.transferLog.isIncoming(transfer.id)

    if (incoming) {
      this.emit('incoming_cancel', transfer, 'timed out')
      yield this.balance.add(transfer.amount)
    } else {
      this.emit('outgoing_cancel', transfer, 'timed out')
    }

    yield this.transferLog.fulfill(transfer.id, undefined)
    yield this.rpc.call('cancel', [
      transfer,
      'timed out',
      // switch the direction
      incoming ? 'outgoing' : 'incoming'
    ])
  }

  getPrefix () {
    return Promise.resolve(this.prefix)
  }

  getBalance () {
    return this.balance.get()
  }

  replyToTransfer (transferId, replyMessage) {
    return this.transferLog.get(transferId).then((storedTransfer) => {
      if (!storedTransfer) {
        throw new TransferNotFoundError('transfer with id ' + transferId + ' not found')
      }
      this.rpc.call('replyToTransfer', [storedTransfer, replyMessage])
    })
  }

  * _handleReject (transferId, message) {
    const transfer = yield this.transferLog.get(transferId)
    if (!transfer || !transfer.executionCondition) {
      throw new TransferNotFoundError('no conditional transfer with id ' + transferId)
    }

    const incoming = yield this.transferLog.isIncoming(transfer.id)
    if (incoming) {
      throw new NotAcceptedError('you must be receiver to reject')
    }

    const fulfilled = yield this.transferLog.isFulfilled(transferId)
    if (fulfilled) {
      throw new RepeatError('transfer is already complete')
    }

    yield this.transferLog.fulfill(transfer.id, undefined)
    this.emit('outgoing_reject', transfer, message)

    return transfer
  }

  * _handleReply (transferId, message) {
    const transfer = yield this.transferLog.get(transferId)
    if (!transfer) {
      throw new TransferNotFoundError('no transfer with id' + transferId)
    }

    this.emit('reply', transfer, message)
    return true
  }

  * _handleSend (transfer, settleAddress) {
    if (settleAddress) {
      this.settleAddress = settleAddress
    }

    const stored = yield this.transferLog.get(transfer.id)
    if (stored) {
      throw new RepeatError('repeat transfer id')
    }

    yield this.transferLog.storeIncoming(transfer)

    const valid = yield this.balance.checkAndSettleIncoming(transfer.amount)
    const validAmount = (typeof transfer.amount === 'string' &&
      !isNaN(transfer.amount - 0))
    const validAccount = (typeof transfer.account === 'string')

    if (!validAmount || !validAccount) {
      throw new InvalidFieldsError('invalid amount or account')
    }

    if (!valid) {
      throw new NotAcceptedError('transfer was denied with current balance')
    }

    yield this.balance.sub(transfer.amount)
    yield this._completeTransfer(transfer)

    if (transfer.executionCondition) {
      this.emit('incoming_prepare', transfer)
    } else {
      this.emit('incoming_transfer', transfer)
    }

    this._handleTimer(transfer)

    return true
  }

  * _settle (balance) {
    this._log('requesting settle for balance of ' + balance)

    const settleAddress = yield this.settler.getAccount()
    this.rpc.call('settle', [settleAddress, balance, this.maxBalance])
  }

  _handleTimer (transfer) {
    if (transfer.expiresAt) {
      let now = new Date()
      let expiry = new Date(transfer.expiresAt)
      this.timers[transfer.id] = setTimeout(() => {
        this.transferLog.isFulfilled(transfer.id).then((isFulfilled) => {
          if (!isFulfilled) {
            this._log('automatic time out on tid: ' + transfer.id)
            co.wrap(this._timeOutTransfer).call(this, transfer)
          }
        })
      }, expiry - now)
      // for debugging purposes
      this.emit('_timing', transfer.id)
    }
  }

  * _completeTransfer (transfer) {
    yield this.transferLog.complete(transfer.id)
    if (!transfer.executionCondition) {
      yield this.transferLog.fulfill(transfer.id, undefined)
    }
  }

  _getSettleAmount (balance) {
    const balanceNumber = balance - 0
    const minNumber = this.minBalance - 0
    const settlePercentNumber = this.settlePercent - 0

    // amount that balance must decrease by
    return ((balanceNumber - minNumber) * settlePercentNumber) + ''
  }

  _log (msg) {
    log.log(this.auth.account + ': ' + msg)
  }
}

module.exports = NerdPluginVirtual
