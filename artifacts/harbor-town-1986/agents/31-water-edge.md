# 31 — Amihama water / land meeting

Do **not** edit sample source from this note. Drop the JS into
`addStreetFurniture` (replace the single quay `BoxGeometry`) and add the
landmark in `scout.mjs` / `map.mjs` in a later pass.

## What is wrong now

`GROUND.water` is a 105 × 32 m `PlaneGeometry` at **y = −0.4, z = 88…120**,
colour `0x2a4458`. The dock slab ends at **z = 88, y = 0.06**. The only
vertical between them is one fence-thin box:

```js
new THREE.BoxGeometry(98, 1.5, 0.85)  // x=4, y=0.35, z=87.7
```

That wall sits *on the dock* (south face ≈ z = 88.125). Looking from
`LANDMARKS.quay` (`x=0, z=82, yaw=0`) it is a grey bar with a paper water
edge behind it. Looking *along* the wall you see a 0.85 m sliver and a
zero-thickness water sheet. No cap, no wet line, no fenders, no ladders,
no depth.

Warehouses stay north of the apron (`z ≈ 68…76`, depth 12–18 m). Keep the
new wall on the **z ≈ 88** line — do not pull it north.

## Design

Gravity seawall, not a fence. Water meets the **south face**, not the dock
slab. Cap overhangs the water. Two water planes give the sheet thickness
when the camera grazes the edge. Tires and ladders repeat every 16 m so
the along-wall shot has a beat.

```
 north (Sakae)                         south (bay)
   dock y=0.06 | cap  y=1.62
               |==================  ← 0.22 m coping, +0.37 m water overhang
               | seawall
               |  h=2.55  thick=1.8
               |---- wet band ----  ← dark strip at waterline
               |  ○ tire  # ladder
 water dark  =====================  y=-0.58
 water top   ---------------------  y=-0.28   (covers GROUND.water at -0.4)
               seawall foot y=-1.15 (below both planes)
```

### Metres (+X east, +Z south)

| piece | size (x,y,z) | position | notes |
|---|---|---|---|
| seawall | 96 × 2.55 × 1.80 | 4, 0.125, 88.35 | south face **z = 89.25** |
| cap | 96.4 × 0.22 × 2.24 | 4, 1.51, 88.50 | water overhang 0.37 m, apron 0.07 m |
| wet band | 96 × 0.42 × 0.05 | 4, −0.10, 89.28 | stained concrete on face |
| water surface | 112 × 44 plane | 4, **−0.28**, 111.2 | north edge **z = 89.2** (tucks 0.05 m under face) |
| water dark | 112 × 44 plane | 4, **−0.58**, 111.2 | same XZ, 0.30 m below surface |
| tire | cyl r=0.36 h=0.16 | x every 16 m +8 | axis along +X |
| ladder | rails + box rungs | x every 16 m | cap → water |
| bollard | cyl r=0.14 h=0.42 | same x as ladder | on cap, dock side |

Wall x-span **−44…52** (centre 4), same as today’s 98 m wall. Dock
(`−40…48`) sits fully on the north half of the wall; water
(`GROUND.water` minZ=88) is swallowed by the wall volume then the two
planes.

`GROUND.water` at y=−0.4 stays in `createStudio`. Do not delete it from
this pass: the new surface sits **0.12 m above** it, the dark plane
**0.18 m below**. The seawall foot is at y=−1.15 so neither plane shows a
cut edge against land.

Fog far is 140 m. Planes run to z ≈ 133 so the bay dies in fog, not as a
hard south lip.

### Tire fenders

No `TorusGeometry` — keep to Box / Cylinder / Plane.

Short cylinder, **axis along the wall (X)**, hanging on the south face.
Along-wall camera sees a circle; from the dock you see the tread slab.
That is how a hanging tyre reads.

x = **−32, −16, 0, 16, 32, 48** (16 m grid, offset 8 m from ladders).
y = 0.22 (mid-face, above water). z = 89.38 (just proud of south face).

### Ladders every 16 m

x = **−40, −24, −8, 8, 24, 40**. Recessed 0.04 m into the south face.
Two `CylinderGeometry` rails, nine `BoxGeometry` rungs. Top rung under
the cap (y ≈ 1.26); bottom rung below the water (y = −0.82) so the
ladder reads as going into the bay.

### Cinematic landmark — look *along* the wall

Current `quay` stares south into the bay (yaw 0) and flattens the
meeting to a horizon line. The useful shot is west apron, looking east,
water on the right, cap and warehouses on the left, tires/ladders
receding.

```js
// scout.mjs LANDMARKS — add, do not replace `quay`
seawall: { x: -38.5, z: 86.6, yaw: 1.62, pitch: -0.12 },
```

