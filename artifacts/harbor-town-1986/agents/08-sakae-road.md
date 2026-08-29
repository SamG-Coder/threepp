# 08 — Sakae-dori road cross-section (metres)

Spec only. Do **not** edit sample source from this note. Parent (or a later pass) drops the boxes into `src/roads.mjs` / `addStreetFurniture` and shrinks the three `GROUND` planes.

Time lock: Saturday 29 November 1986, 15:20, overcast winter, **wet asphalt from earlier drizzle**, no snow. Japan LHT. `+X` east, `+Z` south, `Y` up. Sakae-dori runs east–west. Harbor south, Suzume-zaka north.

---

## 0. What is wrong now

`map.mjs` still paints a highway, not a 商店街:

| patch | AABB (m) | y | colour |
|---|---|---|---|
| `GROUND.asphalt` | x −48…48, **z −8…12** | 0 | `0x3a3a3c` |
| `GROUND.sidewalkN` | x −40…40, **z −12…−6** | **0.08** | `0xb7b1a4` |
| `GROUND.sidewalkS` | x −40…40, **z 6…10** | **0.08** | `0xb7b1a4` |

Yellow dashes in `addStreetFurniture`: `BoxGeometry(1.85, 0.03, 0.14)` at **`z = 2`**, colour `0xc9b56a`, step 4.4 m.

`roads.mjs` is called from `createStudio` but is a first sketch that does not make a street:

- Curbs `BoxGeometry(80, 0.18, 0.28)` at **`z = ±6.15`**, y = 0.09, `0xa8a398` — sitting on the sidewalk/asphalt overlap, not at a lane edge.
- White edges at `z = −0.5 / 4.5`, 8 cm wide, full 80 m through the zebra.
- Crosswalks at **`x = 0` and `x = 18`** (this spec uses **`x = 16`**), stripes `BoxGeometry(0.4, 0.04, 3.2)` parked on the centreline at `z = 2` — they do not run curb-to-curb.
- Manholes are `CylinderGeometry` on `z = 2` (including one **on** the east zebra at `x = 16`). User wants **tiny boxes**.
- No gutter, no 停車帯, no stop line, no drain.

`TOWN.md` district: **sakae** origin `(0, 0)` size **80 × 18**. 80 m is `x = −40…+40`. 18 m is the district envelope (facade line + a few metres of shop body each side), **not** a 20 m carriageway.

Screenshot `sakae-north.png` (camera `(0, 1.62, 1.5)`, yaw `π`) is the symptom: shops stand in a vacant grey plane, no granite lip, no zebra, dashes behind the camera.

---

## 1. Flag — flat `PlaneGeometry` sidewalks ignore the hill

`addGroundPatch` builds a **horizontal** `PlaneGeometry` at constant `spec.y`. It cannot follow `groundHeight`.

Current hill (`map.mjs`):

```
if (z < -12) {
  t = clamp((-z - 12) / 34, 0, 1)
  y = t * 8                          // linear, 8 m rise over 34 m
  if (x ∈ [-24, -16]) y -= 0.4 * t  // stair channel dip
}
```

| z | t | y (open slope) | y (stair channel) |
|---|---|---|---|
| −12.0 | 0 | **0** | 0 |
| −12.6 | 0.018 | 0.14 | 0.13 |
| −13.5 | 0.044 | 0.35 | 0.33 |
| −20.0 | 0.235 | 1.88 | 1.79 |

`sidewalkN.minZ = −12` already kisses the toe. If that plane is extended north, it **slices the rising height-field** (or floats as a disc at y = 0.08). North-row backs (`z ≈ −12.2…−13.5`, arcade worst) already nick the ramp by 0.1–0.35 m.

**Stairs already exist** in `addStreetFurniture`: 12 boxes, `x = −20`, `z = −12.4 − i × 1.05`, `BoxGeometry(6.5, 0.24, 1.12)`, `y = groundHeight(−20, z) + 0.12`. Width 6.5 m → `x = −23.25…−16.75`. They **are** the connection from Suzume-zaka to Sakae. Do not fake a ramped sidewalk with a flat plane.

Rules for this spec:

1. Every Sakae slab has **`minZ ≥ −12.0`**.
2. **No `PlaneGeometry`** for asphalt, sidewalk, curb, gutter, paint. Use `BoxGeometry` so the curb has a face.
3. Do not “fix” the hill by stretching `sidewalkN`. Optional later: a tessellated sidewalk on the slope — out of scope. Use the stairs.
4. Height-field stays; all road `y_top ≥ 0.005` so slabs sit **on** it (today asphalt `y = 0` z-fights the field — the muddy grey band in `sakae-north.png`).

