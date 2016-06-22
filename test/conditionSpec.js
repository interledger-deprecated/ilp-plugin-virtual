'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const newSqliteStore = require('./helpers/sqliteStore')
const log = require('../src/util/log')('test')
const cc = require('five-bells-condition')

let nerd = null
let noob = null
let handle = (err) => { log.log(err) }
let token = require('crypto').randomBytes(8).toString('hex')

describe('UTP/ATP Transactions with Nerd and Noob', function () {
  it('should create the nerd and the noob', () => {
    let objStore = newSqliteStore()
    nerd = new PluginVirtual({
      store: objStore,
      auth: {
        host: 'mqatt://test.mosquitto.org',
        token: token,
        limit: '1000',
        balance: '0',
        account: 'nerd',
        secret: 'secret'
      }
    })
    noob = new PluginVirtual({
      store: {},
      auth: {
        host: 'mqatt://test.mosquitto.org',
        token: token,
        account: 'noob'
      }
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
    }).catch(handle)
  })

  let fulfillment = 'cf:0:'
  let condition = cc.fulfillmentToCondition(fulfillment)

  it('should acknowledge a UTP transaction', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'first',
        account: 'x',
        amount: '100',
        executionCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('accept', (transfer, message) => {
          assert(transfer.id === 'first')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should not count escrowed money in balance yet', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '0')
      done()
    }).catch(handle)
  })

  it('should fulfill a UTP transaction as the noob', (done) => {
    next = next.then(() => {
      return noob.fulfillCondition('first', fulfillment)
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('fulfill_execution_condition', (transfer, fulfillment) => {
          assert(transfer.id === 'first')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should have the correct balance after executing', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '100')
      done()
    }).catch(handle)
  })

  it('should submit an ATP transaction as the noob', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'second',
        account: 'x',
        amount: '200',
        executionCondition: 'garbage',
        cancellationCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('accept', (transfer, message) => {
          assert(transfer.id === 'second')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should take escrowed balance out', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '-100')
      done()
    }).catch(handle)
  })

  it('should cancel an ATP transaction as the noob', (done) => {
    next = next.then(() => {
      return noob.fulfillCondition('second', fulfillment)
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('fulfill_cancellation_condition', (transfer, fulfillment) => {
          assert(transfer.id === 'second')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should give back escrowed funds after cancellation', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '100')
      done()
    }).catch(handle)
  })

  it('should cancel an ATP transaction as the nerd', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'cancelthis',
        account: 'x',
        amount: '200',
        executionCondition: 'garbage',
        cancellationCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('accept', (transfer, message) => {
          assert(transfer.id === 'cancelthis')
          resolve()
        })
      })
    }).then(() => {
      let promise = new Promise((resolve) => {
        noob.once('fulfill_cancellation_condition', (transfer, fulfillment) => {
          assert(transfer.id === 'cancelthis')
          resolve()
        })
      })
      nerd.fulfillCondition('cancelthis', fulfillment)
      return promise
    }).then(() => {
      done()
    })
  })

  it('should support UTP transfers with time limits', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'time_out',
        account: 'x',
        amount: '200',
        executionCondition: condition,
        expiresAt: (new Date()).toString()
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('fulfill_cancellation_condition', (transfer, message) => {
          assert(transfer.id === 'time_out')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should complete a UTP transfer with a time limit', (done) => {
    next = next.then(() => {
      let time = new Date()
      time.setSeconds(time.getSeconds() + 2)

      return noob.send({
        id: 'time_complete',
        account: 'x',
        amount: '200',
        executionCondition: condition,
        expiresAt: time.toString()
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('accept', (transfer, message) => {
          assert(transfer.id === 'time_complete')
          resolve()
        })
      })
    }).then(() => {
      let promise = new Promise((resolve) => {
        noob.once('fulfill_execution_condition', (transfer, fulfill) => {
          assert(transfer.id === 'time_complete')
          resolve()
        })
      })
      nerd.fulfillCondition('time_complete', fulfillment)
      return promise
    }).then(() => {
      done()
    }).catch((err) => { console.error(err) })
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
      return new Promise((resolve) => {
        nerd.once('accept', (transfer, message) => {
          assert(transfer.id === 'third')
          resolve()
        })
      })
    }).then(() => {
      return nerd.fulfillCondition('third', fulfillment)
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('fulfill_execution_condition', (transfer, message) => {
          assert(transfer.id === 'third')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
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
    })
  })

  it('should be able to execute a transfer noob -> nerd', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'fourth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('accept', (transfer, message) => {
          assert(transfer.id === 'fourth')
          resolve()
        })
      })
    }).then(() => {
      return noob.fulfillCondition('fourth', fulfillment)
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('fulfill_execution_condition', (transfer, message) => {
          assert(transfer.id === 'fourth')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
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
    })
  })

  it('should complain when an OTP transfer is fulfilled', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'fifth',
        account: 'x',
        amount: '10'
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('accept', (transfer, message) => {
          assert(transfer.id === 'fifth')
          resolve()
        })
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
    }).then(() => {
      done()
    })
  })

  it('should complain if transfer is given incorrect fulfillment', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'sixth',
        account: 'x',
        amount: '100',
        executionCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('accept', (transfer, message) => {
          assert(transfer.id === 'sixth')
          resolve()
        })
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
    }).then(() => {
      done()
    })
  })

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      nerd.disconnect()
      done()
    }).catch(handle)
  })
})
