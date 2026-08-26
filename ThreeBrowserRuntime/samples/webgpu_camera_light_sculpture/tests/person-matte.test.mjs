import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PERSON_MATTE_LABEL,
  buildPersonMatteLayer,
  createPersonMatte,
  createPersonMatteWorkspace,
  createTemporalMatte,
  inclusiveSkinLikelihood,
  rgbToLumaChroma,
  temporalSmoothMatte,
  thresholdMatte,
} from "../src/person-matte.mjs";

function frame(width, height, colour = [28, 32, 42, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; ++index) data.set(colour, index * 4);
  return data;
}

function paintRect(data, width, x, y, rectWidth, rectHeight, colour) {
  const height = data.length / 4 / width;
  for (let row = Math.max(0, y); row < Math.min(height, y + rectHeight); ++row) {
    for (let column = Math.max(0, x); column < Math.min(width, x + rectWidth); ++column) {
      data.set(colour, (row * width + column) * 4);
    }
  }
  return data;
}

function approx(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

function syntheticPerson(width, height, bodyX = 17) {
  const image = frame(width, height);
  paintRect(image, width, bodyX, 12, 14, 20, [30, 80, 150, 255]);
  paintRect(image, width, bodyX + 3, 6, 8, 8, [205, 142, 105, 255]);
  return image;
}

test("RGB conversion produces deterministic normalized luminance and chroma planes", () => {
  const rgba = new Uint8Array([
    0, 0, 0, 255,
    255, 255, 255, 255,
    255, 0, 0, 255,
  ]);
  const output = {
    y: new Float32Array(3),
    cb: new Float32Array(3),
    cr: new Float32Array(3),
  };
  const converted = rgbToLumaChroma(rgba, 3, 1, output);
  assert.equal(converted.y, output.y);
  assert.equal(converted.cb, output.cb);
  assert.equal(converted.cr, output.cr);
  approx(converted.y[0], 0);
  approx(converted.cb[0], 0.5);
  approx(converted.cr[0], 0.5);
  approx(converted.y[1], 1);
  approx(converted.cb[1], 0.5);
  approx(converted.cr[1], 0.5);
  approx(converted.y[2], 0.299);
  approx(converted.cb[2], 0.331264);
  approx(converted.cr[2], 1);
});

test("inclusive YCbCr skin seeds span dark and light tones while rejecting blue", () => {
  const likelihood = colour => {
    const converted = rgbToLumaChroma(new Uint8Array([...colour, 255]), 1, 1);
    return inclusiveSkinLikelihood(converted.y[0], converted.cb[0], converted.cr[0]);
  };
  assert.ok(likelihood([90, 55, 40]) > 0.8);
  assert.ok(likelihood([230, 185, 155]) > 0.8);
  assert.ok(likelihood([205, 142, 105]) > 0.8);
  assert.ok(likelihood([60, 110, 230]) < 0.05);
});

test("skin-seeded growth includes a connected clothed body and rejects an unseeded mover", () => {
  const width = 48;
  const height = 36;
  const background = frame(width, height);
  const current = syntheticPerson(width, height);
  paintRect(current, width, 3, 20, 7, 6, [30, 200, 240, 255]);

  const matte = buildPersonMatteLayer(
    { data: current, width, height },
    { data: background, width, height },
    { data: background, width, height },
  );
  assert.equal(matte.label, PERSON_MATTE_LABEL);
  assert.equal(matte.kind, "local-seeded-person-matte");
  assert.equal(matte.seedPixels, 64, "only the inclusive skin-coloured head seeds the matte");
  assert.equal(matte.mask[8 * width + 22], 1, "head seed is retained");
  assert.equal(matte.mask[22 * width + 22], 1, "connected non-skin clothing grows into the person");
  assert.equal(matte.mask[22 * width + 5], 0, "disconnected blue moving object is rejected");
  assert.equal(matte.eligibleMask[22 * width + 5], 1, "the object moved but has no person seed");
  assert.equal(matte.pixels, 328);
  assert.deepEqual(matte.bounds, { x: 17, y: 6, width: 14, height: 26 });
  approx(matte.centroid.x, 0.5);
  assert.ok(matte.seedCoverage < matte.coverage);
  assert.ok(matte.coverage < matte.eligibleCoverage);
});

test("global luminance compensation rejects a uniformly changing skin-coloured background", () => {
  const width = 32;
  const height = 24;
  const background = frame(width, height, [80, 70, 65, 255]);
  const brighter = frame(width, height, [95, 85, 80, 255]);
  const matte = buildPersonMatteLayer(
    { data: brighter, width, height },
    { data: background, width, height },
    { data: background, width, height },
  );
  assert.equal(matte.seedPixels, 0);
  assert.equal(matte.pixels, 0);
  assert.equal(matte.coverage, 0);
  assert.ok(matte.globalBackgroundDelta.y > 0.05);
  assert.ok(Math.max(...matte.foregroundEvidence) < 0.02);
});

test("temporal primitives use fast attack, slow release, and reusable buffers", () => {
  const current = new Float32Array([1, 0]);
  const history = new Float32Array(2);
  const output = new Float32Array(2);
  const first = temporalSmoothMatte(current, history, 2, 1, {
    temporalAttack: 0.5,
    temporalRelease: 0.2,
  }, output);
  assert.equal(first, output);
  approx(first[0], 0.5);
  approx(first[1], 0);
  const mask = thresholdMatte(first, 2, 1, 0.45);
  assert.deepEqual([...mask], [1, 0]);

  const temporal = createTemporalMatte(2, 1, {
    temporalAttack: 0.5,
    temporalRelease: 0.2,
    matteThreshold: 0.35,
  });
  const alphaIdentity = temporal.alpha;
  assert.deepEqual([...temporal.update(current).mask], [1, 0]);
  const held = temporal.update(new Float32Array(2));
  assert.equal(held.alpha, alphaIdentity);
  approx(held.alpha[0], 0.4);
  assert.deepEqual([...held.mask], [1, 0], "slow release holds the matte for one missing frame");
  const released = temporal.update(new Float32Array(2));
  approx(released.alpha[0], 0.32);
  assert.deepEqual([...released.mask], [0, 0]);
  temporal.reset();
  assert.deepEqual([...temporal.alpha], [0, 0]);
});

test("stateful tracker initializes a background then returns a temporally smoothed matte", () => {
  const width = 48;
  const height = 36;
  const background = frame(width, height);
  const person = syntheticPerson(width, height);
  const tracker = createPersonMatte();
  const initialized = tracker.update(background, width, height);
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.frameIndex, 1);
  assert.equal(initialized.coverage, 0);

  const detected = tracker.update(person, width, height);
  assert.equal(detected.frameIndex, 2);
  assert.equal(detected.rawMask[22 * width + 22], 1);
  assert.equal(detected.mask[22 * width + 22], 1);
  assert.ok(detected.alpha[22 * width + 22] > 0.6);
  const alphaIdentity = detected.alpha;

  const repeated = tracker.update(person, width, height);
  assert.equal(repeated.alpha, alphaIdentity, "temporal output storage is reused");
  assert.ok(repeated.coverage >= detected.coverage);
  tracker.reset();
  assert.equal(tracker.frameIndex, 0);
});

