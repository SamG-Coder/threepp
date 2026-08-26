export const BALL_RADIUS = 1;
export const TENNIS_BALL_RADIUS_MM = 33.5;
export const FIBRE_ARCHETYPE_COUNT = 3;
export const FIBRES_PER_ARCHETYPE = 8192;
export const FIBRE_COUNT = FIBRE_ARCHETYPE_COUNT * FIBRES_PER_ARCHETYPE;
export const GLOBAL_FIBRE_COUNT = FIBRE_COUNT;
export const MACRO_FIBRE_COUNT = FIBRE_COUNT - GLOBAL_FIBRE_COUNT;
export const MACRO_PATCH_RADIUS = 0.24;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TAU = Math.PI * 2;
const SEAM_AMPLITUDE = 0.43;
const SEAM_HALF_WIDTH = 0.052;

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function seamDistance(latitude, longitude) {
  const seamLatitude = SEAM_AMPLITUDE * Math.sin(longitude * 2);
  const slope = SEAM_AMPLITUDE * 2 * Math.cos(longitude * 2);
  return Math.abs(latitude - seamLatitude) / Math.sqrt(1 + slope * slope);
}

export function seamDistanceForNormal(x, y, z) {
  const latitude = Math.asin(Math.max(-1, Math.min(1, y)));
  return seamDistance(latitude, Math.atan2(z, x));
}

function makeTypedModel(count) {
  return {
    count,
    anchors: new Float32Array(count * 3),
    tangents: new Float32Array(count * 3),
    bitangents: new Float32Array(count * 3),
    restLean: new Float32Array(count * 2),
    lean: new Float32Array(count * 2),
    velocity: new Float32Array(count * 2),
    lengths: new Float32Array(count),
    widthScale: new Float32Array(count),
    stiffness: new Float32Array(count),
    phase: new Float32Array(count),
    tone: new Float32Array(count),
    seam: new Uint8Array(count),
  };
}

/**
 * Builds a deterministic, near-uniform nap over the complete sphere. Global
 * Fibonacci indices are interleaved between archetypes, preventing any one
 * RTX instance group from forming visible bands or patches.
 */
