import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRE_PATTERN_NODE_COUNT,
  FIRE_PATTERN_NODES,
  FIRE_PATTERN_SEED,
  cinWave,
  createFirePatternNodes,
  hashFirePatternSeed,
  sinWave,
} from "../src/fire-pattern.mjs";

function patternSignature(nodes) {
  let hash = 0x811c9dc5;
  for (const node of nodes) {
    for (const value of [
      node.x,
      node.z,
      node.angle,
      node.radius,
      node.monolithHeight,
      node.flameScale,
    ]) {
      hash ^= Math.round(value * 1_000_000);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash >>> 0;
}

test("canonical phrase produces the immutable 233-node CIN/SIN pattern", () => {
  assert.equal(FIRE_PATTERN_SEED, "p4 + 11c9h 9fwhsa assa dasd sa u923t u3240-9t 0w3");
  assert.equal(FIRE_PATTERN_NODE_COUNT, 233);
  assert.equal(hashFirePatternSeed(FIRE_PATTERN_SEED), 1_562_986_971);
  assert.equal(FIRE_PATTERN_NODES.length, 233);
  assert.ok(Object.isFrozen(FIRE_PATTERN_NODES));
  assert.ok(FIRE_PATTERN_NODES.every(Object.isFrozen));
  assert.deepEqual(
    FIRE_PATTERN_NODES.map(node => node.id),
    Array.from({ length: 233 }, (_, index) => `fire-${String(index + 1).padStart(3, "0")}`),
  );
  assert.equal(patternSignature(FIRE_PATTERN_NODES), 1_930_421_111);
});

test("generation is deterministic, seed-sensitive and renderer independent", () => {
  const first = createFirePatternNodes();
  const second = createFirePatternNodes({ seed: FIRE_PATTERN_SEED });
  assert.deepEqual(first, second);
  assert.notDeepEqual(
    createFirePatternNodes({ seed: `${FIRE_PATTERN_SEED} altered` }),
    first,
  );
  assert.throws(() => createFirePatternNodes({ count: 0 }), /count/i);
  assert.throws(() => createFirePatternNodes({ innerRadius: 8, outerRadius: 4 }), /radii/i);
});

test("all node channels are finite, bounded and occupy an expanding spiral", () => {
  const ids = new Set();
  let minimumSpacing = Infinity;
  for (const node of FIRE_PATTERN_NODES) {
    ids.add(node.id);
    for (const key of [
      "progress", "turn", "angle", "radius", "x", "z", "cin", "sin",
      "phase", "frequency", "monolithHeight", "monolithWidth", "monolithLean",
      "flameScale", "crackLength", "crackWidth", "emberBias",
    ]) assert.ok(Number.isFinite(node[key]), `${node.id}.${key} must be finite`);
    assert.ok(node.cin >= -1 && node.cin <= 1);
    assert.ok(node.sin >= -1 && node.sin <= 1);
    assert.ok(node.tier >= 1 && node.tier <= 3);
    assert.ok(node.band >= 0 && node.band <= 3);
    assert.ok(node.pulseGroup >= 0 && node.pulseGroup < 16);
    assert.ok(Math.abs(Math.hypot(node.x, node.z) - node.radius) < 1e-9);
  }
  for (let a = 0; a < FIRE_PATTERN_NODES.length; ++a) {
    for (let b = a + 1; b < FIRE_PATTERN_NODES.length; ++b) {
      minimumSpacing = Math.min(
        minimumSpacing,
        Math.hypot(
          FIRE_PATTERN_NODES[a].x - FIRE_PATTERN_NODES[b].x,
          FIRE_PATTERN_NODES[a].z - FIRE_PATTERN_NODES[b].z,
        ),
      );
    }
  }
  assert.equal(ids.size, 233);
  assert.ok(minimumSpacing > 0.45, `minimum node spacing was ${minimumSpacing}`);
  assert.ok(FIRE_PATTERN_NODES.at(-1).turn - FIRE_PATTERN_NODES[0].turn > 7);

  const quarterMeans = Array.from({ length: 4 }, (_, quarter) => {
    const start = Math.floor(quarter * FIRE_PATTERN_NODE_COUNT / 4);
    const end = Math.floor((quarter + 1) * FIRE_PATTERN_NODE_COUNT / 4);
    const slice = FIRE_PATTERN_NODES.slice(start, end);
    return slice.reduce((sum, node) => sum + node.radius, 0) / slice.length;
  });
  assert.ok(quarterMeans.every((value, index) => index === 0 || value > quarterMeans[index - 1]));
});

test("CIN and SIN companion waves remain normalized and non-identical", () => {
  let different = 0;
  for (let index = -200; index <= 200; ++index) {
    const value = index / 17;
    const cin = cinWave(value, 0.37);
    const sin = sinWave(value, 0.37);
    assert.ok(cin >= -1 && cin <= 1);
    assert.ok(sin >= -1 && sin <= 1);
    if (Math.abs(cin - sin) > 1e-5) different += 1;
  }
  assert.ok(different > 390);
});
