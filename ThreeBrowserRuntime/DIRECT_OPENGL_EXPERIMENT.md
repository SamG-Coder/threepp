# Direct OpenGL experiment

This opt-in path tests whether the runtime needs threepp's native scene objects and GLRenderer when the application already uses Three.js. It keeps stock Three.js WebGLRenderer in JavaScript and submits graphics commands to the existing OpenGL context. The default facade/threepp path is unchanged.

The direct path is:

```text
Stock Three.js objects and WebGLRenderer
  -> JavaScript WebGL adapter
  -> main three/00-cmdbuf.js command ring (RAW_GL opcode)
  -> N-API submission
  -> existing native context worker
  -> OpenGL
```

There is no native Mesh, Material, Camera or Scene reconstruction. In the measured eight-scene run, bridge statistics report zero native scene/resource slots and no selected native render scene while executing about 2.9 million graphics operations. This is a bypass of the scene/render layer, not removal of the threepp build dependency: the experiment still uses the existing runtime's window/context startup, which currently depends on threepp infrastructure.

## Run the comparison

Build/stage the runtime as usual, then use the standalone benchmark repository:

```powershell
$env:THREEBROWSER_ROOT = 'C:\ThreeBrowser'
node C:\three-runtime-benchmarks\native.mjs C:\three-runtime-benchmarks\results\runtime-direct-gl.json --3d --direct-gl
node C:\three-runtime-benchmarks\compare.mjs C:\three-runtime-benchmarks\results\browser-3d.json C:\three-runtime-benchmarks\results\runtime-direct-gl.json
```

The `--direct-gl` flag selects this path in the benchmark runner; it is not yet a general website-loader option. Omit it to select the existing facade/threepp path. The WebGL workloads, sample counts, readback protocol and validation tolerances are identical, so the saved browser WebGL baseline can be reused. Do not combine `--direct-gl` with `--webgpu`.

The runtime API is `createRawGLRenderer(stockThree, host, size)` from `runtime/raw-gl.mjs`. Pass the stock Three.js module and runtime browser host. It creates a single experimental renderer on the runtime's existing context. The wrapper presents after rendering to the default framebuffer and flushes queued resource deletions on disposal. Use one rendering mode per runtime/context; mixing facade rendering and direct GL on the same context has not been implemented.

## Command and synchronization behavior

The adapter provides 133 graphics command/query entries, including buffers, VAOs, shaders, uniforms, textures, framebuffers, draws and readbacks. Setters/uploads/draws are encoded by the existing `three/00-cmdbuf.js` module, using its attached buffer, typed views, rollover/growth logic and normal `CmdSubmit` endpoint. The native main stream dispatches `OP_RAW_GL` directly to OpenGL. The earlier private encoder and `rawGlSubmit` endpoint have been removed. Upload bytes are copied when the API call is recorded, preserving WebGL ordering when the caller subsequently mutates a typed array. Numeric graphics handles have JavaScript object identity for Three.js WeakMap caches.

Each command uses the main stream header `{op, totalBytes}`. Its RAW_GL payload contains a graphics opcode, data byte count, ten numeric argument slots and aligned upload bytes. GL-specific coalescing is implemented in this shared buffer: adjacent `bufferSubData` writes to the same target and exact range replace the earlier pending payload. A bind, draw, query, submission or other intervening command ends that opportunity. This works for instance-matrix buffers without native scene objects. Submission is bounded; the native decoder checks record/payload boundaries. Native buffer uploads and readbacks check data sizes. Remaining setters are replayed in order on the thread that owns the OpenGL context. Queries and synchronous readback flush pending commands first. There is no per-draw scene traversal in C++.

Set `THREEBROWSER_DISABLE_RAW_GL_COALESCING=1` for the unoptimized control. An optional exact uniform cache is enabled with `THREEBROWSER_RAW_GL_UNIFORM_CACHE=1`; it preserves different values across draws and invalidates on program changes, queries, native scene commands and overlapping array uploads. It is disabled by default because the current eight 3D workloads have almost no redundant uniforms and cache overhead makes them slower. `gl.getCommandStats()` exposes eliminated upload/uniform counts and command bytes.

The targeted `runtime/raw-gl-coalescing-bench.mjs` test performs four updates of a 10,000-instance matrix buffer before a full synchronous readback. Across three processes per mode, coalescing reduced median iteration time from 0.7318 to 0.2853 ms and native uploads from four to one, with every readback correct. The existing eight stock Three.js scenes issue no adjacent redundant buffer uploads, so they show no command-count reduction. See `C:/three-runtime-benchmarks/DIRECT-GL-COALESCING-REPORT.md` for native A/B results, tail timings, allocation estimates, correctness checks and reproduction commands. Browser baselines were reused.

The command definitions live in `scripts/generate-raw-gl.mjs`; regenerate checked-in dispatch tables and JavaScript opcodes/constants with:

```powershell
node ThreeBrowserRuntime/scripts/generate-raw-gl.mjs
```

## Scope and evidence

This is an experimental subset for the tested Three.js workloads, not a conformant general-purpose WebGL implementation. It supports typed-array texture uploads; DOM image uploads, context-loss recovery, multiple contexts, compressed textures, asynchronous WebGL readback/fences, and complete extension/parameter coverage are not implemented. Unsupported paths fail rather than being treated as successful rendering. The adapter relies on the active desktop OpenGL driver's support for the supplied shaders and texture-storage entry points. HTML/layout/CSS are not benchmark workloads.

`raw-gl-gpu.test.mjs` checks actual rendering, live texture update/removal/reattachment, buffer snapshot and subrange ordering, shader compilation errors, malformed batches, undersized readback rejection, zero native scene slots and on-screen presentation. The existing runtime regression suite also remains applicable to the default path.

The original results are recorded in `C:\three-runtime-benchmarks\DIRECT-OPENGL-REPORT.md`; the main-command-buffer migration and fresh native measurements are in `C:\three-runtime-benchmarks\DIRECT-GL-MAIN-CMD-REPORT.md`. The direct path improves median completed render/readback time in these eight scenes, particularly instancing, but increases sampled JavaScript allocations in most object-heavy scenes. JS allocation figures do not count threepp's C++ allocations, and on-screen callback pacing differs between paths. These results support further development of the graphics bridge; they do not by themselves establish that all remaining threepp facilities can be removed.
