import { createSeededRandom, MORPHO_SEED } from "./morpho-model.mjs";

export const OMMATIDIA_COUNT = 4096;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const integer = Math.trunc(finite(value, fallback));
  return integer > 0 ? integer : fallback;
}

function wrapTau(angle) {
  const tau = Math.PI * 2;
  return angle - Math.floor(angle / tau) * tau;
}

/**
 * Authors the 4,096 bounded ommatidium descriptors consumed by the two
 * compound-eye InstancedMeshes. Each eye is an independent Fibonacci
 * hemisphere so left/right halves both cover the front dome. Renderer-agnostic
 * so Node can verify determinism without WebGPU, a DOM, or three.js.
 */
export function createOmmatidia({
  seed = MORPHO_SEED,
  count = OMMATIDIA_COUNT,
} = {}) {
  const total = positiveInteger(count, OMMATIDIA_COUNT);
  if (total > 100_000) throw new RangeError("Ommatidia count exceeds the safe authoring limit.");
  const random = createSeededRandom(seed);
  const ommatidia = new Array(total);
  const leftCount = Math.ceil(total / 2);

  for (let index = 0; index < total; ++index) {
    const isLeft = index < leftCount;
    const eyeCount = isLeft ? leftCount : total - leftCount;
    const localIndex = isLeft ? index : index - leftCount;
    const z = 1 - (localIndex + 0.5) / eyeCount;
    const theta = Math.acos(Math.min(1, Math.max(0, z)));
    const phi = wrapTau(localIndex * GOLDEN_ANGLE + (isLeft ? 0 : GOLDEN_ANGLE * 0.5));
    const packing = Math.sqrt((2 * Math.PI) / eyeCount);

    ommatidia[index] = Object.freeze({
      id: `omma-${String(index).padStart(4, "0")}`,
      index,
      eye: isLeft ? "left" : "right",
      theta,
      phi,
      radius: 0.96 + random() * 0.08,
      hexRadius: packing * (0.46 + random() * 0.18),
      orientation: random() * Math.PI * 2,
      luminance: 0.28 + random() * 0.72,
      hue: 0.08 + random() * 0.16,
    });
  }
  return Object.freeze(ommatidia);
}

export function ommatidiaChecksum(list) {
  let hash = 0x811c9dc5;
  for (const omma of list ?? []) {
    const values = [
      omma.index,
      omma.theta,
      omma.phi,
      omma.radius,
      omma.hexRadius,
      omma.orientation,
      omma.luminance,
      omma.hue,
    ];
    for (const value of values) {
      const quantized = Math.round(finite(value) * 1_000_000) | 0;
      hash ^= quantized;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
}

export const OMMATIDIA = createOmmatidia();
export const OMMATIDIA_CHECKSUM = ommatidiaChecksum(OMMATIDIA);
