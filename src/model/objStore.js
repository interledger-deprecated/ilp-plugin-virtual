function newObjStore () {
  // this simple store just uses an javascript object to store things in memory.
  var s = {}
  var get = function (k) { return Promise.resolve(s[k]) }
  var put = function (k, v) { s[k] = v; return Promise.resolve(null) }
  var del = function (k) { s[k] = undefined; return Promise.resolve(null) }
  var store = {get: get, put: put, del: del}

  return store
}
module.exports = newObjStore
