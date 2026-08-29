# 06 — Small props and civilian Hiro

Audit of magenta-studio stills, reconstruction, and Sakae-dori placement for
`vending-enamel`, `phone-booth`, `telephone-pole`, and `civilian-hiro`.

Sources: `assets/{vending-enamel,phone-booth,telephone-pole,civilian-hiro}/`,
`src/catalog.mjs` (`ORBIT_SUBJECTS` + `INSTANCES`), `src/map.mjs` ground
patches, `src/main.mjs` reconstruct path, launch log notes (phone-booth
119932 tris; pole classified custom despite catalog `cylinder`; Hiro 8 views
9528 tris). Sample source was not edited.

Ground (metres, +X east, +Z south):

| patch | X | Z | note |
|---|---|---|---|
| asphalt | −48…48 | −8…12 | carriageway |
| sidewalkN | −40…40 | −12…−6 | north shops, y=0.08 |
| sidewalkS | −40…40 | 6…10 | south shops, y=0.08 |
| paint dashes | −38…38 | 2 | lane centre, slightly south of geometric mid |

Travel lanes are **z = −6 … 6**. Anything with |z| < 6 and not on a sidewalk
patch is in the road.

`reconstructSubject` uses catalog `kind` only to pick the still set
(`CYLINDER_VIEWS` / `HUMANOID_VIEWS` / `CARDINAL_VIEWS`) and `forceCount`.
It does **not** pass `shape: { kind: subject.kind }` into
`reconstructOrbitAsset`, so `classifyOrbitShape` always wins. That is why
the pole log line can read `shape=custom` while the catalog says cylinder.

---

## Launch log vs catalog

| id | catalog kind | stills on disk | logged shape | views | tris | verdict |
|---|---|---|---|---|---|---|
| vending-enamel | rectangle | 4 cardinals | (rectangle expected) | 4 | — | stills break the box |
| phone-booth | rectangle | 4 (one is 3/4) | — | 4 | **119932** | ~12× Hiro; glass + interior + live street |
| telephone-pole | cylinder | 2 | **custom** | 2 | — | classifier rejects cylinder; no round snap |
| civilian-hiro | humanoid | 8 | humanoid/custom | **8** | **9528** | count is healthy; floor/chroma/pose are not |

A clean rectangle at `resolution: 48` should land in the low thousands of
tris (a 48³ box surface is ~25–40k marching-tet tris *before* it is a
simple prism). 119932 on a 0.9×0.9×2.4 m booth is a noisy high-genus hull,
not a kiosk.

9528 tris on Hiro with 8 views is reasonable for a humanoid at this
resolution. Do not chase the number; chase the floor and the pose.

---

## 1. Enamel vending machine

**Catalog.** `kind: rectangle`, 1.82 × 0.9 × 0.72 m, unique pose
`x=-6.2, z=-5.4, yaw=0`.

### Still defects

- **`yaw-270.png` is a 3/4, not a left cardinal.** Front face (products,
  coin slot, delivery bin) and left enamel side are both visible. Rectangle
  reconstruction assumes four orthographic sides; this view inflates the
  left-front corner of the hull.
- **`yaw-180.png` has power cables lying on the studio floor.** Black
  leads snake onto the magenta and rest on an implied ground plane. Those
  pixels survive chroma-key and grow a black “tail” behind every instance.
- **`yaw-270.png` has a contact shadow** under the feet (TOWN.md: no floor,
  no cast shadow). `yaw-000` / `yaw-090` are cleaner but the feet still
  read as sitting on a plane.
- **`yaw-090.png` is a near-profile with a sliver of the front** and a
  rounded top-front lip. Fine as a side if the other three are true
  cardinals; they are not.
- Isolation is otherwise good (hot magenta, Grok watermark is punched by
  the existing chroma watermark crop). Period: ¥100–¥110 cans, red/cream
  enamel, 自動販売機 header — acceptable for 29 Nov 1986.

### Placement

Unique + instances (current `catalog.mjs`):

