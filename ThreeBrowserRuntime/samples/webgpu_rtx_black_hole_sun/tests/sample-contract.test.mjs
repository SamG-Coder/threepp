import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const load = path => readFile(join(root, path), "utf8");

async function filesBelow(path = root) {
  const output = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(absolute));
    else output.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return output.sort();
}

test("sample is a portable WebGPU tidal-disruption entry", async () => {
  const [entry, main, manifestText] = await Promise.all([
    load("site-entry.mjs"),
    load("src/main.mjs"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(entry, /webgpu-rtx-black-hole-sun\.runtime\.threebrowser\.local/);
  assert.match(entry, /import\("\.\/src\/main\.mjs"\)/);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.requiresWebGPU, true);
  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /renderer\.setDrawingBufferSize\(width, height, pixelRatio\)/);
  assert.match(main, /createTidalDisruptionScene/);
  assert.match(main, /createSchwarzschildLensingNode/);
  assert.match(main, /bloom\(lensing\.output/);
});

test("one coherent physical model owns orbit, disruption, landmarks and observed shifts", async () => {
  const [model, scene, lensing, materials] = await Promise.all([
    load("src/relativity-model.mjs"),
    load("src/cosmic-scene.mjs"),
    load("src/lensing.mjs"),
    load("src/celestial-materials.mjs"),
  ]);
  assert.match(model, /buildCaptureTrajectory/);
  assert.match(model, /angularMomentumM = 3\.98/);
  assert.match(model, /shadowRadiusM: 3 \* Math\.sqrt\(3\)/);
  assert.match(model, /Math\.pow\(system\.tidalRadiusM \/ rM, 3\)/);
  assert.match(scene, /disruptionEnvelope\(sample\.rM, system\)/);
  assert.match(scene, /relativisticDopplerFactor/);
  assert.match(lensing, /CRITICAL_IMPACT_M = 3 \* Math\.sqrt\(3\)/);
  assert.match(lensing, /STRONG_DEFLECTION_CONSTANT/);
  assert.match(materials, /zeroTorque/);
  assert.match(materials, /beaming/);
});

test("controls expose cinematic/manual composition and scientific comparison", async () => {
  const main = await load("src/main.mjs");
  assert.match(main, /pointerdown/);
  assert.match(main, /state\.azimuthTarget -= dx/);
  for (const key of ["a", "r", "t", "x", "m", "h"]) {
    assert.match(main, new RegExp(`key === "${key}"`));
  }
  assert.match(main, /event\.code === "Space"/);
  assert.match(main, /state\.lensing = !state\.lensing/);
  assert.match(main, /presets = \[/);
});

test("native WAV sonification is local, gesture-controlled and model-generated", async () => {
  const [main, audio, generator, readme] = await Promise.all([
    load("src/main.mjs"),
    load("src/tidal-audio.mjs"),
    load("scripts/generate-tidal-score.mjs"),
    load("README.md"),
  ]);
  assert.match(main, /createTidalAudioController/);
  assert.match(main, /key === "m"/);
  assert.match(audio, /new URL\("\.\.\/assets\/tidal-rupture-score\.wav"/);
  assert.doesNotMatch(audio + main, /AudioContext|createOscillator|createAnalyser/);
  assert.match(generator, /buildCaptureTrajectory/);
  assert.match(generator, /disruptionEnvelope/);
  assert.match(generator, /gravitationalRedshift/);
  assert.match(readme, /scientific sonification/i);
});

test("RTX status is truthful and unsupported adaptive features remain off", async () => {
  const [main, readme] = await Promise.all([load("src/main.mjs"), load("README.md")]);
  assert.match(main, /reflex: "boost"/);
  assert.match(main, /dlssSuperResolution: false/);
  assert.match(main, /dlssFrameGeneration: false/);
  assert.match(main, /dlssRayReconstruction: false/);
  assert.match(main, /reflex\?\.configured \|\| reflex\?\.active/);
  assert.match(readme, /not requested/i);
});

test("each animation tick has exactly one final swap-chain render path", async () => {
  const [main, readme] = await Promise.all([load("src/main.mjs"), load("README.md")]);
  const renderFrame = main.slice(
    main.indexOf("function renderFrame()"),
    main.indexOf("let previousTime", main.indexOf("function renderFrame()")),
  );
  assert.doesNotMatch(renderFrame, /renderer\.clear\s*\(/);
  assert.equal((renderFrame.match(/renderPipeline\.render\(\)/g) ?? []).length, 1);
  assert.equal((renderFrame.match(/renderer\.render\(scene, camera\)/g) ?? []).length, 1);
  assert.match(renderFrame, /renderPipeline\.render\(\);[\s\S]*return;[\s\S]*renderer\.render\(scene, camera\)/);
  assert.match(renderFrame, /catch \(error\)[\s\S]*renderer\.setAnimationLoop\(null\)/);
  assert.doesNotMatch(main, /renderer\.render\(hud/);
  assert.match(readme, /Exactly one swap-chain presentation per animation tick/);
});

test("manifest is complete, local-only and ships no native source", async () => {
  const manifest = JSON.parse(await load("threebrowser.pull.json"));
  const declared = new Set(manifest.files.map(file => file.path));
  for (const path of await filesBelow()) {
    assert.ok(declared.has(path), `${path} is missing from manifest`);
  }
  for (const file of manifest.files) {
    assert.ok(!/^(https?:)?\/\//i.test(file.path), `remote manifest path: ${file.path}`);
    assert.ok(![".cpp", ".cc", ".cxx", ".h", ".hpp"].includes(extname(file.path).toLowerCase()));
  }
  for (const path of await filesBelow()) {
    if (![".mjs", ".json", ".html", ".md"].includes(extname(path).toLowerCase())) continue;
    const source = await load(path);
    assert.doesNotMatch(source, /https?:\/\/(?!webgpu-rtx-black-hole-sun\.runtime\.threebrowser\.local)/i);
  }
});
