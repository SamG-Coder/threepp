import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const samplesRoot = dirname(sampleRoot);
const load = path => readFile(join(sampleRoot, path), "utf8");
const SAMPLE_URL = "https://webgpu-rtx-universe-eye-x1000.runtime.threebrowser.local/";

const EXPECTED_FILES = Object.freeze([
  "README.md",
  "assets/sclera-microvascular.png",
  "assets/universe-spiral-iris.png",
  "index.html",
  "site-entry.mjs",
  "src/eye-dynamics.mjs",
  "src/eye-scene.mjs",
  "src/main.mjs",
  "src/native-rtx-renderer.mjs",
  "src/rtx-scene.mjs",
  "src/universe-eye-model.mjs",
  "tests/eye-dynamics.test.mjs",
  "tests/eye-scene.test.mjs",
  "tests/generated-assets.test.mjs",
  "tests/sample-contract.test.mjs",
  "tests/universe-eye-model.test.mjs",
  "threebrowser.pull.json",
]);

async function filesBelow(path = sampleRoot) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolute));
    else output.push(relative(sampleRoot, absolute).replaceAll("\\", "/"));
  }
  return output.sort();
}

test("sample is registered as an isolated portable WebGPU/RTX project", async () => {
  const [entry, html, manifestText] = await Promise.all([
    load("site-entry.mjs"),
    load("index.html"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(entry, /globalThis\.__threeBrowserSourceURL/);
  assert.match(entry, /webgpu-rtx-universe-eye-x1000\.runtime\.threebrowser\.local/);
  assert.match(entry, /await import\("\.\/src\/main\.mjs"\)/);
  assert.match(html, /<title>RTX Universe Eye ×1000 — ThreeBrowser Runtime<\/title>/);
  assert.match(html, /"three\/webgpu"/);
  assert.match(html, /src="\.\/site-entry\.mjs"/);

  assert.equal(manifest.format, 2);
  assert.match(manifest.projectId, /^[a-f0-9]{16}$/);
  assert.equal(manifest.virtualURL, SAMPLE_URL);
  assert.equal(manifest.source, SAMPLE_URL);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.html, "index.html");
  assert.equal(manifest.requiresWebGPU, true);
  assert.deepEqual(manifest.compatibility.rendererCandidates, ["webgpu"]);
  assert.equal(manifest.compatibility.canvasOnly, false);
  assert.equal(manifest.compatibility.htmlOverlay, true);
  assert.equal(manifest.compatibility.domRequired, true);
  assert.deepEqual(manifest.files.map(file => file.path).sort(), [...EXPECTED_FILES].sort());
  assert.deepEqual(await filesBelow(), [...EXPECTED_FILES].sort());
});

test("manifest and README state the exact artistic and rendering contract", async () => {
  const [manifestText, readme] = await Promise.all([
    load("threebrowser.pull.json"),
    load("README.md"),
  ]);
  const manifest = JSON.parse(manifestText);
  const notes = manifest.compatibility.notes.join("\n");

  assert.match(readme, /exactly \*\*1,000 deterministic stromal micro-fibres\*\*/);
  assert.match(readme, /`0x0E1E1000`/);
  assert.match(readme, /universe-spiral-iris\.png/);
  assert.match(readme, /sclera-microvascular\.png/);
  assert.match(readme, /no soundtrack or audio\s+transport/i);
  assert.match(readme, /not an offline path tracer/i);
  assert.match(readme, /transparent\s+cornea and the tear film/i);
  assert.match(readme, /excluded from the native\s+static acceleration structure/i);

  assert.match(notes, /Exactly 1,000 deterministic stromal micro-fibres/);
  assert.match(notes, /0x0E1E1000/);
  assert.match(notes, /not a full path tracer/i);
  assert.match(notes, /transparent cornea and tear-film materials/i);
  assert.match(notes, /excluded from BLAS construction/i);
  assert.match(notes, /one tone-mapped swapchain presentation/i);
});

test("main wires exact assets, controls and honest hybrid RTX staging", async () => {
  const main = await load("src/main.mjs");

  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /createUniverseEyeScene/);
  assert.match(main, /NativeRtxRenderer/);
  assert.match(main, /collectStaticRtxScene/);
  assert.match(main, /navigator\.gpu\?\.threeBrowserRTX/);
  assert.match(main, /renderNative\(/);
  assert.match(main, /renderRaster\(/);
  assert.match(main, /\.present\(\)/);
  assert.match(main, /universe-spiral-iris\.png/);
  assert.match(main, /sclera-microvascular\.png/);
  assert.match(main, /Promise\.all\s*\(/);
  assert.match(main, /opaqueRoots/);

  for (const key of ["l", "p", "x", "r"]) {
    assert.match(
      main,
      new RegExp(`(?:key\\s*===\\s*["']${key}["']|case\\s+["']${key}["'])`),
      `missing ${key.toUpperCase()} control`,
    );
  }
  assert.match(main, /(?:code\s*===\s*["']Space["']|case\s+["']Space["'])/);
  for (const event of ["pointerdown", "pointermove", "pointerup", "wheel"]) {
    assert.match(main, new RegExp(`["']${event}["']`), `missing ${event} input`);
  }
  assert.match(main, /beforeunload/);
  assert.doesNotMatch(main, /new\s+Audio\s*\(/);

  assert.equal((main.match(/\.present\(\)/g) ?? []).length, 1,
    "main must make exactly one final presentation call");
});

test("renderer helpers remain byte-identical to the proven Fire Pattern implementation", async () => {
  const fireRoot = resolve(samplesRoot, "webgpu_rtx_fire_pattern_233");
  for (const filename of ["native-rtx-renderer.mjs", "rtx-scene.mjs"]) {
    const [eyeHelper, fireHelper] = await Promise.all([
      readFile(join(sampleRoot, "src", filename)),
      readFile(join(fireRoot, "src", filename)),
    ]);
    assert.deepEqual(eyeHelper, fireHelper, `${filename} drifted from the proven implementation`);
  }

  const [renderer, collector] = await Promise.all([
    load("src/native-rtx-renderer.mjs"),
    load("src/rtx-scene.mjs"),
  ]);
  assert.match(renderer, /export class NativeRtxRenderer/);
  assert.match(renderer, /renderNative\(scene, camera/);
  assert.match(renderer, /renderRaster\(scene, camera/);
  assert.match(renderer, /present\(\)/);
  assert.match(renderer, /this\.renderer\.render\(this\._displayScene, this\._displayCamera\)/);
  assert.match(collector, /export async function collectStaticRtxScene/);
  assert.match(collector, /material\.transparent/);
  assert.match(collector, /material\.transmission/);
  assert.match(collector, /rtxIgnore/);
});

test("package is complete, local-only, audio-free and contains no native source", async () => {
  const manifest = JSON.parse(await load("threebrowser.pull.json"));
  for (const file of manifest.files) {
    assert.equal(file.url, new URL(file.path === "index.html" ? "" : file.path, SAMPLE_URL).href);
    assert.ok(!/^(?:https?:)?\/\//i.test(file.path), `remote manifest path: ${file.path}`);
    assert.ok(![".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"].includes(extname(file.path).toLowerCase()));
    assert.ok(![".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"].includes(extname(file.path).toLowerCase()));
  }

  const sourceFiles = (await filesBelow()).filter(path =>
    [".mjs", ".json", ".html", ".md"].includes(extname(path).toLowerCase()),
  );
  for (const path of sourceFiles) {
    const source = await load(path);
    assert.doesNotMatch(
      source,
      /https?:\/\/(?!webgpu-rtx-universe-eye-x1000\.runtime\.threebrowser\.local)/i,
      `external URL in ${path}`,
    );
  }
});