Walk code still uses `groundHeight` only (sidewalks are visual, same as now). Optional follow-up: add 0.15 m in `groundHeight` on the walk bands. Not required to ship the street.

---

## 2. Cross-section (north shop wall → south shop wall)

LHT: eastbound on the **north** half, westbound on the **south** half. Design speed ~30 km/h, 道路構造令 第4種第3級相当. One 停車帯 on the south (kei-van already lives there).

```
 north (Suzume-zaka / hill toe z=-12)                          south (Yokobori / harbor)
 z
-12.00  |==== N shop terrace / lots ============================|  y=0.15
-6.40   | N 建築線 (shop wall)     poles at -6.2
        |---- N sidewalk  3.00 m --------------------------------|  y=0.15   #B7B1A4
-3.40   | N curb 0.18 × 0.15                                     |  y=0.15   #A39E94
-3.22   | N L-gutter 0.40                                        |  y=0.005  #4A4C50
-2.82   |==== N lane eastbound  2.82 m ==========================|  y=0.03   #2E3033
 0.00   |  - - - yellow 中央線 0.15 - - -
        |==== S lane westbound  2.75 m ==========================|  y=0.03   #2E3033
 2.75   | 停車帯 / parking  1.55 m     van at z=3.4               |  y=0.03   #35363A
 4.30   | S L-gutter 0.25                                        |  y=0.005
 4.55   | S curb 0.18 × 0.15                                     |  y=0.15
 4.73   |---- S sidewalk  3.77 m --------------------------------|  y=0.15
 8.50   | S 建築線 (shop wall)     catalog centres at 8.6
        |==== S shop terrace ====================================|  y=0.15
12.00   | Yokobori alley / back lots   (do not cover GROUND.alley)
```

Building-line to building-line: **`8.50 − (−6.40) = 14.90 m`**. `TOWN.md` 18 m is this plus ~1.5 m of shop body north of −6.40 and south of 8.50.

Carriageway (N gutter lip → S curb lip): **`4.55 − (−3.22) = 7.77 m`**.

### Band table (authoritative)

| id | z min | z max | width | y_top | y_bottom | colour |
|---|---|---|---|---|---|---|
| n-terrace | −12.00 | −6.40 | 5.60 | 0.15 | −0.01 | `#AFA89A` |
| **n-wall** | **−6.40** | | | | | north shop wall |
| n-walk | −6.40 | −3.40 | 3.00 | 0.15 | −0.01 | `#B7B1A4` |
| n-curb | −3.40 | −3.22 | 0.18 | 0.15 | 0.00 | `#A39E94` |
| n-gutter | −3.22 | −2.82 | 0.40 | 0.005 | −0.05 | `#4A4C50` |
| n-lane | −2.82 | 0.00 | 2.82 | 0.03 | −0.05 | `#2E3033` |
| **center** | **0.00** | | 0.15 | 0.05 | 0.03 | `#C9B56A` |
| s-lane | 0.00 | 2.75 | 2.75 | 0.03 | −0.05 | `#2E3033` |
| s-park | 2.75 | 4.30 | 1.55 | 0.03 | −0.05 | `#35363A` |
| s-gutter | 4.30 | 4.55 | 0.25 | 0.005 | −0.05 | `#4A4C50` |
| s-curb | 4.55 | 4.73 | 0.18 | 0.15 | 0.00 | `#A39E94` |
| s-walk | 4.73 | 8.50 | 3.77 | 0.15 | −0.01 | `#B7B1A4` |
| **s-wall** | **8.50** | | | | | south shop wall |
| s-terrace W | 8.50 | 12.00 | 3.50 | 0.15 | −0.01 | `#AFA89A` |
| s-terrace E | 8.50 | 10.00 | 1.50 | 0.15 | −0.01 | `#AFA89A` |

`s-terrace E` (`x ≥ 18`) stops at `z = 10` so spec 10 can pull `GROUND.alley.minZ` to 10. West of x = 18 the terrace runs to z = 12 (back of Midori).

X extents:

| band | minX | maxX | length |
|---|---|---|---|
| n-lane, s-lane, s-park, both gutters | **−48** | **+48** | 96 |  Route 16 T-junction, match today’s asphalt
| sidewalks, curbs, terraces | **−40** | **+40** | 80 |  `TOWN.md` 80 m
| paint, manholes, drains, zebra | on those slabs | | |

---

## 3. Materials (hex)

