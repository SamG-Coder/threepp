# 56 — Skyline blocks off Suzume-zaka park

Minimal edit: `addSkyline` block centres in
`ThreeBrowserRuntime/samples/harbor_town_1986/src/main.mjs`. Ridge plane
unchanged. `addGapFill` / furniture / ground clutter not touched.

## Bug

Hill camera ~`(-36, -35)` saw a giant dark box. Park
`GROUND.park` is `x=-44…-12`, `z=-48…-16`. Skyline block **#5** sat at
`(-36, -24.5)` **inside the park**. Block **#10** `(-15.5, -40.0)` was
also in the park AABB.

Sakae-dori is `z > -16`. None of the ten boxes belong on the street or
in the park; they are distant town massing **behind the ridge**.

## Move

Uniform `Δz = −30` so every centre is `z ≤ -52` (north of park / on the
ridge). X, w, d, h, colour unchanged. South face of each box is
`z + d/2`; after the shift the southernmost face is **#4** at
`−53.2 + 3.7 = −49.5`, still north of park `minZ = -48`.

`castShadow = spec.z > -30` now false for all ten (distant scenery).

## Old vs new positions

| # | old x | old z | new x | new z | w | d | h | old south | new south | old overlap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 1.8 | −24.0 | 1.8 | **−54.0** | 7.4 | 6.6 | 9.4 | −20.7 | −50.7 | — |
| 2 | −8.8 | −22.8 | −8.8 | **−52.8** | 5.8 | 5.6 | 8.2 | −20.0 | −50.0 | — |
| 3 | 14.4 | −26.0 | 14.4 | **−56.0** | 6.8 | 7.0 | 10.4 | −22.5 | −52.5 | — |
| 4 | 28.2 | −23.2 | 28.2 | **−53.2** | 8.4 | 7.4 | 8.6 | −19.5 | −49.5 | — |
| 5 | −36.0 | −24.5 | −36.0 | **−54.5** | 7.4 | 6.8 | 9.6 | −21.1 | −51.1 | **park** (hill cam box) |
| 6 | 4.6 | −37.5 | 4.6 | **−67.5** | 10.5 | 8.4 | 14.0 | −33.3 | −63.3 | — |
| 7 | −8.2 | −34.0 | −8.2 | **−64.0** | 7.2 | 6.4 | 11.2 | −30.8 | −60.8 | — |
| 8 | 22.0 | −36.0 | 22.0 | **−66.0** | 8.0 | 7.2 | 13.2 | −32.4 | −62.4 | — |
| 9 | 36.0 | −34.0 | 36.0 | **−64.0** | 9.0 | 8.0 | 12.4 | −30.0 | −60.0 | — |
| 10 | −15.5 | −40.0 | −15.5 | **−70.0** | 8.2 | 7.0 | 11.8 | −36.5 | −66.5 | **park** |

Keep-out after edit:

- Park `x=-44…-12`, `z=-48…-16`: no centre `z ≤ -52`, no south face `> -49.5`.
- Sakae-dori `z > -16`: none.

## New `blocks` array (as shipped)

```js
  const blocks = [
    { x: 1.8, z: -54.0, w: 7.4, d: 6.6, h: 9.4, color: 0x6a6560 },
    { x: -8.8, z: -52.8, w: 5.8, d: 5.6, h: 8.2, color: 0x7a736c },
    { x: 14.4, z: -56.0, w: 6.8, d: 7.0, h: 10.4, color: 0x5e5a54 },
    { x: 28.2, z: -53.2, w: 8.4, d: 7.4, h: 8.6, color: 0x736e68 },
    { x: -36.0, z: -54.5, w: 7.4, d: 6.8, h: 9.6, color: 0x68625c },
    { x: 4.6, z: -67.5, w: 10.5, d: 8.4, h: 14.0, color: 0x6c6862 },
    { x: -8.2, z: -64.0, w: 7.2, d: 6.4, h: 11.2, color: 0x6e6862 },
    { x: 22.0, z: -66.0, w: 8.0, d: 7.2, h: 13.2, color: 0x5a5854 },
    { x: 36.0, z: -64.0, w: 9.0, d: 8.0, h: 12.4, color: 0x64605c },
    { x: -15.5, z: -70.0, w: 8.2, d: 7.0, h: 11.8, color: 0x625e58 },
  ];
```
