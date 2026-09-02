import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearFilter,
  StorageTexture,
} from "three/webgpu";
import {
  Fn,
  exp,
  float,
  fwidth,
  instanceIndex,
  max,
  min,
  mix,
  mx_noise_float,
  saturate,
  smoothstep,
  texture,
  textureStore,
  uint,
  uniform,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const DEFAULT_SIZE = 512;
const DEFAULT_WORLD_SIZE = 320;
const DEFAULT_STEP_HZ = 30;
const DEFAULT_DECAY_SECONDS = 6.4;
const DEFAULT_SPREAD = 0.92;
const MAX_STEPS_PER_UPDATE = 3;
const MAX_BLUR_WEIGHT = 0.28;
const MAX_FOAMINESS = 3.6;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  return Math.max(1, Math.floor(finiteNumber(value, fallback)));
}

function makeHistoryTexture(size, name) {
  const result = new StorageTexture(size, size);
  result.name = name;
  result.type = HalfFloatType;
  result.wrapS = ClampToEdgeWrapping;
  result.wrapT = ClampToEdgeWrapping;
  result.minFilter = LinearFilter;
  result.magFilter = LinearFilter;
  result.generateMipmaps = false;
  return result;
}

/**
 * Persistent foam raft for the beach Gerstner water.
 *
 * History texels are world-XZ parcels. Each step back-traces by the supplied
 * surface velocity, carries foaminess / age / pattern coordinates, injects
 * new whitewater, and lets old foam thin, hole, and fragment in parcel space.
 */
