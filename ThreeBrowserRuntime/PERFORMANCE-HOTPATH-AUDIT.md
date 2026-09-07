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
