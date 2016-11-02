'use strict'

const mockRequire = require('mock-require')
const mock = require('./mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire('../src/model/connection', MockConnection)

const sinon = require('sinon')
const PluginVirtual = require('..')
const assert = require('chai').assert
const newObjStore = require('./helpers/objStore')

const base64url = require('base64url')
const token = base64url(JSON.stringify({
  channel: require('crypto').randomBytes(8).toString('hex'),
  host: 'mqtt://test.mosquitto.org'
}))

let nerd = null
let noob = null
let noob2 = null
let store1 = newObjStore()

describe('The Noob and the Nerd', function () {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })

  it('should throw if the nerd doesn\'t get a prefix', function () {
    assert.throws(() => {
      return new PluginVirtual({
        _store: store1,
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

  it('should instantiate the nerd with token as object', () => {
    const tmpNerd = new PluginVirtual({
      _store: store1,
      prefix: 'test.nerd.',
      token: {
        channel: require('crypto').randomBytes(8).toString('hex'),
        host: 'mqtt://test.mosquitto.org'
      },
      initialBalance: '0',
      maxBalance: '2000',
      minBalance: '-1000',
      settleIfUnder: '-1000',
      settleIfOver: '2000',
      account: 'nerd',
      mockChannels: MockChannels,
      secret: 'secret'
    })
    assert.isObject(tmpNerd)
  })

  it('should instantiate the noob', () => {
    noob = new PluginVirtual({
      _store: {},
      token: token,
      mockChannels: MockChannels,
      account: 'noob'
    })
    assert.isObject(noob)
  })

  it('should connect to the mosquitto server', () => {
    return Promise.all([
      noob.connect(),
      nerd.connect()
    ])
  })

  it('should be able to log errors in the connection', () => {
    noob.connection._handle('fake error!')
  })

  it('should have a zero balance at the start', () => {
    return noob.getBalance().then((balance) => {
      assert(balance === '0')
    })
  })

  it('should getInfo() without errors', () => {
    return Promise.all([
      noob.getInfo(),
      nerd.getInfo()
    ])
  })

  it('should run getAccount', () => {
    return Promise.all([
      nerd.getAccount().then((account) => {
        assert(account === 'test.nerd.nerd')
      }),
      noob.getAccount().then((account) => {
        assert(account === 'test.nerd.noob')
      })
    ])
  })

  it('should getConnectors() without errors', () => {
    noob.getConnectors()
    nerd.getConnectors()
  })

  it('should keep track of whether it`s connected', () => {
    assert(noob.isConnected())
    assert(nerd.isConnected())
  })

  it('should acknowledge a valid transfer noob -> nerd', () => {
    const p = new Promise((resolve) => {
      noob.once('outgoing_transfer', (transfer, message) => {
        assert(transfer.id === 'first')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    })

    noob.sendTransfer({
      id: 'first',
      account: 'nerd',
      amount: '10'
    })

    return p
  })

  it('should represent the right balance after a sent transfer', () => {
    return noob.getBalance().then((balance) => {
      assert(balance === '-10')
    })
  })

  it('should reject a transfer that puts the balance under limit', () => {
    return noob.sendTransfer({
      id: 'second',
      account: 'nerd',
      amount: '1000'
    }).catch((e) => {
      assert(e)
    })
  })

  it('should reject a transfer with an invalid amount (noob)', () => {
    return noob.sendTransfer({
      id: 'invalid_amount',
      account: 'nerd',
      amount: 'garbage'
    }).then(() => {
      assert(false)
    }).catch((e) => {
      assert.equal(e.name, 'InvalidFieldsError')
    })
  })

  it('should reject a transfer where the amount is non-number JSON', () => {
    return noob.sendTransfer({
      id: 'another_invalid_amount',
      account: 'nerd',
      amount: '{}'
    }).then(() => {
      assert(false)
    }).catch((e) => {
      assert.equal(e.name, 'InvalidFieldsError')
    })
  })

  it('should reject a transfer with an invalid amount (nerd)', () => {
    return nerd.sendTransfer({
      id: 'invalid_amount_2',
      account: 'noob',
      amount: 'garbage'
    }).then(() => {
      assert(false)
    }).catch((e) => {
      assert.equal(e.name, 'InvalidFieldsError')
    })
  })

  it('should add balance when nerd sends money to noob', () => {
    const p = new Promise((resolve) => {
      nerd.once('outgoing_transfer', (transfer, message) => {
        assert(transfer.id === 'third')
        assert(transfer.ledger === 'test.nerd.')
        resolve()
      })
    }).then(() => {
      return noob.getBalance()
    }).then((balance) => {
      assert(balance === '90')
    })

    nerd.sendTransfer({
      id: 'third',
      account: 'noob',
      amount: '100'
    })

    return p
  })

  it('should create a second noob', () => {
    noob2 = new PluginVirtual({
      _store: {},
      token: token,
      mockChannels: MockChannels,
      account: 'noob2'
    })
    assert.isObject(noob2)

    return new Promise((resolve) => {
      noob2.once('connect', () => {
        resolve()
      })
      noob2.connect()
    })
  })

  it('should have the same balance for both noobs', () => {
    return noob2.getBalance().then((balance) => {
      assert(balance === '90')
    })
  })

  it('should notify both noobs on a received transfer', () => {
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
    ])

    nerd.sendTransfer({
      id: 'fourth',
      account: 'noob',
      amount: '100'
    })

    return p
  })

  it('should send a reply from noob -> nerd', () => {
    const p = new Promise((resolve) => {
      nerd.once('reply', (transfer, message) => {
        assert(transfer.id === 'second')
        assert(transfer.ledger === 'test.nerd.')
        assert(message.toString() === 'I have a message')
        resolve()
      })
    })

    noob.replyToTransfer('second', 'I have a message')

    return p
  })

  it('should send a reply from nerd -> noob', () => {
    const p = new Promise((resolve) => {
      noob.once('reply', (transfer, message) => {
        assert(transfer.id === 'fourth')
        assert(transfer.ledger === 'test.nerd.')
        assert(message.toString() === 'I have a message too')
        resolve()
      })
    })

    nerd.replyToTransfer('fourth', 'I have a message too')

    return p
  })

  it('should error replying to nonexistant transfer (noob)', () => {
    return noob.replyToTransfer('nonexistant', 'another message').then(() => {
      assert(false)
    }).catch((e) => {
      assert.equal(e.name, 'TransferNotFoundError')
    })
  })

  it('should error replying to nonexistant transfer (nerd)', () => {
    return nerd.replyToTransfer('nonexistant', 'another message').then(() => {
      assert(false)
    }).catch((e) => {
      assert.equal(e.name, 'TransferNotFoundError')
    })
  })

  it('should not complain on a repeat transfer from the noob', () => {
    return noob.sendTransfer({
      id: 'first',
      amount: '10',
      account: 'nerd'
    })
  })

  it('should not complain on a repeat transfer from the nerd', () => {
    return nerd.sendTransfer({
      id: 'first',
      amount: '10',
      account: 'noob'
    })
  })

  it('should reject a non-matching repeat transfer from the noob', () => {
    return noob.sendTransfer({
      id: 'first',
      amount: '100',
      account: 'nerd'
    }).catch((e) => {
      assert.equal(e.name, 'DuplicateIdError')
    })
  })

  it('should reject a non-matching repeat transfer from the nerd', () => {
    return nerd.sendTransfer({
      id: 'first',
      amount: '100',
      account: 'noob'
    }).catch((e) => {
      assert.equal(e.name, 'DuplicateIdError')
    })
  })

  it('should reject a non-matching repeat transfer with extra field from the noob', () => {
    return noob.sendTransfer({
      id: 'first',
      amount: '10',
      account: 'nerd',
      data: new Buffer('')
    }).catch((e) => {
      assert.equal(e.name, 'DuplicateIdError')
    })
  })

  it('should reject a repeat transfer with extra field from the nerd', () => {
    return nerd.sendTransfer({
      id: 'first',
      amount: '10',
      account: 'noob',
      data: new Buffer('')
    }).catch((e) => {
      assert.equal(e.name, 'DuplicateIdError')
    })
  })

  it('should not give an error if a real transfer is rejected', () => {
  // it's harmless to complete a transfer that is already completed if
  // the reject is to a completed transfer.
    return noob.connection.send({
      type: 'reject',
      transfer: {id: 'first'},
      message: 'late reject'
    })
  })

  it('should not acknowledge an invalid rpc call', () => {
    const stub = sinon.stub()
    nerd.rpc.addMethod('trash', stub)
    noob.rpc.call('trash', 20)
    
    sinon.assert.notCalled(stub)
  })

  it('should hold same balance when nerd is made with old db', () => {
    let tmpNerd = new PluginVirtual({
      _store: store1,
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

    return tmpNerd.getBalance().then((balance) => {
      assert(balance !== '0')
    })
  })

  it('should disconnect gracefully', () => {
    return Promise.all([
      noob.disconnect(),
      noob2.disconnect(),
      nerd.disconnect()
    ])
  })
})
