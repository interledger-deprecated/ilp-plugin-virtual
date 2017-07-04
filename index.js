const { MakePaymentChannelPlugin } = require('ilp-plugin-payment-channel-framework')
const Token = require('./src/token')
const assert = require('assert')

module.exports = MakePaymentChannelPlugin({
  constructor: function (ctx, opts) {
    assert.equal(typeof opts.secret, 'string', 'opts.secret must be a string')
    assert.equal(typeof opts.peerPublicKey, 'string', 'opts.peerPublicKey must be a string')

    ctx.state._secret = opts.secret
    ctx.state._peerAccountName = opts.peerPublicKey
    ctx.state._accountName = Token.publicKey(ctx.state._secret)
    ctx.state._prefix = Token.prefix({
      secretKey: ctx.state._secret,
      peerPublicKey: ctx.state._peerAccountName,
      currencyCode: ctx.state._currencyCode,
      currencyScale: ctx.state._currencyScale
    })

    ctx.state._info = Object.assign({}, (opts.info || {}), {
      currencyCode: ctx.state._currencyCode,
      currencyScale: ctx.state._currencyScale,
      maxBalance: ctx.state._maxBalance,
      prefix: ctx.state._prefix
    })

    ctx.state._account = ctx.state._prefix + ctx.state._accountName

    // Token uses ECDH to get the ledger prefix from secret and public key
    ctx.state._authToken = Token.authToken({
      secretKey: ctx.state._secret,
      peerPublicKey: ctx.state._peerAccountName
    })

    if (opts.prefix && opts.prefix !== ctx.state._prefix) {
      throw new Error('invalid prefix. got "' +
        opts.prefix + '", expected "' + ctx.state._prefix + '"')
    }
  },

  getAccount: (ctx) => ctx.state._account,
  getInfo: (ctx) => ctx.state._info,
  getAuthToken: (ctx) => ctx.state._authToken,

  connect: async () => {},
  disconnect: async () => {},
  handleIncomingPrepare: async () => {},
  createOutgoingClaim: async () => {},
  handleIncomingClaim: async () => {}
})
