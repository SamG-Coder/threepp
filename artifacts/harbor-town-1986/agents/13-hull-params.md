# 13 — Visual-hull parameters for town buildings

Audit of `harbor_town_1986` reconstruction vs `texture_2ds_to_3ds`.
No sample source was patched: `forceCount` is not ignoring `kind`; `kind` is
never passed into the reconstructor at all.

Launch numbers used below (approx, unique meshes):

| id | catalog.kind | reported shape | tris | note |
|---|---|---|---:|---|
| soba-shop | rectangle | custom | 62440 | gable + antenna + sign → flared/organic |
| you-arcade | rectangle | custom | 65124 | same |
| harbor-warehouse-8 | rectangle | **cylinder** | 47820 | **bad** — inscribed round hull |
| vending-enamel | rectangle | rectangle | 8312 | ok |
| phone-booth | rectangle | rectangle | 119932 | glass lattice, no cap |
| telephone-pole | cylinder | custom | 18408 | crossarm / transformer saved it |
| civilian-hiro | humanoid | custom | 9528 | ok-ish at 48³ |
| wooden-hill-house | rectangle | custom | 1324 | **overcarve** |
| yokobori-bar | rectangle | custom | 68604 | voxel candy |
| flower-shop | rectangle | custom | 5248 | ¾ still + photo carve |
| cassette-shop | rectangle | rectangle | 75800 | candy |
| greengrocer | rectangle | custom | 62868 | candy |
| tobacco-shop | rectangle | custom | 61984 | candy |
| harbor-warehouse-3 | rectangle | rectangle | 36608 | orthographic, ok-ish |
| kei-van | rectangle | rectangle | 43448 | ok-ish |

Unique total ≈ **687k** tris. Instanced vending / poles / warehouse-8 add ≈ 212k
more in-scene.

---

## What the town actually passes

```118:133:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
async function reconstructSubject(subject) {
  const catalog = subject.kind === "cylinder"
    ? CYLINDER_VIEWS
    : subject.kind === "humanoid" || subject.kind === "custom"
      ? HUMANOID_VIEWS
      : CARDINAL_VIEWS;
  const asset = await reconstructOrbitAsset({
    assetRoot: import.meta.url,
    folder: subject.folder,
    catalog,
    resolution: 48,
    silhouetteSize: 96,
    mapSize: 128,
    forceCount: catalog.length,
  });
```

`subject.kind` only picks **which PNGs to load** (2 / 4 / 8). It is not forwarded
as `options.shape`. Pipeline defaults (`visual-hull.mjs` / `tree-asset.mjs`) are
`resolution: 96`, `silhouetteSize: 160`, `mapSize: 512`. The town halved all
three for 15 assets.

Town materials use **vertex colors**, not the baked maps, so `mapSize: 128` is
spent and discarded.

---

## 1. Why warehouse-8 became a cylinder

**Yes: force shape from the catalog for buildings. `forceCount` cannot do this.**

### Classifier, not `forceCount`

`reconstructFromViews` classifies from the loaded silhouettes, then carves from
the classified kind:

```72:91:C:\ThreeBrowser\ThreeBrowserRuntime\samples\texture_2ds_to_3ds\src\tree-asset.mjs
  const working = views.map(view => resizeView(view, silhouetteSize));
  const shape = options.shape ?? classifyOrbitShape(working);
  const selection = chooseOrbitAngles(working, {
    resolution: options.angleResolution ?? Math.min(48, resolution),
    shape,
    forceCount: options.forceCount,
  });
  const chosen = pickViewsForShape(working, shape);
  const volume = carveVisualHull(chosen, { resolution });
  if (shape.kind === "cylinder" || shape.kind === "capsule") {
    snapOccupancyToPrimitive(volume, shape);
  } else {
    carvePhotoconsistent(volume, working, { ... });
  }
```

`forceCount` is consumed only by `chooseOrbitAngles` to pick a *report*
candidate (`assetReport.recommendedCount`). The voxels that actually get carved
come from `pickViewsForShape(working, shape)`. For `kind === "cylinder"` that
is **two** stills (0° and 90°), then `snapOccupancyToPrimitive` inscribes a
circle in the remaining square prism.

Warehouse-8 is catalogued `kind: "rectangle"` with 4 cardinals, so
`forceCount: 4`. Classification still ran, reported cylinder, snapped round.
That is working as coded — there is no one-line `forceCount` bug.

### Why the classifier said cylinder

`classifyOrbitShape` (`shape.mjs`):

- `hasCorners` needs a **45°** still (`diagonalRatio > 1.16`). Cardinal-only
  buildings never have one, so `hasCorners` is always false.
- `rotationallySymmetric = aspectCv < 0.12 && meanCardinalIoU > 0.85 && !hasCorners`
- Cylinder is assigned **before** rectangle:

```
humanoid → custom/organic/flared → capsule → cylinder → square → rectangle → custom
```

