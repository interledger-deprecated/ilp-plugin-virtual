'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const Transfer = require('../src/model/transfer').Transfer
const server = require('../src/signalling/server')
const newObjStore = require('../src/model/objStore')

describe('PluginVirtual', function () {
  it('should terminate', function (done) {
    this.timeout(5000)
    /* it('should be an object', function () {
      assert.isObject(PluginVirtual)
    })*/

    server.run()

    var s1store = newObjStore()
    var s2store = newObjStore()

    var pv1 = new PluginVirtual({store: s1store, auth: {account: 'plugin 1'},
      other: {initiator: false, host: 'http://localhost:8080', room: 'test', limit: 300}
    })
    var pv2 = new PluginVirtual({store: s2store, auth: {account: 'plugin 2'},
      other: {initiator: true, host: 'http://localhost:8080', room: 'test', limit: 300}
    })

    var pv1c = pv1.connect().catch((err) => { console.error(err) })
    var pv2c = pv2.connect().catch((err) => { console.error(err) })

    console.log('waiting on Promise.all now for connect')
    Promise.all([pv1c, pv2c]).then(() => {
      it('should construct non-null objects', () => {
        assert(pv1 && pv2)
      })

      let pv1b, pv2b

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
      setTimeout(done, 100)
    }).catch((err) => {
      console.error(err)
    })
  })
})
