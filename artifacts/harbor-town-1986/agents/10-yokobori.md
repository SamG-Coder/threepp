# 10 — Yokobori alley (neon-dormant 1986)

Plan only. Do **not** edit sample source from this note.

Time lock is Saturday 29 November 1986, **15:20**, overcast winter afternoon.
Galaxy sakaba’s neon (the 銀河酒場 blade, the roof `GALAXY` box, the red chōchin)
is **dormant** — glass and enamel only. The noren reads `OPEN 17:00`; interiors
may show a hint of tungsten through the curtain, street stays daylight.

Convention (`map.mjs`, `TOWN.md`, scout lookAt): `+X` east, `+Z` south. Camera
and plant yaw share the same axis: **yaw `0` faces south (`+Z`)**, yaw `Math.PI`
faces north, yaw `-Math.PI / 2` faces west. Local `+Z` on a reconstructed mesh
is the yaw-000 front still.

---

## Ground facts

`GROUND.alley` in `src/map.mjs`:

```
alley: { minX: 18, maxX: 42, minZ: 12, maxZ: 28, y: 0.04, color: 0x6a5e52 }
```

24 m east–west × 16 m north–south. Centre `(30, 20)`. `TOWN.md` district row
(`yokobori` origin `24, 22`, size `28 × 12`) is a sketch; **this patch is
authoritative**.

Sakae sandwich immediately north:

| patch | x | z | y | colour |
|---|---|---|---|---|
| asphalt | −48…48 | −8…12 | 0 | `0x3a3a3c` |
| sidewalkS | −40…40 | **6…10** | **0.08** | `0xb7b1a4` |
| alley | 18…42 | **12…28** | **0.04** | `0x6a5e52` |

Cassette shop / records sits at `(20, −8.5)`, yaw `0`. Nav node `records` is
`(20, 0)`. The mouth of Yokobori is due south of that shop, across the street
and the south sidewalk.

Catalog bar today: `yokobori-bar` / Galaxy sakaba at **`(26, 16)`, `yaw: 0`**,
`realWidth 6.2`, `realDepth 7.4`, `realHeight 8.1`.

`WALK_WAYPOINTS` has no Yokobori stop (hill → stairs → sakae-west → sakae-east
→ harbor-gate → quay). `nav-graph.json` does (`yokobori` at `(26, 16)`, edges
`records` and `harbor-gate`). Scout landmark `bar` is `{ x: 22, z: 12, yaw: 0.15, pitch: 0.06 }`.

---

## Alley floor: material, width, how it meets sidewalkS

**Material.** Keep `0x6a5e52` (rgb 106, 94, 82) — stained taupe concrete / old
asphalt, a full step browner than Sakae’s tan sidewalk (`0xb7b1a4`). Roughness
`0.95`, metalness `0`, same `MeshStandardMaterial` as the other patches. It
should read as a back-street slab that stayed wet after the morning drizzle
(`TOWN.md`: no rain now, wet from earlier). Do not retint it toward the street
grey; the colour change *is* the district cue.

Optional (furniture, not a new `GROUND` key): a 0.6 m darker centre drain
strip `0x5a4e44` down the lane, flush with the alley (`y = 0.045`). Skip if
the patch stays a single plane.

**Width.** The 24 m slab is the **district floor**, not the walkable yokochō.
A 24 m opening off Sakae is a plaza. The alley *proper* is the north–south
slot along the **west** edge:

- West wall of the slab: `x = 18`
- Bar front plane after the yaw fix below: `x ≈ 22.3`
- Clear lane: **≈ 4.3 m** (`x = 18 … 22.3`)
- After the extra vending (0.72 m deep off the façade) the pedestrian slot is
  **≈ 3.5 m** — tight enough to read as 横丁, wide enough for Hiro plus a
  crate stack

Do not shrink `GROUND.alley` to 4 m: crates, pole, and the bar footprint sit
on the same brown slab. The unused east remainder (`x ≈ 30 … 42`) is
back-court paving behind the sakaba (service door, wiring from yaw-180).
Leave it; do not drop a second shop there in this pass.

**Meeting sidewalkS.** Today they **do not touch**. sidewalkS ends at `z = 10`,
alley starts at `z = 12`. The 2 m gap is still `GROUND.asphalt` at `y = 0`
(`asphalt.maxZ = 12`). Walking south you hit: tan 8 cm curb → 2 m of street
grey 4 cm *below* the alley → brown alley. That reads as “the road continues”,
not “you turned into a lane”.

