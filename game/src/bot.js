// SLAGLINE — bot brain. One brain for every bot; only team, role and seeded stream differ.
// Fairness is structural: the brain NEVER reads an enemy position except through perception
// (field of view, range, line of sight) or shared team memory from a teammate that saw
// the enemy. There is no wallhack path in this file.
// World interface (main.js; every field read defensively, the brain runs unwired):
//   colliders: THREE.Box3[] (map.js); waypoints: pathTo(a,b)->nodes {.pos,.guardYaw},
//   holdNodesForSite('Core A'|'Core B', postPlant); sites: [{id:'A'|'B', center, radius}]
//   (or {A,B} map); spawns: {strikers, sentinels}: [{pos, yaw}]; actors: all, player incl.
//   rng: seeded, ONLY randomness; now(): sim seconds; fireWeapon(shooter, origin, dir)
//   teamMemory: optional {Strikers, Sentinels} callouts; bomb: optional {tryPlant, tryDefuse}
//   chargeTimeLeftSeconds(): optional seconds left on a planted charge
// Perception per update: {phase, plantedSite, chargePos, targetSite, shotEvents, plantBeepPos}
//   phase: FREEZE|LIVE|PLANTED|END; shotEvents: [{pos, team}] enemy shots since last tick
//   plantBeepPos: Vector3 of the planted charge, null when nothing is planted
import * as THREE from 'three';
import { CONFIG } from './config.js';

const BOT = CONFIG.bot;
const DEG = Math.PI / 180;
const WALK_SPEED = CONFIG.player.walkSpeed;
const CROUCH_SPEED = CONFIG.player.crouchSpeed;
const BODY_RADIUS = CONFIG.player.radius;

export const BOT_STATES = {
  SPAWN_HOLD: 'SPAWN_HOLD',
  ADVANCE: 'ADVANCE',
  HOLD: 'HOLD',
  ENGAGE: 'ENGAGE',
  REPOSITION: 'REPOSITION',
  INVESTIGATE: 'INVESTIGATE',
  PLANT: 'PLANT',
  DEFUSE: 'DEFUSE',
  RETREAT_SAVE: 'RETREAT_SAVE',
  DEAD: 'DEAD',
};

// Reused scratch vectors: the hot loop allocates nothing per frame.
const tmpEye = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const tmpMove = new THREE.Vector3();

