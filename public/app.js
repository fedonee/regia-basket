// ==========================================================================
// CourtCast Client Application (Roles A, B, C)
// ==========================================================================

// Parse URL Query Parameters
const urlParams = new URLSearchParams(window.location.search);
const matchIdParam = urlParams.get('match');
const roleParam = urlParams.get('role'); // A (Director), B (Camera), C (OCR)

// Global State
let matchId = matchIdParam || null;
let role = roleParam || 'A';
let ws = null;
let localStream = null;

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

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// Role A (Director) WebRTC Connection to B
let pcA = null;
const iceQueueA = [];
let remoteSetA = false;

// Role B (Camera) Preview & WebRTC state
let zoomLevel = 1.0;
let cameraStream = null;
let videoEl = null;
let canvasEl = null;
let ctxEl = null;
let pcB = null;
const iceQueueB = [];
let remoteSetB = false;

// Role C (OCR) state
let zoomLevelC = 1.0;
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

// App Initialization
document.addEventListener('DOMContentLoaded', async () => {
  // Warn if not running in secure context on non-localhost origins
  if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const banner = document.getElementById('offline-banner');
    if (banner) {
      banner.innerText = "Apri questa pagina via HTTPS per abilitare la fotocamera.";
      banner.className = "banner badge-error";
      banner.classList.remove('hidden');
    }
  }

  await showRoleScreen();
  setupUIEventListeners();
  setupZoomEventListeners();
  
  if (matchId) {
    // If match is in URL, auto-connect to signaling
    connectToSignaling();
  }
  
  if (role === 'B') {
    initB().catch(e => console.error("initB error:", e));
  } else if (role === 'C') {
    initCameraBoard().catch(e => console.error("initCameraBoard error:", e));
  }
});

// ==========================================================================
// UI & Screen Routing
// ==========================================================================
async function showRoleScreen() {
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
  } else if (role === 'C') {
    document.getElementById('screen-camera-board').classList.remove('hidden');
  }
}

function setupUIEventListeners() {
  const btnCreateMatch = document.getElementById('btn-create-match');
  if (btnCreateMatch) {
    btnCreateMatch.addEventListener('click', () => {
      const homeVal = document.getElementById('input-home').value.trim().toUpperCase() || 'CASA';
      const awayVal = document.getElementById('input-away').value.trim().toUpperCase() || 'OSPITI';
      
      gameState.homeTeam = homeVal;
      gameState.awayTeam = awayVal;
      
      // Generate random match ID
      matchId = Math.random().toString(36).substring(2, 8).toUpperCase();
      role = 'A';
      
      window.history.replaceState({}, '', `/?match=${matchId}&role=A`);
      showRoleScreen();
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
      if (/^\d{1,2}:\d{2}$/.test(val)) {
        updateGameStateField('clock', val, true);
      } else {
        e.target.value = gameState.clock;
      }
    });
  }
  
  // Avvia button trigger
  const btnAvvia = document.getElementById('btn-avvia');
  if (btnAvvia) {
    btnAvvia.addEventListener('click', avviaPartita);
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
    ws.send(JSON.stringify({
      type: 'join',
      matchId,
      role
    }));
  };

  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log('WebSocket ricevuto:', message.type);

      if (message.type === 'matchClosed') {
        alert('La partita è stata chiusa dal regista.');
        window.location.href = '/';
        return;
      }
      if (message.type === 'error') {
        alert('Errore: ' + message.message);
        window.location.href = '/';
        return;
      }

      if (role === 'A') {
        await handleMessageA(message);
      } else if (role === 'B') {
        await handleMessageB(message);
      } else if (role === 'C') {
        await handleMessageC(message);
      }
    } catch (err) {
      console.error('Errore gestione messaggio WebSocket:', err);
    }
  };

  ws.onclose = () => {
    console.log('Connessione WebSocket chiusa.');
    if (role === 'B') {
      document.getElementById('statusB-cam').textContent = 'Disconnesso';
    } else if (role === 'C') {
      const statusEl = document.getElementById('status-ocr-c');
      if (statusEl) {
        statusEl.innerText = 'Disconnesso';
        statusEl.className = 'badge badge-error';
      }
    }
    if (pcB) {
      pcB.close();
      pcB = null;
    }
    if (pcA) {
      pcA.close();
      pcA = null;
    }
  };
}

