// SLAGLINE — weapons: five weapons, one shared firing model for the player
// and every bot. All balance numbers live in CONFIG; this file only turns
// those numbers into behaviour. Hitscan raycast against map AABB colliders
// and actor body spheres. Spread and pellets draw from the seeded rng
// bound via Weapons.setWorld; nothing here uses an unseeded source.
//
// Interfaces this file expects (owned by other lines, duck-typed so the
// contract, not an import, is the coupling):
//   shooter (actor): pos (Vector3, feet), height, radius, yaw, pitch,
//     crouched (bool), airborne (bool), speed (m/s), armor (bool),
//     helmet (bool), alive (bool), team, takeDamage(hit), weapons
//     (the set built by createWeaponSet).
//   world (bound by main.js at boot): colliders [{min,max} Vector3],
//     actors [actor], rng (createRng instance).
//   hooks (optional, bound with the world): onShot(result),
//     onHit(hit), onKill(victim, shooter, weaponId), onDryFire(shooter),
import { CONFIG } from './config.js';
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// The world is bound once by main.js at boot. Weapons.fire keeps the
let world = null;
let hooks = {};

// Smallest positive ray-sphere hit distance, or null on a miss.
function raySphere(origin, dir, center, radius) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = ox * dir.x + oy * dir.y + oz * dir.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t > 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 > 0 ? t2 : null;
}

// Slab-method ray vs AABB. Returns hit distance or Infinity.
function rayAabb(origin, dir, min, max) {
  let tMin = 0;
  let tMax = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i += 1) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < lo[i] || o[i] > hi[i]) return Infinity;
    } else {
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tMin) tMin = t1;
      if (t2 < tMax) tMax = t2;
      if (tMin > tMax) return Infinity;
    }
  }
  return tMin;
}

// A direction inside a cone of `angle` radians around `dir`, uniformly
// distributed over the disc. Seeded: the same rng stream replays the shot.
function perturbDirection(dir, angle, rng) {
  if (angle <= 0) return dir.clone();
  const ref = Math.abs(dir.y) > 0.9 ? RIGHT : UP;
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(dir, u).normalize();
  const a = rng.range(0, Math.PI * 2);
  const r = angle * Math.sqrt(rng.random());
  return dir
    .clone()
    .addScaledVector(u, Math.cos(a) * r)
    .addScaledVector(v, Math.sin(a) * r)
    .normalize();
}

// Spread in radians for the shooter's current stance and weapon.
function spreadFor(set, def) {
  const s = CONFIG.spread;
  const shooter = set.actor;
  if (def.id === 'mule') return s.shotgunCone;
  const moving = (shooter.speed || 0) > 0.5;
  if (def.id === 'vigil') {
    if (!set.scoped) return s.sniperUnscoped;
    if (shooter.airborne) return s.rifleAir;
    if (moving) return s.rifleMoving;
    return s.sniperScopedStill;
  }
  let base;
  if (shooter.airborne) base = s.rifleAir;
  else if (shooter.crouched) base = s.rifleCrouch;
  else if (moving) base = s.rifleMoving;
  else base = s.rifleStill;
  let spread = base * (def.spreadMult || 1);
  if (set.consecutiveShots > s.bloomAfterShots) spread *= s.bloomMult;
  return spread;
}

