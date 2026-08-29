# 45 — Minamihama tree grid (`english-oak` / `weeping-willow`)

Do **not** edit `catalog.mjs` from this note. Parent copies stills, adds
the two `ORBIT_SUBJECTS`, then appends the clone rows to `INSTANCES`.

Convention: metres, `+X` east, `+Z` south. Yaw `0` faces south. Trunk
spacing **≥ 8 m**. Canopies are allowed to overlap (oak 14 m, willow 12 m).

Meshes (same ids / metres as `texture_2ds_to_3ds` `tree-asset.mjs`):

| id | folder | H × canopy | kind / views |
|---|---|---|---|
| `english-oak` | `tree` | **15 × 14** | `custom`, 8 |
| `weeping-willow` | `willow` | **12 × 12** | `custom`, 8 |

Copy `assets/tree/` and `assets/willow/` from the oak/bin sample into
`harbor_town_1986/assets/`. `reconstructOrbitAsset` resolves
`../assets/${folder}` from `main.mjs`.

## Rules honoured

- **No trunk in the Sakae carriageway** `z ∈ [-6, 6]`.
- **No trunk inside shop footprints** (catalog `realWidth × realDepth`
  rotated by `yaw`; `extX = hx|cos| + hz|sin|`, `extZ = hx|sin| + hz|cos|`).
- **No trunk inside hill-house AABBs** (unique + four `wooden-hill-house`
  instances) or the stone stairs (`x −23.25…−16.75`, `z −24.5…−12.4`).
- **No willow on the seawall** (wall centre `z = 88.35`, cap north
  `z ≈ 87.38`). Willows sit on the dock apron, `z ∈ [80, 86]`.
- Route 16 oaks sit on the **west grass verge**, west of the N–S lanes
  `x −46.5…−36.5`, south of the Sakae T (`asphalt.maxZ = 12`).
- Truck lane `x ≈ 0` (harbor-gate → quay) and `SPAWN (−20, −26)` stay
  clear of trunks.

`GROUND` used: `park` (Suzume hill lawn — there is no separate hill
patch), `asphalt` + sidewalks (Sakae), `dock` + `water`, `route16Road` /
`route16Quay`. Hill houses and the park share the same AABB.

## Keep-outs (current `catalog.mjs`)

North-row shops, `z = −8.5`, `yaw = 0`:

| id | AABB x | AABB z |
|---|---|---|
| hardware-shop | −37.2 … −30.8 | −11.9 … −5.1 |
| tobacco-shop | −28.6 … −23.4 | −11.3 … −5.7 |
| soba-shop | −20.2 … −13.8 | −12.6 … −4.4 |
| greengrocer | −11.7 … −6.3 | −11.6 … −5.4 |
| pharmacy | −3.3 … 3.3 | −12.3 … −4.7 |
| you-arcade | 4.4 … 12.4 | −13.5 … −3.5 |
| cassette-shop | 14.7 … 20.9 | −10.9 … −6.1 |

South-row / alley (none of the trees sit here; listed so a later pass
does not): flower `x −13.3…−6.7, z 4.7…12.5`; barber `2.9…9.1 × 4.9…12.3`;
kissaten `11…17 × 5.4…11.8`; yokobori-bar `23.25…28.75 × 13.4…18.6`.

Hill houses (park is `−44…−12 × −48…−16`):

| pose | AABB x | AABB z |
|---|---|---|
| unique (−28, −34, 0.42) | −33.3 … −22.7 | −39.1 … −28.9 |
| instance (−38, −40, 0.2) | −42.8 … −33.2 | −44.5 … −35.5 |
| instance (−42, −30, 0.7) | −47.6 … −36.4 | −35.5 … −24.5 |
| instance (−38, −22, 0.35) | −43.2 … −32.8 | −27.0 … −17.0 |
| instance (−10.5, −30, −1.35) | −15.1 … −5.9 | −34.8 … −25.2 |

Warehouses stay north of the willow line (south eaves ≤ `z = 77.5` on
current 8.5 × 11 / 16 × 12 hulls). Quay waypoint `(0, 80)` / landmark
`quay (0, 82)` sit in the 12 m gap between willows at `x = ±6`. Seawall
landmark `(−38.5, 86.6)` is 6 m from the west willow.

Park is a 32 × 32 m lawn with those four houses plus the stair corridor,
so the 18 oaks are an 8 m grid with three nudges out of footprints
(`−35.2, −32`, `−16.5, −32`, `−15.4, −23.5`). Closest pairs are **8.0 m**
(grid neighbours). Route 16 beat is **9 m**. Willows **≥ 10.1 m**.

