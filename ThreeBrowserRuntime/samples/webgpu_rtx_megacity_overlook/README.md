# RTX Megacity Overlook

A JavaScript-authored, high-density megacity skyline inspired by cinematic
science-fiction city photography: deep telephoto layering, orange storm glow,
cyan industrial fog, canals, elevated transit, original emissive billboards,
flying traffic and ray-traced wet infrastructure.

The default shot follows a real establishing-shot layout rather than a random
city grid: a 520 m foreground basin narrows into two visible canal stages,
ground and elevated transport cross the water, dense districts occupy both
banks, and a warm crown cluster sits beyond cyan height fog. The safe 16:9
composition preserves the same water/transport/skyline hierarchy as the wider
panoramic reference.

The sample reuses the generic Light Transport Observatory JavaScript RTX
bridge without changing native code. All district-specific geometry,
materials, animation, lighting, camera work and generated textures live in
this folder.

Run with:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_megacity_overlook\site-entry.mjs
```

## Controls

- `A` — cinematic drift / locked composition
- `1`–`4` — authored skyline compositions
- `T` — aerial and elevated traffic
- `F` — atmospheric fog cards
- `Q` — maximum / balanced RTX quality
- drag — restrained telephoto orbit
- wheel — dolly

## Texture provenance

`assets/megacity-display-atlas.png` is an original generated 4 x 4 atlas made
for this sample. It contains no recognizable brands or copied advertisements.
Some tiles are used as restrained recessed-room facade fields behind real
structural fins and mullions—the same production trick used to imply thousands
of occupied rooms without making each room separate geometry. Procedural
JavaScript `DataTexture` maps supply concrete, painted metal and rain-grimed
glass albedo/roughness/normal breakup, while canal ripples remain animated TSL.

The raster city adds 2,800+ instanced scale cues—parapets, rooftop HVAC,
fans, tanks, vents, conduits, antennas, dishes, cranes and service gantries.
They are deliberately excluded from the ray scene. Native RTX instead sees a
coarse static city/canal proxy plus fixed-capacity aircraft proxies, keeping
MAX-quality reflection, shadow and ambient-occlusion rays practical.

## JS-only boundary

No C++ or project-owned native shader is used or changed. The sample imports
only the existing generic Observatory reflection bridge; every city-specific
asset, material, layout, camera, texture, fog layer and animation lives here.
