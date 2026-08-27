import assert from "node:assert/strict";
import test from "node:test";
import { chooseOrbitAngles } from "../src/angles.mjs";
import { realWorldScale } from "../src/real-scale.mjs";
import { classifyOrbitShape } from "../src/shape.mjs";
import { capsuleUv, cylinderUv, wrapUv } from "../src/unwrap.mjs";
import { bakeVoxelColors, voxelRgb } from "../src/color-bake.mjs";
import { greedyMesh } from "../src/greedy-mesh.mjs";
import { axisAlignedNormalRatio } from "../src/isosurface.mjs";
import { keyedViewFromRgba } from "../src/silhouette.mjs";
import { reconstructFromViews } from "../src/tree-asset.mjs";
import { matchAllSlices } from "../src/slice-match.mjs";
import { bakeMaterialMaps, mapsHaveDetail } from "../src/unwrap.mjs";
import { snapOccupancyToPrimitive } from "../src/primitive-fit.mjs";
import { cameraBasis, equallySpacedSubset, pickViewsForShape, unprojectView } from "../src/views.mjs";
import { carveVisualHull, voxelIndex } from "../src/visual-hull.mjs";

function fillMagenta(data) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 220;
    data[i + 1] = 18;
    data[i + 2] = 168;
    data[i + 3] = 255;
  }
}

function insideTree(x, y, z) {
  if (y >= 0 && y <= 0.62 && (x * x + z * z) <= 0.07 * 0.07) return "trunk";
  const cx = x / 0.36;
  const cy = (y - 0.72) / 0.27;
  const cz = z / 0.36;
  if (cx * cx + cy * cy + cz * cz <= 1 && y > 0.44) return "leaf";
  if (Math.abs(y - 0.38) < 0.045 && z * z < 0.035 * 0.035 && x <= -0.06 && x >= -0.32) {
    return "stub";
  }
  return null;
}

function renderSyntheticView(width, height, yaw) {
  const data = new Uint8ClampedArray(width * height * 4);
  fillMagenta(data);
  const basis = cameraBasis(yaw);
  const worldPerPixel = 1 / (height * 0.86);
  const trunkX = width * 0.5;
  const bottom = height * 0.92;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const camX = (px - trunkX) * worldPerPixel;
      const y = (bottom - py) * worldPerPixel;
      if (y < -0.02 || y > 1.08) continue;
      for (let depth = -0.55; depth <= 0.55; depth += 0.018) {
        const world = unprojectView(camX, y, depth, basis);
        const kind = insideTree(world.x, world.y, world.z);
        if (!kind) continue;
        const index = (py * width + px) * 4;
        if (kind === "leaf") {
          data[index] = 42;
          data[index + 1] = 118;
          data[index + 2] = 40;
        } else if (kind === "stub") {
          data[index] = 168;
          data[index + 1] = 148;
          data[index + 2] = 112;
        } else {
          data[index] = 98;
          data[index + 1] = 74;
          data[index + 2] = 50;
        }
        break;
      }
    }
  }
  return keyedViewFromRgba(data, width, height, {
    yaw,
    file: `yaw-${String(yaw).padStart(3, "0")}.png`,
    label: `${yaw}`,
  });
}

function syntheticViews() {
  return [0, 45, 90, 135, 180, 225, 270, 315].map(yaw => renderSyntheticView(96, 96, yaw));
}

function renderSyntheticCylinder(width, height, yaw) {
  const data = new Uint8ClampedArray(width * height * 4);
  fillMagenta(data);
  const basis = cameraBasis(yaw);
  const worldPerPixel = 1 / (height * 0.86);
  const trunkX = width * 0.5;
  const bottom = height * 0.92;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const camX = (px - trunkX) * worldPerPixel;
      const y = (bottom - py) * worldPerPixel;
      if (y < 0 || y > 1.02) continue;
      for (let depth = -0.3; depth <= 0.3; depth += 0.02) {
        const world = unprojectView(camX, y, depth, basis);
        if (world.x * world.x + world.z * world.z > 0.22 * 0.22) continue;
        const index = (py * width + px) * 4;
        data[index] = 160;
        data[index + 1] = 160;
        data[index + 2] = 168;
        break;
      }
    }
  }
  return keyedViewFromRgba(data, width, height, {
    yaw,
    file: `yaw-${String(yaw).padStart(3, "0")}.png`,
    label: `${yaw}`,
  });
}

