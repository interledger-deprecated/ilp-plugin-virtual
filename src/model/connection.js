const EventEmitter = require('events')
const log = require('../controllers/log')
const webrtc = require('webrtc-native')

/* uses the webrtc package, webrtc-native. does not yet have signaling */

class Connection extends EventEmitter {

  /*
    config = {
      initiator: bool
    }
  */
  constructor (config) {
    super()

    var rtcConfig = {
      iceServers: [
        { url: 'stun:stun.l.google.com:19302' }
      ]
    }
    var datachannelConstraints = {
      audio: false,
      video: false,
      mandatory: {
        OfferToReceiveAudio: false,
        OfferToReceiveVideo: false
      } 
    }

    this.datachannelConfig = {
      reliable: true,
      ordered: true
    }
    this.initiator = config.initiator
    this.peer = new webrtc.RTCPeerConnection(rtcConfig, datachannelConstraints)
    this.other = null
  }

  connectPeer(peerInfo) {
    // for now just connect within one instance of node
    this.other = peerInfo.peer
  }

  connect () {

    var has_candidate = false
    this.peer.onicecandidate = (event) => {
      if (!has_candidate) {
        var candidate = event.candidate || event // used in webrtc tests
        this.other.addIceCandidate(candidate)
        has_candidate = true
      }
    }
    
    // result of unfolding a 7-layer callback chain
    this.peer.onnegotiationneeded = () => {
      new Promise((resolve) => {
        this.peer.createOffer((sdp) => { resolve(sdp) })
      }).then((sdp) => {
        return new Promise((resolve) => {
          this.peer.setLocalDescription(sdp, () => { resolve(sdp) })
        })
      }).then((sdp) => {
        return new Promise((resolve) => {
          this.other.setRemoteDescription(sdp, () => { resolve() })
        })
      }).then(() => {
        return new Promise((resolve) => {
          this.other.createAnswer((sdp) => { resolve(sdp) })
        })
      }).then((sdp) => {
        return new Promise((resolve) => {
          this.other.setLocalDescription(sdp, () => { resolve(sdp) })
        })
      }).then((sdp) => {
        this.peer.setRemoteDescription(sdp, () => {
          this._log("Connected to peer")        
          this.emit('connect')       
        })
      })
    }
    
    this.peer.ondatachannel = (event) => {

      var channel = event.channel || event;
      if (!channel) {
        return false 
      }
      this._channel = channel
      this._log("Connected to datachannel")      
  
      channel.onopen = () => {
        this.emit('open') 
      }      

      channel.onmessage = (event) => {
        this.emit('receive', event.data)
      }

      channel.onclose = () {
        this.emit('close')
      }
    }

    if (this.initiator) {
      this.peer.ondatachannel(
        this.peer.createDataChannel('connection', this.dataChannelConfig)
      )
    }
  }

  disconnect () {
    this._channel.close()
    this.peer.close.close()
  }

  send (msg) {
    this._channel.send(msg)
  }

  _getPeer () {
    return this.peer
  }

  static reset () {
    return
    // TODO: remove this entirely
  }
    
  _log (msg) {
    log.log(msg)
  } 
}

exports.Connection = Connection