// ==========================================================================
// Role-Specific Signaling Message Handlers
// ==========================================================================

async function handleMessageA(msg) {
  if (msg.type === 'joined') {
    if (msg.role === 'B') {
      document.getElementById('statusB').textContent = 'B connesso ✓';
    } else if (msg.role === 'C') {
      document.getElementById('statusC').textContent = 'C connessa ✓';
    }
    checkPeersReady();
  }
  
  if (msg.type === 'peerDisconnected') {
    if (msg.role === 'B') {
      document.getElementById('statusB').textContent = 'B: in attesa...';
      document.getElementById('statusVideo').textContent = 'Video B: in attesa...';
    } else if (msg.role === 'C') {
      document.getElementById('statusC').textContent = 'C: in attesa...';
    }
    checkPeersReady();
  }

  if (msg.type === 'offer') {
    if (!pcA) {
      pcA = new RTCPeerConnection(ICE_CONFIG);
      bindPeerConnectionAEvents();
    }
    await pcA.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    remoteSetA = true;
    for (const c of iceQueueA) {
      await pcA.addIceCandidate(new RTCIceCandidate(c));
    }
    iceQueueA.length = 0;
    
    const answer = await pcA.createAnswer();
    await pcA.setLocalDescription(answer);
    ws.send(JSON.stringify({
      type: 'answer',
      sdp: answer,
      matchId
    }));
  }

  if (msg.type === 'ice') {
    if (remoteSetA) {
      await pcA.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else {
      iceQueueA.push(msg.candidate);
    }
  }

  if (msg.type === 'ocrData') {
    handleReceivedOcrData(msg.data);
  }
}

async function handleMessageB(msg) {
  if (msg.type === 'joined') {
    document.getElementById('statusB-cam').textContent = 'Connesso. In attesa di avvio...';
  }
  if (msg.type === 'start') {
    await startWebRTC();
  }
  if (msg.type === 'answer') {
    await pcB.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    remoteSetB = true;
    for (const c of iceQueueB) {
      await pcB.addIceCandidate(new RTCIceCandidate(c));
    }
    iceQueueB.length = 0;
  }
  if (msg.type === 'ice') {
    if (remoteSetB) {
      await pcB.addIceCandidate(new RTCIceCandidate(msg.candidate));
    } else {
      iceQueueB.push(msg.candidate);
    }
  }
}

async function handleMessageC(msg) {
  if (msg.type === 'joined') {
    document.getElementById('status-ocr-c').innerText = 'Connesso';
    document.getElementById('status-ocr-c').className = 'badge badge-primary';
  }
}

function checkPeersReady() {
  const btnAvvia = document.getElementById('btn-avvia');
  if (!btnAvvia) return;
  
  const statusBText = document.getElementById('statusB').textContent;
  const statusCText = document.getElementById('statusC').textContent;
  
  const isBConnected = statusBText.includes('connesso');
  const isCConnected = statusCText.includes('connessa');
  
  if (isBConnected && isCConnected) {
    btnAvvia.classList.remove('disabled');
    btnAvvia.removeAttribute('disabled');
  } else {
    btnAvvia.classList.add('disabled');
    btnAvvia.setAttribute('disabled', 'true');
  }
}

// ==========================================================================
// Role A: WebRTC Connection Receiver
// ==========================================================================

async function avviaPartita() {
  ws.send(JSON.stringify({ type: 'start', matchId }));

  pcA = new RTCPeerConnection(ICE_CONFIG);

  bindPeerConnectionAEvents();
}

function bindPeerConnectionAEvents() {
  pcA.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: 'ice',
        candidate: e.candidate,
        target: 'B',
        matchId
      }));
    }
  };

  pcA.oniceconnectionstatechange = () => {
    console.log('ICE Connection State A:', pcA.iceConnectionState);
    const debugEl = document.getElementById('debug');
    if (debugEl) {
      debugEl.textContent = 'ICE: ' + pcA.iceConnectionState;
    }
  };

  pcA.ontrack = (event) => {
    console.log('Track ricevuto da B:', event.streams);
    const videoFromB = document.getElementById('videoFromB');
    videoFromB.srcObject = event.streams[0];
    videoFromB.play().catch(e => console.error('Play error on videoFromB:', e));
    document.getElementById('statusVideo').textContent = '● Video B ricevuto';
    
    const statusVideoEl = document.getElementById('status-video-received');
    if (statusVideoEl) {
      statusVideoEl.innerText = 'Video ricevuto ✓';
      statusVideoEl.className = 'badge badge-primary';
    }
    // Enable recording trigger
    const btnToggleRec = document.getElementById('btn-toggle-rec');
    if (btnToggleRec) {
      btnToggleRec.classList.remove('disabled');
      btnToggleRec.removeAttribute('disabled');
    }
  };
}

