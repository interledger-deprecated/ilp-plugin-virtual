'use strict'
const BigNumber = require('bignumber.js')
const InvalidFieldsError = require('./errors').InvalidFieldsError
const util = require('util')

// Regex matching a string containing 32 base64url-encoded bytes
const REGEX_32_BYTES_AS_BASE64URL = /^[A-Za-z0-9_-]{43}$/

module.exports = class Validator {
  constructor (opts) {
    this._account = opts.account
    this._peer = opts.peer
    this._prefix = opts.prefix
  }

  validateIncomingTransfer (t) {
    this.validateTransfer(t)
    if (t.account) return
    this.assertIncoming(t)
  }

  validateOutgoingTransfer (t) {
    this.validateTransfer(t)
    if (t.account) return
    this.assertOutgoing(t)
  }

  validateTransfer (t) {
    assert(t.id, 'must have an id')
    assert(t.ledger, 'must have a ledger')
    assert(t.amount, 'must have an amount')

    assertString(t.id, 'id')
    assertNumber(t.amount, 'amount')
    assertObject(t.data, 'data')
    assertObject(t.noteToSelf, 'noteToSelf')
    assertObject(t.custom, 'custom')
    assertConditionOrPreimage(t.executionCondition, 'executionCondition')
    assertString(t.expiresAt, 'expiresAt')

    if (t.account) {
      util.deprecate(() => {}, 'switch from the "account" field to the "to" and "from" fields!')()
      assertString(t.account, 'account')
      return
    }

    assert(t.to, 'must have a destination (.to)')
    assert(t.from, 'must have a source (.from)')
    assertPrefix(t.ledger, this._prefix, 'ledger')
  }

  validateIncomingMessage (m) {
    this.validateMessage(m)
    if (m.account) return
    this.assertIncoming(m)
  }

  validateOutgoingMessage (m) {
    this.validateMessage(m)
    if (m.account) return
    this.assertOutgoing(m)
  }

  validateMessage (m) {
    assert(m.ledger, 'must have a ledger')
    assert(m.data, 'must have data')
    assertObject(m.data, 'data')

    if (m.account) {
      util.deprecate(() => {}, 'switch from the "account" field to the "to" and "from" fields!')()
      assertString(m.account, 'account')
      return
    }

    assert(m.to, 'must have a destination (.to)')
    assert(m.from, 'must have a source (.from)')
    assertPrefix(m.ledger, this._prefix, 'ledger')
  }

  validateFulfillment (f) {
    assert(f, 'fulfillment must not be "' + f + '"')
    assertConditionOrPreimage(f, 'fulfillment')
  }

  assertIncoming (o) {
    assertAccount(o.to, this._account, 'to')
    assertAccount(o.from, this._peer, 'from')
  }

  assertOutgoing (o) {
    assertAccount(o.to, this._peer, 'to')
    assertAccount(o.from, this._account, 'from')
  }

}

function assert (cond, msg) {
  if (!cond) throw new InvalidFieldsError(msg)
}

function assertType (value, name, type) {
  assert(!value || typeof (value) === type,
    name + ' (' + value + ') must be a non-empty ' + type)
}

function assertString (value, name) {
  assertType(value, name, 'string')
}

function assertObject (value, name) {
  assertType(value, name, 'object')
}

function assertPrefix (value, prefix, name) {
  assertString(value, name)
  assert(value === prefix,
    name + ' (' + value + ') must match ILP prefix: ' + prefix)
}

function assertAccount (value, account, name) {
  assertString(value, name)
  assert(value === account,
    name + ' (' + value + ') must match account: ' + account)
}

function assertConditionOrPreimage (value, name) {
  if (!value) return
  assertString(value, name)
  if (!REGEX_32_BYTES_AS_BASE64URL.test(value)) {
    throw new InvalidFieldsError(name + ' (' + value + '): Not a valid 32-byte base64url encoded string')
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
