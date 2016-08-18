'use strict'

const mockRequire = require('mock-require')
const mock = require('./helpers/mockConnection')
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
      limit: '1000',
      warnLimit: '1000',
      max: '2000',
      warnMax: '2000',
      balance: '0',
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

  let next = null
  it('should connect the noob and the nerd', (done) => {
    next = Promise.all([
      noob.connect(),
      nerd.connect()
    ]).then(() => {
      done()
    }).catch(done)
  })

  let fulfillment = 'cf:0:'
  let condition = cc.fulfillmentToCondition(fulfillment)

  it('should acknowledge a UTP transaction', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        nerd.once('outgoing_prepare', (transfer, message) => {
          assert(transfer.id === 'first')
          assert(transfer.ledger === 'test.nerd.')
          resolve()
        })
      }).catch(done)

      nerd.send({
        id: 'first',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)

      return p
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should not count escrowed money in balance yet', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '0')
      done()
    }).catch(done)
  })

  it('should fulfill a UTP transaction as the noob', (done) => {
    next = next.then(() => {
    }).then(() => {
      const p = new Promise((resolve) => {
        noob.once('incoming_fulfill', (transfer, fulfillment) => {
          assert(transfer.id === 'first')
          assert(transfer.ledger === 'test.nerd.')
          resolve()
        })
      }).catch(done)

      noob.fulfillCondition('first', fulfillment)

      return p
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should have the correct balance after executing', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '100')
      done()
    }).catch(done)
  })

  it('should support UTP transfers with time limits noob->nerd', (done) => {
    next = next.then(() => {
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
      }).catch(done)

      return p
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should support UTP transfers with time limits nerd->noob', (done) => {
    next = next.then(() => {
      let promise = new Promise((resolve) => {
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
      }).catch(done)
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should cancel fulfillments submitted after timeout', (done) => {
    let time = new Date()
    time.setSeconds(time.getSeconds() + 1)

    next = next.then(() => {
      nerd.once('_timing', () => {
        clearTimeout(nerd.timers['time_out_2'])
      })
      return noob.send({
        id: 'time_out_2',
        account: 'x',
        amount: '200',
        executionCondition: condition,
        expiresAt: time.toString()
      })
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
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should complete a UTP transfer with a time limit', (done) => {
    next = next.then(() => {
      let time = new Date()
      time.setSeconds(time.getSeconds() + 4)

      const p = new Promise((resolve) => {
        noob.once('outgoing_prepare', (transfer, message) => {
          assert(transfer.id === 'time_complete')
          resolve()
        })
      })

      noob.send({
        id: 'time_complete',
        account: 'x',
        amount: '200',
        executionCondition: condition,
        expiresAt: time.toString()
      }).catch(done)

      return p
    }).then(() => {
      let promise = new Promise((resolve) => {
        noob.once('outgoing_fulfill', (transfer, fulfill) => {
          assert(transfer.id === 'time_complete')
          resolve()
        })
      })
      nerd.fulfillCondition('time_complete', fulfillment)
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should submit a UTP transaction as the nerd', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'third',
        account: 'x',
        amount: '100',
        executionCondition: condition
      })
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
      nerd.fulfillCondition('third', fulfillment).catch(done)
      return Promise.all([noobPromise, nerdPromise])
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should complain on fulfilling a nonexistant transfer', (done) => {
    next = next.then(() => {
      let promise = new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'got transfer ID for nonexistant transfer')
          resolve()
        })
      })
      nerd.fulfillCondition('nonexistant', 'garbage')
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should be able to execute a transfer noob -> nerd', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        noob.once('outgoing_prepare', (transfer, message) => {
          assert(transfer.id === 'fourth')
          resolve()
        })
      })
      noob.send({
        id: 'fourth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)
      return p
    }).then(() => {
      const p = new Promise((resolve) => {
        noob.once('outgoing_fulfill', (transfer, message) => {
          assert(transfer.id === 'fourth')
          resolve()
        })
      })
      noob.fulfillCondition('fourth', fulfillment).catch(done)
      return p
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should complain on fulfilling an transfer twice', (done) => {
    next = next.then(() => {
      let promise = new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'this transfer has already been fulfilled')
          resolve()
        })
      })
      nerd.fulfillCondition('first', fulfillment)
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should complain when an OTP transfer is fulfilled', (done) => {
    next = next.then(() => {
    }).then(() => {
      const p = new Promise((resolve) => {
        noob.once('outgoing_transfer', (transfer, message) => {
          assert(transfer.id === 'fifth')
          resolve()
        })
      })
      noob.send({
        id: 'fifth',
        account: 'x',
        amount: '10'
      }).catch(done)
      return p
    }).then(() => {
      let promise = new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'got transfer ID for OTP transfer')
          resolve()
        })
      })
      nerd.fulfillCondition('fifth', fulfillment)
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should complain if transfer is given incorrect fulfillment', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        nerd.once('outgoing_prepare', (transfer, message) => {
          assert(transfer.id === 'sixth')
          resolve()
        })
      })
      nerd.send({
        id: 'sixth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)
      return p
    }).then(() => {
      let promise = new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'invalid fulfillment')
          resolve()
        })
      })
      nerd.fulfillCondition('sixth', 'garbage')
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should be able to prematurely reject transfer as nerd', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        nerd.once('incoming_prepare', (transfer, message) => {
          assert(transfer.id === 'seventh')
          resolve()
        })
      })
      noob.send({
        id: 'seventh',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)
      return p
    }).then(() => {
      let promise = Promise.all([
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
      nerd.rejectIncomingTransfer('seventh').catch(done)
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should be able to prematurely reject transfer as noob', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        noob.once('incoming_prepare', (transfer, message) => {
          assert(transfer.id === 'eighth')
          resolve()
        })
      })
      nerd.send({
        id: 'eighth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)
      return p
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
      noob.rejectIncomingTransfer('eighth').catch(done)
      return promise
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should not be able to reject outgoing transfer as noob', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        nerd.once('incoming_prepare', (transfer, message) => {
          assert(transfer.id === 'ninth')
          resolve()
        })
      })
      noob.send({
        id: 'ninth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)
      return p
    }).then(() => {
      return noob.rejectIncomingTransfer('ninth')
    }).catch((err) => {
      assert.equal(
        err.message,
        'transfer must be incoming'
      )
      done()
    }).catch(done)
  })

  it('should not be able to reject outgoing transfer as nerd', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        noob.once('incoming_prepare', (transfer, message) => {
          assert(transfer.id === 'tenth')
          resolve()
        })
      })
      nerd.send({
        id: 'tenth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      }).catch(done)
      return p
    }).then(() => {
      return nerd.rejectIncomingTransfer('tenth')
    }).catch((err) => {
      assert.equal(
        err.message,
        'transfer must be incoming'
      )
      done()
    }).catch(done)
  })

  it('should not be able to reject nonexistant transfer as noob', (done) => {
    next = next.then(() => {
      return noob.rejectIncomingTransfer('garbage')
    }).catch((err) => {
      assert.equal(
        err.message,
        'must be an existing transfer with a condition'
      )
      done()
    }).catch(done)
  })

  it('should not be able to reject nonexistant transfer as nerd', (done) => {
    next = next.then(() => {
      return noob.rejectIncomingTransfer('garbage')
    }).catch((err) => {
      assert.equal(
        err.message,
        'must be an existing transfer with a condition'
      )
      done()
    }).catch(done)
  })

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      nerd.disconnect()
      done()
    }).catch(done)
  })
})
