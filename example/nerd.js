const debug = require('debug')
debug.enable('plugin,plugin:err,connection,connection:err')

const PluginVirtual = require('..')
const fs = require('fs')
const newObjStore = require('../src/model/objStore')

let plugin = null

function _log (msg) {
  console.log(msg)
}

function _error (err) {
  console.error(err)
}

function _die (msg) {
  console.error(msg)
  if (plugin) {
    plugin.disconnect() 
  }
  process.exit(1)
}

let pluginOptions = {
  store: newObjStore(),
  auth: null
}

function start () {
  _log('reading ARGV for config file...')
  let configFile = process.argv[2]
  let auth = null
  
  try {
    auth = JSON.parse(fs.readFileSync(configFile)) 
  } catch (err) {
    _error(err)
    _die('usage: node nerd.js <config JSON file>')
  }
  
  pluginOptions.auth = auth
  token()
}

function token () {
  let token = require('crypto').randomBytes(3).toString('hex')
  _log('Your token is: ' + token)

  pluginOptions.auth.token = token 
  connect()
}

function connect () {
  plugin = new PluginVirtual(pluginOptions)
  plugin.connect().then(() => {
    plugin.on('_balanceChanged', (balance) => {
      _log('Balance set to ' + balance)
    })
  }).catch(_error)
}

start()
