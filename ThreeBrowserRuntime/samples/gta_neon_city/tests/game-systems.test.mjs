import assert from "node:assert/strict";
import test from "node:test";
import { MISSION_STAGES, createVehicleRecoveryMission } from "../src/game/mission.mjs";
import { createWantedSystem, starsForHeat } from "../src/game/wanted.mjs";

test("wanted heat maps to escalating response and cools only after pursuit", () => {
  assert.equal(starsForHeat(0), 0);
  assert.equal(starsForHeat(12), 1);
  assert.equal(starsForHeat(70), 4);
  assert.equal(starsForHeat(100), 5);
  const wanted = createWantedSystem({ graceSeconds: 1, searchSeconds: 1, coolRate: 10, hiddenCoolRate: 50 });
  wanted.add(50, "vehicle theft");
  assert.equal(wanted.snapshot().stars, 3);
  for (let index = 0; index < 8; ++index) wanted.update(0.25, { observed: true });
  assert.equal(wanted.snapshot().stars, 3, "visible police should preserve heat");
  for (let index = 0; index < 30; ++index) wanted.update(0.25, { observed: false });
  assert.equal(wanted.snapshot().stars, 0);
  assert.equal(wanted.snapshot().heat, 0);
});

test("authorized vehicle recovery follows collection, escape, and return stages", () => {
  const mission = createVehicleRecoveryMission({ targetVehicleId: "comet-1", reward: 4200, legalRecovery: true });
  mission.begin();
  assert.equal(mission.snapshot().stage, MISSION_STAGES.STEAL);
  mission.notify({ type: "vehicle_entered", vehicleId: "taxi-2", wantedStars: 1 });
  assert.equal(mission.snapshot().stage, MISSION_STAGES.STEAL);
  mission.notify({ type: "vehicle_entered", vehicleId: "comet-1", wantedStars: 2 });
  assert.equal(mission.snapshot().stage, MISSION_STAGES.ESCAPE);
  mission.notify({ type: "wanted_changed", stars: 0 });
  assert.equal(mission.snapshot().stage, MISSION_STAGES.DELIVER);
  const result = mission.notify({ type: "vehicle_delivered", vehicleId: "comet-1" });
  assert.equal(result.stage, MISSION_STAGES.COMPLETE);
  assert.equal(result.reward, 4200);
  assert.equal(result.completedCount, 1);
});

test("mission and wanted state restore exactly", () => {
  const wanted = createWantedSystem();
  wanted.add(29, "gunfire");
  const wantedCopy = createWantedSystem();
  wantedCopy.restore(wanted.snapshot());
  assert.deepEqual(wantedCopy.snapshot(), wanted.snapshot());

  const mission = createVehicleRecoveryMission({ targetVehicleId: "sport-7" });
  mission.begin();
  const copy = createVehicleRecoveryMission();
  copy.restore(mission.snapshot());
  assert.deepEqual(copy.snapshot(), mission.snapshot());
});
