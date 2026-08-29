# 43 — Amihama dock + Yokobori alley clutter

Design only. Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south, `Math.PI` north,
`-Math.PI / 2` west. Mesh yaw-000 is local `+Z`. Eye 1.62 m.
`GROUND.dock` `y = 0.06` (`groundHeight` returns `0.05` for `z ≥ 52`).
`GROUND.alley` `y = 0.04`. Plant uniques with `plantMesh` (AABB floor on
`groundHeight`). Primitive `y` below is the mesh **centre**.

Sources: `seawall-v5.png`, `yokobori-v5.png`, `harbor-warehouses.png`,
`catalog.mjs` warehouse metres, `roads.mjs` bollards, `main.mjs`
`addQuayEdge`, agents 10 / 11 / 15 / 31.

---

## What the three stills actually show

| still | camera (approx) | foreground | mid | already there |
|---|---|---|---|---|
| `seawall-v5.png` | west apron looking **east** (agent 31 `seawall` `{ x: -38.5, z: 86.6, yaw: 1.62 }`) | empty grey dock | warehouses on the left, water + cap on the right | short cap bollards receding; tire/ladder beat |
| `harbor-warehouses.png` | south of W3 / W8-E looking **north** | empty brown-grey apron | W3 (timber, left), W8-E (green corrugated, right) | tiny cap posts on the horizon |
| `yokobori-v5.png` | alley mouth looking **south** (agent 10 `yokobori` `{ x: 20.2, z: 10.4, yaw: 0.18 }`) | empty brown slab | Galaxy left, enamel vending isolated in the lane | vending instance `(21.94, 18.6)`; three sheds in the far dock |

No crates, drums, pallets, coils, or running lines. Dock and alley are
**empty slabs** with sheds + one machine + bollards. That is the hole.

Do not fill the Sakae→harbor approach (`z ≈ 28 … 52`). This note is
apron + quay (`z 52 … 86`) and Yokobori (`GROUND.alley`).

---

## Unique reconstructed vs BoxGeometry / CylinderGeometry

`TOWN.md`: drum and bollard = **cylinder**; shops = rectangle. Crates,
pallets, and rope are not on the cheat-sheet. Rule for this pass: unique
only when the silhouette carries paint / timber / hemp that a primitive
cannot fake at walking FOV, **and** the AABB is ≥ ~0.7 m so 48³ has
enough voxels. Fused silhouette (one blob, no air gaps between crates).
Magenta studio, no floor, no shadow.

| piece | verdict | why |
|---|---|---|
| **Crate stack (cargo / fish)** | **UNIQUE** `dock-crates`, rectangle, 4 | 1.2 m timber mass with 南浜 / 8号 stencil and rope. BoxGeometry is a Minecraft cube; Yaoya’s crates are baked into that façade and do not sit on the apron. |
| **Beer-crate stack** | **UNIQUE** `beer-crates`, rectangle, 4 | Yokobori language is 一升 / beer wood, not fish cargo. 0.96 m fused pile is large enough to carve; a single 0.36 m module is not. |
| **Oil drum** | **UNIQUE** `oil-drum`, cylinder, 2 | `TOWN.md` cylinder. Rust + faded red + stencil. One drum, then instance on the ground. |
| **2–3 drum cluster, 2-high** | **CylinderGeometry** in `addStreetFurniture` | `INSTANCES` have no `y`. A second unique “drum-stack” wastes stills. Match the unique’s colour. |
| **Bollard / bitt** | **KEEP primitives. Do not unique.** | Two sets already exist (below). A 0.85 m T-bitt at 48³ is a wart; `TOWN.md` already calls it a cylinder. |
| **Rope coil (hawser)** | **UNIQUE** `rope-coil` **or** stacked cylinders | Coil is the quay beat next to existing bollards. Custom-8 if stills remain after #1–#3; else three stacked `CylinderGeometry` (agent 31: no `TorusGeometry`). |
| **Running mooring line** | **CylinderGeometry** `r = 0.035`, or skip | A unique line vanishes. One short deck snake per coil is enough. |
| **Pallet (empty)** | **BoxGeometry only** | JIS / T11 is `1.10 × 0.14 × 1.10`. 14 cm at 48³ is a pancake. Three boxes (deck + two stringers) read as a pallet. |
| **Loose single crate** | **BoxGeometry** `0.48 × 0.32 × 0.36` | Same as agent 10’s beer module. Do not orbit a 0.3 m box. |
| **Net pile / tarp / tire stack on deck** | **skip** | Organic blob at 48³. Wall tires already hang on the seawall. |
| **Forklift / quay worker** | **defer** | Agent 15 after-list. Not this clutter pass. |

