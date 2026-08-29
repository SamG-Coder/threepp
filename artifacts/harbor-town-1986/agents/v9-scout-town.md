# v9 scout — `town` UNACCEPTABLE grey slab wall

Shot: `C:\ThreeBrowser\artifacts\harbor-town-1986\town-v9.png`  
Landmark: `go('town')` → `{ x: -6, z: -50, yaw: 0.4, pitch: -0.18 }` (`scout.mjs`).  
Convention: `+X` east, `+Z` south. Yaw `0` looks `+Z`. Look ray `(sin(yaw)·cos(pitch), sin(pitch), cos(yaw)·cos(pitch))` ≈ **(0.38, −0.18, 0.91)** — SSE, slightly down.  
`groundHeight` plateaus ~**7.2 m** for `z ≤ -46`, so eye is ~**8.8 m**. Fog `28…185`. Sun is `DirectionalLight` from **(−71, 18, 53)** — south-west, so **every north face is the shadow side**.

**Verdict: UNACCEPTABLE. This is not a town establishing shot. It is a dam of unlit `MeshStandardMaterial` boxes.** One reconstructed hill-house on the right clip, empty olive ridge in the foreground, a pale skyline cube on the left, and a five-bay charcoal wall where Sakae-dori should read as 1986 shop backs + roofscape + a second block + harbour air.

Do **not** edit sample source from this note.

---

## What the pixels are

| region | what it is | source |
|---|---|---|
| Foreground olive slab | `addSkyline` ridge plane (`z = −92…−36`) + hill `PlaneGeometry` grass verts. Camera **stands on the ridge**. | `addSkyline` |
| Left pale cube | Skyline block **#4** `{ x: 28.2, z: -53.2, w: 8.4, d: 7.4, h: 8.6, color: 0x736e68 }`. South face `z = −49.5` — **in the town frustum, almost beside the camera**. | `addSkyline` |
| Right cream timber house + canopy | `wooden-hill-house` instance **`(−12, −46)`** (yaw `0.15`) at ~**7.2 m** — near clip. Canopy = oaks `(−16, −44)` / `(−20, −46)` / `(−20, −36)`. House `(−10.5, −30)` sits behind that clip. | catalog `INSTANCES` |
| Centre–left **grey slab wall** | North faces of live `addGapFill` boxes at **`z = −10.5`, `d = 7`** → north face **`z = −14`**. Dead-ahead bay is `{ x: -6.4, z: -10.5, w: 7.2, h: 9.6 }` — the camera x. Then `0.8 / 8.0 / 15.6 / 23.4`. | `addGapFill` |
| Tiny nubs on the parapet | Telephone poles at `z = −6.2 / −6.4` and lamp globes at `z = −6.05`, seen **over** the fill, not as architecture. | furniture |
| Anything that looks like a town | **Absent.** Unique north-row `yaw-180` backs, south-row roofs, `addSouthMassing`, Yokobori, Amihama, water — all **occluded** by the 8.4–9.8 m curtain at ~40 m. | — |

`addWorldFill` → `addSouthMassing` (`z = 18.5` and `z = 30`) is **behind** this curtain. It does not fail by being in frame; it fails by being a second anonymous slab rank that will be the next thing you see if the curtain is lowered without dressing. `fill-south.mjs` `addSouthFill` is **not wired**; live south massing is `fill-world.mjs` `plantBlock` only.

`town-v8.png` was a camera-inside-oak (park clip). v9 moved the eye onto the ridge and photographed the **backs of the gap-fill**. Different crime, same “not a town.”

---

## Geometry that builds the wall

### 1. `addGapFill` — primary offender

Live boxes (`main.mjs`), all `z = −10.5`, `d = 7`, colour `0x6a6560` / `0x5c5852`, roughness `0.95`:

| x | w | h | north face z | x span | sits in front of (from the hill) |
|---:|---:|---:|---:|---|---|
| −44.0 | 7.2 | 8.2 | **−14.0** | −47.6…−40.4 | west cap (also doubled by south massing) |
| −36.8 | 8.4 | 8.6 | −14.0 | −41.0…−32.6 | hardware back |
| −28.4 | 8.4 | 9.4 | −14.0 | −32.6…−24.2 | tobacco back |
| −13.2 | 7.0 | 8.8 | −14.0 | −16.7…−9.7 | Yaoya / soba |
| **−6.4** | **7.2** | **9.6** | **−14.0** | **−10.0…−2.8** | **Yaoya + pharmacy — dead ahead of `town`** |
| 0.8 | 7.0 | 8.4 | −14.0 | −2.7…4.3 | pharmacy |
| 8.0 | 7.6 | 9.8 | −14.0 | 4.2…11.8 | arcade |
| 15.6 | 7.4 | 8.6 | −14.0 | 11.9…19.3 | cassette |
| 23.4 | 8.2 | 9.2 | −14.0 | 19.3…27.5 | east of cassette |
| 32.0 | 8.8 | 8.8 | −14.0 | 27.6…36.4 | east wing |
| 40.6 | 7.6 | 9.0 | −14.0 | 36.8…44.4 | sidewalk east |

Windows are **south-face only**: `faceZ = spec.z + d/2 + 0.04 = −6.96`. Four dark panes for `sakae` looking north. **North faces are blank.**

Unique north-row shops (`z = −8.5`, `yaw = 0`, fronts face **south**):

| shop | x | realWidth | realDepth | realHeight | unique north face z |
|---|---:|---:|---:|---:|---:|
| hardware | −34 | 6.4 | 6.8 | 7.0 | −11.9 |
| tobacco | −26 | 5.2 | 5.6 | 7.0 | −11.3 |
| soba | −17 | 6.4 | 8.2 | 7.2 | −12.6 |
| Yaoya | −9 | 5.4 | 6.2 | 6.9 | −11.6 |
| pharmacy | 0 | 6.6 | 7.6 | 7.0 | −12.3 |
| arcade | 8.4 | 8.0 | 10 | 7.8 | −13.5 |
| cassette | 17.8 | 6.2 | 4.8 | 7.1 | −10.9 |

Fill north face `z = −14` is **0.5–3.1 m proud of every unique back**. From `z = −50` the fill is a **curtain**. `MeshBasicMaterial` vertex-colour `yaw-180` backs never get a pixel. Fill height **8.4–9.8 m** overshoots shop height **6.8–7.8 m**, so even a grazing look cannot clear the parapet to the street or the south row.

Agent 46 specified **`z = −8.5`, depth 7 m, north face `z = −12`**, street-lot-line fillers. Live code sat them at **`z = −10.5` as a back wall** (agents 40 / 58). That choice is why `sakae` can see four windows and `town` sees a fortress.

### 2. `addSkyline` — near-field cube + ridge underfoot

Agent 56 shoved every block `Δz = −30` so park `z = −48…−16` is empty. New southernmost face is **#4 at `z = −49.5`**. Landmark `town` is **`z = −50`**. The “distant inland apartments” are now **the set dressing you stand in**.

Ridge `PlaneGeometry(160, 56)` world `z = −92…−36` is the empty lawn that eats the bottom two-thirds of the frame. Fine as far hills. Illegal as the only ground in an establishing shot (no path, no 石垣, no hedge that reads, no second house type at street scale).

`castShadow = spec.z > −30` is false for all ten — they do not even ground themselves.

### 3. `addWorldFill` → `addSouthMassing` — the next slab, currently hidden

`plantBlock` only. No windows, no roof, no north-face kit. Same palette as gap fill.

| band | centres | d | north face | role from `town` |
|---|---|---|---|---|
| South backing | `z = 18.5`, x = −36/−26/−16/+8 | 7.0–7.2 | **`z ≈ 15`** | second rank behind south shops; will read as another charcoal wall once gap fill no longer occludes |
| Street-line caps | `(−44, −8.5)`, `(28, −8.5)`, `(38, −8.5)` | 7.2–7.4 | **`z ≈ −12`** | **stacked on gap fill** at the east/west ends — thicker dam |
| Second rank | `z = 30`, x = −30/−18/+8, h up to **11** | 7.0–7.2 | **`z ≈ 26.5`** | Amihama-side massing; tall enough to peek only after the north curtain is shop-height |

