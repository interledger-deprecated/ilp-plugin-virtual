'use strict'
// const log = require('../util/log')

class TransferLog {

  constructor (store) {
    this._get = store.get
    this._put = store.put
    this._del = store.del
    this.incoming = 'incoming'
    this.outgoing = 'outgoing'
  }

  get (transferId) {
    return this._get('t' + transferId).then((json) => {
      if (json) {
        const transfer = JSON.parse(json).transfer
        return Promise.resolve({
          id: transfer.id,
          account: transfer.account,
          ledger: transfer.ledger,
          amount: transfer.amount,
          data: transfer.data,
          noteToSelf: transfer.noteToSelf,
          executionCondition: transfer.executionCondition,
          expiresAt: transfer.expiresAt,
          custom: transfer.custom
        })
      } else {
        return Promise.resolve(undefined)
      }
    })
  }

  isIncoming (transferId) {
    return this._get('t' + transferId).then((json) => {
      if (json) {
        return Promise.resolve(JSON.parse(json).isIncoming)
      } else {
        return Promise.resolve(undefined)
      }
    })
  }

  store (transfer, incoming) {
    return (this._put('t' + transfer.id, JSON.stringify({
      transfer: transfer,
      isIncoming: incoming
    })))
  }
  storeOutgoing (transfer) {
    return this.store(transfer, false)
  }
  storeIncoming (transfer) {
    return this.store(transfer, true)
  }

  exists (transferId) {
    return this.get(transferId).then((storedTransfer) => {
      return Promise.resolve(storedTransfer !== undefined)
    })
  }

  del (transferId) {
    return this._del('t' + transferId)
  }

  complete (transferId) {
    // TODO: more efficient way of doing this
    return this._put('c' + transferId, 'complete')
  }

  isComplete (transferId) {
    return this._get('c' + transferId).then((data) => {
      return Promise.resolve(data !== undefined)
    })
  }

  fulfill (transferId, fulfillment) {
    // TODO: more efficient way of doing this
    return this._get('t' + transferId).then((json) => {
      const obj = Object.assign(JSON.parse(json), {fulfillment: fulfillment})
      return this._put('t' + transferId, JSON.stringify(obj))
    }).then(() => {
      return this._put('f' + transferId, 'complete')
    })
  }

  isFulfilled (transferId) {
    return this._get('f' + transferId).then((data) => {
      return Promise.resolve(data !== undefined)
    })
  }

  getFulfillment (transferId) {
    return this._get('t' + transferId).then((json) => {
      const obj = json && JSON.parse(json)
      const result = obj && obj.fulfillment
      return Promise.resolve(result || null)
    })
  }
}

exports.TransferLog = TransferLog
