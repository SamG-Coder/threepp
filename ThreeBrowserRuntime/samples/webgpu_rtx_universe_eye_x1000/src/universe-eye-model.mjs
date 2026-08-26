export const UNIVERSE_EYE_SEED = 0x0e1e1000;
export const STROMAL_FIBRE_COUNT = 1000;

const UINT32_SCALE = 1 / 0x100000000;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const integer = Math.trunc(finite(value, fallback));
  return integer > 0 ? integer : fallback;
}

/** Small deterministic generator with a full uint32 input surface. */
export function createSeededRandom(seed = UNIVERSE_EYE_SEED) {
  let state = Math.trunc(finite(seed, UNIVERSE_EYE_SEED)) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) * UINT32_SCALE;
  };
}

/**
 * Authors the 1,000 bounded descriptors consumed by one InstancedMesh. The
 * records are deliberately renderer-agnostic so determinism can be tested in
 * Node without WebGPU, a DOM, or three.js.
 */
export function createStromalFibres({
  seed = UNIVERSE_EYE_SEED,
  count = STROMAL_FIBRE_COUNT,
} = {}) {
  const total = positiveInteger(count, STROMAL_FIBRE_COUNT);
  if (total > 100_000) throw new RangeError("Stromal fibre count exceeds the safe authoring limit.");
  const random = createSeededRandom(seed);
  const fibres = new Array(total);

  for (let index = 0; index < total; ++index) {
    const sector = index / total;
    const angularJitter = (random() - 0.5) * (Math.PI * 2 / total) * 4.2;
    const radialNoise = random();
    const radial = 0.29 + Math.pow(radialNoise, 0.78) * 0.68;
    const spiral = (radial - 0.29) * 1.26 + (random() - 0.5) * 0.19;
    const angle = sector * Math.PI * 2 + angularJitter + spiral;
    const length = 0.045 + random() * 0.11 + (1 - radial) * 0.035;
    const width = 0.0012 + Math.pow(random(), 2.1) * 0.0048;
    const curl = -0.34 + random() * 0.68 + (radial - 0.5) * 0.18;
    const depth = -0.014 + random() * 0.028;
    const luminance = 0.28 + random() * 0.72;
    const cyan = Math.pow(random(), 1.45);

    fibres[index] = Object.freeze({
      id: `stroma-${String(index).padStart(4, "0")}`,
      index,
      radial,
      angle,
      length,
      width,
      curl,
      depth,
      phase: random() * Math.PI * 2,
      luminance,
      cyan,
      opacity: 0.12 + random() * 0.33,
    });
  }
  return Object.freeze(fibres);
}

export function stromalChecksum(fibres) {
  let hash = 0x811c9dc5;
  for (const fibre of fibres ?? []) {
    const values = [
      fibre.index,
      fibre.radial,
      fibre.angle,
      fibre.length,
      fibre.width,
      fibre.curl,
      fibre.depth,
      fibre.phase,
      fibre.luminance,
      fibre.cyan,
      fibre.opacity,
    ];
    for (const value of values) {
      const quantized = Math.round(finite(value) * 1_000_000) | 0;
      hash ^= quantized;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

export const STROMAL_FIBRES = createStromalFibres();
export const STROMAL_FIBRE_CHECKSUM = stromalChecksum(STROMAL_FIBRES);

