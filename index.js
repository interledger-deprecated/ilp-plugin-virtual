'use strict'

const Plugin = require('./src/lib/plugin')
const capitalize = (word) => {
  return word.slice(0, 1).toUpperCase() +
    word.slice(1).toLowerCase()
}

module.exports = Plugin.bind(null, null)
module.exports.MakePaymentChannelPlugin = (channel) => {
  const channelPluginClass = Plugin.bind(null, channel)

  // set the class name
  Object.defineProperty(channelPluginClass, 'name', { writable: true })
  channelPluginClass.name = 'Plugin' + capitalize(channel.pluginName || 'PaymentChannel')

  return channelPluginClass
}
