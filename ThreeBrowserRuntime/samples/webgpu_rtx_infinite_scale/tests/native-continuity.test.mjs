import assert from "node:assert/strict";
import test from "node:test";
import { NativeReflectionRenderer } from "../src/native-reflections.mjs";

function bareRenderer(overrides = {}) {
  return Object.assign(Object.create(NativeReflectionRenderer.prototype), overrides);
}

test("raster handoffs invalidate stale adaptive presentation state", () => {
  const target = { texture: { id: "raster" } };
  const renderer = bareRenderer({
    adaptiveFrameReady: true,
    _lastFrameConstants: { stale: true },
    _ensureRasterTarget() { return target; },
    _renderLinearScene(scene, camera, actualTarget) {
      assert.equal(actualTarget, target);
    },
  });

  assert.equal(renderer.renderRaster({}, {}, 640, 360), true);
  assert.equal(renderer.adaptiveFrameReady, false);
  assert.equal(renderer._lastFrameConstants, null);
});

test("raster texture cannot enter the adaptive/Frame Generation branch", () => {
  const nativeTexture = { id: "native" };
  const rasterTexture = { id: "raster" };
  let displayed = null;
  let frameGenerationTags = 0;
  const renderer = bareRenderer({
    outputTarget: { texture: nativeTexture },
    hudlessTarget: {},
    adaptiveEnabled: true,
    adaptiveFrameReady: true,
    _lastFrameConstants: { stale: true },
    frameGenerationRequested: true,
    frameGenerationWarmup: 0,
    rtx: { tagFrameGeneration() { frameGenerationTags += 1; } },
    _setDisplayTexture(texture) { displayed = texture; },
    _setHudTexture() {},
    _hudQuad: { visible: false },
    _displayScene: {},
    _displayCamera: {},
    renderer: {
      autoClear: false,
      setRenderTarget() {},
      setMRT() {},
      render() {},
    },
  });

  assert.equal(renderer.present(null, rasterTexture), true);
  assert.equal(displayed, rasterTexture);
  assert.equal(frameGenerationTags, 0);
});

test("temporal reset invalidates the previously completed adaptive frame", () => {
  const renderer = bareRenderer({
    resetHistory: false,
    adaptiveFrameReady: true,
    _lastFrameConstants: { stale: true },
    frameGenerationRequested: true,
    frameGenerationWarmup: 0,
    presentationPath: "",
  });

  renderer.resetTemporalHistory("scale rebase");
  assert.equal(renderer.resetHistory, true);
  assert.equal(renderer.adaptiveFrameReady, false);
  assert.equal(renderer._lastFrameConstants, null);
  assert.ok(renderer.frameGenerationWarmup > 0);
});
