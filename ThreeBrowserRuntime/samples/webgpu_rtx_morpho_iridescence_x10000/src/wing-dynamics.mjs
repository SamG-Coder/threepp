import { MORPHO_SEED } from "./morpho-model.mjs";

export const IDLE_WING_HZ = 2.4;
export const IDLE_AMPLITUDE_RAD = 0.16;
export const WING_PHASE_OFFSET_RAD = 0.08;
export const FLAP_DURATION_SECONDS = 0.45;
export const FLAP_DOWNSTROKE_RAD = 0.72;
export const ANGLE_LIMIT_RAD = 1.2;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function clampAngle(value) {
  return clamp(value, -ANGLE_LIMIT_RAD, ANGLE_LIMIT_RAD);
}

function smoothstep(value) {
  const unit = clamp(value, 0, 1);
  return unit * unit * (3 - 2 * unit);
}

export function clampGaze(x = 0, y = 0) {
  const length = Math.hypot(finite(x), finite(y));
  if (length <= 1) return Object.freeze({ x: finite(x), y: finite(y) });
  return Object.freeze({ x: finite(x) / length, y: finite(y) / length });
}

function seededPhase(seed, salt) {
  let value = (Math.trunc(finite(seed, MORPHO_SEED)) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000 * Math.PI * 2;
}

function flapProgress(elapsedSeconds, startedAt, durationSeconds = FLAP_DURATION_SECONDS) {
  const duration = Math.max(0.12, finite(durationSeconds, FLAP_DURATION_SECONDS));
  const local = finite(elapsedSeconds) - finite(startedAt, -Infinity);
  if (!(local >= 0 && local < duration)) return -1;
  return local / duration;
}

function sampleDownstroke(elapsedSeconds, startedAt, durationSeconds = FLAP_DURATION_SECONDS) {
  const unit = flapProgress(elapsedSeconds, startedAt, durationSeconds);
  if (unit < 0) return 0;
  // Fast down, brief hold, slower recover — one 0.45s display beat.
  if (unit < 0.38) return smoothstep(unit / 0.38);
  if (unit < 0.46) return 1;
  return 1 - smoothstep((unit - 0.46) / 0.54);
}

export function createWingDynamics({ seed = MORPHO_SEED } = {}) {
  const resolvedSeed = Math.trunc(finite(seed, MORPHO_SEED));
  const leftPhase = seededPhase(resolvedSeed, 0x1e7f1a9);
  const rightPhase = leftPhase + WING_PHASE_OFFSET_RAD;
  const twistPhase = seededPhase(resolvedSeed, 0x75157);
  const breathPhase = seededPhase(resolvedSeed, 0xb12ea7);
  const abdomenPhase = seededPhase(resolvedSeed, 0xa6d0);
  const antennaPhase0 = seededPhase(resolvedSeed, 0xa07e0a);

  const initial = Object.freeze({
    elapsed: 0,
    paused: false,
    gazeX: 0,
    gazeY: 0,
    flapStartedAt: -Infinity,
    flapStrength: 1,
  });
  let state = { ...initial };

  function pose() {
    const time = Math.max(0, finite(state.elapsed));
    const omega = Math.PI * 2 * IDLE_WING_HZ;
    const stroke = omega * time;
    const down = sampleDownstroke(time, state.flapStartedAt) * clamp(state.flapStrength, 0, 3);
    const flapping = flapProgress(time, state.flapStartedAt) >= 0;

    const leftAngle = clampAngle(
      Math.sin(stroke + leftPhase) * IDLE_AMPLITUDE_RAD - down * FLAP_DOWNSTROKE_RAD,
    );
    const rightAngle = clampAngle(
      Math.sin(stroke + rightPhase) * IDLE_AMPLITUDE_RAD - down * FLAP_DOWNSTROKE_RAD,
    );
    const leftTwist = clampAngle(
      Math.sin(stroke + twistPhase) * 0.09 + down * 0.22,
    );
    const rightTwist = clampAngle(
      Math.sin(stroke + twistPhase + WING_PHASE_OFFSET_RAD) * 0.09 + down * 0.22,
    );
    const thoraxBreath = clampAngle(
      Math.sin(time * Math.PI * 2 * 0.37 + breathPhase) * 0.035
        + Math.abs(Math.sin(stroke + leftPhase)) * 0.012
        + down * 0.05,
    );
    const abdomenCurl = clampAngle(
      Math.sin(stroke * 0.5 + abdomenPhase) * 0.06 + down * 0.16,
    );

    return Object.freeze({
      elapsed: time,
      paused: state.paused,
      flapping,
      leftAngle,
      rightAngle,
      leftTwist,
      rightTwist,
      thoraxBreath,
      abdomenCurl,
      antennaPhase: antennaPhase0 + time * Math.PI * 2 * 0.85,
      gazeX: state.gazeX,
      gazeY: state.gazeY,
    });
  }

  return Object.freeze({
    update(deltaSeconds, { paused } = {}) {
      if (paused !== undefined) state.paused = Boolean(paused);
      const delta = clamp(deltaSeconds, 0, 0.1);
      if (!state.paused) state.elapsed += delta;
      return pose();
    },
    setGaze(x = 0, y = 0) {
      const gaze = clampGaze(x, y);
      state.gazeX = gaze.x;
      state.gazeY = gaze.y;
      return gaze;
    },
    triggerFlap(strength = 1) {
      state.flapStrength = clamp(finite(strength, 1), 0, 3);
      state.flapStartedAt = state.elapsed;
      return state.flapStartedAt;
    },
    setPaused(value = true) {
      state.paused = Boolean(value);
      return state.paused;
    },
    reset() {
      state = { ...initial };
      return pose();
    },
    pose,
  });
}
