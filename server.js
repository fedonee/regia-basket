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
          } else if (role === 'A') {
            const room = rooms[matchId];
            if (room.B) sendTo(ws, { type: 'joined', role: 'B' });
            if (room.C) sendTo(ws, { type: 'joined', role: 'C' });
          }
          break;
        }

        case 'start': {
          const { matchId } = message;
          // Forward 'start' command to B and C
          const peerB = rooms[matchId]?.B;
          const peerC = rooms[matchId]?.C;
          if (peerB) sendTo(peerB, { type: 'start' });
          if (peerC) sendTo(peerC, { type: 'start' });
          break;
        }

        case 'offer': {
          const { matchId, sdp, role } = message; // role can be B or C
          const host = rooms[matchId]?.A;
          if (host) {
            sendTo(host, { type: 'offer', sdp, role });
          }
          break;
        }

        case 'answer': {
          const { matchId, sdp, role } = message; // role specifies recipient B or C
          const peer = rooms[matchId]?.[role];
          if (peer) {
            sendTo(peer, { type: 'answer', sdp });
          }
          break;
        }

        case 'ice': {
          const { matchId, target, candidate, role } = message;
          const peer = rooms[matchId]?.[target];
          if (peer) {
            sendTo(peer, { type: 'ice', candidate, role });
          }
          break;
        }

        case 'videoInfo': {
          const { matchId, width, height } = message;
          const host = rooms[matchId]?.A;
          if (host) {
            sendTo(host, { type: 'videoInfo', width, height, role: 'C' });
          }
          break;
        }

        case 'calibration': {
          const { matchId, rois } = message;
          const peerC = rooms[matchId]?.C;
          if (peerC) {
            sendTo(peerC, { type: 'calibration', rois });
          }
          break;
        }

        case 'calibrationAck': {
          const { matchId } = message;
          const host = rooms[matchId]?.A;
          if (host) {
            sendTo(host, { type: 'calibrationAck' });
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
