const co = require('co')
const EventEmitter = require('events')
const debug = require('debug')('ilp-plugin-virtual:rpc')
const request = require('co-request')
const url = require('url')
const spdy = require('spdy')

// TODO: really call it HTTP RPC?
module.exports = class HttpRpc extends EventEmitter {
  constructor ({ rpcUri, plugin, authToken }) {
    super()
    this._methods = {}
    this._plugin = plugin
    this.rpcUri = rpcUri
    this.authToken = authToken

    const parsed = url.parse(this.rpcUri)
    this.agent = (parsed.protocol === 'https') && spdy.createAgent({
      host: parsed.host,
      port: parsed.port || 443,
      spdy: {
        plain: false,
        ssl: true
      }
    })

    this.receive = co.wrap(this._receive).bind(this)
    this.call = co.wrap(this._call).bind(this)
  }

  addMethod (name, handler) {
    this._methods[name] = handler
  }

  * _receive (method, params) {
    // TODO: 4XX when method doesn't exist
    return yield this._methods[method].apply(this._plugin, params)
  }

  * _call (method, prefix, params) {
    debug('calling', method, 'with', params)

    const uri = this.rpcUri + '?method=' + method + '&prefix=' + prefix
    const result = yield Promise.race([
      request({
        method: 'POST',
        uri: uri,
        body: params,
        auth: { bearer: this.authToken },
        json: true,
        agent: this.agent
      }),
      new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('request to ' + uri + ' timed out.'))
        }, 2000)
      })
    ])

    // 401 is a common error when a peering relationship isn't mutual, so a more
    // helpful error is printed.
    if (result.statusCode === 401) {
      throw new Error('Unable to call "' + this.rpcUri +
        '" (401 Unauthorized). They may not have you as a peer. (error body=' +
        JSON.stringify(result.body) + ')')
    }

    if (result.statusCode !== 200) {
      throw new Error('Unexpected status code ' + result.statusCode + ', with body "' +
        JSON.stringify(result.body) + '"')
    }

    return result.body
  }
}
