# Partial orbit stills — complete vs skip

Audit of five uncatalogued folders under
`ThreeBrowserRuntime/samples/harbor_town_1986/assets/`. Disk counts match
agent 61. None of these ids are in `ORBIT_SUBJECTS` / `INSTANCES`.
`reconstructOrbitAsset` / `loadOrbitViews` **throws** if a catalog file is
missing — there is **no** sample billboard path. “Billboard” below means a
hypothetical single-still sprite, not live code.

Time lock: Saturday 29 November 1986, 15:20. Magenta studio, no floor, no
cast shadow (`TOWN.md`). Catalog views:

| kind | stills | files |
|---|---|---|
| rectangle / 4 cardinals | `CARDINAL_VIEWS` | 000 front, 090 right, 180 back, 270 left |
| humanoid | `HUMANOID_VIEWS` | 000 + 45° through 315 |

User lock for this pass: **bike / boat / sedan / bench = 4 cardinals**,
**mika = 8 humanoid**. (`TOWN.md` cheat-sheet calls parked cars/scooters
custom-8; ignore that here. `honda-cub` / `kei-van` already ship as
rectangle-4.)

Do **not** edit sample source from this note. Do **not** append these
folders to `catalog.mjs` until the “complete” set exists (and bicycle 000
is a true cardinal).

---

## Scoreboard

| folder | on disk | required | remaining | keep / regen | live fallback | **call** |
|---|---|---|---|---|---|---|
| `city-bicycle` | 000, 090 | 4 cardinals | **true 000, 180, 270** | 090 keep; **000 is a 3/4 — regen** | empty `fill-street` bike racks (no bikes) | **SKIP** stills + reconstruct. Racks stay. Billboard 090 only if a sprite path is added. |
| `civilian-mika` | 000, 045, 090 | 8 humanoid | **135, 180, 225, 270, 315** | 000 / 045 / 090 keep | none (Hiro clones only) | **COMPLETE** the five. Highest value in this set. |
| `fishing-boat` | 000, 090, 180 | 4 cardinals | **270** | 000 / 090 keep; **180 identity fail** | box boats in `fill-quay` + `fill-world` (`z ≈ 95–108`) | **COMPLETE 270**, then **one unique** in a visible frustum. Do not catalog 180 as-is. |
| `kei-sedan` | 000 | 4 cardinals | **090, 180, 270** | 000 keep | none (Carry loaf + bus only) | **COMPLETE** the three. Second vehicle type. |
| `park-bench` | 000 | 4 cardinals | **090, 180, 270** | 000 keep | 12 box benches in `fill-park` (+ `fill-world` duplicates) | **SKIP** remaining yaws. Keep procedural kit. |

Priority if stills budget is tight: **mika → sedan → boat 270 → (stop)**.
Do not spend the last three stills on bicycle or bench.

---

## 1. `city-bicycle/` — **SKIP**

Required: 4 cardinals. Disk: 2. Usable cardinals: **1**.

| yaw | file | status |
|---|---|---|
| 000 front | `yaw-000.png` | **FAIL** — 3/4, bars + crate + both wheels. Not a nose. Agent 61. |
| 090 right | `yaw-090.png` | **PASS** — true profile, kickstand, rear crate. Keep. |
| 180 back | — | **missing** |
| 270 left | — | **missing** |

Remaining work if completed: **regen 000** (dead-on front wheel / lamp /
bars, as narrow as `honda-cub/yaw-000.png`), **new 180** (crate + rear
tyre only), **new 270** (opposite flank of 090, no 3/4).

**Why skip.** `honda-cub` already has four cardinals and reconstructs to
**72 tris** (agent 62). A mamachari is thinner (spokes, tubes, basket
grid). Visual hull at `resolution: 32/48` will be a black loaf or a
crumb. Completing three stills does not fix that. `TOWN.md` “custom 8”
would be worse (more stills, same melt).

**Fallback.** `fill-street.mjs` already plants two empty steel racks
(`sakae-bike-rack-n` at `(11.6, −6.32)`, `sakae-bike-rack-s` at
`(−8, 6.5)`). Empty racks read as Saturday curb; a melted bike does not.
No procedural bicycle mesh exists — do not invent one for this note.

