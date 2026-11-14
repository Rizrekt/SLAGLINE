// SLAGLINE — player movement: acceleration, friction, gravity, crouch and
// jump, resolved as a box against the world's colliders one axis at a time,
// so a wall never swallows the player. The player IS an Actor (actor.js):
// the movement body and the damage body are the same object, synced every
// step. When the actor dies the player stops moving and the camera stays
// where the body fell until the round ends — no mid-round respawn.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const P = CONFIG.player;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const PITCH_LIMIT = 1.45;

export function createPlayer(colliders) {
  const player = {
    position: new THREE.Vector3(0, 0, 9.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: P.standEye,
    onGround: true,
    crouching: false,
    height: P.standHeight,
    // Distance walked on the ground, for the footstep hook in main.js.
    distanceWalked: 0,
  };
  // The actor this body belongs to, bound by main.js after the roster is
  let actor = null;
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function setActor(nextActor) {
    actor = nextActor || null;
    if (actor) syncActor();
  }

  // Keep the damage body on the movement body: position, facing, crouch.
  function syncActor() {
    if (!actor) return;
    actor.pos.copy(player.position);
    actor.yaw = player.yaw;
    actor.pitch = player.pitch;
    actor.crouching = player.crouching;
    actor.height = player.height;
  }

  // lift keeps the feet and the crown out of the horizontal tests, so
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - P.radius, y + lift, z - P.radius);
    probe.max.set(x + P.radius, y + height - lift, z + P.radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    if (actor && !actor.alive) return;
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, player.pitch - dy * sensitivity));
    syncActor();
  }

  function recoil(pitchKick, yawKick) {
    if (actor && !actor.alive) return;
    player.pitch = Math.min(PITCH_LIMIT, player.pitch + pitchKick);
    player.yaw += yawKick;
    syncActor();
  }

  // Place the player at a spawn point (round start): feet, facing, still.
  function teleport(x, y, z, yaw) {
    player.position.set(x, y, z);
    player.velocity.set(0, 0, 0);
    player.yaw = yaw;
    player.pitch = 0;
    player.onGround = true;
    syncActor();
  }

  function step(dt, keys) {
    // Dead: spectator, frozen in place. The camera keeps the death view
    if (actor && !actor.alive) return;

    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      player.height = P.crouchHeight;
      if (actor) actor.setCrouch(true);
    } else if (!crouching && player.crouching && !overlaps(player.position.x, player.position.y, player.position.z, P.standHeight, 0.02)) {
      player.crouching = false;
      player.height = P.standHeight;
      if (actor) actor.setCrouch(false);
    }
    const eyeTarget = player.crouching ? P.crouchEye : P.standEye;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(player.yaw);
      const cos = Math.cos(player.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = player.crouching ? P.crouchSpeed : P.walkSpeed;
    const blend = Math.min(1, (player.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    player.velocity.x += (wish.x * speed - player.velocity.x) * blend;
    player.velocity.z += (wish.z * speed - player.velocity.z) * blend;
    if (player.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      player.velocity.x *= damp;
      player.velocity.z *= damp;
    }

    if (keys.has('Space') && player.onGround) {
      player.velocity.y = P.jumpSpeed;
      player.onGround = false;
    }
    player.velocity.y -= P.gravity * dt;

    const nextX = player.position.x + player.velocity.x * dt;
    if (!overlaps(nextX, player.position.y, player.position.z, player.height, 0.04)) player.position.x = nextX;
    else player.velocity.x = 0;
    const nextZ = player.position.z + player.velocity.z * dt;
    if (!overlaps(player.position.x, player.position.y, nextZ, player.height, 0.04)) player.position.z = nextZ;
    else player.velocity.z = 0;

    player.position.y += player.velocity.y * dt;
    player.onGround = false;
    const hit = overlaps(player.position.x, player.position.y, player.position.z, player.height, 0);
    if (hit && player.velocity.y <= 0) {
      player.position.y = hit.max.y;
      player.velocity.y = 0;
      player.onGround = true;
    } else if (hit) {
      player.position.y = hit.min.y - player.height;
      player.velocity.y = 0;
    }
    if (player.position.y < 0) {
      player.position.y = 0;
      player.velocity.y = 0;
      player.onGround = true;
    }
    player.velocity.y = Math.max(-30, player.velocity.y);
    if (player.onGround) player.distanceWalked += Math.hypot(player.velocity.x, player.velocity.z) * dt;
    syncActor();
  }

  return {
    state: player,
    step,
    look,
    recoil,
    teleport,
    setActor,
    groundSpeed() {
      return Math.hypot(player.velocity.x, player.velocity.z);
    },
  };
}
