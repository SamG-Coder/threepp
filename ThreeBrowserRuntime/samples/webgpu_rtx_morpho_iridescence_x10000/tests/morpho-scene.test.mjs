import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const load = path => readFile(join(sampleRoot, path), "utf8");

test("morpho-scene imports the photonic, anatomical and garden modules", async () => {
  const source = await load("src/morpho-scene.mjs");

  for (const moduleName of [
    "morpho-model",
    "interference",
    "wing-geometry",
    "insect-anatomy",
    "garden-architecture",
    "lanterns",
    "iridescence-material",
    "wing-dynamics",
  ]) {
    assert.match(
      source,
      new RegExp(`from\\s+["']\\./${moduleName}\\.mjs["']`),
      `missing import of ${moduleName}.mjs`,
    );
  }

  assert.match(source, /\bcreateIridescenceMaterial\b/);
  assert.match(source, /\bcreateWingDynamics\b/);
  assert.match(source, /export function createMorphoScene\s*\(/);
});

test("morpho-scene pins the ×10000 hero lattice and the opaque RTX partition", async () => {
  const source = await load("src/morpho-scene.mjs");

  assert.match(source, /\bHERO_SCALE_INDEX\b/);
  assert.match(source, /\bSCALE_COUNT\b/);
  assert.match(source, /\bopaqueRoots\b/);
  assert.match(source, /\brtxIgnore\b/);
  assert.match(source, /userData\.rtxIgnore\s*=\s*true/);
});

test("morpho-scene exposes flap control and a frozen stats snapshot", async () => {
  const source = await load("src/morpho-scene.mjs");

  assert.match(source, /\btriggerFlap\b/);
  assert.match(source, /\bstats\s*\(/);
  assert.match(source, /\breset\s*\(/);
  assert.match(source, /\bsetPaused\b/);
  assert.match(source, /Object\.freeze/);
});
