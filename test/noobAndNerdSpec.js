'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const newObjStore = require('./helpers/objStore')
const log = require('../src/util/log')('test')

let nerd = null
let noob = null
let noob2 = null
let handle = (err) => { log.log(err) }
let token = require('crypto').randomBytes(8).toString('hex')
let store1 = newObjStore()

describe('The Noob and the Nerd', function () {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })

  it('should instantiate the nerd', () => {
    nerd = new PluginVirtual({
      store: store1,
      auth: {
        host: 'mqtt://test.mosquitto.org',
        token: token,
        limit: '1000',
        balance: '0',
        account: 'nerd',
        secret: 'secret'
      }
    })
    assert.isObject(nerd)
  })

  it('should run getAccount for compatability reasons', () => {
    assert(nerd.getAccount() === 'nerd')
  })

  it('should instantiate the noob', () => {
    noob = new PluginVirtual({
      store: {},
      auth: {
        host: 'mqtt://test.mosquitto.org',
        token: token,
        account: 'noob'
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

  it('should be able to log errors in the connection', (done) => {
    next = next.then(() => {
      noob.connection._handle('fake error!')
      done()
    })
  })

  it('should have a zero balance at the start', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '0')
      done()
    }).catch(handle)
  })

  it('should getInfo() without errors', (done) => {
    next = next.then(() => {
      noob.getInfo()
      nerd.getInfo()
      done()
    })
  })

  it('should getConnectors() without errors', (done) => {
    next = next.then(() => {
      noob.getConnectors()
      nerd.getConnectors()
      done()
    })
  })

  it('should keep track of whether it`s connected', (done) => {
    next = next.then(() => {
      assert(noob.isConnected())
      assert(nerd.isConnected())
      done()
    })
  })

  it('should acknowledge a valid transfer noob -> nerd', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        noob.once('outgoing_transfer', (transfer, message) => {
          assert(transfer.id === 'first')
          done()
          resolve()
        })
      })

      noob.send({
        id: 'first',
        account: 'x',
        amount: '10'
      })

      return p
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
      }).catch(() => {
        done()
      })
    })
  })

  it('should trigger settlement when balance under limit', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        noob.once('settlement', (balance) => {
          done()
          resolve()
        })
      })

      noob.send({
        id: 'secondish',
        account: 'x',
        amount: '1000'
      })

      return p
    }).catch(handle)
  })

  it('should add balance when nerd sends money to noob', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        nerd.once('outgoing_transfer', (transfer, message) => {
          assert(transfer.id === 'third')
          resolve()
        })
      })

      nerd.send({
        id: 'third',
        account: 'x',
        amount: '100'
      })

      return p
    }).then(() => {
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
          host: 'mqtt://test.mosquitto.org',
          token: token,
          account: 'noob2'
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
      const p = Promise.all([
        new Promise((resolve) => {
          noob.once('incoming_transfer', (transfer, message) => {
            assert(transfer.id === 'fourth')
            resolve()
          })
        }),
        new Promise((resolve) => {
          noob2.once('incoming_transfer', (transfer, message) => {
            assert(transfer.id === 'fourth')
            resolve()
          })
        }),
        new Promise((resolve) => {
          nerd.once('outgoing_transfer', (transfer, message) => {
            assert(transfer.id === 'fourth')
            resolve()
          })
        })
      ])

      nerd.send({
        id: 'fourth',
        account: 'x',
        amount: '100'
      })

      return p
    }).then(() => {
      done()
    }).catch(handle)
  })

  it('should send a reply from noob -> nerd', (done) => {
    next = next.then(() => {
      noob.replyToTransfer('second', 'I have a message')
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('reply', (transfer, message) => {
          assert(transfer.id === 'second')
          assert(message.toString() === 'I have a message')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should send a reply from nerd -> noob', (done) => {
    next = next.then(() => {
      nerd.replyToTransfer('fourth', 'I have a message too')
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('reply', (transfer, message) => {
          assert(transfer.id === 'fourth')
          assert(message.toString() === 'I have a message too')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should reject a false acknowledge from the noob', (done) => {
    next = next.then(() => {
      return noob.connection.send({
        type: 'acknowledge',
        transfer: {id: 'fake'},
        message: 'fake acknowledge'
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('_falseAcknowledge', (transfer) => {
          assert(transfer.id === 'fake')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should reject a repeat transfer from the noob', (done) => {
    next = next.then(() => {
      return noob.send({
        id: 'first',
        amount: '100',
        account: 'x'
      }).catch(() => {
        done()
      })
    })
  })

  it('should emit false reject if a fake transfer is rejected', (done) => {
    next = next.then(() => {
      return noob.connection.send({
        type: 'reject',
        transfer: {id: 'notreal'},
        message: 'fake reject'
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('_falseReject', (transfer) => {
          assert(transfer.id === 'notreal')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should not give an error if a real transfer is rejected', (done) => {
  // it's harmless to complete a transfer that is already completed if
  // the reject is to a completed transfer.
    next = next.then(() => {
      return noob.connection.send({
        type: 'reject',
        transfer: {id: 'first'},
        message: 'late reject'
      })
    }).then(() => {
      done()
    })
  })

  it('should give error if the noob sends invalid message type', (done) => {
    next = next.then(() => {
      return noob.connection.send({
        type: 'garbage'
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('exception', (err) => {
          assert(err.message === 'Invalid message received')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should give error if the nerd sends invalid message type', (done) => {
    next = next.then(() => {
      return nerd.connection.send({
        type: 'garbage'
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('exception', (err) => {
          assert(err.message === 'Invalid message received')
          resolve()
        })
      })
    }).then(() => {
      done()
    })
  })

  it('should hold same balance when nerd is made with old db', (done) => {
    next = next.then(() => {
      let tmpNerd = new PluginVirtual({
        store: store1,
        auth: {
          host: 'mqatt://test.mosquitto.org',
          token: token,
          limit: '1000',
          balance: '0',
          account: 'nerd',
          secret: 'secret'
        }
      })
      return tmpNerd.getBalance()
    }).then((balance) => {
      assert(balance !== '0')
      done()
    })
  })

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      noob2.disconnect()
      nerd.disconnect()
      done()
    }).catch(handle)
  })
})
