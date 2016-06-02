const eventEmitter = require('events');
const log = require('../controllers/log');

var conns = [null, null];
var connCount = 0;

class Connection extends EventEmitter {

  constructor(config) {
    this.config = config;
    this.conn = connCount++;

    conns[this.conn] = this;

    if (connCount > 2) {
      log.error("Too many connections!");
    }
  }

  function connect() {
    return Promise.resolve(null);
  }

  function disconnect() {
    return Promise.resolve(null);
  }

  function send(msg) {
    conns[(this.conn + 1) % 2].emit('receive', msg);
  }
}