test("128x96 workspace reuses all large buffers and stays deterministic", () => {
  const width = 128;
  const height = 96;
  const background = frame(width, height);
  const current = frame(width, height);
  paintRect(current, width, 48, 32, 32, 50, [30, 80, 150, 255]);
  paintRect(current, width, 57, 20, 14, 15, [205, 142, 105, 255]);
  const workspace = createPersonMatteWorkspace(width, height);
  const first = buildPersonMatteLayer(
    { data: current, width, height },
    { data: background, width, height },
    { data: background, width, height },
    {},
    workspace,
  );
  const identities = {
    mask: first.mask,
    alpha: first.alpha,
    y: first.lumaChroma.y,
    queue: workspace.queue,
  };
  const maskCopy = new Uint8Array(first.mask);
  const second = buildPersonMatteLayer(
    { data: current, width, height },
    { data: background, width, height },
    { data: background, width, height },
    {},
    workspace,
  );
  assert.equal(second.workspace, workspace);
  assert.equal(second.mask, identities.mask);
  assert.equal(second.alpha, identities.alpha);
  assert.equal(second.lumaChroma.y, identities.y);
  assert.equal(workspace.queue, identities.queue);
  assert.deepEqual(second.mask, maskCopy);
  assert.equal(second.pixels, 1768);
});

test("person matte remains dependency-free and explicitly non-neural", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("../src/person-matte.mjs", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(source, /mediapipe|tensorflow|onnx|bodypix|segmentation[-_ ]?model/i);
  assert.doesNotMatch(source, /document\.|navigator\./);
  assert.match(source, /NON-NEURAL/);
  assert.match(source, /rgbToLumaChroma/);
  assert.match(source, /seedMask/);
});
