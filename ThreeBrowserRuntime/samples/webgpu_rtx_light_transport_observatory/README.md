# RTX Light Transport Observatory

An original ThreeBrowser Runtime showcase for effects that cannot be reproduced
faithfully by screen-space reflection: recursive mirrors, rooms outside the
camera frustum, shadowed secondary hits, and deterministic rough specular paths.

The visible gallery, procedural materials, eight-light rig, camera tour, input,
HUD, and ray-query shader are all authored in this sample. Nothing is hardcoded
as demo content in C++ or in ThreeBrowser's native shaders.

## Proof scene

- The hero mirror reflects two relay mirrors behind the camera.
- Those relays reveal amber and cyan galleries that the camera never sees.
- Cinematic mode traces three stable bounces; balanced mode traces two.
- Emissive geometry and registered point/spot lights shade terminal ray hits.
- The five-target MRT records scene-linear HDR, dense RG16F velocity, diffuse
  and specular albedo, packed world normal/roughness, and D32 depth.
- OP84 writes both genuinely noisy ray-reflected HDR and a linear R16F primary
  specular hit-distance guide. DLSS Ray Reconstruction consumes those guides;
  DLSS Super Resolution is used only as the per-frame fallback.
- The selected reconstruction is tone-mapped into persistent full-resolution
  HUD-less RGBA8. Frame Generation is tagged after temporal warmup with the
  independent JS HUD when its dimensions match, and Reflex Boost is requested.
- One final fullscreen presentation composites the HDR scene and JS-only HUD,
  preventing competing swapchain submissions and black frames.

## Controls

- `A` — automatic camera tour
- `1`–`4` — authored camera compositions
- `L` — emphasize the transported-light path
- `Q` — cinematic three-bounce rays / balanced two-bounce rays
- `H` — hide the HUD
- `Space` — drop another physically animated marble and reset temporal history
- drag — look
- wheel — dolly

## Project-owned RTX extension

`shaders/observatory_reflections.comp` implements the public
`reflections-v2` pipeline contract, including its generic binding 11
world-space hit-distance output. The GLSL source is canonical: the generic
runtime validates a content-addressed SPIR-V cache against the source,
entry point, profile, compiler identity, Vulkan target, and runtime shader ABI.
It loads a valid cached binary immediately or recompiles and atomically updates
the local cache. Projects that deliberately ship precompiled SPIR-V can still
use `createRayQueryPipeline({ code })` directly. The project uses only the
generic runtime APIs for static-scene registration, ray-query pipeline creation,
reflection evaluation, Ray Reconstruction / Super Resolution, Frame Generation,
Reflex, and presentation. Resize, camera cuts, and marble spawns reset temporal
history.
