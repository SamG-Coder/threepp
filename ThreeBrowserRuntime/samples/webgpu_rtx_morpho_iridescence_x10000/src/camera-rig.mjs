import * as THREE from "three/webgpu";

export const MIN_MAGNIFICATION = 1;
export const MAX_MAGNIFICATION = 10_000;
export const DEFAULT_MAGNIFICATION = 1;
export const DEFAULT_YAW = 0.22;
export const DEFAULT_PITCH = -0.98;

const BASE_FOV_DEGREES = 28;
const MIN_FOV_DEGREES = 0.0035;
const RESPONSE_RATE = 7.2;

// Mag 1 is the hero: almost top-down on the open dorsal wing, insect filling
// the frame the way Universe Eye starts on the whole eye. Higher mag shrinks
// FOV into scales, then the 12-layer lattice. Distances stay inside the house.
const LOOK_STAGES = Object.freeze([
  Object.freeze({ magnification: 1, target: Object.freeze([0.46, 1.14, 0.02]), distance: 1.92 }),
  Object.freeze({ magnification: 8, target: Object.freeze([0.58, 1.15, 0.04]), distance: 1.55 }),
  Object.freeze({ magnification: 80, target: Object.freeze([0.70, 1.16, 0.06]), distance: 1.12 }),
  Object.freeze({ magnification: 800, target: Object.freeze([0.78, 1.165, 0.08]), distance: 0.62 }),
  Object.freeze({ magnification: 10_000, target: Object.freeze([0.80, 1.17, 0.09]), distance: 0.18 }),
]);

const BASE_DISTANCE = LOOK_STAGES[0].distance;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value) {
  return clamp(finite(value), 0, 1);
}

function smoothUnit(value) {
  const unit = clamp01(value);
  return unit * unit * (3 - 2 * unit);
}

function clampMagnification(value) {
  return clamp(finite(value, MIN_MAGNIFICATION), MIN_MAGNIFICATION, MAX_MAGNIFICATION);
}

function logBlend(magnification, fromMag, toMag) {
  const span = Math.log(toMag) - Math.log(fromMag);
  if (!(span > 0)) return 0;
  return smoothUnit((Math.log(magnification) - Math.log(fromMag)) / span);
}

function sampleStage(magnification) {
  const mag = clampMagnification(magnification);
  let index = 0;
  while (index + 1 < LOOK_STAGES.length && mag >= LOOK_STAGES[index + 1].magnification) {
    index += 1;
  }
  const from = LOOK_STAGES[index];
  const to = LOOK_STAGES[Math.min(LOOK_STAGES.length - 1, index + 1)];
  if (from === to || mag <= from.magnification) {
    return { target: from.target, distance: from.distance };
  }
  const blend = logBlend(mag, from.magnification, to.magnification);
  return {
    target: [
      from.target[0] + (to.target[0] - from.target[0]) * blend,
      from.target[1] + (to.target[1] - from.target[1]) * blend,
      from.target[2] + (to.target[2] - from.target[2]) * blend,
    ],
    distance: from.distance + (to.distance - from.distance) * blend,
  };
}

function fovFor(magnification, distance) {
  const baseHeight = 2 * BASE_DISTANCE * Math.tan(THREE.MathUtils.degToRad(BASE_FOV_DEGREES * 0.5));
  const desiredHeight = baseHeight / Math.max(MIN_MAGNIFICATION, magnification);
  const fov = THREE.MathUtils.radToDeg(2 * Math.atan(desiredHeight / (2 * Math.max(1e-5, distance))));
  return clamp(fov, MIN_FOV_DEGREES, BASE_FOV_DEGREES);
}

export function createCameraRig(camera) {
  if (!camera?.isPerspectiveCamera) {
    throw new TypeError("createCameraRig requires a THREE.PerspectiveCamera.");
  }

  const spherical = new THREE.Spherical();
  const desiredTarget = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const currentTarget = new THREE.Vector3();

  let yaw = 0;
  let pitch = 0;
  let magnification = MIN_MAGNIFICATION;

  function poseFrom(nextYaw, nextPitch, nextMagnification) {
    const stage = sampleStage(nextMagnification);
    desiredTarget.set(stage.target[0], stage.target[1], stage.target[2]);
    spherical.set(stage.distance, Math.PI * 0.5 + nextPitch, nextYaw);
    desiredPosition.setFromSpherical(spherical).add(desiredTarget);
    return { stage, fov: fovFor(nextMagnification, stage.distance) };
  }

  function snap(nextYaw = 0, nextPitch = 0, nextMagnification = MIN_MAGNIFICATION) {
    yaw = finite(nextYaw);
    pitch = finite(nextPitch);
    magnification = clampMagnification(nextMagnification);
    poseFrom(yaw, pitch, magnification);
    currentTarget.copy(desiredTarget);
    camera.position.copy(desiredPosition);
    camera.fov = fovFor(magnification, spherical.radius);
    camera.updateProjectionMatrix();
    camera.lookAt(currentTarget);
  }

  function update(dt, { yaw: nextYaw, pitch: nextPitch, magnification: nextMagnification } = {}) {
    const response = 1 - Math.exp(-Math.min(0.08, Math.max(0, finite(dt))) * RESPONSE_RATE);
    yaw = THREE.MathUtils.lerp(yaw, finite(nextYaw, yaw), response);
    pitch = THREE.MathUtils.lerp(pitch, finite(nextPitch, pitch), response);
    const currentLog = Math.log(Math.max(MIN_MAGNIFICATION, magnification));
    const targetLog = Math.log(Math.max(MIN_MAGNIFICATION, clampMagnification(nextMagnification ?? magnification)));
    magnification = Math.exp(THREE.MathUtils.lerp(currentLog, targetLog, response));

    poseFrom(yaw, pitch, magnification);
    camera.position.lerp(desiredPosition, response);
    camera.fov = THREE.MathUtils.lerp(camera.fov, fovFor(magnification, spherical.radius), response);
    camera.updateProjectionMatrix();
    currentTarget.copy(desiredTarget);
    camera.lookAt(currentTarget);
  }

  function reset() {
    snap(DEFAULT_YAW, DEFAULT_PITCH, DEFAULT_MAGNIFICATION);
  }

  reset();

  return Object.freeze({
    update,
    reset,
    snap,
    lookTarget: () => currentTarget.clone(),
    MIN_MAGNIFICATION,
    MAX_MAGNIFICATION,
    DEFAULT_MAGNIFICATION,
    DEFAULT_YAW,
    DEFAULT_PITCH,
  });
}
