# 58 — Missing world (v5 stills vs a 1986 Kanagawa harbor town)

World-completeness critic. Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south (`+Z`), `Math.PI` north,
`Math.PI / 2` east, `-Math.PI / 2` west.
Sources: the eight `*-v5.png` captures, live `catalog.mjs` (`ORBIT_SUBJECTS` +
`INSTANCES`), `TOWN.md`, `map.mjs` `GROUND`, magenta orbit stills under
`assets/`, `main.mjs` gap-fill / clutter / wires / skyline.

**Headline: this is still a film-set. Facades on a grey slab, not a town.**

---

## 1. Each v5 shot: full world or film-set corridor?

Harsh. Eye-height Shenmue Ch.1 density is the bar, not “are there meshes.”

### `sakae-v5.png` — **film-set corridor. Score 2/10.**

Landmark `sakae` `{ x: 0, z: 11, yaw: π }`. Looking due north at the zebra.

A cardboard north wall (Yaoya, pharmacy, arcade) sits on a painted crosswalk.
Between Yaoya and pharmacy the **olive height-field punches through** — a 3 m
lot that should be party wall. Behind the shops: anonymous grey `gap fill` /
`skyline block` cubes (`z ≈ −10.5 / −24`), not a second block of town. South
row is out of this frustum, so the camera is photographing a **one-sided
diorama**. No people, no Cub, no hanging 看板, no wires that read, no wet
stain language beyond one manhole disc. Sky is a solid `0x8894a0` void.

A full world would have a south curb in peripheral vision, a closed lot line,
and something occupying the 8 m of asphalt between eye and façade.

### `street-east-v5.png` — **film-set corridor. Score 3/10.**

Landmark `street-east` `{ x: -38, z: 1.8, yaw: π/2+0.16 }`. The **least empty**
of the eight, and still a set.

North row (left) is the only real wall: hardware clip → Kamimura → Nishiya →
Yaoya → pharmacy → arcade → records, gaps 1–3 m. That is a street **on one
side**. South row (right) is one mint gable (`flower-shop` side, not 花屋みどり)
after **~27 m of sidewalk + enamel machine + poles**. Carriageway is a dark CG
plane that dies into the same grey as the sky. The Suzuki Carry is a white
speck at ~52 m. Zero bodies. Zero Cubs. Poles are masts in empty air — wires
exist in `addOverheadWires` (`r = 0.02` at `y = 8.5`) and they **do not read**
in this capture. Fog eats the east closer. This is Dobuita shot on a sound
stage with the right wall struck.

### `seawall-v5.png` — **film-set. Score 1/10.**

Landmark `seawall` `{ x: -38.5, z: 86.6, yaw: 1.62 }`. Looking east along the
cap.

Left: three melted warehouse potatoes on an infinite concrete table. Right:
a knife-edge seawall and empty grey that is both water and sky. Receding
cap-posts the size of parking bollards. **No boats. No nets. No mooring
lines. No crates in the near field. No forklift. No worker. No willows on
the waterline** (the seven `weeping-willow` poses sit at `z ≈ 82–86` inland
of the look, occluded or out of the water-side half). Freeboard still reads
as a kerb next to a pond. This is a warehouse product shot, not Amihama.

### `hill-v5.png` — **broken set. Score 1/10.**

Landmark `hill` `{ x: -36, z: -35, yaw: 0.52 }`.

Left third: a reconstructed house so close the eaves are a melted cliff.
Mid: two more copies of the **same** `wooden-hill-house` hull, plus a sliver
of stairs. Right **half the frame is a dark unlit plane** — a `skyline block`
or the ridge card sitting in camera, a black flag on a stage. No 石垣, no
block walls, no bikes at 玄関, no second house *type*, no park furniture.
Sakuragaoka is a cluster you turn *between*. This is three stamps and a
void.

### `yokobori-v5.png` — **film-set plaza. Score 2/10.**

