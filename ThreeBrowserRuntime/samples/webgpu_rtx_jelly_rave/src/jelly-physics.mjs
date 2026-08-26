import * as THREE from "three";

export const DEFAULT_FIXED_TIME_STEP = 1 / 120;

const EPSILON = 1e-8;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const finiteNumber = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp01 = value => Math.min(1, Math.max(0, value));

function readVector3(value, fallback = [0, 0, 0]) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value)) {
    return new THREE.Vector3(
      finiteNumber(value[0], fallback[0]),
      finiteNumber(value[1], fallback[1]),
      finiteNumber(value[2], fallback[2]),
    );
  }
  if (value && typeof value === "object") {
    return new THREE.Vector3(
      finiteNumber(value.x, fallback[0]),
      finiteNumber(value.y, fallback[1]),
      finiteNumber(value.z, fallback[2]),
    );
  }
  return new THREE.Vector3(...fallback);
}

function readQuaternion(value) {
  if (value?.isQuaternion) return value.clone().normalize();
  if (Array.isArray(value)) {
    return new THREE.Quaternion(
      finiteNumber(value[0], 0),
      finiteNumber(value[1], 0),
      finiteNumber(value[2], 0),
      finiteNumber(value[3], 1),
    ).normalize();
  }
  if (value && typeof value === "object") {
    return new THREE.Quaternion(
      finiteNumber(value.x, 0),
      finiteNumber(value.y, 0),
      finiteNumber(value.z, 0),
      finiteNumber(value.w, 1),
    ).normalize();
  }
  return new THREE.Quaternion();
}

// Small, dependency-free seeded generator. Every random property is decided at
// construction time so reset() reproduces the same simulation bit-for-bit.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function readArena(config) {
  const arena = config.arena ?? {};
  const halfWidth = Math.max(1, finiteNumber(arena.halfWidth ?? config.halfWidth, 12));
  const halfDepth = Math.max(1, finiteNumber(arena.halfDepth ?? config.halfDepth, 8));
  const floorY = finiteNumber(arena.floorY ?? config.floorY, 0);
  return {
    minX: finiteNumber(arena.minX, -halfWidth),
    maxX: finiteNumber(arena.maxX, halfWidth),
    minZ: finiteNumber(arena.minZ, -halfDepth),
    maxZ: finiteNumber(arena.maxZ, halfDepth),
    floorY,
    ceilingY: Number.isFinite(arena.ceilingY ?? config.ceilingY)
      ? Number(arena.ceilingY ?? config.ceilingY)
      : Infinity,
  };
}

function defaultBodyDefinition(index, count, random, floorY) {
  const columns = Math.ceil(Math.sqrt(count));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const radius = 0.72 + random() * 0.34;
  const x = (column - (columns - 1) * 0.5) * 2.75 + (random() - 0.5) * 0.35;
  const z = (row - (Math.ceil(count / columns) - 1) * 0.5) * 2.55 + (random() - 0.5) * 0.35;
  return {
    id: `jelly-${index + 1}`,
    radius,
    mass: Math.max(0.35, radius ** 3),
    position: [x, floorY + radius + 0.02 + row * 0.11, z],
    velocity: [(random() - 0.5) * 0.18, 0, (random() - 0.5) * 0.18],
  };
}

