const EventEmitter = require('events')
const log = require('../controllers/log')
// const SimplePeer = require('simple-peer')
const wrtc = require('wrtc')

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
    this.peer = new wrtc.RTCPeerConnection();
    this.other = null
    this.channel = null
  }

  connectPeer (peer) {
    this.other  = peer.peer
  }

  connect () {
    this.peer.onicecandidate = (candidate) => {
      if (!candidate.candidate) return;
      this.other.addIceCandidate(candidate.candidate)
    }

    if (this.initiator) {
      var channel = this.peer.createDataChannel('test');
      channel.onopen = () => {
        this._log('opening data channel')
        this.emit('open')
        channel.onmessage = (event) => {
          this.emit('receive', event.data)
        }
        this.channel = channel
      }
  
      return new Promise((resolve, reject) => {
        this._log('creating offer')
        this.peer.createOffer(
          (desc) => { resolve(desc) },
          (err) => { reject(err) }
        )
      }).then((desc) => {
        return new Promise((resolve, reject) => {
          this._log('setting local description for peer')
          this.peer.setLocalDescription(
            new wrtc.RTCSessionDescription(desc),
            () => { resolve(desc) },
            (err) => { reject(err) }
          )
        })
      }).then((desc) => {
        return new Promise((resolve, reject) => {
          this._log('setting remote description for other')
          this.other.setRemoteDescription(
            new wrtc.RTCSessionDescription(desc),
            () => { resolve() },
            (err) => { reject(err) }
          )
        })
      }).then(() => {
        return new Promise((resolve, reject) => {
          this._log('creating answer for other')
          this.other.createAnswer(
            (desc) => { resolve(desc) },
            (err) => { reject(err) }
          )
        })
      }).then((desc) => {
        return new Promise((resolve, reject) => {
          this._log('creating local description for other')
          this.other.setLocalDescription(
            new wrtc.RTCSessionDescription(desc),
            () => { resolve(desc) },
            (err) => { reject(err) }
          )
        })
      }).then((desc) => {
        return new Promise((resolve, reject) => {
          this._log('creating remote description for peer')
          this.peer.setRemoteDescription(
            new wrtc.RTCSessionDescription(desc),
            () => { resolve() },
            (err) => { reject(err) } 
          )
        })
      })

    } else {
      this.peer.ondatachannel = (event) => {
        var channel = event.channel
        channel.onopen = () => {
          this._log('opening data channel')
          this.emit('open')
          channel.onmessage = (event) => {
            this.emit('receive', event.data)
          }
          this.channel = channel
        }
      }
      return Promise.resolve(null)
    }
  }

  disconnect () {
    this.peer.destroy()
    // return promise for when network is used
    return Promise.resolve(null)
  }

  send (msg) {
    this.channel.send(JSON.stringify(msg))
    // return promise for when network is used
    return Promise.resolve(null)
  }

  _getPeer () {
    return this.peer
  }

  _log (msg) {
    var name = this.initiator ? 'sender' : 'receiver'
    log.log(name + ": " + msg)
  }
}

exports.Connection = Connection
