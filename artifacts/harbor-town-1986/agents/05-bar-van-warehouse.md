# 05 — yokobori-bar, kei-van, harbor-warehouse-8, harbor-warehouse-3 stills

Stills / catalog / classifier audit. Do **not** edit sample source from this note.

Convention (`map.mjs`, `views.mjs` `cameraBasis`, `plantMesh`): `+X` east, `+Z` south. Orbit yaw `0` sits at `+Z` looking `−Z`, so the reconstructed **front is local `+Z`**. `rotation.y = 0` therefore faces south. Magenta studio, isolated, no floor, no cast shadow (`TOWN.md`). Buildings = 4 cardinals; cars = **custom / 8 yaws at 45°**; cylinders = 2.

Launch log (agent 13, before the `shape:` force in `main.mjs`): warehouse-8 **cylinder**, van **rectangle**. `main.mjs` now passes catalog `shape`, so a rerun will print `shape=rectangle` for all four of these — that only stops the silo snap. It does not fix stills, missing diagonals, or alley yaw.

---

## Scoreboard

| id | catalog | launch classified | stills on disk | missing yaws | primitive mismatch | placement |
|---|---|---|---|---|---|---|
| yokobori-bar | rectangle, `(26, 16)`, `yaw: 0` | **custom** (68k candy) | 4 cardinals | none for a box; 000 is ¾ | catalog rectangle vs gable/sign → custom | in alley patch, **front does not face the lane** |
| kei-van | rectangle, `(4.2, 3.8)`, `yaw: −0.18` | rectangle (43k) | 4 cardinals | **045/135/225/315** (and 270 is unusable) | catalog rectangle; `TOWN.md` says **custom** | Sakae asphalt, not alley/dock |
| harbor-warehouse-8 | rectangle, `(−12, 72)`, `yaw: π` + 2 instances | **cylinder** (47k silo) | 4 cardinals | none for a box; **000 is ¾**, **090 is the wrong face** | catalog rectangle vs classifier cylinder | on Amihama dock, doors face inland |
| harbor-warehouse-3 | rectangle, `(16, 70)`, `yaw: π` | rectangle (36k) | 4 cardinals | none for a box; 090/180 labels disagree with the roof | none (both rectangle) | on Amihama dock, doors face inland; 000 includes a quay slab |

---

## yokobori-bar / Galaxy sakaba

Catalog: `kind: "rectangle"`, `realHeight 8.1`, `realWidth 6.2`, `realDepth 7.4`, district `yokobori`.

### Still quality

Orbit is the **same two-storey timber sakaba** on all four cards (unlike hill-house 090). Roof language is eave-fronted kirizuma: 090/270 are gable twins, 180 is the rear eave. Isolation is mostly a hot-magenta void. Bottom-right magenta tile is the Grok watermark; `chroma-key.mjs` punches that corner.

| Yaw | Orthogonal? | Same building? | Floor / shadow | Hull |
|---|---|---|---|---|
| 000 front | **fail — ¾** (~30° toward 090). Blade, noren `たこ焼き` / `OPEN 17:00`, `BAR GALAXY` box, right return wall in frame | pass | magenta cyclorama floor + contact shade | **regenerate** |
| 090 right | pass — gable elevation, green upper window, vertical boards below | pass | clean void | keep |
| 180 back | pass — rear eave, service door, meters, cable tangle | pass | clean void | keep |
| 270 left | pass — other gable, balcony + green shutter | pass | clean void | keep |

000 is the flower-shop failure mode: pipeline assumes an orthographic front and extrudes along `+Z`. A ¾ silhouette is a foreshortened parallelogram; intersection with true 090/180/270 gables collapses depth and smears the Galaxy blade across the wedge. That, plus gable/sign `flared`/`organic`, is why launch reported **custom** and 68k candy tris on a box that should have been a rectangle.

### Missing yaws

None required. A rectangle shop is four cardinals. Do not add 45° stills unless kind is flipped to custom.

### Primitive kind

