# Secret River

A native WebGPU 2.5D Hawkesbury journey with a proper main screen and two ways
to enter:

- **Play the Game** — survey Broad Reach at Wisemans Ferry, unlock the crossing,
  travel into the Macdonald River / First Branch scene, trace its narrower
  bank, then return.
- **Riverbank Demo** — the original committed walking study, preserved as its
  own mode.

The camera sits over the water looking inland, so the river fills the bottom of
the screen, the dirt bank is the playable strip, and eucalyptus and sandstone
ridges recede behind.

Photoreal 2D cutouts (gums, wattles, reeds, grasses) stand as face-on cards in
a 3D bank. Native RTX ray queries supply grounded sun visibility and ambient
occlusion against organic proxy volumes, while a planar reflector mirrors the
actual painted cards into the creek. The walker uses a fixed-registration atlas
with a distance-driven gait, so its stride remains smooth at every frame rate.

The Game locations are reconstructed from a downloaded NSW Spatial Services
vector slice containing the Hawkesbury, Macdonald and Webbs waterways, nearby
roads, and the Wisemans/Webbs Creek ferry routes. The two authored stages use
separate shoreline profiles, terrain character and dressing seeds. The source
GeoJSON, build script and attribution are in
[`assets/maps/MAP_SOURCES.md`](assets/maps/MAP_SOURCES.md).

Inspired by the *place* in Kate Grenville's *The Secret River* — sandstone
country, tannin water, pale trunks — not an adaptation of the plot.

Run:

```powershell
node C:\ThreeBrowser\ThreeBrowserRuntime\build\bin\runtime\launch.mjs C:\ThreeBrowser\ThreeBrowserRuntime\samples\secret_river\site-entry.mjs
```

## Controls

| Input | Action |
| --- | --- |
| **W** / **S** or arrows | Choose on the main screen |
| **Enter** / **Space** | Start the selected mode |
| **A** / **D** or arrows | Walk along the river |
| **W** / **Up** | Step inland |
| **S** / **Down** | Step toward the water |
| **Shift** | Walk faster |
| **E** / **Enter** | Observe a waypoint or travel between locations |
| **Escape** | Return to the main screen from the Game |

The riverbank moves continuously through morning, midday, afternoon, sunset,
and night, including while travelling. RTX ray shadows and ambient occlusion
stay engaged automatically when the native bridge is available; each location
registers its own static ray scene and raster shadows remain the safe fallback.
There is no shader or RTX on/off control.

Game guidance and the real vector mini-map are painted into the WebGPU
presentation texture, so the native canvas-only runtime needs no HTML overlay.

## Validation

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\secret_river\tests\*.test.mjs
```
