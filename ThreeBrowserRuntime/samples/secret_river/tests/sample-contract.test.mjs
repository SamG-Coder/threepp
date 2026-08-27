import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

test("sample is self-contained MJS with no native implementation source", async () => {
  const files = await walk(sampleRoot);
  assert.ok(files.some(path => path.endsWith("site-entry.mjs")));
  assert.ok(files.some(path => path.endsWith("src\\main.mjs") || path.endsWith("src/main.mjs")));
  assert.equal(files.some(path => /\.(?:c|cc|cpp|cxx|h|hh|hpp)$/i.test(path)), false);

  const moduleSources = await Promise.all(
    files.filter(path => path.endsWith(".mjs")).map(path => readFile(path, "utf8")),
  );
  assert.doesNotMatch(
    moduleSources.join("\n"),
    /\.(?:c|cc|cpp|cxx|h|hh|hpp)\b/i,
    "sample modules must not reference a native implementation file",
  );
});

test("main walks a face-on riverbank and uses the generic RTX lighting and reflection bridge", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const native = await readFile(join(sampleRoot, "src", "native-rtx-renderer.mjs"), "utf8");
  const trees = await readFile(join(sampleRoot, "src", "trees.mjs"), "utf8");
  const walker = await readFile(join(sampleRoot, "src", "walker.mjs"), "utf8");
  const camera = await readFile(join(sampleRoot, "src", "camera.mjs"), "utf8");

  assert.match(main, /createTreeFlats/);
  assert.match(main, /createWalker/);
  assert.match(main, /createRiver/);
  assert.match(main, /createFaceOnCamera/);
  assert.match(main, /collectStaticRiverScene/);
  assert.match(main, /trees\.hideProxies/);
  assert.match(native, /registerStaticScene/);
  assert.match(native, /evaluateRayLighting/);
  assert.match(native, /evaluateRayReflections/);
  assert.match(native, /compileRayQueryPipeline/);
  assert.match(native, /BANK_LIGHTING_GLSL/);
  assert.match(native, /_evaluateLighting\(frameOptions,\s*layouts\)/);
  assert.doesNotMatch(native, /skipLighting:\s*true/);
  assert.match(main, /skipLighting:\s*false/);
  assert.match(trees, /layoutTrees/);
  assert.match(trees, /PlaneGeometry/);
  assert.match(trees, /rtxIgnore/);
  assert.match(walker, /profile\.jpg/);
  assert.match(walker, /WALK_FRAME_FIRST\s*=\s*8/);
  assert.match(walker, /WALK_FRAME_LAST\s*=\s*30/);
  assert.match(walker, /fixed-registration atlas/);
  assert.match(walker, /gaitFrameFromDistance/);
  assert.doesNotMatch(walker, /texture\.needsUpdate\s*=\s*true[\s\S]*update\(delta, axis\)[\s\S]*texture\.needsUpdate/);
  assert.match(
    camera,
    /Face-on stage camera|side-on cinematic|creek bottom/i,
    "camera comment describes the face-on / side-on creek view",
  );
});

test("main has no HUD and presents exactly one swapchain image per frame", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const imports = [...main.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(
    imports.some(specifier => /(?:^|[-_/])(?:hud|ui)(?:[-_.]|$)/i.test(specifier)),
    false,
    "the canvas-only sample must not import a HUD/UI module",
  );
  assert.doesNotMatch(main, /renderer\.render\(scene,\s*camera\)[\s\S]*nativeRenderer\.present/);
  assert.match(main, /nativeRenderer\.render\(scene,\s*camera/);
  assert.match(main, /nativeRenderer\.renderRaster\(scene,\s*camera\)/);
  assert.match(main, /skipReflections:\s*true/);
  assert.match(main, /nativeRenderer\.present\(null,\s*0\)/);
  assert.match(
    main,
    /if \(!nativeRendered && !offscreenRendered\) \{[\s\S]*?renderer\.render\(scene,\s*camera\);/,
    "direct canvas render is only the emergency fallback",
  );
});

test("photoreal tree photographs are shipped with the sample", async () => {
  const files = await walk(join(sampleRoot, "assets"));
  const { TREE_SPECIES } = await import("../src/tree-layout.mjs");
  const { FLORA_KINDS } = await import("../src/flora-layout.mjs");
  for (const species of TREE_SPECIES) {
    assert.ok(
      files.some(path => path.endsWith(species.file)),
      `missing tree ${species.file}`,
    );
  }
  for (const kind of FLORA_KINDS) {
    assert.ok(
      files.some(path => path.endsWith(kind.file)),
      `missing flora ${kind.file}`,
    );
  }
  assert.ok(files.some(path => path.endsWith("profile.jpg")));
});
