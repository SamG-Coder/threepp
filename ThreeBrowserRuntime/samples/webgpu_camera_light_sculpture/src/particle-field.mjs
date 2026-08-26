import * as THREE from "three/webgpu";
import {
  Fn,
  color,
  cos,
  exp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  max,
  min,
  mix,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export const PARTICLE_FIELD_DEFAULT_COUNT = 65_536;

const MAX_PARTICLE_COUNT = 262_144;
const FIXED_STEP_SECONDS = 1 / 60;
const MAX_STEPS_PER_UPDATE = 4;
const MAX_FRAME_DELTA_SECONDS = FIXED_STEP_SECONDS * MAX_STEPS_PER_UPDATE;
const PARTICLE_SIZE = 0.012;
const MAX_SPEED = 2.8;

// Force constants are in the orthographic world where y spans [-1, 1].
const ATTRACTION_FORCE = 7.2;
const REPULSION_FORCE = 9.4;
const VORTEX_FORCE = 4.6;
const PULSE_REPULSION = 13.5;
const HAND_VELOCITY_INJECTION = 5.2;
const CLOSED_GATHER_FORCE = 11.2;
const CLOSED_SPIRAL_FORCE = 8.1;
const CLOSED_TIGHTENING = 5.8;
const CLOSED_GATHER_RADIUS = 0.22;
const OPEN_BLOOM_FORCE = 13.4;
const OPEN_BLOOM_RADIUS = 0.84;
const SWIPE_VELOCITY_INJECTION = 13.2;
const SWIPE_HEAD_RADIUS = 0.36;
const SWIPE_WAKE_WIDTH = 0.17;
const SWIPE_WAKE_LENGTH = 0.72;
const SWIPE_WAKE_TURBULENCE = 2.2;
// Point mode deliberately reaches much farther than the compact grip vortex.
// The small capture floor gives even edge particles a coherent drift toward
// the finger; the Gaussian still concentrates the visible mass locally.
const POINT_FOLLOW_RADIUS = 0.74;
const POINT_CAPTURE_FLOOR = 0.12;
const POINT_FOLLOW_FORCE = 16.8;
const POINT_PREDICTIVE_FORCE = 12.4;
const POINT_ORBIT_FORCE = 9.2;
const POINT_VELOCITY_MATCH = 12.8;
const POINT_LOOKAHEAD_SECONDS = 0.045;
const POINT_TRAIL_DECAY = 2.15;
const CLOSED_CHARGE_RATE = 1.9;
const CLOSED_CHARGE_DECAY = 0.22;
const OPEN_RELEASE_IMPULSE = 24;
const OPEN_RELEASE_SHELL_WIDTH = 0.012;
const OPEN_RELEASE_GLOW_DECAY = 3.4;
const OPEN_RELEASE_CHARGE_DRAIN = 0.82;
const CURL_FORCE = 0.72;
const CURL_SPATIAL_FREQUENCY = 3.1;
const CURL_TIME_SCALE = 0.32;
const LINEAR_DAMPING = 1.35;
const SOFT_BOUNDARY_START = 0.76;
const CONTAINMENT_FORCE = 54;

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, low, high, fallback) {
  return Math.min(high, Math.max(low, finiteNumber(value, fallback)));
}

function normaliseParticleCount(value) {
  return Math.min(
    MAX_PARTICLE_COUNT,
    Math.max(1, Math.floor(finiteNumber(value, PARTICLE_FIELD_DEFAULT_COUNT))),
  );
}

function component(value, axis, index, fallback = 0) {
  if (value == null) return fallback;
  return finiteNumber(value[axis] ?? value[index], fallback);
}

function copyVector3(target, value, limit = Number.POSITIVE_INFINITY) {
  target.set(
    clampNumber(component(value, "x", 0), -limit, limit, 0),
    clampNumber(component(value, "y", 1), -limit, limit, 0),
    clampNumber(component(value, "z", 2), -limit, limit, 0),
  );
}