Landmark `yokobori` `{ x: 20.2, z: 10.4, yaw: 0.18 }`.

Galaxy sakaba fills the left like a hero prop. One enamel machine stands in
the middle of a brown `GROUND.alley` slab (`18…42 × 10…28` — a **24 m plaza**,
not a 4 m 横丁). Beyond: three warehouse sheds sitting in empty dock air.
No opposite alley wall, no second snack, no 赤提灯, no drain, no beer crates
that read (primitive stacks at `20, 14` are below the noise floor). You can
see *the next district* because there is no architecture in the way. A real
yokochō hides the harbor until you walk out the south end.

### `kissa-v5.png` — **hero-prop street. Score 3/10.**

Landmark `kissa` `{ x: 14, z: -2.5, yaw: 0 }`.

Kissa Miharu is the one façade that almost belongs in a game (timber box,
noren, 港の珈琲). Haru barber on the right is a cream box with yellow chairs.
Galaxy sakaba peeks left. Then: a **melted white van** parked on the zebra,
a lone vending, warehouses in the gap, and a sky that owns the upper third.
South row here is three buildings with holes between them, not a wall. The
van wrecks scale and silhouette. Saturday 15:20 would have bodies on this
corner and a Cub at the kissa jamb.

### `hardware-v5.png` — **two shops in a field. Score 2/10.**

Landmark `hardware` `{ x: -34, z: 8, yaw: π }`.

Yamato kanagu (centre) and Kamimura (right) are the best boxy matches in the
set. That is the problem: they read as **isolated products**. West of hardware
is olive height-field (Route 16 / hill toe, no south-or-west closer). Between
hardware and tobacco the Suzume house and grey skyline cubes show through the
slit. No south-row counterpart in frame. No Cub, no ポスト, no person. West
Sakae is a couple of stills stood on grass.

### `soba-v5.png` — **three shops, two holes. Score 2/10.**

Landmark `soba` `{ x: -17, z: 8, yaw: π }`.

Kamimura / Nishiya / Yaoya as a broken colonnade. The tobacco–soba slit
(`3.2 m`) dumps to a cloned hill house, stone stairs, and sky. Grey
`gap fill` boxes (`z = −10.5`) sit **behind** the lot line, so they never
plug the street-front hole they were meant for. Yaoya’s roof is a chewed
white mass. Hardware peeks left; pharmacy peeks right. Again: a north wall
photographed from an empty south sidewalk.

**None of the eight is a full world.** Best case (`street-east`, `kissa`) is a
one-sided corridor of reconstructed props. Worst case (`seawall`, `hill`) is
empty geometry plus a lighting/skyline bug. Film-set tells: (1) you can see
the next district through the set, (2) sky = ground colour at the vanishing
point, (3) sidewalks have kit (pole, enamel) but no occupation, (4) identical
houses/Hiros.

---

## 2. Do reconstructed hulls MATCH the magenta stills?

