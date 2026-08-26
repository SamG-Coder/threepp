import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { warmRendererPipelines } from "../src/core/pipeline-warmup.mjs";
import {
  createInteriorTextureSet,
  createSurfaceTextureSet,
  disposeSurfaceTextureSets,
} from "../src/world/surface-textures.mjs";
import { createInteriorMappedMaterial } from "../src/world/interior-mapping.mjs";
import { createGtaHud } from "../src/ui/hud.mjs";

test("pipeline warmup renders hidden branches and restores scene and renderer state", async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
  hidden.visible = false;
  hidden.frustumCulled = true;
  scene.add(hidden);
  const originalTarget = { name: "original" };
  const warmTarget = { name: "warm" };
  const calls = [];
  const renderer = {
    toneMapping: 7,
    toneMappingExposure: 0.8,
    autoClear: true,
    target: originalTarget,
    mrt: { name: "mrt" },
    getRenderTarget() { return this.target; },
    getMRT() { return this.mrt; },
    setRenderTarget(value) { this.target = value; calls.push(["target", value]); },
    setMRT(value) { this.mrt = value; },
    async compileAsync(passScene) { calls.push(["compile", hidden.visible, passScene]); },
    clear() { calls.push(["clear"]); },
    render(passScene, passCamera) { calls.push(["render", hidden.visible, passScene, passCamera, this.target]); },
  };
  try {
    const result = await warmRendererPipelines(renderer, [{
      label: "all-hidden",
      scene,
      camera,
      target: warmTarget,
      revealAll: true,
      toneMapping: 0,
      exposure: 1,
    }]);
    assert.equal(result.ready, true);
    assert.equal(result.policy, "startup-preload-all-authored-branches");
    assert.equal(result.passes.length, 1);
    assert.equal(result.passes[0].materials, 1);
    assert.equal(result.passes[0].renders, 1);
    assert.equal(result.passes[0].compileMode, "async");
    assert.equal(result.asyncCompilePasses, 1);
    assert.equal(result.renderDrivenPasses, 0);
    assert.equal(result.storage, "memory-only");
    assert.equal(result.diskCache, false);
    assert.ok(calls.some(call => call[0] === "compile" && call[1] === true));
    assert.ok(calls.some(call => call[0] === "render" && call[1] === true && call[4] === warmTarget));
    assert.equal(hidden.visible, false);
    assert.equal(hidden.frustumCulled, true);
    assert.equal(renderer.target, originalTarget);
    assert.deepEqual(renderer.mrt, { name: "mrt" });
    assert.equal(renderer.toneMapping, 7);
    assert.equal(renderer.toneMappingExposure, 0.8);
    assert.equal(renderer.autoClear, true);
  } finally {
    hidden.geometry.dispose();
    hidden.material.dispose();
  }
});

test("render-driven warmup avoids per-object async yields while preserving reveal-all coverage", async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicNodeMaterial());
  hidden.visible = false;
  scene.add(hidden);
  let compileCalls = 0;
  let renderCalls = 0;
  const renderer = {
    toneMapping: 7,
    toneMappingExposure: 0.8,
    autoClear: true,
    target: null,
    getRenderTarget() { return this.target; },
    getMRT() { return null; },
    setRenderTarget(value) { this.target = value; },
    setMRT() {},
    async compileAsync() { compileCalls += 1; },
    clear() {},
    render() {
      renderCalls += 1;
      assert.equal(hidden.visible, true, "the real warm render must cover hidden authored branches");
    },
  };
  try {
    const result = await warmRendererPipelines(renderer, [{
      label: "render-driven",
      scene,
      camera,
      revealAll: true,
      compileMode: "render",
    }]);
    assert.equal(compileCalls, 0, "render-driven startup must not enter Three's per-object yielding compiler");
    assert.equal(renderCalls, 1);
    assert.equal(result.passes[0].compileMode, "render");
    assert.equal(result.renderDrivenPasses, 1);
    assert.equal(result.asyncCompilePasses, 0);
    assert.equal(hidden.visible, false);
  } finally {
    hidden.geometry.dispose();
    hidden.material.dispose();
  }
});