Do **not** instance `dock-crates` in Yokobori (wrong grain). Do **not**
instance `beer-crates` on the apron (wrong grain).

---

## Keep-out — warehouses, lane, bollards

Live catalog (`realWidth × realDepth`, yaw `π`, `realWorldScale` now
uses `realDepth`):

| id | pose | plan | AABB x × z |
|---|---|---|---|
| W8-W | `harbor-warehouse-8` inst **(−32, 72, π)** | 8.5 × 11 | **[−36.25, −27.75] × [66.5, 77.5]** |
| W8-A | unique **(−12, 72, π)** | 8.5 × 11 | **[−16.25, −7.75] × [66.5, 77.5]** |
| W3 | unique **(16, 70, π)** | 16 × 12 | **[8.00, 24.00] × [64.0, 76.0]** |
| W8-E | inst **(36, 72, π)** | 8.5 × 11 | **[31.75, 40.25] × [66.5, 77.5]** |

Plant clutter **≥ 0.8 m outside** those AABBs (centres listed below
already include that). Agent 11’s older 14 × 18 pads
(`[−39,−25]×[63,81]` etc.) are **not** live; hugging the 8.5 × 11
mesh is what fills `seawall-v5` / `harbor-warehouses`. If a fat hull
still reads 14 m, slide the north-face piles 1 m further north rather
than inventing a fifth shed.

Hard clears (do not plant):

- Truck / walker lane **`x ∈ (−5, 8)`**, `z 52 … 86` — nav
  `harbor-gate (0, 48)` → `quay (0, 80)`, ladder at `x = 0`.
- Dock slab **`x ∈ [−40, 48]`, `z ∈ [52, 86]`**. Nothing at `z > 85.5`
  except the existing bollards (quay walk + cap).
- Existing bollard cylinders (keep; do not duplicate):

`roads.mjs` working-face bitts, `z = 86`, `h = 0.9`, `r = 0.18`,
`y = groundHeight + 0.45`:

`x = −24, −14.86, −5.71, 3.43, 12.57, 21.71, 30.86, 40`

`addQuayEdge` cap posts, `z = 87.72`, `h = 0.42`, `r ≈ 0.15`, `y = 1.83`:

`x = −40, −24, −8, 8, 24, 40`

- 0.8 m radius around every bitt. No crate on `x = 3.43` or `x = −5.71`
  (lane). No third bollard set.

```
z=52   dock north / harbor-gate
z=62   north-apron piles (this note)
          W8-W             W8-A            LANE           W3              W8-E
         −32,72           −12,72         x=−5…8         16,70            36,72
z=64   W3 north wall
z=66.5 WH8 north walls
z=76   W3 south wall  → loading court (hero for harbor-warehouses)
z=77.5 WH8 south eaves
z=82   south-eave piles (hero for seawall-v5)
z=84   quay walk piles (east/west of the lane only)
z=86   roads bollards
z=87.7 cap / wall
z=88   water
```

Aisles that **may** take wall-hugging drums (not stacks that block a
forklift): W8-W/W8-A (`x −27.75 … −16.25`), W3/W8-E (`x 24 … 31.75`).

---

## Amihama poses — `z 52 … 86`

Yaw in radians. Unique origins go in `ORBIT_SUBJECTS`; the rest in
`INSTANCES` (or furniture, marked). All on-dock, outside warehouse AABBs.

