function collectTextures(value, textures, visited, depth = 0) {
  if (!value || typeof value !== "object" || depth > 24) return;
  if (value.isTexture) {
    textures.add(value);
    return;
  }
  if (visited.has(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectTextures(entry, textures, visited, depth + 1);
    return;
  }
  if (value instanceof Map || value instanceof Set) {
    for (const entry of value.values()) collectTextures(entry, textures, visited, depth + 1);
    return;
  }
  // Node materials keep virtual-interior TextureNodes below colorNode rather
  // than in Material.map. Walk the bounded material/node graph so those maps,
  // ordinary PBR slots and ShaderMaterial uniforms share one preload path.
  for (const key of Object.keys(value)) {
    if (key === "parent" || key === "children" || key === "geometry") continue;
    collectTextures(value[key], textures, visited, depth + 1);
  }
}

function textureSourceReady(texture) {
  const source = texture?.source?.data ?? texture?.image ?? null;
  if (Array.isArray(source)) return source.length > 0 && source.every(value => value != null);
  return source != null;
}

function textureLabel(texture) {
  return String(texture?.name || texture?.source?.data?.name || texture?.uuid || "unnamed texture");
}

function snapshotObjects(scene) {
  const states = [];
  const materials = new Set();
  const textures = new Set();
  scene?.traverse?.(object => {
    states.push({ object, visible: object.visible, frustumCulled: object.frustumCulled });
    if (Array.isArray(object.material)) object.material.forEach(value => materials.add(value));
    else if (object.material) materials.add(object.material);
    if (object.isLight && object.map) textures.add(object.map);
  });
  const visited = new WeakSet();
  for (const material of materials) collectTextures(material, textures, visited);
  collectTextures(scene?.background, textures, visited);
  collectTextures(scene?.environment, textures, visited);
  return { states, materials, textures };
}

function revealAll(states) {
  for (const state of states) {
    state.object.visible = true;
    if ("frustumCulled" in state.object) state.object.frustumCulled = false;
  }
}

function restoreObjects(states) {
  for (const state of states) {
    state.object.visible = state.visible;
    state.object.frustumCulled = state.frustumCulled;
  }
}

/**
 * Forces authored render branches through their real render-target formats
 * before play. WebGPU does not expose a portable serialized pipeline cache,
 * and normal scene compilation skips hidden effects/viewmodels. This routine
 * warms both the current state and explicit reveal-all states while preserving
 * every object and renderer property it touches.
 */
export async function warmRendererPipelines(renderer, passes = []) {
  if (!renderer?.render) throw new TypeError("warmRendererPipelines requires a renderer");
  const previousTarget = renderer.getRenderTarget?.() ?? null;
  const previousMrt = renderer.getMRT?.() ?? null;
  const previousToneMapping = renderer.toneMapping;
  const previousExposure = renderer.toneMappingExposure;
  const previousAutoClear = renderer.autoClear;
  const started = Number(globalThis.performance?.now?.() ?? Date.now());
  const results = [];
  const discoveredTextures = new Set();
  const explicitlyInitializedTextures = new Set();
  try {
    for (const definition of passes) {
      if (!definition?.scene || !definition?.camera) continue;
      let preparedCleanup = null;
      let snapshot = null;
      try {
        preparedCleanup = await definition.prepare?.();
        snapshot = snapshotObjects(definition.scene);
        if (definition.revealAll) revealAll(snapshot.states);
        if (definition.toneMapping !== undefined) renderer.toneMapping = definition.toneMapping;
        if (definition.exposure !== undefined) renderer.toneMappingExposure = definition.exposure;
        renderer.autoClear = false;
        renderer.setMRT?.(null);
        renderer.setRenderTarget?.(definition.target ?? null);
        let passExplicitUploads = 0;
        for (const texture of snapshot.textures) {
          discoveredTextures.add(texture);
          if (explicitlyInitializedTextures.has(texture) || typeof renderer.initTexture !== "function") continue;
          // initTexture performs the CPU-to-GPU upload (and mip generation)
          // now. The reveal-all render still consumes the texture through its
          // real material, and the caller's final queue drain retires both.
          renderer.initTexture(texture);
          explicitlyInitializedTextures.add(texture);
          passExplicitUploads += 1;
        }
        const compileMode = definition.compileMode === "render" ? "render" : "async";
        // Three r184's WebGPU compileAsync path deliberately yields once per
        // render item. That is useful while an interactive page is animating,
        // but a reveal-all startup graph with thousands of objects can spend
        // seconds waiting for requestAnimationFrame even when those objects
        // share already-created pipelines. In render mode the real warm render
        // below synchronously creates every missing pipeline for this target
        // format, uploads/binds the resources and submits the same coverage.
        if (compileMode === "async") {
          if (typeof renderer.compileAsync === "function") await renderer.compileAsync(definition.scene, definition.camera);
          else renderer.compile?.(definition.scene, definition.camera);
        }
        const renderCount = Math.max(1, Math.min(4, Math.trunc(Number(definition.settleFrames) || 1)));
        for (let index = 0; index < renderCount; ++index) {
          renderer.clear?.(true, definition.clearDepth !== false, true);
          renderer.render(definition.scene, definition.camera);
        }
        results.push(Object.freeze({
          label: String(definition.label ?? `pass-${results.length + 1}`),
          revealAll: Boolean(definition.revealAll),
          objects: snapshot.states.length,
          materials: snapshot.materials.size,
          textures: snapshot.textures.size,
          textureSourcesReady: [...snapshot.textures].reduce((count, texture) => count + Number(textureSourceReady(texture)), 0),
          explicitTextureUploads: passExplicitUploads,
          textureNames: Object.freeze([...snapshot.textures].map(textureLabel).sort()),
          renders: renderCount,
          compileMode,
        }));
      } finally {
        if (snapshot) restoreObjects(snapshot.states);
        if (typeof preparedCleanup === "function") await preparedCleanup();
        await definition.restore?.();
      }
    }
  } finally {
    renderer.setRenderTarget?.(previousTarget);
    renderer.setMRT?.(previousMrt);
    renderer.toneMapping = previousToneMapping;
    renderer.toneMappingExposure = previousExposure;
    renderer.autoClear = previousAutoClear;
  }
  const finished = Number(globalThis.performance?.now?.() ?? Date.now());
  const pendingTextureSources = [...discoveredTextures]
    .filter(texture => !textureSourceReady(texture))
    .map(textureLabel)
    .sort();
  return Object.freeze({
    ready: true,
    policy: "startup-preload-all-authored-branches",
    passes: Object.freeze(results),
    durationMs: Math.max(0, finished - started),
    storage: "memory-only",
    diskCache: false,
    textureStorage: "memory-only",
    textureDiskCache: false,
    renderDrivenPasses: results.reduce((count, value) => count + Number(value.compileMode === "render"), 0),
    asyncCompilePasses: results.reduce((count, value) => count + Number(value.compileMode === "async"), 0),
    textureUploadPolicy: typeof renderer.initTexture === "function"
      ? "explicit-initTexture-plus-real-render"
      : "real-render-discovery",
    textures: discoveredTextures.size,
    textureSourcesReady: discoveredTextures.size - pendingTextureSources.length,
    explicitTextureUploads: explicitlyInitializedTextures.size,
    allTextureSourcesReady: pendingTextureSources.length === 0,
    pendingTextureSources: Object.freeze(pendingTextureSources),
    objects: Math.max(0, ...results.map(value => value.objects)),
    materials: Math.max(0, ...results.map(value => value.materials)),
  });
}
