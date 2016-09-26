const num = (str) => {
  try {
    n = JSON.parse(str)
    if (typeof n !== 'number') {
      throw new Error()
    }
    return n
  } catch (e) {
    return NaN
  }
}

module.exports = num
