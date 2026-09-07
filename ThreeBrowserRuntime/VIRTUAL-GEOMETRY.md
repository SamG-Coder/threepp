# Virtual Geometry

The native runtime menu has an opt-in **Virtual Geometry (experimental)** toggle
next to its FPS/diagnostic controls. It combines exact cluster culling with an
experimental native adaptive-detail hierarchy. The runtime toggle enables a
1-pixel projected error metric for eligible stock vertex shaders. Library
clients retain exact geometry unless they call `setVirtualGeometryPixelError`.
This is progress toward the requested full Nanite-style architecture, **not a
complete Nanite equivalent**. Occlusion hierarchy, demand-paged geometry and a
GPU-driven material/raster pipeline remain unimplemented.

## Adaptive hierarchy stage (2026-09-07)

- A single background C++ cook consumes an immutable snapshot, using the already
  vendored meshoptimizer. Application buffers, code and shaders remain unchanged.
- Spatial binary partitioning produces exact leaves of at most 128 triangles.
  Internal levels simplify their original source subset toward 128 triangles;
  locked boundaries may require more. Normal/UV/color/tangent channels participate
  in the simplification metric. Derived indices reference original vertices.
- Every subset locks its boundary edges. The regression checks both missing and
  newly introduced boundary edges at every level, and exact leaf coverage/winding.
  This is a tested boundary-preserving hierarchy, not Nanite's production DAG
  clustering/reclustering algorithm.
- Compute selects a hierarchy cut from the current camera, actual pass viewport,
  object transform and instance matrix. A node suppresses its descendants only
  when its detail is acceptable; every ancestor is checked. Near-plane crossings
  force refinement. Indirect drawing uses existing material programs and VAOs.
- The metric includes position and vertex attribute error, projected using a
  conservative transform bound. It is an estimated simplification metric, not
  a guarantee of a one-pixel final shaded image difference.
- Source/index/attribute revision changes discard stale results. Geometry disposal
  releases resident data. A cook already running at toggle-off finishes CPU-only;
  its result cannot attach to a later geometry generation.
- GPU hierarchy/index storage uses a 32 MiB LRU cap and at most 256 entries, with
  up to 5 MiB separate indirect scratch. One input snapshot is in flight, capped
  at 350,000 vertices / 1,000,000 indices. Input copying and completed uploads
  still run on the render thread. This is bounded cache residency, not streaming.
- Admission requires at least 256 triangles per geometry and 4,096 triangles
  across instances. Grouped/partial draws, interleaved/integer/dynamic attributes,
  morph data and custom attributes retain exact rendering. Custom vertex additions
  also remain exact even if proven safe for static bounds: that proof does not
  establish their interpolation error. Stock vertices with fragment overrides
  are supported. Skinning, wind and displacement retain existing fallbacks.
- Menu statistics distinguish adaptive draws/cooked geometries/pending work from
  exact cluster and standard draws. These are submissions, not triangles saved.

### Remaining full-system stages

1. Replace independent binary simplification with grouped/reclustered hierarchy
   construction, and add persistent cooked-data keys and disk storage.
2. Implement conservative GPU hierarchical-depth occlusion with current-pass
   coverage and explicit handling for camera cuts, motion, MSAA and alpha testing.
   Previous-frame depth alone is insufficient to hide geometry safely.
3. Add geometry pages, residency tables, GPU demand feedback, asynchronous uploads,
   eviction and a guaranteed resident coarse representation. Both vertex and index
   pages must participate before calling it geometry streaming.
4. Compact visible work and evaluate a GPU-driven raster/material path, including
   microtriangle workloads, shading compatibility and dynamic/deformed geometry.
5. Benchmark deterministic camera replays with CPU/GPU timings, triangle counts,
   residency and image-error comparisons. No island FPS gain is established by
   the synthetic adaptive-detail regression.

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
- Retain up to four ordinary draw selections per geometry using LRU replacement,
  so alternating cameras/passes do not immediately overwrite each other's work.
  The extra command buffers count against the existing 32 MiB residency cap.
