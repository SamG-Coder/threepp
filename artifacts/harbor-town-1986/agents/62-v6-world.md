# 62 — v6 world completeness (harsh)

World-completeness critic. Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south (`+Z`), `Math.PI` north,
`Math.PI / 2` east, `-Math.PI / 2` west.
Sources: the twelve `*-v6.png` captures (not v5), live `catalog.mjs`
(`ORBIT_SUBJECTS` + `INSTANCES`), `scout.mjs` `LANDMARKS`, `TOWN.md`,
`fill-*.mjs` massing, reconstruct log as reported at capture:

| id | tris | verdict |
|---|---|---|
| `zelkova` | **24** | FAILED. Degenerate. Invisible in every v6 still despite 1 unique + 16 curb clones. |
| `honda-cub` | **72** | FAILED. Degenerate. Invisible. Six poses on disk, zero pixels. |
| `pharmacy` | **~80k** | Swiss cheese. Holes are the sakae shot. |
| `kei-van` | **~17k** | Melted loaf. Every street still. |
| `phone-booth` | **~42k** | Over-tessellated 0.9 m box. Not readable in any v6 frustum. |
| shops (hardware, tobacco, arcade, kissa, barber, yaoya, soba, flower, records, Galaxy) | **50–80k** | Potato boxes. Fascia readable, eaves chewed, corners balloon. |

**Headline: v6 is still a film-set.** Density went up (lamps, vans, grey
massing, cloned Hiros, oak/willow grids). Completeness did not. Four of
twelve cameras are planted *inside* a tree or a shop. The two assets that
would have made Sakae a 1986 sidewalk (zelkova, Cub) reconstructed to
nothing.

v5 → v6 delta in one line: more kit on the same empty slab, plus cameras
that now photograph the interior of the kit.

---

## 1. Each v6 shot: full 1986 harbor town or film-set?

Harsh. Eye-height Shenmue Ch.1 density is the bar, not “are there meshes.”

### `sakae-v6.png` — **film-set corridor. Score 3/10.**

Landmark `sakae` `{ x: 0, z: 11, yaw: π }`. Looking due north at the zebra.

North wall is the same cardboard row as v5: Yaoya, holey pharmacy, arcade.
v6 stuffed the Yaoya–pharmacy olive slit with a **grey skyline cube**
(`addGapFill` still sits *behind* the lot line, so the street-front hole
is a dark slot with Hiro standing in it). Crates and an enamel machine
sit on the north walk. That is kit, not occupation.

South row is **inside the camera** — Haru barber’s cream north face eats
the right third (same crime as v5). A melted Carry clips the left. The
brown primitive planter in the near sidewalk is a prop-table. Behind the
shops: anonymous grey blocks and a smear of hill oaks. Sky is still
`0x8894a0`. Zero zelkova. Zero Cub. Zero booth. One cloned Hiro in the
pharmacy slot.

A full world would have a closed party wall, a south curb in peripheral
vision that is not a shop interior, and a Cub / wet stain / 看板 occupying
the 8 m of asphalt between eye and fascia. This is a product shot of
three reconstructed stills.

### `street-east-v6.png` — **one-and-a-half-wall corridor. Score 4/10.**

Landmark `street-east` `{ x: -38, z: 1.8, yaw: π/2+0.16 }`. Least empty of
the twelve, and still a set.

North row (left) is a real wall: hardware clip → Kamimura たばこ → Nishiya
→ Yaoya → pharmacy → arcade. Gaps 1–3 m, some now dark instead of olive.
South row (right) gained a mint gable (`flower-shop` west face), a second
enamel, lamp globes, and a distant kissa/barber cluster — better than v5’s
naked slab, still not a street. Carriageway is a dark CG plane that dies
into sky-grey. Four melted Carries float in the lanes like boats. Wires
exist in code (`r = 0.02` at `y = 8.5`) and still **do not read**.

Sixteen zelkova poses along `z = ±6.7` should be a winter colonnade in
this frustum. 24 tris. They are air. Six Cub poses should pepper the
walks. 72 tris. Air.

