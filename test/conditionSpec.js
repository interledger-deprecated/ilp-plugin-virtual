'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const newObjStore = require('../src/model/objStore')
const log = require('../src/util/log')('test')
const cc = require('five-bells-condition')

let nerd = null
let noob = null
let handle = (err) => { log.log(err) }

describe('UTP/ATP Transactions with Nerd and Noob', function () {
  it('should create the nerd and the noob', () => {
    let objStore = newObjStore()
    nerd = new PluginVirtual({
      store: objStore,
      auth: {
        host: 'mqatt://test.mosquitto.org',
        token: 'Y29uZGl0aW9uCg',
        limit: '1000',
        max: '1000',
        account: 'nerd',
        secret: 'secret'
      }
    })
    noob = new PluginVirtual({
      store: {},
      auth: {
        host: 'mqatt://test.mosquitto.org',
        token: 'Y29uZGl0aW9uCg',
        account: 'noob',
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

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      nerd.disconnect()
      done()
    }).catch(handle)
  }) 
})
