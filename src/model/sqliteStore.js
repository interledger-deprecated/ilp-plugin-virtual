const sqlite3 = require('sqlite3').verbose()
const log = require('../util/log')('sqlite_store')

function newSqliteStore (address) {
  address = address || ':memory:'

  // create a new database in memory for now
  let db = new sqlite3.Database(address)
  db.run('CREATE TABLE IF NOT EXISTS store (key TEXT, value TEXT)', () => {
    db.run('CREATE UNIQUE INDEX IF NOT EXISTS id ON store (key)')
  })
  
  let put = function (k, v) {
    return new Promise((resolve) => {
      log.log('PUTTING', v, 'INTO', k)
      db.run('REPLACE INTO store (key, value) VALUES (?, ?)', k, v, () => {
        resolve()
      })
    })
  }

  let get = function (k) {
    return new Promise((resolve) => {
      let items = []
      db.each('SELECT key, value FROM store WHERE (key == ?)', k, (key, v) => {
        items.push(v.value)
      }, () => {
        log.log('GOT', items[0], 'FROM', k)
        resolve(items[0] || undefined)
      })
    })
  }

  let del = function (k) {
    return new Promise((resolve) => {
      db.run('DELETE FROM store WHERE (key == ?)', k, () => {
        resolve() 
      })
    })
  }

  return { get: get, put: put, del: del }
}

module.exports = newSqliteStore
