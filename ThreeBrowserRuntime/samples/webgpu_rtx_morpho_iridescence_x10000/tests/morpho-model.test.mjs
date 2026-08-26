import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HERO_SCALE_INDEX,
  MORPHO_SEED,
  PHOTONIC_SCALES,
  PHOTONIC_SCALE_CHECKSUM,
  SCALE_COUNT,
  createPhotonicScales,
  createSeededRandom,
  photonicChecksum,
} from "../src/morpho-model.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const NUMERIC_KEYS = [
  "index",
  "u",
  "v",
  "chord",
  "span",
  "length",
  "width",
  "thickness",
  "tilt",
  "yaw",
  "roll",
  "ridgeCount",
  "layerGapNm",
  "chitinIndex",
  "airIndex",
  "layerCount",
  "peakWavelengthNm",
  "iridescence",
  "roughness",
  "metallic",
  "phase",
  "luminance",
  "opacity",
];

test("canonical photonic model fixes the numeric seed and exact X10000 contract", () => {
  assert.equal(SCALE_COUNT, 10000);
  assert.equal(MORPHO_SEED, 0x10f01000);
  assert.equal(HERO_SCALE_INDEX, 4242);
  assert.equal(PHOTONIC_SCALES.length, 10000);
  assert.equal(photonicChecksum(PHOTONIC_SCALES), PHOTONIC_SCALE_CHECKSUM);
  assert.ok(Object.isFrozen(PHOTONIC_SCALES));

  const hero = PHOTONIC_SCALES[HERO_SCALE_INDEX];
  assert.equal(hero.index, 4242);
  assert.equal(hero.id, "scale-4242");

  const ids = new Set();
  for (const [index, scale] of PHOTONIC_SCALES.entries()) {
    assert.ok(Object.isFrozen(scale));
    assert.equal(scale.index, index);
    assert.equal(scale.id, `scale-${String(index).padStart(4, "0")}`);
    assert.ok(!ids.has(scale.id), `duplicate scale id ${scale.id}`);
    ids.add(scale.id);
  }
  assert.equal(ids.size, 10000);
});

test("photonic authoring is deterministic, seeded and renderer-independent", async () => {
  const first = createPhotonicScales();
  const second = createPhotonicScales({ seed: MORPHO_SEED, count: 10000 });
  const alternate = createPhotonicScales({ seed: MORPHO_SEED ^ 0x5a5a5a5a, count: 10000 });

  assert.deepEqual(first, second);
  assert.equal(photonicChecksum(first), PHOTONIC_SCALE_CHECKSUM);
  assert.notEqual(photonicChecksum(alternate), PHOTONIC_SCALE_CHECKSUM);
  assert.equal(createPhotonicScales({ count: 17 }).length, 17);
  assert.throws(() => createPhotonicScales({ count: 100001 }), RangeError);

  const randomA = createSeededRandom(42);
  const randomB = createSeededRandom(42);
  assert.deepEqual(
    Array.from({ length: 16 }, () => randomA()),
    Array.from({ length: 16 }, () => randomB()),
  );

  const source = await readFile(join(sampleRoot, "src", "morpho-model.mjs"), "utf8");
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /from\s+["']three(?:\/|["'])/);
  assert.doesNotMatch(source, /\b(?:window|document|navigator)\b/);
});

test("all scale descriptors are finite, padded and occupy both wings", () => {
  const wings = new Set();
  for (const scale of PHOTONIC_SCALES) {
    wings.add(scale.wing);
    assert.match(scale.id, /^scale-\d{4}$/);
    assert.ok(scale.wing === "left" || scale.wing === "right", `${scale.id}.wing`);
    for (const key of NUMERIC_KEYS) {
      assert.ok(Number.isFinite(scale[key]), `${scale.id}.${key} is not finite`);
    }
    assert.ok(scale.u >= 0 && scale.u <= 1, `${scale.id}.u`);
    assert.ok(scale.v >= 0 && scale.v <= 1, `${scale.id}.v`);
    assert.ok(Number.isInteger(scale.ridgeCount) && scale.ridgeCount >= 6 && scale.ridgeCount <= 18);
    assert.ok(scale.layerGapNm >= 70 && scale.layerGapNm <= 110);
    assert.ok(scale.chitinIndex >= 1.52 && scale.chitinIndex <= 1.60);
    assert.equal(scale.airIndex, 1.0);
    assert.ok(Number.isInteger(scale.layerCount) && scale.layerCount >= 10 && scale.layerCount <= 12);
  }
  assert.ok(wings.has("left"), "left wing scales are missing");
  assert.ok(wings.has("right"), "right wing scales are missing");
  assert.equal(wings.size, 2);
});
