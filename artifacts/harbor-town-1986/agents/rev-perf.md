# Perf review — Minamihama mesh budget, pooling, agents, shadows

Read-only. Do **not** edit sample source from this note.

Time lock: Saturday 29 November 1986, 15:20. Sources: live
`samples/harbor_town_1986/src/catalog.mjs` (`ORBIT_SUBJECTS` +
`INSTANCES`), `main.mjs` (`plantMesh`, `reconstructSubject`,
`createStudio`, `addGroundClutter`, `addGapFill`, `addSkyline`,
`addOverheadWires`, `addStreetFurniture`), `fill-world.mjs`,
`fill-quay.mjs`, `fill-park.mjs`, `fill-route16.mjs`, `roads.mjs`,
`map.mjs` `GROUND`. `fill-street.mjs` / `fill-south.mjs` /
`fill-yokobori.mjs` exist but are **not imported** — excluded from the
live count.

---

## 1. What is actually in the scene

Reconstruction: **27 unique visual hulls** (the ~28 billed). All go
through `reconstructOrbitAsset`. Resolution is **48³ / silhouette 96**
except `phone-booth`, any `kind === "cylinder"`, or `realHeight < 2.2`
→ **32³ / 64**. `photoIterations` is 0 on rectangle/square, 4 on
custom/humanoid. Forced catalog `shape` is already wired.

| voxel | n | ids |
|---|---:|---|
| **48³** | **18** | ten Sakae shop boxes + `yokobori-bar` + `harbor-warehouse-8` + `harbor-warehouse-3` + `wooden-hill-house` + `english-oak` + `weeping-willow` + `zelkova` + `city-bus` |
| **32³** | **9** | `vending-enamel`, `phone-booth`, `telephone-pole`, `civilian-hiro`, `kei-van` (1.78 m), `steel-bin`, `honda-cub`, `oil-drum`, `crate-stack` |

`ORBIT_SUBJECTS.length = 27`. `INSTANCES.length = 132`.
`plantMesh` does `new THREE.Mesh(proto.geometry, proto.material)` per
pose — **geometry is shared, draws are not**. There is no
`InstancedMesh`. Every hull `castShadow = true`, `DoubleSide`
`MeshBasicMaterial` (vertex colours). Those hulls **do not receive**
the directional shadow; they only pay to rasterize it.

### 1.1 Catalog plants (159 meshes, 27 geos)

| asset | unique | clones | planted | instance? |
|---|---:|---:|---:|---|
| `telephone-pole` | 1 | 19 | **20** | yes |
| `civilian-hiro` | 1 | 21 | **22** | yes — see §3 |
| `zelkova` | 1 | 16 | **17** | **no** (§2) |
| `vending-enamel` | 1 | 11 | **12** | yes |
| `english-oak` | 1 | 11 | **12** | yes |
| `steel-bin` | 1 | 11 | **12** | yes |
| `crate-stack` | 1 | 8 | **9** | yes |
| `oil-drum` | 1 | 7 | **8** | yes |
| `wooden-hill-house` | 1 | 6 | **7** | yes (geo only; visually over-cloned) |
| `kei-van` | 1 | 5 | **6** | yes |
| `honda-cub` | 1 | 5 | **6** | **no** (§2) |
| `harbor-warehouse-8` | 1 | 4 | **5** | yes |
| `weeping-willow` | 1 | 4 | **5** | yes |
| `phone-booth` | 1 | 2 | **3** | maybe (n=3) |
| `harbor-warehouse-3` | 1 | 1 | **2** | skip (`InstancedMesh` of 2) |
| `city-bus` | 1 | 1 | **2** | skip |
| 11 named shop façades | 1 each | 0 | **11** | **never** |

Named façades (`soba-shop`, `you-arcade`, `flower-shop`,
`cassette-shop`, `greengrocer`, `tobacco-shop`, `pharmacy`,
`barber-shop`, `hardware-shop`, `kissaten`, `yokobori-bar`) stay unique.
Do not GPU-instance them even if a later density pass clones a
generic box.

