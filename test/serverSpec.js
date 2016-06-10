'use strict'

const assert = require('chai').assert
const server = require('../src/signalling/server')
const log = require('../src/util/log')('test')
const socketIoClient = require('socket.io-client')

describe('Signalling Server', function () {
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

  let error1 = null
  it('should give an error on a premature answer', (done) => {
    error1 = connected.then(() => {
      return new Promise((resolve) => {
        sock1.once('exception', (err) => {
          assert.isObject(err)
          assert.isString(err.msg)
          log.error(err)
          done()
          resolve()
        })
        sock1.emit('respondWithAnswer', {room: 'a', answer: 'answer'})
      })
    })
  })

  let tworemain = null
  it('should not allow 3 sockets to a room', (done) => {
    tworemain = error1.then(() => {
      // because we're not using webrtc here the offers can be anything
      sock1.emit('startWithOffer', {room: 'a', offer: 'offer'})
      sock2.emit('startWithOffer', {room: 'a', offer: 'offer'})
      sock3.emit('startWithOffer', {room: 'a', offer: 'offer'})
    }).then(() => {
      return Promise.all([
        new Promise((resolve) => {
          let handle = (err) => {
            assert.isObject(err)
            assert.isString(err.msg)
            log.error(err)
            resolve()
          }
          // the errors could appear in any socket
          sock1.once('exception', (err) => { sock1 = sock3; handle(err) })
          sock2.once('exception', (err) => { sock2 = sock3; handle(err) })
          sock3.once('exception', handle)
        }),
        new Promise((resolve) => {
          let handle = (offer) => {
            resolve()
          }
          sock1.once('offer', handle)
          sock2.once('offer', handle)
          sock3.once('offer', handle)
        })
      ]).then(() => {
        done()
      })
    })
  })

  it('should give an exception if offerer sends an answer', (done) => {
    tworemain.then(() => {
      sock1.emit('respondWithAnswer', {room: 'a', answer: 'offer'})
      sock2.emit('respondWithAnswer', {room: 'a', answer: 'offer'})
    }).then(() => {
      return new Promise((resolve) => {
        let handle = (err) => {
          assert.isObject(err)
          assert.isString(err.msg)
          log.error(err)
          done()
          resolve()
        }
        sock1.once('exception', handle)
        sock2.once('exception', handle)
      })
    })
  })
})