function createBody(definition, index, random, floorY) {
  const radius = Math.max(0.08, finiteNumber(definition.radius, 0.85));
  const mass = Math.max(0.02, finiteNumber(definition.mass, radius ** 3));
  const position = readVector3(definition.position, [0, floorY + radius, 0]);
  const quaternion = readQuaternion(definition.quaternion);
  const phase = finiteNumber(definition.phase, random() * Math.PI * 2);
  const body = {
    id: definition.id ?? `jelly-${index + 1}`,
    index,
    radius,
    mass,
    inverseMass: 1 / mass,
    position,
    previousPosition: position.clone(),
    velocity: readVector3(definition.velocity),
    angularVelocity: readVector3(definition.angularVelocity),
    quaternion,
    scale: new THREE.Vector3(radius, radius, radius),
    // Scene geometry may already be authored at body.radius (as the rave
    // membranes are). Such consumers can copy relativeScale straight to their
    // transform, while unit-sphere renderers can keep using absolute scale.
    relativeScale: new THREE.Vector3(1, 1, 1),
    deformation: new THREE.Vector3(),
    deformationVelocity: new THREE.Vector3(),
    grounded: false,
    contactNormal: new THREE.Vector3(),
    impactSpeed: 0,
    phase,
    beatAngle: finiteNumber(definition.beatAngle, random() * Math.PI * 2),
    wobbleModes: [
      { value: 0, velocity: 0, frequency: 5.0 + random() * 1.3, damping: 1.65 },
      { value: 0, velocity: 0, frequency: 7.1 + random() * 1.7, damping: 2.05 },
      { value: 0, velocity: 0, frequency: 9.2 + random() * 2.0, damping: 2.5 },
    ],
    impactEnvelope: 0,
    beatEnvelope: 0,
    uniforms: {
      wobbleA: 0,
      wobbleB: 0,
      wobbleTwist: 0,
      wobblePhase: phase,
      impact: 0,
      beat: 0,
      speed: 0,
      grounded: 0,
      deformation: new THREE.Vector3(),
    },
    userData: definition.userData ?? null,
  };

  body._initial = {
    position: body.position.clone(),
    velocity: body.velocity.clone(),
    angularVelocity: body.angularVelocity.clone(),
    quaternion: body.quaternion.clone(),
  };
  return body;
}

function enforceZeroSum(vector) {
  const mean = (vector.x + vector.y + vector.z) / 3;
  vector.x -= mean;
  vector.y -= mean;
  vector.z -= mean;
}

/**
 * Deterministic fixed-step soft-body proxy for the jelly rave sample.
 *
 * The solver deliberately keeps a compact public pose per blob. Rendering can
 * map body.position/quaternion/scale directly to a mesh and copy body.uniforms
 * into a jelly material without knowing anything about the physics internals.
 */