export const Weapons = {
  setWorld(boundWorld, boundHooks = {}) {
    world = boundWorld;
    hooks = boundHooks;
  },

  // Fire the shooter's current weapon once (one trigger pull). Semi-auto
  fire(shooter, origin, dir) {
    if (!shooter || !shooter.weapons) return { fired: false, reason: 'no-weapon-set' };
    return shooter.weapons.fire(origin, dir);
  },

  // Pure damage model. Zone multipliers, distance falloff, helmet and
  computeDamage(weaponDef, zone, distanceMeters, victim) {
    const dmg = CONFIG.damage;
    let zoneMult;
    if (zone === 'head') {
      zoneMult = victim.helmet ? dmg.helmetHeadMult : (weaponDef.headMult || dmg.head);
    } else if (zone === 'limb') {
      zoneMult = dmg.limb;
    } else {
      zoneMult = dmg.torso;
    }
    let amount = weaponDef.damage * zoneMult;
    const range = weaponDef.effectiveRange;
    const ratio = distanceMeters / range;
    let falloff = 1;
    if (ratio > dmg.falloffStart) {
      const t = Math.min(1, (ratio - dmg.falloffStart) / (dmg.falloffEnd - dmg.falloffStart));
      falloff = 1 - (1 - dmg.falloffMin) * t;
    }
    amount *= falloff;
    if (victim.armor) amount *= dmg.armorMult;
    return amount;
  },

  // Body hit zones: head / torso / limb spheres built from the actor's
  bodyZones(actor) {
    const h = actor.height || CONFIG.player.standHeight;
    const p = actor.pos;
    return [
      { zone: 'head', center: new THREE.Vector3(p.x, p.y + h - 0.13, p.z), radius: 0.14 },
      { zone: 'torso', center: new THREE.Vector3(p.x, p.y + h * 0.62, p.z), radius: 0.32 },
      { zone: 'limb', center: new THREE.Vector3(p.x, p.y + h * 0.28, p.z), radius: 0.3 },
    ];
  },

  // Nearest body-zone hit on one actor, or null.
  rayHitsActor(origin, dir, actor) {
    let best = null;
    for (const zone of Weapons.bodyZones(actor)) {
      const d = raySphere(origin, dir, zone.center, zone.radius);
      if (d !== null && (!best || d < best.distance)) {
        best = {
          zone: zone.zone,
          distance: d,
          point: origin.clone().addScaledVector(dir, d),
        };
      }
    }
    return best;
  },

  // Nearest map collider hit distance, or Infinity when the ray is clear.
  rayHitsCollider(origin, dir) {
    if (!world || !world.colliders) return Infinity;
    let best = Infinity;
    for (const box of world.colliders) {
      const d = rayAabb(origin, dir, box.min, box.max);
      if (d < best) best = d;
    }
    return best;
  },
};

// Nearest enemy actor hit by a ray. Friendly fire is off by design, so
function nearestEnemyHit(origin, dir, shooter) {
  if (!world || !world.actors) return null;
  let best = null;
  for (const actor of world.actors) {
    if (!actor || actor === shooter || !actor.alive) continue;
    if (!CONFIG.economy.friendlyFire && actor.team === shooter.team) continue;
    const hit = Weapons.rayHitsActor(origin, dir, actor);
    if (hit && (!best || hit.distance < best.distance)) {
      best = { ...hit, victim: actor };
    }
  }
  return best;
}

