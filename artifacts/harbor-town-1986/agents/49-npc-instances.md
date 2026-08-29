# 49 — Hiro `INSTANCES` (sidewalk + dock)

Do **not** edit `catalog.mjs` from this note. Parent appends rows to
`INSTANCES` if they override the recommendation below. Unique
`civilian-hiro` stays the one-off in `ORBIT_SUBJECTS`.

Time lock: Saturday 29 November 1986, 15:20. Convention: `+X` east,
`+Z` south. Mesh **yaw `0` faces south (`+Z`)**, `Math.PI` faces north,
`Math.PI / 2` walks east, `-Math.PI / 2` walks west. Travel lanes are
**z = −6 … 6**. Legal plants are sidewalks or dock, never that band.

Sources: `street-east-v5.png`, `catalog.mjs` (`ORBIT_SUBJECTS` +
`INSTANCES`), `map.mjs` `GROUND`, `scout.mjs` `LANDMARKS.street-east`.

---

## What `street-east-v5.png` actually shows

Landmark `street-east`: `{ x: -38, z: 1.8, yaw: Math.PI / 2 + 0.16,
pitch: -0.08 }` — standing on Sakae asphalt looking east-by-south.

- **Left (north):** Kamimura tobacco’s timber たばこ front, then the
  receding north row (soba / Yaoya / pharmacy / arcade). Hardware at
  `x = −34` is a near-left clip, mostly out of the 55° vFOV.
- **Right (south):** mint two-storey and the enamel machine at
  `(−31, 6.0)`. Midori / Haru / kissa sit further down the curb.
- **Carriageway:** wet asphalt, centreline, distant Suzuki Carry.
  **Zero people.** Poles and vending already read; the hole is civilians.

Unique Hiro is `x: -9.2, z: -7.3, yaw: Math.PI` (Yaoya doorway, on
`sidewalkN`, facing the greengrocer). ~29 m ahead, ~9 m left of this
camera — a 1.72 m speck, often lost against the north-row hulls. He does
not fill the empty street. Eight copies of the same blazer would.

Hiro footprint `0.52 × 0.32` m. Keep clones **≥ 8 m** from the unique
and from each other on the same curb, **≥ 1.5 m** from poles / vending /
booth, and **strictly outside** `z ∈ [−6, 6]`.

---

## Recommendation — do **not** instance Hiro

**Wait for a second unique humanoid.** Do not paste the list below.

Minamihama has one 8-view person. Instancing him is the cheap way to put
bodies in `street-east-v5.png` because a second 8-yaw hull is slow. It
is the wrong cheap. Poles and enamel machines clone as kit; a named
school-blazer A-stance does not.

- Same face, same height, same idle in one east-looking frustum is a
  stamp, not Saturday sidewalk life. From `x = −38` a south-curb walker
  plus the Yaoya unique plus a pharmacy facer are three identical Hiros
  at three depths. That is worse than empty asphalt.
- Agent 06 already forbade extra Hiro instances (unique civilian). Agent
  15 ranked **Watanabe** (overcoat, weight on one leg, Yokobori mouth)
  as the second body and a **quay worker** as a later unique. Those are
  the density path — different silhouette, not another 1.72 m blazer.
- Shop facades are not instanced for the same reason (agent 15 / 30):
  identical copies kill the read. People are that class, not poles.

If parent still wants *something* in the east-street still this pass,
plant **at most two** clones, never the eight:

```js
{ asset: "civilian-hiro", x: -27.2, z: 7.25, yaw: Math.PI / 2 }, // south walk, back to street-east
{ asset: "civilian-hiro", x: -30.0, z: 84.5, yaw: Math.PI / 2 }, // west quay, ~70 m from unique
```

Opposite curb from the unique, back to the east camera so the face is
unread, plus one dock copy that cannot share a frustum with Sakae.
Anything more is a clone army.

---

## Ground (legal vs road)

| patch | X | Z | y |
|---|---|---|---|
| asphalt / lanes | −48…48 | **−6…6** | 0 — **forbidden** |
| sidewalkN | −40…40 | −12…−6 | 0.08 — north shops at `z = −8.5` |
| sidewalkS | −40…40 | 6…10 | 0.08 — south shops at `z = 8.6` |
| dock | −40…48 | 52…88 | 0.06 — Amihama apron + quay |

North-curb people sit at **z = −7.2 … −7.45** (same band as the unique).
South-curb at **z = 7.2 … 7.3**. Walking yaw uses the 0.52 m shoulder
span on Z; those z values still clear the lane after rotation.

Do not stand on unique Hiro `(−9.2, −7.3)`. Do not duplicate kit already
in `INSTANCES` / `ORBIT_SUBJECTS`:

| kit | pose | keep-off |
|---|---|---|
| unique Hiro | −9.2, −7.3 | Yaoya doorway |
| vending | −28.6, −6.7 / −10.8, −6.7 / 10.2, −6.7 | north walk |
| vending | −31, 6.0 / 12.4, 6.8 | south walk |
| booth | 16.5, 6.8 | south, east of kissa |
| north poles | −38, −22, −8, 8, 18, 28, 38 at z ≈ −6.2…−6.4 | gutter |
| south poles | −36, −22, −4, 6, 16, 36, 40 at z ≈ 5.6…6.4 | gutter |
| Carry | 14.5, 3.4 | in the lane, ignore |

Shop envelopes used below are current `catalog.mjs` `x ± realWidth/2`.
Shop hulls still oversail the walk (agent 06 / 08); sidewalk patches are
the legal ground, same as the unique.

---

## Six sidewalk poses

West → east. Three north, three south. Three face a shop, three walk.

| # | curb | x | z | yaw | read | landmark that sees it |
|---|---|---:|---:|---|---|---|
| 1 | N | **−33.4** | **−7.4** | `Math.PI` | facing Yamato kanagu | `hardware` |
| 2 | S | **−27.2** | **7.25** | `Math.PI / 2` | walking east, west of Midori | `street-east` (near right, back) |
| 3 | N | **1.6** | **−7.35** | `Math.PI` | facing Minato-machi pharmacy | `pharmacy` / `street-east` (mid left, profile) |
| 4 | S | **7.6** | **7.3** | `0` | facing Haru barber | `barber` / `street-east` (far right, back) |
| 5 | N | **12.6** | **−7.2** | `Math.PI / 2` | walking east, arcade east bay | `arcade` / `street-east` (far left) |
| 6 | S | **20.8** | **7.2** | `-Math.PI / 2` | walking west, east of kissa | `street-west` / `kissa` |

### 1 — face Yamato kanagu (north)

Hardware `x = −34`, span **−37.2 … −30.8**. Centre + 0.6 m so the
`hardware` camera (`z = 8`, yaw `π`) sees a 3/4, not a door-blocker.
`z = −7.4` is 1.4 m onto sidewalkN. Yaw `π` looks at the shop.

Out of `street-east` (too near-left for the 85° hFOV). Fills the
hardware still, which is currently a vacant doorway.

Clear: pole `(−38, −6.4)` 4.7 m; tobacco vending `(−28.6, −6.7)` 4.8 m;
unique Hiro 24 m east.

### 2 — walk east, south curb west of Midori

Empty south walk from Route 16 lip to Midori west (**−13.3**). Walking
east, back to `street-east`. This is the only clone that actually
occupies the empty right-hand pavement in that PNG.

`z = 7.25` is 1.25 m onto sidewalkS (south of the `z = 6` seam). Yaw
`π/2` = +X.

Clear: vending `(−31, 6.0)` 4.4 m; unique pole `(−22, 5.6)` 5.5 m;
Midori 14 m east; unique Hiro is opposite curb, 20 m.

### 3 — face Minato-machi pharmacy (north)

Pharmacy `x = 0`, span **−3.3 … 3.3**. East bay so the gap to unique
Hiro is **10.8 m** (not the Yaoya–pharmacy slit). Yaw `π` at the enamel
cross. Same north-curb facing language as the unique, different shop.

Clear: pole `(−8, −6.4)` 9.7 m; pole `(8, −6.2)` 6.5 m; arcade west 2.8 m.

### 4 — face Haru barber (south)

Barber `x = 6`, span **2.9 … 9.1**. East of the door, west of the east
jamb. Yaw `0` looks at the tokoya. Pole `(6, 6.4)` is 1.8 m west — person
beside a mast, not inside it. From `street-east` this is a far back (he
faces south).

Clear: vending `(12.4, 6.8)` 4.8 m; Carry is in the lane.

### 5 — walk east, arcade east bay (north)

Arcade `x = 8.4`, span **4.4 … 12.4**. `x = 12.6` is the east jamb /
arcade–records slit, walking toward cassette. Yaw `π/2`. Not a twin of
#3 (11 m east, walking vs facing).

Clear: vending `(10.2, −6.7)` 2.5 m; pole `(8, −6.2)` 4.7 m; cassette
west **14.7** is 2.1 m further — he is walking into that slit, not
standing in the records doorway.

### 6 — walk west, east of Kissa Miharu (south)

Kissa span **11.0 … 17.0**, booth `(16.5, 6.8)`, sidewalkS continues to
`x = 40`. `x = 20.8` is past the booth, walking west toward the kissa
(yaw `−π/2`). Fills `street-west` (`x = 30` looking west). Face is
toward that camera — do not pair with a second east-end clone.

Clear: booth 4.3 m; pole `(16, 5.6)` 5.1 m; Yokobori mouth is `z ≥ 10`,
this plant stays on sidewalkS at `z = 7.2`.

