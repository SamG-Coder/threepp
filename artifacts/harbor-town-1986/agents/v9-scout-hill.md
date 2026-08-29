# v9 scout — `hill`

Read-only. Do **not** edit `scout.mjs`, `main.mjs`, `catalog.mjs`, `map.mjs`, or fill modules from this note. Parent applies camera / mesh if it agrees.

Still: `C:\ThreeBrowser\artifacts\harbor-town-1986\hill-v9.png` (`command.json` t17, `go: "hill"`). Cross-check: `park-v9.png`, `hill-v8.png`.

Time lock: Saturday 29 November 1986, 15:20, overcast. Feel: Shenmue Ch.1 **Sakuragaoka** — one stone 坂, timber houses, a park you turn in. Convention: `+X` east, `+Z` south, yaw `0` faces `+Z`. `EYE = 1.62`. `PerspectiveCamera(55, …)`. Look ray `(sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))`.

---

## Landmark as shot

```9:9:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\scout.mjs
  hill: { x: -20, z: -15.2, yaw: 3.2, pitch: -0.08 },
```

| | value |
|---|---|
| plan | stair **centreline**, mid-flight |
| yaw 3.2 | π + 0.058 → **3.3° west of due north** (−Z) |
| pitch −0.08 | looks **down** at tread tops |
| `groundHeight(−20, −15.2)` | t = 3.2/34, y = 8t − 0.4t = **0.715** (path cut) |
| eye Y | **2.34 m** |

Stair boxes (`addStreetFurniture`): 12 × `BoxGeometry(6.5, 0.24, 1.12)`, colour `0x8a8680`, z = `−12.4 − i·1.05` → **z −12.4 … −23.95**, x **−23.25 … −16.75**. Camera z = −15.2 sits **on step i ≈ 2–3**.

Agent 57 authored `{ x: -20, z: -14.8, yaw: -0.75, pitch: -0.12 }` (look SW at park/houses). Current yaw 3.2 is the opposite hemisphere: look **up the flight**. That dodge killed the v6 shop-back / v8 grey near-clip wall and replaced them with a tread close-up.

---

## Verdicts (the four questions)

### 1. Do stairs and park read as one terrain? **No.**

`hill-v9` is two materials butted, not a carved hillside.

- Lower ~55–60 % of the frame is **untextured grey box tops**. Olive grass is two side triangles. There is no 石垣 cheek, no soil cut, no gravel shoulder reading as the same surface.
- `GROUND.park` is still `addGroundPatch`: a **flat** `PlaneGeometry` at **y = 0.02** (`x −44…−12`, `z −48…−16`). The walkable slope is the later height-field (`PlaneGeometry(120, 200)` displaced by `groundHeight`, vertex colour grass `0.32, 0.38, 0.22`). Park card is buried except at the south lip. Stairs never cut that field; they **sit on it**.
- Path cut `if (x ∈ [−24, −16]) y −= 0.4 t` drops the stair corridor ~4–14 cm vs flanking lawn. Boxes sample `groundHeight(−20, z + 0.56)` (downhill lip, agent 12). Flanking grass does not get that cut the same way in screen space → **trough**.
- Tread **1.12 m** vs run **1.05 m** = 7 cm nosing overlap on **untilted** boxes. Different Y per step → the diamond / **triangle grey wedges** on the left of the flight (also the floating thin slabs in `park-v9.png`).

`park-v9` (`LANDMARKS.park` `{ x: -24, z: -20, yaw: 3.05, pitch: -0.1 }`) is the same seam from the west: a thick grey volume on the right, then disconnected grey cards hovering on olive. Not one 坂.

### 2. Melted Hiro back? **Yes.**

Instance `{ asset: "civilian-hiro", x: -22, z: -18, yaw: 0.5 }` (`catalog.mjs` INSTANCES).

- On the **stair keep-out** (x −23.5…−16.5, z −24…−12). 2 m west of camera, 2.8 m north. XZ distance **3.44 m**.
- Yaw 0.5 faces SSE; camera looks north → **back**.
- Hull: dark blazer potato, white shirt smear, **no collar / nape**, head a flesh cone, legs fused to a wishbone, no shoes. Agent 59 already **FAIL** (`res` 32 when `realHeight < 2.2`, cyclorama under shoes). Agent 06: 9528 tris is fine; floor/chroma/pose are not.
- At 3.4 m, 1.72 m height subtends ~28° of the 55° vFOV — left third of the still is the defect.

Unique Hiro `(−9.2, −7.3)` is behind the camera, not in this frustum.

### 3. Oaks blocking? **Yes.**

`english-oak` catalog is still **15 × 14 × 14 m** (agent 42 asked 11 × 9; not applied). Canopy radius **7 m**.

On the look ray from `(−20, −15.2)` north:

| pose | xz from camera | role in `hill-v9` |
|---|---|---|
| `(−16, −28)` yaw 0.1 | 13.4 m, 4 m east | **near-right trunk** — largest melted bole |
| `(−20, −36)` yaw 0.35 | 20.8 m, **on axis** | centre trunk wall |
| `(−22, −40)` yaw 2.1 | 24.9 m | next bole left of centre |
| `(−20, −46)` | 30.8 m, on axis | far centre |
| unique `(−42, −44)` + west grid | left | left canopy clip |

Four fused porcelain trunks + summer canopy fill the **upper third**. Timber houses (unique `(−28, −34)` and instance `(−10.5, −30)`) are only gable fragments in the gaps. `(−16, −28)` canopy (r = 7 m) reaches **x ≈ −23**, over the east treads. Stair keep-out never included z < −24, so the **path continuation is a tree alley**.

