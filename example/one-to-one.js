const PluginVirtual = require('..')
const readline = require('readline')
const fs = require('fs')
const newObjStore = require('../src/model/objStore')

const stdio = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function _error (err) {
  console.error(err)
}
function _log (msg) {
  console.log('>> ' + msg)
}
function _die (msg) {
  console.error(msg)
  if (plugin) {
    plugin.disconnect()
  }
  stdio.close()
  process.exit(1)
}

let pluginOptions = {
  store: newObjStore(),
  auth: { account: 'plugin' },
  other: null
}
let plugin = null

function start () {
  _log('reading argv[2] for config file...')
  let configFile = process.argv[2]
  let other = null

  try {
    other = JSON.parse(fs.readFileSync(configFile))
  } catch (err) {
    _die("usage: node one-to-one.js <config JSON file>")
  }

  pluginOptions.other = other
  connect()
}

function connect () {
  plugin = new PluginVirtual(pluginOptions)
  plugin.connect().then(() => {
    plugin.on('_balanceChanged', (balance) => {
      _log('balance set to ' + balance)
    })

    transaction()
    return Promise.resolve(null)
  }).catch(_error)
}

function transaction () {
  // because this is a one-to-one connection, the account field doesn't matter:
  // all transactions go to the other connector.  data doesn't matter either,
  // because this is not a full ILP transaction
  let transaction = {
    id: null,
    account: 'other',
    amount: null,
    data: new Buffer('')
  }
  id(transaction)
}

function id (transaction) {
  let q = '[question] Enter your transaction id: \n'
  stdio.question(q, (answer) => {
    transaction.id = answer
    amount(transaction)
  })
}

function amount (transaction) {
  let q = '[question] Enter your transaction amount: \n'
  stdio.question(q, (answer) => {
    transaction.amount = answer
    submit(transaction)
  })
}

function submit (transaction) {
  plugin.send(transaction).then(() => {
    next()
    return Promise.resolve(null)
  }).catch(_error)
}

function next () {
  setTimeout(transaction, 1000)
}

start()
