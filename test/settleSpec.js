'use strict'

const mockRequire = require('mock-require')
const mock = require('./mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire('../src/model/connection', MockConnection)

const PluginVirtual = require('..')
const assert = require('chai').assert
const newSqliteStore = require('./helpers/sqliteStore')
const uuid = require('uuid4')

const EventEmitter = require('events')
const OptimisticPlugin = require('./mocks/mockOptimisticPlugin')
mockRequire('ilp-plugin-mock', OptimisticPlugin)

const channels = [ new EventEmitter(), new EventEmitter() ]
const plugin1 = new OptimisticPlugin({
  channels: channels,
  index: 0,
  address: 'example.plugin1',
  prefix: 'example.'
})
const plugin2 = new OptimisticPlugin({
  channels: channels,
  index: 1,
  address: 'example.plugin2',
  prefix: 'example.'
})

const base64url = require('base64url')
const token = base64url(JSON.stringify({
  channel: require('crypto').randomBytes(8).toString('hex'),
  host: 'mqtt://test.mosquitto.org'
}))

let nerd = null
let noob = null

describe('Automatic settlement', function () {
  it('should create the nerd and the noob', () => {
    let objStore = newSqliteStore()
    nerd = new PluginVirtual({
      _store: objStore,
      _optimisticPlugin: plugin1,
      token: token,
      initialBalance: '0',
      minBalance: '-1',
      maxBalance: '2',
      settleIfUnder: '-1',
      settleIfOver: '2',
      account: 'test.nerd.nerd',
      prefix: 'test.nerd.',
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      secret: 'secret'
    })

    noob = new PluginVirtual({
      _store: {},
      _optimisticPlugin: plugin2,
      token: token,
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      account: 'test.nerd.noob'
    })
  })

  it('should create optimistic plugins with options as noob', () => {
    const noob2 = new PluginVirtual({
      _store: {},
      _optimisticPlugin: 'ilp-plugin-mock',
      _optimisticPluginOpts: {
        channels: channels,
        index: 1,
        address: 'example.plugin2',
        prefix: 'example.'
      },
      token: token,
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      account: 'test.nerd.noob'
    })
    assert.equal(typeof noob2.settler, 'object')
  })

  it('should create optimistic plugins with options as nerd', () => {
    let objStore2 = newSqliteStore()
    const nerd2 = new PluginVirtual({
      _store: objStore2,
      _optimisticPlugin: 'ilp-plugin-mock',
      _optimisticPluginOpts: {
        channels: channels,
        index: 1,
        address: 'example.plugin2',
        prefix: 'example.'
      },
      token: token,
      initialBalance: '0',
      minBalance: '-1',
      maxBalance: '2',
      settleIfUnder: '-1',
      settleIfOver: '2',
      account: 'test.nerd.nerd',
      prefix: 'test.nerd.',
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      secret: 'secret'
    })
    assert.equal(typeof nerd2.settler, 'object')
  })

  it('should connect the noob and the nerd', () => {
    return Promise.all([
      noob.connect(),
      nerd.connect()
    ])
  })

  it('should trigger settlement on a big transfer', function () {
    const id = uuid()
    const p = new Promise((resolve) => {
      noob.once('balance', (balance) => {
        assert.equal(balance, '1')
        resolve()
      })
    })

    noob.sendTransfer({
      account: 'ilpdemo.red.alice',
      amount: '10',
      id: id
    })

    return p
  })

  it('should trigger settlement from the nerd to the noob', function () {
    const id = uuid()
    const p = new Promise((resolve) => {
      noob.once('balance', (balance) => {
        assert.equal(balance, '0')
        resolve()
      })
    })

    nerd.sendTransfer({
      account: 'ilpdemo.red.alice',
      amount: '10',
      id: id
    })

    return p
  })

  it('should give an error settling without a settler as noob', function () {
    const id = uuid()

    noob.settler = null
    noob.sendTransfer({
      account: 'ilpdemo.red.alice',
      amount: '10',
      id: id
    }).catch((e) => {
      assert.equal(e.name, 'NotAcceptedError')
    })
  })

  it('should not settle as nerd if settlement doesn\'t come from noob', function () {
    const plugin = new OptimisticPlugin({
      channels: channels,
      index: 1,
      address: 'example.plugin3',
      prefix: 'example.'
    })

    plugin.sendTransfer({
      account: 'example.plugin1',
      amount: '10',
      id: uuid()
    })
  })

  it('should give an error settling without a settler as nerd', function () {
    const id = uuid()

    nerd.settleAddress = null
    nerd.sendTransfer({
      account: 'ilpdemo.red.alice',
      amount: '10',
      id: id
    }).catch((e) => {
      assert.equal(e.name, 'NotAcceptedError')
    })
  })

  it('should get the settle address from the nerd', function () {
    return noob.getSettleAddress().then((address) => {
      assert.equal(address, 'example.plugin1')
    })
  })
})
