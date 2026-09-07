# Advanced runtime performance investigation

## Instanced vertex binding follow-up (2026-09-07)

Baseline: f6f65e9, Virtual Geometry enabled. A separate 20-second native run used
the existing worker CPU/GPU timestamp trace, with a V8 sampling profile from
seconds 5 through 17. The worker summary excludes the first 30 presents and the
last incomplete frame. Application code, quality settings and simulation remain
unchanged. These are observational samples, not a deterministic replay.

| Worker measurement per present | Before | After retaining instance bindings |
| --- | ---: | ---: |
| Frames sampled | 216 | 220 |
| Mean command CPU time | 31.032 ms | 30.626 ms |
| Median command CPU time | 30.828 ms | 30.422 ms |
| Mean GPU timestamp interval | 57.724 ms | 56.573 ms |
| Submission batches | 1 | 1 |
| Observed FPS | about 16 | about 16 |

GPU timestamp intervals can include gaps in GPU work; they are not a shader-busy
time measurement. The small timing differences need repeated controlled runs
before claiming a speedup. The sampling profile also attributes substantial JS
self time to application wave calculations; those functions were not changed.

The confirmed redundant work was `GLBindingStates::setup` forcing every instanced
draw to repeat vertex attribute layout setup. It now compares buffer-allocation
generations. Content uploads leave the generation unchanged, while recreated
buffers receive a new generation even if GL reuses a numeric buffer name.
Virtual Geometry selection keys also include this allocation generation.

The GPU regression instruments actual `glVertexAttribPointer` calls: twelve
unchanged draws and a matrix-content upload perform zero layout calls with exact
pixels. Disposing/recreating the instance buffers forces setup again and retains
the reference pixels. Shared geometry, mixed instance colors, alternate cameras,
matrix changes and cached-command invalidation remain covered by the smoke test.

## Measured scope

Baseline: ea5d896. Same local exported application, existing quality settings,
stationary view, 30-second warmup and 15-second observation. A temporary host
copy drained physical input during measurement. Application source was unchanged.

The new optional `THREEBROWSER_PASS_PROFILE` CSV separates native CPU time into
transform updates, render-list construction, shadows, light setup, drawing and
resolve/mipmap work. These durations include driver blocking. They are not GPU
execution times. Nested render calls are inclusive, so avoid summing parent and
child scopes in applications that perform nested native renders. The trace stops
after 50,000 passes and is disabled by default.

```powershell
$env:THREEBROWSER_PASS_PROFILE="$env:TEMP/passes.csv"
# Launch the runtime, then close it normally to flush the trace.
node ThreeBrowserRuntime/runtime/summarize-pass-profile.mjs "$env:TEMP/passes.csv" 5000
```

The last 5,000 complete passes of the inspected run contain these dominant groups:

| Native scene/camera/target texture | Resolution | Mean CPU per call | Draw | Shadows | Render list |
| --- | --- | ---: | ---: | ---: | ---: |
| 6 / 7 / 109 | 1920x1080 | 15.70 ms | 8.88 ms | 5.71 ms | 1.04 ms |
| 6 / 7 / 106 | 1920x1080 | 10.65 ms | 9.17 ms | <0.01 ms | 1.37 ms |
| 6 / 8570 / 110 | 1024x576 | 6.56 ms | 5.68 ms | <0.01 ms | 0.82 ms |

The first two groups use the same scene and camera; the third uses the same scene
with another camera. Identifiers are local to this trace, not application APIs.
Together they cost about 33 ms per occurrence of the three passes. The remaining
small passes are individually much cheaper. Across the sampled calls, approximately
72% of recorded CPU time is drawing, 17% shadows and 10% list construction.
Transform work is below 0.5%, as is resolve/mipmap work. This does not establish
the GPU cost of each stage; the existing whole-submission GPU query remains a
separate measurement.

## Confirmed buffer version defect — fixed

`GLAttributes::update` previously performed `++data.version` after an upload.
Several `needsUpdate()` calls can occur before a draw. One GPU upload consumes
all those revisions, so the cached version must become `attribute->version`, as
in the installed Three.js `WebGLAttributes.js`. Incrementing once caused unchanged
buffers to upload again on subsequent passes while the cached version caught up.

The first 100,000 baseline upload records contain 45,152 repeated buffer/version
pairs. The fixed run recorded 78,029 uploads with zero repeated pairs. The baseline
trace hit its cap and includes startup; these totals are not comparable per-frame
bandwidth measurements. Optional `THREEBROWSER_BUFFER_UPLOAD_TRACE` records up to
100,000 CSV rows: GL buffer id, previous version, submitted version, upload bytes.

