# 53 — Route 16 fill module

New file only: `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-route16.mjs`.

Do **not** edit `catalog.mjs`, `main.mjs`, `scout.mjs`, or `map.mjs` this pass.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south. `groundHeight` is
passed in (same as `roads.mjs`). `THREE` is the WebGPU three module.

Cheap untextured `BoxGeometry` / `CylinderGeometry` + `MeshStandardMaterial`.
Named meshes, cast/receive shadow, seat on `groundHeight`. No
`reconstructOrbitAsset`. No catalog rows. No `Math.random`.

---

## Why this pass

Route 16 is still a pair of asphalt patches plus the `city-bus` hull.
Agent 27 specified the shelter / stall paint / west verge; those boxes
never landed. `go: route16` (`−33, 11.8`, yaw `−0.38`) looks south-southwest
down an empty highway.

## Live ground (do not retouch)

| patch | AABB | y | colour |
|---|---|---:|---|
| `route16Road` | x **−46.5…−36.5**, z **10…52** | 0 | `0x3a3a3c` |
| `route16Walk` | x **−36.5…−34.5**, z **10…50** | 0.08 | `0xb7b1a4` |
| `route16Lot` | x **−34.5…−25.5**, z **20…34** | 0.02 | `0x4c4a46` |
| `route16Quay` | x **−47…−40.2**, z **50…84** | 0 | `0x3a3a3c` |

`city-bus` unique: **(−40, 22)**, yaw `π/2`, `2.5 × 10.4 × 3.05` m, along
the N–S road. Keep-out used here:

```
x −42.0 … −37.6
z  16.6 …  27.4
```

Treat the across-road reading (depth on X) as a second keep-out at
`x −45.2…−34.8`, `z 20.75…23.25`. Nothing in this module sits in either box.
The road itself is empty of fill.

Nearby catalog that stays put: vending `(−31, 6)`, zelkova `(−30, 10.4)`,
WH8-W instance `(−32, 72)`.

---

## Export

```js
export function addRoute16Fill(scene, { THREE, groundHeight })
```

Same signature as `addRoads`. Returns a group named `route16-fill`.

## 1. Bus-stop shelter — sidewalk at (−35.5, 16)

Open side faces the road (−X). Fits inside `route16Walk`.

| piece | geo (x, y, z) | world | material |
|---|---|---|---|
| Post ×2 | 0.09 × 2.18 × 0.09 | (−34.88, 14.82) / (−34.88, 17.18) | steel `0x6a6e68` |
| Roof | 1.55 × 0.07 × 3.05 | (−35.5, 2.24, 16), `rotation.z = 0.07` | faded green `0x3d5a44` |
| Bench seat | 0.36 × 0.07 × 2.15 | (−35.12, 0.46, 16) | timber `0x6b5340` |
| Bench legs ×2 | 0.06 × 0.42 × 0.30 | z = 15.12 / 16.88 | steel |

Roof tilt dumps rain toward the kerb. Names: `route16-shelter-roof`,
`route16-shelter-post-*`, `route16-shelter-bench`, `route16-shelter-bench-leg-*`.

## 2. Parking-lot paint — inside `route16Lot`

Five perpendicular bays, nose-in west (highway). Aisle on the east.

| | |
|---|---|
| Stall west / east | **−33.55** / **−29.05** (depth 4.5 m) |
| First divider z | **21.4** |
| Pitch | **2.42 m** → dividers 21.4 … 33.5 |
| Dash | `BoxGeometry(0.72, 0.035, 0.08)`, step 1.0 m, colour `0xd0ccc4` |
| West tick | `0.08 × 0.035 × 2.18` at each bay centre |

Paint `y = groundHeight + 0.04`, `castShadow = false`. Stalls stay east of
the bus east-face even if the hull is read across the road. Bays do not
cover the east 3.5 m aisle.

## 3. West-edge massing — out of the road

Anonymous 2-storey concrete, east face ≤ **−46.7** (road `minX = −46.5`).
Centres sit west of −48 so a 4 m plan still clears the carriageway.

| # | x | z | w | d | h | east face | colour |
|---|---:|---:|---:|---:|---:|---:|---|
| 0 | −48.90 | 28.0 | 4.4 | 9.0 | 8.4 | −46.70 | `0x6a6560` |
| 1 | −48.85 | 40.0 | 4.2 | 8.2 | 7.6 | −46.75 | `0x5c5852` |
| 2 | −49.15 | 49.4 | 4.2 | 7.0 | 8.8 | −47.05 | `0x68625c` |

#2 stays west of `route16Quay.minX = −47`. Each block has a 0.22 m darker
cap (`0x4e4a46`). Names: `route16-massing-*`, `route16-massing-cap-*`.

## 4. Drums + chain-link around the lot

Oil-drum stand-ins (`CylinderGeometry` r **0.29**, h **0.88**, 8 segments).
Perimeter only — not in a stall, not in the bus box.

| i | x | z | colour |
|---|---:|---:|---|
| 0 | −33.55 | 20.42 | `0x7a3a2c` |
| 1 | −32.78 | 20.78 | `0x3d2a22` |
| 2 | −33.32 | 33.42 | rust |
| 3 | −32.55 | 33.12 | rust dark |
| 4 | −26.12 | 33.38 | rust |
| 5 | −25.82 | 26.85 | rust dark |

Fence is posts + three rails (no chain mesh). Galvanised `0x8a9088`.

| run | line | posts |
|---|---|---|
| East | x = **−25.42**, z 20.35 → 33.67, step 2.22 | 7 |
| South | z = **33.88**, x −34.15 → −25.55, step 2.15 | 5 |
| North-east | z = **20.18**, x −28.35 → −25.55, step 1.4 | 3 |

North-west of the lot is open (car mouth from the walk). Rails at
y = 0.42 / 1.12 / 1.72. Names: `route16-fence-post-{e,s,n}-*`,
`route16-fence-rail-{e,s,n}-*-*`.

---

## Wire-up (later pass)

In `createStudio`, after roads (fill sits on lot / walk patches):

```js
  addRoads(scene, { THREE, groundHeight });
  addRoute16Fill(scene, { THREE, groundHeight });
```

```js
import { addRoute16Fill } from "./fill-route16.mjs";
```

Do not add catalog ids. Do not move the bus.

## What should read

| go | expect |
|---|---|
| `route16` | shelter on the right walk, stall dashes in the lot, two-storey verge wall on the far (west) side of the bus |
| `bus` | roof + bench at arm’s length, bus hull still the hero in the lane, no fill intersecting it |

Pass: named meshes with shadows; road and bus AABB empty of fill; buildings
west of x = −46.5. Fail: shelter on the asphalt, a cube in the bus box, or
massing overlapping `route16Road`.
