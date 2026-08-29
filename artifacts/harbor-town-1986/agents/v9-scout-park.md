# v9 scout — `park`

Read-only. Do **not** edit `scout.mjs`, `main.mjs`, `catalog.mjs`, `map.mjs`, `fill-park.mjs`, or `fill-world.mjs` from this note. Parent applies camera / mesh if it agrees.

Still: `C:\ThreeBrowser\artifacts\harbor-town-1986\park-v9.png` (`go: "park"`). Cross-check: `hill-v9.png` (same 坂, east of this lens), `park-v8.png` (previous park pose, oak interior), `park-v7.png` (house-in-clip). House still: `assets/wooden-hill-house/yaw-000.png`.

Time lock: Saturday 29 November 1986, 15:20, overcast. Feel: Shenmue Ch.1 **Sakuragaoka** — stone stairs as a ribbon, one park court, timber houses. Convention: `+X` east, `+Z` south, yaw `0` faces `+Z`. `EYE = 1.62`. `PerspectiveCamera(55, …)`. Look ray `(sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))`.

---

## Landmark as shot

```35:35:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\scout.mjs
  park: { x: -24, z: -20, yaw: 3.05, pitch: -0.1 },
```

| | value |
|---|---|
| plan | **west stair lip**, mid-flight in Z |
| yaw 3.05 | π − 0.09 → **5.2° east of due north** (−Z) |
| pitch −0.1 | looks **down** (~5.7°) at tread sides + lawn |
| `groundHeight(−24, −20)` | t = 8/34, y = 8t, then path cut `x ≥ −24` → **1.79 m** |
| eye Y | **3.41 m** |

Stair AABB (`addStreetFurniture`): 12 × `BoxGeometry(6.5, 0.24, 1.12)`, x **−23.25 … −16.75**, z **−12.4 … −23.95**. Camera z = −20 is **step i ≈ 7**. Camera x = −24 is **0.75 m west of the west nosing**.

Agent 57 authored `{ x: -24, z: -22, yaw: -2.35, pitch: -0.1 }` (look NW at houses) — that is `park-v8`, an oak-trunk interior. Agent 51 expected `{ x: -28, z: -20, yaw: -0.8 }` (sandbox + west hedge). Live yaw 3.05 is the **hill** look: up the 坂, 4 m west of `LANDMARKS.hill`. `park-v9` is therefore a **side-on stair product shot**, not a park court.

---

## Verdicts (the five questions)

### 1. Crude stairs? **Yes — they own the frame.**

Lower-right ~40 % of `park-v9` is three receding `0x8a8680` boxes. Same flight as `hill-v9`, seen from the west cheek instead of the centreline.

- **Untilted slabs on a 13.5° slope** (`atan(8/34)`). Each box seats `groundHeight(−20, z + 0.56) + 0.12` (downhill lip). Top face is world-horizontal. Downhill south faces hang **~0.24 m** over lawn; uphill lips bury ~2 cm. Result: **grass triangles between treads** and the thin floating cards mid-flight.
- Tread depth **1.12 m** vs run **1.05 m** = 7 cm nosing overlap at **different Y** → the diamond wedges (hill scout §1; visible here as disconnected grey cards stepping up the right).
- Width **6.5 m** at **0.75 m** from the eye: the nearest tread is a grey floor, not a 坂. Sakuragaoka-scale is ~3.2–4.0 m plus 石垣 cheeks. There are **no cheeks, no riser mesh, no granite grain, no grout**. Overcast hemi 1.42 + sun 0.34 → dead mid-grey, same as `hill-v9`.
- Path cut `if (x ∈ [−24, −16]) y −= 0.4 t` at this camera is **9 cm** at t = 0.235. The lens stands **on the cut**. Lawn left of x = −24 vs trough under the boxes = a longitudinal crease down the look.

This is a mesh problem **and** a camera problem. `go('park')` must not stand inside the stair keep-out in Z.

### 2. Discontinuous grass? **Yes — two slopes, two colours, holes.**

Not a single draped terrace.

