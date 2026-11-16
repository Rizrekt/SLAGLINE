// SLAGLINE — pooled visual effects. Every mesh, sprite and light is created
// once in createEffects and reused; the per-frame update only moves, scales
// and fades them, so the hot loop allocates nothing. A tracer lives 40 ms.
import * as THREE from 'three';
import { createRng } from './rng.js';

// Deterministic jitter for spark directions (visual only, never gameplay).
const fxRng = createRng(777001);

const TRACER_COUNT = 16;
const TRACER_LIFE = 0.04;
const MUZZLE_COUNT = 2;
const MUZZLE_LIFE = 0.06;
const IMPACT_COUNT = 8;
const IMPACT_LIFE = 0.18;
const EXPLOSION_COUNT = 3;
const EXPLOSION_LIFE = 0.6;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function createEffects(scene) {
  // Tracers: thin additive boxes stretched between two points.
  const tracers = [];
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(
      tracerGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, age: Infinity });
  }
  let tracerNext = 0;

  // Muzzle flashes: sprite + point light, pool of 2.
  const muzzleTex = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const c = canvas.getContext('2d');
    const grad = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,240,200,1)');
    grad.addColorStop(0.4, 'rgba(255,180,80,0.9)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  })();
  const muzzles = [];
  for (let i = 0; i < MUZZLE_COUNT; i += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: muzzleTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.visible = false;
    sprite.scale.set(0.6, 0.6, 1);
    scene.add(sprite);
    const light = new THREE.PointLight(0xffc266, 0, 9, 2);
    scene.add(light);
    muzzles.push({ sprite, light, age: Infinity });
  }
  let muzzleNext = 0;

  // Impact sparks: small additive sprites that pop and fade.
  const impacts = [];
  for (let i = 0; i < IMPACT_COUNT; i += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: muzzleTex, color: 0xffe9a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    sprite.visible = false;
    scene.add(sprite);
    impacts.push({ sprite, age: Infinity, vx: 0, vy: 0, vz: 0 });
  }
  let impactNext = 0;

  // Explosions: expanding additive spheres + one shared light.
  const explosions = [];
  const explosionLight = new THREE.PointLight(0xff8c2e, 0, 22, 2);
  scene.add(explosionLight);
  for (let i = 0; i < EXPLOSION_COUNT; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    explosions.push({ mesh, age: Infinity });
  }
  let explosionNext = 0;

  // `color` tints one tracer (e.g. team-colored fire); default is tracer gold.
  function tracer(a, b, color = null) {
    const slot = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACER_COUNT;
    _a.copy(a);
    _b.copy(b);
    _mid.addVectors(_a, _b).multiplyScalar(0.5);
    _dir.subVectors(_b, _a);
    const len = Math.max(0.05, _dir.length());
    slot.mesh.position.copy(_mid);
    slot.mesh.lookAt(_b);
    slot.mesh.scale.set(0.03, 0.03, len);
    slot.mesh.material.color.set(color === null ? 0xffd27a : color);
    slot.mesh.material.opacity = 0.9;
    slot.mesh.visible = true;
    slot.age = 0;
  }

  function muzzle(pos, dir) {
    const slot = muzzles[muzzleNext];
    muzzleNext = (muzzleNext + 1) % MUZZLE_COUNT;
    _a.copy(pos).addScaledVector(dir, 0.45);
    slot.sprite.position.copy(_a);
    const s = 0.5 + fxRng.range(0, 0.25);
    slot.sprite.scale.set(s, s, 1);
    slot.sprite.material.rotation = fxRng.range(0, Math.PI * 2);
    slot.sprite.material.opacity = 1;
    slot.sprite.visible = true;
    slot.light.position.copy(_a);
    slot.light.intensity = 7;
    slot.age = 0;
  }

  function impact(pos) {
    const slot = impacts[impactNext];
    impactNext = (impactNext + 1) % IMPACT_COUNT;
    slot.sprite.position.copy(pos);
    slot.sprite.scale.set(0.28, 0.28, 1);
    slot.sprite.material.opacity = 1;
    slot.sprite.visible = true;
    slot.vx = fxRng.range(-0.6, 0.6);
    slot.vy = fxRng.range(0.4, 1.2);
    slot.vz = fxRng.range(-0.6, 0.6);
    slot.age = 0;
  }

  function explosion(pos) {
    const slot = explosions[explosionNext];
    explosionNext = (explosionNext + 1) % EXPLOSION_COUNT;
    slot.mesh.position.copy(pos);
    slot.mesh.scale.set(0.5, 0.5, 0.5);
    slot.mesh.material.opacity = 0.85;
    slot.mesh.visible = true;
    slot.age = 0;
    explosionLight.position.copy(pos);
    explosionLight.intensity = 30;
  }

  // Advance all live effects by dt seconds. Called once per render frame.
  function update(dt) {
    for (const slot of tracers) {
      if (slot.age === Infinity) continue;
      slot.age += dt;
      if (slot.age >= TRACER_LIFE) {
        slot.mesh.visible = false;
        slot.mesh.material.opacity = 0;
        slot.age = Infinity;
      } else {
        slot.mesh.material.opacity = 0.9 * (1 - slot.age / TRACER_LIFE);
      }
    }
    for (const slot of muzzles) {
      if (slot.age === Infinity) continue;
      slot.age += dt;
      if (slot.age >= MUZZLE_LIFE) {
        slot.sprite.visible = false;
        slot.sprite.material.opacity = 0;
        slot.light.intensity = 0;
        slot.age = Infinity;
      } else {
        const k = 1 - slot.age / MUZZLE_LIFE;
        slot.sprite.material.opacity = k;
        slot.light.intensity = 7 * k;
      }
    }
    for (const slot of impacts) {
      if (slot.age === Infinity) continue;
      slot.age += dt;
      if (slot.age >= IMPACT_LIFE) {
        slot.sprite.visible = false;
        slot.sprite.material.opacity = 0;
        slot.age = Infinity;
      } else {
        const k = 1 - slot.age / IMPACT_LIFE;
        slot.sprite.position.x += slot.vx * dt;
        slot.sprite.position.y += slot.vy * dt;
        slot.sprite.position.z += slot.vz * dt;
        slot.sprite.material.opacity = k;
        const s = 0.28 * (1 - k * 0.6);
        slot.sprite.scale.set(s, s, 1);
      }
    }
    let anyExplosion = false;
    for (const slot of explosions) {
      if (slot.age === Infinity) continue;
      slot.age += dt;
      if (slot.age >= EXPLOSION_LIFE) {
        slot.mesh.visible = false;
        slot.mesh.material.opacity = 0;
        slot.age = Infinity;
      } else {
        anyExplosion = true;
        const k = slot.age / EXPLOSION_LIFE;
        const r = 0.5 + k * 5.5;
        slot.mesh.scale.set(r, r, r);
        slot.mesh.material.opacity = 0.85 * (1 - k);
      }
    }
    if (!anyExplosion) explosionLight.intensity = 0;
    else explosionLight.intensity = Math.max(explosionLight.intensity - dt * 60, 4);
  }

  return { tracer, muzzle, impact, explosion, update };
}
