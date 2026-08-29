# 29 — Vertex color bake vs Sakae north smear

Harbor shops are reconstructed by `harbor_town_1986/src/main.mjs` →
`texture_2ds_to_3ds/src/tree-asset.mjs` `reconstructFromViews`, then drawn with
`MeshBasicMaterial({ vertexColors: true })`. The albedo maps are computed and
thrown away. Displayed colour is **only** the isosurface vertex colours.

## What the mesh actually shows

`extractIsosurface` → `projectVertexColors` (`isosurface.mjs`) paints every
vertex from **one** orbit still:

1. `nearestViewByAzimuth(x, z, views)` picks the still whose camera yaw is
   closest to `atan2(x, z)` of the **vertex position** (not the face normal).
   README calls this the nearest-yaw cake slice.
2. `worldToPixel` orthographically projects that world point onto the still
   (`x·right`, `y` up, no perspective, no occlusion).
3. `sampleViewAtPixel` bilinear-samples the full-res photo (via `colorView`
   when the hull was carved from a resized silhouette).
4. `punchierPhotoRgb` saturates and lifts the sample; sRGB → linear is written
   into `mesh.colors`.
5. Eight Laplacian iterations (`smoothLambda` 0.45, 12 for primitives) move
   vertices **before** this projection, so the sample is already off the photo
   plane.

UVs go through `wrapUv` (box atlas for `rectangle`, photo-planar `customUv`
otherwise). Harbor never binds those UVs to a map.

`bakeVoxelColors` (`color-bake.mjs`) is a **different** path: every occupied
voxel accumulates **all** views with a soft facing term

```
facing = max(0.08, camera.xz · vertex.xz + 0.35)
```

so a front-face voxel is still ~20% left + ~20% right + a 0.08 floor from the
back. Those averaged RGB values feed `bakeMaterialMaps` only.

## Why facades smear (cake slice vs resolution 48)

Sakae north (`artifacts/harbor-town-1986/sakae-north.png`) and the arcade
close-up show voxel-sized colour blobs, especially Starlight Arcade windows.
Two mechanisms stack.

### Cake slice is the wrong partition for a box

`nearestViewByAzimuth` is a Voronoi diagram in XZ. With four cardinal stills
the cells are 90° wedges. For a cube-filling hull the front face sits at
`z ≈ +r`, `x ∈ [−r, +r]`, so azimuth at the corners is **exactly ±45°** — the
slice boundary. Laplacian rounding pushes corner vertices across that
boundary, so one triangle samples the front still and its neighbour samples
the side still. GPU interpolation then gradients window-neon into side-wall
tile.

The stills themselves are not elevations. `you-arcade/yaw-000.png` is a
**¾ perspective** of front *and* right wall; `yaw-090.png` is a near-ortho
side. Cake-slice then orthographically splats the entire +Z hemisphere with
that ¾ photo: front-face vertices walk a horizontal line across an image
where the real windows occupy a trapezoid on the left. Samples jump from
glass to corner tile to side wall to keyed magenta (then the facing
fallback). Greengrocer `yaw-000.png` is closer to a true elevation, which is
why Yaoya in sakae-north is more readable than the arcade — still blotchy,
but not a ¾ photo painted onto a box.

There is no visibility test. A vertex on the side of the potato that happens
to sit in the front wedge still samples the front photo.

### Resolution 48 cannot hold arcade windows

Harbor calls:

```js
reconstructOrbitAsset({
  resolution: 48,
  silhouetteSize: 96,
  mapSize: 128,
  forceCount: catalog.length,
})
```

The visual hull is a cube of side `max(width, height, depth)`. Starlight
Arcade is catalogued 8.0 × 7.8 × 10 m, so the 10 m axis fills 48 cells:

| | 48 | 64 | 80 |
|---|---|---|---|
| cells across 8 m façade | ~38 | ~51 | ~64 |
| 1.5 m window | ~6 | ~8 | ~10 |
| voxel size on façade | ~21 cm | ~16 cm | ~12 cm |

