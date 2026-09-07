# Runtime hot-path audit

Audited runtime commit `3df0704`, using the unchanged local Ashore export at its saved High setting. This is a runtime optimization investigation, not a proposal to migrate application simulation into native code.

## Fresh measurements

One 20.02-second V8 CPU sample after 35 seconds of warm-up: 214 presentations, 10.69 FPS, mean frame interval 93.4 ms. All 20 interaction-bridge samples reported no active input gate. The diagnostic wrapper recorded command opcodes, RAF durations and renderer-call durations; instrumentation has overhead and this single run is not a before/after speed comparison.

| Measurement | Result |
|---|---:|
| Mean total RAF callback time per presentation | 37.3 ms |
| Runtime compatibility-slice CPU self samples per presentation | 10.58 ms |
| Runtime host CPU self samples per presentation | 0.94 ms |
| Application/bundled-library CPU self samples per presentation | 26.15 ms |
| Inclusive renderer wrapper time per presentation | 11.31 ms |
| Native submission-call duration per presentation | 0.022 ms |
| Submitted command bytes per presentation | 645,053 |
| Individual instance-matrix commands per presentation | 4,421.57 |
| Bytes occupied by those instance-matrix commands | 353,725 (54.8% of submitted bytes) |
| Numeric-uniform commands per presentation | 432.56 |
| Texture-uniform commands per presentation | 51.56 |
| Offscreen render commands per presentation | 34.45 |
| Window render commands per presentation | 1.00 |

CPU self samples and inclusive times must not be added together. Renderer wrapper time includes recursive method calls. The offscreen count above comes from command opcode 4, rather than counting JavaScript method invocations; internal shadow draws and resolves are not separately counted.

V8 recorded 11.37 seconds of idle samples. The approximately 56 ms between mean frame interval and RAF duration includes native execution, driver/GPU waiting, scheduling and other work; it is not a GPU measurement. Native `frameUs` reported 55 microseconds because it measures the final presentation path, excluding earlier offscreen commands.

## Prioritized runtime opportunities

### 1. Coalesce instance-matrix commands

Evidence: the largest observed command category is opcode 100, occupying 54.8% of wire bytes. `host/ThreeBrowser/web/three/08-objects.js: setMatrixAt` immediately emits one command per instance. `00-cmdbuf.js: instMatrices` and `native/cmd_batch.cpp: OP_INST_MATRICES` already support contiguous batches, but no opcode 103 batches appeared in the sampled frame submissions.

Candidate: combine adjacent writes to contiguous indices of the same mesh into the existing bulk command. A first implementation can coalesce only adjacent compatible commands, preserving all other command order. Each matrix remains 64 bytes; batching reduces headers, decoder dispatches, handle lookups and repeated native update/bounds invalidation. The maximum header saving for long runs is roughly 20% of individual matrix-command bytes, not elimination of the entire 354 KB.

Required checks: writes on either side of a draw must remain separate; preserve repeated and noncontiguous index writes, different meshes, destroy/recreate, buffer rollover, explicit submissions, and matrix snapshots when the application reuses one Matrix4. Check pixels before and after intervening draws. Measure contiguous-run lengths before promising a command-count reduction. Do not reduce animation or simulation frequency.

### 2. Measure the complete native frame before changing scheduling

Evidence: approximately 34.5 offscreen render commands per presentation, substantial idle/gap time, and `browser-host.mjs: pump` waits for native pressure to return to zero before executing the next RAF batch. `native/three_native.cpp: renderFrame` statistics cover only final presentation.

Candidate: add CPU timings around command execution plus asynchronous GPU query timings for offscreen passes, shadows, resolves and presentation. Retrieve queries in later frames without blocking. If overlap is justified, prepare at most one immutable CPU batch while the preceding native frame executes, with strict backpressure and ordering for later synchronous calls.

Required checks: input-to-presentation latency, no growing frame queue, resource lifetime and readback barriers, no command mutation after submission. Do not interpret idle time as GPU time, add glFinish for ordinary timing, or simply raise the queued-frame limit.

### 3. Reduce repeated scene preparation

Evidence: renderer object-visit callback 376 ms self time, recursive traversal 311 ms, updateMatrixWorld 181 ms and updateMatrix 54 ms in the 20-second trace. Native GLRenderer independently updates scene/camera matrices before rendering too.

Candidates: a versioned structural/renderable index for internal metadata walks; native transform generations for unchanged local/world transforms; eliminate repeated per-object temporary material arrays. Preserve the public traversal and callback semantics.

Required checks: additions/removals/reparenting, ancestor visibility, layers, custom traversal/update overrides, direct matrix writes, manual/automatic matrices, nested render calls, and mutations from onBeforeRender. Do not skip whole subtrees or application callbacks using only a display-frame stamp. Audit JS and native matrix work separately before removing either side.

### 4. Finish the smaller material/texture hot paths

