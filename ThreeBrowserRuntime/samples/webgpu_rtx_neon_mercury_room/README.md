# WebGPU RTX Neon Mercury Mirror Room

A sealed, human-scale mirror chamber filled with stable cyan, magenta, violet
and amber neon. A shallow pool of molten gold-mercury covers the lower room.
Moving the mouse changes a filtered gravity vector: the dense liquid leans,
lags, rebounds from the basin and sends conserved waves through its reflective
surface. The camera can look and shift slightly but is physically confined to
the room.

A generated 48 kHz stereo, 96-second synthwave song now plays through the
Runtime's native audio path. Its tempo map moves from a 58→66 BPM atmospheric
intro into a 72→112 BPM acceleration, a 118→124 BPM main drop, a 68→74 BPM
half-time breakdown, a distinct 126→134 BPM final lift, then a long 72→54 BPM
decay that returns seamlessly to the intro. Section-specific bass scales,
changing chord weights, sparse long-tail lead phrases and different arpeggio
patterns keep it evolving rather than repeating one short bar.

Its 122 standard RIFF cue points are authored from the same table as the
submerged impact positions. Density and position change with the arrangement.
Ordinary accents create travelling rings; larger accents add a second upward
push; only six major sound-wave peaks use the full compound lift, making the
connected mercury surface nearly jump before its volume-conserving recoil.

The sample is canvas-only and has no HUD. All scene, simulation, material and
RTX integration code is project-owned MJS, with no downloaded model, external
texture or custom shader binary.

The exact 88x104 raster mercury grid is excluded from the immutable room BLAS
and copied into one persistent `rgba32float` GPU texture. Its fixed 17,922-
triangle topology owns a native dynamic BLAS that is refitted from the same
Float32 positions used by Three.js. The dynamic mesh carries the liquid's gold
surface/radiance response, so wall-mirror hits follow the connected solver
surface instead of an independently tiled approximation. Upload, refit, native
lighting and reflection work remain offscreen and do not add a draw or another
swapchain presentation.

Run directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_neon_mercury_room\site-entry.mjs
```

Controls:

- move the mouse: look within the sealed room and shift the liquid gravity
- drag: add a stronger inertial pull without unlocking the camera
- `R`: settle and recentre the mercury
- `Space`: pause/resume the native bass transport and liquid simulation together
- `X`: compare native RTX reflections with the WebGPU fallback

Both RTX and fallback rendering stay offscreen. Exactly one fullscreen ACES
presentation reaches the swapchain per frame.

The checked-in WAV is reproducible:

```powershell
node C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_neon_mercury_room\tools\generate-mercury-bass-wav.mjs
```

Validation:

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_neon_mercury_room\tests\*.test.mjs
```
