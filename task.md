# Execution Checklist

- `[x]` Update `download-opencv.js` with early existence check.
- `[x]` Update `server.js` with the matches registry and clean routing functions.
- `[x]` Update `public/index.html` structure for Role B, add indicators and buttons for Role A, and remove redundant zoom controls.
- `[x]` Update `public/app.js` with the clean rewrite of B's local preview/canvas loop, B's WebRTC start, A's `avviaPartita()`, A/B/C WebSocket routing delegates, and zoom event listeners.
- `[x]` Verify server syntax and run build steps.
- `[x]` Copy modified files to the repository workspace and push to git/Render.
- `[x]` Fix duplicate DOM element ID statusB by renaming B's preview status to statusB-cam.
- `[x]` Implement auto-signaling WebSocket connection for director role A on page load.
- `[x]` Implement server peer joined status recall when director A joins.
- `[x]` Implement manual clock adjust +/- buttons.
- `[x]` Verify clean server start-up and routing.
- `[x]` Copy all files to the repository workspace, commit and push to git.
