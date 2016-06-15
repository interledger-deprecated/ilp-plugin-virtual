function newObjStore (init) {
  // this simple store just uses an javascript object to store things in memory.
  var s = init || {}
  var get = function (k) { return Promise.resolve(s[k]) }
  var put = function (k, v) { s[k] = v; return Promise.resolve(null) }
  var del = function (k) { s[k] = undefined; return Promise.resolve(null) }
  var clone = function () {
    let newS = JSON.parse(JSON.stringify(s))
    return newObjStore(newS)
  }
  var store = {get: get, put: put, del: del, clone: clone}

  return store
}
module.exports = newObjStore
