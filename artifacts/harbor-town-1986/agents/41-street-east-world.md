# 41 — `street-east-v5.png`: diorama on a grey slab

Plan only. Do **not** edit sample source from this note.

Shot: `C:\ThreeBrowser\artifacts\harbor-town-1986\street-east-v5.png`  
Landmark `street-east` in `scout.mjs`: `{ x: -38, z: 1.8, yaw: Math.PI / 2 + 0.16, pitch: -0.08 }`  
Eye `1.62 m`, `PerspectiveCamera(55, …)` (vFOV 55°, ~16:9 hFOV **85.5°**, half-hFOV **42.75°**).  
`yaw = π/2 + 0.16` ≈ **99.2°** from +Z → look is **due east + 9.2° north**, 4.6° down.

Look XZ `(sin yaw, cos yaw) ≈ (0.9874, −0.1593)`.  
Right XZ `(−cos yaw, sin yaw) ≈ (0.1593, 0.9874)` (south, slight east).  
Convention: `+X` east, `+Z` south. Yaw `0` faces south. Time lock 15:20, Sat 29 Nov 1986, overcast.

**Verdict: diorama on a grey slab. Not a full 1986 harbor-town world.**

The north row is a receding wall of reconstructed hulls. The south row is one mint gable, then void. The carriageway is a dark CG plane that dies into `scene.background` `0x8894a0` — the same grey as the sky. Fog `(28, 185)` dissolves the east end so the street has no closer. No wires, no trees on this street, no people, no bikes, no hanging 看板. That is a photo-studio set with a road texture, not Dobuita-density Sakae-dori.

---

## Camera frustum (this shot only)

| | |
|---|---|
| Eye | `(−38.00, 1.62, 1.80)` |
| Look | `(+0.984, −0.080, −0.159)` |
| In front | `fwd = (x+38)·0.9874 + (z−1.8)·(−0.1593) > 1.5 m` |
| In hFOV | `abs(right/fwd) < 0.923`, `right = (x+38)·0.1593 + (z−1.8)·0.9874` |
| Useful depth | **8–70 m**. Fog has already eaten past ~70 m. |
| Left | north row + N sidewalk (`z ≈ −12…−3`) |
| Right | south row + S sidewalk (`z ≈ 5…10`) |
| Centre | carriageway (`z ≈ −3…5`) running +X |

Do **not** plant hill oaks, dock willows, Route 16 bus, or Amihama warehouses for this still — they are behind the camera, occluded by the north wall, or south of right-FOV.

---

## 1) What is present

West → east, near → far. Poses from live `catalog.mjs` (`ORBIT_SUBJECTS` + `INSTANCES`).

### Left wall — north row (`z = −8.5`, `yaw = 0`, fronts face south)

| id | x | w | x-span | dist | hFOV | in the PNG |
|---|---:|---:|---|---:|---:|---|
| `hardware-shop` Yamato kanagu | −34 | 6.4 | −37.2…−30.8 | ~8 m | **−36°** (SE corner) | **cut-off far left** — green interior shelves, dark jamb. SW corner is out of FOV; we see the east return. |
| `tobacco-shop` Kamimura | −26 | 5.2 | −28.6…−23.4 | ~15 m | **−18…−30°** | **hero left facade** — yellow brick, たばこ fascia, magazine rack, upstairs laundry. |
| `soba-shop` Nishiya | −17 | 6.4 | −20.2…−13.8 | ~21 m | **−13°** | cream plaster, tiled kirizuma, next door east of tobacco. |
| `greengrocer` Yaoya | −9 | 5.4 | −11.7…−6.3 | ~30 m | **−10°** | produce stall, greenish mass. |
| `pharmacy` Minato-machi pharmacy | 0 | 6.6 | −3.3…3.3 | ~39 m | **−6°** | pale mint, enamel signs. |
| `you-arcade` Starlight | 8.4 | 8.0 | 4.4…12.4 | ~47 m | **−3°** | mosaic, receding. |
| `cassette-shop` records | 17.8 | 6.2 | 14.7…20.9 | ~57 m | **−1°** | last north-row mass before the grey hole. |

Party-wall gaps on this side are 2.6–3.6 m — tight enough that the **left** reads as a street. The hulls are chewed (agent 04 / 25) but they occupy the lot line.

### Right wall — south row (`z = 8.6`, `yaw = π`, fronts face north)

