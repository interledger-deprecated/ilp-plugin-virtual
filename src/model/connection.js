const EventEmitter = require('events')
// const log = require('../controllers/log')
const SimplePeer = require('simple-peer')

/* uses the webrtc package, simple-peer. does not yet have signaling */

class Connection extends EventEmitter {

  constructor (config) {
    super()

    /*
      config = {
        initiator: bool
      }
    */
    this.config = config
    this.initiator = config.initiator
    this.peer = null
    this.other = null
  }

  connectPeer (peer) {
    this.other  = peer
  }

  connect () {
    this.peer = SimplePeer({initiator: this.initiator})
    this.peer.on('signal', (data) => {
      this.other.signal(data)
    })
    this.peer.on('data', (data) => {
      this.emit('receive', data)
    })
  }

  disconnect () {
    // TODO: make this thing disconnect sometime
    return Promise.resolve(null)
  }

  send (msg) {
    this.peer.send(msg)
  }

  _getPeer () {
    return this.peer
  }

  static reset () {
    return
    // TODO: remove this entirely
  }
}

exports.Connection = Connection
