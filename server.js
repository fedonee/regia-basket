const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store matches in a plain object: matchId -> { A: ws, B: ws, C: ws, metadata: {} }
const matches = {};

function sendTo(matchId, targetRole, message) {
  const peer = matches[matchId]?.[targetRole];
  if (peer && peer.readyState === WebSocket.OPEN) {
    peer.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  let clientMatchId = null;
  let clientRole = null;

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      
      // Auto-register peer if matchId and role are provided
      if (parsed.matchId && parsed.role) {
        clientMatchId = parsed.matchId;
        clientRole = parsed.role;
        if (!matches[parsed.matchId]) {
          matches[parsed.matchId] = { A: null, B: null, C: null, metadata: {} };
        }
        matches[parsed.matchId][parsed.role] = ws;
      }

      switch (parsed.type) {
        case 'createMatch': {
          const matchId = uuidv4().substring(0, 6).toUpperCase();
          clientMatchId = matchId;
          clientRole = 'A';
          
          matches[matchId] = {
            A: ws,
            B: null,
            C: null,
            metadata: {
              homeTeam: parsed.homeTeam || 'Casa',
              awayTeam: parsed.awayTeam || 'Ospiti'
            }
          };
          
          ws.send(JSON.stringify({
            type: 'matchCreated',
            matchId,
            metadata: matches[matchId].metadata
          }));
          console.log(`Partita creata: ${matchId}`);
          break;
        }

        case 'joinMatch': {
          const { matchId, role } = parsed;
          clientMatchId = matchId;
          clientRole = role;

          if (!matches[matchId]) {
            ws.send(JSON.stringify({ type: 'error', message: 'Partita non trovata' }));
            return;
          }

          if (role !== 'B' && role !== 'C') {
            ws.send(JSON.stringify({ type: 'error', message: 'Ruolo non valido' }));
            return;
          }

          // Register connection
          matches[matchId][role] = ws;
          
          // Confirm join to client
          ws.send(JSON.stringify({
            type: 'joined',
            matchId,
            role,
            metadata: matches[matchId].metadata
          }));
          
          // Notify A that B or C joined
          sendTo(matchId, 'A', { type: 'joined', role });
          
          console.log(`Client ${role} unito alla partita: ${matchId}`);
          break;
        }

        case 'offer': {
          // B or C -> A (sdp offer)
          sendTo(parsed.matchId, 'A', parsed);
          break;
        }

        case 'answer': {
          // A -> B or C (sdp answer)
          sendTo(parsed.matchId, parsed.target, parsed);
          break;
        }

        case 'ice': {
          // ice candidate -> designated target
          sendTo(parsed.matchId, parsed.target, parsed);
          break;
        }

        case 'start': {
          // start: A -> target (e.g. B or C)
          sendTo(parsed.matchId, parsed.target, parsed);
          break;
        }

        case 'signal': {
          // Route any legacy signals or OCR updates from B or C to A
          if (parsed.target) {
            sendTo(parsed.matchId || clientMatchId, parsed.target, parsed);
          }
          break;
        }
      }
    } catch (e) {
      console.error('WebSocket message parsing error:', e);
    }
  });

  ws.on('close', () => {
    if (clientMatchId && matches[clientMatchId]) {
      const match = matches[clientMatchId];
      if (clientRole === 'A') {
        console.log(`Host A disconnesso, chiusura partita: ${clientMatchId}`);
        if (match.B) match.B.send(JSON.stringify({ type: 'matchClosed' }));
        if (match.C) match.C.send(JSON.stringify({ type: 'matchClosed' }));
        delete matches[clientMatchId];
      } else if (clientRole) {
        console.log(`Client ${clientRole} disconnesso dalla partita: ${clientMatchId}`);
        match[clientRole] = null;
        sendTo(clientMatchId, 'A', {
          type: 'peerDisconnected',
          role: clientRole
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
