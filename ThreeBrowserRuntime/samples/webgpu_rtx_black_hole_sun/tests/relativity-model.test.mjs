import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SYSTEM,
  buildCaptureTrajectory,
  circularOrbitSpeedFraction,
  coordinateCircularPeriodSeconds,
  disruptionEnvelope,
  gravitationalRedshift,
  localGeodesicSpeedFraction,
  radialPotential,
  relativisticDopplerFactor,
  sampleCaptureTrajectory,
  tidalStressRatio,
} from "../src/relativity-model.mjs";

const close = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
};

test("the default intermediate-mass black hole uses exact Schwarzschild landmarks", () => {
  assert.equal(DEFAULT_SYSTEM.blackHoleSolarMasses, 300_000);
  close(DEFAULT_SYSTEM.schwarzschildRadiusMeters / 1000, 886_001.1, 2, "Schwarzschild radius (km)");
  close(DEFAULT_SYSTEM.photonSphereM, 3, 1e-12, "photon sphere");
  close(DEFAULT_SYSTEM.iscoM, 6, 1e-12, "ISCO");
  close(DEFAULT_SYSTEM.shadowRadiusM, 3 * Math.sqrt(3), 1e-12, "critical shadow radius");
  assert.ok(DEFAULT_SYSTEM.tidalRadiusM > 104 && DEFAULT_SYSTEM.tidalRadiusM < 106);
  assert.ok(DEFAULT_SYSTEM.starRadiusM > 1.56 && DEFAULT_SYSTEM.starRadiusM < 1.58);
});

test("redshift, local speeds, period and Doppler shift stay relativistically consistent", () => {
  close(gravitationalRedshift(6), Math.sqrt(2 / 3), 1e-12, "redshift at ISCO");
  close(circularOrbitSpeedFraction(6), 0.5, 1e-12, "local circular speed at ISCO");
  close(localGeodesicSpeedFraction(8, 1), 0.5, 1e-12, "parabolic local speed");
  assert.ok(coordinateCircularPeriodSeconds(6) > 136 && coordinateCircularPeriodSeconds(6) < 138);
  assert.ok(relativisticDopplerFactor(0.5, 1) > 1.7);
  assert.ok(relativisticDopplerFactor(0.5, -1) < 0.6);
});

test("the Roche stress reaches unity at the computed tidal radius", () => {
  close(tidalStressRatio(DEFAULT_SYSTEM.tidalRadiusM), 1, 1e-12, "tidal ratio");
  assert.ok(tidalStressRatio(DEFAULT_SYSTEM.tidalRadiusM * 0.5) > 7.99);
  const intact = disruptionEnvelope(DEFAULT_SYSTEM.tidalRadiusM * 1.5);
  const disrupted = disruptionEnvelope(DEFAULT_SYSTEM.tidalRadiusM * 0.35);
  assert.equal(intact.stretch, 1);
  assert.ok(disrupted.stretch > 2);
  assert.ok(disrupted.boundFraction < intact.boundFraction);
});

test("near-critical E=1, L<4M geodesic zoom-whirls and crosses the horizon monotonically", () => {
  const trajectory = buildCaptureTrajectory();
  assert.ok(trajectory.samples.length > 3_000);
  assert.ok(trajectory.durationProperM > 760 && trajectory.durationProperM < 800);
  assert.ok(trajectory.samples.at(-1).phi > Math.PI * 2);
  assert.ok(trajectory.samples.at(-1).rM < 2.055);
  for (let index = 1; index < trajectory.samples.length; ++index) {
    assert.ok(trajectory.samples[index].rM < trajectory.samples[index - 1].rM);
    assert.ok(trajectory.samples[index].phi > trajectory.samples[index - 1].phi);
  }
  const midpoint = sampleCaptureTrajectory(trajectory, 0.5);
  assert.ok(midpoint.rM < trajectory.startRadiusM && midpoint.rM > trajectory.stopRadiusM);
  assert.ok(radialPotential(midpoint.rM, trajectory.energy, trajectory.angularMomentumM) >= 0);
});
