// SLAGLINE — grenade: the "Popper" HE grenade. A thrown projectile with
// gravity and wall bounces, a fixed 1.8 s fuse from the throw, then an
// explosion dealing 10-90 damage falling off over a 4.5 m radius.
// One grenade per actor per round; friendly fire is off, so only enemies
// take damage. All balance numbers come from CONFIG.
//
// Interfaces this file expects (owned by other lines):
//   world: colliders [{min,max} Vector3] for bounces, actors [actor].
//   actor: pos (Vector3, feet), height, alive, team, grenades (count),
//     takeDamage(hit). The throw direction comes from the actor's aim.
//   scene (optional): a three.js scene; when given, the grenade gets a
//     small visible mesh so the throw reads on screen. Logic runs without it.
//   hooks (optional): onThrow(actor), onExplode(position, victims),
//     onKill(victim, thrower, 'he') — main.js wires onKill to round.onKill.
import { CONFIG } from './config.js';
import * as THREE from 'three';

// Grenades fall with the same gravity as the player: one physical world,
const GRAVITY = CONFIG.player.gravity;
const RESTITUTION = 0.45;
const THROW_SPEED = 14;
const THROW_UP = 3.5;
const GRENADE_RADIUS = 0.09;

// Sphere vs AABB: push the sphere out along the closest-point normal and
function bounceAgainstColliders(pos, vel, colliders) {
  for (const box of colliders) {
    const cx = Math.max(box.min.x, Math.min(pos.x, box.max.x));
    const cy = Math.max(box.min.y, Math.min(pos.y, box.max.y));
    const cz = Math.max(box.min.z, Math.min(pos.z, box.max.z));
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    const dz = pos.z - cz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq >= GRENADE_RADIUS * GRENADE_RADIUS) continue;
    let nx = dx;
    let ny = dy;
    let nz = dz;
    let dist = Math.sqrt(distSq);
    if (dist < 1e-6) {
      // Centre inside the box: escape along the least-penetration axis.
      const px = Math.min(pos.x - box.min.x, box.max.x - pos.x);
      const py = Math.min(pos.y - box.min.y, box.max.y - pos.y);
      const pz = Math.min(pos.z - box.min.z, box.max.z - pos.z);
      if (px <= py && px <= pz) {
        nx = pos.x - box.min.x < box.max.x - pos.x ? -1 : 1;
        ny = 0;
        nz = 0;
        dist = px;
      } else if (py <= px && py <= pz) {
        nx = 0;
        ny = pos.y - box.min.y < box.max.y - pos.y ? -1 : 1;
        nz = 0;
        dist = py;
      } else {
        nx = 0;
        ny = 0;
        nz = pos.z - box.min.z < box.max.z - pos.z ? -1 : 1;
        dist = pz;
      }
    } else {
      nx /= dist;
      ny /= dist;
      nz /= dist;
    }
    pos.x = cx + nx * GRENADE_RADIUS;
    pos.y = cy + ny * GRENADE_RADIUS;
    pos.z = cz + nz * GRENADE_RADIUS;
    const vn = vel.x * nx + vel.y * ny + vel.z * nz;
    if (vn < 0) {
      vel.x -= (1 + RESTITUTION) * vn * nx;
      vel.y -= (1 + RESTITUTION) * vn * ny;
      vel.z -= (1 + RESTITUTION) * vn * nz;
    }
  }
}

export function createGrenade(scene, world, hooks = {}) {
  const g = CONFIG.grenade;
  const live = [];

  function explode(grenade) {
    const pos = grenade.pos;
    const victims = [];
    for (const actor of world.actors || []) {
      if (!actor || !actor.alive) continue;
      if (actor === grenade.thrower) continue;
      if (!CONFIG.economy.friendlyFire && actor.team === grenade.thrower.team) continue;
      const centre = actor.pos.clone();
      centre.y += (actor.height || CONFIG.player.standHeight) * 0.55;
      const dist = centre.distanceTo(pos);
      if (dist > g.radiusMeters) continue;
      // Linear falloff: 90 at the centre, 10 at the edge of the radius.
      const damage = g.damageMax - ((g.damageMax - g.damageMin) * dist) / g.radiusMeters;
      actor.takeDamage({
        amount: damage,
        zone: 'torso',
        shooter: grenade.thrower,
        weaponId: 'he',
        position: pos.clone(),
      });
      victims.push({ victim: actor, damage, distance: dist });
      if (!actor.alive && hooks.onKill) hooks.onKill(actor, grenade.thrower, 'he');
    }
    if (grenade.mesh && scene) scene.remove(grenade.mesh);
    if (hooks.onExplode) hooks.onExplode(pos.clone(), victims);
    return victims;
  }

  return {
    // Throw one grenade. Returns false when the actor has none left this
    throw(actor) {
      if (!actor || !actor.alive) return false;
      if ((actor.grenades || 0) <= 0) return false;
      actor.grenades -= 1;
      const eye = actor.pos.clone();
      eye.y += actor.height ? actor.height - 0.12 : CONFIG.player.standEye;
      const dir = new THREE.Vector3(
        -Math.sin(actor.yaw || 0) * Math.cos(actor.pitch || 0),
        Math.sin(actor.pitch || 0),
        -Math.cos(actor.yaw || 0) * Math.cos(actor.pitch || 0),
      ).normalize();
      const pos = eye.clone().addScaledVector(dir, 0.5);
      const vel = dir.clone().multiplyScalar(THROW_SPEED);
      vel.y += THROW_UP;
      let mesh = null;
      if (scene) {
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(GRENADE_RADIUS, 8, 6),
          new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.7 }),
        );
        mesh.position.copy(pos);
        scene.add(mesh);
      }
      live.push({ pos, vel, fuse: g.fuseSeconds, thrower: actor, mesh });
      if (hooks.onThrow) hooks.onThrow(actor);
      return true;
    },

    // Fixed-step tick: integrate, bounce, count the fuse down, explode.
    step(dt) {
      for (let i = live.length - 1; i >= 0; i -= 1) {
        const grenade = live[i];
        grenade.vel.y -= GRAVITY * dt;
        grenade.pos.addScaledVector(grenade.vel, dt);
        if (world.colliders) bounceAgainstColliders(grenade.pos, grenade.vel, world.colliders);
        // Floor: the map floor is y=0 in world space.
        if (grenade.pos.y < GRENADE_RADIUS) {
          grenade.pos.y = GRENADE_RADIUS;
          if (grenade.vel.y < 0) grenade.vel.y = -grenade.vel.y * RESTITUTION;
        }
        if (grenade.mesh) grenade.mesh.position.copy(grenade.pos);
        grenade.fuse -= dt;
        if (grenade.fuse <= 0) {
          explode(grenade);
          live.splice(i, 1);
        }
      }
    },

    // Live grenades in flight, for HUD/debug reads.

    // Clear in-flight grenades (called by round.startRound): a grenade
    reset() {
      for (const grenade of live) {
        if (grenade.mesh && scene) scene.remove(grenade.mesh);
      }
      live.length = 0;
    },
  };
}
