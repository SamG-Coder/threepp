import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createFrameCapture } from "../src/core/capture.mjs";

test("development capture restores render-only visibility and camera state when rendering throws", async () => {
  const originalTarget = { name: "original-target" };
  const originalMrt = { name: "original-mrt" };
  let activeTarget = originalTarget;
  let activeMrt = originalMrt;
  const transit = new THREE.Group();
  const headlight = new THREE.SpotLight(0xffffff, 18);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const originalAspect = camera.aspect;
  let renderState = null;
  const renderer = {
    getRenderTarget: () => activeTarget,
    getMRT: () => activeMrt,
    setRenderTarget: value => { activeTarget = value; },
    setMRT: value => { activeMrt = value; },
    clear() {},
    render() {
      renderState = { visible: transit.visible, intensity: headlight.intensity };
      throw new Error("synthetic capture render failure");
    },
  };
  const capture = createFrameCapture({
    renderer,
    scene: new THREE.Scene(),
    camera,
    hud: null,
  });
  try {
    await assert.rejects(capture.capture("unused.png", {
      width: 960,
      height: 540,
      renderOnlyHidden: [transit],
      renderOnlyZeroIntensity: [headlight],
    }), /synthetic capture render failure/);
    assert.equal(renderState.visible, false,
      "the Pulse Line remained visible in the direct capture render");
    assert.equal(renderState.intensity, 0,
      "the hidden Pulse Line still illuminated the direct capture");
    assert.equal(transit.visible, true,
      "capture failure stranded the Pulse Line outside its logical visibility state");
    assert.equal(headlight.intensity, 18,
      "capture failure stranded the Pulse Line headlight at zero intensity");
    assert.equal(activeTarget, originalTarget);
    assert.equal(activeMrt, originalMrt);
    assert.equal(camera.aspect, originalAspect);
  } finally {
    capture.dispose();
  }
});
