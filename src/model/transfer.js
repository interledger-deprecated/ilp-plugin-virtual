const BigNumber = require('bignumber.js')

module.exports.equals = (left, right) => {
  return (
    left &&
    right &&
    left.id === right.id &&
    left.amount === right.amount &&
    left.executionCondition === right.executionCondition &&
    left.cancellationCondition === right.cancellationCondition
  )
}
