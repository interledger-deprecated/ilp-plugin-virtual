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
      optional: [
        {
          RtpDataChannels: true,
          DlsSrtpKeyAgreement: false
        }
      ],
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

    this._log("received other")
    this.other = peerInfo.peer
    this.otherConnection = peerInfo
  }

  connect () { 
    return new Promise((resolve) => {
    
      this._log("running this, at least")

      var has_candidate = false
      this.peer.onicecandidate = (event) => {

        this._log("ice candidate") 

        if (!has_candidate) {
          var candidate = event.candidate || event // used in webrtc tests
          this.other.addIceCandidate(candidate)
          has_candidate = true
        }
      }
      
      // TODO: change to promises
      this.peer.onnegotiationneeded = () => {      
        this.peer.createOffer((sdp) => {        
          this.peer.setLocalDescription(sdp, () => {
            this.other.setRemoteDescription(sdp, () => { 
              this.other.createAnswer((sdp) => {
                this.other.setLocalDescription(sdp, () => {
                  this.peer.setRemoteDescription(sdp, () => {
                    this.emit('connect')       
                    this.otherConnection.emit('connect')       
                  });
                });
              });
            });  
          });
        });
      };
      this.on('connect', () => {this._log('connected!')})

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
          this._log(event.data)
          this.emit('receive', event.data)
        }

        channel.onclose = () => {
          this.emit('close')
        }

        this._log("sent out probe")
        this.emit('bloop')
      }

//      this.on('connect', () => {
        this.on('bloop', () => {console.log('bloop') ; this._channel.send('message!')})
        if (this.initiator) {
          this.peer.ondatachannel(
            this.peer.createDataChannel('connection', this.dataChannelConfig)
          )
        }
//      })

      resolve()
    })
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
    var name = this.initiator? "sender" : "recver";
    log.log(name + ": " + msg)
  } 
}

exports.Connection = Connection
