'use strict'

const Plugin = require('./src/lib/plugin')
module.exports = Plugin.bind(null, null)
module.exports.MakePaymentChannelPlugin = (channel) => (Plugin.bind(null, channel))
