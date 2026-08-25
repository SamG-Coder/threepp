import assert from "node:assert/strict";
import test from "node:test";
import { calculateArrestFine, createArrestSystem } from "../src/game/arrest.mjs";

test("arrest requires a sustained close officer contact and movement breaks surrender", () => {
  const arrest = createArrestSystem({ holdSeconds: 1, releaseRate: 2, custodySeconds: 2 });
  const vulnerable = {
    wantedStars: 2,
    playerAlive: true,
    inVehicle: false,
    health: 30,
    speed: 0.2,
    grounded: true,
    officerVisible: true,
    officerDistance: 1.8,
    officerId: "officer-1",
    cash: 1_250,
  };
  for (let index = 0; index < 4; ++index) arrest.update(0.2, vulnerable);
  assert.equal(arrest.snapshot().active, false);
  assert.ok(arrest.snapshot().ratio > 0.7);
  arrest.update(0.2, { ...vulnerable, speed: 4 });
  assert.ok(arrest.snapshot().ratio < 0.5, "running should rapidly unwind the surrender window");
  let sawBustedEdge = false;
  for (let index = 0; index < 6; ++index) {
    const frame = arrest.update(0.2, vulnerable);
    sawBustedEdge ||= frame.justBusted;
  }
  const busted = arrest.snapshot();
  assert.equal(busted.active, true);
  assert.equal(sawBustedEdge, true, "the arrest transition should emit exactly while custody begins");
  assert.equal(busted.officerId, "officer-1");
  assert.equal(busted.count, 1);
  assert.equal(busted.fine, calculateArrestFine(1_250, 2));
});

test("custody has a deterministic release point and force remains bounded by available cash", () => {
  const arrest = createArrestSystem({ custodySeconds: 0.5 });
  const forced = arrest.force({ wantedStars: 5, cash: 80 });
  assert.equal(forced.active, true);
  assert.equal(forced.fine, 80);
  assert.equal(forced.justBusted, true);
  arrest.update(0.25);
  assert.equal(arrest.snapshot().canResume, false);
  arrest.update(0.25);
  assert.equal(arrest.snapshot().canResume, true);
  const released = arrest.release();
  assert.equal(released.active, false);
  assert.equal(released.progress, 0);
  assert.equal(released.fine, 0);
  assert.equal(calculateArrestFine(0, 5), 0);
});
