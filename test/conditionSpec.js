'use strict'

const nock = require('nock')
const uuid = require('uuid4')
const crypto = require('crypto')
const base64url = require('base64url')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const expect = chai.expect

const ObjStore = require('./helpers/objStore')
const PluginVirtual = require('..')

const info = {
  prefix: 'example.red.',
  currencyCode: 'USD',
  currencyScale: 2,
  connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
}

const peerAddress = 'example.red.client'
const options = {
  prefix: 'example.red.',
  token: 'placeholder',
  currencyCode: 'USD',
  currencyScale: 2,
  maxBalance: '10',
  rpcUri: 'https://example.com/rpc',
  info: info
}

describe('Conditional Transfers', () => {
  beforeEach(function * () {
    options._store = new ObjStore()
    this.plugin = new PluginVirtual(options)

    this.fulfillment = 'gHJ2QeIZpstXaGZVCSq4d3vkrMSChNYKriefys3KMtI'
    const hash = crypto.createHash('sha256')
    hash.update(this.fulfillment, 'base64')
    this.condition = base64url(hash.digest())

    const expiry = new Date()
    expiry.setSeconds(expiry.getSeconds() + 5)

    this.transfer = {
      id: uuid(),
      ledger: this.plugin.getInfo().prefix,
      from: this.plugin.getAccount(),
      to: peerAddress,
      amount: '5.0',
      data: {
        field: 'some stuff'
      },
      executionCondition: this.condition,
      expiresAt: expiry.toISOString()
    }

    this.incomingTransfer = Object.assign({}, this.transfer, {
      from: peerAddress,
      to: this.plugin.getAccount()
    })

    yield this.plugin.connect()
  })

  afterEach(function * () {
    assert(nock.isDone(), 'nocks should all have been called')
  })

  describe('sendTransfer (conditional)', () => {
    it('allows an outgoing transfer to be fulfilled', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      const sent = new Promise((resolve) => this.plugin.on('outgoing_prepare', resolve))
      const fulfilled = new Promise((resolve) => this.plugin.on('outgoing_fulfill', resolve))

      yield this.plugin.sendTransfer(this.transfer)
      yield sent

      yield this.plugin.receive('fulfill_condition', [this.transfer.id, this.fulfillment])
      yield fulfilled

      assert.equal((yield this.plugin.getBalance()), '-5', 'balance should decrease by amount')
    })

    it('fulfills an incoming transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=fulfill_condition&prefix=example.red.', [this.transfer.id, this.fulfillment])
        .reply(200, true)

      const fulfilled = new Promise((resolve) => this.plugin.on('incoming_fulfill', resolve))

      yield this.plugin.receive('send_transfer', [this.incomingTransfer])
      yield this.plugin.fulfillCondition(this.transfer.id, this.fulfillment)
      yield fulfilled

      assert.equal((yield this.plugin.getBalance()), '5', 'balance should increase by amount')
    })

    it('cancels an incoming transfer for too much money', function * () {
      this.incomingTransfer.amount = 100

      let incomingPrepared = false
      this.plugin.on('incoming_prepare', () => (incomingPrepared = true))

      yield expect(this.plugin.receive('send_transfer', [this.incomingTransfer]))
        .to.eventually.be.rejectedWith(/balanceIncomingFulfilledAndPrepared exceeds greatest allowed value/)

      assert.isFalse(incomingPrepared, 'incoming_prepare should not be emitted')
      assert.equal((yield this.plugin.getBalance()), '0', 'balance should not change')
    })

    it('should fulfill a transfer even if inital RPC failed', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(500)

      const fulfilled = new Promise((resolve) => this.plugin.on('outgoing_fulfill', resolve))
      const sent = new Promise((resolve) => this.plugin.on('outgoing_prepare', resolve))

      yield this.plugin.sendTransfer(this.transfer)
      yield sent
      yield this.plugin.receive('fulfill_condition', [this.transfer.id, this.fulfillment])
      yield fulfilled

      assert.equal((yield this.plugin.getBalance()), '-5', 'balance should decrease by amount')
    })

    it('doesn\'t fulfill a transfer with invalid fulfillment', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      yield this.plugin.sendTransfer(this.transfer)
      yield expect(this.plugin.fulfillCondition(this.transfer.id, 'Garbage'))
        .to.eventually.be.rejected
    })

    it('doesn\'t fulfill an outgoing transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      yield this.plugin.sendTransfer(this.transfer)
      yield expect(this.plugin.fulfillCondition(this.transfer.id, this.fulfillment))
        .to.eventually.be.rejected
    })

    it('should not send a transfer with condition and no expiry', function () {
      this.transfer.executionCondition = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with expiry and no condition', function () {
      this.transfer.expiresAt = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should resolve even if the event notification handler takes forever', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      this.plugin.on('outgoing_prepare', () => new Promise((resolve, reject) => {}))

      yield this.plugin.sendTransfer(this.transfer)
    })

    it('should resolve even if the event notification handler throws an error', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      this.plugin.on('outgoing_prepare', () => {
        throw new Error('blah')
      })

      yield this.plugin.sendTransfer(this.transfer)
    })

    it('should resolve even if the event notification handler rejects', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      this.plugin.on('outgoing_prepare', function * () {
        throw new Error('blah')
      })

      yield this.plugin.sendTransfer(this.transfer)
    })
  })

  describe('expireTransfer', () => {
    it('expires a transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=expire_transfer&prefix=example.red.', [this.transfer.id])
        .reply(200, true)

      this.incomingTransfer.expiresAt = (new Date()).toISOString()
      const cancel = new Promise((resolve) => this.plugin.on('incoming_cancel', resolve))

      yield this.plugin.receive('send_transfer', [this.incomingTransfer])
      yield cancel

      assert.equal((yield this.plugin.getBalance()), '0', 'balance should not change')
    })

    it('expires an outgoing transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=expire_transfer&prefix=example.red.', [this.transfer.id])
        .reply(200, true)

      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      this.transfer.expiresAt = (new Date()).toISOString()
      const cancel = new Promise((resolve) => this.plugin.on('outgoing_cancel', resolve))

      yield this.plugin.sendTransfer(this.transfer)
      yield cancel

      assert.equal((yield this.plugin.getBalance()), '0', 'balance should not change')
    })

    it('doesn\'t expire an executed transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      const sent = new Promise((resolve) => this.plugin.on('outgoing_prepare', resolve))
      const fulfilled = new Promise((resolve) => this.plugin.on('outgoing_fulfill', resolve))

      yield this.plugin.sendTransfer(this.transfer)
      yield sent

      yield this.plugin.receive('fulfill_condition', [this.transfer.id, this.fulfillment])
      yield fulfilled
      yield this.plugin._expireTransfer(this.transfer.id)

      assert.equal((yield this.plugin.getBalance()), '-5', 'balance should not be rolled back')
    })
  })

  describe('rejectIncomingTransfer', () => {
    it('rejects an incoming transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=reject_incoming_transfer&prefix=example.red.', [this.transfer.id, 'reason'])
        .reply(200, true)

      const rejected = new Promise((resolve) => this.plugin.on('incoming_reject', resolve))

      yield this.plugin.receive('send_transfer', [this.incomingTransfer])
      yield this.plugin.rejectIncomingTransfer(this.transfer.id, 'reason')
      yield rejected

      assert.equal((yield this.plugin.getBalance()), '0', 'balance should not change')
    })

    it('should allow an outgoing transfer to be rejected', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      const rejected = new Promise((resolve) => this.plugin.on('outgoing_reject', resolve))

      yield this.plugin.sendTransfer(this.transfer)
      yield this.plugin.receive('reject_incoming_transfer', [this.transfer.id, 'reason'])
      yield rejected
    })

    it('should not reject an outgoing transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      yield this.plugin.sendTransfer(this.transfer)
      yield expect(this.plugin.rejectIncomingTransfer(this.transfer.id, 'reason'))
        .to.eventually.be.rejected
    })

    it('should not allow an incoming transfer to be rejected by sender', function * () {
      yield this.plugin.receive('send_transfer', [this.incomingTransfer])
      yield expect(this.plugin.receive('reject_transfer', [this.transfer.id, 'reason']))
        .to.eventually.be.rejected
    })
  })
})
