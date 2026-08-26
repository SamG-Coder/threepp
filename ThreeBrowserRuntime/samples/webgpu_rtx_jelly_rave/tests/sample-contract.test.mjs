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

test("sample is a separate portable WebGPU/RTX rave entry", async () => {
  const [entry, main, manifestText] = await Promise.all([
    load("site-entry.mjs"),
    load("src/main.mjs"),
    load("threebrowser.pull.json"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(entry, /webgpu-rtx-jelly-rave\.runtime\.threebrowser\.local/);
  assert.match(entry, /import\("\.\/src\/main\.mjs"\)/);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.requiresWebGPU, true);
  assert.match(main, /new THREE\.WebGPURenderer/);
  assert.match(main, /createJellyRaveScene\(scene\)/);
  assert.match(main, /createJellyPhysics\(/);
  assert.match(main, /createRaveAudioController\(\)/);
  assert.match(main, /createJellyDynamicRayMesh\(rave\.jellies/);
});

test("native path uses stable high-quality reflections and a refitted moving BLAS", async () => {
  const [main, renderer, rtxMesh] = await Promise.all([
    load("src/main.mjs"),
    load("src/native-rtx-renderer.mjs"),
    load("src/jelly-rtx-mesh.mjs"),
  ]);
  assert.match(main, /collectStaticRtxScene\(rave\.staticMeshes/);
  assert.match(main, /dynamicBridgeUsable \? dynamicJellies\.descriptor : null/);
  assert.match(main, /nativeRenderer\.updateDynamicTriangleMesh\(\)/);
  assert.match(main, /aoSampleCount: 12/);
  assert.match(main, /reflectionStrength: 1\.34/);
  assert.match(renderer, /temporalJitter: false/);
  assert.match(renderer, /frameIndex: 0/);
  assert.match(renderer, /refitDynamicTriangleMesh/);
  assert.match(renderer, /_displayMaterialCache = new Map\(\)/);
  assert.match(rtxMesh, /one refittable RTX triangle stream/);
  assert.match(rtxMesh, /mesh\.userData\.rtxIgnore = true/);
});

test("native RTX augments the exact transparent raster without presenting guide color", async () => {
  const renderer = await load("src/native-rtx-renderer.mjs");
  assert.match(renderer, /target\.texture\.isStorageTexture = true/);
  assert.match(renderer, /get\?\.\(exactRasterTarget\.texture\)\?\.texture/);
  assert.match(renderer, /sourceColor:\s*makeResource\(sourceColor/);
  assert.match(renderer, /this\._renderLinearScene\(scene, camera, exactRasterTarget\)/);
  assert.match(renderer, /this\._activeTexture = exactRasterTarget\.texture/);
  assert.doesNotMatch(renderer, /this\._activeTexture = this\.sceneTarget\.textures\[0\]/);
  assert.match(renderer, /environmentColor: frameOptions\.environmentColor \?\? DEFAULT_ENVIRONMENT_COLOR/);
  assert.match(renderer, /environmentIntensity: Math\.max\(0, finite\(frameOptions\.environmentIntensity, 0\.18\)\)/);
  assert.doesNotMatch(renderer, /environmentColor: BLACK_ENVIRONMENT/);

  const exactRaster = renderer.indexOf("this._renderLinearScene(scene, camera, exactRasterTarget)");
  const guideSwap = renderer.indexOf("this._applyNativeGuideMaterials(scene)", exactRaster);
  const guideRaster = renderer.indexOf("this.sceneTarget,", guideSwap);
  const rayEffects = renderer.indexOf("this._evaluateNativeEffects(frameOptions)", guideRaster);
  assert.ok(exactRaster >= 0 && exactRaster < guideSwap && guideSwap < guideRaster && guideRaster < rayEffects);

  assert.match(renderer, /submitBuffers\.push\(lightingBuffer\)/);
  assert.match(renderer, /submitBuffers\.push\(reflectionBuffer\)/);
  assert.match(renderer, /this\.device\.queue\.submit\(submitBuffers\)/);
});

test("warehouse, DJ and jelly rendering are authored geometry rather than downloaded assets", async () => {
  const scene = await load("src/jelly-scene.mjs");
  for (const phrase of [
    "Continuous polished epoxy dance floor",
    "Massive original gelatinous humanoid DJ",
    "Monumental broad gelatinous DJ belly and torso",
    "Distinct glossy gummy DJ head",
    "Wide liquid-chrome gummy DJ visor",
    "Mirror chrome DJ platter",
    "Reactive high-density LED wall pixel",
    "Audio-reactive narrow-beam stage spotlight",
    "Dancing translucent jelly crowd",
    "Thick refractive organic jelly membrane",
    "Coherent laser core",
  ]) assert.match(scene, new RegExp(phrase));
  assert.match(scene, /transmission: 0\.34/);
  assert.match(scene, /clearcoat: 0\.72/);
  assert.match(scene, /gummyDjMaterial\.transmission = 0/);
  assert.match(scene, /gummyDjMaterial\.transparent = false/);
  assert.match(scene, /material\.rtxPreserveTransparency = 1/);
  assert.match(scene, /jellyLayout = \[/);
  assert.match(scene, /applyBody\(body\)/);
  assert.match(scene, /updateReactiveLighting/);
});

test("controls expose orbit, shockwave, drop, music, color and RTX comparison", async () => {
  const main = await load("src/main.mjs");
  assert.match(main, /pointerdown/);
  assert.match(main, /state\.targetAzimuth -= dx/);
  assert.match(main, /function fireShockwave/);
  assert.match(main, /event\.code === "Space"/);
  for (const key of ["m", "x", "c", "r"]) {
    assert.match(main, new RegExp(`key === "${key}"`));
  }
  assert.match(main, /CAMERA_MAX_DISTANCE = 38/);
});

test("manifest is complete, local-only and ships no native source", async () => {
  const manifest = JSON.parse(await load("threebrowser.pull.json"));
  const declared = new Set(manifest.files.map(file => file.path));
  for (const path of await filesBelow()) {
    if (path.startsWith("tests/")) continue;
    assert.ok(declared.has(path), `${path} is missing from manifest`);
  }
  for (const file of manifest.files) {
    assert.ok(!/^(https?:)?\/\//i.test(file.path), `remote manifest path: ${file.path}`);
    assert.ok(![".cpp", ".cc", ".cxx", ".h", ".hpp"].includes(extname(file.path).toLowerCase()));
  }
  const sourceFiles = (await filesBelow()).filter(path =>
    [".mjs", ".json", ".html", ".md"].includes(extname(path).toLowerCase()),
  );
  for (const path of sourceFiles) {
    const source = await load(path);
    assert.doesNotMatch(source, /https?:\/\/(?![a-z0-9-]+\.runtime\.threebrowser\.local)/i);
  }
});
