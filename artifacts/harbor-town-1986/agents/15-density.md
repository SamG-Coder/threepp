# 15 — Catalog density vs Shenmue Ch.1 feel

Plan only. Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Town is **Minamihama** (Sakae-dori, Yokobori, Suzume-zaka, Amihama, Route 16).
Match Dobuita / Sakuragaoka / New Yokosuka Harbor *feel* — wall-to-wall
2-storey shops, hill houses in a cluster, dock clutter, Saturday sidewalk
life. Do **not** clone named shops, people, or brands from Yokosuka.

Convention (`map.mjs`, `TOWN.md`, agent 10): `+X` east, `+Z` south. **Yaw `0`
faces south (`+Z`)**, `Math.PI` faces north, `-Math.PI / 2` faces west,
`Math.PI / 2` faces east. Local `+Z` on a reconstructed mesh is the yaw-000
front still.

View counts from `TOWN.md` / `catalog.mjs`:

| kind | stills | catalog |
|---|---|---|
| rectangle | 4 cardinals | `CARDINAL_VIEWS` |
| cylinder | 2 (0° / 90°) | `CYLINDER_VIEWS` |
| custom | 8 at 45° | `HUMANOID_VIEWS` |
| humanoid | 8 at 45° | `HUMANOID_VIEWS` |

---

## What is on the ground today

15 unique `ORBIT_SUBJECTS` + 10 `INSTANCES` = **25 planted meshes**.
Geo only: 12 stone steps, centreline dashes, one thin quay wall, height field.
`sakae.png` is black (agent 18). Live evidence is `sakae-north.png` and
`arcade.png`.

North-row shop fronts, all `z = -8.5`, `yaw = 0`:

| shop | x | w | x-span | gap after |
|---|---:|---:|---|---:|
| Kamimura tobacco | −25 | 6.4 | −28.2 … −21.8 | 4.6 m |
| Nishiya soba | −14 | 6.4 | −17.2 … −10.8 | 3.7 m |
| Yaoya | −4 | 6.2 | −7.1 … −0.9 | **4.9 m** ← `sakae-north.png` |
| Starlight Arcade | 8 | 8.0 | 4.0 … 12.0 | 4.6 m |
| Minato-machi records | 20 | 6.8 | 16.6 … 23.4 | 16.6 m to x=40 |

South row is **one** shop (Midori florist at `−6, 8.6`). Yokobori is **one**
bar. Suzume is **one** timber house. Amihama is two warehouse uniques + two
Warehouse 8 copies. Route 16 has **zero** tagged subjects. People: Hiro
only. Vehicles: one Suzuki Carry. No scooters, bikes, crates, drums,
lanterns, trees, bus, or crane.

`sakae-north.png` (`go: sakae`, camera `0, 1.5`, yaw `π`, looking north):
Yaoya left, arcade side-wall right, then khaki height-field and
`0x8aa0b4` sky. Agent 24’s cheap skyline boxes fill the *far* void
(`z ≈ −24`). They do **not** replace a shop on the street line.

`arcade.png`: green booth, distant warehouse, empty asphalt. The walk from
Sakae (`z ≈ 12`) to dock (`z = 52`) is ~40 m of nothing.

---

## Feel gap (Ch.1, not a clone)

Ch.1 Yokosuka at this hour is dense at **arm’s length**: party-wall shops,
vending in pairs, a pole every ~20 m, a cub or mamachari every shop or two,
crates at the greengrocer and the quay, two or three people in every street
shot, a second house when you turn on the hill. Empty sky between two
facades is the tell that this slice is still a diorama.

| layer | Ch.1 feel / 80 m street | Minamihama now | ratio |
|---|---|---|---|
| North-row shop fronts | ~90 % party wall | 33.8 m / 80 m = 42 % | 0.5 |
| South-row shop fronts | ~80 % | 6.6 m / 80 m = 8 % | 0.1 |
| Hill houses | 4–8 in a cluster | 1 in 40 × 36 m | 0.15 |
| Harbor large shells | 6–10 | 4 poses (2 unique) | 0.5 |
| Vending | 12–18, often pairs | 4 | 0.25 |
| Poles | 16–24 | 6 | 0.3 |
| Scooters / bikes | 8–15 | 0 | 0 |
| NPCs in frame | 12–25 town-wide | 1 | 0.08 |
| Crates / drums | 15–40 | 0 (Yaoya crates are baked into the still) | 0 |
| Route 16 | bus + stop + lot | empty strip | 0 |

