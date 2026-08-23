# RTX Moonlit Open Ocean

`webgpu_rtx_moonwater_cove` is a native WebGPU/TSL open-ocean study for
ThreeBrowser Runtime. The sample is deliberately built without downloaded
models or textures: JavaScript creates the moon, marine night sky, stars,
wind-driven sea, crest foam, distant navigation buoy, camera motion and the
in-canvas HUD.

## Rendering design

- Thirteen directional JS/TSL wave bands form a coherent wind sea: seven
  displaced deep-water components and six distance-filtered capillary bands.
  A variance-preserving sideband breaks the dominant swell into realistic wave
  groups without changing significant wave height. The same spectrum drives
  normals, wind-broken microfacets and statistically rare curvature foam.
- A procedural TSL sky supplies optically attenuating cloud layers, air-mass
  horizon haze and a physically sized lunar disc. The water evaluates that
  same live directional sky/cloud radiance along its reflected ray; a matching
  JS PMREM supplies lower-frequency environment light to ordinary materials.
- Air-to-water reflection uses the IOR 1.333 Schlick term, finite angular Moon
  glint, distance-aware microfacet roughness and the same exponential marine
  extinction as the scene instead of an artistic reflection floor.
- The distant navigation buoy samples the exact same analytic Gerstner
  displacement and slope as the GPU surface for surge, heave, pitch and roll,
  providing a stable moving real-world scale cue.
- Aerial, deck-height and wave-level cameras remain above the highest crest.
- The optional native bridge performs only reusable scene registration,
  directional-light visibility/AO queries and one-bounce PBR reflections for
  static-scene materials. The animated water retains its complete JS/TSL
  environment response because its sky and clouds are outside the static TLAS. It
  consumes ordinary Three.js depth, world-normal/roughness and F0/reflection
  guides; no sample wave, water, Moon, sky, cloud, foam, camera, caustic or
  other user-visible shader is embedded in C++.

ThreeBrowser RTX is a generic Three.js renderer extension for functionality
absent upstream. Its built-in native pipelines are safe defaults, not scene or
art-direction policy. This sample's JavaScript explicitly supplies the light
data, angular radius, sample counts, trace distance, ray bias and frame index.
A project may instead upload profile-compatible SPIR-V through
`createRayQueryPipeline()`; Moonwater deliberately uses the generic built-ins
and retains its public-WebGPU fallback rather than supplying a custom shader.

When `navigator.gpu.threeBrowserRTX.evaluateRayLighting()` and/or
`evaluateRayReflections()` are available, the sample supplies those generic
APIs with standard Three.js scene and material data. All water displacement,
refraction, absorption/scattering, Fresnel, Moon glint and caustics remain in
this sample's JavaScript/TSL. Without the native features—or when **X** disables
them—the same JS scene remains functional through public WebGPU/TSL rendering.

## Controls

| Input | Action |
| --- | --- |
| **1** | Aerial camera |
| **2** | Deck-height hero camera |
| **3** | Wave-level camera |
| **T** | Pause/resume ocean and camera motion |
| **X** | Toggle generic native RTX queries and public-WebGPU fallback |
| **D** | Cycle Beauty, Fresnel, Caustics, Normals and Ray Distance views |
| **W** | Toggle full wind sea and near-calm water |
| **H** | Hide/show the in-canvas HUD |
| **Drag** | Offset the cinematic look direction |
| **Wheel** | Dolly the active camera |

All visible UI is rendered by a second Three.js scene using a JS-generated
bitmap atlas. HTML is only the module bootstrap used by normal browsers.