| id | x | w | x-span | dist | hFOV | in the PNG |
|---|---:|---:|---|---:|---:|---|
| *(empty)* | −40…−13.3 | | **26.7 m of sidewalkS** | | **+20…+42°** | **the grey slab.** This is the shot. |
| `flower-shop` Midori | −10 | 6.6 | −13.3…−6.7 | ~24 m | **+25°** | **mint-green west gable**, one upper window, isolated in a field. We see the *side*, not 花屋みどり. |
| *(empty)* | −6.7…2.9 | | **9.6 m** | ~35 m | **+18°** | sky between florist and barber. |
| `barber-shop` Haru | 6 | 6.2 | 2.9…9.1 | ~45 m | **+19°** | small mass past Midori. |
| `kissaten` Kissa Miharu | 14 | 6.0 | 11.0…17.0 | ~53 m | **+17°** | further, then Yokobori mouth. |

South coverage on the 80 m street in this frustum: **one gable** in the near/mid, two specs in the fog. Agent 26’s west bay was never planted (florist sat at `−10` instead of `−6`; barber went to `+6` instead of `−14.7`).

### Street furniture already in the PNG

| what | pose | dist | hFOV | read |
|---|---|---:|---:|---|
| `vending-enamel` instance | **−31, 6.0, π** | 6.2 m | **+40°** | **right-foreground hero** — cream enamel, red kick, cans. The only near object on the south walk. |
| `vending-enamel` instance | −28.6, −6.7, 0 | 10 m | −32° | cream machine in Kamimura’s doorway (left). |
| `vending-enamel` unique | −6.8, −5.9, 0 | 32 m | −9° | Yaoya pair, readable as a red-cream sliver. |
| `vending-enamel` instance | −10.8, −6.7, 0 | 28 m | −11° | soba–yaoya slit. |
| `telephone-pole` unique | **−22, 5.6, 0** | 15 m | **+23°** | **tall right mast with blue/white blade.** |
| `telephone-pole` | −22, −6.2, 0 | 17 m | −17° | north mast in the tobacco–soba slit. |
| `telephone-pole` | −8, −6.4, 0 | 31 m | −6° | north, receding. |
| `telephone-pole` | −4, 5.6, 0 | 33 m | +16° | south, receding. |
| further poles | 6 / 8 / 16 / 18 / 28 / 36 / 38 / 40 | 43–78 m | 0…+16° | the ladder into the fog. |
| `kei-van` Suzuki Carry | **14.5, 3.4, −0.18** | **52 m** | **+11°** | the **only vehicle**. A white speck on the centreline. |
| `civilian-hiro` | −9.2, −7.3, π | 30 m | −8° | **in frustum, not in the PNG.** 1.72 m at 30 m is 3.3° (~6 % of vFOV) and sits in Yaoya’s hull. |
| `phone-booth` | 16.5, 6.8, π | 53 m | +14° | green speck, easily missed. |
| `steel-bin` unique + clones | −12 / −24 / −34 / −16 / −4 / 2 / 8, z ±6.6 | 13–46 m | mixed | 0.75 m; if they were in this capture they read as noise. Not density. |
| box `produce crate`s (`addGroundClutter`) | −9.35/−8.62/−9.02, z ≈ −5.8 | 30 m | −10° | untextured brown boxes at Yaoya. Lost in the hull. |
| yellow dashes (`addStreetFurniture`, **z = 2**) | x −38…38 step 4.4 | under the look | ~+1° | the one thing that makes this a *road*. |
| white lane edges (`roads.mjs`, z = −0.5 / 4.5) | 80 m strips | | | visible as hairlines. |
| asphalt `GROUND` `0x3a3a3c` | x −48…48, z −8…12 | | | the slab. |
| sidewalkN/S `0xb7b1a4` y=0.08 | x −40…40 | | | lights as **the same grey as the sky**. No curb lip reads. |
| `scene.fog` 0x8894a0, 28…185 | | | | east end = background. No closer. |

Not in the PNG (behind camera, out of FOV, or occluded): Suzume oaks (`english-oak` at z ≤ −18, behind the north wall), hill houses, warehouses, city-bus, Route 16, quay willows, Galaxy sakaba (maybe a 1-pixel sliver at `+22°` / 61 m).

---

## 2) What is MISSING for Shenmue Ch.1 density

Ch.1 Dobuita at 15:20 is dense **at arm’s length**: party-wall shops on *both* sides, a Cub or mamachari every bay, paired vending, a pole every ~20 m **with wires**, 看板 over the walk, two or three bodies in every street shot, stain on the wet asphalt, a tree or planter where a shop is not. Empty sky between a facade and a vanishing grey rectangle is the tell that this is still a diorama.