This is Dobuita with the right wall half-struck and the parked cars
replaced by potatoes.

### `street-west-v6.png` — **camera-in-a-box. Score 2/10.**

Landmark `street-west` `{ x: 30, z: 2.0, yaw: -π/2-0.16 }`. New in v6.

Left third is a **featureless beige massing plane** (yokobori / south-row
east closer, or the east gable of kissa/barber) sitting in the near clip.
The camera was planted against a lot-filler. Right: arcade mosaic then a
black unlit gap-fill cube, then a melted Carry hovering off the north
curb. Centre: a second loaf-van on the zebra and a grey vanishing point.

You cannot see the west closer (hardware, Route 16 T) because fog and
empty asphalt eat it. This is not “looking west down Sakae.” This is
standing inside a flat.

### `hill-v6.png` — **wrong district, camera in a shop. Score 1/10.**

Landmark `hill` `{ x: -20, z: -14.8, yaw: -0.75, pitch: -0.12 }`.

v5 was `{ -36, -35, yaw: 0.52 }` — already a broken house cluster. v6
**moved the camera south onto the park/street seam and aimed it at
Sakae**, not Suzume park. Yaw `−0.75` from `z = −14.8` looks southwest
into the **backs of the north row**. The ochre brick cliff filling
centre-right is Yamato kanagu / a hill-house side at near clip. Through
the slot: a melted Carry on yellow dashes. Right half is the same **black
unlit skyline flag** as v5.

No 石垣. No park. No second house type. No stairs that read as a climb.
Sakuragaoka is a cluster you turn *between*. This shot is a shop wall
and a street. The landmark is misnamed.

### `park-v6.png` — **camera inside an oak. Score 0/10.**

Landmark `park` `{ x: -24, z: -22, yaw: -2.35, pitch: -0.1 }`.

`english-oak` canopy is **14 m**. Camera sits inside at least two trunks:

- `(-20, -26)` and `(-20, -18)` — both **5.7 m** away (radius 7 m).
- instance `(-16, -22)` — 8 m east, grazing.

The frame is a brown organic blob (oak interior), a strip of olive
`GROUND.park`, the side of a cloned `wooden-hill-house`, and a primitive
bench card in the distance. This is not a park. This is a clipping bug
photographed and filed as a still.

### `town-v6.png` — **camera inside an oak, aimed at dirt. Score 0/10.**

Landmark `town` `{ x: -18, z: -44, yaw: 0.15, pitch: -0.12 }`.

Instance oak at `(-16, -44)` is **2 m** from the lens (14 m canopy).
Unique oak `(-32, -44)` and `(-20, -46)` are also inside the volume.
Pitch `−0.12` aims into the ground plane, so 60 % of the frame is an
olive wedge. The rest is a chewed house eave. There is no town, no
harbor, no skyline, no hill path. An “establishing shot” that establishes
a triangle of grass.

### `yokobori-v6.png` — **hero prop + grey cubes. Score 3/10.**

Landmark `yokobori` `{ x: 20.2, z: 10.4, yaw: 0.18 }`.

Galaxy sakaba still owns the left (noren たこ焼き, 酒場 blade — the one
façade that almost belongs). v6 planted `addYokoboriFill` boxes
(`yokobori-izakaya-west` at `(20, 21.85)` etc.). They read as **unlit
brown cubes**, not snacks. One enamel in the plaza. Crate-stack unique
plus clones as a cardboard pile. One Hiro clone. Warehouses still visible
through the south end because the lane was never shrunk to 4 m — live
floor is still `18…42 × 10…28`, a **24 m court**.

A 横丁 hides the next district. This one is a loading dock with a bar
sticker on the west wall.

### `seawall-v6.png` — **camera inside a willow. Score 0/10.**

Landmark `seawall` `{ x: -38.5, z: 86.6, yaw: 1.62 }`.

v5 was an empty warehouse product shot (score 1) but you could **see the
cap and the sheds**. v6 planted `weeping-willow` instances on the apron
(`(-32, 86)` among others). Canopy **12 m**. Distance camera → `(-32, 86)`
is **~6.5 m** ≈ radius. The entire look is lime isosurface mush. A grey
seawall card peeks lower-right. No water. No boat (primitive hulls sit at
`z ≈ 95–107`, occluded). No crate in the near field. No worker.

