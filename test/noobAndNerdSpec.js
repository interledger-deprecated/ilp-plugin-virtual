'use strict'

const PluginVirtual = require('..')
const assert = require('chai').assert
const Transfer = require('../src/model/transfer').Transfer
const newObjStore = require('../src/model/objStore')
const log = require('../src/util/log')('test')

let pv1 = null
let pv2 = null

describe('The Noob and the Nerd', function () {
  it('should be a function', () => {
    assert.isFunction(PluginVirtual)
  })
})
