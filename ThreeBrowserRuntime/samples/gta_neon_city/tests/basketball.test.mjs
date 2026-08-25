import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import {
  BASKETBALL_SAVE_VERSION,
  BASKETBALL_SHOTS,
  BASKETBALL_STAGES,
  createBasketballActivity,
} from "../src/game/basketball.mjs";

function chargeToSweetSpot(activity) {
  for (let step = 0; step < 300; ++step) {
    const state = activity.snapshot();
    if (Math.abs(state.charge - state.targetRelease) <= 0.006) return state;
    activity.update(1 / 120, { inVehicle: false });
  }
  throw new Error("basketball meter never reached its sweet spot");
}

function finishFlight(activity) {
  for (let step = 0; step < 240 && activity.snapshot().stage === BASKETBALL_STAGES.FLIGHT; ++step) {
    activity.update(1 / 60, { inVehicle: false });
  }
  return activity.snapshot();
}

test("Harbour Court requires positioning and resolves a visible timing-based shot", () => {
  const scene = new THREE.Scene();
  const activity = createBasketballActivity({ scene });
  try {
    assert.equal(activity.root.children.length, 1, "the reusable activity owns exactly one live ball mesh");
    let state = activity.begin({ inVehicle: false });
    assert.equal(state.stage, BASKETBALL_STAGES.WALK);
    assert.equal(state.stopCount, 5);

    state = activity.interact({ position: [0, 0, 0], inVehicle: false });
    assert.equal(state.lastEvent, "move_to_shot_spot");
    assert.equal(state.stage, BASKETBALL_STAGES.WALK);

    state = activity.interact({ position: BASKETBALL_SHOTS[0].position, inVehicle: false });
    assert.equal(state.stage, BASKETBALL_STAGES.CHARGING);
    chargeToSweetSpot(activity);
    state = activity.interact({ position: BASKETBALL_SHOTS[0].position, inVehicle: false });
    assert.equal(state.stage, BASKETBALL_STAGES.FLIGHT);
    assert.equal(state.releaseRating, "PERFECT");
    assert.equal(state.ballVisible, true);
    assert.ok(state.ballPosition.every(Number.isFinite));

    state = finishFlight(activity);
    assert.equal(state.stage, BASKETBALL_STAGES.WALK);
    assert.equal(state.made, 1);
    assert.equal(state.points, 2);
    assert.equal(state.ballVisible, false);
  } finally {
    activity.dispose();
  }
});

test("a five-shot perfect round pays, builds trust, and saves/restores mid-flight exactly", () => {
  const first = createBasketballActivity();
  const second = createBasketballActivity();
  try {
    first.begin({ inVehicle: false });
    for (let shotIndex = 0; shotIndex < BASKETBALL_SHOTS.length; ++shotIndex) {
      first.interact({ position: BASKETBALL_SHOTS[shotIndex].position, inVehicle: false });
      chargeToSweetSpot(first);
      first.interact({ position: BASKETBALL_SHOTS[shotIndex].position, inVehicle: false });

      if (shotIndex === 2) {
        first.update(0.33, { inVehicle: false });
        const saved = first.save();
        second.restore(saved);
        assert.deepEqual(second.save(), saved);
        assert.equal(second.snapshot().ballVisible, true);
      }
      finishFlight(first);
    }
    const complete = first.snapshot();
    assert.equal(complete.status, "completed");
    assert.equal(complete.made, 5);
    assert.equal(complete.perfects, 5);
    assert.equal(complete.points, 14);
    assert.equal(complete.payout, 805);
    assert.equal(complete.trustReward, 2);
  } finally {
    first.dispose();
    second.dispose();
  }
});

test("basketball made and missed paths are RAM-prewarmed without changing the activity", () => {
  const activity = createBasketballActivity();
  try {
    const before = activity.save();
    const warmed = activity.prewarm();
    assert.deepEqual(activity.save(), before);
    assert.deepEqual(warmed, {
      preparedMadeFlight: true,
      preparedMissFlight: true,
      meshes: 1,
      storage: "memory-only",
    });
  } finally {
    activity.dispose();
  }
});

test("Harbour Court rejects incompatible saves and cannot freeze inside a vehicle", () => {
  const activity = createBasketballActivity({ flightDuration: 1 });
  try {
    activity.begin({ inVehicle: false });
    activity.interact({ position: BASKETBALL_SHOTS[0].position, inVehicle: false });
    assert.throws(
      () => activity.restore({ ...activity.save(), version: BASKETBALL_SAVE_VERSION + 1 }),
      /Unsupported basketball activity save version/,
    );

    const failed = activity.update(1 / 60, { inVehicle: true });
    assert.equal(failed.stage, BASKETBALL_STAGES.FAILED);
    assert.equal(failed.failureReason, "on_foot_required");
    assert.equal(failed.ballVisible, false);

    activity.reset();
    activity.begin({ inVehicle: false });
    activity.interact({ position: BASKETBALL_SHOTS[0].position, inVehicle: false });
    chargeToSweetSpot(activity);
    activity.interact({ position: BASKETBALL_SHOTS[0].position, inVehicle: false });
    const boundarySave = { ...activity.save(), flightElapsed: 1 };
    const restored = activity.restore(boundarySave);
    assert.equal(restored.stage, BASKETBALL_STAGES.FLIGHT, "restore must not advance the activity state");
    assert.equal(restored.stopIndex, 0);
    assert.equal(restored.ballVisible, true);
    assert.ok(restored.ballPosition.every(Number.isFinite));
    assert.equal(activity.save().flightElapsed, 1);
    assert.equal(activity.update(0, { inVehicle: false }).stage, BASKETBALL_STAGES.WALK);
  } finally {
    activity.dispose();
  }
});