**Billboard.** The 090 profile is the only still worth pinning to a
camera-facing card (parked parallel to Sakae, long axis east–west). That
path is **not implemented**. Do not fake it with a 1–2 view reconstruct.

Crate is blue plastic lattice — agent 15 wanted “no modern plastic” on a
mamachari. Fine for a skip; if 000 is ever regen’d, swap to a 明治 timber
crate to match the Cub.

---

## 2. `civilian-mika/` — **COMPLETE**

Required: 8 humanoid. Disk: 3. Remaining: **5**.

| yaw | file | status |
|---|---|---|
| 000 front | `yaw-000.png` | **PASS** — A-stance, camel overcoat, navy pleat, loafers. Orthogonal. |
| 045 front-right | `yaw-045.png` | **PASS** — ~45°, same costume, same height. |
| 090 right | `yaw-090.png` | **PASS** — true profile, coat buttons toward camera. |
| 135 back-right | — | **missing** |
| 180 back | — | **missing** |
| 225 back-left | — | **missing** |
| 270 left | — | **missing** |
| 315 front-left | — | **missing** |

Remaining orbit (continue **this** turn: 000 → 045 → 090 is her **left**
flank, coat buttons / right-hand gold ring toward camera at 090):

- **135** back-left: hair + coat back + left sleeve, still some skirt
  pleat
- **180** back: collar, no face, coat vent, heels only
- **225** back-right
- **270** left: dead-on opposite of 090 — **no** coat buttons
- **315** front-left: face + right flank

Pin: same woman, same coat, same A-stance, shoes on magenta (no grey
blob), no Grok mark. Do not invent a second pose (walking / bag) mid-orbit.

**Why complete.** Agent 49 / 58 / 62: eighteen Hiros is a crowd of one.
Mika is the second unique body already on disk (overcoat shop-lady, not
the planned Watanabe drunk). Silhouette is different from the school
blazer. Three consistent views is enough to lock identity; five more is
the Hiro bar (`civilian-hiro/` has all eight).

**Do not** reconstruct or instance on 3 views. `forceCount: 8` will 404.
A 3-view humanoid hull is a wedge. Billboard of 000 would face every
camera — worse than empty asphalt.

**Fallback until then.** Keep unique Hiro only. Do not paste more Hiro
clones as a Mika stand-in (agent 49).

Feet sit on the magenta sweep (same class as Hiro). Acceptable; do not
add a concrete slab.

---

## 3. `fishing-boat/` — **COMPLETE 270** (fix 180 before catalog)

Required: 4 cardinals. Disk: 3. Remaining: **1 file**, plus an identity
bug on 180.

| yaw | file | status |
|---|---|---|
| 000 front / bow | `yaw-000.png` | **PASS** — orthogonal bow, cabin, flag. Bow script **第83号八戸**. |
| 090 right | `yaw-090.png` | **PASS** — true side. Bow **image-left**, stern right → **starboard** (catalog 090 = “right”). Agent 61 called this port; that is wrong. |
| 180 back / stern | `yaw-180.png` | **orthogonal PASS, identity FAIL** — ladder + transom. Paint is **第83号ハナ / 横須賀**. |
| 270 left | — | **missing** — port: bow **image-right**, stern left, opposite of 090 |

**Complete 270** as the missing cardinal. Same hull, same buoys, same
cabin, wheels/keel on magenta, no shadow.

**Do not catalog 180 until the transom matches the bow and the town.**
`TOWN.md`: original Minamihama, not a Yokosuka clone. 000 says Hachinohe
(**八戸**); 180 says Yokosuka (**横須賀**) and a different boat name
(**ハナ** vs **八戸**). Photoconsistency will grow a ghost cabin if the
silhouettes disagree; the paint will read as Dobuita even if the hull
carves. Regen 180: **南浜** (or drop the port name), one hull number,
same ladder.

**Why complete (the one still).** Agent 62 item 8: primitive box boats at
`z ≈ 95` are **unseen** from seawall/quay (willows). A reconstructed
unique in a *visible* frustum is the harbor read. One missing cardinal is
cheap.

**Fallback if 270 is skipped.** Keep `fill-quay.mjs` seven box boats
(white/green/brown hull + cabin + optional mast) and the duplicate
`fill-world.mjs` `addQuayBoats` (six more boxes at similar z). Those are
already the procedural stand-in. Billboard of 090 would look like a card
on the water — skip.

