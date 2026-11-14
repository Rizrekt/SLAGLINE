// SLAGLINE — shared body for player and bots.
// One Actor class for every combatant: health, armor, hit zones, death.
// Whoever controls the actor (keyboard input or bot brain) is a separate
// module; this file only knows the body. Damage numbers live in config.js.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const STAND_HEIGHT = CONFIG.player.standHeight;
const CROUCH_HEIGHT = CONFIG.player.crouchHeight;
const HEAD_HEIGHT = 0.28;

let nextActorId = 0;

export function createActor({ team, name, isPlayer }) {
  const actor = {
    id: nextActorId++,
    team,
    name,
    isPlayer: Boolean(isPlayer),
    botIndex: 0,

    // Body state. pos is the feet on the ground; yaw faces the look direction.
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    crouching: false,
    height: STAND_HEIGHT,

    // Health and protection.
    health: 100,
    maxHealth: 100,
    armor: false,
    helmet: false,

    // Economy and loadout (filled by weapons.js / economy.js).
    money: CONFIG.economy.startMoney,
    weapons: [],
    activeWeapon: 0,
    grenades: 0,
    hasDefuseKit: false,

    // Match stats, kept across rounds; reset by resetMatch().
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,

    alive: true,
    // Death animation progress: 0 upright, 1 flat on the floor. Advanced by
    fallProgress: 0,
    fadeProgress: 0,
    fadeOut: false,

    lastDamageFrom: null,
    lastDamageAt: -1,
  };

  // Eye position, used as the ray origin for shooting and seeing.
  function eyePos(out) {
    const eye = actor.crouching ? CONFIG.player.crouchEye : CONFIG.player.standEye;
    out.set(actor.pos.x, actor.pos.y + eye, actor.pos.z);
    return out;
  }

  // Chest position, the default aim point for bots.
  function chestPos(out) {
    out.set(actor.pos.x, actor.pos.y + actor.height * 0.65, actor.pos.z);
    return out;
  }

  // Head position, the high-value aim point at close range.
  function headPos(out) {
    out.set(actor.pos.x, actor.pos.y + actor.height - HEAD_HEIGHT * 0.5, actor.pos.z);
    return out;
  }

  // Axis-aligned hit boxes for the three damage zones. The boxes ignore yaw

  // Apply one hit. weapons.js already multiplied the base damage by the zone
  function takeDamage(hit) {
    if (!actor.alive) return { damageDealt: 0, killed: false };
    // Callers pass { amount, shooter, position } (weapons.js, grenade.js);
    let damage = hit.amount !== undefined ? hit.amount : hit.damage;
    if (hit.zone === 'head' && actor.helmet) {
      damage *= CONFIG.damage.helmetHeadMult / CONFIG.damage.head;
    }
    if (actor.armor) damage *= CONFIG.damage.armorMult;
    damage = Math.max(0, damage);
    actor.health -= damage;
    actor.lastDamageFrom = hit.shooter !== undefined ? hit.shooter : (hit.from || null);
    actor.lastDamageAt = hit.at !== undefined ? hit.at : -1;
    if (actor.health <= 0) {
      actor.health = 0;
      die();
      return { damageDealt: damage, killed: true };
    }
    return { damageDealt: damage, killed: false };
  }

  // Fall over; the body stays on the floor until the round module fades it.
  function die() {
    if (!actor.alive) return;
    actor.alive = false;
    actor.fallProgress = 0;
    actor.fadeProgress = 0;
    actor.fadeOut = false;
  }

  // Advance the death animation. Called every tick by the main loop.
  function update(dt) {
    if (!actor.alive && actor.fallProgress < 1) {
      actor.fallProgress = Math.min(1, actor.fallProgress + dt * 2.4);
    }
    if (actor.fadeOut && actor.fadeProgress < 1) {
      actor.fadeProgress = Math.min(1, actor.fadeProgress + dt / 1.5);
    }
  }

  function setCrouch(crouch) {
    actor.crouching = crouch;
    actor.height = crouch ? CROUCH_HEIGHT : STAND_HEIGHT;
  }

  // Start-of-round reset: body and health only. Money, weapons and armor
  function reset() {
    actor.health = actor.maxHealth;
    actor.alive = true;
    actor.fallProgress = 0;
    actor.fadeProgress = 0;
    actor.fadeOut = false;
    actor.lastDamageFrom = null;
    actor.lastDamageAt = -1;
    setCrouch(false);
  }

  // Start-of-match reset: stats and wallet back to the opening state.
  function resetMatch() {
    actor.kills = 0;
    actor.deaths = 0;
    actor.plants = 0;
    actor.defuses = 0;
    actor.money = CONFIG.economy.startMoney;
    actor.weapons = [];
    actor.activeWeapon = 0;
    actor.grenades = 0;
    actor.hasDefuseKit = false;
    actor.armor = false;
    actor.helmet = false;
    reset();
  }

  // Attach the methods to the actor itself and return it. A spread copy
  actor.eyePos = eyePos;
  actor.chestPos = chestPos;
  actor.headPos = headPos;
  actor.takeDamage = takeDamage;
  actor.die = die;
  actor.update = update;
  actor.setCrouch = setCrouch;
  actor.reset = reset;
  actor.resetMatch = resetMatch;
  return actor;
}
