import assert from "node:assert/strict";
import test from "node:test";
import {
  createFibreModel,
  fillFibreMatrices,
  seamDistance,
  stepFibreDynamics,
  surfaceDistanceMillimetres,
} from "../src/fibre-model.mjs";

function dot(arrayA, offsetA, arrayB, offsetB) {
  return arrayA[offsetA] * arrayB[offsetB] +
    arrayA[offsetA + 1] * arrayB[offsetB + 1] +
    arrayA[offsetA + 2] * arrayB[offsetB + 2];
}

test("fibre layout is deterministic and its follicle frames are orthonormal", () => {
  const first = createFibreModel({ fibresPerArchetype: 96, seed: 0x1234abcd });
  const second = createFibreModel({ fibresPerArchetype: 96, seed: 0x1234abcd });
  assert.deepEqual(first.anchors, second.anchors);
  assert.deepEqual(first.lengths, second.lengths);
  assert.deepEqual(first.seam, second.seam);

  for (let index = 0; index < first.count; ++index) {
    const offset = index * 3;
    assert.ok(Math.abs(dot(first.anchors, offset, first.anchors, offset) - 1) < 2e-6);
    assert.ok(Math.abs(dot(first.tangents, offset, first.tangents, offset) - 1) < 2e-6);
    assert.ok(Math.abs(dot(first.bitangents, offset, first.bitangents, offset) - 1) < 2e-6);
    assert.ok(Math.abs(dot(first.anchors, offset, first.tangents, offset)) < 2e-6);
    assert.ok(Math.abs(dot(first.anchors, offset, first.bitangents, offset)) < 2e-6);
    assert.ok(first.lengths[index] >= 0.032 && first.lengths[index] <= 0.063);
  }
});

test("the wavy seam is closed and marks a narrow but well-populated fibre band", () => {
  assert.ok(seamDistance(0, 0) < 1e-9);
  assert.ok(seamDistance(0, Math.PI) < 1e-9);
  assert.ok(seamDistance(0.8, 0) > 0.5);
  const model = createFibreModel({ fibresPerArchetype: 2048, seed: 0x7e11ab1e });
  const seamCount = model.seam.reduce((sum, value) => sum + value, 0);
  const ratio = seamCount / model.count;
  assert.ok(ratio > 0.025 && ratio < 0.09, `unexpected seam fibre ratio ${ratio}`);
});

test("follicle springs react to a gust and remain finite under a large frame delta", () => {
  const model = createFibreModel({ fibresPerArchetype: 64, seed: 0x8317 });
  const rest = model.lean.slice();
  for (let frame = 0; frame < 40; ++frame) {
    stepFibreDynamics(model, 0.05, {
      time: frame * 0.05,
      wind: [0.7, 0.2, -0.45],
      gust: frame < 10 ? 1.3 : 0,
      brushNormal: [0, 0, 1],
      brushDirection: [1, 0, 0],
      brushStrength: frame < 5 ? 1.2 : 0,
    });
  }
  let changed = 0;
  for (let index = 0; index < model.lean.length; ++index) {
    assert.ok(Number.isFinite(model.lean[index]));
    assert.ok(Number.isFinite(model.velocity[index]));
    assert.ok(Math.abs(model.lean[index]) <= 0.720001);
    if (Math.abs(model.lean[index] - rest[index]) > 1e-5) changed += 1;
  }
  assert.ok(changed > model.lean.length * 0.5);
});

test("Three.js and Vulkan transforms encode the identical fibre pose", () => {
  const model = createFibreModel({ fibresPerArchetype: 24, seed: 0xa913 });
  stepFibreDynamics(model, 1 / 60, { time: 2, gust: 0.8, wind: [0.4, 0.1, -0.2] });
  const render = new Float32Array(model.fibresPerArchetype * 16);
  const rtx = new Float32Array(model.fibresPerArchetype * 12);
  const masks = new Uint32Array(model.fibresPerArchetype);
  fillFibreMatrices(model, 1, render, rtx, masks);

  for (let instance = 0; instance < model.fibresPerArchetype; ++instance) {
    const m = instance * 16;
    const r = instance * 12;
    assert.deepEqual(
      Array.from(rtx.subarray(r, r + 12)),
      [
        render[m], render[m + 4], render[m + 8], render[m + 12],
        render[m + 1], render[m + 5], render[m + 9], render[m + 13],
        render[m + 2], render[m + 6], render[m + 10], render[m + 14],
      ],
    );
    assert.equal(masks[instance], 0xff);
    assert.equal(render[m + 15], 1);
  }
});

test("macro distance readout uses the regulation 33.5 mm radius", () => {
  assert.equal(surfaceDistanceMillimetres(1), 0);
  assert.ok(Math.abs(surfaceDistanceMillimetres(1.076) - 2.546) < 1e-9);
  assert.ok(Math.abs(surfaceDistanceMillimetres(2) - 33.5) < 1e-9);
});
