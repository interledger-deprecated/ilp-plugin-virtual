'use strict'

const mockRequire = require('mock-require')
const mock = require('./helpers/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire('../src/model/connection', MockConnection)

const PluginVirtual = require('..')
const assert = require('chai').assert
const newSqliteStore = require('./helpers/sqliteStore')
const log = require('../src/util/log')('test')
const cc = require('five-bells-condition')
const uuid = require('uuid4')

/*
const PluginBells = require('ilp-plugin-bells')
const plugin1 = new PluginBells({
  account: 'https://red.ilpdemo.org/ledger/accounts/alice',
  password: 'alice',
  prefix: 'ilpdemo.red.'
})
const plugin2 = new PluginBells({
  account: 'https://red.ilpdemo.org/ledger/accounts/stefan',
  password: 'stefan',
  prefix: 'ilpdemo.red.'
})
const PluginEth = require('ilp-plugin-ethereum')
const plugin1 = new PluginEth({
  provider: 'http://localhost:8545',
  account: '0x900e20dc8dfaa3c835ac3858cde4fbf35031f838',
  prefix: 'ethereum.'
})
const plugin2 = new PluginEth({
  provider: 'http://localhost:8545',
  account: '0x3d674dbfb1b0bc96ae738129df5be40e5b809998',
  prefix: 'ethereum.'
})
*/

const EventEmitter = require('events')
const OptimisticPlugin = require('./helpers/optimisticPlugin')

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

let nerd = null
let noob = null
let handle = (err) => { log.log(err) }
let token = require('crypto').randomBytes(8).toString('hex')

describe('Automatic settlement', function () {
  it('should create the nerd and the noob', () => {
    let objStore = newSqliteStore()
    nerd = new PluginVirtual({
      _store: objStore,
      _optimisticPlugin: plugin1,
//      settleAddress: 'ethereum.0x3d674dbfb1b0bc96ae738129df5be40e5b809998',
      settleAddress: 'example.plugin2',
      host: 'mqatt://test.mosquitto.org',
      token: token,
      limit: '1',
      max: '2',
      balance: '0',
      account: 'test.nerd.nerd',
      prefix: 'test.nerd.',
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      secret: 'secret'
    })

    noob = new PluginVirtual({
      _store: {},
      _optimisticPlugin: plugin2,
//      settleAddress: 'ethereum.0x900e20dc8dfaa3c835ac3858cde4fbf35031f838',
      settleAddress: 'example.plugin1',
      max: '2',
      host: 'mqatt://test.mosquitto.org',
      token: token,
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      account: 'test.nerd.noob'
    })
  })

  let next = null
  it('should connect the noob and the nerd', (done) => {
    next = Promise.all([
      noob.connect(),
      nerd.connect(),
      plugin1.connect(),
      plugin2.connect()
    ]).then(() => {
      done()
    }).catch(handle)
  })

  it('should trigger settlement on a big transfer', function (done) {
    const id = uuid()

    noob.once('balance', (balance) => {
      assert.equal(balance, '1')
      done()
    })
    
    noob.send({
      account: 'ilpdemo.red.alice',
      amount: '10',
      id: id
    })
  })
})
