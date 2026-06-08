# Walkthrough — Video di C su A + Calibrazione Tabellone da A

We have successfully implemented remote calibration of the scoreboard (C) directly from the Director (A), along with streaming the live feed of C to A.

---

## Completed Implementations

### 1. WebSocket Signaling & Routing (`server.js`)
- Extended routing logic to handle signaling messages for role C (offers, answers, ICE candidates) marked with `role: 'C'`.
- Added routing for `'videoInfo'` (from C to A), `'calibration'` (from A to C), and `'calibrationAck'` (from C to A).

### 2. Webrtc Stream from C to A (`public/app.js`)
- Upon receiving `'start'`, C opens a second RTCPeerConnection (`pcC`) using the public Google STUN + fallback TURN configuration, and sends its video stream to A.
- C sends its native resolution via the `'videoInfo'` message once connected.
- A instantiates a receiver PeerConnection (`pcC_recv`) on receiving C's offer, and maps the stream directly to the `#videoFromC` video element.

### 3. Remote Calibration Canvas Overlay on A (`public/index.html`, `public/app.js`)
- A draws the 6 ROIs (Home Score, Away Score, Clock, Quarter, Home Fouls, Away Fouls) in 6 distinct colors overlaying the video feed.
- Clicking on `#videoFromC` scales the click coordinates from display size to C's native resolution (`cNativeWidth` / `cNativeHeight`) and saves them in the active ROI.
- Toggling the selected ROI highlights the active ROI boundary.
- Clicking "Invia calibrazione a C" sends the ROIs array to C, which is acknowledged by C via `'calibrationAck'`.
- Clicking "Reset" clears the calibration overlay and local state.

### 4. Headless C Device Configuration
- All local calibration selectors, buttons, threshold sliders, and click listeners have been removed from C's screen.
- C's interface is now clean and silent, displaying:
  - Fullscreen camera preview
  - Connection status badge
  - OpenCV runtime status badge
  - Small debug overlay panel displaying verified digits currently parsed by OCR.
- Fixed a potential runtime crash in OpenCV's image processing loop by safely checking for `slider-threshold` availability and defaulting threshold value to Otsu Auto (0) when not present in the DOM.

---

## Verification Results

- Verified script syntax compiles cleanly.
- WebSocket message flow is verified and correctly maps B's and C's separate signaling pathways.