Do **not** instance shop buildings. Identical facades kill the shopping-street
read. Repeat **poles, vending, warehouses** (and, once they exist, cub,
mamachari, crates, drums, lanterns).

Agent 13: unique hulls already ~687k tris; each new rectangle shop is another
50–70k. Instancing is the cheap density.

---

## Must-have unique meshes still missing (ranked)

Rank is “closes the largest Ch.1-feel hole per still”. Names are Minamihama
originals. Metres are `realHeight × realWidth × realDepth` as in `catalog.mjs`.

### 1. Kikuchi tokoya — barber

The hole in `sakae-north.png`. Ch.1 streets always have a tokoya; Sakae has
none. Sits in the Yaoya–Arcade gap (`x −0.9 … 4.0`). Agent 24 box #1
(`1.8, −24`) stays **behind** this shop as the next block.

| | |
|---|---|
| id / folder | `kikuchi-tokoya` |
| label | Kikuchi tokoya |
| kind / views | **rectangle**, 4 |
| metres | **6.6 × 4.2 × 6.8** |
| district | sakae |
| x, z, yaw | **1.55, −8.5, 0** |

Narrow 2-storey plaster, candy-stripe pole fused to the corner (do not split
the pole into its own cylinder — it would vanish at 48³). Front faces the
street (south). Occupies `x −0.55 … 3.65`; 0.35 m to Yaoya, 0.35 m to
Arcade — party-wall tight, same as Dobuita slits.

Forbidden still language: “Abe’s Barber”, red-white-blue US pole, English
`BARBER` as the hero word. Noren / enamel in Japanese, family Kikuchi.

### 2. Wakaba pharmacy — drugstore

Second missing street type (the white enamel cross, drug boxes in the
window, night-shutter rail). Fills the dead west end of the north row,
at the Route 16 T.

| | |
|---|---|
| id / folder | `wakaba-pharmacy` |
| label | Wakaba pharmacy |
| kind / views | **rectangle**, 4 |
| metres | **7.0 × 6.6 × 8.0** |
| district | sakae |
| x, z, yaw | **−34.2, −8.5, 0** |

Occupies `x −37.5 … −30.9`. 2.7 m to Kamimura (`−28.2`) — leave that slit
for a pole + vending, not a third shop. Stairs (`x = −20`) are 12 m east;
no overlap. Not a convenience clone, not “Tomato”.

### 3. Kogure house — second hill house

Suzume-zaka is one house in a 40 × 36 m hill. Sakuragaoka feel is a **cluster**
you turn between, not a lone hero. Do **not** instance `wooden-hill-house`:
agent 02’s hull is a 1324-tri remnant, and identical timber twins read as
copy-paste. New stills, slightly smaller, different roof.

| | |
|---|---|
| id / folder | `kogure-house` |
| label | Kogure house |
| kind / views | **rectangle**, 4 |
| metres | **6.8 × 7.4 × 7.0** |
| district | suzume |
| x, z, yaw | **−9.2, −27.0, −0.45** |

East of the stone stairs, downhill of the first house, facing the path.
Plan `x ≈ −12.9 … −5.5`, `z ≈ −30.5 … −23.5`. Clear of: house 1
(`−28, −34`), path (`x −24 … −16`), stairs (`x = −20 ± 3.25`,
`z −12.4 … −24`), skyline #7 (`−8.2, −34`) and #10 (`−15.5, −40`).
`plantMesh` must use agent 21’s min-corner seat — origin sampling will
hover/bury this one too.

Not Ryo’s house, not Ine-san, no “Hazuki” nameplate.

### 4. Street cub scooter

The 1986 sidewalk signature. Super Cub silhouette, cream with a faded
blue seat. `TOWN.md`: parked scooters are **custom**. One unique, then
instance along curbs.

