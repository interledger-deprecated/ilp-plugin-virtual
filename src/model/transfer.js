const BigNumber = require('bignumber.js')

class Transfer {

  constructor (opts) {
    this.opts = opts
    if (!opts) {
      this.opts = {}
    }
  }

  get id () {
    return this.opts.id
  }
  get account () {
    return this.opts.account
  }
  get amount () {
    try {
      return new BigNumber(this.opts.amount)
    } catch (err) {
      return new BigNumber(NaN)
    }
  }
  get data () {
    return this.opts.data
  }
  get executionCondition () {
    return this.opts.executionCondition
  }
  get cancellationCondition () {
    return this.opts.cancellationCondition
  }

  serialize () {
    return {
      id: this.id,
      account: this.account,
      amount: this.amount,
      data: this.data,
      noteToSelf: '',
      executionCondition: this.executionCondition,
      cancellationCondition: this.cancellationCondition,
      expiresAt: '',
      custom: {}
    }
  }

  equals (other) {
    return (
      other &&
      other.id === this.id &&
      this.amount.equals(other.amount)
    )
  }
}

exports.Transfer = Transfer
