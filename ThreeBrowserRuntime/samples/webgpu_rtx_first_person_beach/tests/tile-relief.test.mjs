import assert from "node:assert/strict";
import test from "node:test";
import {
  TILE_SPECS,
  bakeHeight,
  bakeNormal,
  bakeTileMaps,
  composite2x2,
  lumaByte,
  wrapIndex,
} from "../src/tile-relief.mjs";

function fillRgba(width, height, fn) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fn(x, y);
      const o = (y * width + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return data;
}

test("wrap index is periodic on both sides of a tile", () => {
  assert.equal(wrapIndex(-1, 8), 7);
  assert.equal(wrapIndex(8, 8), 0);
  assert.equal(wrapIndex(17, 8), 1);
});

test("height bake lifts bright grains above the mean like FakeDepthTrick", () => {
  const rgb = new Float32Array([
    40, 40, 40,
    220, 220, 220,
    40, 40, 40,
    220, 220, 220,
  ]);
  const height = bakeHeight(rgb, 2, 2, { gain: 2.4 });
  assert.ok(height[1] > height[0]);
  assert.equal(height[1], height[3]);
});

test("wrapping normals point outward from a raised ridge", () => {
  const height = new Uint8Array([
    20, 200, 20,
    20, 200, 20,
    20, 200, 20,
  ]);
  const normal = bakeNormal(height, 3, 3, { strength: 8 });
  const left = normal[0] / 255 * 2 - 1;
  const right = normal[8] / 255 * 2 - 1;
  assert.ok(left < -0.2, "left of ridge leans left");
  assert.ok(right > 0.2, "right of ridge leans right");
  assert.deepEqual(
    Uint8Array.from(normal.subarray(0, 4)),
    Uint8Array.from(normal.subarray(2 * 3 * 4, 2 * 3 * 4 + 4)),
    "identical wrapped rows share a normal",
  );
});

test("tiles that need relief emit wrap-safe albedo, height and normal maps", () => {
  const source = fillRgba(64, 64, (x, y) => {
    const grain = ((x * 13 + y * 29) % 17) * 8;
    return [160 + grain, 140 + grain * 0.6, 110 + grain * 0.3];
  });
  const maps = bakeTileMaps(source, 64, 64, TILE_SPECS["dry-sand"]);
  assert.equal(maps.width, 64);
  assert.equal(maps.height, 64);
  assert.equal(maps.albedo.length, 64 * 64 * 4);
  assert.equal(maps.heightMap.length, 64 * 64);
  assert.equal(maps.normal.length, 64 * 64 * 4);
  const preview = composite2x2(maps.albedo, maps.width, maps.height);
  assert.equal(preview.width, 128);
  const a = maps.albedo.subarray(0, 4);
  const wrapX = maps.albedo.subarray((0 * 64 + 0) * 4, (0 * 64 + 0) * 4 + 4);
  assert.deepEqual(a, wrapX);
  assert.ok(lumaByte(maps.albedo[0], maps.albedo[1], maps.albedo[2]) > 0);
});

test("every catalogued beach tile requests a height and normal bake", () => {
  for (const [name, spec] of Object.entries(TILE_SPECS)) {
    assert.equal(spec.needsRelief, true, `${name} should receive relief maps`);
    assert.ok(spec.heightGain > 0);
    assert.ok(spec.normalStrength > 0);
  }
});
