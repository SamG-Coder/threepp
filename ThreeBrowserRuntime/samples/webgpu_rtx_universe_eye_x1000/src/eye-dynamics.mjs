import { UNIVERSE_EYE_SEED } from "./universe-eye-model.mjs";

export const PUPIL_RADIUS_MIN_MM = 1.55;
export const PUPIL_RADIUS_MAX_MM = 3.75;
export const DEFAULT_PUPIL_RADIUS_MM = 2.18;
export const DEFAULT_BLINK_DURATION_SECONDS = 0.34;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
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

export function sampleBlink(elapsedSeconds, startedAt = -Infinity,
  durationSeconds = DEFAULT_BLINK_DURATION_SECONDS) {
  const duration = Math.max(0.12, finite(durationSeconds, DEFAULT_BLINK_DURATION_SECONDS));
  const unit = (finite(elapsedSeconds) - finite(startedAt, -Infinity)) / duration;
  if (!(unit >= 0 && unit <= 1)) return 0;
  if (unit < 0.36) return smoothstep(unit / 0.36);
  if (unit < 0.48) return 1;
  return 1 - smoothstep((unit - 0.48) / 0.52);
}

export function pupilRadiusForLuminance(luminance = 0.48) {
  const light = clamp(luminance, 0, 1);
  const response = 1 - smoothstep(light);
  return PUPIL_RADIUS_MIN_MM + response * (PUPIL_RADIUS_MAX_MM - PUPIL_RADIUS_MIN_MM);
}

function seededPhase(seed, salt) {
  let value = (Math.trunc(finite(seed, UNIVERSE_EYE_SEED)) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000 * Math.PI * 2;
}

export function sampleMicrosaccade(elapsedSeconds, seed = UNIVERSE_EYE_SEED) {
  const time = Math.max(0, finite(elapsedSeconds));
  const phaseX = seededPhase(seed, 0x51ccade);
  const phaseY = seededPhase(seed, 0x19b10c);
  const slowX = Math.sin(time * 1.73 + phaseX) * 0.010;
  const slowY = Math.sin(time * 1.31 + phaseY) * 0.008;
  const interval = Math.floor(time / 2.35);
  const local = time - interval * 2.35;
  const impulse = Math.exp(-Math.pow((local - 0.045) / 0.024, 2));
  const direction = seededPhase(seed ^ interval, 0xa11ce);
  return Object.freeze({
    x: slowX + Math.cos(direction) * impulse * 0.024,
    y: slowY + Math.sin(direction) * impulse * 0.018,
  });
}

export function createEyeDynamics({ seed = UNIVERSE_EYE_SEED } = {}) {
  const initial = Object.freeze({
    biologyTime: 0,
    paused: false,
    gazeX: 0,
    gazeY: 0,
    targetGazeX: 0,
    targetGazeY: 0,
    luminance: 0.48,
    pupilRadius: DEFAULT_PUPIL_RADIUS_MM,
    blinkStartedAt: -Infinity,
    blinkDuration: DEFAULT_BLINK_DURATION_SECONDS,
  });
  let state = { ...initial };

  function snapshot() {
    const microsaccade = sampleMicrosaccade(state.biologyTime, seed);
    return Object.freeze({
      biologyTime: state.biologyTime,
      paused: state.paused,
      gazeX: clamp(state.gazeX + microsaccade.x, -1, 1),
      gazeY: clamp(state.gazeY + microsaccade.y, -1, 1),
      targetGazeX: state.targetGazeX,
      targetGazeY: state.targetGazeY,
      luminance: state.luminance,
      pupilRadius: state.pupilRadius,
      blink: sampleBlink(state.biologyTime, state.blinkStartedAt, state.blinkDuration),
    });
  }

  return Object.freeze({
    update(deltaSeconds, { gazeX, gazeY, luminance } = {}) {
      const delta = clamp(deltaSeconds, 0, 0.1);
      if (Number.isFinite(gazeX) || Number.isFinite(gazeY)) {
        const gaze = clampGaze(
          Number.isFinite(gazeX) ? gazeX : state.targetGazeX,
          Number.isFinite(gazeY) ? gazeY : state.targetGazeY,
        );
        state.targetGazeX = gaze.x;
        state.targetGazeY = gaze.y;
      }
      if (Number.isFinite(luminance)) state.luminance = clamp(luminance, 0, 1);
      if (!state.paused) {
        state.biologyTime += delta;
        const gazeResponse = 1 - Math.exp(-delta * 10.5);
        state.gazeX += (state.targetGazeX - state.gazeX) * gazeResponse;
        state.gazeY += (state.targetGazeY - state.gazeY) * gazeResponse;
        const pupilTarget = pupilRadiusForLuminance(state.luminance);
        const rate = pupilTarget < state.pupilRadius ? 3.2 : 0.82;
        const pupilResponse = 1 - Math.exp(-delta * rate);
        state.pupilRadius += (pupilTarget - state.pupilRadius) * pupilResponse;
      }
      return snapshot();
    },
    setGaze(x = 0, y = 0) {
      const gaze = clampGaze(x, y);
      state.targetGazeX = gaze.x;
      state.targetGazeY = gaze.y;
      return gaze;
    },
    setLuminance(value = 0.48) {
      state.luminance = clamp(value, 0, 1);
      return state.luminance;
    },
    triggerBlink(durationSeconds = DEFAULT_BLINK_DURATION_SECONDS) {
      state.blinkDuration = clamp(durationSeconds, 0.18, 0.72);
      state.blinkStartedAt = state.biologyTime;
      return state.blinkStartedAt;
    },
    setPaused(value = true) {
      state.paused = Boolean(value);
      return state.paused;
    },
    reset() {
      state = { ...initial };
      return snapshot();
    },
    snapshot,
  });
}

