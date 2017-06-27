const deepEqual = require('deep-equal')

class ObjTransferLog {
  constructor (opts) {
    this.maximum = +opts.maximum
    this.minimum = +opts.minimum
    this.cache = {}
    this.key = opts.key || ''

    // optional, for stateful plugin only
    this.store = opts.store
    this.writeQueue = Promise.resolve()

    // TODO: disable balance? (not needed for client plugin)
    this.balance_if = 0
    this.balance_i = 0
    this.balance_o = 0
    this.balance_of = 0
  }

  async setMaximum (n) {
    this.maximum = +n
  }

  async setMinimum (n) {
    this.minimum = +n
  }

  async getMaximum () {
    return String(this.maximum)
  }

  async getMinimum () {
    return String(this.minimum)
  }

  async getBalance () {
    return String(this.balance_if - this.balance_of)
  }

  async getIncomingFulfilled () {
    return String(this.balance_if)
  }

  async getOutgoingFulfilled () {
    return String(this.balance_of)
  }

  async getIncomingFulfilledAndPrepared () {
    return String(this.balance_i)
  }

  async getOutgoingFulfilledAndPrepared () {
    return String(this.balance_o)
  }

  async get (id) {
    // TODO: errors
    // - what if the transfer doesn't exist?
    return this.cache[id] ||
      (this.store && (await this.store.get(this.key + 'transfer_' + id)))
  }

  async prepare (transfer, isIncoming) {
    // TODO: should direction be a boolean isIncoming?
    // TODO: errors
    // - what if goes over balance?
    // - what if id exists in DB already?
    // - what if the id exists and the contents are different?
    // TODO: should this auto-set the state field?

    const transferWithInfo = {
      transfer,
      isIncoming,
      state: 'prepared'
    }

    // TODO: more elegant way to fix race condition?
    let existing = this.cache[transferWithInfo.transfer.id]
    if (!existing) {
      this.cache[transferWithInfo.transfer.id] = transferWithInfo
      existing = (this.store && (await this.store.get(this.key + 'transfer_' + transfer.id)))
      if (existing) {
        delete this.cache[transferWithInfo.transfer.id]
      }
    }

    if (existing) {
      if (!deepEqual(existing.transfer, transferWithInfo.transfer)) {
        throw new Error('transfer ' + JSON.stringify(transferWithInfo) +
          ' matches the id of ' + JSON.stringify(existing) +
          ' but not the contents.')
      }
      return
    }

    const balance = isIncoming ? 'balance_i' : 'balance_o'
    const otherBalance = this[isIncoming ? 'balance_of' : 'balance_if']

    const amount = transferWithInfo.transfer.amount
    const isOver = isIncoming
      ? (n) => n - otherBalance > this.maximum
      : (n) => n - otherBalance > -this.minimum

    if (isOver(Number(amount) + Number(this[balance]))) {
      throw new Error(balance + ' exceeds greatest allowed value after: ' +
        JSON.stringify(transferWithInfo))
    }

    this[balance] += +transferWithInfo.transfer.amount
    this.cache[transferWithInfo.transfer.id] = transferWithInfo

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + 'transfer_' + transfer.id,
            JSON.stringify(transferWithInfo))
        }).then(() => {
          return this.store.put(this.key + balance, String(this[balance]))
        })

      await this.writeQueue
    }
  }

  async fulfill (transferId, fulfillment) {
    // TODO: errors
    // - what if a transfer is already fulfilled?
    // - what if transfer doesn't exist?
    // - should the fulfillment be validated?
    // - what if the transfer is rejected?
    const transferWithInfo = this.cache[transferId]
    const isIncoming = transferWithInfo.isIncoming
    const balance = isIncoming ? 'balance_if' : 'balance_of'

    if (transferWithInfo.state === 'prepared') {
      this[balance] += +transferWithInfo.transfer.amount
    }

    // TODO: should the failure state be rejected, like FBL API?
    if (transferWithInfo.state === 'cancelled') {
      throw new Error(transferId + ' cannot be fulfilled because it is rejected: ' +
        JSON.stringify(transferWithInfo))
    }

    delete this.cache[transferId]

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + 'transfer_' + transferWithInfo.transfer.id,
            JSON.stringify(transferWithInfo))
        }).then(() => {
          return this.store.put(this.key + balance, String(this[balance]))
        })

      await this.writeQueue
    }
  }

  // TODO: should there be some kind of rejectionReason field? it's useful in FBL.
  async cancel (transferId) {
    // TODO: errors
    // - what if a transfer is already cancelled?
    // - what if transfer doesn't exist?
    // - what if the transfer is fulfilled?
    const transferWithInfo = this.cache[transferId]
    const isIncoming = transferWithInfo.isIncoming
    const balance = isIncoming ? 'balance_i' : 'balance_o'

    if (transferWithInfo.state === 'prepared') {
      this[balance] -= +transferWithInfo.transfer.amount
    }

    // TODO: should the success state be executed, like FBL API?
    if (transferWithInfo.state === 'fulfilled') {
      throw new Error(transferId + ' cannot be rejected because it is fulfilled: ' +
        JSON.stringify(transferWithInfo))
    }

    delete this.cache[transferId]

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + 'transfer_' + transferId,
            JSON.stringify(transferWithInfo))
        }).then(() => {
          return this.store.put(this.key + balance, String(this[balance]))
        })

      await this.writeQueue
    }
  }
}

class getMaxValueTracker {
  constructor (opts) {
    this.highest = { value: '0', data: null }

    // TODO: load from store
    this.store = opts.store
    this.key = opts.key
  }

  async setIfMax (entry) {
    const last = this.highest
    if (+entry.value > +last.value) {
      this.highest = entry
      return last
    }

    return entry
  }

  async getMax () {
    return this.highest
  }
}

module.exports = {
  getTransferLog: (opts) => (new ObjTransferLog(opts)),
  getMaxValueTracker: (opts) => (new MaxValueTracker(opts))
}
