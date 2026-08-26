import test from "node:test";
import assert from "node:assert/strict";

import {
  computeCoverCrop,
  compositePersonMatteRgba,
  coverPlaneSize,
  fillSyntheticCameraFrame,
  mapSourcePointToTexture,
  resampleCoverRgba,
  texturePointToWorld,
} from "../src/camera-background.mjs";

test("cover crop removes the long axis and preserves the target aspect", () => {
  assert.deepEqual(computeCoverCrop(400, 400, 160, 90), {
    x: 0,
    y: 87.5,
    width: 400,
    height: 225,
  });
  assert.deepEqual(computeCoverCrop(400, 200, 160, 90), {
    x: 22.22222222222223,
    y: 0,
    width: 355.55555555555554,
    height: 200,
  });
});

test("source mapping applies the same cover crop and selfie mirror", () => {
  const center = mapSourcePointToTexture(0.5, 0.5, 400, 400, 160, 90, true);
  assert.ok(Math.abs(center.x - 0.5) < 1e-9);
  assert.ok(Math.abs(center.y - 0.5) < 1e-9);
  assert.equal(center.visible, true);

  const left = mapSourcePointToTexture(0.25, 0.5, 400, 400, 160, 90, true);
  assert.ok(Math.abs(left.x - 0.75) < 1e-9);
  assert.equal(left.visible, true);

  const croppedTop = mapSourcePointToTexture(0.5, 0, 400, 400, 160, 90, true);
  assert.equal(croppedTop.visible, false);
});

test("RGBA resampling mirrors a tiny frame without changing channel order", () => {
  const source = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  const destination = new Uint8Array(16);
  resampleCoverRgba(source, 2, 2, destination, 2, 2, true);
  assert.deepEqual(Array.from(destination), [
    0, 255, 0, 255, 255, 0, 0, 255,
    255, 255, 255, 255, 0, 0, 255, 255,
  ]);
});

test("person matte conversion hides the room and mirrors only the revealed subject", () => {
  const source = new Uint8Array([
    230, 150, 110, 255,
    40, 90, 210, 255,
  ]);
  const destination = new Uint8Array(8);
  compositePersonMatteRgba(source, 2, 1, destination, {
    width: 2,
    height: 1,
    alpha: new Float32Array([1, 0]),
  }, 2, 1, true);

  assert.deepEqual(Array.from(destination.slice(0, 4)), [2, 1, 8, 255]);
  assert.ok(destination[4] > 80, "the mirrored subject is visible in converted red");
  assert.ok(destination[6] > destination[5], "the subject is recoloured into the violet palette");
  assert.equal(destination[7], 255);
});

test("cover plane and world mapping remain aligned", () => {
  const size = coverPlaneSize(21 / 9, 16 / 9);
  assert.equal(size.width, 14 / 3);
  assert.ok(Math.abs(size.height - 21 / 8) < 1e-12);
  assert.deepEqual(texturePointToWorld({ x: 0.5, y: 0.5 }, size), { x: 0, y: 0 });
  const corner = texturePointToWorld({ x: 1, y: 0 }, size);
  assert.ok(Math.abs(corner.x - 7 / 3) < 1e-12);
  assert.ok(Math.abs(corner.y - 21 / 16) < 1e-12);
});

test("synthetic camera fallback is deterministic per animation tick and opaque", () => {
  const first = new Uint8Array(8 * 4 * 4);
  const second = new Uint8Array(first.length);
  fillSyntheticCameraFrame(first, 8, 4, 1.001);
  fillSyntheticCameraFrame(second, 8, 4, 1.002);
  assert.deepEqual(first, second);
  assert.ok(first.some((value, index) => index % 4 !== 3 && value > 8));
  for (let index = 3; index < first.length; index += 4) assert.equal(first[index], 255);
});
