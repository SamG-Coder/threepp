# Tree placement — oaks, willows, zelkova

Applied to `catalog.mjs` `INSTANCES` and `fill-world.mjs` `addStreetTrees`.
Did **not** edit `scout.mjs`.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south.

v6 cameras `town`, `park`, `quay`, and `spawn` were inside reconstructed
canopies. `zelkova` is a 24-tri ghost — every curb clone was air.

---

## Keep-out

Oaks are **15 m × 14 m** (`realWidth` 14 → canopy radius **7 m**).
Willows are **12 m** tall. Clearance: canopy edge ≥ **8 m** from a landmark
→ oak trunk ≥ **15 m**, willow trunk ≥ **14 m** if the hull is a 12 m crown.

| landmark | x | z |
|---|---:|---:|
| town | −6 | −50 |
| park | −24 | −20 |
| hill | −20 | −15.2 |
| spawn | −20 | −26 |
| quay | 6 | 87 |

No oak trunk in a hill-house AABB (±4.2 m) or on the stone stairs
(`x −23.4…−16.6`, `z −24…−12`).

---

## `zelkova` — instances removed

Hull is **24 tris**. Sixteen curb clones at `z = ±6.7` printed nothing and
could not be a colonnade.

- **Removed** every `zelkova` row from `INSTANCES`.
- **Kept** the `ORBIT_SUBJECTS` unique at `(−20, −6.7)` so stills tests
  still resolve `zelkova/yaw-*.png`. One failed mesh, not seventeen.

Sakae winter trees are the primitive `addStreetTrees` crowns, not this hull.

---

## `weeping-willow` — four in water only

Apron poses at `z ≈ 80…86` sat inside `quay` / `seawall`. Waterline is
`z > 88` (`groundHeight` −0.45).

Four clones, all `z ∈ [97, 99]`:

| x | z | yaw | dist → quay (6, 87) | canopy (r = 6) |
|---:|---:|---:|---:|---:|
| −28 | 97 | 0.35 | 35.4 m | 29.4 m |
| −6 | 98 | 1.2 | 16.3 m | 10.3 m |
| 16 | 99 | 0.5 | 15.6 m | 9.6 m |
| 32 | 97.5 | 0.2 | 28.0 m | 22.0 m |

Unique stays at `(46, 98)` for stills — east of the quay look, also in
water. No willow on the dock apron.

---

## `english-oak` — thinned park edge

Was an 8–10 m orchard through `park` / `town` / `spawn`. Unique kept at
`(−42, −44)` (15 × 14, already ≥ 21 m canopy clearance). Four clones on
the north and west park lips so the lawn cameras look across grass:

| x | z | yaw | nearest camera / canopy |
|---:|---:|---:|---|
| −34 | −48 | 0.15 | spawn 19.1 m |
| −26 | −48 | −0.1 | town 13.1 m |
| −20 | −42 | 0.25 | spawn 9.0 m, town 9.1 m (behind spawn; ~83° off town look) |
| −44 | −16 | 0.3 | park 13.4 m (behind park; west of hill) |

Dropped the grid at `(−20, −46)`, `(−20, −36)`, `(−16, −28)`, `(−16, −44)`,
`(−22, −40)` (inside town / spawn / park volumes) and `(−44, −36)` (sits
on `wooden-hill-house` `(−44, −36)`).

Trunk spacing ≥ 8 m. Closest clone-to-camera canopy is **9.0 m**.

---

## `addStreetTrees` — winter, not lollipops

`fill-world.mjs` already plants curb primitives at `z = ±7.15`. Retuned
the crown only:

- radius **1.45 → 0.9 m**
- colour `0x6a5a32` → winter brown **`0x5a4228`**
- squash `scale.y = 0.72`, seated at `y + 4.45` so it is a flat November
  blob on the trunk, not a 3 m candy in `sakae` / `street-east`

Trunks unchanged (4.2 m, bark `0x5a4638`). Same `x` beat.

---

## Counts

| asset | unique | instances | notes |
|---|---:|---:|---|
| `zelkova` | 1 | **0** | 24 tris; stills only |
| `weeping-willow` | 1 | **4** | water `z 97…99` |
| `english-oak` | 1 | **4** | park edge, 14 m crown |

`scout.mjs` landmarks were not moved. Cameras now stand in the open;
trees sit beside the look, not in it.
