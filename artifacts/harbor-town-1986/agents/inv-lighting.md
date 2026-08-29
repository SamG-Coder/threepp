# inv-lighting — fog, sun 0.34, Basic hulls vs Standard geo

Read-only. Owner of `main.mjs` materials is another agent — numbers only.
Live values from `ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs`
(`createStudio`, `reconstructSubject`, `addQuayEdge`, `main`). Stills:
`sakae-v9.png`, `seawall-v9.png`, `quay-v9.png`, `harbor-warehouses.png`,
`sakae-north.png`. Agent 17’s lock is **already pasted** for lights/fog/colour;
the mismatch it was meant to hide is still on screen.

Time lock stays **29 Nov 1986, 15:20 JST**. Do not flip the sun vector.

---

## Live state (what the file actually does)

| knob | live |
|---|---|
| `scene.background` / `setClearColor` / `body` | `0x8894a0` |
| `scene.fog` | `THREE.Fog(0x8894a0, 28, 185)` linear |
| `HemisphereLight` | `0xc5cdd4`, `0x5c5a56`, **1.42** |
| `DirectionalLight` | `0xe4ddd2`, **0.34**, pos `(-71, 18, 53)` |
| `sun.castShadow` | true, map 2048, frustum ±80 X, −40…80 Y, far 220 |
| `sun.shadow.bias` / `radius` / `normalBias` | **unset** |
| `renderer.shadowMap.enabled` | true |
| `renderer.shadowMap.type` | **unset** (WebGPU default PCF, not soft) |
| `toneMapping` | `NoToneMapping` |
| `outputColorSpace` | `SRGBColorSpace` |
| `camera` | 55° fov, near 0.12, **far 220** |
| photo hulls (`reconstructSubject`) | `MeshBasicMaterial({ vertexColors, toneMapped: false, DoubleSide })` |
| everything else (fill, quay, ground, water, skyline, gap boxes) | `MeshStandardMaterial` |

Hull vertex colours are **linear** (`srgbChannelToLinear(punchierPhotoRgb(...))`,
sat 1.28, lift 1.08). `MeshBasic` draws them unlit. Geo facades take hemi+sun.

---

## 1. Is fog hiding defects?

**No, not the ones that matter.** Linear fog factor is `(d − 28) / 157`.

| ray | d (m) | fog | what you actually see |
|---|---:|---:|---|
| Sakae (`z=11`) → shop fronts (`z=−8.5`) | ~19.5 | **0** | pharmacy holes, cake-slice smear, gap-fill cardboard (`sakae-v9`) |
| Sakae → walkable hill lip (`z≈−36`) | ~47 | 0.12 | olive / sky cut in old `sakae-north` is geometry, not haze |
| Sakae → skyline boxes (`z≈−54`) | ~65 | 0.24 | dark Standard slabs, still a wall |
| Sakae → Warehouse 8 (`z=72`) | ~61 | 0.21 | hull readable, melt not hidden |
| Harbor (`z=48`) → warehouse | ~14–24 | **0** | `seawall-v9` / `harbor-warehouses.png` — voxel paint in your face |
| Quay (`z=87`) → water far lip (`z≈133`) | ~46 | 0.11 | hard navy / sky cut (`quay-v9`) |
| anything ≥ 185 | — | 1 | solid `0x8894a0` |

`camera.far = 220` is only 35 m past fog-far. That is fine. Fog-near **28 m**
is *behind* the entire north-row frontage and the seawall walk. Hull defects,
gap-fill vs photo, and NPC blobs live in the **unfogged** band.

Tightening fog (e.g. near 8 / far 90) would smear warehouses from Sakae and
turn Amihama into a wall of `0x8894a0`. Agent 17 already forbade that.
Fog is marine haze, not a defect filter.

Water vs sky is the other fog miss: `waterTop` is `0x3d5c6e` and the plane
only runs to **z ≈ 133** (112 × 44 at `z=111.2`). It never reaches fog-far,
and its colour is far from fog colour, so the horizon is a **pigment cut**,
not a dissolve. `GROUND.water` (`0x2a4458`, y=−0.4, z=88…120) still sits
under the two `addQuayEdge` planes.

---

## 2. Is sun 0.34 too dim *with Basic*?

**Sun 0.34 does nothing to Basic hulls.** They ignore lights, shadows, and
N·L. Intensity cannot be “too dim for Basic.” It is **too dim for Standard
geo sitting next to those hulls.**

