function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function calculateArrestFine(cash, wantedStars) {
  const available = Math.max(0, Number(cash) || 0);
  const stars = Math.max(0, Math.min(5, Math.trunc(Number(wantedStars) || 0)));
  const raw = 100 + stars * 125 + available * 0.08;
  return Math.min(available, Math.round(clamp(raw, 100, 1_500) / 25) * 25);
}

export function createArrestSystem(options = {}) {
  const config = Object.freeze({
    holdSeconds: 1.35,
    releaseRate: 2.25,
    maxHealth: 42,
    maxSpeed: 0.85,
    maxOfficerDistance: 2.45,
    custodySeconds: 3.25,
    ...options,
  });
  let elapsed = 0;
  let progress = 0;
  let active = false;
  let activeFor = 0;
  let count = 0;
  let fine = 0;
  let officerId = null;
  let justBusted = false;

  function qualify(context = {}) {
    return Number(context.wantedStars) > 0 && context.playerAlive !== false && !context.inVehicle &&
      Number(context.health) <= config.maxHealth && Number(context.speed) <= config.maxSpeed &&
      context.grounded !== false && context.officerVisible !== false &&
      Number(context.officerDistance) <= config.maxOfficerDistance;
  }

  function begin(context = {}) {
    if (active) return snapshot();
    active = true;
    activeFor = 0;
    progress = config.holdSeconds;
    count += 1;
    fine = calculateArrestFine(context.cash, context.wantedStars);
    officerId = context.officerId ? String(context.officerId) : null;
    justBusted = true;
    return snapshot();
  }

  function update(delta, context = {}) {
    const dt = clamp(delta, 0, 0.25);
    elapsed += dt;
    justBusted = false;
    if (active) {
      activeFor += dt;
      return snapshot();
    }
    if (qualify(context)) {
      progress = Math.min(config.holdSeconds, progress + dt);
      officerId = context.officerId ? String(context.officerId) : officerId;
    } else {
      progress = Math.max(0, progress - dt * config.releaseRate);
      if (progress <= 0) officerId = null;
    }
    if (progress >= config.holdSeconds) return begin(context);
    return snapshot();
  }

  function force(context = {}) {
    justBusted = false;
    return begin({
      wantedStars: Math.max(1, Number(context.wantedStars) || 1),
      cash: context.cash,
      officerId: context.officerId ?? "control",
    });
  }

  function release() {
    active = false;
    activeFor = 0;
    progress = 0;
    fine = 0;
    officerId = null;
    justBusted = false;
    return snapshot();
  }

  function reset() {
    elapsed = 0;
    count = 0;
    return release();
  }

  function snapshot() {
    return Object.freeze({
      active,
      progress,
      required: config.holdSeconds,
      ratio: clamp(progress / config.holdSeconds, 0, 1),
      activeFor,
      custodySeconds: config.custodySeconds,
      canResume: active && activeFor >= config.custodySeconds,
      count,
      fine,
      officerId,
      justBusted,
      elapsed,
    });
  }

  return Object.freeze({ update, force, release, reset, snapshot });
}
