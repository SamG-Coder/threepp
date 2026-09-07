# Virtual Geometry

The native runtime menu has an opt-in **Virtual Geometry (experimental)** toggle
next to its FPS/diagnostic controls. The current implementation is the first,
full-detail stage: native GPU cluster frustum culling and indirect submission.
It is not yet the complete set of modes explored in ThreeNaniteTest.

## Implemented

- Prefer an OpenGL 4.3 context for the native runtime, retrying the previous 3.3
  context if creation fails. Other Canvas clients retain their previous default.
- Load compute, memory-barrier and multi-draw-indirect entry points only on a
  capable context. Unsupported backends show the mode as unavailable.
- Build bounds for contiguous 64-triangle ranges without rewriting source
  indices, positions, normals, UVs, materials or application code.
- Evaluate cluster visibility against the current pass camera and object matrix.
  Shadow, reflection and offscreen render calls use their own transforms.
- Cull ordinary InstancedMesh clusters using the existing GPU instance-matrix
  buffer, retaining per-instance attributes through base-instance addressing.
- Keep indirect commands in source primitive/instance order. Invisible commands
  have zero counts. This intentionally avoids unordered atomic compaction and
  preserves equal-depth ordering.
- Cache geometry metadata by structural, position and index versions. Rebuild
  after relevant changes; unsubscribe and release on geometry disposal.
- Reuse selection commands only when the geometry generation, projection/world
  matrix, draw range, instance count, instance buffer/version and instance owner
  match. This is frustum selection reuse, not stale occlusion reuse.
- Use bounded LRU metadata residency (32 MiB) and a bounded shared instance
  command buffer (up to 5 MiB). Source geometry remains resident and unchanged.
- Restore compute/program/storage/indirect state and use barriers between shader
  writes and draw consumption. Preserve MSAA and the existing shading path.
- Turn off the mode to release its buffers and return to ordinary submission.

The current cost guard admits at least 4,096 source triangles across instances.
Geometry with over 3,000,000 indices or over 262,144 cluster-instance commands
uses ordinary rendering. Fully in-frustum non-instanced geometry also retains
its single ordinary draw. First-use bounds construction is synchronous and
bounded by the index limit; background cooking remains future work.

## Compatibility and fallback

Custom ShaderMaterial/RawShaderMaterial, unproven vertex overrides, skinning, displacement,
enabled morph targets, tet skinning, transparent materials, stencil writes,
non-depth-writing materials, wireframe, generic InstancedBufferGeometry,
dynamic position/index buffers, non-indexed geometry and frustumCulled=false
objects retain ordinary submission. Built-in alpha testing and alpha-to-coverage
remain in their original material shaders. Custom wind shaders are not replaced
or approximated.

Fragment-only overrides are supported. A conservative cached check also accepts
additive varying calculations: all stock lines must remain, additions may only
declare fresh symbols and assign those symbols using arithmetic/constructors.
Stock identifiers (including included chunks) cannot be overwritten or shadowed.
Other function calls, control flow, macro definitions and position writes fall
back. Only the built-in empty material defines are accepted. Proofs invalidate
with the material/shader revision; application shaders are never rewritten.

Source materials are checked even when a pass uses a depth/override material.
Application callbacks and draw groups remain in the original renderer flow.
The original vertex attributes are used by the hardware vertex shader; this
does not introduce vertex pulling or replace application material evaluation.

## Verification

Build:

```powershell
cmake --build ThreeBrowserRuntime/build --target three_browser_runtime_stage three_virtual_geometry_smoke -j 4
```

From ThreeBrowserRuntime:

```powershell
$env:THREEBROWSER_RUN_GPU_TESTS = '1'
npm test
```

`three_virtual_geometry_smoke.exe` tests warm-cache pixel parity, perspective
clipping, nonuniform/negative transforms, material groups, draw ranges, camera
changes, MSAA, shadows, edited/replaced index data, position-version changes,
disposal, instance matrices/colors, moving instances and changed instance counts.
It asserts that indirect draws actually executed, unchanged selections were
reused, and reference frames were not blank. The menu test exercises capability
changes and clicks at three window sizes.
It also checks fragment overrides, read-only varying additions, rejected vertex
writes, and removing an override while cached programs remain alive. The menu
test verifies a constant-height switch thumb, including the compact mode row.

An optional output PNG path can be passed to the native smoke executable.
Its timed clipped-plane workload is a controlled renderer microbenchmark, not
an application FPS benchmark. On the tested RTX 5080 the measured work is only
about 0.05–0.06 GPU ms/frame; do not extrapolate it to the island application.

For native runtime startup automation, `THREEBROWSER_VIRTUAL_GEOMETRY=1` enables
the same setting after context capability detection. The menu remains live.
GLRenderer::virtualGeometryStats exposes submissions, cluster-command counts,
builds, fallbacks, cached bytes, compute dispatches and reused selections.
Cluster/triangle submission counts are upper bounds, not surviving GPU counts;
there is no synchronous visibility readback in the render loop.
The menu shows cumulative cluster/ordinary submissions and cache residency,
refreshed at most once per second while open. A zero cluster count means this
mode is not accelerating any draws in the current workload, even when enabled.

## Remaining stages

These features are not implemented or advertised as active by this toggle:

1. Background geometry cooking and spatial meshlet packing with a hierarchy.
2. Conservative current-frame HZB occlusion, including MSAA depth coverage and
   explicit invalidation around depth clears, overrides and callbacks.
3. Hierarchical simplification with seam preservation and an explicit screen
   error/quality setting. Full-detail compatibility must remain available.
4. Streamed geometry pages, complete parent/child replacement, upload budgets
   and residency fallback. Current metadata caching is not geometry streaming.
5. Optional distant bricks/voxels and approximate cluster lighting. These need
   separate quality controls and material compatibility work; they cannot be
   silently substituted for application geometry, water or shadows.

The ThreeNaniteTest scene generator, custom material bodies, shaders and assets
have not been copied into the runtime or Studio. This implementation consists
of generic native renderer mechanisms.