| | |
|---|---|
| id / folder | `street-cub` |
| label | Street cub |
| kind / views | **custom**, 8 |
| metres | **1.02 × 0.67 × 1.82** |
| district | sakae |
| x, z, yaw | **5.4, −5.7, 1.25** |

North sidewalk, in front of Starlight’s west bay, angled to the curb.
Clear of the Carry (`4.2, 3.8`) and Hiro (`−8.5, −5.2`). Yaw-000 = front
wheel / headlamp. Kickstand down, no rider (Hiro is already the standing
kid). Real product language is fine (the van is already a Suzuki Carry)
but do not letter “Dobuita” on the number plate — use a Kanagawa 湘南 plate
ending in a made-up みなみはま code.

### 5. Sakae-nishi bus stop

Route 16 exists in `TOWN.md` and the nav stub and is empty. Agent 27
already drafted this as **boxes** at `(-35.2, 18.5)`. Upgrade to a
magenta-studio unique (same job as the green phone booth): one photoreal
shelter+blade. If the box shelter already ships, skip this unique and
spend the stills on **#12 city-bus** instead.

| | |
|---|---|
| id / folder | `sakae-nishi-stop` |
| label | Sakae-nishi bus stop |
| kind / views | **custom**, 8 |
| metres | **3.2 × 2.8 × 1.5** |
| district | route16 |
| x, z, yaw | **−35.2, 18.5, −Math.PI / 2** |

Opening faces the road (west). Green enamel blade, cream posts, timber
bench fused into the still — one connected silhouette, no magenta under
the roof. Destination **南浜** / **Sakae-nishi**, not Yokosuka / Dobuita.
Do not generate a 10 m bus out of this mesh.

### 6. Dock crate stack

Amihama is four warehouse poses on a bare apron. Yaoya’s crates are
painted onto the facade, so they do not sit on the sidewalk. One
`1.2 m` wooden stack, then instance. Agent 10’s Yokobori beer-crate
*boxes* can be replaced by an instance of this once it exists.

| | |
|---|---|
| id / folder | `dock-crates` |
| label | Dock crate stack |
| kind / views | **rectangle**, 4 |
| metres | **1.35 × 1.20 × 1.15** |
| district | amihama |
| x, z, yaw | **−18.2, 62.2, 0.15** |

Against Warehouse 8’s north face (unique WH8 AABB `x −19 … −5`,
`z 63 … 81`). Two-by-two timber produce/fish crates, stencilled
**南浜** / **8号**, rope, no plastic.

### 7. Mamachari bicycle

Housewives’ 1986 shopping bike. Custom, instanceable. Pairs with the cub
so the curb is not all one vehicle.

| | |
|---|---|
| id / folder | `mamachari` |
| label | Mamachari |
| kind / views | **custom**, 8 |
| metres | **1.05 × 0.58 × 1.72** |
| district | sakae |
| x, z, yaw | **−10.8, −5.6, 1.52** |

North sidewalk in the 3.7 m Nishiya–Yaoya slit, parallel to the curb,
front wheel east. 3.3 m west of Hiro. Rear basket empty or one daikon —
no modern plastic crate.

### 8. Watanabe — drunk salaryman

Hiro is a standing school blazer. Saturday 15:20 needs a second body
language: loosened tie, overcoat, weight on one leg. Not a named
Dobuita drunk, not a sailor.

| | |
|---|---|
| id / folder | `civilian-watanabe` |
| label | Watanabe |
| kind / views | **humanoid**, 8 |
| metres | **1.65 × 0.58 × 0.42** |
| district | yokobori |
| x, z, yaw | **21.5, 13.2, −1.15** |

Alley mouth, hugging Galaxy’s north gable once the bar faces west
(agent 10: front plane `x ≈ 22.3`). Out of the 3.5 m walk slot
(`x 18 … 22.3`). Visible from Sakae-east looking south. Slumped 7 cm
shorter than Hiro so the hull does not stretch to a standing bbox.

### 9. Suzume tōrō — stone lantern