Marching tetrahedra emit vertices on voxel edges; `MeshBasicMaterial`
interpolates RGB between them. A window with blinds and paper notices needs
tens of samples across the pane, not six. The hull is also carved from
**96 px** silhouettes, so the geometry itself is a rounded 48³ potato
(photoconsistency + tet isosurface + Laplacian), not a plane the photo can
project onto.

Photoconsistency (`carvePhotoconsistent`, default 4 iterations, threshold 96)
only carves a voxel when **three** cameras agree it is a colour outlier. A
front-window voxel that sees the ¾ front still and a side still disagrees
hard; unique-witness / `colors.length < 3` skips some, but corners get eaten
and the surface recedes. Receded vertices then sample the wrong photo
pixels. That pass is designed for trees. Rectangles still run it because
harbor does **not** pass `shape` from the catalog — `classifyOrbitShape`
decides, and a tiled arcade with a ¾ silhouette can fail `rectangleLike`
(`hasCorners && planDelta ≥ 0.14`).

`snapOccupancyToPrimitive` only snaps cylinders/capsules. Shops stay lumpy.

## Raising resolution to 64 or 80 — not worth it

The heavy loops are all `O(resolution³ × views)`: visual hull, four
photoconsistency passes (each rebuilds fronts), colour bake, chamfer SDF,
marching tets, map splat. Voxel count:

- 48³ = 110 592
- 64³ = 262 144 (**2.37×**)
- 80³ = 512 000 (**4.63×**)

Harbor reconstructs 15 unique subjects (12 rectangles × 4 views, Hiro × 8,
pole × 2). 48 → 80 is roughly 4.6× that bill, every load.

What it buys on arcade windows: ~6 → ~10 vertices across a pane, still
linear RGB, still a ¾ cake slice, still Laplacian drift. Blinds and lettering
will not appear. Geometry gets slightly less voxelly; the blotch remains
cake-slice + vertex-colour interpolation.

**Do not raise voxel resolution for rectangle shops.** Spend the cost
elsewhere (below). If anything, `silhouetteSize` 96 is the geometry limiter
that is cheap to bump (2-D), but it will not fix colour.

## mapSize 128

`ORBIT_ASSET.mapSize` defaults to 512. Harbor overrides **128**.

`bakeMaterialMaps` splats **surface-voxel** RGB (the averaged
`bakeVoxelColors`, not the cake-slice vertex colours) into a `width × height`
atlas using `wrapUv`. For `rectangle`/`square` that atlas is a 3×2 box:

- each face ≈ 128/3 × 128/2 ≈ **42 × 64 texels**
- arcade 8 m façade ≈ **19 cm / texel**
- 1.5 m window ≈ 8 texels

Harbor `createGeometry` copies `mesh.uvs` but the material has **no `map`**.
The 128 atlas is CPU work for nothing. Even if bound:

- 42×64 cannot hold arcade windows or signage.
- the texels are the *averaged* voxel colours (front mixed with sides), so
  they are muddier than the vertex colours already on screen.
- unused-atlas fill is the tree-green `(48, 62, 38)`.

Raising `mapSize` without binding a map is free-looking waste. Binding the
current 128 map would look *worse* than vertex colours. A shop atlas that
could compete with the stills wants **512–1024** and must be sampled from the
facing still (see cheap tricks), not from `bakeVoxelColors`.

## hollowCanopy does **not** run on shops — no patch

`reconstructFromViews` (`tree-asset.mjs`):

```js
const canopyY = options.canopyY ?? estimateCanopyStart(working);
if (options.hollowCanopy === true && shape.kind === "custom") {
  hollowCanopy(volume, canopyY, options.canopyThickness ?? 2.6);
}
```

Harbor `reconstructSubject` never passes `hollowCanopy`, so the flag is
falsy. The call is skipped for every Minamihama subject, including trees if
any used this entry point.

Even if someone passed `hollowCanopy: true`:

- rectangles / squares / cylinders / capsules / humanoids would still skip
  because of `shape.kind === "custom"`