A GPU regression fails on the old code with a duplicate upload of buffer 4,
version 513 and passes with the fix. A 256-instance, eight-pass workload produces
the same output hash before/after:
`8aa521ff1c6e7e34a5b104142bf7fcf32d9fb0c520c6f21edda090c001c37b72`.
Small-workload medians were 0.377 ms before and 0.466 ms after; the matched island
pair was 15.17 versus 14.58 FPS with native CPU medians 34.42 versus 34.77 ms.
Consequently no overall speedup is established. The redundant uploads are removed,
but they were not the dominant measured bottleneck. Keep the regression as a
correctness and work-elimination guarantee, not an FPS claim.

## Prioritized advanced candidates

### 1. Native uniform preparation without deep copies or cache eviction

Evidence in `GLUniforms.cpp`: matrix-array visitors take `std::vector<float>`,
`std::vector<Matrix4>` and pointer vectors by value. Structured-uniform visitors
also take the nested unordered map and vector of map pointers by value. These
containers are read during upload, so const references can avoid copying them.
`UniformUtils.hpp::flatten/flattenP` calls `arrayCacheF32.resize(n + 1)` for every
uniform size. Smaller requests shrink the outer cache, destroying retained buffers
for larger requests. Alternating sizes can repeatedly allocate those buffers.

Implementation direction: use const-reference visitors and bounded per-program
scratch storage, then cache unchanged pure-array uniform contents per linked program.
Preserve mutable values, pointer-backed matrices, texture-unit allocation and
program-relink invalidation. Verify alternating array sizes, changed values between
passes, nested structs, relinking and disposal. Measure allocations and CPU draw
time before claiming this accounts for a specific share of the 24 ms draw cost.

### 2. Reuse eligible render-list work across passes

Evidence: two costly passes traverse the same scene and camera; render-list work
across the three dominant groups costs about 3.2 ms. Native Object3D already caches
unchanged local composition and world-matrix multiplication, so another generic
matrix dirty flag is unlikely to address the main cost.

Implementation direction: cache visibility/geometry metadata behind explicit
scene, transform, camera, layer, material and bounds revisions. Keep callbacks
running and invalidate after intervening mutations. A different reflection camera
or shadow camera needs its own visibility result. Cache eligibility must also
cover LOD updates, direct matrix writes, reparenting, material groups and clipping.
Do not reuse a main-camera visibility list for shadow casters.

### 3. Stream dynamic GPU buffers without overwriting in-flight storage

Evidence: dynamic updates currently use `glBufferSubData` on the same buffer.
After redundant updates are removed, remaining uploads can still wait for earlier
GPU consumers. The observed CPU draw cost may include such driver waits, but that
attribution is not yet proven.

Implementation direction: benchmark orphan-and-upload for full dynamic rewrites,
then a capability-gated persistent-mapped ring with fences if justified. Keep a
fallback for unsupported GL contexts. Never overwrite a busy region, grow the
frame queue without a bound, or forget to update VAO/binding-cache references when
storage changes. Preserve partial ranges and readback/draw ordering.

### 4. Batch compatible native draws and amortize per-draw state

Evidence: `GLBufferRenderer` submits individual glDrawArrays/glDrawElements calls
and their instanced variants. Drawing dominates the CPU stage trace. Native
uniform blocks or a per-draw data arena could amortize setup; multi-draw indirect
is a larger extension for compatible draw groups.

Eligibility must preserve program/VAO/material state, render order, transparency,
callbacks, custom shader behavior and original gl_InstanceID/gl_VertexID semantics.
Use a normal-draw fallback for incompatible commands. This needs draw-level GPU
and CPU attribution before choosing the batch representation; it is not safe to
merge arbitrary application draws or replace application shader logic.

## Lower-priority or unjustified changes

- Do not disable MSAA or reduce resolution: measured CPU resolve time is small,
  and quality reduction is outside this task.
- Do not skip wave updates or reduce simulation frequency. Many small passes are
  cheap on the CPU; their individual GPU costs have not been measured here.
- Do not blindly cache shadows once per frame: the inspected dominant passes
  already show substantial shadow work in only one pass. Animated vertex/alpha
  inputs can legitimately invalidate shadows.
- Do not increase queued frames based on the presentation-only 0.2 ms statistic.
  Whole-submission CPU and GPU timing is required, along with input latency.