function syntheticCylinderViews() {
  return [0, 45, 90, 135, 180, 225, 270, 315].map(yaw => renderSyntheticCylinder(96, 96, yaw));
}

function renderSyntheticSolid(width, height, yaw, inside, rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  fillMagenta(data);
  const basis = cameraBasis(yaw);
  const worldPerPixel = 1 / (height * 0.86);
  const trunkX = width * 0.5;
  const bottom = height * 0.92;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const camX = (px - trunkX) * worldPerPixel;
      const y = (bottom - py) * worldPerPixel;
      if (y < -0.02 || y > 1.08) continue;
      for (let depth = -0.55; depth <= 0.55; depth += 0.02) {
        const world = unprojectView(camX, y, depth, basis);
        if (!inside(world.x, world.y, world.z)) continue;
        const index = (py * width + px) * 4;
        data[index] = rgb[0];
        data[index + 1] = rgb[1];
        data[index + 2] = rgb[2];
        break;
      }
    }
  }
  return keyedViewFromRgba(data, width, height, {
    yaw,
    file: `yaw-${String(yaw).padStart(3, "0")}.png`,
    label: `${yaw}`,
  });
}

function syntheticCapsuleViews() {
  const r = 0.18;
  return [0, 45, 90, 135, 180, 225, 270, 315].map(yaw => renderSyntheticSolid(96, 96, yaw, (x, y, z) => {
    if (y < r) return x * x + (y - r) * (y - r) + z * z <= r * r;
    if (y > 1 - r) return x * x + (y - (1 - r)) * (y - (1 - r)) + z * z <= r * r;
    return y >= r && y <= 1 - r && x * x + z * z <= r * r;
  }, [180, 90, 70]));
}

function syntheticRectangleViews() {
  return [0, 45, 90, 135, 180, 225, 270, 315].map(yaw => renderSyntheticSolid(
    96,
    96,
    yaw,
    (x, y, z) => Math.abs(x) <= 0.38 && Math.abs(z) <= 0.16 && y >= 0 && y <= 1,
    [70, 90, 160],
  ));
}

test("synthetic orbit stills key to planted silhouettes", () => {
  const views = syntheticViews();
  for (const view of views) {
    const filled = view.occupancy.reduce((sum, value) => sum + value, 0);
    assert.ok(filled > 200, `yaw ${view.yaw} silhouette too empty`);
    assert.ok(view.bounds.maxY >= view.height * 0.8, `yaw ${view.yaw} is not planted at the bottom`);
    assert.ok(view.bounds.minY < view.height * 0.35, `yaw ${view.yaw} has no canopy`);
  }
});

test("visual hull from 8 consistent views recovers a planted tree", () => {
  const views = syntheticViews();
  const volume = carveVisualHull(views, { resolution: 40 });
  assert.ok(volume.filled > 400, `expected a dense hull, got ${volume.filled}`);
  assert.ok(volume.filled < volume.occupancy.length * 0.35, "hull should be tighter than the bounding box");

  let ground = 0;
  const resolution = volume.resolution;
  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      if (volume.occupancy[x + z * resolution * resolution]) ground += 1;
    }
  }
  assert.ok(ground > 8, "the trunk must stay connected to the ground");

  const slices = matchAllSlices(volume, views, { dilate: 1 });
  assert.ok(slices.meanIoU > 0.78, `mean slice IoU ${slices.meanIoU}`);
  assert.ok(slices.minIoU > 0.62, `weakest slice IoU ${slices.minIoU}`);
});

