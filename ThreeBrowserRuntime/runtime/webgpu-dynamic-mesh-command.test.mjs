import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import cmd, { OP } from "../../host/ThreeBrowser/web/three-webgpu-cmd.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function words(buffer, byteLength) {
  return Array.from(new Uint32Array(buffer, 0, byteLength / 4));
}

test("dynamic triangle mesh commands preserve their versioned binary contract", () => {
  const buffer = new ArrayBuffer(4096);
  cmd.attach(buffer);

  cmd.rtxDynamicMeshCreate(7, {
    handle: 9,
    positionsTextureHandle: 11,
    positionsVulkanLayout: 1,
    width: 2,
    height: 2,
    vertexCount: 3,
    indices: new Uint32Array([0, 1, 2]),
  });
  assert.equal(cmd.used(), 56);
  assert.deepEqual(words(buffer, 56).slice(0, 11), [
    OP.RTX_DYNAMIC_MESH_CREATE, 56,
    1, 7, 9, 11, 1, 2, 2, 3, 3,
  ]);
  assert.deepEqual(words(buffer, 56).slice(11, 14), [0, 1, 2]);
  cmd.submitNow(true);

  cmd.rtxDynamicMeshRefit(7, {
    handle: 9,
    positionsTextureHandle: 12,
    positionsVulkanLayout: 1,
    width: 2,
    height: 2,
    vertexCount: 3,
    rebuild: true,
  });
  assert.equal(cmd.used(), 48);
  assert.deepEqual(words(buffer, 48).slice(0, 11), [
    OP.RTX_DYNAMIC_MESH_REFIT, 48,
    1, 7, 9, 12, 1, 2, 2, 3, 1,
  ]);
  cmd.submitNow(true);

  cmd.rtxDynamicMeshDestroy(7, 9);
  assert.equal(cmd.used(), 24);
  assert.deepEqual(words(buffer, 24).slice(0, 5), [
    OP.RTX_DYNAMIC_MESH_DESTROY, 24, 1, 7, 9,
  ]);
  cmd.submitNow(true);
});

test("dynamic triangle mesh create rejects incomplete topology", () => {
  assert.throws(
    () => cmd.rtxDynamicMeshCreate(1, {
      handle: 2,
      positionsTextureHandle: 3,
      positionsVulkanLayout: 1,
      width: 2,
      height: 2,
      vertexCount: 3,
      indices: new Uint32Array([0, 1]),
    }),
    /complete uint32 triangles/,
  );
});

test("dynamic positions require the caller's explicit current Vulkan layout", async () => {
  const adapterUrl = pathToFileURL(path.resolve(
    here,
    "../../host/ThreeBrowser/web/three-webgpu-gpu.js",
  ));
  const { GPUTexture, rtxDynamicPositionsResource } = await import(
    `${adapterUrl.href}?dynamic-layout-test`
  );
  const texture = new GPUTexture(41, {
    size: { width: 2, height: 2, depthOrArrayLayers: 1 },
    format: "rgba32float",
    usage: 0x01 | 0x08,
  }, false);
  assert.throws(
    () => rtxDynamicPositionsResource(texture, undefined),
    /requires its current non-zero Vulkan VkImageLayout/,
  );
  assert.equal(rtxDynamicPositionsResource(texture, 1).vulkanLayout, 1);
});
