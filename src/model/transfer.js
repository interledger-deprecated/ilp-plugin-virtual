class Transfer {

  constructor (opts) {
    this.opts = opts;
  }
  
  get id () {
    return this.opts.id;
  }
  get account () {
    return this.opts.account;
  }
  get amount () {
    return this.opts.amount;
  }
  get data () {
    return this.opts.data;
  }
  
  serialize () {
    return {
      id: this.id,
      account: this.account,
      amount: this.amount,
      data: this.data,
      noteToSelf: new Buffer(''),
      executionCondition: '',
      cancellationCondition: '',
      expiresAt: '',
      custom: {} 
    }
  }
}

exports.Transfer = Transfer