- only a shop **misclassified** as `custom` *and* opted in would be hollowed
  (interior carved to `canopyThickness` 2.6 voxels above `estimateCanopyStart`,
  which looks for green foliage and would mostly stay at 0.38 on a building)

`estimateCanopyStart` still runs on shops and writes `volume.canopyY`; nothing
downstream uses that for colour.

**Verdict:** options already skip hollowing for non-trees. Not a bug. Sample
source was not edited.

(The tree sample `texture_2ds_to_3ds/src/main.mjs` also does not pass
`hollowCanopy: true`, so the oak/willow potato is currently solid too. That
is outside this note.)

## Cheap tricks (do these instead of 64/80)

1. **Do not hollow buildings** — already the case; keep the `hollowCanopy ===
   true && kind === "custom"` guard. Never default it on.

2. **Stop using vertex colours for rectangle shops.** Bind the cardinal still
   (or a box atlas built *from the stills*, not from voxel RGB) as
   `MeshBasicMaterial.map` with `boxUv`. One 512² face texture beats 80³
   vertices for arcade glass. Harbor already has `mesh.uvs`.

3. **Pick the still by face normal, not XZ azimuth.**
   `projectVertexColors` already has `nx, ny, nz` and a facing fallback, but
   the primary is cake-slice. For a box, `argmax |n|` → matching cardinal
   still. That stops the ±45° corner blend. Cheap, one condition, helps
   every shop including the arcade sides. Does **not** fix a ¾ photo being
   used as an elevation.

4. **Pass catalog `kind: "rectangle"` into `reconstructFromViews`.** Harbor
   already knows; the pipeline re-classifies from 96 px silhouettes and may
   mark an arcade as `custom`, which then photo-carves and uses `customUv`
   (another cake slice). Forcing rectangle also lets you skip
   `carvePhotoconsistent` (needs 3 cameras; windows are supposed to disagree).

5. **Snap rectangles to a box** the way cylinders snap to a radius
   (`primitive-fit.mjs`). Planar faces + `boxUv` + a still = Shenmue-style
   photo cubes. Laplacian on a lumpy hull is what warps the arcade lettering.

6. **Drop or cut Laplacian on rectangles** (`smoothIterations: 0` or 2).
   Vertices stay on the hull the photo was carved from, so `worldToPixel`
   hits the same pixels the silhouette used.

7. **Leave `mapSize` at 128 until maps are displayed.** If you switch shops
   to maps, bake from the facing still via `photoUv` / `boxUv`, not
   `voxelRgb`, and use ≥512. Do not average views (`color-bake.mjs` 0.08
   floor is poison for façades).

8. **Regenerate arcade (and any other ¾) stills as true elevations**, or crop
   the ¾ to the facing plane before chroma-key. Cake-slice ortho cannot
   unwrap a perspective ¾ onto a box no matter the voxel budget. Yaoya’s
   head-on `yaw-000.png` is the template; `you-arcade/yaw-000.png` is the
   counterexample.

## Harbor knobs as they stand

| knob | value | effect on Sakae north |
|---|---|---|
| `resolution` | 48 | ~38 cells on arcade front; window ≈ 6 vertices |
| `silhouetteSize` | 96 | hull fidelity; cheap vs 48³ colour |
| `mapSize` | 128 | unused; 42×64 per box face if bound |
| `hollowCanopy` | omitted | skipped |
| `shape` | omitted | reclassified; may not stay `rectangle` |
| material | `MeshBasicMaterial` + `vertexColors` | cake-slice RGB, no albedo |
| views | 4 cardinal | 90° wedges; ¾ front still on arcade |

**Recommendation:** do not spend 2.4–4.6× voxel cost. Keep 48, keep
hollowCanopy off for buildings, pick stills by face, bind a still-based map
(or snap to a box and projective-UV the elevations). Arcade windows smear
because a ¾ photo is cake-sliced onto a 48³ potato, not because 48 is just
shy of 64.
