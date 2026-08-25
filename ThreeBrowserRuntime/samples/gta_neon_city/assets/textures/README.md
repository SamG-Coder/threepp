# Texture provenance

`facade-concrete-weathered-v1.png` is a 1024×1024 runtime albedo texture
generated for this sample with Codex's built-in image-generation tool on
2026-08-25, then resized locally with Lanczos filtering for power-of-two
mipmaps. It has no external runtime dependency. `buildCity` retains its
deterministic procedural façade map as the fallback if this file cannot load.

Final generation prompt:

```text
Use case: stylized-concept
Asset type: seamless tileable game texture for a native open-world city building façade
Primary request: a realistic neutral-albedo material texture of weathered modern coastal-city concrete façade panels, with fine aggregate, subtle formwork seams, restrained rain streaks, faint salt staining, tiny chips and believable age variation
Style/medium: realistic PBR-style game texture, orthographic flat material scan, production-ready and understated
Composition/framing: square texture viewed perfectly straight-on; evenly distributed detail; must tile seamlessly on all four edges
Lighting/mood: neutral diffuse overcast reference lighting; no directional shadows; no baked highlights
Color palette: cool charcoal blue-gray concrete with modest warm-gray variation, never pure black or white
Materials/textures: fine concrete grain, shallow panel seams, water weathering, sparse hairline cracks; medium-scale detail that remains readable on tall towers
Constraints: seamless edges; no perspective; no windows; no doors; no signs; no text; no logos; no people; no vehicles; no neon; no graffiti; no strong focal element; no watermark
Avoid: photobashed city scene, dramatic lighting, repeating obvious stains, large cracks, glossy surfaces, decorative patterns
```

`asphalt-coastal-worn-v1.png` and `pavement-concrete-aggregate-v1.png`
are 1024×1024 runtime albedo textures generated with Codex's built-in image
generation tool on 2026-08-25 and resized locally with high-quality bicubic
filtering for power-of-two mipmaps. Both are decoded before city construction;
the procedural maps remain the normal and roughness sources and the complete
fallback if either bitmap is unavailable.

Final asphalt prompt:

```text
Use case: stylized-concept
Asset type: tileable game texture
Primary request: photorealistic worn coastal-city asphalt road surface for a third-person open-world game
Style/medium: seamless tileable realistic material albedo reference, orthographic top-down
Composition/framing: square, uniform edge-to-edge surface, genuinely seamless on all four edges, no focal point
Lighting/mood: flat neutral diffuse capture, no directional light, no shadows, no specular glare
Color palette: charcoal gray with restrained cool aggregate variation
Materials/textures: fine mineral aggregate, subtle tar repairs, tiny hairline cracks, sparse embedded grit, natural low-frequency wear
Constraints: no lane paint, no road markings, no arrows, no manholes, no puddles, no debris objects, no curbs, no perspective, no baked lighting, no text, no logos, no watermark; edges must tile without seams
```

Final pavement prompt:

```text
Use case: stylized-concept
Asset type: tileable game texture
Primary request: photorealistic weathered urban concrete sidewalk surface for a coastal open-world game
Style/medium: seamless tileable realistic material albedo reference, orthographic top-down
Composition/framing: square, uniform edge-to-edge surface, genuinely seamless on all four edges, no focal point
Lighting/mood: flat neutral diffuse capture, no directional light, no shadows, no specular glare
Color palette: desaturated warm-gray concrete with subtle aggregate and restrained age variation
Materials/textures: fine sand aggregate, faint hairline wear, tiny mineral speckles, lightly mottled poured concrete; realistic but not dirty
Constraints: no slab seams, no tile joints, no painted markings, no gum, no litter, no leaves, no curbs, no perspective, no baked lighting, no text, no logos, no watermark; edges must tile without seams
```

`facade-brick-coastal-aged-v1.png` is a 1024×1024 runtime albedo generated
with Codex's built-in image-generation tool on 2026-08-25 and resized locally
with Lanczos filtering. Westside and North Market use it with a deterministic
staggered-brick normal/roughness profile, while the complete procedural brick
material remains available if the bitmap cannot be decoded. Like the other
authored maps, it is decoded and uploaded during startup warmup only.

Final brick prompt:

```text
Create a seamless square 2048x2048 photorealistic PBR-ready albedo texture tile for an older coastal-city mixed-use building facade. Weathered reddish-brown brick with occasional muted tan repaired bricks, subtle salt staining, fine mortar joints, restrained age variation, a few hairline cracks and water streaks. Flat orthographic front-facing material scan with perfectly even neutral diffuse lighting, no perspective, no depth-of-field, no shadows, no highlights, no windows, no doors, no signs, no graffiti, no objects, no borders, no text. The left/right and top/bottom edges must tile invisibly. Realistic open-world game material, detailed but not noisy, natural non-neon palette.
```

`court-painted-coastal-worn-v1.png` is a 1024×1024 runtime albedo generated
with Codex's built-in image-generation tool on 2026-08-25, then resized from
the 2048×2048 source with Lanczos filtering. Harbour Court decodes it before
world construction and combines it with a deterministic painted-aggregate
normal/roughness profile. The procedural profile is the complete fallback.

Final court prompt:

```text
Create a production-ready seamless square albedo texture tile for an outdoor waterfront basketball court in a grounded modern open-world video game. Orthographic perfectly top-down material scan, flat diffuse color only, no perspective, no horizon, no objects, no people, no basketball markings, no text, no logos. The surface is muted deep blue-green acrylic court paint over fine asphalt, realistically weathered by coastal salt and rain: subtle fine aggregate, restrained mottling, tiny hairline cracks, sparse worn scuffs, faint desaturated patches, and very light edge-free damp variation. Uniform neutral overcast illumination with no baked directional shadows, no highlights, no neon, no vignette. All four edges must tile seamlessly with no obvious repeated landmark. Photoreal material quality suitable as a color/albedo map; preserve fine microdetail without high-contrast noise. Output a single 2048x2048 square texture.
```

`depot-corrugated-coastal-v1.png` is a 1024×1024 runtime albedo generated
with Codex's built-in image-generation tool on 2026-08-26, then resized from
the 1254×1254 source with Lanczos filtering for power-of-two mipmaps. Southline
Parts Depot combines it with the existing deterministic metal normal/roughness
profile. It is decoded before city construction and has a complete procedural
fallback.

Final depot-cladding prompt:

```text
Use case: stylized-concept
Asset type: seamless tileable game texture for a native WebGPU city environment
Primary request: photorealistic weathered charcoal-gray corrugated steel cladding for a coastal industrial parts depot
Style/medium: seamless square PBR-style albedo texture, realistic material photography, orthographic front-on surface
Materials/textures: narrow vertical galvanized steel ribs, subtle salt-air oxidation, faint rain streaks, restrained scratches and grime in rib valleys, varied roughness implied by color only
Lighting/mood: flat neutral overcast reference lighting with no directional shadows and no baked highlights
Composition/framing: surface fills the entire square; all four edges tile seamlessly; even detail density; no single distinctive focal stain
Color palette: dark graphite, cool gray, tiny muted rust traces
Constraints: strictly seamless edges; albedo/color texture only; no perspective; no depth-of-field; no objects, doors, windows, signs, lettering, logos, people, border, watermark, neon, or dramatic lighting
```
