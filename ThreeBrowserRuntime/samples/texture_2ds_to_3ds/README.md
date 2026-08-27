# Texture 2Ds to 3Ds

A native ThreeBrowser Runtime sample that turns **photographed objects** —
an English oak, a weeping willow, and a steel trash can, each from an orbit
of stills — into high-voxel meshes with vertices, cylindrical UVs, an albedo
map, and bump/normal maps. The oak stands on the left; the willow on the
right; the trash can sits in front.

The stills are generated as a magenta-studio turnaround of a single English
oak. Reconstruction is project-owned JavaScript, and it is **not** a silhouette
fan or a cube mesh:

1. Chroma-key each still and pin the trunk base so every view shares a frame.
2. Classify the orbit as a **capsule**, **cylinder**, **square**, **rectangle**,
   or **custom** shape. A cylinder or capsule uses **two orthogonal stills**
   (0° and 90°) then snaps the visual hull to a round primitive — four
   silhouette cards would leave a square prism. Squares/rectangles use **4**
   sides and a box atlas. A cylinder UV is two islands: the front still wraps
   one half, the back still wraps the other. Custom silhouettes (the oak and
   willow) use **8** views and a photo-planar unwrap. Each mesh is scaled to
   real-world metres
   (oak 15×14, willow 12×12, 32-gallon can 0.75×0.54).
3. Intersect silhouettes into a visual hull, then **photo-consistent space
   carving** removes voxels whose colours disagree across the cameras that can
   see them, without deleting unique silhouette witnesses (the stub, the
   droop, the trunk).
4. Split **trunk vs canopy**. The trunk stays a solid; the canopy is hollowed
   to a thin photo-coloured shell so it does not fill into a potato.
5. Marching tetrahedra extract the surface. Each vertex takes colour from the
   **nearest-yaw still** (cake-slice), not an average of all eight. The studio
   shows that albedo unlit so the oak reads as the photographs.

Run:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\samples\texture_2ds_to_3ds\play.ps1
```

Controls:

- drag: orbit
- mouse wheel: dolly
- `P`: toggle the source stills at their capture angles
- `A`: toggle the anime texture compute pass
- `R`: reset camera

`shaders/anime_texture.comp` is a lighting-v1 GLSL compute shader in the
Ghibli-background register: painted sky and sea, four-value gouache leaf
clumps, cool gray bark, knoll grass with canopy-cast paint shadow. Source
vertex colour is a classifier only. No black ink outlines.

There is no on-screen HUD. Angle counts, per-slice IoU and mesh size print to
stdout.

## Validation

```powershell
node --test C:\ThreeBrowser\ThreeBrowserRuntime\samples\texture_2ds_to_3ds\tests\*.test.mjs
```
