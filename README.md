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

## Usage

You can test out the ledger plugin by running `npm test` on your machine.  To
include debug information during the test, run `npm run-script verbose-test`

When instantiating the plugin, your `opts` need the correct fields.

### opts.auth (Nerd)

```js
{
  "account": "can be anything; only used for logging",
  "token": "base64url encoded json containing 'host' and 'channel' for mqtt server",
  "token": { // token can also be an object which gets encoded to the blob
    "host": "http://mqtt.example/",
    "channel": "secret channel name"
  },
  "initialBalance": "starting balance of the trustline",
  "minBalance": "lowest balance allowed (can be negative)",
  "maxBalance": "highest balance allowed",
  "settleIfUnder": "trigger settlement if balance goes under this value",
  "settleIfOver": "trigger settlement if balance goes over this value",
  "settlePercent": "(default 0.5) in [0,1], proportion of distance between current balance and limit to settle to.",
  "host": "host of MQTT server",
  "prefix": "prefix for ilp address",
  "secret": "not used yet"
}
```

### opts.auth (Noob)

```json
{
  "account": "can be anything; only used for logging",
  "token": "base64url encoded json containing 'host' and 'channel' for mqtt server",
  "prefix": "prefix for ilp address",
  "settlePercent": "(default 0.5) in [0,1], proportion of distance between current balance and limit to settle to.",
  "balance": "starting balance of the trustline",
  "host": "host of MQTT server"
}
```

# Settlement

## Configuration

Trustlines can be configured to settle their balances automatically. If this
feature is used, then the nerd and the noob will each have to have an
Optimistic Plugin. This is a Ledger Plugin capable of sending optimistic
plugins. Any Plugins that implement the full Ledger Plugin Interface can also
be used as Optimistic Plugins.

In order to configure these Optimistic Plugins, the noob and the nerd must
_both_ include one of the following configurations in their Plugin Options
(in the constructor):

```js
optimisticPlugin: new IlpPluginExample({ /* options here ... */ })
```

```js
optimisticPlugin: 'ilp-plugin-example',
optimisticPluginOpts: {
  /* options here ... */
}

In either case, `ilp-plugin-example` must be accessible.
```

## Settlement Conditions

Settlement is triggered in one of two ways.

### Noob Settlement

If a transfer would put the trustline's balance below the trustline's
`settleIfUnder`, then a settlement event will be emitted regardless of whether
the transfer is rejected. This notification will go to the noob, requesting
that they send a payment to the nerd over their Optimistic Plugin.

The noob will automatically send this payment, with a value which is
`settlePercent` of the way between the current balance and the `maxBalance`.
For example, if `settlePercent` is `0.5`, it will settle to the average of
those two values. If `settlePercent` is `0.0`, it will not settle at all. 

The nerd will listen for incoming transfers from the noob on its Optimistic
Plugin, and add the value of any of these transfers to the trustline balance.

### Nerd Settlement

If a transfer would put the trustline's balance over the trustline's
`settleIfOver`, then a settlement event will be emitted regardless of whether
the transfer is rejected. This notification goes to the nerd, triggering a
payment over their Optimistic Plugin.

The nerd will send this payment to the noob's Optimistic Plugin, with a value
`settlePercent` of the way between the current balance and the `minBalance`.
If `settlePercent` is `0.5`, it will settle to the average of these two values.
If `settlePerecent` is `1.0`, it will settle all the way to the `minBalance`.

The noob will listen for incoming transfers from the nerd on its Optimistic
Plugin, and notify the nerd to confirm that the transfers were received. The nerd
will update the trustline balance by subtracting the transfer amounts.
