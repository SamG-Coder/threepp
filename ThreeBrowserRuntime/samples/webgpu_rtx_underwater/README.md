# WebGPU RTX Underwater

A native WebGPU/TSL stress scene based on the supplied shallow tropical-water
reference: a low action-camera view, deforming surface overhead, restrained
turquoise attenuation, pale procedural sand, eroded rocks, one close fish pass,
sparse distant fish, suspended particles, drifting leaves, soft shadows and
animated surface-derived caustics.

Run it directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_underwater\site-entry.mjs
```

## RTX validation boundary

The example reads `navigator.gpu.threeBrowserRTX.capabilities`, queries the
native DLSS Quality render size, and calls `requestFeatures()` with the exact
output dimensions and HDR/exposure contract. The returned status deliberately
keeps four different concepts separate:

- `supported`: the native adapter/Streamline capability probe succeeded;
- `requested`: the page asked to use the feature;
- `configured`: the native bridge accepted the requested configuration;
- `active`: the feature is actually participating in the current frame path.

Reflex requests **On + Boost**. When the runtime accepts DLSS Super Resolution,
the sample renders a real low-resolution MRT containing `rgba16float` HDR
color, `depth32float` depth and `rg16float` TSL motion vectors. It records the
native DLSS evaluation on the same WebGPU command encoder that prepares the
storage-capable output, submits it in order, then samples that output in a
separate presentation pipeline. Three's stock output-target path applies the
renderer's real tone mapping and output-color transform into a persistent
full-resolution `rgba8unorm` HUD-less image. When supported, DLSS Frame
Generation tags that exact image, the native depth buffer and dense TSL motion
vectors on a dedicated raw-only encoder immediately before the final pass;
the final swapchain pass samples the same tagged image. The scene has no HUD,
so no UI resource is tagged. All tagged Vulkan resources remain alive through
Present and are released only after the viewport is suspended.

The runtime's `active` state and counters remain the source of truth. Super
Resolution is active only after a successful native evaluation. Frame
Generation is configured only after `slDLSSGSetOptions` and `slDLSSGGetState`
succeed, and active only after post-Present state reports more than one actually
presented frame. A capability flag, request, or queued tag alone is never
reported as activation.

Ray Reconstruction is explicitly disabled. The ray-query lighting pass is a
deterministic visibility and caustic calculation, not a noisy path-traced
radiance buffer with the complete denoiser guide set. If DLSS cannot be
configured or a native evaluation is rejected, the sample immediately falls
back to the ordinary full-resolution Three.js render path. Frame Generation
also remains off on unsupported adapters, with Vulkan VSync, or while native
loading/diagnostic overlays are visible.

On Vulkan adapters that expose `EXPERIMENTAL_RAY_QUERY`, the bridge provides a
deliberately narrow static-scene contract:

- `registerStaticScene()` uploads world-space indexed triangles and builds one
  native BLAS plus an identity TLAS;
- `evaluateRayLighting()` records a compute pass into the page's WebGPU command
  encoder and modifies its `rgba16float` HDR target in place;
- the pass reconstructs each receiver from `depth32float`, traces sun visibility
  and two ambient-occlusion rays, then solves the inverse water-lens mapping;
- the exact six water waves drawn by the TSL material provide the moving surface
  normal. Snell refraction maps sunlight through that surface, and the local
  Jacobian measures ray convergence to form the bright caustic network;
- separate receiver-to-water and water-to-sun ray queries stop caustic energy
  passing through registered rocks or terrain.

This first bridge intentionally handles static opaque world geometry only.
The animated water surface supplies its exact analytic intersection and normal;
fish, vegetation and other deforming meshes are not represented in the TLAS.
It does not claim a trace-ray pipeline, dynamic BLAS updates, path tracing, ray
counts, or Ray Reconstruction.

The public sample-facing contract is:

```js
const rtx = navigator.gpu.threeBrowserRTX;
const outputWidth = 2560;
const outputHeight = 1440;
const dlss = {
  mode: "quality",
  outputWidth,
  outputHeight,
  preExposure: 1,
  exposureScale: 1,
  colorBuffersHDR: true,
  autoExposure: false,
  alphaUpscaling: false,
};
const optimal = rtx.getOptimalSettings(dlss);
const status = rtx.requestFeatures({
  reflex: "boost", // also accepts off/on or 0/1/2
  dlssSuperResolution: dlss,
  dlssFrameGeneration: true,
  dlssRayReconstruction: false,
});

console.log(status.features.reflex.active);
console.log(optimal.optimalRenderWidth, optimal.optimalRenderHeight);
console.log(rtx.getStatus().features.dlssSuperResolution.evaluationCount);
console.log(rtx.getStatus().features.dlssFrameGeneration.lastFramesPresented);

const staticWorld = rtx.registerStaticScene({ positions, indices });
if (staticWorld.queued) {
  rtx.evaluateRayLighting({
    commandEncoder,
    color: hdrColorResource,
    depth: depthResource,
    inverseViewProjection,
    cameraPosition,
    sunDirection,
    shadowStrength: 0.56,
    aoStrength: 0.18,
    aoRadius: 0.92,
    water: { time, surfaceY: 2.72, strength: 0.78, ior: 1.333 },
  });
}
```

The existing `reflexMode` and `setReflexMode()` members remain available for
older pages.

The following remain native WebGPU raster/TSL effects and are not hidden WebGL
fallbacks:

- physically lit PBR materials and PCF soft shadow maps;
- a multi-wave analytically displaced water underside;
- a transparent Fresnel-tinted water underside (an explicit raster
  approximation; the fixed bridge exposes no refraction ray API);
- a restrained analytic caustic detail/fallback derived from the same wave
  phases (reduced when the ray-query pass is active);
- exponential underwater attenuation/haze and translucent sun shafts;
- dynamic fish, tail, leaf and particle transforms.

The runtime console prints the actual adapter/Streamline capability object,
Reflex result, WebGPU validation failures, render call/triangle counts and GPU
timestamp when the backend exposes it. Static scene vertex/triangle counts are
reported from the geometry actually serialized into the native build; no
invented ray throughput or dynamic acceleration-structure statistics are shown.
