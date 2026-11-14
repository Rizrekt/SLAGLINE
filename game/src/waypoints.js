// SLAGLINE — waypoint graph for Foundry Yard. Named nodes + two-way edges,
// BFS shortest path. Bots walk node to node; hold nodes carry a guard yaw so
// a holding bot faces the threat direction instead of staring at a wall.
// Coordinates: x east, z south, north is -Z. y is 0 except the Catwalk node.
import * as THREE from 'three';

// id, x, z, zone, hold?, guardYaw (radians, 0 = facing north/-Z), postPlant?
const NODE_DEFS = [
  // Striker spawn (south).
  ['t-spawn-1', -4, 15, 'Striker Spawn', false, 0, false],
  ['t-spawn-2', 4, 15, 'Striker Spawn', false, 0, false],
  ['t-mid', 0, 15, 'Striker Spawn', false, 0, false],
  // West lane: spawn -> A.
  ['w3', -17, 12, 'West Lane', false, 0, false],
  ['w1', -17, 8, 'West Lane', false, 0, false],
  ['w2', -17, -2, 'West Lane', false, 0, false],
  // Core A: lobby, two holds, two post-plant spots.
  ['a-lobby', -12, -6.5, 'A Lobby', false, 0, false],
  ['a-site-1', -15, -13.5, 'Core A', true, Math.PI / 4, false],
  ['a-site-2', -10.5, -14, 'Core A', true, -Math.PI / 4, false],
  ['a-post-1', -15.5, -9.5, 'Core A', true, Math.PI, true],
  ['a-post-2', -10, -9, 'Core A', true, Math.PI, true],
  // Mid + Catwalk.
  ['mid-3', 0, 12, 'Mid', false, 0, false],
  ['mid-1', 0, 8, 'Mid', false, 0, false],
  ['mid-2', 0, -3, 'Mid', false, 0, false],
  ['cat-1', 0, -3, 'Catwalk', true, 0, false],
  // East tunnels: spawn -> B.
  ['e3', 17, 12, 'East Tunnels', false, 0, false],
  ['e1', 17, 8, 'East Tunnels', false, 0, false],
  ['e2', 17, -2, 'East Tunnels', false, 0, false],
  // Core B: lobby, two holds, two post-plant spots.
  ['b-lobby', 12, -6.5, 'B Lobby', false, 0, false],
  ['b-site-1', 15, -13.5, 'Core B', true, -Math.PI / 4, false],
  ['b-site-2', 10.5, -14, 'Core B', true, Math.PI / 4, false],
  ['b-post-1', 15.5, -9.5, 'Core B', true, Math.PI, true],
  ['b-post-2', 10, -9, 'Core B', true, Math.PI, true],
  // Sentinel spawn (north) + rotation nodes.
  ['ct-spawn-1', -2, -15.5, 'Sentinel Spawn', false, Math.PI, false],
  ['ct-spawn-2', 2, -15.5, 'Sentinel Spawn', false, Math.PI, false],
  ['ct-mid', 0, -13.5, 'Sentinel Spawn', false, Math.PI, false],
  ['ct-a', -7, -13, 'Mid', false, 0, false],
  ['ct-b', 7, -13, 'Mid', false, 0, false],
  // North Warehouse corner.
  ['wh-1', 17, -15.5, 'North Warehouse', true, Math.PI / 2, false],
];

// Two-way edges. The Catwalk is reached only through mid-2 (the stairs);
const EDGE_DEFS = [
  ['t-spawn-1', 't-mid'],
  ['t-spawn-2', 't-mid'],
  ['t-spawn-1', 'w3'],
  ['t-spawn-2', 'e3'],
  ['t-mid', 'mid-3'],
  ['w3', 'w1'],
  ['w1', 'w2'],
  ['w2', 'a-lobby'],
  ['a-lobby', 'a-site-1'],
  ['a-lobby', 'a-site-2'],
  ['a-site-1', 'a-post-1'],
  ['a-site-2', 'a-post-2'],
  ['a-post-1', 'a-post-2'],
  ['a-lobby', 'mid-2'],
  ['mid-3', 'mid-1'],
  ['mid-1', 'mid-2'],
  ['mid-2', 'cat-1'],
  ['mid-1', 'cat-1'],
  ['mid-2', 'b-lobby'],
  ['e3', 'e1'],
  ['e1', 'e2'],
  ['e2', 'b-lobby'],
  ['b-lobby', 'b-site-1'],
  ['b-lobby', 'b-site-2'],
  ['b-site-1', 'b-post-1'],
  ['b-site-2', 'b-post-2'],
  ['b-post-1', 'b-post-2'],
  ['ct-spawn-1', 'ct-mid'],
  ['ct-spawn-2', 'ct-mid'],
  ['ct-mid', 'ct-a'],
  ['ct-mid', 'ct-b'],
  ['ct-a', 'a-site-1'],
  ['ct-a', 'a-site-2'],
  ['ct-b', 'b-site-1'],
  ['ct-b', 'b-site-2'],
  ['ct-b', 'wh-1'],
  ['wh-1', 'b-site-1'],
  ['ct-a', 'mid-2'],
  ['ct-b', 'mid-2'],
];

export function createWaypointGraph() {
  const nodes = new Map();
  for (const [id, x, z, zone, hold, guardYaw, postPlant] of NODE_DEFS) {
    nodes.set(id, {
      id,
      x,
      y: id === 'cat-1' ? 2.4 : 0,
      z,
      zone,
      hold,
      guardYaw,
      postPlant,
      pos: new THREE.Vector3(x, id === 'cat-1' ? 2.4 : 0, z),
    });
  }

  const adjacency = new Map();
  for (const id of nodes.keys()) adjacency.set(id, []);
  for (const [a, b] of EDGE_DEFS) {
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  function resolveId(target) {
    if (typeof target === 'string') return target;
    return nearestNode(target).id;
  }

  // Breadth-first shortest path. Returns an array of node objects from
  function pathTo(from, to) {
    const start = resolveId(from);
    const goal = resolveId(to);
    if (!nodes.has(start) || !nodes.has(goal)) return [];
    if (start === goal) return [nodes.get(start)];
    const prev = new Map([[start, null]]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const next of adjacency.get(current)) {
        if (prev.has(next)) continue;
        prev.set(next, current);
        if (next === goal) {
          const path = [nodes.get(goal)];
          let step = goal;
          while (prev.get(step) !== null) {
            step = prev.get(step);
            path.unshift(nodes.get(step));
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [];
  }

  function nearestNode(pos) {
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes.values()) {
      const dx = node.x - pos.x;
      const dz = node.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  // Hold nodes for one site: where defenders wait, and where attackers
  function holdNodesForSite(siteId, postPlant = false) {
    const out = [];
    for (const node of nodes.values()) {
      if (node.zone === siteId && node.hold && node.postPlant === postPlant) out.push(node);
    }
    return out;
  }



  return {
    nodes,
    adjacency,
    pathTo,
    nearestNode,
    holdNodesForSite,
  };
}

// Default graph so callers can use Waypoints.pathTo directly.
const defaultGraph = createWaypointGraph();

export const Waypoints = {
  pathTo: defaultGraph.pathTo,
  nearestNode: defaultGraph.nearestNode,
  holdNodesForSite: defaultGraph.holdNodesForSite,
  nodes: defaultGraph.nodes,
};