Sakuragaoka hill language: stone stairs already exist as geo; they
need a lantern at the top so the climb is a place, not a texture.
Kasuga-form, irregular → **custom**, not a cylinder.

| | |
|---|---|
| id / folder | `suzume-toro` |
| label | Suzume tōrō |
| kind / views | **custom**, 8 |
| metres | **1.68 × 0.52 × 0.52** |
| district | suzume |
| x, z, yaw | **−16.4, −24.8, 0** |

East flank of the stair head (stairs are `x = −20 ± 3.25`). Pair with
one instance on the west flank (exact pose in the instance list).
Moss, winter, no shrine nameplate, no vermilion.

### 10. Kissa Minato — south-row kissaten

South row is 8 % coverage. Barber + pharmacy both go **north**; without
this, `arcade.png`-style south views stay empty. 1986 kissaten, not a
cafe chain.

| | |
|---|---|
| id / folder | `kissa-minato` |
| label | Kissa Minato |
| kind / views | **rectangle**, 4 |
| metres | **6.9 × 6.6 × 7.6** |
| district | sakae |
| x, z, yaw | **8.2, 8.6, Math.PI** |

Faces north into Sakae, directly across from Starlight. Occupies
`x 4.9 … 11.5`. Clear of Midori (`−9.3 … −2.7`), booth (`2.4, 6.2`),
vending instance (`12.4, 6.8`), Carry (`4.2, 3.8` in the street).
Wood interior tungsten leaking through the glass; noren `港`.

### 11. Oil drum

`TOWN.md` cheat-sheet: drum = **cylinder**. Harbor beat. Tiny unique,
then instance.

| | |
|---|---|
| id / folder | `oil-drum` |
| label | Oil drum |
| kind / views | **cylinder**, 2 |
| metres | **0.88 × 0.58 × 0.58** |
| district | amihama |
| x, z, yaw | **18.6, 64.0, 0** |

North of Warehouse 3 (`16, 70`). Rust, faded red, 南浜 stencils. Yaw 0
is enough (2-view cylinder).

### 12. City bus

Agent 27’s next unique if the stop stays boxes — still worth doing
*with* a photoreal stop, because the strip has no large object. Boxy
1986 city bus (Isuzu Cubic / Fuso MK class).

| | |
|---|---|
| id / folder | `city-bus` |
| label | Kanachu city bus |
| kind / views | **rectangle**, 4 |
| metres | **3.05 × 2.49 × 10.4** |
| district | route16 |
| x, z, yaw | **−38.2, 19.5, 0** |

Southbound layover in the bay agent 27 painted. Grille faces +Z.
Blind **南浜** / **Amihama**. ≥0.4 m from the kerb, ≥1 m from the
shelter posts. Do not invent this from `BoxGeometry`.

### 13. Suzume park zelkova

`GROUND.park` is a green rectangle with no verticals. Ch.1 hill shots
always have a winter tree. `TOWN.md`: trees = **custom**.

| | |
|---|---|
| id / folder | `suzume-zelkova` |
| label | Suzume park zelkova |
| kind / views | **custom**, 8 |
| metres | **9.5 × 7.0 × 7.0** |
| district | suzume |
| x, z, yaw | **−38.0, −22.0, 0.2** |

West park, clear of house 1 (`−28, −34`) and skyline #5 (`−36, −24.5`)
if that box sits further south-east; if they clash, slide the tree to
`−41.0, −20.0`. Bare November crown, no leaves to explode the hull.

### 14. Amihama portal crane — defer (too big)

A 1986 portal / jib crane is **18–28 m** against Warehouse 8 at 9.5 m,
on a 90 × 50 m dock, reconstructed at `resolution = 48`. It will either
dominate every harbor frame or collapse to a stick. Agent 31’s seawall
already owns the `z ≈ 88` line.

Do **not** unique-mesh it in this density pass. If a later skyline shot
needs a crane silhouette, a cheap untextured gantry (agent 24 language)
at `(8, 86)`, `h ≈ 14`, is enough. A 4.8 m dock derrick as custom-8 is
the only photoreal fallback, and it is not must-have.

### — Manhole: geo only