`MeshStandardMaterial`. Sidewalks dry-ish concrete; asphalt still wet from the morning drizzle.

| key | hex | three | roughness | metalness | use |
|---|---|---|---|---|---|
| `asphalt` | `#2E3033` | `0x2e3033` | **0.42** | 0.08 | travel lanes (darker/wetter than today’s `0x3a3a3c`) |
| `asphaltPark` | `#35363A` | `0x35363a` | 0.50 | 0.06 | 停車帯, slightly faded |
| `gutter` | `#4A4C50` | `0x4a4c50` | 0.55 | 0.04 | L-gutter, wet concrete |
| `curb` | `#A39E94` | `0xa39e94` | 0.92 | 0 | 歩車道境界ブロック / granite. Replaces `0xa8a398` |
| `sidewalk` | `#B7B1A4` | `0xb7b1a4` | 0.95 | 0 | **keep** current tan |
| `terrace` | `#AFA89A` | `0xafa89a` | 0.96 | 0 | under shop lots, dirtier |
| `dash` | `#C9B56A` | `0xc9b56a` | 0.70 | 0 | **keep** dirty chrome yellow |
| `zebra` | `#D9D4C6` | `0xd9d4c6` | 0.68 | 0 | off-white, not `0xffffff` |
| `edge` | `#D9D4C6` | `0xd9d4c6` | 0.68 | 0 | 外側線 / stall ticks / stop line |
| `iron` | `#3E4044` | `0x3e4044` | 0.55 | 0.35 | manhole lids |
| `grate` | `#2A2C2E` | `0x2a2c2e` | 0.50 | 0.30 | drain boxes |
| `tactile` | `#C9A84C` | `0xc9a84c` | 0.85 | 0 | 点字ブロック at the two crossings only |

Slabs: `receiveShadow = true`, `castShadow = false`. Curbs and manholes may cast. `name` every mesh as in the instance list.

---

## 4. Furniture that already sits on this section

Do not move these in the road pass. The bands were chosen so they land on sidewalk / parking.

North walk (`z = −6.40…−3.40`):

| what | (x, z) | why it fits |
|---|---|---|
| poles | x = −22, 8, 28 at **z = −6.2** | 0.20 m south of n-wall, against the shop |
| vending | (−6.2, −5.4), (18.5, −5.4), (10.2, −5.5) | mid-walk |
| Hiro | (−9.2, −6.6) | doorway, 0.20 m into terrace |

South walk (`z = 4.73…8.50`):

| what | (x, z) | why it fits |
|---|---|---|
| poles | x = −36, −22, −4, **16**, 36 at **z = 5.6** | 0.87 m south of s-curb |
| phone booth | (2.4, 6.2) | mid-walk, just east of x = 0 zebra |
| vending | (−31, 6.0), (12.4, 6.8) | mid-walk |
| Honda Cub | (−12.5, 6.5) | mid-walk |

停車帯 (`z = 2.75…4.30`):

| Suzuki Carry | (5.2, 3.4), yaw −0.18, 1.4 × 3.2 m | Z span ≈ 2.70…4.10. 5 cm into the westbound lane because it is crooked — leave it. |

Pole at **`(16, 5.6)`** is the south corner of the east zebra. Keep it.

---

## 5. Shop-wall clash (do not move shops in this spec)

Catalog `z` is the mesh centre. Yaw 0 → south face `z + realDepth/2`. Yaw `π` → north face `z − realDepth/2`. (`realWorldScale` still ignores `realDepth` and scales XZ from `realWidth`; faces below are the **authored plan**, same as spec 01 / 21.)

North row, all `z = −8.5`, yaw 0, target south face on **n-walk**, curb at **−3.40**:

| id | x | realDepth | south face | vs this road |
|---|---|---|---|---|
| tobacco-shop | −26 | 7.2 | **−4.90** | on n-walk, 1.50 m from curb |
| soba-shop | −17 | 8.2 | **−4.40** | on n-walk, 1.00 m from curb |
| greengrocer | −9 | 7.4 | **−4.80** | on n-walk |
| pharmacy | 0 | 7.6 | **−4.70** | on n-walk, **faces the x = 0 zebra** |
| you-arcade | 10 | 10 | **−3.50** | **0.10 m north of curb** — overhang, not in the lane |
| cassette-shop | 21 | 8.0 | **−4.50** | on n-walk |

South row, `z = 8.6`, yaw `π`, s-curb `4.55…4.73`:

| flower-shop | −10 | 7.8 | north face **4.70** | on the curb / walk joint |
| barber-shop | 6 | 7.4 | north face **4.90** | 0.17 m onto s-walk |