Warehouse-8 plan is nearly square (catalog 14 × 18 m; the stills look closer to
1:1). Front/side/back elevations therefore have similar aspect and high
silhouette IoU. With no diagonal, that is exactly `cylinderLike`.

Warehouse-3 stayed rectangle because it is a long slab (16 × 12) with a large
`planDelta`.

### The ¾ still made it worse

`harbor-warehouse-8/yaw-000.png` is a **perspective three-quarter** of a cube,
not an orthographic front. `yaw-090/180/270` are elevations. Visual hull
assumes orthographic yaw (`worldToPixel` is `x*right + z*right`, no
perspective). A ¾ silhouette is almost as wide as a side elevation, which
pushes aspect CV down and IoU up — more cylinder-like. After the snap, the
building is a round drum with the 倉42 facade smeared around it.

Warehouse-3’s `yaw-000` is a true elevation; that is why it classified
rectangle and kept box corners.

### Force catalog kind? Yes, for boxes. Not blindly for everything.

| subject | force catalog kind? |
|---|---|
| shops, warehouses, houses, van, vending, booth | **Yes — rectangle/square.** Classifier is blind without 45° stills, and gables/signs/`organic` (circularity < 0.22) or `flared` (crown > 1.35 × trunk from eaves) dump most shops into `custom`, which then photo-carves. |
| telephone-pole | **No.** Catalog says cylinder; classifier said custom because of the crossarm and transformer. Forcing cylinder would snap those off. Keep 2 stills, skip the primitive snap, or add a `cylinder+attachments` path. |
| hiro | Optional. Humanoid vs custom both use 8 views; the difference is UV and recommendedCount. 9.5k tris is fine. |

So: force **shape**, not just view count, and only where the catalog primitive
is the hull you actually want.

---

## 2. Is resolution 48 too coarse for shop facades?

**Yes for silhouette edges (eaves, signs, antennas). No for painted kanji —
those must stay in vertex color / albedo, not in the hull.**

The volume is a cube `[-r, r] × [0, 1] × [-r, r]` with `r ≈ silhouetteRadius`.
At `resolution: 48`:

- Y voxel ≈ `realHeight / 48` → **~15 cm** on a 7.2 m soba shop
- XZ voxel ≈ `2r / 48` → **~13–20 cm** on a 6–8 m façade

Windows, noren, sign letters, roof tiles are 1–3 voxels. Marching tetrahedra
plus 8× Laplacian (`smoothLambda 0.45`) turns that into candy / melted
cornices. 60–75k tris on a boxy shop is the giveaway: a solid 48³ AABB isosurface
is ~20–30k tris; the extra 2–3× is every stair-stepped voxel of eaves and
antennas.

`silhouetteSize: 96` is only 2 pixels per voxel — the minimum that does not
alias the carve. Pipeline default is 96 / 160.

Photo kanji (Nishiya, 花屋みどり, 倉42) already ride on full-res stills via
`projectVertexColors`. Raising hull resolution will not make letters sharper;
it will make the *outline* of the sign board less cubic.

Hill-house at **1324 tris** and flower-shop at **5248** are not “too coarse” —
they are **overcarved**. Side gable of the hill house is much wider than the
front/back silhouettes; visual-hull intersection collapses to a shaft, then
`carvePhotoconsistent` + `keepGroundConnected` chew the rest (photo-carve
rolls back only if filled drops below 40% of the *already-thin* hull).
Flower-shop `yaw-000` is another ¾ still against orthographic `yaw-090`.
Forcing `rectangle` and skipping photo-carve on those two would recover a
building more than any resolution bump.

---

## 3. Recommended per-kind resolution / silhouetteSize

Surface tris scale ~ `res²`. Do **not** lift the whole town to 96: the booth
alone would go past 200k.

| kind / use | res | silhouetteSize | mapSize | photo carve | mesh |
|---|---:|---:|---:|---|---|
| rectangle/square **shops & warehouses** | **64** | **128** | 256 (or skip) | off, or `photoIterations: 1` | isosurface, or `greedyMesh` if candy persists |
| rectangle **vending / van** | 40–48 | 80–96 | 128 | off | either |
| rectangle **glass booth** | **32**, and treat glass as opaque | 64 | 128 | **off** | greedy box, or isosurface with a **24k cap** |
| cylinder **pole** (if snapped) | 24–32 | 64 | 128 | n/a (snap) | isosurface |
| cylinder **pole with fittings** (keep custom) | 40–48 | 80–96 | 128 | 2 iter | isosurface |
| humanoid | 56–64 | 128 | 256 | 3–4 iter | isosurface |
| custom organic (trees; not in this town) | 80–96 | 160 | 512 | 4 iter | isosurface |
| **hill-house / flower-shop** until stills are ortho | 48 is enough **if** kind is forced rectangle | 96 | 128 | **off** | isosurface |

Rule of thumb: silhouetteSize ≈ 2× resolution. `angleResolution` can stay
`min(48, resolution)` — it only scores the unused `chooseOrbitAngles` report
once `shape` is forced.