// Make globally accessible
window.avviaPartita = avviaPartita;

// ==========================================================================
// Role B: Local Camera Preview, Canvas, & WebRTC Streamer
// ==========================================================================

async function initB() {
  canvasEl = document.getElementById('preview');
  ctxEl = canvasEl.getContext('2d');

  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: true
  }).catch(err => {
    document.getElementById('statusB-cam').textContent = 'Errore fotocamera: ' + err.message;
    throw err;
  });

  videoEl = document.createElement('video');
  videoEl.srcObject = cameraStream;
  videoEl.autoplay = true;
  videoEl.playsInline = true;
  videoEl.muted = true;
  await videoEl.play();

  // Adatta canvas alle dimensioni video
  videoEl.addEventListener('loadedmetadata', () => {
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
  });
  if (videoEl.videoWidth) {
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
  }

  // Draw loop with digital zoom
  function drawLoop() {
    if (videoEl && videoEl.readyState >= 2) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      const cropW = vw / zoomLevel;
      const cropH = vh / zoomLevel;
      const cropX = (vw - cropW) / 2;
      const cropY = (vh - cropH) / 2;
      ctxEl.drawImage(videoEl, cropX, cropY, cropW, cropH, 0, 0, canvasEl.width, canvasEl.height);
    }
    requestAnimationFrame(drawLoop);
  }
  drawLoop();

  document.getElementById('statusB-cam').textContent = 'Fotocamera attiva. In attesa di avvio...';
}

async function startWebRTC() {
  pcB = new RTCPeerConnection(ICE_CONFIG);

  // Capture stream from B's canvas
  const canvasStream = canvasEl.captureStream(30);
  const audioTrack = cameraStream.getAudioTracks()[0];
  if (audioTrack) {
    canvasStream.addTrack(audioTrack);
  }
  canvasStream.getTracks().forEach(t => pcB.addTrack(t, canvasStream));

  pcB.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({
        type: 'ice',
        candidate: e.candidate,
        target: 'A',
        matchId
      }));
    }
  };

  pcB.oniceconnectionstatechange = () => {
    document.getElementById('statusB-cam').textContent = 'ICE: ' + pcB.iceConnectionState;
  };

  const offer = await pcB.createOffer();
  await pcB.setLocalDescription(offer);
  ws.send(JSON.stringify({
    type: 'offer',
    sdp: offer,
    matchId
  }));
}

// ==========================================================================
// Role C: Scoreboard OCR Camera Setup
// ==========================================================================