Arcade is the leftover offender from spec 01 (was 2.5 m into the old asphalt). This curb is placed **just south of that face** so the arcade stands on the sidewalk, not in n-lane. Moving `you-arcade` north (or cutting `realDepth` toward 7.4) is a **later** catalog job, not this road.

Stair channel `x = −23.25…−16.75` overlaps Nishiya’s west third (`x = −20.2…−13.8`). Keep the terrace slab continuous; people step off the stairs onto the shop’s side passage. Do not delete the stairs.

---

## 6. BoxGeometry instances

Three.js `BoxGeometry(sx, sy, sz)` is **X, Y, Z**. `position` is the **centre**.

`y_center = (y_top + y_bottom) / 2`.

### 6.1 Continuous slabs (11)

Replace `GROUND.asphalt` / `sidewalkN` / `sidewalkS` in the Sakae corridor with these. If the planes stay, they z-fight — shrink or delete them (section 8).

| name | sx, sy, sz | position (x, y, z) | material |
|---|---|---|---|
| `sakae-n-terrace` | 80, 0.16, 5.60 | 0, 0.07, **−9.20** | terrace |
| `sakae-n-walk` | 80, 0.16, 3.00 | 0, 0.07, **−4.90** | sidewalk |
| `sakae-n-gutter` | 96, 0.055, 0.40 | 0, −0.0225, **−3.02** | gutter |
| `sakae-n-lane` | 96, 0.08, 2.82 | 0, −0.01, **−1.41** | asphalt |
| `sakae-s-lane` | 96, 0.08, 2.75 | 0, −0.01, **1.375** | asphalt |
| `sakae-s-park` | 96, 0.08, 1.55 | 0, −0.01, **3.525** | asphaltPark |
| `sakae-s-gutter` | 96, 0.055, 0.25 | 0, −0.0225, **4.425** | gutter |
| `sakae-s-walk` | 80, 0.16, 3.77 | 0, 0.07, **6.615** | sidewalk |
| `sakae-s-terrace-w` | 58, 0.16, 3.50 | **−11**, 0.07, **10.25** | terrace |
| `sakae-s-terrace-e` | 22, 0.16, 1.50 | **29**, 0.07, **9.25** | terrace |
| `sakae-stair-landing` | 6.50, 0.16, 0.80 | **−20**, 0.07, **−12.20** | curb (stone) |

`sakae-s-terrace-w`: x −40…18, z 8.50…12.00.
`sakae-s-terrace-e`: x 18…40, z 8.50…10.00 (Yokobori mouth).
Landing stitches sidewalk y = 0.15 to the first stair at `z = −12.4`.

### 6.2 Curbs — split at both crosswalks (10)

Long granite stays 0.15 m high. In the 4.05 m zebra X-range the curb **drops to 40 mm** (1986 段差切下げ, not modern flush).

N curb centre z = **−3.31**. S curb centre z = **4.64**.

| name | sx, sy, sz | position | material |
|---|---|---|---|
| `sakae-n-curb-a` | 37.975, 0.15, 0.18 | −21.0125, 0.075, −3.31 | curb |
| `sakae-n-curb-cut-0` | 4.05, 0.04, 0.18 | **0**, 0.02, −3.31 | curb |
| `sakae-n-curb-b` | 11.95, 0.15, 0.18 | 8.00, 0.075, −3.31 | curb |
| `sakae-n-curb-cut-16` | 4.05, 0.04, 0.18 | **16**, 0.02, −3.31 | curb |
| `sakae-n-curb-c` | 21.975, 0.15, 0.18 | 29.0125, 0.075, −3.31 | curb |
| `sakae-s-curb-a` | 37.975, 0.15, 0.18 | −21.0125, 0.075, 4.64 | curb |
| `sakae-s-curb-cut-0` | 4.05, 0.04, 0.18 | **0**, 0.02, 4.64 | curb |
| `sakae-s-curb-b` | 11.95, 0.15, 0.18 | 8.00, 0.075, 4.64 | curb |
| `sakae-s-curb-cut-16` | 4.05, 0.04, 0.18 | **16**, 0.02, 4.64 | curb |
| `sakae-s-curb-c` | 21.975, 0.15, 0.18 | 29.0125, 0.075, 4.64 | curb |

Splits: `x = −40…−2.025`, `−2.025…2.025`, `2.025…13.975`, `13.975…18.025`, `18.025…40`.

### 6.3 White 外側線 (6)

0.15 m wide, 0.02 thick, y = 0.04. **Gap both zebras.**