| x | z | yaw | where |
|---|---|---|---|
| −6.2 | **−5.4** | 0 | unique — **north travel lane**, in front of Yaoya |
| 18.5 | **−5.4** | 0 | north travel lane, cassette shop |
| 10.2 | **−5.5** | 0 | north travel lane, arcade east jamb |
| −31 | 6.0 | π | south curb, west end (on the seam) |
| 12.4 | 6.8 | π | south sidewalk — only one that is clearly legal |
| 26 | 12.5 | π/2 | Yokobori mouth, against Galaxy sakaba |

Three of six sit at z ≈ −5.4, 0.6 m into the asphalt from the north curb
(sidewalkN `maxZ = -6`). They will read as machines standing in the street,
not against shop walls.

---

## 2. Green phone booth

**Catalog.** `kind: rectangle`, 2.4 × 0.9 × 0.9 m, unique only:
`x=2.4, z=6.2, yaw=Math.PI`. No `INSTANCES` row.

### Still defects (this is the 119932-tri mesh)

- **`yaw-000.png` is a 3/4 corner, not front.** Door (プッシュ / 電話) and
  the phone wall are both in frame. Cardinal 0° is supposed to be one face.
- **Live street through the glass on `yaw-000`.** Trees, a road, and a
  distant building are visible inside the booth. Those pixels are not
  magenta, so the visual hull treats the *environment* as occupancy.
  `yaw-090` correctly shows magenta through the glass — the four silhouettes
  disagree, which is exactly what explodes photoconsistency carving.
- Interior payphone, directories, and door frames are opaque in the stills.
  Combined with glass, the hull becomes a sponge (frame + phone + ghost
  street). Marching tetrahedra then emits **119932 tris** for a 0.9 m box.
- **PHS sticker** on the door in `yaw-090` (vertical “PHS”). Personal
  Handy-phone System commercial launch is July 1995 — nine years after the
  time lock. Strip it on a re-shoot.
- `yaw-180` (NTT-PROPERTY back) and `yaw-270` (solid green side) are the
  only true cardinals. Faint contact shadow under `yaw-180`.
- NTT + 公衆電話 + プッシュ電話 is period-correct (NTT from Apr 1985).
  Keep the branding; kill PHS and the street-through-glass.

`arcade.png` already shows the result: a melted green kiosk with the
interior phone baked into the surface, sitting on the south curb.

### Pose `x=2.4, z=6.2, yaw=π`

Yaw is right: catalog front is photographed from +Z, so `yaw=π` faces
north into Sakae, which is what you want on the south sidewalk.

Z is not:

- sidewalkS starts at **z = 6**.
- Booth depth 0.9 m → occupies z = 5.75 … 6.65 if centred at 6.2.
- **~0.25 m of the cabin is in the road.** Front doors sit in the south
  travel lane.

X is tight against new south-row neighbours:

- Haru barber is at `x=6, z=8.6, width=6.2` → west wall ≈ 2.9. Booth at
  2.4 is half a metre off that wall.
- Kei van is at `x=5.2, z=3.4, depth=3.2` → north-south span ≈ 1.8 … 5.0.
  Gap from van tail to booth ≈ 0.7 m. The booth is wedged between a parked
  van in the lane and the barber.

Recommend **x=1.2, z=7.3, yaw=π**: fully on sidewalkS, 1.3 m setback from
the curb, west of the barber, clear of the van. Doors still face the street.

---

## 3. Concrete telephone pole

**Catalog.** `kind: cylinder`, 10 × 0.35 × 0.35 m, unique `x=-22, z=5.6`.
Two stills (`yaw-000`, `yaw-090`) — the right count for a cylinder.

### Still defects / why it classifies `custom`

`classifyOrbitShape` requires rotational symmetry (`aspectCv < 0.12`,
cardinal IoU > 0.85, no corners) before it will return `cylinder` and
`snapOccupancyToPrimitive`. These stills fail that on purpose:

- **`yaw-000` has a wooden T-crossarm + four insulators.** Span is several
  times the shaft diameter → `hasCorners`, fat aspect.
- **`yaw-090` does not show that crossarm** (it should be a thin edge-on
  line). Hardware set is a different pole: extra horns/speakers at the
  cap, transformer rotated, no timber arm. Two-view hull of disagreeing
  silhouettes is a square prism with a lopsided blob near the top.
- Transformer, concrete footing, and climbing steps are not a cylinder.
  TOWN.md says poles are cylinders; the stills are a full utility assembly.
- Shaft is **cropped at the cap** and the transformer is huge relative to
  height. Scaling the visible stub to `realHeight: 10` makes the
  transformer room-sized.
- Stamps 昭和61年 / 東京電力 are good (Kanagawa is TEPCO; Showa 61 = 1986).
  東芝 on the transformer is fine.

Because `main.mjs` does not force `shape.kind = "cylinder"`, the log
correctly reports **custom**. `forceCount: 2` still carves from two views,
but **without** the inscribed-cylinder snap, so the shaft is a square
post. That is the defect, not the log line.

Fix on a re-shoot (pick one):

1. Bare shaft only, two orthogonals, keep `kind: "cylinder"` **and** pass
   that kind through to `reconstructOrbitAsset` as `shape`. Hardware as a
   separate custom kit, or
2. Eight consistent views of the same pole (crossarm visible edge-on at
   90°), catalog as `custom` / `humanoid`-style 8-view, drop the cylinder
   claim.

### Density along Sakae — every ~20 m? too sparse?

Current poles (unique + instances):

**South curb, z=5.6 (0.4 m *into the road* from sidewalkS minZ=6):**

| x | gap to next |
|---|---|
| −36 | 14 m |
| −22 | 18 m |
| −4 | 20 m |
| 16 | 20 m |
| 36 | — |

**North curb, z=−6.2 (0.2 m into the road from sidewalkN maxZ=−6):**

| x | gap to next |
|---|---|
| −22 | **30 m** |
| 8 | 20 m |
| 28 | — |

20 m on the south side is **not too sparse for real TEPCO spans** (urban
concrete poles are often 20–30 m). It *is* thin for a Shenmue-style
shopping street, and the **north side is actually sparse**: nothing west of
−22 (Kamimura tobacco / Route 16 corner), a 30 m hole through Yaoya, and
nothing east of 28 (cassette / Yokobori). Sidewalks run −40…40, so both
ends are also bare.

Poles also sit in the gutter, not on the sidewalk. Slide them 0.4–0.8 m
onto the pavement (`z=6.4` south, `z=-6.4` north).

---

## 4. Civilian Hiro

**Stills.** Eight yaws at 45° — correct for `kind: "humanoid"`. Same
young man, winter school blazer, white shirt, dark tie, black shoes.
Saturday 15:20 is a plausible time for him to be on Sakae.

### Still defects

- **Studio floor and horizon in every view.** Backdrop is a dusty rose
  cyclorama, not isolated #E040A0-class magenta with no floor
  (TOWN.md reconstruction rules). He is standing *on* a plane.
- **Contact shadow under the shoes** in all eight stills.
- Backdrop hue is wine/rose (high R, modest B). Chroma-key *may* still
  punch it (`magentaKeyAlpha` is a red+blue-vs-green gate), but the
  darker floor band and the wall/floor horizon are the usual leftovers:
  either a pancake under the feet or eaten soles. 9528 tris says the
  mesh is person-shaped, not a giant disk, so the floor is mostly
  keying out — residual risk at the shoes.
- Camera is slightly downward (portrait full-body), not a torso-height
  orbit. Feet are large in frame; the hull will fatten the shoes.
- **`yaw-270.png` has a rectangular magenta patch in the lower-left
  corner** (compositing leftover). Harmless if it keys, ugly if it does
  not.
- Idle A-stance is good for a visual hull (no crossed arms). Fingers
  will fuse; that is expected at res 48.

