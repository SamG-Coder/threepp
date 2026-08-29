# 46 — North-row gap-fill boxes (sakae-v5 / soba-v5)

Do **not** edit sample source from this note. Paste `addGapFill` into
`ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs` in a later pass.

Cheap untextured `MeshStandardMaterial` `BoxGeometry` — not `ORBIT_SUBJECTS`,
not `reconstructOrbitAsset`. Same language as agent 24 skyline: roughness
0.95, metalness 0, colour **`0x6a6560`**. These sit **in the north-row
frontage** at `z = -8.5`, not in the far ranks.

## Bug

`sakae-v5` (`go: sakae`, camera `0, 11`, yaw `π`) — olive height-field
between Yaoya and pharmacy, then sky.

`soba-v5` (`go: soba`, camera `-17, 8`, yaw `π`) — same punch between
Kamimura tobacco and Nishiya soba: Suzume-zaka house, stone stairs, olive
hill, sky.

Agent 24’s skyline boxes (`z ≈ -22…-40`) only fill the *far* void. They
do not replace a shop on the street line. Until more unique stills exist,
anonymous 2-storey boxes plug every north-row gap **≥ 3 m**.

## Catalog envelopes (live `ORBIT_SUBJECTS`)

North row = `district === "sakae" && z === -8.5`, `yaw = 0`. Envelope
along the street is `x ± realWidth / 2`. `realWorldScale` now honours
`realDepth` on Z, so planted frontage **is** `realWidth`.

`GROUND.sidewalkN` is `minX = -40`, `maxX = 40`.

| id | x | realWidth | left | right | gap after (m) | ≥ 3 m |
|---|---:|---:|---:|---:|---:|---|
| *(sidewalk west)* | | | −40.0 | | **2.8** to hardware | no |
| `hardware-shop` | −34 | 6.4 | **−37.2** | **−30.8** | **2.2** | no |
| `tobacco-shop` | −26 | 5.2 | **−28.6** | **−23.4** | **3.2** | **yes — soba-v5** |
| `soba-shop` | −17 | 6.4 | **−20.2** | **−13.8** | **2.1** | no |
| `greengrocer` | −9 | 5.4 | **−11.7** | **−6.3** | **3.0** | **yes — sakae-v5** |
| `pharmacy` | 0 | 6.6 | **−3.3** | **3.3** | **1.1** | no |
| `you-arcade` | 8.4 | 8.0 | **4.4** | **12.4** | **2.3** | no |
| `cassette-shop` | 17.8 | 6.2 | **14.7** | **20.9** | **19.1** to +40 | **yes — east wing** |
| *(sidewalk east)* | | | | 40.0 | | |

Three slots. Internal 1.1–2.3 m alleys stay empty (one-person gap, not a
lot). West sidewalk 2.8 m stays empty.

## Design

- Sit at **`z = -8.5`** on `groundHeight(x, z)` (street is 0 here; hill
  toe is `z < -12`).
- **Depth 7 m** → south face `z = -5.0`, north face `z = -12.0` (sidewalk
  north lip). Axis-aligned, no yaw.
- **Height 7.4–8.6 m** (unique shops are 6.8–7.8 m, so boxes read as the
  same 2-storey band, slightly broken roofline).
- Colour **`0x6a6560`**, one shared `MeshStandardMaterial`.
- **0.12 m air** off every existing envelope so boxes never overlap a
  catalogued shop. Threshold is **`gap < 3 - 1e-4` skip**, so the
  catalogued 3.00 m Yaoya–pharmacy hole still fills (IEEE `5.4 / 2` can
  read as `2.999…`).
- Gaps wider than ~7.2 m split into ~6.2 m bays with a 0.22 m joint
  (party-wall crack, not another olive alley). East wing → three bays.

Keep-out (no overlap, boxes stay on the sidewalk):

- Stone stairs `x = -20 ± 3.25`, `z = -12.4…-24` — north face of the
  tobacco–soba box is `z = -12.0`, 0.4 m south of the first tread.
- Suzume-zaka house `(-28, -34)` — behind the row.
- North-curb pole instance `(-22, -6.2)` sits in the tobacco–soba slot.
  Depth 7 m swallows it in Z the same way unique shops swallow their
  own spill furniture. Leave it; do not skip the slot.

