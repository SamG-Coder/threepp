import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as THREE from "three/webgpu";

import { createFloodEffects } from "../src/effects.mjs";
import FlashFloodModel from "../src/fluid-model.mjs";
import {
  GORGE_BOUNDS,
  bedHeight,
  channelCenterX,
  channelHalfWidth,
  createGorgeEnvironment,
  gorgeHeight,
} from "../src/gorge.mjs";
import { collectStaticRtxScene } from "../src/rtx-scene.mjs";
import {
  SURFACE_TEXTURE_FAMILIES,
  disposeSurfaceTextureCache,
  getSurfaceTextureSet,
  getSurfaceTextureStats,
} from "../src/surface-textures.mjs";
import { createFlashFloodWater } from "../src/water.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

function sourceBlock(source, signature, label) {
  const match = signature.exec(source);
  assert.ok(match, `expected ${label}`);
  const openingBrace = source.indexOf("{", match.index);
  assert.ok(openingBrace >= 0, `expected a body for ${label}`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; ++index) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(match.index, index + 1);
    }
  }
  assert.fail(`unterminated body for ${label}`);
}

function semanticNames(root) {
  const names = [];
  root.traverse(object => {
    for (const value of [object.name, object.geometry?.name, object.material?.name]) {
      if (value) names.push(String(value).toLowerCase());
    }
  });
  return names.join("\n");
}

test("sample is MJS-only implementation with no native or shader source additions", async () => {
  const files = await walk(sampleRoot);
  const paths = files.map(path => relative(sampleRoot, path).replaceAll("\\", "/"));
  const forbiddenExtensions = new Set([
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp",
    ".wgsl", ".glsl", ".vert", ".frag", ".comp", ".spv", ".hlsl",
  ]);
  assert.equal(
    paths.some(path => forbiddenExtensions.has(extname(path).toLowerCase())),
    false,
    `sample contains a forbidden native/shader file: ${paths.join(", ")}`,
  );
  assert.ok(paths.includes("site-entry.mjs"));
  assert.ok(paths.includes("src/main.mjs"));
  assert.ok(paths.includes("src/fluid-model.mjs"));
  assert.ok(paths.includes("src/native-rtx-water.mjs"));

  const modules = await Promise.all(
    files.filter(path => extname(path).toLowerCase() === ".mjs").map(path => readFile(path, "utf8")),
  );
  assert.doesNotMatch(
    modules.join("\n"),
    /["'][^"']+\.(?:c|cc|cpp|cxx|h|hh|hpp|wgsl|glsl|vert|frag|comp|spv|hlsl)["']/i,
    "MJS implementation must not load native or standalone shader source",
  );
});