Catalog `rectangle` is correct (`TOWN.md`: shops = rectangle). Classifier said **custom** because 000 is ¾ and the gables/blade look organic/flared. Force-shape (already in `main.mjs`) keeps it a box; it does not un-wedge the ¾ front. Re-shoot 000 as a true south elevation, same ridge/plinth rows as 180.

### Placement vs alley — does `yaw: 0` face the alley?

**No.** Not as a yokochō sakaba.

`GROUND.alley` is `x 18…42`, `z 12…28`. Bar centre `(26, 16)` sits in the north-west of that slab. `yaw: 0` plants local `+Z` (Galaxy façade, noren) toward **south**. Anyone walking in from Sakae (`z ≈ 10` → `16`) hits **yaw-180 first** (service door). The walkable lane that reads as Yokobori is the ~4 m slot along the **west** edge (`x ≈ 18…22`), not the empty south half of the slab.

Scout `bar` is `{ x: 22, z: 12, yaw: 0.15 }` — alley mouth looking SSE — so the landmark camera also sees the back.

Facing north (`Math.PI`) would only make it a misplaced south-row shop with a 6 m forecourt. **Face west:** `yaw: -Math.PI / 2`. Front plane then sits at `x ≈ 22.3`, noren on the lane, north gable as the right jamb of the mouth (agent 10). Keep `(26, 16)` this pass.

---

## kei-van / Suzuki Carry

Catalog: `kind: "rectangle"`, `realHeight 1.78`, `realWidth 1.4`, `realDepth 3.2`, `(4.2, 3.8)`, `yaw: −0.18`.

### Still quality

Identity is good (round-headlight Carry, yellow 品川 kei plate, 11/29 calendar, Ajinomoto boxes). Magenta is wrinkled seamless paper, not a void. All four sit on a **studio floor with a contact shadow** — `TOWN.md` forbids both.

| Yaw | Orthogonal? | Full vehicle? | Floor / shadow | Hull |
|---|---|---|---|---|
| 000 front | pass — square-on grille | pass | floor + shade | keep pose; kill floor |
| 090 right | pass — full side elevation, nose camera-right | pass | floor + shade | keep pose; kill floor |
| 180 back | pass — barn doors, 88-26 plate | pass | floor + shade | keep pose; kill floor |
| 270 left | **fail — cab crop** | **fail** — rear half and wheels cut off the frame | floor + shade, paper wrinkle | **regenerate** as a matching full left elevation |

270 is not a cardinal of the same subject scale. Visual hull height-normalizes each alpha-bbox; a cab close-up stretched to unit height carves the cargo body off the 090 silhouette and leaves a stub nose.

### Missing yaws — is a 4-view hull acceptable?

**No. Add the four 45° stills and catalog `kind: "custom"`.**

`TOWN.md` primitive cheat-sheet: parked 80s cars = **custom / 8 yaws**. `main.mjs` only loads `HUMANOID_VIEWS` (the 45° set) when `kind` is `humanoid` or `custom`. A rectangle van never even asks for `yaw-045.png`.

Why four cards are not enough:

1. A Carry is not a box. Rounded cab, windshield rake, wheel arches, bumper taper. Four orthographic silhouettes fill the arches and leave square corners. Street viewing angle is already a ¾ (`yaw: −0.18`; landmark `van` looks from `(4.2, 7.5)`).
2. `classifyOrbitShape` cannot mark a van custom from cardinals alone. `hasCorners` needs a 45° still (`diagonalRatio > 1.16`). Front vs side `planDelta` is large, so it falls through to **rectangle** — which is what the launch log printed. That is the classifier working as coded, not a sign the hull is fine.
3. `realWorldScale` applies one XZ scale from `realWidth` onto `max(extentX, extentZ)`. A long rectangle hull scaled to 1.4 m on its **long** axis becomes a 1.4 m cube-ish kei, not a 3.2 m Carry. Custom 8-yaw carving is what gives the long axis a silhouette to keep; even then scale should use `realWidth` × `realDepth` on separate axes (out of scope here, but it makes 4-view-rectangle worse).

