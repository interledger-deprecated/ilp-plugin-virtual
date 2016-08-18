'use strict'
const EventEmitter = require('events')

const BigNumber = require('bignumber.js')

class Balance extends EventEmitter {

  constructor (opts) {
    super()

    this._store = opts.store
    this._limit = this._convert(opts.limit)
    this._balance = opts.balance
    this._max = this._convert(opts.max)
    this._warnMax = this._convert(opts.warnMax)
    this._warnLimit = this._convert(opts.warnLimit)
    this._initialized = false
    this._field = 'account'
  }

  _initialize () {
    this._initialized = true
    return this._store.get(this._field).then((balance) => {
      if (balance === undefined) {
        return this._store.put(this._field, this._balance)
      }
    })
  }

  _getNumber () {
    return this.get().then((balance) => {
      return new BigNumber(balance)
    })
  }

  _convert (amount) {
    try {
      return new BigNumber(amount)
    } catch (err) {
      return new BigNumber('NaN')
    }
  }

  get () {
    let promise = Promise.resolve(null)
    if (!this._initialized) { promise = this._initialize() }
    return promise.then(() => {
      return this._store.get(this._field)
    })
  }

  add (amountString) {
    let amount = this._convert(amountString)
    return this._getNumber().then((balance) => {
      let newBalance = balance.add(amount).toString()
      this.emit('_balanceChanged', newBalance)
      this._store.put(this._field, newBalance)
      return Promise.resolve(newBalance)
    })
  }

  sub (amount) {
    return this.add(this._convert(amount).negated().toString())
  }

  isValidOutgoing (amountString) {
    let amount = this._convert(amountString)
    return this._getNumber().then((balance) => {
      let inMax = balance.add(amount).lte(this._max)
      let inWarn = balance.add(amount).lte(this._warnMax)
      let positive = amount.gte(this._convert('0'))
      if (!inWarn) {
        this.emit('over', balance)
      }
      return Promise.resolve(inMax && positive)
    })
  }

  isValidIncoming (amountString) {
    let amount = this._convert(amountString)
    return this._getNumber().then((balance) => {
      let inLimit = balance.sub(amount).gte(this._limit.negated())
      let inWarn = balance.sub(amount).gte(this._warnLimit.negated())
      let positive = amount.gte(this._convert('0'))
      if (!inWarn) {
        this.emit('under', balance)
      }
      return Promise.resolve(inLimit && positive)
    })
  }
}
module.exports = Balance