| layer | Ch.1 feel in this 85° east view | this PNG | hole |
|---|---|---|---|
| North-row frontage | ~90 % party wall | hardware→records, gaps 2.6–3.6 m | **OK as a wall.** 19 m of nothing **east of records** (`x 20.9…40`) is the closer hole. |
| South-row frontage | ~80 % party wall | **8 %** in the near/mid (one gable at 24 m) | **26.7 m void** west of Midori. 9.6 m void east of it. |
| Overhead wires | every pole pair + cross-street droop | poles are sticks in a void | sky is ~40 % of the frame |
| Street trees / planters | winter zelkova or a planter in the slits | **zero** on Sakae (oaks are on the hill, occluded) | south slab has no verticals |
| People | 2–4 bodies in a street-east still | Hiro unreadable | no Saturday 15:20 |
| Scooters / bikes | Cub or mamachari every 1–2 bays | **0** (`honda-cub` stills exist, not catalogued) | curb is a showroom |
| Parked cars | 停車帯 occupied | one Carry at **52 m** | 50 m of empty asphalt in the crosshairs |
| Crates / clutter | produce spill, shop-front boxes | 7 untextured boxes at Yaoya | no photoreal stack, none on the south walk |
| 看板 / lanterns over the walk | blades, noren that stick out, 赤提灯 | fascia is on the hull only | roofs sit in empty air |
| Hanging laundry / AC / meters | already baked into some stills | tobacco has a little | not a street layer |
| Sidewalk stains / manholes / wet | drizzle lock, iron lids, gum, oil | one dark spec (manhole at z=2, maybe) | slab is sterile |
| White zebra / stop line | `roads.mjs` zebras at x=0 and x=18 | too far / edge-on from this yaw | not the problem |
| East closer | next block, a bus, a wall | fog = sky | the street ends |
| Cats / sandwich boards / hydrants | Dobuita sidewalk noise | 0 | after the above |

The **diorama recipe** in this still is three empty rectangles:

1. **Right mid-ground** (`hFOV +20…+42°`, 8–24 m) — south sidewalk from the enamel machine to Midori’s west gable.  
2. **Centre asphalt** (`hFOV −5…+15°`, 8–50 m) — nobody, no van, no Cub, no stain.  
3. **Sky + vanishing point** — poles with no wires, records then grey.

Fill those three and the shot stops being a kit bash.

Do **not** instance shop facades (identical Nishiya / Midori / arcade kills the shopping-street read). Repeat poles, vending, cub, crates, bins, drums. New south-row bays are **unique** meshes.

---

## 3) Exact plant list — this frustum only

Metres are `realHeight × realWidth × realDepth` as in `catalog.mjs`.  
Yaw radians, same axis as the file (`0` = south / +Z, `π` = north, `π/2` = east).  
`z` for south shops stays **8.6**; north shops **−8.5**; N walk furniture **z ≈ −5.5…−6.7**; S walk **z ≈ 6.2…6.8**; 停車帯 **z ≈ 3.4**.

Do not plant behind `x ≈ −38`, south of `z ≈ 12` (Yokobori, not this still), or north of the shop backs (`z < −12` — occluded). Depth cap **x ≤ 40** (fog).

### 3.1 NEW unique shops (do not instance existing facades)

| # | asset | status | x | z | yaw | metres (H×W×D) | x-span | dist | hFOV | why |
|---|---|---|---:|---:|---|---|---|---:|---:|---|
| A | `yamaguchi-denki` | **NEW** rectangle-4 | **−26.8** | **8.6** | **Math.PI** | **6.8 × 6.4 × 7.4** | −30.0…−23.6 | 10 m | **+40°** | Fills the near-right slab next to the enamel machine. West face 0.9 m east of vending `−31`. Front faces Sakae. 電気屋, noren `山口`, no Dobuita clone. |
| B | `minato-sakaya` | **NEW** rectangle-4 | **−18.4** | **8.6** | **Math.PI** | **6.8 × 6.6 × 7.6** | −21.7…−15.1 | 18 m | **+28°** | Party-wall west of Midori (1.8 m slit). Turns Midori from a lone gable into a wall. 港町酒販, cases in the window. |
| C | `horiuchi-tokei` | **NEW** rectangle-4 | **−1.9** | **8.6** | **Math.PI** | **6.6 × 6.4 × 7.2** | −5.1…1.3 | 37 m | **+19°** | Eats the 9.6 m Midori–barber lot (1.6 m to Midori east, 1.6 m to barber west). 時計・印鑑, enamel clock. |
| D | `kaihin-bunbogu` | **NEW** rectangle-4 | **31.0** | **−8.5** | **0** | **7.0 × 7.0 × 7.4** | 27.5…34.5 | 70 m | **+1°** | East closer on the north lot line. At 70 m it is a 6° grey mass — that is the point. Agent 15 already named this bay. 文具, not a 7-Eleven. |

