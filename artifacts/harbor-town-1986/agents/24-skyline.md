# 24 — Cheap skyline blockers (sakae-north void)

Do **not** edit sample source from this note. Paste `addSkyline` into
`ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs` in a later pass.

## Bug (sakae-north)

`artifacts/harbor-town-1986/sakae-north.png` — `minamihamaGo('sakae')` then
screenshot. Camera is `x=0, z=1.5, yaw=π` (looking **−Z / north**), pitch `0.06`.

Left = Yaoya (`x=-4, z=-8.5`). Right = Starlight Arcade (`x=8, z=-8.5`). Between
them is a ~5 m gap (`x≈-0.9…4`) that punches through to:

1. The khaki height-field (`PlaneGeometry(96, 72)` ends at **z = −36**).
2. Then empty `scene.background` **0x8aa0b4**. No far buildings. No hill skyline.

North-row reconstructed shops (fronts at `z=-8.5`, backs ≈ `z=-12…-13.5`):

| shop | x | width | gap to next |
|---|---|---|---|
| Kamimura tobacco | −25 | 6.4 | ~4.6 m to soba |
| Nishiya soba | −14 | 6.4 | ~3.7 m to yaoya |
| Yaoya | −4 | 6.2 | **~4.9 m to arcade** ← screenshot |
| Starlight Arcade | 8 | 8.0 | ~4.6 m to records |
| Minato-machi records | 20 | 6.8 | open east |

Keep-out (do not sit boxes on these):

- Stone stairs: `x=-20±3.25`, `z=-12.4…-24` (`addStreetFurniture`).
- Suzume-zaka house: `x=-28, z=-34` (`realWidth` 8.2 / `realDepth` 7.6).
- Hill path: `x=-24…-16`, `z=-36…-12`.

## Design

Cheap **untextured `MeshStandardMaterial` boxes** — not `ORBIT_SUBJECTS`, not
`reconstructOrbitAsset`, no magenta stills, no vertex colours from photos.
Same material language as ground / seawall: `roughness` 0.94–0.96, `metalness` 0.

Two depth bands, then a ridge:

1. **Near rank** `z=-22…-28` — next block of 2-storey town, fills shop gaps.
2. **Far rank** `z=-32…-40` — taller 3-storey slabs, reads as inland apartments.
3. **Ridge** `z=-36…-92` — displaced plane that hides the height-field cliff
   and dissolves into fog.

Heights **8–14 m** (shops are 6.8–7.8 m, so boxes peek over roofs and through
gaps). Footprint `x=-40…40`. Sit on `groundHeight(x,z)` so they follow Suzume-zaka.

### 10 box buildings

| # | x | z | w | d | h | colour | rank | notes |
|---|---|---|---|---|---|---|---|---|
| 1 | 1.8 | −24.0 | 7.4 | 6.6 | 9.4 | `0x6a6560` | near | **fills sakae-north gap** |
| 2 | −8.8 | −22.8 | 5.8 | 5.6 | 8.2 | `0x7a736c` | near | soba–yaoya gap |
| 3 | 14.4 | −26.0 | 6.8 | 7.0 | 10.4 | `0x5e5a54` | near | arcade–records gap |
| 4 | 28.2 | −23.2 | 8.4 | 7.4 | 8.6 | `0x736e68` | near | east of records |
| 5 | −36.0 | −24.5 | 7.4 | 6.8 | 9.6 | `0x68625c` | near | west of tobacco / stairs |
| 6 | 4.6 | −37.5 | 10.5 | 8.4 | 14.0 | `0x6c6862` | far | second rank in the void |
| 7 | −8.2 | −34.0 | 7.2 | 6.4 | 11.2 | `0x6e6862` | far | behind yaoya |
| 8 | 22.0 | −36.0 | 8.0 | 7.2 | 13.2 | `0x5a5854` | far | behind records |
| 9 | 36.0 | −34.0 | 9.0 | 8.0 | 12.4 | `0x64605c` | far | NE apartments |
| 10 | −15.5 | −40.0 | 8.2 | 7.0 | 11.8 | `0x625e58` | far | north of park, east of house |

No yaw. Boxes axis-aligned. 10 meshes, 10 unique `BoxGeometry`, shared palette
of `MeshStandardMaterial` (one per colour).

### Distant hill ridge

Height-field mesh is only 72 m in Z (world `z=-36…36`). `groundHeight` already
plateaus at **7.2 m** for `z≤-46`, but there is no geometry, so sakae-north
shows a khaki cliff then sky.

Add a second displaced plane, same recipe as `createStudio`'s hill:

- `PlaneGeometry(160, 56, 32, 12)`, `rotateX(-π/2)`.
- `mesh.position.z = -64` → world **z = −92…−36** (south edge meets the
  height-field lip; north edge sits in fog).
- Height `11 + 3.6·sin(x·0.045) + 1.8·cos(x·0.11) + 2.2·t` where
  `t = (−z−36)/56` (rises inland). Peaks ≈ 18 m.
- Vertex colours: south edge grass `(0.32, 0.38, 0.22)` like the hill; north
  edge mixed toward fog `(0.54, 0.62, 0.68)` so the horizon is not a new
  hard cut.
- `MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 })`.
- `receiveShadow = false`, `castShadow = false`, `name = "skyline ridge"`.

Optional shoulders (already in the paste): two large muted boxes at the
ridge south lip, `h≈16`, so the silhouette is a broken ridgeline not a tabletop.

## Fog interaction

Current studio (`createStudio`):

```js
scene.background = new THREE.Color(0x8aa0b4);
scene.fog = new THREE.Fog(0x8aa0b4, 40, 140);
```

