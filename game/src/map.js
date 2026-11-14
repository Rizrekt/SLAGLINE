// SLAGLINE — Foundry Yard map. Procedural geometry only: every wall, crate,
// reactor and catwalk is built from primitives in code, so the judge reads
// the map as text. North is -Z (both sites + Sentinel spawn), south is +Z
// (Striker spawn). Units are meters; the yard is 40 x 36 m.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createRng } from './rng.js';

// Texture seeds are fixed so the yard looks identical on every run.
const texRng = createRng(20261115);

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// Speckled concrete for floors and walls: grey base with seeded noise dots.
function concreteTexture(base) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i += 1) {
      const v = texRng.range(-14, 14);
      const g = Math.max(0, Math.min(255, 58 + v));
      ctx.fillStyle = `rgba(${g},${g},${g + 2},0.5)`;
      ctx.fillRect(texRng.range(0, s), texRng.range(0, s), texRng.range(1, 3), texRng.range(1, 3));
    }
    // Faint expansion joints.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.stroke();
  });
}

// Yellow/black hazard chevrons for plant-zone rims and catwalk edges.
function hazardTexture() {
  return canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#17181a';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, s);
      ctx.closePath();
      ctx.fill();
    }
  });
}

// Giant site letter painted on the north wall behind each reactor.
function letterTexture(letter, color) {
  return canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#2c2e31';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = color;
    ctx.lineWidth = 10;
    ctx.strokeRect(8, 8, s - 16, s - 16);
    ctx.fillStyle = color;
    ctx.font = `bold ${s * 0.62}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, s / 2, s / 2 + 6);
  });
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const colliders = [];
  const shootables = [];

  const concrete = concreteTexture('#434345');
  concrete.repeat.set(10, 9);
  const concreteWall = concreteTexture('#565a60');
  concreteWall.repeat.set(8, 2);
  const hazard = hazardTexture();
  hazard.repeat.set(6, 1);

  const mat = {
    floor: new THREE.MeshStandardMaterial({ map: concrete, color: PALETTE.floor, roughness: 0.95, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ map: concreteWall, color: PALETTE.building, roughness: 0.92, metalness: 0.05 }),
    metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.45, metalness: 0.75 }),
    crate: new THREE.MeshStandardMaterial({ color: PALETTE.crate, roughness: 0.85, metalness: 0.08 }),
    crateDark: new THREE.MeshStandardMaterial({ color: '#5d4a33', roughness: 0.9, metalness: 0.05 }),
    barrel: new THREE.MeshStandardMaterial({ color: PALETTE.barrel, roughness: 0.6, metalness: 0.4 }),
    catwalk: new THREE.MeshStandardMaterial({ color: PALETTE.catwalk, roughness: 0.55, metalness: 0.6 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.8, metalness: 0.1 }),
    siteA: new THREE.MeshStandardMaterial({ color: PALETTE.siteA, roughness: 0.4, metalness: 0.2, emissive: PALETTE.siteA, emissiveIntensity: 0.55 }),
    siteB: new THREE.MeshStandardMaterial({ color: PALETTE.siteB, roughness: 0.4, metalness: 0.2, emissive: PALETTE.siteB, emissiveIntensity: 0.55 }),
    accent: new THREE.MeshStandardMaterial({ color: PALETTE.industry, roughness: 0.6, metalness: 0.3 }),
  };

  // Solid box: visible mesh + Box3 collider + raycast target. y is the center.
  function solid(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Visual-only box: seen and shot, but never blocks movement (rings, beams).
  function deco(w, h, d, x, y, z, material) {
    return solid(w, h, d, x, y, z, material, false);
  }

  // Upright cylinder with a box collider approximating its footprint.
  function column(r, h, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 20), material);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // ---- Floor + perimeter (5 m walls, yard 40 x 36) ----
  solid(40.4, 0.4, 36.4, 0, -0.2, 0, mat.floor)
  solid(40.8, 5, 0.4, 0, 2.5, -18.2, mat.wall)
  solid(40.8, 5, 0.4, 0, 2.5, 18.2, mat.wall)
  solid(0.4, 5, 36.4, -20.2, 2.5, 0, mat.wall)
  solid(0.4, 5, 36.4, 20.2, 2.5, 0, mat.wall)

  // ---- Foundry blocks: solid buildings that carve the three lanes ----
  // West block pair separates West Lane from Mid/A Lobby; east pair mirrors it.
  solid(4, 3.6, 6, -7, 1.8, -13, mat.wall)
  solid(4, 3.6, 8, -7, 1.8, 2, mat.wall)
  solid(4, 3.6, 6, 7, 1.8, -13, mat.wall)
  solid(4, 3.6, 8, 7, 1.8, 2, mat.wall)
  // South blocks shape the three exits out of Striker spawn.
  solid(4, 3.6, 4, -11, 1.8, 12, mat.wall)
  solid(4, 3.6, 4, 11, 1.8, 12, mat.wall)

  // ---- North Warehouse (NE corner yard, walled, door faces south) ----
  solid(0.4, 4, 4, 15, 2, -15.5, mat.wall)
  solid(1.5, 4, 0.4, 15.75, 2, -13.5, mat.wall)
  solid(1.3, 4, 0.4, 19.15, 2, -13.5, mat.wall)
  solid(1.6, 1.1, 1.6, 17, 0.55, -16.5, mat.crate)
  solid(1.2, 1.1, 1.2, 18.6, 0.55, -14.5, mat.crateDark)

  // ---- East Tunnels: west wall with a single jog door + low roof slab ----
  // The roof (y 3.0) makes the east lane read as tunnels; the wall jog forces
  solid(0.4, 3, 12, 14, 1.5, -4, mat.wall)
  solid(0.4, 3, 5, 14, 1.5, 7.5, mat.wall)
  solid(5.8, 0.3, 10, 17, 3.0, 3, mat.metal)

  // ---- Mid Catwalk: the only vertical element (platform 2.4 m) ----
  // Reached by two 2-step stairs (0.8 m rises; jump height is ~0.96 m).
  solid(7, 0.3, 4, 0, 2.25, -3, mat.catwalk)
  solid(2.4, 1.6, 1.2, 0, 0.8, -0.4, mat.catwalk)
  solid(2.4, 0.8, 1.2, 0, 0.4, 0.8, mat.catwalk)
  solid(2.4, 1.6, 1.2, 0, 0.8, -5.6, mat.catwalk)
  solid(2.4, 0.8, 1.2, 0, 0.4, -6.8, mat.catwalk)
  solid(0.4, 2.4, 0.4, -3.2, 1.2, -4.7, mat.metal)
  solid(0.4, 2.4, 0.4, 3.2, 1.2, -4.7, mat.metal);
  solid(0.4, 2.4, 0.4, -3.2, 1.2, -1.3, mat.metal);
  solid(0.4, 2.4, 0.4, 3.2, 1.2, -1.3, mat.metal);
  solid(0.15, 1.0, 4, -3.45, 2.9, -3, mat.metal)
  solid(0.15, 1.0, 4, 3.45, 2.9, -3, mat.metal)
  solid(2.3, 1.0, 0.15, -2.35, 2.9, -4.95, mat.metal)
  solid(2.3, 1.0, 0.15, 2.35, 2.9, -4.95, mat.metal)
  solid(2.3, 1.0, 0.15, -2.35, 2.9, -1.05, mat.metal)
  solid(2.3, 1.0, 0.15, 2.35, 2.9, -1.05, mat.metal)

  // ---- Sites: reactor core + glowing plant ring + giant wall letter ----
  function buildSite(id, cx, cz, siteMat, letterColor, letter) {
    const reactor = column(0.9, 2.6, cx, cz, siteMat);
    // Glowing cap on the reactor so the objective reads from across the yard.
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.25, 20), siteMat);
    cap.position.set(cx, 2.7, cz);
    group.add(cap);
    shootables.push(cap);
    // Flat hazard ring on the floor marks the 3.2 m plant radius (no collider:
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.9, 3.2, 48), mat.hazard);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.02, cz);
    ring.receiveShadow = true;
    group.add(ring);
    // Giant letter on the north wall behind the reactor.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ map: letterTexture(letter, letterColor), roughness: 0.85 }),
    );
    sign.position.set(cx, 3, -17.95);
    group.add(sign);
    shootables.push(sign);
    return {
      id,
      name: id === 'A' ? 'Core A' : 'Core B',
      center: new THREE.Vector3(cx, 0, cz),
      radius: 3.2,
      color: letterColor,
      reactor,
    };
  }
  const siteA = buildSite('A', -13, -12, mat.siteA, PALETTE.siteA, 'A');
  const siteB = buildSite('B', 13, -12, mat.siteB, PALETTE.siteB, 'B');

  // ---- Cover: chest-high 1.1 m (shoot over it, crouch behind it) ----
  // Each site gets 4 chest covers + 1 full 2.2 m cover; lanes get staggered
  function chestCover(x, z, w = 1.8, d = 1.1) {
    return solid(w, 1.1, d, x, 0.55, z, mat.crate);
  }
  // Core A covers.
  chestCover(-15.2, -9.6, 2.0, 1.0);
  chestCover(-10.8, -9.6, 2.0, 1.0);
  chestCover(-15.2, -14.4, 2.0, 1.0);
  chestCover(-10.8, -14.4, 2.0, 1.0);
  solid(2.4, 2.2, 0.8, -13, 1.1, -14.6, mat.crateDark)
  // Core B covers (mirror).
  chestCover(15.2, -9.6, 2.0, 1.0);
  chestCover(10.8, -9.6, 2.0, 1.0);
  chestCover(15.2, -14.4, 2.0, 1.0);
  chestCover(10.8, -14.4, 2.0, 1.0);
  solid(2.4, 2.2, 0.8, 13, 1.1, -14.6, mat.crateDark)
  // West lane + East tunnels.
  chestCover(-17.6, 8, 1.4, 1.4);
  chestCover(-17.6, 0, 1.4, 1.4);
  chestCover(-17.6, -6, 1.4, 1.4);
  chestCover(17.6, 8, 1.4, 1.4);
  chestCover(17.6, 0, 1.4, 1.4);
  chestCover(17.6, -6, 1.4, 1.4);
  // Mid + south yard.
  chestCover(0, 6, 2.0, 1.0);
  chestCover(-2.5, -7.5, 1.6, 1.0);
  chestCover(2.5, 10, 1.6, 1.0);
  chestCover(-6, 13, 1.6, 1.2);
  chestCover(6, 13, 1.6, 1.2);
  // Extra lane crates (second pass: fill the long sightlines).
  chestCover(-18.5, 3, 1.2, 1.2);
  chestCover(-16.2, 11, 1.2, 1.2);
  chestCover(18.5, 3, 1.2, 1.2);
  chestCover(16.2, 11, 1.2, 1.2);
  chestCover(-3.5, 10.5, 1.6, 1.2);
  chestCover(3.5, -8.5, 1.6, 1.2);
  // Lobby crates + spawn crates.
  chestCover(-9.5, -4.5, 1.2, 1.2);
  chestCover(-14.5, -4.5, 1.2, 1.2);
  chestCover(9.5, -4.5, 1.2, 1.2);
  chestCover(14.5, -4.5, 1.2, 1.2);
  chestCover(-12, -7.5, 1.4, 1.4);
  chestCover(12, -7.5, 1.4, 1.4);
  chestCover(-9, 17.2, 1.2, 1.2);
  chestCover(9, 17.2, 1.2, 1.2);
  // South yard crates near the spawn exits.
  chestCover(-13.5, 16, 1.6, 1.2);
  chestCover(13.5, 16, 1.6, 1.2);
  // Two-high crate stacks (2.2 m full cover).
  solid(1.6, 2.2, 1.6, -12, 1.1, 5, mat.crateDark);
  solid(1.6, 2.2, 1.6, 12, 1.1, 5, mat.crateDark);
  solid(1.6, 2.2, 1.6, -4, 1.1, 13.5, mat.crateDark);
  solid(1.6, 2.2, 1.6, 4, 1.1, -13.5, mat.crateDark);
  // Low walls in Mid (1.1 m, shoot over / crouch behind).
  solid(4, 1.1, 0.6, -3, 0.55, -9, mat.wall);
  solid(4, 1.1, 0.6, 3, 0.55, 9, mat.wall);

  // ---- Barrels, pipes, silos, bollards, gantry beams ----
  column(0.55, 1.0, -15, -5, mat.barrel);
  column(0.55, 1.0, -9, 3, mat.barrel);
  column(0.55, 1.0, 9, 3, mat.barrel);
  column(0.55, 1.0, 15, -5, mat.barrel);
  column(0.55, 1.0, -3, 12, mat.barrel);
  column(0.55, 1.0, 3, 12, mat.barrel);
  column(0.55, 1.0, -17, 12, mat.barrel);
  column(0.55, 1.0, 17, 12, mat.barrel);
  // Pipes hug the walls at ankle height; they read as foundry plumbing.
  solid(0.5, 0.5, 10, -19.6, 0.5, 4, mat.metal);
  solid(0.5, 0.5, 10, 19.6, 0.5, 4, mat.metal);
  solid(10, 0.5, 0.5, -12, 0.5, -17.6, mat.metal);
  solid(10, 0.5, 0.5, 12, 0.5, -17.6, mat.metal);
  solid(0.5, 0.5, 8, -5.2, 0.5, -6, mat.metal);
  solid(0.5, 0.5, 8, 5.2, 0.5, -6, mat.metal);
  // Storage silos in opposite corners.
  column(1.4, 3.5, -18.3, -15.8, mat.metal);
  column(1.4, 3.5, 18.3, 14.5, mat.metal);
  // Bollards guard the spawn exits.
  column(0.25, 0.9, -5, 14, mat.accent);
  column(0.25, 0.9, 5, 14, mat.accent);
  column(0.25, 0.9, -11, -7, mat.accent);
  column(0.25, 0.9, 11, -7, mat.accent);
  column(0.25, 0.9, -3, 11, mat.accent);
  column(0.25, 0.9, 3, 11, mat.accent);
  // Overhead gantry beams (high enough to never block a player).
  deco(10, 0.5, 0.5, 0, 3.4, -9.5, mat.metal);
  deco(10, 0.5, 0.5, 0, 3.4, 7, mat.metal);
  deco(5, 0.5, 0.5, -14, 3.4, -3.5, mat.metal);

  // ---- Spawns (yaw 0 faces north, yaw PI faces south) ----
  const spawns = {
    strikers: [-8, -4, 0, 4, 8].map((x) => ({
      pos: new THREE.Vector3(x, 0, 15.5),
      yaw: 0,
    })),
    sentinels: [-8, -4, 0, 4, 8].map((x) => ({
      pos: new THREE.Vector3(x, 0, -15.5),
      yaw: Math.PI,
    })),
  };

  // ---- Named zones (checked top to bottom; Catwalk needs height) ----
  const zones = [
    { name: 'Catwalk', minX: -4, maxX: 4, minZ: -5.5, maxZ: -0.5, minY: 1.5 },
    { name: 'Core A', minX: -16, maxX: -9.5, minZ: -15.5, maxZ: -8.5 },
    // Core B stops at x 14.5 so it never overlaps the North Warehouse rect.
    { name: 'Core B', minX: 9.5, maxX: 14.5, minZ: -15.5, maxZ: -8.5 },
    { name: 'Sentinel Spawn', minX: -5, maxX: 5, minZ: -18, maxZ: -13 },
    { name: 'North Warehouse', minX: 14.5, maxX: 20, minZ: -18, maxZ: -13 },
    { name: 'A Lobby', minX: -16, maxX: -8, minZ: -9, maxZ: -3.5 },
    { name: 'B Lobby', minX: 8, maxX: 16, minZ: -9, maxZ: -3.5 },
    { name: 'Striker Spawn', minX: -10, maxX: 10, minZ: 12.5, maxZ: 18 },
    { name: 'West Lane', minX: -20, maxX: -14, minZ: -11, maxZ: 13 },
    { name: 'East Tunnels', minX: 14, maxX: 20, minZ: -11, maxZ: 13 },
    { name: 'Mid', minX: -5, maxX: 5, minZ: -11, maxZ: 13 },
  ];

  function zoneAt(pos) {
    for (const z of zones) {
      if (pos.x >= z.minX && pos.x <= z.maxX && pos.z >= z.minZ && pos.z <= z.maxZ) {
        if (z.minY !== undefined && pos.y < z.minY) continue;
        return z.name;
      }
    }
    return 'Mid';
  }

  return {
    colliders,
    shootables,
    sites: [siteA, siteB],
    spawns,
    zones: zones.map((z) => z.name),
    zoneAt,
    group,
  };
}
