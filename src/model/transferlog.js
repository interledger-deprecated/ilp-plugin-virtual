// const log = require('../util/log')

class TransferLog {

  constructor (store) {
    this._get = store.get
    this._put = store.put
    this._del = store.del
    this.incoming = 'i'
    this.outgoing = 'o'
  }

  getId (transferId) {
    return this._get('t' + transferId).then((json) => {
      if (json) {
        return Promise.resolve(JSON.parse(json).transfer)
      } else {
        return Promise.resolve(undefined)
      }
    })
  }

  get (transfer) {
    return this.getId(transfer.id)
  }
  
  getTypeId(transferId) {
    return this._get('t' + transferId).then((json) => {
      if (json) {
        return Promise.resolve(JSON.parse(json).type)
      } else {
        return Promise.resolve(undefined)
      }
    })
  }
  
  getType(transfer) {
    return this.getTypeId(transfer.id)
  }

  store (transfer, type) {
    return (this._put('t' + transfer.id, JSON.stringify({
      transfer: transfer,
      type: type
    })))
  }
  storeOutgoing (transfer) {
    return this.store(transfer, this.outgoing)
  }
  storeIncoming (transfer) {
    return this.store(transfer, this.incoming)
  }

  exists (transfer) {
    return this.get(transfer).then((storedTransfer) => {
      return Promise.resolve(storedTransfer !== undefined)
    })
  }

  del (transfer) {
    return this._del('t' + transfer.id)
  }

  complete (transfer) {
    // TODO: more efficient way of doing this
    return this._put('c' + transfer.id, 'complete')
  }

  isComplete (transfer) {
    return this._get('c' + transfer.id).then((data) => {
      return Promise.resolve(data !== undefined)
    })
  }
}

exports.TransferLog = TransferLog
