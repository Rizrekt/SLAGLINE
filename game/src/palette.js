// SLAGLINE — Foundry Yard palette. Dusk foundry: warm orange industry on
// cold grey concrete, fog fading from dark brown to ember. The first six keys
// (canvas/surface/hairline/accent/ink/muted) are the starter palette kept so
// older modules keep resolving; the rest is the Foundry Yard expansion.
export const PALETTE = {
  // Starter keys (kept).
  canvas: '#3a3a3d', // floor
  surface: '#565a60', // walls / buildings
  hairline: '#6b6f75', // cover crates, trim
  accent: '#e07b2a', // industrial orange
  ink: '#ffd9a0', // warm key light
  muted: '#5a6b7d', // cool fill light

  // Foundry Yard expansion.
  floor: '#3a3a3d',
  building: '#565a60',
  metal: '#7d838a',
  concrete: '#4a4a4d',
  crate: '#8a6a45',
  crateDark: '#5d4a33',
  barrel: '#a03a28',
  catwalk: '#3f444a',
  industry: '#e07b2a',
  hazard: '#f2c200',

  // Teams.
  striker: '#f06423',
  sentinel: '#2ec4b6',

  // Sites (deliberately different from team colors so the objective
  siteA: '#ff9f1c',
  siteB: '#b388ff',

  // Sky / fog / lights.
  sky: '#2b2320',
  fog: '#4a3423',
  lightWarm: '#ffd9a0',
  lightCool: '#5a6b7d',
};

// Fog band for depth: the far wall dissolves instead of ending in a hard edge.
export const FOG = {
  color: PALETTE.fog,
  near: 30,
  far: 70,
};


// Quick lookups for HUD / bot code that colors by team or site.
export const TEAM_COLORS = {
  strikers: PALETTE.striker,
  sentinels: PALETTE.sentinel,
};

export const SITE_COLORS = {
  A: PALETTE.siteA,
  B: PALETTE.siteB,
};