N edge at z = **−2.745** (strip z −2.82…−2.67, lip of n-lane):

| name | sx, sy, sz | position |
|---|---|---|
| `sakae-edge-n-a` | 37.80, 0.02, 0.15 | −21.10, 0.04, −2.745 |
| `sakae-edge-n-b` | 11.60, 0.02, 0.15 | 8.00, 0.04, −2.745 |
| `sakae-edge-n-c` | 21.80, 0.02, 0.15 | 29.10, 0.04, −2.745 |

S lane / parking edge at z = **2.825** (strip z 2.75…2.90):

| `sakae-edge-s-a` | 37.80, 0.02, 0.15 | −21.10, 0.04, 2.825 |
| `sakae-edge-s-b` | 11.60, 0.02, 0.15 | 8.00, 0.04, 2.825 |
| `sakae-edge-s-c` | 21.80, 0.02, 0.15 | 29.10, 0.04, 2.825 |

### 6.4 Yellow centre dashes (11) — **z = 0, not z = 2**

**Delete** the `addStreetFurniture` loop at `z = 2`.

Dash 3.00 m, gap 3.00 m, width 0.15 m, skip x ≈ 0 and x ≈ 16.

```
size  = (3.00, 0.02, 0.15)
y     = 0.04
z     = 0.00
x     ∈ {−36, −30, −24, −18, −12, −6, 6, 12, 24, 30, 36}
name  = sakae-dash-${x}
material dash 0xc9b56a
```

| name | position |
|---|---|
| `sakae-dash--36` | −36, 0.04, 0 |
| `sakae-dash--30` | −30, 0.04, 0 |
| `sakae-dash--24` | −24, 0.04, 0 |
| `sakae-dash--18` | −18, 0.04, 0 |
| `sakae-dash--12` | −12, 0.04, 0 |
| `sakae-dash--6` | −6, 0.04, 0 |
| `sakae-dash-6` | 6, 0.04, 0 |
| `sakae-dash-12` | 12, 0.04, 0 |
| `sakae-dash-24` | 24, 0.04, 0 |
| `sakae-dash-30` | 30, 0.04, 0 |
| `sakae-dash-36` | 36, 0.04, 0 |

### 6.5 Crosswalks at **x = 0** and **x = 16** (10 stripes + 4 stop lines)

JIS-ish zebra: stripe 0.45 m, gap 0.45 m, **5 stripes**, crossing width 4.05 m.
Stripes run **along Z**, curb-to-curb: z **−3.22…4.55** (length **7.77 m**), centre z = **0.665**.

```
size = (0.45, 0.02, 7.77)
y    = 0.04
z    = 0.665
x    = originX + offset,  offset ∈ {−1.80, −0.90, 0, 0.90, 1.80}
```

**x = 0** (pharmacy front, civic axis toward harbor-gate):

| name | position |
|---|---|
| `sakae-zebra-0-0` | −1.80, 0.04, 0.665 |
| `sakae-zebra-0-1` | −0.90, 0.04, 0.665 |
| `sakae-zebra-0-2` | 0.00, 0.04, 0.665 |
| `sakae-zebra-0-3` | 0.90, 0.04, 0.665 |
| `sakae-zebra-0-4` | 1.80, 0.04, 0.665 |

**x = 16** (arcade–records gap, Yokobori mouth, pole at 16, 5.6):

| `sakae-zebra-16-0` | 14.20, 0.04, 0.665 |
| `sakae-zebra-16-1` | 15.10, 0.04, 0.665 |
| `sakae-zebra-16-2` | 16.00, 0.04, 0.665 |
| `sakae-zebra-16-3` | 16.90, 0.04, 0.665 |
| `sakae-zebra-16-4` | 17.80, 0.04, 0.665 |

Stop lines 0.45 m deep in X, 0.50 m before the zebra, white. Eastbound in n-lane, westbound in s-lane.

| name | sx, sy, sz | position | covers |
|---|---|---|---|
| `sakae-stop-0-eb` | 0.45, 0.02, 2.74 | **−2.40**, 0.04, −1.45 | n-lane, west of x = 0 |
| `sakae-stop-0-wb` | 0.45, 0.02, 2.67 | **2.40**, 0.04, 1.335 | s-lane, east of x = 0 |
| `sakae-stop-16-eb` | 0.45, 0.02, 2.74 | **13.60**, 0.04, −1.45 | n-lane, west of x = 16 |
| `sakae-stop-16-wb` | 0.45, 0.02, 2.67 | **18.40**, 0.04, 1.335 | s-lane, east of x = 16 |

