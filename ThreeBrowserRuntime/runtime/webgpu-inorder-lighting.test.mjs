import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterPath = path.resolve(
  here,
  "../../host/ThreeBrowser/web/three-webgpu-gpu.js",
);

test("in-order native lighting accepts ended passes, AS work, and repeated evaluations", async () => {
  const adapterUrl = pathToFileURL(adapterPath);
  const { validateNativeEncoderPassOrder } = await import(
    `${adapterUrl.href}?inorder-lighting-test`
  );
  assert.equal(validateNativeEncoderPassOrder([
    ["computeBegin"],
    ["computePipe", {}],
    ["dispatch", 1, 1, 1],
    ["computeEnd"],
    ["rtxDynamicMeshRefit", {}],
    ["rtxLightingEvaluate", {}],
    ["rtxLightingEvaluate", {}],
  ], "evaluateRayLighting"), true);

  assert.throws(
    () => validateNativeEncoderPassOrder([
      ["computeBegin"],
      ["dispatch", 1, 1, 1],
    ], "evaluateRayLighting"),
    /after the active WebGPU compute pass is ended/,
  );
  assert.throws(
    () => validateNativeEncoderPassOrder([
      ["renderBegin"],
      ["computeBegin"],
    ], "evaluateRayLighting"),
    /overlapping render and compute passes/,
  );
});

test("evaluateRayLighting uses the in-order encoder contract", () => {
  const source = fs.readFileSync(adapterPath, "utf8");
  const start = source.indexOf("const evaluateRayLighting =");
  const end = source.indexOf("const evaluateRayReflections =", start);
  assert.ok(start >= 0 && end > start, "lighting implementation block must exist");
  const implementation = source.slice(start, end);
  assert.match(implementation, /inOrderNativeEncoder\(frame\.commandEncoder/);
  assert.doesNotMatch(implementation, /dedicatedNativeEncoder\(frame\.commandEncoder/);
});

test("logical in-order encoders split WebGPU and raw Vulkan physical encoders", async () => {
  const adapterUrl = pathToFileURL(adapterPath);
  const { replayCommandBuffer } = await import(
    `${adapterUrl.href}?physical-encoder-segmentation-test`
  );
  const calls = [];
  let nextHandle = 100;
  const sink = new Proxy({
    allocHandle() { return ++nextHandle; },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => calls.push([property, ...args]);
    },
  });
  replayCommandBuffer({
    _h: 7,
    _commands: [
      ["computeBegin"],
      ["computeEnd"],
      ["rtxDynamicMeshRefit", { handle: 1 }],
      ["rtxLightingEvaluate", { frame: 1 }],
      ["rtxLightingEvaluate", { frame: 2 }],
      ["copyBuf", { _h: 31 }, 4, { _h: 32 }, 8, 16],
    ],
  }, sink);

  assert.deepEqual(calls, [
    ["encBegin", 7],
    ["computeBegin", 7],
    ["computeEnd", 7],
    ["submitEncoders", [7]],
    ["encBegin", 101],
    ["rtxDynamicMeshRefit", 101, { handle: 1 }],
    ["submitEncoders", [101]],
    ["encBegin", 102],
    ["rtxLightingEvaluate", 102, { frame: 1 }],
    ["submitEncoders", [102]],
    ["encBegin", 103],
    ["rtxLightingEvaluate", 103, { frame: 2 }],
    ["submitEncoders", [103]],
    ["encBegin", 104],
    ["copyBuf", 104, 31, 32, 4, 8, 16],
    ["submitEncoders", [104]],
  ]);
});