Do **not** add `ORBIT_SUBJECTS` for a manhole. At walking FOV it is a
disc on asphalt; a visual hull at 48³ is a wart. Add in
`addStreetFurniture` as a 0.62 m `CylinderGeometry` (or inset circle),
`y = 0.012`, iron `0x4a4a4c`, roughness 0.9:

| x | z | on |
|---:|---:|---|
| 0.0 | 2.0 | Sakae centreline |
| −16.0 | 2.0 | Sakae west |
| 16.0 | 2.0 | Sakae east |
| −8.0 | 2.0 | under Hiro’s street |
| 20.2 | 14.0 | Yokobori mouth |
| 0.0 | 48.0 | harbor-gate |

No unique stills. No catalog row.

---

## After the must-haves (not this pass)

- Second Yokobori snack — agent 10 said no second sakaba this pass; drunk +
  vending + crates carry the alley.
- North-east stationery (`kaihin-bunbogu`, rectangle, `31.0, −8.5, 0`,
  `7.0 × 7.0 × 7.4`) if north-row coverage is still short after #1+#2.
- Harbor forklift (custom 8) and a quay worker (humanoid 8).
- A third Suzume house as an **instance** of Kogure, not of the broken
  first house, at `−38.5, −42.0, yaw 0.7`.

---

## Instance the existing three

Copy-paste extras for `INSTANCES` in `catalog.mjs`. Do not duplicate the
ten poses already there. Yaw in radians, same as the file.

Current planted (unique origin + instances):

**vending-enamel** — unique `(-6.2, -5.4, 0)` +
` (18.5, -5.4, 0)`, `(-31, 6.0, π)`, `(12.4, 6.8, π)` → 4.

**telephone-pole** — unique `(-22, 5.6, 0)` +
`(-4, 5.6)`, `(16, 5.6)`, `(36, 5.6)`, `(-22, -6.2)`, `(28, -6.2)` → 6.

**harbor-warehouse-8** — unique `(-12, 72, π)` +
`(22, 76, 0.08π)`, `(40, 68, -0.42π)` → 3.

`harbor-warehouse-3` is unique-only (`16, 70, π`) and **should start
being instanced**. Warehouse 8 instance `(22, 76)` overlaps Warehouse 3
(`x 8…24, z 64…76` vs instance `x 15…29, z 67…85`). Relocate it west
rather than stacking more on the east apron.

### telephone-pole — 12 extra

Sakae north poles sit at `z ≈ −6.0` **in the shop gaps**, street-edge of
sidewalkN, so they do not embed in shop depth (Arcade depth 10 m already
reaches `z = −3.5`). South side continues the existing `z = 5.6` rhythm.

```
{ asset: "telephone-pole", x: 18.35, z: 11.4, yaw: 0 },          // yokobori mouth (agent 10)
{ asset: "telephone-pole", x: -34.2, z: 32, yaw: 0 },            // route16 (agent 27)
{ asset: "telephone-pole", x: -34.2, z: 52, yaw: 0 },            // route16
{ asset: "telephone-pole", x: -34.2, z: 72, yaw: 0 },            // route16 quay
{ asset: "telephone-pole", x: -31.0, z: -6.0, yaw: 0 },          // sakae N, pharmacy–tobacco slit
{ asset: "telephone-pole", x: -8.8, z: -5.8, yaw: 0 },           // sakae N, soba–yaoya slit
{ asset: "telephone-pole", x: 14.2, z: -5.8, yaw: 0 },           // sakae N, arcade–records slit
{ asset: "telephone-pole", x: 34.0, z: -6.0, yaw: 0 },           // sakae N east
{ asset: "telephone-pole", x: 8.0, z: 5.6, yaw: 0 },             // sakae S, across from arcade
{ asset: "telephone-pole", x: -25.8, z: -15.0, yaw: 0 },         // suzume, west of stairs
{ asset: "telephone-pole", x: -6.0, z: 50.0, yaw: 0 },           // amihama approach
{ asset: "telephone-pole", x: 26.0, z: 60.0, yaw: 0 },           // amihama east
```