After A+B+C south frontage in-frame goes from one gable to a continuous wall `x −30…17` (denki–sakaya–Midori–tokei–barber–kissa). After D the north wall does not dump into sky.

Stills: magenta `#E040A0`, no floor, no cast shadow, true cardinals, 2-storey matched across yaw-000/180. Forbidden: Dobuita names, Abe, Tomato, You Arcade, 7-Eleven as the hero word.

### 3.2 Assets on disk, not in `ORBIT_SUBJECTS` — unique + instances in frustum

`honda-cub/` has 4 cardinals (agent 07: 8-view custom not finished; plant anyway, diagonals later).  
`crate-stack/` has 4 cardinals, rectangle.  
`zelkova/` has **only yaw-000** — complete to custom-8 before reconstruct, or treat as NEW.  
`oil-drum/` has 2 views, cylinder.

| # | asset | status | x | z | yaw | metres | dist | hFOV | note |
|---|---|---|---:|---:|---|---|---:|---:|---|
| E | `honda-cub` | unique (folder exists) | **−23.6** | **−5.5** | **1.40** | **1.15 × 0.66 × 1.85** | 15 m | **−18°** | North walk, Kamimura east bay, nose ESE, kickstand. 15 m, Cub-sized, left of centre. Agent 15 pose, still valid vs current tobacco `x=−26`. |
| F | `honda-cub` | instance | **−16.2** | **6.5** | **−1.48** | same | 23 m | **+22°** | South walk, in the 1.8 m sakaya–Midori slit, nose west. |
| G | `honda-cub` | instance | **−4.8** | **−5.6** | **1.52** | same | 34 m | **−8°** | North walk, Yaoya east / pharmacy west. |
| H | `crate-stack` | unique | **−9.1** | **−5.0** | **0.08** | **1.55 × 1.22 × 0.85** | 30 m | **−10°** | Replaces the brown `BoxGeometry` produce pile. Yaoya spill, on N walk, not in the lane. |
| I | `crate-stack` | instance | **−12.4** | **6.4** | **3.05** | same | 27 m | **+24°** | Midori west-front, south walk. |
| J | `crate-stack` | instance | **−20.6** | **6.5** | **0.20** | same | 19 m | **+29°** | Sakaya doorway cases. |
| K | `zelkova` | unique (finish 8 views) | **−32.4** | **7.0** | **0.25** | **6.4 × 4.8 × 4.8** | 8 m | **+38°** | Winter street tree, south walk, **west** of denki (do not drop a 15 m oak on a 3 m sidewalk). Bare Nov crown, matches the still. |
| L | `zelkova` | instance | **−22.6** | **7.1** | **−0.15** | same | 16 m | **+27°** | South walk, denki–sakaya 1.8 m slit, behind the unique pole at `−22, 5.6` so the mast stays readable. |
| M | `oil-drum` | unique | **−30.2** | **6.6** | **0** | **0.88 × 0.58 × 0.58** | 8 m | **+39°** | Against denki’s west return, next to the enamel machine. Rust, 南浜 stencil. |

`city-bus` stills exist but a bus at agent 15’s `(−38.2, 19.5)` is **behind this camera** (`fwd < 0`). Do not plant it for this still.

### 3.3 Instance existing catalog assets (no new stills)

