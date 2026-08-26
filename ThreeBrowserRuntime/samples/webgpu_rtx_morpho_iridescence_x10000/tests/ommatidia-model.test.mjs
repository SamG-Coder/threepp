import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  OMMATIDIA,
  OMMATIDIA_CHECKSUM,
  OMMATIDIA_COUNT,
  createOmmatidia,
  ommatidiaChecksum,
} from "../src/ommatidia-model.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const MORPHO_SEED = 0x10f01000;

const NUMERIC_KEYS = [
  "index",
  "theta",
  "phi",
  "radius",
  "hexRadius",
  "orientation",
  "luminance",
  "hue",
];

test("canonical ommatidia model fixes the exact 4096 compound-eye contract", () => {
  assert.equal(OMMATIDIA_COUNT, 4096);
  assert.equal(OMMATIDIA.length, 4096);
  assert.match(OMMATIDIA_CHECKSUM, /^[0-9a-f]{8}$/);
  assert.equal(ommatidiaChecksum(OMMATIDIA), OMMATIDIA_CHECKSUM);
  assert.ok(Object.isFrozen(OMMATIDIA));

  const ids = new Set();
  for (const [index, unit] of OMMATIDIA.entries()) {
    assert.ok(Object.isFrozen(unit));
    assert.equal(unit.index, index);
    assert.equal(unit.id, `omma-${String(index).padStart(4, "0")}`);
    assert.ok(!ids.has(unit.id), `duplicate ommatidium id ${unit.id}`);
    ids.add(unit.id);
  }
  assert.equal(ids.size, 4096);
});

test("ommatidia authoring is deterministic, seeded and renderer-independent", async () => {
  const first = createOmmatidia();
  const second = createOmmatidia({ seed: MORPHO_SEED, count: 4096 });
  const alternate = createOmmatidia({ seed: MORPHO_SEED ^ 0x5a5a5a5a, count: 4096 });

  assert.deepEqual(first, second);
  assert.equal(ommatidiaChecksum(first), OMMATIDIA_CHECKSUM);
  assert.notEqual(ommatidiaChecksum(alternate), OMMATIDIA_CHECKSUM);
  assert.equal(createOmmatidia({ count: 17 }).length, 17);
  assert.throws(() => createOmmatidia({ count: 100001 }), RangeError);

  const source = await readFile(join(sampleRoot, "src", "ommatidia-model.mjs"), "utf8");
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(source, /from\s+["']three(?:\/|["'])/);
  assert.doesNotMatch(source, /\b(?:window|document|navigator)\b/);
});

test("all ommatidium descriptors occupy both eyes with finite spherical angles", () => {
  const eyes = new Set();
  for (const unit of OMMATIDIA) {
    eyes.add(unit.eye);
    assert.match(unit.id, /^omma-\d{4}$/);
    assert.ok(unit.eye === "left" || unit.eye === "right", `${unit.id}.eye`);
    for (const key of NUMERIC_KEYS) {
      assert.ok(Number.isFinite(unit[key]), `${unit.id}.${key} is not finite`);
    }
    assert.ok(Number.isFinite(unit.theta), `${unit.id}.theta is not finite`);
    assert.ok(Number.isFinite(unit.phi), `${unit.id}.phi is not finite`);
  }
  assert.ok(eyes.has("left"), "left-eye ommatidia are missing");
  assert.ok(eyes.has("right"), "right-eye ommatidia are missing");
  assert.equal(eyes.size, 2);
});
