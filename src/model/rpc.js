const co = require('co')
const EventEmitter = require('events')
const uuid = require('uuid4')
const debug = require('debug')('ilp-plugin-virtual:rpc')

let n = 1

class JsonRpc1 extends EventEmitter {
  constructor (connection, that) {
    super()
    this._connection = connection
    this._methods = {}
    this._that = that

    this._id = n
    ++n

    this._connection.on('receive', (message) => {
      if (message.method) {
        co.wrap(this._handleRequest).call(this, message)
      } else {
        co.wrap(this._handleResponse).call(this, message)
      }
    })
  }

  _log () {
    debug(this._id, ...arguments)
  }

  addMethod (name, func) {
    this._methods[name] = func
  }

  // handle takes an incoming message and returns a result
  * _handleRequest (request) {
    if (typeof request.method !== 'string' ||
        typeof request.params !== 'object' ||
        !request.id) {
      return null
    }

    this._log('got request with id', request.id, 'for method', request.method, 'with params', request.params)

    let response = {
      result: null,
      error: null,
      id: request.id
    }

    try {
      response.result = yield this._methods[request.method].apply(this._that, request.params)
    } catch (e) {
      this._log('relaying error of type:', e.name, e.stack)
      response.error = { type: e.name, message: e.message }
    }

    this._log('sending reponse', response)
    this._connection.send(response)
  }

  * _handleResponse (response) {
    if (response.id === null) {
      this.emit('notification', response.result, response.error)
    } else {
      this._log('got response on id', response.id)
      this.emit('_' + response.id, response)
    }
  }

  call (method, params) {
    const id = uuid()

    const p = new Promise((resolve, reject) => {
      this.once('_' + id, (response) => {
        if (response.error) {
          let e = new Error()
          e.name = response.error.type
          e.message = response.error.message

          reject(e)
        } else {
          resolve(response.result)
        }
      })
    })

    this._log('calling', method, 'with', params, 'and id', id)
    this._connection.send({
      method: method,
      params: params,
      id: id
    })

    return Promise.race([
      p,
      new Promise((resolve, reject) => {
        setTimeout(reject, 5000, new Error(id + ' has not come back yet'))
      })
    ])
  }

  notify (result, error) {
    this._connection.send({
      result: result || null,
      error: error || null,
      id: null
    })
  }
}

module.exports = JsonRpc1
