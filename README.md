# ilp-plugin-virtual [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-plugin-virtual.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-plugin-virtual
[circle-image]: https://circleci.com/gh/interledgerjs/ilp-plugin-virtual.svg?style=shield
[circle-url]: https://circleci.com/gh/interledgerjs/ilp-plugin-virtual
[codecov-image]: https://codecov.io/gh/interledgerjs/ilp-plugin-virtual/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledgerjs/ilp-plugin-virtual

> ILP virtual ledger plugin for directly transacting connectors

## Installation

``` sh
npm install --save ilp-plugin-virtual
```

# ILP Plugin Payment Channel Framework

ILP Plugin virtual exposes a field called `MakePluginVirtual`.  This function
takes a [Payment Channel Backend](#payment-channel-backend-api), and returns a
LedgerPlugin class.

- [Example Code (w/ Claims)](#example-code-with-claim-based-settlement)
- [Example Code (w/ Payments)](#example-code-with-unconditional-payment-based-settlement)
- [Extended Plugin Backend API](#backend-api-with-extensions-for-payment-channels)
- [Payment Channel Backend API](#payment-channel-backend-api)
- [Plugin Context API](#plugin-context-api)

## Example Code with Claim-Based Settlement

```js
const { MakePluginVirtual } = require('ilp-plugin-virtual')
const { NotAcceptedError } = require('ilp-plugin-shared').Errors
const Network = require('some-example-network')
const BigNumber = require('bignumber.js')

return MakePluginVirtual({
  connect: async function (ctx, opts) {
    await Network.connectToNetwork()

    ctx.state.bestClaim = ctx.backend.getMaxValueTracker('incoming_claim')
    ctx.state.maxInFlight = opts.maxInFlight
  },

  handleIncoming: async function (ctx, transfer) {
    const incoming = await ctx.transferLog.getHighestIncomingBalance()
    const bestClaim = await ctx.state.bestClaim.getMax() || { value: '0', data: null }

    const exceeds = new BigNumber(incoming)
      .sub(bestClaim.value)
      .gt(ctx.state.maxInFlight)

    if (exceeds) {
      throw new NotAcceptedError(transfer.id + ' exceeds max in flight balance')
    }
  },

  settleToBalance: async function (ctx, outgoingBalance) {
    const claim = Network.createClaim(outgoingBalance)

    return {
      balance: outgoingBalance,
      claim: claim
    }
  },

  handleSettlement: async function (ctx, settlement) {
    const { balance, claim } = settlement

    if (Network.verify(claim, balance)) {
      await ctx.state.bestClaim.setIfMax({ value: balance, data: claim })
    }
  },

  disconnect: async function (ctx) {
    const claim = ctx.state.bestClaim.getMax()
    if (!claim) {
      return
    }

    await Network.submitClaim(claim)
  }
})
```

## Example Code with Unconditional Payment-Based Settlement

```js
const { MakePluginVirtual } = require('ilp-plugin-virtual')
const { NotAcceptedError } = require('ilp-plugin-shared').Errors
const Network = require('some-example-network')
const BigNumber = require('bignumber.js')

return MakePluginVirtual({
  connect: async function (ctx, opts) {
    await Network.connectToNetwork()

    ctx.state.incomingSettlements = ctx.backend.getTransferLog('incoming_settlements')
    ctx.state.amountSettled = ctx.backend.getMaxValueTracker('amount_settled')

    ctx.state.maxInFlight = opts.maxInFlight
  },

  handleIncoming: async function (ctx, transfer) {
    const incoming = await ctx.transferLog.getHighestIncomingBalance() 
    const amountReceived = await ctx.state.incomingSettlements.getHighestIncomingBalance()

    const exceeds = new BigNumber(incoming)
      .sub(amountReceived)
      .gt(ctx.state.maxInFlight)

    if (exceeds) {
      throw new NotAcceptedError(transfer.id + ' exceeds max in flight balance')
    }
  },

  settleToBalance: async function (ctx, outgoingBalance) {
    const lastPaid = ctx.state.amountSettled.setIfMax({ value: outgoingBalance, data: null })
    const diff = outgoingBalance - lastPaid.value

    if (!diff) {
      return
    }

    const txid = Network.makePaymentToPeer(diff)

    return { txid }
  },

  handleSettlement: async function (ctx, settlement) {
    const { txid } = settlement
    const payment = await Network.getPayment(txid)

    if (!payment) {
      return
    }

    // it doesn't really matter whether this is fulfilled or not,
    // we just need it to affect the incoming balance so we know
    // how much has been received. A transferlog is used here so
    // the same txid cannot be applied twice.
    await ctx.state.incomingSettlements.prepare({
      id: txid,
      amount: payment.amount
    }, true) // isIncoming: true
  }

}
```

## Backend API, with Extensions for Payment Channels

-------

### `async TransferLog.getIncomingBalance ()`

Get the sum of all incoming payments in the `fulfilled` state.

#### Returns

- `return` (Integer String) incoming balance.

-------

### `async TransferLog.getHighestIncomingBalance ()`

Get the sum of all incoming payments, including those which are in the `prepared` state.

#### Returns

- `return` (Integer String) highest incoming balance.

-------

### `async TransferLog.getOutgoingBalance ()`

Get the sum of all outgoing payments in the `fulfilled` state.

#### Returns

- `return` (Integer String) outgoing balance.

-------

### `async TransferLog.getHighestOutgoingBalance ()`

Get the sum of all outgoing payments, including those which are in the `prepared` state.

#### Returns

- `return` (Integer String) highest outgoing balance.

-------

### `getMaxValueTracker (key)`

Get a MaxValueTracker.

#### Parameters

- `key` (String) name of this value tracker.

#### Returns

- `return` (MaxValueTracker) max value tracker.

-------

### `async MaxValueTracker.setIfMax (entry)`

Put `entry` into the MaxValueTracker. If `entry.value` is larger than the
previous entry's value, then `entry` becomes the new max entry, and the
previous max entry is returned. If `entry.value` is not larger than the
previous max entry's value, then the max entry remains the same and `entry` is
returned back.

#### Parameters

- `entry` (Object) entry to add to the max value tracker.
- `entry.value` (Integer String) value to compare to the current max value.
- `entry.data` (Object) data to attach to the entry.

#### Return

- `return` (Object) previous max entry or `entry`.
- `return.value` (Integer String) value of returned entry.
- `return.data` (Object) data attached to returned entry.

-------

### `async MaxValueTracker.getMax ()`

Returns the max value tracker's maximum entry.

#### Return

- `return` (Object) max entry of the max value tracker.
- `return.value` (Integer String) value of returned entry.
- `return.data` (Object) data attached to returned entry.

## Payment Channel Backend API

Calling `MakePluginVirtual` with an object containing some or all of the
functions defined below will return a class. This new class will perform all the
functionality of ILP Plugin Virtual, and additionally use the supplied callbacks
to handle settlement.

Aside from `connect` and `disconnect`, the functions below might be called
during the flow of an RPC request. They should not take enough time to time out
an HTTP request.

-------

### `async connect (ctx, opts)`

Called when `plugin.connect()` is called.

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `opts` (Object) options passed into plugin constructor.

-------

### `async disconnect (ctx)`

Called when `plugin.disconnect()` is called.

#### Parameters

- `ctx` (PluginContext) current plugin context.

-------

### `async handleIncoming (ctx, transfer)`

Called when an incoming transfer is being processed, but has not yet been
prepared. If this function throws an error, the transfer will not be prepared
and the error will be passed back to the peer. 

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `transfer` (Transfer) incoming transfer.

-------

### `async settleToBalance (ctx, balance)`

Called when settlement is triggered. This may occur in the flow of a single payment,
or it may occur only once per several payments. The return value of this function is
passed to the peer, and into their `handleSettlement()` function. The return value must
be stringifiable to JSON.

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `balance` (Integer String) sum of all outgoing fulfilled transfers. This value is strictly increasing.

-------

### `async handleSettlement (ctx, settlement)`

Called after peer's `settleToBalance()` function is called.

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `settlement` (Object) return value of peer's `settleToBalance()` function.

## Plugin Context API

-------

| Field | Type | Description |
|:--|:--|:--|
| `state` | Object | Object to keep Payment Channel Backend state. Persists between function calls, but not if the plugin is restarted. |
| `rpc` | RPC | RPC object for this plugin. Can be used to call methods on peer. |
| `backend` | ExtendedPluginBackend | Plugin backend, for creating TransferLogs and MaxValueTrackers. |
| `transferLog` | TransferLog | Plugin's TransferLog, containing all its ILP transfers. |
| `plugin` | LedgerPlugin | Plugin object. Only LedgerPlugin Interface functions should be accessed. |