Agent 45 even warned: *“Seawall landmark `(−38.5, 86.6)` is 6 m from the
west willow.”* Then they shot it anyway. Amihama is now a willow interior.

### `quay-v6.png` — **camera inside a willow. Score 0/10.**

Landmark `quay` `{ x: 0, z: 82, yaw: 0 }`.

Looking due south into instance willow `(0, 86)` at **4 m** (radius 6 m).
Unique willow `(8, 84)` is 8 m off-axis. Frame: grey cap slab + green
blob + a hole of sky/water. The seven `addQuayFill` box-boats, pallets,
and dock offices do not exist in this photograph because the lens is
inside a tree. Quay is a failed camera, not a failed district — we cannot
audit the district from this still.

### `bus-v6.png` — **hero loaf in a grey lot. Score 2/10.**

Landmark `bus` `{ x: -32, z: 18, yaw: -1.2 }`. New in v6.

`city-bus` unique sits at `(-40, 22)`, ~10.4 m long. Camera is **~3 m
from the east face**, looking almost west. The hull is a motion-blurred
tram potato (cream/green stripe survives; wheels, destination, 南浜
lettering do not). A second clone loafs behind. Hiro with a briefcase
stands in empty air under a telephone pole that hangs from the sky.
Right: primitive shelter roof (`addRoute16Fill`). Backdrop: untextured
massing cubes.

Route 16 is an arterial. This is a bus-model screenshot against
warehouse flats. No timetable, no queue, no zebra at the Sakae T, no
other vehicle type (Cub failed, sedan stills not catalogued).

### `kissa-v6.png` — **hero-prop corner. Score 3/10.**

Landmark `kissa` `{ x: 14, z: -2.5, yaw: 0 }`.

Kissa Miharu is still the best façade in the town (timber, lace, 港の珈琲
language). Haru barber on the right is a cream box with yellow chairs.
v6 walled the left sky with a **blank plaster massing** so Galaxy now
peeks through a slot instead of sitting in a field — enclosure up,
authenticity down. Melted Carry still parked on the zebra, scale-wrecking.
One Hiro clone between kissa and barber. Crate stack + enamel. No Cub at
the jamb. No booth (unique is at `(16.5, 6.8)`, 9 m ahead, 2.5 m right —
42k tris and still not a green box in this frame). South-row holes dump
to grey.

Saturday 15:20 on this corner would have two bodies, a mamachari, and a
sandwich board. It has a potato van.

### `hardware-v6.png` — **two shops, grey west, van in face. Score 2/10.**

Landmark `hardware` `{ x: -34, z: 8, yaw: π }`.

Yamato kanagu and Kamimura are still the boxiest matches. v5 showed olive
field west; v6 replaced it with a **tall grey `south fill` west cap**
(`(-44, -8.5)`) and oak crowns over the gap-fill cubes. That is a
cardboard city, not Route 16. A melted Carry occupies the right
foreground (instance `(-30, 3.35)`). Brown bin blobs sit in the near
asphalt like floating potatoes. Hill house still peeks east of tobacco.

West Sakae is two stills, a van wreck, and a skyline cube. The T-junction
does not exist in this photograph.

**None of the twelve is a full world.** Best case (`street-east`) is a
one-sided corridor of reconstructed props with potato traffic. Worst case
(`park`, `town`, `seawall`, `quay`) is the interior of a failed tree.
Film-set tells, v6 edition: (1) cameras inside canopies / shop hulls,
(2) grey massing standing in for architecture, (3) sky = ground at the
vanishing point, (4) identical Hiros, identical Carries, identical oaks,
(5) the two sidewalk signatures (zelkova, Cub) reconstructed to air.

---

## 2. Do assets FIT? (scale, facing, not inside camera, not floating)

