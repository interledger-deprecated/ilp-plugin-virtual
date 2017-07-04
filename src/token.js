const tweetnacl = require('tweetnacl')
const crypto = require('crypto') // sodium doesn't have HMAC
const base64url = require('base64url')

const TOKEN_HMAC_INPUT = 'token'
const AUTH_HMAC_INPUT = 'authorization'

const tokenFromSharedSecret = (sharedSecretBuffer) => {
  // token is created by feeding the string 'token' into
  // an HMAC, using the shared secret as the key.
  return base64url(
    crypto.createHmac('sha256', sharedSecretBuffer)
      .update(TOKEN_HMAC_INPUT, 'ascii')
      .digest()
  )
}

const hmac = (key, data) => {
  return base64url(
    crypto.createHmac('sha256', key)
      .update(data, 'ascii')
      .digest()
  )
}

const authToken = ({ secretKey, peerPublicKey }) => {
  return hmac(sharedSecret({
    secretKey, peerPublicKey
  }), AUTH_HMAC_INPUT)
}

const token = ({ secretKey, peerPublicKey }) => {
  // secret and public key should be stored as base64url strings
  return hmac(sharedSecret({
    secretKey, peerPublicKey
  }), TOKEN_HMAC_INPUT)
}

const publicKey = (seed) => {
  // seed should be a base64url string
  const seedBuffer = base64url.toBuffer(seed)

  return base64url(tweetnacl.scalarMult.base(
    crypto.createHash('sha256').update(seedBuffer).digest()
  ))
}

const sharedSecret = ({ secretKey, peerPublicKey }) => {
  const seedBuffer = base64url.toBuffer(secretKey)
  const publicKeyBuffer = base64url.toBuffer(peerPublicKey)

  const sharedSecretBuffer = tweetnacl.scalarMult(
    crypto.createHash('sha256').update(seedBuffer).digest(),
    publicKeyBuffer
  )

  return sharedSecretBuffer
}

const prefix = ({ secretKey, peerPublicKey, currencyScale, currencyCode }) => {
  const tokenPart = token({ secretKey, peerPublicKey }).substring(0, 5)
  return ('peer.' + tokenPart + '.' + currencyCode.toLowerCase() + '.' + currencyScale + '.')
}

// use ECDH and HMAC to get the channel's token
module.exports = {
  token,
  publicKey,
  tokenFromSharedSecret,
  sharedSecret,
  authToken,
  prefix
}