Skipped on purpose: **Midori facing** (x ≈ −10 sits across the street
from unique Hiro — the worst same-depth twin); **Yaoya / soba facing**
(unique already owns that doorway); **records facing** (would stack with
#5 on the same north curb).

---

## Two dock poses

`GROUND.dock` `x −40…48`, `z 52…88`. Warehouses (catalog metres, yaw `π`,
`realWidth` for XZ as planted):

| shed | pose | AABB x × z (approx) |
|---|---|---|
| WH8 unique | −12, 72, π | −16.3…−7.8 × 66.5…77.5 |
| WH8 west instance | −32, 72, π | −36.3…−27.8 × 66.5…77.5 |
| WH3 unique | 16, 70, π | 8…24 × 64…76 |
| WH8 east instance | 36, 72, π | 31.8…40.3 × 66.5…77.5 |

Cargo doors face **north** (town approach). Truck lane `x ∈ (−5, 8)`
stays empty (agent 11). Bollards on `z = 86`, `x = −24 … 40`. Seawall
~`z = 87.7`. `LAND_PADS` dock maxZ **87.2**.

| # | x | z | yaw | read | landmark |
|---|---:|---:|---|---|---|
| 7 | **−10.6** | **61.8** | `0` | north apron, facing WH8 doors | `harbor` / `warehouse` |
| 8 | **−30.0** | **84.5** | `Math.PI / 2` | west quay, walking east | `seawall` / `quay` |

### 7 — WH8 apron

4.7 m north of unique Warehouse 8’s north face, 1.4 m east of its
centreline so he is not a door-sticker. Yaw `0` looks at the yaw-000
cargo doors. `LANDMARKS.warehouse` (`−12, 52`, yaw `0`) sees his back
on the apron; `harbor` (`0, 48`) sees him left of the truck lane.

Clear: truck lane 5.6 m east; west WH8 aisle is `x ≈ −22`, unused here.

### 8 — west quay

South of west Warehouse 8 (shed south ~77.5 m; this is 7 m further south
on the quay walk). Walking east along the water, 8.5 m ahead of
`LANDMARKS.seawall` (`−38.5, 86.6`, yaw `1.62`) — back / right shoulder
in that along-wall shot. `z = 84.5` is 1.5 m north of the bollard line,
2.7 m north of `LAND_PADS` maxZ 87.2.

Not in the Sakae frustum (~70 m south of unique Hiro). Fog 40–140 may
ghost him from the hill; he will not stamp `street-east-v5.png`.

---

## Ready to paste (append only)

Do **not** replace the current `INSTANCES` array (poles, vending,
warehouses, hill houses stay). Append:

```js
  { asset: "civilian-hiro", x: -33.4, z: -7.4, yaw: Math.PI },           // 1 N face Yamato kanagu
  { asset: "civilian-hiro", x: -27.2, z: 7.25, yaw: Math.PI / 2 },       // 2 S walk east, street-east right
  { asset: "civilian-hiro", x: 1.6, z: -7.35, yaw: Math.PI },            // 3 N face pharmacy
  { asset: "civilian-hiro", x: 7.6, z: 7.3, yaw: 0 },                    // 4 S face Haru barber
  { asset: "civilian-hiro", x: 12.6, z: -7.2, yaw: Math.PI / 2 },        // 5 N walk east, arcade east
  { asset: "civilian-hiro", x: 20.8, z: 7.2, yaw: -Math.PI / 2 },        // 6 S walk west, east of kissa
  { asset: "civilian-hiro", x: -10.6, z: 61.8, yaw: 0 },                 // 7 dock apron, face WH8
  { asset: "civilian-hiro", x: -30.0, z: 84.5, yaw: Math.PI / 2 },       // 8 west quay, walk east
```

Counts if pasted: unique Hiro 1 + 8 clones = **9 identical hulls**.
Asset id `civilian-hiro` already exists in `ORBIT_SUBJECTS` (agent 32
instance-asset rule). No row has `z ∈ [−6, 6]`.

---

## Pairwise (clones vs unique and kit)

| pair | Δxz (m) | ok |
|---|---:|---|
| unique (−9.2, −7.3) → #1 | 24.2 | same curb, far |
| unique → #3 | 10.8 | same curb, different shop |
| unique → #5 | 21.8 | same curb |
| unique → #2 / #4 / #6 | ≥ 14 | opposite curb |
| unique → #7 / #8 | ≥ 69 | other district |
| #3 (1.6, −7.35) → #5 (12.6, −7.2) | 11.0 | facing vs walking |
| #2 (−27.2, 7.25) → #4 (7.6, 7.3) | 34.8 | |
| #4 (7.6, 7.3) → #6 (20.8, 7.2) | 13.2 | facing vs walking |
| #4 → pole (6, 6.4) | 1.8 | beside, not overlapping |
| #5 → vending (10.2, −6.7) | 2.5 | walking past |
| #7 → WH8 north face | 4.7 | apron stand-off |
| #8 → bollard line z = 86 | 1.5 | north of bits |

Do not also instance Watanabe-that-does-not-exist as Hiro. When the
second 8-view body lands, drop these rows (or keep at most the two-clone
override) and give the new hull the Yokobori mouth / quay worker slot.
