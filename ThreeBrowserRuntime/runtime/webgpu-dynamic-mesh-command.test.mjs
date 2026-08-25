import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import cmd, { OP } from "../../host/ThreeBrowser/web/three-webgpu-cmd.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const nativeBridgePath = path.resolve(
  here,
  "../../native/webgpu/ray_query_bridge.cpp",
);
const nativeApiPath = path.resolve(
  here,
  "../../native/webgpu/three_webgpu.cpp",
);
const reflectionShaderPath = path.resolve(
  here,
  "../../native/webgpu/shaders/ray_query_reflections.comp",
);

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

test("dynamic triangle mesh reflection material uses the additive v2 create payload", () => {
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
    reflectionMaterial: {
      radiance: new Float32Array([0.25, 0.5, 1.0, 2.0]),
      surface: new Float32Array([0.71, 0.31, 0.022, 0.055]),
    },
  });

  assert.equal(cmd.used(), 96);
  assert.deepEqual(words(buffer, 96).slice(0, 12), [
    OP.RTX_DYNAMIC_MESH_CREATE, 96,
    2, 7, 9, 11, 1, 2, 2, 3, 3, 2,
  ]);
  assert.deepEqual(
    Array.from(new Float32Array(buffer, 12 * 4, 8)),
    Array.from(new Float32Array([
      0.25, 0.5, 1.0, 2.0, 0.71, 0.31, 0.022, 0.055,
    ])),
  );
  assert.deepEqual(words(buffer, 96).slice(20, 23), [0, 1, 2]);
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

test("dynamic reflection material requires a complete finite F0/roughness record", async () => {
  const adapterUrl = pathToFileURL(path.resolve(
    here,
    "../../host/ThreeBrowser/web/three-webgpu-gpu.js",
  ));
  const { rtxDynamicReflectionMaterial } = await import(
    `${adapterUrl.href}?dynamic-reflection-material-test`
  );
  const material = rtxDynamicReflectionMaterial({
    radiance: [0.2, 0.1, 0.05, 1],
    surface: [0.71, 0.31, 0.022, 0.055],
  });
  assert.deepEqual(
    Array.from(material.radiance),
    Array.from(new Float32Array([0.2, 0.1, 0.05, 1])),
  );
  assert.deepEqual(
    Array.from(material.surface),
    Array.from(new Float32Array([0.71, 0.31, 0.022, 0.055])),
  );
  assert.throws(
    () => rtxDynamicReflectionMaterial({ surface: [1, 1, 1, 0.1] }),
    /requires both radiance and surface/,
  );
  assert.throws(
    () => rtxDynamicReflectionMaterial({
      radiance: [0, -1, 0, 0],
      surface: [1, 1, 1, 0.1],
    }),
    /finite, non-negative/,
  );
  assert.throws(
    () => rtxDynamicReflectionMaterial({
      radiance: [0, 0, 0, 0],
      surface: [1, 1, 1, 1.01],
    }),
    /roughness in \[0, 1\]/,
  );
});

test("native dynamic reflection contract keeps legacy ABI and caps the material bounce", () => {
  const api = fs.readFileSync(nativeApiPath, "utf8");
  assert.match(api, /version != 1u && version != 2u/);
  assert.match(
    api,
    /offsetof\(TWRayQueryDynamicTriangleMeshFrame, reflection_radiance\)/,
  );
  assert.match(api, /static_assert\(legacyFrameSize == 36u\)/);
  assert.match(api, /std::memcpy\(&copy, frame, std::min<std::size_t>/);

  const bridge = fs.readFileSync(nativeBridgePath, "utf8");
  assert.match(bridge, /instance\.mask = 0x80u/);
  assert.match(
    bridge,
    /g\.dynamicMeshActive && frame\.pipelineHandle != 0u/,
  );

  const shader = fs.readFileSync(reflectionShaderPath, "utf8");
  assert.match(shader, /binding = 12[\s\S]*dynamicWorldPositions/);
  assert.match(shader, /binding = 13[\s\S]*dynamicWorldIndices/);
  assert.match(shader, /binding = 14[\s\S]*dynamicSurfaceResponse/);
  assert.match(shader, /kStaticRoomCullMask = 0x7fu/);
  assert.match(shader, /traceStaticRoomRadiance\(/);
  assert.match(shader, /dynamicMaterialBounce\(/);
  assert.match(shader, /if \(!isDynamicHit\(primitiveBase\)\) return baseRadiance/);
  assert.match(
    shader,
    /baseRadiance \* \(vec3\(1\.0\) - fresnel\)[\s\S]*reflectedRadiance \* fresnel/,
  );
});