Energy on a **south-facing vertical** (Sakae shop / gap-fill, N ≈ +Z).
Light vector `normalize(-71, 18, 53)` = `(−0.786, 0.199, 0.586)`, N·L ≈ **0.59**.
Hemi on a wall is 50/50 sky/ground.

| term | linear irradiance (approx) |
|---|---|
| hemi 1.42 × mix(`0xc5cdd4`,`0x5c5a56`) | ~0.47 |
| sun 0.34 × N·L 0.59 × `0xe4ddd2` | ~0.15 |
| **wall total** | **~0.62** |

Gap-fill / skyline albedo `0x6a6560` → linear ~**0.14**. Lambert out ≈
`0.14 × 0.62 ≈ 0.09` linear → display **~sRGB 0.33** (RGB ~84). That is the
charcoal cardboard behind the pharmacy in `sakae-v9` and the “near-black
box vs photo plaster” in agent 42.

Photo hulls display the still (pharmacy mint ~sRGB 0.65–0.75) at **full
punch**. Same street, two exposures. Asphalt `0x3a3a3c` is even darker
(linear ~0.04 × 0.62). Poles, seawall, dock, Standard boats: same cave.

Raising **only** the sun (0.34 → 2.8 like `texture_2ds_to_3ds` studio)
would: (a) still not shade Basic hulls, (b) stamp hard winter contact
shadows on PBR ground the booth/shops cannot wear (the `arcade.png` bug
agent 17 killed on purpose), (c) clip under `NoToneMapping`.

So: **0.34 is the right *ratio* for overcast key vs fill, the wrong
*scale* for untonemapped Standard next to unlit photos.**

---

## 3. What to change so hulls sit in the same lighting as geo facades

Two worlds today:

1. **Hulls** — `MeshBasic` + linear vertex colours + `toneMapped: false`.
   Pre-lit 15:20 stills. `castShadow=true` (blob on the street).
   `receiveShadow` is a no-op on Basic.
2. **Geo facades** — `MeshStandard` hex albedo, roughness 0.95, metalness 0.
   Take hemi+sun+shadows. Hex was picked as a *display* colour, then PBR
   treated it as 14 % reflectance.

They will never match while that split stays and wall irradiance stays 0.62.

### Preferred: hulls join geo (material owner)

Swap the reconstruct material to Lambert/Standard so vertex colours are
**albedo**, then set lights so a vertical wall’s irradiance is **~1.0**
(vertex colour ≈ pixels, plus a whisper of N·L / contact shadow).

```js
const material = new THREE.MeshLambertMaterial({
  name: `${subject.label} photo isosurface`,
  vertexColors: true,
  toneMapped: false,
  side: THREE.DoubleSide,
});
// headroom for N·L so fronts do not clip:
// material.color.setRGB(0.82, 0.82, 0.82);
```

`MeshLambert` not `MeshStandard` — no env, no spec on clapboard, cheaper,
same overcast read. Keep `NoToneMapping`. Do **not** enable ACES: Basic
`toneMapped: false` would then refuse the curve that Standard takes.

If the hull stays Basic, the only way to “sit in” geo light is to **dim
the hull** (`material.color.setScalar(0.55–0.65)`) *and* lift geo (below).
That is a second-best: stills go muddy, still no self-shadow on the shop.

Do not keep Basic hulls and crank sun to “match” — the shops will not
move and the street will.

### Geo albedo (fill / skyline / gap-fill)

`0x6a6560` / `0x5c5852` are too dark as PBR albedo. Lift the *same*
meshes to **display-like** plaster:

| role | now | proposed |
|---|---|---|
| gap-fill A | `0x6a6560` | **`0x8e8982`** |
| gap-fill B | `0x5c5852` | **`0x7e7972`** |
| skyline mean | `0x6a6560` | **`0x86817a`** |
| glass panes | `0x2a3238` r=0.35 | keep, or r=**0.45** |

(Fill modules use the same 0x6a6560 language — same lift if they stay
Standard.)

### Lights (unified, still overcast, sun vector unchanged)

Wall irradiance target ~1.0 with N·L 0.59:

```
hemi 1.85 × 0.35  ≈ 0.65
sun  0.72 × 0.59 × 0.72 ≈ 0.31
                      ≈ 0.96
```

| | live | **lock** |
|---|---|---|
| hemi sky | `0xc5cdd4` | **`0xd0d6dc`** |
| hemi ground | `0x5c5a56` | **`0x6a6660`** |
| hemi I | 1.42 | **1.85** |
| sun colour | `0xe4ddd2` | **`0xe8e2d8`** |
| sun I | **0.34** | **0.72** |
| sun pos | `(-71, 18, 53)` | keep |
| fog | `0x8894a0`, 28, 185 | **`0x8894a0`, 22, 170** |
| `camera.far` | 220 | **260** |
| `toneMapping` | None | keep None |

