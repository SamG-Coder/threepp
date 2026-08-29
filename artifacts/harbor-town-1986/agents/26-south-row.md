# 26 — Sakae south-row layout

Plan only. Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, **15:20**, overcast winter afternoon.
Convention (`map.mjs`, `TOWN.md`, scout lookAt): `+X` east, `+Z` south. Camera
and plant yaw share the same axis: **yaw `0` faces south (`+Z`)**, yaw `Math.PI`
faces north. South-row façades face the street, so every bay is `yaw: Math.PI`.

Sakae-dori is east–west. Walking **east** is walking **+X**. The south row must
read as a **continuous shop wall** on your right, not the 4–5 m vacant lots of
the north row (`sakae-north.png`).

---

## Why this pass

North row (`z = -8.5`, `yaw: 0`) already occupies:

| shop | catalog x | realWidth | x span | gap to next |
|---|---|---|---|---|
| Kamimura tobacco | −25 | 6.4 | −28.2 … −21.8 | 4.6 m |
| Nishiya soba | −14 | 6.4 | −17.2 … −10.8 | 3.7 m |
| Yaoya greengrocer | −4 | 6.2 | −7.1 … −0.9 | 4.9 m |
| Starlight Arcade | 8 | 8.0 | 4.0 … 12.0 | 4.6 m |
| Minato-machi records | 20 | 6.8 | 16.6 … 23.4 | open east |

Those gaps are the sakae-north void (agent 24). South currently has **one**
shop: Midori florist at **`(−6, 8.6)`, `yaw: Math.PI`**, `6.8 × 6.6 × 7.8` m
(agent 03 — pose is correct, keep it). Incoming unique meshes (agent 07):

- **barber** — `98.jpg` (000 front) → `barber-shop` / **Haru barber** (港町理容室)
- **pharmacy** — `100.jpg` (000 front) → `pharmacy-shop` / **Haru pharmacy** (港町薬局)

Agent 07 parked those at `x = −18` and `x = 8`. That leaves **5.5 m** west of
Midori and **7.5 m** east of it — another vacant lot, and it leaves no room
for the two future bays. This note supersedes those two x values. Labels,
folders, and metres of the stills stay.

Do not ingest the stills until agent 07’s 270 regens land. Layout below is
the slot plan so the wall is already decided.

---

## Ground facts

```
asphalt    minX −48 … 48   minZ −8 … 12    y 0     carriageway
sidewalkN  minX −40 … 40   minZ −12 … −6   y 0.08  north shops sit on this
sidewalkS  minX −40 … 40   minZ 6 … 10     y 0.08  south shops sit on this
alley      minX 18 … 42    minZ 12 … 28    y 0.04  Yokobori (agent 10)
```

Travel lanes `z = −6 … 6`. South shop centres stay on sidewalkS at **`z = 8.6`**.
With `realDepth ≈ 7.8` the north (street) face would sit near `z ≈ 4.7` if
depth were honoured; `realWorldScale` still scales XZ from `realWidth` only
(agent 03). Same approximation as the north row. Keep **z and yaw identical
on every bay** so the wall is a straight line.

Yokobori mouth is `x = 18 … 22.5` (agent 10). South wall **must end west of
x = 18**. Cassette at `(20, −8.5)` then looks across at the alley opening, not
at a shop back.

Keep-out (do not swallow):

| what | pose | note |
|---|---|---|
| phone booth | `2.4, 6.2`, yaw π | **move** into a bay gap (below) |
| kei van | `4.2, 3.8`, yaw −0.18 | street; stays in front of pharmacy |
| pole | `−4, 5.6` | in front of Midori; keep |
| pole | `16, 5.6` | just east of the wall; keep |
| pole unique | `−22, 5.6` | west of the wall; keep |
| vending | `12.4, 6.8`, yaw π | in front of east reserved; keep |
| vending | `−31, 6.0`, yaw π | Route 16 lip (agent 27); keep |
| Galaxy sakaba | `26, 16` | alley; not a south-row shop |

---

## Five-bay wall (west → east, walking +X)

`realWidth` 6.4–7.0 m. Party-wall gaps **1.5–2.5 m**. `z = 8.6`. `yaw = Math.PI`.

Midori stays at **`x = −6`** (catalog, scout `flower`, nav node). Pack around it.

Derived from west-edge / gap / half-width, not rounded independently:

| # | id | label | still / mesh | x | realWidth | realHeight | realDepth | x span | gap after |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `sakae-south-a` | reserved west | **future unique** | **−23.2** | 6.6 | 6.8 | 7.8 | −26.5 … −19.9 | **1.8** |
| 2 | `barber-shop` | Haru barber | `98.jpg` orbit | **−14.7** | 6.8 | 7.2 | 7.6 | −18.1 … −11.3 | **2.0** |
| 3 | `flower-shop` | Midori florist | catalog (keep) | **−6.0** | 6.6 | 6.8 | 7.8 | −9.3 … −2.7 | **2.2** |
| 4 | `pharmacy-shop` | Haru pharmacy | `100.jpg` orbit | **2.8** | 6.6 | 6.8 | 7.6 | −0.5 … 6.1 | **2.4** |
| 5 | `sakae-south-b` | reserved east | **future unique** | **11.9** | 6.8 | 7.0 | 7.8 | 8.5 … 15.3 | — |

```
west −26.5                                                    east 15.3
 |  south-a  |1.8|  barber  |2.0|  Midori  |2.2| pharmacy |2.4|  south-b  |
      −23.2          −14.7          −6.0           2.8           11.9
```

Frontage **41.8 m**. North row is 51.6 m; the missing ~10 m on the east is the
Yokobori mouth (cassette faces the alley). West edge −26.5 sits 1.7 m inside
tobacco’s west (−28.2) — the two rows start as a gate, not a stagger.

Gaps **1.8 / 2.0 / 2.2 / 2.4** (all inside 1.5–2.5). They open slightly toward
the alley so the wall does not look CAD-even.

Across-the-street pairings (not 1:1, tight south vs gappy north):

| south bay | faces (approx) |
|---|---|
| south-a −23.2 | Kamimura tobacco −25 |
| Haru barber −14.7 | Nishiya soba −14 |
| Midori −6 | Yaoya −4 (2 m west of yaoya centre) |
| Haru pharmacy 2.8 | produce–arcade **gap** (north −0.9 … 4.0) |
| south-b 11.9 | Starlight Arcade east face (arcade 4 … 12) |

Do **not** slide pharmacy to `x = 8` to “face the arcade”. That reopens a
7 m hole east of Midori and breaks the wall.

### Check arithmetic

```
flower  x=−6.0  w=6.6  west=−9.3  east=−2.7
barber  east = −9.3 − 2.0 = −11.3   x = −11.3 − 3.4 = −14.7   west = −18.1
south-a east = −18.1 − 1.8 = −19.9  x = −19.9 − 3.3 = −23.2   west = −26.5
pharm   west = −2.7 + 2.2 = −0.5    x = −0.5 + 3.3  =  2.8    east =  6.1
south-b west =  6.1 + 2.4 =  8.5    x =  8.5 + 3.4  = 11.9    east = 15.3
```

---

## Catalog entries (when stills pass)

Flower — **do not retouch** besides confirming it is still `(−6, 8.6, π)`.

```js
{
  id: "barber-shop",
  folder: "barber-shop",
  label: "Haru barber",
  kind: "rectangle",
  district: "sakae",
  x: -14.7,
  z: 8.6,
  yaw: Math.PI,
  realHeight: 7.2,
  realWidth: 6.8,
  realDepth: 7.6,
},
{
  id: "pharmacy-shop",
  folder: "pharmacy-shop",
  label: "Haru pharmacy",
  kind: "rectangle",
  district: "sakae",
  x: 2.8,
  z: 8.6,
  yaw: Math.PI,
  realHeight: 6.8,
  realWidth: 6.6,
  realDepth: 7.6,
},
```

Ingest map (agent 07, unchanged):

- `barber-shop/yaw-000.png` ← `98.jpg` (shadow filled)
- `pharmacy-shop/yaw-000.png` ← `100.jpg` (date stamp filled)

`district === "sakae" && z >= 6` ⇒ `yaw === Math.PI` (agent 32 test 3). Both
new shops satisfy it. Phone booth is also in that filter — keep its yaw π.

### Reserved bays — cheap boxes until unique stills exist

Not `ORBIT_SUBJECTS`. Same language as agent 24 skyline: untextured
`MeshStandardMaterial` boxes, `roughness` 0.95, `metalness` 0, sit on
`groundHeight`. Replace with reconstructed shops later; **do not leave the
slots empty** or walking east shows two holes and the wall dies.