| layer | what | why it seams |
|---|---|---|
| Height field | `PlaneGeometry(120, 200, 60, 80)` displaced, vertex grass `(0.32, 0.38, 0.22)` | ~2.0 × 2.5 m quads; path cut is a C0 crease; `polygonOffset` 1/1 |
| `GROUND.park` | flat `addGroundPatch` at **y = 0.02**, `0x4a5c3a`, AABB x −44…−12, z −48…−16 | different hue (`#4a5c3a` vs `#516338`); **never follows the hill**. Buried on the slope, but the south lip / coarse quads still flash a second plane |
| Stair boxes | 12 horizontal stones | punch **islands of olive** between treads; the 坂 is not cut into the field |
| `fill-world` hedges | `0x3a4a32`, 0.7 m, one 28 × 0.5 m bar at `(−28, −48)` plus N–S bars | dark stripe that ignores the slope |
| `fill-park` hedges | `0x1a3520`, 0.6 m, 9 strips | darker still; south strips are **behind** this camera |

What the PNG shows: a big sage floor (height field), then a **darker olive band** at the house/tree line (hedge + canopy shadow + lighting, not turf grain), then grey cards with lawn in the gaps. Agent 12 already asked for `addDrapedPatch` on `park` and to kill the y = 0.02 card. Not done.

### 3. Canopy filling the frame? **Yes.**

`english-oak` is still catalog **15 × 14 × 14 m** (agent 42 asked 11 × 9). Canopy radius **7 m**. Pitch **−0.1** aims at the **underside** of those crowns.

From `(−24, −20)` looking yaw 3.05:

| oak | xz from camera | in `park-v9` |
|---|---|---|
| `(−16, −28)` yaw 0.1 | **11.3 m**, 8 m east 8 m north | **near-right bole + crown**. Clearance to canopy ≈ **4.3 m**. Fills the right third and the top-right clip |
| `(−20, −36)` yaw 0.35 | **16.5 m**, 4 m east, **near axis** | centre melted trunk wall |
| `(−22, −40)` yaw 2.1 | 20.1 m | next bole through the centre crown |
| `(−20, −46)` | 26.3 m, on axis | far centre |
| `(−40, −26)` | 17.1 m west | left canopy clip (with unique-house eaves) |
| unique `(−42, −44)` | off-left | not the hero here |

Custom-8 hull: no bark cylinder, hollow / ice-cream melt, dark interiors (DoubleSide + over-carve). Same porcelain trunks as `hill-v9` / `park-v8`. Four 14 m summer crowns on a 32 × 32 m lawn, on the optical axis, with the camera looking **down**, is why the upper half is canopy and sky is crumbs.

`(−16, −28)` is also over the east treads (canopy reaches x ≈ −23). Stair keep-out never included z < −24, so the path continuation is a tree alley.

### 4. House hull quality? **Massing PASS, this frustum FAIL.**

Unique `wooden-hill-house` `(−28, −34)` yaw 0.42, **7.4 × 8.2 × 7.6 m**. XZ from this camera: **4 m west, 14 m north** (dist **14.6 m**). Agent 59 scored the asset **PASS** (stacked kirizuma, 090 warehouse still gone). `yaw-000.png` is a closed 2F 玄関: noren, balcony laundry, CMU planter, slippers, two 瓦 roofs.

In `park-v9` the unique is the **left-mid cream wall**:

- 2F sash grid and dark genkan wood **are** the still, melted at 48³.
- **No** 玄関 noren, slippers, planter, or stacked-roof silhouette. Pitch −0.1 + oaks `(−20, −36)` / `(−40, −26)` eat the kirizuma. We see a ¾ SE eave, not the south elevation.
- Roof tiles smear into canopy. Mid-eave is a brown smear.

Other hulls in this look:

| pose | dist | read |
|---|---|---|
| instance `(−38, −22)` yaw 0.35 | 14.1 m west, 2 m north | **~82° off axis** — left clip / out. Not the left house |
| instance `(−10.5, −30)` yaw −1.35 | 16.8 m, 53° east | right-clip gable fragments, fused with `(−16, −28)` |
| instance `(−38, −40)` | 24.4 m | far left, through canopy |
| extra instances `(−12, −46)`, `(−44, −36)` | far | not readable |

