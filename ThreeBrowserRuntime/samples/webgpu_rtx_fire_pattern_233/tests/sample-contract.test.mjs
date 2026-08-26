import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const load = path => readFile(join(sampleRoot, path), "utf8");
const SAMPLE_URL = "https://webgpu-rtx-fire-pattern-233.runtime.threebrowser.local/";
const EXACT_SEED = "p4 + 11c9h 9fwhsa assa dasd sa u923t u3240-9t 0w3";

const EXPECTED_FILES = Object.freeze([
  "README.md",
  "assets/cin-sin-fire-pattern-233.wav",
  "index.html",
  "site-entry.mjs",
  "src/fire-pattern.mjs",
  "src/fire-scene.mjs",
  "src/fire-score.mjs",
  "src/main.mjs",
  "src/native-rtx-renderer.mjs",
  "src/rtx-scene.mjs",
  "tests/fire-pattern.test.mjs",
  "tests/fire-score.test.mjs",
  "tests/sample-contract.test.mjs",
  "threebrowser.pull.json",
  "tools/generate-fire-score.mjs",
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

test("sample is registered as a portable WebGPU/RTX project", async () => {
  const [entry, html, manifestText] = await Promise.all([
    load("site-entry.mjs"),
    load("index.html"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(entry, /globalThis\.__threeBrowserSourceURL/);
  assert.match(entry, /webgpu-rtx-fire-pattern-233\.runtime\.threebrowser\.local/);
  assert.match(entry, /await import\("\.\/src\/main\.mjs"\)/);
  assert.match(html, /<title>RTX Fire Pattern 233 — ThreeBrowser Runtime<\/title>/);
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
  assert.deepEqual(
    manifest.files.map(file => file.path).sort(),
    [...EXPECTED_FILES].sort(),
  );
  assert.deepEqual(await filesBelow(), [...EXPECTED_FILES].sort());
});

test("score and sculpture share the exact seed and 233-address contract", async () => {
  const [score, pattern, readme] = await Promise.all([
    import(`${pathToFileURL(join(sampleRoot, "src", "fire-score.mjs")).href}?contract`),
    import(`${pathToFileURL(join(sampleRoot, "src", "fire-pattern.mjs")).href}?contract`),
    load("README.md"),
  ]);

  assert.equal(score.FIRE_PATTERN_SEED, EXACT_SEED);
  assert.equal(pattern.FIRE_PATTERN_SEED, EXACT_SEED);
  assert.equal(score.FIRE_SCORE_TRACK.title, "CIN/SIN — Pattern of Fire +233");
  assert.equal(score.FIRE_SCORE_TRACK.durationSeconds, 180);
  assert.equal(score.FIRE_SCORE_TRACK.loop, false);
  assert.equal(score.FIRE_SCORE_CUES.length, 233);
  assert.equal(pattern.FIRE_PATTERN_NODE_COUNT, 233);
  assert.equal(pattern.FIRE_PATTERN_NODES.length, 233);
  assert.equal(new Set(score.FIRE_SCORE_CUES.map(cue => cue.cueId)).size, 233);
  assert.equal(new Set(pattern.FIRE_PATTERN_NODES.map(node => node.id)).size, 233);

  assert.match(readme, /CIN\/SIN — Pattern of Fire \+233/);
  assert.ok(readme.includes(EXACT_SEED));
  assert.match(readme, /exactly \*\*3:00 \(180 seconds\)\*\*/);
  assert.match(readme, /does not loop/);
  assert.match(readme, /exactly 233 deterministic fire nodes/);
});

test("main wires score, fire scene, controls and honest hybrid RTX staging", async () => {
  const [main, scene, manifestText] = await Promise.all([
    load("src/main.mjs"),
    load("src/fire-scene.mjs"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /createFireScoreAudioController/);
  assert.match(main, /createFirePatternScene/);
  assert.match(main, /NativeRtxRenderer/);
  assert.match(main, /collectStaticRtxScene/);
  assert.match(main, /navigator\.gpu\?\.threeBrowserRTX/);
  assert.match(main, /renderNative\(/);
  assert.match(main, /renderRaster\(/);
  assert.match(main, /\.present\(\)/);
  assert.match(scene, /FIRE_PATTERN_NODE_COUNT/);

  for (const key of ["m", "p", "c", "x", "r"]) {
    assert.match(main, new RegExp(`key === ["']${key}["']`), `missing ${key.toUpperCase()} control`);
  }
  assert.match(main, /event\.code === ["']Space["']/);
  for (const event of ["pointerdown", "pointermove", "pointerup", "wheel"]) {
    assert.match(main, new RegExp(`["']${event}["']`), `missing ${event} input`);
  }
  assert.match(main, /beforeunload/);

  const notes = manifest.compatibility.notes.join("\n");
  assert.match(notes, /not a full path tracer/i);
  assert.match(notes, /one tone-mapped swapchain presentation/i);
});

test("renderer helpers retain the proven single-presentation native contracts", async () => {
  const [renderer, collector] = await Promise.all([
    load("src/native-rtx-renderer.mjs"),
    load("src/rtx-scene.mjs"),
  ]);
  assert.match(renderer, /export class NativeRtxRenderer/);
  assert.match(renderer, /evaluateRayLighting/);
  assert.match(renderer, /evaluateRayReflections/);
  assert.match(renderer, /environmentColor:\s*frameOptions\.environmentColor/);
  assert.match(renderer, /if \(this\.disposed \|\| !this\.sceneRegistered\)/);
  assert.match(renderer, /renderNative\(scene, camera/);
  assert.match(renderer, /renderRaster\(scene, camera/);
  assert.match(renderer, /present\(\)/);
  assert.match(renderer, /this\.renderer\.render\(this\._displayScene, this\._displayCamera\)/);
  assert.match(collector, /export async function collectStaticRtxScene/);
  assert.match(collector, /new Float32Array\(triangleRadiance\)/);
  assert.match(collector, /new Float32Array\(triangleSurface\)/);
  assert.match(collector, /validateStaticRtxScene\(scene\)/);
});

test("package is complete, local-only and contains no native implementation source", async () => {
  const manifest = JSON.parse(await load("threebrowser.pull.json"));
  for (const file of manifest.files) {
    assert.equal(file.url, new URL(file.path === "index.html" ? "" : file.path, SAMPLE_URL).href);
    assert.ok(!/^(?:https?:)?\/\//i.test(file.path), `remote manifest path: ${file.path}`);
    assert.ok(![".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"].includes(extname(file.path).toLowerCase()));
  }

  const sourceFiles = (await filesBelow()).filter(path =>
    [".mjs", ".json", ".html", ".md"].includes(extname(path).toLowerCase()),
  );
  for (const path of sourceFiles) {
    const source = await load(path);
    assert.doesNotMatch(
      source,
      /https?:\/\/(?!webgpu-rtx-fire-pattern-233\.runtime\.threebrowser\.local)/i,
      `external URL in ${path}`,
    );
  }
});