| asset | still | v5 hull | verdict |
|---|---|---|---|
| `pharmacy` | Boxy mint-tile 2F, complete eaves, 港町薬局 fascia, packed windows, AC + blue bucket on roof | Swiss cheese: holes through fascia, upper window, corner; interior void; roof ridge collapsed | **FAIL. The holes are the shot.** Magenta volume is a closed box; reconstruction carved air. |
| `kei-van` | Square Carry: chrome grille, yellow 品川 plate, blue waist stripe, box cargo, round lamps, wheels | Melted loaf on the zebra; no wheels; roof crater; stripe smeared; sits like a boat | **FAIL. Not a van. Potato.** `kind: "rectangle"` was the right cheat and the hull still went organic. |
| `hardware-shop` | Ochre 2F, tiled eaves, paint-can window, 金物 noren, laundry on the balcony | Readable box, cans and noren survive, eaves a little chewed | **PASS-ish.** Best shop match. Keep; do not instance. |
| `tobacco-shop` | Yellow-brick たばこ, magazine rack, upstairs laundry | Boxy, fascia readable in `street-east` / `soba-v5` | **PASS-ish.** |
| `soba-shop` | Cream kirizuma, ラーメン fascia, blue 中華そば noren, striped flag | Box holds; gable flattened; flag gone; windows smeared | **PARTIAL.** Recognisable, not the still. |
| `kissaten` | Dark timber 2F, 喫茶みはる, lace curtains, 港風 noren, coffee enamel | Box holds in `kissa-v5`; mass matches | **PASS.** Strongest building. |
| `barber-shop` | Cream plaster, candy pole, two yellow chairs in the window | Boxy cream, chairs readable, pole fused | **PASS-ish.** Pole is the silhouette that must stay rectangle. |
| `flower-shop` | Mint clapboard, 花屋みどり, striped awning, pots | In `street-east` we see the **west gable**, not the front. Isolated in a field. Hull is boxy enough; placement is the fail. | **HULL OK, WORLD FAIL.** |
| `you-arcade` | Mosaic 2F, ファミリーゲーム / SPACE | Boxy mosaic in `sakae-v5`, better than pharmacy | **PARTIAL.** Corners round off. |
| `greengrocer` | Produce stall under noren | Stall OK; roof is a white chewed mass | **PARTIAL.** |
| `yokobori-bar` | Dark timber, vertical 銀河酒場, たこ焼き noren, GALAXY roof box | Mass and noren read in `yokobori-v5` / `kissa-v5`; corners soft | **PARTIAL.** Hero prop, no alley to belong to. |
| `wooden-hill-house` | Clean timber 2F, tiled kirizuma, 玄関 noren, CMU planter | Melted cliff in `hill-v5`; windows smeared; **four clones** of the same scar | **FAIL as a cluster.** Unique still is a house; instances are copy-paste potatoes. |
| `harbor-warehouse-8` | Sharp corrugated gable, 倉42, sliding doors | Layered pancake / potato in `seawall-v5`; lettering mush | **FAIL.** Still is a rectangle shed. Hull is custom mush. |
| `harbor-warehouse-3` | Wider timber/iron shed | Same melt family | **FAIL.** |
| `honda-cub` | Red Cub, crate on the rack, kickstand | **Not visible in any v5.** Unique sits at `(−14.6, −6.35)` — sidewalk, but no shot frames it. | **UNTESTED in v5 / under-planted.** |
| `city-bus` | Cream/green 南浜 bus | **Not in any v5.** Unique at `(−40, 22)` is behind `street-east` camera. | **UNTESTED in v5.** |
| `vending-enamel` / `telephone-pole` | Box / cylinder stills | Machines read; poles read as sticks | **PASS as kit.** Wires do not. |
| `english-oak` | Broad oak | Grid of 13 identical trees; not in `hill-v5` as a park, only as missing | **OVER-cloned, under-composed.** |

**Rule the v5 shots prove:** rectangle stills that stay boxy (hardware, tobacco,
kissa, barber) sell the street. Rectangle stills that the reconstructor treated
as organic (pharmacy holes, van potato, warehouse pancakes, hill-house melt)
destroy it. Do not plant more unique shops until pharmacy / van / warehouse
hulls are forced back onto the box.

Pharmacy holes are not “weather.” The magenta side (`yaw-090`) is a closed
tile wall. The mesh has **see-through cavities** at the fascia, the upper
right window, and the corner — voxel dropouts, not dirt.

---

## 3. Ranked missing things, by district

Rank is “closes the largest Ch.1-feel hole per still.” Do **not** instance
unique shop façades. Names are Minamihama originals, not Dobuita clones.

### sakae (Sakae-dori, 80 × 18, origin 0,0)

North row is ~42 m of frontage on an 80 m street (~50 %). South row is
flower `−13.3…−6.7` + barber `2.9…9.1` + kissa `11.0…17.0` ≈ **19 m / 80 m
= 24 %**. That is the district.

