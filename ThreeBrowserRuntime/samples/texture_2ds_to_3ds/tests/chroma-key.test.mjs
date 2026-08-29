import assert from "node:assert/strict";
import test from "node:test";
import { despillImageData, keyImageData, magentaKeyAlpha } from "../src/chroma-key.mjs";

function makeRgba(width, height, fill) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const rgb = fill(x, y);
      data[index] = rgb[0];
      data[index + 1] = rgb[1];
      data[index + 2] = rgb[2];
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

function rgbAt(image, x, y) {
  const index = (y * image.width + x) * 4;
  return [image.data[index], image.data[index + 1], image.data[index + 2]];
}

const MAGENTA = [224, 64, 160];
const NEAR_MAGENTA = [208, 78, 148];
const HOT_RED = [220, 70, 90];
const RED = [176, 32, 28];
const GREEN = [60, 110, 40];
const WHITE = [250, 250, 250];
const DUSTY = [180, 160, 170];

test("only strict or near-studio magenta keys globally", () => {
  assert.equal(magentaKeyAlpha(224, 64, 160), 0);
  assert.equal(magentaKeyAlpha(255, 45, 200), 0);
  assert.equal(magentaKeyAlpha(...NEAR_MAGENTA), 0);
  assert.equal(magentaKeyAlpha(...HOT_RED), 255);
  assert.equal(magentaKeyAlpha(60, 110, 40), 255);
  assert.equal(magentaKeyAlpha(180, 110, 90), 255);
  assert.equal(magentaKeyAlpha(176, 32, 28), 255);
  assert.equal(magentaKeyAlpha(70, 90, 160), 255);
});

test("border flood fill keys backdrop and keeps enclosed interior hot red", () => {
  const image = makeRgba(24, 16, (x, y) => {
    const pink = x >= 9 && x <= 14 && y >= 5 && y <= 10;
    const frame = x >= 7 && x <= 16 && y >= 3 && y <= 12;
    if (pink) return HOT_RED;
    if (frame) return GREEN;
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, 0, 0), 0, "border magenta is keyed");
  assert.equal(alphaAt(image, 11, 7), 255, "enclosed candidate pink stays opaque");
  assert.equal(alphaAt(image, 7, 3), 255, "non-magenta frame stays opaque");
});

test("strict and near-studio magenta key even inside an enclosed island", () => {
  const image = makeRgba(24, 16, (x, y) => {
    const pocket = x >= 9 && x <= 14 && y >= 5 && y <= 10;
    const frame = x >= 7 && x <= 16 && y >= 3 && y <= 12;
    if (pocket) return x < 12 ? MAGENTA : NEAR_MAGENTA;
    if (frame) return GREEN;
    return MAGENTA;
  });
  keyImageData(image, { close: false, watermark: false });
  assert.equal(alphaAt(image, 10, 7), 0, "exact studio magenta keys globally");
  assert.equal(alphaAt(image, 13, 7), 0, "near studio magenta keys globally");
  assert.equal(alphaAt(image, 7, 3), 255, "opaque enclosure stays intact");
});

for (const [label, color] of [
  ["muted brown", [128, 100, 100]],
  ["charcoal brown", [100, 80, 80]],
  ["hot red", HOT_RED],
]) {
  test(`border-connected ${label} subject pixels stay opaque`, () => {
    const image = makeRgba(16, 12, (x, y) => {
      if (x <= 3 && y >= 3 && y <= 8) return color;
      return MAGENTA;
    });
    keyImageData(image, { close: false, watermark: false });
    assert.equal(alphaAt(image, 0, 5), 255, "subject survives at the image border");
    assert.equal(alphaAt(image, 2, 5), 255, "connected subject interior survives");
    assert.equal(alphaAt(image, 15, 0), 0, "studio background still keys");
  });
}

test("muted blue-gray subject stays opaque against the magenta studio", () => {
  const image = makeRgba(16, 16, (x, y) => {
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return [70, 90, 160];
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, 7, 7), 255);
  assert.equal(alphaAt(image, 0, 0), 0);
});

test("non-magenta red subject stays opaque even when it touches the backdrop", () => {
  const image = makeRgba(16, 16, (x, y) => {
    if (x >= 5 && x <= 10 && y >= 5 && y <= 10) return RED;
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, 0, 0), 0, "studio magenta keys out");
  assert.equal(alphaAt(image, 7, 7), 255, "interior red survives");
  assert.equal(alphaAt(image, 5, 5), 255, "red edge touching magenta survives");
  assert.deepEqual(rgbAt(image, 7, 7), RED);
});

test("1px holes in the keyed backdrop close without eating the subject", () => {
  const image = makeRgba(20, 12, (x, y) => {
    if (x === 2 && y === 2) return GREEN;
    if (x >= 8 && x <= 14 && y >= 3 && y <= 8) return GREEN;
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, 2, 2), 0, "1px island in the backdrop is closed");
  assert.equal(alphaAt(image, 11, 5), 255, "subject block stays opaque");
});

test("near-magenta dusty pixels connect the backdrop flood", () => {
  const image = makeRgba(16, 12, (x, y) => {
    const onRing = (x === 4 || x === 11 || y === 3 || y === 8)
      && x >= 4 && x <= 11 && y >= 3 && y <= 8;
    const pocket = x >= 5 && x <= 10 && y >= 4 && y <= 7;
    const gap = (x === 4 || x === 5) && y === 5;
    if (gap) return DUSTY;
    if (pocket) return MAGENTA;
    if (onRing) return GREEN;
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, 4, 5), 0, "dusty gap is keyed");
  assert.equal(alphaAt(image, 7, 5), 0, "magenta pocket reached through dusty");
  assert.equal(alphaAt(image, 4, 3), 255, "green frame stays");
});

test("watermark punch only applies when the corner is already keyed background", () => {
  const width = 40;
  const height = 40;
  const image = makeRgba(width, height, (x, y) => {
    if (x >= 8 && x <= 22 && y >= 8 && y <= 28) return GREEN;
    if ((x === 36 && y === 38) || (x === 38 && y === 37) || (x === 37 && y === 39)) return WHITE;
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, 36, 38), 0, "white watermark letters on keyed corner are punched");
  assert.equal(alphaAt(image, width - 1, height - 1), 0);
  assert.equal(alphaAt(image, 15, 18), 255, "subject away from the corner stays");
});

test("watermark rectangle does not punch a subject that occupies the corner", () => {
  const width = 40;
  const height = 40;
  const watermarkWidth = Math.max(1, Math.floor(width * 0.24));
  const watermarkHeight = Math.max(1, Math.floor(height * 0.075));
  const image = makeRgba(width, height, (x, y) => {
    if (x >= width - watermarkWidth && y >= height - watermarkHeight) return GREEN;
    return MAGENTA;
  });
  keyImageData(image);
  assert.equal(alphaAt(image, width - 1, height - 1), 255, "subject in the corner stays opaque");
  assert.equal(alphaAt(image, width - watermarkWidth, height - watermarkHeight), 255);
  assert.equal(alphaAt(image, 0, 0), 0);
});

test("despill pulls magenta fringe on edge pixels only", () => {
  const image = makeRgba(12, 12, (x, y) => {
    if (x >= 3 && x <= 8 && y >= 3 && y <= 8) return RED;
    return MAGENTA;
  });
  keyImageData(image);
  despillImageData(image);
  assert.equal(alphaAt(image, 5, 5), 255);
  assert.deepEqual(rgbAt(image, 5, 5), RED, "interior is not despelled");
  const edge = rgbAt(image, 3, 5);
  assert.ok(edge[0] < RED[0], "edge red is pulled");
});
