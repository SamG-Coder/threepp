# Ashore rendering-path audit — 2026-09-07

## Scope and evidence

Audited the readable local export `ashore-island-world-beautified/assets/IslandGame-BBHGt3vE.mjs`, the JavaScript compatibility slices, binary command handlers, and native OpenGL renderer. The export includes a bundled Three.js revision marker of 180. This is not a claim of complete Three.js compatibility.

An instrumented startup/exploration run recorded 64 command-buffer entry points and 311 distinct materials: 28 ShaderMaterial, 4 MeshBasicMaterial, 112 MeshStandardMaterial, 142 MeshDepthMaterial, 24 MeshPhysicalMaterial, and 1 RawShaderMaterial. 97 materials had alpha-to-coverage enabled. The trace recorded scalar, integer, vec2/3/4, mat3/4, float-array and vec3-array uniform commands. Instrumentation changes timing; its FPS is not a performance benchmark.

The trace includes four-sample half-float refraction and composer targets, including targets with depth textures. Startup allocations with samples=0 are followed by recreated samples=4 targets; an initial zero-sample allocation alone does not demonstrate dropped MSAA.

## Verified paths and fixes

| Path | Source → native implementation | Evidence/status |
|---|---|---|
| Renderer antialias option | WebGLRenderer → RuntimeStart → addon start → tn_runtime_start_with_samples → Canvas framebuffer | Fixed ignored option. true requests four samples; actual GL_SAMPLES is reported, rather than echoing the request. GPU test verifies multisampled allocation. |
| Renderer antialias=false | Same path | Separate fresh-process check returns actual samples=0 and antialias=false. |
| Context antialias reporting | RuntimeSamples → renderer/context attributes and SAMPLES | Fixed hardcoded false; reports native window samples. This is default-framebuffer reporting, not arbitrary bound-target GL introspection. |
| Target samples and mutation | WebGLRenderTarget._ensureNative → RenderTargetCreate → tn_render_target_create → GLTextures multisample storage | GPU test verifies four-sample partial coverage and recreation at samples=0. |
| MSAA resolve | GLRenderer → GLTextures.updateMultisampleRenderTarget → glBlitFramebuffer | GPU pixel readback verifies resolved color coverage. Depth/stencil resolve code exists but has not received an equivalent depth/stencil pixel regression in this audit. |
| Material alphaToCoverage | flushNative → MAT_RENDER_STATE → GLState GL_SAMPLE_ALPHA_TO_COVERAGE | GPU test verifies fractional coverage in a multisampled target. This does not verify every built-in alpha-test shader branch. |
| toneMapped | flushNative → extended MAT_RENDER_STATE → native material/program selection | Fixed dropped field. GPU test verifies exposure invariance when false. |
| colorWrite | Same material-state command → GPU color mask | Fixed dropped field. GPU test verifies the clear color survives a colorWrite=false draw. |
| shadowSide | Same material-state command → native shadowSide → GLShadowMap side selection | Fixed dropped field; decoder and consumer inspected. No dedicated shadowSide image assertion yet. |
| Legacy material-state packets | New fields guarded by protocol presence bit | Existing packets retain old defaults; new packet carries explicit optional shadow side. |
| Display vs intermediate tone mapping | GLRenderer program parameters and material program cache | Fixed tone mapping on intermediate targets. GPU test verifies exposure-invariant intermediates and restored exposure on screen. |
| Custom depth transparency | GLShadowMap.getDepthMaterial copies source map/alphaMap/cutoff/displacement | GPU test reproduced opaque shadows from transparent source pixels, then passed with fix. |
| Shadow update state | renderer shadowMap → shadowState command → native ShadowConfig | Main-window state restoration added. Submission assertion covers restoration after offscreen state changes. |
| Shadow texture lifetime across passes | Three.js uses live light-state arrays; native Uniform values copy vectors. | Fixed stale directional/spot/point shadow texture snapshots by refreshing them on material upload. A GPU regression fails without the fix when the receiver program is prepared before shadow allocation, and passes with the fix; it also verifies the same shadowed world point after camera motion. |
| Shadow autoUpdate and resize | Renderer has both a public shadowMapAutoUpdate field and ShadowConfig; allocation tests depend on both. | Fixed command forwarding to the field used by GLRenderer. GPU test verifies autoUpdate=false does not allocate a map. Size changes now reset disposed target pointers so allocation actually recreates the map. |
| Uniform batching | pushShaderUniform → shaderUniform opcode → native uniforms | Scalar/vector/matrix/array paths observed. Existing command tests verify alignment, signed integers and order. Texture sampling has a separate GPU regression. |
| Overlay texture bindings | native overlay upload/composition save and restore GL state | GPU regression verifies sampled textures survive FPS toggle on/off. |
| Frame submission | queued commands → worker → explicit presentation | GPU regression verifies no stale frame on resource-only sync/async uploads and one presentation for world/composite submission. |
| Keyboard delivery | native events → focused element/body → document → window | Regression verifies document delivery, one window delivery, keyup, detached focus and stopPropagation. Live W hold moves player. |