### Boxes from current catalog

| # | x | z | w | d | h | slot | notes |
|---|---:|---:|---:|---:|---:|---|---|
| 1 | −21.80 | −8.5 | 2.96 | 7 | 7.4 | tobacco −23.4 → soba −20.2 | soba-v5 hole |
| 2 | −4.80 | −8.5 | 2.76 | 7 | 8.0 | yaoya −6.3 → pharmacy −3.3 | sakae-v5 hole |
| 3 | 24.09 | −8.5 | 6.14 | 7 | 8.6 | cassette 20.9 → 40 | east bay A |
| 4 | 30.45 | −8.5 | 6.14 | 7 | 7.6 | same | east bay B |
| 5 | 36.81 | −8.5 | 6.14 | 7 | 8.2 | same | east bay C |

Envelope check (box left/right vs shop):

- #1 `-23.28…-20.32` vs tobacco right `-23.4`, soba left `-20.2`
- #2 `-6.18…-3.42` vs yaoya right `-6.3`, pharmacy left `-3.3`
- #3 left `21.02` vs cassette right `20.9`; #5 right `39.88` vs sidewalk `40`

When a unique shop is later planted into a slot, `addGapFill` rereads
`ORBIT_SUBJECTS` and the box goes away. Do not add catalog ids for these.

## Wire-up (later pass)

In `createStudio`, after skyline:

```js
  addSkyline(scene);
  addGapFill(scene);
```

`groundHeight` and `GROUND` are already imported from `./map.mjs`.
`ORBIT_SUBJECTS` is already imported from `./catalog.mjs`. `THREE` is
`import * as THREE from "three/webgpu"`. No new files, no catalog entries.

## Copy-paste: `addGapFill(scene)`

Paste next to `addSkyline` in `main.mjs`.

```js
function addGapFill(scene) {
  const z = -8.5;
  const depth = 7;
  const air = 0.12;
  const joint = 0.22;
  const targetBay = 6.2;
  const row = ORBIT_SUBJECTS
    .filter((s) => s.district === "sakae" && s.z === -8.5)
    .map((s) => ({ left: s.x - s.realWidth * 0.5, right: s.x + s.realWidth * 0.5 }))
    .sort((a, b) => a.left - b.left);
  const slots = [];
  let cursor = GROUND.sidewalkN.minX;
  for (const shop of row) {
    slots.push({ left: cursor, right: shop.left });
    cursor = shop.right;
  }
  slots.push({ left: cursor, right: GROUND.sidewalkN.maxX });
  const mat = new THREE.MeshStandardMaterial({ color: 0x6a6560, roughness: 0.95, metalness: 0 });
  let n = 0;
  for (const slot of slots) {
    const gap = slot.right - slot.left;
    if (gap < 3 - 1e-4) continue;
    const innerL = slot.left + air;
    const innerR = slot.right - air;
    const usable = innerR - innerL;
    const bayCount = usable > 7.2 ? Math.max(2, Math.round(usable / targetBay)) : 1;
    const bayW = (usable - joint * (bayCount - 1)) / bayCount;
    for (let i = 0; i < bayCount; i++) {
      const x = innerL + i * (bayW + joint) + bayW * 0.5;
      const h = 7.4 + ((n * 3) % 8) * 0.2;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bayW, h, depth), mat);
      mesh.name = "gap fill";
      mesh.position.set(x, groundHeight(x, z) + h * 0.5, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      n += 1;
    }
  }
}
```

## Verify

Re-run scout:

```json
{"id":"t46","shots":[{"go":"sakae","screenshot":"sakae-v6"},{"go":"soba","screenshot":"soba-v6"},{"go":"street-east","screenshot":"street-east-v6"}]}
```

Pass: Yaoya–pharmacy and tobacco–soba show muted concrete mass, not olive
hill or sky; east of records is a 2-storey wall to `x ≈ 40`; unique shop
photos are untouched. Fail: still seeing height-field between those
pairs, or a box clipping a reconstructed façade, or one 19 m slab east
of cassette.