Agent 13’s “kei-van can stay rectangle” was about **not photo-carving a boxy shop**. It is not permission to skip the 45° orbit. If kind stays rectangle, `pickViewsForShape` will throw the diagonals away even after you generate them.

**Must:** `kind: "custom"`, eight PNGs, 270 reshot as a full left twin of 090 (nose camera-left), no floor, no shade. Do not keep 4-view and hope force-shape saves the arches.

### Placement vs alley / dock

On Sakae asphalt (`z −8…12`), just south of the dashed centreline, slight clockwise yaw. Not in Yokobori, not on Amihama. Landmark looks north at the grille. Fine as a parked street van once the mesh is a van.

---

## harbor-warehouse-8 / Warehouse 8

Catalog: `kind: "rectangle"`, `realHeight 9.5`, `realWidth 14`, `realDepth 18`, `(−12, 72)`, `yaw: π`. Instances at `(22, 76)` and `(40, 68)`. Painted 倉42 / No.17 / 昭和61 — folder says 8; ignore the numbering.

### Still quality

| Yaw | Orthogonal? | Face | Floor / shadow | Hull |
|---|---|---|---|---|
| 000 front | **fail — ¾ cube** of the door gable (倉42, 港運倉庫, sliding doors) | door gable + left eave in frame | cyclorama floor + shade, Grok mark | **regenerate as true front elevation** |
| 090 right | mostly gable elevation, slight ¾ eaves | **wrong face** — another **gable**, not the eave wall a gable-fronted shed must show at +90° | shade, Grok mark | **regenerate as the long eave** |
| 180 back | gable elevation, downpipe, antenna | correct opposite gable | shade, Grok mark | keep pose; flatten magenta |
| 270 left | eave / roof slope with gable peeking over | correct side, slightly ¾ | shade, Grok mark | keep pose or square it up |

000 + 090 + 180 are three gable-shaped cards of a nearly square footprint. 270 is the only eave. That is not a 90° orbit of one prism.

### Why cylinder? Too round, or too gabled?

**Gabled + ¾ + no 45° still, not “too round.”** Circularity never has to be high.

`classifyOrbitShape` (`shape.mjs`):

- `hasCorners` is `diagonalRatio > 1.16` from a **yaw-45** still. Cardinal-only assets default `diagonalRatio = 1` → `hasCorners = false`.
- `rotationallySymmetric = aspectCv < 0.12 && meanCardinalIoU > 0.85 && !hasCorners`
- Cylinder is assigned **before** rectangle. `rectangleLike` needs `hasCorners` **or** `planDelta > 0.18 && !rotationallySymmetric`.

Warehouse-8 plan is ~14 × 18 and the stills read closer to 1:1. Three gable silhouettes plus a ¾ front that is almost as wide as a side elevation push aspect CV down and cardinal IoU up. That is exactly `cylinderLike`. `pickViewsForShape` then keeps **two** stills (0° and 90°) and `snapOccupancyToPrimitive` inscribes a circle — the 倉42 façade smears around a silo. Launch: `shape=cylinder`, 47820 tris.

Warehouse-3 stayed rectangle because it is a long slab with a large front/side `planDelta`. The kirizuma triangle is not itself a cylinder cue; **similar cardinals without a diagonal** are.

Force-shape now prevents the snap. It does not invent an orthographic front or the missing eave at 090. Re-shoot 000 (true door elevation, ridge centred, no ¾) and 090 (long eave twin of 270). Then the forced rectangle hull can actually be a box.

### Placement vs dock

On `GROUND.dock` (`z 52…88`, `y 0.06`), north of the quay wall at `z = 87.7`. `yaw: π` aims the sliding-door “front” **inland / north**, backs toward the water. Road-side loading is a valid choice; it is not quay-facing. Instances fan east along the same pad. Not in the alley. Leave the poses; fix stills first.

---

