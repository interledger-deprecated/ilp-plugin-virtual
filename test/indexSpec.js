'use strict'

const plugin = require('../src/plugin')
const PluginVirtual = plugin.PluginVirtual
// const Connection = plugin.Connection
const assert = require('chai').assert
const Transfer = require('../src/model/transfer').Transfer

describe('PluginVirtual', function () {
  it('should terminate', function (done)  {
    this.timeout(10000)
    /* it('should be an object', function () {
      assert.isObject(PluginVirtual)
    })*/

    /* this is going to be in the code pretty briefly so no need to make it too nice */
    var s1 = {}
    var s2 = {}
    var s1get = function (k) { return Promise.resolve(s1[k]) }
    var s2get = function (k) { return Promise.resolve(s2[k]) }
    var s1put = function (k, v) { s1[k] = v; return Promise.resolve(null) }
    var s2put = function (k, v) { s2[k] = v; return Promise.resolve(null) }
    var s1del = function (k) { s1[k] = undefined; return Promise.resolve(null) }
    var s2del = function (k) { s2[k] = undefined; return Promise.resolve(null) }
    var s1store = {get: s1get, put: s1put, del: s1del}
    var s2store = {get: s2get, put: s2put, del: s2del}

    var pv1 = new PluginVirtual({store: s1store, auth: {account: 'plugin 1'}, limit: 300,
      other: {initiator: false}
    })
    var pv2 = new PluginVirtual({store: s2store, auth: {account: 'plugin 2'}, limit: 300,
      other: {initiator: true}
    })

    pv1.connection.connectPeer(pv2.connection)
    pv2.connection.connectPeer(pv1.connection)

    var pv1c = new Promise((resolve) => {
      pv1.on('connect', () => { resolve() })
    })
    var pv2c = new Promise((resolve) => {
      pv2.on('connect', () => { resolve() })
    })

    var pv1o = new Promise((resolve) => {
      pv1.connection.on('open', () => { resolve() })
    })
    var pv2o = new Promise((resolve) => {
      pv2.connection.on('open', () => { resolve() })
    })
  
    pv1.connect().then(() => {
      console.log('connection 1 connected')
      return pv2.connect()
    }).then(() => {
      console.log('waiting on Promise.all now for connect')
      return Promise.all([pv1c, pv2c])
    }).then(() => {
      console.log('waiting on Promise.all now for open')
      return Promise.all([pv1o, pv2o])
    }).then(() => {
      
      it('should construct non-null objects', () => {
        assert(pv1 && pv2)
      })

      var pv1b, pv2b

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

    }).then(() => {
      return pv1.send({
        id: 'onehundred',
        account: 'doesnt really matter',
        amount: '100',
        data: new Buffer('')
      })
    }).then(() => {
      return pv2.send({
        id: 'twohundred',
        account: 'doesnt really matter here either',
        amount: '200',
        data: new Buffer('')
      })
    }).then(() => {
      return pv2.send({
        id: 'rejectthis',
        account: 'this should get rejected',
        amount: '400',
        data: new Buffer('')
      })
    }).then(() => {
      return pv2._acceptTransfer(new Transfer({
        id: 'thisdoesntexist',
        account: 'this should get rejected',
        amount: '400',
        data: new Buffer('')
      }))
    }).then(() => {
      it('should reject invalid acknowledgements', (done) => {
        pv1.on('error', () => {
          done()
        })
      })
    }).then(() => {
      it('should finish with the correct balances', (done) => {
        setTimeout(() => {
          assert(pv1b === 100 && pv2b === -100, 'balances should be correct')
          done()
        }, 100)
      })
    }).then(() => {
      setTimeout(done, 5000)
    }).catch((err) => {
      console.error(err)
    })
  })
})
