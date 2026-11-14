// SLAGLINE — seeded RNG. Every gameplay random decision goes through here.
// No Math.random anywhere in the simulation path: in normal play the seed comes
// from boot time, in ?shot= mode it comes from the seed= query so a staged
// scene is reproducible tick for tick.
export function mulberry32(initialSeed) {
  let a = initialSeed | 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const random = mulberry32(seed);
  return {
    random,
    // Uniform float in [min, max).
    range(min, max) {
      return min + random() * (max - min);
    },
    // Uniform integer in [min, max] inclusive.
    int(min, max) {
      return min + Math.floor(random() * (max - min + 1));
    },
    pick(array) {
      return array[Math.floor(random() * array.length)];
    },
    // Fisher-Yates with the seeded stream; returns a new array.
    shuffle(array) {
      const out = array.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    // Approximate Gaussian (mean 0, stddev 1) via Box-Muller.
    gauss() {
      let u = 0;
      let v = 0;
      while (u === 0) u = random();
      while (v === 0) v = random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    chance(p) {
      return random() < p;
    },
  };
}
