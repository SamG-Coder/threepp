# v9 scout — `spawn` (Suzume-zaka, looking down to Sakae)

No sample-source edits. No `spawn-v9.png` in `C:\ThreeBrowser\artifacts\harbor-town-1986\`. Read is `LANDMARKS.spawn` + `map.mjs` `SPAWN` plus `hill-v9.png` (same stair ribbon, opposite look) and `town-v9.png` (north crest, same house/oak/skyline language). Cross-check stills: `park-v9.png`, `sakae-v9.png`.

Convention: `+X` east, `+Z` south. Yaw `0` faces south. `EYE = 1.62`. `PerspectiveCamera(55, …)`, far `220`. Walk Y is `groundHeight + EYE`; `SPAWN.y` is unused.

---

## Pose as shipped (synced)

```8:8:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\scout.mjs
  spawn: { x: -20, z: -26, yaw: 0.18, pitch: -0.2 },
```

```39:45:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\map.mjs
export const SPAWN = Object.freeze({
  x: -20,
  y: 1.6,
  z: -26,
  yaw: 0.18,
  pitch: -0.2,
});
```

`minamihamaGo('spawn')` now matches map spawn. Pitch is applied (`walk.pitch = SPAWN.pitch ?? 0`).

| | |
|---|---|
| XZ | stair centreline, **2.05 m north of the top tread** (`i = 11` → `z = -23.95`) |
| `groundHeight(-20, -26)` | `t = 14/34 ≈ 0.412` → `t·8 − 0.4t ≈ **3.13 m**` (path dip on `x ∈ [-24, -16]`) |
| eye Y | **≈ 4.75 m** |
| look XZ | `(sin 0.18, cos 0.18) ≈ (0.179, 0.984)` — 10° east of south, down the flight |
| 3 s of `W` @ 3.6 m/s | `Δ ≈ (1.93, 10.63)` → **(-18.1, -15.4)** still on the boxes |

Intent is right (Sakuragaoka hill-to-street). The camera is in the wrong volume.

---

## Camera blocked by tree / house?

**Tree: yes. House: no (clip only).**

English oak canopy is `14 × 14 m` (`catalog.mjs` unique + instances). Trunk keep-out in agent 45 was “off spawn `(-20, -26)`”; the live grid puts a clone **inside that keep-out**.

| mesh | x, z | Δ from spawn | fwd m | right m | dist | verdict |
|---|---|---:|---:|---:|---:|---|
| `english-oak` instance | **−16, −28** | +4, −2 | **−1.25** | **+4.29** | **4.47** | **inside 7 m crown** — camera is in the canopy, 1.3 m behind the trunk, 4.3 m to the right |
| `english-oak` instance | −20, −36 | 0, −10 | −9.84 | 0 | 10.0 | behind; 15 m trunk can still fill the top of the 55° frame |
| `wooden-hill-house` E | −10.5, −30 | +9.5, −4 | −2.24 | +10.1 | 10.3 | outside 5.59 m circumradius; **behind-right gable may clip the right edge** |
| unique house A | −28, −34 | −8, −8 | −9.3 | −6.4 | 11.3 | behind-left, clear |
| house (−38, −22) | −38, −22 | −18, +4 | +0.7 | −18.4 | 18.4 | left periphery, not the look |
| unique zelkova | −20, −6.7 | 0, +19.3 | +19.0 | −3.5 | 19.3 | on-axis street tree at the toe — subject, not a block |

`hill-v9.png` is `LANDMARKS.hill` `{ x: -20, z: -15.2, yaw: 3.2, pitch: -0.08 }` — **same X, 10.8 m south, looking north**. The melted oak trunks in that mid-ground **are the spawn volume**. Three twisted boles sit at the head of the flight, houses behind. Spawn looking the other way is inside that grove.

`town-v9.png` (crest, looking SSE): oak canopy already eats the top-right; house hull fused into the canopy. Same assets, same failure mode.

House AABBs do **not** contain `(-20, -26)`. Do not move spawn only to clear a house.

---

## Black slabs?

**Yes, on the spawn look — the north faces of `addGapFill`, not the moved skyline.**

Skyline boxes now live at `z ≈ -52 … -70` (`addSkyline`). They are **behind** spawn and are the black rank in `town-v9.png` (near-black `MeshStandardMaterial` 0x5a–0x7a vs unlit shop hulls). Spawn does not face them.

Gap-fill is the spawn problem. Eleven boxes, all `{ z: -10.5, d: 7, h: 8.2–9.8 }`, so **z ∈ [−14.0, −7.0]** — a wall **north of the shop fronts** (`z = -8.5`). Windows are planted on the **south** face (`faceZ = z + d/2 + 0.04 ≈ -6.96`). The north face is a blank 8–10 m Standard box.

From spawn, order along +Z: eye → treads (`z -24 … -12`) → **gap-fill north faces at z = −14** → shop hulls. The first “town” you see is a rank of untextured grey/black slabs, with shop backs z-fighting through. `town-v9.png` is the same material language at the crest. `house-v4.png` still shows the older on-hill slabs; those particular boxes moved, the street-line copies did not.

Closest boxes on the look:

| box x | w | x-span | sits on |
|---:|---:|---|---|
| −28.4 | 8.4 | −32.6 … −24.2 | overlaps Kamimura tobacco |
| −13.2 | 7.0 | −16.7 … −9.7 | soba / yaoya gap + both hulls |
| −6.4 | 7.2 | −10.0 … −2.8 | yaoya / pharmacy |

A camera fix cannot paint those faces. It can keep the look ray on the **stair gap** (`x ≈ -20`) so tobacco | stairs | soba read L→R instead of a slab filling the axis. Do not yaw toward arcade (`0.55`) — that aims at the −13.2 / −6.4 wall.

---

## Z-fighting?

**Yes, on the flight.** `hill-v9.png` and `park-v9.png` both show it.

Stairs (`addStreetFurniture`): 12× `BoxGeometry(6.5, 0.24, 1.12)` at `z = -12.4 - i·1.05`, `y = groundHeight(-20, z+0.56) + 0.12`. Tread 1.12 vs spacing 1.05 → **7 cm nosing overlap**.

Visible in v9:

- Triangular slivers between treads (`hill-v9` lower-left and lower-centre).
- Detached grey cards sitting on the olive height field (`park-v9` mid-right) — the same boxes, camera west of the ribbon, so the overlap reads as floating slabs.
- Height-field grass (`vertexColors` khaki) punching through step sides.

Spawn stands 2 m north of the top box, pitch −0.2, so the overlap is the **lower half of the first frame**. Moving onto the treads (recommended pose) makes it worse, not better, until the boxes are reseated — flag only; this note does not retune furniture.

Ground patch `GROUND.park` (`y: 0.02`) vs displaced height field is the olive-on-olive shimmer under the oaks in `town-v9` / `hill-v9`. Secondary.

---

## Melted hulls?

**Yes.** All three v9 hill stills.

- `wooden-hill-house` (unique A + instances, including E at −10.5, −30 and the extra crest copies at −12, −46 / −44, −36): chewed eaves, warped plaster, gable fused to canopy. `town-v9` right third is one hull. `hill-v9` background is the same remnant (~1324 tris, agent 02).
- `english-oak`: ice-cream trunks, chrome bark, canopy as a solid blob (`hill-v9` centre three, `park-v9` mid, `town-v9` top-right). Spawn is inside one of these hulls, so the first frame is melted oak interior, not stairs.

Shop hulls on Sakae are a later beat (`sakae-v9`); spawn will see their **backs** plus gap-fill before any frontage.

---

## Clone army?

**One Hiro on the stairs is fine. The Sakae rank is an army.**

`civilian-hiro` unique is still Yaoya `(-9.2, -7.3, π)`. Instance `{ x: -22, z: -18, yaw: 0.5 }` is on the 6.5 m flight (x ∈ [−23.25, −16.75], z ∈ [−24, −12]). `hill-v9` is that mesh from behind, facing SSE — one figure, correct scale.

Spawn looking south puts that same back **7.5 m ahead, 3.4 m left** (left-of-centre on the treads). Keep him.

Same frustum then hits the north sidewalk (`z ≈ -7`) at ~19 m. Half-width at 85° hFOV ≈ 17 m. Identical blazers in that slab:

| x, z | notes |
|---|---|
| −22, −18 | stairs, keep |
| −24, −6.9 | north walk, west of tobacco |
| −9.2, −7.3 | unique, Yaoya door |
| −4, −6.9 | north walk |
| 2, −7.0 | north walk |
| 8, −6.8 | north walk (right edge / just out) |

`sakae-v9.png` is the same stamps at street scale (five+ identical jackets in one 55° frame). From spawn they are smaller but still a row of the same A-stance. Road clones at `(-2.2, 1.4)` / `(2.6, 2.8)` can join once the look clears the gap-fill.

Not a spawn-camera bug. Do not add more Hiros on the flight.

---

## Missing foreground?

**If the oak stays: yes — melted canopy instead of treads. If the camera leaves the crown: no.**

Math at the current pose (no tree): pitch −0.2, vFOV 55°, eye 1.62 m AGL. Bottom ray hits the slope ~2 m ahead — **on the top step**. Stairs should own the lower half; Sakae the horizon. That is the beat `28-spawn-feel` asked for.

What actually owns the foreground is the (−16, −28) crown (camera inside it). `town-v8.png` is the cautionary: camera in an oak = brown cave, no world. `town-v9.png` after they pulled the town camera off the grove: **empty khaki lawn**, hedge/bench strip missing because `z = -50` is north of `GROUND.park`. Spawn will do the cave version, not the empty-lawn version, until XZ leaves the 7 m radius.

Park fill under spawn is thin: gravel path is the SW spur `(-20, -16) → (-26.5, -29)`, ~5 m west of the eye; lantern `(-26.16, -26.42)` and benches `(-26.1, -24.95)` / `(-24.86, -29.07)` are off the south look. They should not be the subject. The treads should.

Do not spawn on asphalt (`z ∈ [-8, 12]`). Do not face north (`yaw ≈ π`) — that is `hill` / `park`, house and park void.

---

## Concrete fix (camera only)

Stay on the stone boxes, west of the east oak, south of its crown, still looking down the flight. Copy onto **both** `SPAWN` and `LANDMARKS.spawn`.

```js
{ x: -21.2, z: -22.4, yaw: 0.10, pitch: -0.18 }
```

| check | value |
|---|---|
| on stairs? | yes — width 6.5 m about x = −20 (`x ∈ [−23.25, −16.75]`), treads `z ∈ [−23.95, −12.4]`; this is ~step i ≈ 9.5 |
| `groundHeight` | `t ≈ 0.306` → **≈ 2.33 m** (path dip) |
| eye Y | **≈ 3.95 m** |
| oak (−16, −28) | Δ (5.2, −5.6), dist **7.64 m**, fwd **−4.99**, right **+6.12** — **just outside 7 m crown**, behind-right, not in the hull |
| oak (−20, −36) | 13.7 m behind |
| house E (−10.5, −30) | 13.1 m, behind-right, outside circumradius |
| house A (−28, −34) | 13.5 m behind-left |
| Hiro (−22, −18) | 4.5 m ahead, ~0.7 m left — still the one downhill figure |
| look | 5.7° east of south; centreline x = −20 is slightly left; tobacco / stairs / soba still L→R |
| 3 s of `W` | `Δ ≈ (1.08, 10.75)` → **≈ (−20.1, −11.7)** at the toe / north sidewalk — hill-to-street beat intact |

Do **not** use `{ x: -20, z: -22.8 }` — dist to (−16, −28) stays **6.6 m**, still in the crown. The 1.2 m west nudge is the point.

Do **not** drop to `LANDMARKS.stairs` `{ x: -18, z: -14, yaw: 0.12, pitch: -0.16 }` for spawn. That is the last third of the flight; the intro is gone.

`SPAWN.y` can stay `1.6`. Walk / scout will keep seating on `groundHeight + EYE`.

After parent applies, reshoot `spawn-v9.png` (`go: spawn`). Expected: treads in the lower half, one Hiro ahead-left, oak canopy off the right-rear, north-row as a distant wall (still dark until gap-fill is a content pass), house A not in frame.

---

## Still used

| file | landmark | why |
|---|---|---|
| *(missing)* `spawn-v9.png` | spawn | not in artifacts |
| `hill-v9.png` | hill (−20, −15.2, yaw 3.2) | opposite look up the same ribbon; oaks + Hiro + stair z-fight at spawn’s XZ |
| `town-v9.png` | town (−6, −50, yaw 0.4) | black skyline rank, melted house, canopy clip, empty grass |
| `park-v9.png` | park (−24, −20, yaw 3.05) | floating stair cards, melted oaks/houses |
| `sakae-v9.png` | sakae | Hiro clone army the spawn look will hit at ~19 m |
