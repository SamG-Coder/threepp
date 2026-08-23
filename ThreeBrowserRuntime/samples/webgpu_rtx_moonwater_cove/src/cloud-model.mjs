// Shared numeric definition of the procedural marine cloud volume. The TSL
// sky integrates these constants on the GPU; the CPU probe below evaluates
// the same MaterialX Perlin field only along the single Moon ray so optional
// native lighting receives the same cloud extinction as the visible disc.

export const CLOUD_PLANET_RADIUS_KM = 6371.0;
export const CLOUD_LOW_BASE_KM = 0.72;
export const CLOUD_LOW_TOP_KM = 2.35;
export const CLOUD_HIGH_BASE_KM = 4.20;
export const CLOUD_HIGH_TOP_KM = 7.10;
export const CLOUD_LOW_EXTINCTION_PER_KM = 0.82;
export const CLOUD_HIGH_EXTINCTION_PER_KM = 0.075;

export const CLOUD_LOW_QUADRATURE = Object.freeze([
  { position: 0.0198550718, weight: 0.0506142681 },
  { position: 0.1016667613, weight: 0.1111905172 },
  { position: 0.2372337950, weight: 0.1568533229 },
  { position: 0.4082826788, weight: 0.1813418917 },
  { position: 0.5917173212, weight: 0.1813418917 },
  { position: 0.7627662050, weight: 0.1568533229 },
  { position: 0.8983332387, weight: 0.1111905172 },
  { position: 0.9801449282, weight: 0.0506142681 },
]);
export const CLOUD_HIGH_QUADRATURE = Object.freeze([
  { position: 0.0469100770, weight: 0.1184634425 },
  { position: 0.2307653449, weight: 0.2393143352 },
  { position: 0.5000000000, weight: 0.2844444444 },
  { position: 0.7692346551, weight: 0.2393143352 },
  { position: 0.9530899230, weight: 0.1184634425 },
]);
export const CLOUD_LIGHT_QUADRATURE = Object.freeze([
  { position: 0.1127016654, weight: 0.2777777778 },
  { position: 0.5000000000, weight: 0.4444444444 },
  { position: 0.8872983346, weight: 0.2777777778 },
]);
export const CLOUD_LIGHT_QUADRATURE_TWO_POINT = Object.freeze([
  { position: 0.2113248654, weight: 0.5 },
  { position: 0.7886751346, weight: 0.5 },
]);
export const CLOUD_LOW_SLABS = Object.freeze([
  { firstSample: 0, fallbackPosition: 0.1554024124, quadratureWeight: 0.3186581082 },
  { firstSample: 3, fallbackPosition: 0.5000000000, quadratureWeight: 0.3626837834 },
  { firstSample: 5, fallbackPosition: 0.8445975876, quadratureWeight: 0.3186581082 },
]);

const clamp01 = value => Math.min(Math.max(value, 0), 1);
const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (edge0, edge1, value) => {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, 1e-12));
  return t * t * (3 - 2 * t);
};
const rotateLeft32 = (value, count) => (
  (value << count) | (value >>> (32 - count))
) >>> 0;

function bobJenkinsFinal(aValue, bValue, cValue) {
  let a = aValue >>> 0;
  let b = bValue >>> 0;
  let c = cValue >>> 0;
  c = ((c ^ b) - rotateLeft32(b, 14)) >>> 0;
  a = ((a ^ c) - rotateLeft32(c, 11)) >>> 0;
  b = ((b ^ a) - rotateLeft32(a, 25)) >>> 0;
  c = ((c ^ b) - rotateLeft32(b, 16)) >>> 0;
  a = ((a ^ c) - rotateLeft32(c, 4)) >>> 0;
  b = ((b ^ a) - rotateLeft32(a, 14)) >>> 0;
  c = ((c ^ b) - rotateLeft32(b, 24)) >>> 0;
  return c;
}

function materialXHash3(x, y, z) {
  const seed = (0xdeadbeef + (3 << 2) + 13) >>> 0;
  return bobJenkinsFinal(
    (seed + (x >>> 0)) >>> 0,
    (seed + (y >>> 0)) >>> 0,
    (seed + (z >>> 0)) >>> 0,
  );
}

function materialXGradient3(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function materialXPerlin3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fy);
  const w = fade(fz);
  const gradient = (ox, oy, oz) => materialXGradient3(
    materialXHash3(ix + ox, iy + oy, iz + oz),
    fx - ox,
    fy - oy,
    fz - oz,
  );
  const lower = mix(
    mix(gradient(0, 0, 0), gradient(1, 0, 0), u),
    mix(gradient(0, 1, 0), gradient(1, 1, 0), u),
    v,
  );
  const upper = mix(
    mix(gradient(0, 0, 1), gradient(1, 0, 1), u),
    mix(gradient(0, 1, 1), gradient(1, 1, 1), u),
    v,
  );
  return mix(lower, upper, w) * 0.9820;
}

