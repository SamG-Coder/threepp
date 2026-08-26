# RTX Tennis Felt Macro

An original ThreeBrowser Runtime material-and-physics sample: one tennis ball
resting on a polished kitchen-island bench, with a recessed porous seam, dense
curved undercoat and an always-resident layer of dynamically simulated,
ray-traced felt fibres. The camera can orbit from a full-kitchen product view
into a macro view where individual bent strands, their cross-sections and the
shadows between them remain geometric.

Outside free-play, pressing `Space` turns the material study into a cinematic
high bounce. Press `L` to bring up all kitchen practicals and enter a physics
mode: `WASD` accelerates the ball across the finite island, momentum can carry
it over the bench edge onto the kitchen floor and onward into the room walls,
and holding `Space` adds lift for a higher jump. The entire ball translates,
rolls and squashes, the GPU fibre/RTX pose follows the shell, and a locally
generated tennis-ball impact plays quietly through native browser audio.

There are no downloaded models, textures or sounds, and no demo-specific C++
or Runtime-native shader changes. The small WAV is deterministically authored
by the included JavaScript generator rather than sourced externally.

## Rendering architecture

This is deliberately a **hybrid real-time frame**, not a general multi-bounce
path tracer:

1. Three.js/WebGPU rasterizes the procedurally shaded shell, recessed seam,
   420,000-strand undercoat, visible four-sided fibre tubes, finite island and
   complete procedural kitchen into a scene-linear HDR target.
2. A project-owned WGSL compute pass integrates 24,576 fibre springs and writes
   all tube positions, including the current bounce translation and squash, to
   a persistent `rgba32float` atlas.
3. A native dynamic triangle mesh reads that same atlas. Only the 24,576 live
   tubes feed its diameter-ribbon RTX proxy, which is refit every frame without
   CPU position readback.
4. The native static ray-query scene contains only genuinely fixed geometry:
   the room surfaces, kitchen floor, island, cabinetry and appliances. The
   moving shell, seam and 420,000 curved undercoat fibres stay together in the
   rasterized ball group rather than being incorrectly frozen into the static
   scene.
5. `shaders/fibre_transport.comp` uses the public `lighting-v1` ray-query ABI
   for six stable soft-key visibility paths and four short
   ambient/inter-fibre paths. Those low-sample terms are explicitly masked to
   the fluorescent felt, so they cannot crawl across kitchen tiles, plaster or
   quartz as the camera moves.
6. A depth-aware, 16-tap golden-angle WGSL pass supplies photographic depth of
   field only at macro camera distances. It fades completely out in the room
   and play views, preserving crisp, temporally stable architectural edges.

The ray-query pass contributes live-fibre self-shadowing, inter-fibre openness,
forward transmission, sheen and a restrained multiple-scatter lift. Primary
visibility remains rasterized geometry; the sample does not claim native curve
primitives or an offline path-traced frame. If ray queries are unavailable,
the same GPU simulation and visible tube raster remain active with raster
lighting, and the HUD identifies that fallback.

## Fibre topology

- **24,576 dynamic fibres** cover the whole ball in three deterministic
  archetypes. Every root and every tube remains allocated and simulated at all
  camera distances: there is no distance-spawned patch, LOD swap or fibre
  pop-in when orbiting or zooming.
- Each live visible strand has 12 rings and four sides: **1,179,648 shared atlas
  vertices** and **2,162,688 raster triangles** in total.
- The dynamic RTX proxy connects exact vertices from opposing sides of each
  simulated tube, producing **540,672 ray-query triangles**. It shares the
  position atlas with the visible pass and refits in the same frame as physics.
- A second, always-resident layer of **420,000 curved whole-ball microfibres**
  forms the dense soft undercoat. Each five-vertex tapered ribbon bends through
  a raised middle into a tip, for **1,260,000 raster triangles**. This fixed
  undercoat moves and squashes with the ball but is not part of the refitted RTX
  BLAS.
- Dynamic seam candidates are collapsed into the recessed channel and
  undercoat candidates are buried beneath it, so no visible felt grows across
  the pale track while the topology remains deterministic.

The compressed backing, displaced shell, porous seam, fibre colors and kitchen
are procedural. The ball starts on a finite **38 × 20** polished quartz island
bench above a full **72 × 72** black-and-ivory checkerboard floor. Enlarged
Shaker cabinetry and aligned appliances, smoky blue trowelled plaster, a true
left-wall window aperture with layered sky/ground/houses, and an L-shaped
counter with a recessed stainless basin and correctly oriented gooseneck tap
make the zoomed-out view a complete room rather than an abstract plane. A
focused tungsten follow-spot uses
inverse-square falloff, a feathered cone, shadow map, visible warm emitter and
physical blackened-steel housing, and tracks the airborne ball. Pressing `L`
fades up recessed ceiling downlights, under-cabinet practicals and indirect
kitchen fill. An environment-lit physical clearcoat and procedural quartz
micro-normal keep the bench glossy without an unstable recursive planar
reflection target.

## Interaction and bounce

The cinematic bounce uses gravity, diminishing rebounds and a damped
deformation spring. Free-play adds 8.5-unit ground acceleration, 3.5-unit air
control, a 12-unit planar speed cap, rolling resistance, variable-height held
jumps, visible seam rotation and restitution against the island, kitchen floor,
ceiling and all four room walls. Rolling beyond the finite bench footprint
drops the ball naturally to the floor. The vertical
squash is paired with horizontal expansion to retain volume, and the shell,
seam, raster fibres and dynamic RTX atlas receive the same position, scale and
quaternion pose. Each collision triggers velocity-scaled native WAV playback,
capped at five-percent element volume. The committed sound is generated by
`tools/generate-impact-audio.mjs` from a softened rubber body mode, rounded
felt transient and restrained bench resonances. A four-voice pool permits
clean overlapping rebounds.

## Controls

- left-drag — orbit around the ball and stop the automatic macro tour
- right-drag or `Shift` + left-drag — brush the local nap; faster motion pushes harder
- wheel — dolly continuously from a 1.12-unit camera distance out to a 32-unit room view
- `L` — fade up the complete kitchen lighting and toggle physics/free-play
- `WASD` — accelerate the ball relative to the camera and build rolling momentum in free-play
- hold `Space` in free-play — jump immediately; holding longer adds lift
- `Space` outside free-play — stage the cinematic high bounce, squash and rebounds
- `X` — ray-lighting A/B while keeping simulation and dynamic RTX geometry active
- `R` — reset the follicle springs and cancel the bounce/deformation
- `T` — resume or pause the automatic product-to-macro tour
- `H` — hide or show the native-canvas bitmap HUD

Regenerate the authored impact sound with:

```powershell
node .\tools\generate-impact-audio.mjs
```

## Run

With an existing Runtime build, the sample is JavaScript/shader-only and does
not need a rebuild:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 `
  C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_tennis_ball_fibres\site-entry.mjs
```

Or from the Runtime project:

```powershell
cd C:\ThreeBrowser\ThreeBrowserRuntime
dotnet run -- .\samples\webgpu_rtx_tennis_ball_fibres\site-entry.mjs
```

The folder is discovered automatically in the Runtime launcher's sample list.

## Tests

```powershell
node --test .\samples\webgpu_rtx_tennis_ball_fibres\tests\*.test.mjs
```

The contract tests cover deterministic whole-ball layout, orthonormal follicle
frames, spring stability, seam exclusion, fixed tube/proxy topology, atlas
capacity, shader ABI bindings, frame ordering, shared bounce pose, kitchen/audio
contracts, manifest completeness and the no-readback/no-C++ boundary.
