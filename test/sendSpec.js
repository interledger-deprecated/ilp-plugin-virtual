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

  describe('sendMessage', () => {
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
        .post('/rpc?method=send_message&prefix=peer.NavKx.usd.2.', [this.message])
        .reply(200, true)

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_message', resolve))
      yield this.plugin.sendMessage(this.message)
      yield outgoing
    })

    it('should send a message with deprecated fields', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_message&prefix=peer.NavKx.usd.2.', [this.message])
        .reply(200, true)

      delete this.message.to
      delete this.message.from
      this.message.account = 'other'

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
