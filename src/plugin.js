const EventEmitter = require('events')

const Connection = require('./model/connection').Connection
const Transfer = require('./model/transfer').Transfer
const TransferLog = require('./model/transferlog').TransferLog
const log = require('./controllers/log')

class PluginVirtual extends EventEmitter {

  /* LedgerPlugin API */

  constructor (opts) {
    super()

    this.connected = false
    this.auth = opts.auth
    this.store = opts.store
    // store contains
    //   put(k, v) => promise.null
    //   get(k)    => promise.string
    //   del(k)    => promise.null

    this.myAccount = '1'
    this.otherAccount = '2'
    // TODO: is opts.limit the right place to get this?
    this.limit = opts.limit
    this.transferLog = new TransferLog(this.store)

    this.connectionConfig = {} // no need for a config right now
    this.connection = new Connection({})
    
    var pv = this;
    this.connection.on('receive', (msg) => {
      pv._receive(msg).catch((err) => this._error(err))
    });
    
  }

  connect () {
    // as of right now, there is no need to connect
    this.emit('connect')
    this.connected = true;
    return Promise.resolve(null)
  }

  disconnect () {
    // as of right now, there is no need to disconnect
    this.emit('disconnect')
    this.connected = false;
    return Promise.resolve(null)
  }

  isConnected () {
    return this.connected
  }

  getBalance () {
    return this.store.get("a" + this.myAccount).then((balance) => {
      //TODO: figure out what the store does when a key doesn't exist
      if (!balance) {
        return this.store.put("a" + this.myAccount, 0).then(() => {
          return Promise.resolve(0)
        })
      }
      return Promise.resolve(balance);
    })
  }

  getConnectors () {
    // the connection is only between two plugins for now
    return Promise.resolve([this.otherAccount])
  }

  send (outgoingTransfer) {
    this._log("sending out a Transfer with tid: " + outgoingTransfer.id);
    return this.connection.send({
      type: 'transfer',
      transfer: outgoingTransfer
    }).then(() => {
      return this.transferLog.store(outgoingTransfer)
    }).catch(this._error)
  }

  /* Add these once UTP and ATP are introduced
  fullfillCondition(transferId, fullfillment) {
    // TODO: implement this
  }
  */

  replyToTransfer(transferId, replyMessage) {
    return this.transferLog.getId(transferId).then((storedTransfer) => {
      // TODO: should this send a different type from this?
      return this.connection.send({
        type: 'message',
        transfer: storedTransfer,
        message: replyMessage
      })
    })
  }

  /* Private Functions */
  _receive (obj) {
    // TODO: remove this debug message
    //this._log(JSON.stringify(obj));

    if (obj.type === 'transfer') {

      this._log("received a Transfer with tid: " + obj.transfer.id);
      this.emit('incoming', obj.transfer)
      return this._handleTransfer(new Transfer(obj.transfer))

    } else if (obj.type == 'acknowledge') {

      this._log("received a ACK on tid: " + obj.transfer.id);
      this.emit('reply', obj.transfer, obj.message) // TODO: can obj.message be null?
      return this._handleAcknowledge(new Transfer(obj.transfer))
     
    } else if (obj.type == 'reject') {

      this._log("received a reject on tid: " + obj.transfer.id);
      this.emit('reject', obj.transfer, obj.message)
      return Promise.resolve(null)

    }
  }

  _handleTransfer (transfer) {
    return this.transferLog.store(transfer).then(() => {
      return this.getBalance()
    }).then((balance) => {

      if (balance + (transfer.amount | 0) <= this.limit) {

        return this._addBalance(this.myAccount, transfer.amount).then(() => {
          return this._acceptTransfer(transfer)
        })

      } else {
        return this._rejectTransfer(transfer, 'credit limit exceeded').then(() => {
          return this.transferLog.del(transfer)
        })
      }
    })
  }
  
  _handleAcknowledge (transfer) {

      // subtract the transfer amount because it's acklowledging a sent transaction
      var pv = this
      return this.transferLog.get(transfer).then((storedTransfer) => {
        // TODO: compare better
        if (storedTransfer && storedTransfer.id === transfer.id) {
          return pv._addBalance(pv.myAccount, -1 * transfer.amount)
        } else {
          return pv._error(new Error("Recieved false acknowledge for tid: " + transfer.id))
        }
      })
  }

  _addBalance (account, amt) {
    return this.getBalance().then((balance) => {
      // TODO: make sure that these numbers have the correct precision
      this._log(balance + " changed by " + amt)
      return this.store.put("a" + account, (balance | 0) + (amt | 0) + "")
    }).then(() => {
      // event for debugging
      this.emit('_balanceChanged')
      return Promise.resolve(null)
    })
  }

  _acceptTransfer(transfer) {
    this._log('sending out an ACK for tid: ' + transfer.id);
    return this.connection.send({
      type: 'acknowledge',
      transfer: transfer.serialize(),
      message: new Buffer('transfer accepted')
    })
  }
  _rejectTransfer(transfer, reason) {
    this._log('sending out a reject for tid: ' + transfer.id);
    return this.connection.send({
      type: 'reject',
      transfer: transfer.serialize(),
      message: new Buffer(reason)
    })
  }

  _log (msg) {
    log.log(this.auth.account + ": " + msg)
  }

  _error (err) {
    log.error(err) 
// TODO: figure out why emitting creates two messages
//       even though commenting out log.error removes all messages here
//    this.emit('error', err) 
  }
}

exports.PluginVirtual = PluginVirtual
exports.Connection = Connection
