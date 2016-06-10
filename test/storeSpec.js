'use strict'
const newObjStore = require('../src/model/objStore')
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

