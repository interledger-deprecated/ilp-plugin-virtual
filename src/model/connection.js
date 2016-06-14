'use strict'
const EventEmitter = require('events')
const log = require('../util/log')('connection')
const mqtt = require('mqtt')

class Connection extends EventEmitter {

  constructor (config) {
    super()

    this.config = config
    this.name = config.account
    this.host = config.host
    this.token = config.token

    this.client = null

    this.isNoob = true
    if (this.config.secret) {
      this.isNoob = false
    }
    this.recvChannel = this.isNoob + '' + this.token
    this.sendChannel = !this.isNoob + '' + this.token
  }

  _log (msg) {
    log.log(this.name + ': ' + msg)
  }

  _handle (err) {
    log.error(this.name + ': ' + err) 
  }

  connect () {
    this.client = mqtt.connect(this.host)
    this.client.on('connect', () => {
      client.subscribe(this.recvChannel)
      this.emit('connect')
    })
    this.client.on('message', (channel, data) => {
      this.emit('receive', JSON.parse(data))
    })
    return Promise.resolve(null)
  }
  
  disconnect () {
    this.client.end()
    return Promise.resolve(null)
  }

  send (msg) {
    this.client.publish(this.sendChannel, JSON.stringify(msg))
    return Promise.resolve(null)
  }
}
module.exports = Connection
