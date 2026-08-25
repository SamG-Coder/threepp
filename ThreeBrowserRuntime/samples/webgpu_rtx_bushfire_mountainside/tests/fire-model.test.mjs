import assert from "node:assert/strict";
import test from "node:test";

import WildfireModel, { FIRE_STATES } from "../src/fire-model.mjs";

function model(overrides = {}) {
  return new WildfireModel({
    width: 9,
    height: 5,
    cellSize: 4,
    seed: "fixed-bushfire-test",
    fixedStepSeconds: 1,
    fuel: 0.95,
    moisture: 0.08,
    spreadTimeSeconds: 72,
    burnDurationSeconds: 420,
    preheatRetentionSeconds: 300,
    wind: { x: 1, z: 0, speed: 0 },
    ...overrides,
  });
}

function progression(cell) {
  const rank = {
    [FIRE_STATES.UNBURNED]: 0,
    [FIRE_STATES.HEATING]: 1,
    [FIRE_STATES.BURNING]: 2,
    [FIRE_STATES.BURNED]: 3,
  };
  return rank[cell.state] + cell.heat + cell.burn;
}

test("cells are stable renderer records and world lookup uses their centres", () => {
  const fire = model({ width: 4, height: 3, originX: -8, originZ: 10 });
  const first = fire.cells[0];
  assert.deepEqual(
    Object.keys(first),
    ["index", "x", "z", "gridX", "gridZ", "elevation", "fuel", "moisture", "heat", "burn", "state"],
  );
  assert.equal(first.x, -6);
  assert.equal(first.z, 12);
  assert.equal(fire.cellAtWorld(first.x, first.z), first);
  assert.equal(fire.cellAtGrid(0, 0), first);
  assert.equal(fire.cellAtWorld(-100, -100), null);

  fire.ignite(1, 1);
  fire.advance(30);
  assert.equal(fire.cells[0], first, "simulation must not replace retained cell objects");
  assert.equal(fire.validate(), true);
});

test("fixed-step spread is deterministic across different frame partitions", () => {
  const left = model({ wind: { x: 0.94, z: 0.34, speed: 6 } });
  const right = model({ wind: { x: 0.94, z: 0.34, speed: 6 } });
  left.ignite(4, 2);
  right.ignite(4, 2);

  left.advance(240);
  for (let frame = 0; frame < 960; ++frame) right.advance(0.25);

  assert.deepEqual(right.snapshot(), left.snapshot());
  assert.ok(left.stats().active + left.stats().burned > 1, "fire should visibly expand over several minutes");
});

test("prevailing wind advances the downwind front before the upwind front", () => {
  const fire = model({
    width: 11,
    height: 3,
    wind: { x: 1, z: 0, speed: 9 },
    windBiasPerSpeed: 0.2,
  });
  fire.ignite(5, 1);
  fire.advance(115);

  const downwind = fire.cellAtGrid(6, 1);
  const upwind = fire.cellAtGrid(4, 1);
  assert.ok(progression(downwind) > progression(upwind) + 0.65, {
    downwind: { state: downwind.state, heat: downwind.heat, burn: downwind.burn },
    upwind: { state: upwind.state, heat: upwind.heat, burn: upwind.burn },
  });
  assert.ok([FIRE_STATES.BURNING, FIRE_STATES.BURNED].includes(downwind.state));
  assert.notEqual(upwind.state, FIRE_STATES.BURNED);
});

test("uphill heating outruns an otherwise identical downhill neighbour", () => {
  const fire = model({
    width: 5,
    height: 3,
    wind: { x: 1, z: 0, speed: 0 },
    elevation: ({ gridX }) => (gridX - 2) * 1.55,
    uphillBias: 4.2,
  });
  fire.ignite(2, 1);
  fire.advance(105);

  const uphill = fire.cellAtGrid(3, 1);
  const downhill = fire.cellAtGrid(1, 1);
  assert.ok(progression(uphill) > progression(downhill) + 0.55, {
    uphill: { state: uphill.state, heat: uphill.heat, burn: uphill.burn },
    downhill: { state: downhill.state, heat: downhill.heat, burn: downhill.burn },
  });
  assert.ok([FIRE_STATES.BURNING, FIRE_STATES.BURNED].includes(uphill.state));
});

test("burning consumes fuel and every public value remains bounded", () => {
  const fire = model({ width: 7, height: 7, burnDurationSeconds: 120 });
  const source = fire.cellAtGrid(3, 3);
  const initialFuel = source.fuel;
  fire.ignite(3, 3);
  fire.advance(45);
  assert.ok(source.fuel < initialFuel);
  assert.ok(source.burn > 0 && source.burn <= 1);
  const afterFortyFive = fire.stats();
  assert.ok(afterFortyFive.fuelConsumed > 0);

  fire.advance(300);
  assert.equal(source.state, FIRE_STATES.BURNED);
  assert.equal(source.fuel, 0);
  assert.equal(fire.validate(), true);
  for (const cell of fire.cells) {
    assert.ok(cell.fuel >= 0 && cell.fuel <= 1);
    assert.ok(cell.moisture >= 0 && cell.moisture <= 1);
    assert.ok(cell.heat >= 0 && cell.heat <= 1);
    assert.ok(cell.burn >= 0 && cell.burn <= 1);
  }
  const stats = fire.stats();
  assert.equal(stats.unburned + stats.heating + stats.burning + stats.burned, fire.cells.length);
  assert.ok(stats.fuelFraction >= 0 && stats.fuelFraction <= 1);
  assert.ok(stats.burnedFraction >= 0 && stats.burnedFraction <= 1);
});

test("reset preserves cell identity and reignite replays recorded ignition points", () => {
  const fire = model();
  const source = fire.cellAtGrid(4, 2);
  fire.igniteWorld(source.x, source.z, { radius: 1 });
  assert.equal(fire.stats().burning, 5);
  fire.advance(80);

  fire.reset();
  assert.equal(fire.cellAtGrid(4, 2), source);
  assert.equal(fire.stats().burning, 0);
  assert.equal(fire.stats().unburned, fire.cells.length);
  assert.equal(fire.elapsedSeconds, 0);

  fire.reignite();
  assert.equal(fire.stats().burning, 5);
  assert.equal(source.state, FIRE_STATES.BURNING);
  assert.equal(fire.ignitionPlan.length, 1);
  assert.throws(() => fire.advance(-1), /non-negative/);
  assert.throws(() => new WildfireModel({ width: 0 }), /width/);
});
