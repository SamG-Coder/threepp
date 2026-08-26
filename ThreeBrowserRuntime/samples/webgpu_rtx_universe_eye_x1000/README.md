# RTX Universe Eye ×1000

`RTX Universe Eye ×1000` is a project-owned macro eye study for ThreeBrowser
Runtime. Its blue universe-spiral iris is structured by
exactly **1,000 deterministic stromal micro-fibres** generated from the numeric seed
`0x0E1E1000`. Reopening or resetting the sample reconstructs the same fibre
field; the effect does not depend on `Math.random()` or network content.

The two checked-in, generated albedos give the close-up a deliberate identity:

- `assets/universe-spiral-iris.png` supplies the blue cosmic iris surface.
- `assets/sclera-microvascular.png` supplies the ivory sclera and its fine
  microvascular detail.

Both images are local 1254 × 1254 PNGs. They are art assets, not claims of
clinical or scientific imaging accuracy. There is no soundtrack or audio
transport in this sample.

## Honest WebGPU/RTX rendering

This is a **hybrid real-time WebGPU/RTX frame**, not an offline path tracer.
Three.js WebGPU owns primary visibility, anatomy animation, the transparent
cornea and the tear film. Those transparent optical layers remain physically
shaded in the WebGPU beauty pass and are deliberately excluded from the native
static acceleration structure.

Only eligible opaque anatomy is collected for the ThreeBrowser ray-query
scene. Native visibility, contact shadow, ambient occlusion and reflection
information augment the exact raster image, while the raster fallback and RTX
paths converge on one tone-mapped presentation. The comparison therefore does
not freeze the cornea or tear film into opaque BLAS geometry and does not imply
native ray-traced refraction.

The sample owns its geometry, animation, textures and RTX integration. It does
not require sample-specific C++, downloaded models, remote assets or audio.

## Controls

- drag — orbit around the eye
- pointer movement — direct the gaze and key light
- wheel — move between the complete eye and macro fibre detail
- `Space` — trigger a blink
- `L` — cycle the studio lighting rigs
- `P` — pause or resume the biological animation
- `X` — compare native RTX augmentation with the raster fallback
- `R` — reset the eye, gaze, camera and lighting rig

## Run

With an existing ThreeBrowser Runtime build, no native rebuild is required:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 `
  C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_universe_eye_x1000\site-entry.mjs
```

The sample appears automatically as **Webgpu Rtx Universe Eye X1000** in the
Runtime launcher's Demos library because its folder contains `site-entry.mjs`.

## Tests

```powershell
node --test .\tests\*.test.mjs
```

The focused tests cover the exact seed and 1,000-fibre deterministic model,
bounded biological dynamics, opaque/transparent RTX partition, generated PNG
assets, controls, local-only packaging and the proven single-presentation RTX
helpers.