| # | asset | x | z | yaw | metres | dist | hFOV | note |
|---|---|---:|---:|---|---|---:|---:|---|
| N | `kei-van` | **−18.5** | **3.4** | **−0.12** | 1.78 × 1.4 × 3.2 | **19 m** | **+14°** | 停車帯, crooked like the unique. Occupies the empty centre-right asphalt that currently runs 52 m to the far Carry. ≥0.4 m from s-gutter. Unique Carry stays at `14.5, 3.4`. |
| O | `kei-van` | **2.8** | **3.5** | **0.08** | same | 41 m | +9° | Second stall east of x=0 zebra (agent 08 P3 is the unique; this is P2). Fog-readable block. |
| P | `vending-enamel` | **−21.0** | **6.7** | **Math.PI** | 1.82 × 0.9 × 0.72 | 19 m | +28° | Pair on sakaya’s west jamb, facing north. Classic double with `−31, 6.0`. |
| Q | `vending-enamel` | **−14.4** | **6.7** | **Math.PI** | same | 25 m | +24° | Midori west, 1.1 m east of sakaya east face. |
| R | `vending-enamel` | **−3.6** | **−5.4** | **0** | same | 35 m | −7° | Pharmacy west, north walk. Completes the left-row rhythm. |
| S | `telephone-pole` | **−12.0** | **5.6** | **0** | 10 × 0.35 × 0.35 | 26 m | +20° | South curb, Midori front. Current south beat jumps `−22 → −4` (18 m); this splits it. |
| T | `telephone-pole` | **−14.0** | **−6.2** | **0** | same | 25 m | −12° | North, soba–yaoya slit (unique north poles skip this gap). |
| U | `phone-booth` | **−20.4** | **6.3** | **Math.PI** | 2.4 × 0.9 × 0.9 | 19 m | +26° | South walk, sakaya front, 1.4 m south of the unique pole so they do not merge. Green kiosk is a Ch.1 sidewalk word. Keep the far booth at `16.5, 6.8`. |
| V | `steel-bin` | **−27.4** | **6.6** | **0.4** | 0.75 × 0.54 × 0.54 | 12 m | +35° | Denki west, in front of drum M. |
| W | `steel-bin` | **−8.8** | **6.6** | **0** | same | 30 m | +22° | Midori east bay (current unique is `−12, 6.6` — keep it). |

Do **not** instance `flower-shop`, `barber-shop`, `kissaten`, `tobacco-shop`, `soba-shop`, `you-arcade`. Do **not** drop `english-oak` (15 × 14 × 14) on Sakae — crown would eat both facades.

### 3.4 NEW uniques — people, bikes, 看板, wires

| # | asset | status | x | z | yaw | metres | dist | hFOV | note |
|---|---|---|---:|---:|---|---|---:|---:|---|
| X | `mamachari` | **NEW** custom-8 | **−11.2** | **6.5** | **−1.52** | **1.05 × 0.58 × 1.72** | 27 m | **+23°** | South walk, Midori door, parallel to curb, basket, no plastic crate. Agent 15 unique was north-row; this shot needs the south one. |
| Y | `mamachari` | instance | **−17.4** | **−5.6** | **1.50** | same | 22 m | −14° | North walk, Nishiya east slit, front wheel east. 3 m west of Hiro. |
| Z | `civilian-sato` | **NEW** humanoid-8 | **−24.2** | **−5.4** | **1.45** | **1.58 × 0.52 × 0.40** | 14 m | **−20°** | Housewife, shopping bag, facing Kamimura. 14 m, 6.4° tall — actually readable. Not Ryo, not a sailor. |
| AA | `civilian-watanabe` | **NEW** humanoid-8 | **−19.6** | **6.4** | **−2.4** | **1.65 × 0.58 × 0.42** | 20 m | **+25°** | Overcoat, loosened tie, weight on one leg, south walk by the booth. Agent 15 parked him in Yokobori — too far for this PNG (1.6° at 61 m). |
| AB | `civilian-kid` | **NEW** humanoid-8 | **−8.6** | **−5.8** | **0.2** | **1.28 × 0.42 × 0.32** | 30 m | −8° | Next to Hiro, looking at Yaoya crates. Two bodies beat one lost school blazer. |
| AC | `kanban-blade` | **NEW** custom-8 | **−26.0** | **−4.6** | **0** | **1.6 × 1.4 × 0.10** | 16 m | −22° | Timber 看板 hung off Kamimura, projecting **south over the N walk**. Copy as instances: |
|    | `kanban-blade` | instance | −17.0 | −4.4 | 0 | same | 22 m | −13° | Nishiya ラーメン blade. |
|    | `kanban-blade` | instance | −10.0 | 5.0 | Math.PI | same | 29 m | +22° | Midori 花屋, over the S walk. |
|    | `kanban-blade` | instance | −18.4 | 5.0 | Math.PI | same | 20 m | +27° | Sakaya 酒. |
| AD | `akachochin` | **NEW** custom-8 | **−18.0** | **5.2** | **Math.PI** | **0.55 × 0.32 × 0.32** | 21 m | +26° | One red lantern on sakaya’s noren rod. Instance at `−17.2, −4.8, 0` for Nishiya. |
| AE | `overhead-span` | **NEW** custom-2 *or* geo | see spans | | | droop 0.4–0.8 × span | — | sky | **Do this as `addStreetFurniture` Line/catenary if possible** — a 48³ hull will look like a sausage. If it must be an asset: one span mesh, instance per pole pair. |