export function createWeaponSet(actor) {
  const set = {
    actor,
    owned: {},
    currentId: 'p9',
    elapsed: 0,
    nextShotAt: 0,
    reloading: false,
    reloadEndAt: 0,
    shellsToLoad: 0,
    consecutiveShots: 0,
    lastShotAt: -1e9,
    recoilPitch: 0,
    scoped: false,

    current() {
      return set.owned[set.currentId] || null;
    },

    has(id) {
      return Boolean(set.owned[id]);
    },

    // Buying a weapon stocks it full: magazine + reserve from CONFIG.
    add(id) {
      const def = CONFIG.weapons[id];
      if (!def || set.owned[id]) return false;
      set.owned[id] = { def, mag: def.mag, reserve: def.reserve };
      return true;
    },

    switchTo(id) {
      if (!set.owned[id] || id === set.currentId) return false;
      set.reloading = false;
      set.shellsToLoad = 0;
      set.currentId = id;
      set.scoped = false;
      set.consecutiveShots = 0;
      set.recoilPitch = 0;
      return true;
    },

    ammo() {
      const w = set.current();
      if (!w) return { id: null, name: '', mag: 0, reserve: 0, magSize: 0 };
      return { id: w.def.id, name: w.def.name, mag: w.mag, reserve: w.reserve, magSize: w.def.mag };
    },

    // Current spread in radians, for the HUD crosshair gap.
    spreadNow() {
      const w = set.current();
      if (!w) return 0;
      return spreadFor(set, w.def);
    },

    reload() {
      const w = set.current();
      if (!w || set.reloading) return false;
      if (w.mag >= w.def.mag || w.reserve <= 0) return false;
      set.reloading = true;
      if (w.def.id === 'mule') {
        // Pump shotgun loads shell by shell and can be interrupted by firing.
        set.shellsToLoad = Math.min(w.def.mag - w.mag, w.reserve);
        set.reloadEndAt = set.elapsed + (w.def.reloadPerShellSeconds || 0.45);
      } else {
        set.shellsToLoad = 0;
        set.reloadEndAt = set.elapsed + w.def.reloadSeconds;
      }
      if (hooks.onReload) hooks.onReload(set.actor, w.def.id);
      return true;
    },

    // Fixed-step tick: recoil recovery and reload completion run on sim
    // time, never on wall-clock time, so replays stay deterministic.
    tick(dt) {
      set.elapsed += dt;
      const s = CONFIG.spread;
      if (set.elapsed - set.lastShotAt > s.recoilRecoverMs / 1000) {
        set.recoilPitch = 0;
        set.consecutiveShots = 0;
      }
      if (!set.reloading) return;
      const w = set.current();
      if (!w) {
        set.reloading = false;
        return;
      }
      if (set.elapsed < set.reloadEndAt) return;
      if (w.def.id === 'mule') {
        w.mag += 1;
        w.reserve -= 1;
        set.shellsToLoad -= 1;
        if (set.shellsToLoad > 0 && w.reserve > 0 && w.mag < w.def.mag) {
          set.reloadEndAt = set.elapsed + (w.def.reloadPerShellSeconds || 0.45);
        } else {
          set.reloading = false;
          set.shellsToLoad = 0;
        }
      } else {
        const transfer = Math.min(w.def.mag - w.mag, w.reserve);
        w.mag += transfer;
        w.reserve -= transfer;
        set.reloading = false;
      }
    },

    fire(origin, dir) {
      const w = set.current();
      if (!w) return { fired: false, reason: 'no-weapon' };
      if (!world || !world.rng) return { fired: false, reason: 'no-world' };
      // A reload blocks the shot — except a pump shotgun mid shell-load,
      if (set.reloading) {
        if (w.def.id === 'mule' && w.mag > 0) {
          set.reloading = false;
          set.shellsToLoad = 0;
        } else {
          return { fired: false, reason: 'reloading' };
        }
      }
      if (set.elapsed < set.nextShotAt) return { fired: false, reason: 'rate' };
      if (w.mag <= 0) {
        if (hooks.onDryFire) hooks.onDryFire(set.actor);
        set.reload();
        return { fired: false, dryFire: true, reason: 'empty' };
      }
      w.mag -= 1;
      set.nextShotAt = set.elapsed + 60 / w.def.fireRateRpm;
      set.lastShotAt = set.elapsed;
      set.consecutiveShots += 1;
      // Recoil kicks the aim up 0.35 degrees per shot; the controller
      const recoilDegrees = CONFIG.spread.recoilPerShotDegrees;
      set.recoilPitch += (recoilDegrees * Math.PI) / 180;

      const spread = spreadFor(set, w.def);
      const pelletCount = w.def.pellets || 1;
      const hits = [];
      const killed = [];
      for (let i = 0; i < pelletCount; i += 1) {
        const pelletDir = perturbDirection(dir, spread, world.rng);
        const wallDist = Weapons.rayHitsCollider(origin, pelletDir);
        const enemy = nearestEnemyHit(origin, pelletDir, set.actor);
        if (!enemy || enemy.distance >= wallDist) {
          hits.push({
            hit: false,
            point: origin.clone().addScaledVector(pelletDir, Math.min(wallDist, 200)),
            distance: Math.min(wallDist, 200),
          });
          continue;
        }
        const damage = Weapons.computeDamage(w.def, enemy.zone, enemy.distance, enemy.victim);
        enemy.victim.takeDamage({
          amount: damage,
          zone: enemy.zone,
          shooter: set.actor,
          weaponId: w.def.id,
          position: enemy.point,
        });
        const hit = {
          hit: true,
          victim: enemy.victim,
          zone: enemy.zone,
          damage,
          distance: enemy.distance,
          point: enemy.point,
        };
        hits.push(hit);
        if (hooks.onHit) hooks.onHit(hit);
        if (!enemy.victim.alive && !killed.includes(enemy.victim)) {
          killed.push(enemy.victim);
          if (hooks.onKill) hooks.onKill(enemy.victim, set.actor, w.def.id);
        }
      }
      const result = {
        fired: true,
        weaponId: w.def.id,
        hits,
        killed,
        recoilDegrees,
        spread,
        ammo: set.ammo(),
      };
      if (hooks.onShot) hooks.onShot(result);
      return result;
    },
  };

  set.add('p9');
  return set;
}
