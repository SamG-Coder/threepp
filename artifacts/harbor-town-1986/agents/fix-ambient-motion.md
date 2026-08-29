# Ambient motion (15:20)

Shipped `ThreeBrowserRuntime/samples/harbor_town_1986/src/ambient-motion.mjs`.

```js
export function createAmbientMotion({ scene, THREE, groundHeight }) → { update(dt) }
```

Wired in `main.mjs` next to ambient life, after the scene exists:

```js
const life = createAmbientLife({ scene, THREE, groundHeight });
const motion = createAmbientMotion({ scene, THREE, groundHeight });
// animation loop
life.update(dt, camera);
motion.update(dt);
```

Did **not** edit `catalog.mjs`. Cheap `BoxGeometry` / `CylinderGeometry` only. No `Math.random`. No reconstructed hulls.

Time lock: Saturday 29 November 1986, 15:20, overcast. `+X` east, `+Z` south. Yaw `0` faces south.

---

## 1. One kei-van box on a carriageway loop

West-lane Route 16 (`x = −43.8`, inside `route16Road` `−46.5…−36.5`) then Sakae lane centre (`z = 2`, yellow dashes). Never sidewalk (`z = −12…−6` / `6…10`, `route16Walk` `x = −36.5…−34.5`).

Closed polyline, 2.8 m/s, yaw damped 2.1 rad/s at the T and the east overrun:

| vertex | x | z |
|---|---:|---:|
| quay south | −43.8 | 82 |
| T-junction | −43.8 | 2 |
| Sakae east overrun | 45 | 2 |
| T-junction | −43.8 | 2 |

`onCarriageway` rejects anything off Sakae `z ∈ [−5.6, 5.6]` or Route 16 `x ∈ [−46.4, −36.8]`, `z ∈ [2, 84]`. West lane stays ~4 m off the parked `city-bus` boxes at `(−40, 22)` and `(−40, 38)`.

Van is a light-grey box (`1.48 × 1.58 × 3.12`, `0xb8c4c8`) plus a cab window and four wheels. Name `ambient kei-van`. Seats on `groundHeight`.

## 2. Yokobori hanging signs

Two 看板 on iron arms, pivot at the hang point, `rotation.z = amp * sin(t * freq + phase)`:

| name | x | y | z | amp | colour |
|---|---:|---:|---:|---:|---|
| `yokobori hanging sign galaxy` | 22.55 | 3.48 | 15.15 | 0.08 | enamel red |
| `yokobori hanging sign west` | 22.15 | 3.28 | 19.85 | 0.07 | cream |

Galaxy front is `x ≈ 23.25`; both boards hang west into the alley above the walk slot.

## 3. Fishing boats

Does not plant new hulls. Traverses existing `fishing boat *` meshes (`fill-quay` + `fill-world`) and clusters parts to the nearest hull so cabin/mast stay with the hull.

```js
mesh.position.y = baseY + 0.04 * Math.sin(t * 0.85 + phase)
```

Phase from hull `x * 0.23 + z * 0.11`.

## 4. Gulls

Three white soaring boxes far over the bay (water `z ≥ 88`). No shadow.

| | centre (x, z) | r | y | ω |
|---|---|---:|---:|---:|
| 0 | (8, 118) | 14 | 18.2 | 0.22 |
| 1 | (−12, 124) | 11 | 16.4 | 0.18 |
| 2 | (28, 121) | 16 | 20.1 | 0.15 |

Wing box ~0.7–0.9 × 0.055 × 0.22 m. Bank `rotation.z = 0.22`.
