# 47 — Ground clutter (boxes + drums)

Do **not** edit sample source from this note. Paste `addGroundClutter` into
`ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs` in a later pass.

Time lock: Saturday 29 November 1986, 15:20, overcast winter afternoon.
Convention: `+X` east, `+Z` south. Yaw `0` faces south. `groundHeight` is
already imported from `./map.mjs`. `THREE` is `import * as THREE from
"three/webgpu"`.

No `reconstructOrbitAsset`. No catalog rows. No `dock-crates` / `oil-drum`
orbit subjects (agent 15). Same cheap language as stairs / quay / skyline:
`BoxGeometry` + `CylinderGeometry` + `MeshStandardMaterial`,
cast/receive shadow, sit on `groundHeight`.

---

## Why this pass

Agent 15: **0** crates/drums on the ground (Yaoya’s produce is baked into
the still). Agent 10’s Yokobori beer-crate boxes were never applied.
Amihama apron, Route 16 lot, and shop backs are bare slabs.

Ch.1 feel at arm’s length is timber cubes, 200 L drums, pallets, and a
sandbag or planter against a wall — not another reconstructed shop.

---

## Kit (metres)

| piece | geometry | size | notes |
|---|---|---|---|
| crate | `BoxGeometry` | **0.4³** | stacks of **3–8**, two woods, slight yaw jitter |
| oil drum | `CylinderGeometry` | **r = 0.29, h = 0.88** | 8 segments; faded red / darker rust |
| pallet | `BoxGeometry` | **1.1 × 0.12 × 1.1** | two loaded (crate `lift: 0.12`) |
| sandbag | `BoxGeometry` | 0.50 × 0.22 × 0.32 | short walls, 3–6 bags |
| planter | `BoxGeometry` | 0.62 × 0.40 × 0.62 + 0.50 × 0.08 × 0.50 soil | clay pot, dark dirt cap |

Shared geometries. Two materials per family. No `Math.random` (reload-stable).
No `Group` — each cube/drum is a mesh, named like skyline blocks.

Seat recipe (same as stairs / skyline):

```
y = groundHeight(x, z) + height * 0.5
```

A whole crate stack samples `groundHeight` **once at the origin** so the
pile does not stair-step on Suzume’s toe. `lift` raises every cube (loaded
pallet).

---

## Keep-out (catalog.mjs now)

Do not sit inside hulls or on walk spines.

| what | pose / AABB | clutter rule |
|---|---|---|
| Yaoya | (−9, −8.5), 5.4 × 6.2, front **z = −5.4** | crates **south** of the front, not in the shop |
| Hiro | (−9.2, −7.3) | stacks stay at **z ≤ −4.4**, south of him |
| vending unique | (−6.8, −5.9) | east stack in the pharmacy slit, not on the machine |
| vending instance | (−10.8, −6.7) | west stack south of it |
| pole | (−8, −6.4) | east of Yaoya; 1.5 m from east stack |
| Galaxy sakaba | (26, 16), yaw −π/2 → AABB **x 23.25…28.75, z 13.4…18.6** | against west/south walls, not in the lane |
| yokobori vending | (21.94, 18.6) | stack A south of it |
| yokobori pole | (18.35, 11.4) | planter at 18.72, 12.32 (0.9 m SE) |
| WH8 unique | (−12, 72) → x −16.25…−7.75, z 66.5…77.5 | north apron, ≥1.2 m off the wall |
| WH8 west | (−32, 72) same depth | pallet west of east face |
| WH8 east | (36, 72) | stack north, x ≈ 32.4 |
| WH3 | (16, 70) → x 8…24, z 64…76 | drums at **z ≈ 62.9**, not on z = 64 |
| seawall / bollards | wall z = 88.35, `roads` bollards z = 86 | bags/drums at z ≤ 85.6 |
| stairs | x −23.25…−16.75, z −12.4…−24 | no behind-shop pile in this band |
| harbor corridor | x −8…8, z 10…52 | barber back pile at **x = 8.85** (east of the pad) |
| yokobori lane | x ≈ 20.5 | stacks at 18.6 (west wall) and 22.5 (bar) |
| r16 bays | (−29.6, 24.4 / 27.6 / 30.8) | keep aisle; clutter on east/SW/N edges |
| `LANDMARKS.seawall` | (−38.5, 86.6) | nothing at the camera |

Sakae travel lanes `z = −6…6` stay empty except the Yaoya spill at
**z ≈ −4.5** (produce on the threshold, classic yaoya, not a cargo dump).

---

## 60 plants / 5 zones (40+)

