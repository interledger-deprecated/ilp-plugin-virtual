const deepEqual = require('deep-equal')
const BigNumber = require('bignumber.js')
const KEY_REGEX = /^[A-Za-z0-9\-_]*$/
const {
  DuplicateIdError,
  TransferNotFoundError,
  AlreadyRolledBackError,
  AlreadyFulfilledError,
  NotAcceptedError
} = require('./errors')

class ObjTransferLog {
  constructor (store, opts) {
    this.maximum = new BigNumber(opts.maximum || Infinity)
    this.minimum = new BigNumber(opts.minimum || -Infinity)
    this.cache = {}
    this.key = opts.key || ''
    if (!this.key.match(KEY_REGEX)) {
      throw new Error('invalid key: ' + this.key)
    }

    // optional, for stateful plugin only
    this.store = store
    this.writeQueue = Promise.resolve()

    this.balanceIncomingFulfilled = new BigNumber(0)
    this.balanceIncomingFulfilledAndPrepared = new BigNumber(0)
    this.balanceOutgoingFulfilledAndPrepared = new BigNumber(0)
    this.balanceOutgoingFulfilled = new BigNumber(0)
  }

  async connect () {
    if (this.connected) return

    if (this.store) {
      this.maximum = new BigNumber(await this.store.get(this.key + ':tl:maximum') || this.maximum)
      this.minimum = new BigNumber(await this.store.get(this.key + ':tl:minimum') || this.minimum)
      this.balanceIncomingFulfilled = new BigNumber(await this.store.get(this.key + ':tl:balance:if') || 0)
      this.balanceOutgoingFulfilled = new BigNumber(await this.store.get(this.key + ':tl:balance:of') || 0)
      this.balanceIncomingFulfilledAndPrepared = new BigNumber(this.balanceIncomingFulfilled)
      this.balanceOutgoingFulfilledAndPrepared = new BigNumber(this.balanceOutgoingFulfilled)
    }

    this.connected = true
  }

