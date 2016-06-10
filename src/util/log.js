const debug = require('debug')

module.exports = function(name) {
  let stderr = debug(name + ':err')
  let stdout = debug(name)
  stdout.log = console.log.bind(console)

  logFunctions = {}
  logFunctions.log = stdout
  logFunctions.error = stderr
  
  return logFunctions
}
