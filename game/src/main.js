// SLAGLINE — boot and the one loop. Builds the match from the module
// contracts (map, actors, weapons, round, economy, bomb, grenade, bots),
// runs a fixed 60 Hz sim, renders, and stages deterministic ?shot= frames
// for the four captures: fight / buy / plant / end.
import * as THREE from 'three';
import { PALETTE, FOG, TEAM_COLORS } from './palette.js';
import { CONFIG } from './config.js';
import { createRng } from './rng.js';
import { createMap } from './map.js';
import { Waypoints } from './waypoints.js';
import { createActor } from './actor.js';
import { createBotBrain } from './bot.js';
import { Weapons, createWeaponSet } from './weapons.js';
import { createGrenade } from './grenade.js';
import { createRound } from './round.js';
import { Economy } from './economy.js';
import { Bomb } from './bomb.js';
import { createPlayer } from './player.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createEffects } from './effects.js';
import { Audio, unlockAudio, setListenerPos } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = createRng(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(FOG.color), FOG.near, FOG.far);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);
const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.lightWarm), new THREE.Color(PALETTE.sky), 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.lightWarm), 3.2);
sun.position.set(18, 26, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
sun.shadow.camera.far = 70;
scene.add(sun);

const map = createMap(scene);
const colliders = map.colliders;
const hud = createHud();
const effects = createEffects(scene);

// --- Roster: the player plus nine bots, one Actor each. ---
const NAMES = {
  Strikers: ['You', 'Rook', 'Vex', 'Hale', 'Fable'],
  Sentinels: ['Sable', 'Wren', 'Onyx', 'Pike', 'Dusk'],
};
const actors = [];
const brains = new Map();
const meshes = new Map();
function addActor(team, name, isPlayer) {
  const actor = createActor({ team, name, isPlayer });
  actor.weapons = createWeaponSet(actor);
  actors.push(actor);
  return actor;
}
const playerActor = addActor('Strikers', 'You', true);
const strikerBots = NAMES.Strikers.slice(1).map((n) => addActor('Strikers', n, false));
const sentinelBots = NAMES.Sentinels.map((n) => addActor('Sentinels', n, false));
for (const actor of actors) actor.botIndex = actors.indexOf(actor) % 5;

const player = createPlayer(colliders);
player.setActor(playerActor);
const input = createInput(renderer.domElement, onLockChange);

// --- Bot bodies: simple team-coloured figures so enemies read on screen. ---
function makeBodyMesh(actor) {
  const color = new THREE.Color(TEAM_COLORS[actor.team.toLowerCase()]);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.05, 0.28),
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  body.position.y = 0.85; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xd8cfc0, roughness: 0.6 }));
  head.position.y = 1.55; head.castShadow = true;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x111111 }));
  visor.position.set(0, 1.56, -0.13);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.6 }));
  gun.position.set(0.2, 1.05, -0.2);
  g.add(body, head, visor, gun);
  scene.add(g);
  return g;
}
for (const bot of [...strikerBots, ...sentinelBots]) meshes.set(bot, makeBodyMesh(bot));

// --- Player viewmodel: a small gun fixed to the camera. ---
const viewmodel = new THREE.Group();
const vmBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.5),
  new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.4, metalness: 0.6 }));
const vmTip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12),
  new THREE.MeshStandardMaterial({ color: 0xe07b2a, roughness: 0.5 }));
vmTip.position.set(0, 0.02, -0.3);
viewmodel.add(vmBody, vmTip);
viewmodel.position.set(0.3, -0.24, -0.5);
camera.add(viewmodel);
let vmKick = 0;

// --- Shared sim state. ---
let simTime = 0;
let started = false;
let frozen = false;
let scoped = false;
let lastShotAt = -100;
let lastStepAt = 0;
let wasAlive = true;
let playerKills = 0;
let lastShooter = null;
const shotEvents = [];
const teamMemory = { Strikers: {}, Sentinels: {} };
const eye = new THREE.Vector3();
const dir = new THREE.Vector3();
const tmpV = new THREE.Vector3();

const world = {
  colliders,
  waypoints: Waypoints,
  sites: map.sites,
  spawns: map.spawns,
  actors,
  rng,
  now: () => simTime,
  fireWeapon(shooter, origin, d) {
    lastShooter = shooter;
    return Weapons.fire(shooter, origin, d);
  },
  teamMemory,
  bomb: {
    tryPlant: (a) => Bomb.tryPlant(a),
    tryDefuse: (a) => Bomb.tryDefuse(a),
  },
  chargeTimeLeftSeconds: () => Bomb.timeLeft(),
};
for (const bot of [...strikerBots, ...sentinelBots]) {
  brains.set(bot, createBotBrain(bot, world));
}

