export const DAY_LENGTH_SECONDS = 360;
export const DAY_START_PROGRESS = 0.62;

/**
 * A full authored day. Duplicate end phases create real holds at midday and
 * night instead of making every moment a constant colour cross-fade.
 */
export const DAY_PHASES = Object.freeze([
  Object.freeze({ progress: 0.00, preset: "night" }),
  Object.freeze({ progress: 0.12, preset: "night" }),
  Object.freeze({ progress: 0.22, preset: "morning" }),
  Object.freeze({ progress: 0.38, preset: "midday" }),
  Object.freeze({ progress: 0.62, preset: "afternoon" }),
  Object.freeze({ progress: 0.76, preset: "sunset" }),
  Object.freeze({ progress: 0.86, preset: "night" }),
  Object.freeze({ progress: 1.00, preset: "night" }),
]);

export function wrapDayProgress(value) {
  const numeric = Number(value) || 0;
  return ((numeric % 1) + 1) % 1;
}

export function dayProgressAt(
  elapsedSeconds,
  durationSeconds = DAY_LENGTH_SECONDS,
  startProgress = DAY_START_PROGRESS,
) {
  const duration = Math.max(1, Number(durationSeconds) || DAY_LENGTH_SECONDS);
  return wrapDayProgress(startProgress + Math.max(0, Number(elapsedSeconds) || 0) / duration);
}

function smootherstep(value) {
  const t = Math.min(1, Math.max(0, Number(value) || 0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function dayBlendAt(progress) {
  const wrapped = wrapDayProgress(progress);
  for (let index = 0; index < DAY_PHASES.length - 1; index++) {
    const from = DAY_PHASES[index];
    const to = DAY_PHASES[index + 1];
    if (wrapped < from.progress || wrapped > to.progress) continue;
    const span = Math.max(1e-6, to.progress - from.progress);
    return {
      from: from.preset,
      to: to.preset,
      mix: smootherstep((wrapped - from.progress) / span),
      progress: wrapped,
    };
  }
  return { from: "night", to: "night", mix: 0, progress: wrapped };
}
