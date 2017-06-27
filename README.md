# ilp-plugin-virtual [![npm][npm-image]][npm-url] [![circle][circle-image]][circle-url] [![codecov][codecov-image]][codecov-url]

[npm-image]: https://img.shields.io/npm/v/ilp-plugin-virtual.svg?style=flat
[npm-url]: https://npmjs.org/package/ilp-plugin-virtual
[circle-image]: https://circleci.com/gh/interledgerjs/ilp-plugin-virtual.svg?style=shield
[circle-url]: https://circleci.com/gh/interledgerjs/ilp-plugin-virtual
[codecov-image]: https://codecov.io/gh/interledgerjs/ilp-plugin-virtual/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/interledgerjs/ilp-plugin-virtual

> ILP virtual ledger plugin for directly transacting connectors, including a
> framework for attaching on-ledger settlement mechanisms.

## Installation

``` sh
npm install --save ilp-plugin-virtual
```

# ILP Plugin Payment Channel Framework

The plugin payment channel framework includes all the functionality of
`ilp-plugin-virtual`, but wrapped around a [Payment Channel
Backend](#payment-channel-backend-api). A payment channel backend includes
methods for securing a trustline balance, whether by payment channel claims or
by periodically sending unconditional payments. The common functionality, such
as implementing the ledger plugin interface, logging transfers, keeping
balances, etc. are handled by the payment channel framework itself.

ILP Plugin virtual exposes a field called `MakePluginVirtual`.  This function
takes a [Payment Channel Backend](#payment-channel-backend-api), and returns a
LedgerPlugin class.

- [Example Code (w/ Claims)](#example-code-with-claim-based-settlement)
- [Example Code (w/ Payments)](#example-code-with-unconditional-payment-based-settlement)
- [Extended Plugin Backend API](#backend-api-with-extensions-for-payment-channels)
- [Payment Channel Backend API](#payment-channel-backend-api)
- [Plugin Context API](#plugin-context-api)

## Example Code with Claim-Based Settlement

Claim-based settlement is the simple case that this framework uses as its
abstraction for settlement. Claim based settlement uses a unidirectional
payment channel. You put your funds on hold, and give your peer signed claims
for more and more of the funds. These signed claims are passed off-ledger, and
your peer submits the highest claim when they want to get their funds.

Claim based settlement has been implemented on ripple with the PayChan
functionality, or on bitcoin (and many other blockchains) by signing
transactions that pay out of some script output.

```js
const { MakePluginVirtual } = require('ilp-plugin-virtual')
const { NotAcceptedError } = require('ilp-plugin-shared').Errors
const Network = require('some-example-network')
const BigNumber = require('bignumber.js')

return MakePluginVirtual({
  // the connect function runs when the plugin is connected.
  connect: async function (ctx, opts) {
    // network initiation should happen here. In a claim-based plugin, this
    // would be the place to connect to the network and initiate payment
    // channels if they don't exist already.
    await Network.connectToNetwork()

    // we have one maxValueTracker to track the best incoming claim we've
    // gotten so far. it starts with a value of '0', and contains no data.
    ctx.state.bestClaim = ctx.backend.getMaxValueTracker('incoming_claim')

    // the 'maxUnsecured' option is taken from the plugin's constructor.
    // it defines how much the best incoming claim can differs from the amount
    // of incoming transfers.
    ctx.state.maxUnsecured = opts.maxUnsecured
  },

  // this function is called every time an incoming transfer has been prepared.
  // throwing an error will stop the incoming transfer from being emitted as an
  // event.
  handleIncomingPrepare: async function (ctx, transfer) {
    // we get the incomingFulfilledAndPrepared because it represents the most
    // that can be owed to us, if all prepared transfers get fulfilled. The
    // 'transfer' has already been applied to this balance.
    const incoming = await ctx.transferLog.getIncomingFulfilledAndPrepared()
    const bestClaim = await ctx.state.bestClaim.getMax() || { value: '0', data: null }

    // make sure that if all incoming transfers are fulfilled (including the
    // new one), it won't put us too far from the best incoming claim we've
    // gotten.  'incoming - bestClaim.value' is the amount that our peer can
    // default on, so it's important we limit it.
    const exceeds = new BigNumber(incoming)
      .subtract(bestClaim.value)
      .greaterThan(ctx.state.maxUnsecured)

    if (exceeds) {
      throw new NotAcceptedError(transfer.id + ' exceeds max unsecured balance')
    }
  },

  // this function is called whenever the outgoingBalance changes by a
  // significant amount.  It may or may not be called on every transfer's
  // fulfill, so it should not rely on being part of a payment flow.
  createOutgoingClaim: async function (ctx, outgoingBalance) {
    // create a claim for the total outgoing balance. This call is idempotent,
    // because it's relating to the absolute amount owed, and doesn't modify
    // anything.
    const claim = Network.createClaim(outgoingBalance)

    // return an object with the claim and the amount that the claim is for.
    // this will be passed into your peer's handleIncomingClaim function.
    return {
      balance: outgoingBalance,
      claim: claim
    }
  },

  // this function is called right after the peer calls createOutgoingClaim.
  handleIncomingClaim: async function (ctx, claim) {
    const { balance, claim } = claim

    if (Network.verify(claim, balance)) {
      // if the incoming claim is valid and it's better than your previous best
      // claim, set the bestClaim to the new one. If you already have a better
      // claim this will leave it intact. It's important to use the backend's
      // maxValueTracker here, because it will be safe across many processes.
      await ctx.state.bestClaim.setIfMax({ value: balance, data: claim })
    }
  },

  // called on plugin disconnect
  disconnect: async function (ctx) {
    const claim = ctx.state.bestClaim.getMax()
    if (!claim) {
      return
    }

    // submit the best claim before disconnecting. This is the only time we
    // have to wait on the underlying ledger.
    await Network.submitClaim(claim)
  }
})
```

## Example Code with Unconditional Payment-Based Settlement

Unconditional payment settlement secures a trustline balance by sending payments
on a system that doesn't support conditional transfers. Hashed timelock transfers
go through plugin virtual like a clearing layer, and every so often a settlement
is sent to make sure the amount secured on the ledger doesn't get too far from
the finalized amount owed.

Unlike creating a claim, sending a payment has side-effects (it alters an
external system). Therefore, the code is slightly more complicated.

```js
const { MakePluginVirtual } = require('ilp-plugin-virtual')
const { NotAcceptedError } = require('ilp-plugin-shared').Errors
const Network = require('some-example-network')
const BigNumber = require('bignumber.js')

return MakePluginVirtual({
  connect: async function (ctx, opts) {
    await Network.connectToNetwork()

    // In this type of payment channel backend, we create a log of incoming
    // settlements to track all the transfers sent to us on the ledger we're
    // using for settlement.  We use a transferLog in order to make sure a
    // single transfer can't be added twice.
    ctx.state.incomingSettlements = ctx.backend.getTransferLog('incoming_settlements')

    // The amount settled is used to track how much we've paid out in total.
    // We'll go deeper into how it's used in the `createOutgoingClaim`
    // function.
    ctx.state.amountSettled = ctx.backend.getMaxValueTracker('amount_settled')

    // In this type of payment channel backend, the unsecured balance we want
    // to limit is the total amount of incoming transfers minus the sum of all
    // the settlement transfers we've received.
    ctx.state.maxUnsecured = opts.maxUnsecured
  },

  handleIncomingPrepare: async function (ctx, transfer) {
    const incoming = await ctx.transferLog.getIncomingFulfilledAndPrepared() 

    // Instead of getting the best claim, we're getting the sum of all our
    // incoming settlement transfers. This tells us how much incoming money has
    // been secured.
    const amountReceived = await ctx.state.incomingSettlements.getIncomingFulfilledAndPrepared()

    // The peer can default on 'incoming - amountReceived', so we want to limit
    // that amount.
    const exceeds = new BigNumber(incoming)
      .subtract(amountReceived)
      .greaterThan(ctx.state.maxUnsecured)

    if (exceeds) {
      throw new NotAcceptedError(transfer.id + ' exceeds max unsecured balance')
    }
  },

  // Even though this function is designed for creating a claim, we can
  // very easily repurpose it to make a payment for settlement.
  createOutgoingClaim: async function (ctx, outgoingBalance) {
    // If a new max value is set, the maxValueTracker returns the previous max
    // value. We tell the maxValueTracker that we're gonna pay the entire
    // outgoingBalance we owe, and then look at the difference between the last
    // balance and the outgoingBalance to determine how much to pay.
    // If we've already paid out more than outgoingBalance, then it won't be the
    // max value. The maxValueTracker will return outgoingBalance as the result,
    // and outgoingBalance - outgoingBalance is 0. Therefore, we send no payment.
    const lastPaid = ctx.state.amountSettled.setIfMax({ value: outgoingBalance, data: null })
    const diff = outgoingBalance - lastPaid.value

    if (!diff) {
      return
    }

    // We take the transaction ID from the payment we send, and give it as an
    // identifier so out peer can look it up on the network and verify that we
    // paid them. Another approach could be to return nothing from this
    // function, and have the peer automatically track all incoming payments
    // they're notified of on the settlement ledger.
    const txid = Network.makePaymentToPeer(diff)

    return { txid }
  },

  handleIncomingClaim: async function (ctx, claim) {
    const { txid } = claim
    const payment = await Network.getPayment(txid)

    if (!payment) {
      return
    }

    // It doesn't really matter whether this is fulfilled or not, we just need
    // it to affect the incoming balance so we know how much has been received.
    // We use the txid as the ID of the incoming payment, so it's impossible to
    // apply the same incoming settlement transfer twice.
    await ctx.state.incomingSettlements.prepare({
      id: txid,
      amount: payment.amount
    }, true) // isIncoming: true
  }

}
```

## Backend API, with Extensions for Payment Channels

-------

### `async TransferLog.getIncomingFulfilled ()`

Get the sum of all incoming payments in the `fulfilled` state.

#### Returns

- `return` (Integer String) incoming balance.

-------

### `async TransferLog.getIncomingFulfilledAndPrepared ()`

Get the sum of all incoming payments, including those which are in the `prepared` state.

#### Returns

- `return` (Integer String) highest incoming balance.

-------

### `async TransferLog.getOutgoingFulfilled ()`

Get the sum of all outgoing payments in the `fulfilled` state.

#### Returns

- `return` (Integer String) outgoing balance.

-------

### `async TransferLog.getOutgoingFulfilledAndPrepared ()`

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

### `async handleIncomingPrepare (ctx, transfer)`

Called when an incoming transfer is being processed, but has not yet been
prepared. If this function throws an error, the transfer will not be prepared
and the error will be passed back to the peer. 

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `transfer` (Transfer) incoming transfer.

-------

### `async createOutgoingClaim (ctx, balance)`

Called when settlement is triggered. This may occur in the flow of a single payment,
or it may occur only once per several payments. The return value of this function is
passed to the peer, and into their `handleIncomingClaim()` function. The return value must
be stringifiable to JSON.

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `balance` (Integer String) sum of all outgoing fulfilled transfers. This value is strictly increasing.

-------

### `async handleIncomingClaim (ctx, claim)`

Called after peer's `createOutgoingClaim()` function is called.

#### Parameters

- `ctx` (PluginContext) current plugin context.
- `claim` (Object) return value of peer's `createOutgoingClaim()` function.

## Plugin Context API

-------

| Field | Type | Description |
|:--|:--|:--|
| `state` | Object | Object to keep Payment Channel Backend state. Persists between function calls, but not if the plugin is restarted. |
| `rpc` | RPC | RPC object for this plugin. Can be used to call methods on peer. |
| `backend` | ExtendedPluginBackend | Plugin backend, for creating TransferLogs and MaxValueTrackers. |
| `transferLog` | TransferLog | Plugin's TransferLog, containing all its ILP transfers. |
| `plugin` | LedgerPlugin | Plugin object. Only LedgerPlugin Interface functions should be accessed. |
