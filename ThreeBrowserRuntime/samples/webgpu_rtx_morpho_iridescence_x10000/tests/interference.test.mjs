import assert from "node:assert/strict";
import test from "node:test";

import {
  AIR_IOR,
  CHITIN_IOR,
  LATTICE_LAYER_COUNT,
  NOMINAL_LAYER_GAP_NM,
  braggPeakWavelengthNm,
  iridescentRgb,
  structuralColorForScale,
  thinFilmReflectance,
} from "../src/interference.mjs";

const VISIBLE_MIN_NM = 380;
const VISIBLE_MAX_NM = 780;
const DEFAULT_PEAK_NM = 480;
const PEAK_TOLERANCE_NM = 80;

function defaultStack(overrides = {}) {
  return {
    layerGapNm: NOMINAL_LAYER_GAP_NM,
    layerCount: LATTICE_LAYER_COUNT,
    chitinIndex: CHITIN_IOR,
    airIndex: AIR_IOR,
    thetaRadians: 0,
    ...overrides,
  };
}

function reflectanceAt(wavelengthNm, overrides = {}) {
  return thinFilmReflectance(defaultStack({ wavelengthNm, ...overrides }));
}

function sampledPeakWavelengthNm(thetaRadians) {
  let peakNm = VISIBLE_MIN_NM;
  let peakR = -Infinity;
  for (let wavelengthNm = VISIBLE_MIN_NM; wavelengthNm <= VISIBLE_MAX_NM; wavelengthNm += 2) {
    const value = reflectanceAt(wavelengthNm, { thetaRadians });
    if (value > peakR) {
      peakR = value;
      peakNm = wavelengthNm;
    }
  }
  return peakNm;
}

test("lattice constants match the Morpho multilayer stack", () => {
  assert.equal(LATTICE_LAYER_COUNT, 12);
  assert.equal(CHITIN_IOR, 1.56);
});

test("thinFilmReflectance stays in [0, 1] across visible wavelengths and angles", () => {
  const thetas = [0, 0.25, 0.6, 1.0];
  for (const thetaRadians of thetas) {
    for (let wavelengthNm = VISIBLE_MIN_NM; wavelengthNm <= VISIBLE_MAX_NM; wavelengthNm += 10) {
      const value = reflectanceAt(wavelengthNm, { thetaRadians });
      assert.ok(Number.isFinite(value), `R(${wavelengthNm} nm, θ=${thetaRadians}) is not finite`);
      assert.ok(
        value >= 0 && value <= 1,
        `R(${wavelengthNm} nm, θ=${thetaRadians}) = ${value} is outside [0, 1]`,
      );
    }
  }
});

test("default Bragg peak sits near 480 nm at theta=0", () => {
  const braggNm = braggPeakWavelengthNm(defaultStack({ thetaRadians: 0 }));
  assert.ok(Number.isFinite(braggNm), `bragg peak ${braggNm} nm is not finite`);
  assert.ok(
    Math.abs(braggNm - DEFAULT_PEAK_NM) <= PEAK_TOLERANCE_NM,
    `bragg peak ${braggNm} nm is not within ${PEAK_TOLERANCE_NM} nm of ${DEFAULT_PEAK_NM} nm`,
  );

  const sampledNm = sampledPeakWavelengthNm(0);
  assert.ok(
    Math.abs(sampledNm - DEFAULT_PEAK_NM) <= PEAK_TOLERANCE_NM,
    `sampled reflectance peak ${sampledNm} nm is not within ${PEAK_TOLERANCE_NM} nm of ${DEFAULT_PEAK_NM} nm`,
  );
});

test("increasing thetaRadians blueshifts the Bragg peak with cosθ", () => {
  const theta = Math.PI / 4;
  const normalBragg = braggPeakWavelengthNm(defaultStack({ thetaRadians: 0 }));
  const obliqueBragg = braggPeakWavelengthNm(defaultStack({ thetaRadians: theta }));
  assert.ok(
    Number.isFinite(normalBragg) && Number.isFinite(obliqueBragg),
    `Bragg peaks ${normalBragg} / ${obliqueBragg} nm are not finite`,
  );
  assert.ok(
    obliqueBragg < normalBragg,
    `expected Bragg blueshift with cosθ, got ${obliqueBragg} nm vs ${normalBragg} nm at θ=0`,
  );
  assert.ok(
    obliqueBragg < normalBragg * Math.cos(theta * 0.35),
    `Bragg peak ${obliqueBragg} nm did not move toward λ ∝ cosθ from ${normalBragg} nm`,
  );

  const normalSampled = sampledPeakWavelengthNm(0);
  const obliqueSampled = sampledPeakWavelengthNm(theta);
  assert.ok(
    obliqueSampled < normalSampled,
    `expected sampled reflectance blueshift, got ${obliqueSampled} nm vs ${normalSampled} nm at θ=0`,
  );
});

test("iridescentRgb returns finite r, g, b", () => {
  const rgb = iridescentRgb({
    layerGapNm: NOMINAL_LAYER_GAP_NM,
    layerCount: LATTICE_LAYER_COUNT,
    chitinIndex: CHITIN_IOR,
    airIndex: AIR_IOR,
    viewAngle: 0.18,
    lightAngle: 0.11,
  });
  assert.equal(typeof rgb, "object");
  assert.ok(rgb);
  assert.ok(Number.isFinite(rgb.r), `r=${rgb.r}`);
  assert.ok(Number.isFinite(rgb.g), `g=${rgb.g}`);
  assert.ok(Number.isFinite(rgb.b), `b=${rgb.b}`);
});

test("structuralColorForScale works with a fake scale object", () => {
  const scale = Object.freeze({
    id: "scale-fake",
    index: 4242,
    layerGapNm: NOMINAL_LAYER_GAP_NM,
    layerCount: LATTICE_LAYER_COUNT,
    chitinIndex: CHITIN_IOR,
    airIndex: AIR_IOR,
  });
  const rgb = structuralColorForScale(scale, 0.22, 0.08);
  assert.equal(typeof rgb, "object");
  assert.ok(rgb);
  assert.ok(Number.isFinite(rgb.r), `r=${rgb.r}`);
  assert.ok(Number.isFinite(rgb.g), `g=${rgb.g}`);
  assert.ok(Number.isFinite(rgb.b), `b=${rgb.b}`);
});
