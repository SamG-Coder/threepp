import assert from "node:assert/strict";
import test from "node:test";

import MercuryPoolModel, {
  HeavyLiquidPoolModel,
  MERCURY_DENSITY_KG_M3,
  MERCURY_SURFACE_TENSION_N_M,
  MercuryPoolModel as NamedMercuryPoolModel,
} from "../src/mercury-model.mjs";

function compactOptions(overrides = {}) {
  return {
    width: 24,
    height: 28,
    poolWidth: 1.2,
    poolDepth: 1.4,
    ...overrides,
  };
}

function assertFiniteArray(array, label) {
  for (let index = 0; index < array.length; ++index) {
    assert.ok(Number.isFinite(array[index]), `${label}[${index}] must be finite`);
  }
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +/- ${tolerance}, received ${actual}`,
  );
}

test("production defaults expose stable renderer-friendly mercury fields", () => {
  assert.equal(HeavyLiquidPoolModel, MercuryPoolModel);
  assert.equal(NamedMercuryPoolModel, MercuryPoolModel);
  const model = new MercuryPoolModel();
  assert.equal(model.width, 88);
  assert.equal(model.height, 104);
  assert.equal(model.poolWidth, 4.4);
  assert.equal(model.poolDepth, 5.2);
  assert.equal(model.meanDepth, 0.11);
  assert.equal(model.fixedStepSeconds, 1 / 240);
  assert.equal(model.density, MERCURY_DENSITY_KG_M3);
  assert.equal(model.surfaceTension, MERCURY_SURFACE_TENSION_N_M);
  assert.equal(model.depth.length, 88 * 104);
  assert.equal(model.surface.length, model.depth.length);
  assert.equal(model.faceVelocityX.length, (88 + 1) * 104);
  assert.equal(model.faceVelocityZ.length, 88 * (104 + 1));
  assert.equal(model.cellSizeX, 0.05);
  assert.equal(model.cellSizeZ, 0.05);
  assert.ok(Object.isFrozen(model.config));
  assert.ok(Object.isFrozen(model.worldBounds));
  assert.ok(model.depth.every(value => value === 0.11));
  assert.ok(model.surface.every(value => value === 0.11));

  const expectedVolume = 4.4 * 5.2 * 0.11;
  const stats = model.stats();
  assertNear(stats.volume, expectedVolume, 1e-12, "rest volume");
  assertNear(stats.massKg, expectedVolume * MERCURY_DENSITY_KG_M3, 1e-9, "mass");
  assertNear(
    stats.restWeightNewtons,
    expectedVolume * MERCURY_DENSITY_KG_M3 * model.gravity,
    1e-8,
    "rest weight",
  );
});

test("a flat pool remains bit-identical under fixed ticks", () => {
  const model = new MercuryPoolModel(compactOptions());
  const initialDepth = model.depth.slice();
  const initialSurface = model.surface.slice();
  model.advanceTicks(240);
  assert.equal(model.tick, 240);
  assert.deepEqual(model.depth, initialDepth);
  assert.deepEqual(model.surface, initialSurface);
  assert.ok(model.faceVelocityX.every(value => value === 0));
  assert.ok(model.faceVelocityZ.every(value => value === 0));
  assert.ok(model.agitation.every(value => value === 0));
});

test("tick-keyed input is deterministic across render-frame partitions", () => {
  const options = compactOptions({ width: 20, height: 24, poolWidth: 1, poolDepth: 1.2 });
  const wholeFrame = new MercuryPoolModel(options);
  const partitioned = new MercuryPoolModel(options);
  for (const model of [wholeFrame, partitioned]) {
    model.queuePointer(0, 0.8, -0.2);
    model.queuePointer(72, -0.7, 0.5);
    model.disturb(0, 0, 0.025, 0.16, 96);
    model.queuePointer(160, 0.1, -0.8);
    model.queuePointer(224, 0, 0);
  }

  const totalTicks = 288;
  wholeFrame.advance(totalTicks * wholeFrame.fixedStepSeconds);
  const partitions = [1, 3, 7, 2, 11, 5, 13, 4];
  let remaining = totalTicks;
  let partition = 0;
  while (remaining > 0) {
    const ticks = Math.min(remaining, partitions[partition++ % partitions.length]);
    partitioned.advance(ticks * partitioned.fixedStepSeconds);
    remaining -= ticks;
  }

  assert.equal(wholeFrame.tick, totalTicks);
  assert.equal(partitioned.tick, totalTicks);
  for (const key of [
    "depth",
    "surface",
    "faceVelocityX",
    "faceVelocityZ",
    "velocityX",
    "velocityZ",
    "curvature",
    "agitation",
    "tilt",
    "tiltVelocity",
  ]) assert.deepEqual(partitioned[key], wholeFrame[key], key);
});

test("donor-limited fluxes conserve volume and remain finite and positive", () => {
  const model = new MercuryPoolModel(compactOptions());
  const pointerSequence = [
    [0, 1, 0.7],
    [80, -1, 0.5],
    [160, 0.8, -1],
    [240, -0.9, -0.8],
    [320, 1, 0],
    [440, 0, 0],
  ];
  for (const [tick, x, y] of pointerSequence) model.queuePointer(tick, x, y);
  model.disturb(-0.25, -0.15, 0.045, 0.14, 92);
  model.disturb(0.32, 0.25, -0.035, 0.13, 276);
  model.advanceTicks(560);

  for (const key of [
    "depth",
    "surface",
    "faceVelocityX",
    "faceVelocityZ",
    "velocityX",
    "velocityZ",
    "curvature",
    "agitation",
  ]) assertFiniteArray(model[key], key);
  const stats = model.stats();
  assert.ok(stats.minimumDepth >= model.minimumDepth - 1e-12, stats);
  assert.ok(stats.maximumSpeed <= model.maximumVelocity + 1e-12, stats);
  assert.ok(Math.abs(stats.volumeError) / model.restVolume < 1e-10, stats);
  assert.ok(stats.rmsSurfaceDisplacement > 1e-5, stats);

  const xStride = model.width + 1;
  for (let z = 0; z < model.height; ++z) {
    assert.equal(model.faceVelocityX[z * xStride], 0);
    assert.equal(model.faceVelocityX[z * xStride + model.width], 0);
  }
  for (let x = 0; x < model.width; ++x) {
    assert.equal(model.faceVelocityZ[x], 0);
    assert.equal(model.faceVelocityZ[model.height * model.width + x], 0);
  }
});

test("mass-derived tilt is delayed, bounded, and changes apparent weight", () => {
  const model = new MercuryPoolModel(compactOptions({
    width: 16,
    height: 20,
    poolWidth: 0.8,
    poolDepth: 1,
  }));
  const expectedMass = 0.8 * 1 * model.meanDepth * model.density;
  const expectedInertia = expectedMass * (0.8 * 0.8 + 1) / 12;
  assertNear(model.massKg, expectedMass, 1e-10, "configured mercury mass");
  assertNear(model.tiltInertia, expectedInertia, 1e-10, "mass-derived inertia");
  const restWeight = model.stats().restWeightNewtons;

  model.setPointer(0.45, 0, { weight: 1 });
  const ordinaryTarget = model.targetTilt[0];
  model.setPointer(0.45, 0, { weight: 1.32 });
  assert.ok(model.targetTilt[0] > ordinaryTarget, "drag weight should strengthen tilt demand");
  model.setPointer(1, 0);
  const target = model.targetTilt[0];
  model.advanceTicks(24); // 0.1 seconds
  assert.ok(model.tilt[0] > 0 && model.tilt[0] < target * 0.15, {
    tilt: model.tilt[0],
    target,
  });
  model.advanceTicks(456); // two seconds total
  assertNear(model.tilt[0], target, 1e-8, "settled heavy tilt");
  assert.ok(Math.hypot(model.tilt[0], model.tilt[1]) <= model.maximumTiltRadians + 1e-12);
  const maximumAcceleration = model.gravity * Math.tan(model.maximumTiltRadians);
  assert.ok(Math.abs(model.apparentGravity[0]) <= maximumAcceleration + 1e-12);
  assert.ok(model.stats().apparentWeightNewtons > restWeight);
});

test("a compact disturbance reaches and rebounds from a closed wall, then decays", () => {
  const model = new MercuryPoolModel({
    width: 32,
    height: 24,
    poolWidth: 1.6,
    poolDepth: 1.2,
    meanDepth: 0.11,
    linearDamping: 0.24,
  });
  model.disturb(0, 0, 0.035, 0.18);
  const initialEnergy = model.stats().mechanicalEnergyJoules;
  const wallX = model.worldBounds.maxX - model.cellSizeX * 0.5;
  assert.ok(initialEnergy > 0);

  model.advanceTicks(168); // ~0.7 s: first wave reaches the x wall
  const arrival = model.sample(wallX, 0).depth - model.meanDepth;
  assert.ok(arrival > 0.0005, `expected positive wall arrival, received ${arrival}`);
  model.advanceTicks(48); // reflected trough follows the crest
  const reflected = model.sample(wallX, 0).depth - model.meanDepth;
  assert.ok(reflected < -0.0005, `expected reflected trough, received ${reflected}`);
  model.advanceTicks(384); // 2.5 s total
  const finalEnergy = model.stats().mechanicalEnergyJoules;
  assert.ok(finalEnergy < initialEnergy * 0.45, { initialEnergy, finalEnergy });
});

test("reset preserves public references and restores the exact initial state", () => {
  const model = new MercuryPoolModel(compactOptions({ bottomHeight: -0.35 }));
  const references = Object.fromEntries([
    "depth",
    "surface",
    "velocityX",
    "velocityZ",
    "curvature",
    "agitation",
    "faceVelocityX",
    "faceVelocityZ",
    "tilt",
    "targetTilt",
  ].map(key => [key, model[key]]));
  model.setPointer(-0.9, 0.6);
  model.disturb(0.1, -0.15, 0.03, 0.18);
  model.queuePointer(300, 1, 1);
  model.advanceTicks(120);
  assert.ok(model.stats().mechanicalEnergyJoules > 0);
  const insideSample = model.sample(0, 0);
  const outsideSample = model.sample(99, -99);
  assert.equal(insideSample.inside, true);
  assert.equal(outsideSample.inside, false);
  for (const key of ["depth", "surface", "velocityX", "velocityZ", "curvature", "agitation"]) {
    assert.ok(Number.isFinite(insideSample[key]));
  }

  model.reset();
  for (const [key, reference] of Object.entries(references)) {
    assert.equal(model[key], reference, `${key} reference changed`);
  }
  assert.equal(model.tick, 0);
  assert.equal(model.elapsedSeconds, 0);
  assert.equal(model.stats().pendingEvents, 0);
  assert.ok(model.depth.every(value => value === model.meanDepth));
  assert.ok(model.surface.every(value => value === model.bottomHeight + model.meanDepth));
  assert.ok(model.faceVelocityX.every(value => value === 0));
  assert.ok(model.faceVelocityZ.every(value => value === 0));
  assert.deepEqual(Array.from(model.tilt), [0, 0]);
  assert.deepEqual(Array.from(model.targetTilt), [0, 0]);
});
