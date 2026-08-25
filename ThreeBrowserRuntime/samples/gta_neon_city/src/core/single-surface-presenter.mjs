import * as THREE from "three/webgpu";

function positiveInteger(value, fallback = 1) {
  const resolved = Math.trunc(Number(value));
  return Number.isFinite(resolved) && resolved > 0 ? resolved : fallback;
}

/**
 * Temporarily changes only Object3D.visible for one synchronous render call.
 * Scratch storage is retained in RAM and reused, so an authored cutscene does
 * not allocate a second vehicle, mutate simulation state, or allocate a guard
 * array every frame. Call restore from a finally block.
 */
export function createRenderOnlyVisibilityGuard() {
  const targets = [];
  const originalVisibility = [];
  let count = 0;

  function hide(values) {
    if (count) throw new Error("render-only visibility guard is already active");
    const sourceIsArray = Array.isArray(values);
    const length = sourceIsArray ? values.length : values ? 1 : 0;
    for (let index = 0; index < length; ++index) {
      const object = sourceIsArray ? values[index] : values;
      if (!object?.isObject3D) continue;
      let duplicate = false;
      for (let prior = 0; prior < count; ++prior) {
        if (targets[prior] !== object) continue;
        duplicate = true;
        break;
      }
      if (duplicate) continue;
      targets[count] = object;
      originalVisibility[count] = object.visible;
      object.visible = false;
      count += 1;
    }
    return count;
  }

  function restore() {
    const restored = count;
    for (let index = count - 1; index >= 0; --index) {
      targets[index].visible = originalVisibility[index];
      targets[index] = null;
      originalVisibility[index] = false;
    }
    count = 0;
    return restored;
  }

  function isActive() { return count > 0; }

  return Object.freeze({ hide, restore, isActive });
}

/**
 * Resolves only draw submissions below a root. Lights and structural groups
 * deliberately remain visible so a cinematic occluder cannot change Three's
 * LightsNode cache key and trigger an in-play pipeline rebuild.
 */
export function collectRenderOnlyDrawables(root) {
  const drawables = [];
  root?.traverse?.(object => {
    if (object?.isMesh || object?.isLine || object?.isPoints || object?.isSprite) {
      drawables.push(object);
    }
  });
  return Object.freeze(drawables);
}

export function collectRenderOnlyLights(...roots) {
  const lights = [];
  for (const root of roots) {
    root?.traverse?.(object => {
      if (object?.isLight && !lights.includes(object)) lights.push(object);
    });
  }
  return Object.freeze(lights);
}

/** Keeps resident light objects in the graph while removing their visual spill. */
export function createRenderOnlyIntensityGuard() {
  const targets = [];
  const originalIntensity = [];
  let count = 0;

  function zero(values) {
    if (count) throw new Error("render-only intensity guard is already active");
    const sourceIsArray = Array.isArray(values);
    const length = sourceIsArray ? values.length : values ? 1 : 0;
    for (let index = 0; index < length; ++index) {
      const light = sourceIsArray ? values[index] : values;
      if (!light?.isLight || !Number.isFinite(Number(light.intensity))) continue;
      let duplicate = false;
      for (let prior = 0; prior < count; ++prior) {
        if (targets[prior] !== light) continue;
        duplicate = true;
        break;
      }
      if (duplicate) continue;
      targets[count] = light;
      originalIntensity[count] = light.intensity;
      light.intensity = 0;
      count += 1;
    }
    return count;
  }

  function restore() {
    const restored = count;
    for (let index = count - 1; index >= 0; --index) {
      targets[index].intensity = originalIntensity[index];
      targets[index] = null;
      originalIntensity[index] = 0;
    }
    count = 0;
    return restored;
  }

  function isActive() { return count > 0; }

  return Object.freeze({ zero, restore, isActive });
}

/**
 * Stages the 3D world and transparent HUD away from the native canvas, then
 * composites both layers in exactly one render to the swap-chain surface.
 * ThreeBrowserRuntime presents every default-target render independently, so
 * drawing the HUD to the canvas as a second pass would replace the world frame.
 */
