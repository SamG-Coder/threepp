# 40 — v5 shop QA (sakae-v5 / soba-v5 vs yaw-000 stills)

Visual QA only. Do **not** edit sample source from this note.

Shots (`command.json` `t13`):

| file | landmark | camera |
|---|---|---|
| `artifacts/harbor-town-1986/sakae-v5.png` | `sakae` | `x: 0, z: 11, yaw: π, pitch: 0.04` — south sidewalk, looking **north** at the north row |
| `artifacts/harbor-town-1986/soba-v5.png` | `soba` | `x: -17, z: 8, yaw: π, pitch: 0.06` — south sidewalk, looking **north** at Nishiya |

North-row shops in frame, all catalog `z = -8.5`, `yaw = 0` (fronts face +Z / south):

| id | label | x | realWidth | realDepth | x-span | south face if depth honoured |
|---|---|---:|---:|---:|---|---:|
| `tobacco-shop` | Kamimura tobacco | −26 | 5.2 | 5.6 | −28.6 … −23.4 | **−5.7** |
| `soba-shop` | Nishiya soba | −17 | 6.4 | 8.2 | −20.2 … −13.8 | **−4.4** |
| `greengrocer` | Yaoya | −9 | 5.4 | 6.2 | −11.7 … −6.3 | **−5.4** |
| `pharmacy` | Minato-machi pharmacy | 0 | 6.6 | 7.6 | −3.3 … 3.3 | **−4.7** |
| `you-arcade` | Starlight Arcade | 8.4 | 8.0 | 10 | 4.4 … 12.4 | **−3.5** |

`GROUND.sidewalkN` is `z = −12 … −6`. Asphalt / travel lane starts at `z = −6`. `realWorldScale` now applies `realDepth` on Z (`real-scale.mjs`), so the three deep shops mathematically overhang the curb.

Pipeline on this run (`main.mjs` `reconstructSubject`): `kind` forced `rectangle`, `photoIterations: 0`, `resolution: 48`, `silhouetteSize: 96`. Holes are **silhouette intersection + Laplacian**, not photo-carve.

Stills that already landed (do **not** put back on the reshoot list):