### 1.2 Fill loops (live)

Cheap untextured `MeshStandardMaterial` primitives. Geos are often
shared; **each `new THREE.Mesh` is still a draw**, and almost every
mesh `castShadow = true`.

| loop | where | meshes (approx) | note |
|---|---|---:|---|
| Ground patches | `GROUND` × 11 | 11 | receive only |
| Height field | `PlaneGeometry(120, 200, 60, 80)` | 1 | ~9.6k quads |
| Stairs | 12 boxes | 12 | |
| Centreline dashes | `x = −38…38` step 4.4 | 18 | should not cast |
| Quay edge | seawall + cap + wet + 2 water + 6 tires + 6 ladders×(2 rails+9 rungs+bollard) | **83** | rungs are 54 extra draws |
| Ground clutter crates/drums | produce 7 + yokobori 5 + 4 dock piles×5 + 4 warehouse×4 drums | **48** | |
| Overhead wires | 7 N + 7 S poles, 3 segs/span | **36** | 5-seg cylinders, still casters |
| Skyline | 10 boxes + ridge | 11 | boxes `castShadow` only if `z > −30` → **none cast** |
| Gap façades | 11 blocks × (body + 4 windows) | **55** | the live “shop wall” |
| World fill lamps | 8×2 × (pole+arm+globe) | **48** | would stack with `fill-street` if wired |
| World benches + 3 hedges | 8×4 + 3 | 35 | overlaps park fill |
| World boats | 6×4 | 24 | overlaps quay fill boats |
| South / yokobori / R16 massing | 10 + 5+2 crates + 2+4 shelter | 23 | |
| World planters | 8×2 | 16 | |
| World street trees | 7×2 × (trunk+crown) | **28** | **do not keep** once zelkova hull is real |
| Quay fill | 7 boats (~39) + 5 pallets×3 + 4 nets×2 + 4 coils + 4 drums + 4 shacks×4 | **86** | |
| Park fill | 12 benches×4 + 4 lanterns×4 + **52** hedge segs + 12 path + 2 sandbox | **130** | |
| Route 16 fill | shelter 6 + ~35 paint + 6 massing + 6 drums + **~51 fence** | **104** | paint already `castShadow = false` |
| Roads | 2 curbs + 2 edges + 16 zebra + 6 manholes + cobble + 8 bollards | **35** | zebra/manholes should not cast |
| **Fill / geo subtotal** | | **~804** | |
| **Orbit plants** | 27 + 132 | **159** | |
| **Live Mesh count** | | **~963** | |

Dead modules (not in the 963): `fill-street` would add 16 lamps × 5
parts = 80, plus 8 planters×2, 3 newsstands×2, 3 boards×3, 2 bike
racks×7 ≈ **+125** if parent wires it on top of world lamps. Do not.

Triangle heat is **not** the 804 boxes (~12 tris). It is the 159 hull
draws, `DoubleSide`, then the same 159 in the shadow pass. Ballpark
planted hull tris (48³ box/custom isosurface often 8–40k; agent 13’s
old 15 uniques were ~687k before clones): **~1.5–2.0 M** colour +
**the same again** in the 2048² depth pass. Fill is noise (~10 k).

---

## 2. Pooling advice

`plantMesh` already shares `BufferGeometry` + material. That is **not**
instancing. Three/WebGPU still emits one draw per `Mesh`. ~960 draws
plus a full shadow pass is the frame.

### Do

1. **One `InstancedMesh` per kit asset** with `n ≥ 4` and a real hull
   (`telephone-pole` 20, `vending-enamel` 12, `steel-bin` 12,
   `english-oak` 12, `crate-stack` 9, `oil-drum` 8, `wooden-hill-house` 7,
   `kei-van` 6, `harbor-warehouse-8` 5, `weeping-willow` 5). Unique pose
   is instance `[0]`; drop the separate `ORBIT_SUBJECTS` mesh.