Fog-near 22 still leaves shop fronts at ~19 m unfogged (defects stay
visible — fix hulls, don’t haze them). Far 170 pulls skyline/ridge into
~0.55 haze from Sakae without eating Warehouse 8 (~0.25).

If hulls **stay** Basic this pass, use the same table but sun **0.55**
(not 0.72) and hemi **2.05**, plus the albedo lift — geo comes up to the
photos instead of photos coming down. Do not go past sun 0.9 or hemi 2.2
with Basic hulls; shadows on asphalt will outrun the stills.

### Shadows (missing from the 17 paste)

```js
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sun.shadow.radius = 4;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.035;
sun.shadow.camera.near = 10; // live unset
```

Keep hull `castShadow = true`. Soft, pale contacts under 0.72 key.
Hard PCF + 0.34 key is why the dock in `seawall-v9` looks shadowless
and the booth used to stamp a comic-book blob.

---

## 4. `addQuayEdge` water

```227:259:C:\ThreeBrowser\ThreeBrowserRuntime\samples\harbor_town_1986\src\main.mjs
waterTop  MeshStandard  0x3d5c6e  roughness 0.22  metalness 0.08  y = -0.28  receiveShadow
waterDark MeshStandard  0x1a2e3c  roughness 0.92  metalness 0      y = -0.58
+ GROUND.water          0x2a4458  y = -0.4, z 88…120
```

No env map, `NoToneMapping`, sun 0.34 → roughness 0.22 does **not** read
as water. It reads as a dark matte slab (`quay-v9`). Spec from a 0.34
disc is a spark, not a bay.

Proposed water (Standard, still no env):

| mesh | color | roughness | metalness | y |
|---|---|---|---|---|
| `waterTop` | **`0x5a7382`** | **0.48** | **0.02** | −0.28 |
| `waterDark` | **`0x2a3e4c`** | 0.92 | 0 | −0.58 |
| `GROUND.water` | **`0x4a6574`** | 0.95 | 0 | −0.40 |

`0x5a7382` is halfway to fog `0x8894a0`, so the far lip hazes instead of
cutting. Optional: grow the plane depth 44 → **72** (centre z **125**,
south lip **z ≈ 161**) so the sheet dies *in* fog-far 170.

Leave seawall / cap / wet / rubber / rust as Standard; after the light
lift they will sit with the dock instead of going black. Wet band
`0x4a504c` can stay.

`fill-world.mjs` still plants six Standard box-boats (`addQuayBoats`) and
`fill-quay.mjs` plants seven more. Lighting will not hide that double
fleet; another agent.

---

## 5. Copy-paste numbers (createStudio + renderer only)

```js
const SKY = 0x8894a0;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 22, 170);

scene.add(new THREE.HemisphereLight(0xd0d6dc, 0x6a6660, 1.85));

const sun = new THREE.DirectionalLight(0xe8e2d8, 0.72);
sun.position.set(-71, 18, 53); // 15:20, el 11.3°, az 233° — do not touch
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 4;
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.035;
sun.shadow.camera.left = -80;
sun.shadow.camera.right = 80;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 220;
scene.add(sun);
scene.add(sun.target);

// main():
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(SKY, 1);
// PerspectiveCamera far 260
```

Hull material (other agent):

```js
new THREE.MeshLambertMaterial({
  vertexColors: true,
  toneMapped: false,
  side: THREE.DoubleSide,
  color: 0xd1d1d1, // 0.82 scalar headroom
});
```

---

## Verdict

| question | answer |
|---|---|
| Fog hiding defects? | **No** inside 28 m (all shop/seawall stills). Slight haze only past ~60 m. Water/sky cut is colour, not fog. |
| Sun 0.34 too dim with Basic? | **0.34 never reaches Basic.** It leaves Standard geo at ~0.09 linear vs photo ~0.4. Too dim for the *pair*. |
| How hulls join geo lighting | Hulls → **Lambert + vertexColors** (not Basic). Hemi **1.85**, sun **0.72**, same vector. Lift fill albedo to `0x8e8982`. Soft shadows. Water roughness **0.48**, colour **`0x5a7382`**. Keep `NoToneMapping`. |

Do not: FogExp2, ACES, Sky.js, sun Y=40, sun I≥2, convert stills to Standard-with-roughness-0.4, or pull fog-near below ~18.
