import * as THREE from "three/webgpu";
import { createAtmosphere } from "../atmosphere.mjs";
import { createFaceOnCamera } from "../camera.mjs";
import { createFlora } from "../flora.mjs";
import { createHills } from "../hills.mjs";
import { createInput } from "../input.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "../native-rtx-renderer.mjs";
import { createRiver } from "../river.mjs";
import { collectStaticRiverScene } from "../rtx-scene.mjs";
import { createTerrain } from "../terrain.mjs";
import { createTreeFlats } from "../trees.mjs";
import { createWalker } from "../walker.mjs";

const cutoutTintColor = new THREE.Color();

function applyCutoutTint(preset, trees, flora, walker) {
  const tint = preset?.treeTint ?? [1, 1, 1];
  cutoutTintColor.setRGB(tint[0], tint[1], tint[2]);
  trees.setTint?.(cutoutTintColor);
  flora.setTint?.(cutoutTintColor);
  walker.setTint?.(cutoutTintColor);
}

function positiveSize(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}

/**
 * The committed riverbank study, isolated behind the shared app-mode contract.
 * Its world construction, update ordering and native/raster present path remain
 * the same as the original standalone main module.
 */
export async function createDemoMode({ renderer, rtx, viewport }) {
  if (!renderer) throw new TypeError("Secret River demo needs the shared renderer.");
  let currentViewport = { ...viewport };
  let disposed = false;

  const scene = new THREE.Scene();
  scene.name = "Hawkesbury riverbank";
  scene.userData.renderer = renderer;
  const camera = new THREE.PerspectiveCamera(
    52,
    positiveSize(currentViewport.width) / positiveSize(currentViewport.height),
    0.15,
    280,
  );

  const atmosphere = createAtmosphere(scene);
  const terrain = await createTerrain();
  scene.add(terrain.group);
  const river = createRiver();
  scene.add(river.mesh);
  const hills = await createHills();
  scene.add(hills.group);
  const trees = await createTreeFlats();
  scene.add(trees.group);
  const flora = await createFlora();
  scene.add(flora.group);
  const walker = await createWalker();
  scene.add(walker.mesh);
  applyCutoutTint(atmosphere.getPreset(), trees, flora, walker);

  const follow = createFaceOnCamera(camera, walker);
  follow.update(1);
  atmosphere.updateFocus(walker.position, 1);
  const input = createInput();

  prepareRtxGuideMaterials(scene);
  // The planar reflector sees the actual alpha-cutout artwork. Native scene
  // hits use simplified shadow volumes, so applying those reflections to the
  // creek would replace faithful trees with opaque proxy blobs.
  river.mesh.material.rtxReflectionMask = 0;

  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx);
  let staticScene = null;
  if (rtx && (typeof rtx.evaluateRayLighting === "function" ||
      typeof rtx.evaluateRayReflections === "function")) {
    try {
      staticScene = collectStaticRiverScene(
        [
          ...terrain.rtxRoots,
          ...(hills.rtxRoots ?? []),
          ...trees.rtxRoots,
          ...(flora.rtxRoots ?? []),
        ],
        atmosphere.campfire ? [atmosphere.campfire] : [],
      );
    } catch (error) {
      console.warn(`[Secret River RTX] Static-scene collection failed: ${error?.message || error}`);
    } finally {
      trees.hideProxies();
      flora.hideProxies?.();
    }
  } else {
    trees.hideProxies();
    flora.hideProxies?.();
  }

  const initialWidth = positiveSize(currentViewport.internalWidth);
  const initialHeight = positiveSize(currentViewport.internalHeight);
  nativeRenderer.resize(initialWidth, initialHeight);
  const nativeConfigured = staticScene
    ? await nativeRenderer.configure(initialWidth, initialHeight, staticScene)
    : false;

  const state = {
    elapsed: 0,
  };
  let diagnosticTime = 0;
  let diagnosticFrames = 0;
  let diagnosticWallTime = 0;

  function useNativePath() {
    return Boolean(nativeConfigured && nativeRenderer.rayLightingReady);
  }

  function syncShadowPath() {
    atmosphere.setRayTracedShadows(useNativePath());
  }

  syncShadowPath();

  function resize(nextViewport) {
    if (disposed) return;
    currentViewport = { ...nextViewport };
    follow.resize(positiveSize(currentViewport.width), positiveSize(currentViewport.height));
    nativeRenderer.resize(
      positiveSize(currentViewport.internalWidth),
      positiveSize(currentViewport.internalHeight),
    );
    syncShadowPath();
  }

  resize(currentViewport);

  return {
    id: "demo",
    resize,
    frame({ delta, wallDelta }) {
      if (disposed) return;
      state.elapsed += delta;
      diagnosticTime += delta;
      diagnosticFrames += 1;
      diagnosticWallTime += wallDelta;

      walker.update(delta, input.axis());
      follow.update(delta);
      const preset = atmosphere.updateCycle(state.elapsed);
      applyCutoutTint(preset, trees, flora, walker);
      atmosphere.updateFocus(walker.position, delta);
      river.update(state.elapsed);
      flora.update?.(state.elapsed);
      trees.update?.(state.elapsed);

      renderer.info.reset();
      let nativeRendered = false;
      let offscreenRendered = false;
      if (useNativePath()) {
        nativeRendered = nativeRenderer.render(scene, camera, {
          skipReflections: true,
          skipLighting: false,
          celestialDirection: atmosphere.sunDirection,
          celestialIntensity: preset.rtxCelestialIntensity,
          shadowStrength: preset.rtxShadowStrength,
          aoStrength: preset.rtxAoStrength,
        });
      }
      if (!nativeRendered) {
        if (!nativeRenderer.rayLightingReady) syncShadowPath();
        offscreenRendered = nativeRenderer.renderRaster(scene, camera);
      }
      if (nativeRendered || offscreenRendered) {
        if (!nativeRenderer.present(null, 0)) {
          nativeRendered = false;
          offscreenRendered = false;
        }
      }
      if (!nativeRendered && !offscreenRendered) {
        renderer.setRenderTarget(null);
        renderer.setMRT(null);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
      }

      if (diagnosticTime >= 7) {
        diagnosticTime = 0;
        const fps = diagnosticWallTime > 0 ? Math.round(diagnosticFrames / diagnosticWallTime) : 0;
        const renderInfo = renderer.info?.render ?? {};
        console.log(
          `[Secret River] fps=${fps}` +
          ` · calls=${renderInfo.drawCalls ?? renderInfo.calls ?? 0}` +
          ` · trees=${trees.records.length}` +
          ` · flora=${flora.records.length}` +
          ` · atmosphere=${preset.name}` +
          ` · path=${nativeRendered || offscreenRendered ? nativeRenderer.lastPath : "webgpu-fallback"}` +
          ` · pos=${walker.position.x.toFixed(1)},${walker.position.z.toFixed(1)}`,
        );
        diagnosticFrames = 0;
        diagnosticWallTime = 0;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      input.dispose();
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      nativeRenderer.dispose();
      atmosphere.dispose();
      terrain.dispose();
      river.dispose();
      hills.dispose();
      trees.dispose();
      flora.dispose();
      walker.dispose();
      scene.clear();
    },
  };
}