24 stacks (110 cubes, every stack 3–8) + 17 drums + 8 pallets + 4 bag
walls (19 bags) + 7 planters (pot + soil) = **60 plants, 168 meshes**.

### 1. Greengrocer front — Yaoya

`LANDMARKS.produce` looks north at this facade. Spill onto the asphalt
just south of the still’s crate table.

| kind | n | x | z | yaw | lift |
|---|---:|---:|---:|---|---:|
| crate | 5 | −11.05 | −4.62 | 0.10 | 0 |
| crate | 4 | −5.52 | −4.78 | −0.14 | 0 |
| crate | 3 | −8.38 | −4.45 | 0.26 | 0 |
| planter | | −11.58 | −5.12 | 0.05 | |
| planter | | −4.35 | −5.32 | −0.08 | |

West 5-stack south of the west vending. East 4-stack in the 3 m
Yaoya–pharmacy slit (vending unique east edge ≈ −6.35; pharmacy west
−3.3). 3-stack is the street island, south of Hiro. Planters bookend.

### 2. Dock — Amihama

North faces of the warehouses (`z ≈ 64…66.5`) and the quay north of the
seawall. Centreline `x ≈ 0` gets one pallet + one 6-stack at x = −2, not
a wall.

| kind | n | x | z | yaw | lift |
|---|---:|---:|---:|---|---:|
| crate | 8 | −18.20 | 63.30 | 0.15 | 0 |
| crate | 6 | 5.35 | 62.85 | −0.18 | 0 |
| crate | 5 | 25.55 | 62.45 | 0.20 | 0 |
| crate | 4 | 32.35 | 64.55 | −0.08 | 0 |
| crate | 3 | −14.60 | 62.35 | 0.06 | **0.12** |
| crate | 6 | −2.05 | 84.00 | 0.38 | 0 |
| pallet | | −14.60 | 62.35 | 0.06 | |
| pallet | | 14.20 | 62.50 | −0.18 | |
| pallet | | 2.35 | 83.35 | 0.28 | |
| pallet | | −28.90 | 63.35 | −0.10 | |
| drum | | 18.60 | 62.92 | 0 | |
| drum | | 19.34 | 62.78 | 0.40 | |
| drum | | 18.40 | 63.55 | 0.10 | |
| drum | | −19.05 | 64.30 | 0.20 | |
| drum | | −18.32 | 63.82 | 0 | |
| drum | | −8.52 | 64.70 | 0.15 | |
| drum | | −8.40 | 85.15 | 0 | |
| drum | | 8.18 | 84.52 | 0.25 | |
| sandbag | 6 | −22.40 | 85.55 | 0.02 | |
| sandbag | 6 | 28.55 | 85.32 | 0.04 | |

8-stack is agent 15’s dock-crates origin, as boxes. Drum trio at WH3
matches the unique+pair poses, pulled 1.1 m north of the hull.

### 3. Yokobori

Agent 10 stack A/B/C, cube size updated. Lane centre stays open.

| kind | n | x | z | yaw |
|---|---:|---:|---:|---|
| crate | 6 | 22.50 | 19.38 | −0.12 |
| crate | 3 | 22.68 | 19.98 | 0.20 |
| crate | 5 | 18.58 | 17.18 | 0.40 |
| crate | 4 | 29.35 | 19.25 | −0.35 |
| drum | | 22.38 | 18.18 | 0.10 |
| drum | | 22.10 | 17.50 | 0 |
| drum | | 29.08 | 18.42 | 0.15 |
| pallet | | 30.55 | 23.85 | 0.35 |
| planter | | 18.72 | 12.32 | 0.08 |

A/B against Galaxy’s south-west corner (south of the enamel). C pinches
the west wall, not the walk. East 4-stack + drum sit past the bar AABB
(`x > 28.75`). Pallet at the south-east cobble, off the lane.

### 4. Route 16 lot

`GROUND.route16Lot` x −34.5…−25.5, z 20…34. Future Carry bay B
(−29.4, 27.6) stays empty.

| kind | n | x | z | yaw | lift |
|---|---:|---:|---:|---|---:|
| crate | 7 | −26.40 | 22.50 | 0.28 | 0 |
| crate | 5 | −33.20 | 32.65 | −0.16 | 0 |
| crate | 4 | −27.15 | 21.35 | 0.16 | **0.12** |
| pallet | | −27.15 | 21.35 | 0.16 | |
| pallet | | −26.70 | 32.50 | −0.22 | |
| drum | | −33.48 | 21.12 | 0 | |
| drum | | −32.70 | 21.58 | 0.35 | |
| drum | | −33.10 | 22.08 | 0.10 | |
| drum | | −26.12 | 33.32 | 0.20 | |
| sandbag | 4 | −25.82 | 26.90 | π/2 | |
| planter | | −33.90 | 20.52 | 0.10 | |

