# 11 — Amihama docks / quay / water

Design only. Do not edit sample source in this pass.

World: +X east, +Z south, metres. Camera `yaw = 0` looks +Z (water), `yaw = π` looks −Z (town). Mesh `yaw = 0` presents the yaw-000 facade to +Z. Eye is 1.62 m. Dock `groundHeight` is 0.04 for `z ∈ (52, 88]`.

Sources: `map.mjs` GROUND, `catalog.mjs` warehouse subjects + INSTANCES, `scout.mjs` LANDMARKS, `main.mjs` `addStreetFurniture` wall.

---

## Height verdict — yes, too toy-like

| piece | now | reads as | small 1986 Kanagawa fishing / coastal-cargo quay |
|---|---|---|---|
| dock patch | `y = 0.06` | street-level apron | keep. Do not raise the town. Sakae is `y = 0`; Shenmue-style towns share one walkable plane. |
| `groundHeight` on dock | `0.04` | 2 cm below the patch | ignore. |
| water patch | `y = −0.4` | 0.46 m freeboard | **toy.** A person could step onto a barge. Real freeboard 1.8–3.0 m (Yokosuka spring tide ~1.6 m; coping sits ~0.5–1.0 m above MHWS). Container terminals are 4–5 m; we are not those. |
| wall box | `BoxGeometry(98, 1.5, 0.85)` at `(4, 0.35, 87.7)` | face from `y = −0.40` to `1.10` | **toy kerb.** Top is only 1.04 m above the dock — a playground parapet, not a quay face. Cargo quays are open; safety is bollards + a painted line, not a 1.5 m wall on the deck. |
| water south extent | `maxZ = 120` | 32 m basin | pond. Fog is 40–140, far clip 220. From the quay you see a hard water edge against sky. |

**Keep the deck at ~0.06. Drop the water. Rebuild the wall as the vertical face of the slab, not a fence on top of it.**

Recommended vertical section, seaward to inland:

```
y =  0.36   coping top (0.30 m upstand, 0.40 m wide)
y =  0.06   dock walking surface          ← GROUND.dock.y (unchanged)
y = −2.20   water surface                 ← GROUND.water.y
y = −2.50   (optional darker under-plane)
```

Freeboard 2.26 m. Wall box then spans water to coping:

- size `98 × 2.56 × 0.85`
- center `(4, −0.92, 87.7)`
- same X as today (`x ∈ [−45, 53]`), same Z seam (`z ∈ [87.275, 88.125]`)

If water **must** stay at −0.4 (walker / fog already authored): shrink the wall to the real face height `0.52` (water to deck + 6 cm coping), center `y = −0.14`. Do not keep the 1.5 m box — it will always look like a garden wall. Skip the quay ladder in that cheat (a 46 cm drop does not need one).

Bollard “0.4 m” is **diameter**, not height. 0.4 m tall is a parking post. Mooring bitts are ~0.85 m high, 0.3–0.4 m across.

---

## Warehouse pads — current collision, then a non-overlapping line

Catalog footprints, local X = `realWidth`, local Z = `realDepth`, rotated by Three `rotation.y`.

`realWorldScale` only uses `realWidth` for both XZ axes. Pads below reserve the catalog `width × depth` so a correctly deep hull still fits; a squarer hull just leaves extra aisle.

### As authored (broken)

| id | asset | pose | AABB (x × z) | problem |
|---|---|---|---|---|
| W8-A | `harbor-warehouse-8` unique | `x=−12, z=72, yaw=π` | `[−19, −5] × [63, 81]` | clear. South eaves 7 m from the wall. |
| W3 | `harbor-warehouse-3` unique | `x=16, z=70, yaw=π` | `[8, 24] × [64, 76]` | clear of W8-A (13 m gap). |
| W8-B | instance | `x=22, z=76, yaw=π·0.08` (~14°) | `[13.0, 31.0] × [65.5, 86.5]` | **intersects W3** ~11 × 10 m. South corner 0.8 m from the wall north face. |
| W8-C | instance | `x=40, z=68, yaw=−π·0.42` (~−76°) | `[29.5, 50.5] × [59.0, 77.0]` | corner-clips W8-B; **hangs 2.5 m off dock `maxX=48`**. The 76° yaw spends the 18 m depth along X; the east apron cannot take that. |

Keep W8-A and W3 where they are. They already face the town approach (`yaw = π` → yaw-000 cargo doors to −Z). That is the walk from harbor-gate. Do **not** sit a shed on `x = 0`: that axis is the truck lane (nav `harbor-gate` `(0,48)` → `quay` `(0,80)`).

W3’s yaw-000 still bakes a concrete lip + waterline onto the **inland** facade. Treat that as a reconstruction scar, not a second quay. Do not rotate W3 to `yaw = 0` just to make that lip face the water — it would hide the “第3倉庫” doors from the town walk.

### Proposed pads (4 sheds, 1 m eave margin inside each pad)

