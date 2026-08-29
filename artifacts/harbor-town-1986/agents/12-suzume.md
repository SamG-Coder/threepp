# 12 — Suzume-zaka (stairs, path, house plots)

Plan only. Do **not** edit sample source from this note. Parent applies
stairs / `hillPath` / `INSTANCES` / `LANDMARKS` in a later pass.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Feel: Shenmue Chapter 1 **Sakuragaoka** — stone stairs, timber houses on
石垣 terraces, town and harbour in the bowl below. Original place names.

Convention (`map.mjs`, `TOWN.md`, scout `lookAt`): `+X` east, `+Z` south.
Walk / plant yaw share the axis: **yaw `0` faces south (`+Z`)**, `π` north,
`π/2` east, `−π/2` west. Reconstructed local `+Z` is the yaw-000 still.
`wooden-hill-house` yaw-000 is the **玄関** (noren, slippers, CMU planter).
`EYE = 1.62`. `PerspectiveCamera(55, …)`.

Related notes (do not fight them): `02-hill-house.md` (stills),
`21-slope-seat.md` (plant Y), `23-nav-graph.md` (walk spine),
`28-spawn-feel.md` (SPAWN look).

---

## Ground facts (as shipped)

```3:12:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\map.mjs
export function groundHeight(x, z) {
  let y = 0;
  if (z < -12) {
    const t = Math.min(1, Math.max(0, (-z - 12) / 34));
    y += t * t * 7.2;
  }
  if (z > 88) y = -0.35;
  else if (z > 52) y = 0.04;
  return y;
}
```

Hill is **independent of X**. Toe at `z = -12` (`y = 0`). Crest formula
reaches `7.2 m` at `z = -46`. Derivative `dy/dz = −(14.4 t) / 34 ≈ −0.4235 t`.

| z | t | y (m) | \|dy/dz\| | angle |
|---|---|---|---|---|
| −12 | 0.000 | 0.00 | 0.000 | 0.0° |
| −16 | 0.118 | 0.10 | 0.050 | 2.9° |
| −20 | 0.235 | 0.40 | 0.100 | 5.7° |
| −24 | 0.353 | 0.90 | 0.149 | 8.5° |
| −28 | 0.471 | **1.59** | 0.199 | 11.3° |
| −34 | 0.647 | **3.01** | 0.274 | 15.3° |
| −36 | 0.706 | 3.59 | 0.299 | 16.6° |

`SPAWN = { x: -22, z: -28, yaw: 0.4 }`. Eye is `groundHeight + EYE ≈ 3.21 m`,
not unused `SPAWN.y = 1.6`.

`GROUND.hillPath` `{ minX: -24, maxX: -16, minZ: -36, maxZ: -12, y: 0.05 }`
is a **flat** `addGroundPatch` card. At spawn it is buried ~1.5 m under the
height field; at the toe it floats 5 cm over asphalt. It never reads as a
path. Park `{ y: 0.02, minZ: -48 }` is the same bug at district scale.

Height field in `createStudio` is `PlaneGeometry(96, 72)` at the origin:
**x −48…48, z −36…36**. Hero house `z = -34` already hangs its north eaves
off the mesh (`21-slope-seat` NE corner `z ≈ -39`).

Stone stairs (`addStreetFurniture`): 12 boxes, centreline **x = −20**.

```
z = -12.4 - i * 1.05          // i = 0…11 → z = -12.4 … -23.95
BoxGeometry(6.5, 0.24, 1.12)  // width, rise, tread (+ 7 cm nosing overlap)
position.y = groundHeight(-20, z) + 0.12
```

Hero house: `wooden-hill-house` at **(−28, −34), yaw = 0.42**,
`realHeight 7.4`, `realWidth 8.2`, `realDepth 7.6`.

Scout as shipped (broken for the house):

