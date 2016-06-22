const EventEmitter = require('events')

const BigNumber = require('bignumber.js')

class Balance extends EventEmitter {

  constructor (opts) {
    super()

    this._store = opts.store
    this._limit = this._convert(opts.limit)
    this._balance = opts.balance
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

  isValidIncoming (amountString) {
    let amount = this._convert(amountString)
    return this._getNumber().then((balance) => {
      let inLimit = balance.sub(amount).gte(this._limit.negated())
      let positive = amount.gt(this._convert('0'))
      return Promise.resolve(inLimit && positive)
    })
  }
}
module.exports = Balance
