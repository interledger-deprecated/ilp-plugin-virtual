const EventEmitter = require('events')
const BigNumber = require('bignumber.js')

const Connection = require('./model/connection').Connection
const Transfer = require('./model/transfer').Transfer
const TransferLog = require('./model/transferlog').TransferLog
const log = require('./util/log')('plugin')

class PluginVirtual extends EventEmitter {

  /* LedgerPlugin API */

  /**
  * Create a PluginVirtual
  * @param {object} opts contains PluginOptions for PluginVirtual.
  *
  * @param {object} opts.store methods for persistance
  * @param {function} opts.store.get get an element by key
  * @param {function} opts.store.put store an element by key, value
  * @param {function} opts.store.del delete an elemeny by key
  *
  * @param {object} opts.auth ledger-specific information
  * @param {string} opts.auth.account name of your PluginVirtual (can be anything)
  * @param {string} opts.auth.room room to connect to in signalling server
  * @param {string} opts.auth.limit numeric string representing credit limit
  * @param {string} opts.auth.host hostname of signalling server with port
  */
  constructor (opts) {
    super()

    this.connected = false
    this.auth = opts.auth
    this.store = opts.store

    this.myAccount = '1'
    this.otherAccount = '2'
    this.limit = opts.auth.limit
    this.transferLog = new TransferLog(this.store)

    this.connectionConfig = opts.auth
    this.connection = new Connection(this.connectionConfig)

    this.connection.on('receive', (obj) => {
      this._receive(obj).catch((err) => {
        this.emit('error', err)
      })
    })
  }

  static canConnectToLedger (auth) {
    // TODO: Q test the server?
    return true
  }

  connect () {
    return new Promise((resolve) => {
      this.connection.on('connect', () => {
        this.emit('connect')
        this.connected = true
        resolve(null)
      })
      this.connection.connect()
    })
  }

  disconnect () {
    return this.connection.disconnect().then(() => {
      this.emit('disconnect')
      this.connected = false
      return Promise.resolve(null)
    })
  }

  isConnected () {
    return this.connected
  }

  getBalance () {
    return this.store.get('a' + this.myAccount).then((balance) => {
      // TODO: Q figure out what the store does when a key doesn't exist
      if (!balance) {
        return this.store.put('a' + this.myAccount, '0').then(() => {
          return Promise.resolve('0')
        })
      }
      return Promise.resolve(balance)
    })
  }
  _getBalanceFloat () {
    return this.getBalance().then((balance) => {
      return Promise.resolve(new BigNumber(balance))
    })
  }

  getConnectors () {
    // the connection is only between two plugins for now, so the connector
    // name can be literally anything
    return Promise.resolve([this.otherAccount])
  }

  send (outgoingTransfer) {
    this._log('sending out a Transfer with tid: ' + outgoingTransfer.id)
    return this.connection.send({
      type: 'transfer',
      transfer: (new Transfer(outgoingTransfer)).serialize()
    }).then(() => {
      return this.transferLog.store(outgoingTransfer)
    }).catch((err) => {
      this.emit('error', err)
    })
  }

  getInfo () {
    return Promise.resolve({
      /* placeholder values */
      // TODO: Q what should these be
      precision: 'inf',
      scale: 'inf',
      currencyCode: 'GBP',
      currencySymbol: '$'
    })
  }

  /* Add these once UTP and ATP are introduced
  fullfillCondition(transferId, fullfillment) {
    // TODO: implement this
  }
  */

  replyToTransfer (transferId, replyMessage) {
    return this.transferLog.getId(transferId).then((storedTransfer) => {
      return this.connection.send({
        type: 'reply',
        transfer: storedTransfer,
        message: replyMessage
      })
    })
  }