| id | x, z | yaw | looks at |
|---|---|---|---|
| spawn | −22, −28 | 0.55 | arcade, skips the stairs (`28-spawn-feel`) |
| hill | −22, −32 | −0.35 | SSW town; house is behind-left |
| house | −22, −28 | −0.55 | SSW **away** from the genkan |
| stairs | −18, −14 | 0.15 | sidewalk / Sakae, almost no treads |

---

## 1. Stair geometry — on the slope, not in the air

Keep **12 steps**, centreline **x = −20**, width **6.5 m**, run **1.05 m**,
tread box **1.12 m** (7 cm nosing overlap), slab **0.24 m**. Do not tilt
the boxes (`rotation.x = 0`): real treads are level; the quadratic is
absorbed as rise.

### Why the shipped Y floats

`y = groundHeight(centre) + 0.12` puts the **bottom face on the centre
contour**. Downhill of centre the ramp drops; uphill it rises.

At the top tread (`i = 11`, `z = -23.95`) `|dy/dz| ≈ 0.149`. Over
`±0.56 m` that is **±8 cm**. Downhill lip is an 8 cm air wedge (visible).
Uphill lip is 8 cm of buried stone (fine — that is a riser). Agent 21
noted the box still *intersects* the hill; the downhill gap is the part
this note fixes.

### Y that seats the downhill lip

Sample the **south / downhill** edge, then add half-height:

```js
const TREAD = 1.12;
const RISE = 0.24;
const HALF = TREAD * 0.5;          // 0.56
const RUN = 1.05;
for (let i = 0; i < 12; i++) {
  const z = -12.4 - i * RUN;
  const gDown = groundHeight(-20, z + HALF);
  const step = new THREE.Mesh(new THREE.BoxGeometry(6.5, RISE, TREAD), stone);
  step.position.set(-20, gDown + RISE * 0.5, z);
  step.castShadow = true;
  step.receiveShadow = true;
  scene.add(step);
}
```

| i | z | gDown | **new y** | old y | old float | uphill nosing |
|---|---|---|---|---|---|---|
| 0 | −12.40 | 0.000 | **0.120** | 0.121 | 1 mm | 0.23 m (curb onto sidewalk) |
| 5 | −17.65 | 0.161 | **0.281** | 0.319 | 38 mm | 0.16 m |
| 8 | −20.80 | 0.423 | **0.543** | 0.602 | 59 mm | 0.12 m |
| 11 | −23.95 | 0.808 | **0.928** | 1.009 | **81 mm** | 0.07 m |

Tread top is always `gDown + 0.24 ≥ gUp` on this flight, so the walking
surface is never under grass. Width does not matter (`groundHeight`
ignores X); 6.5 m stays a public 坂 stair, not a garden flight.

Per-step rise (top-to-top) equals the terrain rise over one `RUN`
(~1 cm at the toe, **~16 cm** at the head). Lower treads read as stone
paving that *becomes* stairs — that is the right Japanese kidan, not a
bug. Do not compress 12 steps onto the steep band; spawn’s 3 s of `W`
(`28-spawn-feel`) is tuned to this spacing.

Do **not** extend the flight to `z = -28`. Spawn sits on gravel **above**
the last tread; the stairs are the event you walk onto, not a carpet
under the camera.

---

## 2. Path — spawn to Sakae

Ribbon stays `GROUND.hillPath` in plan: **x −24…−16, z −36…−12**, colour
`0x9a9488`. That AABB already contains SPAWN, the stair shoulders, and
the merge onto `sidewalkN` (`z = -12…-6`).

### Drape it

Stop feeding `hillPath` (and `park`) through `addGroundPatch`. Displace a
strip the same way as the height field, **+5 cm** to avoid z-fight:

```js
function addDrapedPatch(scene, spec, segsZ = 24, lift = 0.05) {
  const width = spec.maxX - spec.minX;
  const depth = spec.maxZ - spec.minZ;
  const geo = new THREE.PlaneGeometry(width, depth, 1, segsZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cx = (spec.minX + spec.maxX) / 2;
  const cz = (spec.minZ + spec.maxZ) / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx;
    const z = pos.getZ(i) + cz;
    pos.setY(i, groundHeight(x, z) + lift);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.95, metalness: 0 }),
  );
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  scene.add(mesh);
}
```

