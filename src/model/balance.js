'use strict'
const BigNumber = require('bignumber.js')
const debug = require('debug')('ilp-plugin-virtual:balance')

module.exports = class Balance {
  constructor (opts) {
    this._maximum = new BigNumber(opts.maximum)
    this._get = opts.store.get
    this._put = opts.store.put

    // all reserved DB key prefixes are 9 characters
    // so it lines up with 'transfer_'
    this._key = 'balance__'
  }

  * get () {
    return (yield this._getNumber()).toString()
  }

  * _getNumber () {
    const stored = yield this._get(this._key)

    if (!this._isNumber(stored)) {
      debug('stored balance (' + stored + ') is invalid. rewriting as 0.')
      yield this._put(this._key, '0')
      return new BigNumber('0')
    }

    return new BigNumber(stored)
  }

  * add (number) {
    this._assertNumber(number)

    const balance = yield this._getNumber()
    if (balance.add(new BigNumber(number)).gt(this._maximum)) {
      throw new NotAcceptedError('adding amount (' + number +
        ') to balance (' + balance +
        ') exceeds maximum (' + this._maximum.toString() +
        ')')
    }

    this._put(this._key, balance.add(new BigNumber(number)).toString())
  }

  * sub (number) {
    this._assertNumber(number)
    this._put(this._key,
      (yield this._getNumber()).sub(new BigNumber(number)).toString())
  }

  * _assertNumber (number) {
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
