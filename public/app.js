// ==========================================================================
// CourtCast Client Application (Roles A, B, C)
// ==========================================================================

// Parse URL Query Parameters
const urlParams = new URLSearchParams(window.location.search);
const matchIdParam = urlParams.get('match');
const roleParam = urlParams.get('role'); // A (Director/Hotspot), B (Camera), C (OCR)

// Global State
let matchId = matchIdParam || null;
let role = roleParam || 'A';
let ws = null;
let localStream = null;
let peerConnectionB = null; // A's connection with B
let peerConnectionC = null; // A's connection with C
let peerConnectionMatch = null; // B or C's connection with A
let dataChannelC = null; // WebRTC Data Channel for OCR (C -> A)

// Game State (Official state on A, synced to C)
const gameState = {
  homeTeam: 'CASA',
  awayTeam: 'OSPITI',
  homeScore: 0,
  awayScore: 0,
  clock: '10:00', // MM:SS
  quarter: 1,
  homeFouls: 0,
  awayFouls: 0
};

// Flags for Manual Correction on A
const manualOverride = {
  homeScore: false,
  awayScore: false,
  clock: false,
  quarter: false,
  homeFouls: false,
  awayFouls: false
};

// Consecutive frames check to clear manual badges (requires 5 consecutive matches)
const ocrMatchCount = {
  homeScore: 0,
  awayScore: 0,
  clock: 0,
  quarter: 0,
  homeFouls: 0,
  awayFouls: 0
};

// WebRTC Configuration
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
};

// Initialize PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((reg) => {
        console.log('Service Worker registrato con successo.');
        document.getElementById('offline-banner').classList.add('hidden');
      })
      .catch((err) => {
        console.warn('Errore registrazione Service Worker:', err);
      });
  });
}

// Handle Offline/Online Status
window.addEventListener('offline', () => {
  document.getElementById('offline-banner').classList.remove('hidden');
});
window.addEventListener('online', () => {
  document.getElementById('offline-banner').classList.add('hidden');
});

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
  // Warn if not running in secure context on non-localhost origins
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const banner = document.getElementById('offline-banner');
    if (banner) {
      banner.innerText = "Apri questa pagina via HTTPS per abilitare la fotocamera.";
      banner.className = "banner badge-error";
      banner.classList.remove('hidden');
    }
  }

  showRoleScreen();
  setupUIEventListeners();
  
  if (matchId && (role === 'B' || role === 'C')) {
    // If role and match are in URL, auto-connect as client
    connectToSignaling();
  }
});

// ==========================================================================
// UI & Screen Routing
// ==========================================================================
function showRoleScreen() {
  // Hide all screens
  document.getElementById('screen-setup').classList.add('hidden');
  document.getElementById('screen-director').classList.add('hidden');
  document.getElementById('screen-camera-match').classList.add('hidden');
  document.getElementById('screen-camera-board').classList.add('hidden');

  if (!matchId && role === 'A') {
    document.getElementById('screen-setup').classList.remove('hidden');
  } else if (role === 'A') {
    document.getElementById('screen-director').classList.remove('hidden');
    initDirector();
  } else if (role === 'B') {
    document.getElementById('screen-camera-match').classList.remove('hidden');
    initCameraMatch();
  } else if (role === 'C') {
    document.getElementById('screen-camera-board').classList.remove('hidden');
    initCameraBoard();
  }
}

function setupUIEventListeners() {
  // Setup screen button
  const btnCreateMatch = document.getElementById('btn-create-match');
  if (btnCreateMatch) {
    btnCreateMatch.addEventListener('click', () => {
      const homeVal = document.getElementById('input-home').value.trim().toUpperCase() || 'CASA';
      const awayVal = document.getElementById('input-away').value.trim().toUpperCase() || 'OSPITI';
      
      gameState.homeTeam = homeVal;
      gameState.awayTeam = awayVal;
      
      role = 'A';
      connectToSignaling();
    });
  }

  // Director screen manual clock toggle
  const btnToggleClock = document.getElementById('btn-toggle-clock');
  if (btnToggleClock) {
    btnToggleClock.addEventListener('click', toggleClockManual);
  }

  // Director clock input manual edit
  const clockInput = document.getElementById('val-clock');
  if (clockInput) {
    clockInput.addEventListener('change', (e) => {
      let val = e.target.value.trim();
      // Ensure MM:SS format
      if (/^\d{1,2}:\d{2}$/.test(val)) {
        updateGameStateField('clock', val, true);
      } else {
        e.target.value = gameState.clock;
      }
    });
  }
}

// ==========================================================================
// Signaling & Room Connections (WebSocket)
// ==========================================================================
function connectToSignaling() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket di segnalazione connesso.');
    
    if (role === 'A' && !matchId) {
      // Create a new match
      ws.send(JSON.stringify({
        type: 'createMatch',
        homeTeam: gameState.homeTeam,
        awayTeam: gameState.awayTeam
      }));
    } else {
      // Join an existing match
      ws.send(JSON.stringify({
        type: 'joinMatch',
        matchId,
        role
      }));
    }
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('WebSocket ricevuto:', message.type);

      switch (message.type) {
        case 'matchCreated':
          matchId = message.matchId;
          // Set URL query params silently
          window.history.replaceState({}, '', `/?match=${matchId}&role=A`);
          showRoleScreen();
          break;

        case 'joined':
          gameState.homeTeam = message.metadata.homeTeam;
          gameState.awayTeam = message.metadata.awayTeam;
          console.log(`Unito con successo alla partita ${matchId} come ${role}`);
          if (role === 'B') {
            document.getElementById('status-camera-b').innerText = 'Connesso';
            document.getElementById('status-camera-b').className = 'badge badge-primary';
            setupWebRTCPeerB();
          } else if (role === 'C') {
            document.getElementById('status-ocr-c').innerText = 'Connesso';
            document.getElementById('status-ocr-c').className = 'badge badge-primary';
            setupWebRTCPeerC();
          }
          break;

        case 'peerConnected':
          updateConnectionStatus(message.role, true);
          break;

        case 'peerDisconnected':
          updateConnectionStatus(message.role, false);
          break;

        case 'readyToStart':
          document.getElementById('btn-toggle-rec').classList.remove('disabled');
          document.getElementById('btn-toggle-rec').removeAttribute('disabled');
          break;

        case 'signal':
          handleSignalingMessage(message.from, message.data);
          break;

        case 'matchClosed':
          alert('La partita è stata chiusa dal regista.');
          window.location.href = '/';
          break;

        case 'error':
          alert('Errore: ' + message.message);
          window.location.href = '/';
          break;
      }
    } catch (err) {
      console.error('Errore gestione messaggio WebSocket:', err);
    }
  };

  ws.onclose = () => {
    console.log('Connessione WebSocket chiusa.');
    // Try to reconnect if signaling was lost, but don't disrupt active local WebRTC flows
  };
}

