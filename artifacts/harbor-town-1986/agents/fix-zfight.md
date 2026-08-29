# Ground-plane Y vs height field (z-fight)

Owner: `GROUND.y` in `src/map.mjs`. Height-field vertex Y in `src/main.mjs`
stays `groundHeight(x, z)` with **no** extra offset — lifting the field by
0.02 would land it on `roads.mjs` paint (`surfaceY + 0.02`) and the Sakae
dashes (`y = 0.03`). Walk / eye still sample `groundHeight`. Fill systems
untouched.

`addGroundPatch` plants a horizontal `PlaneGeometry` at `spec.y`. The field
is `PlaneGeometry(120, 200, 60, 80)` at the origin, `rotateX(-π/2)`,
`pos.setY(i, groundHeight(...))`. Camera `near = 0.12`, `far = 220`.

## Before / after (`GROUND.y`)

| patch | before | after | vs field (`groundHeight` in AABB) |
|---|---:|---:|---|
| `asphalt` | **0** | **−0.02** | 0 on z ∈ [−8, 12] (was coplanar → moire road) |
| `route16Road` | **0** | **−0.02** | 0 on z ∈ [10, 52) |
| `route16Quay` | **0** | **−0.02** | 0 on z ∈ [50, 52); 0.05 on z ≥ 52 |
| `park` | **0.02** | **−0.02** | hill 0.94…8 (flat card no longer at a near-zero Y) |
| `sidewalkN` | 0.08 | 0.08 | field 0; 8 cm lip stays |
| `sidewalkS` | 0.08 | 0.08 | field 0 |
| `route16Walk` | 0.08 | 0.08 | field 0 |
| `alley` | 0.04 | 0.04 | field 0.02 (x > 18, z 12…28) → 2 cm |
| `route16Lot` | 0.02 | 0.02 | field 0 → 2 cm (stall paint sits at +0.04) |
| `dock` | 0.06 | **0.08** | field 0.05 (was 1 cm; now 3 cm, same lip as sidewalks) |
| `water` | −0.40 | −0.40 | field −0.45 for z > 88 |

Road / park overlays that sat **on** the field are now **2 cm under** it.
Sakae paint stays 2–3 cm **above** the field.

## Water vs `addQuayEdge`

Unchanged. Three sheets plus the field, none coplanar:

| mesh | y | gap to next |
|---|---:|---|
| quay surface (`addQuayEdge`) | **−0.28** |  |
| `GROUND.water` | **−0.40** | 0.12 below surface |
| height field `z > 88` | **−0.45** | 0.05 below `GROUND.water` |
| quay dark (`addQuayEdge`) | **−0.58** | 0.13 below field |

Surface covers `GROUND.water`; dark plane is the thickness cue. Seawall foot
is −1.15. Do not pull `GROUND.water` onto −0.28 or −0.58.

## Not done

- No `pos.setY` / `terrain.position.y` bias in `main.mjs`.
- No delete of asphalt (AABB stays the district owner; card is just an underlay).
- No fill / `roads.mjs` / `groundHeight` edits.
