# 21 — Slope seat for `plantMesh`

Do not edit `main.mjs` from this note. Parent applies the snippet.

## Current plant

```103:116:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
function plantMesh(proto, pose, label) {
  const object = new THREE.Mesh(proto.geometry, proto.material);
  object.name = label;
  object.scale.copy(proto.scale);
  object.position.y = proto.baseY;
  object.rotation.y = pose.yaw ?? 0;
  object.castShadow = true;
  object.receiveShadow = true;
  const group = new THREE.Group();
  group.name = label;
  group.position.set(pose.x, groundHeight(pose.x, pose.z ?? 0), pose.z ?? 0);
  group.add(object);
  return group;
}
```

`proto.baseY` is `-scale.extents.minY * scale.y`, so the mesh AABB floor sits at the group origin. The group Y is `groundHeight` at **the pose origin only**. The mesh stays axis-aligned in pitch/roll (`rotation.y` only).

`groundHeight(x, z)` in `map.mjs` ignores X. North of `z = -12` it is a quadratic ramp `t² × 7.2` with `t = clamp((-z - 12) / 34, 0, 1)`. Peak slope is about `0.42` (rise/run) at the top of the hill.

On a wide footprint that delta is metres, not centimetres.

## The hill house (why origin sampling fails)

`wooden-hill-house` / Suzume-zaka: `x = -28`, `z = -34`, `yaw = 0.42`, `realWidth = 8.2`, `realDepth = 7.6`.

Local corners `(±4.1, ±3.8)` rotated with Three.js `rotation.y` (`x' = x cos + z sin`, `z' = -x sin + z cos`):

| local (lx, lz) | world z | `groundHeight` |
|---|---|---|
| (4.1, 3.8) | -32.20 | 2.54 |
| (4.1, -3.8) | -39.14 | 4.59 |
| (-4.1, 3.8) | -28.86 | 1.77 |
| (-4.1, -3.8) | -35.80 | 3.53 |
| origin | -34.00 | **3.01** |

Δh across the slab is **2.82 m**. Sitting on the origin:

- downhill corner hovers **1.24 m**
- uphill corner buries **1.58 m**

Sakae shops (`z ≈ -8.5`) only nick the ramp (north edge ≈ `z = -12.6` → 2 mm). Warehouses sit on the dock plateau (`z > 52` → 0.04 m). Poles, booth, van, Hiro have sub-metre footprints. **Only the timber house is visibly wrong today**; the helper is still worth using on every plant so later hill instances do not regress.

## How to sample the four corners

Use the **catalog plan**, not mesh AABB:

- `realWidth` → local X (half `hx`)
- `realDepth` → local Z (half `hz`)
- `pose.yaw` → same Y rotation as `object.rotation.y`

`realWorldScale` currently scales XZ uniformly from `realWidth` and **ignores `realDepth`**. Seating must still use the authored `realWidth × realDepth` rectangle; that is the intended building plan.

World corner:

```
wx = pose.x + lx * cos(yaw) + lz * sin(yaw)
wz = pose.z - lx * sin(yaw) + lz * cos(yaw)
```

with `lx ∈ {−hx, +hx}`, `lz ∈ {−hz, +hz}`. Sample `groundHeight(wx, wz)` at each.

Fallback when `subject` is omitted or width/depth is missing: origin sample, same as today (INSTANCES do not carry dimensions).

## Min vs average

The mesh is not pitched, so one number has to stand in for a plane.

| policy | hill-house Y | downhill | uphill |
|---|---|---|---|
| origin (now) | 3.01 | hover 1.24 m | bury 1.58 m |
| **average of 4** | 3.11 | hover 1.34 m | bury 1.48 m |
| **min of 4** | 1.77 | flush | hover 2.82 m |
| max of 4 (not requested) | 4.59 | bury 2.82 m | flush |

Average ≈ origin on this hill (quadratic in z; four corners straddle the pose). It does **not** fix hover or bury.

**Use min.** The height field is the walkable ground; clipping a house through it is worse than a gap on the uphill eaves. `baseY` stays as the floor-to-origin offset; only `group.position.y` changes.

The leftover 2.8 m uphill gap is the cost of a rigid unpitched box. A follow-on (out of this patch) is to pitch the group to the four-corner plane, or drop a foundation skirt. Do not do that here.

Narrow props (`realWidth`/`realDepth` ≲ 1 m) agree with origin to centimetres; min is harmless.

## Patch snippet

Signature: `plantMesh(proto, pose, label, subject?)`. Keep `object.position.y = proto.baseY`.

```js
function footprintSeatY(pose, subject) {
  const width = Number(subject?.realWidth);
  const depth = Number(subject?.realDepth);
  const x = pose.x;
  const z = pose.z ?? 0;
  if (!(width > 0) || !(depth > 0)) return groundHeight(x, z);
  const hx = width * 0.5;
  const hz = depth * 0.5;
  const yaw = pose.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let minY = Infinity;
  for (const lx of [-hx, hx]) {
    for (const lz of [-hz, hz]) {
      const y = groundHeight(x + lx * c + lz * s, z - lx * s + lz * c);
      if (y < minY) minY = y;
    }
  }
  return minY;
}

function plantMesh(proto, pose, label, subject) {
  const object = new THREE.Mesh(proto.geometry, proto.material);
  object.name = label;
  object.scale.copy(proto.scale);
  object.position.y = proto.baseY;
  object.rotation.y = pose.yaw ?? 0;
  object.castShadow = true;
  object.receiveShadow = true;
  const group = new THREE.Group();
  group.name = label;
  group.position.set(pose.x, footprintSeatY(pose, subject), pose.z ?? 0);
  group.add(object);
  return group;
}
```

To sit on average instead, replace the `minY` fold with `sum / 4`. Not recommended (see table).

Call sites — pass the catalog subject so instances pick up width/depth:

```js
scene.add(plantMesh(proto, subject, subject.label, subject));
// ...
const src = ORBIT_SUBJECTS.find((entry) => entry.id === instance.asset);
scene.add(plantMesh(proto, instance, `${instance.asset} instance`, src));
```

`ORBIT_SUBJECTS` is already imported from `./catalog.mjs`.

## Stairs in `addStreetFurniture`

Already sit correctly. They are **not** `plantMesh` meshes.

```77:86:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
function addStreetFurniture(scene) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x8a8680, roughness: 0.92, metalness: 0 });
  for (let i = 0; i < 12; i++) {
    const z = -12.4 - i * 1.05;
    const step = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.24, 1.12), stone);
    step.position.set(-20, groundHeight(-20, z) + 0.12, z);
    step.castShadow = true;
    step.receiveShadow = true;
    scene.add(step);
  }
```

Each tread is its own 1.12 m-deep box. Y is `groundHeight` at that step’s centre plus half-height `0.12`, so the **bottom face meets the height field at the centre**.

- Height is independent of X → the 6.5 m width does not tilt or hang.
- 12 steps from `z = -12.4` to `z ≈ -24.0` follow the ramp individually.
- Worst slope under the top tread is ≈ 0.15. Over ±0.56 m of depth that is ≈ **8 cm**, inside the 24 cm slab, so the box still intersects the hill on both lips.

Four-corner seating would change each tread by millimetres. Leave the loop as-is.

Road dashes (`y = 0.03` on flat asphalt) and the quay wall (`z = 87.7`) are off the ramp; out of scope.