- `you-arcade/yaw-000.png` — now a true front (agent 04’s ¾ wreck is gone).
- `soba-shop/yaw-090.png` — now a true east elevation (agent 25 #7 is gone).
- `tobacco-shop/yaw-090.png` — now a true east gable (agent 25 #6 is gone).

---

## Scorecard

Pass = the reconstructed hull in these two shots would pass as that shop at street distance. Fail = reshoot or reshape before another beauty pass.

| shop | shape (box / potato / holes) | painted front vs yaw-000 | footprint | **shop** |
|---|---|---|---|---|
| `greengrocer` | **FAIL** — potato roof | **FAIL** — noren ok, specials board dead | **PASS** — sidewalk | **FAIL** |
| `pharmacy` | **FAIL** — holes | **FAIL** — 港町薬局 punched | **PASS*** — curb, depth overhang | **FAIL** |
| `you-arcade` | **PASS** — box | **PASS** — fascia readable | **PASS*** — curb, deepest overhang | **PASS** |
| `tobacco-shop` | **FAIL** — potato roof | **PASS** — たばこ TOBACCO | **PASS** — sidewalk | **FAIL** |
| `soba-shop` | **FAIL** — melted gable | **PASS** — ラーメン | **PASS*** — curb, depth overhang | **FAIL** |

\*Visual: none of the five sit on the zebra or the yellow dashes. Catalog `realDepth` still pushes arcade / soba / pharmacy south faces into the first 1–2.5 m of asphalt.

Arcade is the only shop-level pass. The other four fail on hull, not on planting.

---

## Per shop

### 1. `greengrocer` / Yaoya — **FAIL**

Seen in **both** shots (sakae-v5 left of pharmacy; soba-v5 right).

Still `greengrocer/yaw-000.png`: two-storey pale-blue clapboard, kirizuma with eaves to the street, 八百果 noren, red 青果 lantern, crate table (cabbage / mikan / daikon), readable 本日のおすすめ board (白菜 98円, 大根 50円, みかん 250円/箱, 昭和61年11月29日), 住居 plaque, lace curtains, TV antenna. `yaw-090` / `yaw-270` are true gables; `yaw-180` is a true back. Cardinals agree. This is **not** a stills wreck.

| test | verdict | what the hull does |
|---|---|---|
| 3D shape | **FAIL** | Body is still a box. Roof is a melted cap — no tiles, no ridge, no eaves. 2F is a yellow smear; east gable is a stepped sponge. Light potato, not holes. |
| Painted front | **FAIL** | Blue 八百果 noren is readable. Produce crates survive. The specials board is an orange-white blob; 住居 is gone; lantern is gone. Does not match yaw-000. |
| Footprint | **PASS** | On sidewalkN. Unique enamel vending sits on the sidewalk in front of the east bay, not in the lane. South face ~0.6 m past the curb on paper; the shot reads curb-seated. |

Cause: res 48 + 8× Laplacian on thin eaves (`13-hull-params.md`). Cake-slice bake at the ±45° corners kills the board (`29-color-bake.md`). **Reshape, do not reshoot.**

---

### 2. `pharmacy` / 港町薬局 — **FAIL** (worst hull)

Seen in **sakae-v5** (centre, on the zebra axis) and as the mint potato on the right edge of **soba-v5**.

Still `pharmacy/yaw-000.png`: mint square tile, mortar-and-pestle enamel, 「港町薬局」, 昭和61年創業 HARU PHARMACY 1986, red 薬 noren, packed 1F windows, open 2F sash with curtains / calendar / plant, rusty AC, roof bucket. `yaw-090` is a **true** right gable (solid tile, vent, small rear window). `yaw-180` is a true back. **`yaw-270.png` is still the ¾ wreck** agent 07 failed (`105.jpg`): shopfront + signboard + the upstairs front window transplanted onto the left wall.

| test | verdict | what the hull does |
|---|---|---|
| 3D shape | **FAIL — holes** | Not a box and not a potato. Through-holes: mortar logo, 2F left of the sash, 2F curtain/AC bay, 1F window (orange puncture), right 1F window. West party wall is chopped off. Sky shows through the building. |
| Painted front | **FAIL** | 「港町薬局」 is readable around the holes. Mortar/pestle is a void. HARU PHARMACY 1986 is gone. 薬 noren is a dark rectangle. |
| Footprint | **PASS*** | On the north curb, aligned with Yaoya and the arcade, **not** on the zebra. Catalog south face `z ≈ −4.7` (1.3 m into asphalt). |

Cause: visual-hull intersection of a ¾ left silhouette against a narrow true 090 gable shears the west-south corner (exactly where the logo sits). Laplacian on the thin remainder opens the 2F/1F windows into holes. Open 2F interior in yaw-000 does not match 090’s solid wall, so even a fixed 270 will leave a weak 2F unless glass is opaque.

**Must reshoot 270. Must reshape (solid rectangle, less smooth).** Highest priority.

---

### 3. `you-arcade` / Starlight Arcade — **PASS** (only pass)

Seen in **sakae-v5** (right of pharmacy). Right foreground white potato is **Haru barber** (south row `x: 6, z: 8.6`), not the arcade.

Still `you-arcade/yaw-000.png`: now a true front — mint mosaic, ファミリーゲームセンター / SPACE INVADER '86 fascia, 本日休業 glass, rooftop parapet and railing, クラブ・ゲ blade on the east edge. `yaw-090` and `yaw-180` are usable orthogonals (side grid + fire escape). **`yaw-270.png` is still a near-duplicate of 090** (クラブ・ゲ face-on, image-left). Agent 04 already flagged that; 000 was the wreck, 270 was never a unique left.

| test | verdict | what the hull does |
|---|---|---|
| 3D shape | **PASS — box** | Two-storey tiled prism, parapet present, antenna present. Top-left roof is chewed; west edge melts a little into the pharmacy slot. Not holes, not a potato. Best hull of the five. |
| Painted front | **PASS** | ファミリーゲームセンター is readable. SPACE INVADER is readable (the '86 is soft). Ground-floor posters smear but still read as glass doors. Mosaic reads. |
| Footprint | **PASS*** | Same facade line as pharmacy in the shot. Catalog south face `z ≈ −3.5` (**2.5 m into the travel lane**) — deepest overhang of the row. Slide north on the next layout pass. |

`yaw-270` still wants a true west elevation (bake will keep painting the east blade onto the west wall). That is a polish reshoot, not a hull-breaker, because 090 and 270 currently agree as “side” silhouettes and the intersection stays a box.

---

### 4. `tobacco-shop` / Kamimura — **FAIL** (roof)

Seen in **soba-v5** (left). Far-left ochre mass is the west gable wrapping around, with Yamato kanagu (`hardware-shop`, `x: −34`) cropped off-frame.

Still `tobacco-shop/yaw-000.png`: yellow-brick 1F, cream 2F, kirizuma, balcony (mums, laundry, 上村), 三菱 AC, たばこ TOBACCO / KAMIMURA SINCE 1963, magazine window, glass door with Open. `yaw-090` and `yaw-270` are true gables (090 brick with a window; 270 cream-over-brick, no window). `yaw-180` is a true back (steel door, gas meter). Cardinals agree.

| test | verdict | what the hull does |
|---|---|---|
| 3D shape | **FAIL** | 1F/2F body is a box. Kirizuma is a dark melted lid — no tiles, no onigawara, no eaves. Balcony mass survives. Not holes. |
| Painted front | **PASS** | たばこ and TOBACCO are readable at street distance. Magazine rack reads as a rack. KAMIMURA SINCE 1963 is mush. Close enough to yaw-000 for a shop card. |
| Footprint | **PASS** | On sidewalkN. Enamel vending on the west lot line (`INSTANCES` `−28.6, −6.7`) sits on the sidewalk, not the lane. South face ~0.3 m past the curb on paper. |

Cause: same eave melt as Yaoya. **Reshape, do not reshoot.**

---

### 5. `soba-shop` / Nishiya — **FAIL** (gable)

Seen in **soba-v5** (centre) and as a sliver on the left of **sakae-v5**.

Still `soba-shop/yaw-000.png`: cream 2F irimoya/kirizuma **facing the street**, 横浜港町ラーメン fascia, blue 中華そば / ラーメン noren, striped flag, lattice, 営業中, TV antenna. `yaw-090` is now a true east elevation (lattice, flag as a thin profile on image-left). `yaw-180` is a true back. **`yaw-270.png` is not a left elevation**: gable faces the camera (000/180 language), flag is on **image-left** (090 language). A true 270 puts the façade on image-right, so the flag must be a thin profile on the **right**. 180/270 still sit on a concrete pad.

| test | verdict | what the hull does |
|---|---|---|
| 3D shape | **FAIL** | Body is a box. The street-facing gable — the still’s silhouette — is a flat melted cap. Flag is a vertical wisp. Antenna gone. Corners round off. Potato roof on a box, not holes. |
| Painted front | **PASS** | Red ラーメン on the fascia is readable. Blue ラーメン noren is readable. 横浜港町 is soft. Lattice reads as dark rectangles. Identity holds at street distance. |
| Footprint | **PASS*** | On the north curb, aligned with tobacco and Yaoya in the shot, **not** in the lane. Catalog south face `z ≈ −4.4` (1.6 m into asphalt). |

Cause: 270-vs-090 silhouette fight on the roof (gable vs side slope) plus res-48 eave melt. **Reshoot 270, then reshape the roof.**

---

## Ranked reshoot / reshape

Highest first. “Reshoot” = replace a PNG. “Reshape” = hull / bake / pose, stills can stay.

| # | action | asset | why | exact still / prompt if reshoot |
|---|---|---|---|---|
| **1** | **Reshoot + reshape** | `pharmacy` `yaw-270` | ¾ left is the hole-maker. Intersection with true 090 shears the west-south corner; smoothing punches the fascia and 2F. | True orthographic **left** elevation of this same mint-tile 港町薬局. Copy `yaw-090.png`’s camera (square gable, no shopfront, no signboard). Front (AC, bucket, 薬 noren) belongs on **image-right**. Side wall is tile only — do **not** transplant the upstairs front sash onto the gable. Isolated on `#E040A0`, no floor, no cast shadow, no Grok mark. Then reconstruct as a **solid rectangle** (already forced; drop Laplacian or greedy-mesh so windows cannot open). |
| **2** | **Reshoot** | `pharmacy` `yaw-000` (glass) | Open 2F sash shows interior. Even with 270 fixed, 000≠090 at 2F. | Keep this exact front. Close the 2F sash (opaque curtains or frosted glass, no room interior). Keep 「港町薬局」, mortar/pestle, HARU PHARMACY 1986, packed 1F windows. Magenta void, no floor. |
| **3** | **Reshoot** | `soba-shop` `yaw-270` | Not a left elevation. Gable-on-camera + flag on image-left fights true 090 and melts the street gable. | True orthographic **left** elevation of this same two-storey Nishiya. Twin of `yaw-090.png`: ridge centred, cream plaster, lattice 1F+2F, **no** ラーメン fascia facing the camera. Striped flag is a thin profile on **image-right** only. No concrete pad (plinth overlapping the walls, on magenta). No Grok mark. |
| **4** | **Reshape** | `greengrocer`, `tobacco-shop`, `soba-shop` roofs | Cardinals already agree. Res 48 + `smoothLambda 0.45` × 8 turns 1–2 voxel eaves into potato lids. Yaoya’s specials board dies at the cake-slice corners. | Do not reshoot 000/090/180. Raise `silhouetteSize` (128) / drop smoothing on `rectangle`, or greedy-mesh the occupancy and project yaw-000 only onto +Z faces (`29-color-bake.md`). Kirizuma must survive as a ridge, not a cap. |
| **5** | **Reshoot** | `you-arcade` `yaw-270` | Near-duplicate of 090 (クラブ・ゲ face-on, image-left). Shape already passes; west wall is the east wall. | True orthographic **west** elevation. 2×2 mosaic grid, downpipe, no クラブ・ゲ face. Blade sign only as a thin profile on **image-right** (front). No fire escape (that is 180). Magenta void, no floor, no Grok mark. |
| **6** | **Reshape (pose)** | `you-arcade`, then `soba-shop` / `pharmacy` | Catalog `realDepth` puts south faces at `z ≈ −3.5 / −4.4 / −4.7` (travel lane is `z ≥ −6`). Shots hide it because the camera is 19 m away; a walk on the north sidewalk will clip. | Keep `z = −8.5` as the **front** line, or shrink planted depth so the south face sits at `z ≈ −6.2` (0.2 m north of the curb). Do not slide X. |
| **7** | **Layout, not stills** | tobacco–soba gap, yaoya–pharmacy gap | See empty-world. 3.2 m and 3.0 m party-wall holes are vacant lots, not alleys. | Close to 1.5–2.5 m (agent 04 / 26) **or** plant a kiosk / zelkova that actually reads in these cameras. Do not invent a sixth 6 m shop in a 3 m slot. |

Not on the list (already fixed or out of scope):

- Arcade / soba / tobacco **yaw-000** — keep.
- Greengrocer and tobacco **yaw-090 / 180 / 270** — keep.
- Pharmacy **yaw-090 / 180** — keep; 090 is the 270 template.
- South-row Haru barber (white potato in sakae-v5 right fg) — wrecked, but not one of the five shops. Same ¾/pad failure mode as agent 07 `101.jpg`. Queue it after pharmacy 270.

---

## Empty-world gaps in these two shots

Not shop hulls. What is missing **inside sakae-v5 and soba-v5**.

### Sky holes

- Studio clear colour `0x8894a0` (`setClearColor` / `document.body` `#8894a0`). No clouds, no overcast texture, no sun disc. Reads as a cyclorama, not 15:20 29 Nov 1986.
- Agent 24 skyline boxes (`addSkyline`, `z ≈ −24 / −34 / −40`) peek over every roof as untextured khaki slabs. **Gaps between boxes show sky** — the far rank is not a wall. Ridge plane (`z = −64`) does not close those slots from this pitch.
- Through-holes **in** the pharmacy hull are extra sky holes at street scale.

### Missing trees

Catalog has the trees. The shots do not.

| planted | pose | where it should be in these frames |
|---|---|---|
| `zelkova` unique | `−20, −10.5` | **tobacco–soba gap** (centre of soba-v5). 7.5 m. Absent. |
| `zelkova` instance | `−2, −10.8` | **yaoya–pharmacy gap** (sakae-v5). Absent. |
| `english-oak` instances | `x ∈ {−40,−30,−20}`, `z ∈ {−46…−18}` | Suzume-zaka canopy behind the tobacco–soba window. The gap shows bare green slope + one timber house, no crown. |
| street zelkova south | `4, 10.2` etc. | Behind / beside the sakae camera. Not in frame; north-row gaps are the ones that matter. |

Sakae-dori reads as a treeless lot. The unique zelkova sitting in the 3.2 m tobacco–soba hole is the one that would change soba-v5; it is either a failed custom hull or occluded into nothing.

### Missing curb life

Present: zebra at `x = 0`, yellow dashes, one manhole, two enamel vendings per shot, two poles, Yaoya produce table (part of the hull), south-row barber potato in sakae-v5 fg.

Absent, and the street dies without them:

- **People.** `civilian-hiro` instance at `(8, −6.8)` should stand in front of the arcade in sakae-v5 — not in frame. Instance at `(−16, 6.8)` is behind the soba camera. North sidewalk is empty.
- **Bikes / Cub.** `honda-cub` exists as stills and is not on `ORBIT_SUBJECTS`. No parked bikes at Nishiya or Yaoya.
- **Wires.** Poles exist (`−22, −6.2` in the tobacco–soba gap; `8, −6.2` at the arcade). No spans, no transformer cross-arms reading as a net.
- **Bins / crates as street furniture.** `steel-bin` instances at `−16` and `2` on `z = −6.6` should sit on this curb; they do not read. `crate-stack` at `−9.5, −5.9` is under Yaoya and does not add clutter in either shot.
- **Kei van / bus / Cub** — none in these two frames (van landmark is `5.2, 9`, behind the sakae camera).
- **Shop-gap infill at the façade line.** `addGapFill` boxes sit at `z = −10.5`. They are a back wall, not a street wall. Result:
  - **tobacco–soba (~3.2 m, x ≈ −23.4 … −20.2)** — soba-v5 looks **through** to Suzume stone stairs (`x = −20`) and the hill house. No gap-fill block is centred on this slot (`addGapFill` jumps `−28.4` → `−13.2`).
  - **yaoya–pharmacy (~3.0 m, x ≈ −6.3 … −3.3)** — sakae-v5 shows a green vacant lot and a grey slab behind. A 商店街 party wall is 1.5–2.5 m of dark slot, not a park.
  - **soba–yaoya (~2.1 m)** — narrower, still a skyline window.
- **Sidewalk material.** North sidewalk `0xb7b1a4` does not read as a granite lip in either shot; shops meet a dark asphalt plane (agent 08’s highway cross-section). No gutter, no tactile tile, no drain, no 停車帯.
- **Hill vegetation / park.** Green height-field through every gap; `GROUND.park` colour, no shrubs, no fence, no stone wall at the stair cheek.

### Adjacent wreck that pollutes sakae-v5

Right ~15 % of sakae-v5 is Haru barber (`barber-shop`, south row, `x: 6, z: 8.6`) at 2.4 m from the lens — a white melted hull with no 理容 identity. It is not in the five-shop list, but it is the first thing in the sakae beauty pass. Same queue as pharmacy 270 (agent 07 `101.jpg` left gable).

---

## What a pass looks like (next v6)

From `sakae` and `soba` after this list:

1. Pharmacy is a **closed mint box**; mortar/pestle and HARU PHARMACY 1986 read; no sky through the fascia.
2. Nishiya keeps a **street-facing gable** and a flag that is a flag.
3. Yaoya and Kamimura keep **tiled eaves**; 本日のおすすめ and たばこ stay sharp.
4. Arcade stays a box; west wall is not the east wall.
5. South faces sit on sidewalkN, not in the zebra.
6. Party-wall gaps are dark slots ≤ 2.5 m, not windows onto Suzume or the khaki field.
7. At least one zelkova crown in the tobacco–soba hole, oaks on the hill, wires on the poles, one person or one Cub on the curb.

Until then these two shots are five shop cards on a vacant lot under a studio sky.