`roads.mjs` today uses `CROSSWALK_X = [0, 18]` and stripe depth 3.2 at `z = 2`. Throw that away.

### 6.6 点字ブロック (4, optional but cheap)

0.30 m warning strip on the sidewalk, against each curb cut.

| name | sx, sy, sz | position |
|---|---|---|
| `sakae-tactile-n-0` | 4.05, 0.02, 0.30 | 0, 0.16, −3.55 |
| `sakae-tactile-s-0` | 4.05, 0.02, 0.30 | 0, 0.16, 4.88 |
| `sakae-tactile-n-16` | 4.05, 0.02, 0.30 | 16, 0.16, −3.55 |
| `sakae-tactile-s-16` | 4.05, 0.02, 0.30 | 16, 0.16, 4.88 |

### 6.7 Manhole boxes (6) + sidewalk valves (2)

**Boxes, not cylinders.** 0.62 m lids on asphalt, 0.32 m valves on sidewalk. Proud of the surface. **None on a zebra.**

| name | sx, sy, sz | position | material |
|---|---|---|---|
| `sakae-manhole-0` | 0.62, 0.04, 0.62 | **−24**, 0.03, **−1.40** | iron (n-lane) |
| `sakae-manhole-1` | 0.62, 0.04, 0.62 | **−8**, 0.03, **−1.40** | iron (n-lane) |
| `sakae-manhole-2` | 0.62, 0.04, 0.62 | **8**, 0.03, **−1.40** | iron (n-lane, between zebras) |
| `sakae-manhole-3` | 0.62, 0.04, 0.62 | **−32**, 0.03, **1.40** | iron (s-lane) |
| `sakae-manhole-4` | 0.62, 0.04, 0.62 | **4**, 0.03, **1.40** | iron (s-lane, east of x = 0) |
| `sakae-manhole-5` | 0.62, 0.04, 0.62 | **28**, 0.03, **3.50** | iron (停車帯) |
| `sakae-valve-n` | 0.32, 0.03, 0.32 | **−10.5**, 0.165, **−5.00** | iron (n-walk) |
| `sakae-valve-s` | 0.32, 0.03, 0.32 | **9.5**, 0.165, **6.90** | iron (s-walk) |

Drop today’s list `(-20,2), (-8,2), (4,2), (16,2), (28,2), (8,8)` — `(16, 2)` sat in the east crossing.

### 6.8 Drain boxes (20)

Grey グレーチング in both gutters, every 8 m. 2 m clear of zebra edges.

```
size = (0.50, 0.05, 0.32)
y    = -0.02          // in the gutter, top ≈ 0.005
x    ∈ {−36, −28, −20, −12, −4, 4, 12, 20, 28, 36}
```

| name | position |
|---|---|
| `sakae-drain-n-${x}` | (x, −0.02, **−3.02**) |
| `sakae-drain-s-${x}` | (x, −0.02, **4.425**) |

Twenty meshes. Material `grate`.

### 6.9 Parallel-parking ticks (8, optional)

White 0.12 × 0.02 × 1.40 at stall ends, z = 3.525, skip zebra X.

Stalls (along-street, ~5.4 m, kei-length + gap):

| stall | x0 | x1 | occupant |
|---|---|---|---|
| P1 | −20.0 | −14.6 | empty |
| P2 | −8.0 | −2.6 | empty (west of x = 0 zebra) |
| P3 | 2.6 | 8.0 | **kei-van (5.2, 3.4)** |
| P4 | 18.6 | 24.0 | empty (east of x = 16 zebra) |

Ticks at each x0 and x1: `BoxGeometry(0.12, 0.02, 1.40)`, pos `(x, 0.04, 3.525)`, name `sakae-stall-tick-${x}`.

---

## 7. Copy-paste kernel (`addRoads` Sakae section)

Keep `yokobori-cobble` and `quay-bollard-*` from the current file. Replace everything between the curb loop and the alley plane with:

```js
function box(THREE, sx, sy, sz, mat, name, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.name = name;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  return m;
}

export function addSakaeCarriageway(root, THREE) {
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x2e3033, roughness: 0.42, metalness: 0.08 });
  const park = new THREE.MeshStandardMaterial({ color: 0x35363a, roughness: 0.50, metalness: 0.06 });
  const gutter = new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.55, metalness: 0.04 });
  const curb = new THREE.MeshStandardMaterial({ color: 0xa39e94, roughness: 0.92, metalness: 0 });
  const walk = new THREE.MeshStandardMaterial({ color: 0xb7b1a4, roughness: 0.95, metalness: 0 });
  const terrace = new THREE.MeshStandardMaterial({ color: 0xafa89a, roughness: 0.96, metalness: 0 });
  const dash = new THREE.MeshStandardMaterial({ color: 0xc9b56a, roughness: 0.70, metalness: 0 });
  const paint = new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.68, metalness: 0 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3e4044, roughness: 0.55, metalness: 0.35 });
  const grate = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.50, metalness: 0.30 });
  const tactile = new THREE.MeshStandardMaterial({ color: 0xc9a84c, roughness: 0.85, metalness: 0 });

  const add = (...a) => root.add(box(THREE, ...a));

  add(80, 0.16, 5.60, terrace, "sakae-n-terrace", 0, 0.07, -9.20);
  add(80, 0.16, 3.00, walk, "sakae-n-walk", 0, 0.07, -4.90);
  add(96, 0.055, 0.40, gutter, "sakae-n-gutter", 0, -0.0225, -3.02);
  add(96, 0.08, 2.82, asphalt, "sakae-n-lane", 0, -0.01, -1.41);
  add(96, 0.08, 2.75, asphalt, "sakae-s-lane", 0, -0.01, 1.375);
  add(96, 0.08, 1.55, park, "sakae-s-park", 0, -0.01, 3.525);
  add(96, 0.055, 0.25, gutter, "sakae-s-gutter", 0, -0.0225, 4.425);
  add(80, 0.16, 3.77, walk, "sakae-s-walk", 0, 0.07, 6.615);
  add(58, 0.16, 3.50, terrace, "sakae-s-terrace-w", -11, 0.07, 10.25);
  add(22, 0.16, 1.50, terrace, "sakae-s-terrace-e", 29, 0.07, 9.25);
  add(6.5, 0.16, 0.80, curb, "sakae-stair-landing", -20, 0.07, -12.20);

  const curbLong = [
    ["a", 37.975, -21.0125],
    ["b", 11.95, 8],
    ["c", 21.975, 29.0125],
  ];
  for (const [id, sx, x] of curbLong) {
    add(sx, 0.15, 0.18, curb, `sakae-n-curb-${id}`, x, 0.075, -3.31);
    add(sx, 0.15, 0.18, curb, `sakae-s-curb-${id}`, x, 0.075, 4.64);
  }
  for (const x of [0, 16]) {
    add(4.05, 0.04, 0.18, curb, `sakae-n-curb-cut-${x}`, x, 0.02, -3.31);
    add(4.05, 0.04, 0.18, curb, `sakae-s-curb-cut-${x}`, x, 0.02, 4.64);
  }

  const edgeX = [[37.8, -21.1], [11.6, 8], [21.8, 29.1]];
  edgeX.forEach(([sx, x], i) => {
    add(sx, 0.02, 0.15, paint, `sakae-edge-n-${i}`, x, 0.04, -2.745);
    add(sx, 0.02, 0.15, paint, `sakae-edge-s-${i}`, x, 0.04, 2.825);
  });

  for (const x of [-36, -30, -24, -18, -12, -6, 6, 12, 24, 30, 36]) {
    add(3.00, 0.02, 0.15, dash, `sakae-dash-${x}`, x, 0.04, 0);
  }

  for (const originX of [0, 16]) {
    for (let i = 0; i < 5; i++) {
      const x = originX + (i - 2) * 0.90;
      add(0.45, 0.02, 7.77, paint, `sakae-zebra-${originX}-${i}`, x, 0.04, 0.665);
    }
    add(4.05, 0.02, 0.30, tactile, `sakae-tactile-n-${originX}`, originX, 0.16, -3.55);
    add(4.05, 0.02, 0.30, tactile, `sakae-tactile-s-${originX}`, originX, 0.16, 4.88);
  }
  add(0.45, 0.02, 2.74, paint, "sakae-stop-0-eb", -2.40, 0.04, -1.45);
  add(0.45, 0.02, 2.67, paint, "sakae-stop-0-wb", 2.40, 0.04, 1.335);
  add(0.45, 0.02, 2.74, paint, "sakae-stop-16-eb", 13.60, 0.04, -1.45);
  add(0.45, 0.02, 2.67, paint, "sakae-stop-16-wb", 18.40, 0.04, 1.335);

  const holes = [
    [-24, -1.40], [-8, -1.40], [8, -1.40],
    [-32, 1.40], [4, 1.40], [28, 3.50],
  ];
  holes.forEach(([x, z], i) => add(0.62, 0.04, 0.62, iron, `sakae-manhole-${i}`, x, 0.03, z));
  add(0.32, 0.03, 0.32, iron, "sakae-valve-n", -10.5, 0.165, -5.00);
  add(0.32, 0.03, 0.32, iron, "sakae-valve-s", 9.5, 0.165, 6.90);

  for (const x of [-36, -28, -20, -12, -4, 4, 12, 20, 28, 36]) {
    add(0.50, 0.05, 0.32, grate, `sakae-drain-n-${x}`, x, -0.02, -3.02);
    add(0.50, 0.05, 0.32, grate, `sakae-drain-s-${x}`, x, -0.02, 4.425);
  }
}
```

