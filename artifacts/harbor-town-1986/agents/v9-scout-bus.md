# v9 scout — `bus` / Route 16

Read-only. Shot: `artifacts/harbor-town-1986/bus-v9.png` (t17 `go: bus`).
`bus-v8.png` is the same landmark and the same composition; v9 is the one
with the faded-green shelter lid and the rust drum in the near left.
Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20, overcast winter.
Convention: `+X` east, `+Z` south. Yaw `0` looks south.

`fill-route16.mjs` **is wired** (`main.mjs` `createStudio` calls
`addRoute16Fill` after `addWorldFill`). Named shelter / stall paint /
west-verge boxes / drums / fence exist in the scene graph. This still
only proves the pieces that fall in the frustum.

---

## Camera

`LANDMARKS.bus` `{ x: -32, z: 18, yaw: -1.2, pitch: 0.02 }`.

Eye on the east walk, ~8 m east and ~4 m north of unique `city-bus`
`(−40, 22)`, looking west-southwest at the grille. Horizontal look is
~69° west of south. 55° vFOV, ~3 m from the east face — a model shot,
not a highway shot.

Agent 53 expect for this go: *roof + bench at arm’s length, bus hull
still the hero in the lane, no fill intersecting it.*

---

## 1. Bus hull quality — **FAIL** (smear loaf, parked across the road)

Studio stills (`assets/city-bus/yaw-000.png` … `270`) are a boxy 80s
city bus: cream over dark green, red belt, 南浜 blind, 都営バス,
headlights, wipers, green wheels, mirrors. Kind `rectangle`,
`photoIterations: 0`, 3.05 m → res 48. Predicted hull: a 10.4 m box
with the stripe baked on.

**Pixels in `bus-v9`:** a motion-blurred tram potato. Cream / green /
rust-red belt survive as horizontal streaks. Windshield is a grey smear
with a purple-grey destination panel — **南浜 does not read**. Orange
bars from the still’s blind are painted onto the roof as a chewed
highlighter. Headlights, wipers, mirrors, wheel arches, tyres: gone.
Underbelly is a dark lip; contact with asphalt is acceptable (not a
hovercraft). Rear third is a cream shoebox with a door-shaped dent.

Facing: unique `yaw: π/2` puts the grille **east**. Camera looking west
therefore sees a ¾ front. That also lays the 10.4 m depth **across**
Route 16 (`x ≈ −45.2…−34.8`, `z ≈ 20.8…23.3`) instead of in a
southbound bay. The bus is a roadblock, not a layover.

Second loaf: instance `{ asset: "city-bus", x: -40, z: 38 }` peeks on
the far left as a truncated cream/green rear. Same hull, same yaw, ~16 m
south. Two melted buses in one still is worse than one.

v6 called this a tram potato. v9 did not un-melt it. Fill cannot fix a
visual hull.

**Cheapest later fix (not this note):** magenta-fill the four studio
contact shadows; **yaw `0`** (grille south, body along the N–S lane) at
a bay pose such as `(−38.2, 19.5)`; drop the `(−40, 38)` clone. Do not
add 45° stills until a cardinal `bus` shot looks like the studio front.

---

## 2. Shelter — **PASS as kit / FAIL as a stop**

Right of frame, arm’s length: faded-green slab roof, one steel post,
timber bench seat in the lower right. Matches `addRoute16Fill`
`addShelter` at `(−35.5, 16)` — roof `0x3d5a44`, posts `0x6a6e68`,
bench `0x6b5340`. Open side faces the road (−X). Sits on the pale walk
(`route16Walk`), **not** on the asphalt. That is the agent-53 pass
condition for furniture.

What the kit is not: no enamel 南浜 blade, no timetable box, no kerb of
a bus bay, no queue. Roof is a 1.55 × 3.05 m lid with a slight kerb
tilt; it reads as a park picnic roof parked on a highway shoulder.

