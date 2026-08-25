# WebGPU RTX Bushfire Mountainside

A native ThreeBrowser Runtime night scene set at approximately 9 PM: a 600 by
800 metre procedural mountain valley, 1,400 layered deterministic trees,
visible stars and a cratered gibbous moon. Inside it, a 192 by 264 metre live
fuel field drives a wide broken bushfire front that spreads gradually with
wind, moisture and uphill bias. Irregular flames climb trunks, lower branches
and crown pockets while vegetation blackens, smoke columns merge across the
valley, embers lift and warm fire-front lighting evolves in real time. Behind
the front, consumed trees become broken black snags and persistent fallen logs
surrounded by ash, glowing coals and slowly fading ember cracks.

All scene and simulation implementation is contained in this sample's `.mjs`
files. `C:\DenseTrees` was used only as a visual reference for asymmetric tree
scaffolds and crown negative space. No C++, native Runtime source, downloaded
model, texture, image or external asset is modified or required.

Run directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_bushfire_mountainside\site-entry.mjs
```

Controls:

- `1`, `2`, `3`: valley overlook, close fireline and aerial survey cameras
- drag: look around
- mouse wheel: dolly
- `Space`: pause/resume fire spread
- `[` / `]`: halve/double spread speed
- `R`: reset and reignite the authored ignition line
- `X`: compare native RTX lighting with the raster fallback

There is deliberately no on-screen UI. The native Runtime presents exactly one
swapchain image per frame; status and performance diagnostics remain in stdout.

## RTX boundary

When `navigator.gpu.threeBrowserRTX` exposes native ray queries, the sample
registers a bounded static snapshot of terrain, rock, trunks, branches and
opaque crown proxies. Every HDR frame is ray-tested for soft moon visibility,
shadows and ambient occlusion. Up to three moving fire clusters then add warm
distance-attenuated direct light through a custom native ray-query pipeline;
terrain and opaque tree geometry correctly occlude each emitter. The visible
high-detail hero leaf cards, flame volumes, smoke and embers remain outside the
static BLAS.

When a burned-log cluster exists, one bounded RTX emitter slot is reserved for
its weaker residual glow, so the ash wake still throws warm ray-tested light
while the stronger active front continues elsewhere.

Raster `PointLight`s provide a matching fallback when native ray queries are
unavailable. The RTX passes all write the same offscreen HDR image and the
Runtime performs one final ACES swapchain presentation per frame.

## Validation

The spread model is renderer-independent and deterministic:

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_bushfire_mountainside\tests\*.test.mjs
```

The tests cover fixed-step determinism, downwind and uphill bias, fuel
consumption, bounded state, stable renderer records, reproducible reignition,
forest/RTX budgets, tree-emitter integration, the MJS-only boundary, and the
single surface-presentation contract.
