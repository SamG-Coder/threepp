import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { TILE_SPECS } from "../src/tile-relief.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = relative => readFile(path.join(root, relative), "utf8");

test("manifest registers a portable WebGPU first-person beach", async () => {
  const [entry, html, manifestText] = await Promise.all([
    load("site-entry.mjs"),
    load("index.html"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(entry, /globalThis\.__threeBrowserSourceURL/);
  assert.match(entry, /webgpu-rtx-first-person-beach\.runtime\.threebrowser\.local/);
  assert.match(html, /RTX First-Person Beach/);
  assert.match(html, /"three\/webgpu"/);
  assert.equal(manifest.requiresWebGPU, true);
  assert.deepEqual(manifest.compatibility.rendererCandidates, ["webgpu"]);
  assert.equal(manifest.compatibility.canvasOnly, true);
  assert.equal(manifest.compatibility.htmlOverlay, false);
  assert.equal(manifest.compatibility.domRequired, false);
  for (const file of [
    "index.html",
    "site-entry.mjs",
    "src/main.mjs",
    "src/tile-relief.mjs",
    "src/native-rtx-renderer.mjs",
    "assets/textures/dry-sand-albedo.png",
    "assets/textures/dry-sand-height.png",
    "assets/textures/dry-sand-normal.png",
  ]) {
    assert.ok(manifest.files.some(entry => entry.path === file), `${file} missing from manifest`);
    assert.ok((await stat(path.join(root, file))).isFile());
  }
});

test("main wires first-person controls and hybrid RTX lighting without HTML overlay", async () => {
  const [main, html] = await Promise.all([load("src/main.mjs"), load("index.html")]);
  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /stepFirstPerson/);
  assert.match(main, /pointermove/);
  assert.match(main, /requestPointerLock/);
  assert.match(main, /NativeRtxRenderer/);
  assert.match(main, /evaluateRayLighting/);
  assert.match(main, /collectStaticBeachScene/);
  assert.match(main, /loadAllTileMaps/);
  assert.match(main, /\.present\(/);
  assert.match(main, /renderRaster\(/);
  assert.doesNotMatch(main, /OrbitControls|PointerLockControls|FlyControls/);
  assert.doesNotMatch(main, /document\.createElement\(\s*["'](?:div|aside|section|button|input|output)["']\s*\)/);
  assert.doesNotMatch(main, /innerHTML/);
  assert.doesNotMatch(html, /<(?:div|aside|section|header|footer|button|input)\b/i);
  assert.ok((main.match(/\.present\(/g) ?? []).length >= 1);
});

test("every tile that needs relief ships albedo, height and normal maps", async () => {
  for (const name of Object.keys(TILE_SPECS)) {
    for (const suffix of ["albedo", "height", "normal"]) {
      const file = path.join(root, "assets", "textures", `${name}-${suffix}.png`);
      assert.ok((await stat(file)).isFile(), file);
    }
  }
});
