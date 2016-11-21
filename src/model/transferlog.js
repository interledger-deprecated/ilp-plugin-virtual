'use strict'
const errors = require('../util/errors')
const TransferNotFoundError = errors.TransferNotFoundError
const TransferNotConditionalError = errors.TransferNotConditionalError
const DuplicateIdError = errors.DuplicateIdError
const NotAcceptedError = errors.NotAcceptedError
const AlreadyRolledBackError = errors.AlreadyRolledBackError
const AlreadyFulfilledError = errors.AlreadyFulfilledError
const MissingFulfillmentError = errors.MissingFulfillmentError
const _ = require('lodash')
const debug = require('debug')('ilp-plugin-virtual:store')

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

  * getFulfillment (transferId) {
    const packaged = yield this._getPackaged(transferId)

    if (!packaged.transfer.executionCondition) {
      throw new TransferNotConditionalError('transfer with id ' + transferId +
        ' is not conditional')

    } else if (packaged.state === 'cancelled') {
      throw new AlreadyRolledBackError('transfer with id ' + transferId +
        ' has already been rolled back')

    } else if (packaged.state === 'prepared') {
      throw new MissingFulfillmentError('transfer with id ' + transferId +
        ' has not been fulfilled')
    }

    return packaged.fulfillment
  }

  * fulfill (transferId, fulfillment) {
    debug('fulfilling with ' + fulfillment)
    return yield this._setState(transferId, 'executed', fulfillment)
  }

  * cancel (transferId) {
    return yield this._setState(transferId, 'cancelled', null)
  }
  
  * drop (transferId) {
    yield this._del('transfer_' + transferId)
  }

  // returns whether or not the state changed
  * _setState(transferId, state, fulfillment) {
    const existingTransfer = yield this._getPackaged(transferId)
    if (!(yield this.assertAllowedChange(transferId, state))) {
      return false
    }

    existingTransfer.state = state
    existingTransfer.fulfillment = fulfillment

    yield this._storePackaged(existingTransfer)
    return true
  }

  * storeIncoming (transfer) {
    yield this._store(transfer, true) 
  }

  * storeOutgoing (transfer) {
    yield this._store(transfer, false)
  }

  * _store (transfer, isIncoming) {
    const stored = yield this._safeGet(transfer.id)

    if (stored && !_.isEqual(transfer, stored)) {
      throw new DuplicateIdError('transfer ' +
        JSON.stringify(transfer) +
        ' matches the id of ' +
        JSON.stringify(stored) +
        ' but not the contents.')
    } else if (stored) {
      return
    }

    debug('stored ' + transfer.id, 'isIncoming', isIncoming)
    yield this._storePackaged({
      transfer: transfer,
      state: (transfer.executionCondition? 'prepared':'executed'),
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
      debug('is incoming?', packaged.isIncoming, 'looking for', isIncoming)
      throw new NotAcceptedError('transfer with id ' + transferId + ' is not ' +
        (isIncoming? 'incoming':'outgoing'))
    }
  }

  * assertAllowedChange (transferId, targetState) {
    const packaged = yield this._getPackaged(transferId)

    // top priority is making sure not to change an optimistic
    if (!packaged.transfer.executionCondition) {
      throw new TransferNotConditionalError('transfer with id ' + transferId + ' is not conditional')
    // next priority is to silently return if the change has already occurred
    } else if (packaged.state === targetState) {
      return false
    } else if (packaged.state === 'executed') {
      throw new AlreadyFulfilledError('transfer with id ' + transferId + ' has already executed')
    } else if (packaged.state === 'cancelled') {
      throw new AlreadyRolledBackError('transfer with id ' + transferId + ' has already rolled back')
    }

    return true
  }

  * _safeGet (transferId) {
    try {
      return yield this.get(transferId)
    } catch (e) {
      return null
    }
  }

  * _getPackaged (transferId) {
    const packaged = yield this._get('transfer_' + transferId)
    if (!packaged) {
      throw new TransferNotFoundError('no transfer with id ' + transferId + ' was found.')
    }
    return JSON.parse(packaged)
  }
}
