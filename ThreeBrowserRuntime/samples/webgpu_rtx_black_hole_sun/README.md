# RTX Tidal Rupture

A procedural WebGPU/TSL visualization of a solar twin being tidally disrupted
and captured by a non-spinning, 300,000-solar-mass Schwarzschild black hole.
The system is deliberately chosen so the Sun is disrupted outside the horizon
and remains large enough to read beside the apparent black-hole shadow.

## What is physically solved

- The center of mass follows a fixed-step RK4 integration of the exact
  equatorial timelike Schwarzschild geodesic with `E = 1` and `L = 3.98M`.
  This is a near-critical parabolic capture, so its late zoom-whirl is genuine
  gravity rather than a fictitious orbital drag force.
- All distances share geometrized `GM/c²` units. The event horizon is `2M`,
  photon sphere `3M`, ISCO `6M`, and apparent shadow radius `3√3 M`.
- The solar tidal radius is `R☉ (M_BH/M☉)^(1/3) = 105.1M`. The displayed
  tidal-stress ratio is exactly `(r_t/r)^3`.
- Gravitational redshift, special-relativistic Doppler factor, local geodesic
  speed and the `g³`/`g⁴` radiance changes all derive from the same state.
- Accretion emission follows the Schwarzschild zero-torque profile
  `F(r) ∝ r^-3 (1 - √(6M/r))`; the approaching side is Doppler-brightened and
  the receding side is reddened.
- The post compositor captures rays inside the exact critical impact parameter
  and blends the logarithmic strong-deflection limit with the second-order
  Schwarzschild weak-field bending law.

## Deliberate real-time approximations

This is not a general-relativistic magnetohydrodynamics solver. The photosphere
uses a volume-preserving Roche envelope driven by the exact tidal ratio, and
the leading/trailing debris uses a deterministic frozen-in ballistic stream
around the solved center trajectory. The disk is visible from the opening frame
for composition, its visible colors map ultraviolet temperatures into a camera
palette, the photon ring is widened for pixel/bloom readability, and the
72-second playback uses an adaptive time-lapse. Lensing is a screen-space
Schwarzschild transfer, so foreground debris close to the hole is an artistic
depth approximation.

## Rendering

- Native Three.js WebGPU, ACES tone mapping and HDR procedural materials
- Schwarzschild lensing and exact shadow mask in TSL
- Selective emissive bloom with a direct-HDR fallback when the compositor
  cannot be constructed before rendering begins
- Exactly one swap-chain presentation per animation tick; the world,
  camera-attached GPU HUD, lensing and bloom share one final render call
- Procedural photosphere, corona, prominences, stars and Milky Way
- A 72-second stereo PCM score procedurally generated from the same geodesic,
  redshift and Roche-stress timeline as the image
- Optional NVIDIA Reflex Boost when the Runtime reports support
- No downloaded models, textures, skyboxes or sample-specific native code

Ray Reconstruction, Frame Generation and DLSS Super Resolution are explicitly
not requested: this sample does not provide their complete frame-resource
contracts. The HUD only calls Reflex active when the Runtime reports it.
If a post pass itself fails after drawing begins, animation stops on the last
valid frame instead of risking reuse of an already-acquired swap-chain texture.

## Sound

`Spacetime in Tension` is a scientific sonification, not literal sound
propagating through vacuum. Its sub-bass curvature drone, accretion rumble,
stellar-plasma band and six rupture transients are synthesized offline from the
same radius, local speed, gravitational redshift, tidal stress and stripped-mass
values used by the renderer. It plays through the Runtime's native local-WAV
bridge and remains muted until `M` is pressed. Pause, restart and time-lapse
speed stay synchronized to the 72-second encounter.

## Controls

- `A`: toggle the cinematic camera
- `1`, `2`, `3`: encounter-wide, edge-on lens, and photon-ring shots
- left-drag: manual orbit
- mouse wheel: dolly
- `Space`: pause/resume
- `T`: cycle 0.5×, 1× and 2× playback
- `X`: compare Schwarzschild lensing with the raw scene
- `M`: enable/mute the synchronized sonification
- `R`: restart the encounter
- `H`: hide/show the in-canvas HUD

Run from `ThreeBrowserRuntime`:

```powershell
pwsh -File .\run.ps1 .\samples\webgpu_rtx_black_hole_sun\site-entry.mjs
```

Tests:

```powershell
node --test .\samples\webgpu_rtx_black_hole_sun\tests\*.test.mjs
```

Regenerate the deterministic soundtrack after changing the physical model:

```powershell
node .\samples\webgpu_rtx_black_hole_sun\scripts\generate-tidal-score.mjs
```
