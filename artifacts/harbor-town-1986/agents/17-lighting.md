# 17 — Lighting / fog / sky

Time lock: **Saturday 29 November 1986, 15:20 JST**, overcast Kanagawa
(Yokosuka stand-in 35.28°N, 139.67°E). +X east, +Z south, +Y up.
Do not edit sample source from this note — numbers are for a later `createStudio` patch.

## What sakae-north.png is doing wrong

Looking north from Sakae (yaw = π → −Z) the camera sees:

1. Photo hulls (`MeshBasicMaterial`, vertex colours, `toneMapped: false`).
2. A ~3° olive strip — the walkable height field.
3. Then a cheap flat `0x8aa0b4` void.

It is **not** mainly a fog-far problem. Fog is `near 40, far 140` and the hill
mesh ends at **z = −36** (~37 m). Linear fog has not started yet, then the
background is already 100 % fog colour, so the horizon is a hard unfogged
olive / sky cut.

Walkable hill (`PlaneGeometry(96, 72)` → X[−48, 48], Z[−36, 36]) plus
`groundHeight`:

```
z < -12:  t = clamp((-z - 12) / 34);  y = t² * 7.2
```

North edge z = −36 → t = 0.706 → **y = 3.6 m**. Camera eye is 1.62 m, so
angular height is atan((3.6 − 1.62) / 37.5) ≈ **3.0°**. Shops are 7 m.
Raising the walkable slope to its function max (7.2 m at z = −46) still only
reads as a residential bank, not a skyline.

Current sun `(-30, 40, 18)` is also the wrong *season*: azimuth is roughly
SW (OK) but elevation is **48.8°** (April noon), not a winter 15:20.

## Sun — 15:20, low west, +Z is south

Sunset at Yokosuka that date is ~16:29, solar noon ~11:29 at **33.3°**.
15:20 is **69 min before sunset**, **3 h 51 min after noon**.

| | value |
|---|---|
| Declination | −21.4° |
| Hour angle | 57.7° west |
| **Azimuth** (CW from north) | **233.4°** (53° west of south, WSW) |
| **Elevation** | **11.3°** (refraction included) |

Scene direction (unit):

```
x =  cos(el) * sin(az)     =  0.9806 * sin(233.4°) = -0.786   // west
y =  sin(el)               =  0.196
z = -cos(el) * cos(az)     =  0.9806 * 0.598       = +0.586   // south
```

Scale 90 m (outside the town, long winter shadows):

```
sun.position.set(-71, 18, 53)
```

Check: atan(18 / hypot(71, 53)) = **11.5°**. atan2(east, north) =
atan2(−71, −53) = **233.3°**.

**The current +Z = 18 is the right sign, the wrong ratio.** SW sun *must*
have +Z (south) and −X (west). `+Z = 18` with `Y = 40` is what makes 49°.
Keep +Z; drop Y; grow |X| and Z together. Do not flip Z negative — that
would put the sun in the north.

Overcast: no golden-hour key. `0xffe6c4 @ 1.35` is a clear late-day sun
and is why the phone-booth casts a comic-book shadow on PBR asphalt in
`arcade.png` while the booth itself is an unlit photo.

| | current | lock |
|---|---|---|
| `DirectionalLight` colour | `0xffe6c4` | **`0xe4ddd2`** |
| intensity | `1.35` | **`0.34`** |
| position | `(-30, 40, 18)` | **`(-71, 18, 53)`** |
| `HemisphereLight` sky / ground / I | `0xc8d4e0`, `0x5a5348`, `1.1` | **`0xc5cdd4`, `0x5c5a56`, `1.42`** |

Hemi does the overcast dome (cool steel, wet-asphalt bounce). Sun is a
pale disc through stratus — enough to read volume on PBR ground, not
enough to fight the baked stills.

`scene.add(sun.target)` and leave the target at the origin (Sakae). Shadow
frustum must grow: a 7 m shop casts 7 / tan(11.3°) ≈ **35 m** of shadow
toward the NE. `shadow.camera.far = 220`, ±80 X, −40…80 Z in light space.

## Sky / fog colours (exact)

