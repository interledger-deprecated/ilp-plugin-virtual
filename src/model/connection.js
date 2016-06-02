const EventEmitter = require('events');
const log = require('../controllers/log');

// this is a very basic placeholder version of a connection class,
// that just sends messages between two variables

var conns = [null, null];
var connCount = 0;

class Connection extends EventEmitter {

  constructor(config) {
    super();

    this.config = config;
    this.conn = connCount++;

    conns[this.conn] = this;

    if (connCount > 2) {
      log.error("Too many connections!");
      throw Error("Too Many Connections!");
    }
  }

  connect() {
    return Promise.resolve(null);
  }

  disconnect() {
    return Promise.resolve(null);
  }

  send(msg) {
    conns[(this.conn + 1) % 2].emit('receive', msg);
  }
}

exports.Connection = Connection;
