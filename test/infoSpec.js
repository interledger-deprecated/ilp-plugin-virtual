'use strict'

const mockRequire = require('mock-require')
const mock =
  require('./mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire(
  '../src/model/connection',
  MockConnection
)

const _ = require('lodash')
const assert = require('chai').assert
const expect = require('chai').expect

const newObjStore = require('./helpers/objStore')
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
  _store: newObjStore(),
  broker: 'mqtt://example.com',
  other: {
    'channels': MockChannels,
    'name': 'noob'
  },
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
    it('should use the supplied info', function * () {
      assert.deepEqual((yield this.plugin.getInfo()), info)
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