```
z=52   dock north (GROUND.dock.minZ)     harbor-gate is z=48
z=63   north eaves, W8 line
          W8-W              W8-A                W3               W8-E
         −32,72            −12,72             16,70             36,72
         14×18             14×18              16×12             14×18
         [−39,−25]         [−19,−5]           [8,24]            [29,43]
              6 m aisle         13 m truck lane      5 m aisle
z=76   W3 south (loading court, 12 m extra to the wall)
z=81   W8 south eaves
z=84   quay walk
z=86.6 bollards
z=87.7 wall center
z=88   water seam
```

| id | asset | x | z | yaw | footprint | AABB | pad AABB (+1 m) |
|---|---|---|---|---|---|---|---|
| W8-W | `harbor-warehouse-8` instance | −32 | 72 | π | 14 × 18 | `[−39, −25] × [63, 81]` | `[−40, −24] × [62, 82]` |
| W8-A | unique (unchanged) | −12 | 72 | π | 14 × 18 | `[−19, −5] × [63, 81]` | `[−20, −4] × [62, 82]` |
| W3 | unique (unchanged) | 16 | 70 | π | 16 × 12 | `[8, 24] × [64, 76]` | `[7, 25] × [63, 77]` |
| W8-E | `harbor-warehouse-8` instance | 36 | 72 | π | 14 × 18 | `[29, 43] × [63, 81]` | `[28, 44] × [62, 82]` |

Replace the two INSTANCES lines with:

```js
{ asset: "harbor-warehouse-8", x: -32, z: 72, yaw: Math.PI },
{ asset: "harbor-warehouse-8", x: 36, z: 72, yaw: Math.PI },
```

Optional 5° irregularity on the east shed only: `yaw: Math.PI - 0.08`. Do not revive `−π·0.42`.

Clearances:

- W8-W west face at −39 vs dock `minX = −40` → 1 m.
- W8-E east face at 43 vs dock `maxX = 48` → 5 m (forklift / van).
- North of the sheds: 11 m of apron (`z=52…63`) for the turn off harbor-gate.
- South of the W8s: 6.7 m of quay walk (`z=81…87.7`). W3 has 11.7 m — its loading court.
- Truck lane `x ∈ (−5, 8)` is empty all the way to the ladder at `x = 0`.

---

## Quay kit — primitives in `addStreetFurniture`

Wall already exists. Add bollards, one ladder, rubber fenders. Same cheap `MeshStandardMaterial` as the stairs / wall. No new orbit subjects.

### Wall (replace the current 1.5 m box)

```
BoxGeometry(98, 2.56, 0.85)
position (4, -0.92, 87.7)
material  color 0x6e6a64  roughness 0.95  metalness 0
```

Coping as a second box on the seaward half of the deck edge, so the walk does not hit a 2.5 m fence:

```
BoxGeometry(98, 0.30, 0.40)
position (4, 0.21, 87.55)
material  color 0x7a7670  roughness 0.9
```

Top `y = 0.36`, seaward face ~87.75 (flush with wall north-of-center). Inland face ~87.35 — a 0.3 m trip edge, not a parapet.

Painted safety line 0.8 m inland of the coping, on the dock:

```
for x = -38; x <= 46; x += 3.2
  BoxGeometry(1.6, 0.02, 0.12) at (x, 0.08, 86.3)
  color 0xc9b56a   (same paint as the Sakae centre dashes)
```

### Bollards — cylinder, 0.4 m diameter

```
CylinderGeometry(0.20, 0.20, 0.85, 10)
material  color 0x3a3834  roughness 0.55  metalness 0.35
```

Height 0.85 m. Center `y = 0.06 + 0.425 = 0.485`. Place on the dock, 1.1 m inland of wall center so they are not inside the wall mesh:

`z = 86.6`

Nine, every 10 m, between the painted line and the sheds, spanning the working face and missing the ladder at `x = 0`:

`x = −36, −26, −16, −6, 4, 14, 24, 34, 44`

W8 south eaves at `z = 81` → 5.6 m of clear quay. Eastmost bollard `x = 44` is 1 m inside dock `maxX`. Optional 0.06 m yellow band: a thin torus or a second cylinder `r=0.21, h=0.05` at `y = 0.80`.

### Ladder (one, in the truck-lane gap)

Not the roof ladder already painted on W3’s gable. This one is a quay ladder down the seaward face at `x = 0`.

With water at −2.2 (run ~2.4 m):

```
rails   two BoxGeometry(0.06, 2.40, 0.06)
        at x = ±0.18, y = −0.92, z = 88.18
rungs   eight BoxGeometry(0.42, 0.04, 0.06)
        y = −2.05 + i·0.30,  i = 0..7
        z = 88.18
material  color 0x5a5c58  roughness 0.7  metalness 0.4
```

Seaward of the wall (`wall z` max 88.125) so rungs are grab-able from a boat. Top rung ~`y = 0.05` (deck). Bottom rung ~`y = −2.05` (15 cm above water).

If water stays at −0.4, omit the ladder.

### Rubber fenders — boxes

Hanging on the seaward face, staggered between bollards so a hull hits rubber not iron.

With 2.26 m freeboard:

```
BoxGeometry(0.55, 1.60, 0.40)
y = -0.90
z = 88.22          (flush outside the wall)
material  color 0x1a1a1a  roughness 0.98  metalness 0
```

Eight: `x = −31, −21, −11, −1, 9, 19, 29, 39`

Top ~`y = −0.10` (just under coping). Bottom ~`y = −1.70` (0.5 m above water).

Toy-water cheat: `BoxGeometry(0.55, 0.50, 0.28)` at `y = −0.15, z = 88.22` — otherwise a 1.6 m fender sticks above the deck.

No tires, no chains. Boxes only.

---

## Water patch extent

Authored:

```
dock   { minX: -40, maxX: 48, minZ: 52, maxZ: 88,  y:  0.06, color: 0x8a8680 }
water  { minX: -50, maxX: 55, minZ: 88, maxZ: 120, y: -0.40, color: 0x2a4458 }
```

The seam at `z = 88` is correct (wall sits on it). The patch is too small in X (wall runs −45…53, water −50…55 — 2 m of margin, corners show from the quay) and far too small in Z.

Replace with:

```
water: { minX: -58, maxX: 62, minZ: 87.9, maxZ: 168, y: -2.2, color: 0x2a4458 }
```

| | now | proposed |
|---|---|---|
| width X | 105 m | 120 m (covers wall + 13 m each side) |
| south Z | 32 m from seam | 80 m from seam |
| from quay landmark `z=84` to water end | 36 m | 84 m — dies in fog (40–140) instead of a hard edge |
| y | −0.4 | −2.2 |
| color | `0x2a4458` | keep (overcast winter steel, not tropical) |

`minZ = 87.9` tucks 3 cm under the wall so there is no light gap.

`groundHeight` today: `z > 88 → −0.35`. If water drops, either clamp the walker (`z ≤ 86.5`) or set `z > 88 → −2.2` so a fall matches the plane. Do not leave the walker hovering 2 m over the water.

Hill mesh is 96 × 72 centered on origin (`z ∈ [−36, 36]`) and does not reach the dock. South of `z = 168` is fog-colored void. That is enough.

No FFT ocean in this sample. One `PlaneGeometry` via `addGroundPatch` is the water.

---

## Landmark poses

Scout applies `y = groundHeight(x,z) + 1.62` unless `y` is given. 55° FOV. W8-A north face is at `z = 63`, 9.5 m to the ridge; standing at `z = 58` (current `warehouse`) is 5 m from the facade and clips the gable. Pull back.

```js
// head-on cargo doors of Warehouse 8, from the town side of the dock
warehouse: { x: -12, z: 50, yaw: 0, pitch: 0.10 },

// on the quay, truck-lane gap, looking out to water (lower third = basin)
quay:      { x: 0,   z: 84, yaw: 0, pitch: -0.12 },

// same boots, turn around — sheds in the periphery, Sakae + hill in the gap
town:      { x: 0,   z: 84, yaw: Math.PI, pitch: 0.06 },
```

Keep the approach shot, just put it on the lane axis:

```js
harbor:    { x: 0,   z: 56, yaw: 0, pitch: 0.02 },
```

| name | why these numbers |
|---|---|
| `warehouse` | `x` matches W8-A. `z=50` is 13 m from the north face (on the dock lip / gate). `atan((9.5−1.66)/13) ≈ 31°` vs ~27° half-VFOV — ridge in frame, a strip of sky. `yaw=0` looks at the numbered doors (`倉42` / No.17). `pitch=0.10` lifts the camera onto the gable, not the asphalt. |
| `quay` | `x=0` is the empty lane, no shed in the way. `z=84` is 3.7 m inland of the wall, 2.6 m inland of the bollards — water, fenders, and the 2.3 m drop sit in the lower third. `pitch=−0.12` (~−7°) glances down; with only 0.46 m freeboard this pitch is wasted, which is another reason to drop the water. |
| `town` | Same pair of boots as `quay`. `yaw=π` frames W8-A east eave (`x=−5`) and W3 west eave (`x=8`) as a 13 m slot onto Sakae (`z=0`) and Suzume-zaka (`z≈−28`). Slight up-pitch for the ridges and the hill. |
| `harbor` | Gate of the district. Looking south you read: apron, four sheds, slot of water. |

3/4 extras, not required for keys 1–9:

```js
warehouse34: { x: -22, z: 54, yaw: 0.48, pitch: 0.08 },  // NW of W8-A, gable + eave
quayBollard: { x: 3.2, z: 85, yaw: 0.06, pitch: -0.10 }, // 0.4 m west of the x=4 bitt, scale reference
```

---

## What not to do

- Do not edit `samples/harbor_town_1986` in this pass.
- Do not instance a fifth warehouse. Four fills the 88 m dock; a fifth lands in the truck lane or in the water.
- Do not put bollards at 0.4 m **height**.
- Do not use W3’s baked dock lip as the world quay.
- Do not raise `GROUND.dock.y` to “look more harbor.” Raise the *drop* to the water instead.