  async setMaximum (n) {
    await this.connect()
    this.maximum = new BigNumber(n)

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + ':tl:maximum', this.maximum.toString())
        })

      await this.writeQueue
    }
  }

  async setMinimum (n) {
    await this.connect()
    this.minimum = new BigNumber(n)

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + ':tl:minimum', this.minimum.toString())
        })

      await this.writeQueue
    }
  }

  async getMaximum () {
    await this.connect()
    return this.maximum.toString()
  }

  async getMinimum () {
    await this.connect()
    return this.minimum.toString()
  }

  async getBalance () {
    await this.connect()
    return this.balanceIncomingFulfilled.sub(this.balanceOutgoingFulfilled).toString()
  }

  async getIncomingFulfilled () {
    await this.connect()
    return this.balanceIncomingFulfilled.toString()
  }

  async getOutgoingFulfilled () {
    await this.connect()
    return this.balanceOutgoingFulfilled.toString()
  }

  async getIncomingFulfilledAndPrepared () {
    await this.connect()
    return this.balanceIncomingFulfilledAndPrepared.toString()
  }

  async getOutgoingFulfilledAndPrepared () {
    await this.connect()
    return this.balanceOutgoingFulfilledAndPrepared.toString()
  }

  async get (id) {
    await this.connect()
    const transferWithInfo = this.cache[id] ||
      (this.store && (await this.store.get(this.key + ':tl:transfer:' + id)))

    if (!transferWithInfo) {
      throw new TransferNotFoundError('No transfer found with ID ' + id)
    }

    return transferWithInfo
  }

  async prepare (transfer, isIncoming) {
    await this.connect()
    const transferWithInfo = {
      transfer,
      isIncoming,
      state: 'prepared'
    }

    // TODO: more elegant way to fix race condition?
    let existing = this.cache[transferWithInfo.transfer.id]
    if (!existing) {
      this.cache[transferWithInfo.transfer.id] = transferWithInfo
      existing = (this.store && (await this.store.get(this.key + ':tl:transfer:' + transfer.id)))
      if (existing) {
        delete this.cache[transferWithInfo.transfer.id]
        return
      }
    }

    if (existing) {
      if (!deepEqual(existing.transfer, transferWithInfo.transfer)) {
        throw new DuplicateIdError('transfer ' + JSON.stringify(transferWithInfo) +
          ' matches the id of ' + JSON.stringify(existing) +
          ' but not the contents.')
      }
      return
    }

    const balance = isIncoming ? 'balanceIncomingFulfilledAndPrepared' : 'balanceOutgoingFulfilledAndPrepared'
    const otherBalance = this[isIncoming ? 'balanceOutgoingFulfilled' : 'balanceIncomingFulfilled']

    const amount = transferWithInfo.transfer.amount
    const isOver = isIncoming
      ? (n) => n.sub(otherBalance).gt(this.maximum)
      : (n) => n.sub(otherBalance).gt(this.minimum.neg())

    if (isOver(this[balance].add(amount))) {
      throw new NotAcceptedError(balance + ' exceeds greatest allowed value after: ' +
        JSON.stringify(transferWithInfo))
    }

    this[balance] = this[balance].add(amount)
    this.cache[transferWithInfo.transfer.id] = transferWithInfo

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + ':tl:transfer:' + transfer.id,
            JSON.stringify(transferWithInfo))
        })

      await this.writeQueue
    }
  }

  async fulfill (transferId, fulfillment) {
    await this.connect()
    const transferWithInfo = this.cache[transferId]
    if (!transferWithInfo) {
      throw new TransferNotFoundError('No prepared transfer with ID ' + transferId)
    }

    const isIncoming = transferWithInfo.isIncoming
    const balance = isIncoming ? 'balanceIncomingFulfilled' : 'balanceOutgoingFulfilled'

    if (transferWithInfo.state === 'prepared') {
      this[balance] = this[balance].add(transferWithInfo.transfer.amount)
    }

    if (transferWithInfo.state === 'cancelled') {
      throw new AlreadyRolledBackError(transferId + ' cannot be fulfilled because it is rejected: ' +
        JSON.stringify(transferWithInfo))
    }

    transferWithInfo.state = 'fulfilled'
    transferWithInfo.fulfillment = fulfillment
    delete this.cache[transferId]

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + ':tl:transfer:' + transferWithInfo.transfer.id,
            JSON.stringify(transferWithInfo))
        }).then(() => {
          const balanceKey = isIncoming ? ':tl:balance:if' : ':tl:balance:of'
          return this.store.put(this.key + balanceKey, this[balance].toString())
        })

      await this.writeQueue
    }
  }

  async cancel (transferId) {
    await this.connect()
    const transferWithInfo = this.cache[transferId]
    if (!transferWithInfo) {
      throw new TransferNotFoundError('No prepared transfer with ID ' + transferId)
    }

    const isIncoming = transferWithInfo.isIncoming
    const balance = isIncoming
      ? 'balanceIncomingFulfilledAndPrepared'
      : 'balanceOutgoingFulfilledAndPrepared'

    if (transferWithInfo.state === 'prepared') {
      this[balance] = this[balance].sub(transferWithInfo.transfer.amount)
    }

    if (transferWithInfo.state === 'fulfilled') {
      throw new AlreadyFulfilledError(transferId + ' cannot be rejected because it is fulfilled: ' +
        JSON.stringify(transferWithInfo))
    }

    transferWithInfo.state = 'cancelled'
    delete this.cache[transferId]

    if (this.store) {
      this.writeQueue = this.writeQueue
        .then(() => {
          return this.store.put(this.key + ':tl:transfer:' + transferId,
            JSON.stringify(transferWithInfo))
        })

      await this.writeQueue
    }
  }
}

class MaxValueTracker {
  constructor (store, opts) {
    this.highest = { value: '0', data: null }
    this.writeQueue = Promise.resolve()

    this.store = store
    this.key = opts.key || ''
    if (!this.key.match(KEY_REGEX)) {
      throw new Error('invalid key: ' + this.key)
    }
  }

  async connect () {
    if (this.connected) return
    if (this.store) {
      const storedHighest = await this.store.get(this.key + ':mvt:maximum')
      if (storedHighest) this.highest = JSON.parse(storedHighest)
    }

    this.connected = true
  }

  async setIfMax (entry) {
    await this.connect()

    if (!entry.value) {
      throw new Error('entry "' + JSON.stringify(entry) + '" must have a value')
    }

    const last = this.highest
    const lastValue = new BigNumber(last.value)

    if (lastValue.lt(entry.value)) {
      this.highest = entry

      if (this.store) {
        this.writeQueue = this.writeQueue
          .then(() => {
            return this.store.put(this.key + ':mvt:maximum', JSON.stringify({
              value: entry.value,
              data: entry.data
            }))
          })

        await this.writeQueue
      }

      return last
    }

    return entry
  }

  async getMax () {
    await this.connect()

    return this.highest
  }
}

module.exports = (store) => ({
  getTransferLog: (opts) => (new ObjTransferLog(store, opts)),
  getMaxValueTracker: (opts) => (new MaxValueTracker(store, opts))
})