function cloudDensity(x, y, z, altitudeKm, time, highLayer) {
  const advectedX = x - time * 0.00384;
  const advectedZ = z - time * 0.01136;
  const windU = advectedX * 0.32 + advectedZ * 0.947;
  const windV = advectedX * -0.947 + advectedZ * 0.32;
  let weatherA = 0;
  let weatherB = 0;
  let densityU = windU;
  let densityV = windV;
  if (!highLayer) {
    weatherA = Math.sin(windU * 0.014 + windV * 0.006 + 1.7);
    weatherB = Math.cos(windU * -0.005 + windV * 0.017 - 0.8);
    densityU = windU + weatherB * 4.0;
    densityV = windV + weatherA * 2.0;
  }
  const lowShear = altitudeKm - 1.35;
  const coarseCoord = highLayer
    ? [windU * 0.028 + 31.7, altitudeKm * 0.24 - 5.8, windV * 0.070 + 2.4]
    : [
      densityU * 0.060 + lowShear * 0.31 + 7.1,
      altitudeKm * 0.68 - 2.4,
      densityV * 0.155 - lowShear * 0.18 + 11.6,
    ];
  const detailScale = highLayer ? 2.41 : 2.27;
  const detailOffset = highLayer ? [13.1, -7.3, 19.7] : [17.1, -8.3, 5.7];
  const coarse = materialXPerlin3(...coarseCoord) * 0.5 + 0.5;
  const detail = materialXPerlin3(
    coarseCoord[0] * detailScale + detailOffset[0],
    coarseCoord[1] * detailScale + detailOffset[1],
    coarseCoord[2] * detailScale + detailOffset[2],
  ) * 0.5 + 0.5;
  const structure = coarse - detail * (highLayer ? 0.13 : 0.18)
    + (highLayer ? 0.065 : 0.09);

  if (highLayer) {
    const profile = smoothstep(4.20, 4.55, altitudeKm)
      * (1 - smoothstep(6.35, 7.10, altitudeKm));
    return smoothstep(0.63, 0.78, structure) * profile;
  }

  const weather = clamp01((weatherA * 0.62 + weatherB * 0.38) * 0.5 + 0.5);
  const coverage = smoothstep(0.32, 0.68, weather);
  const cloudBase = 0.76 + (0.5 - coarse) * 0.28 + (1 - coverage) * 0.10;
  const lumpyTop = 1.62 + coarse * 0.65;
  const profile = smoothstep(cloudBase, cloudBase + 0.20, altitudeKm)
    * (1 - smoothstep(lumpyTop - 0.22, lumpyTop + 0.12, altitudeKm));
  const densityOnset = mix(0.68, 0.59, coverage);
  return smoothstep(densityOnset, densityOnset + 0.14, structure)
    * profile * coverage;
}

function sphereExitDistance(origin, direction, radius) {
  const b = origin[0] * direction[0]
    + origin[1] * direction[1]
    + origin[2] * direction[2];
  const c = origin[0] * origin[0] + origin[1] * origin[1]
    + origin[2] * origin[2] - radius * radius;
  const root = Math.sqrt(Math.max(b * b - c, 0));
  return Math.max(-c / Math.max(b + root, 0.0001), 0);
}

function integrateCloudDeck(
  origin,
  direction,
  startRadius,
  endRadius,
  quadrature,
  extinction,
  time,
  highLayer,
) {
  const start = sphereExitDistance(origin, direction, startRadius);
  const end = sphereExitDistance(origin, direction, endRadius);
  const segmentLength = Math.max(end - start, 0);
  let opticalDepth = 0;
  for (const sample of quadrature) {
    const distance = start + segmentLength * sample.position;
    const x = origin[0] + direction[0] * distance;
    const y = origin[1] + direction[1] * distance;
    const z = origin[2] + direction[2] * distance;
    const altitude = Math.hypot(x, y, z) - CLOUD_PLANET_RADIUS_KM;
    opticalDepth += cloudDensity(x, y, z, altitude, time, highLayer)
      * segmentLength * sample.weight * extinction;
  }
  return opticalDepth;
}

export function sampleMoonCloudTransmission(cameraPosition, time, moonDirection) {
  const inputLength = Math.hypot(
    moonDirection.x,
    Math.max(moonDirection.y, 0.004),
    moonDirection.z,
  ) || 1;
  const direction = [
    moonDirection.x / inputLength,
    Math.max(moonDirection.y, 0.004) / inputLength,
    moonDirection.z / inputLength,
  ];
  const origin = [
    cameraPosition.x * 0.001,
    cameraPosition.y * 0.001 + CLOUD_PLANET_RADIUS_KM,
    cameraPosition.z * 0.001,
  ];
  const lowTau = integrateCloudDeck(
    origin,
    direction,
    CLOUD_PLANET_RADIUS_KM + CLOUD_LOW_BASE_KM,
    CLOUD_PLANET_RADIUS_KM + CLOUD_LOW_TOP_KM,
    CLOUD_LOW_QUADRATURE,
    CLOUD_LOW_EXTINCTION_PER_KM,
    time,
    false,
  );
  const highTau = integrateCloudDeck(
    origin,
    direction,
    CLOUD_PLANET_RADIUS_KM + CLOUD_HIGH_BASE_KM,
    CLOUD_PLANET_RADIUS_KM + CLOUD_HIGH_TOP_KM,
    CLOUD_HIGH_QUADRATURE,
    CLOUD_HIGH_EXTINCTION_PER_KM,
    time,
    true,
  );
  const horizonGate = smoothstep(0.004, 0.020, direction[1]);
  return Math.exp(-(lowTau + highTau) * horizonGate);
}
