const EventEmitter = require('events')
const debug = require('debug')('ilp-plugin-virtual:rpc')
const request = require('co-request')

// TODO: really call it HTTP RPC?
module.exports = class HttpRpc extends EventEmitter {
  constructor ({ rpcUris, plugin, authToken, tolerateFailure }) {
    super()
    this._methods = {}
    this._plugin = plugin
    this.rpcUris = rpcUris
    this.authToken = authToken
    this.tolerateFailure = tolerateFailure
  }

  addMethod (name, handler) {
    this._methods[name] = handler
  }

  async receive (method, params) {
    if (!this._methods[method]) {
      throw new Error('no method "' + method + '" found.')
    }

    return await this._methods[method].apply(this._plugin, params)
  }

  async call (method, prefix, params) {
    const results = await Promise.all(this.rpcUris.map((uri) => {
      return this._callUri(uri, method, prefix, params)
        .catch((e) => {
          if (!this.tolerateFailure) throw e
        })
    }))

    return results.reduce((a, r) => {
      if (a) debug('got RPC result:', a)
      return a || r
    })
  }

  async _callUri (rpcUri, method, prefix, params) {
    debug('calling', method, 'with', params)

    const uri = rpcUri + '?method=' + method + '&prefix=' + prefix
    const result = await Promise.race([
      request({
        method: 'POST',
        uri: uri,
        body: params,
        auth: { bearer: this.authToken },
        json: true
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
      throw new Error('Unable to call "' + rpcUri +
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