## harbor-warehouse-3 / Warehouse 3

Catalog: `kind: "rectangle"`, `realHeight 8.2`, `realWidth 16`, `realDepth 12`, `(16, 70)`, `yaw: π`.

### Still quality

Best of the four assets: true elevations, isolated magenta, no cyclorama floor on 090/270. Launch classified **rectangle** (36608 tris) — the long 16 × 12 slab gives `planDelta` the classifier needs.

| Yaw | Orthogonal? | Face vs a gable roof | Extra geometry | Hull |
|---|---|---|---|---|
| 000 front | **pass** — square-on 第3倉庫 / loading doors | eave (ridge // picture plane) | **concrete quay slab + fenders only in this view** | keep the shed; **drop the dock** on reshoot |
| 090 right | pass elevation | **eave again** — for an eave-front this must be a **gable** | none | **relabel or reshoot as the short gable** |
| 180 back | pass | **gable** with personnel door — this is a short end, not the back eave | none | keep as a gable end (probably 90 or 270, not 180) |
| 270 left | pass | gable with ladder + awning sliver | none | keep as the other short end |

000 and 090 are the two long eaves; 180 and 270 are the two gables. That is a consistent rectangular gable shed **if 090 is really the back (180°)** and 180/270 are the sides. As labelled, the orbit is rotated 90° from the filenames. Visual hull will still produce a box (all four are orthographic rectangles of similar height) but door/awning/ladder colours will bake onto the wrong faces.

000’s quay platform is subject in this still and void in the others → a thin dock slab that survives poorly, or a chewed waterline. Amihama already has `GROUND.dock`; the still must not carry the pier.

Identity: “KOBE PORT AUTHORITY 1982” on a Kanagawa Minamihama shed. Cosmetic.

### Missing yaws / primitive

None. Rectangle + 4 cardinals is correct. No kind mismatch. Do not add 45°.

### Placement vs dock

Same pad as warehouse-8, further east, also `yaw: π` (doors inland). Footprint 16 × 12 at `(16, 70)` stays on the dock, clear of the quay wall. Fine. After 000 loses the pier, the plant will sit on `GROUND.dock` instead of growing its own.

---

## Direct answers

### Van: 4-view hull acceptable, or must we add 45° views?

**Must add 45° views** (`yaw-045/135/225/315.png`) and set `kind: "custom"`. Four rectangle cards make a boxy prism with filled wheel wells; `TOWN.md` already called cars custom. Also reshoot `yaw-270.png` as a full left elevation — the current cab crop is not a usable 4th card even if we kept rectangle.

### Warehouse-8: why cylinder? Stills too round / gabled?

**Too gabled and too ¾, plus no 45° still, on a near-square plan.** The classifier does not test roundness. It tests “cardinals look the same and I never saw a corner.” 000 is a perspective house; 090 and 180 are both gable ends; that is rotationally symmetric → cylinder → inscribed silo. Flatten 000 to a true door elevation, shoot 090 as the eave, keep forcing `kind: "rectangle"`.

### Bar at `(26, 16)` `yaw: 0`: does the front face the alley?

**The Galaxy façade faces south, into the empty south of the alley patch, not into the lane and not toward Sakae.** Approach from the shopping street sees the service door. For a Yokobori sakaba, set `yaw: -Math.PI / 2` so the noren faces west onto `x ≈ 18…22`. Re-shoot `yaw-000.png` as a true orthographic front regardless of yaw.

---

## Regeneration order

1. **harbor-warehouse-8 yaw-000 and yaw-090** — stops the silo-shaped stills (force-shape already stops the snap).
2. **kei-van yaw-270 + four diagonals**, `kind: "custom"` — without this the street van is a 1.4 m box.
3. **yokobori-bar yaw-000** (true front) **and catalog yaw `-π/2`**.
4. **harbor-warehouse-3 yaw-000** without the quay slab; fix 090 so eaves/gables match the filenames (or rename 090↔180). Lowest urgency — already a rectangle box on the dock.
