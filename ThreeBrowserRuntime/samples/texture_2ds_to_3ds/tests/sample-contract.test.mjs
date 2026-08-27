import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORBIT_VIEWS } from "../src/views.mjs";

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

test("main reconstructs a photo-consistent tree isosurface and presents one canvas", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const imports = [...main.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);
  assert.equal(
    imports.some(specifier => /(?:^|[-_/])(?:hud|ui)(?:[-_.]|$)/i.test(specifier)),
    false,
    "the canvas-only sample must not import a HUD/UI module",
  );
  assert.match(main, /reconstructOrbitAsset/);
  assert.match(main, /ORBIT_SUBJECTS/);
  assert.match(main, /realWorldScale/);
  assert.match(main, /assetReport/);
  assert.match(main, /MeshBasicMaterial/);
  assert.match(main, /vertexColors:\s*true/);
  assert.match(main, /photo isosurface/);
  assert.match(main, /ORBIT_SUBJECTS/);
  assert.doesNotMatch(main, /TREE_SPECIES/);
  const subjects = await readFile(join(sampleRoot, "src", "tree-asset.mjs"), "utf8");
  assert.match(subjects, /english-oak/);
  assert.match(subjects, /weeping-willow/);
  assert.match(subjects, /steel-trash-can/);
  assert.match(subjects, /realHeight:\s*15/);
  assert.match(subjects, /realHeight:\s*0\.75/);
  assert.match(main, /AnimeTextureRenderer/);
  assert.match(main, /anime\.render\(scene,\s*camera\)/);
  assert.equal((main.match(/\brenderer\.render\(scene,\s*camera\)/g) ?? []).length, 1);
});

test("pipeline modules expose photoconsistent carving, MVS TSDF and a smooth isosurface", async () => {
  const tree = await readFile(join(sampleRoot, "src", "tree-asset.mjs"), "utf8");
  const hull = await readFile(join(sampleRoot, "src", "visual-hull.mjs"), "utf8");
  const photo = await readFile(join(sampleRoot, "src", "photoconsistency.mjs"), "utf8");
  const mvs = await readFile(join(sampleRoot, "src", "mvs-tsdf.mjs"), "utf8");
  const iso = await readFile(join(sampleRoot, "src", "isosurface.mjs"), "utf8");
  const unwrap = await readFile(join(sampleRoot, "src", "unwrap.mjs"), "utf8");
  assert.match(tree, /ORBIT_SUBJECTS/);
  assert.match(tree, /classifyOrbitShape/);
  assert.match(tree, /pickViewsForShape/);
  assert.match(tree, /snapOccupancyToPrimitive/);
  assert.match(tree, /chooseOrbitAngles/);
  assert.match(tree, /carveVisualHull/);
  assert.match(tree, /carvePhotoconsistent/);
  assert.match(tree, /estimateDepthMaps/);
  assert.match(tree, /extractIsosurface/);
  assert.match(tree, /hollowCanopy/);
  assert.match(tree, /estimateCanopyStart/);
  assert.match(tree, /bakeMaterialMaps/);
  assert.match(hull, /keepGroundConnected/);
  assert.match(photo, /buildViewFronts/);
  assert.match(mvs, /chamferSignedDistance/);
  assert.match(mvs, /fuseDepthMaps/);
  assert.match(iso, /marchingTetrahedra/);
  assert.match(iso, /laplacianSmooth/);
  assert.match(iso, /projectVertexColors/);
  assert.match(unwrap, /bumpBytes/);
  assert.match(unwrap, /normalBytes/);
  assert.match(unwrap, /cylinderUv/);
  assert.match(unwrap, /capsuleUv/);
  assert.match(unwrap, /boxUv/);
  assert.match(unwrap, /customUv/);
  assert.match(unwrap, /wrapUv/);
});

test("eight orbit stills are shipped for each reconstructed tree", async () => {
  const files = await walk(join(sampleRoot, "assets"));
  for (const folder of ["tree", "willow", "trash-can"]) {
    for (const view of ORBIT_VIEWS) {
      assert.ok(
        files.some(path => path.includes(folder) && path.endsWith(view.file)),
        `missing ${folder}/${view.file}`,
      );
    }
  }
});
