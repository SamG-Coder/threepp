# RTX First-Person Beach

A walkable tropical beach for ThreeBrowser Runtime. The camera is first-person.
Late-afternoon sun lights a dune-to-shore heightfield, tiled sand and rock
materials, coconut palms, and a Gerstner-displaced lagoon. When
`navigator.gpu.threeBrowserRTX` exposes ray queries, the same frame receives
generic ray-tested sun lighting, contact shadows, ambient occlusion and
one-bounce reflections. Without the native bridge the WebGPU/TSL scene keeps
working.

## Tiled materials

Albedo tiles were generated as orthographic material scans, then passed through
a sample-owned port of the FakeDepthTrick world-map baker (`C:\FakeDepthTrick`):

1. `MakeSeamless` — centre crop, wrap-aware high-pass, overlap quilt (or
   wrap-blend for already periodic bark)
2. `BakeRoadMaps` — height from mean-subtracted luma, wrapping Sobel normals

Every ground and bark tile ships `*-albedo.png`, `*-height.png` and
`*-normal.png`. Re-bake with:

```powershell
node .\samples\webgpu_rtx_first_person_beach\tools\bake-tile-maps.mjs
```

The native Runtime presents one swapchain image. There is no HTML overlay;
controls and RTX path are reported on stdout.

## Controls

| Input | Action |
| --- | --- |
| Click | Lock the cursor and look |
| `W` `A` `S` `D` | Walk |
| Shift | Sprint |
| `X` | Toggle native RTX lighting/reflections |

Wade into the shallows; chest-deep water stops the stride. There is no swim
controller.

## Run and test

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\samples\webgpu_rtx_first_person_beach\play.ps1
node --test .\samples\webgpu_rtx_first_person_beach\tests\*.test.mjs
```

## RTX boundary

WebGPU owns primary visibility, water displacement, foam, sky and the tiled
PBR materials. Native RTX consumes the standard Three.js depth / world-normal /
roughness / F0 guides. The displaced water, sky dome and palm fronds stay out of
the static BLAS. This is a hybrid real-time path, not an offline path tracer.

RTX and raster work stay offscreen and share one tone-mapped swapchain
presentation per frame.