const grenade = createGrenade(scene, { colliders, actors }, {
  onThrow: (a) => { if (a === playerActor) Audio.play('click', a.pos); },
  onExplode: (pos) => { effects.explosion(pos); Audio.play('explosion', pos); },
  onKill: (victim, killer) => round.onKill(victim, killer),
});

Weapons.setWorld({ colliders, actors, rng }, {
  onShot(result) {
    const shooter = lastShooter;
    if (!shooter || !result.fired) return;
    shooter.eyePos(eye);
    const end = result.hits.length > 0 ? result.hits[0].point : tmpV.copy(eye).addScaledVector(dir, 40);
    effects.tracer(eye, end, TEAM_COLORS[shooter.team.toLowerCase()]);
    effects.muzzle(eye.clone().addScaledVector(dir, 0.7), dir);
    Audio.play(`shot_${result.weaponId}`, eye);
    shotEvents.push({ pos: eye.clone(), team: shooter.team });
    if (!result.hits[0] || !result.hits[0].hit) effects.impact(end);
  },
  onHit(hit) {
    if (lastShooter === playerActor) {
      hud.hitMarker(false, shot ? 4000 : 90);
      Audio.play('hit', hit.point);
    }
  },
  onKill(victim, killer) {
    round.onKill(victim, killer);
    if (killer === playerActor) {
      playerKills += 1;
      hud.hitMarker(true, shot ? 4000 : 120);
      Audio.play('kill', victim.pos);
    }
  },
  onDryFire(shooter) { if (shooter === playerActor) Audio.play('dryfire', shooter.pos); },
  onReload(shooter) { if (shooter === playerActor) Audio.play('reload', shooter.pos); },
});

const round = createRound(actors, {
  rng,
  player: playerActor,
  hooks: {
    onRoundStart(snap) {
      // Spawn: player first, then bots down each spawn line.
      player.teleport(map.spawns.strikers[0].pos.x, 0, map.spawns.strikers[0].pos.z, 0);
      strikerBots.forEach((b, i) => {
        const s = map.spawns.strikers[i + 1];
        b.pos.set(s.pos.x, 0, s.pos.z); b.yaw = s.yaw;
      });
      sentinelBots.forEach((b, i) => {
        const s = map.spawns.sentinels[i];
        b.pos.set(s.pos.x, 0, s.pos.z); b.yaw = s.yaw;
      });
      const roles = ['hold', 'hold', 'hold', 'hold', 'mid'];
      const holdSites = ['A', 'A', 'B', 'B', null];
      sentinelBots.forEach((b, i) => brains.get(b).setAssignment({
        role: roles[i], site: holdSites[i], targetSite: snap.targetSite,
      }));
      strikerBots.forEach((b, i) => brains.get(b).setAssignment({
        role: i < 2 ? 'escort' : 'lurk', site: null, targetSite: snap.targetSite,
      }));
      for (const bot of [...strikerBots, ...sentinelBots]) {
        for (const id of brains.get(bot).planBuy()) Economy.tryBuy(bot, id);
      }
      grenade.reset();
      hud.setRound(snap.roundNumber, snap.score);
      hud.setBanner(`Round ${snap.roundNumber} — take ${snap.targetSite === 'A' ? 'Core A' : 'Core B'}`);
      hud.hideBuy();
    },
    onPhase(phase, snap) {
      hud.setPhase(phase, Math.ceil(snap.timer));
      if (phase === 'PLANTED') {
        hud.setBanner('Charge planted — hold the site');
        Audio.play('plant_done', Bomb.state.site ? Bomb.state.site.center : playerActor.pos);
      }
    },
    onRoundEnd(snap, reason, winner) {
      hud.setRound(snap.roundNumber, snap.score);
      hud.setBanner(winner === 'Strikers'
        ? `Strikers take round ${snap.roundNumber} (${reason})`
        : `Sentinels hold round ${snap.roundNumber} (${reason})`);
      Audio.play(winner === 'Strikers' ? 'round_win' : 'round_lose', playerActor.pos);
    },
    onMatchEnd(snap, winner) {
      hud.setBanner(winner === 'Draw' ? 'Match drawn' : `${winner} win the match`);
      hud.showOverlay('end', snap.score);
      if (document.pointerLockElement) document.exitPointerLock();
    },
    onKill(victim, killer, snap) {
      hud.pushKillfeed(`${killer ? killer.name : '?'} ▸ ${victim.name}`);
      hud.setRound(snap.roundNumber, snap.score);
      hud.setKills(playerKills, playerActor.deaths);
    },
    onBeep(timeLeft) {
      if (Bomb.state.site) Audio.play('charge_beep', Bomb.state.site.center);
      hud.setPhase('PLANTED', Math.ceil(timeLeft));
    },
    onPickup(actor) {
      if (actor === playerActor) hud.setBanner('You picked up the charge');
    },
  },
});
round.setSites(map.sites);
round.startMatch();

