import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import {
  collectRenderOnlyDrawables,
  collectRenderOnlyLights,
  createSingleSurfacePresenter,
} from "../src/core/single-surface-presenter.mjs";

test("single-surface presenter stages offscreen and touches the swap chain exactly once", () => {
  let target = null;
  let mrt = null;
  const renders = [];
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.92,
    autoClear: true,
    getDrawingBufferSize: output => output.set(640, 360),
    getRenderTarget: () => target,
    getMRT: () => mrt,
    setRenderTarget: value => { target = value; },
    setMRT: value => { mrt = value; },
    clear() {},
    render(scene, camera) { renders.push({ scene, camera, target, transitVisible: transit.visible }); },
    initRenderTarget() {},
  };
  const transit = new THREE.Group();
  const presenter = createSingleSurfacePresenter({ renderer, hudTexture: new THREE.Texture() });
  try {
    assert.equal(presenter.stage(new THREE.Scene(), new THREE.PerspectiveCamera(), {
      renderOnlyHidden: [transit],
    }), true);
    assert.equal(transit.visible, true, "render-only suppression leaked into gameplay state");
    assert.equal(presenter.present(), true);
    assert.equal(renders.length, 2);
    assert.equal(renders[0].target, presenter.worldTarget, "world must never render directly to the native surface");
    assert.equal(renders[0].transitVisible, false, "the transit vehicle remained in the authored world frame");
    assert.equal(renders[1].target, null, "only the final compositor may acquire the swap chain");
    assert.equal(renders[1].transitVisible, true, "suppression leaked into the compositor/present pass");
    assert.equal(renders.filter(render => render.target === null).length, 1);
    assert.deepEqual(presenter.snapshot(), {
      path: "single-surface-offscreen-composite",
      width: 640,
      height: 360,
      staged: false,
      stagedFrames: 1,
      presentations: 1,
      swapchainRendersPerFrame: 1,
      lastStageRenderOnlyHidden: 1,
      renderOnlyHiddenStages: 1,
      renderOnlyVisibilityRestored: true,
      lastStageRenderOnlyZeroIntensity: 0,
      renderOnlyZeroIntensityStages: 0,
      renderOnlyIntensityRestored: true,
    });
    assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(renderer.toneMappingExposure, 0.92);
    assert.equal(presenter.resize(800, 450), true);
    assert.equal(presenter.snapshot().width, 800);
  } finally {
    presenter.dispose();
  }
});

test("render-only visibility is restored exactly when world rendering throws", () => {
  let target = null;
  let mrt = "original-mrt";
  const visibleTransit = new THREE.Group();
  const alreadyHidden = new THREE.Group();
  alreadyHidden.visible = false;
  let observedDuringRender = null;
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 0.87,
    autoClear: true,
    getDrawingBufferSize: output => output.set(640, 360),
    getRenderTarget: () => target,
    getMRT: () => mrt,
    setRenderTarget: value => { target = value; },
    setMRT: value => { mrt = value; },
    clear() {},
    render() {
      observedDuringRender = [visibleTransit.visible, alreadyHidden.visible];
      throw new Error("synthetic world render failure");
    },
    initRenderTarget() {},
  };
  const presenter = createSingleSurfacePresenter({ renderer });
  try {
    assert.throws(() => presenter.stage(new THREE.Scene(), new THREE.PerspectiveCamera(), {
      renderOnlyHidden: [visibleTransit, alreadyHidden, visibleTransit, null],
    }), /synthetic world render failure/);
    assert.deepEqual(observedDuringRender, [false, false],
      "every requested live object must be hidden for the failing render itself");
    assert.equal(visibleTransit.visible, true,
      "a render exception stranded the normally visible transit vehicle");
    assert.equal(alreadyHidden.visible, false,
      "a render exception changed an object that was already hidden");
    assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(renderer.toneMappingExposure, 0.87);
    assert.equal(renderer.autoClear, true);
    assert.equal(target, null);
    assert.equal(mrt, "original-mrt");
    assert.equal(presenter.snapshot().lastStageRenderOnlyHidden, 2,
      "duplicate objects must be suppressed and restored only once");
    assert.equal(presenter.snapshot().renderOnlyVisibilityRestored, true);
  } finally {
    presenter.dispose();
  }
});

test("cinematic drawable suppression preserves the resident light graph", () => {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const nested = new THREE.Group();
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(), new THREE.MeshBasicMaterial());
  const headlight = new THREE.SpotLight(0xffffff, 12);
  nested.add(wheel);
  root.add(body, nested, headlight, headlight.target);
  const drawables = collectRenderOnlyDrawables(root);
  assert.deepEqual(drawables, [body, wheel]);
  const lights = collectRenderOnlyLights(root);
  assert.deepEqual(lights, [headlight]);

  let target = null;
  let observed = null;
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping,
    toneMappingExposure: 1,
    autoClear: true,
    getDrawingBufferSize: output => output.set(320, 180),
    getRenderTarget: () => target,
    getMRT: () => null,
    setRenderTarget: value => { target = value; },
    setMRT() {}, clear() {}, initRenderTarget() {},
    render() {
      observed = {
        root: root.visible,
        body: body.visible,
        wheel: wheel.visible,
        light: headlight.visible,
        intensity: headlight.intensity,
      };
    },
  };
  const presenter = createSingleSurfacePresenter({ renderer });
  try {
    presenter.stage(new THREE.Scene(), new THREE.PerspectiveCamera(), {
      renderOnlyHidden: drawables,
      renderOnlyZeroIntensity: lights,
    });
    assert.deepEqual(observed, { root: true, body: false, wheel: false, light: true, intensity: 0 });
    assert.equal(root.visible, true);
    assert.equal(body.visible, true);
    assert.equal(wheel.visible, true);
    assert.equal(headlight.visible, true);
    assert.equal(headlight.intensity, 12);
    assert.equal(presenter.snapshot().lastStageRenderOnlyHidden, 2);
    assert.equal(presenter.snapshot().lastStageRenderOnlyZeroIntensity, 1);
    assert.equal(presenter.snapshot().renderOnlyIntensityRestored, true);
  } finally {
    presenter.dispose();
    body.geometry.dispose();
    body.material.dispose();
    wheel.geometry.dispose();
    wheel.material.dispose();
  }
});
