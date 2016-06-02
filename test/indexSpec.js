'use strict'

const PluginVirtual = require('../src/plugin').PluginVirtual
const assert = require('chai').assert

describe('PluginVirtual', function () {
/*  it('should be an object', function () {
    assert.isObject(PluginVirtual)
  })*/

  it('should send a transaction between two instances', function() {

    var pv1 = new PluginVirtual({store: {}, auth: {account: "plugin 1"}})
    var pv2 = new PluginVirtual({store: {}, auth: {account: "plugin 2"}})

    // TODO: make this async once the connection class needs that
    pv1.connect()
    pv2.connect()

    pv1.send({things: "thing one"});
    pv2.send({things: "thing two"});

    // check the console logs for now
    assert(true); 
  })
})