test("eight equally spaced views beat four on tightness while keeping slice match", () => {
  const views = syntheticViews();
  const selection = chooseOrbitAngles(views, { resolution: 32 });
  const two = selection.candidates.find(candidate => candidate.viewCount === 2);
  const four = selection.candidates.find(candidate => candidate.viewCount === 4);
  const eight = selection.candidates.find(candidate => candidate.viewCount === 8);
  assert.ok(two && four && eight);
  assert.ok(eight.filled < four.filled, "more angles must carve a tighter hull");
  assert.ok(four.filled < two.filled);
  assert.ok(eight.meanIoU > 0.74);
  assert.equal(selection.recommendedCount, 8);
  assert.equal(selection.shape.generic, false);
  assert.equal(selection.shape.kind, "custom");
  assert.deepEqual(equallySpacedSubset(views, 4).map(view => view.yaw), [0, 90, 180, 270]);
});

test("generic cylinders and boxes use four sides; complex subjects use eight", () => {
  const tree = classifyOrbitShape(syntheticViews());
  const can = classifyOrbitShape(syntheticCylinderViews());
  assert.equal(tree.generic, false);
  assert.equal(tree.kind, "custom");
  assert.equal(tree.recommendedCount, 8);
  assert.equal(can.generic, true);
  assert.equal(can.kind, "cylinder");
  assert.equal(can.recommendedCount, 2);
  const picked = chooseOrbitAngles(syntheticCylinderViews(), { resolution: 28 });
  assert.equal(picked.recommendedCount, 2);
  assert.equal(classifyOrbitShape(syntheticCapsuleViews()).kind, "capsule");
  assert.equal(classifyOrbitShape(syntheticRectangleViews()).kind, "rectangle");
});

test("UV wrapper follows the classified primitive", () => {
  const bounds = { minX: -1, minY: 0, minZ: -1, maxX: 1, maxY: 1, maxZ: 1, radius: 0.25 };
  for (const kind of ["cylinder", "capsule", "square", "rectangle", "custom"]) {
    const uv = wrapUv(0.2, 0.4, 0.1, { kind, bounds, normal: [1, 0, 0] });
    assert.ok(uv[0] >= 0 && uv[0] <= 1, `${kind} u`);
    assert.ok(uv[1] >= 0 && uv[1] <= 1, `${kind} v`);
  }
  const cylinder = cylinderUv(0.2, 0.08, 0.1, bounds);
  const capsule = capsuleUv(0.2, 0.08, 0.1, bounds);
  assert.notEqual(cylinder[1], capsule[1]);
  const box = wrapUv(1, 0.5, 0, { kind: "square", bounds, normal: [1, 0, 0] });
  assert.ok(box[0] < 1 / 3);
  const orbit = syntheticCylinderViews();
  const frontUv = wrapUv(0, 0.5, 0.2, { kind: "cylinder", bounds, views: orbit });
  const backUv = wrapUv(0, 0.5, -0.2, { kind: "cylinder", bounds, views: orbit });
  assert.ok(frontUv[0] < 0.5, "front still wraps the facing half");
  assert.ok(backUv[0] >= 0.5, "back still wraps the other half");
});

test("cylinders pick two orthogonal stills and snap the square hull to a round volume", () => {
  const views = syntheticCylinderViews();
  const picked = pickViewsForShape(views, { kind: "cylinder", recommendedCount: 2 });
  assert.deepEqual(picked.map(view => view.yaw).sort((a, b) => a - b), [0, 90]);
  const volume = carveVisualHull(picked, { resolution: 32 });
  const before = volume.filled;
  snapOccupancyToPrimitive(volume, { kind: "cylinder" });
  assert.ok(volume.filled < before, "inscribed cylinder must drop the square corners");
  const mid = Math.floor(volume.resolution / 2);
  const corner = voxelIndex(volume.resolution - 1, mid, volume.resolution - 1, volume.resolution);
  assert.equal(volume.occupancy[corner], 0);
});

