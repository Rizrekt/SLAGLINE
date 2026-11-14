// SLAGLINE — bomb: the breach charge. One Striker carries it each round
// (the player, when the player is a Striker; otherwise a seeded-random
// Striker). Planting is a 3.0 s channel inside a site zone, cancelled by
// moving more than 0.5 m or dying. Once planted the charge ticks 35 s with
// beeps that speed up; Sentinels defuse in 5.0 s (2.5 s with a kit). If the
// carrier dies the charge drops and any other Striker can pick it up.
// All numbers come from CONFIG.
//
// Interfaces this file expects (owned by other lines):
//   context bound by round.js: getPhase() ('FREEZE'|'LIVE'|'PLANTED'|'END'),
//     sites [{id:'A'|'B', name, center: Vector3, radius}], actors [actor],
//     hooks { onPlanted(site, planter), onDetonated(site),
//       onDefused(defuser), onPlantCancelled(actor),
//       onDefuseCancelled(actor), onPickup(actor), onBeep(timeLeft) }.
//   actor: pos (Vector3), alive, team, hasDefuseKit (bool).
import { CONFIG } from './config.js';

let context = {
  getPhase: () => 'FREEZE',
  sites: [],
  actors: [],
  hooks: {},
};

function horizontalDistance(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function siteAt(pos) {
  for (const site of context.sites || []) {
    const radius = site.radius || CONFIG.round.plantRadiusMeters;
    if (horizontalDistance(pos, site.center) <= radius) return site;
  }
  return null;
}

export const Bomb = {
  state: {
    carrier: null,
    planted: false,
    site: null,
    timeLeft: 0,
    planting: null,
    defusing: null,
    droppedPosition: null,
    lastBeepSecond: -1,
  },

  init(boundContext) {
    context = { ...context, ...boundContext, hooks: { ...context.hooks, ...(boundContext.hooks || {}) } };
  },

  resetRound(carrier) {
    Bomb.state.carrier = carrier || null;
    Bomb.state.planted = false;
    Bomb.state.site = null;
    Bomb.state.timeLeft = 0;
    Bomb.state.planting = null;
    Bomb.state.defusing = null;
    Bomb.state.droppedPosition = null;
    Bomb.state.lastBeepSecond = -1;
  },

  // Start (or continue) the plant channel. True when the channel is
  tryPlant(actor) {
    const R = CONFIG.round;
    if (!actor || !actor.alive) return false;
    if (Bomb.state.planted) return false;
    if (context.getPhase() !== 'LIVE') return false;
    if (Bomb.state.carrier !== actor) return false;
    const site = siteAt(actor.pos);
    if (!site) return false;
    if (Bomb.state.planting && Bomb.state.planting.actor === actor) return true;
    Bomb.state.planting = {
      actor,
      site,
      progress: 0,
      startPos: actor.pos.clone(),
    };
    return true;
  },

  // Start (or continue) the defuse channel. True when the channel is
  tryDefuse(actor) {
    const R = CONFIG.round;
    if (!actor || !actor.alive) return false;
    if (!Bomb.state.planted) return false;
    if (actor.team !== 'Sentinels') return false;
    if (context.getPhase() !== 'PLANTED') return false;
    if (horizontalDistance(actor.pos, Bomb.state.site.center) > CONFIG.round.plantRadiusMeters + 0.6) return false;
    if (Bomb.state.defusing && Bomb.state.defusing.actor === actor) return true;
    Bomb.state.defusing = {
      actor,
      progress: 0,
      duration: actor.hasDefuseKit ? R.defuseKitSeconds : R.defuseSeconds,
      startPos: actor.pos.clone(),
    };
    return true;
  },

  // Pick the dropped charge up. Any living Striker standing on it takes it.
  tryPickup(actor) {
    if (!actor || !actor.alive) return false;
    if (actor.team !== 'Strikers') return false;
    if (Bomb.state.planted || Bomb.state.carrier) return false;
    if (!Bomb.state.droppedPosition) return false;
    if (horizontalDistance(actor.pos, Bomb.state.droppedPosition) > 1.2) return false;
    Bomb.state.carrier = actor;
    Bomb.state.droppedPosition = null;
    if (context.hooks.onPickup) context.hooks.onPickup(actor);
    return true;
  },

  // Called by round.onKill when an actor dies: a dead carrier drops the
  onCarrierDeath(actor) {
    if (Bomb.state.planting && Bomb.state.planting.actor === actor) {
      Bomb.state.planting = null;
      if (context.hooks.onPlantCancelled) context.hooks.onPlantCancelled(actor);
    }
    if (Bomb.state.defusing && Bomb.state.defusing.actor === actor) {
      Bomb.state.defusing = null;
      if (context.hooks.onDefuseCancelled) context.hooks.onDefuseCancelled(actor);
    }
    if (Bomb.state.carrier === actor && !Bomb.state.planted) {
      Bomb.state.carrier = null;
      Bomb.state.droppedPosition = actor.pos.clone();
    }
  },

  // HUD reads: channel progress 0..1, and seconds left on a planted charge.
  plantProgress() {
    return Bomb.state.planting ? Bomb.state.planting.progress : 0;
  },

  defuseProgress() {
    return Bomb.state.defusing ? Bomb.state.defusing.progress : 0;
  },

  timeLeft() {
    return Bomb.state.planted ? Bomb.state.timeLeft : 0;
  },

  // Fixed-step tick: advance channels, tick the planted charge, beep,
  step(dt) {
    const R = CONFIG.round;
    const planting = Bomb.state.planting;
    if (planting) {
      const actor = planting.actor;
      const moved = horizontalDistance(actor.pos, planting.startPos);
      if (!actor.alive || moved > R.plantMoveCancelMeters || !siteAt(actor.pos)) {
        Bomb.state.planting = null;
        if (context.hooks.onPlantCancelled) context.hooks.onPlantCancelled(actor);
      } else {
        planting.progress += dt / R.plantChannelSeconds;
        if (planting.progress >= 1) {
          Bomb.state.planting = null;
          Bomb.state.planted = true;
          Bomb.state.site = planting.site;
          Bomb.state.timeLeft = R.chargeSeconds;
          Bomb.state.lastBeepSecond = -1;
          if (context.hooks.onPlanted) context.hooks.onPlanted(planting.site, actor);
        }
      }
    }
    const defusing = Bomb.state.defusing;
    if (defusing) {
      const actor = defusing.actor;
      const moved = horizontalDistance(actor.pos, defusing.startPos);
      if (
        !actor.alive
        || moved > R.plantMoveCancelMeters
        || !Bomb.state.planted
        || horizontalDistance(actor.pos, Bomb.state.site.center) > CONFIG.round.plantRadiusMeters + 0.6
      ) {
        Bomb.state.defusing = null;
        if (context.hooks.onDefuseCancelled) context.hooks.onDefuseCancelled(actor);
      } else {
        defusing.progress += dt / defusing.duration;
        if (defusing.progress >= 1) {
          Bomb.state.defusing = null;
          Bomb.state.planted = false;
          if (context.hooks.onDefused) context.hooks.onDefused(actor);
        }
      }
    }
    if (Bomb.state.planted) {
      Bomb.state.timeLeft -= dt;
      // Beeps: once a second, twice a second in the last 10 seconds.
      const rate = Bomb.state.timeLeft <= 10 ? 2 : 1;
      const second = Math.floor(Bomb.state.timeLeft * rate);
      if (second !== Bomb.state.lastBeepSecond) {
        Bomb.state.lastBeepSecond = second;
        if (context.hooks.onBeep) context.hooks.onBeep(Bomb.state.timeLeft);
      }
      if (Bomb.state.timeLeft <= 0) {
        Bomb.state.timeLeft = 0;
        Bomb.state.planted = false;
        if (context.hooks.onDetonated) context.hooks.onDetonated(Bomb.state.site);
      }
    }
    // Dropped charge: a Striker walking over it picks it up.
    if (!Bomb.state.planted && !Bomb.state.carrier && Bomb.state.droppedPosition) {
      for (const actor of context.actors || []) {
        if (actor && actor.alive && actor.team === 'Strikers') {
          if (Bomb.tryPickup(actor)) break;
        }
      }
    }
  },
};