export function createSingleSurfacePresenter({ renderer, hudTexture = null } = {}) {
  if (!renderer) throw new TypeError("createSingleSurfacePresenter requires a renderer");
  const drawingSize = renderer.getDrawingBufferSize?.(new THREE.Vector2()) ?? new THREE.Vector2(1, 1);
  let width = positiveInteger(drawingSize.x);
  let height = positiveInteger(drawingSize.y);
  const worldTarget = new THREE.RenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  worldTarget.texture.name = "GTA Neon City linear world staging texture";
  worldTarget.texture.colorSpace = THREE.NoColorSpace;
  worldTarget.texture.generateMipmaps = false;
  worldTarget.texture.mipmapsAutoUpdate = false;
  renderer.initRenderTarget?.(worldTarget);

  const scene = new THREE.Scene();
  scene.name = "GTA Neon City single-surface world and HUD presentation";
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uvs = geometry.getAttribute("uv");
  for (let index = 0; index < uvs.count; ++index) uvs.setY(index, 1 - uvs.getY(index));
  uvs.needsUpdate = true;

  const worldMaterial = new THREE.MeshBasicNodeMaterial({
    map: worldTarget.texture,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  worldMaterial.toneMapped = true;
  const worldQuad = new THREE.Mesh(geometry, worldMaterial);
  worldQuad.name = "Tonemapped staged city frame";
  worldQuad.frustumCulled = false;
  worldQuad.renderOrder = 0;
  scene.add(worldQuad);

  const hudMaterial = new THREE.MeshBasicNodeMaterial({
    map: hudTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  hudMaterial.toneMapped = false;
  const hudQuad = new THREE.Mesh(geometry, hudMaterial);
  hudQuad.name = "Transparent GPU HUD compositor layer";
  hudQuad.frustumCulled = false;
  hudQuad.renderOrder = 1;
  hudQuad.visible = Boolean(hudTexture);
  scene.add(hudQuad);

  let staged = false;
  let stagedFrames = 0;
  let presentations = 0;
  let disposed = false;
  let lastStageRenderOnlyHidden = 0;
  let renderOnlyHiddenStages = 0;
  let lastStageRenderOnlyZeroIntensity = 0;
  let renderOnlyZeroIntensityStages = 0;
  const renderVisibility = createRenderOnlyVisibilityGuard();
  const renderIntensity = createRenderOnlyIntensityGuard();

  function resize(nextWidth = null, nextHeight = null) {
    if (disposed) return false;
    if (nextWidth === null || nextHeight === null) {
      const size = renderer.getDrawingBufferSize?.(new THREE.Vector2()) ?? new THREE.Vector2(width, height);
      nextWidth = size.x;
      nextHeight = size.y;
    }
    const resolvedWidth = positiveInteger(nextWidth, width);
    const resolvedHeight = positiveInteger(nextHeight, height);
    if (resolvedWidth === width && resolvedHeight === height) return false;
    width = resolvedWidth;
    height = resolvedHeight;
    worldTarget.setSize(width, height);
    staged = false;
    return true;
  }

  function stage(worldScene, worldCamera, options = null) {
    if (disposed) return false;
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    const previousMrt = renderer.getMRT?.() ?? null;
    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousAutoClear = renderer.autoClear;
    try {
      lastStageRenderOnlyHidden = renderVisibility.hide(options?.renderOnlyHidden);
      if (lastStageRenderOnlyHidden > 0) renderOnlyHiddenStages += 1;
      lastStageRenderOnlyZeroIntensity = renderIntensity.zero(options?.renderOnlyZeroIntensity);
      if (lastStageRenderOnlyZeroIntensity > 0) renderOnlyZeroIntensityStages += 1;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
      renderer.autoClear = false;
      renderer.setMRT?.(null);
      renderer.setRenderTarget(worldTarget);
      // This clear is strictly offscreen; it cannot acquire or present a
      // swap-chain texture.
      renderer.clear(true, true, true);
      renderer.render(worldScene, worldCamera);
      staged = true;
      stagedFrames += 1;
      return true;
    } finally {
      // Restore scene visibility before any renderer-state restoration can
      // throw, so a failed render can never strand a live gameplay object.
      renderVisibility.restore();
      renderIntensity.restore();
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT?.(previousMrt);
      renderer.toneMapping = previousToneMapping;
      renderer.toneMappingExposure = previousExposure;
      renderer.autoClear = previousAutoClear;
    }
  }

  function present() {
    if (disposed || !staged) return false;
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.setRenderTarget(null);
      renderer.setMRT?.(null);
      renderer.autoClear = true;
      // The only default-target render in the frame. autoClear folds the clear
      // into this same render pass, avoiding a separate black presentation.
      renderer.render(scene, camera);
      presentations += 1;
      staged = false;
      return true;
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  }

  function snapshot() {
    return Object.freeze({
      path: "single-surface-offscreen-composite",
      width,
      height,
      staged,
      stagedFrames,
      presentations,
      swapchainRendersPerFrame: 1,
      lastStageRenderOnlyHidden,
      renderOnlyHiddenStages,
      renderOnlyVisibilityRestored: !renderVisibility.isActive(),
      lastStageRenderOnlyZeroIntensity,
      renderOnlyZeroIntensityStages,
      renderOnlyIntensityRestored: !renderIntensity.isActive(),
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    worldTarget.dispose();
    geometry.dispose();
    worldMaterial.dispose();
    hudMaterial.dispose();
    scene.clear();
  }

  return Object.freeze({ worldTarget, scene, camera, stage, present, resize, snapshot, dispose });
}