Call `addDrapedPatch` for `hillPath` and `park`. Leave asphalt / sidewalks
/ dock / water on the flat helper — they sit where `groundHeight` is 0.

On `z ∈ [-24, -12]` the **stones are the path**. The gravel strip can
still run under them (shoulders at `x = -24…-23.25` and `-16.75…-16`);
the 5 cm lift plus 24 cm slabs will not z-fight.

### Walk line (hold `W` from SPAWN)

`28-spawn-feel` preferred look: `yaw = 0.18`, `pitch = -0.2`. Forward
`(sin 0.18, cos 0.18) ≈ (0.179, 0.984)`.

| id | x | z | y | how you get there |
|---|---|---|---|---|
| spawn | −22 | −28 | 1.59 | start, 2 m west of centreline |
| path-bend | −21.3 | −24.1 | 0.91 | 4 m of `W` — stair head |
| stair-top | −20 | −23.95 | 0.89 | last tread (`i = 11`) |
| stair-mid | −20 | −18.70 | 0.28 | `i = 6` |
| stair-foot | −20 | −12.40 | 0.00 | `i = 0`, onto `sidewalkN` |
| sakae-west | −14 | 0 | 0 | `WALK_WAYPOINTS` / tobacco–soba gap |
| sakae | 0 | 1.5 | 0 | `LANDMARKS.sakae` |

~16 m of `W` (4.5 s at 3.6 m/s) is the foot of the flight; ~28 m is
Sakae-dori. Do not spawn on asphalt. Do not face north.

Short **genkan spur** (not a new `GROUND` key): from spawn
`(−22, −28)` west-north to the hero front plane
`≈ (−26.5, −30.5)`. Packed earth / three stepping stones is enough.
Keep the 8 m ribbon clear of house footprints.

### Park

Shipped park AABB swallows the path and the hero. Shrink to a NW grass
pocket on the mesh, still draped:

```
park: { minX: -46, maxX: -40, minZ: -36, maxZ: -26, color: 0x4a5c3a }
```

Height-field vertex colours already paint `z < -12` grass. The pocket is
an optional darker patch, not the whole district.

### Height field

Extend north so the hero’s uphill corners and the park exist. Minimum
for this district: cover **z −50…36** (e.g. `PlaneGeometry(96, 86)`
moved to `z = -7`, or keep origin and use depth 100). Coordinate with
`28-spawn-feel`’s 110 × 160 harbour enlarge — one mesh, not two.

---

## 3. House orientation — front visible from spawn

Catalog yaw **0.42 rad (24° east of south)** is the right hero pose.
Do not zero it. Do not flip to `π`.

- Mesh yaw 0 → 玄関 faces `+Z` (south), same rule as Sakae north row.
- After `rotation.y = 0.42`, front direction is
  `(sin 0.42, cos 0.42) ≈ (0.41, 0.91)` — SSE, downhill toward the path.
- Spawn `(−22, −28)` is **6 m east, 6 m south** of the house. Bearing
  from house to spawn is `atan2(6, 6) = 0.785` (45°).
- Angle between front normal and spawn is **21°**. That is a 3/4 of the
  玄関 + east planter, not a gable. From spawn, look
  `yaw = atan2(-6, -6) ≈ -2.36` (the `house` landmark below).

`yaw = 0` would split the frame 50/50 genkan / east gable (and the east
gable is the still `02-hill-house` wants regenerated). `yaw = 0.85`
would be dead-on to spawn and hide the downhill face. **0.42** keeps the
house a hillside house that *also* greets the path.

Seat the slab with `21-slope-seat` **min of four catalog corners** if
the terrace pads below do not ship. Origin sampling hovers the downhill
corner **1.24 m** and buries the uphill **1.58 m**.

