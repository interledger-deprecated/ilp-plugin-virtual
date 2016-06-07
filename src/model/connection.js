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
    this.initiator = config.initiator
    this.host = config.host
    this.room = config.room
    this.peerConfig = {
      iceServers: [{url: 'stun:stun.l.google.com:19302'}]
    }
    this.peer = new wrtc.RTCPeerConnection(this.peerConfig)
    this.other = null
    this.channel = null
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

  connect () {
    let peer = this.peer
    let host = this.host
    let room = this.room
    let conn = null

    // start by getting the ice information
    return new Promise((resolve, reject) => {
      let channel = this.channel = peer.createDataChannel('test_' + this.initiator, {reliable: true})
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
      this._log('cid: ' + channel.label)

      peer.createOffer((desc) => {
        peer.setLocalDescription(desc, () => {
          this._log('created offer')
        }, () => {})
      }, () => {})
      peer.onicecandidate = (candidate) => {
        if (candidate.candidate == null) {
          this._log('created ice')
          this.ice = peer.localDescription
          this.emit('ice', this.ice)
          resolve()
        }
      }

    }).then(() => {
      this._log('connecting socket')
      conn = socketIoClient.connect(host)
      return new Promise((resolve, reject) => {
        conn.on('connect', () => { resolve() })
        conn.on('connect_error', (err) => {
          this._log('there was a connection error')
          log.error(err)
          reject(err)
        })
      })

    }).then(() => {
      return new Promise((resolve, reject) => {
        this._log('connected to signaling server')
        conn.on('offer', (offer) => { resolve([true, offer.offer]) })
        conn.on('completeWithAnswer', (answer) => { resolve([false, answer.answer]) })
        conn.emit('startWithOffer', { room: room, offer: this.ice })
        this._log('sent my offer')
      })

    }).then((args) => {
      let isAnswerer = args[0]
      let offerOrAnswer = args[1]
      // this._log('got: ' + isAnswerer + " and " + JSON.stringify(offerOrAnswer))
      this._log('got: ' + isAnswerer + ' and ' + offerOrAnswer)

      if (isAnswerer) {
        // we want to make a new peer to get new ICE info
        this._log('I`m answerer')
        this.peer.close()
        this._log('closed old connection')
        this._log('channel: ' + this.channel.readyState)
        let offer = this.offer = new wrtc.RTCSessionDescription(offerOrAnswer)
        this._log('my offer is: ' + offer)
        let peer = this.peer = new wrtc.RTCPeerConnection(this.peerConfig)

        peer.onicecandidate = (candidate) => {
          if (candidate.candidate == null) {
            this.emit('answer', this.answer)
            this._log('I have the ice candidate and I`m sending')
            conn.emit('respondWithAnswer', {
              room: room,
              answer: this.answer
            })
          }
        }

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

        peer.setRemoteDescription(offer, () => {
          this._log('set the remote description')
          peer.createAnswer((answer) => {
            this._log('created my answer')
            this.answer = answer
            peer.setLocalDescription(answer, () => {
              this._log('set my local description')
            }, () => {})
          }, () => {})
        }, () => {})

        return new Promise((resolve) => {
          conn.on('completeWithAnswer', (msg) => {
            this._log('now I`m resolving')
            resolve()
          })
        })

      } else {
        return new Promise((resolve, reject) => {
          this._log('setting the remote description')
          let answer = this.answer = new wrtc.RTCSessionDescription(offerOrAnswer)
          this._log('I created a sessiondescription: ' + answer)

          peer.setRemoteDescription(answer, () => {
            this._log('resolving my promise')
            this._log('channel: ' + this.channel.readyState)
            resolve()
          }, (err) => {
            log.error(err)
            reject(err)
          })
        })
      }
    }).catch((err) => {
      log.error(err)
    })
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
    let name = this.initiator ? 'sender' : 'receiver'
    log.log(name + ': ' + msg)
  }
}

exports.Connection = Connection
