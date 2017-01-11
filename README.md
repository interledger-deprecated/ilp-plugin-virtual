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
include debug information during the test, run `DEBUG=ilp* npm test`.

When instantiating the plugin, make sure to pass in an object with the right fields: 

```js
{
  "maxBalance": "highest balance allowed",
  "prefix": "prefix for ilp address",
  "secret": "your secret. your peer must know the corresponding public key.",
  "peerPublicKey": "base64url encoded public key of your peer",
  "rpcUri": "https://example.com/rpc", // this is used to communicate with your peer (see below)
  "_store": { /* this object will be created by the connector */ },
  "info": { /* the object to be returned by getInfo */ }
}
```

# Receiving RPC calls

In order to use plugin virtual, you need an HTTP endpoint that passes calls to the plugin.
The url must take one query parameter (`method`), as well as a JSON body. The method parameter
and parsed body must be passed to the plugin like so:

```js
plugin.receive(method, body)
```
