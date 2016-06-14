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

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      nerd.disconnect()
      done()
    }).catch(handle)
  }) 
})
