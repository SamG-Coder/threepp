import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  STROMAL_FIBRE_CHECKSUM,
  STROMAL_FIBRE_COUNT,
  STROMAL_FIBRES,
  UNIVERSE_EYE_SEED,
  createSeededRandom,
  createStromalFibres,
  stromalChecksum,
} from "../src/universe-eye-model.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("canonical eye model fixes the numeric seed and exact X1000 contract", () => {
  assert.equal(UNIVERSE_EYE_SEED, 0x0e1e1000);
  assert.equal(STROMAL_FIBRE_COUNT, 1000);
  assert.equal(STROMAL_FIBRES.length, 1000);
  assert.equal(STROMAL_FIBRE_CHECKSUM, "0c706deb");
  assert.equal(stromalChecksum(STROMAL_FIBRES), STROMAL_FIBRE_CHECKSUM);
  assert.ok(Object.isFrozen(STROMAL_FIBRES));

  const ids = new Set();
  for (const [index, fibre] of STROMAL_FIBRES.entries()) {
    assert.ok(Object.isFrozen(fibre));
    assert.equal(fibre.index, index);
    assert.equal(fibre.id, `stroma-${String(index).padStart(4, "0")}`);
    assert.ok(!ids.has(fibre.id), `duplicate fibre id ${fibre.id}`);
    ids.add(fibre.id);
  }
  assert.equal(ids.size, 1000);
});

test("stromal authoring is deterministic, seeded and renderer-independent", async () => {
  const first = createStromalFibres();
  const second = createStromalFibres({ seed: UNIVERSE_EYE_SEED, count: 1000 });
  const alternate = createStromalFibres({ seed: UNIVERSE_EYE_SEED ^ 0x5a5a5a5a, count: 1000 });

  assert.deepEqual(first, second);
  assert.equal(stromalChecksum(first), STROMAL_FIBRE_CHECKSUM);
  assert.notEqual(stromalChecksum(alternate), STROMAL_FIBRE_CHECKSUM);
  assert.equal(createStromalFibres({ count: 17 }).length, 17);
  assert.throws(() => createStromalFibres({ count: 100_001 }), RangeError);

  const randomA = createSeededRandom(42);
  const randomB = createSeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 16 }, () => randomA()),
    Array.from({ length: 16 }, () => randomB()),
  );

  const source = await readFile(join(sampleRoot, "src", "universe-eye-model.mjs"), "utf8");
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /from\s+["']three(?:\/|["'])/);
  assert.doesNotMatch(source, /\b(?:window|document|navigator)\b/);
});

test("all fibre descriptors are finite, bounded and span the complete iris", () => {
  const numericKeys = [
    "index", "radial", "angle", "length", "width", "curl", "depth",
    "phase", "luminance", "cyan", "opacity",
  ];
  for (const fibre of STROMAL_FIBRES) {
    for (const key of numericKeys) {
      assert.ok(Number.isFinite(fibre[key]), `${fibre.id}.${key} is not finite`);
    }
    assert.ok(fibre.radial >= 0.29 && fibre.radial <= 0.97);
    assert.ok(fibre.length >= 0.045 && fibre.length <= 0.181);
    assert.ok(fibre.width >= 0.0012 && fibre.width <= 0.006);
    assert.ok(fibre.curl >= -0.39 && fibre.curl <= 0.77);
    assert.ok(fibre.depth >= -0.014 && fibre.depth <= 0.014);
    assert.ok(fibre.phase >= 0 && fibre.phase < Math.PI * 2);
    assert.ok(fibre.luminance >= 0.28 && fibre.luminance <= 1);
    assert.ok(fibre.cyan >= 0 && fibre.cyan <= 1);
    assert.ok(fibre.opacity >= 0.12 && fibre.opacity <= 0.45);
  }

  const radialValues = STROMAL_FIBRES.map(fibre => fibre.radial);
  assert.ok(Math.min(...radialValues) < 0.31, "fibres do not reach the inner iris");
  assert.ok(Math.max(...radialValues) > 0.94, "fibres do not reach the limbal edge");

  const occupiedSectors = new Set(STROMAL_FIBRES.map(fibre => {
    const wrapped = ((fibre.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.min(11, Math.floor(wrapped / (Math.PI * 2) * 12));
  }));
  assert.equal(occupiedSectors.size, 12);
});
