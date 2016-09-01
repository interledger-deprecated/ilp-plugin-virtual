class InvalidFieldsError extends Error {
  constructor () {
    super(...arguments)
    this.name = 'InvalidFieldsError'
  }
}

class TransferNotFoundError extends Error {
  constructor () {
    super(...arguments)
    this.name = 'TransferNotFoundError'
  }
}

class MissingFulfillmentError extends Error {
  constructor () {
    super(...arguments)
    this.name = 'MissingFulfillmentError'
  }
}

class RepeatError extends Error {
  constructor () {
    super(...arguments)
    this.name = 'RepeatError'
  }
}

class NotAcceptedError extends Error {
  constructor () {
    super(...arguments)
    this.name = 'NotAcceptedError'
  }
}

module.exports = {
  InvalidFieldsError,
  TransferNotFoundError,
  MissingFulfillmentError,
  RepeatError,
  NotAcceptedError
}