  /* Private Functions */
  _receive (obj) {
    if (obj.type === 'transfer') {
      this._log('received a Transfer with tid: ' + obj.transfer.id)
      this.emit('incoming', obj.transfer)
      return this._handleTransfer(new Transfer(obj.transfer))
    } else if (obj.type === 'acknowledge') {
      this._log('received a ACK on tid: ' + obj.transfer.id)
      // TODO: Q should accept be fullfill execution condition even in OTP?
      this.emit('accept', obj.transfer, new Buffer(obj.message)) // TODO: Q can obj.message be null?
      return this._handleAcknowledge(new Transfer(obj.transfer))
    } else if (obj.type === 'reject') {
      this._log('received a reject on tid: ' + obj.transfer.id)
      this.emit('reject', obj.transfer, new Buffer(obj.message))
      return this.transferLog.complete(obj.transfer)
    } else if (obj.type === 'reply') {
      this._log('received a reply on tid: ' + obj.transfer.id)
      this.emit('reply', obj.transfer, new Buffer(obj.message))
      return Promise.resolve(null)
    } else {
      this.emit('error', new Error('Invalid message received'))
    }
  }

  _handleTransfer (transfer) {
    return this.transferLog.get(transfer).then((storedTransfer) => {
      if (storedTransfer) {
        this.emit('_repeatTransfer', transfer)
        return this._rejectTransfer(transfer, 'repeat transfer id').then(() => {
          throw new Error('repeat transfer id')
        })
      } else {
        return Promise.resolve(null)
      }
    }).then(() => {
      return this.transferLog.store(transfer.serialize())
    }).then(() => {
      return this._getBalanceFloat()
    }).then((balance) => {
      if (transfer.amount.isNaN()) {
        return this._rejectTransfer(transfer, 'amount is not a number')
      } else if (transfer.amount.lte(new BigNumber(0))) {
        return this._rejectTransfer(transfer, 'invalid amount')
      } else if ((balance.add(transfer.amount).lessThanOrEqualTo(this.limit))) {
        return this._addBalance(this.myAccount, transfer.amount).then(() => {
          return this._acceptTransfer(transfer)
        })
      } else {
        return this._rejectTransfer(transfer, 'credit limit exceeded')
      }
    }).catch((err) => {
      this.emit('error', err)
    })
  }

  _handleAcknowledge (transfer) {
    // subtract the transfer amount because it's ackowledging a sent transaction
    var pv = this
    return this.transferLog.get(transfer).then((storedTransfer) => {
      if (transfer.equals(new Transfer(storedTransfer))) {
        return this.transferLog.isComplete(transfer).then((isComplete) => {
          if (isComplete) {
            this._falseAcknowledge(transfer)
          } else {
            return this.transferLog.complete(transfer).then(() => {
              return pv._addBalance(pv.myAccount, transfer.amount.negated())
            })
          }
        })
      } else {
        this._falseAcknowledge(transfer)
      }
    })
  }

  _falseAcknowledge (transfer) {
    this.emit('_falseAcknowledge', transfer)
    this.emit(
      'error',
      new Error('Recieved false acknowledge for tid: ' + transfer.id)
    )
  }

  _addBalance (account, amt) {
    return this._getBalanceFloat().then((balance) => {
      this._log(balance + ' changed by ' + amt)
      let newBalance = balance.add(amt).toString()
      return this.store.put('a' + account, balance.add(amt).toString())
      .then(() => {
        return Promise.resolve(newBalance)
      })
    }).then((newBalance) => {
      // event for debugging
      this.emit('_balanceChanged', newBalance)
      return Promise.resolve(null)
    })
  }

  _acceptTransfer (transfer) {
    this._log('sending out an ACK for tid: ' + transfer.id)
    return this.connection.send({
      type: 'acknowledge',
      transfer: transfer.serialize(),
      message: 'transfer accepted'
    })
  }
  _rejectTransfer (transfer, reason) {
    this._log('sending out a reject for tid: ' + transfer.id)
    this.transferLog.complete(transfer)
    return this.connection.send({
      type: 'reject',
      transfer: transfer.serialize(),
      message: reason
    })
  }

  _log (msg) {
    log.log(this.auth.account + ': ' + msg)
  }
}

exports.PluginVirtual = PluginVirtual
exports.Connection = Connection
