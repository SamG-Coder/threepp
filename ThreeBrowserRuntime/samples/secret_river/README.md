# Secret River

A zoomed-out 2.5D side-on walk along a Hawkesbury creek. The camera sits over
the water looking inland, so the creek fills the **bottom of the screen**, the
dirt bank is the playable strip, and eucalyptus hills recede behind.

Photoreal 2D cutouts (gums, wattles, reeds, grasses) stand as face-on cards in
a 3D bank. Native RTX supplies sun shadows and one-bounce water reflections.
The walker uses a keyed profile plus a walk-cycle when moving.

Inspired by the *place* in Kate Grenville's *The Secret River* — sandstone
country, tannin water, pale trunks — not an adaptation of the plot.

Run:

```powershell
node C:\ThreeBrowser\ThreeBrowserRuntime\build\bin\runtime\launch.mjs C:\ThreeBrowser\ThreeBrowserRuntime\samples\secret_river\site-entry.mjs
```

## Controls

| Input | Action |
| --- | --- |
| **A** / **D** or arrows | Walk along the creek |
| **W** / **Up** | Step inland |
| **S** / **Down** | Step toward the water |
| **Shift** | Walk faster |
| **1**–**5** | Morning, midday, late afternoon, sunset, night |
| **X** | RTX lighting/reflections on or off |

No on-screen HUD. Status stays in stdout.

## Validation

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\secret_river\tests\*.test.mjs
```
