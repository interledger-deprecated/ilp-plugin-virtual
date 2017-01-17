'use strict'

const assert = require('chai').assert

const ObjStore = require('./helpers/objStore')
const PluginVirtual = require('..')

const info = {
  currencyCode: 'USD',
  currencySymbol: '$',
  precision: 15,
  scale: 15,
  connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
}

const options = {
  currency: 'USD',
  secret: 'seeecret',
  maxBalance: '10',
  peerPublicKey: 'Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk',
  rpcUri: 'https://example.com/rpc',
  _store: new ObjStore(),
  info: info
}

describe('Info', () => {
  beforeEach(function * () {
    this.plugin = new PluginVirtual(options)
    yield this.plugin.connect()
  })

  describe('getBalance', () => {
    it('should start at zero', function * () {
      assert.equal((yield this.plugin.getBalance()), '0')
    })
  })

  describe('getInfo', () => {
    it('should use the supplied info', function () {
      assert.deepEqual(
        this.plugin.getInfo(),
        Object.assign({}, info, {prefix: this.plugin.getInfo().prefix}))
    })
  })

  describe('disconnect', () => {
    it('should disconnect when connected', function * () {
      assert.isTrue(this.plugin.isConnected(), 'should have connected before')
      yield this.plugin.disconnect()
      assert.isFalse(this.plugin.isConnected(), 'shouldn\'t be connected after disconnect')
    })

    it('should stay disconnected when disconnected', function * () {
      yield this.plugin.disconnect()
      yield this.plugin.disconnect()
      assert.isFalse(this.plugin.isConnected(), 'still should be disconnected after second disconnect')
    })

    it('should reconnect', function * () {
      yield this.plugin.disconnect()
      yield this.plugin.connect()
      assert.isTrue(this.plugin.isConnected(), 'should have reconnected')
    })
  })
})
