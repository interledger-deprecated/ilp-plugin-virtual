'use strict'

module.exports = class TransferLog {

  constructor (opts) {
    this._get = opts.store.get
    this._put = opts.store.put
    this._del = opts.store.del
    this.incoming = 'incoming'
    this.outgoing = 'outgoing'
  }

  * get (transferId) {
    return (yield this._getPackaged(transferId)).transfer
  }

  * fulfill (transferId) {
    yield this._setState(transferId, 'fulfilled')
  }

  * cancel (transferId) {
    yield this._setState(transferId, 'cancelled')
  }

  * _setState(transferId, state) {
    const existingTransfer = yield this._getPackaged(transferId)
    yield this.assertFulfillable(transferId)

    existingTransfer.state = state
    yield this._storePackaged(existingTransfer)
  }

  * storeIncoming (transfer) {
    yield this.store(transfer, true) 
  }

  * storeOutgoing (transfer) {
    yield this.store(transfer, false)
  }

  * _store (transfer, isIncoming) {
    const existingTransfer = yield this.get(transfer.id)
    if (existingTransfer && !_.deepEquals(transfer, existingTransfer)) {
      throw new DuplicateIdError('transfer ' +
        JSON.stringify(transfer) +
        ' matches the id of ' +
        JSON.stringify(existingTransfer) +
        ' but not the contents.')
    } else if (existingTransfer) {
      return
    }

    yield this._storePackaged({
      transfer: transfer,
      state: transfer.executionCondition? 'prepared':'executed',
      isIncoming: isIncoming
    })
  }

  * _storePackaged (packaged) {
    yield this._put('transfer_' + packaged.transfer.id, JSON.stringify(packaged))
  }

  * assertIncoming (transferId) {
    yield this._assertDirection(transferId, true)
  }

  * assertOutgoing (transferId) {
    yield this._assertDirection(transferId, false)
  }

  * _assertDirection (transferId, isIncoming) {
    const packaged = yield this._getPackaged(transferId)

    if (packaged.isIncoming !== isIncoming) {
      throw new NotAcceptedError('transfer with id ' + transferId + ' is not ' +
        isIncoming? 'incoming':'outgoing')
    }
  }

  * assertFulfillable (transferId) {
    const packaged = yield this._getPackaged(transferId)

    if (!packaged.transfer.executionCondition) {
      throw new TransferNotConditionalError('transfer with id ' + transferId + ' is not conditional')
    } else if (packaged.state === 'executed') {
      throw new AlreadyFulfilledError('transfer with id ' + transferId + ' has already executed')
    } else if (packaged.state === 'cancelled') {
      throw new AlreadyRolledBackError('transfer with id ' + transferId + ' has already rolled back')
    }
  }

  * _getPackaged (transferId) {
    const packaged = JSON.parse(yield this._get('transfer_' + transferId))    
    if (!packaged) {
      throw new TransferNotFoundError('no transfer with id ' + transferId + ' was found.')
    }
    return packaged
  }
}
