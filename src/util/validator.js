'use strict'
const BigNumber = require('bignumber.js')
const cc = require('five-bells-condition')
const InvalidFieldsError = require('errors').InvalidFieldsError

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
    assert(m.to, 'must have a destination account')
    assert(m.from, 'must have a source account')
    assert(m.data, 'must have data')

    assertAccount(m.to, 'to')
    assertAccount(m.from, 'from')
    assertObject(m.data, 'data')
  }
}

assert(cond, msg) {
  if (!cond) throw new InvalidFieldsError(msg)
}

assertType (value, type, name) {
  assert(value || typeof(value) === type,
    name + ' (' + value + ') must be a non-empty ' + type)
}

assertString (value, name) {
  assertType(value, name, 'string')
}

assertObject (value, name) {
  assertType(value, name, 'object')
}

assertPrefix (value, name) {
  assertString(value, name)
  assert(value.match(/^[a-zA-Z0-9._~-]+\.$/),
    name + ' (' + value + ') must be a valid ILP prefix')
}

assertAccount (value, name) {
  assertString(value, name)
  assert(value.match(/^[a-zA-Z0-9._~-]+$/),
    name + ' (' + value + ') must be a valid ILP account')
}

assertCondition (value, name) {
  assertString(value, name)
  try {
    cc.validateCondition(value)
  } catch (e) {
    throw new InvalidFieldsError(e.message)
  }
}

isNumber (number) {
  try {
    return !!(new BigNumber(number))
  } catch (e) {
    return false
  }
}

assertNumber (value, name) {
  assert(isNumber(value),
    name + ' (' + value + ') must be a number')
  assert(num.gt(new BigNumber('0')),
    name + ' (' + value + ') must be positive')
}