**Wire spans in this frustum** (catenary sag 0.8–1.4 m, attachment y ≈ 7.2 on the 10 m poles):

Cross-street (the ladder you see looking east — highest pixel impact per metre):

| from pole (x,z) | to (x,z) | mid (x,z) | yaw |
|---|---|---|---|
| −22, −6.2 | −22, 5.6 | **−22.0, −0.3** | 0 |
| −14, −6.2 | −12, 5.6 | **−13.0, −0.3** | 0 |
| −8, −6.4 | −4, 5.6 | **−6.0, −0.4** | 0 |
| 8, −6.2 | 6, 6.4 | **7.0, 0.1** | 0 |
| 18, −6.4 | 16, 5.6 | **17.0, −0.4** | 0 |
| 28, −6.2 | 36, 5.6 | skip — 8 m stagger, run along-street instead | |

Along-street (south, against the sky on the right):

| −22, 5.6 → −12, 5.6 | mid **−17.0, 5.6** | π/2 |
| −12, 5.6 → −4, 5.6 | mid **−8.0, 5.6** | π/2 |
| −4, 5.6 → 6, 6.4 | mid **1.0, 6.0** | π/2 |
| 6, 6.4 → 16, 5.6 | mid **11.0, 6.0** | π/2 |

Along-street north: `−22→−14→−8→8→18→28→38` at `z ≈ −6.3`, yaw `π/2`.

Two transformers as `BoxGeometry` 0.7×0.5×0.4, grey `0x6a6e70`, on poles `(−22, 5.6)` and `(−4, 5.6)` at y=6.6 — geo, not a unique.

### 3.5 Geo only (not `ORBIT_SUBJECTS`) — still this frustum

Do not unique-mesh these (agent 15 manhole rule). `addRoads` / `addStreetFurniture`:

| what | pose | why this PNG |
|---|---|---|
| Iron manhole 0.62 box | **−24, −1.4** (n-lane) | 14 m ahead, left of dashes. |
| Iron manhole | **−8, −1.4** | 30 m, already in agent 08 list. |
| Drain grate | **−20, −3.02** and **−20, 4.425** | gutter sparkle at 18 m. |
| Oil/water decal (dark, roughness 0.35) | ellipse ~3.2×1.4 at **−16, 1.2** | wet-drizzle lock on the empty asphalt. |
| Gum/stain specks | N walk `x −28…−8, z −5.2` | Kamimura–Yaoya is the left sidewalk we actually see. |
| Curb lip already in `roads.mjs` at z=±6.15 | keep | it does not read; raising sidewalk y 0.08→0.15 is a road pass, not a plant. |

Skip a portal crane, skip a 10 m bus, skip a third identical timber house.

---

## 4) Rank: 10 plants that most change *this* screenshot

Rank is pixel impact in `street-east-v5.png`, not town-wide density. One mesh each.

| rank | plant | pose | why it rewrites the PNG |
|---|---|---|---|
| **1** | **`yamaguchi-denki` (NEW)** | `−26.8, 8.6, π` 6.8×6.4×7.4 | 10 m, **+40°**. A 6.8 m facade at 10 m is 35° of vFOV — the entire near-right grey slab (vending to empty sky) becomes a shop wall. This is the diorama. |
| **2** | **`minato-sakaya` (NEW)** | `−18.4, 8.6, π` 6.8×6.6×7.6 | 18 m, **+28°**. Fills the hole between denki and Midori so the mint building is a neighbour, not a toy on a table. |
| **3** | **`overhead-span` cross-street** (geo / NEW) | six droops at `x=−22,−13,−6,7,17`, `z≈0` | Sky is ~40 % of the frame. Poles without wires are CG. Cross-street catenaries are the Ch.1 vanishing-point ladder. |
| **4** | **`kei-van` instance** | `−18.5, 3.4, −0.12` | 19 m, **+14°**, in the crosshairs. Today the road is empty until a 52 m speck. A 3.2 m Carry at 19 m is a vehicle, not furniture. |
| **5** | **`honda-cub` unique** | `−23.6, −5.5, 1.40` | 15 m, **−18°**, in front of the tobacco we already read. The 1986 sidewalk signature. Stills are on disk. |
| **6** | **`zelkova` unique** | `−32.4, 7.0, 0.25` 6.4 m | 8 m, **+38°**, right edge, winter crown against the grey sky. Even before denki lands, it stops the south walk looking like a loading dock. Do not use `english-oak` here. |
| **7** | **`civilian-sato` (NEW)** | `−24.2, −5.4, 1.45` | 14 m, **−20°**. A 1.58 m body at 14 m is 6.4° — the first readable person in a shot that currently has zero. Saturday 15:20. |
| **8** | **`kaihin-bunbogu` (NEW)** | `31.0, −8.5, 0` | 70 m, on the look ray. Does not have to be sharp: it is the closer that makes fog *distance* instead of *the world ending*. |
| **9** | **`kanban-blade` unique + 3 instances** | tobacco / soba / sakaya / Midori at z=±4.6…5.2 | Breaks the “hulls standing on a plane” roof-line. Ch.1 streets have signs *over* the walk, not only printed on the isosurface. |
| **10** | **`mamachari` unique** | `−11.2, 6.5, −1.52` | 27 m, Midori’s door on the right. Pairs with the Cub so the curb is not one vehicle type. Basket, kickstand, 1986. |

