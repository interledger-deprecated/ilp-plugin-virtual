'use strict'

const Plugin = require('./src/lib/plugin')
const capitalize = (name) => {
  return name.split('-').map(word => word.slice(0, 1).toUpperCase() +
    word.slice(1).toLowerCase()).join('')
}

module.exports = Plugin.bind(null, null)
module.exports.makePaymentChannelPlugin = (channel) => {
  const channelPluginClass = Plugin.bind(null, channel)

  // set the class name
  Object.defineProperty(channelPluginClass, 'name', { writable: true })
  channelPluginClass.name = 'Plugin' + capitalize(channel.pluginName)

  return channelPluginClass
}
