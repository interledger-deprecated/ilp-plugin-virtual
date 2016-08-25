'use strict'

const mockRequire = require('mock-require')
const mock = require('./mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire('../src/model/connection', MockConnection)

const PluginVirtual = require('..')
const assert = require('chai').assert
const newSqliteStore = require('./helpers/sqliteStore')
const cc = require('five-bells-condition')

let nerd = null
let noob = null
let token = require('crypto').randomBytes(8).toString('hex')

describe('Conditional transfers with Nerd and Noob', function () {
  it('should create the nerd and the noob', () => {
    mockRequire('mqtt', null)
    let objStore = newSqliteStore()
    nerd = new PluginVirtual({
      _store: objStore,
      host: 'mqatt://test.mosquitto.org',
      token: token,
      initialBalance: '0',
      maxBalance: '2000',
      minBalance: '-1000',
      settleIfUnder: '-1000',
      settleIfOver: '2000',
      account: 'nerd',
      prefix: 'test.nerd.',
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      secret: 'secret'
    })
    noob = new PluginVirtual({
      _store: {},
      host: 'mqatt://test.mosquitto.org',
      token: token,
      mockConnection: MockConnection,
      mockChannels: MockChannels,
      account: 'noob'
    })
    assert.isObject(noob)
    assert.isObject(nerd)
  })

  it('should connect the noob and the nerd', () => {
    return Promise.all([
      noob.connect(),
      nerd.connect()
    ])
  })

  let fulfillment = 'cf:0:'
  let condition = cc.fulfillmentToCondition(fulfillment)

  it('should acknowledge a UTP transaction', () => {
    const p = new Promise((resolve) => {
      nerd.once('outgoing_prepare', (transfer, message) => {
        assert(transfer.id === 'first')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    })

    nerd.send({
      id: 'first',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should not count escrowed money in balance yet', () => {
    return noob.getBalance().then((balance) => {
      assert(balance === '0')
    })
  })

  it('should fulfill a UTP transaction as the noob', () => {
    const p = new Promise((resolve) => {
      noob.once('incoming_fulfill', (transfer, fulfillment) => {
        assert(transfer.id === 'first')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    })

    noob.fulfillCondition('first', fulfillment)

    return p
  })

  it('should recover the fulfillment from a fulfilled transfer', () => {
    return Promise.all([
      noob.getFulfillment('first').then((f) => {
        assert.equal(f, fulfillment)
      }),
      nerd.getFulfillment('first').then((f) => {
        assert.equal(f, fulfillment)
      })
    ])
  })

  it('should return error from getFulfillment of nonexistant transfer', () => {
    return Promise.all([
      new Promise((resolve) => {
        noob.getFulfillment('garbage').catch(() => { resolve() })
      }),
      new Promise((resolve) => {
        nerd.getFulfillment('garbage').catch(() => { resolve() })
      })
    ])
  })

  it('should have the correct balance after executing', () => {
    return noob.getBalance().then((balance) => {
      assert(balance === '100')
    })
  })

  it('should support UTP transfers with time limits noob->nerd', () => {
    const p = new Promise((resolve) => {
      noob.once('outgoing_cancel', (transfer, message) => {
        assert(transfer.id === 'time_out')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    })

    noob.send({
      id: 'time_out',
      account: 'x',
      amount: '200',
      executionCondition: condition,
      expiresAt: (new Date()).toString()
    })

    return p
  })

  it('should support UTP transfers with time limits nerd->noob', () => {
    const promise = new Promise((resolve) => {
      nerd.once('outgoing_cancel', (transfer, message) => {
        assert(transfer.id === 'time_out_3')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    })

    nerd.send({
      id: 'time_out_3',
      account: 'x',
      amount: '200',
      executionCondition: condition,
      expiresAt: (new Date()).toString()
    })

    return promise
  })

  it('should cancel fulfillments submitted after timeout', () => {
    let time = new Date()
    time.setSeconds(time.getSeconds() + 1)

    nerd.once('_timing', () => {
      clearTimeout(nerd.timers['time_out_2'])
    })

    return noob.send({
      id: 'time_out_2',
      account: 'x',
      amount: '200',
      executionCondition: condition,
      expiresAt: time.toString()
    }).then(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          noob.fulfillCondition('time_out_2', fulfillment)
        }, 1000)
        noob.once('outgoing_cancel', (transfer, message) => {
          assert(transfer.id === 'time_out_2')
          assert(transfer.ledger === 'test.nerd.')
          resolve()
        })
      })
    })
  })

  it('should complete a UTP transfer with a time limit', () => {
    let time = new Date()
    time.setSeconds(time.getSeconds() + 4)

    const p = new Promise((resolve) => {
      noob.once('outgoing_prepare', (transfer, message) => {
        assert(transfer.id === 'time_complete')
        resolve()
      })
    }).then(() => {
      let promise = new Promise((resolve) => {
        noob.once('outgoing_fulfill', (transfer, fulfill) => {
          assert(transfer.id === 'time_complete')
          resolve()
        })
      })
      nerd.fulfillCondition('time_complete', fulfillment)
      return promise
    })

    noob.send({
      id: 'time_complete',
      account: 'x',
      amount: '200',
      executionCondition: condition,
      expiresAt: time.toString()
    })

    return p
  })

  it('should submit a UTP transaction as the nerd', () => {
    return nerd.send({
      id: 'third',
      account: 'x',
      amount: '100',
      executionCondition: condition
    }).then(() => {
      const noobPromise = new Promise((resolve) => {
        noob.once('incoming_fulfill', (transfer, message) => {
          assert(transfer.id === 'third')
          resolve()
        })
      })
      const nerdPromise = new Promise((resolve) => {
        nerd.once('outgoing_fulfill', (transfer, message) => {
          assert(transfer.id === 'third')
          resolve()
        })
      })
      nerd.fulfillCondition('third', fulfillment).catch()
      return Promise.all([noobPromise, nerdPromise])
    })
  })

  it('should complain on fulfilling a nonexistant transfer', () => {
    const promise = new Promise((resolve) => {
      nerd.once('exception', (err) => {
        assert(err.message === 'got transfer ID for nonexistant transfer')
        resolve()
      })
    })

    nerd.fulfillCondition('nonexistant', 'garbage')
    return promise
  })

  it('should be able to execute a transfer noob -> nerd', () => {
    const p = new Promise((resolve) => {
      noob.once('outgoing_prepare', (transfer, message) => {
        assert(transfer.id === 'fourth')
        resolve()
      })
    }).then(() => {
      const p = new Promise((resolve) => {
        noob.once('outgoing_fulfill', (transfer, message) => {
          assert(transfer.id === 'fourth')
          resolve()
        })
      })
      noob.fulfillCondition('fourth', fulfillment).catch()
      return p
    })

    noob.send({
      id: 'fourth',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should complain on fulfilling an transfer twice', () => {
    const promise = new Promise((resolve) => {
      nerd.once('exception', (err) => {
        assert(err.message === 'this transfer has already been fulfilled')
        resolve()
      })
    })
    nerd.fulfillCondition('first', fulfillment)
    return promise
  })

  it('should complain when an OTP transfer is fulfilled', () => {
    const p = new Promise((resolve) => {
      noob.once('outgoing_transfer', (transfer, message) => {
        assert(transfer.id === 'fifth')
        resolve()
      })
    }).then(() => {
      let promise = new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'got transfer ID for OTP transfer')
          resolve()
        })
      })
      nerd.fulfillCondition('fifth', fulfillment)
      return promise
    })

    noob.send({
      id: 'fifth',
      account: 'x',
      amount: '10'
    })

    return p
  })

  it('should complain if transfer is given incorrect fulfillment', () => {
    const p = new Promise((resolve) => {
      nerd.once('outgoing_prepare', (transfer, message) => {
        assert(transfer.id === 'sixth')
        resolve()
      })
    }).then(() => {
      let promise = new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'invalid fulfillment')
          resolve()
        })
      })
      nerd.fulfillCondition('sixth', 'garbage')
      return promise
    })

    nerd.send({
      id: 'sixth',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should be able to prematurely reject transfer as nerd', () => {
    const p = new Promise((resolve) => {
      nerd.once('incoming_prepare', (transfer, message) => {
        assert(transfer.id === 'seventh')
        resolve()
      })
    }).then(() => {
      const promise = Promise.all([
        new Promise((resolve) => {
          nerd.once('incoming_reject', (transfer, msg) => {
            assert(msg === 'manually rejected')
            resolve()
          })
        }),
        new Promise((resolve) => {
          noob.once('outgoing_reject', (transfer, msg) => {
            assert(msg === 'manually rejected')
            resolve()
          })
        })
      ])
      nerd.rejectIncomingTransfer('seventh').catch()
      return promise
    })

    noob.send({
      id: 'seventh',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should be able to prematurely reject transfer as noob', () => {
    const p = new Promise((resolve) => {
      noob.once('incoming_prepare', (transfer, message) => {
        assert(transfer.id === 'eighth')
        resolve()
      })
    }).then(() => {
      let promise = Promise.all([
        new Promise((resolve) => {
          noob.once('incoming_reject', (transfer, msg) => {
            assert(msg === 'manually rejected')
            resolve()
          })
        }),
        new Promise((resolve) => {
          nerd.once('outgoing_reject', (transfer, msg) => {
            assert(msg === 'manually rejected')
            resolve()
          })
        })
      ])
      noob.rejectIncomingTransfer('eighth').catch()
      return promise
    })

    nerd.send({
      id: 'eighth',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should not be able to reject outgoing transfer as noob', () => {
    const p = new Promise((resolve) => {
      nerd.once('incoming_prepare', (transfer, message) => {
        assert(transfer.id === 'ninth')
        resolve()
      })
    }).then(() => {
      return noob.rejectIncomingTransfer('ninth')
    }).catch((err) => {
      assert.equal(
        err.message,
        'transfer must be incoming'
      )
    })

    noob.send({
      id: 'ninth',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should not be able to reject outgoing transfer as nerd', () => {
    const p = new Promise((resolve) => {
      noob.once('incoming_prepare', (transfer, message) => {
        assert(transfer.id === 'tenth')
        resolve()
      })
    }).then(() => {
      return nerd.rejectIncomingTransfer('tenth')
    }).catch((err) => {
      assert.equal(
        err.message,
        'transfer must be incoming'
      )
    })

    nerd.send({
      id: 'tenth',
      account: 'x',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should not be able to reject nonexistant transfer as noob', () => {
    return noob.rejectIncomingTransfer('garbage').catch((err) => {
      assert.equal(
        err.message,
        'must be an existing transfer with a condition'
      )
    })
  })

  it('should not be able to reject nonexistant transfer as nerd', () => {
    return noob.rejectIncomingTransfer('garbage').catch((err) => {
      assert.equal(
        err.message,
        'must be an existing transfer with a condition'
      )
    })
  })

  it('should disconnect gracefully', () => {
    return Promise.all([
      noob.disconnect(),
      nerd.disconnect()
    ])
  })
})
