'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const Transfer = require('../src/model/transfer').Transfer
const server = require('../src/signalling/server')
const newObjStore = require('../src/model/objStore')
const log = require('../src/controllers/log')

let pv1 = null, pv2 = null

describe('PluginVirtual', function (doneDescribe) {

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

  it('should create objects with the constructor', () => {

    pv1 = new PluginVirtual({store: s1store, auth: {
        account: 'plugin 1', host: 'http://localhost:8080', room: 'test', limit: 300
      }
    })
    pv2 = new PluginVirtual({store: s2store, auth: {
        account: 'plugin 2', host: 'http://localhost:8080', room: 'test', limit: 300
      }
    })

    assert.isObject(pv1)
    assert.isObject(pv2)
  })

  it('should return true for canConnect', () => {
    assert(pv1.canConnectToLedger())
    assert(pv2.canConnectToLedger())
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

  let send0 = null
  it('should reject a payment with a non-numeric amount', (done) => {
    connected.then(() => {
      return pv1.send({
        id: 'invalidnumber',
        account: 'doesnt really matter',
        amount: 'notanumber',
        data: new Buffer('')
      })
    })
    send0 = new Promise((resolve) => {
      pv1.once('reject', (transfer) => {
        assert(transfer.id == 'invalidnumber')
        done()
        resolve()
      })
    })
  })

  let send1 = null
  it('should recieve an acknowledge for a valid transfer', (done) => {
    send0.then(() => {
      return pv1.send({
        id: 'onehundred',
        account: 'doesnt really matter',
        amount: '100',
        data: new Buffer('')
      })
    })
    send1 = new Promise((resolve) => {
      pv1.once('accept', (transfer) => {
        assert(transfer.id == 'onehundred')
        done()
        resolve()
      })
    })
  })

  let repeat0 = null
  let negativetransfer = null
  it('should reject a transfer with a negative amount', (done) => {
    send1.then(() => {
      return pv1.send({
        id: 'negativeamount',
        account: 'doesnt really matter',
        amount: '-100',
        data: new Buffer('')
      })
    })
    repeat0 = new Promise((resolve) => {
      pv1.once('reject', (transfer) => {
        assert(transfer.id == 'negativeamount')
        negativetransfer = transfer
        done()
        resolve()
      })
    })
  })

  let reply1 = null
  it('should send and recieve reply messages', (done) => {
    repeat0.then(() => {
      return pv2.replyToTransfer(negativetransfer.id, 'this sucks')
    })
    reply1 = new Promise((resolve) => {
      pv1.once('reply', (transfer, message) => {
        assert(transfer.id === negativetransfer.id)
        assert(message.equals(new Buffer('this sucks')))
        done()
        resolve()
      })
    })
  })

  let reply2 = null
  it('should emit an error on an unknown message type', (done) => {
    reply1.then(() => {
      return pv2.connection.send({
        type: 'garbage'
      })
    })
    reply2 = new Promise((resolve) => {
      pv1.once('error', (err) => {
        done()
        resolve()
      })
    })
  })

  let repeat0point5 = null
  it('should reject a transfer with a zero amount', (done) => {
    reply2.then(() => {
      return pv1.send({
        id: 'zeroamount',
        account: 'doesnt really matter',
        amount: '0',
        data: new Buffer('')
      })
    })
    repeat0point5 = new Promise((resolve) => {
      pv1.once('reject', (transfer) => {
        assert(transfer.id == 'zeroamount')
        done()
        resolve()
      })
    })
  })

  let repeat1 = null
  it('should reject a transfer with a repeat id', (done) => {
    repeat0point5.then(() => {
      return pv1.send({
        id: 'onehundred',
        account: 'doesnt really matter',
        amount: '100',
        data: new Buffer('')
      })
    })
    repeat1 = new Promise((resolve) => {
      pv1.once('reject', (transfer) => {
        assert(transfer.id == 'onehundred')
        done()
        resolve()
      })
    })
  })

  let repeat3 = null
  it('should also emit an error on a transfer with a repeat id', (done) => {
    repeat1.then(() => {
      return pv1.send({
        id: 'onehundred',
        account: 'doesnt really matter',
        amount: '100',
        data: new Buffer('')
      })
    })
    repeat3 = new Promise((resolve) => {
      pv2.once('error', (err) => {
        log.error(err)
        done()
        resolve()
      })
    })
  })

  let repeat2 = null
  it('should reject a repeated acknowledge', (done) => {
    repeat3.then(() => {
      return pv2._acceptTransfer(new Transfer({
        id: 'onehundred',
        account: 'doesnt really matter',
        amount: '100',
        data: new Buffer('')
      }))
    })
    repeat2 = new Promise((resolve) => {
      pv1.once('_falseAcknowledge', (transfer) => {
        assert(transfer.id == 'onehundred')
        done()
        resolve()
      })
    })
  })

  let send2 = null
  it('should recieve an acknowledge for a second valid transfer', (done) => {
    repeat2.then(() => {
      return pv2.send({
        id: 'twohundred',
        account: 'doesnt really matter here either',
        amount: '200',
        data: new Buffer('')
      })
    })
    send2 = new Promise((resolve) => {
      pv2.once('accept', (transfer) => {
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

  let send5 = null
  it('should reject a repeat ID after the original failed', (done) => {
    send4.then(() => {
      return pv2.send({
        id: 'repeatafterfail',
        account: 'this should get rejected',
        amount: '4000',
        data: new Buffer('')
      })
    })
    send5 = new Promise((resolve) => {
      pv2.once('reject', (transfer) => {
        console.log('** rejected once')
        assert(transfer.id == 'repeatafterfail')
        pv2.send({
          id: 'repeatafterfail',
          account: 'this should get rejected',
          amount: '100',
          data: new Buffer('')
        }).then(() => {
          pv2.once('reject', (transfer) => {
            assert(transfer.id == 'repeatafterfail')
            done()
            resolve()
          })
        })
      })
    })
  })

  let send6 = null
  it('should support the exists operation in the transferlog', (done) => {
    send6 = send5.then(() => {
      return pv1.transferLog.exists({id: 'onehundred'})
    }).then((exists) => {
      assert(exists === true)
      return pv1.transferLog.exists({id: 'thiscertainlydoesntexist'})
    }).then((exists) => {
      assert(exists === false)
      done()
      return Promise.resolve(null)
    })
  })

  let send7 = null
  it('should support the delete operation in the transferlog', (done) => {
    send7 = send6.then(() => {
      return pv1.transferLog.store({id: 'test transaction'})
    }).then(() => {
      return pv1.transferLog.del({id: 'test transaction'})
    }).then(() => {
      return pv1.transferLog.exists({id: 'test transaction'})
    }).then((exists) => {
      assert(exists === false)
      done()
      return Promise.resolve(null)
    })
  })

  let getconnectors = null
  it('should give an array of size one for getConnectors', (done) => {
    getconnectors = send7.then(() => {
      return pv1.getConnectors()
    }).then((connectors) => {
      assert.isArray(connectors)
      assert(connectors.length === 1)
      done()
      return Promise.resolve(null)
    })
  }) 

  let getinfo = null
  it('should give an object for getInfo', (done) => {
    getinfo = getconnectors.then(() => {
      return pv1.getInfo()
    }).then((info) => {
      assert.isObject(info)
      done()
      return Promise.resolve(null)
    })
  })
  
  let disconnected = null
  it('should disconnect', (done) => {
    disconnected = getinfo.then(() => {
      assert(pv1.isConnected() === true)
      assert(pv2.isConnected() === true)
      return Promise.all([pv1.disconnect(), pv2.disconnect()])
    }).then(() => {
      assert(pv1.isConnected() === false)
      assert(pv2.isConnected() === false)
      done()
      return Promise.resolve(null)
    })
  })

  it('should finish with the correct balances', (done) => {
    disconnected.then(() => {
      assert(pv1b === 100 && pv2b === -100, 'balances should be correct')
      done()
      doneDescribe()
    })
  })
})
