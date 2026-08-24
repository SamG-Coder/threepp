import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "../../webgpu_rtx_light_transport_observatory/src/native-reflections.mjs";
import { collectStaticReflectionScene } from "../../webgpu_rtx_light_transport_observatory/src/rtx-scene.mjs";
import {
  createMegacityMaterials,
  disposeMegacityMaterials,
  palette,
} from "./materials.mjs";
import { buildMegacityOverlook } from "./scene.mjs";

document.title = "RTX Megacity Overlook — ThreeBrowser Runtime";

const MAX_RASTER_PIXELS = 6_300_000;
const MAX_RASTER_RATIO = 2.25;
const REFERENCE_TARGET = new THREE.Vector3(-40, 125, -1750);

function chooseRasterRatio(width, height) {
  const viewportPixels = Math.max(1, width * height);
  const displayRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  return Math.max(
    1,
    Math.min(MAX_RASTER_RATIO, displayRatio, Math.sqrt(MAX_RASTER_PIXELS / viewportPixels)),
  );
}

function createSkyDome(scene) {
  const geometry = new THREE.SphereGeometry(4400, 48, 24);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const upper = new THREE.Color(0x07090a);
  const horizon = new THREE.Color(0x2a1711);
  const lower = new THREE.Color(0x071319);
  const sample = new THREE.Color();
  for (let index = 0; index < position.count; ++index) {
    const normalizedY = THREE.MathUtils.clamp(position.getY(index) / 4400, -1, 1);
    if (normalizedY >= 0) {
      const blend = Math.pow(normalizedY, 0.62);
      sample.copy(horizon).lerp(upper, blend);
    } else {
      sample.copy(horizon).lerp(lower, Math.pow(-normalizedY, 0.42));
    }
    colors[index * 3] = sample.r;
    colors[index * 3 + 1] = sample.g;
    colors[index * 3 + 2] = sample.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicNodeMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  material.name = "JS-authored storm gradient sky";
  material.toneMapped = true;
  material.rtxReflectionMask = 0;
  material.userData.rtxIgnore = true;
  const sky = new THREE.Mesh(geometry, material);
  sky.name = "Storm ceiling panorama dome";
  sky.position.set(0, 300, -1750);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.userData.rtxIgnore = true;
  scene.add(sky);
  return sky;
}

function addEnvironmentPanel(scene, size, position, rotation, colorValue, intensity) {
  const color = new THREE.Color(colorValue).multiplyScalar(intensity);
  const material = new THREE.MeshBasicNodeMaterial({ color, side: THREE.DoubleSide, fog: false });
  material.toneMapped = false;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  panel.position.set(...position);
  panel.rotation.set(...rotation);
  scene.add(panel);
}

function createMegacityEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x020507);
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(80, 52, 100),
    new THREE.MeshBasicNodeMaterial({ color: 0x071015, side: THREE.BackSide, fog: false }),
  );
  shell.position.set(0, 4, -18);
  environmentScene.add(shell);
  addEnvironmentPanel(environmentScene, [16, 18], [-30, 5, -20], [0, Math.PI * 0.5, 0], 0x2e8390, 2.8);
  addEnvironmentPanel(environmentScene, [20, 11], [29, 10, -30], [0, -Math.PI * 0.5, 0], 0xb4542e, 3.8);
  addEnvironmentPanel(environmentScene, [26, 8], [3, 19, -46], [0, 0, 0], 0xffb36a, 3.4);
  addEnvironmentPanel(environmentScene, [34, 3], [0, -17, -14], [Math.PI * 0.5, 0, 0], 0x2d7280, 2.3);
  addEnvironmentPanel(environmentScene, [5, 15], [-18, 1, -43], [0, 0, 0], 0xd42d22, 1.5);

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.045,
    0.1,
    120,
    { size: 192, position: new THREE.Vector3(0, 3, -20) },
  );
  generator.dispose();
  environmentScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