After a 4-view catalog: plant **one** unique, yaw so 000 faces the
camera that needs it (seawall looking east → boat yaw ~0, bow south).
Do not instance seven reconstructed hulls over the box fleet in one pass.

---

## 4. `kei-sedan/` — **COMPLETE**

Required: 4 cardinals. Disk: 1. Remaining: **3**.

| yaw | file | status |
|---|---|---|
| 000 front | `yaw-000.png` | **PASS** — dead-on grille, SUZUKI, cream Alto/Fronte-class. Agent 61; `158.jpg` 3/4 unused. |
| 090 right | — | **missing** |
| 180 back | — | **missing** |
| 270 left | — | **missing** |

Remaining: true side (090), tail (180), opposite flank (270). Same cream
paint, same mirrors, wheels on magenta, no drop-shadow, no Grok mark.
090/270 must be **orthographic** (full wheelbase, no 3/4 nose).

**Why complete.** Route 16 / Sakae has Carry loafs + one melted bus. Agent
62 wanted “a second vehicle type.” Three stills lock a different
silhouette (short hatch vs van vs 10 m bus). Park parallel at
`z ≈ ±3.2`, `yaw ±π/2`, same rule as `kei-van` — not in the `z = 2`
centreline.

**Caveat.** `kei-van` is already rectangle-4 and carves as a loaf
(windows + wheels). Expect a similar hull. Still worth the stills: a
second *colour / length* loaf reads as mixed parking; cloning more
Carrys does not. Do not upgrade this asset to custom-8 in this pass.

**Fallback until 4 exist.** No sedan mesh. Do not billboard 000 (a
floating grille in the lane). Do not reconstruct on one view.

---

## 5. `park-bench/` — **SKIP**

Required: 4 cardinals. Disk: 1. Remaining: **3**.

| yaw | file | status |
|---|---|---|
| 000 front | `yaw-000.png` | **PASS** — dead-on slats, concrete feet, no 3/4. Agent 61; `156.jpg` 3/4 unused. |
| 090 right | — | **missing** |
| 180 back | — | **missing** |
| 270 left | — | **missing** |

**Why skip.** Visual hull of five back slats + seat gap will **fill
solid** (same class as phone-booth glass → 119k tris, agent 06). A
reconstructed bench becomes a sofa. `fill-park.mjs` already seats **12**
named box benches on legal park ground (edges + path), with
`groundHeight` + downhill seating. Agent 51: “Do not unique-mesh a
bench.” Agent 62 item 14 said replace boxes once cardinals exist — that
assumes a hull that still *reads as slats*. It will not, at 48³.

**Fallback.** Keep `addParkFill` kit. `fill-world.mjs` `addParkBenches`
is a **second**, coarser 8-spot kit on top of the 12 — a duplicate, not
a reason to reconstruct. Route 16 shelter bench stays a box
(`route16-shelter-bench`).

**Billboard.** 000 is a good park-camera card if a sprite path appears.
Not worth three more stills until then.

---

## Catalog (do not paste yet)

Only after the **complete** calls land:

| id | kind | views | metres (suggest) | plant |
|---|---|---|---|---|
| `civilian-mika` | `humanoid` | 8 | ~1.62 × 0.55 × 0.38 | unique sidewalk / shop door, **not** a Hiro clone army |
| `kei-sedan` | `rectangle` | 4 | ~1.38 × 1.40 × 3.20 | 1–2 parallel parks, `z ≈ ±3.2` |
| `fishing-boat` | `rectangle` | 4 | ~2.4 × 2.1 × 7.4 | **one** unique in seawall/quay frustum, `z` on water |

Do not add `city-bicycle` or `park-bench` rows.

---

## Do not

- Reconstruct any of the five folders on the current disk set.
- Billboard by feeding 1–3 files into `CARDINAL_VIEWS` / `HUMANOID_VIEWS`
  (`loadOrbitViews` 404s; a partial carve is a wedge).
- Instance Mika or the sedan before the orbit is closed.
- Spend stills on bicycle 000/180/270 or bench 090/180/270 while Mika
  is missing five and the sedan is missing three.
- Leave `横須賀` on a Minamihama transom.
