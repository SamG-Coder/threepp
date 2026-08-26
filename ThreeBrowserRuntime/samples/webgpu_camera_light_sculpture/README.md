# Camera Light Sculpture

A client-only ThreeBrowser Runtime example inspired by a mirrored webcam light
sculpture: a persistent violet, magenta and pale-pink particle field curls around
one or two moving interaction points, stretches into wakes and rings, and keeps
coasting after the input settles.

The sample reuses the runtime's existing camera surface. Each frame is converted
to luminance/chroma first, and only a locally estimated person foreground is
revealed in the violet/cyan camera layer; the room itself remains hidden. All
frame conversion, mirroring, motion analysis, WebGPU compute, particle
rendering, bloom composition and UI live inside this sample's JavaScript
modules. It does not add or modify native/C++ code.

## Interaction

- Camera access is requested on startup so the sculpture is ready for hand
  gestures as soon as permission is granted. Press **C** to stop/retry it, or
  launch with `?camera=0` when a no-camera preview is desired.
- For the cleanest calibration, let the camera see the still room briefly, then
  move into view or raise a hand. YCbCr skin seeds anchor a connected moving
  foreground, including adjacent hair and clothing, while unseeded room motion
  remains hidden.
- **Point — FOLLOW:** lead with one fingertip and the particle stream follows it,
  curling into a soft violet orbit by default.
- **Closed — CHARGE:** after engaging POINT, close your hand to pull the orbit
  inward and compress it into a dense, bright knot.
- **Open — RELEASE:** open the charged hand to release a crisp luminous
  shockwave and a stronger bloom.
- **Swipe — THROW:** sweep quickly to throw long magenta ribbons in the swipe
  direction.
- Press **R** to reset the particle field and **H** to hide the help card.

Mouse, touch, click and pointer movement do not control the sculpture. Camera
hand gestures are its only interaction source.

If Windows camera privacy blocks access, the HUD reports that directly. Enable
camera access for desktop apps in Windows Settings, then press **C** to retry.

## Tracking boundary

This is deliberately a lightweight, local heuristic rather than a landmark or
semantic segmentation model. It never uploads frames or infers identity. A
separate display matte converts RGB into YCbCr, compensates broad lighting
changes, seeds from inclusive skin colour plus real foreground change, then
grows through connected motion so a moving person's clothing can be shown too.
The raw camera is never displayed while that matte calibrates. A steady
background, visible movement and ordinary room light produce the best result.

Gesture analysis stays separate and more detailed: its first hand layer softly
diffuses skin-colour likelihood, then real motion seeds grow only through
neighbouring skin-colour support. Gesture shape and the leading-tip estimate are
extracted from that completed hand silhouette rather than the broader person
matte, preserving finger gaps and fingertip priority.
Point/follow estimates a leading tip rather than identifying an anatomical
fingertip. Compact and broad shapes select charge and release, while
sufficiently fast directional movement temporarily overrides either pose as a
swipe.
POINT deliberately arms the charge/release sequence first, which prevents a
moving face or other compact skin-toned region from cold-starting an effect.
Because the display matte is non-neural, a person already motionless in the
first calibration frame cannot be separated reliably from the room. Move or
raise a hand to reveal the silhouette; leaving the frame lets the adaptive
background clear it again.

## Visual system

- A mirrored, cover-cropped 640×360 person-only camera layer: RGB is converted
  to YCbCr, a temporally smoothed foreground-person proxy is extracted at low
  resolution, then the revealed luminance is recoloured violet/cyan over a dark
  background.
- A persistent WebGPU storage-buffer simulation with fingertip-follow vortices,
  closed-hand compression, open-hand shockwaves, directional swipe ribbons,
  curl drift, damping and soft screen containment.
- Additive soft sprites colored by velocity and local interaction energy.
- A bloom render pipeline with a direct additive fallback if bloom is unavailable.

## Run and test

From `C:\ThreeBrowser\ThreeBrowserRuntime`:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\run.ps1 .\samples\webgpu_camera_light_sculpture\site-entry.mjs
node --test .\samples\webgpu_camera_light_sculpture\tests\*.test.mjs
```

The already-built runtime is sufficient; no native rebuild is required.
