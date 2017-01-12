'use strict'
class ObjStore {

  constructor (init) {
    this.s = init || {}
  }
  // this simple store just uses an javascript object to store things in memory.

  get (k) {
    return Promise.resolve(this.s[k])
  }

  put (k, v) {
    this.s[k] = v
    return Promise.resolve(null)
  }

  del (k) {
    delete this.s[k]
    return Promise.resolve(null)
  }

  clone () {
    let newS = JSON.parse(JSON.stringify(this.s))
    return new ObjStore(newS)
  }
}

module.exports = ObjStore
