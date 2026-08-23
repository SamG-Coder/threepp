# WebGPU RTX Midnight Glasshouse

An original, fully procedural midnight atrium built to make reflection failures
obvious: rain-polished charcoal stone, a shallow indoor pool, a reflective rear
glass wall, cool structural glazing, an animated chrome mobile, wet foliage,
exterior rain, a passing vehicle and an amber-versus-moonlight palette.

Run it directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_midnight_glasshouse\site-entry.mjs
```

## Controls

The visible HUD is not HTML. `src/hud.mjs` generates a monochrome RGBA
`DataTexture` font atlas byte-by-byte, batches each text line into glyph quads,
and renders panels, type and buttons in a second Three.js scene through an
orthographic camera. It is rendered only after the world pass, so it never
enters the planar reflection captures. Button picking uses canvas pointer
coordinates and plain rectangle tests.

- Click the right-side controls or press `A` to toggle the camera tour, `R` to
  toggle exterior rain and `Q` to switch reflection resolution.
- Drag to leave the camera tour and inspect the atrium manually.
- Use the mouse wheel to dolly, and press `H` to hide or show the HUD.

The narrow layout intentionally hides the click panels while preserving the
keyboard controls.

## Native reflection path and fallback

ThreeBrowser RTX is a generic Three.js renderer extension for functionality
absent upstream. Its native shaders are safe, reusable defaults; this project's
JavaScript owns the moon direction and intensity, angular radius, ray counts,
trace distance, bias, frame sequence, materials, and every artistic value. A
project may instead upload profile-compatible SPIR-V through
`createRayQueryPipeline()`. This sample deliberately keeps the built-in
pipelines and its planar fallback rather than supplying a custom shader.

When `navigator.gpu.threeBrowserRTX.evaluateRayReflections()` is available, the
sample uses explicit public-native boundaries end to end:

- OP83, `registerStaticScene`, receives static atrium geometry flattened into
  world-space indexed triangles plus one linear HDR RGBA hit-radiance value per
  triangle. That radiance is the terminal contribution at a ray hit; it is not
  a recursively shaded material;
- OP85 appends linear albedo and perceptual roughness for every registered
  triangle, while OP86 appends eight packed point/spot emitters. The native hit
  shader reconstructs a geometric normal, evaluates the emitter cone/range and
  casts a visibility ray before adding the first diffuse bounce. Transparent
  glazing stays out of the TLAS, so window light crosses the panes but opaque
  mullions, walls and fixtures still shadow it;
- before OP84, the storage-capable primary HDR target receives a restrained
  native ray-query moon-visibility/contact-AO pass. It grounds the visible
  architecture without replacing the authored raster lights or double-lighting
  the room. JavaScript explicitly selects four deterministic directional-light
  visibility samples, eight cosine-weighted AO samples, angular radius, trace
  distance, bias and frame index;
- one same-size MRT writes linear `rgba16float` source color, direct world normal
  xyz plus perceptual roughness, linear F0 plus a reflection mask, and
  `depth32float` depth;
- OP84, `evaluateRayReflections`, consumes those resources through a dedicated
  otherwise-empty encoder and writes one-bounce native specular into a distinct,
  primed, storage-capable `rgba16float` output;
- the returned HDR image is presented through Three's ACES/output transform,
  and only then is the independent orthographic HUD rendered.

The wet floor, pool surface and rear pane swap to native guide materials before
the MRT pass. Those materials contain neither a `ReflectorNode` nor a viewport
copy, so fallback planar textures cannot enter the native MRT or trigger an
incompatible framebuffer copy. Their original materials are restored intact if
the native path stops.

The bridge defaults to stable one/four/eight-ray GGX tiers; this stress demo
opts into its one/eight/sixteen-ray cinematic tier plus adaptive supersampling.
A 1280x720 window now renders the world/reflection buffers at a true
3840x2160, and 1080p also reaches a 4K internal frame; the scale tapers against
an 8.3-megapixel budget as the window grows, so a native 4K display does not
accidentally request an 8K or 12K internal frame. The HUD remains an independent
native-resolution layer.

Animated rain, foliage, vehicle and kinetic sculpture stay out of the static
BLAS. They remain in source color; the current native contract intentionally
traces the static architecture, pool shell, skyline, emissive windows and light
fixtures. The G-buffer stores full signed world normals, never oct encoding.

The authored world includes 2,400 depth-layered rain streaks, GPU-driven glass
condensation and trails, expanding wet-floor impact rings, animated pool
caustics/micro-normal detail, submerged steps and rails, recessed luminaires,
and a layered wet streetscape beyond the glass. These are coherent procedural
scene features rather than downloaded assets or screen-space decoration.

If OP83 registration, OP84 evaluation or the native feature itself is
unavailable, the same scene immediately restores its independent public
Three.js/WebGPU planar fallback:

- three `ReflectorNode` planar captures show real off-screen geometry on the wet
  floor, pool and rear glass;
- generated mip levels distinguish sharper water/glass from rough wet stone;
- a procedural HDR room is GGX-prefiltered with `PMREMGenerator` for chrome,
  brushed metal and clearcoat highlights;
- the pool combines a distorted planar reflection with the already-rendered
  viewport for shallow refraction;
- material roughness spans near-mirror chrome, polished glazing, wet stone and
  foliage so the reflection response remains readable rather than uniformly
  glossy.

NVIDIA Reflex Boost is requested when supported. DLSS Super Resolution, Frame
Generation and Ray Reconstruction are not requested because this sample owns a
different full-resolution reflection-resource contract and does not manufacture
the additional inputs those features require.

All architecture, materials, vegetation, skyline, rain, vehicle, lighting,
animation and UI assets are created by JavaScript modules in this folder. There
are no downloaded models, images, textures, fonts, style sheets or HTML UI.
