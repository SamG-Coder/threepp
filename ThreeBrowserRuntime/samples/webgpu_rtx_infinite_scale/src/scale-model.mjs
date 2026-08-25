export const DOMAIN_DEFINITIONS = Object.freeze([
  // The opening descent is deliberately spacious: it keeps moving while all
  // later raster/MRT variants stream and compile before the first handoff.
  Object.freeze({ id: "forge", label: "FORGE", seconds: 36, logStart: 0.65, logEnd: -3.0 }),
  Object.freeze({ id: "surface", label: "SURFACE", seconds: 14, logStart: -3.0, logEnd: -6.0 }),
  Object.freeze({ id: "microstructure", label: "MICROSTRUCTURE", seconds: 14, logStart: -6.0, logEnd: -9.0 }),
  Object.freeze({ id: "crystal", label: "CRYSTAL", seconds: 14, logStart: -9.0, logEnd: -10.35 }),
  Object.freeze({ id: "atomic", label: "ATOMIC", seconds: 13, logStart: -10.35, logEnd: -14.0 }),
  Object.freeze({ id: "nucleus", label: "NUCLEUS", seconds: 12, logStart: -14.0, logEnd: -16.0 }),
  Object.freeze({ id: "energy", label: "ENERGY", seconds: 15, logStart: -16.0, logEnd: -24.0 }),
]);

export const TOTAL_JOURNEY_SECONDS = DOMAIN_DEFINITIONS.reduce(
  (sum, domain) => sum + domain.seconds,
  0,
);

// Handoffs use cinematic time rather than a percentage of each shot. This
// keeps the long forge approach moving all the way into the blade instead of
// displaying the incoming domain as a miniature scene for many seconds.
export const HANDOFF_SECONDS = 1.25;
export const FOCUS_SECONDS = 2.25;
export const SETTLEMENT_SECONDS = 0.8;

export function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

export function smoothstep01(value) {
  const x = clamp01(value);
  return clamp01(x * x * (3 - 2 * x));
}

export function smootherstep01(value) {
  const x = clamp01(value);
  return clamp01(x * x * x * (x * (x * 6 - 15) + 10));
}

export function perceptualEase(value) {
  const x = smootherstep01(value);
  // A restrained logarithmic bias keeps screen-space motion alive in the
  // middle of a shot while retaining zero velocity at both rebase boundaries.
  return smoothstep01(0.08 * x + 0.92 * (Math.log1p(7 * x) / Math.log(8)));
}

export function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

export function sampleJourney(seconds, definitions = DOMAIN_DEFINITIONS) {
  const total = definitions.reduce((sum, domain) => sum + domain.seconds, 0);
  const cycleSeconds = positiveModulo(Number(seconds) || 0, total);
  let cursor = 0;
  let index = definitions.length - 1;
  for (let candidate = 0; candidate < definitions.length; ++candidate) {
    const end = cursor + definitions[candidate].seconds;
    if (cycleSeconds < end || candidate === definitions.length - 1) {
      index = candidate;
      break;
    }
    cursor = end;
  }

  const domain = definitions[index];
  const localLinear = clamp01((cycleSeconds - cursor) / domain.seconds);
  const localT = perceptualEase(localLinear);
  const handoffFraction = Math.min(1, HANDOFF_SECONDS / domain.seconds);
  const focusFraction = Math.min(1 - handoffFraction, FOCUS_SECONDS / domain.seconds);
  const handoffStart = 1 - handoffFraction;
  const focusStart = handoffStart - focusFraction;
  // The authored camera reaches its focal feature first. A separate focus
  // approach then fills the frame before any neighboring geometry is shown.
  const focus = smootherstep01((localLinear - focusStart) / Math.max(1e-9, focusFraction));
  const reverseFocus = smootherstep01(
    (handoffFraction + focusFraction - localLinear) / Math.max(1e-9, focusFraction),
  );
  // Adjacent representations overlap only for this short, fixed-time window.
  // The overlap still contains real nested geometry and a projection-matched
  // similarity transform, not a full-screen opacity dissolve.
  const transitionLinear = clamp01((localLinear - handoffStart) / handoffFraction);
  const transition = smootherstep01(transitionLinear);
  const reverseTransition = smootherstep01(clamp01(
    (handoffFraction - localLinear) / handoffFraction,
  ));
  const logMeters = domain.logStart + (domain.logEnd - domain.logStart) * localT;
  return {
    cycleSeconds,
    cycleProgress: cycleSeconds / total,
    index,
    previousIndex: (index + definitions.length - 1) % definitions.length,
    nextIndex: (index + 1) % definitions.length,
    domain,
    localLinear,
    localT,
    handoffFraction,
    focus,
    reverseFocus,
    transition,
    reverseTransition,
    logMeters,
  };
}

