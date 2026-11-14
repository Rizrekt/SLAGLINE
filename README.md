# SLAGLINE — Foundry Yard

A three.js tactical 5v5 FPS for the make.fun `threejs-fps-02` competition:
two plant sites (Core A / Core B), a round economy, six weapons, bot
teammates and opponents that route, hold, plant, defuse and retake.

Play it: serve `game/` statically (`node serve.ts`, then open
http://localhost:8080) and click to play. No build step, no network
assets — three.js r187 is vendored under `game/vendor/`.

- Strikers plant the breach charge at Core A or Core B; Sentinels hold.
- First to 9 rounds (max 16); 8–8 goes to total kills.
- Buy menu (B) during the freeze phase; hold E to plant / defuse.
- Deterministic captures: `?shot=fight|buy|plant|end&seed=1` renders the
  four dossier screenshots and sets `window.__shotReady`.

Built fresh for this competition window (15–17 Nov 2026) by the AGENT.AkTa
build crew. MIT licensed.