Instance count: 11 slabs + 10 curbs + 6 edges + 11 dashes + 10 stripes + 4 stops + 4 tactile + 8 lids + 20 drains = **84** (+ 8 stall ticks if wanted). All `BoxGeometry`.

---

## 8. `GROUND` / `addStreetFurniture` / `roads.mjs` edits (when coding)

1. **Delete** the yellow-dash loop in `addStreetFurniture` (`z = 2`, step 4.4). Keep the 12 stairs and the quay wall (quay wall is spec 31).
2. **Replace** Sakae curbs, edges, zebras, manholes in `addRoads`. Keep yokobori cobble + quay bollards.
3. **Do not** leave the old 80 × 0.18 × 0.28 curbs at `z = ±6.15` — they would sit in the new sidewalks.
4. Shrink or remove the three planes so they do not z-fight the boxes:

```
// if any planes remain as underlay (not preferred):
asphalt:   { minX: -48, maxX: 48, minZ: -2.82, maxZ: 4.30, y: 0.00, color: 0x2e3033 }
sidewalkN: { minX: -40, maxX: 40, minZ: -6.40, maxZ: -3.40, y: 0.15, color: 0xb7b1a4 }
sidewalkS: { minX: -40, maxX: 40, minZ:  4.73, maxZ:  8.50, y: 0.15, color: 0xb7b1a4 }
```

Preferred: **delete** `asphalt`, `sidewalkN`, `sidewalkS` from `GROUND` and let the boxes own the street. Keep a west remnant for spec 27 if Route 16 is not in yet:

```
asphaltWest: { minX: -48, maxX: -40, minZ: -8, maxZ: 12, y: 0, color: 0x2e3033 }
```

5. Height-field vertex colour: for `z < −12` **and** `|x| < 40` behind the north row, paint **grey** `(0.24, 0.24, 0.25)` not grass `(0.32, 0.38, 0.22)`. The olive rectangle in `sakae-north.png` is that grass showing through the 4.9 m lot (now filled by pharmacy, but the backs still see turf). Park grass stays `x < −12`. Out of scope if you only ship the boxes; listed because it reads as “the road is broken”.

6. Scout: `ROAD_LANDMARKS` in `roads.mjs` today look at `z = 2`. After this pass:

```
"sakae-crosswalk":      { x: 0,  z: 0.7, yaw: Math.PI, pitch: -0.18 }
"sakae-crosswalk-east": { x: 16, z: 0.7, yaw: Math.PI, pitch: -0.18 }
```

---

## 9. What this is not

- Not a shop move. Arcade still kisses the north curb (0.10 m). Spec 01 still wants `you-arcade` north or shallower.
- Not Route 16 (spec 27). Carriageway already extends to x = −48 so the T has asphalt.
- Not Yokobori paving (spec 10). `s-terrace-e` stops at z = 10, x ≥ 18.
- Not wet-asphalt *textures* — colour + lower roughness only.
- Not `groundHeight` sidewalk boost. Player still walks at y = 0 + eye.
- Not `PlaneGeometry` sidewalks on the hill. Stairs at `x = −20` already exist.

---

## 10. Sanity numbers

| quantity | metres |
|---|---|
| Street length (sidewalks) | 80 (x −40…40) |
| Carriageway length | 96 (x −48…48) |
| N wall → S wall | 14.90 |
| N sidewalk | 3.00 |
| Curb W × H | 0.18 × 0.15 |
| N gutter / S gutter | 0.40 / 0.25 |
| N lane / S lane | 2.82 / 2.75 |
| 停車帯 | 1.55 |
| S sidewalk | 3.77 |
| Centreline | **z = 0** (was z = 2) |
| Zebras | **x = 0 and x = 16** (was 0 and 18) |
| Zebra span Z | 7.77 (z −3.22…4.55) |
| Hill toe | z = −12; no slab north of this |
| Stairs | x = −20, already in `addStreetFurniture` |
