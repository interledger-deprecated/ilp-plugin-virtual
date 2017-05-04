'use strict'

const nock = require('nock')
const uuid = require('uuid4')
const request = require('co-request')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const expect = chai.expect

const ObjStore = require('./helpers/objStore')
const PluginVirtual = require('..')

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
  peerPublicKey: 'Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk',
  rpcUri: 'https://example.com/rpc',
  info: info
}

describe('Send', () => {
  beforeEach(function * () {
    this.plugin = new PluginVirtual(Object.assign({},
      options, { _store: new ObjStore() }))

    yield this.plugin.connect()
  })

  afterEach(function * () {
    assert(nock.isDone(), 'nocks should all have been called')
  })

  describe('RPC', () => {
    it('should throw an error on an error code', function () {
      nock('https://example.com')
        .post('/rpc?method=method&prefix=peer.NavKx.usd.2.', [])
        .reply(500)

      return expect(this.plugin._rpc.call('method', 'peer.NavKx.usd.2.', []))
        .to.eventually.be.rejected
    })

    it('should send authorization bearer token', function () {
      nock('https://example.com', {
        reqheaders: {
          'Authorization': 'Bearer ' + this.plugin._authToken
        }
      })
        .post('/rpc?method=method&prefix=peer.NavKx.usd.2.', [])
        .reply(200, { a: 'b' })

      return expect(this.plugin._rpc.call('method', 'peer.NavKx.usd.2.', []))
        .to.eventually.deep.equal({ a: 'b' })
    })

    it('should accept an object as a response', function () {
      nock('https://example.com')
        .post('/rpc?method=method&prefix=peer.NavKx.usd.2.', [])
        .reply(200, {
          a: {
            b: 'c'
          }
        })

      return expect(this.plugin._rpc.call('method', 'peer.NavKx.usd.2.', []))
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
        .post('/rpc?method=send_request&prefix=peer.NavKx.usd.2.', [this.message])
        .reply(200, this.response)

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_request', resolve))
      const incoming = new Promise((resolve) => this.plugin.on('incoming_response', resolve))

      const response = yield this.plugin.sendRequest(this.message)
      yield outgoing
      yield incoming

      assert.deepEqual(response, this.response)
    })

    it('should send a request with deprecated fields', function * () {
      delete this.response.to
      delete this.response.from
      this.response.account = 'other'

      delete this.message.to
      delete this.message.from
      this.message.account = 'other'

      nock('https://example.com')
        .post('/rpc?method=send_request&prefix=peer.NavKx.usd.2.', [this.message])
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

    it('should not send with missing ledger', function () {
      this.message.ledger = undefined
      return expect(this.plugin.sendRequest(this.message))
        .to.eventually.be.rejectedWith(/must have a ledger/)
    })

    it('should not send without any ilp packet', function () {
      this.message.ilp = undefined
      return expect(this.plugin.sendRequest(this.message))
        .to.eventually.be.rejectedWith(/must have ilp field/)
    })
  })

  describe('sendTransfer (non-conditional)', () => {
    beforeEach(function * () {
      this.transfer = {
        id: uuid(),
        ledger: this.plugin.getInfo().prefix,
        from: this.plugin.getAccount(),
        to: peerAddress,
        amount: '5.0',
        data: {
          field: 'some stuff'
        }
      }
    })

    it('should send a transfer', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200, true)

      const balanced = new Promise((resolve, reject) => {
        this.plugin.on('balance', (balance) => {
          try {
            assert.equal(balance, '-5')
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })

      const sent = new Promise((resolve) => this.plugin.on('outgoing_transfer', resolve))
      yield this.plugin.sendTransfer(this.transfer)
      yield sent
      yield balanced

      assert.equal((yield this.plugin.getBalance()), '-5', 'balance should decrease by amount')
      assert.equal((yield this.plugin._store.get('balance__')), '-5', 'correct balance should be stored')
      assert.deepEqual(this.plugin._transfers._storeCache, {}, 'transfer cache should be clear')
    })

    it('should roll back a transfer if the RPC call fails', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(500)

      yield this.plugin.sendTransfer(this.transfer)
        .catch((e) => assert.match(e.message, /Unexpected status code 500/))

      assert.equal((yield this.plugin.getBalance()), '0', 'balance should be rolled back')
    })

    it('should send a transfer with deprecated fields', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200, true)

      const balanced = new Promise((resolve, reject) => {
        this.plugin.on('balance', (balance) => {
          try {
            assert.equal(balance, '-5')
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })

      delete this.transfer.to
      delete this.transfer.from
      this.transfer.account = 'other'

      const sent = new Promise((resolve) => this.plugin.on('outgoing_transfer', resolve))
      yield this.plugin.sendTransfer(this.transfer)
      yield sent
      yield balanced

      assert.equal((yield this.plugin.getBalance()), '-5', 'balance should decrease by amount')
    })

    it('should receive a transfer', function * () {
      const balanced = new Promise((resolve, reject) => {
        this.plugin.on('balance', (balance) => {
          try {
            assert.equal(balance, '5')
            resolve()
          } catch (e) {
            reject(e)
          }
        })
      })

      const received = new Promise((resolve, reject) => {
        this.plugin.on('incoming_transfer', (transfer) => {
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
      yield balanced
    })

    it('should not race when reading the balance', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200, true)

      const transfer2 = Object.assign({}, this.transfer, { id: uuid() })
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [transfer2])
        .reply(200, true)

      const send1 = this.plugin.sendTransfer(this.transfer)
      const send2 = this.plugin.sendTransfer(transfer2)

      yield Promise.all([ send1, send2 ])
      assert.equal(yield this.plugin.getBalance(), '-10',
        'both transfers should be applied to the balance')
    })

    it('should not apply twice when two identical transfers come in with the same id', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200, true)

      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200, true)

      const send1 = this.plugin.sendTransfer(this.transfer)
      const send2 = this.plugin.sendTransfer(this.transfer)

      yield Promise.all([ send1, send2 ])
      assert.equal(yield this.plugin.getBalance(), '-5',
        'only one of the transfers should be applied to the balance')
    })

    it('should not race when two different transfers come in with the same id', function * () {
      const transfer1nock = nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [this.transfer])
        .reply(200, true)

      const transfer2 = Object.assign({}, this.transfer, { amount: '10' })
      const transfer2nock = nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.', [transfer2])
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
        uri: 'https://example.com/rpc?method=send_transfer&prefix=peer.NavKx.usd.2.',
        body: [transfer2],
        json: true,
        method: 'POST'
      })
    })

    it('should not send a transfer without id', function () {
      this.transfer.id = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer without account', function () {
      this.transfer.account = undefined
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid id', function () {
      this.transfer.id = 666
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid account', function () {
      this.transfer.account = '$$$ cawiomdaAW ($Q@@)$@$'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with a non-string account', function () {
      this.transfer.account = 42
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

    it('should not send a transfer with amount over maximum', function () {
      this.transfer.amount = '50.0'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with negative amount', function () {
      this.transfer.amount = '-5.0'
      return expect(this.plugin.sendTransfer(this.transfer)).to.eventually.be.rejected
    })
  })
})
