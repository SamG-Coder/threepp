# WebGPU RTX Flash Flood Gorge

A native ThreeBrowser Runtime demonstration of a mountain gorge during late
sunset and blue hour. A deterministic shallow-water solver releases a deep surge
from the upstream spillway and carries it through a long, irregular rock
channel. Water depth, velocity, wet/dry transitions and hydraulic turbulence
drive the deforming surface, aperiodic advected chop, white water, spray, mist,
phase-locked caustics and floating storm timber.

The environment is procedural and physically scaled. A connected 2.8 by 2.5
kilometre rolling upland embeds the gorge in real terrain, while two detailed
but non-occluding mountain ranges close the sunset horizon without shadowing
the flood. Layered cliff faces, river stones, wet shelves, sparse vegetation,
a concrete control structure and a downstream bridge give the moving water
readable scale. Ten deterministic
surface families generate 27 shared 256² terrain/structure maps plus a 512²
animated-water albedo, roughness and tangent-normal triplet. They cover dry
and wet rock, boulders, bark, foliage, dead timber, concrete, asphalt, metal,
and two-layer animated water flow. There is no HUD or on-screen telemetry;
diagnostics remain in stdout.

All project implementation lives in this new sample's `.mjs`, HTML and
manifest files. The surface maps are generated in memory by MJS; no native/C++
Runtime file, downloaded model, image texture or external asset is modified or
required.

Run directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_flash_flood_gorge\site-entry.mjs
```

Controls:

- `1`: high gorge overview
- `2`: low aerial surge-chase camera
- `3`: bridge and debris view
- `4`: upstream spillway release view
- drag: look around
- mouse wheel: dolly
- `Space`: pause/resume the simulation
- `[` / `]`: halve/double simulation speed
- `R`: reset the gorge and replay the release
- `X`: compare native RTX with the WebGPU fallback

## RTX boundary

The moving water, foam, spray, mist and debris stay outside the static TLAS.
The ordinary Three.js/TSL water material writes its live surface depth, normal,
roughness and reflection mask to an offscreen FP16 guide set. Native ray
queries use those guides to reflect registered gorge, upland, bridge, rock and
vegetation geometry and to add ray-tested sunset-key visibility and ambient
occlusion. Horizon-only mountains remain outside the local TLAS so their
silhouette cannot extinguish the authored warm river path. Mapped opaque
surfaces also feed resolved normal and roughness data into those guides.
Refraction, absorption, micro-waves and caustics remain authored in TSL; the
generic bridge does not expose a dedicated refraction-ray operation.

Both RTX and fallback paths render offscreen. Exactly one final ACES fullscreen
render reaches the swapchain each frame.

## Validation

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_flash_flood_gorge\tests\*.test.mjs
```

The contracts cover deterministic fixed-step flow, finite bounded state,
downstream surge propagation, wet/dry transitions, reset identity, foam
generation, MJS-only scope, the static RTX budget and the single-presentation
render boundary.
