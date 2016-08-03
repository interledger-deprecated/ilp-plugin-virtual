'use strict'
const EventEmitter = require('events')
const log = require('../../src/util/log')('connection')

class MockConnection extends EventEmitter {

  constructor (config) {
    super()

    this.config = config
    this.name = config.account
    this.host = config.host
    this.token = config.token
    this.channels = config.mockChannels

    this.client = null

    this.isNoob = true
    if (this.config.secret) {
      this.isNoob = false
    }

    this.recvChannel = this.channels[(this.isNoob ? 'noob' : 'nerd')]
    this.sendChannel = this.channels[(this.isNoob ? 'nerd' : 'noob')]
  }

  _log (msg) {
    log.log(this.name + ': ' + msg)
  }

  _handle (err) {
    log.error(this.name + ': ' + err)
  }

  connect () {
    this._log('connecting to host `' + this.host + '`...')
    this._log('connected! subscribing to channel `' + this.recvChannel + '`')
    this.emit('connect')
    this.recvChannel.on('message', (channel, data) => {
      this._log('received on', this.isNoob)
      // don't let errors in the handler affect the connection
      try {
        this.emit('receive', JSON.parse(data))
      } catch (err) {
        this._log(err)
      }
    })
    return Promise.resolve(null)
  }

  disconnect () {
    return Promise.resolve(null)
  }

  send (msg) {
    return new Promise((resolve) => {
      this._log('sending on', this.isNoob)
      // asyncronously runs function and swallows
      // the errors, just like a network connection
      setTimeout(() => {
        this.sendChannel.emit(
          'message',
          this.sendChannel,
          JSON.stringify(msg))
      }, 0)
      resolve()
    })
  }

}
module.exports = {
  MockConnection: MockConnection,
  MockChannels: {
    'noob': new EventEmitter(),
    'nerd': new EventEmitter()
  }
}
