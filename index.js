'use strict'

const NerdPluginVirtual = require('./src/plugin/nerd_plugin')
const NoobPluginVirtual = require('./src/plugin/noob_plugin')

module.exports = function (opts) {
  // if the opts.auth contains a secret then it is assumed
  // that this is the Nerd, and the NerdPluginVirtual
  // constructor is used.
  if (opts.auth && opts.auth.secret) {
    return new NerdPluginVirtual(opts)
  } else {
    return new NoobPluginVirtual(opts)
  }
}