### Terrace pads (Sakuragaoka 石垣)

An 8.2 × 7.6 m unpitched box cannot sit on a 15° ramp. Cut a **level
pad** under each plot and put a low stone retaining box on the downhill
lip. Pad Y = average of the four corners (cut uphill, fill downhill).

Hero pad:

| | |
|---|---|
| centre | (−28, −34), yaw 0.42 |
| half-extents | hx 5.0, hz 4.6 (1 m yard around 8.2 × 7.6) |
| pad Y | **3.11 m** (four-corner average; origin is 3.01) |
| downhill min | 1.77 m → retaining **~1.3 m** |
| uphill max | 4.59 m → cut **~1.5 m** |

Retaining box, same stone as the stairs: roughly
`BoxGeometry(9.2, 1.3, 0.45)` on the south face of the pad, top flush
with pad Y. Then `plantMesh` at `group.position.y = padY` (not raw
`groundHeight`). Same helper for every hill instance.

If pads are deferred, ship `footprintSeatY` min from agent 21 and accept
the uphill gap; do not leave origin seating.

---

## 4. Extra house instances (same mesh)

`wooden-hill-house` cloned via `INSTANCES`. Same 7.4 / 8.2 / 7.6 metres.
Clear the path corridor **x −24.5…−15.5**. Stay south of `z = -36` until
the height field grows. Stay north of `z = -18` so the north-row shops
(tobacco `−25, −8.5`, soba `−14, −8.5`) keep their sky.

| id | x | z | yaw | pad Y | role |
|---|---|---|---|---|---|
| **A** (unique) | **−28** | **−34** | **0.42** | 3.11 | hero, 3/4 genkan from spawn |
| **B** | −38 | −22 | 0.35 | 0.72 | downhill west; density on the left while walking to Sakae |
| **C** | −10.5 | −30 | −1.35 | 2.10 | east of the path, front faces the ribbon (WSW) |
| **D** | −42 | −30 | 0.70 | 2.20 | far-west terrace, second roof in the overlook |

```js
{ asset: "wooden-hill-house", x: -38, z: -22, yaw: 0.35 },
{ asset: "wooden-hill-house", x: -10.5, z: -30, yaw: -1.35 },
{ asset: "wooden-hill-house", x: -42, z: -30, yaw: 0.70 },
```

Yaw jitter so the clone does not read as one stamp. A and D front SSE /
ESE (downhill + path). C fronts the path, not the harbour — street-facing
lots, view from the side.

Footprint check (centres, ~11 m minimum): A–B 15.6 m, A–C 18.0 m,
A–D 14.6 m, B–D 11.3 m. C front plane at yaw −1.35 lands near
`x ≈ -14.2`, ~1.8 m east of the path edge — a tight front yard, no
overlap with the 6.5 m stair.

Optional later (needs terrain to `z ≈ -50`): **E** at `(−30, −42), yaw 0.3`
on the crest above A. Do not place it on the current 72 m mesh.

Pass `ORBIT_SUBJECTS` `wooden-hill-house` into `plantMesh` for instances
so seating sees `realWidth` / `realDepth` (`21-slope-seat` call site).

---

## 5. Landmark cameras — house + town below

Replace the four Suzume keys in `LANDMARKS`. Keys 1–4 stay spawn / hill /
house / stairs. `y` omitted → `groundHeight + EYE`.

```js
spawn: { x: -22,   z: -28,   yaw: 0.18,  pitch: -0.20 },
hill:  { x: -36,   z: -35,   yaw: 0.52,  pitch: -0.14 },
house: { x: -21.5, z: -27.2, yaw: -2.34, pitch:  0.08 },
stairs:{ x: -20,   z: -23.5, yaw: 0.08,  pitch: -0.28 },
```

### `spawn` — hill-to-street beat