`addYokoboriMassing` / `addRoute16Massing` are out of this frustum. Not the wall.

Eye ~8.8 m, pitch −0.18, wall ~9.6 m at 40 m: the slab **is the horizon**. South massing, south-row `yaw-000` roofs, warehouses at `z ≈ 58–72`, water — zero silhouette.

---

## Why it reads as a bunker (not “untextured is OK”)

1. **One material, shadow side.** `MeshStandardMaterial` + hemi `1.42` + sun `0.34` from the **south**. North faces fall to ~`0x2a2826`. Unique shops are `MeshBasic` vertex colours and would still read; they are hidden.
2. **No roof break.** Boxes are vertical slabs to a flat top. 1986 Minamihama is 切妻 / 瓦 / トタン, 6.8–7.8 m, stepped. A flat 9.6 m parapet is a factory wall.
3. **Party walls are hairlines.** Adjacent 7 m bays with 0–0.2 m joints = one extrusion. Needs 0.3–0.8 m setbacks and height chatter at **shop scale**.
4. **Windows face the wrong way.** Gap fill dresses `+Z`. This camera looks at `−Z`.
5. **Skyline cube as a neighbour.** A lone 8.6 m grey house in the left grass proves the skyline pass is a blocker volume, not a town edge.

Pass bar for `go('town')`: hill house in the **middle distance**, park/path in the foreground, **Sakae ura (backs) as a row of buildings**, tiled roofscape, a second block, a hint of harbour weather. Fail: any shot whose mid-ground is a single unlit plane.

---

## How to dress the backs so this shot is a town

Do not clone unique shop **fronts** onto fill. Do not add dummy 看板. Ura-dori is pipes, sash, laundry, rust — Dobuita back streets, 29 Nov 1986, 15:20 overcast.

### A. Stop the curtain (`addGapFill`)

- Sit on the **north-row lot line** `z = −8.5` (agent 46), **or** keep `z = −10.5` but **shrink `d`** so north face **`≥` unique north faces** (arcade `−13.5` is the limit; target **`z ≥ −12`**).
- **Do not overlap unique AABBs in X.** Live `−6.4` and `0.8` swallow Yaoya and pharmacy. Fill only **gaps ≥ 3 m** (agent 46 slot list). If a unique occupies the bay, **delete that box** so `yaw-180.png` is the back.
- Height **6.8–8.2 m**, not 9.8. Must be able to see **south-row ridges and south massing** over the row from eye ~8.8 m.
- East/west caps: pick **either** gap fill **or** `addSouthMassing` street-line boxes, not both.

### B. North elevation kit (gap fill **and** south massing north faces)

Every anonymous box that can appear in `town` / `hill` / `park` needs a **north dress**, not only a south window card.

Per bay, cheap geo (still not catalog ids):

| piece | metres | 1986 read |
|---|---|---|
| Plaster body | full `w × h × d` | albedo **`0xcfc6b8` / `0xb8a090` / `0x9aa08c` / `0xd2c8b0`** — winter stucco, **not** `0x5c5852`. Roughness 0.9. |
| 瓦 / トタン roof | `w+0.3 × 0.15 × d+0.4` pitched or a two-board 切妻 | `0x5a5048` / `0x6a4840`. Breaks the parapet against the sky. |
| 2F sash | 2–3 panes, **on `z − d/2`** (north) | `0x2a3238` glass, white/aluminium frame `0xd8d4cc`, ~0.7×0.9 m. Same as gap-fill south windows but **mirrored to the back**. |
| 1F service | one small window or a steel door | 裏入口, not a shopfront. |
| AC / 配管 | 0.7×0.45×0.4 box + a 0.08 pipe | rust `0x6a5a48`, mid 2F. |
| トタン patch or laundry pole | optional on 1/3 of bays | corrugated strip or two 0.04 cylinders. |