Camera `far = 220`. Fog colour **equals** background, so silhouettes dissolve
instead of greying out against a different sky.

| band | z | dist from sakae (`z=1.5`) | linear fog factor `(d−40)/(140−40)` |
|---|---|---|---|
| near boxes | −22…−28 | 23–30 m | **0** (pre-fog, next street) |
| far boxes | −32…−40 | 34–42 m | 0–0.02 (just entering) |
| ridge south | −36 | 38 m | 0 |
| ridge mid | −64 | 66 m | 0.26 |
| ridge north | −92 | 94 m | 0.54 |
| fog far | — | 140 m | 1 |

`MeshStandardMaterial.fog` defaults **true** — leave it. Do not switch to
`FogExp2`. Do not retint `scene.fog.color`.

Rules:

- Muted concrete (`0x6a6560` family) so near boxes do not compete with
  reconstructed shop photos. They should read as mass, not as new hero meshes.
- Ridge vertex colours already lean toward `0x8aa0b4`, so at 50 % fog they
  are almost sky — atmospheric perspective without a shader.
- **Cast shadows** only for near rank (`z > -30`). Shadow camera is
  `left/right ±60`, `far 160`, sun at `(-30, 40, 18)`; far boxes and the ridge
  are scenery and would only smear a huge north shadow across Sakae-dori.
- Far rank `receiveShadow = true` (contact on the hill). Ridge neither.
- Optional later (not in this paste): pull `fog.near` to 28 if the far rank
  still looks too crisp. Do **not** drop `fog.far` below ~120 or the harbor
  south (`z≈80`) will milk out.

## Wire-up (later pass)

In `createStudio`, after the height-field is added:

```js
  terrain.name = "height field";
  scene.add(terrain);
  addSkyline(scene);
}
```

`groundHeight` is already imported from `./map.mjs`. `THREE` is
`import * as THREE from "three/webgpu"`. No new files, no catalog entries.

## Copy-paste: `addSkyline(scene)`

Paste next to `addStreetFurniture` in `main.mjs`.

```js
function addSkyline(scene) {
  const blocks = [
    { x: 1.8, z: -24.0, w: 7.4, d: 6.6, h: 9.4, color: 0x6a6560 },
    { x: -8.8, z: -22.8, w: 5.8, d: 5.6, h: 8.2, color: 0x7a736c },
    { x: 14.4, z: -26.0, w: 6.8, d: 7.0, h: 10.4, color: 0x5e5a54 },
    { x: 28.2, z: -23.2, w: 8.4, d: 7.4, h: 8.6, color: 0x736e68 },
    { x: -36.0, z: -24.5, w: 7.4, d: 6.8, h: 9.6, color: 0x68625c },
    { x: 4.6, z: -37.5, w: 10.5, d: 8.4, h: 14.0, color: 0x6c6862 },
    { x: -8.2, z: -34.0, w: 7.2, d: 6.4, h: 11.2, color: 0x6e6862 },
    { x: 22.0, z: -36.0, w: 8.0, d: 7.2, h: 13.2, color: 0x5a5854 },
    { x: 36.0, z: -34.0, w: 9.0, d: 8.0, h: 12.4, color: 0x64605c },
    { x: -15.5, z: -40.0, w: 8.2, d: 7.0, h: 11.8, color: 0x625e58 },
  ];
  const mats = new Map();
  for (const spec of blocks) {
    let mat = mats.get(spec.color);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.95, metalness: 0 });
      mats.set(spec.color, mat);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), mat);
    mesh.name = "skyline block";
    mesh.position.set(spec.x, groundHeight(spec.x, spec.z) + spec.h * 0.5, spec.z);
    mesh.castShadow = spec.z > -30;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  const shoulders = [
    { x: -48, z: -46, w: 22, d: 14, h: 16.5, color: 0x5c6058 },
    { x: 52, z: -48, w: 24, d: 16, h: 15.0, color: 0x585850 },
  ];
  for (const spec of shoulders) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(spec.w, spec.h, spec.d),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.96, metalness: 0 }),
    );
    mesh.name = "skyline shoulder";
    mesh.position.set(spec.x, 7.2 + spec.h * 0.35, spec.z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    scene.add(mesh);
  }

  const ridge = new THREE.PlaneGeometry(160, 56, 32, 12);
  ridge.rotateX(-Math.PI / 2);
  const pos = ridge.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) - 64;
    const t = Math.min(1, Math.max(0, (-z - 36) / 56));
    const y = 11 + Math.sin(x * 0.045) * 3.6 + Math.cos(x * 0.11) * 1.8 + t * 2.2;
    pos.setXYZ(i, x, y, z);
    const g = 1 - t * 0.55;
    colors[i * 3] = 0.32 * g + 0.54 * (1 - g);
    colors[i * 3 + 1] = 0.38 * g + 0.62 * (1 - g);
    colors[i * 3 + 2] = 0.22 * g + 0.68 * (1 - g);
  }
  ridge.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  ridge.computeVertexNormals();
  const ridgeMesh = new THREE.Mesh(
    ridge,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 }),
  );
  ridgeMesh.name = "skyline ridge";
  ridgeMesh.castShadow = false;
  ridgeMesh.receiveShadow = false;
  scene.add(ridgeMesh);
}
```

## Verify

Re-run scout: `{"id":"t4b","go":"sakae","screenshot":"sakae-north"}`.

Pass: gap between Yaoya and Arcade shows a muted concrete mass (`#1`) and a
taller slab behind it (`#6`); khaki cliff is gone; horizon is a soft ridgeline
that fades into `0x8aa0b4`. Fail: still seeing raw sky between the two shops,
or a new hard-edged cardboard cutout that reads closer than the reconstructed
facades.
