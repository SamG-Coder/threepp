# RTX Morpho Iridescence ×10000

`RTX Morpho Iridescence ×10000` is a project-owned Morpho photonic-crystal
study for ThreeBrowser Runtime. Its electric-blue wing is structured by
exactly **10,000 deterministic photonic-crystal scales** generated from the numeric seed
`0x10F01000`, plus a second micro-structure of **4,096 ommatidia** on the
compound eyes. Reopening or resetting the sample reconstructs the same scale
and ommatidia fields; the effect does not depend on `Math.random()` or network
content.

Wheel magnification moves from the ruined greenhouse garden at ×1 into a
single hero scale, then into a **12-layer chitin lattice at ×10000**. The
iridescence is a physically inspired multilayer interference model (Bragg
reflectors in chitin and air), not a claim of spectral offline rendering.

The three checked-in, generated albedos give the close-up a deliberate identity:

- `assets/morpho-wing-lamellae.png` supplies the wing-scale lamellae surface.
- `assets/compound-eye-mosaic.png` supplies the hexagonal ommatidial mosaic.
- `assets/greenhouse-moss.png` supplies wet moss, stone and planter detail.

These images are local art assets, not claims of laboratory or scientific
imaging accuracy. There is no soundtrack or audio transport in this sample.

## Honest hybrid WebGPU/RTX rendering

This is a **hybrid real-time WebGPU/RTX frame**, not an offline path tracer.
Three.js WebGPU owns primary visibility, insect animation, the transparent glass
/ water / dew, pollen, and the flapping wing membranes.
Those transparent glass, water and dew layers remain physically
shaded in the WebGPU beauty pass and are deliberately excluded from the native
static acceleration structure / BLAS.

Only eligible opaque greenhouse iron, stone, brick and idle lantern housings
are collected for the ThreeBrowser ray-query scene. Native visibility, contact
shadow, ambient occlusion and reflection information augment the exact raster
image, while the raster fallback and RTX paths converge on one tone-mapped
presentation. The comparison therefore does not freeze glass, water or dew into
opaque BLAS geometry and does not imply native ray-traced refraction.

The sample does not provide DLSS Super Resolution, Frame Generation or Ray
Reconstruction, and it is not a spectral offline renderer. The sample owns its
geometry, animation, textures and RTX integration. It does not require
sample-specific C++, downloaded models, remote assets or audio.

## Controls

- drag — orbit around the perched Morpho
- pointer movement — direct the insect gaze and key light
- wheel — log-scale magnification from the greenhouse (×1) to the 12-layer chitin lattice (×10000)
- `Space` — trigger a flap
- `L` — cycle the lighting rigs (dawn, overcast, lantern, studio)
- `P` — pause or resume the biological animation
- `X` — compare native RTX augmentation with the raster fallback
- `R` — reset the Morpho, gaze, camera and lighting rig

## Run

With an existing ThreeBrowser Runtime build, no native rebuild is required:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_morpho_iridescence_x10000\site-entry.mjs
```

The sample appears automatically as **Webgpu Rtx Morpho Iridescence X10000** in
the Runtime launcher's Demos library because its folder contains
`site-entry.mjs`.

## Tests

```powershell
node --test .\tests\*.test.mjs
```

The focused tests cover the exact seed and 10,000-scale deterministic model,
4,096 ommatidia, bounded wing dynamics, the 12-layer lattice zoom, the
opaque/transparent RTX partition, generated PNG assets, controls, local-only
packaging and the proven single-presentation RTX helpers.
