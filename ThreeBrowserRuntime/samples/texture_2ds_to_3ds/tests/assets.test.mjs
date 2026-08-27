import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadRgba } from "../src/image-rgba.mjs";
import { keyedViewFromRgba } from "../src/silhouette.mjs";
import { reconstructOrbitAsset, assetReport } from "../src/tree-asset.mjs";
import { mapsHaveDetail } from "../src/unwrap.mjs";
import { ORBIT_VIEWS } from "../src/views.mjs";

test("orbit PNGs decode and key to tree-shaped silhouettes", async () => {
  for (const folder of ["tree", "willow", "trash-can"]) {
    for (const entry of ORBIT_VIEWS) {
      const url = new URL(`../assets/${folder}/${entry.file}`, import.meta.url);
      const image = await loadRgba(url);
      assert.ok(image.width >= 256 && image.height >= 256, `${folder}/${entry.file} is too small`);
      const view = keyedViewFromRgba(image.data, image.width, image.height, entry);
      const filled = view.occupancy.reduce((sum, value) => sum + value, 0);
      const coverage = filled / (image.width * image.height);
      assert.ok(coverage > 0.08 && coverage < 0.72, `${folder}/${entry.file} coverage ${coverage}`);
      assert.ok(view.bounds.maxY >= image.height * 0.72, `${folder}/${entry.file} is not planted`);
      assert.ok(view.bounds.minY < image.height * 0.45, `${folder}/${entry.file} missing canopy`);
    }
  }
});

test("photo reconstruction stitches each grove tree with matching slices", async () => {
  for (const folder of ["tree", "willow", "trash-can"]) {
    const asset = await reconstructOrbitAsset({
      assetRoot: import.meta.url,
      folder,
      resolution: 48,
      silhouetteSize: 96,
      angleResolution: 32,
      mapSize: 64,
    });
    const report = assetReport(asset);
    if (folder === "trash-can") {
      assert.equal(report.generic, true, `${folder} should classify as a generic primitive`);
      assert.equal(report.recommendedCount, 2, `${folder} cylinders use two orthogonal stills`);
      assert.equal(report.kind, "cylinder");
    } else {
      assert.equal(report.generic, false, `${folder} should classify as complex`);
      assert.equal(report.recommendedCount, 8, `${folder} complex shapes use 8 sides`);
    }
    assert.ok(report.filled > 200, `${folder} hull too empty: ${report.filled}`);
    assert.ok(report.meanIoU > 0.5, `${folder} mean slice IoU ${report.meanIoU}`);
    assert.ok(asset.mesh.vertexCount > 80, `${folder} vertices`);
    assert.equal(asset.mesh.uvs.length, asset.mesh.vertexCount * 2);
    assert.ok(mapsHaveDetail(asset.maps), `${folder} bump`);
  }
});