### `dock-crates` (unique + instances)

| | x | z | yaw | sits |
|---|---:|---:|---:|---|
| **unique** | **−14.2** | **65.2** | **0.12** | W8-A north face (`z = 66.5`). Replaces agent 15’s `(−18.2, 62.2)` — that x is west of the live 8.5 m hull. Occupies ≈ `[−14.8, −13.6] × [64.6, 65.8]`. |
| inst N-W | −34.4 | 65.2 | −0.18 | W8-W north |
| inst N-3 | 10.4 | 62.8 | 0.08 | W3 north (town / `yokobori-v5` background at the shed feet) |
| inst N-E | 38.2 | 65.2 | −0.10 | W8-E north |
| inst S-3 | **12.6** | **77.4** | **0.22** | W3 south court — **hero for `harbor-warehouses.png`** |
| inst S-A | **−10.8** | **78.8** | **−0.15** | W8-A south eaves — **hero for `seawall-v5`** (left of frame once you look east) |
| inst S-E | 33.4 | 78.8 | 0.18 | W8-E south, west corner, in the W3/W8-E gap |
| inst S-W | −29.6 | 78.8 | −0.22 | W8-W south eaves (near camera in `seawall-v5`) |
| inst quay W | −6.6 | 83.6 | 0.35 | quay walk, **west** of the truck lane, 2.4 m north of bitt `x = −5.71` |
| inst quay E | 9.4 | 83.6 | −0.28 | quay walk, **east** of the lane, 3.2 m west of bitt `x = 12.57` |

Ten poses. Do **not** add agent 15’s `(2.0, 84.0)` — that is in the lane.

### `oil-drum` (unique + instances, all on the ground)

| | x | z | yaw | sits |
|---|---:|---:|---:|---|
| **unique** | **18.6** | **62.6** | **0** | W3 north, x on the façade, z 1.4 m north of `z = 64`. Agent 15’s `z = 64.0` was on the wall. |
| inst pair | 19.35 | 62.75 | 0.40 | 0.75 m east of unique (classic 2-drum) |
| inst W8-A | −16.9 | 65.5 | 0.20 | W8-A NW corner, west of the unique crate stack |
| inst aisle | 25.6 | 74.2 | 0.15 | W3 east wall (`x = 24`), in the 7.7 m aisle, not blocking |
| inst S-3 | 20.8 | 77.2 | 0.30 | W3 SE corner, south court |
| inst S-E | 32.2 | 78.7 | 0.10 | W8-E SW |
| inst S-W | −30.4 | 78.7 | 0.08 | W8-W south |
| inst quay | −8.5 | 84.7 | 0 | west of lane, 1.3 m north of bitt `x = −5.71` (centres 3.1 m apart) |

No drum at `(22.4, 18.2)` (agent 15) — that overlaps the alley vending.
Yokobori drums are in the alley table.

### Pallets — BoxGeometry only (`addStreetFurniture`)

JIS T11 empty, winter wet timber `color 0x8a7048`, roughness `0.92`.
Each “pallet” is three boxes. `y` centres on dock `0.06`.

```
deck      BoxGeometry(1.10, 0.04, 1.10)   y = 0.14
stringer  BoxGeometry(1.10, 0.10, 0.12)   y = 0.07,  z = ±0.38
```

| id | x | z | yaw | n high | sits |
|---|---:|---:|---:|---:|---|
| P1 | 14.0 | 78.6 | 0.08 | 2 | W3 south court, west of crate inst S-3 |
| P2 | 21.2 | 77.0 | −0.20 | 1 | W3 SE, next to drum inst S-3 |
| P3 | 34.0 | 79.0 | 0.12 | 1 | W8-E south |
| P4 | −36.4 | 79.1 | 0.30 | 1 | W8-W south |
| P5 | 9.6 | 83.2 | 0.05 | 2 | quay, east of lane (with crate inst quay E) |
| P6 | **−26.9** | **70.4** | **0.40** | 1 | W8-W east wall (`x = −27.75`), mid-depth. Leaves ~3 m through the aisle. Not at aisle centre. |

