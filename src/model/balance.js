'use strict'
const BigNumber = require('bignumber.js')
const debug = require('debug')('ilp-plugin-virtual:balance')
const EventEmitter = require('eventemitter2')

const errors = require('../util/errors')
const NotAcceptedError = errors.NotAcceptedError
const InvalidFieldsError = errors.InvalidFieldsError

const BALANCE_PREFIX = 'balance__'

module.exports = class Balance extends EventEmitter {
  constructor (opts) {
    super()

    this._maximum = new BigNumber(opts.maximum)
    this._balance = null

    this._key = BALANCE_PREFIX
    this._store = opts.store

    // used to keep writes to store in order. See queueWrite.
    this._writeToStoreQueue = Promise.resolve()
  }

  // _queueWrite solves the problem of balance updates being committed to the
  // store out of order. Because calling balance gets and puts asynchronously
  // would cause a race condition, we keep a promise chain in
  // `this._writeToStoreQueue` and attach each balance update to the end via
  // `.then()`. No update to the balance will be committed to the database
  // unless all previous writes are resolved.
  _queueWriteBalance () {
    this._writeToStoreQueue = this._writeToStoreQueue.then(() => {
      return this._store.put(this._key, this._balance.toString())
    })
    return this._writeToStoreQueue
  }

  async connect () {
    let stored = await this._store.get(this._key)

    if (!this._isNumber(stored)) {
      debug('stored balance (' + stored + ') is invalid. rewriting as 0.')
      await this._store.put(this._key, '0')
      stored = '0'
    }

    this._balance = new BigNumber(stored)
  }

  get () {
    return this._balance.toString()
  }

  _getNumber () {
    return this._balance
  }

  async add (number) {
    this._assertNumber(number)

    const balance = this._balance
    if (balance.add(new BigNumber(number)).gt(this._maximum)) {
      throw new NotAcceptedError('adding amount (' + number +
        ') to balance (' + balance +
        ') exceeds maximum (' + this._maximum.toString() +
        ')')
    }

    this._balance = balance.add(new BigNumber(number))
    await this._queueWriteBalance()
    this.emitAsync('balance', this._balance.toString())
  }

  async sub (number) {
    this._assertNumber(number)
    this._balance = this._balance.sub(new BigNumber(number))
    await this._queueWriteBalance()
    this.emitAsync('balance', this._balance.toString())
  }

  _assertNumber (number) {
    if (!this._isNumber(number)) {
      throw new InvalidFieldsError('"' + number + '" is not a number.')
    }
  }

  _isNumber (string) {
    try {
      return !!(new BigNumber(string))
    } catch (e) {
      debug('"' + string + '" is not a number.')
      return false
    }
  }
}