1. **South-row unique shops** (the `street-east` right-slab). Until these
   exist, west Sakae is a one-wall corridor.
   - `yamaguchi-denki` 電気屋 — **−26.8, 8.6, π** — fills the enamel-to-Midori
     void.
   - `minato-sakaya` 酒販 — **−18.4, 8.6, π**.
   - `horiuchi-tokei` 時計・印鑑 — **−1.9, 8.6, π** (Midori–barber 9.6 m hole).
   - `sato-sakana` 魚屋 — **−34.0, 8.6, π** (west of denki, Route 16 T).
2. **North-row east closer** — `kaihin-bunbogu` 文具 at **31.0, −8.5, 0**
   (19 m of nothing east of records). Optional `kome-ya` 米屋 at **24.2, −8.5, 0**.
3. **North-row party-wall uniques in the 3 m slits**, not grey boxes behind
   the lot line: tobacco–soba (`x ≈ −21.8`) and Yaoya–pharmacy (`x ≈ −4.8`)
   need 2-storey shops (or a forced-box `gap fill` at **`z = −8.5`**, not
   `−10.5`). Current `addGapFill` sits at `z = −10.5` and **misses every v5
   hole**.
4. **Honda Cub / mamachari every 1–2 bays** (asset exists).
5. **Parked kei vans in the 停車帯** (`z ≈ 3.2–3.6`), not one Carry on the
   zebra.
6. **Second and third humanoids** (Watanabe overcoat, shop lady, school kid).
   Stop cloning Hiro (agent 49). Four identical blazers is worse than empty.
7. **Wires that read** — thicken to `r ≥ 0.04`, add **cross-street** droops
   north curb ↔ south curb, drop a slack span in front of pharmacy / arcade.
8. **看板 / 赤提灯 / sandwich boards** that occupy the sidewalk volume, not
   only paint on the hull.
9. **Red ポスト, hydrant, manhole ring, puddle cards, oil stain.**
10. **交番** at the Route 16 T (west Sakae closer) and a **銭湯** chimney as
    the east-block skyline instead of grey cubes.
11. **Street lamps** (not only NTT poles).
12. **Cats, bikes on kickstands, a newspaper stack, a crate of bottles at
    the kissa door.**

### yokobori (alley, live floor `18…42 × 10…28`)

1. **Opposite wall.** A 横丁 has two faces. `snack-akane` スナック at
   **19.2, 22.0, π/2** (faces east into a 4 m lane). Maybe `shokudo-umi`
   食堂 south of Galaxy.
2. **Shrink the readable lane to ~4 m** (`x ≈ 18…22.5`). The unused east
   court can take a service wall / second bar back, not stay a plaza that
   reveals Amihama.
3. **Beer-crate unique** (`beer-crates`) against Galaxy’s west/south walls.
4. **Dormant 赤提灯** and a blade 看板 over the lane (neon off, 15:20).
5. **Watanabe** (overcoat, weight on one leg) at the mouth **(22.4, 11.6)**.
6. **Drain strip + standing water** down the lane.
7. **Do not let warehouses be the alley’s vanishing point.** A south closer
   (wall, noren, or parked Cub) at `z ≈ 26`.

### suzume (hill 40 × 36, origin −28, −36)

1. **Stop instancing `wooden-hill-house`.** Five copies of one melted hull
   is the `hill-v5` crime. Unique #2 `kogure-house` and #3 `endo-house`
   with different roofs / plan.
2. **石垣 / ブロック塀** along the stairs (`x ≈ −24` and `−16`, `z −14…−28`).
3. **Fix the black plane in `hill-v5`** — skyline block / ridge is in camera
   at `hill` `{ −36, −35 }`. Move far boxes to `z ≤ −48` or `x > −20`.
4. **Hill path that sits on `groundHeight`**, not a buried card.
5. **Genkan clutter:** Cub, 郵便受け, planter (already in the still — do not
   duplicate on the unique; add on the *new* houses).