2. **Merge fill by material**, not by object. Target:
   - 1 mesh: Sakae lamps (world fill 48 parts → one, or InstancedMesh
     of 16 poles + 16 arms + 16 globes).
   - 1 mesh: crate boxes (produce + yokobori + dock + fill-world).
   - 1–2 meshes: gap + south + yokobori + route16 **façade boxes**
     (same roughness 0.95 concrete palette). Windows as a second merge.
   - 1 mesh: park hedges; 1 mesh: park benches; 1 mesh: R16 fence.
   - `BufferGeometryUtils.mergeGeometries` after bake of world matrix.
     `StaticDrawUsage`. One `MeshStandardMaterial` per merge (stop
     `plantBlock` allocating a **new material per box**).
3. **Shadow caster set ≠ scene graph.** `castShadow = false` on
   dashes, zebra, manholes, wires, gravel path, planter dirt, crate
   tops under 0.6 m, park path, lot paint (already off). Keep casters
   on: hulls that read, 2-storey fill boxes, seawall, boats, poles.
4. **Kill the duplicate tree/lamp lanes.** World-fill spheres at
   `z = ±7.15` plus 17 catalog zelkovas plus (if wired) street-fill
   lamps is three systems for one curb. Pick catalog zelkova **after**
   the hull is real; merge the primitive lamps; delete the spheres.
5. After the world is static, `sun.shadow.autoUpdate = false` and
   `needsUpdate = true` once. Re-enable only while agents move.

### Do not GPU-instance these hulls

| id | logged tris | why |
|---|---:|---|
| **`zelkova`** | **24** | Failed custom carve (`59-hull-vs-still`: over-carve / filled envelope, `photoIterations: 4`). 24 tris is a shard, not a tree. `InstancedMesh` setup + 17 **6×6×7.5 m shadow AABBs** costs more than 17 tiny draws, and multiplies a smear. Leave the unique for QA; **do not instance** (GPU or catalog) until the isosurface is a real crown (thousands of tris, `photoIterations: 0`). If you must show a row now, merge the **primitive** trunk/crown geos from `addStreetTrees`, not this hull. |
| **`honda-cub`** | **72** | 32³ rectangle, wheel-only / hover (`59`). 72 tris × 6 is 432 tris — cheaper as six `Mesh` or one merged static than an instance buffer. Same as zelkova: **do not multiply a broken hull**. Reshoot 270, then `kind: custom` at 48³; *then* instance sidewalk cubs. |

Also skip `InstancedMesh` for `n ≤ 2` (`city-bus`, `harbor-warehouse-3`).
Named shop façades: never. Hiro: see §3 — not a kit part.

---

## 3. Max moving agents

Live: **22** `civilian-hiro` (1 unique + 21 clones), all **static**.
No nav tick, no mixamo. Graph in `23-nav-graph` is 14 nodes, enough
for a sidewalk loop. Agent 49 already forbade a Hiro clone army for
read; perf agrees.

| cap | meaning |
|---|---|
| **8 walking** | Hard max on the 32³ humanoid. One `InstancedMesh`, instance matrices updated on the CPU from the 14-node graph. Only these 8 `castShadow`. |
| **4 in any one frustum** | Sakae 80 m street; four identical blazers in `street-east` is already a stamp. Prefer 2 on Sakae, 2 dock / park / R16. |
| **0 extra static clones** | Freeze or delete the other 14. Do not animate all 22. |
| **12 only if** | Agent shadows off, and a **second unique** humanoid exists so it is not 12× Hiro. |

Cost of 8 movers vs 22 static: the colour pass is cheap (humanoid was
~9.5 k tris at 48³ in agent 13; now 32³ so less). The bill is
**shadow-map re-raster every frame** of DoubleSide hulls plus matrix
uploads. `autoUpdate = true` for 22 walkers on a 2048² map that also
contains ~1.5 M static hull tris is the hitch. Cap **8**, shadow
**4**, rest idle without `castShadow`.

Do not skin or morph these hulls. Visual-hull Hiro is a rigid A-stance;
sliding the instance along the graph is the whole motion model.

