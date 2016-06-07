/* this signaling server is meant to be run on its own as a script */
var socket_io = require('socket.io')

function _log(msg) {
  console.log('signaling: ' + msg)
}

function runServer() {

  var port = 8080
  var io = socket_io(port)
  var rooms = {}
  _log('running the server...')

  io.on('connection', (socket) => {
    _log('a user connected')

    socket.on('startWithOffer', (obj) => {
      _log('got a startWithOffer')
      var room = obj.room
      var offer = obj.offer      

      if (! (room in rooms)) {
        // if you are first to the room then you are the offerer
        // aka initiator
        rooms[room] = {
          offerer: socket,
          offer: offer
        }
      } else if (! ('answerer' in rooms[room])) {
        // if you are second to the room then you are the answerer
        // or the responder
        _log('sending an offer out')
        rooms[room].answerer = socket
        rooms[room].answerer.emit('offer', {
          room: room,
          offer: rooms[room].offer
        })
      } else {
        // if both roles have been filled then give an error
        socket.emit('_error', { msg: 'this room is full; use another' })
      }
    })

    // no need for a `getAnswer,' because setOffer and getOffer
    // already establish the roles of the two connections
    socket.on('respondWithAnswer', (obj) => {
      var room = obj.room
      var answer = obj.answer
      
      if (!(room in rooms && 
            'answerer' in rooms[room] &&
            'offerer' in rooms[room] )) {
        socket.emit('_error', {
          msg: 'premature answer; first use setOffer or getOffer'
        })
      } else if (socket === rooms[room].answerer) {
        msg = {
          room: room,
          answer: answer
        }
        rooms[room].offerer.emit('completeWithAnswer', msg)
        rooms[room].answerer.emit('completeWithAnswer', msg)

      } else {
        socket.emit('_error', { msg: 'you are not the answerer in this room' })
      } 
    })

    socket.on('error', (err) => {
      console.error(err)
    })
  })
}

exports.run = runServer
