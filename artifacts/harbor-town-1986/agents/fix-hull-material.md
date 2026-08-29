# Photo hull material — unlit Basic → Standard

Edit: `ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs` only.
Reconstruction math (`reconstructOrbitAsset`, resolution, photoIterations,
shape) is unchanged. Agent 17 told us *not* to relight hulls; that left shops
as pasted-on stills against PBR ground. This patch does the opposite on
purpose: hulls take the same overcast hemi + low winter sun as the street.

## Before

`reconstructSubject` drew every orbit mesh with

```js
new THREE.MeshBasicMaterial({
  name: `${subject.label} photo isosurface`,
  vertexColors: true,
  toneMapped: false,
  side: THREE.DoubleSide,
})
```

`MeshBasicMaterial` ignores lights. Vertex colours from `projectVertexColors`
(`srgbChannelToLinear` after `punchierPhotoRgb`) showed as a flat photo
sticker. `castShadow` on `plantMesh` still punched a contact on asphalt;
`receiveShadow` was a no-op.

## After

```js
new THREE.MeshStandardMaterial({
  name: `${subject.label} photo isosurface`,
  vertexColors: true,
  roughness: 0.86,
  metalness: 0,
  toneMapped: false,
  side: THREE.FrontSide,
})
```

| knob | value | why |
|---|---|---|
| `vertexColors` | `true` | stills live in `mesh.colors`; albedo maps are still discarded |
| `roughness` | `0.86` | matte clapboard / tile / enamel; sits under hemi 1.42 + sun 0.34 without a plastic spec |
| `metalness` | `0` | dielectric street furniture, not chrome |
| `toneMapped` | `false` | matches `renderer.toneMapping = THREE.NoToneMapping`; baked RGB is not run through ACES if tone mapping is later enabled |
| `side` | `FrontSide` | closed isosurface (see below) |

`plantMesh` already had `castShadow = true` and `receiveShadow = true` on the
`THREE.Mesh` (not the Group). Left as-is. Standard now actually *receives*
the directional contact the Basic hull ignored.

## FrontSide vs DoubleSide

`extractIsosurface` is marching tetrahedra on a visual-hull SDF
(`isosurface.mjs`). `pushTriangle` orients faces toward empty space; vertex
normals are the area-weighted sum of those faces. The result is a closed
(or closed-with-genus) manifold with outward normals — shops are solid
potatoes, not open shells.

`DoubleSide` was leftover from the unlit path. It would shade the inward
backs of every triangle (wrong lighting, possible z-fight in thin branches).
Pharmacy swiss-cheese and glass booths are *holes through occupied volume*,
not open surfaces; FrontSide still shows the hole rims.

If a later carve ever emits a true open shell (boundary edges, inward
normals), flip that subject only.

## Renderer colour space (no change)

Already set in `main()`:

```js
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = true;
```

Vertex colours are stored linear (`srgbChannelToLinear` in
`projectVertexColors`). Standard multiplies them by Lambert/GGX, then the
renderer encodes sRGB. That is the correct pipeline; do not mark the colour
attribute as sRGB.

## What this does not do

- Does not retouch stills, UVs, cake-slice bake, or `punchierPhotoRgb`.
- Does not bind `asset.maps` — display colour is still vertex RGB.
- Does not raise sun intensity. Overcast lock stays hemi `0xc5cdd4/0x5c5a56 @ 1.42`, sun `0xe4ddd2 @ 0.34` at `(-71, 18, 53)`.
- Does not change `texture_2ds_to_3ds/src/main.mjs` (studio sample still uses Basic).

## Expectation

Hulls pick up a grey whisper of directional shade on west/north faces and
receive the same contact as crates and curbs. They will no longer read as a
different exposure from the PBR street. Facades that already bake 15:20
overcast will go slightly darker on the lit side (hemi × albedo) — that is
the trade for sitting in the same light as the ground.
