'use strict'
const BigNumber = require('bignumber.js')
const cc = require('five-bells-condition')
const InvalidFieldsError = require('./errors').InvalidFieldsError

module.exports = class Validator {
  validateTransfer (t) {
    assert(t.id, 'must have an id')
    assert(t.account, 'must have an account')
    assert(t.ledger, 'must have a ledger')
    assert(t.amount, 'must have an amount')

    assertString(t.id, 'id')
    assertAccount(t.account, 'account')
    assertPrefix(t.ledger, 'ledger')
    assertNumber(t.amount, 'amount')
    assertObject(t.data, 'data')
    assertObject(t.noteToSelf, 'noteToSelf')
    assertObject(t.custom, 'custom')
    assertCondition(t.executionCondition, 'executionCondition')
    assertString(t.expiresAt, 'expiresAt')
  }

  validateMessage (m) {
    if (!m.account) {
      assert(m.to, 'must have a destination account')
      assert(m.from, 'must have a source account')
      assertAccount(m.to, 'to')
      assertAccount(m.from, 'from')
    } else {
      assert(m.account, 'must have an account')
      assertAccount(m.account, 'account')
    }

    assert(m.ledger, 'must have a ledger')
    assert(m.data, 'must have data')

    assertPrefix(m.ledger, 'ledger')
    assertObject(m.data, 'data')
  }

  validateFulfillment (f) {
    assert(f, 'fulfillment must not be "' + f + '"')
    assertFulfillment(f, 'fulfillment')
  }
}

function assert(cond, msg) {
  if (!cond) throw new InvalidFieldsError(msg)
}

function assertType (value, name, type) {
  assert(!value || typeof(value) === type,
    name + ' (' + value + ') must be a non-empty ' + type)
}

function assertString (value, name) {
  assertType(value, name, 'string')
}

function assertObject (value, name) {
  assertType(value, name, 'object')
}

function assertPrefix (value, name) {
  assertString(value, name)
  assert(value.match(/^[a-zA-Z0-9._~-]+\.$/),
    name + ' (' + value + ') must be a valid ILP prefix')
}

function assertAccount (value, name) {
  assertString(value, name)
  assert(value.match(/^[a-zA-Z0-9._~-]+$/),
    name + ' (' + value + ') must be a valid ILP account')
}

function assertCondition (value, name) {
  if (!value) return
  assertString(value, name)
  try {
    cc.validateCondition(value)
  } catch (e) {
    throw new InvalidFieldsError(name + ' (' + value + '): ' + e.message)
  }
}

function assertFulfillment (value, name) {
  if (!value) return
  assertString(value, name)
  try {
    cc.fromFulfillmentUri(value)
  } catch (e) {
    throw new InvalidFieldsError(name + ' (' + value + '): ' + e.message)
  }
}

function isNumber (number) {
  try {
    return !!(new BigNumber(number))
  } catch (e) {
    return false
  }
}

function assertNumber (value, name) {
  assert(isNumber(value),
    name + ' (' + value + ') must be a number')
  assert((new BigNumber(value)).gt(new BigNumber('0')),
    name + ' (' + value + ') must be positive')
}