function writeGestureMode(target, source) {
  const value = source?.mode ?? source?.gesture ?? source?.gestureMode;
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (["closed", "grip", "pinch", "gather"].includes(mode)) {
    target.set(1, 0, 0, 0);
  } else if (["open", "bloom", "expand", "push"].includes(mode)) {
    target.set(0, 1, 0, 0);
  } else if (["swipe", "sweep", "flick", "throw"].includes(mode)) {
    target.set(0, 0, 1, 0);
  } else if (["point", "follow", "fingertip", "hover"].includes(mode)) {
    target.set(0, 0, 0, 1);
  } else {
    // No explicit mode preserves the original continuous openness behavior.
    target.set(0, 0, 0, 0);
  }
}

/**
 * Creates the persistent GPU particle sculpture used over the camera image.
 *
 * Attractor positions use the orthographic world: x is `[-aspect, aspect]`
 * and y is `[-1, 1]`. A hand's `openness` continuously changes its radial
 * force from a tight attractive vortex at zero to expansion at one. Explicit
 * `mode` values (`point`/`follow`, `closed`/`grip`, `open`, or `swipe`) select
 * distinct gesture signatures. `pulse` adds an outward impulse and triggers
 * open-hand release, while `velocity` drags nearby particles in the hand's
 * direction. The first and second attractors have opposite vortex handedness.
 */