function updateConnectionStatus(peerRole, connected) {
  const statusEl = document.getElementById(`status-${peerRole.toLowerCase()}`);
  if (statusEl) {
    if (connected) {
      statusEl.innerText = 'Connesso';
      statusEl.className = 'status-indicator connected';
    } else {
      statusEl.innerText = 'Disconnesso';
      statusEl.className = 'status-indicator disconnected';
      if (role === 'A') {
        document.getElementById('btn-toggle-rec').classList.add('disabled');
        document.getElementById('btn-toggle-rec').setAttribute('disabled', 'true');
      }
    }
  }
}

// ==========================================================================
// WebRTC Connections (B -> A Video, C -> A Data)
// ==========================================================================

// A Setup connection for B (Video stream from B)
function setupWebRTCPeerB() {
  if (role === 'B') {
    // Camera B initiates connection to A
    peerConnectionMatch = new RTCPeerConnection(rtcConfig);
    
    // Add local camera video tracks
    if (localStream) {
      localStream.getTracks().forEach(track => peerConnectionMatch.addTrack(track, localStream));
    }

    peerConnectionMatch.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('A', { candidate: event.candidate });
      }
    };

    // Create SDP Offer
    peerConnectionMatch.createOffer()
      .then(offer => peerConnectionMatch.setLocalDescription(offer))
      .then(() => {
        sendSignal('A', { sdp: peerConnectionMatch.localDescription });
      });
  }
}

// A Setup connection for C (DataChannel from C)
function setupWebRTCPeerC() {
  if (role === 'C') {
    // Camera C initiates connection to A
    peerConnectionMatch = new RTCPeerConnection(rtcConfig);

    // Create direct data channel
    dataChannelC = peerConnectionMatch.createDataChannel('ocr-data', { ordered: true });
    
    dataChannelC.onopen = () => {
      console.log('WebRTC Data Channel aperto su C.');
    };
    
    dataChannelC.onmessage = (event) => {
      // C receives messages from A (e.g. manual score sync)
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'manualCorrection') {
          // Re-anchor OCR reference values
          syncManualCorrectionToOCR(msg.field, msg.value);
        }
      } catch (err) {
        console.error('Errore lettura dati WebRTC su C:', err);
      }
    };

    peerConnectionMatch.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('A', { candidate: event.candidate });
      }
    };

    // Create SDP Offer
    peerConnectionMatch.createOffer()
      .then(offer => peerConnectionMatch.setLocalDescription(offer))
      .then(() => {
        sendSignal('A', { sdp: peerConnectionMatch.localDescription });
      });
  }
}

// Generic Signaling Send
function sendSignal(target, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'signal',
      target,
      data
    }));
  }
}

// Handle incoming WebRTC signaling messages
async function handleSignalingMessage(from, signalData) {
  if (role === 'A') {
    if (signalData.ocrData) {
      handleReceivedOcrData(signalData.ocrData);
      return;
    }
    // A receives signaling from B or C
    let pc = from === 'B' ? peerConnectionB : peerConnectionC;
    
    if (!pc) {
      pc = new RTCPeerConnection(rtcConfig);
      if (from === 'B') {
        peerConnectionB = pc;
        pc.ontrack = (event) => {
          console.log('Ricevuta traccia video da B');
          const hiddenVideo = document.getElementById('hidden-video-a');
          hiddenVideo.srcObject = event.streams[0];
          hiddenVideo.play();
        };
      } else {
        peerConnectionC = pc;
        pc.ondatachannel = (event) => {
          console.log('Ricevuto DataChannel da C');
          const channel = event.channel;
          channel.onmessage = (e) => {
            handleReceivedOcrData(JSON.parse(e.data));
          };
          // Keep a reference to send manual corrections back to C
          dataChannelC = channel;
        };
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(from, { candidate: event.candidate });
        }
      };
    }

    if (signalData.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
      if (signalData.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal(from, { sdp: pc.localDescription });
      }
    } else if (signalData.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signalData.candidate));
    }

  } else {
    // B or C receives signaling from A
    if (!peerConnectionMatch) return;
    
    if (signalData.sdp) {
      await peerConnectionMatch.setRemoteDescription(new RTCSessionDescription(signalData.sdp));
      if (signalData.sdp.type === 'offer') {
        const answer = await peerConnectionMatch.createAnswer();
        await peerConnectionMatch.setLocalDescription(answer);
        sendSignal('A', { sdp: peerConnectionMatch.localDescription });
      }
    } else if (signalData.candidate) {
      await peerConnectionMatch.addIceCandidate(new RTCIceCandidate(signalData.candidate));
    }
  }
}

