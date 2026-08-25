# RTX Infinite Descent

An original ThreeBrowser Runtime sample that continuously descends through one
ancient sword: forge, blade relief, metal grains, a body-centred-cubic iron
lattice, an atom, an iron-56 nucleus, and an abstract energy field that reforms
the forge and begins the journey again.

No downloaded model, image, texture, font, audio file, or Infinite
Descent-specific native code is used. The forge, sword, procedural material
response, particles, lattice, probability-density field, scale HUD, camera and
all transition behavior are authored in JavaScript, Three.js and TSL.

## A scale transition, not seven scene fades

Every domain uses normalized local coordinates appropriate to its scale. The
authored camera first reaches the outgoing focal feature, then a 2.25-second
close-focus move fills the frame with that scratch, grain, atom or energy
structure. Only then does a fixed 1.25-second geometric handoff begin. Nested
particle shells and wire membranes reveal the next domain's real geometry
behind the focal surface, already near the current camera projection rather
than appearing as a miniature panel. At the boundary, the camera and world root
keep the exact similarity transform, then ease back to the incoming domain's
canonical frame over 0.8 seconds. The same transform is used in reverse, so
changing direction does not expose a cut. Apparent screen size, view direction
and field of view remain continuous; there is no full-screen cross-fade.

The native bridge owns one immutable acceleration structure. To avoid a BLAS /
TLAS rebuild at every scale, normalized domains occupy isolated cells in an AS
atlas. Those cell offsets are renderer bookkeeping, never physical units. The
visible root and camera move to the same cell at each rebase, and ray distance
prevents domains from interacting. During the short two-domain geometric
handoff, the persistent raster path is used; temporal history is reset before
native adaptive presentation resumes.

At most two domain roots render. The incoming root grows continuously during a
handoff, and the outgoing root remains animated while it fades through the
short settlement interval. Previous and next domains stay warm; all remaining
roots are dormant, so memory does not grow as the loop repeats.

## Representations

- **Forge:** instanced settled masonry, timber structure, moon doorway, wet
  flagstones, furnace arch/coals, layered flames and heat bloom, smoke, dust,
  sparks, tools, quench barrel, anvil, and a fully procedural old sword. A tool
  gallery and hot-steel rack behind the camera exist specifically to prove
  off-screen blade reflections.
- **Surface:** a 33,000-vertex blade relief turns the material's scratch into a
  canyon. Hundreds of real polishing grooves, oxide fragments, partially
  exposed steel/carbide inclusions, suspended metallic dust and microscopic
  droplets replace the macro normal response progressively.
- **Microstructure:** bounded instanced crystal grains in four orientations form
  a grain-boundary tunnel, with translucent intergranular membranes, emissive
  boundary energy and a progressively resolving BCC basis/bond field.
- **Crystal:** an exact body-centred-cubic structure with 576 shared corner
  sites, 385 body centres and 3,080 nearest-neighbour bonds.
- **Atomic:** 12,900 probability-density points, layered orbital wisps and a
  thermally vibrating nucleus. Orbiting coloured balls are deliberately not
  used as an electron model.
- **Nucleus:** iron-56, represented as 26 instanced protons and 30 instanced
  neutrons inside a 5,200-point artistic short-range force field.
- **Energy:** a bounded ray-query proxy field plus 20,900 apparent light paths.
  The field resolves into a doorway, anvil and diagonal sword before the loop
  rebases into the real forge.

The atomic, nuclear and energy stages are artistic, physically inspired
visualizations—not claims of literal quantum simulation.

## RTX path

The project vendors the current generic adaptive reflection presenter and owns
its canonical `reflections-v2` GLSL source. On supported hardware the frame is:

1. Three.js HDR MRT: color, dense motion, diffuse/specular albedo,
   world-normal/roughness and depth.
2. Generic ray-query key-light visibility and contact AO.
3. Deterministic two-bounce reflections, or three in high-quality mode, into a
   distinct noisy HDR target plus world-space specular hit distance.
4. DLSS Ray Reconstruction when it evaluates successfully; DLSS Super
   Resolution is the per-frame fallback.
5. Tone mapping into a full-resolution HUD-less target, Frame Generation tag,
   and one final canvas presentation with a separate JavaScript HUD.

The forge also updates 64 bounded emissive spark instances through the public
fixed-capacity instance-group API, refitting the TLAS without rebuilding their
shared geometry. All other apparent particle density stays GPU-friendly raster
content.

The in-canvas HUD says `ACTIVE` only when
`navigator.gpu.threeBrowserRTX.getStatus().features.<feature>.active` says so.
Support, requests, successful queueing, and configuration are never presented
as activation. Shift+Tab remains the authoritative detailed runtime panel.

## Controls

- `Space` — pause / resume
- `R` — reverse time
- mouse wheel or `+` / `-` — continuous speed control
- `1`–`7` — jump to forge, surface, microstructure, crystal, atomic, nucleus or
  energy (debug controls; hidden by default)
- drag — restrained look offset
- `A` — restore forward automatic cinematic mode at normal speed
- `D` — show / hide the debug control and streaming panel
- `H` — hide / show all HUD elements

The minimal scale and domain indicator remains visible by default. General HTML
or CSS overlays are not required.

## Run and validate

```powershell
cd C:\ThreeBrowser\ThreeBrowserRuntime
pwsh -File .\run.ps1 .\samples\webgpu_rtx_infinite_scale\site-entry.mjs
```

Unit and structural contracts:

```powershell
node --test .\samples\webgpu_rtx_infinite_scale\tests\*.test.mjs
```

The native accelerated full-loop validation records every domain rebase, WebGPU
validation error, RTX active/evaluation counters and heap samples:

```powershell
$env:THREEBROWSER_INFINITE_SCALE_TEST_MODE = "1"
$env:THREEBROWSER_INFINITE_SCALE_REPORT = "C:\Temp\infinite-scale-report.json"
pwsh -File .\run.ps1 .\samples\webgpu_rtx_infinite_scale\site-entry.mjs
```

Set `THREEBROWSER_INFINITE_SCALE_TEST_REBASES=15` to continue through a second
complete loop for a longer memory-stability soak.

Set `THREEBROWSER_INFINITE_SCALE_TEST_START_SECONDS` to begin an automated
visual/timing probe at an exact journey time; for example, `32` starts just
before the forge's final close-focus move.
Add `THREEBROWSER_INFINITE_SCALE_TEST_HOLD_AFTER_PREWARM=1` to hold that exact
frame after preparation; press Space in the runtime window to release it.

The automated runner defaults to `8×` so the full loop completes quickly while
the visible sample remains at its `1×` cinematic pace. Set
`THREEBROWSER_INFINITE_SCALE_TEST_SPEED=1` and
`THREEBROWSER_INFINITE_SCALE_TEST_REBASES=2` for a production-speed timing probe
of the first forge-to-surface handoff.

The current native runtime is built without audio output. The scale architecture
keeps audio behavior project-owned, but this sample does not claim an audible
soundscape on that build.