test("real-world scale maps mesh extents onto metres", () => {
  const mesh = {
    positions: new Float32Array([
      -0.25, 0, -0.25,
      0.25, 1, 0.25,
    ]),
  };
  const scale = realWorldScale(mesh, { realHeight: 0.75, realWidth: 0.54 });
  assert.ok(Math.abs(scale.y - 0.75) < 1e-6);
  assert.ok(Math.abs(scale.x - 1.08) < 1e-6);
  assert.equal(scale.x, scale.z);
});

test("greedy mesh carries vertices, cylindrical UVs and baked photo color", () => {
  const views = syntheticViews();
  const volume = carveVisualHull(views, { resolution: 28 });
  bakeVoxelColors(volume, views);
  const mesh = greedyMesh(volume);
  assert.ok(mesh.vertexCount >= 24);
  assert.ok(mesh.triangleCount >= 12);
  assert.equal(mesh.uvs.length, mesh.vertexCount * 2);
  assert.equal(mesh.colors.length, mesh.vertexCount * 3);
  for (let i = 0; i < mesh.uvs.length; i += 2) {
    assert.ok(mesh.uvs[i] >= 0 && mesh.uvs[i] <= 2);
    assert.ok(mesh.uvs[i + 1] >= 0 && mesh.uvs[i + 1] <= 1);
  }
  let colored = 0;
  const resolution = volume.resolution;
  for (let z = 0; z < resolution; z++) {
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const rgb = voxelRgb(volume, x, y, z);
        if (rgb[1] > rgb[0] + 10 && rgb[1] > 40) colored += 1;
      }
    }
  }
  assert.ok(colored > 20, "canopy voxels should pick up leaf green");
});

test("photoconsistent isosurface keeps tree structure without axis-aligned cubes", () => {
  const views = syntheticViews();
  const asset = reconstructFromViews(views, {
    resolution: 28,
    silhouetteSize: 64,
    angleResolution: 18,
    mapSize: 32,
    depthSteps: 12,
    photoIterations: 3,
    smoothIterations: 4,
  });
  assert.ok(asset.mesh.vertexCount > 40, `too few vertices ${asset.mesh.vertexCount}`);
  assert.ok(asset.mesh.triangleCount > 40);
  assert.equal(asset.mesh.uvs.length, asset.mesh.vertexCount * 2);
  assert.equal(asset.mesh.colors.length, asset.mesh.vertexCount * 3);
  assert.ok(
    axisAlignedNormalRatio(asset.mesh) < 0.6,
    `mesh is still cube-like (${axisAlignedNormalRatio(asset.mesh)})`,
  );
  let green = 0;
  for (let i = 0; i < asset.mesh.colors.length; i += 3) {
    if (asset.mesh.colors[i + 1] > asset.mesh.colors[i] && asset.mesh.colors[i + 1] > 0.18) green += 1;
  }
  assert.ok(green > 8, "projected vertex colours should include canopy");
  assert.ok(asset.volume.filled > 80);
});

test("cylindrical unwrap writes albedo, bump and normal maps with detail", () => {
  const views = syntheticViews();
  const volume = carveVisualHull(views, { resolution: 24 });
  bakeVoxelColors(volume, views);
  const maps = bakeMaterialMaps(volume, { width: 64, height: 64 });
  assert.equal(maps.albedo.length, 64 * 64 * 4);
  assert.equal(maps.bump.length, 64 * 64);
  assert.equal(maps.normal.length, 64 * 64 * 4);
  assert.ok(mapsHaveDetail(maps));
  let greenish = 0;
  for (let i = 0; i < maps.albedo.length; i += 4) {
    if (maps.albedo[i + 1] > maps.albedo[i] && maps.albedo[i + 1] > 50) greenish += 1;
  }
  assert.ok(greenish > 30, "albedo must contain canopy colour");
});