export function createBeachFoamField(renderer, {
  injectionNode,
  velocityNode,
  size = DEFAULT_SIZE,
  worldSize = DEFAULT_WORLD_SIZE,
  originX = 0,
  originZ = 78,
  stepHz = DEFAULT_STEP_HZ,
  decaySeconds = DEFAULT_DECAY_SECONDS,
  spread = DEFAULT_SPREAD,
} = {}) {
  if (!renderer || typeof renderer.compute !== "function") {
    throw new TypeError("Beach foam requires an initialized WebGPU renderer.");
  }
  if (typeof injectionNode !== "function") {
    throw new TypeError("Beach foam requires an injectionNode(point) callback.");
  }

  const fieldSize = positiveInteger(size, DEFAULT_SIZE);
  const fieldWorldSize = Math.max(1, finiteNumber(worldSize, DEFAULT_WORLD_SIZE));
  const fieldOriginX = finiteNumber(originX, 0);
  const fieldOriginZ = finiteNumber(originZ, 78);
  const fixedStep = 1 / Math.max(1, finiteNumber(stepHz, DEFAULT_STEP_HZ));
  const lifetime = Math.max(0.05, finiteNumber(decaySeconds, DEFAULT_DECAY_SECONDS));
  const spatialSpread = Math.max(0, finiteNumber(spread, DEFAULT_SPREAD));
  const sampleVelocity = typeof velocityNode === "function"
    ? velocityNode
    : () => vec2(0, 0);

  const history = [
    makeHistoryTexture(fieldSize, "Beach foam history A"),
    makeHistoryTexture(fieldSize, "Beach foam history B"),
  ];
  const display = makeHistoryTexture(fieldSize, "Beach foam display");
  const stepDelta = uniform(fixedStep);

  const buildStep = (readIndex, writeIndex) => Fn(() => {
    const id = instanceIndex;
    const coord = uvec2(
      id.mod(uint(fieldSize)),
      id.div(uint(fieldSize)),
    );
    const uv = vec2(float(coord.x), float(coord.y))
      .add(0.5)
      .div(fieldSize);
    const worldXZ = uv.sub(0.5).mul(fieldWorldSize)
      .add(vec2(fieldOriginX, fieldOriginZ));
    const point = vec3(worldXZ.x, 0, worldXZ.y);
    const flow = sampleVelocity(point);
    const backtracedUv = uv.sub(flow.mul(stepDelta).div(fieldWorldSize));
    const texel = float(1 / fieldSize);
    const tap = (offsetX, offsetY) => texture(
      history[readIndex],
      backtracedUv.add(vec2(texel.mul(offsetX), texel.mul(offsetY))),
    ).level(float(0));
    const centrePacked = tap(0, 0);
    const centre = centrePacked.x;
    const alongCrest = tap(-0.34, 0.94).x.add(tap(0.34, -0.94).x).mul(0.5);
    const isotropic = tap(1, 0).x
      .add(tap(-1, 0).x)
      .add(tap(0, 1).x)
      .add(tap(0, -1).x)
      .mul(0.25);
    const blurWeight = min(stepDelta.mul(spatialSpread), float(MAX_BLUR_WEIGHT));
    const youngSpread = float(1).sub(smoothstep(0.08, 0.42, centrePacked.y));
    const spreadTarget = mix(alongCrest, isotropic, mix(float(0.22), float(0.7), youngSpread));
    const previous = mix(centre, spreadTarget, blurWeight);
    const decayed = previous.mul(exp(stepDelta.negate().div(lifetime)));
    const injected = min(max(injectionNode(point), float(0)), float(MAX_FOAMINESS));
    const hasHistory = smoothstep(0.012, 0.07, centre);
    const parcel = mix(
      worldXZ,
      centrePacked.zw,
      hasHistory,
    );
    const resetParcel = mix(parcel, worldXZ, saturate(injected.sub(0.22).mul(1.8)));
    const aged = min(
      mix(
        centrePacked.y.add(stepDelta.div(lifetime)),
        float(0),
        saturate(injected.sub(0.32).mul(2.4)),
      ),
      float(1),
    );
    const fragmentNoise = mx_noise_float(vec3(
      resetParcel.x.mul(0.16),
      4.7,
      resetParcel.y.mul(0.14),
    ));
    const fragment = mix(
      float(1),
      smoothstep(float(-0.22), float(0.48), fragmentNoise),
      saturate(aged.mul(1.15).sub(0.28)),
    );
    const pinchNoise = mx_noise_float(vec3(
      resetParcel.x.mul(0.31),
      8.2,
      resetParcel.y.mul(0.27),
    ));
    const pinch = mix(
      float(1),
      smoothstep(float(-0.05), float(0.42), pinchNoise),
      saturate(aged.mul(1.35).sub(0.48)),
    );
    const dissolveRate = float(0.12)
      .add(aged.mul(1.65))
      .mul(float(1.2).sub(min(decayed, float(1))));
    const dissolved = decayed
      .mul(exp(stepDelta.negate().mul(dissolveRate)))
      .mul(fragment)
      .mul(pinch);
    const border = min(
      min(uv.x, uv.y),
      min(float(1).sub(uv.x), float(1).sub(uv.y)),
    );
    const inField = smoothstep(0.0, 0.04, border);
    const foaminess = min(max(injected, dissolved), float(MAX_FOAMINESS)).mul(inField);
    const packed = vec4(foaminess, aged, resetParcel.x, resetParcel.y);

    textureStore(history[writeIndex], coord, packed).toWriteOnly();
    textureStore(display, coord, packed).toWriteOnly();
  })().compute(fieldSize * fieldSize);

  const steps = [buildStep(0, 1), buildStep(1, 0)];
  const clearCompute = Fn(() => {
    const id = instanceIndex;
    const coord = uvec2(
      id.mod(uint(fieldSize)),
      id.div(uint(fieldSize)),
    );
    const empty = vec4(0, 0, 0, 1);
    textureStore(history[0], coord, empty).toWriteOnly();
    textureStore(history[1], coord, empty).toWriteOnly();
    textureStore(display, coord, empty).toWriteOnly();
  })().compute(fieldSize * fieldSize);

  let accumulator = 0;
  let parity = 0;
  let disposed = false;

  function uvNode(point) {
    return vec2(point.x, point.z)
      .sub(vec2(fieldOriginX, fieldOriginZ))
      .div(fieldWorldSize)
      .add(0.5);
  }

  return {
    texture: display,
    size: fieldSize,
    worldSize: fieldWorldSize,
    originX: fieldOriginX,
    originZ: fieldOriginZ,

    uvNode,

    sampleNode(point) {
      const sampleUv = uvNode(point);
      const texel = float(1 / fieldSize);
      const packed = texture(display, sampleUv).level(float(0));
      const footprintTexels = max(
        fwidth(sampleUv.x),
        fwidth(sampleUv.y),
      ).mul(fieldSize);
      const radius = texel.mul(
        footprintTexels.mul(0.58).max(0.7).min(8),
      );
      const tap = sampleOffset => texture(
        display,
        sampleUv.add(sampleOffset),
      ).level(float(0)).x;
      const cardinal = tap(vec2(radius, 0))
        .add(tap(vec2(radius.negate(), 0)))
        .add(tap(vec2(0, radius)))
        .add(tap(vec2(0, radius.negate())));
      const diagonalRadius = radius.mul(0.70710678);
      const diagonal = tap(vec2(diagonalRadius, diagonalRadius))
        .add(tap(vec2(diagonalRadius.negate(), diagonalRadius)))
        .add(tap(vec2(diagonalRadius, diagonalRadius.negate())))
        .add(tap(vec2(diagonalRadius.negate(), diagonalRadius.negate())));
      const mass = tap(vec2(0)).mul(0.28)
        .add(cardinal.mul(0.12))
        .add(diagonal.mul(0.06));
      return vec4(mass, packed.y, packed.z, packed.w);
    },

    update(deltaSeconds, active = true) {
      if (disposed || !active) return 0;
      const delta = Math.max(0, Math.min(
        finiteNumber(deltaSeconds, 0),
        fixedStep * MAX_STEPS_PER_UPDATE,
      ));
      accumulator = Math.min(
        accumulator + delta,
        fixedStep * MAX_STEPS_PER_UPDATE,
      );

      let submitted = 0;
      while (accumulator + 1e-9 >= fixedStep && submitted < MAX_STEPS_PER_UPDATE) {
        stepDelta.value = fixedStep;
        renderer.compute(steps[parity]);
        parity ^= 1;
        accumulator -= fixedStep;
        submitted += 1;
      }
      return submitted;
    },

    clear() {
      if (disposed) return;
      renderer.compute(clearCompute);
      accumulator = 0;
      parity = 0;
    },

    resize() {
      return false;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      history[0].dispose();
      history[1].dispose();
      display.dispose();
    },
  };
}
