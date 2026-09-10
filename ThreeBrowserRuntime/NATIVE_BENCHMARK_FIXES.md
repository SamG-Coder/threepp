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

This does not establish performance parity with the browser. A separate city trace placed roughly 4 ms of native CPU time in draw/program setup, versus about 0.7 ms in render-list preparation; a draw-level trace placed most per-draw work in program/uniform setup. The same city still takes about 5.9 ms including readback on the native path. The measured instance allocation defect is fixed; broader OpenGL submission/driver overhead remains a separate optimization target.

Detailed before/after records, raw samples, CPU/memory/GC counters and PNGs are in the standalone benchmark repository's `FIX-REPORT.md` and generated `results/` directory. The baseline reports were preserved.