2-high means a second deck/stringer group with `y += 0.14`.

### Rope — unique coils *or* cylinders, plus one deck snake

If `rope-coil` ships, instance it. If not, each row is three
`CylinderGeometry(0.30, 0.30, 0.10)` stacked at `y = 0.11, 0.21, 0.31`,
hemp `0x6a5a40`.

| | x | z | yaw | next to |
|---|---:|---:|---:|---|
| unique or prim | **−14.9** | **85.25** | **0.4** | bitt `x = −14.86` (inland of it) |
| inst / prim | 12.55 | 85.25 | −0.2 | bitt `x = 12.57` |
| inst / prim | 21.70 | 85.20 | 0.1 | bitt `x = 21.71` |
| inst / prim | 39.85 | 85.25 | 0.0 | bitt `x = 40`, 8 m inside `maxX = 48` |

Optional deck snake (primitive only): `CylinderGeometry(0.035, 0.035, 1.8)`
rotated onto XZ, from coil centre toward the bitt, `y = 0.10`. Four
snakes max. No line across the lane (`x = −5 … 8`).

### 2-high drum cluster — primitives, W3 court

Match unique drum metres `h = 0.88, r = 0.29`, colour `0x6a2a22`,
roughness `0.82`. Furniture, not catalog.

```
(15.15, 0.50, 77.85)   ground
(15.78, 0.50, 78.10)   ground, kissed
(15.40, 1.38, 77.95)   sitting on the pair  (y = 0.06 + 0.88 + 0.44)
```

This is the rusty pile in the lower-left third of `harbor-warehouses.png`.
Keep it west of crate inst S-3 `(12.6, 77.4)` — 2.5 m gap.

### Copy-paste `INSTANCES` rows (new assets only)

Do not duplicate warehouse / vending / pole rows already in `catalog.mjs`.

```js
// dock-crates — unique origin is ORBIT_SUBJECTS (−14.2, 65.2, 0.12)
{ asset: "dock-crates", x: -34.4, z: 65.2, yaw: -0.18 },
{ asset: "dock-crates", x: 10.4, z: 62.8, yaw: 0.08 },
{ asset: "dock-crates", x: 38.2, z: 65.2, yaw: -0.10 },
{ asset: "dock-crates", x: 12.6, z: 77.4, yaw: 0.22 },
{ asset: "dock-crates", x: -10.8, z: 78.8, yaw: -0.15 },
{ asset: "dock-crates", x: 33.4, z: 78.8, yaw: 0.18 },
{ asset: "dock-crates", x: -29.6, z: 78.8, yaw: -0.22 },
{ asset: "dock-crates", x: -6.6, z: 83.6, yaw: 0.35 },
{ asset: "dock-crates", x: 9.4, z: 83.6, yaw: -0.28 },

// oil-drum — unique origin (18.6, 62.6, 0)
{ asset: "oil-drum", x: 19.35, z: 62.75, yaw: 0.40 },
{ asset: "oil-drum", x: -16.9, z: 65.5, yaw: 0.20 },
{ asset: "oil-drum", x: 25.6, z: 74.2, yaw: 0.15 },
{ asset: "oil-drum", x: 20.8, z: 77.2, yaw: 0.30 },
{ asset: "oil-drum", x: 32.2, z: 78.7, yaw: 0.10 },
{ asset: "oil-drum", x: -30.4, z: 78.7, yaw: 0.08 },
{ asset: "oil-drum", x: -8.5, z: 84.7, yaw: 0 },
{ asset: "oil-drum", x: 25.45, z: 19.15, yaw: 0.22 },  // yokobori south gable
{ asset: "oil-drum", x: 18.48, z: 21.6, yaw: 0.10 },   // yokobori west wall

// beer-crates — unique origin (23.58, 19.18, -0.12)
{ asset: "beer-crates", x: 18.52, z: 16.85, yaw: 0.35 },
{ asset: "beer-crates", x: 23.70, z: 13.55, yaw: 0.18 },

// rope-coil — unique origin (−14.9, 85.25, 0.4)  (omit whole block if primitives)
{ asset: "rope-coil", x: 12.55, z: 85.25, yaw: -0.20 },
{ asset: "rope-coil", x: 21.70, z: 85.20, yaw: 0.10 },
{ asset: "rope-coil", x: 39.85, z: 85.25, yaw: 0 },
```

