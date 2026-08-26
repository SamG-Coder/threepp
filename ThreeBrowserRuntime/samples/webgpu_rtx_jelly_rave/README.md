# RTX Jelly Rave

An original ThreeBrowser Runtime demo set inside a reflective neon warehouse:
fourteen soft, translucent jellies bounce, collide, squash and wobble below a
massive gummy humanoid DJ while the lighting and motion follow an original
procedural rave track. The oversized performer works the decks above the
crowd, and the camera can orbit from a full warehouse view into the clearcoat
surfaces where the jellies pick up the LED wall, lasers, spotlights and
neighboring colors in their reflections.

Everything specific to the demo is project-owned JavaScript and generated
content. The committed soundtrack is recreated by the included Node generator;
it is not a downloaded or remixed commercial recording.

## Rendering architecture

This is a **hybrid real-time WebGPU/RTX frame**, not a full path tracer.

- Three.js/WebGPU rasterizes primary visibility for the enclosed warehouse,
  reflective epoxy floor, DJ booth, decks, massive gummy humanoid DJ, speaker
  stacks, trusses, haze, practical emitters and fourteen
  clearcoat/transmissive jelly meshes.
- The fixed warehouse geometry is collected into a static native ray scene.
  The deforming jelly membranes are packed into one dynamic RTX triangle
  stream whose BLAS is refitted from the current soft-body poses instead of
  rebuilding the room or leaving duplicate frozen silhouettes behind.
- Project-owned native ray-query lighting adds deterministic reflection and
  visibility information from the reflective club environment. Stable
  material guides preserve each jelly's tint, roughness and metallic response.
- `X` keeps the same physics and composition while switching between the RTX
  lighting result and the raster fallback for an honest A/B comparison.

The result is designed to demonstrate live, reflected light on substantially
deforming objects. It does not claim multi-bounce offline path tracing.

## Jelly simulation

The jellies run through a deterministic fixed-step soft-body model with:

- gravity, floor and arena-wall response;
- jelly-to-jelly collision and momentum transfer;
- volume-preserving squash and stretch;
- damped wobble modes driven by landings and the soundtrack;
- beat impulses and pointer shockwaves; and
- bounded deformation values suitable for both raster meshes and dynamic RTX
  refits.

Pressing `Space` drops a stronger impulse into the group. Right-clicking on the
floor launches a local radial shockwave, which can set off a chain of impacts
through nearby bodies. `R` returns the complete simulation to its authored
starting arrangement.

## Original soundtrack and music response

`assets/neon-jelly-rave.wav` is an original 45-second, 128 BPM rave/house loop
generated at 48 kHz stereo PCM16 by `tools/generate-rave-track.mjs`. It combines
four-on-the-floor kicks, rolling bass, syncopated rave stabs, stereo delay,
transition risers, two drops and a liquid breakdown. The encoded master peaks
below full scale, and playback starts at a restrained 38-percent element
volume.

The playback controller never starts during page construction. Press `M` from
a user gesture to start or pause it safely under browser autoplay rules. Its
authored musical grid exposes beat phase, kick pulse, bass, section energy,
drop and finale-strobe values to the visuals, so the jelly impulses and club
lighting remain synchronized without microphone access or an approximate live
FFT. The WAV also embeds one cue marker per beat.

Regenerate the deterministic soundtrack with:

```powershell
node .\tools\generate-rave-track.mjs
```

## Controls

- left-drag — orbit the camera around the dance floor
- wheel — zoom between jelly close-up and full DJ-warehouse views
- right-click — launch a local floor shockwave
- `Space` — apply a strong drop impulse to the jellies
- `M` — start or pause the rave music
- `X` — switch between RTX lighting and raster fallback
- `C` — cycle the jelly and lighting palette
- `R` — reset the jelly simulation

## Run

With an existing Runtime build, the sample is JavaScript-only and does not
require a native rebuild:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 `
  C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_jelly_rave\site-entry.mjs
```

Or from the Runtime project:

```powershell
cd C:\ThreeBrowser\ThreeBrowserRuntime
dotnet run -- .\samples\webgpu_rtx_jelly_rave\site-entry.mjs
```

## Tests

```powershell
node --test .\samples\webgpu_rtx_jelly_rave\tests\*.test.mjs
```

The focused tests cover deterministic fixed-step physics, collision and volume
bounds, dynamic RTX mesh topology/refits, soundtrack metadata and levels,
music-analysis wrapping, and autoplay-safe controller behavior.