Honourable, not top-ten: `horiuchi-tokei` (rank 2.5 if denki+sakaya already exist — the 9.6 m Midori–barber hole is smaller in frame than the west void), `crate-stack` at Yaoya (left clutter, 30 m), `phone-booth` at `−20.4, 6.3` (green vertical, 19 m), `civilian-watanabe` on the south walk, lantern pair, oil-drum beside the enamel machine, second van at `2.8, 3.5`.

If only **three** meshes ship before the next `street-east` capture: **denki, sakaya, cross-street wires.** That kills the right slab and the empty sky. The van and the Cub are the cheap fourth and fifth (one is already an instance).

---

## Copy-paste poses (frustum plants only)

New `ORBIT_SUBJECTS` rows (when stills exist):

```js
{ id: "yamaguchi-denki", folder: "yamaguchi-denki", label: "Yamaguchi denki",
  kind: "rectangle", district: "sakae", x: -26.8, z: 8.6, yaw: Math.PI,
  realHeight: 6.8, realWidth: 6.4, realDepth: 7.4 },
{ id: "minato-sakaya", folder: "minato-sakaya", label: "Minato sakaya",
  kind: "rectangle", district: "sakae", x: -18.4, z: 8.6, yaw: Math.PI,
  realHeight: 6.8, realWidth: 6.6, realDepth: 7.4 },
{ id: "horiuchi-tokei", folder: "horiuchi-tokei", label: "Horiuchi tokei",
  kind: "rectangle", district: "sakae", x: -1.9, z: 8.6, yaw: Math.PI,
  realHeight: 6.6, realWidth: 6.4, realDepth: 7.2 },
{ id: "kaihin-bunbogu", folder: "kaihin-bunbogu", label: "Kaihin bunbogu",
  kind: "rectangle", district: "sakae", x: 31.0, z: -8.5, yaw: 0,
  realHeight: 7.0, realWidth: 7.0, realDepth: 7.4 },
{ id: "honda-cub", folder: "honda-cub", label: "Meiji milk Cub",
  kind: "custom", district: "sakae", x: -23.6, z: -5.5, yaw: 1.40,
  realHeight: 1.15, realWidth: 0.66, realDepth: 1.85 },
{ id: "crate-stack", folder: "crate-stack", label: "Harbor crate stack",
  kind: "rectangle", district: "sakae", x: -9.1, z: -5.0, yaw: 0.08,
  realHeight: 1.55, realWidth: 1.22, realDepth: 0.85 },
{ id: "zelkova", folder: "zelkova", label: "Sakae street zelkova",
  kind: "custom", district: "sakae", x: -32.4, z: 7.0, yaw: 0.25,
  realHeight: 6.4, realWidth: 4.8, realDepth: 4.8 },
{ id: "oil-drum", folder: "oil-drum", label: "Oil drum",
  kind: "cylinder", district: "sakae", x: -30.2, z: 6.6, yaw: 0,
  realHeight: 0.88, realWidth: 0.58, realDepth: 0.58 },
{ id: "mamachari", folder: "mamachari", label: "Mamachari",
  kind: "custom", district: "sakae", x: -11.2, z: 6.5, yaw: -1.52,
  realHeight: 1.05, realWidth: 0.58, realDepth: 1.72 },
{ id: "civilian-sato", folder: "civilian-sato", label: "Sato",
  kind: "humanoid", district: "sakae", x: -24.2, z: -5.4, yaw: 1.45,
  realHeight: 1.58, realWidth: 0.52, realDepth: 0.40 },
{ id: "civilian-watanabe", folder: "civilian-watanabe", label: "Watanabe",
  kind: "humanoid", district: "sakae", x: -19.6, z: 6.4, yaw: -2.4,
  realHeight: 1.65, realWidth: 0.58, realDepth: 0.42 },
{ id: "civilian-kid", folder: "civilian-kid", label: "Kid",
  kind: "humanoid", district: "sakae", x: -8.6, z: -5.8, yaw: 0.2,
  realHeight: 1.28, realWidth: 0.42, realDepth: 0.32 },
{ id: "kanban-blade", folder: "kanban-blade", label: "Timber kanban",
  kind: "custom", district: "sakae", x: -26.0, z: -4.6, yaw: 0,
  realHeight: 1.6, realWidth: 1.4, realDepth: 0.10 },
{ id: "akachochin", folder: "akachochin", label: "Red chochin",
  kind: "custom", district: "sakae", x: -18.0, z: 5.2, yaw: Math.PI,
  realHeight: 0.55, realWidth: 0.32, realDepth: 0.32 },
```