test("warmup explicitly uploads generated PBR maps and nested virtual-interior textures", async () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const surface = createSurfaceTextureSet("asphalt", { repeat: [4, 7], normalStrength: 2.3 });
  const interior = createInteriorTextureSet(1, { roomCount: 4, roomWidth: 12, height: 32 });
  const pbrMaterial = new THREE.MeshStandardNodeMaterial({
    map: surface.albedo,
    roughnessMap: surface.roughness,
    normalMap: surface.normal,
  });
  const interiorController = createInteriorMappedMaterial(interior, { style: 1 });
  const pbrGeometry = new THREE.BoxGeometry();
  const interiorGeometry = new THREE.PlaneGeometry();
  scene.add(
    new THREE.Mesh(pbrGeometry, pbrMaterial),
    new THREE.Mesh(interiorGeometry, interiorController.material),
  );
  const uploads = [];
  const renderer = {
    toneMapping: 0,
    toneMappingExposure: 1,
    autoClear: true,
    getRenderTarget() { return null; },
    getMRT() { return null; },
    setRenderTarget() {},
    setMRT() {},
    initTexture(texture) { uploads.push(texture); },
    clear() {},
    render() {},
  };
  try {
    const result = await warmRendererPipelines(renderer, [{
      scene,
      camera,
      revealAll: true,
      compileMode: "render",
    }]);
    assert.equal(result.textures, 7, "three PBR maps and four room-box layers must be discovered");
    assert.equal(result.textureSourcesReady, 7);
    assert.equal(result.explicitTextureUploads, 7);
    assert.equal(result.allTextureSourcesReady, true);
    assert.deepEqual(result.pendingTextureSources, []);
    assert.equal(result.textureUploadPolicy, "explicit-initTexture-plus-real-render");
    assert.equal(result.textureStorage, "memory-only");
    assert.equal(result.textureDiskCache, false);
    assert.equal(result.passes[0].textures, 7);
    assert.equal(result.passes[0].textureSourcesReady, 7);
    assert.equal(result.passes[0].explicitTextureUploads, 7);
    assert.deepEqual(new Set(uploads), new Set([...surface.textures, ...interior.textures]));
  } finally {
    pbrGeometry.dispose();
    interiorGeometry.dispose();
    pbrMaterial.dispose();
    interiorController.material.dispose();
    disposeSurfaceTextureSets([surface, interior]);
  }
});

test("reveal-all HUD warmup uploads the font, panel skins and pooled minimap", async () => {
  const uploads = [];
  const renderer = {
    toneMapping: 0,
    toneMappingExposure: 1,
    autoClear: true,
    target: null,
    getSize(vector) { return vector.set(1280, 720); },
    getDrawingBufferSize(vector) { return vector.set(1280, 720); },
    getRenderTarget() { return this.target; },
    getMRT() { return null; },
    setRenderTarget(value) { this.target = value; },
    setMRT() {},
    initTexture(texture) { uploads.push(texture); },
    clear() {},
    render() {},
  };
  const hud = createGtaHud({ renderer });
  try {
    const result = await warmRendererPipelines(renderer, [{
      scene: hud.scene,
      camera: hud.camera,
      target: hud.target,
      revealAll: true,
      compileMode: "render",
    }]);
    assert.equal(result.textures, 5);
    assert.equal(result.explicitTextureUploads, 5);
    assert.equal(result.allTextureSourcesReady, true);
    assert.deepEqual(result.passes[0].textureNames, [
      "Neon City GPU bitmap font",
      "Neon City baked-alpha black HUD backdrop",
      "Neon City pooled raster navigation map",
      "Neon Life phone canvas fallback",
      "Neon Life tintable rounded panel texture",
    ]);
    assert.equal(new Set(uploads).size, 5);
    assert.ok(uploads.includes(hud.minimapTexture));
  } finally {
    hud.dispose();
  }
});