`0x8aa0b4` (138, 160, 180) is too blue and too “default Three fog”.
Overcast 15:20 is still afternoon (sunset 16:29), so do not dusk it down.

| role | hex | rgb |
|---|---|---|
| `scene.background`, `scene.fog`, `setClearColor`, `document.body` | **`0x8894a0`** | 136, 148, 160 |
| optional sky-dome zenith | `0x6d7884` | 109, 120, 132 |
| hemi sky (illuminant, not a pixel) | `0xc5cdd4` | 197, 205, 212 |
| hemi ground | `0x5c5a56` | 92, 90, 86 |
| sun | `0xe4ddd2` | 228, 221, 210 |

Keep `renderer.toneMapping = THREE.NoToneMapping` and
`outputColorSpace = THREE.SRGBColorSpace`. ACES would shift the photo hulls.

No `Sky.js` / physical sun disc — that is clear air.

## Fog near / far

`THREE.Fog` (linear), not `FogExp2`. Warehouse must stay a readable box
from Sakae; infinity must already be fog colour.

Distances that matter:

| ray | metres |
|---|---|
| Sakae cam → shop fronts (z = −8.5) | ~10 |
| Sakae cam → walkable hill end (z = −36) | ~38 |
| Sakae cam → Warehouse 8 (z = 72) | **~72** |
| Harbor cam (z = 58) → Warehouse 8 | ~14 |
| Sakae cam → proposed north ridge (z = −120) | ~122 |
| `camera.far` today | 220 |

**`new THREE.Fog(0x8894a0, 28, 185)`**

| distance | fog factor `(d − 28) / 157` |
|---|---|
| 10 m shops | 0 |
| 38 m hill | 0.06 |
| 72 m warehouse from Sakae | **0.28** — visible, marine haze |
| 14 m warehouse from harbor | 0 |
| 122 m north ridge | 0.60 |
| ≥ 185 m | 1 — no empty infinity |

Bump **`camera.far` to 260** when the ridge goes in, so the far mesh exists
inside the clip. Fog far 185 < clip far, so anything past the ridge is
solid `0x8894a0`.

Fog alone **cannot** fix sakae-north: at 38 m the hill is only 6 % hazed.
The cut is geometry.

## Backdrop hill — yes. Blocking meshes — yes. Raise walkable hill — no.

Do **not** retune `groundHeight` / the 96 × 72 field for lighting. Spawn,
stairs, and Suzume-zaka walking stay as mapped.

Add **non-walkable** fillers, `MeshLambertMaterial`, `fog: true`, no
shadows (they are past the interesting shadow range):

1. **North ridge** — plane X[−120, 120], Z[−150, −90], peak **24–32 m**.
   From Sakae, atan((28 − 1.6) / 122) ≈ **12°**, which actually plugs the
   shop gap. Tint `0x6a7064` → `0x5a6058` (cool winter scrub, not the
   current lime-olive vertex colour).
2. **Blocking boxes on that ridge** — 5–8 unlit `BoxGeometry` house
   silhouettes (6–10 m tall, 8–14 m wide) scattered around z = −100…−130,
   colour `0x5e5c58` / `0x4a5048`. Stops the ridge reading as “another
   flat band”.
3. **South shore / breakwater** — box ~200 × 4 × 8 m at z = **148**,
   y = 1.5, colour `0x6a6864`. Harbor view then hazes into a bank, not
   into a water/sky infinity. Water patch already ends at z = 120.

Optional: inverted hemisphere radius 240, vertex gradient zenith
`0x6d7884` → horizon `0x8894a0`, `fog: false`, `depthWrite: false`. Nice
but not required if the ridge + fog colour match.

## Ground PBR vs unlit photo hulls

Shops / warehouse / booth / van / Hiro stay **`MeshBasicMaterial` +
vertex colours + `toneMapped: false`**. Correct: the stills already hold
the 15:20 overcast (cool clapboard, tungsten interiors, magenta studio
keyed out). Relighting them with `MeshStandard` would fight the photos.

Street, curbs, hill, dock, water, furniture are **`MeshStandardMaterial`**.
They *do* take hemi + sun + shadows.

