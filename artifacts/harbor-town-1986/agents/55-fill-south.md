# 55 — South fill (anonymous town massing)

New module only: `ThreeBrowserRuntime/samples/harbor_town_1986/src/fill-south.mjs`.

Do **not** edit `catalog.mjs`, `main.mjs`, `scout.mjs`, or `map.mjs` from this note.
Wire `addSouthFill` in a later pass.

Cheap untextured `MeshStandardMaterial` `BoxGeometry` — not `ORBIT_SUBJECTS`,
not `reconstructOrbitAsset`, no dummy shop signs. Same language as agent 24
skyline and agent 46 gap fill: roughness **0.95**, metalness **0**, muted
concrete palette. Every mesh (and the group) is named **`south fill`**.

```js
export function addSouthFill(scene, { THREE, groundHeight })
```

Same call shape as `addRoads`. Sit on `groundHeight(x, z) + h * 0.5`. Axis-aligned.

---

## Why this pass

South sidewalk shops (yaw `π`, face north) sit at **`z = 8.6`**:

| shop | x | realWidth | span |
|---|---:|---:|---|
| Midori florist | −10 | 6.6 | −13.3 … −6.7 |
| Haru barber | 6 | 6.2 | 2.9 … 9.1 |
| Kissa Miharu | 14 | 6.0 | 11.0 … 17.0 |

Hardware / tobacco / soba / yaoya / pharmacy / arcade / cassette are the
**north** row at `z = −8.5`. Behind the south three is empty height-field.
East of cassette `(17.8, −8.5)` and west of hardware `(−34, −8.5)` the
street line also dies.

Yokobori starts at **`x = 18`**. Harbor-gate waypoint is **`(0, 48)`**.
Walk pad / keep-out: **`x = −8…8`, `z = 10…52`**.

---

## Four bands

### 1. South backing row — `z = 18…22`

Fill the block **behind** the south shops. `x` from **−36 to 16**, ~8 m lots,
heights **7–10 m**. Stop before yokobori (`x ≥ 18`). Skip the harbor corridor
so a walk from Sakae (`z ≈ 11`) to `harbor-gate` is not a wall.

West of the corridor (`−36 … −8` = 28 m) → three 8 m bays, leftover 3.4 m
as an alley into the pad (behind Midori at `x = −10`). East of the corridor
(`8 … 16`) → one bay, 0.2 m air off `x = 8` and 2.2 m air off `x = 18`.

Depth **3.8–4.2 m** so the boxes occupy `z ≈ 18…22`, not the south shop
backs (`z ≈ 12`) and not Galaxy (`26, 16`).

### 2. West cap — west of hardware

One 2-storey shop-like box at **`x = −44`, `z = −8.5`**. Depth 7 m (same
street-line as the north row). Hardware left edge `−34 − 3.2 = −37.2`;
cap right `−44 + 3.4 = −40.6` → 3.4 m slit. Off `sidewalkN.minX = −40`
onto the Route 16 verge — that is the T-junction end cap.

### 3. East caps — east of cassette

Two anonymous boxes at **`x = 28`** and **`x = 36`**, `z = −8.5`. Cassette
right `17.8 + 3.1 = 20.9`; first cap left `24.6` → 3.7 m. 1.0 m joint
between the two; second cap right `39.6` vs sidewalk `40`. No lettering.

### 4. Second south row — `z = 28`

Lower-priority depth toward Amihama. Centres **`x = −30, −18, −6, 6`**,
heights **8–12 m**. Corridor-adjacent lots (`±6`) are narrower (5.6 m)
so inner faces sit at **`x = ±3.2`**. Open spine **`x = −3.2…3.2`** on
the walk to `(0, 48)`. Do not slab `x = −8…8`.

---

## Keep-out

| what | AABB / pose | fill rule |
|---|---|---|
| Harbor approach | `x −8…8`, `z 10…52` | row 1 skipped; row 2 flanks, gap at `x ≈ 0` |
| Yokobori | `x ≥ 18`, `z 12…28` | no box with right edge ≥ 18 |
| Galaxy sakaba | `(26, 16)` ≈ `x 23.3…28.8`, `z 13.4…18.6` | east backing ends `x = 15.8` |
| South shop backs | flower / barber / kissa `z ≈ 12` | backing starts `z ≥ 17.4` |
| Hardware | `x −37.2…−30.8`, `z −8.5` | west cap right `−40.6` |
| Cassette | `x 14.7…20.9`, `z −8.5` | east cap left `24.6` |
| City bus | `(−40, 22)`, yaw `π/2` | backing starts `x = −36` |
| `harbor-gate` | `(0, 48)` | no mass on the spine |

