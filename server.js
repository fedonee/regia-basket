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

// Store matches: matchId -> { A: ws, B: ws, C: ws, metadata: {} }
const matches = new Map();

wss.on('connection', (ws) => {
  let clientMatchId = null;
  let clientRole = null;

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      
      switch (parsed.type) {
        case 'createMatch': {
          const matchId = uuidv4().substring(0, 6).toUpperCase();
          clientMatchId = matchId;
          clientRole = 'A';
          
          matches.set(matchId, {
            A: ws,
            B: null,
            C: null,
            metadata: {
              homeTeam: parsed.homeTeam || 'Casa',
              awayTeam: parsed.awayTeam || 'Ospiti'
            }
          });
          
          ws.send(JSON.stringify({
            type: 'matchCreated',
            matchId,
            metadata: matches.get(matchId).metadata
          }));
          console.log(`Partita creata: ${matchId}`);
          break;
        }

        case 'joinMatch': {
          const { matchId, role } = parsed;
          clientMatchId = matchId;
          clientRole = role;

          if (!matches.has(matchId)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Partita non trovata' }));
            return;
          }

          const match = matches.get(matchId);
          if (role !== 'B' && role !== 'C') {
            ws.send(JSON.stringify({ type: 'error', message: 'Ruolo non valido' }));
            return;
          }

          // Register connection
          match[role] = ws;
          
          // Confirm join to client
          ws.send(JSON.stringify({
            type: 'joined',
            matchId,
            role,
            metadata: match.metadata
          }));
          
          // Notify A
          if (match.A) {
            match.A.send(JSON.stringify({
              type: 'peerConnected',
              role
            }));
            
            // Check if both are ready
            if (match.B && match.C) {
              match.A.send(JSON.stringify({ type: 'readyToStart' }));
            }
          }
          console.log(`Client ${role} unito alla partita: ${matchId}`);
          break;
        }

        case 'signal': {
          // Relay WebRTC signals
          if (!clientMatchId || !matches.has(clientMatchId)) return;
          const match = matches.get(clientMatchId);

          if (clientRole === 'A') {
            // Signal from A to B or C
            const target = parsed.target;
            if (target && match[target]) {
              match[target].send(JSON.stringify({
                type: 'signal',
                from: 'A',
                data: parsed.data
              }));
            }
          } else {
            // Signal from B or C to A
            if (match.A) {
              match.A.send(JSON.stringify({
                type: 'signal',
                from: clientRole,
                data: parsed.data
              }));
            }
          }
          break;
        }
      }
    } catch (e) {
      console.error('WebSocket message parsing error:', e);
    }
  });

  ws.on('close', () => {
    if (clientMatchId && matches.has(clientMatchId)) {
      const match = matches.get(clientMatchId);
      if (clientRole === 'A') {
        // Host disconnected, close the match and notify others
        console.log(`Host A disconnesso, chiusura partita: ${clientMatchId}`);
        if (match.B) match.B.send(JSON.stringify({ type: 'matchClosed' }));
        if (match.C) match.C.send(JSON.stringify({ type: 'matchClosed' }));
        matches.delete(clientMatchId);
      } else if (clientRole) {
        console.log(`Client ${clientRole} disconnesso dalla partita: ${clientMatchId}`);
        match[clientRole] = null;
        if (match.A) {
          match.A.send(JSON.stringify({
            type: 'peerDisconnected',
            role: clientRole
          }));
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