Do **not** rebuild the house from this still. The unique hull is good enough once the camera sees `yaw-000` (south face) at 15–20 m with pitch **up**. This shot is an occlusion / pose miss.

### 5. Benches? **Two kits, one on the stairs, none reading as a park.**

Live furniture in this frustum:

| id | x, z | yaw | dist | kit |
|---|---|---|---|---|
| `park-bench-10` | −26.10, −24.95 | 2.034 | **5.4 m** WNW | `fill-park` wood 1.52 × 0.40, wood legs `0x2a1c12` |
| `park-lantern-1` | −26.16, −26.42 | — | 6.8 m | stone T-post ~1.34 m — the grey “table” left of centre |
| `park-bench-11` | −24.86, −29.07 | −1.107 | 9.1 m | fill-park, further on the path |
| `fill-world` bench | **−18, −24** | 1.2 | 7.2 m ENE | **on the stair AABB** (keep-out x −23.4…−16.6, z −24…−12). Dark block among treads |
| `fill-world` bench | −26, −32 | −0.3 | 12.2 m | concrete legs `0x9a958c` |
| `fill-world` bench | −30, −20 | 0.4 | 6.0 m due west | same Z as camera — left FOV clip |

`addParkBenches` in `fill-world.mjs` plants **8** benches + **3** untapered hedges. `addParkFill` plants **12** more. **20 seats on a 32 × 32 m lawn**, two recipes (wood legs vs grey concrete 0.12 × 0.38), no shared facing. Catalog `park-bench/` orbit still is unused.

South-edge fill-park benches `#0/#1/#2` at z = −17.15 sit **behind** this north-looking camera. The postcard benches are the path pair plus an **illegal stair bench**. Scale of the 1.52 m seat is fine; placement is not. Lantern vs bench height reads OK (~1.3 m vs 0.47 m seat).

---

## What the still actually shows (top → bottom)

- Melted oak undersides; `0x8894a0` sky crumbs; no trunk colonnade.
- Unique house ¾ on the left (windows + dark genkan), instance C fragments on the right — not a court.
- Dark wood bench + lantern + second bench, left-centre, ~5–9 m.
- Olive height-field lawn, darker band at the tree line.
- Three huge grey treads, lower right, with grass in the gaps; fill-world bench sitting in the flight.

This is **the west cheek of `hill-v9`**, not Suzume park.

---

## Proposed camera (`LANDMARKS.park` only)

Goal: **west lawn as a court** — sandbox + lantern 2 + unique 玄関 + stairs as a far-right ribbon. Stay out of the stair AABB. Stay ≥ **14 m** from oak trunks (7 m crown + 7 m air). Pitch **up** so 7.4 m kirizuma roofs land in the 55° vFOV. Do not reuse yaw −0.8 (looks SSW, *away* from the park) or yaw −2.35 (`park-v8` oak interior). Do not duplicate `hill` (centreline, look up the 坂).

**Primary** (replace current):

```js
park: { x: -28.5, z: -16.6, yaw: 3.35, pitch: 0.08 },
```

| | |
|---|---|
| plan | 5.25 m **west** of stair west nosing, z just south of south-edge benches, **not** on treads (x + 20 = 8.5 > 3.5) |
| `groundHeight` | t = 4.6/34, y ≈ **1.08 m** (west of the path cut) → eye **2.70 m** |
| yaw 3.35 | π + 0.21 → **12° west of north**. Unique `(−28, −34)` is 17.4 m almost due north (slightly camera-right). House `(−38, −22)` left. Stairs recede far right |
| pitch +0.08 | unique ridge ~12.6 m Y, ΔY ~9.9 m at 17.4 m → ~30° above eye; ridge stays in frame |
| sandbox `(−32.55, −20.4)` | **5.6 m** WNW — playground in the left foreground, not a floor |
| lantern 2 `(−31.45, −20.85)` | 5.2 m |
| oak `(−16, −28)` | 16.9 m, ~44° east — right **flank**, not the vanishing point |
| oak `(−20, −36)` | 21.2 m, ~26° east — mid-right bole |
| oak `(−40, −26)` | 14.9 m west — left canopy, clearance ~8 m |
| house `(−38, −22)` | 10.9 m — left-mid, outside 5.59 m circumradius |

