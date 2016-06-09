'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const Transfer = require('../src/model/transfer').Transfer
const server = require('../src/signalling/server')
const newObjStore = require('../src/model/objStore')

describe('PluginVirtual', function () {

  it('should be a function', function () {
      assert.isFunction(PluginVirtual)
  })

  it('should be able to start the signalling server', () => {
    server.run()
  })

  let s1store = null, s2store = null
  it('should create the object store', () => {
    s1store = newObjStore()
    s2store = newObjStore()
  })

  let pv1 = null, pv2 = null
  it('should create objects with the constructor', () => {

    pv1 = new PluginVirtual({store: s1store, auth: {account: 'plugin 1'},
      other: {host: 'http://localhost:8080', room: 'test', limit: 300}
    })
    pv2 = new PluginVirtual({store: s2store, auth: {account: 'plugin 2'},
      other: {host: 'http://localhost:8080', room: 'test', limit: 300}
    })

    assert.isObject(pv1)
    assert.isObject(pv2)
  })

  let connected = null
  it('should connect', (done) => {

    let pv1c = pv1.connect().catch((err) => { console.error(err); assert(false) })
    let pv2c = pv2.connect().catch((err) => { console.error(err); assert(false) })
    connected = Promise.all([pv1c, pv2c]).then(() => {
      done()
    })
  })

  let pv1b = 0, pv2b = 0
  it('should be an event emitter', () => {

    pv1.on('_balanceChanged', () => {
      pv1.getBalance().then((balance) => {
        pv1b = balance | 0
        pv1._log(balance)
      })
    })
    pv2.on('_balanceChanged', () => {
      pv2.getBalance().then((balance) => {
        pv2b = balance | 0
        pv2._log(balance)
      })
    })
  })

  let send1 = null
  it('should recieve an acknowledge for a valid transfer', (done) => {
    
    connected.then(() => {
      return pv1.send({
        id: 'onehundred',
        account: 'doesnt really matter',
        amount: '100',
        data: new Buffer('')
      })
    })
    send1 = new Promise((resolve) => {
      pv1.once('reply', (transfer) => {
        assert(transfer.id == 'onehundred')
        done()
        resolve()
      })
    })
  })

  let send2 = null
  it('should recieve an acknowledge for a second valid transfer', (done) => {
    send1.then(() => {
      return pv2.send({
        id: 'twohundred',
        account: 'doesnt really matter here either',
        amount: '200',
        data: new Buffer('')
      })
    })
    send2 = new Promise((resolve) => {
      pv2.once('reply', (transfer) => {
        assert(transfer.id == 'twohundred')
        done()
        resolve()
      })
    })
  })
  
  let send3 = null
  it('should reject a transfer that`s over the limit', (done) => {
    send2.then(() => {
      return pv2.send({
        id: 'rejectthis',
        account: 'this should get rejected',
        amount: '400',
        data: new Buffer('')
      })
    })
    send3 = new Promise((resolve) => {
      pv2.once('reject', (transfer) => {
        assert(transfer.id == 'rejectthis')
        done()
        resolve()
      })
    })
  })

  let send4 = null
  it('should reject a false acknowledgement', (done) => {
    send3.then(() => {
      return pv2._acceptTransfer(new Transfer({
        id: 'thisdoesntexist',
        account: 'this should get rejected',
        amount: '400',
        data: new Buffer('')
      }))
    })
    send4 = new Promise((resolve) => {
      pv1.once('_falseAcknowledge', (transfer) => {
        assert(transfer.id == 'thisdoesntexist')
        done()
        resolve()
      })
    })
  })

  it('should finish with the correct balances', (done) => {
    send4.then(() => {
      assert(pv1b === 100 && pv2b === -100, 'balances should be correct')
      done()
    })
  })
})