`fill-world.mjs` still plants a **second** shelter (darker roof
`0x3a3a38` at `−35.9, 16`, posts at `x = −36.6`). v9’s green lid is
the route16 fill on top of that. Two kits in the same 2 m of walk.
Neither collides with the smeared hull in this photograph.

**Cheapest later:** leave the green kit; kill the `addRoute16Massing`
duplicate in `fill-world.mjs`; add a sign blade if the stop must read
as a stop.

---

## 3. Beige massing — **FAIL** (windowless slab in the hero slot)

Right-center, immediately north of the bus rear and behind the person:
a tall **beige / taupe** rectangular prism, ground to sky, no windows,
no fascia, no rain cap that reads. It is the largest wall in the still
after the bus itself. Overcast hemisphere light bleaches
`MeshStandardMaterial` `0x6a6560`-class concrete into cream; this face
is the lit one.

Likely body: `fill-world` `addSouthMassing` block
`{ x: -36, z: 18.5, w: 8.4, d: 7.2, h: 8.8, color: 0x6a6560 }`.
That AABB is `x −40.2…−31.8`, `z 14.9…22.1` — it swallows the `bus`
camera (`−32, 18`) and overlaps the unique hull’s east end. Default
front-face culling hides the box from an interior eye, so the shot
looks “past” it and the west/south face becomes a close beige cliff
beside the person. It is not west-verge architecture; it is a south-row
plug sitting on Route 16.

Left of the bus (south, far side of the carriageway): two **charcoal**
2-storey cubes with a darker cap on the nearer one. Those *are* the
specified west-verge massing (`fill-route16` `route16-massing-0/1` at
`(−48.9, 28)` / `(−48.85, 40)`, plus the older `fill-world`
`addRoute16Massing` twins at `(−49.2, 28)` / `(−49.2, 42)`). East faces
stay ≤ −46.7, out of the road. They read as warehouse flats, not a
national-highway verge, but they do their job: they kill the west sky.

Verdict: west charcoal boxes **PASS as fill, FAIL as buildings**. The
beige slab on the right **FAIL** — it is in the keep-out, it is the
wrong colour/read, and it turns the stop into a cul-de-sac.

**Cheapest later:** delete or slide the `(−36, 18.5)` south-fill cube
(and its `fill-south.mjs` cousin at `(−32, 19.6)` if that module is
ever imported) so the bus camera is not inside a box. Do not beige the
west verge; it is already the right grey.

---

## 4. Person — **PASS scale / FAIL as Saturday 15:20**

One `civilian-hiro` clone, navy school blazer, white shirt, dark
trousers, briefcase, A-stance, planted on the dark ground under a
telephone pole. Catalog row `{ asset: "civilian-hiro", x: -40, z: 18,
yaw: 1.5 }` — ~8 m west of the camera, ~4 m north of the unique bus,
yaw ~86° (facing east, into the lens). Height vs the 3.05 m hull is
adult-scale (not a giant, not a 32³ speck). Shoes meet the plane; no
magenta pedestal in this shot.

Problems that keep it from reading as a passenger:

- He is **not at the bench**. The shelter is on the right walk; he
  stands in the carriageway / lot mouth, in the bus’s east keep-out.
- One body, no queue, no second silhouette. 15:20 on a Route 16 stop
  in November is not one identical Hiro.
- The pole (`telephone-pole` instance `(−42, 18)`) is a chrome mast:
  insulator at the top of frame, shaft falling behind the beige wall,
  **no wires**. v6 already called these skyhooks. Unchanged.
- Same-face clone army (agent 49). Unique stays at Yaoya.

**Cheapest later:** move this instance onto the walk at the bench
(`~−35.1, 16`) facing the road; do not mint a second Hiro.

---

## 5. Lot — **PARTIAL** (drum yes, parking no)

Ground in frame, west → east as the camera sees it:

| band | pixels | source |
|---|---|---|
| Pale raised walk, foreground | `0xb7b1a4` slab under the eye | `route16Walk` (−36.5…−34.5, 10…50) |
| Dark asphalt under the bus | wet-grey, no centreline, no bay paint | `route16Road` and/or `route16Lot` |
| Rust-brown 8-gon cylinder, lower left | oil-drum stand-in | `route16-oil-drum-0` at `(−33.55, 20.42)` |