6. **Vending + pole at the stair head** `(−20, −12.8)`.
7. **地蔵 / park bench / winter shrub**, not a 4×3 English-oak orchard.
8. **Break the oak grid.** Keep 4–6, vary yaw, pull off the house plots.

### amihama (docks 90 × 50, origin 0, 64)

1. **Fishing boat / 漁船** at the wall (`x ≈ −8, z ≈ 92` in water, or a
   hull tied at the face). Without a boat this is a parking lot.
2. **Near-field dock clutter in the `seawall` frustum** (`x −36…−20`,
   `z 82…86`): `crate-stack`, `oil-drum`, rope coil, pallet. Current piles
   sit at `z ≈ 78–83` **inland of the look**.
3. **Quay worker unique** (different silhouette from Hiro).
4. **Ice house / 魚市場** unique shed, not a fourth Warehouse 8.
5. **Forklift or 2-ton truck** on the truck lane (`x ≈ 0, z ≈ 60`).
6. **Mooring lines + rope coil** at existing bollards (`x −40…40` step 16).
7. **Willows on the water side of the cap** (`z ≈ 87–89` is water — plant
   at `z ≈ 85.5` *between* sheds and wall, not only at `z = 84` behind the
   camera).
8. **Force warehouse hulls back to rectangle.** Three potato sheds in a
   line still look like three potatoes.
9. **Water that is not sky.** Darker, lower (`y ≈ −2.2` per agent 11),
   a breakwater or far quay so the basin has a closer.
10. **Nets / floats / カゴ** — unique if ≥ 0.7 m fused; else skip (48³ blob).

### route16 (strip 24 × 80, origin −48, 8)

`GROUND.route16Road / Quay / Lot / Walk` exist. Catalog occupation is
**one bus**. `street-east` / `hardware-v5` look *away* from it, so the T
reads as olive field.

1. **Bus-stop pole + timetable + bench** at **(−35.4, 16.5)** (town-side
   walk). Optionally a tiny shelter unique.
2. **`phone-booth` clone** at the stop **(−35.2, 14.2, π/2)**.
3. **`vending-enamel` pair** at the stop.
4. **`telephone-pole` N–S beat** every ~20 m on `x ≈ −36.2`, `z = 16, 36, 56`.
5. **`kei-van` in the lot** at the three bays **(−29.6, 24.4 / 27.6 / 30.8)**.
6. **Guardrail / W-beam** on the west verge (`x ≈ −47`).
7. **T-junction zebra** where Route 16 meets Sakae (`z ≈ 10`, `x −46…−36`).
8. **ガソリンスタンド** unique (1986 two-bay, not a modern canopy) at
   **(−30, 40)** — the south closer `hardware-v5` does not have.
9. **Highway 16 enamel blade** on a pole.
10. **Do not leave the bus as the only vertical on a 80 m strip.**

---

## 4. What already exists but is under-instanced

Counts = `ORBIT_SUBJECTS` unique + `INSTANCES` clones. Do **not** clone
shop façades, hill houses, or Hiro.