**Does the mismatch look bad?** Yes, **with the current sun**.
`arcade.png`: the booth is a uniformly exposed photo; the asphalt takes a
hard directional contact shadow the booth cannot wear. `sakae-north.png`:
sidewalk is a plastic PBR slab against photo shop plinths.

With the lock values (hemi 1.42, sun 0.34, roughness ≥ 0.96) the ground
is almost a Lambert fill plus a grey whisper of shadow. That sits under
baked hulls. Keep it.

Do **not**:

- Convert hulls to `MeshStandard` / enable `vertexColors` lighting.
- Turn on `toneMapping` to “match” PBR.
- Drop `castShadow` on hulls — a *soft* contact on wet asphalt is useful.
  `receiveShadow` on `MeshBasic` is a no-op for the hull’s own shading.

Do:

- `renderer.shadowMap.type = THREE.PCFSoftShadowMap` and `sun.shadow.radius = 5`.
- Leave asphalt `0x3a3a3c` (wet drizzle). Optional cooler sidewalk
  `0xa8a496` instead of `0xb7b1a4` if the beige slab still pops.
- `metalness: 0`, `roughness: 0.96–0.98` on ground. No env map.

## Copy-paste — `createStudio` lights / fog / background

Replace the background / fog / hemi / sun block. Call `addSkyFill(scene)`
after the walkable hill. Also set `document.body` / `setClearColor` /
`camera.far` to the same hex and `260` where those live in `main()`.

```js
const SKY = 0x8894a0;

function createStudio(scene) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 28, 185);

  scene.add(new THREE.HemisphereLight(0xc5cdd4, 0x5c5a56, 1.42));

  const sun = new THREE.DirectionalLight(0xe4ddd2, 0.34);
  // 29 Nov 1986 15:20 JST, 35.28°N 139.67°E
  // azimuth 233.4° CW from north, elevation 11.3°; +X east, +Z south
  sun.position.set(-71, 18, 53);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 5;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 220;
  scene.add(sun);
  scene.add(sun.target);

  for (const spec of Object.values(GROUND)) addGroundPatch(scene, spec);
  addStreetFurniture(scene);
  // existing walkable height-field follows…
  addSkyFill(scene);
}

function addSkyFill(scene) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x6a7064, fog: true });
  const ridge = new THREE.PlaneGeometry(240, 70, 20, 6);
  ridge.rotateX(-Math.PI / 2);
  const pos = ridge.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i) - 120; // world z ≈ -155 … -85
    const h = 22 + 8 * Math.sin(x * 0.035) + 4 * Math.cos(x * 0.08);
    pos.setXYZ(i, x, Math.max(4, h * (1 - Math.abs(z + 120) / 40)), z);
  }
  ridge.computeVertexNormals();
  const hill = new THREE.Mesh(ridge, mat);
  hill.name = "north ridge";
  hill.receiveShadow = false;
  hill.castShadow = false;
  scene.add(hill);

  const houseMat = new THREE.MeshLambertMaterial({ color: 0x54524e, fog: true });
  const houses = [
    [-70, -118, 9, 7],
    [-40, -108, 11, 8],
    [-12, -126, 8, 6],
    [18, -112, 10, 8],
    [48, -122, 12, 9],
    [78, -104, 8, 7],
    [-92, -132, 7, 6],
  ];
  for (const [x, z, w, h] of houses) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6), houseMat);
    box.position.set(x, h * 0.5 + 16, z);
    box.castShadow = false;
    scene.add(box);
  }

  const shore = new THREE.Mesh(
    new THREE.BoxGeometry(220, 4, 10),
    new THREE.MeshLambertMaterial({ color: 0x6a6864, fog: true }),
  );
  shore.position.set(4, 1.4, 148);
  shore.name = "south shore";
  scene.add(shore);
}
```

Companion lines in `main()` (not inside `createStudio`):

```js
document.body.style.background = "#8894a0";
renderer.setClearColor(0x8894a0, 1);
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(55, innerWidth / Math.max(1, innerHeight), 0.12, 260);
```
