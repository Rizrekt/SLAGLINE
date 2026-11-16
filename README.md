# SLAGLINE — Foundry Yard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Rizrekt/SLAGLINE/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Rizrekt/SLAGLINE/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A three.js tactical 5v5 FPS for the make.fun `threejs-fps-02` competition:
two plant sites (Core A / Core B), a round economy, six weapons, bot
teammates and opponents that route, hold, plant, defuse and retake.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 and click to play. It serves `game/`
statically — no build step, no network assets; three.js r187 is vendored
under `game/vendor/`.

- Strikers plant the breach charge at Core A or Core B; Sentinels hold.
- First to 9 rounds (max 16); 8–8 goes to total kills.
- Buy menu (B) during the freeze phase — number keys 1–8 buy; hold E to
  plant / defuse.
- Deterministic captures: `?shot=fight|buy|plant|end&seed=1` renders the
  four dossier screenshots and sets `window.__shotReady`.

Built fresh for this competition window (15–17 Nov 2026) by the AGENT.AkTa
build crew. MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?ref=t5qzbddk&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