async function initCameraBoard() {
  console.log('initCameraBoard: Inizializzazione fotocamera e OCR su C...');
  try {
    const videoPreview = document.getElementById('video-preview-c');
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

    // Bind UI calibration selectors
    const selectRoi = document.getElementById('select-roi');
    selectRoi.addEventListener('change', (e) => {
      currentRoiField = e.target.value;
    });

    document.getElementById('btn-clear-roi').onclick = () => {
      calibPoints[currentRoiField] = [];
      saveCalibration();
      drawCalibrationLayer();
    };

    const slider = document.getElementById('slider-threshold');
    slider.oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      document.getElementById('val-threshold-slider').innerText = val === 0 ? 'Auto' : val;
    };

    // Tap corners listener
    canvasCalib.addEventListener('click', handleCalibrationTap);

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false
    }).catch(err => {
      handleCameraError(err, 'C');
      throw err;
    });
    
    videoPreview.srcObject = cameraStream;
    
    videoPreview.onloadedmetadata = () => {
      canvasCalib.width = videoPreview.videoWidth;
      canvasCalib.height = videoPreview.videoHeight;
      startPreviewLoopC();
      loadOpenCvDynamically();
    };
  } catch (err) {
    handleCameraError(err, 'C');
  }
}

// C's Zoom Rendering Loop (Standard Preview when OpenCV isn't running)
let previewLoopCActive = false;
function startPreviewLoopC() {
  previewLoopCActive = true;
  requestAnimationFrame(previewLoopC);
}

function previewLoopC() {
  if (!previewLoopCActive) return;
  if (ocrRunning) return;
  
  const video = document.getElementById('video-preview-c');
  if (video && video.readyState >= 2) {
    const w = video.videoWidth;
    const h = video.videoHeight;
    initCleanCanvasC(w, h);
    
    const cropW = w / zoomLevelC;
    const cropH = h / zoomLevelC;
    const cropX = (w - cropW) / 2;
    const cropY = (h - cropH) / 2;
    cleanCtxC.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, w, h);
    
    ctxCalib.drawImage(cleanCanvasC, 0, 0, w, h);
    drawCalibrationLayer();
  }
  requestAnimationFrame(previewLoopC);
}

// Global hidden canvas for C clean video (no overlay lines)
let cleanCanvasC = null;
let cleanCtxC = null;
function initCleanCanvasC(w, h) {
  if (!cleanCanvasC) {
    cleanCanvasC = document.createElement('canvas');
    cleanCanvasC.id = 'canvas-clean-c';
    cleanCanvasC.width = w;
    cleanCanvasC.height = h;
    cleanCtxC = cleanCanvasC.getContext('2d');
  } else {
    cleanCanvasC.width = w;
    cleanCanvasC.height = h;
  }
}

// Camera Error Helper
function handleCameraError(err, roleLabel) {
  console.error(`Errore fotocamera su ${roleLabel}:`, err);
  let msg = `Impossibile accedere alla fotocamera: ${err.message}`;
  if (err.name === 'NotAllowedError') {
    msg = "Permesso fotocamera negato. Consenti l'accesso alla fotocamera.";
  } else if (err.name === 'NotFoundError') {
    msg = "Nessuna fotocamera trovata.";
  }
  
  const errorEl = document.getElementById(roleLabel === 'B' ? 'statusB-cam' : 'status-ocr-c');
  if (errorEl) {
    if (roleLabel === 'B') {
      errorEl.textContent = "Errore Camera";
    } else {
      errorEl.innerText = "Errore Camera";
      errorEl.className = "badge badge-error";
    }
  }
  alert(msg);
}

