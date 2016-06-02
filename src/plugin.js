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

  function connect() {
    // TODO: implement this
    this.emit('connect');
  }
  
  function disconnect() {
    // TODO: implement this
    this.emit('disconnect');
  }
  
  function isConnected() {
    return this.connected;
  }

  function getBalance() {
    return this.store.get(this.myAccount);
  }

  function getConnectors() {
    // TODO: implement this
  }

  function send(outgoingTransfer) {
    // TODO: implement this
  }
  
  /* Add these once UTP and ATP are introduced
  function fullfillCondition(transferId, fullfillment) {
    // TODO: implement this
  }

  function replyToTransfer(transferId, replyMessage) {
    // TODO: implement this
  }
  */

  /* Private Functions */


}