## Counts

| group | asset | n | unique | instances |
|---|---|---|---|---|
| Suzume park (`GROUND.park`) | `english-oak` | **18** | 1 | 17 |
| Route 16 west verge | `english-oak` | **6** | — | 6 |
| Amihama apron `z 80…86` | `weeping-willow` | **8** | 1 | 7 |
| **total** | | **32** | 2 | 30 |

Parent plants the unique oak and unique willow via `ORBIT_SUBJECTS`
(required — `main.mjs` only reconstructs ids in that array). **Do not**
also clone those two origins in `INSTANCES`.

## `ORBIT_SUBJECTS` (add)

```js
{
  id: "english-oak",
  folder: "tree",
  label: "English oak",
  kind: "custom",
  district: "suzume",
  x: -28,
  z: -24,
  yaw: 0.35,
  realHeight: 15,
  realWidth: 14,
  realDepth: 14,
},
{
  id: "weeping-willow",
  folder: "willow",
  label: "Weeping willow",
  kind: "custom",
  district: "amihama",
  x: -36,
  z: 81.2,
  yaw: 0.4,
  realHeight: 12,
  realWidth: 12,
  realDepth: 12,
},
```

`kind: "custom"` selects the 8-view catalog in `reconstructSubject`.
`realDepth` matches canopy so `footprintSeatY` samples the downhill
corners on Suzume-zaka.

## Ready to paste — `INSTANCES` (append)

```js
  // Suzume park oaks (17). Unique occupies (−28, −24).
  { asset: "english-oak", x: -44.0, z: -48.0, yaw: 0.15 },
  { asset: "english-oak", x: -36.0, z: -48.0, yaw: 1.10 },
  { asset: "english-oak", x: -28.0, z: -48.0, yaw: 2.40 },
  { asset: "english-oak", x: -20.0, z: -48.0, yaw: 3.70 },
  { asset: "english-oak", x: -12.0, z: -48.0, yaw: 5.20 },
  { asset: "english-oak", x: -44.0, z: -40.0, yaw: 0.85 },
  { asset: "english-oak", x: -28.0, z: -40.0, yaw: 1.95 },
  { asset: "english-oak", x: -20.0, z: -40.0, yaw: 4.10 },
  { asset: "english-oak", x: -12.0, z: -40.0, yaw: 5.85 },
  { asset: "english-oak", x: -35.2, z: -32.0, yaw: 0.40 },
  { asset: "english-oak", x: -16.5, z: -32.0, yaw: 2.85 },
  { asset: "english-oak", x: -44.0, z: -24.0, yaw: 1.55 },
  { asset: "english-oak", x: -15.4, z: -23.5, yaw: 3.20 },
  { asset: "english-oak", x: -44.0, z: -16.0, yaw: 4.60 },
  { asset: "english-oak", x: -36.0, z: -16.0, yaw: 0.70 },
  { asset: "english-oak", x: -28.0, z: -16.0, yaw: 2.15 },
  { asset: "english-oak", x: -12.0, z: -16.0, yaw: 5.05 },
  // Route 16 west verge (x ≈ −47.5, south of Sakae T, west of lanes).
  { asset: "english-oak", x: -47.5, z: 15.5, yaw: 0.22 },
  { asset: "english-oak", x: -47.5, z: 24.5, yaw: 1.40 },
  { asset: "english-oak", x: -47.5, z: 33.5, yaw: 2.75 },
  { asset: "english-oak", x: -47.5, z: 42.5, yaw: 3.90 },
  { asset: "english-oak", x: -47.5, z: 51.5, yaw: 5.10 },
  { asset: "english-oak", x: -47.5, z: 60.5, yaw: 6.05 },
  // Amihama willows, z 80–86, not on seawall. Unique occupies (−36, 81.2).
  { asset: "weeping-willow", x: -26.0, z: 84.8, yaw: 1.10 },
  { asset: "weeping-willow", x: -16.0, z: 82.0, yaw: 2.00 },
  { asset: "weeping-willow", x: -6.0, z: 85.4, yaw: 2.80 },
  { asset: "weeping-willow", x: 6.0, z: 81.0, yaw: 3.50 },
  { asset: "weeping-willow", x: 16.0, z: 84.2, yaw: 4.20 },
  { asset: "weeping-willow", x: 26.0, z: 82.6, yaw: 5.10 },
  { asset: "weeping-willow", x: 36.0, z: 85.6, yaw: 5.90 },
```

