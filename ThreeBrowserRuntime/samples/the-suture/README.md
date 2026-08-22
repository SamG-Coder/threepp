# The Suture

An original JS/MJS-only shader sculpture packaged in the same format as a
ThreeBrowser Runtime export.

The scene is one authored mechanism: a split porcelain Möbius monument held by
an animated red seam above a black basin. A pulse runs through the stitches,
then reaches the basin and the ordered field of obsidian witnesses around it.

Stress coverage:

- a split custom-parametric surface with roughly 200,000 triangles;
- per-vertex phase, side, cross-strip, and seam attributes;
- a 20,000-instance shader-driven architectural field;
- 320 precisely aligned stitch instances and a dense closed seam tube;
- a high-resolution displaced basin with a restrained travelling signal;
- a full-background multi-sample volumetric light shader;
- pointer hold/release, wheel, keyboard, resize, and continuous animation.

Run the exported entry directly:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\the-suture\site-entry.mjs
```

Hold the pointer to open the seam, then release it to launch a pulse. Use the
wheel to dolly, Space to pause, O to toggle camera drift, and R to reset.
