const co = require('co')
const EventEmitter = require('events')
const debug = require('debug')('ilp-plugin-virtual:rpc')
const request = require('co-request')

// TODO: really call it HTTP RPC?
module.exports = class HttpRpc extends EventEmitter {
  constructor (rpcUri, that) {
    super()
    this._methods = {}
    this._that = that
    this.rpcUri = rpcUri

    this.receive = co.wrap(this._receive).bind(this)
    this.call = co.wrap(this._call).bind(this)
  }

  addMethod (name, handler) {
    this._methods[name] = handler
  }

  * _receive (method, params) {
    // TODO: 4XX when method doesn't exist
    return yield this._methods[method].apply(this._that, params)
  }

  * _call (method, prefix, params) {
    debug('calling', method, 'with', params)

    const uri = this.rpcUri + '?method=' + method + '&prefix=' + prefix
    const result = yield Promise.race([
      request({
        method: 'POST',
        uri: uri,
        body: params,
        json: true
      }),
      new Promise((resolve, reject) => {
        setTimeout(() => {
          reject(new Error('request to ' + uri + ' timed out.'))
        }, 2000)
      })
    ])

    if (result.statusCode !== 200) {
      throw new Error('Unexpected status code ' + result.statusCode + ', with body "' +
        res.body + '"')
    }

    return result.body
  }
}
