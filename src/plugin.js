const eventEmitter = require('events');

class PluginVirtual extends EventEmitter {
  
  /* LedgerPlugin API */

  constructor(opts) {
    this.connected = false;
    this.store = opts.store;
    // store contains
    //   put(k, v) => promise.null
    //   get(k)    => promise.string
    //   del(k)    => promise.null

    this.myAccount = "1";
    this.otherAccount = "2";
  }

  connect() {
    // TODO: implement this
    this.emit('connect');
  }
  
  disconnect() {
    // TODO: implement this
    this.emit('disconnect');
  }
  
  isConnected() {
    return this.connected;
  }

  getBalance() {
    return this.store.get(this.myAccount);
  }

  getConnectors() {
    // TODO: implement this
  }

  send(outgoingTransfer) {
    // TODO: implement this
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


}
