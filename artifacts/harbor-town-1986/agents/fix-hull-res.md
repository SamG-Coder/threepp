# Hull resolution — custom / humanoid 64³

Patch of the `reconstructSubject` resolution / silhouette / photo-carve
selection in `ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs`.
Catalog, stills, and the rest of reconstruct are untouched.

Time lock: Saturday 29 November 1986, 15:20.

---

## Why

Foreground organics (zelkova / oak / willow, Hiro) were marching at the
same voxel budget as a shop box. The previous gate was:

```js
const small = subject.id === "phone-booth" || subject.kind === "cylinder" || subject.realHeight < 2.2;
const resolution = small ? 32 : 48;
const silhouetteSize = small ? 64 : 96;
```

That put **Hiro** (1.72 m humanoid) and **steel-bin** (0.75 m custom) on
32³ / silhouette 64, and the **trees** on 48³ / 96 — same as a warehouse.
Agent 59 already called 32³ fatal for a 1.72 m person; agent 42 asked
oak/willow for 64³ / 128. Torn trunks and chewed A-stances are voxel
alias, not still defects.

Boxes were never the complaint. A 64³ shop would ~double unique tris
without un-melting 瓦. The green phone booth at 48³ was already a ~120k
glass lattice (`13-hull-params.md`); 64³ would be 200k+.

---

## Selection (current)

| gate | res | silhouetteSize | photoIterations | who |
|---|---:|---:|---:|---|
| `kind` custom **or** humanoid | **64** | **128** | 4 | zelkova, english-oak, weeping-willow, steel-bin, civilian-hiro |
| `id` phone-booth | **32** | **64** | 0 | green kiosk — glass stays opaque-enough not to lattice |
| `kind` cylinder | **32** | **64** | 4 | oil-drum (tiny), telephone-pole (thin, not tiny, still 32) |
| everything else (rectangle / square boxes) | **48** | **96** | 0 | shops, warehouses, van, cub, vending, crate-stack, bus |

`silhouetteSize` stays 2× `resolution`. Boxes stay at **48** (not 56):
the torn-organic bug is not a shop-voxel bug, and 56³ would still melt
eaves (`29-color-bake.md`, `40-v5-shop-qa.md`). Small boxes that used to
fall through `realHeight < 2.2` (vending 1.82 m, Cub 1.05 m, crate-stack
1.60 m) now share the 48³ box budget — they are not organics and not
glass.

Photo-carve is unchanged: off for rectangle/square, 4 iterations for
custom / humanoid / cylinder.

---

## Before → after (unique meshes)

| id | kind | h (m) | was | now |
|---|---|---:|---|---|
| civilian-hiro | humanoid | 1.72 | 32 / 64 | **64 / 128** |
| zelkova | custom | 7.5 | 48 / 96 | **64 / 128** |
| english-oak | custom | 15 | 48 / 96 | **64 / 128** |
| weeping-willow | custom | 12 | 48 / 96 | **64 / 128** |
| steel-bin | custom | 0.75 | 32 / 64 | **64 / 128** |
| phone-booth | rectangle | 2.4 | 32 / 64 | 32 / 64 |
| oil-drum | cylinder | 0.88 | 32 / 64 | 32 / 64 |
| telephone-pole | cylinder | 10 | 32 / 64 | 32 / 64 |
| vending-enamel | rectangle | 1.82 | 32 / 64 | 48 / 96 |
| honda-cub | rectangle | 1.05 | 32 / 64 | 48 / 96 |
| crate-stack | rectangle | 1.6 | 32 / 64 | 48 / 96 |
| shops / warehouses / bus | rectangle | ≥2.2 | 48 / 96 | 48 / 96 |

Do **not** raise the booth. Do **not** lift the town to 64. Cylinder
snap is still 24–32 (`13-hull-params.md`); the 10 m pole stays coarse
because it is a thin primitive, not an organic.

---

## Not this patch

- `mapSize` stays 128. Colour smear is a bake problem (`29-color-bake.md`),
  not a hull-res problem.
- `hollowCanopy` is still not passed (oak/willow can fill into potatoes
  at any res — agent 42).
- Cub / zelkova stills that already over-carve (agent 59) need still
  edits or `photoIterations: 0` on zelkova; extra voxels will not invent
  spokes or winter twigs.
- `forceCount` / `shape.kind` already wired; leave them.
