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
const uuid = require('uuid')

const base64url = require('base64url')
const token = base64url(JSON.stringify({
  channel: require('crypto').randomBytes(8).toString('hex'),
  host: 'mqtt://test.mosquitto.org'
}))

let nerd = null
let noob = null

describe('Conditional transfers with Nerd and Noob', function () {
  it('should create the nerd and the noob', () => {
    mockRequire('mqtt', null)
    let objStore = newSqliteStore()
    nerd = new PluginVirtual({
      _store: objStore,
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
      nerd.once('outgoing_prepare', (transfer) => {
        assert(transfer.id === 'first')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    })

    nerd.sendTransfer({
      id: 'first',
      account: 'noob',
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

  it('should not be able to reject fulfilled transfer as noob', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      nerd.once('outgoing_prepare', (transfer) => {
        assert(transfer.id === uid)
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })

      nerd.sendTransfer({
        id: uid,
        account: 'noob',
        amount: '100',
        executionCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        noob.once('incoming_fulfill', (transfer, fulfillment) => {
          assert(transfer.id === uid)
          assert(transfer.ledger === 'test.nerd.')
          resolve()
        })

        noob.fulfillCondition(uid, fulfillment)
      })
    }).then(() => {
      return noob.rejectIncomingTransfer(uid).then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'AlreadyFulfilledError')
      })
    })
  })

  it('should not be able to reject fulfilled transfer as nerd', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      noob.once('outgoing_prepare', (transfer) => {
        assert(transfer.id === uid)
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })

      noob.sendTransfer({
        id: uid,
        account: 'nerd',
        amount: '100',
        executionCondition: condition
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.once('incoming_fulfill', (transfer, fulfillment) => {
          assert(transfer.id === uid)
          assert(transfer.ledger === 'test.nerd.')
          resolve()
        })

        nerd.fulfillCondition(uid, fulfillment)
      })
    }).then(() => {
      return nerd.rejectIncomingTransfer(uid).then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'AlreadyFulfilledError')
      })
    })
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
        noob.getFulfillment('garbage').catch((e) => {
          assert.equal(e.name, 'TransferNotFoundError')
          resolve()
        })
      }),
      new Promise((resolve) => {
        nerd.getFulfillment('garbage').catch((e) => {
          assert.equal(e.name, 'TransferNotFoundError')
          resolve()
        })
      })
    ])
  })

  it('should return error from getFulfillment of optimistic transfer as nerd', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      noob.on('outgoing_transfer', () => {
        resolve()
      })

      noob.sendTransfer({
        id: uid,
        amount: '1',
        account: 'nerd'
      })
    }).then(() => {
      return nerd.getFulfillment(uid).then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'TransferNotConditionalError')
      })
    })
  })

  it('should return error from getFulfillment of optimistic transfer as noob', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      nerd.on('outgoing_transfer', () => {
        resolve()
      })

      nerd.sendTransfer({
        id: uid,
        amount: '1',
        account: 'noob'
      })
    }).then(() => {
      return noob.getFulfillment(uid).then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'TransferNotConditionalError')
      })
    })
  })

  it('should return MissingFulfillmentError from prepared transfer', () => {
    const p = new Promise((resolve) => {
      nerd.once('outgoing_prepare', (transfer) => {
        assert(transfer.id === 'prepared')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    }).then(() => {
      return Promise.all([
        new Promise((resolve) => {
          noob.getFulfillment('prepared').catch((e) => {
            assert.equal(e.name, 'MissingFulfillmentError')
            resolve()
          })
        }),
        new Promise((resolve) => {
          nerd.getFulfillment('prepared').catch((e) => {
            assert.equal(e.name, 'MissingFulfillmentError')
            resolve()
          })
        })
      ])
    })

    nerd.sendTransfer({
      id: 'prepared',
      account: 'noob',
      amount: '100',
      executionCondition: condition
    })

    return p
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

    noob.sendTransfer({
      id: 'time_out',
      account: 'noob',
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

    nerd.sendTransfer({
      id: 'time_out_3',
      account: 'noob',
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

    return noob.sendTransfer({
      id: 'time_out_2',
      account: 'nerd',
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

    noob.sendTransfer({
      id: 'time_complete',
      account: 'nerd',
      amount: '200',
      executionCondition: condition,
      expiresAt: time.toString()
    })

    return p
  })

  it('should submit a UTP transaction as the nerd', () => {
    return nerd.sendTransfer({
      id: 'third',
      account: 'noob',
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

  it('should complain on fulfilling an optimistic transfer from noob', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      noob.on('outgoing_transfer', () => {
        resolve()
      })

      noob.sendTransfer({
        id: uid,
        amount: '1',
        account: 'nerd'
      })
    }).then(() => {
      return nerd.fulfillCondition(uid, 'cf:0:abc').then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'TransferNotConditionalError')
      })
    })
  })

  it('should complain on fulfilling an optimistic transfer from nerd', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      nerd.on('outgoing_transfer', () => {
        resolve()
      })

      nerd.sendTransfer({
        id: uid,
        amount: '1',
        account: 'noob'
      })
    }).then(() => {
      return noob.fulfillCondition(uid, 'cf:0:abc').then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'TransferNotConditionalError')
      })
    })
  })

  it('should complain on fulfilling a nonexistant transfer', () => {
    return new Promise((resolve) => {
      nerd.fulfillCondition('nonexistant', 'garbage').catch((e) => {
        assert.equal(e.name, 'TransferNotFoundError')
        resolve()
      })
    })
  })

  it('should complain on fulfilling a malformed transfer', () => {
    return new Promise((resolve) => {
      nerd.fulfillCondition('first', 'garbage').catch((e) => {
        assert.equal(e.name, 'InvalidFieldsError')
        resolve()
      })
    })
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

    noob.sendTransfer({
      id: 'fourth',
      account: 'nerd',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should complain on fulfilling an transfer twice', () => {
    return new Promise((resolve) => {
      nerd.fulfillCondition('first', fulfillment).then(() => {
        resolve()
      })
    })
  })

  it('should complain if transfer is given incorrect fulfillment', () => {
    const p = new Promise((resolve) => {
      nerd.once('outgoing_prepare', (transfer, message) => {
        assert(transfer.id === 'sixth')
        resolve()
      })
    }).then(() => {
      return new Promise((resolve) => {
        nerd.fulfillCondition('sixth', 'cf:0:abc').catch((e) => {
          assert(e.name === 'NotAcceptedError')
          resolve()
        })
      })
    })

    nerd.sendTransfer({
      id: 'sixth',
      account: 'noob',
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
          nerd.once('incoming_reject', (transfer) => {
            assert(transfer.id === 'seventh')
            resolve()
          })
        }),
        new Promise((resolve) => {
          noob.once('outgoing_reject', (transfer) => {
            assert(transfer.id === 'seventh')
            resolve()
          })
        })
      ])
      nerd.rejectIncomingTransfer('seventh').catch()
      return promise
    })

    noob.sendTransfer({
      id: 'seventh',
      account: 'nerd',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should be unable to fulfill a rejected transfer', () => {
    return nerd.fulfillCondition('seventh', fulfillment)
      .then(() => {
        assert(false)
      })
      .catch((e) => {
        assert.equal(e.name, 'AlreadyRolledBackError')
      })
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
            assert.equal(transfer.id, 'eighth')
            resolve()
          })
        }),
        new Promise((resolve) => {
          nerd.once('outgoing_reject', (transfer, msg) => {
            assert.equal(transfer.id, 'eighth')
            resolve()
          })
        })
      ])
      noob.rejectIncomingTransfer('eighth')
      return promise
    })

    nerd.sendTransfer({
      id: 'eighth',
      account: 'noob',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should not recover the fulfillment from a rejected transfer', () => {
    return Promise.all([
      noob.getFulfillment('eighth').then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'AlreadyRolledBackError')
      }),
      nerd.getFulfillment('eighth').then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'AlreadyRolledBackError')
      })
    ])
  })

  it('should be able to reject transfer twice as nerd', () => {
    return nerd.rejectIncomingTransfer('seventh')
  })

  it('should be able to reject transfer twice as noob', () => {
    return noob.rejectIncomingTransfer('eighth')
  })

  it('should not be able to reject nonexistant transfer as noob', () => {
    return noob.rejectIncomingTransfer('nonexistant').then(() => {
      assert(false)
    }).catch((err) => {
      assert.equal(err.name, 'TransferNotFoundError')
    })
  })

  it('should not be able to reject nonexistant transfer as nerd', () => {
    return nerd.rejectIncomingTransfer('nonexistant').then(() => {
      assert(false)
    }).catch((err) => {
      assert.equal(err.name, 'TransferNotFoundError')
    })
  })

  it('should not be able to reject outgoing transfer as noob', () => {
    const p = new Promise((resolve) => {
      nerd.once('incoming_prepare', (transfer, message) => {
        assert(transfer.id === 'ninth')
        resolve()
      })
    }).then(() => {
      return noob.rejectIncomingTransfer('ninth')
    }).then(() => {
      assert(false)
    }).catch((err) => {
      assert.equal(
        err.name,
        'NotAcceptedError'
      )
    })

    noob.sendTransfer({
      id: 'ninth',
      account: 'nerd',
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
    }).then(() => {
      assert(false)
    }).catch((err) => {
      assert.equal(
        err.name,
        'NotAcceptedError'
      )
    })

    nerd.sendTransfer({
      id: 'tenth',
      account: 'noob',
      amount: '100',
      executionCondition: condition
    })

    return p
  })

  it('should not be able to reject nonexistant transfer as noob', () => {
    return noob.rejectIncomingTransfer('garbage').catch((err) => {
      assert.equal(
        err.name,
        'TransferNotFoundError'
      )
    })
  })

  it('should not be able to reject nonexistant transfer as nerd', () => {
    return noob.rejectIncomingTransfer('garbage').catch((err) => {
      assert.equal(
        err.name,
        'TransferNotFoundError'
      )
    })
  })

  it('should complain on rejecting optimistic transfer from noob', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      noob.on('outgoing_transfer', () => {
        resolve()
      })

      noob.sendTransfer({
        id: uid,
        amount: '1',
        account: 'nerd'
      })
    }).then(() => {
      return nerd.rejectIncomingTransfer(uid, 'cf:0:abc').then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'TransferNotConditionalError')
      })
    })
  })

  it('should complain on rejecting optimistic transfer from noob', () => {
    const uid = uuid()

    return new Promise((resolve) => {
      nerd.on('outgoing_transfer', () => {
        resolve()
      })

      nerd.sendTransfer({
        id: uid,
        amount: '1',
        account: 'noob'
      })
    }).then(() => {
      return noob.rejectIncomingTransfer(uid, 'cf:0:abc').then(() => {
        assert(false)
      }).catch((e) => {
        assert.equal(e.name, 'TransferNotConditionalError')
      })
    })
  })

  it('should disconnect gracefully', () => {
    return Promise.all([
      noob.disconnect(),
      nerd.disconnect()
    ])
  })
})
