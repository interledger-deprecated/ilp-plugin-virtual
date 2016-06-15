'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const newObjStore = require('../src/model/objStore')
const log = require('../src/util/log')('test')

let nerd = null
let nerd2 = null
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
        }),
        new Promise((resolve) => {
          nerd.once('accept', (transfer, message) => {
            assert(transfer.id === 'fourth')
            resolve()
          })
        })
      ])
    }).then(() => {
      done()
    }).catch(handle)
  })

  it('should instantiate a second nerd', (done) => {
    next = next.then(() => {
      // objStore needs to be cloned manually because there isn't
      // a standard way to clone any store
      let objStore2 = nerd.store.clone()

      nerd2 = new PluginVirtual({
        store: objStore2,
        auth: {
          host: 'mqatt://test.mosquitto.org',
          token: 'aW50ZXJsZWdlcgo',
          limit: '1000',
          max: '1000',
          account: 'nerd2',
          secret: 'secret'
        }
      })

      // hacky way to make sure the balance doesn't start at zero
      nerd2.balance._initialized = true

      assert.isObject(nerd2)
    }).then(() => {
      return nerd2.connect()
    }).then(() => {
      done()
    }).catch(handle)
  })

  it('should hold hold the same balance between the two nerds', (done) => {
    let nerd1Balance = null
    next = next.then(() => {
      return nerd.getBalance()
    }).then((balance) => {
      nerd1Balance = balance
      return nerd2.getBalance()
    }).then((nerd2Balance) => {
      log.log('nerd: ' + nerd1Balance + '; nerd2: ' + nerd2Balance)
      assert(nerd1Balance === nerd2Balance)
      done()
    })
  })

  it('should getBalance with two nerds', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '190')
      done()
    }).catch(handle)
  })

  it('should send a transfer when there are two nerds', (done) => {
    next = next.then(() => {
      return nerd.send({
        id: 'fifth',
        account: 'x',
        amount: '100' 
      })
    }).then(() => {
      // currently, the expectation is that transactions from the nerd side
      // must be send out through all of the nerds
      return nerd2.send({
        id: 'fifth',
        account: 'x',
        amount: '100' 
      })
    }).then(() => {
      return Promise.all([
        new Promise((resolve) => {
          nerd.once('accept', (transfer, message) => {
            assert(transfer.id === 'fifth')
            resolve()
          })
        }),
        new Promise((resolve) => {
          nerd2.once('accept', (transfer, message) => {
            assert(transfer.id === 'fifth')
            resolve()
          })
        })
      ])
    }).then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '290')
      done()
    }).catch(handle)
  })

  it('should be able to send transfers when one nerd dies', (done) => {
    next = next.then(() => {
      return nerd.disconnect()
    }).then(() => {
      return noob2.send({
        id: 'sixth',
        account: 'x',
        amount: '40' 
      })
    }).then(() => {
      return new Promise((resolve) => {
        // the first noob will not receive the accept event for this, because it was
        // not in the state to receive an acknowledgement
        noob2.once('accept', (transfer, message) => {
          assert(transfer.id === 'sixth')
          resolve()
        })
      })
    }).then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '250')
      done()
    }).catch(handle)
  })

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      noob2.disconnect()
      nerd2.disconnect()
      done()
    }).catch(handle)
  }) 
})
