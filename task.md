# Execution Checklist — C-to-A Video & Remote Calibration

- `[x]` Update WebSocket message routing in `server.js` for role 'C' signalling and calibration
- `[x]` Update HTML layouts in `public/index.html` (A's new panels and overlay canvas, C's simplified screen)
- `[x]` Add CSS rules for `#calibOverlay` and layout grids in `public/style.css`
- `[x]` Implement WebRTC video sender, resolution reporting (`videoInfo`), and remote calibration receiver in `public/app.js` (Role C)
- `[x]` Implement second WebRTC receiver, coordinate mapping, interactive overlay drawing, and calibration dispatch in `public/app.js` (Role A)
- `[x]` Verify local compilation and server startup
- `[x]` Sync modified files to workspace, commit, and deploy