// Send manual correction event back to C via DataChannel
function sendManualCorrectionToC(field, value) {
  if (role === 'A' && dataChannelC && dataChannelC.readyState === 'open') {
    dataChannelC.send(JSON.stringify({
      type: 'manualCorrection',
      field,
      value
    }));
  }
}

// ==========================================================================
// Role A: Control Center & Compositing Canvas
// ==========================================================================
let canvasA = null;
let ctxA = null;
let broadcastRunning = false;

function initDirector() {
  document.getElementById('display-match-id').innerText = matchId;
  
  // Create QR codes dynamically using window.location.origin
  const base = window.location.origin;
  const urlB = `${base}/?match=${matchId}&role=B`;
  const urlC = `${base}/?match=${matchId}&role=C`;
  
  // Generate QR for B
  const qrBContainer = document.getElementById('qrcode-b');
  qrBContainer.innerHTML = '';
  const canvasB = document.createElement('canvas');
  qrBContainer.appendChild(canvasB);
  QRCode.toCanvas(canvasB, urlB, { width: 150 });

  // Generate QR for C
  const qrCContainer = document.getElementById('qrcode-c');
  qrCContainer.innerHTML = '';
  const canvasC = document.createElement('canvas');
  qrCContainer.appendChild(canvasC);
  QRCode.toCanvas(canvasC, urlC, { width: 150 });

  // Setup broadcast canvas
  canvasA = document.getElementById('canvas-broadcast');
  ctxA = canvasA.getContext('2d');
  
  broadcastRunning = true;
  requestAnimationFrame(drawBroadcastLoop);

  // Setup manual button bindings
  document.getElementById('label-home-team').innerText = gameState.homeTeam;
  document.getElementById('label-away-team').innerText = gameState.awayTeam;

  // Setup Recording Trigger
  const btnToggleRec = document.getElementById('btn-toggle-rec');
  btnToggleRec.addEventListener('click', toggleRecording);
}

// Rendering Broadcast Canvas with Custom Scoreboard Overlay
function drawBroadcastLoop() {
  if (!broadcastRunning) return;

  // 1. Draw camera video background
  const hiddenVideo = document.getElementById('hidden-video-a');
  if (hiddenVideo && hiddenVideo.readyState >= 2) {
    ctxA.drawImage(hiddenVideo, 0, 0, canvasA.width, canvasA.height);
  } else {
    // Black screen background with loading indicator
    ctxA.fillStyle = '#0b0f19';
    ctxA.fillRect(0, 0, canvasA.width, canvasA.height);
    
    ctxA.fillStyle = 'rgba(255,255,255,0.7)';
    ctxA.font = 'bold 24px Outfit, sans-serif';
    ctxA.textAlign = 'center';
    ctxA.fillText('In attesa della telecamera (B)...', canvasA.width / 2, canvasA.height / 2);
  }

  // 2. Draw Premium TV Scoreboard Overlay
  drawScoreboardOverlay(ctxA, canvasA.width, canvasA.height);

  requestAnimationFrame(drawBroadcastLoop);
}

function drawScoreboardOverlay(ctx, w, h) {
  // Scoreboard size and positioning
  const overlayW = 600;
  const overlayH = 65;
  const x = (w - overlayW) / 2;
  const y = h - overlayH - 40; // 40px padding from bottom

  // 1. Draw main glass container background
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 5;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; // Deep glass slate
  ctx.beginPath();
  ctx.roundRect(x, y, overlayW, overlayH, 8);
  ctx.fill();
  ctx.restore();

  // Subtle border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // 2. Draw Sections
  // Home block (Left)
  ctx.fillStyle = '#3b82f6'; // Bright Neon Blue
  ctx.beginPath();
  ctx.roundRect(x + 5, y + 5, 140, overlayH - 10, 6);
  ctx.fill();
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.homeTeam, x + 75, y + 37);

  // Home Score
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 150, y + 5, 60, overlayH - 10);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.homeScore, x + 180, y + 43);

  // Middle Block (Clock & Quarter)
  // Divider
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 220, y + 10);
  ctx.lineTo(x + 220, y + overlayH - 10);
  ctx.stroke();

  // Game clock
  ctx.fillStyle = '#f59e0b'; // Amber LED glow
  ctx.font = 'bold 30px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.clock, x + 300, y + 42);

  // Quarter indicator
  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 12px Inter, sans-serif';
  ctx.fillText(`Q${gameState.quarter}`, x + 300, y + 55);

  // Divider
  ctx.beginPath();
  ctx.moveTo(x + 380, y + 10);
  ctx.lineTo(x + 380, y + overlayH - 10);
  ctx.stroke();

  // Away Score
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x + 390, y + 5, 60, overlayH - 10);
  
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.awayScore, x + 420, y + 43);

  // Away block (Right)
  ctx.fillStyle = '#ef4444'; // Bright Crimson Red
  ctx.beginPath();
  ctx.roundRect(x + 455, y + 5, 140, overlayH - 10, 6);
  ctx.fill();
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.awayTeam, x + 525, y + 37);

  // 3. Draw Fouls Bar Below (subtle secondary panel)
  const foulsY = y + overlayH + 4;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.beginPath();
  ctx.roundRect(x + 50, foulsY, overlayW - 100, 24, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 11px Inter, sans-serif';
  
  // Home Fouls left aligned
  ctx.textAlign = 'left';
  ctx.fillText(`FALLI: ${gameState.homeFouls}`, x + 65, foulsY + 16);

  // Away Fouls right aligned
  ctx.textAlign = 'right';
  ctx.fillText(`FALLI: ${gameState.awayFouls}`, x + overlayW - 65, foulsY + 16);

  ctx.restore();
}

