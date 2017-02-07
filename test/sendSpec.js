'use strict'

const nock = require('nock')
const uuid = require('uuid4')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const expect = chai.expect

const ObjStore = require('./helpers/objStore')
const PluginVirtual = require('..')

const info = {
  currencyCode: 'USD',
  currencySymbol: '$',
  precision: 15,
  scale: 15,
  connectors: [ { id: 'other', name: 'other', connector: 'peer.usd.other' } ]
}

const peerAddress = 'peer.NavKx.usd.Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk'
const options = {
  currency: 'USD',
  secret: 'seeecret',
  maxBalance: '10',
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
        .post('/rpc?method=method&prefix=peer.NavKx.usd.', [])
        .reply(500)

      return expect(this.plugin._rpc.call('method', 'peer.NavKx.usd.', []))
        .to.eventually.be.rejected
    })

    it('should accept an object as a response', function () {
      nock('https://example.com')
        .post('/rpc?method=method&prefix=peer.NavKx.usd.', [])
        .reply(200, {
          a: {
            b: 'c' 
          }
        })
  
      return expect(this.plugin._rpc.call('method', 'peer.NavKx.usd.', []))
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
        .post('/rpc?method=send_message&prefix=peer.NavKx.usd.', [this.message])
        .reply(200, true)

      const outgoing = new Promise((resolve) => this.plugin.on('outgoing_message', resolve))
      yield this.plugin.sendMessage(this.message)
      yield outgoing
    })

    it('should send a message with deprecated fields', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_message&prefix=peer.NavKx.usd.', [this.message])
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
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.', [this.transfer])
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
    })

    it('should send a transfer with deprecated fields', function * () {
      nock('https://example.com')
        .post('/rpc?method=send_transfer&prefix=peer.NavKx.usd.', [this.transfer])
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