hud.onPlay(() => {
  if (shot) return;
  if (round.matchOver) {
    for (const actor of actors) {
      actor.resetMatch();
      actor.weapons = createWeaponSet(actor);
    }
    playerKills = 0;
    round.startMatch();
    input.requestLock();
    return;
  }
  input.requestLock();
});
hud.onBuy((id) => {
  if (Economy.tryBuy(playerActor, id)) {
    Audio.play('buy', playerActor.pos);
    hud.refreshBuy(playerActor.money, playerActor.weapons);
  } else {
    Audio.play('buy_error', playerActor.pos);
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    unlockAudio();
    hud.hideOverlay();
  } else if (!round.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

function syncCamera() {
  const body = player.state;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const wantFov = scoped ? 28 : 74;
  if (camera.fov !== wantFov) { camera.fov = wantFov; camera.updateProjectionMatrix(); }
}

function aimAt(point) {
  const body = player.state;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function firePlayer() {
  const set = playerActor.weapons;
  const def = CONFIG.weapons[set.currentId];
  if (def && def.semi && simTime - lastShotAt < 0.12) return;
  playerActor.eyePos(eye);
  camera.getWorldDirection(dir);
  lastShooter = playerActor;
  const result = Weapons.fire(playerActor, eye.clone(), dir.clone());
  if (!result.fired) return;
  lastShotAt = simTime;
  player.recoil(0.0061, (rng.range(-1, 1)) * 0.0012);
  vmKick = 0.07;
}

function perception() {
  return {
    phase: round.phase,
    plantedSite: Bomb.state.planted && Bomb.state.site ? Bomb.state.site.id : null,
    chargePos: Bomb.state.planted && Bomb.state.site ? Bomb.state.site.center : null,
    targetSite: round.targetSite,
    shotEvents: shotEvents.splice(0, shotEvents.length),
    plantBeepPos: Bomb.state.planted && Bomb.state.site ? Bomb.state.site.center : null,
  };
}

function step(dt) {
  simTime += dt;
  // Hold E to run the plant / defuse channel.
  if (input.state.keys.has('KeyE')) {
    if (round.phase === 'LIVE') Bomb.tryPlant(playerActor);
    else if (round.phase === 'PLANTED') Bomb.tryDefuse(playerActor);
  }
  player.step(dt, input.state.keys);
  const perc = perception();
  for (const bot of [...strikerBots, ...sentinelBots]) brains.get(bot).update(dt, perc);
  round.step(dt);
  grenade.step(dt);
  for (const actor of actors) {
    actor.weapons.tick(dt);
    actor.update(dt);
  }
  effects.update(dt);
  // Footsteps every 2.4 m walked.
  if (player.distanceWalked - lastStepAt > 2.4) {
    lastStepAt = player.distanceWalked;
    Audio.play('step', playerActor.pos);
  }
  setListenerPos(playerActor.pos);
  if (vmKick > 0) vmKick = Math.max(0, vmKick - dt * 0.3);
  viewmodel.position.z = -0.5 + vmKick;
  // Bot bodies follow their actors; the dead fall flat and fade.
  for (const [actor, mesh] of meshes) {
    mesh.position.copy(actor.pos);
    mesh.rotation.y = actor.yaw;
    mesh.rotation.x = -Math.PI / 2 * actor.fallProgress;
    mesh.scale.y = actor.crouching ? 0.75 : 1;
    mesh.visible = actor.fadeProgress < 1;
  }
  if (playerActor.alive !== wasAlive) {
    wasAlive = playerActor.alive;
    if (!wasAlive) hud.setBanner('You are down — the round plays on');
  }
  syncHud();
}

function syncHud() {
  const ammo = playerActor.weapons.ammo();
  hud.setAmmo(ammo.mag, ammo.reserve);
  hud.setMoney(playerActor.money);
  hud.setKills(playerKills, playerActor.deaths);
  hud.setHealth(Math.ceil(playerActor.health));
  hud.setWeapon(ammo.name, playerActor.weapons.currentId);
  hud.setTimer(Math.ceil(round.timer));
  hud.setPhase(round.phase, Math.ceil(round.timer));
  hud.setZone(map.zoneAt(playerActor.pos));
  hud.setCarrier(round.carrier === playerActor);
  hud.setPlant(Bomb.plantProgress(), Bomb.defuseProgress(), Bomb.state.planted);
  hud.setScope(scoped);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    if (input.state.firing) firePlayer();
    for (const code of input.takePressed()) {
      if (code === 'KeyR') playerActor.weapons.reload();
      else if (code === 'KeyG') grenade.throw(playerActor);
      else if (code === 'KeyB') hud.toggleBuy(round.phase);
      else if (code.startsWith('Digit')) {
        const ids = ['p9', 'p50', 'kestrel', 'mule', 'ar7', 'vigil'];
        const id = ids[Number(code.slice(5)) - 1];
        if (id) playerActor.weapons.switchTo(id);
      }
    }
    let steps = 0;
    accumulator += dt;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

let accumulator = 0;
let lastTime = performance.now();

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  const body = player.state;
  body.pitch = 0;
  if (name === 'fight') {
    round.phase = 'LIVE'; round.timer = 100;
    // Fight at the round's real target site, bots in the open so the cover
    // shows a live firefight, not two helmets behind crates.
    const site = map.sites.find((s) => s.id === round.targetSite) || map.sites[0];
    const cx = site.center.x, cz = site.center.z;
    const foes = sentinelBots.slice(0, 2);
    // South of the site, in the open lobby, backs to the player: the
    // site-edge crates otherwise eat every round, and the lane walls
    // (x=±14) occlude the site from the lanes. The player shoots from
    // the lobby; the bots turn on the gunshots and return fire.
    foes[0].pos.set(cx, 0, cz + 5); foes[0].yaw = 0;
    // Second foe toward mid, not across the lane wall (x=±14 hides it).
    foes[1].pos.set(cx + (cx < 0 ? 3.5 : -3.5), 0, cz + 5); foes[1].yaw = 0;
    player.teleport(cx, 0, -2, 0);
    settle(20);
    // Kill the first foe on camera (killfeed + K/D), then aim at the second.
    let guard = 0;
    while (foes[0].alive && guard < 12) {
      foes[0].chestPos(tmpV);
      aimAt(tmpV);
      firePlayer();
      settle(13);
      guard += 1;
    }
    settle(12);
    foes[1].chestPos(tmpV);
    aimAt(tmpV);
    firePlayer();
    settle(1);
  } else if (name === 'buy') {
    player.teleport(0, 0, 15.5, 0);
    // Two teammates ahead of the player so the buy frame shows the squad.
    strikerBots[0].pos.set(2.5, 0, 12); strikerBots[0].yaw = 0;
    strikerBots[1].pos.set(-2.5, 0, 12); strikerBots[1].yaw = 0;
    hud.showBuy();
    settle(10);
  } else if (name === 'plant') {
    round.phase = 'LIVE'; round.timer = 100;
    // Stand at the site edge facing the reactor: the site centre itself is
    // inside the reactor mesh, so planting from there films a wall.
    const site = map.sites.find((s) => s.id === round.targetSite) || map.sites[0];
    player.teleport(site.center.x, 0, site.center.z + 3.0, 0);
    for (let i = 0; i < 200 && round.phase !== 'PLANTED'; i += 1) {
      Bomb.tryPlant(playerActor);
      step(FIXED_STEP);
    }
    // Step back for the photo: at plant range the reactor fills the frame.
    player.teleport(site.center.x, 0, site.center.z + 6, 0);
    settle(5);
    aimAt(new THREE.Vector3(site.center.x, 1.2, site.center.z));
    settle(25);
  } else {
    // West Lane vantage down the lane to Core A: the Mid blocks fill the
    // frame from the spawn, so the round banner gets a real backdrop.
    player.teleport(-17, 0, 2, 0);
    round.endRound('elimination', 'Strikers');
    settle(10);
  }
  syncHud();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

// Right mouse holds the scope on the Vigil; anywhere else it does nothing.
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 2 && playerActor.weapons.currentId === 'vigil') {
    scoped = true;
    Audio.play('scope', playerActor.pos);
  }
});
window.addEventListener('mouseup', (e) => { if (e.button === 2) scoped = false; });
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