Same XZ as `SPAWN`. Yaw **0.18** / pitch **−0.20** from `28-spawn-feel`
(not shipped `0.55 / -0.12`). Stairs left-of-centre, tobacco | soba |
yaoya across the far plane, house **behind** the camera. Sync `SPAWN.yaw`
and `walk.pitch = SPAWN.pitch ?? 0` or the landmark and the boot pose
disagree again.

### `house` — 玄関 from the path

Stand on the ribbon, look at A. Bearing `atan2(-28-(-21.5), -34-(-27.2))
= atan2(-6.5, -6.8) ≈ -2.38`. Use **−2.34** so the planter gable does
not win the frame. Pitch **+0.08** aims at the noren, not the ridge
(`Δy` to mid-facade over 9.4 m is ~0.2; we bias down to the genkan).
This is the shot the shipped `house` landmark (yaw −0.55) inverted.

### `hill` — Sakuragaoka postcard

Stand **west-and-up** of A, look SSE. Eye at `z = -35` is
`groundHeight ≈ 3.32 + 1.62 ≈ 4.94 m`.

- A `(−28, −34)` is 8 m east, 1 m south → **left third**, full two-storey
  timber + tile, laundry on the balcony.
- Path and 12 treads drop through the centre toward `z = -12`.
- Sakae north row ~35 m south, harbour warehouses in the `40–140` fog.
- Pitch `−0.14` ≈ `atan((0 − 4.94) / 35)` — street level in the middle
  of the 55° frame, not the winter sky.

D `(−42, −30)` sits further left as a second roof. B is downhill, not in
the way of the look ray `(sin 0.52, cos 0.52)` toward `(-26, -18)`.
Do not put a plot at `(−36, −35)`.

### `stairs` — looking down the flight

On the top tread, yaw almost due south, pitch **−0.28** so the 12 level
stones lead the eye to the sidewalk and the soba/tobacco pair. House is
behind; this is the “town below” half of the pair with `hill`.

Do not keep `{ x: -18, z: -14, pitch: -0.2 }`: that is already off the
flight, looking at paving.

### What each frame must contain

| landmark | house A | stone stairs | Sakae roofs | harbour haze |
|---|---|---|---|---|
| spawn | no (behind) | yes, left | yes | maybe |
| house | **genkan 3/4** | no | no | no |
| hill | **left foreground** | centre drop | **yes** | **yes** |
| stairs | no (behind) | **foreground** | yes | maybe |

`hill` is the one that has to feel like Sakuragaoka. If A is missing,
the camera is too far east (on the path) or yaw is still negative.

---

## Nav / clamp (do not overwrite the sample graph)

Artifact graph `23-nav-graph.json` already walks `hill — stairs —
tobacco/soba`. After this layout:

| node | x, z | edges |
|---|---|---|
| spawn | −22, −28 | house, stairs |
| house | −24, −30 | spawn |
| hill | −22, −32 | spawn (optional overlook stub) |
| stairs | −20, −14 | spawn, tobacco, soba |

Keep `stairs` at the **foot** for the street graph (agent 23). The scout
landmark `stairs` is the **head** — different jobs, same name in two
files. Do not collapse them.

`28-spawn-feel` land pad for suzume
`{ minX: -44, maxX: -12, minZ: -46, maxZ: -12 }` plus the path
`{ minX: -24, maxX: -16, minZ: -36, maxZ: -8 }` still covers A–D and the
flight. House C at `x = -10.5` needs the park pad `maxX` pulled to
**−8** or C is clamped back onto the path.

---

## Parent checklist

1. Stair Y: `groundHeight(-20, z + 0.56) + 0.12`. Keep 6.5 / 0.24 / 1.12 / 12 / `x = -20`.
2. Drape `hillPath` (and shrunk `park`); delete the flat `y = 0.05` card.
3. Keep hero `(−28, −34, yaw 0.42)`. Add instances B/C/D. Terrace pads or min-corner seat.
4. Landmarks as the four poses above. Copy `spawn` onto `SPAWN` + `walk.pitch`.
5. Extend the height field north of `z = -36` before adding a crest house.
6. Do not edit sample source from this note.