That drum is the proof `addRoute16Fill` ran. Colour `0x7a3a2c`, ~0.88 m
tall, on the north-west corner of `route16Lot`.

**Not in the photograph:**

- Stall dashes / west ticks (`route16-stall-dash-*`, `route16-stall-tick-*`).
  Five bays live at `x −33.55…−29.05`, `z 21.4…33.5` — behind and
  left-rear of a west-looking eye at `z = 18`. Paint cannot pass or
  fail from this still.
- Chain-link posts + three rails. East run is `x = −25.42` (**behind**
  the camera). South run `z = 33.88` is ~16 m south, out of the ¾ bus
  close-up.
- Occupied bays. No kei van instance in this lot (agent 27’s Carry was
  never planted). Empty brown apron if you already know it is a lot;
  empty asphalt if you do not.
- Zebra / T with Sakae. Camera does not look north.

So: the lot is a dark plane with one drum. Fill’s parking language is
wired and mostly **out of frustum**. Do not reshoot `bus` to QA paint;
`go: route16` `{ x: -33, z: 11.8, yaw: -0.38 }` is the stall-paint
camera and is not in t17.

---

## Scoreboard

| piece | in `bus-v9` | verdict |
|---|---|---|
| `city-bus` unique hull | smeared ¾ front, stripe only, no 南浜 | **FAIL** |
| `city-bus` instance `(−40, 38)` | ghost rear, left edge | **FAIL** (clone) |
| Bus facing / bay | grille east, body across the N–S road | **FAIL** |
| `route16-shelter-*` | green lid + post + bench, on the walk | **PASS** (kit) |
| Duplicate `fill-world` shelter | not separately readable | leftover |
| Beige south-fill slab `(−36, 18.5)` | windowless cliff, right of hull | **FAIL** |
| West-verge `route16-massing-*` | two charcoal cubes, far left | **PASS** as fill |
| Hiro `(−40, 18)` | one planted adult, wrong place | **FAIL** as a stop |
| Telephone pole | skyhook through the beige wall | **FAIL** as kit |
| Oil drum | one rust cylinder, near left | **PASS** |
| Lot paint / fence / kei bays | out of frustum | **UNVERIFIED** here |
| `fill-route16.mjs` wired | shelter + drum visible | **yes** |

**Still score: 3/10.** Better than v6 (2/10) only because the green
shelter and one drum prove the fill module landed. The hero is still a
melted loaf in a grey lot against warehouse flats.

---

## What should have read (agent 53) vs what does

| go | expect | v9 |
|---|---|---|
| `bus` | roof + bench at arm’s length | **yes** |
| `bus` | hull the hero in the lane | **no** — smear, across the lane |
| `bus` | no fill intersecting the hull | **no** — beige south-fill AABB eats the east face |
| `route16` | shelter on the right walk, dashes in the lot, verge wall west of the bus | **not shot in t17** |

Pass condition from 53 for the *module*: named meshes, road and bus
AABB empty of fill, buildings west of `x = −46.5`. Shelter and drums
obey. The beige south-fill cube does **not** — it is a different
module sitting in this landmark.

---

## Cheapest next (other agents; no source this pass)

1. **Hull / pose** — not a fill problem. New stills only after shadows
   are magenta; then yaw `0` in a N–S bay; delete the second bus.
2. **Beige slab** — move or delete `addSouthMassing` `(−36, 18.5)` so
   `go: bus` is not inside a 8.4 × 7.2 m box.
3. **Hiro** — walk him to the bench; leave him unique-looking.
4. **Lot QA** — shoot `route16`, not another `bus` close-up.
5. **Do not** retouch `fill-route16.mjs` for this still. It is doing
   what it was asked: shelter on the walk, drum on the lot lip,
   charcoal verge west of the carriageway.
