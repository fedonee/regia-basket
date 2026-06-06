# Walkthrough — CourtCast MVP Complete Rewrite & General Debug

We have successfully performed a complete rewrite of both the server-side signaling and the client-side roles to meet the requested specifications exactly.

---

## Architectural Changes & Updates

### 1. Server-Side Signaling (`server.js` & `package.json`)
- **Express & WS Dependencies**: Verified that `express` and `ws` are the only production dependencies. Removed external dependencies (like `uuid`) and generated shorter, native match IDs using pure Javascript `Math.random()`.
- **Match Registry (`rooms`)**: Maintained room mappings as a plain object `rooms[matchId] = { A: ws, B: ws, C: ws }`.
- **Targeted Message Routing**: Managed exact routing case switches for:
  - `join` (client -> server to register in room, notifying A of joining).
  - `start` (A -> server to forward start command to B).
  - `offer` (B -> server to forward to A).
  - `answer` (A -> server to forward to B).
  - `ice` (peers -> server to forward to target role).
  - `ocrData` (C -> server to forward to A for score updates).

### 2. Premium TV Broadcast Frontend (`public/index.html` & `public/style.css`)
- **Role B Screen**: Configured with a single full-page live preview `<canvas id="preview"></canvas>`, and large visible zoom buttons `[ − ] [ 1.0x ] [ + ]`. Disabled camera mirroring by selecting the back-facing camera (`facingMode: 'environment'`).
- **Role C Screen**: Setup a direct camera `<video id="video-preview-c">` preview and an overlay `#canvas-calibration` for setting calibration points, with zoom controls and an OpenCV status badge.
- **Role A Screen**: Director panel with team name setup, connection state indicators for B and C, start button `#btn-avvia` (disabled until B and C are connected), composite broadcast canvas `#canvas-broadcast`, manual score adjusts, and a recording toggle.

### 3. Client JS Logic (`public/app.js`)
- **Modular Signallers**: Defined role-specific handlers `handleMessageA`, `handleMessageB`, and `handleMessageC` mapping websocket routing cleanly.
- **WebRTC Handshake Flow**:
  - A clicking "Avvia" dispatches `'start'` and creates its `RTCPeerConnection`.
  - B receiving `'start'` instantiates `pcB`, adds the canvas stream, creates the offer, and sends it.
  - A receiving the offer sets description, creates the answer, and sends it back.
  - B receiving the answer finishes setRemoteDescription and flushes its ICE queue.
- **Local Zoom Managers**: Assigned separate zoom values (`zoomLevel` and `zoomLevelC`) and event bindings to prevent camera controls from conflicting on separate roles.
- **Robust OCR Digits Engine**: Kept sports logic checks, OPFS inline Web Worker recording, and OpenCV perspective warps to process segment boundaries accurately.

### 4. OpenCV Local Dev Check (`download-opencv.js`)
- Bypasses download and exits early if `./public/libs/opencv.js` already exists.

---

## Bug Fixes & Additional Enhancements

We identified and resolved the following issues:
1. **Duplicate statusB DOM Element ID**: Screen B had a status display element with `id="statusB"`, colliding with the director status monitor `statusB` on Screen A. We renamed the screen B element to `statusB-cam` and updated all JS handlers in Role B logic.
2. **Auto-connection for Role A on Page Reload**: If the director reloads the page with `?match=ID&role=A`, the client now automatically reconnects to the WebSocket signaling room so connection indicators continue functioning.
3. **Server Peer Joined Status Recall**: When Director A joins a room where B or C are already connected, the server immediately notifies A of their presence (`type: 'joined'`) so connection indicators update instantly without requiring B or C to reconnect.
4. **Manual Clock Controls**: Added explicit `-10s` and `+10s` buttons next to the clock input on screen A to simplify precise timing corrections.

---

## Verification Checklist

- [x] Dependencies and script checks in `package.json` -> OK
- [x] Server compile and listen test -> OK (Successfully tested booting on port 3001)
- [x] Clean WebRTC routing matches -> OK
- [x] UI buttons and state targets -> OK
- [x] Duplicate DOM element ID resolved -> OK
- [x] Director auto-signaling recall and connection -> OK
- [x] Git push -> Done