South faces of gap fill may keep the existing four panes (for `sakae`). South massing **north** faces at `z ≈ 15` face the south-shop backs — that is an **alley**, same ura language, not enamel 看板.

If a later pass can reconstruct **anonymous rear stills** (cardinal `yaw-180` of a blank 2-storey ura, magenta studio), plant those as fill instead of Standard boxes. `MeshBasic` vertex colour is the only thing that survives this sun.

### C. Let unique `yaw-180` actually be the back

North-row folders already have `CARDINAL_VIEWS` `yaw-180.png` (`label: "back"`). That is the establishing-shot elevation.

- If those stills are **blank boxes or studio paper**, reshoot as real 1986 rears (soil stack, アルミ sash, stained plaster, 瓦 eaves). Do not expect fill to invent a town in front of them.
- If those stills are good, **the only job of fill is to not hide them**.

South-row (`flower` / `barber` / `kissaten` at `z = 8.6`, `yaw = π`) present **south** walls to a camera looking `+Z` from the hill — those are also backs. Same dress rule on their `yaw-000` (local front = world south = ura from Suzume).

### D. `addSkyline` out of the landmark

- No skyline AABB with south face **`z > −60`** while `town` lives at `z = −50`. Push the ten boxes to **`z ≤ −72`** (true inland) **or** replace them with reconstructed 3-storey apartment stills that can sit in fog.
- Ridge may stay as far hills. It must not be the only readable ground: park path / 石垣 / a house at 15–25 m (not 7 m clip).
- The left cube in `town-v9` is the test: if a skyline mesh has a silhouette wider than ~2° at `go('town')`, it is too close.

### E. South massing as **roofscape**, not a second dam

Once gap fill is shop-height, `addSouthMassing` at `z = 18.5 / 30` becomes the **next ridge of 瓦**. Give those boxes:

- the same roof prisms and north-face sash as (B)
- height **7.5–10 m** (second rank may peek; do not slab `h = 11` as a hotel)
- **0.4–1.0 m** X/Z jitter so it is lots, not a keep
- keep-out unchanged: harbour corridor `x = −8…8`, `z = 10…52`; Yokobori `x ≥ 18`

From eye 8.8 m you should read: **north-row ura → street slot / south-row tiles → south-fill tiles → grey weather**. Three stepped roof lines. Not one wall.

### F. Lighting so backs exist

North faces will stay dead on Standard + this sun. Either:

- dress fill with **`MeshBasicMaterial`** (or vertex colours from rear stills), same as unique shops, **or**
- add a weak north fill (`Hemisphere` already 1.42 is not enough on `0x5c5852`).

Albedo lift alone (`0xcfc6b8`) is the minimum if Standard stays.

---

## Later-pass checklist (not this note)

1. `addGapFill`: `z = −8.5` (or north face `≥ −12`); drop boxes that overlap unique X; `h ≤ 8.2`; windows on **north** too; roof prism per bay.
2. `addSouthMassing`: roof + north sash; delete street-line caps that duplicate gap fill; keep harbour corridor.
3. `addSkyline`: centres `z ≤ −72` (or textured apartments); ridge is hills only.
4. Confirm `wooden-hill-house (−12, −46)` is ≥ 12 m from `town` eye (v5/v6/v9 keep planting cameras inside Suzume meshes).
5. Re-scout `{"go":"town","screenshot":"town-v10"}` plus `hill` / `park` / `sakae`.

**Pass:** from `go('town')` a still reads as Minamihama — house, park, a row of 1986 **backs**, a broken 瓦 skyline, weather. **Fail:** grey slab wall, skyline cube in the grass, or unique `yaw-180` still hidden.

---

## Do not

- Edit `main.mjs` / `fill-world.mjs` / `scout.mjs` / `catalog.mjs` from this note
- Instance unique **front** stills as fill
- Paint noren / enamel on north faces
- Raise fill height to “hide the sky”
- Call the ridge + dam a town because meshes exist
