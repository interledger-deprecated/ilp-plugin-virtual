const EventEmitter = require('events')

class MockOptimisticPlugin extends EventEmitter {
  constructor (opts) {
    super()

    this.channels = opts.channels
    this.index = opts.index
    this.address = opts.address
    this.ledger = opts.prefix
  }

  connect () {
    this.channels[this.index].on('incoming_transfer', (t) => {
      this.emit('incoming_transfer', t)
    })
    return Promise.resolve(null)
  }

  disconnect () { return Promise.resolve(null) }

  send (transfer) {
    this.channels[(this.index + 1) % 2].emit(
      'incoming_transfer',
      Object.assign({},
        transfer,
        {
          account: this.address,
          ledger: this.prefix
        }
      )
    )
    this.emit('outgoing_transfer', transfer)
  }
}

module.exports = MockOptimisticPlugin
