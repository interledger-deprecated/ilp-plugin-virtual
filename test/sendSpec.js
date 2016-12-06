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
const uuid = require('uuid4')

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const expect = chai.expect

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
  broker: 'mqtt://example.com',
  other: {
    'channels': MockChannels,
    'name': 'noob'
  },
  info: info
}

describe('Send', () => {
  beforeEach(function * () {
    this.pluginA = new PluginVirtual(Object.assign({}, options, {_store: newObjStore()}))
    this.pluginB = new PluginVirtual(Object.assign({}, options, {_store: newObjStore(),
      other: {channels: MockChannels, name: 'nerd'}}))

    yield this.pluginA.connect()
    yield this.pluginB.connect()
  })

  afterEach(function * () {
    yield this.pluginA.disconnect()
    yield this.pluginB.disconnect()
  })

  describe('sendMessage', () => {
    beforeEach(function * () {
      this.message = {
        account: 'peer.usd.other',
        ledger: (yield this.pluginA.getPrefix()),
        data: {
          field: 'some stuff'
        }
      }
    })

    it('should send a message from A to B', function * () {
      this.pluginB.on('incoming_message', (msg) => {
        assert.equal(msg.data.field, 'some stuff', 'message data should remain unchanged') 
      })

      yield this.pluginA.sendMessage(this.message)
    })

    it('should send a message in the to-from form', function * () {
      this.pluginB.on('incoming_message', (msg) => {
        assert.equal(msg.data.field, 'some stuff', 'message data should remain unchanged') 
      })

      yield this.pluginA.sendMessage(Object.assign({},
        this.message,
        { to: 'peer.usd.other', // account names don't matter on trustlines
          from: 'peer.usd.me', // there's only one possible src/dest
          account: undefined
        }))
    })

    it('should not send without an account or to-from', function () {
      this.message.account = undefined
      return expect(this.pluginA.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send with incorrect ledger', function () {
      this.message.ledger = 'bogus'
      return expect(this.pluginA.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send with missing ledger', function () {
      this.message.ledger = undefined
      return expect(this.pluginA.sendMessage(this.message)).to.eventually.be.rejected
    })

    it('should not send without any data', function () {
      this.message.data = undefined
      return expect(this.pluginA.sendMessage(this.message)).to.eventually.be.rejected
    })
  })

  describe('sendTransfer (non-conditional)', () => {
    beforeEach(function * () {
      this.transfer = {
        id: uuid(),
        ledger: (yield this.pluginA.getPrefix()),
        account: 'other',
        amount: '5.0',
        data: {
          field: 'some stuff'
        }
      }
    })

    it('should send a transfer from A to B', function * () {
      const received = new Promise((resolve, reject) => {
        this.pluginA.on('incoming_transfer', (transfer) => {
          try {
            assert.equal(transfer.amount, this.transfer.amount, 'amounts should match')
            assert.equal(transfer.id, this.transfer.id, 'ids should match')
            assert.equal(transfer.data.field, this.transfer.data.field, 'data should be kept intact')
            resolve()
          } catch (e) {
            reject(e) 
          }
        })
      })

      yield this.pluginA.sendTransfer(this.transfer)
      // yield received

      assert.equal((yield this.pluginA.getBalance()), '-5', 'balance should decrease by amount')
      assert.equal((yield this.pluginB.getBalance()), '5', 'balance should increase by amount')
    })

    it('should not send a transfer without id', function () {
      this.transfer.id = undefined
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer without account', function () {
      this.transfer.account = undefined
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid id', function () {
      this.transfer.id = 666
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with an invalid account', function () {
      this.transfer.account = '$$$ cawiomdaAW ($Q@@)$@$'
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with a non-string account', function () {
      this.transfer.account = 42
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with non-object data', function () {
      this.transfer.data = 9000
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with no amount', function () {
      this.transfer.amount = undefined
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with non-number amount', function () {
      this.transfer.amount = 'bogus'
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with amount over maximum', function () {
      this.transfer.amount = '50.0'
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })

    it('should not send a transfer with negative amount', function () {
      this.transfer.amount = '-5.0'
      return expect(this.pluginA.sendTransfer(this.transfer)).to.eventually.be.rejected
    })
  })
})
