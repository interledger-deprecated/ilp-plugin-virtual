'use strict'
const newObjStore = require('../src/model/objStore')
const TransferLog = require('../src/model/transferlog').TransferLog
const Balance = require('../src/model/balance')
const assert = require('chai').assert

describe('ObjectStore', function () {
  let obj = null
  it('should create an object', () => {
    obj = newObjStore()
    assert.isObject(obj)
  })

  it('should support deletion', function (done) {
    obj.put('k', 'v').then(() => {
      return obj.del('k')
    }).then(() => {
      return obj.get('k')
    }).then((value) => {
      assert(value === undefined)
      done()
    })
  })
})

describe('TransferLog', function () {
  let obj = null
  let tlog = null
  
  it('should create an object', () => {
    obj = newObjStore()
    tlog = new TransferLog(obj)
    assert.isObject(tlog)
  })

  let next = null
  it('should add something', (done) => {
    next = tlog.storeOutgoing({id: 'transfer'}).then(() => {
      return tlog.exists({id: 'transfer'})
    }).then((exists) => {
      assert(exists)
      done()
    })
  })

  it('should delete something', (done) => {
    next = next.then(() => {
      return tlog.del({id: 'transfer'})
    }).then(() => {
      return tlog.exists({id: 'transfer'})
    }).then((exists) => {
      assert(!exists)
      done()
    })
  })

  it('should not contain something nonexistant', (done) => {
    next = next.then(() => {
      return tlog.getTypeId('transfer')
    }).then((type) => {
      assert(type === undefined)
      done()
    })
  })
})

describe('Balance', function () {
  let obj = null
  let balance = null

  it('should create an object', () => {
    obj = newObjStore()
    balance = new Balance(obj)
  })

  it('should yield NaN when converting invalid amount', () => {
    let nan = balance._convert('oaiwdoiawdmawo')
    assert(nan.isNaN())
  })
})