Skip a pole at `(8, -6.2)` — that is inside Arcade’s footprint.
Skip `(24, 5.6)` if the yokobori mouth pole at `18.35, 11.4` is in;
two masts 8 m apart on the same corner fight.

After this: 6 + 12 = **18 poles**. ~20 m cadence on the streets that exist.

### vending-enamel — 6 extra

Agent 27: do **not** add a second machine on Route 16; `(-31, 6.0)` already
marks the T. Pair the unique on Sakae (classic double). One on the hill
stairs (very Ch.1). One at the harbor gate.

```
{ asset: "vending-enamel", x: 21.94, z: 18.6, yaw: -Math.PI / 2 }, // yokobori facade (agent 10)
{ asset: "vending-enamel", x: -5.15, z: -5.4, yaw: 0 },            // pair, 1.05 m east of unique
{ asset: "vending-enamel", x: 25.2, z: -5.3, yaw: 0 },             // sakae N, east of records
{ asset: "vending-enamel", x: -12.8, z: 6.7, yaw: Math.PI },       // sakae S, west of Midori
{ asset: "vending-enamel", x: -16.6, z: -11.4, yaw: 0 },           // suzume, foot of stairs
{ asset: "vending-enamel", x: 5.2, z: 57.5, yaw: Math.PI },        // amihama gate, face north
```

Pair math: unique width 0.9, centre −6.2 → right edge −5.75; sibling
centre −5.15 → 10 cm gap. Hiro stays 3.3 m west. After this: 4 + 6 =
**10 machines**.

### harbor-warehouse-8 — relocate 1, add 0

Keep `(40, 68, -Math.PI * 0.42)`.

Replace the overlapping instance:

```
// REMOVE: { asset: "harbor-warehouse-8", x: 22, z: 76, yaw: Math.PI * 0.08 }
{ asset: "harbor-warehouse-8", x: -36, z: 72, yaw: Math.PI }
```

West dock, empty today. AABB `x −43 … −29`, `z 63 … 81`. 10 m west of
unique WH8 (`x −19 … −5`). Same south-facing yaw as the unique so the
pair reads as a row, not a jumble.

### harbor-warehouse-3 — 2 first instances (currently none)

Frame the harbor-gate camera (`LANDMARKS.harbor` at `−8, 58` /
waypoint `0, 48`):

```
{ asset: "harbor-warehouse-3", x: -30, z: 57, yaw: 0.08 }
{ asset: "harbor-warehouse-3", x: 10, z: 54, yaw: 0.06 }
```

| pose | AABB (yaw ≈ 0, 16 × 12) | clears |
|---|---|---|
| −30, 57 | x −38…−22, z 51…63 | unique WH8 starts x −19, z 63; west WH8 at −36, 72 sits south |
| 10, 54 | x 2…18, z 48…60 | unique WH3 at 16, 70 is 4 m south; unique WH8 is west of x −5 |

Left and right masses on the walk from Sakae to the quay. Keep the
centreline (`x ≈ 0`) open.

---

## Instance the new uniques too (once they exist)

Not in `catalog.mjs` yet. Park these next to the unique origins.

**street-cub** (unique `5.4, -5.7, 1.25`):

```
{ asset: "street-cub", x: -23.6, z: -5.5, yaw: 1.40 },   // Kamimura
{ asset: "street-cub", x: 21.8, z: 7.1, yaw: -1.20 },    // Yokobori mouth, south curb
{ asset: "street-cub", x: 24.6, z: 17.4, yaw: 0.35 },    // alley, south of Galaxy door
{ asset: "street-cub", x: -33.8, z: 16.8, yaw: -0.20 },  // Route 16, north of shelter
```

**mamachari** (unique `-10.8, -5.6, 1.52`):

```
{ asset: "mamachari", x: -7.4, z: 6.5, yaw: -1.48 },     // Midori
{ asset: "mamachari", x: -27.2, z: -30.8, yaw: 0.55 },   // Suzume, downhill of house 1
{ asset: "mamachari", x: 19.4, z: -5.5, yaw: 1.50 },     // records
```

**dock-crates** (unique `-18.2, 62.2, 0.15`):