export function createJellyPhysics(config = {}) {
  const seed = Math.trunc(finiteNumber(config.seed, 0x4a454c4c)) >>> 0;
  const random = mulberry32(seed);
  const arena = readArena(config);
  if (!(arena.maxX > arena.minX) || !(arena.maxZ > arena.minZ)) {
    throw new RangeError("Jelly arena bounds must have a positive width and depth.");
  }

  const count = Math.max(1, Math.trunc(finiteNumber(config.count, 7)));
  const definitions = Array.isArray(config.bodies) && config.bodies.length > 0
    ? config.bodies
    : Array.from({ length: count }, (_, index) => (
      defaultBodyDefinition(index, count, random, arena.floorY)
    ));
  const bodies = definitions.map((definition, index) => (
    createBody(definition, index, random, arena.floorY)
  ));

  const gravity = readVector3(config.gravity, [0, -22, 0]);
  const fixedTimeStep = Math.min(1 / 30, Math.max(1 / 300, finiteNumber(config.fixedTimeStep, DEFAULT_FIXED_TIME_STEP)));
  const maximumSubSteps = Math.max(1, Math.trunc(finiteNumber(config.maximumSubSteps, 24)));
  const maximumFrameDelta = Math.max(fixedTimeStep, finiteNumber(config.maximumFrameDelta, 0.2));
  const restitution = clamp01(finiteNumber(config.restitution, 0.62));
  const wallRestitution = clamp01(finiteNumber(config.wallRestitution, 0.72));
  const bodyRestitution = clamp01(finiteNumber(config.bodyRestitution, 0.72));
  const surfaceFriction = clamp01(finiteNumber(config.surfaceFriction, 0.16));
  const airDrag = Math.max(0, finiteNumber(config.airDrag, 0.12));
  const angularDrag = Math.max(0, finiteNumber(config.angularDrag, 1.8));
  const shapeSpring = Math.max(1, finiteNumber(config.shapeSpring, 92));
  const shapeDamping = Math.max(0, finiteNumber(config.shapeDamping, 13.5));
  const deformationLimit = Math.max(0.05, finiteNumber(config.deformationLimit, 0.42));
  const impactToShape = Math.max(0, finiteNumber(config.impactToShape, 0.035));
  const beatStrength = Math.max(0, finiteNumber(config.beatStrength, 3.8));
  const beatThreshold = clamp01(finiteNumber(config.beatThreshold, 0.68));
  const collisionIterations = Math.max(1, Math.trunc(finiteNumber(config.collisionIterations, 3)));

  const temporary = {
    delta: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    tangent: new THREE.Vector3(),
    impulse: new THREE.Vector3(),
    axis: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    force: new THREE.Vector3(),
  };

  let accumulator = 0;
  let elapsedTime = 0;
  let lastBeatValue = 0;
  let currentBass = 0;
  let currentEnergy = 0;
  let interpolationAlpha = 0;

  function exciteShape(body, normal, impulseMagnitude) {
    const amount = Math.min(0.58, Math.max(0, impulseMagnitude) * impactToShape);
    // A hit compresses along the contact normal and expands on both tangent
    // axes. This is a log-scale impulse, therefore its sum is exactly zero.
    body.deformationVelocity.x += amount * (1 / 3 - normal.x * normal.x);
    body.deformationVelocity.y += amount * (1 / 3 - normal.y * normal.y);
    body.deformationVelocity.z += amount * (1 / 3 - normal.z * normal.z);
    enforceZeroSum(body.deformationVelocity);
    body.wobbleModes[0].velocity += amount * 1.35;
    body.wobbleModes[1].velocity -= amount * 0.82;
    body.wobbleModes[2].velocity += amount * 0.57 * Math.sin(body.phase + elapsedTime * 2.1);
    body.impactEnvelope = Math.max(body.impactEnvelope, Math.min(1, impulseMagnitude * 0.085));
    body.impactSpeed = Math.max(body.impactSpeed, impulseMagnitude);
  }

  function resolvePlane(body, normal, penetration, bounce) {
    if (penetration <= 0) return;
    body.position.addScaledVector(normal, penetration + 1e-5);
    const normalSpeed = body.velocity.dot(normal);
    if (normalSpeed < 0) {
      const deltaSpeed = -(1 + bounce) * normalSpeed;
      body.velocity.addScaledVector(normal, deltaSpeed);
      temporary.tangent.copy(body.velocity).addScaledVector(normal, -body.velocity.dot(normal));
      body.velocity.addScaledVector(temporary.tangent, -surfaceFriction);
      exciteShape(body, normal, deltaSpeed);
    }
    body.contactNormal.add(normal);
  }

  function resolveArena(body) {
    const radius = body.radius;
    const floorPenetration = arena.floorY + radius - body.position.y;
    if (floorPenetration > 0) {
      resolvePlane(body, Y_AXIS, floorPenetration, restitution);
      body.grounded = true;
    } else if (body.position.y - radius <= arena.floorY + 0.025 && body.velocity.y <= 0.35) {
      body.grounded = true;
      body.contactNormal.y += 1;
    }

    temporary.normal.set(1, 0, 0);
    resolvePlane(body, temporary.normal, arena.minX + radius - body.position.x, wallRestitution);
    temporary.normal.set(-1, 0, 0);
    resolvePlane(body, temporary.normal, body.position.x + radius - arena.maxX, wallRestitution);
    temporary.normal.set(0, 0, 1);
    resolvePlane(body, temporary.normal, arena.minZ + radius - body.position.z, wallRestitution);
    temporary.normal.set(0, 0, -1);
    resolvePlane(body, temporary.normal, body.position.z + radius - arena.maxZ, wallRestitution);
    if (Number.isFinite(arena.ceilingY)) {
      temporary.normal.set(0, -1, 0);
      resolvePlane(body, temporary.normal, body.position.y + radius - arena.ceilingY, wallRestitution);
    }
  }

  function resolveBodyPair(first, second) {
    temporary.delta.subVectors(second.position, first.position);
    const minimumDistance = first.radius + second.radius;
    const distanceSquared = temporary.delta.lengthSq();
    if (distanceSquared >= minimumDistance * minimumDistance) return;

    let distance = Math.sqrt(distanceSquared);
    if (distance > EPSILON) {
      temporary.normal.copy(temporary.delta).multiplyScalar(1 / distance);
    } else {
      // A stable fallback prevents coincident blobs from acquiring NaNs and is
      // intentionally derived from indices rather than random state.
      const angle = (first.index * 2.399963 + second.index * 0.754877) % (Math.PI * 2);
      temporary.normal.set(Math.cos(angle), 0, Math.sin(angle));
      distance = 0;
    }

    const inverseMassSum = first.inverseMass + second.inverseMass;
    const penetration = minimumDistance - distance;
    first.position.addScaledVector(temporary.normal, -penetration * first.inverseMass / inverseMassSum);
    second.position.addScaledVector(temporary.normal, penetration * second.inverseMass / inverseMassSum);

    temporary.delta.subVectors(second.velocity, first.velocity);
    const closingSpeed = temporary.delta.dot(temporary.normal);
    if (closingSpeed >= 0) return;
    const impulseMagnitude = -(1 + bodyRestitution) * closingSpeed / inverseMassSum;
    temporary.impulse.copy(temporary.normal).multiplyScalar(impulseMagnitude);
    first.velocity.addScaledVector(temporary.impulse, -first.inverseMass);
    second.velocity.addScaledVector(temporary.impulse, second.inverseMass);
    exciteShape(first, temporary.normal, impulseMagnitude * first.inverseMass);
    exciteShape(second, temporary.normal, impulseMagnitude * second.inverseMass);
  }

  function integrateRotation(body, dt) {
    if (body.grounded) {
      body.angularVelocity.x += body.velocity.z / body.radius * dt * 7.5;
      body.angularVelocity.z -= body.velocity.x / body.radius * dt * 7.5;
    }
    body.angularVelocity.multiplyScalar(Math.exp(-angularDrag * dt));
    const angularSpeed = body.angularVelocity.length();
    if (angularSpeed > EPSILON) {
      temporary.axis.copy(body.angularVelocity).multiplyScalar(1 / angularSpeed);
      temporary.quaternion.setFromAxisAngle(temporary.axis, angularSpeed * dt);
      body.quaternion.premultiply(temporary.quaternion).normalize();
    }
  }

  function integrateSoftShape(body, dt) {
    // Flight elongation gives jumps a lively silhouette. It remains a target
    // rather than a direct scale so the jelly overshoots and rings naturally.
    const verticalStretch = body.grounded
      ? 0
      : Math.min(0.12, Math.abs(body.velocity.y) * 0.009);
    const targetX = -verticalStretch * 0.5;
    const targetY = verticalStretch;
    const targetZ = -verticalStretch * 0.5;
    body.deformationVelocity.x += ((targetX - body.deformation.x) * shapeSpring - body.deformationVelocity.x * shapeDamping) * dt;
    body.deformationVelocity.y += ((targetY - body.deformation.y) * shapeSpring - body.deformationVelocity.y * shapeDamping) * dt;
    body.deformationVelocity.z += ((targetZ - body.deformation.z) * shapeSpring - body.deformationVelocity.z * shapeDamping) * dt;
    body.deformation.addScaledVector(body.deformationVelocity, dt);
    enforceZeroSum(body.deformation);
    body.deformation.clampScalar(-deformationLimit, deformationLimit);
    enforceZeroSum(body.deformation);

    for (const mode of body.wobbleModes) {
      const acceleration = -mode.frequency * mode.frequency * mode.value - mode.damping * mode.velocity;
      mode.velocity += acceleration * dt;
      mode.value += mode.velocity * dt;
    }
    body.impactEnvelope *= Math.exp(-5.4 * dt);
    body.beatEnvelope *= Math.exp(-3.6 * dt);
  }

  function updateVisualPose(body) {
    const modeA = body.wobbleModes[0].value;
    const modeB = body.wobbleModes[1].value;
    const modeTwist = body.wobbleModes[2].value;
    let logX = body.deformation.x + modeA * 0.34 - modeB * 0.12;
    let logY = body.deformation.y - modeA * 0.17 - modeB * 0.17;
    let logZ = body.deformation.z - modeA * 0.17 + modeB * 0.29;
    const mean = (logX + logY + logZ) / 3;
    logX = Math.max(-deformationLimit, Math.min(deformationLimit, logX - mean));
    logY = Math.max(-deformationLimit, Math.min(deformationLimit, logY - mean));
    logZ = Math.max(-deformationLimit, Math.min(deformationLimit, logZ - mean));

    body.scale.set(Math.exp(logX), Math.exp(logY), Math.exp(logZ));
    // Clamping the log components can disturb their zero sum. Renormalising by
    // the geometric mean guarantees scale.x*scale.y*scale.z == radius^3.
    const volumeCorrection = Math.cbrt(1 / (body.scale.x * body.scale.y * body.scale.z));
    body.scale.multiplyScalar(body.radius * volumeCorrection);
    body.relativeScale.copy(body.scale).multiplyScalar(1 / body.radius);

    body.uniforms.wobbleA = modeA;
    body.uniforms.wobbleB = modeB;
    body.uniforms.wobbleTwist = modeTwist;
    body.uniforms.wobblePhase = body.phase + elapsedTime * (1.5 + currentEnergy * 1.7);
    body.uniforms.impact = body.impactEnvelope;
    body.uniforms.beat = body.beatEnvelope;
    body.uniforms.speed = body.velocity.length();
    body.uniforms.grounded = body.grounded ? 1 : 0;
    body.uniforms.deformation.copy(body.deformation);
  }

  function physicsStep(dt, frameForce) {
    for (const body of bodies) {
      body.previousPosition.copy(body.position);
      body.grounded = false;
      body.contactNormal.set(0, 0, 0);
      body.impactSpeed = 0;
      body.velocity.addScaledVector(gravity, dt);
      body.velocity.addScaledVector(frameForce, dt * body.inverseMass);
      body.velocity.multiplyScalar(Math.exp(-airDrag * dt));
      body.position.addScaledVector(body.velocity, dt);
    }

    for (let iteration = 0; iteration < collisionIterations; iteration += 1) {
      for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
          resolveBodyPair(bodies[firstIndex], bodies[secondIndex]);
        }
      }
      for (const body of bodies) resolveArena(body);
    }

    for (const body of bodies) {
      if (body.contactNormal.lengthSq() > EPSILON) body.contactNormal.normalize();
      integrateRotation(body, dt);
      integrateSoftShape(body, dt);
    }
    elapsedTime += dt;
  }

  function impulseAt(origin, strength = 5, radius = 5, options = {}) {
    const centre = readVector3(origin);
    const waveRadius = Math.max(EPSILON, finiteNumber(radius, 5));
    const waveStrength = finiteNumber(strength, 5);
    const verticalLift = finiteNumber(options.verticalLift, 0.32);
    const exponent = Math.max(0.1, finiteNumber(options.falloffExponent, 1.5));
    let affected = 0;

    for (const body of bodies) {
      temporary.delta.subVectors(body.position, centre);
      const distance = temporary.delta.length();
      if (distance > waveRadius) continue;
      if (distance > EPSILON) {
        temporary.normal.copy(temporary.delta).multiplyScalar(1 / distance);
      } else {
        const angle = body.beatAngle + elapsedTime * 0.31;
        temporary.normal.set(Math.cos(angle), 0.15, Math.sin(angle)).normalize();
      }
      temporary.normal.y += verticalLift;
      temporary.normal.normalize();
      const falloff = Math.pow(clamp01(1 - distance / waveRadius), exponent);
      const deltaSpeed = waveStrength * falloff / Math.sqrt(body.mass);
      body.velocity.addScaledVector(temporary.normal, deltaSpeed);
      exciteShape(body, temporary.normal, Math.abs(deltaSpeed));
      affected += 1;
    }
    return affected;
  }

  function triggerBeat(amount) {
    const beat = Math.max(0, finiteNumber(amount, 1));
    if (beat <= 0) return;
    for (const body of bodies) {
      const angle = body.beatAngle + elapsedTime * 0.17;
      const massScale = 1 / Math.sqrt(body.mass);
      body.velocity.x += Math.cos(angle) * beatStrength * beat * 0.18 * massScale;
      body.velocity.y += beatStrength * beat * (0.78 + 0.16 * Math.sin(body.phase)) * massScale;
      body.velocity.z += Math.sin(angle) * beatStrength * beat * 0.18 * massScale;
      temporary.normal.set(Math.cos(angle) * 0.2, 0.96, Math.sin(angle) * 0.2).normalize();
      exciteShape(body, temporary.normal, beatStrength * beat * 0.75);
      body.wobbleModes[2].velocity += Math.sin(body.phase + elapsedTime) * beat * 0.42;
      body.beatEnvelope = Math.max(body.beatEnvelope, Math.min(1, beat));
    }
  }

  function consumeSignals(signals) {
    const beatValue = signals.beat === true
      ? 1
      : clamp01(finiteNumber(signals.beat, 0));
    const directBeat = Math.max(0, finiteNumber(signals.beatImpulse, 0));
    if (directBeat > 0) triggerBeat(directBeat);
    if (beatValue > beatThreshold && lastBeatValue <= beatThreshold) triggerBeat(beatValue);
    lastBeatValue = beatValue;
    currentBass = clamp01(finiteNumber(signals.bass, 0));
    currentEnergy = clamp01(finiteNumber(signals.energy, currentBass));

    const shockwaves = Array.isArray(signals.pointerShockwave)
      ? signals.pointerShockwave
      : signals.pointerShockwave
        ? [signals.pointerShockwave]
        : [];
    for (const shockwave of shockwaves) {
      if (!shockwave) continue;
      impulseAt(
        shockwave.position ?? shockwave.origin ?? shockwave.point,
        shockwave.strength,
        shockwave.radius,
        shockwave,
      );
    }
  }

  function update(deltaTime, signals = {}) {
    if (!Number.isFinite(deltaTime) || deltaTime < 0) {
      throw new RangeError("Jelly physics deltaTime must be a finite, non-negative number.");
    }
    consumeSignals(signals);
    temporary.force.copy(readVector3(signals.force));
    const acceptedDelta = Math.min(deltaTime, maximumFrameDelta);
    accumulator = Math.min(accumulator + acceptedDelta, fixedTimeStep * maximumSubSteps);
    let steps = 0;
    while (accumulator + EPSILON >= fixedTimeStep && steps < maximumSubSteps) {
      physicsStep(fixedTimeStep, temporary.force);
      accumulator -= fixedTimeStep;
      steps += 1;
    }
    if (Math.abs(accumulator) < EPSILON) accumulator = 0;
    interpolationAlpha = accumulator / fixedTimeStep;
    for (const body of bodies) updateVisualPose(body);
    return bodies;
  }

  function reset() {
    accumulator = 0;
    elapsedTime = 0;
    lastBeatValue = 0;
    currentBass = 0;
    currentEnergy = 0;
    interpolationAlpha = 0;
    for (const body of bodies) {
      body.position.copy(body._initial.position);
      body.previousPosition.copy(body._initial.position);
      body.velocity.copy(body._initial.velocity);
      body.angularVelocity.copy(body._initial.angularVelocity);
      body.quaternion.copy(body._initial.quaternion);
      body.deformation.set(0, 0, 0);
      body.deformationVelocity.set(0, 0, 0);
      body.grounded = false;
      body.contactNormal.set(0, 0, 0);
      body.impactSpeed = 0;
      body.impactEnvelope = 0;
      body.beatEnvelope = 0;
      for (const mode of body.wobbleModes) {
        mode.value = 0;
        mode.velocity = 0;
      }
      updateVisualPose(body);
    }
    return bodies;
  }

  reset();
  return {
    bodies,
    arena: Object.freeze({ ...arena }),
    gravity: gravity.clone(),
    fixedTimeStep,
    update,
    impulseAt,
    reset,
    get time() {
      return elapsedTime;
    },
    get interpolationAlpha() {
      return interpolationAlpha;
    },
  };
}
