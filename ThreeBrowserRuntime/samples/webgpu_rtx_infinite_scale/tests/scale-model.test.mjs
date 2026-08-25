import assert from "node:assert/strict";
import test from "node:test";
import {
  DOMAIN_DEFINITIONS,
  HANDOFF_SECONDS,
  ScaleJourney,
  TOTAL_JOURNEY_SECONDS,
  formatScale,
  gatewayCoverage,
  perceptualEase,
  sampleJourney,
} from "../src/scale-model.mjs";

test("journey covers every domain exactly once per cycle", () => {
  const seen = new Set();
  for (let second = 0; second < TOTAL_JOURNEY_SECONDS; second += 0.05) {
    const sample = sampleJourney(second);
    seen.add(sample.domain.id);
    assert.ok(sample.localLinear >= 0 && sample.localLinear <= 1);
    assert.ok(sample.localT >= 0 && sample.localT <= 1);
    assert.ok(sample.transition >= 0 && sample.transition <= 1);
    assert.ok(sample.reverseTransition >= 0 && sample.reverseTransition <= 1);
    assert.ok(Number.isFinite(sample.logMeters));
  }
  assert.deepEqual([...seen], DOMAIN_DEFINITIONS.map(domain => domain.id));
});

test("physical scale is continuous at every non-loop boundary", () => {
  let boundary = 0;
  for (let index = 0; index < DOMAIN_DEFINITIONS.length - 1; ++index) {
    boundary += DOMAIN_DEFINITIONS[index].seconds;
    const before = sampleJourney(boundary - 1e-7);
    const after = sampleJourney(boundary + 1e-7);
    assert.ok(Math.abs(before.logMeters - after.logMeters) < 1e-5);
  }
});

test("handoffs wait for the fully focused end of every shot", () => {
  let cursor = 0;
  for (const definition of DOMAIN_DEFINITIONS) {
    const forwardStart = cursor + definition.seconds - HANDOFF_SECONDS;
    const beforeForward = sampleJourney(forwardStart - 1e-6);
    const afterForward = sampleJourney(forwardStart + 0.01);
    assert.equal(beforeForward.transition, 0, definition.id);
    assert.ok(afterForward.transition > 0, definition.id);
    assert.ok(beforeForward.focus > 0.999999, definition.id);
    assert.ok(
      perceptualEase(1 - HANDOFF_SECONDS / definition.seconds) > 0.9999,
      definition.id,
    );

    const reverseStart = cursor + HANDOFF_SECONDS;
    const beforeReverse = sampleJourney(reverseStart + 1e-6);
    const afterReverse = sampleJourney(reverseStart - 0.01);
    assert.equal(beforeReverse.reverseTransition, 0, definition.id);
    assert.ok(afterReverse.reverseTransition > 0, definition.id);
    assert.ok(beforeReverse.reverseFocus > 0.999999, definition.id);
    cursor += definition.seconds;
  }
});

test("normalized coordinate rebase preserves screen coverage", () => {
  const before = gatewayCoverage(1, 0.1, 1);
  const after = gatewayCoverage(1, 1, 10);
  assert.equal(before, after);
});

test("scale labels choose cinematic SI units", () => {
  assert.equal(formatScale(0), "1 m");
  assert.equal(formatScale(-2), "1 cm");
  assert.equal(formatScale(-3), "1 mm");
  assert.equal(formatScale(-6), "1 μm");
  assert.equal(formatScale(-9), "1 nm");
  assert.equal(formatScale(-10), "1 Å");
  assert.equal(formatScale(-15), "1 fm");
  assert.match(formatScale(-21), /10⁻²¹ m/);
});

test("pause, reverse, speed and debug jumps remain deterministic", () => {
  const journey = new ScaleJourney();
  journey.setSpeed(2);
  journey.update(1);
  assert.equal(journey.seconds, 2);
  journey.togglePaused();
  journey.update(5);
  assert.equal(journey.seconds, 2);
  journey.togglePaused();
  journey.reverse();
  journey.update(0.5);
  assert.equal(journey.seconds, 1);
  const atomic = journey.jumpTo(4);
  assert.equal(atomic.domain.id, "atomic");
  assert.ok(atomic.rebaseSerial > 0);
});