**Alternate** if primary still clips house `(−38, −22)` or sandbox (stand further south, still west of stairs):

```js
park: { x: -30.8, z: -14.8, yaw: 2.95, pitch: 0.10 },
```

South of `GROUND.park` maxZ = −16 by 1.2 m, 7.6 m west of stair west edge. Look ~10° east of north: unique house centre, stairs a distant right band, sandbox left, house `(−38, −22)` less dominant (dist ~12.8 m). Keep `|x + 20| > 3.5` and `z > −12.3` **or** `x < −23.5` so this is never a second `hill`.

Leave `stairs` `{ x: -18, z: -14, yaw: 0.12, pitch: -0.16 }` as the downhill / Sakae shot. Leave `hill` to the hill scout (toe of the 坂). `house` `{ x: -24, z: -26 }` is the genkan close-up — do not steal it.

---

## Proposed mesh / plant (parent, not this file)

Cheap first. Aligns with `v9-scout-hill.md` where the 坂 is shared.

1. **Move `LANDMARKS.park` off the west nosing** (primary above). Pitch must be **≥ 0**.
2. **Delete `fill-world` `addParkBenches` (8 + 3 hedges).** They duplicate `fill-park`, mix grey-concrete legs with wood, and plant `(−18, −24)` **on the treads**. Keep the 12 `fill-park` benches. Path #10 / #11 can stay; they are legal vs house pads.
3. **Stair / grass seam** (same as hill): drape `GROUND.park` (`addDrapedPatch`, lift 0.05, segsZ ≥ 24); stop the y = 0.02 card. Drop the `0.4 t` path cut **or** paint it on the draped verts. Tread depth **1.05–1.06 m** (kill the 7 cm diamond). Optional 0.35 m stone cheeks at x = ±3.25 from centreline so the flight is **cut into** the slope. Per-step albedo jitter (`0x8a8680` ± 8).
4. **Nudge oaks off this postcard axis** (keep trunks ≥ 8 m, crowns off treads):
   - `(−16, −28)` → **`(−13.8, −22.5)`** (east lawn, south of house C keep-out) **or** `(−12.5, −32)` if that keep-out wins.
   - `(−20, −36)` → **`(−32, −38)`** (not on unique house `(−28, −34)`).
   - `(−22, −40)` → **`(−26, −42)`** or leave.
5. **Scale oaks** to agent 42: `realHeight 11`, `realWidth/Depth 9`. 14 m crowns are why the upper half is foliage.
6. **Do not retouch `wooden-hill-house` stills for this camera.** Unique is PASS. After the camera move, the south face at ~17 m should show 玄関 / mid-eave. If `park-v10` still hides the planter, the fault is remaining oaks, not 48³.
7. Optional later: plant catalog `park-bench` instead of box kits. Not needed for v10 if the eight fill-world seats are gone.

Do not move skyline boxes for this still — they are not the grey (the stairs are).

---

## Pass bar for `park-v10`

- Camera **outside** stair keep-out: not (`x ∈ [−23.4, −16.6]` **and** `z ∈ [−24, −12]`). `|x + 20| > 3.5` preferred.
- Stairs are a **side ribbon in lawn**, both flanks of turf visible, no floating grey cards, no triangle overlays. Stair angular width ≲ 20° of HFOV.
- One continuous olive terrace (draped park = height field). No y = 0.02 card flash, no two-tone hedge bar as the horizon.
- Oak trunks as **flanks**, not a ceiling. No trunk < 14 m on the look ray. Sky visible above unique-house ridge.
- Unique house: stacked kirizuma **or** 玄関 readable, not only sash through canopy holes. Dist 12–20 m. No house circumradius (5.59 m) intersection with the eye.
- Benches: **one kit**. Zero seats on treads. South-edge or path benches readable as furniture, not near-clip L-blocks.
- Sandbox + lantern 2 may appear in the left third; they must not be a floor under the nose.

**Fail** if `park-v10` is still the west cheek of the stair product shot, or another `park-v8` oak interior.
