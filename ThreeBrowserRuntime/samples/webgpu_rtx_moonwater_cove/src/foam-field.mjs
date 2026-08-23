import {
  HalfFloatType,
  LinearFilter,
  RepeatWrapping,
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
  texture,
  textureStore,
  uint,
  uniform,
  uvec2,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

const DEFAULT_SIZE = 384;
const DEFAULT_WORLD_SIZE = 768;
const DEFAULT_STEP_HZ = 30;
const DEFAULT_DECAY_SECONDS = 5.5;
const DEFAULT_SPREAD = 1.1;
const MAX_STEPS_PER_UPDATE = 3;
const MAX_BLUR_WEIGHT = 0.25;
const MAX_FOAMINESS = 4;

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
  result.wrapS = RepeatWrapping;
  result.wrapT = RepeatWrapping;
  result.minFilter = LinearFilter;
  result.magFilter = LinearFilter;
  result.generateMipmaps = false;
  return result;
}

/**
 * Persistent, world-space white-water state for the JS/TSL ocean sample.
 *
 * `injectionNode(point)` receives a TSL vec3 in the same XZ coordinate system
 * as the ocean plane and must return current breaker foaminess. The simulation
 * keeps that authored source in a pair of ping-ponged half-float textures,
 * back-traces it by the surface drift, dissipates it in space and time, and
 * exposes one stable sampled texture to the water materials.
 *
 * The field is intentionally independent of the window size. Resizing the
 * swapchain therefore cannot reset the foam or change its physical lifetime.
 */
export function createOceanFoamField(renderer, {
  injectionNode,
  size = DEFAULT_SIZE,
  worldSize = DEFAULT_WORLD_SIZE,
  originX = 0,
  originZ = -192,
  driftX = -0.090,
  driftZ = -0.266,
  stepHz = DEFAULT_STEP_HZ,
  decaySeconds = DEFAULT_DECAY_SECONDS,
  spread = DEFAULT_SPREAD,
} = {}) {
  if (!renderer || typeof renderer.compute !== "function") {
    throw new TypeError("Ocean foam requires an initialized WebGPU renderer.");
  }
  if (typeof injectionNode !== "function") {
    throw new TypeError("Ocean foam requires an injectionNode(point) callback.");
  }

  const fieldSize = positiveInteger(size, DEFAULT_SIZE);
  const fieldWorldSize = Math.max(1, finiteNumber(worldSize, DEFAULT_WORLD_SIZE));
  const fieldOriginX = finiteNumber(originX, 0);
  const fieldOriginZ = finiteNumber(originZ, -192);
  const fixedStep = 1 / Math.max(1, finiteNumber(stepHz, DEFAULT_STEP_HZ));
  const lifetime = Math.max(0.05, finiteNumber(decaySeconds, DEFAULT_DECAY_SECONDS));
  const spatialSpread = Math.max(0, finiteNumber(spread, DEFAULT_SPREAD));
  const surfaceDriftX = finiteNumber(driftX, -0.090);
  const surfaceDriftZ = finiteNumber(driftZ, -0.266);

  const history = [
    makeHistoryTexture(fieldSize, "Moonwater foam history A"),
    makeHistoryTexture(fieldSize, "Moonwater foam history B"),
  ];
  // Materials sample a stable resource while the hidden histories alternate.
  // This costs one additional storage write per simulation step, but avoids a
  // dynamic texture-binding mutation and keeps the material graph immutable.
  const display = makeHistoryTexture(fieldSize, "Moonwater foam display");
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

    // Foam is a bubble raft, not a feature glued to the phase velocity of its
    // carrier wave. Back-trace by the much slower windage + Stokes drift, then
    // sample the previous state at texel centres to avoid accidental blur.
    const backtracedUv = uv.sub(
      vec2(surfaceDriftX, surfaceDriftZ)
        .mul(stepDelta)
        .div(fieldWorldSize),
    );
    const texel = float(1 / fieldSize);
    const tap = (offsetX, offsetY) => texture(
      history[readIndex],
      backtracedUv.add(vec2(texel.mul(offsetX), texel.mul(offsetY))),
    ).level(float(0)).x;
    const centre = tap(0, 0);
    // Bubble rafts spread preferentially along a breaking crest (cross-wind),
    // not equally in every direction. This three-tap kernel rounds cell edges
    // while retaining a narrow along-wind leading edge.
    const crosswind = vec2(-0.947, 0.32);
    const crestSpread = tap(crosswind.x, crosswind.y)
      .add(tap(crosswind.x.negate(), crosswind.y.negate()))
      .mul(0.5);
    const blurWeight = min(
      stepDelta.mul(spatialSpread),
      float(MAX_BLUR_WEIGHT),
    );
    const previous = mix(centre, crestSpread, blurWeight);
    const decayed = previous.mul(exp(stepDelta.negate().div(lifetime)));
    const injected = min(
      max(injectionNode(point), float(0)),
      float(MAX_FOAMINESS),
    );
    const foaminess = max(injected, decayed);
    const packed = vec4(foaminess, 0, 0, 1);

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
      // A history texel represents a world-space foam parcel, not a visible
      // square of white water. Reconstruct the slowly varying parcel envelope
      // from four sub-texel taps here; the material adds the sub-metre bubble
      // filaments. Keeping that detail out of the compute field avoids a very
      // large screen-independent simulation texture while removing its grid
      // from close camera views.
      const sampleUv = uvNode(point);
      const texel = float(1 / fieldSize);
      // The field has no hardware mip chain because it is written as a
      // storage texture. Reconstruct an isotropic footprint explicitly so a
      // distant pixel integrates several world cells instead of exposing one
      // square texel. Close views retain a sub-texel radius and the authored
      // crest direction remains in the simulation itself.
      const footprintTexels = max(
        fwidth(sampleUv.x),
        fwidth(sampleUv.y),
      ).mul(fieldSize);
      const radius = texel.mul(
        footprintTexels.mul(0.58).max(0.72).min(10),
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
      return tap(vec2(0)).mul(0.25)
        .add(cardinal.mul(0.125))
        .add(diagonal.mul(0.0625));
    },

    /** Advance at a fixed cadence; returns the number of GPU steps submitted. */
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

    /** Clear both histories and the stable display texture immediately. */
    clear() {
      if (disposed) return;
      renderer.compute(clearCompute);
      accumulator = 0;
      parity = 0;
    },

    /** Viewport resize is deliberately a no-op; the simulation is world-sized. */
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
