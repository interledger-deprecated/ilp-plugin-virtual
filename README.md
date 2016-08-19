# ilp-plugin-virtual

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

```json
{
  "account": "can be anything; only used for logging",
  "token": "channel name in MQTT server",
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
  "token": "channel name in MQTT server",
  "prefix": "prefix for ilp address",
  "settlePercent": "(default 0.5) in [0,1], proportion of distance between current balance and limit to settle to.",
  "balance": "starting balance of the trustline",
  "host": "host of MQTT server"
}
```
