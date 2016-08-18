'use strict'

const mockRequire = require('mock-require')
const mock = require('./helpers/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire('../src/model/connection', MockConnection)

const PluginVirtual = require('..')
const assert = require('chai').assert
const newSqliteStore = require('./helpers/sqliteStore')
const uuid = require('uuid4')

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
let token = require('crypto').randomBytes(8).toString('hex')

describe('Automatic settlement', function () {
  let next = Promise.resolve(null)

  it('should create the nerd and the noob', () => {
    next = next.then(() => {
      let objStore = newSqliteStore()
      nerd = new PluginVirtual({
        _store: objStore,
        _optimisticPlugin: plugin1,
        settleAddress: 'example.plugin2',
        host: 'mqatt://test.mosquitto.org',
        token: token,
        limit: '1',
        warnLimit: '1',
        max: '2',
        warnMax: '2',
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
        settleAddress: 'example.plugin1',
        host: 'mqatt://test.mosquitto.org',
        token: token,
        mockConnection: MockConnection,
        mockChannels: MockChannels,
        account: 'test.nerd.noob'
      })
    })
  })

  it('should connect the noob and the nerd', (done) => {
    next = next.then(() => {
      return Promise.all([
        noob.connect(),
        nerd.connect(),
        plugin1.connect(),
        plugin2.connect()
      ])
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should trigger settlement on a big transfer', function (done) {
    next = next.then(() => {
      const id = uuid()

      const p = new Promise((resolve) => {
        noob.once('balance', (balance) => {
          assert.equal(balance, '1')
          resolve()
        })
      })

      noob.send({
        account: 'ilpdemo.red.alice',
        amount: '10',
        id: id
      })

      return p
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should trigger settlement from the nerd to the noob', function (done) {
    next = next.then(() => {
      const id = uuid()
      const p = new Promise((resolve) => {
        noob.once('balance', (balance) => {
          assert.equal(balance, '0')
          resolve()
        })
      })

      nerd.send({
        account: 'ilpdemo.red.alice',
        amount: '10',
        id: id
      })

      return p
    }).then(() => {
      done()
    }).catch(done)
  })
})
