const { makePaymentChannelPlugin } = require('ilp-plugin-payment-channel-framework')
const Token = require('./src/token')
const assert = require('assert')

module.exports = makePaymentChannelPlugin({
  pluginName: 'virtual',

  constructor: function (ctx, opts) {
    assert.equal(typeof opts.secret, 'string', 'opts.secret must be a string')
    assert.equal(typeof opts.peerPublicKey, 'string', 'opts.peerPublicKey must be a string')
    assert.equal(typeof opts.currencyCode, 'string', 'opts.currencyCode must be a string')
    assert.equal(typeof opts.currencyScale, 'number', 'opts.currencyScale must be a string')

    ctx.state._peerAccountName = opts.peerPublicKey
    ctx.state._accountName = Token.publicKey(opts.secret)
    ctx.state._prefix = Token.prefix({
      secretKey: opts.secret,
      currencyCode: opts.currencyCode,
      currencyScale: opts.currencyScale,
      peerPublicKey: ctx.state._peerAccountName,
    })

    ctx.state._info = Object.assign({}, (opts.info || {}), {
      currencyCode: opts.currencyCode,
      currencyScale: opts.currencyScale,
      maxBalance: opts.maxBalance,
      prefix: ctx.state._prefix
    })

    ctx.state._account = ctx.state._prefix + ctx.state._accountName
    ctx.state._peerAccount = ctx.state._prefix + ctx.state._peerAccountName

    // Token uses ECDH to get the ledger prefix from secret and public key
    ctx.state._authToken = Token.authToken({
      secretKey: opts.secret,
      peerPublicKey: ctx.state._peerAccountName
    })

    if (opts.prefix && opts.prefix !== ctx.state._prefix) {
      throw new Error('invalid prefix. got "' +
        opts.prefix + '", expected "' + ctx.state._prefix + '"')
    }
  },

  getAccount: (ctx) => ctx.state._account,
  getPeerAccount: (ctx) => ctx.state._peerAccount,
  getInfo: (ctx) => ctx.state._info,
  getAuthToken: (ctx) => ctx.state._authToken,

  connect: async () => {},
  disconnect: async () => {},
  handleIncomingPrepare: async () => {},
  createOutgoingClaim: async () => {},
  handleIncomingClaim: async () => {}
})

module.exports.generatePrefix = Token.prefix
module.exports.generatePublicKey = Token.publicKey