| asset | planted | in v6 pixels | fit |
|---|---|---|---|
| `pharmacy` | `(0, −8.5) yaw 0` faces south, correct | sakae, street-east | **Holes.** 80k sponge. Scale ~6 m OK. Facing OK. Interior void is the shot. |
| `kei-van` | unique `(14.5, 3.4)` + 5 clones in lanes | sakae, street-east/west, hill, kissa, hardware | **Melted, oversized loaf, no wheels.** Sits like a hovercraft. Unique is still on/near the zebra. |
| `honda-cub` | unique `(−14.6, −6.35)` + 5 clones | **nowhere** | **INVISIBLE.** 72 tris. Fit is untestable because the mesh is a speck. |
| `zelkova` | unique `(−20, −6.7)` + 16 at `z=±6.7` | **nowhere** | **INVISIBLE.** 24 tris. Sixteen ghosts. |
| `phone-booth` | unique `(16.5, 6.8)` + 2 clones | **nowhere readable** | 42k tris on a 0.9 m box. Either eaten by kissa/van or a green sponge below the noise floor. |
| `hardware-shop` | `(−34, −8.5) yaw 0` | hardware, street-east, hill | Scale OK, facing south OK. In `hill-v6` the **north/east wall is in the near clip**. |
| `tobacco-shop` | `(−26, −8.5)` | hardware, street-east | **PASS-ish.** Best box. |
| `you-arcade` | `(8.4, −8.5)` | sakae, street-west | Corners round off. Mosaic reads. |
| `kissaten` | `(14, 8.6) yaw π` | kissa | **PASS** as a façade. Corners soft. |
| `barber-shop` | `(6, 8.6) yaw π` | kissa, **sakae right edge** | Hull OK. **Inside `sakae` camera** (north face at ~2 m). |
| `flower-shop` | `(−10, 8.6) yaw π` | street-east right | West gable, not the 花屋みどり front. Isolated. |
| `yokobori-bar` | `(26, 16) yaw −π/2` | yokobori, kissa slot | Faces west into a plaza, not a 4 m lane. |
| `wooden-hill-house` | unique `(−28, −34)` + 6 clones | park (side), town (eave) | Same scar, stamped. Never a cluster you walk through. |
| `english-oak` | unique `(−32, −44)`, 15 m × 14 m + 19 clones | park, town, hardware crowns | **INSIDE `park` and `town` cameras.** Grid orchard, not a park. |
| `weeping-willow` | unique `(8, 84)`, 12 m × 12 m + 12 clones | seawall, quay | **INSIDE `seawall` and `quay` cameras.** Planted on the look. |
| `city-bus` | unique `(−40, 22)` + clone `(−40, 38)` | bus | **Too close.** Melted. Second clone is a second loaf. |
| `civilian-hiro` | unique + ~18 clones | sakae, yokobori, kissa, bus | Scale OK. **One man copied.** Facing random. |
| `vending-enamel` / `telephone-pole` | many | street-east, sakae, yokobori | Kit PASS. Poles are masts; wires do not read. Poles in `bus-v6` hang from the skybox. |
| `crate-stack` / `steel-bin` | many | sakae, yokobori, hardware | Primitive / reconstructed potatoes. Bins in `hardware-v6` float in the near lane. |
| grey `gap fill` / `south fill` / `skyline` | `z=−10.5` / `z=19–28` / far | almost every still | **Unlit cubes as architecture.** They plug sky holes and create new “inside camera” walls (`street-west` left, `hill` right, `hardware` west). |
| primitive boats / benches / shelter | `fill-quay` / `fill-world` / `fill-route16` | park (bench speck), bus (roof) | Boats **unseen** (willow). Benches are box kits, not the `park-bench` still. |

**Facing:** north row `yaw 0` (south, toward street) is correct. South row
`yaw π` is correct. Galaxy `−π/2` faces west — correct *if* there were an
east wall. Vans `±π/2` in the lanes are LHT-ish but the hull has no nose.

**Floating:** van loafs hover (no contact shadow, no wheels). Bin blobs in
`hardware-v6` sit in the carriageway. Hiro in `bus-v6` has a hard contact
on a featureless plane — planted, not walking.

**Inside camera (immediate, ranked):**