export function createFibreModel({
  fibresPerArchetype = FIBRES_PER_ARCHETYPE,
  archetypeCount = FIBRE_ARCHETYPE_COUNT,
  seed = 0x7e11ab1e,
} = {}) {
  if (!Number.isInteger(fibresPerArchetype) || fibresPerArchetype <= 0 ||
      fibresPerArchetype > 8192) {
    throw new RangeError("fibresPerArchetype must be an integer in [1, 8192].");
  }
  if (!Number.isInteger(archetypeCount) || archetypeCount <= 0) {
    throw new RangeError("archetypeCount must be a positive integer.");
  }

  const count = fibresPerArchetype * archetypeCount;
  const model = makeTypedModel(count);
  const random = mulberry32(seed);
  const averageAngularSpacing = Math.sqrt((4 * Math.PI) / count);

  for (let index = 0; index < count; ++index) {
    const jitterY = (random() - 0.5) * 1.15 / count;
    const y = Math.max(-1, Math.min(1, 1 - 2 * ((index + 0.5) / count + jitterY)));
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const longitude = index * GOLDEN_ANGLE +
      (random() - 0.5) * averageAngularSpacing * 0.62;
    const x = Math.cos(longitude) * radial;
    const z = Math.sin(longitude) * radial;
    const positionOffset = index * 3;
    model.anchors[positionOffset] = x;
    model.anchors[positionOffset + 1] = y;
    model.anchors[positionOffset + 2] = z;

    // Start with a pole-safe frame, then roll it randomly so the three curved
    // strand meshes do not share a visible preferred direction.
    let tx;
    let ty;
    let tz;
    if (Math.abs(y) < 0.985) {
      const inverse = 1 / Math.max(1e-9, Math.hypot(z, x));
      tx = -z * inverse;
      ty = 0;
      tz = x * inverse;
    } else {
      const inverse = 1 / Math.max(1e-9, Math.hypot(y, x));
      tx = y * inverse;
      ty = -x * inverse;
      tz = 0;
    }
    const bx = y * tz - z * ty;
    const by = z * tx - x * tz;
    const bz = x * ty - y * tx;
    const roll = random() * TAU;
    const cosine = Math.cos(roll);
    const sine = Math.sin(roll);
    const rolledTx = tx * cosine + bx * sine;
    const rolledTy = ty * cosine + by * sine;
    const rolledTz = tz * cosine + bz * sine;
    const rolledBx = bx * cosine - tx * sine;
    const rolledBy = by * cosine - ty * sine;
    const rolledBz = bz * cosine - tz * sine;
    model.tangents[positionOffset] = rolledTx;
    model.tangents[positionOffset + 1] = rolledTy;
    model.tangents[positionOffset + 2] = rolledTz;
    model.bitangents[positionOffset] = rolledBx;
    model.bitangents[positionOffset + 1] = rolledBy;
    model.bitangents[positionOffset + 2] = rolledBz;

    const dynamicsOffset = index * 2;
    const cantMagnitude = 0.018 + random() * 0.075;
    const cantAngle = random() * TAU;
    const cantX = Math.cos(cantAngle) * cantMagnitude;
    const cantY = Math.sin(cantAngle) * cantMagnitude;
    model.restLean[dynamicsOffset] = cantX;
    model.restLean[dynamicsOffset + 1] = cantY;
    model.lean[dynamicsOffset] = cantX;
    model.lean[dynamicsOffset + 1] = cantY;

    // A real nap is not one uniform length. The averaged random pair keeps the
    // majority compact while retaining occasional hero fibres for macro shots.
    const lengthMix = (random() + random()) * 0.5;
    model.lengths[index] = 0.032 + lengthMix * 0.031;
    model.widthScale[index] = 0.72 + random() * 0.62;
    model.stiffness[index] = 31 + random() * 34;
    model.phase[index] = random() * TAU;
    model.tone[index] = random();
    model.seam[index] = seamDistanceForNormal(x, y, z) <= SEAM_HALF_WIDTH ? 1 : 0;
  }

  return Object.assign(model, {
    fibresPerArchetype,
    archetypeCount,
    seed: seed >>> 0,
  });
}

function optionVector(value, fallback) {
  return value && value.length >= 3 ? value : fallback;
}

/**
 * A critically damped two-axis follicle spring. Physics stays in JavaScript,
 * while the resulting rigid curved-strand transforms are shared with raster
 * instancing and the native ray-query TLAS.
 */