Full plant list in the same `{ asset, x, z, yaw }` shape (uniques marked).
Parent should **not** paste the two unique rows into `INSTANCES`.

```js
{ asset: "english-oak", x: -44.0, z: -48.0, yaw: 0.15 },
{ asset: "english-oak", x: -36.0, z: -48.0, yaw: 1.10 },
{ asset: "english-oak", x: -28.0, z: -48.0, yaw: 2.40 },
{ asset: "english-oak", x: -20.0, z: -48.0, yaw: 3.70 },
{ asset: "english-oak", x: -12.0, z: -48.0, yaw: 5.20 },
{ asset: "english-oak", x: -44.0, z: -40.0, yaw: 0.85 },
{ asset: "english-oak", x: -28.0, z: -40.0, yaw: 1.95 },
{ asset: "english-oak", x: -20.0, z: -40.0, yaw: 4.10 },
{ asset: "english-oak", x: -12.0, z: -40.0, yaw: 5.85 },
{ asset: "english-oak", x: -35.2, z: -32.0, yaw: 0.40 },
{ asset: "english-oak", x: -16.5, z: -32.0, yaw: 2.85 },
{ asset: "english-oak", x: -44.0, z: -24.0, yaw: 1.55 },
{ asset: "english-oak", x: -28.0, z: -24.0, yaw: 0.35 }, // unique ORBIT_SUBJECTS
{ asset: "english-oak", x: -15.4, z: -23.5, yaw: 3.20 },
{ asset: "english-oak", x: -44.0, z: -16.0, yaw: 4.60 },
{ asset: "english-oak", x: -36.0, z: -16.0, yaw: 0.70 },
{ asset: "english-oak", x: -28.0, z: -16.0, yaw: 2.15 },
{ asset: "english-oak", x: -12.0, z: -16.0, yaw: 5.05 },
{ asset: "english-oak", x: -47.5, z: 15.5, yaw: 0.22 },
{ asset: "english-oak", x: -47.5, z: 24.5, yaw: 1.40 },
{ asset: "english-oak", x: -47.5, z: 33.5, yaw: 2.75 },
{ asset: "english-oak", x: -47.5, z: 42.5, yaw: 3.90 },
{ asset: "english-oak", x: -47.5, z: 51.5, yaw: 5.10 },
{ asset: "english-oak", x: -47.5, z: 60.5, yaw: 6.05 },
{ asset: "weeping-willow", x: -36.0, z: 81.2, yaw: 0.40 }, // unique ORBIT_SUBJECTS
{ asset: "weeping-willow", x: -26.0, z: 84.8, yaw: 1.10 },
{ asset: "weeping-willow", x: -16.0, z: 82.0, yaw: 2.00 },
{ asset: "weeping-willow", x: -6.0, z: 85.4, yaw: 2.80 },
{ asset: "weeping-willow", x: 6.0, z: 81.0, yaw: 3.50 },
{ asset: "weeping-willow", x: 16.0, z: 84.2, yaw: 4.20 },
{ asset: "weeping-willow", x: 26.0, z: 82.6, yaw: 5.10 },
{ asset: "weeping-willow", x: 36.0, z: 85.6, yaw: 5.90 },
```

## Why these pads

Park south row at `z = −16` is 4 m north of sidewalkN (`minZ = −12`) and
≥ 3.4 m north of the nearest shop back (soba `z = −12.6`). Trunks are
outside every shop AABB; oak crowns will hang over the backyards, which
is the Suzume read from Sakae.

`(−28, −24)` is the open lawn between the hero house (south eaves
`z = −28.9`) and the stair west edge (`x = −23.25`), 8.2 m from `SPAWN`.
`(−16.5, −32)` and `(−15.4, −23.5)` are the east-path shoulder, west of
the instance house at `(−10.5, −30)`, east of the treads.

Route 16: agent 27 west verge is grass `x −48.0…−47.2` then W-beam at
`−47.2` then southbound lane at `−46.5`. Trunks at `x = −47.5` stay on
the grass. `z = 15.5` is 3.5 m south of `asphalt.maxZ = 12` and well
south of carriageway `z = 6`. Last oak `z = 60.5` is on `route16Quay`,
north of Warehouse 8 west (`z ≥ 66.5`), then the apron switches to
willows.

Willows skip `x = 0` (quay walk) and stop at `z ≤ 85.6` (1.8 m north of
the cap). Staggered `z` so the seawall shot is a grove, not a fence.
