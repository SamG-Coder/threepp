import assert from "node:assert/strict";
import test from "node:test";

import cmd, { OP } from "../../host/ThreeBrowser/web/three-webgpu-cmd.js";

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function resource(textureHandle) {
  return {
    textureHandle,
    vulkanLayout: 2,
    left: 0,
    top: 0,
    width: 1280,
    height: 720,
  };
}

function frame(controlMask, style = 0) {
  return {
    viewport: 3,
    colorInput: resource(11),
    colorOutput: resource(12),
    depth: resource(13),
    motionVectors: resource(14),
    controlMask,
    options: {
      enabled: true,
      intensity: 1,
      localToneStrength: 1,
      localStructureStrength: 1,
      globalToneStrength: 1,
      style,
      renderPreset: 0,
      useAutoMask: !controlMask,
      skinStructureStrength: 1,
      performanceMode: 6,
    },
    constants: {
      cameraViewToClip: identity,
      clipToCameraView: identity,
      clipToLensClip: identity,
      clipToPrevClip: identity,
      prevClipToClip: identity,
      jitterOffset: [0, 0],
      motionVectorScale: [0.5, -0.5],
      cameraPinholeOffset: [0, 0],
      cameraPosition: [0, 0, 0],
      cameraUp: [0, 1, 0],
      cameraRight: [1, 0, 0],
      cameraForward: [0, 0, -1],
      cameraNear: 0.1,
      cameraFar: 1000,
      cameraFov: 1,
      cameraAspectRatio: 16 / 9,
      depthInverted: false,
      cameraMotionIncluded: true,
      motionVectors3D: false,
      reset: false,
      orthographicProjection: false,
      motionVectorsDilated: false,
      motionVectorsJittered: false,
    },
  };
}

test("DLSS Neural Rendering command carries the optional control-mask descriptor", () => {
  const buffer = new ArrayBuffer(4096);
  cmd.attach(buffer);

  cmd.dlssNeuralRenderingEvaluate(7, frame(resource(15), 2));

  const words = new Uint32Array(buffer, 0, cmd.used() / 4);
  assert.equal(cmd.used(), 616);
  assert.deepEqual(Array.from(words.slice(0, 4)), [
    OP.DLSS_NR_EVALUATE, 616, 7, 3,
  ]);
  assert.deepEqual(Array.from(words.slice(28, 36)), [
    15, 2, 0, 0, 1280, 720, 1, 1,
  ]);
  assert.equal(words[40], 2, "style is encoded as its validated integer value");
  cmd.submitNow(true);
});

test("DLSS Neural Rendering preserves the no-control-mask wire shape", () => {
  const buffer = new ArrayBuffer(4096);
  cmd.attach(buffer);

  cmd.dlssNeuralRenderingEvaluate(7, frame(null));

  const words = new Uint32Array(buffer, 0, cmd.used() / 4);
  assert.equal(cmd.used(), 616);
  assert.deepEqual(Array.from(words.slice(28, 35)), [0, 0, 0, 0, 0, 0, 0]);
  assert.equal(words[35], 1);
  cmd.submitNow(true);
});
