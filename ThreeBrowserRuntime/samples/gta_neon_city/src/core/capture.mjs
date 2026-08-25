import * as THREE from "three/webgpu";
import {
  createRenderOnlyIntensityGuard,
  createRenderOnlyVisibilityGuard,
} from "./single-surface-presenter.mjs";

export function createFrameCapture({ renderer, scene, camera, hud } = {}) {
  let target = null;
  const renderVisibility = createRenderOnlyVisibilityGuard();
  const renderIntensity = createRenderOnlyIntensityGuard();

  async function capture(filePath, {
    width = 1280,
    height = 720,
    renderOnlyHidden = null,
    renderOnlyZeroIntensity = null,
  } = {}) {
    const captureWidth = Math.max(320, Math.min(1920, Math.trunc(Number(width) || 1280)));
    const captureHeight = Math.max(180, Math.min(1080, Math.trunc(Number(height) || 720)));
    if (!target) {
      target = new THREE.RenderTarget(captureWidth, captureHeight, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
        generateMipmaps: false,
      });
      target.texture.name = "GTA Neon City development capture";
    } else target.setSize(captureWidth, captureHeight);

    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT();
    const previousAspect = camera.aspect;
    try {
      camera.aspect = captureWidth / captureHeight;
      camera.updateProjectionMatrix();
      renderer.setMRT(null);
      renderer.setRenderTarget(target);
      renderer.clear(true, true, true);
      renderVisibility.hide(renderOnlyHidden);
      renderIntensity.zero(renderOnlyZeroIntensity);
      try {
        renderer.render(scene, camera);
      } finally {
        renderVisibility.restore();
        renderIntensity.restore();
      }
      hud?.render?.();
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, captureWidth, captureHeight);
      const canvas = document.createElement("canvas");
      canvas.width = captureWidth;
      canvas.height = captureHeight;
      const context = canvas.getContext("2d");
      // ThreeBrowserRuntime's WebGPU readback is already top-down. Keeping the
      // byte order intact also makes GPU HUD text readable in captured frames.
      context.putImageData(new ImageData(new Uint8ClampedArray(pixels), captureWidth, captureHeight), 0, 0);
      const [{ writeFile, mkdir }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
      const resolved = filePath
        ? path.resolve(String(filePath))
        : path.join(globalThis.process?.env?.TEMP || globalThis.process?.cwd?.() || ".", `gta-neon-city-${Date.now()}.png`);
      await mkdir(path.dirname(resolved), { recursive: true });
      await writeFile(resolved, canvas.toBuffer("image/png"));
      return { path: resolved, width: captureWidth, height: captureHeight };
    } finally {
      renderVisibility.restore();
      renderIntensity.restore();
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMrt);
      camera.aspect = previousAspect;
      camera.updateProjectionMatrix();
    }
  }

  return {
    capture,
    dispose() { target?.dispose(); target = null; },
  };
}
