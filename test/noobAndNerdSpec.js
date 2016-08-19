'use strict'

const mockRequire = require('mock-require')
const mock = require('./mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire('../src/model/connection', MockConnection)

const PluginVirtual = require('..')
const assert = require('chai').assert
const newObjStore = require('./helpers/objStore')

let nerd = null
let noob = null
let noob2 = null
let token = require('crypto').randomBytes(8).toString('hex')
let store1 = newObjStore()

describe('The Noob and the Nerd', function () {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })

  it('should throw if the nerd doesn\'t get a prefix', function () {
    assert.throws(() => {
      return new PluginVirtual({
        _store: store1,
        host: 'mqtt://test.mosquitto.org',
        token: token,
        initialBalance: '0',
        maxBalance: '2000',
        minBalance: '-1000',
        settleIfUnder: '-1000',
        settleIfOver: '2000',
        account: 'nerd',
        secret: 'secret'
      })
    }, 'Expected opts.prefix to be a string, received: undefined')
  })

  it('should instantiate the nerd', () => {
    nerd = new PluginVirtual({
      _store: store1,
      host: 'mqtt://test.mosquitto.org',
      prefix: 'test.nerd.',
      token: token,
      initialBalance: '0',
      maxBalance: '2000',
      minBalance: '-1000',
      settleIfUnder: '-1000',
      settleIfOver: '2000',
      account: 'nerd',
      mockChannels: MockChannels,
      secret: 'secret'
    })
    assert.isObject(nerd)
  })

  it('should run getAccount for compatability reasons', () => {
    assert(nerd.getAccount() === 'nerd')
  })

  it('should instantiate the noob', () => {
    noob = new PluginVirtual({
      _store: {},
      host: 'mqtt://test.mosquitto.org',
      token: token,
      mockChannels: MockChannels,
      account: 'noob'
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
    }).catch(done)
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
    }).catch(done)
  })

  it('should getInfo() without errors', (done) => {
    next = next.then(() => {
      noob.getInfo()
      nerd.getInfo()
      done()
    }).catch(done)
  })

  it('should getConnectors() without errors', (done) => {
    next = next.then(() => {
      noob.getConnectors()
      nerd.getConnectors()
      done()
    }).catch(done)
  })

  it('should keep track of whether it`s connected', (done) => {
    next = next.then(() => {
      assert(noob.isConnected())
      assert(nerd.isConnected())
      done()
    }).catch(done)
  })

  it('should acknowledge a valid transfer noob -> nerd', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        noob.once('outgoing_transfer', (transfer, message) => {
          assert(transfer.id === 'first')
          assert(transfer.ledger === 'test.nerd.')
          done()
          resolve()
        })
      }).catch(done)

      noob.send({
        id: 'first',
        account: 'x',
        amount: '10'
      })

      return p
    }).catch(done)
  })

  it('should represent the right balance after a sent transfer', (done) => {
    next = next.then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '-10')
      done()
    }).catch(done)
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
    }).catch(done)
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
    }).catch(done)
  })

  it('should add balance when nerd sends money to noob', (done) => {
    next = next.then(() => {
      const p = new Promise((resolve) => {
        nerd.once('outgoing_transfer', (transfer, message) => {
          assert(transfer.id === 'third')
          assert(transfer.ledger === 'test.nerd.')
          resolve()
        })
      }).catch(done)

      nerd.send({
        id: 'third',
        account: 'x',
        amount: '100'
      }).catch(done)

      return p
    }).then(() => {
    }).then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '90')
      done()
    }).catch(done)
  })

  it('should create a second noob', (done) => {
    next = next.then(() => {
      noob2 = new PluginVirtual({
        _store: {},
        host: 'mqtt://test.mosquitto.org',
        token: token,
        mockChannels: MockChannels,
        account: 'noob2'
      })
      assert.isObject(noob2)
    }).then(() => {
      return new Promise((resolve) => {
        noob2.once('connect', () => {
          resolve()
        })
        noob2.connect()
      })
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should have the same balance for both noobs', (done) => {
    next = next.then(() => {
      return noob2.getBalance()
    }).then((balance) => {
      assert(balance === '90')
      done()
    }).catch(done)
  })

  it('should notify both noobs on a received transfer', (done) => {
    next = next.then(() => {
      const p = Promise.all([
        new Promise((resolve) => {
          noob.once('incoming_transfer', (transfer, message) => {
            assert(transfer.id === 'fourth')
            assert(transfer.ledger === 'test.nerd.')
            resolve()
          })
        }),
        new Promise((resolve) => {
          noob2.once('incoming_transfer', (transfer, message) => {
            assert(transfer.id === 'fourth')
            assert(transfer.ledger === 'test.nerd.')
            resolve()
          })
        }),
        new Promise((resolve) => {
          nerd.once('outgoing_transfer', (transfer, message) => {
            assert(transfer.id === 'fourth')
            assert(transfer.ledger === 'test.nerd.')
            resolve()
          })
        })
      ]).catch(done)

      nerd.send({
        id: 'fourth',
        account: 'x',
        amount: '100'
      }).catch(done)

      return p
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should send a reply from noob -> nerd', (done) => {
    next = next.then(() => {
      noob.replyToTransfer('second', 'I have a message')
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('reply', (transfer, message) => {
          assert(transfer.id === 'second')
          assert(transfer.ledger === 'test.nerd.')
          assert(message.toString() === 'I have a message')
          resolve()
        })
      })
    }).then(() => {
      done()
    }).catch(done)
  })

  it('should send a reply from nerd -> noob', (done) => {
    next = next.then(() => {
      nerd.replyToTransfer('fourth', 'I have a message too')
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('reply', (transfer, message) => {
          assert(transfer.id === 'fourth')
          assert(transfer.ledger === 'test.nerd.')
          assert(message.toString() === 'I have a message too')
          resolve()
        })
      })
    }).then(() => {
      done()
    }).catch(done)
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
    }).catch(done)
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
    }).catch(done)
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
    }).catch(done)
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
    }).catch(done)
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
    }).catch(done)
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
    }).catch(done)
  })

  it('should hold same balance when nerd is made with old db', (done) => {
    next = next.then(() => {
      let tmpNerd = new PluginVirtual({
        _store: store1,
        host: 'mqatt://test.mosquitto.org',
        token: token,
        initialBalance: '0',
        maxBalance: '2000',
        minBalance: '-1000',
        settleIfUnder: '-1000',
        settleIfOver: '2000',
        account: 'nerd',
        prefix: 'test.tmpNerd.',
        mockChannels: MockChannels,
        secret: 'secret'
      })
      return tmpNerd.getBalance()
    }).then((balance) => {
      assert(balance !== '0')
      done()
    }).catch(done)
  })

  it('should disconnect gracefully', (done) => {
    next.then(() => {
      noob.disconnect()
      noob2.disconnect()
      nerd.disconnect()
      done()
    }).catch(done)
  })
})
