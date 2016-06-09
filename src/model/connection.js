'use strict'
const EventEmitter = require('events')
const log = require('../controllers/log')
const socketIoClient = require('socket.io-client')
// const SimplePeer = require('simple-peer')
const wrtc = require('wrtc')
/* eslint-disable padded-blocks */

/* uses the webrtc package, simple-peer. does not yet have signaling */

class Connection extends EventEmitter {

  constructor (config) {
    super()

    /*
      config = {
        initiator: bool
        host: string
        room: string
      }
    */
    this.config = config
    this.name = 'conn'
    this.host = config.host
    this.room = config.room
    this.peerConfig = {
      iceServers: [{url: 'stun:stun.l.google.com:19302'}]
    }
    this.peer = null
    this.other = null
    this.channel = null
    this.conn = null
  }

  setAnswer (answer) {
    this.emit('_answer', answer)
  }
  setOffer (offer) {
    this.emit('_offer', offer)
  }
  getOffer () {
    return this.offer
  }

  _handleError (err) {
    log.error(err)
  }

  _makeDataChannel () {
    let channel = this.channel = this.peer.createDataChannel('test_' + this.name, {reliable: true})
    this._log('cid: ' + channel.label)
    channel.onopen = () => {
      this._log('connected to channel')
      this.emit('connect')
    }
    channel.onmessage = (event) => {
      let data = JSON.parse(event.data)
      this.emit('receive', data)
    }
    channel.onerror = (err) => {
      log.error(err)
      throw err
    }
  }

  connect () {
    this._log('initializing the connection negotiation')

    // start by making a peer; this may or may not be deleted
    let peer = this.peer = new wrtc.RTCPeerConnection(this.peerConfig)

    // create a datachannel; this may or may not be deleted
    this._makeDataChannel()

    // get your connection info and use it to set local info
    peer.createOffer((desc) => {
      peer.setLocalDescription(desc, () => {
        this._log('created offer')
      }, this._handleError)
    }, this._handleError)

    // once the offer is made, onicecandidate will run
    peer.onicecandidate = (candidate) => {
      if (candidate.candidate == null) {
        this.ice = peer.localDescription
        this._log('created ice')
        this.emit('ice', this.ice)

        // proceed to connection phase only when an offer is ready
        this._connectionPhase()
      }
    }
  }

  _connectionPhase () {
    this._log('connecting socket')
    let host = this.host
    let conn = this.conn = socketIoClient.connect(host)

    // only proceed if connection is successful
    conn.on('connect', () => { this._getRole() })
    conn.on('connect_error', this._handleError)
  }

  _getRole () {
    let peer = this.peer
    let conn = this.conn
    let room = this.room
    this._log('connected to signaling server')

    // offer triggers the responder role otherwise wait for the responder to
    // complete. undecided ensures only one path is traversed
    let undecided = true
    conn.on('offer', (offer) => {
      if (undecided) {
        undecided = false
        this._respondToOffer(offer.offer)
      }
    })
    conn.on('completeWithAnswer', (answer) => {
      if (undecided) {
        undecided = false
        this._respondToAnswer(answer.answer)
      }
    })

    // send in your offer then wait for your response
    conn.emit('startWithOffer', { room: room, offer: peer.localDescription })
    this._log('sent my offer')
  }

  _respondToOffer (objOffer) {
    // because we're the responder now, we can shut down the data connection
    // that we started. we'll respond to the incoming data connection instead
    this._log('I`m responder')
    this.channel.close()
    this.peer.close()
    this._log('closed old connection')
    this.offer = new wrtc.RTCSessionDescription(objOffer)
    this.answer = null

    // create a new peer now
    let peer = this.peer = new wrtc.RTCPeerConnection(this.peerConfig)

    // respond with an answer once ICE candidates come in
    peer.onicecandidate = (candidate) => {
      if (candidate.candidate == null) {
        this.emit('answer', this.answer)
        this._log('I have the ice candidate and I`m sending')

        // this will trigger the signalling server to send out a
        // completewithanswer message, which will trigger the offerer to move
        // on
        this.conn.emit('respondWithAnswer', {
          room: this.room,
          answer: this.peer.localDescription
        })
      }
    }

    // we just wait for the real connection on here
    this._handleDataChannels()

    // finalize the network information
    peer.setRemoteDescription(this.offer, () => {
      this._createAnswer()
    }, this._handleError)
  }

  _handleDataChannels () {
    let peer = this.peer

    // register all the events for once actual connection happens
    peer.ondatachannel = (event) => {
      this._log('on data channel active')
      let channel = this.channel = event.channel
      channel.onopen = () => {
        this._log('connected to channel')
        this.emit('connect')
      }
      channel.onmessage = (event) => {
        let data = JSON.parse(event.data)
        this.emit('receive', data)
      }
      channel.onerror = (err) => {
        log.error(err)
        throw err
      }
    }
    this._log('registered datachannel events')
  }

  _createAnswer () {
    let peer = this.peer

    // set up the descriptions and create the answer. This will in turn trigger
    // the onicecandidate from earlier now that the network information exists
    this._log('set the remote description')
    peer.createAnswer((answer) => {
      this._log('created my answer')
      this.answer = answer
      peer.setLocalDescription(answer, () => {
        this._log('set my local description')
      }, this._handleError)
    }, this._handleError)
  }

  _respondToAnswer (objAnswer) {
    let peer = this.peer
    this._log('setting the remote description')
    let answer = this.answer = new wrtc.RTCSessionDescription(objAnswer)
    this._log('I created a session description: ' + answer)

    // after registering the remote description, the data channel should be opened automatically
    peer.setRemoteDescription(answer, () => {
      this._log('channel: ' + this.channel.readyState)
    }, this._handleError)
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
    log.log(this.name + ': ' + msg)
  }
}

exports.Connection = Connection
