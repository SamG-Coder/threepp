# 54 — Fill Yokobori alley

Wrote `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-yokobori.mjs` only.
Did **not** edit `catalog.mjs`, `main.mjs`, `scout.mjs`, or `map.mjs`.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south. Cheap untextured
`BoxGeometry` / `CylinderGeometry` + `MeshStandardMaterial`, same language as
skyline / gap-fill / roads. Named meshes, `castShadow` + `receiveShadow`, sit
on `groundHeight`.

---

## Why this pass

`yokobori-v5` (`go: yokobori`, camera `(20.2, 10.4)`, yaw `0.18`) looks south
down the mouth and reads an **empty plaza** toward the Amihama warehouses at
`z ≈ 70`. Galaxy sakaba is the only hull in `GROUND.alley` (`x 18…42`,
`z 10…28`). The east remainder and the south half of the slab are a lot, not a
横丁.

---

## Keep-out

Live bar: `yokobori-bar` `(26, 16)`, `yaw = −π/2`, `5.2 × 7.6 × 5.5`.
Front plane **`x = 23.25`**, façade **`z = 13.4 … 18.6`**, back **`x = 28.75`**.
Boxes keep ≥ 0.4 m air off that AABB.

Also clear:

| what | pose | rule |
|---|---|---|
| yokobori camera / mouth lane | `(20.2, 10.4)` looking +Z | no shop at `x = 20`, `z ≈ 16` (would swallow the eye) |
| walk slot | `x 19.2…22.5`, `z 10…19` | stay empty |
| vending inst | `(21.94, 18.6)` | north of west izakaya |
| pole inst | `(18.35, 11.4)` | mouth, untouched |
| live crates in `main.mjs` | `(20.0, 14.0)` nest | north of new mass |

Skip **`x = 26`** — that column is Galaxy.

---

## File

```
export function addYokoboriFill(scene, { THREE, groundHeight })
```

Same injection as `addRoads`. Group `yokobori-fill`. No `Math.random`. No
catalog ids. No `reconstructOrbitAsset`.

### 1. Five 2-storey izakaya / shop boxes (`z = 16…24`, `x = 20, 32, 38`)

Heights 5.4–7.6 m (in-band 5–8). Dark brown `0x4a3226`, dirty cream `0xc4b496`,
faded green `0x5c6e58`.

| name | x | z | w | d | h | colour | AABB (x, z) |
|---|---:|---:|---:|---:|---:|---|---|
| `yokobori-izakaya-west` | 20 | 21.85 | 4.4 | 5.0 | 6.6 | brown | 17.8…22.2, 19.35…24.35 |
| `yokobori-izakaya-mid` | 32 | 17.2 | 5.0 | 6.0 | 7.2 | cream | 29.5…34.5, 14.2…20.2 |
| `yokobori-shop-mid-south` | 32 | 23.1 | 4.8 | 4.8 | 5.4 | green | 29.6…34.4, 20.7…25.5 |
| `yokobori-shop-east` | 38 | 17.0 | 5.4 | 5.8 | 6.8 | green | 35.3…40.7, 14.1…19.9 |
| `yokobori-izakaya-east-south` | 38 | 23.0 | 5.0 | 5.0 | 7.6 | brown | 35.5…40.5, 20.5…25.5 |

`x = 20` is **south of Galaxy** (`z ≥ 19.35`) so the mouth still shows the
west front on the left. `x = 32 / 38` fill the empty east court; mid-east
south face peeks past Galaxy’s south gable (`z = 18.6`).

### 2. Dead-end at `z = 26…28`, gap at `x = 24`

| name | x | z | w | d | h | colour | AABB (x, z) |
|---|---:|---:|---:|---:|---:|---|---|
| `yokobori-deadend-west` | 20.15 | 27.05 | 4.7 | 2.1 | 6.2 | cream | 17.8…22.5, 26.0…28.1 |
| `yokobori-deadend-east` | 33.9 | 27.1 | 16.2 | 2.2 | 7.0 | brown | 25.8…42.0, 26.0…28.2 |

Gap **`x = 22.5…25.8`** (centre `≈ 24.15`) is the harbour passage. Closes the
warehouse look at `z ≈ 70`.

### 3. Crates + noren-like box + barrels

Noren: thin indigo box `1.72 × 1.38 × 0.05` on the west izakaya north door
(`yokobori-noren` at `(20.1, 19.28)`, centre y `≈ 2.12`).

Crates (`yokobori-crate`, `0.58 × 0.48 × 0.52`, wood `0x6b5344`) outside hulls:

| stack | x | z | n | against |
|---|---:|---:|---:|---|
| A | 19.55 | 19.08 | 2 | west izakaya north |
| B | 22.55 | 21.35 | 3 | west izakaya east |
| C | 29.12 | 19.85 | 3 | Galaxy south-east / mid-east west |
| D | 25.45 | 25.55 | 2 | dead-end gap east jamb |

Barrels (`yokobori-barrel`, r `0.29`, h `0.86`): `(18.62, 19.08)`,
`(22.52, 20.35)`, `(29.08, 19.22)`, `(25.48, 25.58)`.

### 4. One hanging signboard

`yokobori-signboard` — `1.18 × 0.58 × 0.08` enamel `0x7a3028` at
`(21.55, 19.22)`, centre y `≈ 3.22`, off the west izakaya NE corner. Faces
the mouth shot.

---

## Wire-up (later pass)

In `createStudio`, after roads / clutter:

```js
import { addYokoboriFill } from "./fill-yokobori.mjs";
// ...
addYokoboriFill(scene, { THREE, groundHeight });
```

Do not paste the boxes into `main.mjs`.

---

## Verify

Re-run scout:

```json
{"id":"t54","shots":[{"go":"yokobori","screenshot":"yokobori-v6"},{"go":"kissa","screenshot":"kissa-v6"},{"go":"records","screenshot":"records-v6"}]}
```

Pass: `yokobori-v6` shows 2-storey mass closing the south lot (west izakaya +
dead-end), Galaxy still on the left, no warehouse gables at `z ≈ 70` filling
the alley; noren + signboard readable on the closer box; crates/barrels on the
walls, lane open. Fail: still seeing the dock sheds through the slab, a box
clipping Galaxy / vending / the mouth camera, or a shop on `x = 26`.