- yaw 1.62 rad ≈ 93°: +X plus a hair of +Z so the south face and water
  stay in frame.
- pitch −0.12 looks down the cap / tire line.
- On-dock (`z=86.6 < 88`) so `groundHeight` stays at the apron and the
  walker can actually stand here. Eye height comes from `EYE`.
- Screenshot name: `seawall`.

Optional second pose (cap, explicit y, not walkable):

```js
seawallCap: { x: -41, y: 3.05, z: 88.5, yaw: 1.56, pitch: -0.18 },
```

## Copy-paste JS

Replace the quay wall block at the end of `addStreetFurniture` with a
call to `addQuayEdge(scene)`. Leave the hill steps and road dashes.

```js
function addQuayEdge(scene) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0x7a7670, roughness: 0.94, metalness: 0 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.88, metalness: 0 });
  const wetMat = new THREE.MeshStandardMaterial({ color: 0x4a504c, roughness: 0.78, metalness: 0 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.96, metalness: 0 });
  const rust = new THREE.MeshStandardMaterial({ color: 0x4a453c, roughness: 0.72, metalness: 0.18 });
  const waterTop = new THREE.MeshStandardMaterial({ color: 0x3d5c6e, roughness: 0.22, metalness: 0.08 });
  const waterDark = new THREE.MeshStandardMaterial({ color: 0x1a2e3c, roughness: 0.92, metalness: 0 });

  const wallX = 4;
  const wallZ = 88.35;
  const faceZ = wallZ + 1.8 * 0.5; // 89.25

  const seawall = new THREE.Mesh(new THREE.BoxGeometry(96, 2.55, 1.8), concrete);
  seawall.position.set(wallX, 0.125, wallZ);
  seawall.castShadow = true;
  seawall.receiveShadow = true;
  scene.add(seawall);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(96.4, 0.22, 2.24), capMat);
  cap.position.set(wallX, 1.51, 88.5);
  cap.castShadow = true;
  cap.receiveShadow = true;
  scene.add(cap);

  const wet = new THREE.Mesh(new THREE.BoxGeometry(96, 0.42, 0.05), wetMat);
  wet.position.set(wallX, -0.1, faceZ + 0.03);
  scene.add(wet);

  const surface = new THREE.Mesh(new THREE.PlaneGeometry(112, 44), waterTop);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(wallX, -0.28, 111.2); // north edge z=89.2, tucks under face
  surface.receiveShadow = true;
  scene.add(surface);

  const deep = new THREE.Mesh(new THREE.PlaneGeometry(112, 44), waterDark);
  deep.rotation.x = -Math.PI / 2;
  deep.position.set(wallX, -0.58, 111.2);
  scene.add(deep);

  for (let x = -32; x <= 48; x += 16) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.16, 12), rubber);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, 0.22, faceZ + 0.13);
    tire.castShadow = true;
    scene.add(tire);
  }

  for (let x = -40; x <= 40; x += 16) {
    const railH = 2.35;
    const railY = 0.18;
    for (const dx of [-0.18, 0.18]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), rust);
      rail.position.set(x + dx, railY, faceZ + 0.04);
      rail.castShadow = true;
      scene.add(rail);
    }
    for (let i = 0; i < 9; i++) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.04), rust);
      rung.position.set(x, -0.82 + i * 0.26, faceZ + 0.06);
      scene.add(rung);
    }
    const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.42, 8), concrete);
    bollard.position.set(x, 1.83, 87.72);
    bollard.castShadow = true;
    scene.add(bollard);
  }
}
```

Call site, replacing lines 93–100:

```js
  addQuayEdge(scene);
```

## Why this meeting reads

1. **Seawall foot below both water planes** — no light gap under the wall.
2. **Water tucks 0.05 m under the south face** (z = 89.2), not under the
   dock — the land never floats over a blue carpet.
3. **Two planes 0.30 m apart** — grazing view along the wall sees a slab
   of water, not a hairline.
4. **Cap overhang** — the top reads as coping, and hides the wall/plane
   T-junction from the dock.
5. **Wet band** — a darker strip at the waterline is the cheapest
   “this wall stands in the sea” cue.
6. **16 m ladder / tire rhythm** — the along-wall landmark gets
   perspective posts instead of an empty concrete strip.
7. **GROUND.water stays** — new surface covers it; no map edit required
   for this pass.

## Out of scope

- Do not move warehouses, dock patch, or `groundHeight` (z > 88 → −0.35).
- Do not add `TorusGeometry`, shaders, or vertex-coloured waves.
- Do not extend the height-field mesh (it only covers z = −36…36).
- Keep the sample canvas-only, no HUD.
