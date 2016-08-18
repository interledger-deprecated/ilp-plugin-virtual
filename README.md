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
  "limit": "amount of negative balance that can exist",
  "warnLimit": "amount of negative balance before warning to settle",
  "max": "amount of positive balance that can exist",
  "warnMax": "amount of positive balance before warning to settle",
  "settlePercent": "(default 0.5) in [0,1], proportion of distance between current balance and limit to settle to.",
  "balance": "starting balance of the trustline",
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
