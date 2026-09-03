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
| `Space` | Jump |
| Primary click | Dig while carrying the shovel |
| `X` | Toggle native RTX lighting/reflections |

Wade into the shallows; chest-deep water stops the stride. There is no swim
controller.

Footfalls are distance-driven rather than timer-driven. Dry sand, wet sand,
shallow water, coastal rock and driftwood each use a distinct two-variation
native WAV set. Alternating feet leave pooled, slope-aligned concave
impressions in dry or wet sand; shallow-water steps feed the existing ripple
and splash simulation. Rain accumulation also changes dry footsteps and marks
to wet ones. Regenerate the deterministic local sounds with:

```powershell
node .\samples\webgpu_rtx_first_person_beach\tools\generate-footstep-audio.mjs
```

The player uses a solid capsule-sized horizontal footprint. Palm trunks,
Studio rocks and driftwood block and slide the player; low prop tops can be
landed on after a jump. Footprints are locally tessellated terrain patches:
their sole/tread vertices are physically depressed and retain the exact ground
albedo, normal, roughness, shoreline wash, cloud shadow and rain/runoff
wetness. A dynamic terrain mask exposes that real depth; no decal texture or
second footprint-water mesh is layered over the beach. Each replacement patch
also has a level terrain-material collar outside the depression, preventing
the filtered cutout from exposing water or sky as a coloured edge seam.

Landing impact speed is carried out of the jump solver. A sand landing stamps
both feet and scales both the contact area and physical depression depth with
force; a shallow-water landing drives a proportionally larger existing
ripple/splash event. Normal and landing prints use the player's facing axis,
so A/D strafing shifts each contact sideways without turning the toes toward
the strafe direction.

A Studio-authored forged-steel and ash-wood shovel starts near the player.
Face it and press `E` to pick it up; press `E` again to place it upright on the
terrain ahead. The reusable carryable controller keeps held props camera-local,
adds restrained movement sway, and removes/rebuilds their solid world collider
across pickup and drop. While carried, the shovel hovers in a low diagonal
ready-to-dig pose without covering the centre of the view. Character hands are
intentionally deferred until a proper first-person character rig is available.
Primary click casts the centre of the current view into the shared collision
world and plays a deliberately simple first-person shovel gesture: a short
wind-up places the shovel on the right, the blade swings low from right to
left, and the follow-through lifts it over the left shoulder before returning
to the ready pose.
Looking down therefore digs in the viewed direction, with horizontal reach
capped at 1.5 world units. A successful terrain swing removes a persistent,
spade-sized sand volume rather than placing a decal. Digging rebuilds the
affected heightfield cells at higher local resolution, and every new vertex
samples the same depression data used by collision. Overlapping and repeated
cuts merge into one continuous, still-diggable terrain mesh; there are no
per-hole sand overlays that can intersect into vertical shards. Repeated digs
in the same cut deepen it to a bounded 0.3 world units. A cut that overlaps an
existing footprint removes that entire sole impression from both the pooled
geometry and the terrain-opening mask, so digging cannot leave a floating or
partially exposed footprint behind.

Each cut is also registered in the rain/runoff height field. Existing standing
water is drawn into the new low point, rainfall gradually accumulates in it,
and overlapping cuts exchange water so a chain of shovel cuts acts as a small
drainage channel. Cuts whose bottoms reach the shoreline water table become
sea-connected and fill toward the global water level; the retained surface is
kept inside the cut boundary to avoid the blue edge seam previously seen on
footprints.
A closer rock, log, palm or carryable stops the action after the low swing
instead of allowing the terrain-only shoulder follow-through. The aim ray is
swept continuously through the collision world so thin geometry is not skipped.

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