## Failed or incomplete paths

| Path | Finding | Consequence |
|---|---|---|
| Shader compilation as a whole | The live export still logs undefined surfacePoint/coastalTime/WATER_LEVEL/stoneWet in a generated shader. | Shader compatibility is FAILED, even though individual uniform and output tests pass. The origin of this hook composition failure is not established; do not assume it is an application bug. |
| MeshPhysicalMaterial | Subclass stores physical properties in JS but uses the standard-material native creation path. No physical-property command was found. | Physical-specific appearance is not faithfully transferred. 24 physical material instances were observed; non-default properties need individual inventory. |
| onBeforeShadow/onAfterShadow | Application installs shadow callbacks; the runtime does not dispatch these hooks around native shadow draws. | Per-shadow uniform/state changes cannot match Three.js. |
| Built-in alpha-test coverage | Fixed: alphaToCoverage now selects a distinct shader program with ALPHA_TO_COVERAGE, and both native alpha-test chunk versions use derivative-smoothed coverage. | GPU regression verifies partial built-in edge coverage and restoration of hard alpha testing when disabled. Full foliage visual parity remains unverified. |
| Viewport/scissor APIs | WebGLRenderer setViewport/setScissor/setScissorTest are no-ops. Target viewport/scissor data is a separate implemented path. | Explicit renderer viewport/scissor requests are not supported. |
| Transparent sorting | JS defaults sortObjects=true; native runtime sets sortObjects=false. | Ordering can differ even when shader state is correct. |
| MRT/cube MSAA | GLTextures.getRenderTargetSamples explicitly returns zero for multiple color attachments and cube textures. | Requested MSAA is silently disabled on these branches. They were not established as active Ashore four-sample paths in this run. |
| Capability reporting | Most capabilities remain fixed values. Only actual default-framebuffer samples were corrected here. | maxSamples/extensions/limits cannot be treated as verified driver capabilities. |
| Shadow camera variants | Directional projection/target and shadow settings have native paths. Point/spot shadow camera update parity and cloned shadow-camera settings are not fully tested. | Night/point-light correctness is not certified. |
| Directional shadow projection | Fixed: the command now transfers orthographic bounds, zoom and perspective fov/aspect alongside the matrix; JS refreshes projection on first allocation and size changes. Native capture records scale 0.012821 and depth scale -0.008032, matching application bounds +/-78 and near/far 1/250. | GPU regression compares all projection components after first allocation and resize. The initial single-view visual conclusion was insufficient: the user reproduced the boundary afterwards. The additional stale-texture-array fix above was necessary; a later live capture shows foliage shadows replacing the broad band. Other shadow callbacks and variants remain separate open items. |
| Environment/PMREM | Environment textures, scene intensity/rotation and PMREM have implementation paths and were exercised during startup. | No numerical reference comparison yet; lighting parity remains unverified. |
| Shader hooks and invalidation | Custom hooks, defines and versioned source rebuilding exist and were exercised. | All hook compositions, shared-material per-object uniforms, and custom cache-key changes are not certified. |
| Texture/depth paths | Byte/float/half-float textures and render targets were observed. | Full depth resolve, all formats, mip selection and every color-space combination still require dedicated reference tests. |
| HTML | Default runtime uses the interaction bridge; experimental painter is disabled. | Layout, fonts and full page composition are not browser-equivalent. |
| Performance | Previous uninstru­mented exploration was approximately 18–19 updates/s. | Not resolved; do not use native presentation FPS or instrumented audit FPS as application-performance proof. |

## Validation

`npm --prefix ThreeBrowserRuntime test` with `THREEBROWSER_RUN_GPU_TESTS=1`: 56 tests passed after the fixes above. Native stage rebuilt successfully. An additional fresh-process antialias=false check returned samples=0. Live captures were inspected in preceding verification and must be inspected again for any later rendering change.

Only the previously authorized raw pointer-lock option was changed in the application export. No application shaders or logic were embedded into the runtime. This document records failures explicitly; it must not be presented as an all-paths pass or one-to-one visual certification.