Drum nest in the NW corner (walk / lot seam). 4-bag wall along the east
lot line, facing the highway. Loaded pallet at the north apron, in
`LANDMARKS.route16`’s south-looking frame.

### 5. Behind shops

North backs sit on the hill toe (`groundHeight(−9, −13) ≈ 0.24`) — must
sample, not `y = 0.2`. South backs are unwalkable except the harbor
corridor; barber pile is **east** of x = 8.

| kind | n | x | z | yaw | shop |
|---|---:|---:|---:|---|---|
| crate | 5 | −34.20 | −13.18 | 0.12 | hardware |
| crate | 4 | −26.35 | −12.58 | −0.18 | tobacco (west of stairs) |
| crate | 4 | −9.10 | −12.92 | −0.20 | Yaoya |
| crate | 3 | 0.50 | −13.32 | 0.14 | pharmacy |
| crate | 4 | 17.85 | −12.32 | −0.10 | cassette |
| crate | 5 | −10.20 | 13.22 | π+0.08 | Midori |
| crate | 4 | 8.85 | 12.62 | π−0.10 | Haru SE |
| crate | 3 | 14.20 | 12.52 | π+0.16 | kissaten |
| drum | | −34.55 | −13.52 | 0.20 | hardware |
| drum | | 8.92 | 12.80 | 0.12 | barber |
| pallet | | −11.15 | 13.50 | 0.12 | Midori |
| sandbag | 3 | −10.85 | 13.38 | 0.10 | Midori |
| planter | | 4.90 | −13.15 | 0.05 | pharmacy–arcade |
| planter | | −13.08 | 12.82 | 0.06 | Midori SW |
| planter | | 16.62 | 12.28 | −0.10 | kissaten, west of alley mouth |

Skyline near rank is z = −22…−28. These piles are 9 m south of it, in
the service strip, not a second street wall.

---

## Wire-up

In `createStudio`, after roads (clutter sits on cobble / lot / dock
patches):

```js
  addStreetFurniture(scene);
  addSkyline(scene);
  addRoads(scene, { THREE, groundHeight });
  addGroundClutter(scene);
```

Paste `addGroundClutter` next to `addStreetFurniture`. No new files.

---

## Copy-paste JS

