'use strict'

const nock = require('nock')
const crypto = require('crypto')
const base64url = require('base64url')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert

const ObjBackend = require('../src/util/backend')
const PluginVirtual = require('..')

const conditionPair = () => {
  const preimage = crypto.randomBytes(32)
  const hash = crypto.createHash('sha256').update(preimage).digest()

  return {
    fulfillment: base64url(preimage),
    condition: base64url(hash)
  }
}

const info = {
  currencyCode: 'USD',
  currencyScale: 2,
  connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
}

const peerAddress = 'peer.NavKx.usd.2.Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk'
const options = {
  currencyCode: 'USD',
  currencyScale: 2,
  secret: 'seeecret',
  maxBalance: '1000000',
  minBalance: '-40',
  peerPublicKey: 'Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk',
  rpcUri: 'https://example.com/rpc'
}

describe('Asymmetric plugin virtual', () => {
  beforeEach(function * () {
    nock('https://example.com')
      .post('/rpc?method=get_info&prefix=peer.NavKx.usd.2.')
      .reply(200, info)

    this.plugin = new PluginVirtual(Object.assign({},
      options))

    yield this.plugin.connect()
  })

  describe('setup', () => {
    it('should get info from rpc endpoint', function () {
      assert.deepEqual(this.plugin.getInfo(), info)
    })

    it('should get balance from peer', async function () {
      nock('https://example.com')
        .post('/rpc?method=get_balance&prefix=peer.NavKx.usd.2.')
        .reply(200, '-5')

      assert.equal(await this.plugin.getBalance(), '5')
    })
  })

  describe('sending', () => {
    beforeEach(function () {
      const { condition, fulfillment } = conditionPair()

      this.condition = condition
      this.fulfillment = fulfillment
      this.transfer = {
        id: '5709e97e-ffb5-5454-5c53-cfaa5a0cd4c1',
        to: peerAddress,
        amount: '10',
        executionCondition: condition,
        expiresAt: new Date(Date.now() + 1000).toISOString()
      }
    })

    it('should send a request', async function () {
      const response = {
        to: this.plugin.getAccount(),
        ilp: 'some_base64_encoded_data_goes_here'
      }

      nock('https://example.com')
        .post('/rpc?method=send_request&prefix=peer.NavKx.usd.2.')
        .reply(200, response)

      const result = await this.plugin.sendRequest({
        to: peerAddress,
        ilp: 'some_data'
      })

      assert.deepEqual(result, response)
    })

    it('should prepare and execute a transfer', async function () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [ this.transfer ])
        .reply(200, true)

      const prepared = new Promise((resolve) =>
        this.plugin.once('outgoing_prepare', () => resolve()))

      await this.plugin.sendTransfer(this.transfer)
      await prepared

      const fulfilled = new Promise((resolve) =>
        this.plugin.once('outgoing_fulfill', () => resolve()))

      await this.plugin.receive('fulfill_condition',
        [ this.transfer.id, this.fulfillment ])
      await fulfilled
    })

    it('should receive and fulfill a transfer', async function () {
      this.transfer.to = this.plugin.getAccount()
      const prepared = new Promise((resolve) =>
        this.plugin.once('incoming_prepare', () => resolve()))

      await this.plugin.receive('send_transfer', [ this.transfer ])
      await prepared

      nock('https://example.com')
        .post('/rpc?method=fulfill_condition&prefix=peer.NavKx.usd.2.',
          [ this.transfer.id, this.fulfillment ])
        .reply(200, true)

      const fulfilled = new Promise((resolve) =>
        this.plugin.once('incoming_fulfill', () => resolve()))

      await this.plugin.fulfillCondition(this.transfer.id, this.fulfillment)
      await fulfilled
    })

    it('should not send a transfer if peer gives error', async function () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [ this.transfer ])
        .reply(500)

      const prepared = new Promise((resolve, reject) => {
        this.plugin.once('outgoing_prepare', () =>
          reject(new Error('should not be accepted')))
        setTimeout(resolve, 10)
      })

      await assert.isRejected(this.plugin.sendTransfer(this.transfer))
      await prepared
    })
  })

  describe('server', function () {
    it('should call several plugins over RPC', async function () {
      const _options = Object.assign({}, options)

      delete _options.rpcUri
      _options._backend = ObjBackend
      _options.tolerateFailure = true
      _options.rpcUris = [
        'https://example.com/1/rpc',
        'https://example.com/2/rpc',
        'https://example.com/3/rpc'
      ]

      nock('https://example.com')
        .post('/1/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.')
        .reply(200, true)
        .post('/2/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.')
        .reply(200, true)
        .post('/3/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.')
        .reply(500) // should tolerate an error from one

      this.plugin = new PluginVirtual(_options)
      await this.plugin.connect()

      await this.plugin.sendTransfer({
        id: '0aad44fd-a64e-537a-14b0-aec8a4e80b9c',
        to: peerAddress,
        amount: '10',
        executionCondition: '8EhfVB4NBL3Bpa7PPqA0-LbJPg_xGyNnnRkBJ1oYLSU',
        expiresAt: new Date(Date.now() + 1000).toISOString()
      })

      nock.isDone()
    })
  })
})
