const EventEmitter = require('events')

const Connection = require('./model/connection').Connection
const Transfer = require('./model/transfer').Transfer
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

    this.connectionConfig = {} // no need for a config right now
    this.connection = new Connection({})
    
    var pv = this;
    this.connection.on('receive', function(msg) {
      pv._receive(msg).catch(function(err) { log.error(err) })
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
    return this.store.get(this.myAccount).then((balance) => {
      //TODO: figure out what the store does when a key doesn't exist
      if (!balance) {
        return this.store.put(this.myAccount, 0).then(() => {
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
    log.log(this.auth.account + ": sending out a Transfer");
    return this.connection.send({
      type: 'transfer',
      data: outgoingTransfer
    })
  }

  /* Add these once UTP and ATP are introduced
  fullfillCondition(transferId, fullfillment) {
    // TODO: implement this
  }

  replyToTransfer(transferId, replyMessage) {
    // TODO: implement this
  }
  */

  /* Private Functions */
  _receive (obj) {
    // TODO: remove this debug message
    log.log(this.auth.account + ': ' + JSON.stringify(obj));

    if (obj.type === 'transfer') {
      log.log(this.auth.account + ": received a Transfer");
      return this._handleTransfer(new Transfer(obj.data))
    } else if (obj.type == 'acknowledge') {
      log.log(this.auth.account + ": received an ACK");
      var transfer = new Transfer(obj.data) 
      // subtract the transfer amount because it's acklowledging a sent transaction
      return this._addBalance(this.myAccount, -1 * transfer.amount)
    }
  }

  _handleTransfer (transfer) {
    // TODO: reject when the credit is maxed out
    return this._addBalance(this.myAccount, transfer.amount).then(() => {
      log.log(this.auth.account + ": sending out an ACK");
      return this.connection.send({
        type: 'acknowledge',
        data: transfer.serialize()
      })
    })
  }

  _addBalance (account, amt) {
    return this.getBalance().then((balance) => {
      // TODO: make sure that these numbers have the correct precision
      log.log(this.auth.account + ": " + balance + " changed by " + amt)
      return this.store.put(account, (balance | 0) + (amt | 0) + "")
    })
  }
}

exports.PluginVirtual = PluginVirtual
exports.Connection = Connection