// Segment vs AABB slab test. A wall between the eyes and the target blocks
function segmentHitsBox(a, b, box) {
  let tmin = 0;
  let tmax = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const axes = [
    [a.x, dx, box.min.x, box.max.x],
    [a.y, dy, box.min.y, box.max.y],
    [a.z, dz, box.min.z, box.max.z],
  ];
  for (let i = 0; i < 3; i += 1) {
    const origin = axes[i][0];
    const dir = axes[i][1];
    const lo = axes[i][2];
    const hi = axes[i][3];
    if (Math.abs(dir) < 1e-9) {
      if (origin < lo || origin > hi) return false;
    } else {
      let t1 = (lo - origin) / dir;
      let t2 = (hi - origin) / dir;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

function losClear(from, to, colliders) {
  for (let i = 0; i < colliders.length; i += 1) {
    if (segmentHitsBox(from, to, colliders[i])) return false;
  }
  return true;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function createBotBrain(actor, world) {
  const rng = world.rng;
  const botIndex = actor.botIndex || 0;
  // Think ticks are staggered per bot index so five brains never all decide
  let thinkTimer = botIndex * (BOT.thinkSeconds / 5);
  let state = BOT_STATES.SPAWN_HOLD;

  // Role assignment from the round module (setAssignment). Defaults keep the
  let role = actor.team === 'Sentinels' ? 'hold' : 'escort';
  let assignedSite = null;
  let targetSite = null;
  let holdYaw = actor.yaw;

  // Perception memory. lastSeenPos stays valid 4 s; the bot investigates a
  let visibleTarget = null;
  const lastSeenPos = new THREE.Vector3();
  let lastSeenAt = -100;
  let lastSeenValid = false;
  let reactionTimer = 0;
  let wasEngaged = false;

  // Aim state. The aim point turns toward the target at most 240 deg/s, so
  let aimYaw = actor.yaw;
  let aimPitch = 0;
  const aimPoint = new THREE.Vector3();
  let aimAtHead = false;

  // Burst state. A burst is 3-5 shots, then a 0.28-0.5 s gap during which
  let burstLeft = 0;
  let burstGapTimer = 0;
  let fireTimer = 0;
  let burstIndex = 0;

  // Movement state. path is a list of Vector3 waypoints (or a single direct
  let moveTarget = null;
  let path = [];
  let pathIndex = 0;
  let strafeDir = 1;
  let strafeTimer = 0;
  let holdUntil = 0;
  let holdBaseYaw = actor.yaw;
  let investigatePos = null;
  const investigatePoint = new THREE.Vector3();
  const strafePoint = new THREE.Vector3();
  // Target tracking for the lateral-speed aim penalty: the bot estimates how
  const trackedPos = new THREE.Vector3();
  let trackedAt = -100;
  let targetLateralSpeed = 0;

  // Shared team callouts. One object per team, written by any bot that sees
  function teamMemory() {
    if (!world.teamMemory) return null;
    if (!world.teamMemory[actor.team]) {
      world.teamMemory[actor.team] = { lastEnemyPos: null, at: -100, spottedCount: 0 };
    }
    return world.teamMemory[actor.team];
  }

  function now() {
    return world.now ? world.now() : 0;
  }

  function eye(out) {
    return actor.eyePos(out);
  }

  function currentWeapon() {
    // actor.weapons is the set object from createWeaponSet (weapons.js),
    if (!actor.weapons || !actor.weapons.current) return null;
    return actor.weapons.current();
  }

  function weaponDef() {
    const weapon = currentWeapon();
    if (!weapon) return null;
    return weapon.def || CONFIG.weapons[weapon.id] || null;
  }

  // Move toward a point with per-axis collision sliding, the same rule as
  function moveToward(target, dt, speed, face = true) {
    tmpMove.set(target.x - actor.pos.x, 0, target.z - actor.pos.z);
    const dist = Math.hypot(tmpMove.x, tmpMove.z);
    if (dist < 0.05) return true;
    tmpMove.x /= dist;
    tmpMove.z /= dist;
    const stepX = tmpMove.x * speed * dt;
    const stepZ = tmpMove.z * speed * dt;
    if (!hitsCollider(actor.pos.x + stepX, actor.pos.z, actor.height)) {
      actor.pos.x += stepX;
    }
    if (!hitsCollider(actor.pos.x, actor.pos.z + stepZ, actor.height)) {
      actor.pos.z += stepZ;
    }
    // Face where we walk; the aim point catches up at the turn-rate cap.
    if (face) actor.yaw = Math.atan2(-tmpMove.x, -tmpMove.z);
    return dist < 0.4;
  }

  const probe = new THREE.Box3();
  function hitsCollider(x, z, height) {
    const colliders = world.colliders || [];
    probe.min.set(x - BODY_RADIUS, actor.pos.y + 0.04, z - BODY_RADIUS);
    probe.max.set(x + BODY_RADIUS, actor.pos.y + height - 0.04, z + BODY_RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return true;
    }
    return false;
  }

  function setPathTo(targetPos) {
    path = [];
    pathIndex = 0;
    moveTarget = null;
    if (!targetPos) return;
    const waypoints = world.waypoints;
    if (waypoints && waypoints.pathTo) {
      const nodes = waypoints.pathTo(actor.pos, targetPos) || [];
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        // Node objects carry .pos (a Vector3, y = 2.4 on the Catwalk);
        if (n.pos) path.push(n.pos.clone());
        else path.push(new THREE.Vector3(n.x, 0, n.z));
      }
    }
    if (path.length === 0) path.push(new THREE.Vector3(targetPos.x, 0, targetPos.z));
    moveTarget = path[0];
  }

  function followPath(dt, speed) {
    if (!moveTarget) return true;
    const arrived = moveToward(moveTarget, dt, speed);
    if (arrived) {
      pathIndex += 1;
      if (pathIndex >= path.length) {
        moveTarget = null;
        return true;
      }
      moveTarget = path[pathIndex];
    }
    return false;
  }

  // Site ids in this file are 'A' / 'B'; waypoint zones are named
  function siteZoneName(site) {
    if (!site) return null;
    if (site === 'A' || site === 'Core A') return 'Core A';
    if (site === 'B' || site === 'Core B') return 'Core B';
    return null;
  }

  function siteCenter(site) {
    if (!site || !world.sites) return null;
    if (Array.isArray(world.sites)) {
      for (let i = 0; i < world.sites.length; i += 1) {
        const s = world.sites[i];
        if (s.id === site || s.name === site || s.name === siteZoneName(site)) {
          return s.center || s.pos || null;
        }
      }
      return null;
    }
    return world.sites[site] || world.sites[siteZoneName(site)] || null;
  }

  // Hold node for this bot: a waypoint node flagged hold for the role/site.
  function holdNodeFor(postPlant) {
    const waypoints = world.waypoints;
    const zone = siteZoneName(assignedSite || targetSite);
    if (waypoints && waypoints.holdNodesForSite && zone) {
      const nodes = waypoints.holdNodesForSite(zone, postPlant) || [];
      if (nodes.length > 0) return nodes[botIndex % nodes.length];
    }
    return null;
  }

  function holdPointFor() {
    const node = holdNodeFor(false);
    if (node) return new THREE.Vector3(node.pos.x, 0, node.pos.z);
    const center = siteCenter(assignedSite || targetSite);
    if (center) {
      const away = actor.team === 'Sentinels' ? 3 : -3;
      return new THREE.Vector3(center.x + away, 0, center.z + away);
    }
    return new THREE.Vector3(actor.pos.x, 0, actor.pos.z);
  }

  function holdGuardYaw() {
    const node = holdNodeFor(false);
    if (node && node.guardYaw !== undefined) return node.guardYaw;
    return null;
  }

  function postPlantPoint(site) {
    const waypoints = world.waypoints;
    const zone = siteZoneName(site);
    if (waypoints && waypoints.holdNodesForSite && zone) {
      const nodes = waypoints.holdNodesForSite(zone, true) || [];
      if (nodes.length > 0) {
        const node = nodes[botIndex % nodes.length];
        return new THREE.Vector3(node.pos.x, 0, node.pos.z);
      }
    }
    const center = siteCenter(site);
    if (center) return new THREE.Vector3(center.x + 4, 0, center.z - 4);
    return new THREE.Vector3(actor.pos.x, 0, actor.pos.z);
  }

  // --- Perception: the only way this brain learns where enemies are. ---
  function scanEnemies() {
    const actors = world.actors || [];
    eye(tmpEye);
    let best = null;
    let bestDist = Infinity;
    const fovHalf = (BOT.fovDegrees / 2) * DEG;
    for (let i = 0; i < actors.length; i += 1) {
      const other = actors[i];
      if (other === actor || !other.alive || other.team === actor.team) continue;
      tmpTarget.copy(other.pos);
      const dx = tmpTarget.x - tmpEye.x;
      const dz = tmpTarget.z - tmpEye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > BOT.sightMeters) continue;
      // Horizontal field of view around the facing direction.
      const angleTo = Math.atan2(-dx, -dz);
      if (Math.abs(angleDiff(angleTo, actor.yaw)) > fovHalf) continue;
      // Line of sight: eye to chest, then eye to head. Either clear counts.
      other.chestPos(tmpTarget);
      let seen = losClear(tmpEye, tmpTarget, world.colliders || []);
      if (!seen) {
        other.headPos(tmpTarget);
        seen = losClear(tmpEye, tmpTarget, world.colliders || []);
      }
      if (!seen) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = other;
      }
    }
    return best ? { enemy: best, dist: bestDist } : null;
  }

  function rollReaction(firstAngleDeg) {
    let base = BOT.reactionBaseSeconds + rng.range(-BOT.reactionVarianceSeconds, BOT.reactionVarianceSeconds);
    if (state === BOT_STATES.HOLD && firstAngleDeg < 25) {
      // Holding and already facing the angle: the fastest reaction we allow.
      base = BOT.reactionHoldingSeconds + rng.range(-0.05, 0.05);
    } else if (firstAngleDeg > 70) {
      // Surprised from the side or behind: the slowest reaction we allow.
      base = BOT.reactionSurprisedSeconds + rng.range(-0.05, 0.05);
    }
    const def = weaponDef();
    if (def && def.id === 'vigil') base += BOT.sniperReactionExtraSeconds;
    return Math.max(0.15, base);
  }

  function think(perception) {
    const phase = (perception && perception.phase) || 'LIVE';
    const t = now();

    if (phase === 'FREEZE') {
      if (state !== BOT_STATES.SPAWN_HOLD) setState(BOT_STATES.SPAWN_HOLD);
      return;
    }
    if (phase === 'END') {
      if (state !== BOT_STATES.HOLD) setState(BOT_STATES.HOLD);
      return;
    }

    // --- See. ---
    const sight = scanEnemies();
    if (sight) {
      const firstSight = !visibleTarget;
      visibleTarget = sight.enemy;
      visibleTarget.chestPos(lastSeenPos);
      lastSeenAt = t;
      lastSeenValid = true;
      if (firstSight) {
        const dx = visibleTarget.pos.x - actor.pos.x;
        const dz = visibleTarget.pos.z - actor.pos.z;
        const angleTo = Math.atan2(-dx, -dz);
        const facingGap = Math.abs(angleDiff(angleTo, actor.yaw)) / DEG;
        reactionTimer = rollReaction(facingGap);
      }
      const memory = teamMemory();
      if (memory) {
        memory.lastEnemyPos = lastSeenPos.clone();
        memory.at = t;
        memory.spottedCount = (memory.spottedCount || 0) + 1;
      }
      // Estimate lateral speed from successive sightings for the aim model.
      if (trackedAt > 0 && t > trackedAt) {
        const moved = Math.hypot(
          visibleTarget.pos.x - trackedPos.x,
          visibleTarget.pos.z - trackedPos.z,
        );
        targetLateralSpeed = moved / (t - trackedAt);
      }
      trackedPos.copy(visibleTarget.pos);
      trackedAt = t;
      if (state !== BOT_STATES.ENGAGE && state !== BOT_STATES.DEAD) {
        setState(BOT_STATES.ENGAGE);
      }
    } else if (state === BOT_STATES.ENGAGE) {
      // Target lost: keep shooting the last seen spot for 1.2 s, then go look.
      if (t - lastSeenAt > BOT.loseTargetSeconds) {
        visibleTarget = null;
        if (lastSeenValid) {
          investigatePoint.copy(lastSeenPos);
          investigatePos = investigatePoint;
          setState(BOT_STATES.INVESTIGATE);
          setPathTo(investigatePoint);
        } else {
          resumeTask();
        }
      }
    }

    if (lastSeenValid && t - lastSeenAt > BOT.lastSeenMemorySeconds) {
      lastSeenValid = false;
    }

    // --- Hear. Gunshots within 30 m, footsteps close, plant beeps at 18 m. ---
    if (perception && perception.shotEvents) {
      for (let i = 0; i < perception.shotEvents.length; i += 1) {
        const shot = perception.shotEvents[i];
        if (!shot || shot.team === actor.team) continue;
        const d = Math.hypot(shot.pos.x - actor.pos.x, shot.pos.z - actor.pos.z);
        if (d <= BOT.hearShotMeters && state !== BOT_STATES.ENGAGE && state !== BOT_STATES.PLANT && state !== BOT_STATES.DEFUSE) {
          investigatePoint.set(shot.pos.x, 0, shot.pos.z);
          investigatePos = investigatePoint;
          setState(BOT_STATES.INVESTIGATE);
          setPathTo(investigatePoint);
          break;
        }
      }
    }
    if (perception && perception.plantBeepPos && actor.team === 'Sentinels') {
      const d = Math.hypot(perception.plantBeepPos.x - actor.pos.x, perception.plantBeepPos.z - actor.pos.z);
      if (d <= BOT.hearPlantBeepMeters && state === BOT_STATES.HOLD) {
        investigatePoint.set(perception.plantBeepPos.x, 0, perception.plantBeepPos.z);
        investigatePos = investigatePoint;
        setState(BOT_STATES.INVESTIGATE);
        setPathTo(investigatePoint);
      }
    }

    // --- Objective: the planted charge rewrites every task. ---
    const plantedSite = perception ? perception.plantedSite : null;
    if (plantedSite) {
      if (actor.team === 'Strikers') {
        if (state !== BOT_STATES.ENGAGE && state !== BOT_STATES.HOLD) {
          setState(BOT_STATES.HOLD);
          setPathTo(postPlantPoint(plantedSite));
        }
      } else if (state !== BOT_STATES.ENGAGE && state !== BOT_STATES.DEFUSE && state !== BOT_STATES.RETREAT_SAVE) {
        // Retake: advance to the planted site, then defuse.
        const chargePos = (perception && perception.chargePos) || siteCenter(plantedSite);
        if (chargePos) {
          setState(BOT_STATES.ADVANCE);
          setPathTo(new THREE.Vector3(chargePos.x, 0, chargePos.z));
        }
      }
      // Save the rifle: outnumbered 1v3+ with under 8 s on the charge means
      if (actor.team === 'Sentinels' && world.chargeTimeLeftSeconds) {
        const left = world.chargeTimeLeftSeconds();
        if (left < 8 && left > 0 && outnumberedBy(3)) {
          setState(BOT_STATES.RETREAT_SAVE);
          const spawns = world.spawns && world.spawns.sentinels;
          if (spawns && spawns.length > 0) {
            const spawn = spawns[botIndex % spawns.length];
            setPathTo(new THREE.Vector3(spawn.pos.x, 0, spawn.pos.z));
          } else if (perception && perception.chargePos) {
            const awayX = actor.pos.x - perception.chargePos.x;
            const awayZ = actor.pos.z - perception.chargePos.z;
            const len = Math.hypot(awayX, awayZ) || 1;
            setPathTo(new THREE.Vector3(
              actor.pos.x + (awayX / len) * 10,
              0,
              actor.pos.z + (awayZ / len) * 10,
            ));
          }
        }
      }
    }

    // --- Per-state decisions. ---
    if (state === BOT_STATES.SPAWN_HOLD) {
      // Live phase started: attackers push, defenders walk to their hold.
      if (actor.team === 'Strikers') {
        const site = targetSite || assignedSite || 'A';
        setState(BOT_STATES.ADVANCE);
        setPathTo(siteCenter(site) || actor.pos);
      } else {
        setState(BOT_STATES.ADVANCE);
        setPathTo(holdPointFor());
      }
    } else if (state === BOT_STATES.ADVANCE) {
      if (!moveTarget) {
        if (plantedSite && actor.team === 'Sentinels') {
          setState(BOT_STATES.DEFUSE);
        } else if (role === 'carrier' && actor.team === 'Strikers' && atSite(targetSite)) {
          setState(BOT_STATES.PLANT);
        } else {
          enterHold();
        }
      }
    } else if (state === BOT_STATES.HOLD) {
      // Sweep the guarded angle slowly around the hold facing, about +-35
      actor.yaw = holdBaseYaw + Math.sin(t * 0.5 + botIndex * 1.3) * 0.6;
      holdYaw = actor.yaw;
    } else if (state === BOT_STATES.INVESTIGATE) {
      if (!moveTarget) {
        holdUntil = t + 2;
        setState(BOT_STATES.HOLD);
        holdYaw = actor.yaw;
      }
    } else if (state === BOT_STATES.PLANT) {
      if (world.bomb && world.bomb.tryPlant) {
        const result = world.bomb.tryPlant(actor);
        if (result === 'planted') {
          setState(BOT_STATES.HOLD);
          setPathTo(postPlantPoint(targetSite || assignedSite || 'A'));
        } else if (result === 'denied') {
          setState(BOT_STATES.ADVANCE);
          setPathTo(siteCenter(targetSite || 'A') || actor.pos);
        }
        // 'planting' keeps the channel open; the bot stands still.
      } else {
        // No bomb module wired yet: hold at the site as a placeholder.
        enterHold();
      }
    } else if (state === BOT_STATES.DEFUSE) {
      if (world.bomb && world.bomb.tryDefuse) {
        const result = world.bomb.tryDefuse(actor);
        if (result === 'defused' || result === 'denied') resumeTask();
      } else {
        resumeTask();
      }
    } else if (state === BOT_STATES.REPOSITION) {
      if (!moveTarget) resumeTask();
    } else if (state === BOT_STATES.RETREAT_SAVE) {
      if (!moveTarget) setState(BOT_STATES.HOLD);
    }
  }

  function atSite(site) {
    const center = siteCenter(site);
    if (!center) return false;
    return Math.hypot(center.x - actor.pos.x, center.z - actor.pos.z) < CONFIG.round.plantRadiusMeters;
  }

  function outnumberedBy(n) {
    const actors = world.actors || [];
    let friends = 0;
    let foes = 0;
    for (let i = 0; i < actors.length; i += 1) {
      if (!actors[i].alive) continue;
      if (actors[i].team === actor.team) friends += 1;
      else foes += 1;
    }
    return foes - friends >= n;
  }

  function enterHold() {
    setState(BOT_STATES.HOLD);
    // Face the node's guard yaw when the graph gives one (a defender holds
    const guardYaw = holdGuardYaw();
    holdBaseYaw = guardYaw !== null ? guardYaw : actor.yaw;
    actor.yaw = holdBaseYaw;
    holdYaw = actor.yaw;
    holdUntil = now() + 2;
    // Crouch at cover about two holds in five; crouching tightens aim.
    actor.setCrouch(rng.chance(0.4));
  }

  function resumeTask() {
    actor.setCrouch(false);
    if (actor.team === 'Sentinels') {
      setState(BOT_STATES.ADVANCE);
      setPathTo(holdPointFor());
    } else {
      const site = targetSite || assignedSite || 'A';
      if (role === 'carrier' && atSite(site)) {
        setState(BOT_STATES.PLANT);
      } else {
        setState(BOT_STATES.ADVANCE);
        setPathTo(siteCenter(site) || actor.pos);
      }
    }
  }

  function setState(next) {
    if (state === next) return;
    if (next !== BOT_STATES.ENGAGE) {
      burstLeft = 0;
      burstGapTimer = 0;
      fireTimer = 0;
    }
    // Any entry into HOLD anchors the sweep on the current facing;
    if (next === BOT_STATES.HOLD) holdBaseYaw = actor.yaw;
    state = next;
  }

  // --- Firing: same weapons.js as the player, bot-side aim error only. ---
  function aimSigmaDegrees(dist, targetLateralSpeed) {
    const near = BOT.aimSigmaNearDegrees;
    const far = BOT.aimSigmaFarDegrees;
    const t = clamp01((dist - BOT.aimSigmaNearMeters) / (BOT.aimSigmaFarMeters - BOT.aimSigmaNearMeters));
    let sigma = near + (far - near) * t;
    if (targetLateralSpeed > 3) sigma *= BOT.aimMovingTargetMult;
    if (actor.crouching) sigma *= BOT.aimCrouchedMult;
    if (burstIndex > 0) sigma *= BOT.aimLaterBurstMult;
    const def = weaponDef();
    if (def && def.id === 'vigil') sigma *= BOT.sniperAimMult;
    return sigma;
  }

  function fireStep(dt) {
    if (state !== BOT_STATES.ENGAGE || !visibleTarget || !visibleTarget.alive) return;
    if (reactionTimer > 0) return;
    if (!world.fireWeapon) return;
    const def = weaponDef();
    if (!def) return;

    // Aim point is refreshed every frame, before the aim turns. The
    const dist = Math.hypot(
      visibleTarget.pos.x - actor.pos.x,
      visibleTarget.pos.z - actor.pos.z,
    );
    if (aimAtHead) visibleTarget.headPos(aimPoint);
    else visibleTarget.chestPos(aimPoint);

    // Turn the aim toward the target, capped so the bot never snaps.
    const maxTurn = BOT.aimMaxTurnDegreesPerSecond * DEG * dt;
    const dx = aimPoint.x - actor.pos.x;
    const dz = aimPoint.z - actor.pos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    const dy = aimPoint.y - (actor.pos.y + CONFIG.player.standEye);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    aimYaw += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(wantYaw, aimYaw)));
    aimPitch += Math.max(-maxTurn, Math.min(maxTurn, angleDiff(wantPitch, aimPitch)));

    if (burstLeft > 0) {
      fireTimer -= dt;
      if (fireTimer <= 0) {
        fireOneShot(def);
        burstLeft -= 1;
        fireTimer = 60 / def.fireRateRpm;
        if (burstLeft === 0) {
          burstGapTimer = def.id === 'vigil'
            ? BOT.sniperBurstGapSeconds
            : rng.range(BOT.burstGapMinSeconds, BOT.burstGapMaxSeconds);
        }
      }
    } else {
      burstGapTimer -= dt;
      strafeTimer -= dt;
      if (strafeTimer <= 0) {
        strafeDir = rng.chance(0.5) ? 1 : -1;
        strafeTimer = rng.range(0.4, 0.9);
      }
      if (burstGapTimer <= 0) {
        burstLeft = def.id === 'vigil' || def.id === 'mule' ? 1 : rng.int(BOT.burstMin, BOT.burstMax);
        burstIndex += 1;
        // One burst in five goes high at close range; decided once per burst.
        aimAtHead = dist < BOT.aimHeadMaxMeters && rng.chance(BOT.aimHeadChanceClose);
        fireTimer = 0;
      }
    }
  }

  function fireOneShot(def) {
    if (!visibleTarget) return;
    const dist = Math.hypot(
      visibleTarget.pos.x - actor.pos.x,
      visibleTarget.pos.z - actor.pos.z,
    );
    // Lateral speed comes from successive sightings (see think), never from
    const sigma = aimSigmaDegrees(dist, targetLateralSpeed) * DEG;
    // Gaussian error on two perpendicular axes, then re-normalize.
    eye(tmpEye);
    tmpDir.subVectors(aimPoint, tmpEye).normalize();
    tmpUp.set(0, 1, 0);
    tmpRight.crossVectors(tmpDir, tmpUp).normalize();
    tmpUp.crossVectors(tmpRight, tmpDir).normalize();
    const errYaw = rng.gauss() * sigma;
    const errPitch = rng.gauss() * sigma;
    tmpDir.addScaledVector(tmpRight, Math.tan(errYaw));
    tmpDir.addScaledVector(tmpUp, Math.tan(errPitch));
    tmpDir.normalize();
    world.fireWeapon(actor, tmpEye.clone(), tmpDir.clone());
  }

  function moveStep(dt) {
    if (state === BOT_STATES.ENGAGE) {
      // Strafe sideways during burst gaps, facing the enemy the whole time;
      if (burstLeft <= 0 && visibleTarget) {
        const dx = visibleTarget.pos.x - actor.pos.x;
        const dz = visibleTarget.pos.z - actor.pos.z;
        const len = Math.hypot(dx, dz) || 1;
        const sideX = (-dz / len) * strafeDir;
        const sideZ = (dx / len) * strafeDir;
        strafePoint.set(actor.pos.x + sideX * 0.9, 0, actor.pos.z + sideZ * 0.9);
        moveToward(strafePoint, dt, WALK_SPEED * 0.7, false);
      }
      return;
    }
    if (state === BOT_STATES.ADVANCE || state === BOT_STATES.INVESTIGATE
      || state === BOT_STATES.REPOSITION || state === BOT_STATES.RETREAT_SAVE) {
      const speed = state === BOT_STATES.INVESTIGATE ? WALK_SPEED * 0.75 : WALK_SPEED;
      followPath(dt, speed);
      return;
    }
    if (state === BOT_STATES.HOLD && moveTarget) {
      followPath(dt, WALK_SPEED);
    }
  }

  function update(dt, perception) {
    if (!actor.alive) {
      if (state !== BOT_STATES.DEAD) setState(BOT_STATES.DEAD);
      return;
    }
    thinkTimer -= dt;
    if (thinkTimer <= 0) {
      thinkTimer += BOT.thinkSeconds;
      think(perception || {});
    }
    if (reactionTimer > 0) reactionTimer -= dt;
    if (state === BOT_STATES.ENGAGE && actor.health < 30 && moveTarget === null) {
      const cover = holdPointFor();
      setState(BOT_STATES.REPOSITION);
      setPathTo(cover);
    }
    moveStep(dt);
    fireStep(dt);
    // Keep the aim roughly where the body faces when no target is tracked.
    if (!visibleTarget) {
      aimYaw = actor.yaw;
      aimPitch = actor.pitch;
    }
  }

  // Bot shopping rules (PREP 3.6): priority order, stop when money runs out.
  function planBuy() {
    const money = actor.money;
    const list = [];
    const isMidSentinel = actor.team === 'Sentinels' && role === 'mid';
    if (isMidSentinel && money >= 4300 + 1000) {
      list.push('vigil', 'helmet');
    } else if (money >= 2700 + 1000 + 300) {
      list.push('ar7', 'helmet', 'he');
    } else if (money >= 1250 + 650) {
      list.push('kestrel', 'armor');
      if (money >= 1250 + 650 + 300) list.push('he');
    } else if (money >= 1100 + 650 && (role === 'hold' || role === 'mid')) {
      list.push('mule', 'armor');
    } else if (money >= 800) {
      list.push('p50', 'he');
    } else if (money >= 300) {
      list.push('he');
    }
    if (actor.team === 'Sentinels' && money >= 200 && !list.includes('defuseKit')) {
      list.push('defuseKit');
    }
    return list;
  }

  function setAssignment(assignment) {
    if (!assignment) return;
    if (assignment.role) role = assignment.role;
    if (assignment.site) assignedSite = assignment.site;
    if (assignment.targetSite) targetSite = assignment.targetSite;
    if (assignment.holdYaw !== undefined) holdYaw = assignment.holdYaw;
  }

  return {
    update,
    setAssignment,
    planBuy,
    get state() {
      return state;
    },
    get role() {
      return role;
    },
    get visibleTarget() {
      return visibleTarget;
    },
    get lastSeenPos() {
      return lastSeenPos;
    },
  };
}
