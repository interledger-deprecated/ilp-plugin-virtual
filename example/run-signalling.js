const debug = require('debug')
debug.enable('plugin,plugin:err,connection,connection:err,server')

const Server = require('../src/signalling/server')
Server.run()