| id | x | z | w | d | h | colour | yaw |
|---|---|---|---|---|---|---|---|
| `sakae-south-a` | −23.2 | 8.6 | 6.6 | 7.8 | 6.8 | `0x6a6560` | π (or axis-aligned; box has no façade) |
| `sakae-south-b` | 11.9 | 8.6 | 6.8 | 7.8 | 7.0 | `0x736e68` | π |

2-storey mass only — no painted dummy signs. They exist so the party-wall
rhythm is already in the street.

When future unique meshes arrive, reuse these x / z / yaw / metres. Do not
invent shop brands in this pass (`TOWN.md`: original names, not Dobuita clones).
Haru on the two incoming stills is already on the photos; keep it.

---

## Furniture that has to move

### Phone booth — out of the pharmacy footprint

Catalog booth `x: 2.4, z: 6.2` sits **inside** pharmacy span `−0.5 … 6.1`.
Agent 07 left it in a 7.5 m hole that this wall closes.

Park it in the **2.4 m** pharmacy–south-b gap (widest slot, 0.75 m clearance
each side of a 0.9 m booth):

```
{ id: "phone-booth", x: 7.3, z: 6.2, yaw: Math.PI }
```

Same sidewalkS strip, still faces north into the street. Scout `booth`
`{ x: 2.4, z: 4, yaw: 0 }` must follow: **`x: 7.3`, `z: 4.0`, `yaw: 0`**.

Do not put it in the 2.2 m Midori–pharmacy gap (`x ≈ −1.6`) — 0.65 m
shoulders are too tight next to the pole at `x = −4`.

### Everything else stays

- Kei van `(4.2, 3.8)` — in the lane in front of the pharmacy. Period parking.
- Vending `(12.4, 6.8)` — south curb, in front of south-b, not inside it
  (shop north face ≈ 4.7; vending z = 6.8 is on the sidewalk under/against
  the hull, same as north-row vending at z = −5.4). If the hull eats it,
  slide to `x: 15.6` (east corner).
- Pole `x = −4` — in front of Midori’s east half. Typical.
- Pole `x = 16` — 0.7 m east of south-b, marks the wall end before Yokobori.

---

## Landmark cameras — north sidewalk, looking south

Scout lookAt is `sin(yaw)` on X, `cos(yaw)` on Z. **yaw `0` looks +Z / south.**
Eye `1.62` m. `PerspectiveCamera(55)`. Pitch `+0.04` (~2.3° up) — enough 2F,
less than sakae-north’s `+0.06` which clipped roofs at 6 m.

`GROUND.sidewalkN` is `z = −12 … −6`. North-row hulls occupy most of that
patch (fronts at z ≈ −4.8 … −3.5). A camera at a **south-shop x** and
`z = −6.5` is inside tobacco / soba / yaoya / arcade. Those poses screenshot
the interior of a visual hull.

**Stand in the north-row gaps.** Those slots are real sidewalk. Distance to
south centres is `8.6 − (−6.5) = 15.1 m`. At 55° vFOV / ~86° hFOV that is
~15.7 m of height and **~28 m of width** — three bays plus two gaps, which
*is* the continuous wall. The current `flower` close-up at `z = 5.2` only
sees one shop (~6 m wide) and cannot prove the wall.

North-row gap centres (from the table at the top):

| gap | x span | camera x |
|---|---|---|
| tobacco – soba | −21.8 … −17.2 | **−19.5** |
| soba – yaoya | −10.8 … −7.1 | **−9.0** |
| yaoya – arcade | −0.9 … 4.0 | **1.6** |
| arcade – records | 12.0 … 16.6 | **14.3** |

### Required `LANDMARKS` (add; do not steal existing names)

```js
"south-wall":  { x: -30.0, z: -6.5, yaw: 0.40, pitch: 0.03 },
"south-west":  { x: -19.5, z: -6.5, yaw: 0,    pitch: 0.04 },
"south-mid":   { x: -9.0,  z: -6.5, yaw: 0,    pitch: 0.04 },
"south-east":  { x:  1.6,  z: -6.5, yaw: 0,    pitch: 0.04 },
"south-end":   { x: 14.3,  z: -6.5, yaw: 0,    pitch: 0.04 },
"barber":      { x: -19.5, z: -6.5, yaw: 0.30, pitch: 0.04 },
"pharmacy":    { x:  1.6,  z: -6.5, yaw: 0.08, pitch: 0.04 },
```

