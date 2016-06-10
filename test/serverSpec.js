'use strict'

const Connection = require('../src/model/connection')
const assert = require('chai').assert
const server = require('../src/signalling/server')
const log = require('../src/util/log')('test')
const socketIoClient = require('socket.io-client')

describe('Signalling Server', function(doneDescribe) {
  
  it('should be an object containing the `run` function', () => {
    assert.isObject(server)
    assert.isFunction(server.run)
  })

  it('should start', () => {
    server.run()
  })
  
  let host = 'http://localhost:8080'
  let sock1 = null
  let sock2 = null
  let sock3 = null
  let connected = null
  it('should allow sockets to connect', (done) => {
    sock1 = socketIoClient(host)
    sock2 = socketIoClient(host)
    sock3 = socketIoClient(host)
    connected = Promise.all([
      new Promise((resolve) => {
        sock1.on('connect', () => {
          resolve()
        }) 
      }),
      new Promise((resolve) => {
        sock2.on('connect', () => {
          resolve()
        }) 
      }),
      new Promise((resolve) => {
        sock3.on('connect', () => {
          resolve()
        }) 
      })
    ]).then(() => {
      done()
      return Promise.resolve(null)
    })
  })
  
  let tworemain = null
  it('should not allow 3 sockets to a room', (done) => {
    connected.then(() => {
      // because we're not using webrtc here the offers can be anything
      sock1.emit('startWithOffer', {room: 'a', offer: 'offer'})
      sock2.emit('startWithOffer', {room: 'a', offer: 'offer'})
      sock3.emit('startWithOffer', {room: 'a', offer: 'offer'})
    })
    
    tworemain = new Promise((resolve) => {
      let handle = (err) => {
        assert.isObject(err) 
        assert.isString(err.msg)
        log.error(err)
        done()
        doneDescribe()
        resolve() 
      }
      // the errors could appear in any socket
      sock1.once('exception', (err) => { sock1 = sock3; handle(err) })
      sock2.once('exception', (err) => { sock2 = sock3; handle(err) })
      sock3.once('exception', handle)
    })
  })

  /* WIP
  it('should give an exception on a premature answer', (done) => {
    tworemain.then(() => {
      return new Promise((resolve) => {
        let offerAndError = (s1, s2) => {
          s1.once('offer', () => {
            s2.emit('respondWithAnswer', {room: 'a', answer: 'answer'})
            s2.once('exception', (err) => {
              done() 
              doneDescribe()
            })
          })
        }
        offerAndError(sock1, sock2)
        offerAndError(sock2, sock1)
      })
    })
  })
  */
})