// Official State Update & Refresh UI Elements on A
function updateGameStateField(field, val, isManual = false) {
  gameState[field] = val;
  
  // Refresh UI
  if (field === 'homeScore') {
    document.getElementById('val-home-score').innerText = val;
    if (isManual) {
      manualOverride.homeScore = true;
      ocrMatchCount.homeScore = 0;
      document.getElementById('badge-home-manual').classList.remove('hidden');
      sendManualCorrectionToC('homeScore', val);
    }
  } else if (field === 'awayScore') {
    document.getElementById('val-away-score').innerText = val;
    if (isManual) {
      manualOverride.awayScore = true;
      ocrMatchCount.awayScore = 0;
      document.getElementById('badge-away-manual').classList.remove('hidden');
      sendManualCorrectionToC('awayScore', val);
    }
  } else if (field === 'clock') {
    document.getElementById('val-clock').value = val;
    if (isManual) {
      manualOverride.clock = true;
      ocrMatchCount.clock = 0;
      document.getElementById('badge-clock-manual').classList.remove('hidden');
      sendManualCorrectionToC('clock', val);
    }
  } else if (field === 'quarter') {
    document.getElementById('val-quarter').innerText = val;
    if (isManual) {
      manualOverride.quarter = true;
      ocrMatchCount.quarter = 0;
      document.getElementById('badge-quarter-manual').classList.remove('hidden');
      sendManualCorrectionToC('quarter', val);
    }
  } else if (field === 'homeFouls') {
    document.getElementById('val-home-fouls').innerText = val;
    if (isManual) {
      manualOverride.homeFouls = true;
      ocrMatchCount.homeFouls = 0;
      sendManualCorrectionToC('homeFouls', val);
    }
  } else if (field === 'awayFouls') {
    document.getElementById('val-away-fouls').innerText = val;
    if (isManual) {
      manualOverride.awayFouls = true;
      ocrMatchCount.awayFouls = 0;
      sendManualCorrectionToC('awayFouls', val);
    }
  }
}

// Manual Event Adjusters called from HTML onclicks
window.adjustScore = function(team, amt) {
  const field = team === 'home' ? 'homeScore' : 'awayScore';
  let newVal = Math.max(0, gameState[field] + amt);
  updateGameStateField(field, newVal, true);
};

window.adjustFouls = function(team, amt) {
  const field = team === 'home' ? 'homeFouls' : 'awayFouls';
  let newVal = Math.max(0, gameState[field] + amt);
  updateGameStateField(field, newVal, true);
};

window.adjustQuarter = function(amt) {
  let newVal = Math.max(1, Math.min(5, gameState.quarter + amt));
  updateGameStateField('quarter', newVal, true);
};