Pull **`alley.minZ` from 12 to 10** so the brown slab abuts `sidewalkS.maxZ`.
Then the threshold is a single **4 cm step down** (0.08 → 0.04) at `z = 10`,
`x = 18 … 22.5` — the mouth. Keep the rest of sidewalkS tan; do not recolour
the whole south curb. The 4 cm drop plus the hue change is the gutter lip;
no extra mesh required.

If the patch must stay `minZ: 12`, at least paint `z = 10 … 12`, `x = 18 … 23`
with the alley colour (a second tiny patch, same `y = 0.04`) so the mouth is
not a band of fresh asphalt.

Mouth width in plan: **~4.5 m** (`x = 18 … 22.5`). East of that, the bar’s
north gable (yaw-270 balcony wall) forms the right jamb as you enter.

---

## Bar yaw `0` is wrong — face west

`yaw: 0` plants the reconstructed **front on `+Z`**. At `(26, 16)` that means
the Galaxy blade, noren and `OPEN 17:00` face **south**, into the empty south
half of the slab. Anyone walking in from Sakae (from `z = 10` toward `z = 16`)
meets the **back** first: yaw-180 service door, meters, cable tangle.

That is a street-front shop sitting in a yard, not a yokochō sakaba.

Sakae already uses the opposite rule correctly: north row `yaw: 0` (face the
street, south), south row `yaw: Math.PI` (face the street, north). The florist
at `(−6, 8.6)` is the south-row pattern. Galaxy is **not** a south-row shop —
it is 6 m south of sidewalkS, inside the alley envelope. Facing north
(`Math.PI`) would only make it a misplaced south-row façade with a 6 m
forecourt.

**Face west into the lane.** Set

```
yaw: -Math.PI / 2
```

Keep the catalog position `(26, 16)` this pass.

Footprint with agent-21’s plant convention (`realWidth` → local X, `realDepth`
→ local Z, Three.js `rotation.y`):

```
wx = 26 + lx * cos(yaw) + lz * sin(yaw)
wz = 16 − lx * sin(yaw) + lz * cos(yaw)
```

`yaw = −π/2` → local `+Z` (front) → world `−X`. Half-extents `hx = 3.1`,
`hz = 3.7`:

| local | world (x, z) | what |
|---|---|---|
| (0, +3.7) front | **(22.3, 16.0)** | noren / blade, faces the lane |
| (0, −3.7) back | (29.7, 16.0) | service door, back-court |
| (−3.1, +3.7) front-left | **(22.3, 12.9)** | north jamb of the mouth |
| (+3.1, +3.7) front-right | (22.3, 19.1) | south end of the façade |

North gable sits 0.9 m south of today’s `alley.minZ` (2.9 m south of
sidewalkS). That is the “first sakaba on your right” as you turn off Sakae —
gable and balcony in the entrance, front unrolling as you walk south.

`realWorldScale` still ignores `realDepth` and scales XZ from `realWidth`;
the authored 6.2 × 7.4 plan is what seating and this layout use.

Do **not** use `+Math.PI / 2` (face east). That puts the front into the
empty east court; the lane west of the bar would show the back again.

---

## Where the pieces sit

Lane centre-line ≈ `x = 20.2`. All extras hug walls; nothing in the 3.5 m
walk slot.

### Bar (already catalogued)

| | |
|---|---|
| id | `yokobori-bar` / Galaxy sakaba |
| x, z | **26, 16** (keep) |
| yaw | **`-Math.PI / 2`** (change; currently `0`) |
| district | `yokobori` |

### Extra vending

No yokobori instance exists. Sakae already has three (`18.5, −5.4` north of
records, `−31, 6.0` and `12.4, 6.8` on the south curb). The alley one is a
fourth **instance** of `vending-enamel`, not a new orbit subject.

Stand it on the façade, **south of the door**, facing the lane so a walk
south hits noren then the machine:

```
{ asset: "vending-enamel", x: 21.94, z: 18.6, yaw: -Math.PI / 2 }
```

- `x = 22.3 − 0.72/2 = 21.94` — back flush to the front plane
- `z = 18.6` — ~1.5 m south of door centre `(22.3, 16)`, still on the
  6.2 m façade (`z = 12.9 … 19.1`)
- yaw west, same as the bar
- 0.9 × 0.72 × 1.82 m (`catalog.mjs`)

Do not put it on the west wall facing east: that copies the south-curb
vendings and hides it from the landmark camera.

### Pole

Sakae poles already sit at `z = 5.6` (`x = −4, 16, 36`) and `z = −6.2`
(`x = −22, 28`). The nearest (`16, 5.6`) is in the street 2 m west of the
mouth, not in the alley. Yokobori needs its own mast for the wires that
should read over the lane.

