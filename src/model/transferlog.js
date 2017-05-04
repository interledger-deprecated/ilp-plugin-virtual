'use strict'
const errors = require('../util/errors')
const TransferNotFoundError = errors.TransferNotFoundError
const TransferNotConditionalError = errors.TransferNotConditionalError
const DuplicateIdError = errors.DuplicateIdError
const NotAcceptedError = errors.NotAcceptedError
const AlreadyRolledBackError = errors.AlreadyRolledBackError
const AlreadyFulfilledError = errors.AlreadyFulfilledError
const MissingFulfillmentError = errors.MissingFulfillmentError
const debug = require('debug')('ilp-plugin-virtual:store')

const TRANSFER_PREFIX = 'transfer_'

module.exports = class TransferLog {

  constructor (opts) {
    this._store = opts.store
    this._storeCache = {}
  }

  _getFromCache (transferId) {
    debug('_getFromCache', transferId)
    return this._storeCache[transferId]
  }

  _putToCache (id, transferWithInfo) {
    debug('_putToCache', id)
    this._storeCache[id] = transferWithInfo
  }

  drop (id) {
    delete this._storeCache[id]
  }

  _putToStore (id) {
    const cached = this._getCachedTransferWithInfo(id)
    if (cached.written) return

    cached.written = true
    this._putCachedTransferWithInfo(cached)
    this._store.put(TRANSFER_PREFIX + id, JSON.stringify(cached))
  }

  get (transferId) {
    return this._getCachedTransferWithInfo(transferId).transfer
  }

  async getFulfillment (transferId) {
    const transferWithInfo = await this._getTransferWithInfo(transferId)

    if (!transferWithInfo.transfer.executionCondition) {
      throw new TransferNotConditionalError('transfer with id ' + transferId +
        ' is not conditional')
    } else if (transferWithInfo.state === 'cancelled') {
      throw new AlreadyRolledBackError('transfer with id ' + transferId +
        ' has already been rolled back')
    } else if (transferWithInfo.state === 'prepared') {
      throw new MissingFulfillmentError('transfer with id ' + transferId +
        ' has not been fulfilled')
    }

    return transferWithInfo.fulfillment
  }

  fulfill (transferId, fulfillment) {
    debug('fulfilling with ' + fulfillment)
    return this._setState(transferId, 'executed', fulfillment)
  }

  cancel (transferId) {
    debug('cancelling ' + transferId)
    return this._setState(transferId, 'cancelled', null)
  }

  // returns whether or not the state changed
  _setState (transferId, state, fulfillment) {
    const cachedTransferWithInfo = this._getCachedTransferWithInfo(transferId)
    cachedTransferWithInfo.state = state
    cachedTransferWithInfo.fulfillment = fulfillment

    this._putCachedTransferWithInfo(cachedTransferWithInfo)
    this._putToStore(cachedTransferWithInfo.transfer.id)

    // clear from cache now that the transfer is resolved
    this.drop(cachedTransferWithInfo.transfer.id)
    return true
  }

  cacheIncoming (transfer) {
    return this._putCachedTransfer(transfer, true)
  }

  cacheOutgoing (transfer) {
    return this._putCachedTransfer(transfer, false)
  }

  async notInStore (transfer) {
    const stored = await this._store.get(TRANSFER_PREFIX + transfer.id)
    return !stored
  }

  _putCachedTransfer (transfer, isIncoming) {
    const cachedTransferWithInfo = this._getFromCache(transfer.id)
    const cachedTransfer = cachedTransferWithInfo &&
      cachedTransferWithInfo.transfer

    if (cachedTransfer && !deepEqual(transfer, cachedTransfer)) {
      throw new DuplicateIdError('transfer ' +
        JSON.stringify(transfer) +
        ' matches the id of ' +
        JSON.stringify(cachedTransfer) +
        ' but not the contents.')
    } else if (cachedTransfer) {
      return false
    }

    debug('stored ' + transfer.id, 'isIncoming', isIncoming)
    this._putCachedTransferWithInfo({
      transfer: transfer,
      state: 'prepared',
      isIncoming: isIncoming
    })

    return true
  }

  _putCachedTransferWithInfo (transferWithInfo) {
    this._putToCache(transferWithInfo.transfer.id, transferWithInfo)
  }

  assertIncoming (transferId) {
    this._assertDirection(transferId, true)
  }

  assertOutgoing (transferId) {
    this._assertDirection(transferId, false)
  }

  _assertDirection (transferId, isIncoming) {
    const cachedTransferWithInfo = this._getCachedTransferWithInfo(transferId)

    if (cachedTransferWithInfo.isIncoming !== isIncoming) {
      debug('is incoming?', cachedTransferWithInfo.isIncoming, 'looking for', isIncoming)
      throw new NotAcceptedError('transfer with id ' + transferId + ' is not ' +
        (isIncoming ? 'incoming' : 'outgoing'))
    }
  }

  assertAllowedChange (transferId, targetState) {
    const cachedTransferWithInfo = this._getCachedTransferWithInfo(transferId)

    // top priority is making sure not to change an optimistic
    if (!cachedTransferWithInfo.transfer.executionCondition) {
      throw new TransferNotConditionalError('transfer with id ' + transferId + ' is not conditional')
    // next priority is to silently return if the change has already occurred
    } else if (cachedTransferWithInfo.state === 'prepared') {
      return
    }

    return this._getTransferWithInfo().then((transferWithInfo) => {
      if (transferWithInfo.state === targetState) {
        return
      } else if (transferWithInfo.state === 'executed') {
        throw new AlreadyFulfilledError('transfer with id ' + transferId + ' has already executed')
      } else if (transferWithInfo.state === 'cancelled') {
        throw new AlreadyRolledBackError('transfer with id ' + transferId + ' has already rolled back')
      }
    })
  }

  async _getTransferWithInfo (transferId) {
    const cachedTransferWithInfo = this._getFromCache(transferId)
    const storedTransferWithInfo = await this._store.get(transferId)

    if (!cachedTransferWithInfo && !storedTransferWithInfo) {
      throw new TransferNotFoundError('no transfer with id ' + transferId + ' was found.')
    }

    return cachedTransferWithInfo || JSON.parse(storedTransferWithInfo)
  }

  _getCachedTransferWithInfo (transferId) {
    const cachedTransferWithInfo = this._getFromCache(transferId)
    if (!cachedTransferWithInfo) {
      throw new TransferNotFoundError('no prepared transfer with id ' + transferId + ' was found.')
    }
    return cachedTransferWithInfo
  }
}

const deepEqual = (a, b) => {
  return deepContains(a, b) && deepContains(b, a)
}

const deepContains = (a, b) => {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  for (let k of Object.keys(a)) {
    if (a[k] && typeof a[k] === 'object') {
      if (!deepContains(a[k], b[k])) {
        return false
      }
    } else if (a[k] !== b[k]) {
      return false
    }
  }
  return true
}