---

## 4. Shadow-map cost

Live `createStudio`:

```
sun.castShadow = true
sun.shadow.mapSize  2048 × 2048
sun.shadow.camera   left −80, right 80, top 80, bottom −40, far 220
sun.position        (−71, 18, 53)   // ~11.5° elevation, 233° az
sun.intensity       0.34            // overcast
renderer.shadowMap.enabled = true
```

| term | live | cost |
|---|---|---|
| Texels | 4.19 M | ~16 MB D32F (or 8 MB D16). One extra full-scene raster per frame. |
| Ground texel | 160 m / 2048 ≈ **7.8 cm** | Fine for a 1.72 m person; wasted on overcast 0.34 sun. |
| Vertical | 120 m / 2048 ≈ 5.9 cm | `bottom −40` / `top 80` covers the 8 m hill + 14 m skyline. |
| Elongation | 1/tan(11.5°) ≈ **4.9×** | Acne / peter-pan on every curb crate. Bias will fight 7.8 cm texels. |
| Casters | ~900 of ~963 meshes | Hulls (MeshBasic, DoubleSide) **pay and do not receive**. Fill PBR is the only surface that shows the map. |
| Skyline | `castShadow` iff `z > −30` | Far blocks correctly skip. Ridge already off. |
| CSM / extra lights | none | Keep it that way. |

**Estimate:** colour ~1.5–2.0 M hull tris + ~10 k fill. Shadow pass
repeats almost all of that at 2048². DoubleSide can double hull
fragments. Fog far is 185 m; the shadow frustum already covers the
whole town, so there is no “off-screen” save.

### Cut (in order, no source edit here)

1. **1024²** (4× less fill rate). Overcast 0.34 does not need 8 cm
   texels. Optional 512² if agents stay unshadowed.
2. **Follow the walker:** `shadow.camera` ±36 m XZ, `far` 80, around
   `walk`. Texel ~7 cm at 1024, without paying for z = 120 water.
3. **`autoUpdate = false`** until a mover exists; then only the
   instance matrix of the 8 agents is dynamic — still a full recast
   unless casters are split. Cheapest split: static town baked once
   into the map is **not** available in stock WebGL/WebGPU three
   without a custom static atlas. Practical: shrink frustum + fewer
   casters.
4. **Caster allow-list:** orbit hulls with tris ≥ 500 and height ≥ 1.5 m,
   2-storey fill boxes, seawall, poles, boats. Off: zelkova (24 tris,
   huge AABB), cub (72), bins, drums, crates, wires, dashes, windows.
5. Do not add a second shadow-casting light. Hemi is already the
   overcast key.

2048² whole-town on this density is the first thing that will miss
60 fps on the WebGPU path once 27 hulls finish reconstructing. Pooling
without touching the shadow camera will not be enough.

---

## 5. One-page budget

| bucket | now | target |
|---|---|---|
| Unique 48³/32³ hulls | 27 (~28 as billed; 18 at 48³, 9 at 32³) | 27 (no extra uniques for kit) |
| Catalog draws | 159 | **~16 InstancedMesh** + 11 shop `Mesh` + 2 leftovers (bus, W3) ≈ **29** |
| Fill draws | ~804 | **~15 merged** (lamps, crates, façades, hedges, fence, boats, benches, quay kit) |
| Total draws | ~963 + shadow | **~50** colour + shadow allow-list |
| GPU-instance zelkova / cub | 17 + 6 | **0** until hulls are real (24 / 72 tris) |
| Moving agents | 0 (22 statues) | **≤ 8** walk, **≤ 4** shadow |
| Shadow map | 2048², 160×120×220 | **1024²**, camera-follow ~70 m, `autoUpdate` off when idle |

Parent: catalog clones of poles / vending / oak / warehouse / crates
are the right `InstancedMesh` set. Fill loops (lamps, crates, gap
façades) want **merge**, not instances of 12-tri boxes. Zelkova and
Cub stay unique (or unplanted) until the isosurface has a body.
