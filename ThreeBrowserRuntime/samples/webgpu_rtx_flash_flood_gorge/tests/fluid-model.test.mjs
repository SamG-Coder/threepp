import assert from "node:assert/strict";
import test from "node:test";

import FlashFloodModel, { ShallowWaterModel } from "../src/fluid-model.mjs";

function gorge(overrides = {}) {
  return new FlashFloodModel({
    width: 13,
    height: 48,
    cellSize: 2,
    originX: -13,
    originZ: -48,
    fixedStepSeconds: 0.05,
    bed: ({ gridX, gridZ }) => Math.pow(Math.abs(gridX - 6) / 6, 4) * 7 - gridZ * 0.075,
    gateWidthCells: 5,
    gateStartSeconds: 0,
    gateRiseSeconds: 1,
    gateHoldSeconds: 60,
    gateFallSeconds: 4,
    gatePeakDischarge: 40,
    maxDepth: 6,
    maxVelocity: 18,
    ...overrides,
  });
}

test("x spans the gorge, increasing z is downstream, and state is renderer-friendly", () => {
  const water = gorge({ width: 5, height: 7, originX: -5, originZ: -14 });
  assert.equal(ShallowWaterModel, FlashFloodModel);
  assert.equal(water.depth.length, 35);
  assert.ok(water.depth instanceof Float64Array);
  assert.ok(water.foam instanceof Float64Array);
  assert.ok(water.wetMask instanceof Uint8Array);
  assert.deepEqual(water.worldBounds, { minX: -5, maxX: 5, minZ: -14, maxZ: 0 });

  const upstream = water.cellAtGrid(2, 0);
  const downstream = water.cellAtGrid(2, 6);
  assert.ok(upstream.z < downstream.z);
  assert.equal(water.cellAtWorld(upstream.x, upstream.z), upstream);
  assert.equal(upstream.depth, water.depth[upstream.index]);

  const sample = water.sample(upstream.x, upstream.z);
  assert.equal(sample.depth, upstream.depth);
  assert.equal(sample.bed, upstream.bed);
  assert.equal(water.sample(-500, 0), null);
  assert.equal(water.cellAtGrid(-1, 0), null);
});

test("fixed ticks are deterministic across different render-frame partitions", () => {
  const single = gorge();
  const renderFrames = gorge();
  single.advance(20);
  for (let frame = 0; frame < 1_200; ++frame) renderFrames.advance(1 / 60);

  assert.deepEqual(renderFrames.snapshot(), single.snapshot());
  assert.ok(single.stats().everWetCells > single.gate.cellCount);
});

test("the gate hydrograph launches a travelling surge that reaches downstream", () => {
  const water = gorge();
  assert.equal(water.gateOpeningAt(0), 0);
  assert.ok(water.gateOpeningAt(0.5) > 0 && water.gateOpeningAt(0.5) < 1);
  assert.equal(water.gateOpeningAt(2), 1);

  water.advance(5);
  const early = water.stats();
  assert.ok(early.frontGridZ >= 5 && early.frontGridZ < water.height - 1, early);
  assert.ok(water.cellAtGrid(6, 0).wet);
  assert.equal(water.cellAtGrid(6, water.height - 1).wet, false);

  water.advance(27);
  const arrived = water.stats();
  assert.equal(arrived.frontGridZ, water.height - 1);
  assert.ok(water.cellAtGrid(6, water.height - 1).depth > water.config.wetDepth);
  assert.ok(arrived.outflowVolume > 0, "the open downstream edge should release the arrived surge");
});

test("wet/dry transitions progress down the gorge instead of wetting instantly", () => {
  const water = gorge();
  water.advance(4);
  const first = water.stats();
  assert.ok(first.wetCells > 0);
  assert.ok(first.wetCells < water.depth.length * 0.25);

  water.advance(8);
  const second = water.stats();
  assert.ok(second.everWetCells > first.everWetCells * 2, { first, second });
  assert.ok(second.frontGridZ > first.frontGridZ + 5, { first, second });
  assert.ok(second.wetCells < water.depth.length, "the travelling front must leave dry gorge ahead");
});

test("depths, velocities, surface metrics, and mass accounting remain bounded", () => {
  const water = gorge({
    maxDepth: 2.5,
    maxVelocity: 7,
    gatePeakDischarge: 125,
    gateHoldSeconds: 80,
  });
  water.advance(42);
  assert.equal(water.validate(), true);
  for (let index = 0; index < water.depth.length; ++index) {
    assert.ok(Number.isFinite(water.depth[index]));
    assert.ok(water.depth[index] >= 0 && water.depth[index] <= 2.5);
    assert.ok(Math.abs(water.velocityX[index]) <= 7);
    assert.ok(Math.abs(water.velocityZ[index]) <= 7);
    assert.ok(water.speed[index] <= 7);
    assert.ok(water.foam[index] >= 0 && water.foam[index] <= 1);
    assert.ok(water.turbulence[index] >= 0 && water.turbulence[index] <= 1);
  }
  const stats = water.stats();
  assert.ok(stats.injectedVolume > 0);
  assert.ok(Math.abs(stats.massError) < Math.max(1e-7, stats.injectedVolume * 1e-10), stats);
});

test("the leading bore creates usable turbulence and foam fields", () => {
  const water = gorge();
  water.advance(9);
  const stats = water.stats();
  assert.ok(stats.maxFoam > 0.35, stats);
  assert.ok(stats.meanTurbulence > 0.015, stats);

  let energeticFoamCells = 0;
  for (let index = 0; index < water.foam.length; ++index) {
    if (water.foam[index] > 0.2 && water.turbulence[index] > 0.2) energeticFoamCells += 1;
  }
  assert.ok(energeticFoamCells >= water.gate.cellCount, { energeticFoamCells, stats });
});

test("reset restores the exact initial state without replacing renderer references", () => {
  const water = gorge({ initialDepth: ({ gridZ }) => (gridZ === 0 ? 0.08 : 0) });
  const pristine = gorge({ initialDepth: ({ gridZ }) => (gridZ === 0 ? 0.08 : 0) });
  const depthArray = water.depth;
  const foamArray = water.foam;
  const retainedCell = water.cellAtGrid(6, 0);
  water.advance(18);
  assert.ok(water.stats().injectedVolume > 0);

  water.reset();
  assert.equal(water.depth, depthArray);
  assert.equal(water.foam, foamArray);
  assert.equal(water.cellAtGrid(6, 0), retainedCell);
  assert.deepEqual(water.snapshot(), pristine.snapshot());
  assert.throws(() => water.advance(-1), /non-negative/);
  assert.throws(() => new FlashFloodModel({ width: 1 }), /width/);
});
