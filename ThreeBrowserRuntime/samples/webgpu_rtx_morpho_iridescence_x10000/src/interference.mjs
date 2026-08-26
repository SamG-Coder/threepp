export const CHITIN_IOR = 1.56;
export const AIR_IOR = 1.0;
export const NOMINAL_LAYER_GAP_NM = 90;
export const LATTICE_LAYER_COUNT = 12;

const SPECTRUM_SAMPLES = 31;
const LAMBDA_MIN_NM = 380;
const LAMBDA_MAX_NM = 780;
const BRAGG_FWHM_NM = 40;
const MIN_COSINE = 1e-6;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function positive(value, fallback) {
  const number = finite(value, fallback);
  return number > 0 ? number : fallback;
}

function diffractionOrder(order) {
  const mode = Math.trunc(finite(order, 1));
  return mode >= 1 ? mode : 1;
}

/** Bragg uses the air-side polar angle; cosθ is guarded to (0, 1]. */
function guardedCosine(thetaRadians) {
  const cosine = Math.cos(finite(thetaRadians, 0));
  if (!(cosine > 0)) return MIN_COSINE;
  return cosine > 1 ? 1 : cosine;
}

function effectiveIndex(chitinIndex, airIndex) {
  return 0.5 * (positive(chitinIndex, CHITIN_IOR) + positive(airIndex, AIR_IOR));
}

/**
 * Quarter-wave Morpho stack, not the 2 n d first-order slab (that peaks in the UV).
 * λ = 4 n_eff d cosθ / m with n_eff = (n_chitin + n_air) / 2.
 * Defaults: 4 × 1.28 × 90 nm ≈ 461 nm at normal incidence.
 */
export function braggPeakWavelengthNm({
  layerGapNm = NOMINAL_LAYER_GAP_NM,
  chitinIndex = CHITIN_IOR,
  airIndex = AIR_IOR,
  thetaRadians = 0,
  order = 1,
} = {}) {
  const gapNm = positive(layerGapNm, NOMINAL_LAYER_GAP_NM);
  const nEff = effectiveIndex(chitinIndex, airIndex);
  const cosine = guardedCosine(thetaRadians);
  const mode = diffractionOrder(order);
  return (4 * nEff * gapNm * cosine) / mode;
}

function fresnelFloor(chitinIndex, airIndex, cosine) {
  const nC = positive(chitinIndex, CHITIN_IOR);
  const nA = positive(airIndex, AIR_IOR);
  const f0 = ((nC - nA) / (nC + nA)) ** 2;
  const m = 1 - cosine;
  const schlick = f0 + (1 - f0) * m * m * m * m * m;
  return 0.02 + 0.28 * schlick;
}

function braggPeakHeight(layerCount, chitinIndex, airIndex) {
  const layers = Math.max(1, positive(layerCount, LATTICE_LAYER_COUNT));
  const nC = positive(chitinIndex, CHITIN_IOR);
  const nA = positive(airIndex, AIR_IOR);
  const contrast = Math.abs(nC - nA) / (nC + nA);
  return clamp(Math.tanh(layers * contrast * 1.15) ** 2, 0, 1);
}

/**
 * Lorentzian Bragg envelope around the quarter-wave peak, FWHM ~40 nm at 12
 * layers (narrower with more layers), plus a small Fresnel floor. Result ∈ [0, 1].
 */
export function thinFilmReflectance({
  wavelengthNm,
  layerGapNm = NOMINAL_LAYER_GAP_NM,
  layerCount = LATTICE_LAYER_COUNT,
  chitinIndex = CHITIN_IOR,
  airIndex = AIR_IOR,
  thetaRadians = 0,
} = {}) {
  const lambdaNm = positive(wavelengthNm, 550);
  const layers = Math.max(1, positive(layerCount, LATTICE_LAYER_COUNT));
  const cosine = guardedCosine(thetaRadians);
  const peakNm = braggPeakWavelengthNm({
    layerGapNm,
    chitinIndex,
    airIndex,
    thetaRadians,
    order: 1,
  });
  const fwhmNm = Math.max(6, BRAGG_FWHM_NM * Math.sqrt(LATTICE_LAYER_COUNT / layers));
  const halfWidthNm = 0.5 * fwhmNm;
  const envelope = 1 / (1 + ((lambdaNm - peakNm) / halfWidthNm) ** 2);
  const floor = fresnelFloor(chitinIndex, airIndex, cosine);
  const peak = Math.max(floor, braggPeakHeight(layers, chitinIndex, airIndex));
  return clamp(floor + (peak - floor) * envelope, 0, 1);
}

function lobe(wavelengthNm, centerNm, widthNm) {
  const t = (wavelengthNm - centerNm) / widthNm;
  return Math.exp(-0.5 * t * t);
}

/** Compact CIE 1931-like RGB matching lobes. */
function cieLikeRgb(wavelengthNm) {
  return {
    r: 1.056 * lobe(wavelengthNm, 600, 38) + 0.362 * lobe(wavelengthNm, 445, 18),
    g: 0.821 * lobe(wavelengthNm, 555, 40) + 0.286 * lobe(wavelengthNm, 530, 22),
    b: 1.217 * lobe(wavelengthNm, 445, 22) + 0.681 * lobe(wavelengthNm, 460, 26),
  };
}

function effectiveViewTheta(viewAngle, lightAngle) {
  return 0.5 * (Math.abs(finite(viewAngle, 0)) + Math.abs(finite(lightAngle, 0)));
}

export function iridescentRgb({
  layerGapNm = NOMINAL_LAYER_GAP_NM,
  layerCount = LATTICE_LAYER_COUNT,
  chitinIndex = CHITIN_IOR,
  airIndex = AIR_IOR,
  viewAngle = 0,
  lightAngle = 0,
} = {}) {
  const thetaRadians = effectiveViewTheta(viewAngle, lightAngle);
  const stepNm = (LAMBDA_MAX_NM - LAMBDA_MIN_NM) / (SPECTRUM_SAMPLES - 1);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let index = 0; index < SPECTRUM_SAMPLES; ++index) {
    const wavelengthNm = LAMBDA_MIN_NM + index * stepNm;
    const reflectance = thinFilmReflectance({
      wavelengthNm,
      layerGapNm,
      layerCount,
      chitinIndex,
      airIndex,
      thetaRadians,
    });
    const cmf = cieLikeRgb(wavelengthNm);
    r += reflectance * cmf.r;
    g += reflectance * cmf.g;
    b += reflectance * cmf.b;
  }
  return Object.freeze({
    r: finite(r),
    g: finite(g),
    b: finite(b),
  });
}

export function structuralColorForScale(scale, viewAngle, lightAngle) {
  const record = scale ?? {};
  return iridescentRgb({
    layerGapNm: record.layerGapNm,
    layerCount: record.layerCount,
    chitinIndex: record.chitinIndex,
    airIndex: record.airIndex,
    viewAngle,
    lightAngle,
  });
}