1. `park` inside oak `(−20, −26)` / `(−20, −18)` / `(−16, −22)`.
2. `town` inside oak `(−16, −44)` (2 m).
3. `seawall` inside willow `(−32, 86)` (~6.5 m, 6 m radius).
4. `quay` inside willow `(0, 86)` (4 m).
5. `hill` looking at street, shop wall in near clip; black skyline in frame.
6. `sakae` — barber north face in the right third.
7. `street-west` — beige massing in the left third.
8. `bus` — 10 m bus at 3 m.

---

## 3. Ranked missing things

Rank is “closes the largest Ch.1-feel hole **given these twelve stills**.”
Do not instance unique shop façades. Do not plant more trees until cameras
move. Names stay Minamihama originals.

1. **Move the four cameras that are inside geometry.** Until `park`,
   `town`, `seawall`, `quay` stand in the clear, v6 cannot be audited as a
   world. Suggested: `park {−24, −14, yaw: π}` looking north into lawn
   *between* oaks; `town {−8, −48, yaw: 0.4}` from north of the oak grid;
   `seawall {−38.5, 88.2, yaw: 1.55}` on the **cap**, trunks at `z ≤ 82`;
   `quay {0, 78, yaw: 0}` *north* of the willow line. `hill` must look
   **into the park** (`yaw ≈ π` or `+2.4` from `(−20, −14.8)`), not
   `−0.75` at Sakae.
2. **Fix the two failed sidewalk signatures.** `zelkova` 24 tris and
   `honda-cub` 72 tris are why Sakae is a showroom. Force `custom` 8-view
   for both; do not ship another street-east until a winter crown and a
   Cub kickstand exist as pixels. Stills are already on disk.
3. **Force-box the 80k pharmacy and the 17k van.** Holes and loafs are in
   every hero still. Rectangle + `photoIterations: 0` is already wired;
   the stills/carve still punch cavities. Reshoot pharmacy 090/270 as
   closed tile walls; give the Carry 45° orbits and `kind: "custom"`.
4. **South-row unique shops** (still the district). `street-east` right
   slab and `street-west` left plaster prove it. `yamaguchi-denki`,
   `minato-sakaya`, `horiuchi-tokei`, `sato-sakana` as in agent 58. Grey
   `addSouthFill` / yokobori boxes are not shops.
5. **North-row party walls at `z = −8.5`**, not grey cubes at `z = −10.5`.
   sakae-v6’s Hiro-in-a-slot is the Yaoya–pharmacy 3 m hole.
6. **Second humanoid.** Eighteen Hiros is a crowd of one. Watanabe /
   Mika (stills in `civilian-mika/`, not catalogued).
7. **Wires that read** (`r ≥ 0.04`) and **cross-street droops**. Poles in
   bus-v6 / street-east are radio masts.
8. **A fishing boat in a *visible* frustum.** Primitive box boats at
   `z ≈ 95` do not count if seawall/quay are inside willows.
   `fishing-boat/` stills exist (agent 61) and are not catalogued.
9. **Stop cloning `wooden-hill-house` and `english-oak` on a 8 m grid.**
   Unique #2 / #3 houses. 4–6 oaks, not 20. 石垣 along the stairs.
10. **Yokobori opposite wall as a *shop*, lane ~4 m.** Cream/brown cubes
    at `(32, 17)` are flats.
11. **Route 16 as a road**, not a bus against cubes: T-junction zebra,
    timetable, a second vehicle type, west verge that is not a grey box
    in `hardware-v6`.
12. **看板 / 赤提灯 / ポスト / hydrant / puddle cards.** Sidewalk volume,
    not paint on hulls.
13. **Phone-booth that is a booth.** Cap at ~4k tris, plant one where
    `kissa` / `street-west` can see it.
14. **`kei-sedan` / `city-bicycle` / `park-bench` stills** (agent 61) —
    do not reconstruct until cardinals exist; do not keep using box
    benches as stand-ins once they do.

Honourable: wet-asphalt spec from `TOWN.md`; water darker than sky;
交番 at the T; 銭湯 chimney instead of a skyline cube.