| asset | now | Ch.1 feel | action |
|---|---:|---|---|
| `honda-cub` | **1 / 0 clones** | 8–15 town-wide | **Hottest kit.** Clone to every other bay. Unique stays at `(−14.6, −6.35)`. |
| `kei-van` | **1 / 0** | 3–6 parked | Unique is on the zebra in `kissa-v5` — **move unique off the crosswalk**, then clone into 停車帯 + Route 16 lot. |
| `phone-booth` | **1 / 0** | 2–3 | Clone at Route 16 stop + dock gate. |
| `crate-stack` | **6** | 12–20 | 4 dock + 1 alley + 1 Yaoya. Need seawall *foreground*, kissa door, hardware spill. |
| `oil-drum` | **5** + primitive drums | 10–15 visible | Seawall near field (`x −32…−24, z 84`). Primitives at warehouse corners are invisible from `seawall-v5`. |
| `vending-enamel` | **8** | 12–18, often **pairs** | Pair at stair head, bus stop, kissa jamb, dock gate. |
| `zelkova` | **7** | winter street trees both curbs | Unique is at **`(−20, −6.7)`** — on the north walk, easy to eat a façade. South curb has 3; west south-row void has **0** (that is why `street-east` right slab is bald). |
| `steel-bin` | **9** | OK as kit | Add Yokobori mouth + dock. Fine. |
| `telephone-pole` | **14** | 16–24 + **wires** | Count is near OK. **Wires fail.** Add Route 16 N–S and cross-street spans. |
| `harbor-warehouse-8` | **3** | 6–8 large shells | One more only if a clear pad (west of W8-W or east of W8-E). Do not overlap W3. |
| `weeping-willow` | **7** | waterline trees | Relocate toward the cap; current line is behind warehouses relative to `seawall`. |
| `city-bus` | **1 / 0** | 1 on the stand | Do not clone the same bus. Optional second unique (parked, different livery) later. |
| `civilian-hiro` | **4** | 12–25 **different** bodies | **Over-instanced already.** Wait for Watanabe / quay worker. |
| `wooden-hill-house` | **5** | 4–8 **different** houses | **Over-instanced.** Delete clones; new uniques. |
| `english-oak` | **13** | a grove, not a grid | Thin to ~6. Over-instanced. |
| `flower-shop` `barber-shop` `kissaten` `soba-shop` … | 1 each | 1 each | Correct. Never clone. |

Assets on disk, in catalog, **absent from every v5 frame:** `honda-cub`,
`city-bus`, most `zelkova`, most `english-oak`, most dock `crate-stack` /
`oil-drum` (wrong side of camera), `phone-booth` (speck at best).

---

## 5. Concrete placement suggestions

Yaw in radians. Sit on `groundHeight`. Keep travel lanes `z ∈ [−6, 6]` clear
except parked 停車帯 (`z ≈ 3.3`) and the unique van once it is a van.

### 5.1 Existing kit — plant now (no new stills)