Frustum `INSTANCES` to append (do not duplicate the unique origins above):

```js
{ asset: "honda-cub", x: -16.2, z: 6.5, yaw: -1.48 },
{ asset: "honda-cub", x: -4.8, z: -5.6, yaw: 1.52 },
{ asset: "crate-stack", x: -12.4, z: 6.4, yaw: 3.05 },
{ asset: "crate-stack", x: -20.6, z: 6.5, yaw: 0.20 },
{ asset: "zelkova", x: -22.6, z: 7.1, yaw: -0.15 },
{ asset: "kei-van", x: -18.5, z: 3.4, yaw: -0.12 },
{ asset: "kei-van", x: 2.8, z: 3.5, yaw: 0.08 },
{ asset: "vending-enamel", x: -21.0, z: 6.7, yaw: Math.PI },
{ asset: "vending-enamel", x: -14.4, z: 6.7, yaw: Math.PI },
{ asset: "vending-enamel", x: -3.6, z: -5.4, yaw: 0 },
{ asset: "telephone-pole", x: -12.0, z: 5.6, yaw: 0 },
{ asset: "telephone-pole", x: -14.0, z: -6.2, yaw: 0 },
{ asset: "phone-booth", x: -20.4, z: 6.3, yaw: Math.PI },
{ asset: "steel-bin", x: -27.4, z: 6.6, yaw: 0.4 },
{ asset: "steel-bin", x: -8.8, z: 6.6, yaw: 0 },
{ asset: "mamachari", x: -17.4, z: -5.6, yaw: 1.50 },
{ asset: "kanban-blade", x: -17.0, z: -4.4, yaw: 0 },
{ asset: "kanban-blade", x: -10.0, z: 5.0, yaw: Math.PI },
{ asset: "kanban-blade", x: -18.4, z: 5.0, yaw: Math.PI },
{ asset: "akachochin", x: -17.2, z: -4.8, yaw: 0 },
```

Keep-out vs live catalog: unique pole `(−22, 5.6)`, unique vending `(−6.8, −5.9)`, Carry `(14.5, 3.4)`, Hiro `(−9.2, −7.3)`, Midori `(−10, 8.6)`, booth `(16.5, 6.8)`, enamel south `(−31, 6.0)`. Slits stay ≥0.35 m. Cub E is 1.6 m west of tobacco’s east face and 2.1 m east of the N vending at `−28.6`. Van N is in the 停車帯, not the eastbound lane.

---

## Do not

- Edit sample source from this note
- Call this shot a finished world — it is a diorama on a grey slab
- Instance Nishiya / Midori / arcade / records / tobacco / hardware / kissa / barber
- Plant `english-oak` 15 m on the 3 m sidewalk (hill trees stay on Suzume)
- Plant `city-bus` or Route 16 kit — behind this camera
- Plant dock willows, Warehouse 8, or hill houses for this still
- Unique-mesh manholes, drains, or the wires if a Line catenary will do
- Sit denki / sakaya / tokei anywhere except `z = 8.6`, `yaw = π`
- Sit bunbogu anywhere except the north lot line `z = −8.5`, `yaw = 0`, east of records
- Clone Dobuita shop names or characters on the new stills