---

## Yokobori alley poses

Live bar: `yokobori-bar` `(26, 16)`, `yaw = −π/2`, `5.2 × 5.5`
(agent 16 metres, already in catalog). Front plane **`x = 23.25`**,
façade **`z = 13.4 … 18.6`**, back **`x = 28.75`**.

Already planted (do not overlap):

| piece | x | z | AABB (approx) |
|---|---:|---:|---|
| bar hull | 26 | 16 | x 23.25…28.75, z 13.4…18.6 |
| vending inst | 21.94 | 18.6 | x 21.58…22.30, z 18.15…19.05 (yaw −π/2) |
| pole inst | 18.35 | 11.4 | r 0.18 at the mouth |

Lane / walk slot to **keep empty**: **`x 19.2 … 22.5`**, `z 10 … 22`
(the 3.3 m yokochō; vending already nicks the south-east corner).
West wall `x = 18`. Mouth `z ≈ 10`. Back-court `x > 28.75` is off-camera
in `yokobori-v5` — one pallet only.

| piece | x | z | yaw | type | sits |
|---|---:|---:|---:|---|---|
| **beer-crates unique** | **23.58** | **19.18** | **−0.12** | unique | south gable, 0.6 m south of vending, 0.3 m east of front plane. Occupies ≈ `[23.22, 23.94] × [18.86, 19.50]`. Left third of the beauty shot as you walk in. |
| beer-crates inst W | 18.52 | 16.85 | 0.35 | inst | west wall, opposite the noren. Pinches the lane to ~3.3 m without a trip in the centre. |
| beer-crates inst N | 23.70 | 13.55 | 0.18 | inst | north jamb, **east** of the mouth. Visible from Sakae-east looking south. |
| oil-drum inst S | 25.45 | 19.15 | 0.22 | inst | further along the south gable, 1.9 m east of the unique stack |
| oil-drum inst W | 18.48 | 21.6 | 0.10 | inst | west wall, south of the door, still on the brown slab (`maxZ = 28`) |
| pallet P7 | 29.6 | 17.1 | 0.45 | BoxGeometry | back-court, east of the service door. Skip if furniture budget is tight. |
| loose crate A | 22.95 | 19.70 | 0.55 | BoxGeometry `0.48×0.32×0.36`, `0x6b4423` | tumble south of the unique stack |
| loose crate B | 18.55 | 15.40 | −0.4 | same | west wall, north of inst W, 0.5 m south of the north gable line |

`y` for unique/inst via `plantMesh`. Primitive crate centres:
`y = 0.04 + 0.16 = 0.20`. Pallet same recipe as the dock, `y` on alley
`0.04`.

Do not stand anything on `z < 11` (sidewalkS / mouth camera). Do not
put a 1.35 m `dock-crates` here.

---

## Ranked unique meshes to generate

Rank is “closes the empty-slab hole per still, per extra orbit”. Metres
are catalog `realHeight × realWidth × realDepth`. Magenta `#E040A0`-class,
isolated, no floor, no shadow, 15:20 29 Nov 1986. No Dobuita / Yokosuka /
“New Harbor” lettering — **南浜**, **8号**, **3号** only.

### 1. `dock-crates` — do first

Fills `seawall-v5` (south eaves) and `harbor-warehouses` (W3 court) and
the shed feet in `yokobori-v5`.

| | |
|---|---|
| id / folder | `dock-crates` |
| label | Dock crate stack |
| kind / views | **rectangle**, **4** |
| metres | **1.35 × 1.20 × 1.15** |
| district | amihama |
| x, z, yaw | **−14.2, 65.2, 0.12** |