// Simple manual clock timer decrement for simulation/fallback
let manualClockInterval = null;
function toggleClockManual() {
  const btn = document.getElementById('btn-toggle-clock');
  if (manualClockInterval) {
    clearInterval(manualClockInterval);
    manualClockInterval = null;
    btn.innerText = 'Avvia';
  } else {
    btn.innerText = 'Pausa';
    manualClockInterval = setInterval(() => {
      let parts = gameState.clock.split(':');
      let min = parseInt(parts[0], 10);
      let sec = parseInt(parts[1], 10);
      
      if (min === 0 && sec === 0) {
        clearInterval(manualClockInterval);
        manualClockInterval = null;
        btn.innerText = 'Avvia';
        return;
      }
      
      sec--;
      if (sec < 0) {
        sec = 59;
        min--;
      }
      
      let newClock = `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
      updateGameStateField('clock', newClock, false); // Don't flag as manual override
    }, 1000);
  }
}

// Handle data payload received from OCR Device C
function handleReceivedOcrData(data) {
  // Sync each field using re-anchoring logic
  
  // 1. Home Score
  if (manualOverride.homeScore) {
    if (data.homeScore === gameState.homeScore) {
      ocrMatchCount.homeScore++;
      if (ocrMatchCount.homeScore >= 5) {
        manualOverride.homeScore = false;
        document.getElementById('badge-home-manual').classList.add('hidden');
      }
    } else {
      ocrMatchCount.homeScore = 0;
    }
  } else {
    // Strict incremental validation
    let diff = data.homeScore - gameState.homeScore;
    if (diff >= 0 && diff <= 3) {
      updateGameStateField('homeScore', data.homeScore, false);
    }
  }

  // 2. Away Score
  if (manualOverride.awayScore) {
    if (data.awayScore === gameState.awayScore) {
      ocrMatchCount.awayScore++;
      if (ocrMatchCount.awayScore >= 5) {
        manualOverride.awayScore = false;
        document.getElementById('badge-away-manual').classList.add('hidden');
      }
    } else {
      ocrMatchCount.awayScore = 0;
    }
  } else {
    let diff = data.awayScore - gameState.awayScore;
    if (diff >= 0 && diff <= 3) {
      updateGameStateField('awayScore', data.awayScore, false);
    }
  }

  // 3. Quarter
  if (manualOverride.quarter) {
    if (data.quarter === gameState.quarter) {
      ocrMatchCount.quarter++;
      if (ocrMatchCount.quarter >= 5) {
        manualOverride.quarter = false;
        document.getElementById('badge-quarter-manual').classList.add('hidden');
      }
    } else {
      ocrMatchCount.quarter = 0;
    }
  } else {
    let diff = data.quarter - gameState.quarter;
    if (diff === 0 || diff === 1) {
      updateGameStateField('quarter', data.quarter, false);
    }
  }

  // 4. Clock
  if (manualOverride.clock) {
    if (data.clock === gameState.clock) {
      ocrMatchCount.clock++;
      if (ocrMatchCount.clock >= 5) {
        manualOverride.clock = false;
        document.getElementById('badge-clock-manual').classList.add('hidden');
      }
    } else {
      ocrMatchCount.clock = 0;
    }
  } else {
    // Validate chrono decrement
    let curSecs = clockToSeconds(gameState.clock);
    let newSecs = clockToSeconds(data.clock);
    let diff = curSecs - newSecs;
    if (diff >= 0 && diff <= 3) {
      updateGameStateField('clock', data.clock, false);
    }
  }

  // 5. Fouls
  if (!manualOverride.homeFouls) {
    if (data.homeFouls >= gameState.homeFouls || data.homeFouls === 0) { // allows reset on new period
      updateGameStateField('homeFouls', data.homeFouls, false);
    }
  } else if (data.homeFouls === gameState.homeFouls) {
    ocrMatchCount.homeFouls++;
    if (ocrMatchCount.homeFouls >= 5) manualOverride.homeFouls = false;
  }

  if (!manualOverride.awayFouls) {
    if (data.awayFouls >= gameState.awayFouls || data.awayFouls === 0) {
      updateGameStateField('awayFouls', data.awayFouls, false);
    }
  } else if (data.awayFouls === gameState.awayFouls) {
    ocrMatchCount.awayFouls++;
    if (ocrMatchCount.awayFouls >= 5) manualOverride.awayFouls = false;
  }
}

function clockToSeconds(clockStr) {
  let parts = clockStr.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

// ==========================================================================
// Director Recording System (High-Performance OPFS via Inline Web Worker)
// ==========================================================================
let mediaRecorder = null;
let recording = false;
let recordStartTime = 0;
let recordTimerInterval = null;
let recordFileHandle = null;

// Inline Worker Code to run in a background thread for thread-safe writing to OPFS
const opfsWorkerCode = `
  let fileHandle = null;
  let accessHandle = null;
  let offset = 0;

  self.onmessage = async (e) => {
    const { type, handle, chunk } = e.data;
    
    if (type === 'init') {
      try {
        fileHandle = handle;
        // Open the high performance access handle
        accessHandle = await fileHandle.createAccessHandle();
        offset = 0;
        self.postMessage({ type: 'ready' });
      } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
      }
    } else if (type === 'write') {
      if (!accessHandle) return;
      try {
        const bytesWritten = accessHandle.write(chunk, { at: offset });
        offset += bytesWritten;
        self.postMessage({ type: 'written', offset });
      } catch (err) {
        self.postMessage({ type: 'error', error: err.message });
      }
    } else if (type === 'close') {
      if (accessHandle) {
        await accessHandle.close();
        accessHandle = null;
        self.postMessage({ type: 'closed' });
      }
    }
  };
`;

let opfsWorker = null;
let wakeLockSentinel = null;

async function toggleRecording() {
  const btn = document.getElementById('btn-toggle-rec');
  
  if (recording) {
    // STOP RECORDING
    recording = false;
    document.getElementById('screen-director').classList.remove('recording');
    btn.innerText = 'Preparo video...';
    btn.classList.add('disabled');
    btn.setAttribute('disabled', 'true');
    
    if (mediaRecorder) {
      mediaRecorder.stop();
    }
  } else {
    // START RECORDING
    try {
      // 1. Screen Wake Lock request (Safari 16.4+)
      if ('wakeLock' in navigator) {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
          console.log('Screen Wake Lock attivato.');
        } catch (wlErr) {
          console.warn('Errore Screen Wake Lock:', wlErr);
        }
      }

      // 2. Prepare file on OPFS
      const root = await navigator.storage.getDirectory();
      recordFileHandle = await root.getFileHandle('partita.mp4', { create: true });
      
      // Init Web Worker
      const blob = new Blob([opfsWorkerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      opfsWorker = new Worker(workerUrl);
      
      opfsWorker.postMessage({ type: 'init', handle: recordFileHandle });
      
      opfsWorker.onmessage = (e) => {
        if (e.data.type === 'error') {
          console.error('OPFS Worker Error:', e.data.error);
        } else if (e.data.type === 'ready') {
          console.log('OPFS Worker pronto per la scrittura.');
          startStreamCapture();
        }
      };

    } catch (err) {
      console.error('Inizializzazione registrazione fallita:', err);
      alert('Impossibile iniziare la registrazione su disco: ' + err.message);
    }
  }
}

function startStreamCapture() {
  const canvasStream = canvasA.captureStream(30); // 30 FPS
  
  // Determine suitable video format for Safari/iOS
  let mimeType = 'video/mp4';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = ''; // Let Safari fall back to its internal defaults
  }
  
  mediaRecorder = new MediaRecorder(canvasStream, { mimeType });
  
  mediaRecorder.ondataavailable = async (event) => {
    if (event.data && event.data.size > 0 && opfsWorker) {
      // Send the blob as ArrayBuffer to the worker for synchronous local disk writing
      const buffer = await event.data.arrayBuffer();
      opfsWorker.postMessage({ type: 'write', chunk: buffer }, [buffer]);
    }
  };
  
  mediaRecorder.onstop = async () => {
    // Close worker stream
    if (opfsWorker) {
      opfsWorker.postMessage({ type: 'close' });
      opfsWorker.onmessage = async (e) => {
        if (e.data.type === 'closed') {
          opfsWorker.terminate();
          opfsWorker = null;
          await finalizeFileExport();
        }
      };
    }
    
    // Release Wake Lock
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
    
    clearInterval(recordTimerInterval);
  };
  
  mediaRecorder.start(1000); // 1-second timeslices
  
  // UI Update
  recording = true;
  document.getElementById('screen-director').classList.add('recording');
  const btn = document.getElementById('btn-toggle-rec');
  btn.innerText = 'Ferma Registrazione';
  btn.classList.remove('disabled');
  btn.removeAttribute('disabled');
  
  // Start timer
  recordStartTime = Date.now();
  recordTimerInterval = setInterval(updateRecordTimer, 1000);
}

function updateRecordTimer() {
  const diff = Date.now() - recordStartTime;
  const secs = Math.floor(diff / 1000) % 60;
  const mins = Math.floor(diff / 60000) % 60;
  const hrs = Math.floor(diff / 3600000);
  
  document.getElementById('rec-timer').innerText = 
    `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

async function finalizeFileExport() {
  const file = await recordFileHandle.getFile();
  
  // Setup share button
  const btnShare = document.getElementById('btn-share-video');
  btnShare.classList.remove('hidden');
  btnShare.onclick = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          files: [file],
          title: 'Partita Basket Registrata',
          text: 'Ecco il video della partita con overlay TV'
        });
      } else {
        alert('Condivisione non supportata da questo browser.');
      }
    } catch (err) {
      console.warn('Errore condivisione file:', err);
    }
  };

  // Setup download button
  const btnDownload = document.getElementById('btn-download-video');
  btnDownload.classList.remove('hidden');
  btnDownload.onclick = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `partita_${matchId}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btnToggleRec = document.getElementById('btn-toggle-rec');
  btnToggleRec.innerText = 'Avvia Nuova Registrazione';
  btnToggleRec.classList.remove('disabled');
  btnToggleRec.removeAttribute('disabled');
}

// ==========================================================================
// Role B: Game Camera Streamer
// ==========================================================================
async function initCameraMatch() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // Rear camera
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: true
    });
    
    const videoPreview = document.getElementById('video-preview-b');
    videoPreview.srcObject = localStream;
  } catch (err) {
    console.error('Camera access failed on B:', err);
    alert('Impossibile accedere alla fotocamera su B: ' + err.message);
  }
}

// ==========================================================================
// Role C: Scoreboard OCR Camera (OpenCV.js logic)
// ==========================================================================
let canvasCalib = null;
let ctxCalib = null;
let currentRoiField = 'homeScore';
let calibPoints = {
  homeScore: [],
  awayScore: [],
  clock: [],
  quarter: [],
  homeFouls: [],
  awayFouls: []
};

// Colors associated with each ROI calibration
const roiColors = {
  homeScore: '#3b82f6',
  awayScore: '#ef4444',
  clock: '#f59e0b',
  quarter: '#a855f7',
  homeFouls: '#10b981',
  awayFouls: '#ec4899'
};

const ocrHistory = {
  homeScore: [],
  awayScore: [],
  clock: [],
  quarter: [],
  homeFouls: [],
  awayFouls: []
};

// Current calibrated value limits to filter OCR anomalies
const lastValidOcr = {
  homeScore: 0,
  awayScore: 0,
  clock: '10:00',
  quarter: 1,
  homeFouls: 0,
  awayFouls: 0
};

// Synchronize manual correction from A back to C to update our validation anchor
function syncManualCorrectionToOCR(field, value) {
  lastValidOcr[field] = value;
  console.log(`OCR C re-ancorato al valore manuale di A: ${field} = ${value}`);
}

async function initCameraBoard() {
  canvasCalib = document.getElementById('canvas-calibration');
  ctxCalib = canvasCalib.getContext('2d');

  // Load saved calibration points from LocalStorage
  const savedPoints = localStorage.getItem('courtcast_calib_points');
  if (savedPoints) {
    try {
      calibPoints = JSON.parse(savedPoints);
      console.log('Calibrazione caricata da LocalStorage.');
    } catch (e) {
      console.warn('Errore lettura calibrazione salvata.');
    }
  }

  // Bind selector change
  const selectRoi = document.getElementById('select-roi');
  selectRoi.addEventListener('change', (e) => {
    currentRoiField = e.target.value;
  });

  // Clear button
  document.getElementById('btn-clear-roi').onclick = () => {
    calibPoints[currentRoiField] = [];
    saveCalibration();
    drawCalibrationLayer();
  };

  // Slider change
  const slider = document.getElementById('slider-threshold');
  slider.oninput = (e) => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('val-threshold-slider').innerText = val === 0 ? 'Auto' : val;
  };

  // Tap corners listener
  canvasCalib.addEventListener('click', handleCalibrationTap);

  // Initialize camera and OpenCV loop
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment', // rear
        width: { ideal: 1920 },    // high resolution to capture scoreboard details
        height: { ideal: 1080 }
      },
      audio: false
    });

    const videoPreview = document.getElementById('video-preview-c');
    videoPreview.srcObject = localStream;
    
    // Start canvas sizing sync
    videoPreview.onloadedmetadata = () => {
      canvasCalib.width = videoPreview.videoWidth;
      canvasCalib.height = videoPreview.videoHeight;
      checkOpenCvStatus();
    };
  } catch (err) {
    console.error('Camera access failed on C:', err);
    alert('Impossibile accedere alla fotocamera su C: ' + err.message);
  }
}

// Check if OpenCV is loaded and running
function checkOpenCvStatus() {
  const statusBadge = document.getElementById('status-opencv');
  if (typeof cv !== 'undefined' && cv.Mat) {
    statusBadge.innerText = 'Pronto';
    statusBadge.className = 'badge badge-primary';
    startOcrLoop();
  } else {
    setTimeout(checkOpenCvStatus, 500);
  }
}

// Handle tap to set the 4 vertices of a ROI
function handleCalibrationTap(e) {
  const rect = canvasCalib.getBoundingClientRect();
  const scaleX = canvasCalib.width / rect.width;
  const scaleY = canvasCalib.height / rect.height;

  const tapX = (e.clientX - rect.left) * scaleX;
  const tapY = (e.clientY - rect.top) * scaleY;

  const points = calibPoints[currentRoiField];
  if (points.length < 4) {
    points.push({ x: tapX, y: tapY });
    saveCalibration();
    drawCalibrationLayer();
  }
}

function saveCalibration() {
  localStorage.setItem('courtcast_calib_points', JSON.stringify(calibPoints));
}

// Draw calibration boxes & points on preview
function drawCalibrationLayer() {
  ctxCalib.clearRect(0, 0, canvasCalib.width, canvasCalib.height);

  // Draw current frames for each ROI
  for (const [field, points] of Object.entries(calibPoints)) {
    const isCurrent = field === currentRoiField;
    ctxCalib.fillStyle = roiColors[field];
    ctxCalib.strokeStyle = roiColors[field];
    ctxCalib.lineWidth = isCurrent ? 5 : 2;

    // Draw points
    points.forEach((p, idx) => {
      ctxCalib.beginPath();
      ctxCalib.arc(p.x, p.y, isCurrent ? 8 : 4, 0, 2 * Math.PI);
      ctxCalib.fill();
      
      ctxCalib.font = '16px Inter, sans-serif';
      ctxCalib.fillStyle = '#fff';
      ctxCalib.fillText(idx + 1, p.x + 10, p.y - 10);
      ctxCalib.fillStyle = roiColors[field];
    });

    // Draw connecting lines
    if (points.length > 0) {
      ctxCalib.beginPath();
      ctxCalib.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctxCalib.lineTo(points[i].x, points[i].y);
      }
      if (points.length === 4) {
        ctxCalib.closePath();
      }
      ctxCalib.stroke();
    }
  }
}

// ==========================================================================
// OpenCV.js Image Processing & 7-Segment OCR Loop (runs on C)
// ==========================================================================
let ocrRunning = false;
let cap = null;
let srcFrame = null;

function startOcrLoop() {
  ocrRunning = true;
  cap = new cv.VideoCapture(document.getElementById('video-preview-c'));
  srcFrame = new cv.Mat(canvasCalib.height, canvasCalib.width, cv.CV_8UC4);
  
  requestAnimationFrame(ocrProcessFrame);
}

function ocrProcessFrame() {
  if (!ocrRunning) return;

  try {
    // 1. Capture current frame from video feed
    cap.read(srcFrame);

    // 2. Draw calibration overlay in the canvas
    drawCalibrationLayer();

    // 3. Process each calibrated field
    for (const [field, points] of Object.entries(calibPoints)) {
      if (points.length === 4) {
        processRoiField(srcFrame, field, points);
      }
    }

    // 4. Send official voted state back to A via RTCDataChannel (or ws if dataChannel not ready)
    sendOcrStateToDirector();

  } catch (err) {
    console.error('Errore loop OCR OpenCV:', err);
  }

  requestAnimationFrame(ocrProcessFrame);
}

function processRoiField(srcMat, field, points) {
  // Target sizes for warping (depending on expected digit count)
  let targetW = 80;
  let targetH = 60;
  if (field === 'clock') targetW = 160;
  if (field === 'quarter' || field === 'homeFouls' || field === 'awayFouls') targetW = 40;

  // 1. Warp perspective to deskew the ROI
  let srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    points[0].x, points[0].y,
    points[1].x, points[1].y,
    points[2].x, points[2].y,
    points[3].x, points[3].y
  ]);

  let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    targetW, 0,
    targetW, targetH,
    0, targetH
  ]);

  let M = cv.getPerspectiveTransform(srcPts, dstPts);
  let warped = new cv.Mat();
  let dsize = new cv.Size(targetW, targetH);
  
  cv.warpPerspective(srcMat, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  // 2. Preprocessing
  let gray = new cv.Mat();
  cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

  // Normalization (CLAHE) to suppress camera auto-exposure changes
  let equalized = new cv.Mat();
  try {
    let clahe = new cv.createCLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(gray, equalized);
    clahe.delete();
  } catch (e) {
    // Fallback if CLAHE fails
    cv.equalizeHist(gray, equalized);
  }

  // 3. Thresholding (Adaptive or Override)
  let thresh = new cv.Mat();
  const sliderVal = parseInt(document.getElementById('slider-threshold').value, 10);
  
  if (sliderVal === 0) {
    // Otsu automatic thresholding
    cv.threshold(equalized, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  } else {
    // Manual override slider
    cv.threshold(equalized, thresh, sliderVal, 255, cv.THRESH_BINARY);
  }

  // Show the warped and binarized frame in UI canvases
  cv.imshow(`warped-${field}`, warped);
  cv.imshow(`thresh-${field}`, thresh);

  // 4. Perform digit extraction & segment classification
  readDigitsFromThreshold(thresh, field, targetW, targetH);

  // Clean memory
  srcPts.delete();
  dstPts.delete();
  M.delete();
  warped.delete();
  gray.delete();
  equalized.delete();
  thresh.delete();
}

// 7-segment Layout mapping on a standard warped digit block (40x60 width*height)
// Bounding boxes coordinates relative to a 40x60 container
const segmentBoxes = [
  { name: 'A', x1: 8,  x2: 32, y1: 4,  y2: 10 },
  { name: 'B', x1: 30, x2: 36, y1: 8,  y2: 26 },
  { name: 'C', x1: 30, x2: 36, y1: 32, y2: 50 },
  { name: 'D', x1: 8,  x2: 32, y1: 48, y2: 54 },
  { name: 'E', x1: 4,  x2: 10, y1: 32, y2: 50 },
  { name: 'F', x1: 4,  x2: 10, y1: 8,  y2: 26 },
  { name: 'G', x1: 8,  x2: 32, y1: 25, y2: 33 }
];

// Mapping active segments key 'A B C D E F G' -> digit
const activePatterns = {
  '1111110': 0,
  '0110000': 1,
  '1101101': 2,
  '1111001': 3,
  '0110011': 4,
  '1101011': 5,
  '1101111': 6,
  '1110000': 7,
  '1111111': 8,
  '1111011': 9,
  '0000000': 0 // off/blank is treated as 0
};

function readDigitsFromThreshold(threshMat, field, totalW, totalH) {
  const digitWidth = 40;
  const numDigits = Math.floor(totalW / digitWidth);
  let parsedValueStr = '';

  for (let d = 0; d < numDigits; d++) {
    const xOffset = d * digitWidth;
    
    // Check segments A-G in this digit region
    const activeSegments = [];
    segmentBoxes.forEach(box => {
      // Create sub-region for segment
      const rect = new cv.Rect(xOffset + box.x1, box.y1, (box.x2 - box.x1), (box.y2 - box.y1));
      const subMat = threshMat.roi(rect);
      
      const whiteCount = cv.countNonZero(subMat);
      const totalPixels = subMat.rows * subMat.cols;
      const isActive = (whiteCount / totalPixels) > 0.30; // 30% segment threshold
      
      activeSegments.push(isActive);
      subMat.delete();
    });

    const digit = decodeSegmentPattern(activeSegments);
    if (digit !== null) {
      parsedValueStr += digit.toString();
    } else {
      parsedValueStr += '0'; // default fallback for unrecognizable segment noise
    }
  }

  // Push raw reading to history list for multi-frame voting
  let finalVal = parseFieldResult(field, parsedValueStr);
  pushOcrHistory(field, finalVal);
}

// Hamming distance decoder (matches closest digit with max 1 segment deviation)
function decodeSegmentPattern(segments) {
  const patternStr = segments.map(s => s ? '1' : '0').join('');
  if (activePatterns[patternStr] !== undefined) {
    return activePatterns[patternStr];
  }

  let bestMatch = null;
  let minDistance = 999;
  for (const [pat, val] of Object.entries(activePatterns)) {
    let dist = 0;
    for (let i = 0; i < 7; i++) {
      if (pat[i] !== patternStr[i]) dist++;
    }
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = val;
    }
  }

  if (minDistance <= 1) {
    return bestMatch;
  }
  return null;
}

function parseFieldResult(field, rawStr) {
  if (field === 'clock') {
    // 4 digits -> MM:SS
    return `${rawStr.substring(0, 2)}:${rawStr.substring(2, 4)}`;
  }
  return parseInt(rawStr, 10);
}

function pushOcrHistory(field, val) {
  const list = ocrHistory[field];
  list.push(val);
  if (list.length > 5) {
    list.shift();
  }

  // Multi-frame voting
  if (list.length >= 3) {
    const votes = {};
    let maxCount = 0;
    let votedVal = val;
    
    list.forEach(v => {
      votes[v] = (votes[v] || 0) + 1;
      if (votes[v] > maxCount) {
        maxCount = votes[v];
        votedVal = v;
      }
    });

    // Validate the voted value using sports logic rules
    validateAndPublishOcrValue(field, votedVal);
  }
}

// Sports Logic Validation and UI Publishing
function validateAndPublishOcrValue(field, value) {
  let isValid = false;

  if (field === 'homeScore' || field === 'awayScore') {
    // Score validation (can only increase by 0, 1, 2, or 3)
    let prev = lastValidOcr[field];
    let diff = value - prev;
    if (diff >= 0 && diff <= 3) {
      lastValidOcr[field] = value;
      isValid = true;
    }
  } else if (field === 'clock') {
    // Clock validation (must count down, max decrease of 3 secs, allows reset on period end)
    let prevSecs = clockToSeconds(lastValidOcr.clock);
    let newSecs = clockToSeconds(value);
    let diff = prevSecs - newSecs;
    
    // Accept if it decreases regularly, stays same, or jumps up (for period start)
    if ((diff >= 0 && diff <= 3) || newSecs === 600 || newSecs === 0) {
      lastValidOcr.clock = value;
      isValid = true;
    }
  } else if (field === 'quarter') {
    // Quarter validation (only advances by 0 or 1)
    let prev = lastValidOcr.quarter;
    let diff = value - prev;
    if (diff === 0 || diff === 1) {
      lastValidOcr.quarter = value;
      isValid = true;
    }
  } else if (field === 'homeFouls' || field === 'awayFouls') {
    // Fouls validation (increases or resets to 0 on new quarter)
    let prev = lastValidOcr[field];
    if (value >= prev || value === 0) {
      lastValidOcr[field] = value;
      isValid = true;
    }
  }

  // Update diagnostic UI text on device C
  const uiEl = document.getElementById(`ocr-val-${field}`);
  if (uiEl) {
    uiEl.innerText = lastValidOcr[field];
    uiEl.style.color = isValid ? '#f59e0b' : '#ef4444'; // Orange for valid, Red for discarded
  }
}

// Send current state packet to director
function sendOcrStateToDirector() {
  const dataPacket = {
    homeScore: lastValidOcr.homeScore,
    awayScore: lastValidOcr.awayScore,
    clock: lastValidOcr.clock,
    quarter: lastValidOcr.quarter,
    homeFouls: lastValidOcr.homeFouls,
    awayFouls: lastValidOcr.awayFouls
  };

  if (dataChannelC && dataChannelC.readyState === 'open') {
    dataChannelC.send(JSON.stringify(dataPacket));
  } else if (ws && ws.readyState === WebSocket.OPEN) {
    // Fallback via ws if WebRTC DataChannel isn't open yet
    ws.send(JSON.stringify({
      type: 'signal',
      target: 'A',
      data: { ocrData: dataPacket }
    }));
  }
}
