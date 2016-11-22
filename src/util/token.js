const sodium = require('chloride')
const base64url = require('base64url')

// use ECDH to get the channel's token
module.exports = {

  publicKey: (seed) => {
    // seed should be a base64url string
    const seedBuffer = base64url.toBuffer(seed)

    return base64url(sodium.crypto_scalarmult_base(
      sodium.crypto_hash_sha256(seedBuffer)
    ))
  },
  
  token: (seed, publicKey) => {
    // seed and public key should be stored as base64url strings
    const seedBuffer = base64url.toBuffer(seed)
    const publicKeyBuffer = base64url.toBuffer(publicKey)

    return base64url(sodium.crypto_scalarmult(
      sodium.crypto_hash_sha256(seedBuffer),
      publicKeyBuffer
    ))
  }
}
