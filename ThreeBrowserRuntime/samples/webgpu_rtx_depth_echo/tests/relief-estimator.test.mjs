import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RELIEF_HEIGHT,
  RELIEF_LABEL,
  RELIEF_WIDTH,
  createReliefEstimator,
} from "../src/relief-estimator.mjs";

function fakeDevice() {
  const state = {
    textures: [],
    writes: 0,
    submits: 0,
    dispatches: [],
    imported: [],
  };
  const device = {
    queue: {
      writeBuffer() { state.writes += 1; },
      submit() { state.submits += 1; },
    },
    createTexture(descriptor) {
      const texture = {
        descriptor,
        destroyed: false,
        createView() { return { texture }; },
        destroy() { texture.destroyed = true; },
      };
      state.textures.push(texture);
      return texture;
    },
    createBuffer(descriptor) {
      return { descriptor, destroyed: false, destroy() { this.destroyed = true; } };
    },
    createSampler(descriptor) { return { descriptor }; },
    createBindGroupLayout(descriptor) { return { descriptor }; },
    createPipelineLayout(descriptor) { return { descriptor }; },
    createShaderModule(descriptor) { state.shader = descriptor.code; return { descriptor }; },
    createComputePipeline(descriptor) { return { descriptor }; },
    async createComputePipelineAsync(descriptor) { return { descriptor }; },
    createBindGroup(descriptor) { return { descriptor }; },
    importExternalTexture({ source }) {
      state.imported.push(source);
      return { source };
    },
    createCommandEncoder() {
      return {
        beginComputePass() {
          return {
            setPipeline() {},
            setBindGroup() {},
            dispatchWorkgroups(...groups) { state.dispatches.push(groups); },
            end() {},
          };
        },
        finish() { return {}; },
      };
    },
  };
  return { device, state };
}

test("heuristic estimator owns one persistent 224-square rgba32float position texture", async () => {
  const { device, state } = fakeDevice();
  const estimator = createReliefEstimator({ device });
  await estimator.init();
  assert.equal(estimator.label, RELIEF_LABEL);
  assert.equal(estimator.kind, "heuristic-non-neural");
  assert.equal(RELIEF_WIDTH, 224);
  assert.equal(RELIEF_HEIGHT, 224);
  assert.equal(state.textures[0].descriptor.format, "rgba32float");
  assert.deepEqual(state.textures[0].descriptor.size, {
    width: 224,
    height: 224,
    depthOrArrayLayers: 1,
  });
  assert.equal(state.textures[0].descriptor.usage & 0x01, 0x01, "positions need COPY_SRC");
  assert.equal(state.textures[0].descriptor.usage & 0x04, 0x04, "positions need TEXTURE_BINDING");
  assert.equal(state.textures[0].descriptor.usage & 0x08, 0x08, "positions need STORAGE_BINDING");

  const source = {
    width: 2,
    height: 2,
    data: new Uint8Array(16).fill(255),
    sequence: 1,
  };
  const first = await estimator.update({ source });
  assert.equal(first.positionsTexture, estimator.positionsTexture);
  assert.equal(first.label, "HEURISTIC LUMA+EDGE RELIEF / NON-NEURAL / NON-METRIC");
  assert.match(first.confidenceChannel, /positionsTexture\.w.*heuristic foreground confidence/i);
  assert.equal(first.fresh, true);
  assert.deepEqual(state.dispatches, [[28, 28, 1]]);
  assert.equal(state.submits, 1);
  assert.equal(state.writes, 1);

  const repeated = await estimator.update({ source });
  assert.equal(repeated.positionsTexture, first.positionsTexture);
  assert.equal(repeated.fresh, false);
  assert.equal(state.submits, 1, "a repeated deterministic sequence must not recompute");

  source.sequence = 2;
  const next = await estimator.update({ source, mirrorX: true });
  assert.equal(next.positionsTexture, first.positionsTexture);
  assert.equal(next.fresh, true);
  assert.equal(state.submits, 2);
  assert.match(state.shader, /texture_external/);
  assert.match(state.shader, /texture_storage_2d<rgba32float, write>/);
  assert.match(state.shader, /worldZ = -0\.20 \+ smoothed \* 1\.55/);
  assert.match(state.shader, /registeredU = select\(gridUv\.x, 1\.0 - gridUv\.x/);
  assert.match(state.shader, /foregroundConfidence = clamp/);
  assert.match(state.shader, /vec4<f32>\(worldX, worldY, worldZ, foregroundConfidence\)/);

  estimator.dispose();
  assert.equal(state.textures.every(texture => texture.destroyed), true);
});

test("production estimator has no CPU readback or inference dependency", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("../src/relief-estimator.mjs", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /mapAsync|getMappedRange/);
  assert.doesNotMatch(source, /typegpu|depthart/i);
  assert.match(source, /NON-NEURAL \/ NON-METRIC/);
});
