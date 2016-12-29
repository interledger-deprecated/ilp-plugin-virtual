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

const assert = require('chai').assert
const expect = require('chai').expect

const ObjStore = require('./helpers/objStore')
const PluginVirtual = require('..')
const options = {
  currency: 'USD',
  secret: 'seeecret',
  maxBalance: '10',
  peerPublicKey: 'Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk',
  _store: new ObjStore(),
  broker: 'mqtt://example.com',
  // if every test doesn't mock the connection, then the real connection will
  // be cached and the tests will not be able to mock require later
  other: {
    name: 'noob',
    channels: MockChannels
  }
}

describe('constructor', () => {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })

  it('should return an object', () => {
    assert.isObject(new PluginVirtual(options))
  })

  const omitField = (field) => {
    it('should give an error without ' + field, () => {
      expect(() => new PluginVirtual(Object.assign(options, { [field]: undefined })))
        .to.throw(Error)
    })
  }

  omitField('maxBalance')
  omitField('currency')
  omitField('secret')
  omitField('peerPublicKey')
  omitField('_store')
  omitField('broker')

  it('should give an error with incorrect prefix passed in', () => {
    expect(() => new PluginVirtual(Object.assign({}, options, {prefix: 'trash.'})))
      .to.throw(Error)
  })
})
