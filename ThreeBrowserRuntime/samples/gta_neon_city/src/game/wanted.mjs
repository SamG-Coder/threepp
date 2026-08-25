export const WANTED_THRESHOLDS = Object.freeze([0, 12, 28, 48, 70, 90]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function starsForHeat(heat) {
  const value = clamp(heat, 0, 100);
  let stars = 0;
  for (let index = 1; index < WANTED_THRESHOLDS.length; ++index) {
    if (value >= WANTED_THRESHOLDS[index]) stars = index;
  }
  return stars;
}

export function createWantedSystem(options = {}) {
  const config = {
    graceSeconds: 6,
    searchSeconds: 8,
    coolRate: 3.2,
    hiddenCoolRate: 7.5,
    ...options,
  };
  let heat = 0;
  let grace = 0;
  let search = 0;
  let lastCrime = null;
  let lastCrimeAt = -Infinity;
  let elapsed = 0;
  let totalCrimes = 0;

  function add(amount, reason = "crime") {
    const increase = Math.max(0, Number(amount) || 0);
    if (increase <= 0) return snapshot();
    heat = clamp(heat + increase, 0, 100);
    grace = config.graceSeconds;
    search = config.searchSeconds;
    lastCrime = String(reason);
    lastCrimeAt = elapsed;
    totalCrimes += 1;
    return snapshot();
  }

  function update(delta, context = {}) {
    const dt = clamp(delta, 0, 0.25);
    elapsed += dt;
    grace = Math.max(0, grace - dt);
    const observed = Boolean(context.observed || context.policeNearby || context.policeInSight);
    if (observed && heat > 0) search = config.searchSeconds;
    else search = Math.max(0, search - dt);
    if (heat > 0 && grace <= 0 && !observed) {
      const rate = search > 0 ? config.coolRate : config.hiddenCoolRate;
      heat = Math.max(0, heat - rate * dt);
      if (heat < WANTED_THRESHOLDS[1] * 0.4 && search <= 0) heat = 0;
    }
    return snapshot();
  }

  function clear() {
    heat = 0;
    grace = 0;
    search = 0;
    return snapshot();
  }

  function restore(value = {}) {
    heat = clamp(value.heat, 0, 100);
    grace = clamp(value.grace, 0, config.graceSeconds);
    search = clamp(value.search, 0, config.searchSeconds);
    lastCrime = value.lastCrime ? String(value.lastCrime) : null;
    lastCrimeAt = Number(value.lastCrimeAt ?? -Infinity);
    elapsed = Math.max(0, Number(value.elapsed) || 0);
    totalCrimes = Math.max(0, Math.trunc(Number(value.totalCrimes) || 0));
    return snapshot();
  }

  function snapshot() {
    const stars = starsForHeat(heat);
    return Object.freeze({
      heat,
      stars,
      grace,
      search,
      searching: heat > 0 && search > 0,
      lastCrime,
      lastCrimeAt,
      elapsed,
      totalCrimes,
      response: stars === 0 ? "none" : stars === 1 ? "patrol" : stars <= 3 ? "pursuit" : "tactical",
    });
  }

  return { add, update, clear, restore, snapshot };
}
