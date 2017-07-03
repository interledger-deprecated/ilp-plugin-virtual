'use strict'

const nock = require('nock')
const crypto = require('crypto')
const uuid = require('uuid4')
const request = require('co-request')
const IlpPacket = require('ilp-packet')
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
  maxBalance: '1000000',
  minBalance: '-40',
  rpcUri: 'https://example.com/rpc',
  info: info
}

describe('Send', () => {
  beforeEach(function * () {
    options._store = new ObjStore()
    this.plugin = new PluginVirtual(options)

    yield this.plugin.connect()
  })

  afterEach(function * () {
    assert(nock.isDone(), 'nocks should all have been called')
  })

  describe('RPC', () => {
    it('should throw an error on an error code', function () {
      nock('https://example.com')
        .post('/rpc?method=method&prefix=example.red.', [])
        .reply(500)

      return expect(this.plugin._rpc.call('method', 'example.red.', []))
        .to.eventually.be.rejected
    })

    it('should send authorization bearer token', function () {
      nock('https://example.com', {
        reqheaders: {
          'Authorization': 'Bearer ' + this.plugin._getAuthToken()
        }
      })
        .post('/rpc?method=method&prefix=example.red.', [])
        .reply(200, { a: 'b' })

      return expect(this.plugin._rpc.call('method', 'example.red.', []))
        .to.eventually.deep.equal({ a: 'b' })
    })

    it('should accept an object as a response', function () {
      nock('https://example.com')
        .post('/rpc?method=method&prefix=example.red.', [])
        .reply(200, {
          a: {
            b: 'c'
          }
        })

      return expect(this.plugin._rpc.call('method', 'example.red.', []))
        .to.eventually.deep.equal({
          a: {
            b: 'c'
          }
        })
    })
  })

  describe('sendRequest', () => {
    beforeEach(function * () {
      this.message = {
        from: this.plugin.getAccount(),
        to: peerAddress,
        ledger: this.plugin.getInfo().prefix,
        ilp: 'some_base64_encoded_data_goes_here',
        custom: {
          field: 'some stuff'
        }
      }

      this.response = {
        from: peerAddress,
        to: this.plugin.getAccount(),
        ledger: this.plugin.getInfo().prefix,
        ilp: 'some_other_base64_encoded_data_goes_here',
        custom: {
          field: 'some other stuff'
        }
      }
    })

    it('should send a request', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_request&prefix=example.red.', [this.message])
        .reply(200, this.response)

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_request', resolve))
      const incoming = new Promise((resolve) => this.plugin.on('incoming_response', resolve))

      const response = yield this.plugin.sendRequest(this.message)
      yield outgoing
      yield incoming

      assert.deepEqual(response, this.response)
    })

    it('should response to a request', function * () {
      this.response.to = this.message.from = peerAddress
      this.response.from = this.message.to = this.plugin.getAccount()

      this.plugin.registerRequestHandler((request) => {
        assert.deepEqual(request, this.message)
        return Promise.resolve(this.response)
      })

      const incoming = new Promise((resolve) => this.plugin.on('incoming_request', resolve))
      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_response', resolve))

      assert.deepEqual(
        yield this.plugin.receive('send_request', [this.message]),
        this.response)

      yield incoming
      yield outgoing
    })

    it('should return an ILP error if the request handler errors', function * () {
      this.response.to = this.message.from = peerAddress
      this.response.from = this.message.to = this.plugin.getAccount()

      this.plugin.registerRequestHandler((request) => {
        return Promise.reject(new Error('this is an error'))
      })

      const response = yield this.plugin.receive('send_request', [this.message])
      assert.equal(response.to, this.message.from)
      assert.equal(response.from, this.message.to)
      assert.equal(response.ledger, this.message.ledger)

      const error = IlpPacket.deserializeIlpError(Buffer.from(response.ilp, 'base64'))
      assert.equal(error.code, 'F00')
      assert.equal(error.name, 'Bad Request')
      assert.equal(error.triggeredBy, this.plugin.getAccount())
      assert.deepEqual(error.forwardedBy, [])
      assert.deepEqual(JSON.parse(error.data), { message: 'this is an error' })
    })

    it('should throw an error if a handler is already registered', function * () {
      this.plugin.registerRequestHandler(() => {})
      assert.throws(() => this.plugin.registerRequestHandler(() => {}),
        /requestHandler is already registered/)
    })

    it('should throw an error if no handler is registered', function * () {
      this.response.to = this.message.from = peerAddress
      this.response.from = this.message.to = this.plugin.getAccount()

      assert.isNotOk(this.plugin._requestHandler, 'handler should not be registered yet')

      this.plugin.registerRequestHandler((request) => {
        assert.deepEqual(request, this.message)
        return Promise.resolve(this.response)
      })

      this.plugin.deregisterRequestHandler()

      yield expect(this.plugin.receive('send_request', [this.message]))
        .to.be.rejectedWith(/no request handler registered/)
    })

    it('should throw an error on no response', function () {
      this.timeout(3000)
      return expect(this.plugin.sendRequest(this.message)).to.eventually.be.rejected
    })

    it('should not send without an account or to-from', function () {
      this.message.account = undefined
      this.message.to = undefined
      this.message.from = undefined

      return expect(this.plugin.sendRequest(this.message))
        .to.eventually.be.rejectedWith(/must have a destination/)
    })

    it('should not send with incorrect ledger', function () {
      this.message.ledger = 'bogus'
      return expect(this.plugin.sendRequest(this.message))
        .to.eventually.be.rejectedWith(/ledger .+ must match ILP prefix/)
    })
  })

  describe('sendTransfer (log and balance logic)', () => {
    beforeEach(function * () {
      this.fulfillment = require('crypto').randomBytes(32)
      this.transfer = {
        id: uuid(),
        ledger: this.plugin.getInfo().prefix,
        from: this.plugin.getAccount(),
        to: peerAddress,
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        amount: '5.0',
        custom: {
          field: 'some stuff'
        },
        executionCondition: base64url(crypto
          .createHash('sha256')
          .update(this.fulfillment)
          .digest())
      }
    })

    it('should send a transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      const sent = new Promise((resolve) => this.plugin.on('outgoing_prepare', resolve))
      yield this.plugin.sendTransfer(this.transfer)
      yield sent
    })

    it('should roll back a transfer if the RPC call fails', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(500)

      yield this.plugin.sendTransfer(this.transfer)
        .catch((e) => assert.match(e.message, /Unexpected status code 500/))

      assert.equal((yield this.plugin.getBalance()), '0', 'balance should be rolled back')
    })

    it('should receive a transfer', function * () {
      const received = new Promise((resolve, reject) => {
        this.plugin.on('incoming_prepare', (transfer) => {
          try {
            assert.deepEqual(transfer, this.transfer)
          } catch (e) {
            reject(e)
          }
          resolve()
        })
      })

      this.transfer.from = peerAddress
      this.transfer.to = this.plugin.getAccount()

      yield this.plugin.receive('send_transfer', [this.transfer])
      yield received
    })

    it('should not race when reading the balance', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      const transfer2 = Object.assign({}, this.transfer, { id: uuid() })
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [transfer2])
        .reply(200, true)

      yield this.plugin.sendTransfer(this.transfer)
      yield this.plugin.sendTransfer(transfer2)

      const send1 = this.plugin.receive('fulfill_condition',
        [ this.transfer.id, base64url(this.fulfillment) ])

      const send2 = this.plugin.receive('fulfill_condition',
        [ transfer2.id, base64url(this.fulfillment) ])

      yield Promise.all([ send1, send2 ])
      assert.equal(yield this.plugin.getBalance(), '-10',
        'both transfers should be applied to the balance')
    })

    it('should not apply twice when two identical transfers come in with the same id', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      yield this.plugin.sendTransfer(this.transfer)
      yield this.plugin.sendTransfer(this.transfer)

      const send1 = this.plugin.receive('fulfill_condition',
        [ this.transfer.id, base64url(this.fulfillment) ])

      const send2 = this.plugin.receive('fulfill_condition',
        [ this.transfer.id, base64url(this.fulfillment) ])
        .catch((e) => {})

      yield Promise.all([ send1, send2 ])
      assert.equal(yield this.plugin.getBalance(), '-5',
        'only one of the transfers should be applied to the balance')
    })

    it('should not race when two different transfers come in with the same id', function * () {
      const transfer1nock = nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [this.transfer])
        .reply(200, true)

      const transfer2 = Object.assign({}, this.transfer, { amount: '10' })
      const transfer2nock = nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=example.red.', [transfer2])
        .reply(200, true)

      const send1 = this.plugin.sendTransfer(this.transfer)
      const send2 = this.plugin.sendTransfer(transfer2)

      // one of these should be rejected because they are two transfer with the
      // same ID but different data
      yield expect(Promise.all([ send1, send2 ]))
        .to.eventually.be.rejectedWith(/transfer .* matches the id of .* but not the contents/)

      assert.isFalse(transfer1nock.isDone() && transfer2nock.isDone(),
        'one of the sendTransfer calls should fail')

      // this is the only way to clean up a nock
      yield request({
        uri: 'https://example.com/rpc?method=send_transfer&prefix=example.red.',
        body: [transfer2],
        json: true,
        method: 'POST'
      })
    })

    it('should not send a transfer without id', function () {
      this.transfer.id = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid id', function () {
      this.transfer.id = 666
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer without to', function () {
      delete this.transfer.to
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid to', function () {
      this.transfer.to = '$$$ cawiomdaAW ($Q@@)$@$'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with a non-string to', function () {
      this.transfer.to = 42
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with non-object data', function () {
      this.transfer.data = 9000
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with no amount', function () {
      this.transfer.amount = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with non-number amount', function () {
      this.transfer.amount = 'bogus'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with amount over limit', function () {
      this.transfer.amount = '50.0'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with negative amount', function () {
      this.transfer.amount = '-5.0'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })
  })

  describe('sendMessage (legacy)', () => {
    beforeEach(function * () {
      this.message = {
        from: this.plugin.getAccount(),
        to: peerAddress,
        ledger: this.plugin.getInfo().prefix,
        data: {
          field: 'some stuff'
        }
      }
    })

    it('should send a message', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_message&prefix=example.red.', [this.message])
        .reply(200, true)

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_message', resolve))
      yield this.plugin.sendMessage(this.message)
      yield outgoing
    })

    it('should receive a message', function * () {
      this.message.from = peerAddress
      this.message.to = this.plugin.getAccount()
      this.message.account = this.plugin.getAccount()

      const incoming = new Promise((resolve, reject) => {
        this.plugin.on('incoming_message', (message) => {
          try {
            assert.deepEqual(message, Object.assign({},
              this.message,
              { account: peerAddress }))
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })

      assert.isTrue(yield this.plugin.receive('send_message', [this.message]))
      yield incoming
    })

    it('should throw an error on no response', function () {
      this.timeout(3000)
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send without an account or to-from', function () {
      this.message.account = undefined
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send with incorrect ledger', function () {
      this.message.ledger = 'bogus'
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send with missing ledger', function () {
      this.message.ledger = undefined
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send without any data', function () {
      this.message.data = undefined
      return expect(this.plugin.sendMessage(this.message)).to.eventually.be.rejected
    })
  })
})
