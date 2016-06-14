'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const newObjStore = require('../src/model/objStore')
const log = require('../src/util/log')('test')

let nerd = null
let noob = null
let noob2 = null
let handle = (err) => { log.log(err) }

describe('The Noob and the Nerd', function () {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })

  it('should instantiate the nerd', () => {
    let objStore = newObjStore()
    nerd = new PluginVirtual({
      store: objStore,
      auth: {
        host: 'mqatt://test.mosquitto.org',
        token: 'aW50ZXJsZWdlcgo',
        limit: '1000',
        max: '1000',
        account: 'nerd',
        secret: 'secret'
      }
    })
    assert.isObject(nerd)
  })
  
  it('should instantiate the noob', () => {
    noob = new PluginVirtual({
      store: {},
      auth: {
        host: 'mqatt://test.mosquitto.org',
        token: 'aW50ZXJsZWdlcgo',
        account: 'noob',
      }
    })
    assert.isObject(noob)
  })

  let next = null
  it('should connect to the mosquitto server', (done) => {
    next = Promise.all([
      noob.connect(),
      nerd.connect()
    ]).then(() => {
      done()
    }).catch(handle)
  })

  it('should have a zero balance at the start', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '0')
      done()
    }).catch(handle)
  })

  it('should acknowledge a valid transfer noob -> nerd', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'first',
        account: 'x',
        amount: '10' 
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('accept', (transfer, message) => {
          assert(transfer.id === 'first')
          done()
          resolve()
        })
      })
    }).catch(handle)
  })

  it('should represent the right balance after a sent transfer', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '-10')
      done()
    })
  })

  it('should reject a transfer that puts the balance under limit', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'second',
        account: 'x',
        amount: '1000' 
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('reject', (transfer, message) => {
          assert(transfer.id === 'second')
          done()
          resolve()
        })
      })
    }).catch(handle)
  })

  it('should add balance when nerd sends money to noob', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'third',
        account: 'x',
        amount: '100' 
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('accept', (transfer, message) => {
          assert(transfer.id === 'third')
          resolve()
        })
      })
    }).then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '90')
      done()
    })
  })

  it('should create a second noob', (done) => {
    next = next.then(() => {
      noob2 = new PluginVirtual({
        store: {},
        auth: {
          host: 'mqatt://test.mosquitto.org',
          token: 'aW50ZXJsZWdlcgo',
          account: 'noob2',
        }
      })
      assert.isObject(noob2)
    }).then(() => {
      noob2.connect()
      return new Promise((resolve) => {
        noob2.once('connect', () => {
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should have the same balance for both noobs', (done) => {
    next = next.then(() => {
      return noob2.getBalance()
    }).then((balance) => {
      assert(balance === '90')
      done()
    })
  })

  it('should notify both noobs on a received transfer', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'fourth',
        account: 'x',
        amount: '100' 
      })
    }).then(() => {
      return Promise.all([
        new Promise((resolve) => {
          noob.once('receive', (transfer, message) => {
            assert(transfer.id === 'fourth')
            resolve()
          })
        }),
        new Promise((resolve) => {
          noob2.once('receive', (transfer, message) => {
            assert(transfer.id === 'fourth')
            resolve()
          })
        })
      ])
    }).then(() => {
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