```js
// --- honda-cub (unique stays -14.6, -6.35, π/2) ---
{ asset: "honda-cub", x: -31.4, z: 6.55, yaw: Math.PI / 2 },     // street-east right walk, west of enamel
{ asset: "honda-cub", x: -23.8, z: -6.45, yaw: -Math.PI / 2 },  // Kamimura jamb
{ asset: "honda-cub", x: -6.2,  z: 6.55, yaw: Math.PI / 2 },     // Midori west
{ asset: "honda-cub", x: 11.2,  z: 6.55, yaw: Math.PI / 2 },     // kissa west / barber east
{ asset: "honda-cub", x: 22.8,  z: 11.8, yaw: 0 },               // Yokobori mouth
{ asset: "honda-cub", x: -19.2, z: -13.4, yaw: 0.2 },            // Suzume stair head
{ asset: "honda-cub", x: -8.4,  z: 62.5, yaw: Math.PI / 2 },     // harbor-gate

// --- kei-van: MOVE unique off the zebra, then clone ---
// unique should leave (14.5, 3.4); kissa-v5 currently photographs a potato on paint.
{ asset: "kei-van", x: -8.0,  z: 3.35, yaw: -0.12 },            // 停車帯, street-east mid
{ asset: "kei-van", x: 4.2,   z: 3.4,  yaw: 0.08 },             // 停車帯, barber front
{ asset: "kei-van", x: -29.6, z: 24.4, yaw: Math.PI / 2 },      // route16 lot bay
{ asset: "kei-van", x: -29.6, z: 30.8, yaw: Math.PI / 2 },      // route16 lot bay

// --- phone-booth (unique 16.5, 6.8, π) ---
{ asset: "phone-booth", x: -35.2, z: 14.2, yaw: Math.PI / 2 },  // route16 stop
{ asset: "phone-booth", x: -6.5,  z: 50.5, yaw: 0 },            // harbor-gate

// --- vending-enamel ---
{ asset: "vending-enamel", x: -20.8, z: -12.6, yaw: 0 },        // stair head pair
{ asset: "vending-enamel", x: -19.2, z: -12.6, yaw: 0 },
{ asset: "vending-enamel", x: -35.5, z: 17.2, yaw: Math.PI / 2 }, // bus stop
{ asset: "vending-enamel", x: 16.9,  z: 6.7,  yaw: Math.PI },   // kissa east jamb
{ asset: "vending-enamel", x: -2.0,  z: 50.8, yaw: 0 },         // dock gate

// --- crate-stack / oil-drum into seawall-v5 near field ---
{ asset: "crate-stack", x: -30.0, z: 84.2, yaw: 0.25 },
{ asset: "crate-stack", x: -24.5, z: 83.6, yaw: 1.1 },
{ asset: "crate-stack", x: 15.2,  z: 6.9,  yaw: 0.3 },          // kissa bottles stand-in
{ asset: "crate-stack", x: -36.6, z: -6.5, yaw: 0.1 },          // hardware spill
{ asset: "oil-drum",    x: -32.4, z: 84.8, yaw: 0.4 },
{ asset: "oil-drum",    x: -28.8, z: 85.1, yaw: 1.6 },
{ asset: "oil-drum",    x: -22.0, z: 83.9, yaw: 0.2 },

// --- telephone-pole Route 16 ---
{ asset: "telephone-pole", x: -36.2, z: 16, yaw: 0 },
{ asset: "telephone-pole", x: -36.2, z: 36, yaw: 0 },
{ asset: "telephone-pole", x: -36.2, z: 56, yaw: 0 },

// --- zelkova into the street-east south void (until south-row shops exist) ---
{ asset: "zelkova", x: -24.0, z: 10.3, yaw: 0.6 },
{ asset: "zelkova", x: -16.0, z: 10.3, yaw: 1.4 },

// --- steel-bin ---
{ asset: "steel-bin", x: 22.1, z: 12.2, yaw: 0.4 },             // Yokobori mouth
{ asset: "steel-bin", x: -34.0, z: 84.4, yaw: 0 },              // seawall

// --- warehouse-8 extra only if pad stays clear of W8-W AABB ---
{ asset: "harbor-warehouse-8", x: 48, z: 70, yaw: Math.PI },    // east of W8-E; clip-check vs dock maxX=48
```

**Move / delete (not new plants):**

| what | now | do |
|---|---|---|
| `kei-van` unique | `14.5, 3.4, −0.18` on the zebra in `kissa-v5` | **`12.2, 3.35, −0.15`** (停車帯, not the crosswalk) once the hull is a van |
| `wooden-hill-house` instances | `(−38,−40)`, `(−38,−22)`, `(−10.5,−30)`, `(−42,−30)` | **Remove.** `hill-v5` is a clone army. |
| `civilian-hiro` instances | `(8,−6.8)`, `(−16,6.8)`, `(0,64)` | Cap at **one** extra, back to camera, or **zero** until a second unique. |
| `addGapFill` boxes | `z = −10.5` | Slide to **`z = −8.5`** (street lot line) or they will never appear in sakae/soba/hardware v5 holes. |
| `english-oak` grid | 12 clones on a 10 m lattice | Keep unique `(−32,−44)` + 5 clones max; drop the `z = −18` row that fights the shop backs. |
| skyline block near `hill` camera | `{ x: −36, z: −24.5 }` and ridge | Push **`z ≤ −48`** so `hill-v5` is not a black flag. |

### 5.2 New uniques (stills required) — first plants

Metres `H × W × D`. Rectangle-4 unless noted.

