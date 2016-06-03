// const log = require('../controllers/log')

class TransferLog {

  constructor (store) {
    this._get = store.get
    this._put = store.put
    this._del = store.del
  }

  getId (transferId) {
    return this._get('t' + transferId).then((jsonTransfer) => {
      if (jsonTransfer) {
        return Promise.resolve(JSON.parse(jsonTransfer))
      } else {
        return Promise.resolve(undefined)
      }
    })
  }

  get (transfer) {
    return this.getId(transfer.id)
  }

  store (transfer) {
    return (this._put('t' + transfer.id, JSON.stringify(transfer)))
  }

  exists (transfer) {
    return this.get(transfer).then((storedTransfer) => {
      return Promise.resolve(storedTransfer !== undefined)
    })
  }

  del (transfer) {
    return this._del('t' + transfer.id)
  }
}

exports.TransferLog = TransferLog
