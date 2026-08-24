# ThreeBrowserRuntime

ThreeBrowserRuntime is the WebView-free execution path for ThreeBrowser. V8 is
provided by Node, while a Node-API addon calls the existing threepp and native
WebGPU hosts directly in-process and owns the rendering window.

The first milestone includes:

- a custom native threepp window;
- an in-process V8-to-C++ command path using `ArrayBuffer` memory;
- native display-clock `requestAnimationFrame` scheduling;
- a minimal `window`, `document`, canvas and `EventTarget` environment;
- mouse, button and keyboard event dispatch into JavaScript;
- JavaScript and simple HTML module entry points;
- reuse of the existing ThreeBrowser `THREE` compatibility slices; and
- reuse of the existing `three_webgpu.dll` command ring for stock Three.js
  WebGPU/TSL applications such as Poseidon.

## Build and run

Install x64 Node, .NET 10, CMake and the MSYS2 UCRT64 toolchain. The project
uses the normal .NET CLI workflow from its own directory:

```powershell
cd C:\ThreeBrowser\ThreeBrowserRuntime
dotnet build
dotnet run
```

Pass a `.mjs`, `.js`, or simple `.html` entry after `--` to launch another page:

```powershell
dotnet run -- .\pages\example.html
```

A `threebrowser.local` page can be copied into an isolated runtime project and
launched with one command:

```powershell
dotnet run -- import https://threebrowser.local/demos/poseidon/index.html
```

The imported files are stored under `ThreeBrowserRuntime\projects\<name>` with
a `.threebrowser-project.json` manifest. Running the same import refreshes the
copied files from the browser web root without editing the originals.

## Pull and unpack a website

From a new empty folder, `pull` downloads a website and walks its Vite/ESM
dependency graph. JavaScript modules are localized as `.mjs`, referenced chunks
and assets are copied, available source maps are expanded, and Three.js sources
inside source maps are separated under `unpacked\three`.

```powershell
mkdir C:\Sites\pulled-demo
cd C:\Sites\pulled-demo
dotnet run --project C:\ThreeBrowser\ThreeBrowserRuntime\ThreeBrowserRuntime.csproj -- pull https://example.com/
dotnet run --project C:\ThreeBrowser\ThreeBrowserRuntime\ThreeBrowserRuntime.csproj -- .\site-entry.mjs
```

The command writes `site-entry.mjs` and `threebrowser.pull.json`. It refuses to
write into a non-empty destination unless `--force` is supplied. `unpack` is an
alias for `pull`. The manifest includes a `compatibility` section that reports
whether Three.js remains importable or has been embedded into a production
bundle, which renderer families were detected, and whether the page appears to
be canvas-only, an HTML overlay, or DOM-required.

Relative ESM imports, `.js` modules, and HTML import maps are supported. The
bare `three` import resolves to the native ThreeBrowser compatibility API rather
than stock WebGL; addon paths continue through the page's import map so their
JavaScript can import that native core. Escape releases pointer lock, while
Ctrl+C in the terminal exits the runtime.

At configure time CMake reads the installed Node version and downloads its
matching official Node-API headers and Windows import library from nodejs.org.
Node supplies V8; no WebView or browser renderer process is used.

## Current compatibility boundary

This milestone is a three.js application runtime, not a general HTML/CSS
browser. Localized ESM graphs, import maps, local and network `fetch`, image
decoding, HDR environments, DRACO workers, skeletal animation, pointer/keyboard
input, and the WebGPU/TSL command path are supported. DOM controls can execute,
but this native-only milestone does not paint general HTML/CSS widgets over the
GPU surface yet.

Production Vite output creates a second, independent boundary. If Vite embeds a
WebGL copy of Three.js into a minified chunk, the puller parses the chunk and
looks for stable semantic markers such as `isScene`, `isMesh`,
`isBufferGeometry`, and `isWebGLRenderer`. It then relinks the mangled render
model and renderer bindings to ThreeBrowser's native facade, even when Rollup
has renamed every class. The manifest reports each relinked native type and uses
`threeMode: "relinked"`; a bundle with no safe renderer binding remains
`"bundled"`.
WebGPU bundles can use the native `navigator.gpu` bridge, subject to browser API
coverage, but their React or HTML control panels are still headless. Source maps
and builds that preserve `three` imports remain preferable because they retain
more module structure and allow stronger tree-shaking.

