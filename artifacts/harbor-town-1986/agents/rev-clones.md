# Rev clones — `civilian-hiro` / `vending-enamel`

Do **not** edit `catalog.mjs` from this note. Parent deletes
`INSTANCES` rows. Unique `ORBIT_SUBJECTS` poses stay.

Time lock: Saturday 29 November 1986, 15:20. `+X` east, `+Z` south.
Yaw `0` faces south. Live file:
`ThreeBrowserRuntime/samples/harbor_town_1986/src/catalog.mjs`.

Travel lane **`z ∈ [−6, 6]`** is forbidden for people. Dock truck lane
**`x ∈ (−5, 8)`** on the apron stays empty (agent 11). People are not
kit; enamel machines are.

---

## Live counts (unique + clones)

| asset | `ORBIT_SUBJECTS` | `INSTANCES` | hulls |
|---|---:|---:|---:|
| `civilian-hiro` | 1 at `(−9.2, −7.3, π)` Yaoya doorway | **21** | **22** |
| `vending-enamel` | 1 at `(−6.8, −5.9, 0)` Yaoya spill | **11** | **12** |

Hiro is already a clone army (agent 49 forbade eight; agent 58 called
four identical blazers worse than empty; agent 62 saw ~18 in v6). Enamel
count is in the Ch.1 band (agent 58 wanted 12–18, often **pairs**); the
problem is adjacent / lane / booth collisions, not the raw total.

---

## Adjacent clones (Δxz)

Same-asset pairs under the min-spacing rules below, plus kit overlaps
that make a row unusable.

### `civilian-hiro` (vs unique and vs each other)

Unique `(−9.2, −7.3)`. Footprint `0.52 × 0.32` m.

| a | b | Δxz (m) | why it fails |
|---|---|---:|---|
| unique | `(−4, −6.9)` | **5.22** | same north curb, &lt; 8 m |
| `(−4, −6.9)` | `(2, −7.0)` | **6.00** | north-curb chain |
| `(2, −7.0)` | `(8, −6.8)` | **6.00** | north-curb chain |
| `(−2.2, 1.4)` | `(2.6, 2.8)` | **5.00** | pair **in the carriageway** |
| `(−8, 6.9)` | `(−1.4, 8.2)` | **6.73** | south curb |
| `(−16, 6.8)` | `(−8, 6.9)` | 8.00 | on the 8 m line; drop one |
| `(−1.4, 8.2)` | `(−2.2, 1.4)` | 6.85 | south walk vs road clone |
| `(−1.4, 8.2)` | `(2.6, 2.8)` | 6.72 | same |
| `(8, −6.8)` | booth `(8.6, −6.6)` | **0.63** | inside the booth clone |
| `(8, −6.8)` | zelkova `(8, −6.7)` | **0.10** | inside the tree |
| `(−32, 6.8)` | enamel `(−31, 6.0)` | **1.28** | &lt; 1.5 m kit stand-off |
| `(10, 6.8)` | enamel `(12.4, 6.8)` | 2.40 | walking into the machine |
| `(−28, 78)` | oil-drum `(−28, 78)` | **0** | exact overlap |
| `(0, 64)` | — | — | **truck lane** `x = 0` |

North walk is a 6 m stamp: unique → `(−4)` → `(2)` → `(8)` (and `(8)`
sits on a zelkova and a booth). Road pair `(−2.2, 1.4)` / `(2.6, 2.8)`
is two Hiros on asphalt. Dock `(−28, 78)` is a drum.

### `vending-enamel` (vs unique and vs kit)

Unique `(−6.8, −5.9)`, cabinet `0.90 × 0.72` m. A **pair** is 1.00–1.20 m
centre-to-centre (agent 15’s 1.05 m double). Anything ~4 m is not a pair
and not an 8 m unpaired beat.

| a | b | Δxz (m) | why it fails |
|---|---|---:|---|
| unique | `(−10.8, −6.7)` | **4.08** | same Yaoya bay, neither pair nor beat |
| `(−18.4, −6.7)` | `(−10.8, −6.7)` | **7.60** | unpaired under 8 m |
| `(12.4, 6.8)` | `(16.8, 6.7)` | **4.40** | south-curb double that is not a pair |
| `(16.8, 6.7)` | unique booth `(16.5, 6.8)` | **0.32** | **inside the phone booth** |
| `(18.5, −5.4)` | — | — | **`z = −5.4` travel lane** (sidewalkN maxZ `−6`) |
| `(18.5, −5.4)` | cub `(18.6, −6.4)` | 1.00 | cub vs machine in the gutter |
| `(−28.6, −6.7)` | zelkova `(−28, −6.7)` | 0.60 | tree on the cabinet (slide the tree) |
| `(12.4, 6.8)` | zelkova `(12, 6.7)` | 0.41 | same (slide the tree) |

Unique enamel `z = −5.9` is 0.1 m into the lane. Do not delete the
unique; parent should slide it to `z ≈ −6.7` in a later pose pass.

---

## Delete — `civilian-hiro` `INSTANCES`

**Delete all 21 clone rows.** Keep the unique in `ORBIT_SUBJECTS`.

Do not keep a “thinned” eight. Agent 49: poles and enamel clone as kit;
a named school-blazer A-stance does not. Agent 62: one man copied.

If parent still wants bodies in v9 stills **this pass** (before Mika /
worker 8-views land), keep **at most two** clones, never these, and
never any row in the table above:

```js
{ asset: "civilian-hiro", x: -27.2, z: 7.25, yaw: Math.PI / 2 }, // S walk, back to street-east
{ asset: "civilian-hiro", x: -30.0, z: 84.5, yaw: Math.PI / 2 }, // west quay, ~70 m from unique
```

