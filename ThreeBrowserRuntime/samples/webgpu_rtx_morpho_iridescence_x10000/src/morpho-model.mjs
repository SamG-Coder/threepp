export const MORPHO_SEED = 0x10f01000;
export const SCALE_COUNT = 10_000;
export const HERO_SCALE_INDEX = 4242;

const UINT32_SCALE = 1 / 0x100000000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Longitudinal Morpho veins as polar angles from the body attachment (u=0, v=0.5).
const VEIN_ANGLES = Object.freeze([
  -1.18, -0.82, -0.48, -0.14, 0.20, 0.56, 0.94,
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const integer = Math.trunc(finite(value, fallback));
  return integer > 0 ? integer : fallback;
}

function nearestVeinAngle(angle) {
  let best = VEIN_ANGLES[0];
  let bestDistance = Math.abs(angle - best);
  for (let index = 1; index < VEIN_ANGLES.length; ++index) {
    const distance = Math.abs(angle - VEIN_ANGLES[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = VEIN_ANGLES[index];
    }
  }
  return best;
}

function morphoDiskHalfChord(u) {
  const x = finite(u) - 0.5;
  return Math.sqrt(Math.max(0, 0.25 - x * x));
}

function clampToMorphoDisk(u, v) {
  let x = finite(u, 0.5) - 0.5;
  let y = finite(v, 0.5) - 0.5;
  // Slight hindwing scallop on the trailing (positive-v) half of the disk.
  const scallop = y > 0
    ? 1 - 0.07 * Math.pow(Math.max(0, Math.sin((x + 0.5) * Math.PI * 2.2)), 2)
    : 1;
  const limit = 0.5 * scallop;
  const distance = Math.hypot(x, y);
  if (distance > limit && distance > 0) {
    const scale = limit / distance;
    x *= scale;
    y *= scale;
  }
  return [
    Math.min(1, Math.max(0, x + 0.5)),
    Math.min(1, Math.max(0, y + 0.5)),
  ];
}

/** Small deterministic generator with a full uint32 input surface. */
export function createSeededRandom(seed = MORPHO_SEED) {
  let state = Math.trunc(finite(seed, MORPHO_SEED)) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) * UINT32_SCALE;
  };
}

/**
 * Authors the 10,000 bounded photonic-crystal scale descriptors consumed by
 * one InstancedMesh. The records are deliberately renderer-agnostic so
 * determinism can be tested in Node without WebGPU, a DOM, or three.js.
 */
export function createPhotonicScales({
  seed = MORPHO_SEED,
  count = SCALE_COUNT,
} = {}) {
  const total = positiveInteger(count, SCALE_COUNT);
  if (total > 100_000) throw new RangeError("Photonic scale count exceeds the safe authoring limit.");
  const random = createSeededRandom(seed);
  const scales = new Array(total);
  const leftCount = Math.ceil(total / 2);

  for (let index = 0; index < total; ++index) {
    const onLeft = index < leftCount;
    const localIndex = onLeft ? index : index - leftCount;
    const localCount = onLeft ? leftCount : total - leftCount;

    const angularJitter = (random() - 0.5) * 0.11;
    const radialJitter = (random() - 0.5) * 0.016;
    const radius = Math.min(0.5, Math.max(0,
      Math.sqrt((localIndex + 0.5) / localCount) * 0.5 + radialJitter,
    ));
    const theta = localIndex * GOLDEN_ANGLE + angularJitter;
    let u = 0.5 + radius * Math.cos(theta);
    let v = 0.5 + radius * Math.sin(theta);

    const pull = 0.5 + random() * 0.38;
    const fromBase = Math.hypot(u, v - 0.5);
    const currentAngle = Math.atan2(v - 0.5, u);
    const nextAngle = currentAngle + (nearestVeinAngle(currentAngle) - currentAngle) * pull;
    u = fromBase * Math.cos(nextAngle);
    v = 0.5 + fromBase * Math.sin(nextAngle);
    [u, v] = clampToMorphoDisk(u, v);

    const span = u;
    const chord = 2 * morphoDiskHalfChord(u);
    const length = 0.0078 + random() * 0.0074 + (1 - u) * 0.0018;
    const width = 0.0034 + Math.pow(random(), 1.55) * 0.0046;
    const thickness = 0.00026 + random() * 0.0005;
    const tilt = -0.14 + random() * 0.32;
    const yaw = Math.atan2(v - 0.5, Math.max(1e-6, u)) + (random() - 0.5) * 0.14;
    const roll = (random() - 0.5) * 0.2;
    const ridgeCount = 6 + Math.floor(random() * 13);
    const layerGapNm = 70 + random() * 40;
    const chitinIndex = 1.52 + random() * 0.08;
    const airIndex = 1;
    const layerCount = 10 + Math.floor(random() * 3);
    const peakWavelengthNm = 2 * chitinIndex * layerGapNm;
    const iridescence = 0.72 + random() * 0.28;
    const roughness = 0.08 + random() * 0.16;
    const metallic = 0.04 + random() * 0.12;
    const phase = random() * Math.PI * 2;
    const luminance = 0.34 + random() * 0.66;
    const opacity = 0.78 + random() * 0.22;

    scales[index] = Object.freeze({
      id: `scale-${String(index).padStart(4, "0")}`,
      index,
      wing: onLeft ? "left" : "right",
      u,
      v,
      chord,
      span,
      length,
      width,
      thickness,
      tilt,
      yaw,
      roll,
      ridgeCount,
      layerGapNm,
      chitinIndex,
      airIndex,
      layerCount,
      peakWavelengthNm,
      iridescence,
      roughness,
      metallic,
      phase,
      luminance,
      opacity,
    });
  }
  return Object.freeze(scales);
}

export function photonicChecksum(scales) {
  let hash = 0x811c9dc5;
  for (const scale of scales ?? []) {
    const values = [
      scale.index,
      scale.u,
      scale.v,
      scale.chord,
      scale.span,
      scale.length,
      scale.width,
      scale.thickness,
      scale.tilt,
      scale.yaw,
      scale.roll,
      scale.ridgeCount,
      scale.layerGapNm,
      scale.chitinIndex,
      scale.airIndex,
      scale.layerCount,
      scale.peakWavelengthNm,
      scale.iridescence,
      scale.roughness,
      scale.metallic,
      scale.phase,
      scale.luminance,
      scale.opacity,
    ];
    for (const value of values) {
      const quantized = Math.round(finite(value) * 1_000_000) | 0;
      hash ^= quantized;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

export const PHOTONIC_SCALES = createPhotonicScales();
export const PHOTONIC_SCALE_CHECKSUM = photonicChecksum(PHOTONIC_SCALES);