| id | district | x | z | yaw | metres | why / which v5 |
|---|---|---:|---:|---|---|---|
| `yamaguchi-denki` | sakae | **−26.8** | **8.6** | π | 6.8 × 6.4 × 7.4 | `street-east` right slab |
| `minato-sakaya` | sakae | **−18.4** | **8.6** | π | 6.8 × 6.6 × 7.6 | same |
| `sato-sakana` | sakae | **−34.0** | **8.6** | π | 6.6 × 6.2 × 7.2 | `hardware-v5` west field |
| `horiuchi-tokei` | sakae | **−1.9** | **8.6** | π | 6.6 × 6.4 × 7.2 | Midori–barber hole |
| `kaihin-bunbogu` | sakae | **31.0** | **−8.5** | 0 | 7.0 × 7.0 × 7.4 | east closer |
| `snack-akane` | yokobori | **19.2** | **22.0** | π/2 | 6.4 × 4.8 × 7.2 | opposite alley wall |
| `kogure-house` | suzume | **−38.0** | **−22.0** | 0.35 | 6.8 × 7.4 × 7.0 | replace hill-house clone |
| `endo-house` | suzume | **−10.5** | **−30.0** | −1.2 | 7.0 × 7.8 × 7.2 | replace clone |
| `amihama-ubune` | amihama | **−10** | **93.5** | 0.2 | 2.4 × 3.2 × 9.0 custom-8 | boat in `seawall` water |
| `rope-coil` | amihama | **−36.5** | **86.0** | 0.3 | 0.55 × 1.1 × 1.1 | seawall foreground |
| `minamihama-kojo` | route16 | **−35.4** | **16.5** | π/2 | 2.6 × 1.8 × 1.2 | bus shelter |
| `watanabe` | yokobori | **22.4** | **11.6** | −0.4 | 1.70 × 0.55 × 0.38 humanoid-8 | alley mouth, `yokobori-v5` |
| `quay-worker` | amihama | **−26.0** | **83.5** | 1.4 | 1.68 × 0.52 × 0.34 humanoid-8 | `seawall-v5` |

Forbidden still language: Abe, Tomato, You Arcade, Dobuita shop names,
US barber pole as English `BARBER` hero type, 7-Eleven.

### 5.3 Hull-force before more density

Planting more shops on top of pharmacy holes and a potato van will multiply
the scar. Before the south-row stills land:

1. **Force `pharmacy` to rectangle.** Closed volume. No through-holes. Match
   `yaw-000` mint box and `yaw-090` tile gable.
2. **Force `kei-van` to rectangle.** Wheels, box cargo, blue stripe, grille.
   If reconstructor cannot hold a Carry, do not instance it.
3. **Force `harbor-warehouse-8` / `-3` to rectangle.** Corrugated gable, not
   pancake layers.
4. **Force `wooden-hill-house` to rectangle** and **delete the four clones**.
5. **Slide `addGapFill` to `z = −8.5`** so sakae/soba/hardware v5 slits close
   even before new stills.

---

## Coverage vs the eight shots (after §5.1)

| still | what §5.1 changes | still missing without new stills |
|---|---|---|
| `street-east-v5` | Cubs + van + zelkovas on the right slab | south-row shops (the actual wall) |
| `sakae-v5` | gap-fill at `z = −8.5` kills the olive punch | pharmacy holes, people, south curb |
| `soba-v5` | same gap-fill in tobacco–soba slit | unique infill shop |
| `hardware-v5` | hardware spill crate, west Cub, fish-shop later | Route 16 closer, south row |
| `kissa-v5` | van off zebra, Cub at jamb, crate | people; van hull |
| `yokobori-v5` | Cub + bin at mouth | opposite wall, beer crates unique |
| `seawall-v5` | crates/drums in `x −32…−24, z 84` | boat, worker, warehouse hulls |
| `hill-v5` | delete house clones, move skyline | second unique house, 石垣, black-flag fix |

Until south-row uniques, a boat, and hull-force on pharmacy/van/warehouse,
Minamihama remains a **kit of 1986 props arranged as corridors**. That is
the honest read of every v5 capture.