On Windows/Vulkan builds, the runtime integrates NVIDIA Streamline 2.12 through
the signed Vulkan interposer. The Shift+Tab panel reports DLSS Super Resolution,
Frame Generation, Ray Reconstruction and Reflex independently for the active
adapter. Reflex is integrated end-to-end (frame pacing plus PCL simulation,
render-submit and present markers) and offers Off, On and On + Boost modes.
DLSS rendering features are exposed only when the adapter and Streamline plugin
support them; a page must still provide the feature's semantic inputs (for
example depth and motion vectors) before evaluation can be enabled safely.

WebGPU pages can inspect and request those features through
`navigator.gpu.threeBrowserRTX`. The status contract keeps adapter support,
page request, successful native configuration, and per-frame activity separate;
callers must use `active`, rather than the support flag, when describing a
feature as enabled:

```js
const rtx = navigator.gpu.threeBrowserRTX;
const status = rtx.requestFeatures({
  reflex: "boost",
  dlssSuperResolution: rtx.capabilities.dlssSuperResolution && {
    mode: "quality",
    outputWidth: innerWidth,
    outputHeight: innerHeight,
    colorBuffersHDR: true,
  },
  // These remain inactive unless their complete native frame contracts exist.
  dlssFrameGeneration: false,
  dlssRayReconstruction: false,
});

console.log(status.features.dlssSuperResolution.active);
console.log(rtx.getStatus());
```

`getOptimalSettings()` queries the native DLSS plugin for render dimensions.
`evaluateSuperResolution()` accepts native `GPUTexture` inputs plus the
`GPUCommandEncoder` they belong to. Evaluation is recorded into that encoder's
command stream and replayed between encoder creation and submission; it is not
called out of order from JavaScript. Every resource includes its current
non-zero Vulkan image layout, region, and texture. Matrices, motion-vector
scale, jitter, and camera constants are validated before the command is queued.
The returned `queued` flag is not an activation claim: `getStatus()` reports
`active: true` only after native Streamline evaluation succeeds.

Ray Reconstruction is exposed as a real denoising/upscaling pass; it is not a
substitute for ray traversal. A page requests it together with the underlying
HDR DLSS mode, renders genuine noisy ray-traced lighting and all denoiser
guides, then records `evaluateRayReconstruction()` on a dedicated empty command
encoder. The frame must contain noisy HDR color, a distinct output, depth,
dense motion vectors, diffuse and specular albedo, and either packed
normal/roughness or separate normal and roughness textures. It must also contain
exactly one reflection guide: specular motion vectors, or specular hit distance
with the world/view inverse matrix pair. Set `rayTracedInput: true` to attest
that the input really came from ray traversal; raster-only pages must not opt
in. Texture formats, Vulkan layouts and usages, extents, matrices, and the
configured output size are validated by both JavaScript and the native bridge.

`evaluateRayReconstruction()` returns `queued: true` after serialization only.
The Shift+Tab panel and `getStatus()` report Ray Reconstruction as active only
after `slEvaluateFeature(kFeatureDLSS_RR)` succeeds for a submitted frame.
Failures and evaluation counts remain observable independently, so adapter
support is never presented as successful per-frame use.

ThreeBrowser RTX is a generic Three.js renderer extension for functionality
that upstream Three.js does not expose. On adapters that advertise
`EXPERIMENTAL_RAY_QUERY`, it provides a focused Vulkan ray-query bridge. This is
separate from Streamline and DLSS: it supplies native ray traversal to a WebGPU
page while preserving the page's command ordering and texture ownership. The
first contract intentionally owns one static world-space triangle scene:

```js
const rtx = navigator.gpu.threeBrowserRTX;
const registration = rtx.registerStaticScene({
  positions, // Float32Array of world-space xyz values
  indices,   // Uint32Array, one indexed triangle list
  // Optional linear HDR RGB plus a reserved alpha value for every triangle.
  // A native reflection ray returns this radiance when it hits that triangle.
  triangleRadiance,
  // Optional linear albedo RGB + perceptual roughness for every triangle.
  triangleSurface,
  // Optional packed point/spot records, 16 floats each, maximum eight.
  // position/range, direction/outerCos, color/intensity,
  // innerCos/type/decay/reserved
  lights,
});

if (registration.queued) {
  rtx.evaluateRayLighting({
    commandEncoder,
    color: hdrColorResource, // rgba16float storage + render attachment
    depth: depthResource,    // depth32float
    inverseViewProjection,
    cameraPosition,
    directionalLightDirection,
    directionalLightIntensity: 1,
    directionalAngularRadius: 0.0065,
    directionalSampleCount: 1,
    aoSampleCount: 2,
    maxDistance: 10000,
    rayBias: 0.002,
    frameIndex,
    shadowStrength: 0.6,
    aoStrength: 0.2,
    aoRadius: 0.9,
  });
}
```

`evaluateRayLighting()` is deliberately scene-independent: it provides
directional-light visibility/shadows and ray-traced ambient occlusion only.
Water waves, caustics and other authored material behavior remain in the
Three.js page. The native bridge deliberately does not provide scene-specific
water, atmosphere, material or composition APIs.

The native lighting and reflection pipelines are generic, safe defaults. The
page's JavaScript owns the light data and naming, angular size, ray counts and
sample sequence, trace distance and bias, material behavior, and every artistic
value. Projects may keep profile-compatible GLSL compute source as their
canonical shader and let ThreeBrowser compile and cache it:

```js
const pipeline = threeBrowserRTX.compileRayQueryPipeline({
  profile: "lighting-v1", // or reflections-v1 / reflections-v2
  source: glslSource,
  language: "glsl",
  stage: "compute",
  entryPoint: "main",
  label: "project lighting",
});
```

The native runtime validates a content-addressed cache entry before loading it.
Its key includes the complete source, profile ABI, entry point, compiler binary,
compiler flags and Vulkan target. A matching validated SPIR-V entry is loaded
directly; otherwise the bundled compiler produces SPIR-V, the result is
validated and atomically published to the per-user shader cache, and that result
is loaded. This is stronger than timestamp-only invalidation and does not modify
the project directory.

Projects that already ship a trusted precompiled shader may bypass compilation
and upload it directly with
`createRayQueryPipeline({ profile: "lighting-v1" | "reflections-v1" |
"reflections-v2", code,
entryPoint: "main", label })`, where `code` is a `Uint32Array` or
`ArrayBuffer`. Profile shaders are compute entry points with an explicit
`layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;`; uploads
that do not match this dispatch contract are rejected before reaching Vulkan.
Pass the returned device-scoped object as `pipeline` to the
matching evaluation call and invoke its idempotent `destroy()` when finished.
Projects that omit `pipeline` continue to use the built-in generic profile.

Pages that provide reflection guides can record a separate one-bounce pass.
The source and output must be distinct, equally sized persistent textures so
the native shader never samples and writes the same image. `normalRoughness`
stores a world-space normal in RGB and perceptual roughness in A;
`specularAlbedo` stores linear F0 in RGB and a reflection mask in A:

```js
rtx.evaluateRayReflections({
  commandEncoder,
  sourceColor,       // rgba16float TEXTURE_BINDING
  outputColor,       // distinct rgba16float STORAGE_BINDING
  depth,             // depth32float TEXTURE_BINDING
  normalRoughness,   // rgba16float TEXTURE_BINDING
  specularAlbedo,    // rgba16float TEXTURE_BINDING
  // Optional Ray Reconstruction guide. `hitDistanceOutput` is retained as an
  // alias. The texture must match the frame extent, be single-sampled R16F or
  // R32F, and include STORAGE_BINDING usage.
  specularHitDistanceOutput,
  width,
  height,
  inverseViewProjection,
  cameraPosition,
  reflectionStrength: 1,
  maxDistance: 120,
  rayBias: 0.012,
  roughnessCutoff: 0.32,
  environmentColor: [0.018, 0.032, 0.052],
  environmentIntensity: 1,
  temporalJitter: true, // rotate deterministic rough-reflection samples per frame
  frameIndex,
});
```

