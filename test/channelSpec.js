'use strict'

const nock = require('nock')
const crypto = require('crypto')
const uuid = require('uuid4')
const base64url = require('base64url')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert

const ObjStore = require('./helpers/objStore')
const MakePluginVirtual = require('..').MakePluginVirtual

describe('MakePluginVirtual', function () {
  beforeEach(function () {
    this.info = {
      currencyCode: 'USD',
      currencyScale: 2,
      connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
    }

    this.opts = {
      currencyCode: 'USD',
      currencyScale: 2,
      secret: 'seeecret',
      maxBalance: '1000000',
      minBalance: '-40',
      peerPublicKey: 'Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk',
      rpcUri: 'https://example.com/rpc',
      info: this.info,
      _store: new ObjStore()
    }

    this.channel = {}
    this.PluginClass = MakePluginVirtual(this.channel)
    this.plugin = new (this.PluginClass)(this.opts)

    this.fulfillment = require('crypto').randomBytes(32)
    this.transfer = {
      id: uuid(),
      ledger: this.plugin.getInfo().prefix,
      from: this.plugin.getAccount(),
      to: this.plugin.getInfo().prefix + this.opts.peerPublicKey,
      expiresAt: new Date(Date.now() + 10000).toISOString(),
      amount: '5',
      custom: {
        field: 'some stuff'
      },
      executionCondition: base64url(crypto
        .createHash('sha256')
        .update(this.fulfillment)
        .digest())
    }
  })

  describe('connect', function () {
    it('is called when the plugin connects', async function () {
      let called = false
      this.channel.connect = (ctx, opts) => {
        called = true
        assert.deepEqual(ctx.state, {})
        assert.equal(ctx.plugin, this.plugin)
        assert.equal(opts, this.opts)
      }

      await this.plugin.connect()
      assert.equal(called, true)
    })

    it('causes connect to fail if it throws', async function () {
      let called = false
      this.channel.connect = (ctx, opts) => {
        called = true
        throw new Error('no')
      }

      await assert.isRejected(this.plugin.connect(), /^no$/)
      assert.equal(called, true)
    })
  })

  describe('disconnect', function () {
    it('is called when the plugin disconnects', async function () {
      await this.plugin.connect()

      let called = false
      this.channel.disconnect = (ctx, opts) => {
        called = true
        assert.deepEqual(ctx.state, {})
        assert.equal(ctx.plugin, this.plugin)
      }

      await this.plugin.disconnect()
      assert.equal(called, true)
    })
  })

  describe('handleIncomingPrepare', function () {
    it('should be called when a transfer is prepared', async function () {
      let called = false
      this.channel.handleIncomingPrepare = (ctx, transfer) => {
        called = true
        assert.deepEqual(ctx.state, {})
        assert.equal(ctx.plugin, this.plugin)
        assert.deepEqual(transfer, this.transfer)
      }

      this.transfer.from = this.transfer.to
      this.transfer.to = this.plugin.getAccount()
      const emitted = new Promise((resolve) => this.plugin.on('incoming_prepare', resolve))

      await this.plugin.receive('send_transfer', [ this.transfer ])
      await emitted
      assert.equal(called, true)

      assert.equal(await this.plugin._transfers.getIncomingFulfilledAndPrepared(), '5')
    })

    it('should make prepare throw if handler throws', async function () {
      let called = false
      this.channel.handleIncomingPrepare = (ctx, transfer) => {
        called = true
        throw new Error('no')
      }

      this.transfer.from = this.transfer.to
      this.transfer.to = this.plugin.getAccount()

      let emitted = false
      this.plugin.on('incoming_prepare', () => {
        emitted = true
      })

      await assert.isRejected(
        this.plugin.receive('send_transfer', [ this.transfer ]),
        /^no$/)

      assert.equal(called, true)
      assert.equal(emitted, false, 'should not emit if handleIncoming throws')

      // should cancel the payment
      assert.equal(await this.plugin._transfers.getIncomingFulfilledAndPrepared(), '0')
    })
  })

  describe('createOutgoingClaim', function () {
    it('should be called when an outgoing transfer is fulfilled', async function () {
      const called = new Promise((resolve, reject) => {
        this.channel.createOutgoingClaim = (ctx, outgoing) => {
          try {
            assert.deepEqual(ctx.state, {})
            assert.equal(ctx.plugin, this.plugin)
            assert.equal(outgoing, '5')
          } catch (e) {
            reject(e)
          }
          resolve()
        }
      })

      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200)

      await this.plugin.sendTransfer(this.transfer)
      await this.plugin.receive('fulfill_condition',
        [ this.transfer.id, base64url(this.fulfillment) ])

      await called
      assert.equal(await this.plugin._transfers.getOutgoingFulfilled(), '5')
      assert(nock.isDone(), 'nocks must be called')
    })

    it('should not fail fulfillCondition if it fails', async function () {
      this.channel.createOutgoingClaim = (ctx, outgoing) => {
        throw new Error('this will be logged but swallowed')
      }

      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200)

      await this.plugin.sendTransfer(this.transfer)
      await this.plugin.receive('fulfill_condition',
        [ this.transfer.id, base64url(this.fulfillment) ])

      assert.equal(await this.plugin._transfers.getOutgoingFulfilled(), '5')
      assert(nock.isDone(), 'nocks must be called')
    })
  })

  describe('handleIncomingClaim', function () {
    it('should be called when an incoming transfer is fulfilled', async function () {
      const called = new Promise((resolve, reject) => {
        this.channel.handleIncomingClaim = (ctx, claim) => {
          try {
            assert.deepEqual(ctx.state, {})
            assert.equal(ctx.plugin, this.plugin)
            assert.deepEqual(claim, { foo: 'bar' })
          } catch (e) {
            reject(e)
          }
          resolve()
        }
      })

      nock('https://example.com')
        .post('/rpc?method=fulfill_condition&prefix=peer.NavKx.usd.2.',
          [ this.transfer.id, base64url(this.fulfillment) ])
        .reply(200, { foo: 'bar' })

      this.transfer.from = this.transfer.to
      this.transfer.to = this.plugin.getAccount()

      await this.plugin.receive('send_transfer', [ this.transfer ])
      await this.plugin.fulfillCondition(this.transfer.id, base64url(this.fulfillment))

      await called
      assert(nock.isDone(), 'nocks must be called')
    })

    it('should not fail fulfillCondition if it throws', async function () {
      this.channel.handleIncomingClaim = (ctx, claim) => {
        throw new Error('will be logged but swallowed')
      }

      nock('https://example.com')
        .post('/rpc?method=fulfill_condition&prefix=peer.NavKx.usd.2.',
          [ this.transfer.id, base64url(this.fulfillment) ])
        .reply(200, { foo: 'bar' })

      this.transfer.from = this.transfer.to
      this.transfer.to = this.plugin.getAccount()

      await this.plugin.receive('send_transfer', [ this.transfer ])
      await this.plugin.fulfillCondition(this.transfer.id, base64url(this.fulfillment))

      assert(nock.isDone(), 'nocks must be called')
    })
  })
})