Evidence: flushNative 175 ms, pushShaderUniform 104 ms, material handle getter 98 ms and applyNativeTexParams 90 ms self time. Texture checks still construct a parameter object, array and joined string. Hooked materials allocate a Matrix4 for environment rotation each relevant render call.

Candidates: scalar snapshots for texture sampling parameters; reuse environment-rotation scratch storage; avoid constructing material arrays for objects without materials. These are smaller targets than matrix command traffic and full native frame execution.

Required checks: changed sampling parameters, texture-handle replacement, direct vector edits, per-pass environment changes, user-mutated uniform matrices and nested renders. Do not reuse a stale uniform or suppress a source recompile.

### 5. Reduce native uniform-array allocation after native profiling

Code evidence, not independently timed: OP_SHADER_UNIFORM constructs a name string and replaces vector storage for array uniforms. Vector2/Vector3 arrays grow through repeated emplace_back without reserve. Stable-size arrays could reuse storage or reserve the known count; name lookup could use a bounded program-aware cache.

Required checks: changed element type/length, shader rebuild, material disposal and handle reuse. Native timings must establish whether this work is material before changing the protocol to uniform IDs.

## Scope and next step

The largest application CPU self-time functions are wave/shore calculations. They remain application code. Runtime work should improve transfer, traversal, resource updates and scheduling without copying those functions into C++, lowering resolution or changing simulation behavior.

Adjacent instance-matrix command coalescing has now been implemented and validated below. Native all-pass timing is the next measurement priority. The other entries are candidates with stated evidence and validation requirements, not completed optimizations or predicted FPS gains.

## Instance batching implementation and validation

The command ring promotes adjacent single-matrix writes for the same mesh and consecutive indices into the existing OP_INST_MATRICES format. The first matrix remains a normal single-write command until a second compatible write arrives. Matrices are copied immediately, including when the caller reuses one Matrix4. Any other command, submission, buffer attachment or capacity boundary breaks the run. No writes are deferred across draws, reordered, or removed. Appending a Float32Array uses a direct typed-array copy without allocating a temporary byte view.

Controlled seven-round benchmark, alternating old/new order: 100,000 updates in runs of 256 became 391 commands instead of 100,000. Bytes fell from 8,000,000 to 6,409,384. All rounds produced the same matrix-data hash and matrix count. Median JS preparation fell from 21.77 ms to 7.76 ms. A separate synchronous native-worker benchmark applying 100,000 updates to an allocated InstancedMesh measured 3.16 ms for individual commands versus 1.21 ms for one contiguous bulk command. The native benchmark excludes JS encoding and drawing; it is not a frame-rate measurement.

The live follow-up trace observed 439 single-matrix plus 414 bulk commands per presentation, and approximately 589,978 submitted bytes per presentation. The preceding trace observed 4,422 individual matrix commands and approximately 645,053 bytes. The inspected follow-up capture included the pause overlay and a different view; the observed 21.1 FPS is not a controlled comparison with the preceding 10.7 FPS. Do not claim a doubling of application FPS from these runs. Live counters were collected before the final allocation-free typed-array append refinement; that refinement preserves command contents.

All 60 tests pass with GPU tests enabled. Command regressions cover repeated/noncontiguous indices, multiple meshes, caller-owned matrix reuse, draw/destroy/submission boundaries and small-ring rollover. A GPU regression submits draws to two targets with different instance positions and verifies that each target contains its own expected result.

## Texture-state fast path

The measured applyNativeTexParams hotspot now compares raw sampler inputs before constructing normalized parameters and string signatures. Mutable offset/repeat components and native handle identity are included. Changed inputs still pass through the existing normalization/deduplication path; failed sends remain retryable.

Seven alternating benchmark rounds, 200,000 checks over 128 textures with periodic in-place offset changes: median 77.51 ms before versus 2.49 ms after. Both paths emitted the same 95 parameter commands with identical arguments in the first measured round; command sequences were equal in every round. This isolates texture-state checks. The earlier live profile attributed 90 ms of self time over 20 seconds to this function, so this improvement must not be presented as a large whole-frame speedup. All 62 tests pass with GPU tests enabled, including sampling fields, mutable transforms, legacy encoding, equivalent normalized values and failed-submission retry.

## Additional native texture candidate

The observed opcode 38 float-texture upload occurs about once per presentation. Native OP_TEX_FLOAT allocates a pixel vector; finishFloatTexture constructs a temporary DataTexture and copies its state into an existing texture. GLTextures uploads the pixels with texImage2D even when dimensions/format/type remain unchanged. These are concrete allocation/storage-update paths to measure next.

Candidate: reuse matching CPU pixel storage and use subimage updates for an already allocated compatible GPU texture. Preserve handle identity, sampler state, float precision, mipmap behavior, color space and resize/format changes. Validate updates before and after intervening draws; do not replace GPU-generated render-target contents or alter application update frequency. Allocation avoidance is established by code inspection, but its GPU/driver benefit remains unmeasured and is not claimed here.

