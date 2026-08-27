/**
 * Analytic first-order locomotion used by the walker.
 *
 * Integrating the exponential exactly keeps movement nearly identical at
 * 30, 60, 120 or irregular frame rates.  The returned distance is signed and
 * belongs to the same interval as the returned velocity.
 */
export function integrateDampedAxis(current, target, delta, response = 12) {
  const velocity = Number.isFinite(current) ? current : 0;
  const goal = Number.isFinite(target) ? target : 0;
  const seconds = Math.max(0, Number.isFinite(delta) ? delta : 0);
  const rate = Math.max(0.001, Number.isFinite(response) ? response : 12);
  const decay = Math.exp(-rate * seconds);
  return {
    velocity: goal + (velocity - goal) * decay,
    distance: goal * seconds + (velocity - goal) * (1 - decay) / rate,
  };
}

export function gaitFrameFromDistance(distance, frameCount, metresPerCycle = 1.42) {
  const count = Math.max(1, Math.trunc(Number(frameCount) || 1));
  const stride = Math.max(0.1, Number(metresPerCycle) || 1.42);
  const phase = ((Number(distance) || 0) / stride) % 1;
  return Math.floor((phase < 0 ? phase + 1 : phase) * count) % count;
}
