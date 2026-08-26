/**
 * Renderer-independent construction of the canonical 233-node CIN/SIN fire
 * spiral.  The phrase is deliberately part of the data contract: it seeds the
 * soundtrack and the visual field without relying on Math.random().
 */

export const FIRE_PATTERN_SEED =
  "p4 + 11c9h 9fwhsa assa dasd sa u923t u3240-9t 0w3";

export const FIRE_PATTERN_NODE_COUNT = 233;

const TAU = Math.PI * 2;
const GOLDEN_FRACTION = 0.6180339887498949;

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const lerp = (a, b, amount) => a + (b - a) * amount;

/** FNV-1a plus a short avalanche, kept in uint32 arithmetic. */
export function hashFirePatternSeed(seed = FIRE_PATTERN_SEED) {
  const source = String(seed ?? "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; ++index) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * CIN is the counter-wound cosine channel.  A small nested sine bend prevents
 * the companion channels from collapsing into a mathematically perfect ring.
 */
export function cinWave(value, phase = 0) {
  const x = Number(value) || 0;
  const p = Number(phase) || 0;
  return Math.cos(x + p + Math.sin(x * 0.5 - p * 0.37) * 0.35);
}

/** The SIN channel winds in the opposite harmonic direction to CIN. */
export function sinWave(value, phase = 0) {
  const x = Number(value) || 0;
  const p = Number(phase) || 0;
  return Math.sin(x - p + Math.cos(x * GOLDEN_FRACTION + p * 0.23) * 0.28);
}

function normalizedOptions(options = {}) {
  const count = Math.trunc(Number(options.count ?? FIRE_PATTERN_NODE_COUNT));
  if (!Number.isFinite(count) || count < 1 || count > 4096) {
    throw new RangeError("Fire-pattern count must be an integer from 1 through 4096.");
  }
  const innerRadius = Number(options.innerRadius ?? 4.2);
  const outerRadius = Number(options.outerRadius ?? 34.5);
  if (!Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) ||
      innerRadius <= 0 || outerRadius <= innerRadius) {
    throw new RangeError("Fire-pattern radii must be finite and outerRadius must exceed innerRadius.");
  }
  return {
    seed: String(options.seed ?? FIRE_PATTERN_SEED),
    count,
    innerRadius,
    outerRadius,
  };
}

/**
 * Build immutable node records for a seven-and-a-third-turn expanding spiral.
 * Every visible monolith, floor crack and flame anchor consumes the same node,
 * so all three layers retain the authored 233-count identity.
 */
export function createFirePatternNodes(options = {}) {
  const { seed, count, innerRadius, outerRadius } = normalizedOptions(options);
  const hash = hashFirePatternSeed(seed);
  const random = mulberry32(hash ^ 0xa233f17e);
  const tokens = seed.trim().split(/\s+/).filter(Boolean);
  const phraseTokens = tokens.length ? tokens : ["fire"];
  const seedPhase = (hash / 0x1_0000_0000) * TAU;
  const turns = 7 + 1 / 3;
  const nodes = [];

  for (let index = 0; index < count; ++index) {
    const progress = count === 1 ? 0.5 : index / (count - 1);
    const token = phraseTokens[index % phraseTokens.length];
    const tokenHash = hashFirePatternSeed(`${token}:${index % phraseTokens.length}`);
    const tokenPhase = (tokenHash / 0x1_0000_0000) * TAU;
    const cin = cinWave(progress * TAU * 5.0 + tokenPhase, seedPhase * 0.31);
    const sin = sinWave(progress * TAU * 3.0 - tokenPhase, seedPhase * 0.19);
    const jitter = random() * 2 - 1;
    const angularJitter = (random() * 2 - 1) * 0.032;
    const angle = seedPhase + progress * TAU * turns + cin * 0.072 + angularJitter;
    const radialProgress = Math.pow(progress, 0.74);
    const radius = clamp(
      lerp(innerRadius, outerRadius, radialProgress) + cin * 0.58 + sin * 0.31 + jitter * 0.16,
      innerRadius * 0.88,
      outerRadius * 1.035,
    );
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const tier = index % 13 === 0 ? 3 : index % 5 === 0 ? 2 : 1;
    const monolithHeight = 1.05 + Math.pow(0.5 + 0.5 * cin, 1.35) * 3.9 + tier * 0.44;
    const monolithWidth = 0.28 + (0.5 + 0.5 * sin) * 0.25 + tier * 0.055;
    const flameScale = 0.42 + (0.5 + 0.5 * sin) * 0.70 + tier * 0.18;
    const crackLength = 0.72 + (0.5 + 0.5 * cin) * 1.65 + tier * 0.30;
    const crackWidth = 0.055 + tier * 0.018 + random() * 0.026;

    nodes.push(Object.freeze({
      id: `fire-${String(index + 1).padStart(3, "0")}`,
      index,
      token,
      tokenIndex: index % phraseTokens.length,
      progress,
      turn: progress * turns,
      angle,
      radius,
      x,
      z,
      cin,
      sin,
      tier,
      band: index % 4,
      pulseGroup: index % 16,
      phase: tokenPhase + random() * TAU,
      frequency: 0.72 + random() * 1.56,
      monolithHeight,
      monolithWidth,
      monolithLean: (cin * 0.018 + jitter * 0.012),
      flameScale,
      crackLength,
      crackWidth,
      emberBias: clamp(0.28 + tier * 0.16 + (0.5 + 0.5 * sin) * 0.18, 0, 1),
    }));
  }

  return Object.freeze(nodes);
}

export const FIRE_PATTERN_NODES = createFirePatternNodes();

export default createFirePatternNodes;