- Retain instanced draw selections by instance owner, buffer/revision, geometry
  generation, camera/object transform, draw range and count. Use at most 256 LRU
  selections with a separate 32 MiB byte cap; reuse allocated command storage
  on misses when its capacity fits. Geometry disposal/invalidation releases its
  cached instance selections, and disabling the mode releases all buffers.
- Use bounded LRU metadata/ordinary-command residency (32 MiB) plus the bounded
  instanced-command pool (32 MiB). Source geometry remains resident and unchanged.
- Restore compute/program/storage/indirect state and use barriers between shader
  writes and draw consumption. Preserve MSAA and the existing shading path.
- Turn off the mode to release its buffers and return to ordinary submission.

The current cost guard admits at least 4,096 source triangles across instances.
Geometry with over 3,000,000 indices or over 262,144 cluster-instance commands
uses ordinary rendering. Fully in-frustum non-instanced geometry also retains
its single ordinary draw. First-use bounds construction is synchronous and
bounded by the index limit. Adaptive hierarchy cooking uses the separate
background path described above.

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
cmake --build ThreeBrowserRuntime/build --target three_browser_runtime_stage three_virtual_geometry_smoke three_adaptive_geometry_smoke -j 4
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
`three_adaptive_geometry_smoke.exe` checks hierarchy boundary preservation and
exact leaf coverage, then uses a real GPU primitive query to verify distant detail
reduction and nearby refinement. It also covers render-target size changes,
exact/adaptive VAO restoration, partial-range/custom-vertex fallback, attribute
invalidation, disposal, instancing and replacement while cooking. GPU readback is
confined to the test; ordinary rendering does not wait for visibility results.

Measured on the local RTX 5080 / GL 4.3 regression: 16,128 original sphere
triangles became 3,072 at distance, 8,408 nearby, and 15,880 with the tighter
error setting. These are GPU primitive counts, not an application FPS estimate.
The live island capture had zero adaptive draws/builds: its vertex hooks remain
on the exact path. No adaptive-detail speedup is claimed for that application.

The final suite also reproduced an instanced-mesh teardown crash in the debugger:
`GLObjects::dispose` dereferenced a mesh destroyed after explicit disposal and
subsequent rendering. Registration now uses lifetime-safe subscriptions; the
regression destroys those meshes before explicitly disposing the renderer. The
debugger then exited normally and all 68 GPU-enabled runtime tests passed.
It also checks fragment overrides, read-only varying additions, rejected vertex
writes, and removing an override while cached programs remain alive. The menu
test verifies a constant-height switch thumb, including the compact mode row.
An alternating-camera regression warms four selections, then verifies twelve
exact-pixel revisits with no additional compute dispatches.
Two instanced owners sharing geometry/material also alternate across two cameras
without recomputation, including mixed per-instance-color variants. Revision
invalidation, command-cache eviction, byte limits and geometry disposal are
checked separately.

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

1. Broader shader eligibility and bounded streaming uploads. Background CPU
   cooking and a spatial simplification hierarchy are now experimental paths.
2. Conservative current-frame HZB occlusion, including MSAA depth coverage and
   explicit invalidation around depth clears, overrides and callbacks.
3. A user-facing screen-error/quality setting. The experimental hierarchy uses
   locked boundaries and projected error; exact fallback remains available.
4. Streamed geometry pages, complete parent/child replacement, upload budgets
   and residency fallback. Current metadata caching is not geometry streaming.
5. Optional distant bricks/voxels and approximate cluster lighting. These need
   separate quality controls and material compatibility work; they cannot be
   silently substituted for application geometry, water or shadows.

The ThreeNaniteTest scene generator, custom material bodies, shaders and assets
have not been copied into the runtime or Studio. This implementation consists
of generic native renderer mechanisms.