Do not raise booth or shop res without the cap / greedy path. Town unique
budget today is ~687k; a sane target is **~250–350k** unique (shops ~25–40k
each at 64³ if photo-carve is off, furniture < 8k, booth < 24k).

---

## 4. How to pass `catalog.kind` into classify / reconstruct

The hook already exists. `classifyOrbitShape` does not take a force flag;
`reconstructFromViews` does:

```js
const shape = options.shape ?? classifyOrbitShape(working);
```

`reconstructOrbitAsset` forwards `options` unchanged.

### Helper (put next to `classifyOrbitShape` in `shape.mjs`)

```js
export function shapeFromKind(kind = "custom") {
  const generic = kind !== "custom" && kind !== "humanoid";
  const recommendedCount =
    kind === "cylinder" || kind === "capsule" ? 2
    : kind === "humanoid" || kind === "custom" ? 8
    : 4;
  return { generic, kind, recommendedCount, forced: true };
}
```

The extra fields (`aspectCv`, …) are diagnostics only.

### Town call (`reconstructSubject`)

```js
import { shapeFromKind } from "../../texture_2ds_to_3ds/src/shape.mjs";

const shape = shapeFromKind(subject.kind);
const asset = await reconstructOrbitAsset({
  assetRoot: import.meta.url,
  folder: subject.folder,
  catalog,
  resolution: hullParams[subject.kind].resolution,
  silhouetteSize: hullParams[subject.kind].silhouetteSize,
  mapSize: hullParams[subject.kind].mapSize,
  shape,                    // <-- this is the missing line
  forceCount: catalog.length,
  photoIterations: shape.generic && shape.kind !== "cylinder" ? 0 : 4,
});
```

`pickViewsForShape` will then keep all 4 cardinals for rectangle instead of
collapsing warehouse-8 to 2 views, and will **not** call
`snapOccupancyToPrimitive`.

Optional: if some subjects should still auto-classify (pole, hiro), only pass
`shape` when `subject.forceKind !== false`.

`classifyOrbitShape` itself does not need a `forceKind` argument unless you
want the diagnostic stats (aspectCv, planDelta) mixed into a forced object
for logging.

---

## 5. Phone-booth 120k tris — cap?

**Yes. Cap, and stop carving glass as a lattice.**

`phone-booth/yaw-090.png` shows magenta **through the glass**. `magentaKeyAlpha`
punches those pixels out, so occupancy is a metal cage + the phone body.
Almost every remaining voxel is a surface voxel. Marching tetrahedra on a 48³
sponge is ~120k tris — about 4–5× a solid box at the same res, and 17% of
the unique-mesh budget for one 0.9 × 0.9 × 2.4 m prop (catalog rectangle,
correctly classified, so photo-carve still ran and hollowed it further).

A post-extract triangle cap (decimate to N) would shrink the mesh but keep a
spiky cage. Prefer, in order:

1. **Treat glass as opaque** at key time for this asset (or a
   `solidSilhouette: true` that flood-fills each still’s alpha bounds before
   carve). Then a 32³ rectangle isosurface is ~8–12k tris, or greedy ~200.
2. **Skip `carvePhotoconsistent`** for rectangle/square street furniture.
3. **Hard cap** `mesh.triangleCount` at **24k** (booth) / **48k** (shop) as a
   safety net, with a console warning. Do not cap by dropping random
   tetrahedra — if over cap, either greedy-mesh the occupancy or drop
   resolution one step and retry.
4. Do **not** raise booth resolution. 64³ of a glass cage would be ~200k+.

Vending at 8.3k is the right scale for furniture. Booth should land in that
band, not 14× higher.

---

## Also broken (same root)

- **Most shops → custom** because gables/signs trigger `flared` or
  `organic`. Custom runs photo-carve and 8-view logic on 4 stills. Force
  rectangle unless the subject is truly non-box (kei-van can stay rectangle;
  it already classified correctly).
- **¾ vs elevation mismatch** (warehouse-8 `yaw-000`, flower-shop `yaw-000`)
  is a stills problem, not a voxel-count problem. Replace those with
  orthographic cardinals; the hull assumes `worldToPixel` orthographic yaw.
- **`keepGroundConnected` after photo-carve** on the hill house: disconnected
  planters sit at y=0 in some views and become the flood-fill seed, or the
  carved remnant is a thin ground blob (1324 tris). Force rectangle + no
  photo-carve first; only then consider disconnecting pots from the hull.
- **`mapSize: 128` is unused** in the town (MeshBasic vertex colors). Spend
  the budget on silhouetteSize or skip the bake.

---

## Patch status

No source edited. The missing wiring is `shape:` on `reconstructOrbitAsset`,
not a one-line `forceCount` fix. `forceCount: catalog.length` only affects the
angle-scoring report; `pickViewsForShape` and `snapOccupancyToPrimitive` key
off classified `shape.kind`.
