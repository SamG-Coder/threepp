export const PHYSICAL_CONSTANTS = Object.freeze({
  gravitationalConstant: 6.67430e-11,
  speedOfLight: 299_792_458,
  solarMass: 1.98847e30,
  solarRadius: 6.957e8,
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

/**
 * Builds one internally consistent Schwarzschild + stellar system.
 * Distances ending in `M` use geometrized units GM/c^2. In those units the
 * horizon is 2M, the photon sphere is 3M and the apparent shadow radius for a
 * distant observer is 3 sqrt(3) M.
 */
export function createRelativisticSystem({
  blackHoleSolarMasses = 300_000,
  starSolarMasses = 1,
  starSolarRadii = 1,
} = {}) {
  const { gravitationalConstant: G, speedOfLight: c, solarMass, solarRadius } = PHYSICAL_CONSTANTS;
  const blackHoleMassKg = blackHoleSolarMasses * solarMass;
  const starMassKg = starSolarMasses * solarMass;
  const starRadiusMeters = starSolarRadii * solarRadius;
  const gravitationalRadiusMeters = G * blackHoleMassKg / (c * c);
  const schwarzschildRadiusMeters = 2 * gravitationalRadiusMeters;
  const geometricTimeSeconds = G * blackHoleMassKg / (c * c * c);
  const starRadiusM = starRadiusMeters / gravitationalRadiusMeters;
  const tidalRadiusMeters = starRadiusMeters * Math.cbrt(blackHoleMassKg / starMassKg);
  const tidalRadiusM = tidalRadiusMeters / gravitationalRadiusMeters;

  return Object.freeze({
    blackHoleSolarMasses,
    starSolarMasses,
    starSolarRadii,
    blackHoleMassKg,
    starMassKg,
    starRadiusMeters,
    gravitationalRadiusMeters,
    schwarzschildRadiusMeters,
    geometricTimeSeconds,
    starRadiusM,
    tidalRadiusMeters,
    tidalRadiusM,
    horizonM: 2,
    photonSphereM: 3,
    iscoM: 6,
    shadowRadiusM: 3 * Math.sqrt(3),
  });
}

export const DEFAULT_SYSTEM = createRelativisticSystem();

export function radialPotential(rM, energy = 1, angularMomentumM = 3.98) {
  if (!(rM > 2)) return Number.NaN;
  return energy * energy
    - (1 - 2 / rM) * (1 + angularMomentumM * angularMomentumM / (rM * rM));
}

export function gravitationalRedshift(rM) {
  return Math.sqrt(Math.max(0, 1 - 2 / Math.max(2, rM)));
}

/** Local speed measured by a stationary Schwarzschild observer. */
export function localGeodesicSpeedFraction(rM, energy = 1) {
  if (!(rM > 2) || !(energy > 0)) return 1;
  return clamp(Math.sqrt(Math.max(0, 1 - (1 - 2 / rM) / (energy * energy))), 0, 1);
}

/** Local speed of a circular orbit, valid outside the photon sphere (r > 3M). */
export function circularOrbitSpeedFraction(rM) {
  if (!(rM > 3)) return 1;
  return clamp(1 / Math.sqrt(rM - 2), 0, 1);
}

export function coordinateCircularPeriodSeconds(rM, system = DEFAULT_SYSTEM) {
  if (!(rM > 0)) return 0;
  return 2 * Math.PI * Math.pow(rM, 1.5) * system.geometricTimeSeconds;
}

export function relativisticDopplerFactor(speedFraction, directionCosine) {
  const beta = clamp(Math.abs(speedFraction), 0, 0.999_999);
  const mu = clamp(directionCosine, -1, 1);
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  return 1 / (gamma * (1 - beta * mu));
}

export function tidalStressRatio(rM, system = DEFAULT_SYSTEM) {
  if (!(rM > 0)) return Number.POSITIVE_INFINITY;
  return Math.pow(system.tidalRadiusM / rM, 3);
}

/**
 * A conservative visual envelope driven by the exact Roche scaling above.
 * It preserves volume while the photosphere remains bound, then transfers
 * opacity into the two debris streams after the tidal stress exceeds unity.
 */
export function disruptionEnvelope(rM, system = DEFAULT_SYSTEM) {
  const stress = tidalStressRatio(rM, system);
  const overload = Math.max(0, stress - 1);
  const stretch = 1 + Math.min(10, Math.pow(overload, 0.38) * 1.12);
  const transverse = 1 / Math.sqrt(stretch);
  const stripped = 1 - Math.exp(-Math.pow(overload, 0.46) * 0.52);
  const horizonFade = clamp((rM - system.horizonM * 1.03) / 3.2, 0, 1);
  const boundFraction = clamp((1 - stripped * 0.92) * horizonFade, 0, 1);
  return {
    stress,
    stretch,
    transverse,
    strippedFraction: clamp(stripped, 0, 1),
    boundFraction,
  };
}

export function encounterPhase(rM, system = DEFAULT_SYSTEM) {
  if (rM <= system.horizonM * 1.05) return "CAPTURED";
  if (rM <= system.photonSphereM) return "FINAL PLUNGE";
  if (rM <= system.iscoM) return "ZOOM-WHIRL";
  const stress = tidalStressRatio(rM, system);
  if (stress >= 5) return "STELLAR SPAGHETTIFICATION";
  if (stress >= 1) return "TIDAL DISRUPTION";
  if (stress >= 0.55) return "ROCHE LIMIT APPROACH";
  return "BOUND APPROACH";
}

function geodesicDerivative(rM, energy, angularMomentumM) {
  const safeRadius = Math.max(2.000_001, rM);
  const potential = Math.max(0, radialPotential(safeRadius, energy, angularMomentumM));
  return {
    dr: -Math.sqrt(potential),
    dPhi: angularMomentumM / (safeRadius * safeRadius),
    dCoordinateTime: energy / Math.max(1e-6, 1 - 2 / safeRadius),
  };
}

function rk4Step(state, stepM, energy, angularMomentumM) {
  const derivative = radius => geodesicDerivative(radius, energy, angularMomentumM);
  const k1 = derivative(state.rM);
  const k2 = derivative(state.rM + k1.dr * stepM * 0.5);
  const k3 = derivative(state.rM + k2.dr * stepM * 0.5);
  const k4 = derivative(state.rM + k3.dr * stepM);
  const sixth = stepM / 6;
  return {
    rM: state.rM + sixth * (k1.dr + 2 * k2.dr + 2 * k3.dr + k4.dr),
    phi: state.phi + sixth * (k1.dPhi + 2 * k2.dPhi + 2 * k3.dPhi + k4.dPhi),
    coordinateTimeM: state.coordinateTimeM + sixth * (
      k1.dCoordinateTime + 2 * k2.dCoordinateTime + 2 * k3.dCoordinateTime + k4.dCoordinateTime
    ),
    properTimeM: state.properTimeM + stepM,
  };
}

/**
 * Integrates an equatorial timelike Schwarzschild geodesic in proper time.
 * E=1 and L just below 4M produce the classic near-critical zoom-whirl capture.
 */
export function buildCaptureTrajectory({
  startRadiusM = 130,
  stopRadiusM = 2.055,
  energy = 1,
  angularMomentumM = 3.98,
  stepM = 0.05,
  recordEvery = 4,
  maxSteps = 200_000,
} = {}) {
  if (!(startRadiusM > stopRadiusM && stopRadiusM > 2)) {
    throw new RangeError("Capture radii must satisfy start > stop > 2M.");
  }
  if (!(stepM > 0) || !(recordEvery >= 1)) {
    throw new RangeError("The integration step and record cadence must be positive.");
  }
  if (!(radialPotential(startRadiusM, energy, angularMomentumM) >= 0)) {
    throw new RangeError("The requested geodesic has no inward branch at the start radius.");
  }

  let state = { rM: startRadiusM, phi: 0, coordinateTimeM: 0, properTimeM: 0 };
  const samples = [{ ...state }];
  let step = 0;
  while (state.rM > stopRadiusM && step < maxSteps) {
    const next = rk4Step(state, stepM, energy, angularMomentumM);
    if (!Number.isFinite(next.rM) || next.rM >= state.rM) {
      throw new Error("Schwarzschild capture integration lost its inward branch.");
    }
    state = next;
    step += 1;
    if ((step % recordEvery) === 0 || state.rM <= stopRadiusM) samples.push({ ...state });
  }
  if (state.rM > stopRadiusM) throw new Error("Capture integration exceeded its step budget.");

  const durationProperM = samples.at(-1).properTimeM;
  const durationCoordinateM = samples.at(-1).coordinateTimeM;
  for (const sample of samples) sample.progress = sample.properTimeM / durationProperM;

  return Object.freeze({
    energy,
    angularMomentumM,
    startRadiusM,
    stopRadiusM,
    stepM,
    durationProperM,
    durationCoordinateM,
    samples: Object.freeze(samples.map(sample => Object.freeze(sample))),
  });
}

export function sampleCaptureTrajectory(trajectory, progress) {
  const samples = trajectory?.samples;
  if (!samples?.length) throw new TypeError("A capture trajectory is required.");
  const amount = clamp(Number(progress) || 0, 0, 1);
  if (amount <= 0) return { ...samples[0] };
  if (amount >= 1) return { ...samples.at(-1) };

  let low = 0;
  let high = samples.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].progress <= amount) low = middle;
    else high = middle;
  }
  const left = samples[low];
  const right = samples[high];
  const span = Math.max(1e-12, right.progress - left.progress);
  const blend = (amount - left.progress) / span;
  const lerp = (a, b) => a + (b - a) * blend;
  return {
    rM: lerp(left.rM, right.rM),
    phi: lerp(left.phi, right.phi),
    coordinateTimeM: lerp(left.coordinateTimeM, right.coordinateTimeM),
    properTimeM: lerp(left.properTimeM, right.properTimeM),
    progress: amount,
  };
}

export function trajectoryCartesian(sample, scale = 1) {
  return {
    x: Math.cos(sample.phi) * sample.rM * scale,
    y: 0,
    z: Math.sin(sample.phi) * sample.rM * scale,
  };
}

export function formatDuration(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  if (value < 60) return `${value.toFixed(1)} S`;
  const minutes = Math.floor(value / 60);
  const remainder = Math.floor(value % 60);
  return `${minutes}M ${String(remainder).padStart(2, "0")}S`;
}
