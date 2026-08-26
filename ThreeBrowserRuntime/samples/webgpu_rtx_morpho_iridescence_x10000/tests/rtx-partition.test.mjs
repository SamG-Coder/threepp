import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const load = path => readFile(join(sampleRoot, path), "utf8");

function assertExcludedFromStaticBlas(source, label) {
  assert.match(
    source,
    /rtxIgnore|transparent|transmission/,
    `${label} must use rtxIgnore or transparent/transmission to stay out of the static BLAS`,
  );
}

test("collectStaticRtxScene is used on opaqueRoots in main or morpho-scene", async () => {
  const [main, scene] = await Promise.all([
    load("src/main.mjs"),
    load("src/morpho-scene.mjs"),
  ]);
  const callOnOpaqueRoots = /collectStaticRtxScene\s*\(\s*(?:[\w$.]+\.)?opaqueRoots/;
  assert.ok(
    callOnOpaqueRoots.test(main) || callOnOpaqueRoots.test(scene),
    "collectStaticRtxScene must receive opaqueRoots from main.mjs or morpho-scene.mjs",
  );
  assert.match(scene, /\bopaqueRoots\b/);
  assert.doesNotMatch(main, /collectStaticRtxScene\s*\(\s*scene\b/);
  assert.doesNotMatch(scene, /collectStaticRtxScene\s*\(\s*scene\b/);
});

test("glass, water, dew and wings stay out of the opaque native RTX boundary", async () => {
  const [garden, pond, dew, wings, scene] = await Promise.all([
    load("src/garden-architecture.mjs"),
    load("src/pond.mjs"),
    load("src/dew-field.mjs"),
    load("src/wing-geometry.mjs"),
    load("src/morpho-scene.mjs"),
  ]);

  assert.match(garden, /\bglassRoot\b/);
  assert.match(garden, /\bopaqueRoot\b/);
  assertExcludedFromStaticBlas(garden, "greenhouse glass");

  assert.match(pond, /\bwater\b/);
  assertExcludedFromStaticBlas(pond, "pond water");

  assert.match(dew, /\brtxIgnore\b/);
  assertExcludedFromStaticBlas(dew, "dew droplets");

  assertExcludedFromStaticBlas(wings, "wing membranes");

  assert.match(scene, /lattice/i);
  assertExcludedFromStaticBlas(scene, "hero photonic lattice");
});

test("native-rtx-renderer exports NativeRtxRenderer and present()", async () => {
  const renderer = await load("src/native-rtx-renderer.mjs");
  assert.match(renderer, /export class NativeRtxRenderer/);
  assert.match(renderer, /present\(\)/);
  assert.match(renderer, /this\.renderer\.render\(this\._displayScene, this\._displayCamera\)/);
});

test("rtx-scene excludes transparent and transmission from the static collector", async () => {
  const collector = await load("src/rtx-scene.mjs");
  assert.match(collector, /export async function collectStaticRtxScene/);
  assert.match(collector, /material\.transparent/);
  assert.match(collector, /material\.transmission/);
  assert.match(collector, /rtxIgnore/);
  assert.match(collector, /material\.transparent !== true/);
  assert.match(collector, /finite\(material\.transmission, 0\) <= 0\.005/);
  assert.match(collector, /skipped\.transparent \+= 1/);
});