```
{ asset: "dock-crates", x: 14.2, z: 63.5, yaw: -0.20 },  // north of WH3
{ asset: "dock-crates", x: 2.0, z: 84.0, yaw: 0.40 },    // quay (agent 31 wall is z≈88)
{ asset: "dock-crates", x: 22.55, z: 19.35, yaw: -0.12 },// yokobori, agent 10 stack A
{ asset: "dock-crates", x: -2.6, z: -4.8, yaw: 0.06 },   // Yaoya spillover, sidewalk
```

**oil-drum** (unique `18.6, 64.0, 0`):

```
{ asset: "oil-drum", x: 19.3, z: 64.1, yaw: 0.4 },       // pair
{ asset: "oil-drum", x: -19.0, z: 63.4, yaw: 0.2 },      // WH8 corner
{ asset: "oil-drum", x: -8.4, z: 85.2, yaw: 0 },         // quay
{ asset: "oil-drum", x: 22.4, z: 18.2, yaw: 0.1 },       // yokobori, south of vending
```

**suzume-toro** (unique `-16.4, -24.8, 0`):

```
{ asset: "suzume-toro", x: -23.6, z: -24.8, yaw: 0 },    // west stair flank
{ asset: "suzume-toro", x: -40.5, z: -18.5, yaw: 0.3 },  // park, near zelkova
```

**kei-van** — not in the user trio, but agent 27 already wants the lot
copy. Include it when touching `INSTANCES`:

```
{ asset: "kei-van", x: -29.4, z: 27.6, yaw: -Math.PI / 2 + 0.10 }
```

Do **not** instance `wooden-hill-house` until agent 02 regenerates yaw-090.
Do **not** instance shop fronts.

---

## Coverage after this pass (unique + listed instances)

| | now | after must-haves + instances |
|---|---|---|
| Unique meshes | 15 | 15 + 13 listed (skip crane) = 28 |
| North-row frontage | 42 % | + barber 4.2 + pharmacy 6.6 → **56 %** |
| South-row frontage | 8 % | + kissaten 6.6 → **16 %** (still thin; bunbogu next) |
| Hill houses | 1 | 2 unique + lantern pair + tree + stair vending |
| Vending | 4 | 10 |
| Poles | 6 | 18 |
| Warehouse poses | 4 (with an overlap) | 5 WH8-class + 3 WH3-class, overlap gone |
| Sidewalk vehicles | 1 van | van + cub×5 + mamachari×4 + bus |
| People | 1 | 2 |
| Harbor clutter | 0 | crates×5 + drums×5 |

56 % north-row is not yet party-wall. The remaining 3.7–4.6 m slits are
*occupied* by poles, paired vending, cub, mamachari — that is the Ch.1
trick: you never see sky *and* empty sidewalk in the same gap. Agent 24
kills the far sky; this list kills the street-level hole.

---

## Stills brief (every new unique)

Magenta studio `#E040A0`-class, isolated, **no floor, no cast shadow**,
time-locked 15:20 29 Nov 1986 overcast. Same pipeline as oak/bin.
Rectangle shops: true cardinal elevations, two-storey height matched
across yaw-000/180 and yaw-090/270 (agent 02’s hill-house failure mode).
Custom: 8 yaws, one connected alpha blob. Cylinder: 0° and 90° only.
Humanoid: 8 yaws, feet planted in the magenta (no floating shoes — they
carve, same as the hill-house pots).

Do not letter Dobuita, Yokosuka, Abe, Tomato, You Arcade, Hazuki, Ryo,
or “New Harbor” on any still.

---

## Do not

- Edit sample source from this note
- Clone Dobuita shop names or characters
- Unique-mesh a manhole
- Unique-mesh the portal crane this pass
- Instance `wooden-hill-house` until yaw-090 is the same building
- Instance Nishiya / Arcade / records / florist (identical shops)
- Sit the barber anywhere except the Yaoya–Arcade street line
  (`z = -8.5`); skyline box #1 is the *next* block, not this one
- Put Route 16 vending besides the existing `(-31, 6.0)`
- Leave Warehouse 8 at `(22, 76)` overlapping Warehouse 3
