const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store rooms: matchId -> { A: ws, B: ws, C: ws }
const rooms = {};

function sendTo(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  let clientMatchId = null;
  let clientRole = null;

  ws.on('message', (messageStr) => {
    try {
      const message = JSON.parse(messageStr);
      
      switch (message.type) {
        case 'join': {
          const { matchId, role } = message;
          clientMatchId = matchId;
          clientRole = role;

          if (!rooms[matchId]) {
            rooms[matchId] = { A: null, B: null, C: null };
          }
          
          rooms[matchId][role] = ws;
          console.log(`Client joined match: ${matchId} as ${role}`);

          // Notify A when B or C joins
          if (role === 'B' || role === 'C') {
            const host = rooms[matchId]?.A;
            if (host) {
              sendTo(host, { type: 'joined', role });
            }
          }
          break;
        }

        case 'start': {
          const { matchId } = message;
          // Forward 'start' command to B
          const peerB = rooms[matchId]?.B;
          if (peerB) {
            sendTo(peerB, { type: 'start' });
          }
          break;
        }

        case 'offer': {
          const { matchId, sdp } = message;
          // Forward offer from B to A
          const host = rooms[matchId]?.A;
          if (host) {
            sendTo(host, { type: 'offer', sdp });
          }
          break;
        }

        case 'answer': {
          const { matchId, sdp } = message;
          // Forward answer from A to B
          const peerB = rooms[matchId]?.B;
          if (peerB) {
            sendTo(peerB, { type: 'answer', sdp });
          }
          break;
        }

        case 'ice': {
          const { matchId, target, candidate } = message;
          // Forward ice candidate to the target (A or B)
          const peer = rooms[matchId]?.[target];
          if (peer) {
            sendTo(peer, { type: 'ice', candidate });
          }
          break;
        }

        case 'ocrData': {
          const { matchId, data } = message;
          // Forward OCR scoreboard data from C to A
          const host = rooms[matchId]?.A;
          if (host) {
            sendTo(host, { type: 'ocrData', data });
          }
          break;
        }
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.onclose = () => {
    if (clientMatchId && clientRole && rooms[clientMatchId]) {
      rooms[clientMatchId][clientRole] = null;
      console.log(`Client disconnected: ${clientMatchId} role ${clientRole}`);
      
      // Notify other peers in the room
      if (clientRole === 'A') {
        // A disconnected, close the room
        const peerB = rooms[clientMatchId].B;
        const peerC = rooms[clientMatchId].C;
        if (peerB) sendTo(peerB, { type: 'matchClosed' });
        if (peerC) sendTo(peerC, { type: 'matchClosed' });
        delete rooms[clientMatchId];
      } else {
        const host = rooms[clientMatchId].A;
        if (host) {
          sendTo(host, { type: 'peerDisconnected', role: clientRole });
        }
      }
    }
  };
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