export function stepFibreDynamics(model, deltaSeconds, {
  time = 0,
  wind = [0.34, 0.055, -0.16],
  gust = 0,
  brushNormal = null,
  brushDirection = null,
  brushStrength = 0,
  brushRadius = 0.23,
} = {}) {
  const delta = Math.max(0, Math.min(0.05, Number(deltaSeconds) || 0));
  if (delta === 0) return model;
  const windVector = optionVector(wind, [0.34, 0.055, -0.16]);
  const hasBrush = Boolean(
    brushNormal?.length >= 3 && brushDirection?.length >= 3 && brushStrength > 0,
  );
  const brushCosine = Math.cos(Math.max(0.01, Number(brushRadius) || 0.23));
  const steps = Math.max(1, Math.ceil(delta / (1 / 120)));
  const stepDelta = delta / steps;
  const gustAmount = Math.max(0, Math.min(1.5, Number(gust) || 0));

  for (let index = 0; index < model.count; ++index) {
    const p = index * 3;
    const d = index * 2;
    const tx = model.tangents[p];
    const ty = model.tangents[p + 1];
    const tz = model.tangents[p + 2];
    const bx = model.bitangents[p];
    const by = model.bitangents[p + 1];
    const bz = model.bitangents[p + 2];
    const compliance = 0.72 + (65 - model.stiffness[index]) * 0.012;
    const windScale = (0.052 + gustAmount * 0.19) * compliance;
    const pulse = Math.sin(time * (1.65 + model.tone[index] * 0.9) + model.phase[index]);
    let targetX = model.restLean[d] +
      (windVector[0] * tx + windVector[1] * ty + windVector[2] * tz) * windScale +
      pulse * (0.0045 + gustAmount * 0.013) - ty * 0.012;
    let targetY = model.restLean[d + 1] +
      (windVector[0] * bx + windVector[1] * by + windVector[2] * bz) * windScale +
      Math.cos(time * 1.31 + model.phase[index] * 1.17) * 0.0035 - by * 0.012;

    if (hasBrush) {
      const alignment = model.anchors[p] * brushNormal[0] +
        model.anchors[p + 1] * brushNormal[1] +
        model.anchors[p + 2] * brushNormal[2];
      if (alignment > brushCosine) {
        const normalized = (alignment - brushCosine) / Math.max(1e-6, 1 - brushCosine);
        const falloff = normalized * normalized * (3 - 2 * normalized);
        const push = Math.min(1.5, brushStrength) * 0.46 * falloff;
        targetX += (brushDirection[0] * tx + brushDirection[1] * ty +
          brushDirection[2] * tz) * push;
        targetY += (brushDirection[0] * bx + brushDirection[1] * by +
          brushDirection[2] * bz) * push;
      }
    }

    const spring = model.stiffness[index];
    const damping = Math.sqrt(spring) * 1.58;
    let leanX = model.lean[d];
    let leanY = model.lean[d + 1];
    let velocityX = model.velocity[d];
    let velocityY = model.velocity[d + 1];
    for (let step = 0; step < steps; ++step) {
      velocityX += ((targetX - leanX) * spring - velocityX * damping) * stepDelta;
      velocityY += ((targetY - leanY) * spring - velocityY * damping) * stepDelta;
      leanX += velocityX * stepDelta;
      leanY += velocityY * stepDelta;
    }
    model.lean[d] = Math.max(-0.72, Math.min(0.72, leanX));
    model.lean[d + 1] = Math.max(-0.72, Math.min(0.72, leanY));
    model.velocity[d] = velocityX;
    model.velocity[d + 1] = velocityY;
  }
  return model;
}

/**
 * Writes the exact same affine transform in Three.js column-major 4x4 form
 * and Vulkan row-major 3x4 form. Keeping this conversion in the model layer is
 * what prevents visible fibres and ray-query occluders from drifting apart.
 */