Route 16 lot (`x −34.5…−25.5`, `z 20…34`) is nicked by backing #1
(north lip) and holds second-row `x = −30`. Accepted — those x/z were
the brief.

---

## Boxes

| # | x | z | w | d | h | colour | band |
|---|---:|---:|---:|---:|---:|---|---|
| 1 | −32.0 | 19.6 | 8.0 | 4.0 | 7.6 | `0x6a6560` | backing west |
| 2 | −23.7 | 20.4 | 8.0 | 3.8 | 9.2 | `0x736e68` | backing west |
| 3 | −15.4 | 19.8 | 8.0 | 4.2 | 8.4 | `0x5e5a54` | backing west |
| 4 | 12.0 | 20.2 | 7.6 | 4.0 | 9.8 | `0x68625c` | backing east of corridor |
| 5 | −44.0 | −8.5 | 6.8 | 7.0 | 8.2 | `0x6a6560` | west cap |
| 6 | 28.0 | −8.5 | 6.8 | 7.0 | 8.6 | `0x736e68` | east cap A |
| 7 | 36.0 | −8.5 | 7.2 | 7.0 | 7.6 | `0x5e5a54` | east cap B |
| 8 | −30.0 | 28.0 | 8.2 | 6.4 | 10.4 | `0x625e58` | second rank |
| 9 | −18.0 | 28.0 | 7.8 | 6.0 | 8.6 | `0x6c6862` | second rank |
| 10 | −6.0 | 28.0 | 5.6 | 6.2 | 11.2 | `0x5a5854` | second, west flank |
| 11 | 6.0 | 28.0 | 5.6 | 6.0 | 9.4 | `0x64605c` | second, east flank |

Envelope checks:

- #1 `−36.0…−28.0` — west bound of the brief
- #3 `−19.4…−11.4` — 3.4 m alley to corridor `x = −8`
- #4 `8.2…15.8` — not in `x = −8…8`, not in yokobori
- #5 `−47.4…−40.6` vs hardware `−37.2`
- #6 `24.6…31.4` vs cassette `20.9`; #7 `32.4…39.6` vs sidewalk `40`
- #10 `−8.8…−3.2`; #11 `3.2…8.8`; open `−3.2…3.2` at `z = 28`

When a unique shop is later planted into a cap or backing slot, drop that
row from `BLOCKS`. Do not add catalog ids for these.

---

## Wire-up (later pass)

In `createStudio`, after gap fill:

```js
import { addSouthFill } from "./fill-south.mjs";
// ...
addGapFill(scene);
addSouthFill(scene, { THREE, groundHeight });
```

`groundHeight` is already imported from `./map.mjs`. `THREE` is
`import * as THREE from "three/webgpu"`. No catalog entries.

---

## Verify

Re-run scout after the later wire-up:

```json
{"id":"t55","shots":[
  {"go":"sakae","screenshot":"sakae-south-fill"},
  {"go":"street-east","screenshot":"street-east-caps"},
  {"go":"harbor-gate","screenshot":"harbor-gate-corridor"}
]}
```

Pass: looking **south** from Sakae, 2-storey mass behind the florist / barber /
kissa, not olive field then sky; looking **north** at the east and west ends,
street-line boxes instead of a dead sidewalk; yokobori mouth (`x ≥ 18`) still
an alley; walk `x ≈ 0`, `z = 10…52` still open to the quay. Fail: a slab across
the harbor gate, a box in Galaxy’s lane, a painted fake sign, or a box through
a reconstructed façade.

---

## Do not

- Edit `catalog.mjs` / `main.mjs` / `scout.mjs` / `map.mjs` from this note
- Instance unique shop facades as the fill
- Put mass in `x = −8…8`, `z = 10…52` except the `±6` flanks at `z = 28`
- Extend backing to `x ≥ 18` (Yokobori)
- Add dummy noren / enamel on the boxes
