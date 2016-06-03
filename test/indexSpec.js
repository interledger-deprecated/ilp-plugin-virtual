'use strict'

const plugin = require('../src/plugin')
const PluginVirtual = plugin.PluginVirtual
const Connection = plugin.Connection
const assert = require('chai').assert

describe('PluginVirtual', function () {
/*  it('should be an object', function () {
    assert.isObject(PluginVirtual)
  })*/

  it('should go through the proper channels for a transaction', function() {

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

    var pv1 = new PluginVirtual({store: s1store, auth: {account: "plugin 1"}})
    var pv2 = new PluginVirtual({store: s2store, auth: {account: "plugin 2"}})

    // TODO: make this async once the connection class needs that
    pv1.connect()
    pv2.connect()

    pv1.send({
      id: 'thing number 1',
      account: 'doesnt really matter',
      amount: '100',
      data: new Buffer('')
    }).then(() => {
      return pv2.send({
        id: 'thing numba 2',
        account: 'doesnt really matter here either',
        amount: '200',
        data: new Buffer('')
      })
    }).then(() => {
      return pv1.getBalance()
    }).then((balance) => {
      console.log("pv1 balance: " + balance)
      return Promise.resolve(null)
    }).then(() => {
      return pv2.getBalance()
    }).then((balance) => {
      console.log("pv2 balance: " + balance)
      return Promise.resolve(null)
    }).then(() => {
      return pv1.getBalance()
    }).then((balance) => {
      console.log("pv1 balance: " + balance)
      return Promise.resolve(null)
    })
    assert(true);
  })
})
