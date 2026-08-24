# RTX Depth Echo

A clean-room ThreeBrowser Runtime sample that turns a camera frame into a
project-owned heuristic relief, freezes four earlier reliefs, and lets native
RTX ray queries test directional-light shadows against the current and past
geometry.

The default input is a conspicuously synthetic animated portrait. Press C to
request a webcam, or launch with the live=1 query. Camera permission is never
requested silently.

## What it is

- A 224×224 WebGPU compute estimator built from luminance, Sobel edges, local
  contrast, saturation and a broad center prior.
- A fixed 12-second sequence: RGB source, relief unfold, four echo captures,
  RTX shadow test, then a side-on echo cascade.
- One fixed-topology dynamic BLAS. Each 223×223 current cell and each 63×63
  echo cell owns an independent quad, so low-confidence cells can collapse
  without changing topology. The result is 262,420 vertices and 131,210
  triangles packed into one 512×513 rgba32float texture.
- One ordered RTX encoder per lighting frame: WebGPU pack, BLAS refit, then the
  public lighting-v1 ray evaluation.

## What it is not

The relief is **non-neural and non-metric**. It does not infer real distance,
recognize people, segment semantic subjects, or download a model. Position w
is only a non-semantic confidence score used to collapse weak grid cells.
Frozen echoes are earlier heuristic camera sheets, not reconstructed people or
volumes.

In native RTX mode raster shadow casting is disabled for the relief meshes.
Therefore echo-shaped occlusion in the final lighting pass comes from traversal
of the refitted temporal BLAS. Press Q to disable only the ray evaluation for
a direct A/B view. When the dynamic RTX bridge is unavailable, the same scene
continues with clearly labelled WebGPU raster shadows.

## Controls

- C — request live camera input
- Q — toggle only the RTX ray-lighting evaluation
- D — toggle relief wireframe
- R — restart the 12-second capture loop

## Run and test

From ThreeBrowserRuntime:

    pwsh -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 .\samples\webgpu_rtx_depth_echo\site-entry.mjs
    node --test .\samples\webgpu_rtx_depth_echo\tests\*.test.mjs

All visible content is generated at runtime. There are no external images,
weights, fonts, inference packages or shader files.