Those poses are **not** in the live file. Closest live stand-ins are
illegal: `(−32, 6.8)` hits enamel; `(−28, 78)` is the drum.

Must-delete even if parent refuses the wipe (illegal / adjacent):

```js
{ asset: "civilian-hiro", x: -2.2, z: 1.4, yaw: 0.4 },   // road
{ asset: "civilian-hiro", x: 2.6, z: 2.8, yaw: 3.4 },    // road
{ asset: "civilian-hiro", x: 0, z: 64, yaw: 0.3 },       // truck lane
{ asset: "civilian-hiro", x: -28, z: 78, yaw: 0.15 },    // oil-drum origin
{ asset: "civilian-hiro", x: -4, z: -6.9, yaw: 0.4 },    // 5.22 m from unique
{ asset: "civilian-hiro", x: 2, z: -7.0, yaw: 2.8 },     // 6 m chain
{ asset: "civilian-hiro", x: 8, z: -6.8, yaw: Math.PI }, // booth + zelkova
{ asset: "civilian-hiro", x: -32, z: 6.8, yaw: 3.0 },    // 1.28 m from enamel
{ asset: "civilian-hiro", x: -8, z: 6.9, yaw: 1.7 },     // 6.73 m from (-1.4, 8.2)
{ asset: "civilian-hiro", x: -1.4, z: 8.2, yaw: 3.1 },   // south cluster
{ asset: "civilian-hiro", x: 10, z: 6.8, yaw: 0.2 },     // 2.4 m from enamel
```

Then still drop the leftovers so one frustum never holds two blazers:
`(−16, 6.8)`, `(20, −6.8)`, `(32, −6.9)`, `(22, 6.9)`, `(18, 18)`,
`(−22, −18)`, `(−16, 80)`, `(12, 82)`, `(−40, 18)`, `(−24, −6.9)`.
`(18, 18)` is the Watanabe slot. Dock leftovers are the worker slot.

---

## Delete — `vending-enamel` `INSTANCES`

Kit may clone. Delete only the adjacent / illegal three:

```js
{ asset: "vending-enamel", x: -10.8, z: -6.7, yaw: 0 },           // 4.08 m from unique, not a pair
{ asset: "vending-enamel", x: 18.5, z: -5.4, yaw: 0 },            // in the north travel lane
{ asset: "vending-enamel", x: 16.8, z: 6.7, yaw: Math.PI },       // inside unique phone-booth
```

Keep unique + the other eight clones (T-junction, arcade, tobacco,
records-east, yokobori facade, south west, arcade-south, east north).
After the three cuts: **1 + 8 = 9** machines. If a classic double is
still wanted, add **one** sibling **1.00–1.20 m east of the unique**
(`x ≈ −5.7`, `z ≈ −6.7`), not another 4 m neighbour.

Do not delete enamel to clear zelkova `(−28, −6.7)` / `(12, 6.7)` —
slide the trees.

---

## Min spacing (parent applies on paste)

| class | min Δxz | extra |
|---|---|---|
| Hiro ↔ Hiro (same curb or same landmark frustum) | **8 m** | unique owns Yaoya `(−9.2, −7.3)` |
| Hiro ↔ Hiro (other district, cannot share a hero still) | **8 m** still; prefer **≥ 40 m** | dock vs Sakae |
| Hiro ↔ enamel / booth / pole / cub | **1.5 m** | 0.52 m shoulders |
| Hiro vs ground | — | **no** `z ∈ [−6, 6]`; **no** dock `x ∈ (−5, 8)` |
| Enamel unpaired beat (same curb) | **8 m** | lot-line flanks, not shop-front wallpaper |
| Enamel **pair** (one per stop / shop) | **1.00–1.20 m** c-c | 0.10–0.30 m gap; never a 4 m “almost pair” |
| Enamel ↔ booth / cub / Hiro | **1.5 m** | |
| Enamel vs ground | — | north `z ≤ −6.5`; south `z ≥ 6.5` |

Target occupancy until second humanoids exist: **Hiro unique + 0 clones**
(hard cap **+2**, agent 49 override only). Enamel **~8–12** unpaired, or
fewer plus **one** true pair at Yaoya.

---

## Need Mika / worker variants?

**Yes. Both. Do not reskin Hiro.**

`civilian-hiro` is one 8-view school blazer. Instancing him is the wrong
cheap (agent 06 / 15 / 49 / 58 / 62). Density is **different silhouettes**.

| body | role | stills now | catalog | plant when ready |
|---|---|---|---|---|
| **Mika** `civilian-mika/` | Sakae sidewalk, not a blazer | **3/8** (`yaw-000/045/090` only) | **not catalogued** (agent 61) | unique on sidewalkN/S, **≥ 8 m** from Hiro; take the deleted north/south clone slots |
| **Quay worker** | Amihama apron / seawall | **none** | none | unique `quay-worker` **`(−26.0, 83.5)`** (agent 58); replace every dock Hiro |
| Watanabe (also needed) | Yokobori mouth, overcoat | **none** | none | unique **`(22.4, 11.6)`** (agent 58); not Mika, not Hiro `(18, 18)` |

Mika: finish `yaw-135 … yaw-315` before any `ORBIT_SUBJECTS` row. Do not
instance Mika either until a third female / shop-lady hull exists.

Worker: new humanoid-8 stills (helmet / work coat / shorter than Hiro).
Do not stand a Hiro on the quay and call it a variant.

Until those two uniques exist, **delete Hiro clones** rather than
padding stills with the same 1.72 m A-stance.
)