## Float storage and preparation implementation

Matching RGBA float command uploads now copy into the existing CPU vector and mark the same texture dirty. Render-target slots are excluded. Changed dimensions, storage type or format retain the allocation path. Plain 2D float GPU uploads reuse allocated storage with `glTexSubImage2D` only when width, height, internal format, external format and data type match. Other upload branches invalidate the storage record. Sampler changes and mip generation still run through their existing paths.

Renderer preparation no longer allocates one-element material arrays for each visited object or runs four separate material searches in the metadata traversal. Scene environment rotation is computed once per distinct Euler value/order and shared with hooked material uniforms. Each use checks the current Euler, so callbacks and nested passes can still change it. Object traversal, matrix-world propagation and application callbacks remain active on every pass; there is no speculative cross-frame transform or scene-membership cache.

The regression suite samples GPU pixels after compatible updates, resizing, float/byte transitions, repeat wrapping, and two draws separated by an upload. It also checks material replacement during render callbacks and mutable environment Euler components/order.

### Complete command-submission timing

Set `THREEBROWSER_FRAME_PROFILE` to an absolute JSONL output path before launching the native runtime. This opt-in diagnostic records worker CPU execution and asynchronous OpenGL timestamp spans for every command submission, including resource-only and offscreen submissions. A presentation marker associates preceding submissions with the next presented frame. Shadows and resolves issued within those submissions are included in the total; they are not individually attributed.

Queries are polled on later submissions with `GL_QUERY_RESULT_AVAILABLE`. There is no `glFinish` or wait for an unavailable result. At most 32 samples are pending. Unsupported backends, saturation and unavailable teardown samples record `gpuUs: null`, not zero. Query names are released before context teardown. Profiling is disabled by default.

CPU scopes exclude enqueue time and command-buffer copying before worker dispatch. GPU values are timestamp spans, which can include idle/driver scheduling gaps; they are not shader-active time. Direct native calls outside command submission are outside these scopes. CPU and GPU overlap, so do not add their totals together. The old `stats.frameUs` remains a presentation-only statistic.

Summarize a trace, excluding the first 200 presentations:

```powershell
node ThreeBrowserRuntime/runtime/summarize-frame-profile.mjs "$env:TEMP/trace.jsonl" 200
```

### Reproducible controlled workload

```powershell
node ThreeBrowserRuntime/runtime/benchmark-hotpaths.mjs "$env:TEMP/hotpaths.json" 300
```

This fixed workload uploads a 256x256 float texture, visits 1,000 ordinary transform objects and performs eight offscreen passes into a 128x128, four-sample target per iteration. It warms up for 30 iterations, synchronizes through pixel readback, verifies expected sampled colors and hashes all measured output pixels. Run before and after builds with profiling disabled and no other rendering workload. Compare matching `workload`, `frames` and `pixelHash`; do not equate these timings with application FPS.

Two 300-iteration baseline runs had medians 4.354 and 4.100 ms; the first two optimized runs had medians 3.746 and 3.939 ms. All four output hashes were `f3e1260350c02f4a0bf916592740a5c52c0113cc8234fa08f69181d3a5689f4c`. These isolated measurements show a modest improvement, with run-to-run variation.

The final build measured 3.616 ms median with the same output hash. All 64 tests passed with `THREEBROWSER_RUN_GPU_TESTS=1`, including an additional child-process test proving the optional GPU timing covers offscreen-only submissions and identifies presentation.

### Matched application check

The same local Ashore export was launched for each build, entered through the same UI control, warmed for 30 seconds and measured for 15 seconds. Both used existing quality settings and four native samples. A temporary benchmark-only host copy drained physical input during the run; application files were untouched. Both captured views were inspected and showed the same viewpoint with the overlay closed. The copy was removed after benchmarking. An earlier pair with changed camera/overlay state was rejected.

The baseline was `dd94167` with the same optional timing instrumentation added; the optimized build includes the float/preparation changes above. The optimized run preceded the baseline in this final pair. The following figures are one matched pair, not a statistically established application-wide improvement:

| Metric | Baseline | Optimized |
| --- | ---: | ---: |
| Presented frames / measured interval | 220 / 15.039 s | 227 / 14.983 s |
| Observed FPS | 14.63 | 15.15 |
| Mean JS RAF callback time | 27.06 ms | 26.04 ms |
| Median native submission CPU time | 34.32 ms | 34.35 ms |
| Median GPU submission timestamp span | 57.18 ms | 56.24 ms |
| Median bytes / frame | 587,760 | 587,760 |

The large native rendering cost remains. The existing presentation-only counter reported roughly 0.2 ms, which did not describe the cost of the complete submission. Next investigation should attribute the measured native total to individual offscreen/shadow/resolve passes before changing scheduling or render preparation further. Existing application shader-hook errors remained visible in both builds; this optimization pass did not rewrite them or suppress diagnostics.
