const path = require('path')
const childProcess = require('child_process')

process.env.ILP_PLUGIN_TEST_CONFIG = path.join(__dirname, '../test/interface/config.js')

childProcess.execSync('npm test', {
  cwd: path.join(__dirname, '../node_modules/ilp-plugin-tests'),
  env: process.env,
  stdio: [ process.stdout, process.stderr, process.stdin ]
})
