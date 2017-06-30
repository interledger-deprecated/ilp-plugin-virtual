'use strict'

const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert

const getObjBackend = require('../src/util/backend')
const ObjStore = require('./helpers/objStore')

describe('ObjStore and ObjBackend', function () {
  beforeEach(function () {
    this.store = new ObjStore()
    this.backend = getObjBackend(this.store)
  })

  describe('maxValueTracker', function () {
    beforeEach(function () {
      this.opts = {
        key: 'foo'
      }

      this.tracker = this.backend.getMaxValueTracker(this.opts)
    })

    it('should return a default value', async function () {
      assert.deepEqual(
        await this.tracker.getMax(),
        { value: '0', data: null })
    })

    it('should set a higher value', async function () {
      const last = await this.tracker.setIfMax({ value: '3', data: { foo: 'bar' } })

      assert.deepEqual(last, { value: '0', data: null })
      assert.deepEqual(
        await this.tracker.getMax(),
        { value: '3', data: { foo: 'bar' } })

      // key is concatenated to mvt_maximum
      assert.deepEqual(
        JSON.parse(await this.store.get('foo:mvt:maximum')),
        { value: '3', data: { foo: 'bar' } })
    })

    it('should not set for a lower value', async function () {
      const last = await this.tracker.setIfMax({ value: '-1', data: { foo: 'bar' } })

      assert.deepEqual(last, { value: '-1', data: { foo: 'bar' } })
      assert.deepEqual(
        await this.tracker.getMax(),
        { value: '0', data: null })
    })

    it('should load a value from the store', async function () {
      await this.tracker.setIfMax({ value: '1', data: 'foo' })

      // uses same key as this.tracker
      const newTracker = this.backend.getMaxValueTracker(this.opts)

      assert.deepEqual(
        await newTracker.getMax(),
        { value: '1', data: 'foo' })
    })

    it('should not overload a separate key', async function () {
      await this.tracker.setIfMax({ value: '1', data: 'foo' })
      const newTracker = this.backend.getMaxValueTracker({
        key: 'bar'
      })

      assert.deepEqual(
        await this.tracker.getMax(),
        { value: '1', data: 'foo' })

      assert.deepEqual(
        await newTracker.getMax(),
        { value: '0', data: null })
    })

    it('should not allow an invalid key', async function () {
      assert.throws(() => this.backend.getMaxValueTracker({ key: 'test:' }),
        /invalid key: test:/)
    })

    it('handles an invalid value', async function () {
      await assert.isRejected(this.tracker.setIfMax({ foo: 'bar' }),
        /entry .* must have a value/)
    })
  })

  describe('transferLog', function () {
    beforeEach(function () {
      this.opts = {
        maximum: '100',
        minimum: '-10',
        key: 'foo'
      }

      this.log = this.backend.getTransferLog(this.opts)
      this.transfer = {
        amount: '10',
        to: 'test.alice',
        from: 'test.bob',
        ledger: 'test.',
        executionCondition: '7OPop9SpNvWKydlm2JluDEVWrfazSZ3dSpH5h98dSK4',
        expiresAt: new Date(Date.now() + 1000).toISOString()
      }
    })

    it('should set a new maximum', async function () {
      assert.equal(await this.log.getMaximum(), '100')

      await this.log.setMaximum('120')

      assert.equal(await this.log.getMaximum(), '120')
      assert.equal(await this.store.get('foo:tl:maximum'), '120')
    })

    it('should set a new minimum', async function () {
      assert.equal(await this.log.getMinimum(), '-10')

      await this.log.setMinimum('-5')

      assert.equal(await this.log.getMinimum(), '-5')
      assert.equal(await this.store.get('foo:tl:minimum'), '-5')
    })

    it('should apply the same transfer only once', async function () {
      // isIncoming true
      await this.log.prepare(this.transfer, true)
      await this.log.prepare(this.transfer, true)

      assert.equal(await this.log.getBalance(), '0')
      assert.equal(await this.log.getIncomingFulfilled(), '0')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '10')
      assert.equal(await this.log.getOutgoingFulfilled(), '0')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '0')
    })

    it('should throw if transfer with same ID is added with different contents', async function () {
      await this.log.prepare(this.transfer, true)

      const transfer2 = Object.assign({}, this.transfer, { executionCondition: 'bogus' })
      await assert.isRejected(this.log.prepare(transfer2, true),
        /transfer .* matches the id of .* but not the contents/)
    })

    it('should process fulfilled payment', async function () {
      assert.equal(await this.log.getBalance(), '0')
      assert.equal(await this.log.getIncomingFulfilled(), '0')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '0')
      assert.equal(await this.log.getOutgoingFulfilled(), '0')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '0')

      // isIncoming true
      await this.log.prepare(this.transfer, true)

      assert.equal(await this.log.getBalance(), '0')
      assert.equal(await this.log.getIncomingFulfilled(), '0')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '10')
      assert.equal(await this.log.getOutgoingFulfilled(), '0')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '0')

      await this.log.fulfill(this.transfer.id, 'fulfillment')

      assert.equal(await this.log.getBalance(), '10')
      assert.equal(await this.log.getIncomingFulfilled(), '10')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '10')
      assert.equal(await this.log.getOutgoingFulfilled(), '0')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '0')

      const transfer2 = Object.assign({}, this.transfer,
        { id: 'c900f1af-55b1-39f7-2f9f-f2eb90e0a7bf' })

      // isIncoming false
      await this.log.prepare(transfer2, false)

      assert.equal(await this.log.getBalance(), '10')
      assert.equal(await this.log.getIncomingFulfilled(), '10')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '10')
      assert.equal(await this.log.getOutgoingFulfilled(), '0')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '10')

      await this.log.fulfill(transfer2.id, 'fulfillment')

      assert.equal(await this.log.getBalance(), '0')
      assert.equal(await this.log.getIncomingFulfilled(), '10')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '10')
      assert.equal(await this.log.getOutgoingFulfilled(), '10')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '10')

      assert.equal(await this.store.get('foo:tl:balance:if'), '10')
      assert.equal(await this.store.get('foo:tl:balance:of'), '10')
      assert.deepEqual(
        JSON.parse(await this.store.get('foo:tl:transfer:' + this.transfer.id)),
        { transfer: this.transfer,
          isIncoming: true,
          fulfillment: 'fulfillment',
          state: 'fulfilled' })

      assert.deepEqual(
        JSON.parse(await this.store.get('foo:tl:transfer:' + transfer2.id)),
        { transfer: transfer2,
          isIncoming: false,
          fulfillment: 'fulfillment',
          state: 'fulfilled' })
    })

    it('should process cancelled payments', async function () {
      // isIncoming true
      await this.log.prepare(this.transfer, true)

      assert.deepEqual(
        JSON.parse(await this.store.get('foo:tl:transfer:' + this.transfer.id)),
        { transfer: this.transfer,
          isIncoming: true,
          state: 'prepared' })

      await this.log.cancel(this.transfer.id)

      assert.equal(await this.log.getBalance(), '0')
      assert.equal(await this.log.getIncomingFulfilled(), '0')
      assert.equal(await this.log.getIncomingFulfilledAndPrepared(), '0')
      assert.equal(await this.log.getOutgoingFulfilled(), '0')
      assert.equal(await this.log.getOutgoingFulfilledAndPrepared(), '0')

      assert.deepEqual(
        JSON.parse(await this.store.get('foo:tl:transfer:' + this.transfer.id)),
        { transfer: this.transfer,
          isIncoming: true,
          state: 'cancelled' })
    })

    it('should load persistent values correctly', async function () {
      await this.log.prepare(this.transfer, true)
      await this.log.fulfill(this.transfer.id, 'fulfillment')

      const log2 = this.backend.getTransferLog(this.opts)

      // prepared transfers are cache values so we don't load them
      assert.equal(await log2.getBalance(), '10')
      assert.equal(await log2.getIncomingFulfilled(), '10')
      assert.equal(await log2.getOutgoingFulfilled(), '0')

      assert.deepEqual(
        JSON.parse(await this.store.get('foo:tl:transfer:' + this.transfer.id)),
        { transfer: this.transfer,
          isIncoming: true,
          fulfillment: 'fulfillment',
          state: 'fulfilled' })
    })

    it('supports several keys without overwriting', async function () {
      this.opts.key = 'bar'
      const log2 = this.backend.getTransferLog(this.opts)

      await this.log.prepare(this.transfer, true)
      await this.log.fulfill(this.transfer.id, 'fulfillment')

      assert.equal(await log2.getBalance(), '0')
      assert.equal(await log2.getIncomingFulfilled(), '0')
      assert.equal(await log2.getOutgoingFulfilled(), '0')

      assert.equal(
        await this.store.get('bar:tl:transfer:' + this.transfer.id),
        undefined)
    })
  })
})