```js
function addGroundClutter(scene) {
  const crateGeo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const drumGeo = new THREE.CylinderGeometry(0.29, 0.29, 0.88, 8);
  const palletGeo = new THREE.BoxGeometry(1.1, 0.12, 1.1);
  const bagGeo = new THREE.BoxGeometry(0.5, 0.22, 0.32);
  const planterGeo = new THREE.BoxGeometry(0.62, 0.4, 0.62);
  const soilGeo = new THREE.BoxGeometry(0.5, 0.08, 0.5);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 0.9, metalness: 0 });
  const woodDark = new THREE.MeshStandardMaterial({ color: 0x4e3a28, roughness: 0.92, metalness: 0 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x7a3a2c, roughness: 0.72, metalness: 0.14 });
  const rustDark = new THREE.MeshStandardMaterial({ color: 0x3d2a22, roughness: 0.78, metalness: 0.16 });
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 0.94, metalness: 0 });
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x8a7c5c, roughness: 0.96, metalness: 0 });
  const planterMat = new THREE.MeshStandardMaterial({ color: 0x6e4332, roughness: 0.9, metalness: 0 });
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.98, metalness: 0 });

  const STACK = {
    3: [[0, 0, 0, 0.05], [0.41, 0, 0.05, -0.08], [0.17, 0.4, 0.02, 0.12]],
    4: [[0, 0, 0, 0.04], [0.42, 0, 0.03, -0.06], [0.02, 0.4, 0.04, 0.1], [0.4, 0.4, -0.02, -0.04]],
    5: [[0, 0, 0, 0.06], [0.42, 0, 0.05, -0.05], [0.1, 0, 0.43, 0.08], [0.22, 0.4, 0.14, -0.1], [0.2, 0.8, 0.1, 0.14]],
    6: [[0, 0, 0, 0.03], [0.42, 0, 0.04, -0.07], [0.84, 0, -0.03, 0.05], [0.2, 0.4, 0.06, 0.09], [0.62, 0.4, 0.01, -0.04], [0.4, 0.8, 0.03, 0.11]],
    7: [[0, 0, 0, 0.04], [0.42, 0, 0.05, -0.06], [0.06, 0, 0.43, 0.08], [0.46, 0, 0.41, -0.03], [0.22, 0.4, 0.12, 0.1], [0.24, 0.4, 0.5, -0.08], [0.24, 0.8, 0.28, 0.05]],
    8: [[0, 0, 0, 0.03], [0.42, 0, 0.04, -0.05], [0.84, 0, -0.02, 0.06], [0.1, 0, 0.43, 0.08], [0.22, 0.4, 0.1, -0.07], [0.64, 0.4, 0.02, 0.04], [0.42, 0.4, 0.44, -0.1], [0.44, 0.8, 0.14, 0.12]],
  };

  function plant(mesh, name, x, y, z, yaw) {
    mesh.name = name;
    mesh.position.set(x, y, z);
    if (yaw) mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  function plantStack(x, z, n, yaw, lift) {
    const layout = STACK[n];
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const y0 = groundHeight(x, z) + (lift || 0);
    for (let i = 0; i < layout.length; i++) {
      const lx = layout[i][0];
      const ly = layout[i][1];
      const lz = layout[i][2];
      const crate = new THREE.Mesh(crateGeo, i % 2 ? woodDark : wood);
      plant(
        crate,
        "crate",
        x + lx * c + lz * s,
        y0 + 0.2 + ly,
        z - lx * s + lz * c,
        yaw + layout[i][3],
      );
    }
  }

  function plantBagWall(x, z, yaw, n) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const y0 = groundHeight(x, z);
    for (let i = 0; i < n; i++) {
      const col = i % 4;
      const row = (i / 4) | 0;
      const lx = (col - 1.5) * 0.42;
      const lz = (row % 2) * 0.06;
      const bag = new THREE.Mesh(bagGeo, bagMat);
      plant(
        bag,
        "sandbag",
        x + lx * c + lz * s,
        y0 + 0.11 + row * 0.2,
        z - lx * s + lz * c,
        yaw + (col % 2 ? 0.08 : -0.06),
      );
    }
  }

  const stacks = [
    { x: -11.05, z: -4.62, n: 5, yaw: 0.1 },
    { x: -5.52, z: -4.78, n: 4, yaw: -0.14 },
    { x: -8.38, z: -4.45, n: 3, yaw: 0.26 },
    { x: -18.2, z: 63.3, n: 8, yaw: 0.15 },
    { x: 5.35, z: 62.85, n: 6, yaw: -0.18 },
    { x: 25.55, z: 62.45, n: 5, yaw: 0.2 },
    { x: 32.35, z: 64.55, n: 4, yaw: -0.08 },
    { x: -14.6, z: 62.35, n: 3, yaw: 0.06, lift: 0.12 },
    { x: -2.05, z: 84, n: 6, yaw: 0.38 },
    { x: 22.5, z: 19.38, n: 6, yaw: -0.12 },
    { x: 22.68, z: 19.98, n: 3, yaw: 0.2 },
    { x: 18.58, z: 17.18, n: 5, yaw: 0.4 },
    { x: 29.35, z: 19.25, n: 4, yaw: -0.35 },
    { x: -26.4, z: 22.5, n: 7, yaw: 0.28 },
    { x: -33.2, z: 32.65, n: 5, yaw: -0.16 },
    { x: -27.15, z: 21.35, n: 4, yaw: 0.16, lift: 0.12 },
    { x: -34.2, z: -13.18, n: 5, yaw: 0.12 },
    { x: -26.35, z: -12.58, n: 4, yaw: -0.18 },
    { x: -9.1, z: -12.92, n: 4, yaw: -0.2 },
    { x: 0.5, z: -13.32, n: 3, yaw: 0.14 },
    { x: 17.85, z: -12.32, n: 4, yaw: -0.1 },
    { x: -10.2, z: 13.22, n: 5, yaw: Math.PI + 0.08 },
    { x: 8.85, z: 12.62, n: 4, yaw: Math.PI - 0.1 },
    { x: 14.2, z: 12.52, n: 3, yaw: Math.PI + 0.16 },
  ];
  for (const spec of stacks) plantStack(spec.x, spec.z, spec.n, spec.yaw, spec.lift);

  const drums = [
    { x: 18.6, z: 62.92, yaw: 0 },
    { x: 19.34, z: 62.78, yaw: 0.4 },
    { x: 18.4, z: 63.55, yaw: 0.1 },
    { x: -19.05, z: 64.3, yaw: 0.2 },
    { x: -18.32, z: 63.82, yaw: 0 },
    { x: -8.52, z: 64.7, yaw: 0.15 },
    { x: -8.4, z: 85.15, yaw: 0 },
    { x: 8.18, z: 84.52, yaw: 0.25 },
    { x: 22.38, z: 18.18, yaw: 0.1 },
    { x: 22.1, z: 17.5, yaw: 0 },
    { x: 29.08, z: 18.42, yaw: 0.15 },
    { x: -33.48, z: 21.12, yaw: 0 },
    { x: -32.7, z: 21.58, yaw: 0.35 },
    { x: -33.1, z: 22.08, yaw: 0.1 },
    { x: -26.12, z: 33.32, yaw: 0.2 },
    { x: -34.55, z: -13.52, yaw: 0.2 },
    { x: 8.92, z: 12.8, yaw: 0.12 },
  ];
  for (let i = 0; i < drums.length; i++) {
    const spec = drums[i];
    const drum = new THREE.Mesh(drumGeo, i % 2 ? rustDark : rust);
    plant(drum, "oil drum", spec.x, groundHeight(spec.x, spec.z) + 0.44, spec.z, spec.yaw);
  }

  const pallets = [
    { x: -14.6, z: 62.35, yaw: 0.06 },
    { x: 14.2, z: 62.5, yaw: -0.18 },
    { x: 2.35, z: 83.35, yaw: 0.28 },
    { x: -28.9, z: 63.35, yaw: -0.1 },
    { x: 30.55, z: 23.85, yaw: 0.35 },
    { x: -27.15, z: 21.35, yaw: 0.16 },
    { x: -26.7, z: 32.5, yaw: -0.22 },
    { x: -11.15, z: 13.5, yaw: 0.12 },
  ];
  for (const spec of pallets) {
    const pallet = new THREE.Mesh(palletGeo, palletMat);
    plant(pallet, "pallet", spec.x, groundHeight(spec.x, spec.z) + 0.06, spec.z, spec.yaw);
  }

  plantBagWall(-22.4, 85.55, 0.02, 6);
  plantBagWall(28.55, 85.32, 0.04, 6);
  plantBagWall(-25.82, 26.9, Math.PI / 2, 4);
  plantBagWall(-10.85, 13.38, 0.1, 3);

  const planters = [
    { x: -11.58, z: -5.12, yaw: 0.05 },
    { x: -4.35, z: -5.32, yaw: -0.08 },
    { x: 18.72, z: 12.32, yaw: 0.08 },
    { x: -33.9, z: 20.52, yaw: 0.1 },
    { x: 4.9, z: -13.15, yaw: 0.05 },
    { x: -13.08, z: 12.82, yaw: 0.06 },
    { x: 16.62, z: 12.28, yaw: -0.1 },
  ];
  for (const spec of planters) {
    const y0 = groundHeight(spec.x, spec.z);
    const pot = new THREE.Mesh(planterGeo, planterMat);
    plant(pot, "planter", spec.x, y0 + 0.2, spec.z, spec.yaw);
    const dirt = new THREE.Mesh(soilGeo, soilMat);
    plant(dirt, "planter soil", spec.x, y0 + 0.38, spec.z, spec.yaw);
  }
}
```

---

## What should read in screenshots

| go | expect |
|---|---|
| `produce` | 0.4 m cubes on the Yaoya threshold, Hiro still visible over the 3-stack, vending not buried |
| `yokobori` | timber pile + drums on the left (Galaxy south-west), west-wall 5-stack as a dark block, lane open |
| `warehouse` | 8-stack and pallet on WH8’s north apron, drums at the west corner |
| `quay` | 6-stack + pallet off-centre, sandbag walls L/R, drums near the cap, seawall still the hero |
| `route16` | lot drums/pallets south of the T, bays empty, planter at the walk corner |
| `flower` / `barber` | south-row fronts unchanged; clutter is **behind** (only if you walk around) |

---

## Out of scope

- Do not edit `catalog.mjs`, `map.mjs`, or stills.
- Do not add `TorusGeometry`, `PlaneGeometry`, or a reconstructed crate/drum.
- Do not instance shop facades as boxes.
- Do not drop a bus, forklift, or crane out of this kit.
- Do not plant on Sakae centreline, the stone stairs, or `LANDMARKS.seawall`.
- Agent 15’s `dock-crates` / `oil-drum` uniques can replace matching
  clusters later; keep these origins so the swap is a delete+plant.
