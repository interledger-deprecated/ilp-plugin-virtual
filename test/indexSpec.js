'use strict'

const assert = require('chai').assert
const expect = require('chai').expect

const getObjBackend = require('../src/util/backend')
const PluginVirtual = require('..')
const options = {
  prefix: 'example.red.',
  token: 'placeholder',
  maxBalance: '1000',
  rpcUri: 'https://example.com/rpc',
  _backend: getObjBackend(null)
}

describe('constructor', () => {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })

  it('should return an object', () => {
    assert.isObject(new PluginVirtual(options))
  })

  it('should export the generatePrefix method from the module', () => {
    assert.isFunction(PluginVirtual.generatePrefix)
  })

  const omitField = (field) => {
    it('should give an error without ' + field, () => {
      expect(() => new PluginVirtual(Object.assign(options, { [field]: undefined })))
        .to.throw(Error)
    })
  }

  omitField('maxBalance')
  omitField('secret')
  omitField('peerPublicKey')
  omitField('_store')
  omitField('rpcUri')

  it('should give an error with incorrect prefix passed in', () => {
    expect(() => new PluginVirtual(Object.assign({}, options, {prefix: 'trash.'})))
      .to.throw(Error)
  })
})