---

## 4. Immediate camera / placement bugs

These are not taste. These are “the landmark is inside a mesh.”

### seawall inside willow

`seawall {−38.5, 86.6, yaw: 1.62}` looks east along the cap. Instance
`weeping-willow (−32, 86)` is **6.5 m** down the look. Catalog canopy
**12 × 12 m**. v6 frame is 90 % lime isosurface. v5, with no willows in
the frustum, at least showed warehouses and a wall.

**Fix:** slide willows inland to `z ∈ [80, 82]`, keep a 8 m gap at
`x ≈ −38…−34`, or move the camera onto the cap south face
`z ≈ 88.2` with pitch `−0.18`. Do not add more willows on `z = 86`.

### hill looking at street, not park

`hill {−20, −14.8, yaw: −0.75}` sits on the **north sidewalk of Sakae**
(`north row z = −8.5`, park `maxZ = −16`). Yaw `−0.75` is southwest —
into hardware’s wall and the carriageway. The ochre cliff is a shop.
The black right half is a skyline block in camera. Suzume park is
*behind* this look.

**Fix:** from the same seat, `yaw ≈ 2.5` (northwest into oaks/houses) or
`yaw ≈ π` (due north up the stairs). Pull `x` to `−24` so hardware’s
AABB is out of the near clip. Move far skyline boxes to `z ≤ −48` or
`x > −16` so they cannot flag the right half.

### park inside oak

`park {−24, −22, yaw: −2.35}` is inside the 14 m canopies at
`(−20, −26)`, `(−20, −18)`, and nearly `(−16, −22)`. Pitch `−0.1` aims
into trunk meat.

**Fix:** `{ x: −24, z: −14.2, yaw: π, pitch: −0.08 }` standing on the
south edge of `GROUND.park`, looking north *between* the `z = −18` and
`z = −26` rows. Break the 8 m orchard (delete instances at
`(−20, −18)`, `(−16, −22)`, `(−20, −26)` or push them ≥ 10 m from any
landmark). Primitive benches can stay; they are not the problem.

### Also broken in this set (do not reshoot until moved)

| landmark | pose | bug |
|---|---|---|
| `town` | `−18, −44, yaw 0.15, pitch −0.12` | Inside oak `(−16, −44)` at 2 m. Pitch into grass. |
| `quay` | `0, 82, yaw 0` | Inside willow `(0, 86)` at 4 m. |
| `sakae` | `0, 11, yaw π` | Barber `(6, 8.6)` north face in the right third. Pull `z` to `12.5` or `x` to `−1.5`. |
| `street-west` | `30, 2.0, yaw −π/2−0.16` | Beige massing in near clip on the south. Pull `x` to `26` or `z` to `1.2`. |
| `bus` | `−32, 18, yaw −1.2` | 3 m from a 10 m hull. Pull `x` to `−28`, `z` to `22`, yaw `−π/2`. |
| `hardware` | `−34, 8, yaw π` | Carry instance `(−30, 3.35)` in the foreground; bins in the lane. |

### Reconstruct failures that read as placement failures

If a mesh has 24 tris, every pose is a miss. Do not “replant” zelkova or
Cub until the log prints thousands of triangles and a street-east
reshoot shows a trunk and a wheel. Pharmacy holes are not a lot-line
bug. The van is not “too far into the zebra” — it has no silhouette of
a van.

---

## Verdict

v6 added lamps, massing, vans, Hiros, oaks, willows, a bus stop, and
four new cameras. It used those cameras to photograph **the inside of
the new trees** and **the same three potato shops**. Sakae is a
one-sided diorama with melted traffic. Amihama and Suzume are
un-auditable. Reconstruct spent 80k tris carving holes in the pharmacy
and 24 tris erasing the street trees.

This is not a 1986 harbor town. It is a film-set that got denser and
then stuck the lens in the flats.

Do not take a v7 contact sheet until: (1) four cameras are out of
geometry, (2) `hill` looks at the park, (3) zelkova and Cub print
real tris, (4) pharmacy is a closed box, (5) the Carry has wheels.
)
