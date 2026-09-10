# Native benchmark compatibility fixes

The browser/native comparison exposed three concrete defects, plus native renderer allocation overhead. The fixes are in the shared JavaScript facade and native OpenGL command path; application scenes and benchmark image tolerances were not relaxed.

## Changes

- **Instance matrix allocations:** `setMatrixAt()` constructed a `Float32Array.subarray()` view for every instance write. The command encoder now accepts an offset into the original array and snapshots exactly 16 elements into the command ring. Contiguous batching, draw barriers, repeated indices and buffer-boundary splitting retain their ordering semantics.
- **Point and spot light compatibility:** the light-state command carried color, intensity and target, but omitted distance/decay/cone settings. Native point lights consequently kept the older C++ default decay of 1 while JavaScript reported decay 2. The extended payload transports distance, decay, angle and penumbra; these values also participate in state invalidation. The decoder still accepts the older payload size.
- **Live material maps:** maps assigned after native material creation were not bound on first render. Material preparation now synchronizes map slots, ensures current texture data, and caches unchanged bindings. Removing a map explicitly clears its native slot. Both binary commands and direct native map-slot calls accept texture handle zero for removal.
- **Streaming RGBA uploads:** matching byte uploads now reuse native image storage with an ordered copy rather than constructing and copying temporary Image/Texture objects. Resize and format changes retain the existing fallback. Texture identity and sampler configuration survive repeated uploads.
- **Loading overlay GL state:** raw loading-overlay GL calls changed clear state behind the renderer's cache. The renderer cache is reset after those calls so a following black-background render does not inherit a stale light clear color.
- **Per-draw setup:** material/object type strings and the environment-map interface are queried once within program setup, avoiding repeated owning-string allocations and casts.

## Verification

Built and staged the native runtime with:

```powershell
cmake --build ThreeBrowserRuntime/build --target three_browser_runtime_stage -j 4
```

Ran all runtime tests with GPU cases enabled and sequential execution: **71 passed, zero failures, zero skips**. Regression coverage includes matrix snapshot ordering, light-state wire layout, dynamic point attenuation, late texture attachment, texture updates, resize/UV state, map removal/reattachment, black clearing, and actual instance pixels. Existing GPU tests cover shadows, virtual geometry, presentation, float/byte texture transitions and upload ordering.

The standalone suite at `C:\three-runtime-benchmarks` was rerun with 30 warm-ups, 120 samples and three repeats. All **eight 3D cases and six diagnostic cases** now pass browser/native correctness checks. The original scene definitions and image thresholds remain unchanged.

Local observations on the same machine:

| Metric | Before | After |
| --- | ---: | ---: |
| V8 allocations for 120 updates of 10,000 instances, median repeat | 120.376 MiB | 0.626 MiB |
| Instance render/readback median | 3.102 ms | 2.680 ms |
| Instance render/readback p99 | 4.390 ms | 3.740 ms |
| PBR lighting image error, average normalized RGB | about 4.95% | at most 0.685% |
| Dynamic byte-texture correctness | Failed | Passed |

Allocation figures are statistical V8 samples, not native C++ allocation totals. Lighting correctness previously failed, so its old timing is not an equivalent rendering baseline. Frame pacing was recorded again, but scheduling/VSync differences prevent treating callback cadence changes as an isolated effect of these fixes.

## Remaining performance boundary

### Follow-up: sorting and automatic instancing

Native now defaults to `sortObjects = true`, matching Three.js and the facade. A new ordered command forwards explicit true/false changes for offscreen and window rendering. The native renderer conservatively packs compatible adjacent low-poly Mesh draws into a bounded 1,024-matrix streaming buffer after normal visibility checks and sorting. Small scenes, high-poly geometry, unsupported shaders/states/transforms and callbacks retain their original draw path. Set `THREEBROWSER_DISABLE_AUTO_INSTANCING=1` before launching to measure the sorting-only control.

Across three independent final process launches (nine repeats), cubes fell from 2.265 to 1.807 ms and city from 2.948 to 2.131 ms including readback. The city trace submitted 846 objects in five draws. Shadows were 0.044 ms slower and triangle-heavy cases essentially unchanged; this is not a universal speedup. All eight 3D cases pass the unchanged saved browser baseline in all three launches, and all six diagnostics pass. Browser tests were not rerun.

The combined-scene investigation also caught a dangling bound render-target pointer after handle disposal. Native now unbinds the target before destroying it. A new GPU regression compares batched/unbatched images, crosses the buffer capacity, exercises live state and fallbacks, replaces targets repeatedly, and checks transparent sorting with true/false toggles. All 74 runtime tests pass with GPU cases enabled and no skips. Full results and limits are in `C:\three-runtime-benchmarks\AUTOMATIC-BATCHING-REPORT.md`.

### Follow-up: native material interface caching

The follow-up optimization removes repeated C++ multiple-inheritance casts from per-draw program setup and material uniform refresh. Renderer-owned `MaterialProperties` caches 19 non-owning interface pointers once per material and releases the cache on disposal. Current colors, textures, wireframe/morph flags, uniforms and program-invalidation conditions remain live.

Against a freshly rebuilt native baseline at `e41a424`, native completed render/readback median latency fell from 5.202 to 2.304 ms for 1,000 cubes, 5.882 to 2.955 ms for city, and 1.883 to 1.019 ms for PBR lighting. All eight saved native validation PNGs are byte-identical; all eight 3D and six diagnostic cases pass the unchanged browser baseline. Browser tests were not rerun.

GPU regressions also exposed and fixed missing automatic facade color synchronization and wireframe command transport. The extended material-state command retains support for old payloads. Disposed materials clear their facade state caches before explicit reattachment. All 72 runtime tests pass with GPU tests enabled, zero skips and zero failures.

Frame pacing improves much less than completed draw latency, and instance p99 does not improve. A new city trace averages roughly 0.92 microseconds of program setup per draw, down from the earlier trace's 4.56 microseconds. The detailed measurements, compatibility scope, allocation tradeoff and remaining limits are recorded in `C:\three-runtime-benchmarks\PERFORMANCE-REPORT.md`.

The following paragraph describes the earlier, pre-optimization trace:

This does not establish performance parity with the browser. A separate city trace placed roughly 4 ms of native CPU time in draw/program setup, versus about 0.7 ms in render-list preparation; a draw-level trace placed most per-draw work in program/uniform setup. The same city still takes about 5.9 ms including readback on the native path. The measured instance allocation defect is fixed; broader OpenGL submission/driver overhead remains a separate optimization target.

Detailed before/after records, raw samples, CPU/memory/GC counters and PNGs are in the standalone benchmark repository's `FIX-REPORT.md` and generated `results/` directory. The baseline reports were preserved.
