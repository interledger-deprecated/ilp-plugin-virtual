const PluginVirtual = require('..')
const chai = require('chai')
chai.use(require('chai-as-promised'))
const assert = chai.assert
const ObjStore = require('./helpers/objStore')

describe('PluginVirtual', () => {
  beforeEach(async function () {
    this.peerPublicKey = 'Ivsltficn6wCUiDAoo8gCR0CO5yWb3KBED1a9GrHGwk'
    this.peerAddress = 'peer.NavKx.usd.2.' + this.peerPublicKey
    this.info = { connectors: [ this.peerAddress ] }

    this.opts = {
      maxBalance: '100',
      currencyCode: 'USD',
      currencyScale: 2,
      secret: 'seeecret',
      peerPublicKey: this.peerPublicKey,
      rpcUri: 'https://example.com/rpc',
      _store: new ObjStore(),
      info: this.info
    }

    this.plugin = new PluginVirtual(this.opts)
    await this.plugin.connect()
  })

  it('should create the correct account name', function () {
    assert.equal(this.plugin.getAccount(),
      'peer.NavKx.usd.2.dS9p1thT7z_7Thtshfy7eqsN-0B6s7b1wVv3lkZ4jU8')
  })

  it('should create the correct peer account name', function () {
    assert.equal(this.plugin.getPeerAccount(), this.peerAddress)
  })

  it('should return the correct metadata', function () {
    assert.deepEqual(this.plugin.getInfo(), {
      prefix: 'peer.NavKx.usd.2.',
      currencyCode: 'USD',
      currencyScale: 2,
      maxBalance: '100',
      connectors: this.info.connectors
    })
  })

  it('should return auth token from the shared secret', function () {
    assert.equal(this.plugin._getAuthToken(),
      'x2T03bBmMNhAT6XmRcj52wKEvlG83JIR8tmmV2hGMiY')
  })
})