Supplying `specularHitDistanceOutput` selects the generic `reflections-v2`
contract. Its additional `set=0, binding=11` storage image uses `r16f` or
`r32f` to match the supplied texture. The built-in v2 shader writes the linear
world-space distance along the first reflection ray, in the same units as the
registered scene, and writes `0.0` for a miss, background pixel, non-reflective
pixel, or roughness-cutoff pixel. The resulting texture can be passed directly
as `specularHitDistance` to `evaluateRayReconstruction()` at the same extent.
Custom `reflections-v2` pipelines must follow the same binding and sentinel
contract. Omitting the guide preserves the original `reflections-v1` command,
descriptor writes, and shader path exactly.

`registerStaticScene()` builds one native BLAS and identity TLAS. The built-in
lighting evaluation is recorded into the supplied WebGPU command encoder,
reconstructs receivers from depth, and traces directional-light visibility and
ambient occlusion. Its optional defaults are one visibility sample, two AO
samples, a 0.0065-radian directional-light radius, a 10000-unit maximum trace
distance and a 0.002-unit ray bias. These are generic compatibility defaults,
not scene policy: JavaScript can explicitly override every value, as the
example above does.
The reflection evaluation reconstructs the visible receiver from depth, traces
the static TLAS, reconstructs the hit triangle's geometric normal, evaluates
the optional packed emitters with range/cone attenuation and shadow rays, then
combines that first diffuse bounce with the registered terminal radiance. Glass
may be deliberately omitted from the TLAS so light crosses a transparent pane
while opaque frames and walls still occlude it. Stable one/four/eight-ray GGX
tiers composite the result through roughness-aware Fresnel into a distinct HDR
output; pages with measured headroom may opt into stable one/eight/sixteen-ray
tiers. It is one reflection bounce with shadow-tested hit lighting, not a
recursive path tracer. Both passes restore every
supplied Vulkan image layout before later WebGPU/DLSS work. Dynamic BLAS
updates, skinned geometry, textured hit materials, transparent refraction,
general trace-ray pipelines and path tracing are not part of this contract;
pages must retain a normal WebGPU fallback when `capabilities.rayQuery` is
false.

The legacy `reflexMode` and `setReflexMode()` members remain supported.

Framework effects may create their renderer after module evaluation, so the
runtime keeps the browser event loop alive during a bounded startup window.
Because the native host deliberately has no CSS layout engine, unmeasured DOM
mounts inherit their parent box and ultimately the viewport; this preserves the
standard full-window `clientWidth`/`clientHeight` canvas sizing pattern.

Relinked WebGL applications can also create, resize, bind, query, and dispose
`WebGLRenderTarget` instances. Target changes are synchronous ordering barriers
around the asynchronous command stream, so an offscreen pass completes before
the following pass changes its framebuffer or returns to the window surface.

## Visually verified official examples

The following pages have been pulled from `threejs.org`, run in Release mode,
and visually checked in the native window:

- `webgl_geometry_cube.html` — image decode, textured geometry, animation;
- `webgl_instancing_performance.html` — 1,000 meshes and pointer orbit;
- `webgl_loader_gltf.html` — GLB, embedded textures, UltraHDR and PMREM;
- `webgl_animation_keyframes.html` — DRACO WASM worker and skinned animation;
- `webgpu_compute_particles.html` — stock WebGPU/TSL compute and rendering;
- `webgpu_postprocessing.html` — TSL render pipeline, dot-screen and RGB shift;
- `webgpu_postprocessing_ssgi.html` — MRT G-buffer passes, comparison samplers,
  cube texture views, and progressive screen-space global illumination;
- `webgpu_postprocessing_ssr.html` — pulled DRACO/GLB assets, PMREM, TSL screen
  background, mip-chain copies, SMAA, and screen-space reflections;
- `webgpu_postprocessing_traa.html` — temporal history texture copies,
  reprojection, camera jitter, motion, wireframe, and textured geometry;
- `webgpu_postprocessing_dof.html` — composed cubemap asset URLs, large
  instanced uniform workloads, reflective spheres, and depth-of-field bokeh.
