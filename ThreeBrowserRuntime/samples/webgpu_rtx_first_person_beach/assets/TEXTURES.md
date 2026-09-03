# Texture provenance

All six albedo sources were generated on 2026-09-03 with Grok image generation
as orthographic, neutrally lit material scans, then converted to 1024×1024 RGB
PNG. Height and object-space-style tangent normals are not generated images.
They come from `src/tile-relief.mjs`, a JavaScript port of FakeDepthTrick
`MakeSeamless.cs` and `BakeRoadMaps` in `world_maps.cpp`.

| Tile | Mode | Height gain | Normal strength | Notes |
| --- | --- | --- | --- | --- |
| dry-sand | quilt | 1.85 | 6.4 | Rotation-safe grain |
| wet-sand | quilt | 2.35 | 8.6 | Diagonal ripples encode direction |
| pebble-hash | quilt | 3.15 | 10.4 | High-contrast stones; residual 2×2 plus is faint |
| coastal-rock | wrap | 3.2 | 11 | Cracked coastal greywacke |
| dune-grass | quilt | 1.45 | 5.4 | Top-down thatch |
| palm-bark | wrap | 2.85 | 11.2 | Periodic diamond scars; not quilted |
| lunar-surface | keep | 2.4 | 8.5 | Generated lunar albedo; height/normals baked, not quilted |

Grok corner marks are patched, then excluded by the 5/8 centre crop on quilted
tiles. Palm bark keeps its grid and only wrap-blends the edges.

Re-bake:

```powershell
node .\samples\webgpu_rtx_first_person_beach\tools\bake-tile-maps.mjs
```