async function loadDisplayAtlas(renderer) {
  const url = new URL("../assets/megacity-display-atlas.png", import.meta.url).href;
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.name = "Original generated megacity display atlas";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(16, renderer.capabilities?.getMaxAnisotropy?.() ?? 16);
  texture.needsUpdate = true;
  return texture;
}

function reportCapabilities(rtx) {
  const capabilities = rtx?.capabilities ?? {};
  console.log(
    `[Megacity Overlook] adapter=${capabilities.adapterName || "unknown"}` +
    ` · RTX=${Boolean(capabilities.rtx)}` +
    ` · nativeTraversal=${Boolean(capabilities.rayQuery ?? capabilities.nativeRayTracing)}` +
    " · bridge=generic Observatory transport",
  );
  console.log(
    "[Megacity Overlook] Controls: A slow camera drift · 1–4 compositions · " +
    "T aerial traffic · F shaped fog · Q max/balanced RTX · drag orbit · wheel dolly",
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Native WebGPU is required; RTX Megacity Overlook has no WebGL fallback.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#020506";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  let rasterRatio = chooseRasterRatio(innerWidth, innerHeight);
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x020506, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error("WebGPURenderer did not initialize its WebGPU backend.");
  }
  renderer.backend.device?.addEventListener?.("uncapturederror", event => {
    console.error("[Megacity Overlook WebGPU]", event.error?.message || event.error || event);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const previousReflexMode = rtx?.reflexMode ?? 0;
  reportCapabilities(rtx);

  const scene = new THREE.Scene();
  scene.name = "JS-authored RTX megacity overlook";
  scene.background = new THREE.Color(0x08090a);
  scene.fog = new THREE.FogExp2(0x172126, 0.0004);

  const camera = new THREE.PerspectiveCamera(
    29,
    innerWidth / Math.max(1, innerHeight),
    1,
    5200,
  );
  camera.position.set(0, 260, 760);
  camera.lookAt(REFERENCE_TARGET);

  const sky = createSkyDome(scene);
  const environmentTarget = createMegacityEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.68;
  scene.environmentRotation.y = -0.35;

  const atlasTexture = await loadDisplayAtlas(renderer);
  const materials = createMegacityMaterials({ renderer, atlasTexture });
  const overlook = buildMegacityOverlook(scene, camera, materials);
  prepareReflectionGuideMaterials(scene);

  overlook.stormLight.updateWorldMatrix(true, false);
  overlook.stormLight.target.updateWorldMatrix(true, false);
  const stormPosition = overlook.stormLight.getWorldPosition(new THREE.Vector3());
  const stormTarget = overlook.stormLight.target.getWorldPosition(new THREE.Vector3());
  const rayStormDirection = stormPosition.sub(stormTarget).normalize();

  const reflectionRenderer = new NativeReflectionRenderer(renderer, camera, rtx, null);
  let staticReflectionScene = null;
  if (typeof rtx?.evaluateRayReflections === "function") {
    try {
      staticReflectionScene = collectStaticReflectionScene(
        overlook.staticRoots,
        overlook.staticLights,
      );
      if (overlook.instanceGroups.length > 0) {
        staticReflectionScene.instanceGroups = overlook.instanceGroups;
      }
      console.log(
        `[Megacity Overlook] RTX proxy=${staticReflectionScene.triangleCount.toLocaleString()} triangles` +
        ` / ${staticReflectionScene.vertexCount.toLocaleString()} vertices` +
        ` / ${overlook.instanceGroups.length} dynamic instance group`,
      );
    } catch (error) {
      console.warn(`[Megacity Overlook] Static RTX proxy failed: ${error?.message || error}`);
    }
  }

  const displaySize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const nativeConfigured = staticReflectionScene
    ? await reflectionRenderer.configure(displaySize.x, displaySize.y, staticReflectionScene)
    : false;
  overlook.setNativeMode(nativeConfigured);

  const state = {
    autoCamera: true,
    maxQuality: true,
    traffic: true,
    fog: true,
    nativeReflections: nativeConfigured,
    preset: 0,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    pointer: new THREE.Vector2(),
    orbitTarget: new THREE.Vector2(),
    orbit: new THREE.Vector2(),
    dollyTarget: 1,
    dolly: 1,
  };

  const presets = [
    { position: [0, 260, 760], target: [-40, 125, -1750], fov: 29 },
    { position: [-300, 292, 610], target: [20, 155, -2130], fov: 30 },
    { position: [170, 205, 620], target: [-85, 92, -1480], fov: 30.5 },
    { position: [-105, 342, 845], target: [120, 185, -2350], fov: 27.5 },
  ];

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  function stopDrift(reason) {
    if (!state.autoCamera) return;
    state.autoCamera = false;
    reflectionRenderer.resetTemporalHistory(reason);
  }

  function onPointerDown(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    state.pointerTarget.copy(pointerNdc(event));
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.previousPointer.set(event.clientX, event.clientY);
    state.orbitTarget.x = THREE.MathUtils.clamp(state.orbitTarget.x - dx * 0.0015, -0.22, 0.22);
    state.orbitTarget.y = THREE.MathUtils.clamp(state.orbitTarget.y + dy * 0.00125, -0.13, 0.16);
    stopDrift("camera drag");
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.dollyTarget = THREE.MathUtils.clamp(state.dollyTarget + Math.sign(event.deltaY) * 0.045, 0.83, 1.20);
    stopDrift("camera dolly");
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "a") {
      state.autoCamera = !state.autoCamera;
      state.orbitTarget.set(0, 0);
      reflectionRenderer.resetTemporalHistory("slow camera drift toggled");
      console.log(`[Megacity Overlook] camera drift=${state.autoCamera ? "on" : "off"}`);
      return;
    }
    if (key === "t") {
      state.traffic = !state.traffic;
      overlook.setTrafficEnabled(state.traffic);
      reflectionRenderer.resetTemporalHistory("aerial traffic toggled");
      console.log(`[Megacity Overlook] aerial traffic=${state.traffic ? "on" : "off"}`);
      return;
    }
    if (key === "f") {
      state.fog = !state.fog;
      overlook.setFogEnabled(state.fog);
      console.log(`[Megacity Overlook] shaped fog=${state.fog ? "on" : "off"}`);
      return;
    }
    if (key === "q") {
      state.maxQuality = !state.maxQuality;
      reflectionRenderer.resetTemporalHistory("RTX quality changed");
      console.log(`[Megacity Overlook] RTX=${state.maxQuality ? "MAX" : "balanced"}`);
      return;
    }
    const number = Number.parseInt(event.key, 10);
    if (!Number.isInteger(number) || number < 1 || number > presets.length) return;
    state.preset = number - 1;
    state.autoCamera = false;
    state.orbitTarget.set(0, 0);
    state.dollyTarget = 1;
    reflectionRenderer.resetTemporalHistory("composition preset cut");
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);

  const basePosition = new THREE.Vector3();
  const baseTarget = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const lookTarget = REFERENCE_TARGET.clone();
  const offset = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();

  function updateCamera(elapsed, delta) {
    const smoothing = 1 - Math.exp(-delta * 5.8);
    state.pointer.lerp(state.pointerTarget, smoothing);
    state.orbit.lerp(state.orbitTarget, smoothing);
    state.dolly = THREE.MathUtils.lerp(state.dolly, state.dollyTarget, smoothing);
    const preset = presets[state.preset];
    basePosition.set(...preset.position);
    baseTarget.set(...preset.target);
    if (state.autoCamera) {
      basePosition.x += Math.sin(elapsed * 0.058) * 7.5;
      basePosition.y += Math.sin(elapsed * 0.041 + 1.2) * 2.1;
      baseTarget.x += Math.sin(elapsed * 0.051 + 0.8) * 4.5;
    }
    camera.fov = THREE.MathUtils.lerp(camera.fov, preset.fov, smoothing);
    offset.copy(basePosition).sub(baseTarget);
    offset.applyAxisAngle(up, state.orbit.x);
    right.crossVectors(offset, up).normalize();
    offset.applyAxisAngle(right, state.orbit.y);
    offset.multiplyScalar(state.dolly);
    desiredPosition.copy(baseTarget).add(offset);
    desiredPosition.x += state.pointer.x * 3.5;
    desiredPosition.y += state.pointer.y * 1.8;
    desiredTarget.copy(baseTarget);
    camera.position.lerp(desiredPosition, smoothing * 0.62);
    lookTarget.lerp(desiredTarget, smoothing * 0.72);
    camera.lookAt(lookTarget);
    camera.rotateZ(Math.sin(elapsed * 0.034) * 0.0009);
    camera.updateProjectionMatrix();
    sky.position.x = camera.position.x * 0.04;
    sky.position.z = -1750 + camera.position.z * 0.02;
  }

  const rasterRenderSize = () => new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * rasterRatio)),
    Math.max(1, Math.round(innerHeight * rasterRatio)),
  );

  function disableNative(reason) {
    if (!state.nativeReflections) return;
    state.nativeReflections = false;
    overlook.setNativeMode(false);
    console.warn(`[Megacity Overlook] Native transport disabled (${reason}); using raster fallback.`);
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    rasterRatio = chooseRasterRatio(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (state.nativeReflections) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!reflectionRenderer.resize(size.x, size.y)) disableNative("resize failed");
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

  console.log("[Megacity Overlook] systems", overlook.stats);
  let previousTime = performance.now();
  let elapsed = 0;
  let diagnosticElapsed = 0;
  let diagnosticFrames = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.05, wallDelta);
    previousTime = now;
    elapsed += delta;
    diagnosticElapsed += wallDelta;
    diagnosticFrames += 1;

    overlook.update(elapsed, delta);
    updateCamera(elapsed, delta);

    let nativeRendered = false;
    if (state.nativeReflections) {
      const updates = overlook.rayTracingInstanceUpdates();
      if (updates.length > 0 && !reflectionRenderer.updateInstanceGroups(updates)) {
        disableNative("aerial instance refit failed");
      }
      if (state.nativeReflections) {
        nativeRendered = reflectionRenderer.render(scene, camera, {
          directionalLightDirection: rayStormDirection,
          reflectionStrength: state.maxQuality ? 0.78 : 0.65,
          maxDistance: state.maxQuality ? 1600 : 1180,
          rayBias: 0.018,
          roughnessCutoff: 0.84,
          environmentColor: [0.006, 0.016, 0.026],
          environmentIntensity: state.maxQuality ? 0.52 : 0.42,
          highQuality: state.maxQuality,
        });
      }
    }

    if (nativeRendered) {
      if (!reflectionRenderer.present(null)) disableNative("presentation failed");
    } else {
      if (state.nativeReflections) disableNative("render returned false");
      const size = rasterRenderSize();
      const rasterRendered = reflectionRenderer.renderRaster(scene, camera, size.x, size.y);
      if (!rasterRendered || !reflectionRenderer.present(null, reflectionRenderer.rasterTarget?.texture)) {
        renderer.setRenderTarget(null);
        renderer.setMRT(null);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
      }
    }

    if (diagnosticElapsed >= 10) {
      const fps = Math.round(diagnosticFrames / Math.max(0.001, diagnosticElapsed));
      const calls = renderer.info?.render?.drawCalls ?? 0;
      const triangles = renderer.info?.render?.triangles ?? 0;
      console.log(
        `[Megacity Overlook] fps=${fps}` +
        ` · draws=${calls}` +
        ` · triangles=${Number(triangles).toLocaleString()}` +
        ` · transport=${state.nativeReflections ? "native RTX" : "raster"}` +
        ` · quality=${state.maxQuality ? "MAX" : "balanced"}`,
      );
      diagnosticElapsed = 0;
      diagnosticFrames = 0;
    }
  });

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    overlook.dispose();
    reflectionRenderer.dispose();
    environmentTarget.dispose();
    atlasTexture.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
    disposeMegacityMaterials?.();
    if (rtx?.capabilities?.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    renderer.dispose();
  });
}

await main();
