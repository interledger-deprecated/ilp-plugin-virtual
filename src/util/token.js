const tweetnacl = require('tweetnacl')
const crypto = require('crypto') // sodium doesn't have HMAC
const base64url = require('base64url')

const TOKEN_HMAC_INPUT = 'token'

const token = (seed, publicKey) => {
  // seed and public key should be stored as base64url strings
  const seedBuffer = base64url.toBuffer(seed)
  const publicKeyBuffer = base64url.toBuffer(publicKey)

  const sharedSecretBuffer = tweetnacl.scalarMult(
    crypto.createHash('sha256').update(seedBuffer).digest(),
    publicKeyBuffer
  )

  // token is created by feeding the string 'token' into
  // an HMAC, using the shared secret as the key.
  return base64url(
    crypto.createHmac('sha256', sharedSecretBuffer)
      .update(TOKEN_HMAC_INPUT, 'ascii')
      .digest()
  )
}

const publicKey = (seed) => {
  // seed should be a base64url string
  const seedBuffer = base64url.toBuffer(seed)

  return base64url(tweetnacl.scalarMult.base(
    crypto.createHash('sha256').update(seedBuffer).digest()
  ))
}

const prefix = ({ secretKey, peerPublicKey, currency }) => {
  const tokenPart = token(secretKey, peerPublicKey).substring(0, 5)
  return ('peer.' + tokenPart + '.' + currency.toLowerCase() + '.')
}

// use ECDH and HMAC to get the channel's token
module.exports = {
  token,
  publicKey,
  prefix
}
