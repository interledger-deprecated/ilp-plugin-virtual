'use strict'
const EventEmitter = require('events')
const log = require('debug')('ilp-plugin-virtual:connection')
const mqtt = require('mqtt')
const base64url = require('base64url')

class Connection extends EventEmitter {

  constructor (config) {
    super()

    this.config = config
    this.token = config.token
    this.host = config.host

    this.publicKey = config.publicKey
    this.peerPublicKey = config.peerPublicKey

    this.client = null

    this.recvChannel = this.token + '/' + this.publicKey
    this.sendChannel = this.token + '/' + this.peerPublicKey
  }

  _log (msg) {
    log(this.name + ': ' + msg)
  }

  _handle (err) {
    log(this.name + ': ' + err)
  }

  connect () {
    this.client = mqtt.connect(this.host)
    this._log('connecting to host `' + this.host + '`...')
    this.client.on('connect', () => {
      this.client.subscribe(this.recvChannel)
      this._log('connected! subscribing to channel `' + this.recvChannel + '`')
      this.emit('connect')
    })
    this.client.on('message', (channel, data) => {
      // don't let errors in the handler affect the connection
      try {
        this.emit('receive', JSON.parse(data))
      } catch (err) {}
    })
    return Promise.resolve(null)
  }

  disconnect () {
    this.client.end()
    return Promise.resolve(null)
  }

  send (msg) {
    return new Promise((resolve) => {
      this.client.publish(this.sendChannel, JSON.stringify(msg), resolve)
    })
  }

}
module.exports = Connection