// Setup zoom button event listeners
function setupZoomEventListeners() {
  // B's zoom controls
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const zoomLabel = document.getElementById('zoomLabel');

  if (zoomInBtn && zoomOutBtn && zoomLabel) {
    zoomInBtn.onclick = () => {
      zoomLevel = Math.min(3.0, parseFloat((zoomLevel + 0.5).toFixed(1)));
      zoomLabel.textContent = zoomLevel + 'x';
    };
    zoomOutBtn.onclick = () => {
      zoomLevel = Math.max(1.0, parseFloat((zoomLevel - 0.5).toFixed(1)));
      zoomLabel.textContent = zoomLevel + 'x';
    };
  }

  // C's zoom controls
  const zoomInBtnC = document.getElementById('btn-zoom-in-c');
  const zoomOutBtnC = document.getElementById('btn-zoom-out-c');
  const zoomLabelC = document.getElementById('label-zoom-c');

  if (zoomInBtnC && zoomOutBtnC && zoomLabelC) {
    zoomInBtnC.onclick = () => {
      zoomLevelC = Math.min(3.0, parseFloat((zoomLevelC + 0.5).toFixed(1)));
      zoomLabelC.textContent = zoomLevelC + 'x';
    };
    zoomOutBtnC.onclick = () => {
      zoomLevelC = Math.max(1.0, parseFloat((zoomLevelC - 0.5).toFixed(1)));
      zoomLabelC.textContent = zoomLevelC + 'x';
    };
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
  const hiddenVideo = document.getElementById('videoFromB');
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

  // 2. Draw TV Scoreboard Overlay
  drawScoreboardOverlay(ctxA, canvasA.width, canvasA.height);

  requestAnimationFrame(drawBroadcastLoop);
}

function drawScoreboardOverlay(ctx, w, h) {
  const overlayW = 600;
  const overlayH = 65;
  const x = (w - overlayW) / 2;
  const y = h - overlayH - 40; 

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetY = 5;

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; // Deep glass slate
  ctx.beginPath();
  ctx.roundRect(x, y, overlayW, overlayH, 8);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Home block (Left)
  ctx.fillStyle = '#3b82f6'; 
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

  // Divider
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 220, y + 10);
  ctx.lineTo(x + 220, y + overlayH - 10);
  ctx.stroke();

  // Game clock
  ctx.fillStyle = '#f59e0b'; // Amber LED
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
  ctx.fillStyle = '#ef4444'; 
  ctx.beginPath();
  ctx.roundRect(x + 455, y + 5, 140, overlayH - 10, 6);
  ctx.fill();
  
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gameState.awayTeam, x + 525, y + 37);

  // Draw Fouls Bar Below
  const foulsY = y + overlayH + 4;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.beginPath();
  ctx.roundRect(x + 50, foulsY, overlayW - 100, 24, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.stroke();

  ctx.fillStyle = '#94a3b8';
  ctx.font = '600 11px Inter, sans-serif';
  
  ctx.textAlign = 'left';
  ctx.fillText(`FALLI: ${gameState.homeFouls}`, x + 65, foulsY + 16);

  ctx.textAlign = 'right';
  ctx.fillText(`FALLI: ${gameState.awayFouls}`, x + overlayW - 65, foulsY + 16);

  ctx.restore();
}

// Official State Update & Refresh UI Elements on A
function updateGameStateField(field, val, isManual = false) {
  gameState[field] = val;
  
  if (field === 'homeScore') {
    document.getElementById('val-home-score').innerText = val;
    if (isManual) {
      manualOverride.homeScore = true;
      ocrMatchCount.homeScore = 0;
      document.getElementById('badge-home-manual').classList.remove('hidden');
    }
  } else if (field === 'awayScore') {
    document.getElementById('val-away-score').innerText = val;
    if (isManual) {
      manualOverride.awayScore = true;
      ocrMatchCount.awayScore = 0;
      document.getElementById('badge-away-manual').classList.remove('hidden');
    }
  } else if (field === 'clock') {
    document.getElementById('val-clock').value = val;
    if (isManual) {
      manualOverride.clock = true;
      ocrMatchCount.clock = 0;
      document.getElementById('badge-clock-manual').classList.remove('hidden');
    }
  } else if (field === 'quarter') {
    document.getElementById('val-quarter').innerText = val;
    if (isManual) {
      manualOverride.quarter = true;
      ocrMatchCount.quarter = 0;
      document.getElementById('badge-quarter-manual').classList.remove('hidden');
    }
  } else if (field === 'homeFouls') {
    document.getElementById('val-home-fouls').innerText = val;
    if (isManual) {
      manualOverride.homeFouls = true;
      ocrMatchCount.homeFouls = 0;
    }
  } else if (field === 'awayFouls') {
    document.getElementById('val-away-fouls').innerText = val;
    if (isManual) {
      manualOverride.awayFouls = true;
      ocrMatchCount.awayFouls = 0;
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

window.adjustClock = function(seconds) {
  let parts = gameState.clock.split(':');
  let min = parseInt(parts[0], 10);
  let sec = parseInt(parts[1], 10);
  let totalSecs = min * 60 + sec + seconds;
  totalSecs = Math.max(0, totalSecs);
  let newMin = Math.floor(totalSecs / 60);
  let newSec = totalSecs % 60;
  let newClock = `${newMin.toString().padStart(2, '0')}:${newSec.toString().padStart(2, '0')}`;
  updateGameStateField('clock', newClock, true);
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
      updateGameStateField('clock', newClock, false);
    }, 1000);
  }
}

