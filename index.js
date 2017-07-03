'use strict'

const PluginVirtual = require('./src/lib/plugin')
module.exports = PluginVirtual.bind(null, null)
module.exports.MakePluginVirtual = (channel) => (PluginVirtual.bind(null, channel))