| id | where | looks at |
|---|---|---|
| **south-wall** | west of tobacco, on sidewalkN | SSE down the south row. **Walking-east proof.** yaw `0.40` (`atan2(6.8, 15.1)` onto south-a) so the wall recedes through the right-centre of the frame |
| south-west | tobacco–soba gap | south-a + Haru barber |
| south-mid | soba–yaoya gap | barber + Midori (Midori 3 m right of the lens, still on-axis enough) |
| south-east | yaoya–arcade gap | Midori + Haru pharmacy. This x is also clear of north hulls at the pharmacy’s own x |
| south-end | arcade–records gap | pharmacy + south-b, Yokobori mouth just off the right edge |
| barber | same gap as south-west | yaw `0.30` onto Haru (`atan2(−14.7−(−19.5), 15.1)`). Shop card |
| pharmacy | same gap as south-east | yaw `0.08` onto Haru pharmacy. Shop card |

Keep existing `flower: { x: -6, z: 5.2, yaw: 0, pitch: 0.08 }` as the
**close-up** (1.5 m north of sidewalkS, same as today). Nav node `flower`
stays. The wall is proven by `south-wall` / `south-mid`, not by `flower`.

`minamihamaGo('south-wall')` then `minamihamaScreenshot('sakae-south')`.
`command.json` example:

```json
{ "id": "s1", "go": "south-wall", "screenshot": "sakae-south" }
```

Optional second sheet: `"go": "south-mid"` → `sakae-south-mid` (Midori in
the middle of a three-bay wall).

### What a pass looks like

From `south-wall` / `south-mid` you should see:

1. A **continuous 2F wall** on the far (south) curb, party-wall gaps ≤ 2.5 m
   reading as dark slots, not as park / sky (the sakae-north failure mode).
2. Midori’s 花屋みどり shopfront, Haru pole + yellow chairs, mint pharmacy
   tile — three different faces, one street line at `z ≈ 8.6`.
3. West reserved box and east reserved box holding the rhythm before their
   unique meshes exist.
4. Phone booth in the 2.4 m slot at `x = 7.3`, not exploding out of a façade.
5. Yokobori still a turn-off at `x ≈ 18`, not a shop jammed into the mouth.

If the north hull still clips a gap camera, pull **z to −3.2** (1.5 m south
of the arcade’s south face at −3.5, north carriageway) and keep yaw 0. Do
not push z down to 5.2 for these ids — that is the close-up, not the wall.

---

## Nav / waypoints (same pass if someone is in `nav-graph.json`)

South sidewalk fronts, 1.5 m north of sidewalkS (`z = 5.2`), matching today’s
`flower`. Bidirectional, no walking through hulls.

| id | x | z | edges |
|---|---|---|---|
| `south-a` | −23.2 | 5.2 | tobacco, barber |
| `barber` | −14.7 | 5.2 | south-a, flower, soba |
| `flower` | −6.0 | 5.2 | barber, pharmacy, soba, produce, sakae *(keep)* |
| `pharmacy` | 2.8 | 5.2 | flower, south-b, sakae, arcade |
| `south-b` | 11.9 | 5.2 | pharmacy, arcade, records, bar |

`flower` already exists at this pose. Add the other four. Drop any edge that
would cut a diagonal through a shop.

`WALK_WAYPOINTS` does not need a south-row stop this pass; scout landmarks
cover screenshots.

---

## Do not

- Edit sample source from this note (parent / a later agent applies it)
- Move Midori off `x = −6` / `z = 8.6` / `yaw = Math.PI`
- Use agent 07’s `barber x = −18` or `pharmacy x = 8` (gaps 5.5 m / 7.5 m)
- Face any south bay `yaw: 0` (that puts the back on the sidewalk)
- Leave the two reserved slots as empty sky — cheap boxes until unique stills
- Extend south-b east of **x = 15.3** (Yokobori mouth at 18)
- Keep the phone booth at `x = 2.4` once pharmacy is planted
- Stand wall cameras at south-shop x on sidewalkN (inside north hulls)
- Fill south-row gaps with agent 24 skyline boxes (those are **north** of
  the north row, `z ≤ −22`)
- Clone Dobuita shop brands; Haru is already on the incoming stills