const SUPERSCRIPTS = Object.freeze({
  "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴",
  5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹",
});

function superscript(number) {
  return String(number).split("").map(character => SUPERSCRIPTS[character] ?? character).join("");
}

function concise(value) {
  if (value >= 100) return Math.round(value).toString();
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatScale(logMeters) {
  const exponent = Number(logMeters);
  if (!Number.isFinite(exponent)) return "—";
  const units = [
    { symbol: "m", exponent: 0 },
    { symbol: "cm", exponent: -2 },
    { symbol: "mm", exponent: -3 },
    { symbol: "μm", exponent: -6 },
    { symbol: "nm", exponent: -9 },
    { symbol: "Å", exponent: -10 },
    { symbol: "fm", exponent: -15 },
  ];
  for (const unit of units) {
    const value = 10 ** (exponent - unit.exponent);
    if (value >= 0.95 && value < 1000) return `${concise(value)} ${unit.symbol}`;
  }
  const rounded = Math.floor(exponent);
  const mantissa = 10 ** (exponent - rounded);
  return `${concise(mantissa)}×10${superscript(rounded)} m`;
}

export class ScaleJourney {
  constructor({ speed = 1, paused = false, direction = 1 } = {}) {
    this.seconds = 0;
    this.speed = Math.max(0.02, Number(speed) || 1);
    this.paused = Boolean(paused);
    this.direction = direction < 0 ? -1 : 1;
    this.cycle = 0;
    this.rebaseSerial = 0;
    this._lastIndex = 0;
  }

  update(deltaSeconds) {
    if (!this.paused) {
      const before = this.seconds;
      this.seconds += Math.max(0, Number(deltaSeconds) || 0) * this.speed * this.direction;
      const beforeCycle = Math.floor(before / TOTAL_JOURNEY_SECONDS);
      const afterCycle = Math.floor(this.seconds / TOTAL_JOURNEY_SECONDS);
      if (beforeCycle !== afterCycle) this.cycle += afterCycle - beforeCycle;
    }
    const sample = sampleJourney(this.seconds);
    if (sample.index !== this._lastIndex) {
      this.rebaseSerial += 1;
      this._lastIndex = sample.index;
    }
    return { ...sample, direction: this.direction, rebaseSerial: this.rebaseSerial, cycle: this.cycle };
  }

  sample() {
    return {
      ...sampleJourney(this.seconds),
      direction: this.direction,
      rebaseSerial: this.rebaseSerial,
      cycle: this.cycle,
    };
  }

  jumpTo(index, localLinear = 0.06) {
    const count = DOMAIN_DEFINITIONS.length;
    const target = positiveModulo(Math.trunc(index), count);
    let seconds = 0;
    for (let candidate = 0; candidate < target; ++candidate) {
      seconds += DOMAIN_DEFINITIONS[candidate].seconds;
    }
    this.seconds = seconds + DOMAIN_DEFINITIONS[target].seconds * clamp01(localLinear);
    this._lastIndex = target;
    this.rebaseSerial += 1;
    return this.sample();
  }

  setSpeed(speed) {
    this.speed = Math.min(8, Math.max(0.05, Number(speed) || 1));
  }

  togglePaused() {
    this.paused = !this.paused;
    return this.paused;
  }

  reverse() {
    this.direction *= -1;
    return this.direction;
  }
}

// At a rebase, a feature scaled to 0.1 and viewed from distance 1 has the same
// apparent coverage as the normalized feature viewed from distance 10.
export function gatewayCoverage(radius, scale, distance) {
  return Math.abs(Number(radius) * Number(scale) / Math.max(1e-9, Math.abs(Number(distance))));
}
