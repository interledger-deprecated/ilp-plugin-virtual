# ilp-plugin-virtual

> ILP virtual ledger plugin for directly transacting connectors

## Installation

``` sh
npm install --save ilp-plugin-virtual
```

The `wrtc` module might give some trouble, because it has to be built from
source sometimes. See the instructions on [their github
page](https://github.com/js-platform/node-webrtc).

## Usage

You can test out the ledger plugin by running `npm test` on your machine.  To
include debug information during the test, run `npm run-script verbose-test`

If you want to try sending transactions between two machines, you should use
`examples/one-to-one.js`

### Signalling server

Before you can test ILP plugin virtual using the example scripts, you need to
start the signalling server. This is used when starting a peer-to-peer
connection in order to exchange connection information. Go into the `examples`
folder and run `run-signalling.js`.

### One-to-one.js

#### Setup

To run one-to-one.js, start by entering the examples folder. Run two instances
of `one-to-one.js config.example.json`. You can tweak the `config.example.json`
file or make a new one. If you are running an instance on a different machine
from the signalling server you have to change the host.

#### Usage

You will be prompted for a transaction ID. Enter any unique string for this.
Then enter whatever amount you want. The amount will be transfered from the
balance on your instance to the balance on the other instance.