export function createParticleField(renderer, { count = PARTICLE_FIELD_DEFAULT_COUNT } = {}) {
  if (!renderer || typeof renderer.compute !== "function") {
    throw new TypeError("Particle field requires an initialized WebGPU renderer.");
  }

  const particleCount = normaliseParticleCount(count);

  // Position.w carries speed into the render stage, so only this one storage
  // buffer is visible to the vertex/fragment graph. Velocity remains compute-only.
  const particlePositions = instancedArray(particleCount, "vec4")
    .setName("cameraSculpturePositions");
  const particleVelocities = instancedArray(particleCount, "vec4")
    .setName("cameraSculptureVelocities");
  // Follow-trail, release-shock and closed-charge energy remain GPU-resident.
  const particleVisualEnergy = instancedArray(particleCount, "vec4")
    .setName("cameraSculptureVisualEnergy");

  const stepDeltaUniform = uniform(FIXED_STEP_SECONDS);
  const simulationTimeUniform = uniform(0);
  const aspectUniform = uniform(1);

  // Keep two explicit uniform centres: no CPU particle uploads are needed when
  // either tracked hand moves. The companion controls are radial strength,
  // openness, pulse and active state, respectively.
  const attractorCenterA = uniform(new THREE.Vector3());
  const attractorCenterB = uniform(new THREE.Vector3());
  const attractorVelocityA = uniform(new THREE.Vector3());
  const attractorVelocityB = uniform(new THREE.Vector3());
  const attractorControlA = uniform(new THREE.Vector4(0, 0.5, 0, 0));
  const attractorControlB = uniform(new THREE.Vector4(0, 0.5, 0, 0));
  // xyzw are closed/open/swipe/point weights. A zero vector deliberately
  // selects the backwards-compatible openness-driven behavior.
  const attractorGestureA = uniform(new THREE.Vector4());
  const attractorGestureB = uniform(new THREE.Vector4());

  const initialiseParticles = Fn(() => {
    const id = instanceIndex;
    const randomAngle = hash(id).mul(Math.PI * 2);
    const randomRadius = hash(id.add(1_013_904_223)).sqrt();
    // Keep offsets below signed i32 max; r184's literal inference may otherwise
    // emit an overflowing WGSL integer before hash() converts the seed to uint.
    const randomDepth = hash(id.add(1_664_525_927)).sub(0.5);
    const randomPhase = hash(id.add(747_796_405)).mul(Math.PI * 2);

    // A low-discrepancy elliptical cloud gives the flow immediate structure
    // without a CPU-generated seed buffer or a visible square distribution.
    const radius = randomRadius.mul(0.88);
    const position = vec3(
      cos(randomAngle).mul(radius).mul(1.18),
      sin(randomAngle).mul(radius).mul(0.86),
      randomDepth.mul(0.14),
    );
    const initialVelocity = vec3(
      sin(randomAngle).mul(-0.035),
      cos(randomAngle).mul(0.035),
      sin(randomPhase).mul(0.008),
    );

    particlePositions.element(id).assign(vec4(position, 0));
    particleVelocities.element(id).assign(vec4(initialVelocity, randomPhase));
    particleVisualEnergy.element(id).assign(vec4(0));
  })().compute(particleCount, [64, 1, 1]).setName("Initialize camera particle field");

  const advanceParticles = Fn(() => {
    const id = instanceIndex;
    const packedPosition = particlePositions.element(id);
    const packedVelocity = particleVelocities.element(id);
    const packedVisualEnergy = particleVisualEnergy.element(id);
    const position = packedPosition.xyz.toVar("particlePosition");
    const velocity = packedVelocity.xyz.toVar("particleVelocity");
    const particlePhase = packedVelocity.w;
    const acceleration = vec3(0).toVar("particleAcceleration");
    const followTrailEnergy = packedVisualEnergy.x.mul(
      exp(stepDeltaUniform.mul(-POINT_TRAIL_DECAY)),
    ).toVar("followTrailEnergy");
    const openReleaseGlow = packedVisualEnergy.y.mul(
      exp(stepDeltaUniform.mul(-OPEN_RELEASE_GLOW_DECAY)),
    ).toVar("openReleaseGlow");
    const closedCharge = packedVisualEnergy.z.mul(
      exp(stepDeltaUniform.mul(-CLOSED_CHARGE_DECAY)),
    ).toVar("closedCharge");

    const applyAttractor = (center, handVelocity, controls, gesture, handedness) => {
      const offsetToCenter = center.sub(position).toVar();
      const distanceSquared = offsetToCenter.dot(offsetToCenter).add(0.0008);
      const distance = distanceSquared.sqrt();
      const towardCenter = offsetToCenter.div(distance);
      const openness = controls.y;
      const active = controls.w;
      const closedMode = gesture.x;
      const openMode = gesture.y;
      const swipeMode = gesture.z;
      const pointMode = gesture.w;
      const explicitMode = min(
        float(1),
        closedMode.add(openMode).add(swipeMode).add(pointMode),
      );
      const legacyMode = explicitMode.oneMinus();
      const legacyRadius = mix(float(0.28), float(0.68), openness);
      const influenceRadius = legacyRadius.mul(legacyMode)
        .add(closedMode.mul(CLOSED_GATHER_RADIUS))
        .add(openMode.mul(OPEN_BLOOM_RADIUS))
        .add(swipeMode.mul(SWIPE_HEAD_RADIUS))
        .add(pointMode.mul(POINT_FOLLOW_RADIUS));
      const falloff = exp(
        distanceSquared.negate().div(influenceRadius.mul(influenceRadius)),
      ).mul(active);

      // A closed/pinched hand attracts; an open palm repels. Keeping both terms
      // explicit makes the legacy middle pose neutral rather than discontinuous.
      const attraction = openness.oneMinus().mul(ATTRACTION_FORCE);
      const repulsion = openness.mul(REPULSION_FORCE);
      const legacyRadialForce = attraction.sub(repulsion).mul(legacyMode);
      const gestureRadialForce = closedMode.mul(CLOSED_GATHER_FORCE)
        .sub(openMode.mul(OPEN_BLOOM_FORCE))
        .add(pointMode.mul(POINT_FOLLOW_FORCE));
      const radialForce = legacyRadialForce.add(gestureRadialForce).mul(controls.x);
      acceleration.addAssign(towardCenter.mul(radialForce).mul(falloff));

      // Closed-hand gathering also stores a local charge on the affected
      // particles. The charge is released only by an explicit open pulse.
      const chargeAdded = stepDeltaUniform.mul(CLOSED_CHARGE_RATE)
        .mul(closedMode)
        .mul(controls.x.abs())
        .mul(falloff);
      closedCharge.assign(min(float(1), closedCharge.add(chargeAdded)));

      // Grip mode tightens the spiral by cancelling only outward radial motion;
      // inward flow and tangential momentum remain intact.
      const outwardSpeed = velocity.dot(towardCenter).negate().max(0);
      acceleration.addAssign(
        towardCenter.mul(outwardSpeed)
          .mul(CLOSED_TIGHTENING)
          .mul(closedMode)
          .mul(controls.x.abs())
          .mul(falloff),
      );

      // Point/follow predicts the moving fingertip slightly ahead, then combines
      // tight attraction with velocity matching. Particles orbit the actual
      // fingertip while their centre of mass follows the predicted point.
      const predictedFingertip = center.add(
        handVelocity.mul(POINT_LOOKAHEAD_SECONDS),
      );
      const offsetToPrediction = predictedFingertip.sub(position);
      const predictionDistanceSquared = offsetToPrediction.dot(offsetToPrediction)
        .add(0.0008);
      const predictionDirection = offsetToPrediction.div(
        predictionDistanceSquared.sqrt(),
      );
      const pointCaptureShape = max(float(POINT_CAPTURE_FLOOR), exp(
        predictionDistanceSquared.negate().div(
          POINT_FOLLOW_RADIUS * POINT_FOLLOW_RADIUS,
        ),
      ));
      const pointFollowFalloff = pointCaptureShape.mul(pointMode).mul(active);
      acceleration.addAssign(
        predictionDirection.mul(POINT_PREDICTIVE_FORCE)
          .mul(controls.x.abs())
          .mul(pointFollowFalloff),
      );
      acceleration.addAssign(
        handVelocity.mul(POINT_VELOCITY_MATCH)
          .mul(controls.x.abs())
          .mul(pointFollowFalloff),
      );
      const pointTrailStamp = pointFollowFalloff.mul(
        min(float(1), handVelocity.length().mul(0.22).add(0.42)),
      );
      followTrailEnergy.assign(max(followTrailEnergy, pointTrailStamp));

      // Tangential force gives each hand a coherent vortex. Opposite handedness
      // lets two hands braid the field rather than merely translating it.
      const tangent = vec3(
        towardCenter.y.negate(),
        towardCenter.x,
        sin(particlePhase.add(simulationTimeUniform)).mul(0.12),
      ).normalize();
      const legacyVortex = openness.oneMinus().mul(0.72).add(0.28)
        .mul(VORTEX_FORCE)
        .mul(legacyMode);
      const gestureVortex = closedMode.mul(CLOSED_SPIRAL_FORCE)
        .add(openMode.mul(VORTEX_FORCE * 0.16))
        .add(swipeMode.mul(VORTEX_FORCE * 0.22))
        .add(pointMode.mul(POINT_ORBIT_FORCE));
      const vortexAmount = controls.x.abs()
        .mul(legacyVortex.add(gestureVortex))
        .mul(handedness);
      acceleration.addAssign(tangent.mul(vortexAmount).mul(falloff));

      // Non-swipe hand velocity retains the original gentle local entrainment.
      const nonSwipeInjection = legacyMode.mul(HAND_VELOCITY_INJECTION)
        .add(closedMode.mul(HAND_VELOCITY_INJECTION * 0.56))
        .add(openMode.mul(HAND_VELOCITY_INJECTION * 0.72))
        .add(pointMode.mul(HAND_VELOCITY_INJECTION * 0.42));
      acceleration.addAssign(
        handVelocity.mul(nonSwipeInjection).mul(falloff),
      );

      // Swipe has both a strong head impulse and an elongated trail behind the
      // moving hand. The lateral/behind decomposition makes the wake directional
      // rather than another circular attractor falloff.
      const handSpeed = handVelocity.length();
      const swipeDirection = handVelocity.div(max(handSpeed, float(0.001)));
      const fromCenter = position.sub(center);
      const distanceAlongSwipe = fromCenter.dot(swipeDirection);
      const behindDistance = distanceAlongSwipe.negate().max(0);
      const lateralOffset = fromCenter.sub(swipeDirection.mul(distanceAlongSwipe));
      const lateralDistanceSquared = lateralOffset.dot(lateralOffset);
      const behindGate = smoothstep(0.012, 0.09, behindDistance);
      const wakeFalloff = exp(
        lateralDistanceSquared.negate().div(SWIPE_WAKE_WIDTH * SWIPE_WAKE_WIDTH),
      ).mul(exp(behindDistance.negate().div(SWIPE_WAKE_LENGTH)))
        .mul(behindGate)
        .mul(swipeMode)
        .mul(active);
      const swipeHeadFalloff = falloff.mul(swipeMode);
      acceleration.addAssign(
        handVelocity.mul(SWIPE_VELOCITY_INJECTION)
          .mul(controls.x.abs())
          .mul(swipeHeadFalloff.add(wakeFalloff.mul(0.82))),
      );
      const wakeTangent = vec3(
        swipeDirection.y.negate(),
        swipeDirection.x,
        sin(particlePhase.add(simulationTimeUniform.mul(2.1))).mul(0.1),
      );
      acceleration.addAssign(
        wakeTangent.mul(SWIPE_WAKE_TURBULENCE)
          .mul(handSpeed)
          .mul(controls.x.abs())
          .mul(wakeFalloff)
          .mul(handedness),
      );

      // A gesture pulse is a separate repulsion so it remains readable through
      // attraction. Open mode broadens it into an unmistakable bloom.
      const pulseArea = float(0.055).mul(legacyMode)
        .add(closedMode.mul(0.035))
        .add(openMode.mul(0.20))
        .add(swipeMode.mul(0.09))
        .add(pointMode.mul(0.045));
      const pulseFalloff = exp(distanceSquared.negate().div(pulseArea)).mul(active);
      const pulseStrength = float(PULSE_REPULSION)
        .mul(openMode.mul(0.65).add(1));
      acceleration.addAssign(
        towardCenter.negate()
          .mul(controls.z)
          .mul(pulseStrength)
          .mul(pulseFalloff),
      );

      // Opening after a charged grip emits a distinct one-shot shell. `pulse`
      // is supplied by the gesture transition and can decay from one to zero;
      // that decay moves the shell outward while reducing its amplitude.
      const releaseRadius = mix(float(0.10), float(0.72), controls.z.oneMinus());
      const distanceFromReleaseShell = distance.sub(releaseRadius);
      const releaseShell = exp(
        distanceFromReleaseShell.mul(distanceFromReleaseShell)
          .negate()
          .div(OPEN_RELEASE_SHELL_WIDTH),
      ).mul(openMode).mul(active).mul(controls.z);
      const releasePower = closedCharge.mul(1.35).add(0.55)
        .mul(OPEN_RELEASE_IMPULSE)
        .mul(controls.x.abs());
      acceleration.addAssign(
        towardCenter.negate().mul(releasePower).mul(releaseShell),
      );
      openReleaseGlow.assign(max(
        openReleaseGlow,
        releaseShell.mul(closedCharge.mul(0.72).add(0.42)),
      ));
      closedCharge.mulAssign(
        float(1).sub(
          openMode.mul(controls.z).mul(OPEN_RELEASE_CHARGE_DRAIN),
        ).max(0),
      );
    };

    applyAttractor(
      attractorCenterA,
      attractorVelocityA,
      attractorControlA,
      attractorGestureA,
      1,
    );
    applyAttractor(
      attractorCenterB,
      attractorVelocityB,
      attractorControlB,
      attractorGestureB,
      -1,
    );

    // Analytic curl noise: every component depends only on the other two axes,
    // so its divergence is exactly zero without texture samples or finite
    // differences. Two offset sin/cos waves avoid an obviously periodic orbit.
    const curlPoint = position.mul(CURL_SPATIAL_FREQUENCY).add(particlePhase);
    const curlTime = simulationTimeUniform.mul(CURL_TIME_SCALE);
    const analyticCurlNoise = vec3(
      sin(curlPoint.y.add(curlTime))
        .sub(cos(curlPoint.z.sub(curlTime.mul(1.13)))),
      sin(curlPoint.z.add(curlTime.mul(0.87)))
        .sub(cos(curlPoint.x.add(curlTime.mul(1.07)))),
      sin(curlPoint.x.sub(curlTime.mul(0.91)))
        .sub(cos(curlPoint.y.sub(curlTime.mul(0.73)))),
    );
    acceleration.addAssign(analyticCurlNoise.mul(CURL_FORCE));

    // Soft containment begins before the visible edges. There is deliberately
    // no hard clamp or reset, so coherent streams fold back into the sculpture.
    const bounds = vec3(aspectUniform.mul(0.97), 0.97, 0.18);
    const normalisedPosition = position.div(bounds);
    const boundaryPenetration = normalisedPosition.abs()
      .sub(SOFT_BOUNDARY_START)
      .max(0);
    const containment = boundaryPenetration.mul(boundaryPenetration)
      .mul(normalisedPosition.sign())
      .negate()
      .mul(CONTAINMENT_FORCE);
    acceleration.addAssign(containment);

    velocity.addAssign(acceleration.mul(stepDeltaUniform));
    velocity.mulAssign(exp(stepDeltaUniform.mul(-LINEAR_DAMPING)));

    // A smooth global cap bounds energy after a fast tracked-hand discontinuity.
    const speedBeforeCap = velocity.length();
    const speedScale = min(
      float(1),
      float(MAX_SPEED).div(max(speedBeforeCap, float(0.0001))),
    );
    velocity.mulAssign(speedScale);
    position.addAssign(velocity.mul(stepDeltaUniform));

    particlePositions.element(id).assign(vec4(position, velocity.length()));
    particleVelocities.element(id).assign(vec4(velocity, particlePhase));
    particleVisualEnergy.element(id).assign(vec4(
      min(float(1), followTrailEnergy),
      min(float(1), openReleaseGlow),
      min(float(1), closedCharge),
      0,
    ));
  })().compute(particleCount, [64, 1, 1]).setName("Advance camera particle field");

  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.name = "Soft particle billboard quad";

  const material = new THREE.SpriteNodeMaterial();
  material.name = "Violet magenta additive particle material";
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = false;
  material.blending = THREE.AdditiveBlending;
  material.toneMapped = false;

  const positionAttribute = particlePositions.toAttribute();
  const visualEnergyAttribute = particleVisualEnergy.toAttribute();
  material.positionNode = positionAttribute.xyz;

  const speedEnergy = smoothstep(0.08, MAX_SPEED * 0.72, positionAttribute.w);
  const followGlow = visualEnergyAttribute.x;
  const releaseGlow = visualEnergyAttribute.y;
  const chargeGlow = visualEnergyAttribute.z;
  const displayEnergy = max(speedEnergy, max(followGlow, releaseGlow));
  material.scaleNode = vec2(
    mix(float(PARTICLE_SIZE * 0.72), float(PARTICLE_SIZE * 1.48), displayEnergy),
  );

  const proximityEnergy = max(
    exp(positionAttribute.xyz.sub(attractorCenterA).dot(
      positionAttribute.xyz.sub(attractorCenterA),
    ).negate().div(0.11)).mul(attractorControlA.w),
    exp(positionAttribute.xyz.sub(attractorCenterB).dot(
      positionAttribute.xyz.sub(attractorCenterB),
    ).negate().div(0.11)).mul(attractorControlB.w),
  );
  const colourEnergy = max(
    max(speedEnergy, followGlow.mul(0.94)),
    proximityEnergy.mul(0.92),
  );
  const violetToMagenta = mix(
    color(0x120024), // deep violet
    color(0xd020ff), // electric magenta
    smoothstep(0.02, 0.62, colourEnergy),
  );
  const hotParticleColour = mix(
    violetToMagenta,
    color(0xffefff), // hot pale core
    smoothstep(0.58, 1, colourEnergy),
  );
  const chargedParticleColour = mix(
    hotParticleColour,
    color(0xff72ef),
    chargeGlow.mul(0.58),
  );
  const followedParticleColour = mix(
    chargedParticleColour,
    color(0xf1dcff),
    followGlow.mul(0.68),
  );
  const coolShockwaveColour = mix(
    color(0x30bfff),
    color(0xedffff),
    smoothstep(0.16, 0.92, releaseGlow),
  );
  material.colorNode = mix(
    followedParticleColour,
    coolShockwaveColour,
    smoothstep(0.025, 0.78, releaseGlow),
  );

  // Analytic radial alpha creates a genuinely soft particle without a texture.
  const radiusFromCenter = uv().sub(0.5).length().mul(2);
  const softParticleAlpha = radiusFromCenter.oneMinus().max(0).pow(1.85);
  material.opacityNode = softParticleAlpha.mul(
    mix(float(0.10), float(0.27), max(colourEnergy, releaseGlow)),
  );

  const mesh = new THREE.InstancedMesh(geometry, material, particleCount);
  mesh.name = "GPU camera light sculpture particles";
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;

  let accumulator = 0;
  let simulationTime = 0;
  let totalSubmittedSteps = 0;
  let resetCount = 0;
  let disposed = false;
  let initialized = false;
  let latestAspect = 1;

  function writeAttractor(slot, source) {
    const centerUniform = slot === 0 ? attractorCenterA : attractorCenterB;
    const velocityUniform = slot === 0 ? attractorVelocityA : attractorVelocityB;
    const controlUniform = slot === 0 ? attractorControlA : attractorControlB;
    const gestureUniform = slot === 0 ? attractorGestureA : attractorGestureB;
    const active = source != null && source.active !== false && source.tracked !== false;

    copyVector3(centerUniform.value, source?.position ?? source?.center ?? source);
    copyVector3(velocityUniform.value, source?.velocity, 5);
    controlUniform.value.set(
      clampNumber(source?.strength, -2, 2, active ? 1 : 0),
      clampNumber(source?.openness, 0, 1, 0.5),
      clampNumber(source?.pulse, 0, 1, 0),
      active ? 1 : 0,
    );
    writeGestureMode(gestureUniform.value, source);
  }

  function reset() {
    if (disposed) return false;
    renderer.compute(initialiseParticles);
    accumulator = 0;
    simulationTime = 0;
    totalSubmittedSteps = 0;
    resetCount += 1;
    initialized = true;
    return true;
  }

  function update({ delta = 0, time = undefined, aspect = 1, attractors = [] } = {}) {
    if (disposed) return 0;

    latestAspect = clampNumber(aspect, 0.35, 4, latestAspect);
    aspectUniform.value = latestAspect;
    writeAttractor(0, attractors?.[0]);
    writeAttractor(1, attractors?.[1]);

    const frameDelta = clampNumber(delta, 0, MAX_FRAME_DELTA_SECONDS, 0);
    accumulator = Math.min(accumulator + frameDelta, MAX_FRAME_DELTA_SECONDS);
    const hasExternalTime = Number.isFinite(Number(time));
    const frameTime = hasExternalTime ? Number(time) : simulationTime + frameDelta;
    let submitted = 0;

    while (
      accumulator + Number.EPSILON >= FIXED_STEP_SECONDS &&
      submitted < MAX_STEPS_PER_UPDATE
    ) {
      const remainingAfterStep = accumulator - FIXED_STEP_SECONDS;
      stepDeltaUniform.value = FIXED_STEP_SECONDS;
      simulationTimeUniform.value = hasExternalTime
        ? frameTime - Math.max(0, remainingAfterStep)
        : simulationTime + FIXED_STEP_SECONDS;
      renderer.compute(advanceParticles);
      accumulator = Math.max(0, remainingAfterStep);
      simulationTime += FIXED_STEP_SECONDS;
      totalSubmittedSteps += 1;
      submitted += 1;
    }

    return submitted;
  }

  function status() {
    return Object.freeze({
      state: disposed ? "disposed" : initialized ? "ready" : "initializing",
      backend: "tsl-gpu-compute",
      particleCount,
      fixedStepSeconds: FIXED_STEP_SECONDS,
      maxStepsPerUpdate: MAX_STEPS_PER_UPDATE,
      submittedSteps: totalSubmittedSteps,
      accumulatorSeconds: accumulator,
      simulationTimeSeconds: simulationTime,
      aspect: latestAspect,
      resets: resetCount,
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    mesh.removeFromParent();
    geometry.dispose();
    material.dispose();
    particlePositions.value.dispose();
    particleVelocities.value.dispose();
    particleVisualEnergy.value.dispose();
  }

  reset();

  return {
    object: mesh,
    mesh,
    particleCount,
    update,
    reset,
    dispose,
    status,
  };
}