Trunks themselves are the custom-8 hollow-canopy miss: no bark cylinder, ice-cream melt, same as `hill-v8`.

### 4. Grey slabs? **Yes — they *are* the shot.**

Not the v5 skyline wall (agent 42 moved #5). v8’s right-edge house-interior clip is **gone** (yaw 3.2 looks north). What remains:

1. **Twelve `0x8a8680` stair boxes** as a CG ramp. No grout, no granite grain, no wet. Overcast hemi (1.42) + sun 0.34 → dead mid-grey.
2. **Nosing triangles** from overlapping untilted tops (see §1).
3. Dark wedge under the **right eaves** (house `(−10.5, −30)` east of stairs, plus any residual gap-fill). Reads as another slab, not plaster.
4. `park-v9` floating tread cards — same boxes from the side.

Lantern 0 `(−24.55, −16.85)` is the small grey post behind Hiro. Fine. The slabs are the stairs.

---

## What the still actually shows (top → bottom)

- Canopy clip, `0x8894a0` sky crumbs between boles.
- Four melted oaks in a rank; kirizuma houses behind, unreadable as a park court.
- Dark benches at the stair head; lantern west of centreline.
- Olive height-field flanks, hard vertical cut to grey.
- Hiro back, left, standing on a tread.
- Receding 6.5 m slabs; nearest tread is a grey floor to the bottom edge.

This is a **stair product shot with a person in the near clip**, not Suzume-zaka.

---

## Proposed camera (`LANDMARKS.hill` only)

Goal: stairs as a **ribbon in lawn**, houses above, oaks as flanks, Hiro not a billboard. Stay off treads. Pitch **up** when looking uphill so we do not stare at box tops.

**Primary** (toe, look up the 坂 — replace current):

```js
hill: { x: -17.2, z: -10.8, yaw: 3.05, pitch: 0.10 },
```

- SidewalkN, **4.4 m south of the first tread**, 2.8 m **east** of centreline (not in the flight).
- Yaw 3.05 = π − 0.09 → ~5° west of north: look **along** the east shoulder, stairs recede left-of-centre, west lawn in the left third.
- Pitch **+0.10** lifts the horizon onto house eaves; tread tops become a path, not a floor.
- Hiro `(−22, −18)` is ~8.6 m ahead and 5 m left — a figure, not a melted wall.
- Oak `(−16, −28)` is 17 m ahead but **4 m off** the new look (we stand at x = −17.2 looking slightly west) — bole is a flank, not the vanishing point.

**Alternate** if primary still hits the `(−16, −28)` canopy (west lawn 3/4):

```js
hill: { x: -26.2, z: -14.6, yaw: 1.02, pitch: -0.08 },
```

West of lantern 0, look ENE **across** the flight. Stairs as a band on grass, unique house left-rear, instance `(−10.5, −30)` right. Do **not** reuse yaw −0.75 (v6 looked into north-row **backs**).

Leave `stairs` `{ x: -18, z: -14, yaw: 0.12, pitch: -0.16 }` as the **downhill / Sakae** shot. `park` already shows the west lawn (and the same stair bug).

---

## Proposed mesh / plant (parent, not this file)

Cheap first, stills last.

1. **Relocate the stair Hiro.** `{ x: -22, z: -18 }` is illegal vs the stair AABB. Park bench #1 `(−33.00, −17.15, yaw: π)` or path bench #10 `(−26.10, −24.95)`. Do not clone another blazer into this frustum.
2. **Nudge oaks off the stair axis** (keep trunks ≥ 8 m, canopy not over treads):
   - `(−20, −36)` → **`(−28, −36)`** (or drop; unique house is at −28, −34 — use **`(−32, −38)`** if that collides).
   - `(−16, −28)` → **`(−12.5, −32)`** (east lawn, outside house C keep-out `x −14.7…−6.3 × z −34.2…−25.8` — sit **`(−13.8, −22.5)`** south of that house instead).
   - `(−22, −40)` already 2 m off axis; leave or push to **`(−26, −42)`**.
3. **Scale oaks** to agent 42: `realHeight 11`, `realWidth/Depth 9`. 14 m crowns are why four boles become a wall.
4. **Drape park (and any hillPath) on `groundHeight`.** Agent 12 `addDrapedPatch`, lift 0.05, segsZ ≥ 24. Stop `addGroundPatch` for `GROUND.park`. Same field as the stairs.
5. **Stair / grass seam.** Either drop the `0.4 t` path cut so lips match, or apply the same cut to the draped park verts in `x ∈ [−24, −16]`. Keep downhill-lip Y (already in `main.mjs`). Optional: 0.35 m stone cheek boxes along x = ±3.25 so the flight reads **cut into** the slope. Per-step albedo jitter (`0x8a8680` ± 8) beats a texture this pass.
6. **Nosing triangles.** Cut tread depth to **1.05** (flush run) or 1.06. The extra 7 cm is the diamond in `hill-v9` / floating cards in `park-v9`.
7. **Hiro hull** (not a camera fix): `realHeight 1.72` must not drop to 32³; magenta-fill cyclorama; a true `yaw-180` back. Until then, keep his back out of landmark stills.

Do not move skyline boxes for this still — they are not the grey.

---

## Pass bar for `hill-v10`

- Camera **not** on a tread (`z > −12.3` or `z < −24.2` or `|x + 20| > 3.5`).
- Stairs read as a **6.5 m stone path in grass**, both flanks visible, no triangle overlays.
- At least one Suzume house genkan / gable readable, not only through canopy holes.
- Zero Hiro **backs** inside ~6 m.
- Oak trunks as a **colonnade beside** the path, not a rank on the optical axis.