test("manifest lists every runtime entry and declares a canvas-only no-overlay sample", async () => {
  const manifest = JSON.parse(await readFile(join(sampleRoot, "threebrowser.pull.json"), "utf8"));
  assert.equal(manifest.format, 2);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.html, "index.html");
  assert.equal(manifest.requiresWebGPU, true);
  assert.equal(manifest.compatibility?.canvasOnly, true);
  assert.equal(manifest.compatibility?.htmlOverlay, false);
  assert.equal(manifest.compatibility?.domRequired, false);

  const expected = [
    "index.html",
    "site-entry.mjs",
    "src/main.mjs",
    "src/gorge.mjs",
    "src/surface-textures.mjs",
    "src/atmosphere.mjs",
    "src/fluid-model.mjs",
    "src/water.mjs",
    "src/effects.mjs",
    "src/rtx-scene.mjs",
    "src/native-rtx-water.mjs",
  ];
  const listed = manifest.files.map(file => file.path);
  assert.equal(new Set(listed).size, listed.length, "manifest paths must be unique");
  for (const path of expected) {
    assert.ok(listed.includes(path), `manifest must include ${path}`);
    await access(join(sampleRoot, ...path.split("/")));
  }
  const entry = await readFile(join(sampleRoot, manifest.entry), "utf8");
  assert.match(entry, /await\s+import\(["']\.\/src\/main\.mjs["']\)/);
});

test("HTML and modules contain no HUD, overlay, controls, or telemetry UI", async () => {
  const files = await walk(sampleRoot);
  const html = await readFile(join(sampleRoot, "index.html"), "utf8");
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const modulePaths = files
    .filter(path => path.endsWith(".mjs"))
    .map(path => relative(sampleRoot, path).replaceAll("\\", "/"));
  const imports = [...main.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);

  assert.equal(
    modulePaths.some(path => /(?:^|\/)(?:hud|ui|overlay)(?:[-_.]|\/|$)/i.test(path)),
    false,
  );
  assert.equal(
    imports.some(path => /(?:^|[-_/])(?:hud|ui|overlay|gui)(?:[-_.]|$)/i.test(path)),
    false,
  );
  assert.doesNotMatch(
    html,
    /<(?:div|aside|section|header|footer|button|input|output|label|meter|progress|dialog)\b/i,
  );
  assert.doesNotMatch(html, /position\s*:\s*(?:fixed|absolute)/i);
  assert.doesNotMatch(
    main,
    /document\.createElement\(\s*["'](?:div|aside|section|button|input|output)["']\s*\)/i,
    "main must not build overlay UI",
  );
  assert.ok(
    (main.match(/document\.createElement\(\s*["']canvas["']\s*\)/gi) ?? []).length <= 1,
    "the sample may own at most its single renderer canvas",
  );
  assert.doesNotMatch(main, /\b(?:create|render|update)\w*(?:Hud|HUD|Ui|UI|Overlay|Telemetry)\s*\(/);
});

test("all map sections have deterministic shared PBR texture triplets", () => {
  disposeSurfaceTextureCache();
  const families = [...new Set(Object.values(SURFACE_TEXTURE_FAMILIES))];
  assert.equal(families.length, 10);
  try {
    for (const family of families) {
      const set = getSurfaceTextureSet(family);
      assert.equal(getSurfaceTextureSet(family), set, `${family} must reuse its cached triplet`);
      assert.equal(set.size, 256);
      assert.equal(set.byteLength, 256 * 256 * 4 * 3);
      for (const map of [set.albedo, set.roughness, set.normal]) {
        assert.equal(map.isDataTexture, true);
        assert.equal(map.image.width, 256);
        assert.equal(map.image.height, 256);
        assert.equal(map.wrapS, THREE.RepeatWrapping);
        assert.equal(map.wrapT, THREE.RepeatWrapping);
        assert.equal(map.generateMipmaps, true);
      }
      assert.equal(set.albedo.colorSpace, THREE.SRGBColorSpace);
      assert.equal(set.roughness.colorSpace, THREE.NoColorSpace);
      assert.equal(set.normal.colorSpace, THREE.NoColorSpace);
    }
    const stats = getSurfaceTextureStats();
    assert.equal(stats.cachedFamilies, 10);
    assert.equal(stats.cachedTextures, 30);
    assert.equal(stats.byteLength, 10 * 256 * 256 * 4 * 3);
  } finally {
    assert.equal(disposeSurfaceTextureCache(), 30);
  }
  assert.equal(getSurfaceTextureStats().cachedTextures, 0);
});

test("the gorge has landscape scale and recognizable spillway and bridge landmarks", () => {
  const gorge = createGorgeEnvironment();
  try {
    const stats = gorge.getStats();
    assert.ok(GORGE_BOUNDS.length >= 900);
    assert.ok(GORGE_BOUNDS.width >= 600);
    assert.equal(GORGE_BOUNDS.maxZ - GORGE_BOUNDS.minZ, GORGE_BOUNDS.length);
    assert.equal(stats.reachLengthMetres, GORGE_BOUNDS.length);
    assert.equal(stats.spillwayBays, 3);
    assert.ok(stats.bridgeSpanMetres >= 90);
    assert.ok(stats.staticTriangles >= 200_000 && stats.staticTriangles < 400_000, stats);
    assert.ok(stats.terrainTriangles >= 100_000);
    assert.ok(stats.cliffLedges >= 150);
    assert.ok(stats.dryBoulders + stats.wetBoulders >= 400);
    assert.ok(stats.trees >= 80 && stats.canopyClusters >= stats.trees * 3);
    assert.ok(stats.strandedLogs >= 50);
    assert.equal(stats.surfaceTextureFamilies, 9);
    assert.equal(stats.surfaceTextureMaps, 27);
    assert.equal(stats.surfaceTextureBytes, 9 * 256 * 256 * 4 * 3);
    assert.ok(gorge.rtxRoots.length >= 16);
    assert.ok(gorge.rtxRoots.every(root => root.userData?.rtxIgnore !== true));

    for (const landmark of [gorge.landmarks.spillway, gorge.landmarks.bridge]) {
      assert.ok([landmark.x, landmark.y, landmark.z].every(Number.isFinite));
      assert.ok(landmark.z >= GORGE_BOUNDS.minZ && landmark.z <= GORGE_BOUNDS.maxZ);
    }
    assert.ok(
      gorge.landmarks.bridge.z - gorge.landmarks.spillway.z >= 650,
      "landmarks must establish the scale of most of the authored reach",
    );

    const names = semanticNames(gorge.group);
    for (const feature of ["spillway", "bridge", "boulder", "cliff", "tree", "shrub", "log"]) {
      assert.match(names, new RegExp(feature), `gorge must visibly include ${feature}`);
    }

    const mappedMaterials = new Set();
    gorge.group.traverse(object => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material?.map && material?.roughnessMap && material?.normalMap) {
          mappedMaterials.add(material);
          assert.equal(material.rtxUsesResolvedPbr, 1);
          assert.ok(material.userData.surfaceTextureFamily);
        }
      }
    });
    assert.ok(mappedMaterials.size >= 14, `expected mapped terrain assets, got ${mappedMaterials.size}`);
    assert.equal(gorge.terrain.material.rtxUsesResolvedPbr, 1);
    assert.equal(gorge.terrain.material.userData.surfaceTextureFamily, "dryGorge+wetChannelRock");

    for (const z of [-640, -440, -220, 0, 260]) {
      const center = channelCenterX(z);
      const halfWidth = channelHalfWidth(z);
      const bed = bedHeight(center, z);
      assert.ok(Number.isFinite(bed) && halfWidth >= 10 && halfWidth <= 42);
      assert.ok(gorgeHeight(center - 120, z) > bed + 30);
      assert.ok(gorgeHeight(center + 120, z) > bed + 30);
    }
  } finally {
    gorge.dispose();
  }
});

test("moving water and effects cannot enter the static RTX triangle collection", async () => {
  const model = new FlashFloodModel({
    width: 7,
    height: 10,
    cellSize: 2,
    fixedStepSeconds: 0.05,
    bed: ({ gridX, gridZ }) => Math.pow(Math.abs(gridX - 3) / 3, 4) * 5 - gridZ * 0.06,
    gateWidthCells: 3,
    gateStartSeconds: 0,
    gateRiseSeconds: 1,
    gatePeakDischarge: 20,
  });
  const sampleBed = (x, z) => model.sample(x, z)?.bed ?? 0;
  const water = createFlashFloodWater({ model, bedHeight: sampleBed });
  const effects = createFloodEffects({
    model,
    bedHeight: sampleBed,
    channelCenterX: () => 0,
    channelHalfWidth: () => 6,
  });
  const markerGeometry = new THREE.BoxGeometry(2, 2, 2);
  const markerMaterial = new THREE.MeshStandardMaterial({ color: 0x777777 });
  const staticMarker = new THREE.Mesh(markerGeometry, markerMaterial);
  staticMarker.name = "Static RTX inclusion control";
  try {
    model.advance(4);
    water.update(4);
    effects.update(4, 0.05);
    assert.equal(water.surface.userData.rtxIgnore, true);
    assert.equal(water.material.userData.rtxIgnore, true);
    effects.group.traverse(object => {
      if (object.isMesh || object.isPoints || object.isInstancedMesh) {
        assert.equal(object.userData.rtxIgnore, true, `${object.name} must be marked dynamic`);
      }
    });

    const staticOnly = await collectStaticRtxScene(staticMarker, { maxTriangles: 1_000 });
    const mixed = await collectStaticRtxScene(
      [staticMarker, water.surface, effects.group],
      { maxTriangles: 10_000 },
    );
    assert.equal(staticOnly.triangleCount, 12);
    assert.equal(mixed.triangleCount, staticOnly.triangleCount);
    assert.equal(mixed.sourceMeshCount, staticOnly.sourceMeshCount);
    assert.equal(mixed.sourceInstanceCount, staticOnly.sourceInstanceCount);
    assert.ok(mixed.skipped.ignoredOrHidden >= effects.group.children.length + 1);
  } finally {
    effects.dispose();
    water.dispose();
    markerGeometry.dispose();
    markerMaterial.dispose();
  }
});

test("native and raster stages are mutually exclusive and feed exactly one presentation", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const native = await readFile(join(sampleRoot, "src", "native-rtx-water.mjs"), "utf8");
  const present = sourceBlock(native, /\bpresent\s*\(\s*\)\s*\{/, "present()");
  const offscreen = sourceBlock(
    native,
    /\b_renderLinearScene\s*\([^)]*\)\s*\{/,
    "_renderLinearScene()",
  );

  assert.equal((main.match(/\bnativeRenderer\.renderNative\s*\(/g) ?? []).length, 1);
  assert.equal((main.match(/\bnativeRenderer\.renderRaster\s*\(/g) ?? []).length, 1);
  assert.equal((main.match(/\bnativeRenderer\.present\s*\(/g) ?? []).length, 1);
  assert.match(main, /let\s+staged\s*=\s*false\s*;/);
  assert.match(
    main,
    /if\s*\(\s*nativeConfigured\s*&&\s*!\s*state\.forceRaster\s*\)\s*\{\s*staged\s*=\s*nativeRenderer\.renderNative\s*\(/,
  );
  assert.match(
    main,
    /if\s*\(\s*!\s*staged\s*\)\s*staged\s*=\s*nativeRenderer\.renderRaster\s*\(/,
    "raster staging must be the mutually exclusive fallback",
  );
  assert.match(
    main,
    /if\s*\(\s*staged\s*\)\s*\{\s*if\s*\(\s*!\s*nativeRenderer\.present\s*\(\s*\)\s*\)\s*\{/,
    "the sole presentation must be guarded by a completed offscreen stage",
  );
  const nativeStageIndex = main.indexOf("nativeRenderer.renderNative");
  const rasterStageIndex = main.indexOf("nativeRenderer.renderRaster");
  const presentIndex = main.indexOf("nativeRenderer.present");
  assert.ok(
    nativeStageIndex >= 0 && nativeStageIndex < rasterStageIndex && rasterStageIndex < presentIndex,
    "native attempt, raster fallback, and presentation must occur in that order",
  );

  assert.match(offscreen, /setRenderTarget\(target\)[\s\S]*?\.clear\([^)]*\)[\s\S]*?\.render\(scene,\s*camera\)/);
  assert.equal((present.match(/this\.renderer\.render\s*\(/g) ?? []).length, 1);
  assert.match(present, /setRenderTarget\(null\)[\s\S]*?autoClear\s*=\s*true[\s\S]*?\.render\(this\._displayScene,\s*this\._displayCamera\)/);
  assert.doesNotMatch(present, /\.clear\s*\(/, "the default target must not be cleared directly");
  assert.doesNotMatch(main, /\brenderer\.clear\s*\(/, "main must not clear the swapchain target");
  assert.doesNotMatch(
    main,
    /\brenderer\.setRenderTarget\(null\)[\s\S]{0,180}?\brenderer\.(?:clear|render)\s*\(/,
    "main must leave default-target presentation to NativeRtxWaterRenderer.present()",
  );
  assert.equal(
    (native.match(/this\.renderer\.clear\s*\(/g) ?? []).length,
    1,
    "the sole explicit clear must belong to the offscreen helper",
  );
});