// Handle data payload received from OCR Device C
function handleReceivedOcrData(data) {
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
    let curSecs = clockToSeconds(gameState.clock);
    let newSecs = clockToSeconds(data.clock);
    let diff = curSecs - newSecs;
    if ((diff >= 0 && diff <= 3) || newSecs === 600 || newSecs === 0) {
      updateGameStateField('clock', data.clock, false);
    }
  }

  // 5. Fouls
  if (!manualOverride.homeFouls) {
    if (data.homeFouls >= gameState.homeFouls || data.homeFouls === 0) {
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

const opfsWorkerCode = `
  let fileHandle = null;
  let accessHandle = null;
  let offset = 0;

  self.onmessage = async (e) => {
    const { type, handle, chunk } = e.data;
    
    if (type === 'init') {
      try {
        fileHandle = handle;
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
    recording = false;
    document.getElementById('screen-director').classList.remove('recording');
    btn.innerText = 'Preparo video...';
    btn.classList.add('disabled');
    btn.setAttribute('disabled', 'true');
    
    if (mediaRecorder) {
      mediaRecorder.stop();
    }
  } else {
    try {
      if ('wakeLock' in navigator) {
        try {
          wakeLockSentinel = await navigator.wakeLock.request('screen');
          console.log('Screen Wake Lock attivato.');
        } catch (wlErr) {
          console.warn('Errore Screen Wake Lock:', wlErr);
        }
      }

      const root = await navigator.storage.getDirectory();
      recordFileHandle = await root.getFileHandle('partita.mp4', { create: true });
      
      const blob = new Blob([opfsWorkerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      opfsWorker = new Worker(workerUrl);
      
      opfsWorker.postMessage({ type: 'init', handle: recordFileHandle });
      
      opfsWorker.onmessage = (e) => {
        if (e.data.type === 'error') {
          console.error('OPFS Worker Error:', e.data.error);
        } else if (e.data.type === 'ready') {
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
  const canvasStream = canvasA.captureStream(30); 
  let mimeType = 'video/mp4';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = ''; 
  }
  
  mediaRecorder = new MediaRecorder(canvasStream, { mimeType });
  
  mediaRecorder.ondataavailable = async (event) => {
    if (event.data && event.data.size > 0 && opfsWorker) {
      const buffer = await event.data.arrayBuffer();
      opfsWorker.postMessage({ type: 'write', chunk: buffer }, [buffer]);
    }
  };
  
  mediaRecorder.onstop = async () => {
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
    
    if (wakeLockSentinel) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
    }
    
    clearInterval(recordTimerInterval);
  };
  
  mediaRecorder.start(1000); 
  
  recording = true;
  document.getElementById('screen-director').classList.add('recording');
  const btn = document.getElementById('btn-toggle-rec');
  btn.innerText = 'Ferma Registrazione';
  btn.classList.remove('disabled');
  btn.removeAttribute('disabled');
  
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
// OpenCV.js Image Processing & 7-Segment OCR Loop (runs on C)
// ==========================================================================
let ocrRunning = false;
let cap = null;
let srcFrame = null;

function loadOpenCvDynamically() {
  const statusBadge = document.getElementById('status-opencv');
  
  if (typeof cv !== 'undefined' && cv.Mat) {
    statusBadge.innerText = 'Pronto';
    statusBadge.className = 'badge badge-primary';
    startOcrLoop();
    return;
  }
  
  statusBadge.innerText = 'Caricamento OpenCV...';
  statusBadge.className = 'badge badge-neutral';

  let script = document.getElementById('opencv-script');
  if (!script) {
    script = document.createElement('script');
    script.id = 'opencv-script';
    script.src = 'libs/opencv.js';
    
    script.onerror = () => {
      console.error('Errore caricamento OpenCV.js');
      statusBadge.innerText = 'Errore OpenCV';
      statusBadge.className = 'badge badge-error';
      alert('OpenCV non trovato. Riavvia il server.');
    };
    
    script.onload = () => {
      console.log('OpenCV.js caricato, in attesa del runtime...');
      waitForCvReady();
    };
    
    document.head.appendChild(script);
  } else {
    waitForCvReady();
  }
}

function waitForCvReady() {
  const statusBadge = document.getElementById('status-opencv');
  if (typeof cv !== 'undefined' && cv.Mat) {
    statusBadge.innerText = 'Pronto';
    statusBadge.className = 'badge badge-primary';
    startOcrLoop();
  } else {
    setTimeout(waitForCvReady, 200);
  }
}

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

function drawCalibrationLayer() {
  for (const [field, points] of Object.entries(calibPoints)) {
    const isCurrent = field === currentRoiField;
    ctxCalib.fillStyle = roiColors[field];
    ctxCalib.strokeStyle = roiColors[field];
    ctxCalib.lineWidth = isCurrent ? 5 : 2;

    points.forEach((p, idx) => {
      ctxCalib.beginPath();
      ctxCalib.arc(p.x, p.y, isCurrent ? 8 : 4, 0, 2 * Math.PI);
      ctxCalib.fill();
      ctxCalib.font = '16px Inter, sans-serif';
      ctxCalib.fillStyle = '#fff';
      ctxCalib.fillText(idx + 1, p.x + 10, p.y - 10);
      ctxCalib.fillStyle = roiColors[field];
    });

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

function startOcrLoop() {
  ocrRunning = true;
  cap = new cv.VideoCapture(document.getElementById('video-preview-c'));
  srcFrame = new cv.Mat(canvasCalib.height, canvasCalib.width, cv.CV_8UC4);
  
  requestAnimationFrame(ocrProcessFrame);
}

function ocrProcessFrame() {
  if (!ocrRunning) return;

  try {
    const video = document.getElementById('video-preview-c');
    if (video && video.readyState >= 2) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      initCleanCanvasC(w, h);
      
      const cropW = w / zoomLevelC;
      const cropH = h / zoomLevelC;
      const cropX = (w - cropW) / 2;
      const cropY = (h - cropH) / 2;
      cleanCtxC.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, w, h);
      
      ctxCalib.drawImage(cleanCanvasC, 0, 0, w, h);
      drawCalibrationLayer();
      
      cap.read(srcFrame);
      
      for (const [field, points] of Object.entries(calibPoints)) {
        if (points.length === 4) {
          processRoiField(srcFrame, field, points);
        }
      }
      
      sendOcrStateToDirector();
    }
  } catch (err) {
    console.error('Errore loop OCR OpenCV:', err);
  }

  requestAnimationFrame(ocrProcessFrame);
}

function processRoiField(srcMat, field, points) {
  let targetW = 80;
  let targetH = 60;
  if (field === 'clock') targetW = 160;
  if (field === 'quarter' || field === 'homeFouls' || field === 'awayFouls') targetW = 40;

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

  let gray = new cv.Mat();
  cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

  let equalized = new cv.Mat();
  try {
    let clahe = new cv.createCLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(gray, equalized);
    clahe.delete();
  } catch (e) {
    cv.equalizeHist(gray, equalized);
  }

  let thresh = new cv.Mat();
  const sliderVal = parseInt(document.getElementById('slider-threshold').value, 10);
  
  if (sliderVal === 0) {
    cv.threshold(equalized, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
  } else {
    cv.threshold(equalized, thresh, sliderVal, 255, cv.THRESH_BINARY);
  }

  cv.imshow(`warped-${field}`, warped);
  cv.imshow(`thresh-${field}`, thresh);

  readDigitsFromThreshold(thresh, field, targetW, targetH);

  srcPts.delete();
  dstPts.delete();
  M.delete();
  warped.delete();
  gray.delete();
  equalized.delete();
  thresh.delete();
}

const segmentBoxes = [
  { name: 'A', x1: 8,  x2: 32, y1: 4,  y2: 10 },
  { name: 'B', x1: 30, x2: 36, y1: 8,  y2: 26 },
  { name: 'C', x1: 30, x2: 36, y1: 32, y2: 50 },
  { name: 'D', x1: 8,  x2: 32, y1: 48, y2: 54 },
  { name: 'E', x1: 4,  x2: 10, y1: 32, y2: 50 },
  { name: 'F', x1: 4,  x2: 10, y1: 8,  y2: 26 },
  { name: 'G', x1: 8,  x2: 32, y1: 25, y2: 33 }
];

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
  '0000000': 0
};

function readDigitsFromThreshold(threshMat, field, totalW, totalH) {
  const digitWidth = 40;
  const numDigits = Math.floor(totalW / digitWidth);
  let parsedValueStr = '';

  for (let d = 0; d < numDigits; d++) {
    const xOffset = d * digitWidth;
    const activeSegments = [];
    segmentBoxes.forEach(box => {
      const rect = new cv.Rect(xOffset + box.x1, box.y1, (box.x2 - box.x1), (box.y2 - box.y1));
      const subMat = threshMat.roi(rect);
      
      const whiteCount = cv.countNonZero(subMat);
      const totalPixels = subMat.rows * subMat.cols;
      const isActive = (whiteCount / totalPixels) > 0.30; 
      
      activeSegments.push(isActive);
      subMat.delete();
    });

    const digit = decodeSegmentPattern(activeSegments);
    if (digit !== null) {
      parsedValueStr += digit.toString();
    } else {
      parsedValueStr += '0'; 
    }
  }

  let finalVal = parseFieldResult(field, parsedValueStr);
  pushOcrHistory(field, finalVal);
}

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

    validateAndPublishOcrValue(field, votedVal);
  }
}

function validateAndPublishOcrValue(field, value) {
  let isValid = false;

  if (field === 'homeScore' || field === 'awayScore') {
    let prev = lastValidOcr[field];
    let diff = value - prev;
    if (diff >= 0 && diff <= 3) {
      lastValidOcr[field] = value;
      isValid = true;
    }
  } else if (field === 'clock') {
    let prevSecs = clockToSeconds(lastValidOcr.clock);
    let newSecs = clockToSeconds(value);
    let diff = prevSecs - newSecs;
    if ((diff >= 0 && diff <= 3) || newSecs === 600 || newSecs === 0) {
      lastValidOcr.clock = value;
      isValid = true;
    }
  } else if (field === 'quarter') {
    let prev = lastValidOcr.quarter;
    let diff = value - prev;
    if (diff === 0 || diff === 1) {
      lastValidOcr.quarter = value;
      isValid = true;
    }
  } else if (field === 'homeFouls' || field === 'awayFouls') {
    let prev = lastValidOcr[field];
    if (value >= prev || value === 0) {
      lastValidOcr[field] = value;
      isValid = true;
    }
  }

  const uiEl = document.getElementById(`ocr-val-${field}`);
  if (uiEl) {
    uiEl.innerText = lastValidOcr[field];
    uiEl.style.color = isValid ? '#f59e0b' : '#ef4444'; 
  }
}

function sendOcrStateToDirector() {
  const dataPacket = {
    homeScore: lastValidOcr.homeScore,
    awayScore: lastValidOcr.awayScore,
    clock: lastValidOcr.clock,
    quarter: lastValidOcr.quarter,
    homeFouls: lastValidOcr.homeFouls,
    awayFouls: lastValidOcr.awayFouls
  };

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'ocrData',
      matchId,
      data: dataPacket
    }));
  }
}
