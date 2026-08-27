import assert from "node:assert/strict";
import test from "node:test";
import {
  alphaBounds,
  cropImageData,
  keyImageData,
  magentaKeyAlpha,
} from "../src/chroma-key.mjs";

test("hot-pink studio pixels key out and foliage stays opaque", () => {
  assert.equal(magentaKeyAlpha(255, 45, 200), 0);
  assert.equal(magentaKeyAlpha(236, 18, 168), 0);
  assert.equal(magentaKeyAlpha(240, 90, 170), 0);
  assert.equal(magentaKeyAlpha(60, 110, 40), 255);
  assert.equal(magentaKeyAlpha(210, 200, 180), 255);
  assert.equal(magentaKeyAlpha(160, 80, 150), 0);
  assert.equal(magentaKeyAlpha(180, 110, 90), 255);
});

test("keyImageData clears magenta and the grok watermark corner", () => {
  const width = 32;
  const height = 24;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (x > 8 && x < 18 && y > 4 && y < 18) {
        data[index] = 70;
        data[index + 1] = 120;
        data[index + 2] = 50;
        data[index + 3] = 255;
      } else {
        data[index] = 255;
        data[index + 1] = 40;
        data[index + 2] = 210;
        data[index + 3] = 255;
      }
    }
  }
  data[((height - 1) * width + (width - 1)) * 4] = 250;
  data[((height - 1) * width + (width - 1)) * 4 + 1] = 250;
  data[((height - 1) * width + (width - 1)) * 4 + 2] = 250;
  keyImageData({ width, height, data });
  const tree = (5 * width + 9) * 4;
  assert.equal(data[tree + 3], 255);
  const backdrop = 0;
  assert.equal(data[backdrop + 3], 0);
  const corner = ((height - 1) * width + (width - 1)) * 4;
  assert.equal(data[corner + 3], 0);
});

test("alpha crop tightens a cutout to the opaque silhouette", () => {
  const width = 16;
  const height = 16;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 6; y <= 10; y++) {
    for (let x = 5; x <= 9; x++) {
      const index = (y * width + x) * 4;
      data[index + 1] = 90;
      data[index + 3] = 255;
    }
  }
  const bounds = alphaBounds({ width, height, data });
  assert.equal(bounds.minX, 5);
  assert.equal(bounds.maxX, 9);
  assert.equal(bounds.minY, 6);
  assert.equal(bounds.maxY, 10);
  const cropped = cropImageData({ width, height, data }, bounds, 1);
  assert.equal(cropped.width, 7);
  assert.equal(cropped.height, 7);
});
