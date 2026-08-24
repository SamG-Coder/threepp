# RTX Neon Rain District

A street-level, fully procedural night district built as a cinematic realism
showcase: deep urban composition, moving two-way traffic, animated rain and
spray, varied wet asphalt, puddles and ripples, volumetric-looking local fog,
occupied facades, practical lighting and architectural neon.

The surface response is backed by five deterministic JavaScript texture
families: asphalt, concrete, painted metal, rain-grimed glass and rubber. Each
family shares a 128 x 128 albedo/roughness/tangent-normal triplet across every
matching material. The maps are combined inside the TSL material nodes, so the
native RTX guide pass receives the same high-frequency roughness and normal
variation that is visible in the source render.

Eleven pedestrians use pooled articulated rigs rather than cylinder
silhouettes. They have jointed limbs, planted shoes, varied proportions,
clothing, skin, hair and bags; eight carry animated umbrellas and three use
hooded coats. Fixed-speed sidewalk convoys prevent overlap, while rain toggling
transitions open umbrellas into coherent folded poses.

Run it directly against the existing Runtime build:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File C:\ThreeBrowser\ThreeBrowserRuntime\run.ps1 C:\ThreeBrowser\ThreeBrowserRuntime\samples\webgpu_rtx_neon_rain_district\site-entry.mjs
```

## Controls

- `A` — automatic cinematic camera / manual camera
- `1`–`4` — authored street-level compositions
- `R` — rain and road-splash effects
- `Q` — cinematic / balanced reflection quality
- drag — orbit the active composition
- wheel — dolly

## JS-only content boundary

The new scene is entirely authored by the modules in this folder. Buildings,
shop interiors, windows, signs, street furniture, vehicles, pedestrians,
rain, puddles, fog cards, light shafts, materials, animation and camera work
are procedural Three.js content. There are no downloaded models, images,
fonts or textures and no demo-specific native code or shader. Material maps
are generated as cached `DataTexture` objects at runtime and released after
the scene materials during teardown.

The sample imports the already-bundled generic `NativeReflectionRenderer` and
static-scene serializer from the Light Transport Observatory. That bridge is
used without alteration: JavaScript registers the static district, eight
shadow-tested practical lights and a dynamic traffic proxy instance group,
then supplies the wet-surface guide materials and cinematic ray parameters.
On compatible hardware the bridge can use ray reconstruction, super
resolution, frame generation and Reflex; otherwise the same JavaScript scene
uses its authored WebGPU planar-road reflection fallback.

Moving vehicle proxy transforms are updated through the bridge's generic
instance API, so cars remain present in off-screen wet-road reflections without
adding any C++ knowledge of traffic or of this level.
