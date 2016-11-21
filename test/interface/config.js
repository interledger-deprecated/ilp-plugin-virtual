// mock require the network connection
const mockRequire = require('mock-require')
const mock =
  require('../mocks/mockConnection')
const MockConnection = mock.MockConnection
const MockChannels = mock.MockChannels
mockRequire(
  '../../src/model/connection',
  MockConnection
)

const newObjStore = require('../helpers/objStore')
const store1 = newObjStore()
const store2 = newObjStore()

// This field contains the constructor for a plugin
exports.plugin = require('../..')

// This specifies the number of time in seconds that the plugin needs in order
// to fulfill a transfer (from send until fulfillment goes through).
exports.timeout = 0.2

const crypto = require('crypto')
const token = crypto.randomBytes(32).toString('hex')

// These objects specify the configs of different
// plugins. There must be 2, so that they can send
// transfers to one another.
exports.options = [
  // options for the first plugin
  {
    // These are the PluginOptions passed into the plugin's
    // constructor.
    'pluginOptions': {
      'publicKey': 'aimoAndvkweuyldjnvAfubKS2352nSG9KDNSgajk',
      'prefix': 'test.nerd.',
      'account': 'nerd',
      'broker': 'ws://broker.hivemq.com:8000',
      'maxBalance': '1000',
      'token': token,
      'other': {
        'channels': MockChannels,
        'name': 'nerd'
      },
      'info': {
        'currencyCode': 'USD',
        'currencySymbol': '$',
        'precision': 15,
        'scale': 15,
        'connectors': [ { id: 'other', name: 'other', connector: 'peer.other' } ]
      },
      '_store': store1
    },
    // These objects are merged with transfers originating from
    // their respective plugins. Should specify the other plugin's
    // account, so that the two plugins can send to one another
    'transfer': {
      'account': 'peer.' + token.substring(0, 5) + '.biap24ts09xAFSFVWHGvuoVVr7mUVPTrVKUROWT'
    }
  },
  // options for the second plugin
  {
    'pluginOptions': {
      'publicKey': 'biap24ts09xAFSFVWHGvuoVVr7mUVPTrVKUROWT',
      'prefix': 'test.nerd.',
      'account': 'noob',
      'broker': 'ws://broker.hivemq.com:8000',
      'maxBalance': '1000',
      'token': token,
      'other': {
        'channels': MockChannels,
        'name': 'noob'
      },
      'info': {
        'currencyCode': 'USD',
        'currencySymbol': '$',
        'precision': 15,
        'scale': 15,
        'connectors': [ { id: 'other', name: 'other', connector: 'peer.other' } ]
      },
      '_store': store2
    },
    'transfer': {
      'account': 'peer.' + token.substring(0, 5) + '.aimoAndvkweuyldjnvAfubKS2352nSG9KDNSgajk'
    }
  }
]
