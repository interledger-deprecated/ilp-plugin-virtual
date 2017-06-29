'use strict'

const PluginVirtual = require('./src/lib/plugin')
const Token = require('./src/util/token')

module.exports = PluginVirtual.bind(null, {})

module.exports.MakePluginVirtual = (channel) => (PluginVirtual.bind(null, channel))
module.exports.generatePrefix = Token.prefix
module.exports.generatePublicKey = Token.publicKey