Two-by-two timber produce / fish crates, one connected silhouette
(gaps between boards are paint, not air). Rope. Stencil **南浜** / **8号**.
No plastic, no stretch-wrap. Yaw-000 = the stencilled long face.

### 2. `oil-drum` — cheap second beat

| | |
|---|---|
| id / folder | `oil-drum` |
| label | Oil drum |
| kind / views | **cylinder**, **2** (`yaw-000`, `yaw-090`) |
| metres | **0.88 × 0.58 × 0.58** |
| district | amihama |
| x, z, yaw | **18.6, 62.6, 0** |

200 L, rust, faded red, 南浜 stencil. Pass catalog `kind: "cylinder"`
into reconstruction so it snaps round (agent 13 / 22). Yaw 0 is enough.

### 3. `beer-crates` — alley only

| | |
|---|---|
| id / folder | `beer-crates` |
| label | Beer crate stack |
| kind / views | **rectangle**, **4** |
| metres | **0.96 × 0.72 × 0.64** |
| district | yokobori |
| x, z, yaw | **23.58, 19.18, −0.12** |

Fused 3-high × 2-wide 一升 / beer wood (not the 1.2 m cargo stack).
Dark `0x6b4423` timber, maybe one faded ビール panel — no brand that
post-dates 1986 as the hero word. If still budget dies after #1+#2,
skip this unique and keep the two `BoxGeometry` tumble crates plus
agent 10’s original three modules at A/B/C.

### 4. `rope-coil` — only if #1–#3 exist

| | |
|---|---|
| id / folder | `rope-coil` |
| label | Hawser coil |
| kind / views | **custom**, **8** |
| metres | **0.38 × 0.70 × 0.70** |
| district | amihama |
| x, z, yaw | **−14.9, 85.25, 0.4** |

Hemp coil on the deck, hole optional (48³ will fill it). Custom because
a cylinder snap becomes a squat drum and duplicates #2. If this is cut,
the stacked-cylinder stand-in at the same four poses is acceptable.

### Do not unique this pass

| id | metres | reason |
|---|---|---|
| bollard / bitt | ~0.85 × 0.40 × 0.40 | already `CylinderGeometry` × 14 |
| wood-pallet | 0.14 × 1.10 × 1.10 | too thin; three boxes |
| single crate | 0.32 × 0.48 × 0.36 | too small |
| running rope | — | thin cylinder or skip |
| portal crane / forklift | — | agent 15 defer |

---

## What the stills should look like after this pass

- **`seawall-v5`**: walking east, timber piles against W8-W / W8-A south
  eaves on the left, hawser coils just inland of the receding bitts,
  truck lane still a dark empty slot down the middle of the sheds.
- **`harbor-warehouses`**: W3 court has crate stack + pallet + 2-high
  drum cluster in the lower third; W8-E keeps a pile at its SW corner;
  gap between the sheds shows one aisle drum, not a wall of cargo.
- **`yokobori-v5`**: beer-crate unique under Galaxy’s south corner, west-wall
  stack as a dark block on the right, vending still readable, walk slot
  open, distant dock piles tiny at the shed feet.

Counts: crates × 10 dock + 3 alley, drums × 8 dock + 2 alley + 3
primitive, pallets × 6 dock + 1 alley, coils × 4, bollards unchanged.

---

## Do not

- Edit `samples/harbor_town_1986` from this note
- Unique-mesh a bollard, pallet, manhole, or single crate
- Add a third bollard set on top of `roads.mjs` + `addQuayEdge`
- Plant anything in `x ∈ (−5, 8)` on the dock, or on `z > 85.5`
- Instance `dock-crates` in Yokobori or `beer-crates` on Amihama
- Revive agent 15’s `(−18.2, 62.2)` crate origin or `(2.0, 84.0)` quay crate
- Drop a fifth warehouse, a crane, or a forklift
- Use `TorusGeometry` (agent 31)
- Letter Dobuita / Yokosuka / Abe / Tomato / “New Harbor”