export function fillFibreMatrices(
  model,
  archetype,
  renderMatrices,
  rtxMatrices,
  masks,
  { radius = BALL_RADIUS + 0.0015, center = [0, 0, 0] } = {},
) {
  if (!Number.isInteger(archetype) || archetype < 0 || archetype >= model.archetypeCount) {
    throw new RangeError("Invalid fibre archetype index.");
  }
  const capacity = model.fibresPerArchetype;
  if (renderMatrices.length < capacity * 16 || rtxMatrices.length < capacity * 12 ||
      masks.length < capacity) {
    throw new RangeError("Fibre transform outputs are smaller than the archetype capacity.");
  }

  for (let instance = 0; instance < capacity; ++instance) {
    const index = instance * model.archetypeCount + archetype;
    const p = index * 3;
    const d = index * 2;
    const nx = model.anchors[p];
    const ny = model.anchors[p + 1];
    const nz = model.anchors[p + 2];
    const tx = model.tangents[p];
    const ty = model.tangents[p + 1];
    const tz = model.tangents[p + 2];
    const bx = model.bitangents[p];
    const by = model.bitangents[p + 1];
    const bz = model.bitangents[p + 2];
    let dyx = nx + tx * model.lean[d] + bx * model.lean[d + 1];
    let dyy = ny + ty * model.lean[d] + by * model.lean[d + 1];
    let dyz = nz + tz * model.lean[d] + bz * model.lean[d + 1];
    const directionInverse = 1 / Math.max(1e-9, Math.hypot(dyx, dyy, dyz));
    dyx *= directionInverse;
    dyy *= directionInverse;
    dyz *= directionInverse;

    const tangentDot = tx * dyx + ty * dyy + tz * dyz;
    let dxx = tx - dyx * tangentDot;
    let dxy = ty - dyy * tangentDot;
    let dxz = tz - dyz * tangentDot;
    const xInverse = 1 / Math.max(1e-9, Math.hypot(dxx, dxy, dxz));
    dxx *= xInverse;
    dxy *= xInverse;
    dxz *= xInverse;
    let dzx = dxy * dyz - dxz * dyy;
    let dzy = dxz * dyx - dxx * dyz;
    let dzz = dxx * dyy - dxy * dyx;
    const zInverse = 1 / Math.max(1e-9, Math.hypot(dzx, dzy, dzz));
    dzx *= zInverse;
    dzy *= zInverse;
    dzz *= zInverse;

    const length = model.lengths[index];
    const lateralScale = length * model.widthScale[index];
    dxx *= lateralScale;
    dxy *= lateralScale;
    dxz *= lateralScale;
    dyx *= length;
    dyy *= length;
    dyz *= length;
    dzx *= lateralScale;
    dzy *= lateralScale;
    dzz *= lateralScale;
    const px = center[0] + nx * radius;
    const py = center[1] + ny * radius;
    const pz = center[2] + nz * radius;

    const renderOffset = instance * 16;
    renderMatrices[renderOffset] = dxx;
    renderMatrices[renderOffset + 1] = dxy;
    renderMatrices[renderOffset + 2] = dxz;
    renderMatrices[renderOffset + 3] = 0;
    renderMatrices[renderOffset + 4] = dyx;
    renderMatrices[renderOffset + 5] = dyy;
    renderMatrices[renderOffset + 6] = dyz;
    renderMatrices[renderOffset + 7] = 0;
    renderMatrices[renderOffset + 8] = dzx;
    renderMatrices[renderOffset + 9] = dzy;
    renderMatrices[renderOffset + 10] = dzz;
    renderMatrices[renderOffset + 11] = 0;
    renderMatrices[renderOffset + 12] = px;
    renderMatrices[renderOffset + 13] = py;
    renderMatrices[renderOffset + 14] = pz;
    renderMatrices[renderOffset + 15] = 1;

    const rtxOffset = instance * 12;
    rtxMatrices[rtxOffset] = dxx;
    rtxMatrices[rtxOffset + 1] = dyx;
    rtxMatrices[rtxOffset + 2] = dzx;
    rtxMatrices[rtxOffset + 3] = px;
    rtxMatrices[rtxOffset + 4] = dxy;
    rtxMatrices[rtxOffset + 5] = dyy;
    rtxMatrices[rtxOffset + 6] = dzy;
    rtxMatrices[rtxOffset + 7] = py;
    rtxMatrices[rtxOffset + 8] = dxz;
    rtxMatrices[rtxOffset + 9] = dyz;
    rtxMatrices[rtxOffset + 10] = dzz;
    rtxMatrices[rtxOffset + 11] = pz;
    masks[instance] = 0xff;
  }
  return { renderMatrices, rtxMatrices, masks };
}

export function surfaceDistanceMillimetres(cameraDistance, ballRadius = BALL_RADIUS) {
  const surfaceDistance = Math.max(0, Number(cameraDistance) - ballRadius);
  return surfaceDistance * (TENNIS_BALL_RADIUS_MM / ballRadius);
}

export const fibreModelConstants = Object.freeze({
  goldenAngle: GOLDEN_ANGLE,
  seamAmplitude: SEAM_AMPLITUDE,
  seamHalfWidth: SEAM_HALF_WIDTH,
  globalFibreCount: GLOBAL_FIBRE_COUNT,
  macroFibreCount: MACRO_FIBRE_COUNT,
  macroPatchRadius: MACRO_PATCH_RADIUS,
});