### Pose — `x=-8.5, z=-5.2`, standing in the road?

**Yes, that pose is in the road.**

- sidewalkN ends at **z = −6**.
- z = −5.2 is **0.8 m into the north travel lane** (carriageway −6…6,
  centreline paint at z=2).
- x = −8.5 sits in the gap between Nishiya soba (centre −14) and Yaoya
  (centre now −9), which would be a fine *sidewalk* slot if z were north
  of −6.

He would be a pedestrian in traffic, overlapping the enamel vending at
(−6.2, −5.4) by ~2.3 m.

Current `catalog.mjs` has already been nudged to **`x=-9.2, z=-6.6`,
`yaw=π·0.15`**. z = −6.6 is 0.6 m onto sidewalkN — curb, not the lane.
x = −9.2 is directly in front of Yaoya (centre −9). That is the right
*kind* of pose (kid on the pavement outside the greengrocer) but:

- He is still on the very lip of the curb. A 0.32 m depth mesh at
  z = −6.6 occupies z ≈ −6.76 … −6.44; the south half is almost in the
  gutter.
- `yaw = 0.15π ≈ 27°` faces south-southeast, i.e. out into the street.
  Fine if he is about to cross; odd if he is meant to be looking at
  produce (that wants `yaw = π`, facing the shop).
- Yaoya `realDepth: 7.4` centred at z = −8.5 has a south face around
  z = −4.8 if the origin is the building centre — which would bury both
  Hiro and the sidewalk inside the shop volume. That is a **building
  depth / origin** problem, not Hiro’s, but it means “in front of Yaoya”
  may clip until shop fronts are pulled back to z ≈ −8.

Recommended unique pose (do not apply here): **`x=-9.2, z=-7.3,
yaw=Math.PI`** — 1.3 m onto the sidewalk, facing the greengrocer, clear
of the lane and of the vending that should also move onto the pavement.

---

## Recommended extra `INSTANCES`

Do not edit `catalog.mjs` from this note. Unique-subject moves (Hiro,
booth, vending, pole z) are listed as comments only. Add the rows below
to `INSTANCES` in a later catalog pass.

Convention: north curb furniture at **z = −6.5 … −7.4**, yaw 0 (faces
street); south curb at **z = 6.5 … 7.4**, yaw π. Poles 0.4 m onto the
sidewalk.

### Telephone poles — fill north side and the 20 m holes

South is already ~14–20 m. North is the sparse side. Also pin the
west/east ends (sidewalks are −40…40).

```js
// north curb (sidewalkN), ~16–20 m, currently missing west + Yaoya + east
{ asset: "telephone-pole", x: -38, z: -6.4, yaw: 0 },
{ asset: "telephone-pole", x: -8,  z: -6.4, yaw: 0 },
{ asset: "telephone-pole", x:  18, z: -6.4, yaw: 0 },
{ asset: "telephone-pole", x:  38, z: -6.4, yaw: 0 },

// south curb: close −4 → 16 (20 m is the long south gap) and the east end
{ asset: "telephone-pole", x:  6,  z:  6.4, yaw: 0 },
{ asset: "telephone-pole", x:  46, z:  5.6, yaw: 0 }, // skip if asphalt-only; sidewalk maxX is 40
{ asset: "telephone-pole", x:  40, z:  6.4, yaw: 0 },
```

Drop the `x: 46` row if you want to stay on sidewalkS. After this, north
is −38, −22 (existing), −8, 8 (existing), 18, 28 (existing), 38.

If the look needs to feel *busier* than real TEPCO, 12–15 m on both curbs
is the Shenmue density; 20 m south is already enough once north is filled.

Existing south poles at z=5.6 and north at z=−6.2 should later be slid to
z=6.4 / z=−6.4 (unique subject too). Not duplicated here.

### Vending — off the asphalt, clusters of two

Keep the six that exist but treat the three at z≈−5.4 as pending moves.
Add pavement machines so Sakae is not four lonely boxes on 80 m of shops:

```js
// north sidewalk, against shop returns (yaw 0 = face south / street)
{ asset: "vending-enamel", x: -28.6, z: -6.7, yaw: 0 },           // Kamimura west
{ asset: "vending-enamel", x: -10.8, z: -6.7, yaw: 0 },           // soba / yaoya gap, pair with Hiro
{ asset: "vending-enamel", x:  -0.8, z: -6.7, yaw: 0 },           // pharmacy east jamb
{ asset: "vending-enamel", x:  12.4, z: -6.7, yaw: 0 },           // arcade east, *on pavement* (not 10.2,-5.5)
{ asset: "vending-enamel", x:  24.6, z: -6.7, yaw: 0 },           // cassette east

// south sidewalk, face north
{ asset: "vending-enamel", x: -14.2, z:  7.0, yaw: Math.PI },     // west of Midori
{ asset: "vending-enamel", x:  -3.6, z:  7.0, yaw: Math.PI },     // east of Midori / west of booth
{ asset: "vending-enamel", x:  10.8, z:  7.0, yaw: Math.PI },     // east of Haru barber (12.4,6.8 already exists; this is the pair)

// harbor gate, for the walk from Sakae south
{ asset: "vending-enamel", x:  -6.0, z:  50.5, yaw: 0 },
```

Later, retarget the three road machines:

- unique `(−6.2, −5.4)` → `(−6.8, −6.7)` (Yaoya south face, pavement)
- instance `(18.5, −5.4)` → `(18.5, −6.7)`
- instance `(10.2, −5.5)` → delete or replace with `(12.4, −6.7)` above

### Phone booth — only one today

```js
{ asset: "phone-booth", x: -29.5, z: 7.3, yaw: Math.PI },  // west Sakae, across from Kamimura
{ asset: "phone-booth", x:   8.5, z: 54.0, yaw: 0 },       // Amihama gate, face north toward town
```

And move the unique from `(2.4, 6.2, π)` → **`(1.2, 7.3, π)`** so it is
on the sidewalk, west of Haru, clear of the Carry.

### Hiro

No extra instances (he is a unique civilian). Move the unique off the
lane as above: **`x=-9.2, z=-7.3, yaw=Math.PI`**.

---

## Pipeline notes (blockers, not catalog rows)

1. **Pass catalog `kind` into reconstruction.**
   `reconstructOrbitAsset({ shape: { kind: subject.kind, recommendedCount: catalog.length } })`
   so a pole tagged cylinder actually snaps round. Today the log’s
   `shape=` is the classifier, not the catalog.
2. **Re-shoot stills to the rules in TOWN.md:** isolated #E040A0-class
   magenta, no floor, no shadow, true cardinals (or true 45° orbit for
   Hiro). Booth glass either opaque-green for a box hull, or magenta
   *consistently* through every window.
3. **Booth must not stay at 119k tris.** After a clean 4-cardinal reshoot
   it should fall in line with the vending (a few thousand tris), not
   Hiro×12.
4. Shop `realDepth` vs sidewalk: north-row centres at z=−8.5 with depth
   7–10 m put south faces around z=−4.5, i.e. in the street. Until that
   is fixed, “place on sidewalkN” may still clip a shop volume. Prop
   coordinates above assume sidewalk patches are the legal ground.

---

## Priority

1. Hiro out of the road (if the unique is still −8.5, −5.2) / off the curb
   lip (if it is already −9.2, −6.6).
2. Booth off the gutter and away from the van/barber (`1.2, 7.3, π`).
3. Pole stills + force `shape.kind = cylinder"` (or 8-view custom) so the
   shaft is round; then fill the north curb.
4. Re-shoot the booth (cardinals, no street through glass, no PHS) — this
   is the 119932-tri bomb.
5. Vending: cardinal left, no cables, no shadow; slide the z=−5.4 row onto
   the pavement; add the clusters above.
6. Hiro stills: no floor, no shadow, true magenta, drop the yaw-270 patch.