```
{ asset: "telephone-pole", x: 18.35, z: 11.4, yaw: 0 }
```

- West jamb of the mouth, on the threshold (`z = 11.4` is the sidewalkS /
  alley seam once `minZ` is 10; if the patch stays at 12, use `z: 12.3`)
- `x = 18.35` keeps the 0.35 m cylinder on the slab, out of the 3.5 m walk
- Cylinder, yaw 0 is fine (crossarm already east–west in yaw-000, spanning
  the mouth)
- Do not add a second pole this pass; one silhouette at the entrance is the
  landmark. A south-end mate at `(18.4, 26)` is optional later for a wire
  run.

### Crates

No crate orbit subject. Do **not** invent a magenta-studio stack for this
pass. Add cheap boxes in `addStreetFurniture` (same path as the quay wall
and road dashes) — rectangle, wood, no reconstruction.

Three beer-crate modules, each `0.48 × 0.32 × 0.36` (w × h × d), colour
`0x6b4423`, roughness `0.9`:

| id | x | z | y | yaw | note |
|---|---|---|---|---|---|
| stack A (2 high) | 22.55 | 19.35 | 0.36 | −0.12 | south of vending, against the façade |
| stack B (3 high) | 22.70 | 19.75 | 0.52 | 0.20 | nested, slightly proud of A |
| stack C (1 high) | 18.55 | 17.2 | 0.20 | 0.4 | west wall, opposite the door, pinches the lane |

`y` is centre-height above the alley (`alley.y + half-height`). A/B sit on
the east side so they catch in the 3/4 façade shot; C is a dark block on
the left as you look down the alley, not a trip in the centre.

If a later drop wants photoreal crates, new subject `beer-crates`, kind
`rectangle`, 2 cardinals would do — still sit them at A.

---

## Camera landmark

Current `LANDMARKS.bar` `{ x: 22, z: 12, yaw: 0.15, pitch: 0.06 }` stands
**on the west front plane** once the bar faces west (`x ≈ 22.3`). It would
clip the noren. Retire that pose.

Replace (or add `yokobori` and keep `bar` as an alias) with a mouth shot
looking **south down the lane**, Galaxy blade on the left, pole on the right,
dormant neon against the steel-blue sky:

```
yokobori: { x: 20.2, z: 10.4, yaw: 0.18, pitch: 0.07 }
```

| | |
|---|---|
| x 20.2 | lane centre-line, 2.1 m west of the façade |
| z 10.4 | last of sidewalkS / first of the 4 cm step, looking in |
| yaw 0.18 (~10° east of south) | pulls the west front into the left third |
| pitch 0.07 | includes the 8.1 m `GALAXY` roof box without putting the camera in the sky |

Scout lookAt is `sin(yaw)` on X, `cos(yaw)` on Z. From this pose a 6 m look
lands near `(21.3, 2.0, 16.3)` — chest height, just off the door, blade
rising out of frame-left. Overcast fill from `HemisphereLight 0xc8d4e0`;
the west-low sun (`DirectionalLight` at `(-30, 40, 18)`) grazes the façade.

Key `7` / `minamihamaGo('yokobori')` / `command.json` `"go": "yokobori"`.
Do not reuse `"go": "bar"` without remapping the pose.

Optional second pose (straight-on, not the beauty shot):

```
galaxy: { x: 19.6, z: 16.0, yaw: Math.PI / 2, pitch: 0.08 }
```

Across the lane, looking east at the noren. Use for a shop card; the alley
shot is `yokobori`.

---

## Waypoints / nav (same pass if someone is already in `map.mjs`)

Add to `WALK_WAYPOINTS`:

```
{ id: "yokobori", x: 20.2, z: 16, look: [22.3, 2.4, 16] }
```

Standing in the lane at door height, looking at the façade. Insert it after
`sakae-east` (the walk from records into the alley) and before `harbor-gate`.

Move nav node `yokobori` off the building origin:

```
{ "id": "yokobori", "x": 20.2, "z": 16, "edges": ["records", "harbor-gate"] }
```

`(26, 16)` is inside the bar once yaw is west.

---

## Do not

- Edit sample source from this note (parent / a later agent applies it)
- Face the bar south (`yaw: 0`) or north (`Math.PI`)
- Face it east (`+Math.PI / 2`)
- Drop a new reconstructed crate / second sakaba / neon-on night variant
- Grow `GROUND.alley` east of 42 or south of 28
- Stand the extra vending on Sakae (`z < 10`)
- Keep scout `bar` at `(22, 12)` after the yaw change
