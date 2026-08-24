import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createObservatoryHud } from "./hud.mjs";
import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "./native-reflections.mjs";
import { observatoryClock, palette } from "./materials.mjs";
import { createMarbleDropSystem } from "./marbles.mjs";
import { collectStaticReflectionScene } from "./rtx-scene.mjs";
import { buildLightTransportObservatory } from "./scene.mjs";

document.title = "RTX Light Transport Observatory — ThreeBrowser Runtime";

const MAX_INTERNAL_PIXELS = 6_300_000;
const MAX_INTERNAL_RATIO = 2.35;

function chooseInternalRatio(width, height) {
  const viewportPixels = Math.max(1, width * height);
  const displayRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  return Math.max(
    1,
    Math.min(MAX_INTERNAL_RATIO, displayRatio, Math.sqrt(MAX_INTERNAL_PIXELS / viewportPixels)),
  );
}

function addEnvironmentPanel(scene, size, position, rotation, colorValue, intensity) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(colorValue).multiplyScalar(intensity),
    side: THREE.DoubleSide,
    fog: false,
  });
  material.toneMapped = false;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  panel.position.set(...position);
  panel.rotation.set(...rotation);
  scene.add(panel);
}

function createObservatoryEnvironment(renderer, { mirrorSafe = false } = {}) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x020508);
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(32, 18, 34),
    new THREE.MeshBasicNodeMaterial({
      color: mirrorSafe ? 0x182329 : 0x10171b,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  room.position.y = 2.5;
  environmentScene.add(room);

  // Diffuse room lighting keeps the authored photography cards. Specular
  // materials use a second, card-free PMREM so those off-camera helpers cannot
  // appear as rectangles in mirrors, metals, or the polished floor.
  if (!mirrorSafe) {
    addEnvironmentPanel(environmentScene, [11, 0.45], [0, 7.1, -12], [0, 0, 0], 0xffb66e, 8.5);
    addEnvironmentPanel(environmentScene, [5.5, 8], [-13.2, 2.5, 1], [0, Math.PI * 0.5, 0], 0x72dbf1, 6.3);
    addEnvironmentPanel(environmentScene, [5.5, 8], [13.2, 2.2, 2], [0, -Math.PI * 0.5, 0], 0xffa15d, 6.8);
    addEnvironmentPanel(environmentScene, [7.5, 0.28], [0, -5.2, 3.5], [Math.PI * 0.5, 0, 0], 0x9ac5d2, 3.2);
    addEnvironmentPanel(environmentScene, [2.2, 8.5], [4.2, 2.0, 13.5], [0, Math.PI, 0], 0xeaf6f7, 3.6);
  }

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.03,
    0.1,
    80,
    { size: 192, position: new THREE.Vector3(0, 2.6, 0) },
  );
  generator.dispose();
  environmentScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

async function createProjectReflectionPipeline(rtx) {
  if (!rtx?.capabilities?.rayQuery || typeof rtx.createRayQueryPipeline !== "function") return null;
  try {
    const shaderUrl = new URL("../shaders/observatory_reflections.spv", import.meta.url);
    const response = await fetch(shaderUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${shaderUrl.pathname}`);
    const code = await response.arrayBuffer();
    const pipeline = rtx.createRayQueryPipeline({
      profile: "reflections-v2",
      code,
      entryPoint: "main",
      label: "Observatory deterministic multi-bounce reflections",
    });
    console.log(
      `[Light Transport Observatory] Project reflection pipeline ready` +
      ` · ${pipeline.codeByteLength.toLocaleString()} bytes` +
      " · 2 bounce balanced / 3 bounce cinematic.",
    );
    return pipeline;
  } catch (error) {
    console.warn(
      `[Light Transport Observatory] Project shader unavailable; using the generic bridge pipeline: ${error?.message || error}`,
    );
    return null;
  }
}

function reportRtxStatus(rtx, pipeline) {
  const capabilities = rtx?.capabilities ?? {};
  console.log(
    `[Light Transport Observatory] RTX=${Boolean(capabilities.rtx)}` +
    ` · adapter=${capabilities.adapterName || "unknown"}` +
    ` · rayQuery=${Boolean(capabilities.rayQuery ?? capabilities.nativeRayTracing)}` +
    ` · shader=${pipeline ? "project multi-bounce" : "generic bridge fallback"}`,
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Native WebGPU is required; Light Transport Observatory has no WebGL fallback.");
  }

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  let internalRatio = chooseInternalRatio(innerWidth, innerHeight);
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(palette.void, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
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
    console.error("[Light Transport Observatory WebGPU]", event.error?.message || event.error || event);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const previousReflexMode = rtx?.reflexMode ?? 0;
  const reflectionPipeline = await createProjectReflectionPipeline(rtx);
  reportRtxStatus(rtx, reflectionPipeline);

  const scene = new THREE.Scene();
  scene.name = "Light Transport Observatory world";
  scene.background = new THREE.Color(palette.void);
  scene.fog = new THREE.FogExp2(0x060b0f, 0.0075);

  const camera = new THREE.PerspectiveCamera(
    47,
    innerWidth / Math.max(1, innerHeight),
    0.035,
    180,
  );
  camera.position.set(0, 2.2, 10.8);
  camera.lookAt(0, 2.2, -8.7);

  const environmentTarget = createObservatoryEnvironment(renderer);
  const mirrorEnvironmentTarget = createObservatoryEnvironment(renderer, { mirrorSafe: true });
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.9;
  scene.environmentRotation.y = -0.34;

  const observatory = buildLightTransportObservatory(scene, mirrorEnvironmentTarget.texture);
  const marbles = createMarbleDropSystem(scene);
  prepareReflectionGuideMaterials(scene);

  observatory.sun.updateWorldMatrix(true, false);
  observatory.sun.target.updateWorldMatrix(true, false);
  const sunPosition = observatory.sun.getWorldPosition(new THREE.Vector3());
  const sunTarget = observatory.sun.target.getWorldPosition(new THREE.Vector3());
  const raySunDirection = sunPosition.sub(sunTarget).normalize();

  const internalRenderSize = (scale = 1) => new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * internalRatio * scale)),
    Math.max(1, Math.round(innerHeight * internalRatio * scale)),
  );
  const drawingBufferSize = () => renderer.getDrawingBufferSize(new THREE.Vector2());

  const reflectionRenderer = new NativeReflectionRenderer(
    renderer,
    camera,
    rtx,
    reflectionPipeline,
  );
  let staticReflectionScene = null;
  if (typeof rtx?.evaluateRayReflections === "function") {
    try {
      staticReflectionScene = collectStaticReflectionScene(
        observatory.staticRoots,
        observatory.staticLights,
      );
      staticReflectionScene.instanceGroups = [marbles.rtxInstanceGroup];
    } catch (error) {
      console.warn(`[Light Transport Observatory] Static scene failed: ${error?.message || error}`);
    }
  }
  // configure() receives the real presentation extent. The adaptive renderer
  // owns the lower internal DLSS quality resolution; pre-scaling it here would
  // make the final output smaller than the window and invalidate FG/UI inputs.
  const initialSize = drawingBufferSize();
  const nativeConfigured = staticReflectionScene
    ? await reflectionRenderer.configure(initialSize.x, initialSize.y, staticReflectionScene)
    : false;

  const state = {
    autoCamera: true,
    lightPath: true,
    cinematic: true,
    nativeReflections: nativeConfigured,
    dragging: false,
    pointerTarget: new THREE.Vector2(),
    pointer: new THREE.Vector2(),
    previousPointer: new THREE.Vector2(),
    orbitTarget: new THREE.Vector2(),
    orbit: new THREE.Vector2(),
    dollyTarget: 1,
    dolly: 1,
    preset: 0,
  };

  const nativeRtxAvailable = Boolean(
    rtx && (rtx.capabilities?.rayQuery ?? rtx.capabilities?.nativeRayTracing),
  );
  let hud = null;
  hud = createObservatoryHud({
    renderer,
    nativeRtxAvailable,
    nativeReflectionsActive: nativeConfigured,
    onAutoCamera: enabled => { state.autoCamera = enabled; },
    onLightPath: enabled => { state.lightPath = enabled; },
    onReflectionQuality: enabled => {
      state.cinematic = enabled;
      if (state.nativeReflections) {
        reflectionRenderer.resetTemporalHistory("reflection quality changed");
      }
    },
  });

  const presets = [
    { position: [0, 2.15, 10.8], target: [0, 2.15, -8.7], fov: 50 },
    { position: [-6.8, 1.15, 7.5], target: [1.8, 1.3, -8.5], fov: 43 },
    { position: [7.4, 2.7, 4.0], target: [-7.8, 2.7, -5.5], fov: 45 },
    { position: [0, 3.9, 7.8], target: [0, 3.0, -11.8], fov: 38 },
  ];
  const tourPositions = new THREE.CatmullRomCurve3(
    presets.map(preset => new THREE.Vector3(...preset.position)),
    true,
    "centripetal",
    0.35,
  );
  const tourTargets = new THREE.CatmullRomCurve3(
    presets.map(preset => new THREE.Vector3(...preset.target)),
    true,
    "centripetal",
    0.35,
  );

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  function disableTour() {
    if (!state.autoCamera) return;
    state.autoCamera = false;
    hud.buttons[0].setActive(false);
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
    state.orbitTarget.x = THREE.MathUtils.clamp(state.orbitTarget.x - dx * 0.0031, -1.05, 1.05);
    state.orbitTarget.y = THREE.MathUtils.clamp(state.orbitTarget.y + dy * 0.0025, -0.48, 0.5);
    disableTour();
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.dollyTarget = THREE.MathUtils.clamp(
      state.dollyTarget + Math.sign(event.deltaY) * 0.07,
      0.72,
      1.34,
    );
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === "Space" || event.key === " ") {
      marbles.spawn();
      reflectionRenderer.resetTemporalHistory("marble spawned");
      event.preventDefault?.();
      return;
    }
    // Ignore every non-numeric key before touching the camera preset. In
    // particular, the Runtime owns Shift+Tab for its overlay; parsing `Shift`
    // produced NaN and left state.preset pointing at an undefined entry.
    const presetNumber = Number.parseInt(event.key, 10);
    if (!Number.isInteger(presetNumber)) return;
    const index = presetNumber - 1;
    if (index < 0 || index >= presets.length) return;
    state.preset = index;
    state.orbitTarget.set(0, 0);
    disableTour();
    reflectionRenderer.resetTemporalHistory("camera preset changed");
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);

  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const lookTarget = new THREE.Vector3(...presets[0].target);
  const basePosition = new THREE.Vector3();
  const baseTarget = new THREE.Vector3();
  const offset = new THREE.Vector3();
  function updateCamera(time, delta) {
    const smoothing = 1 - Math.exp(-delta * 5.8);
    state.pointer.lerp(state.pointerTarget, smoothing);
    state.orbit.lerp(state.orbitTarget, smoothing);
    state.dolly = THREE.MathUtils.lerp(state.dolly, state.dollyTarget, smoothing);

    if (state.autoCamera) {
      const phase = (time / 62) % 1;
      const eased = THREE.MathUtils.smoothstep(phase, 0, 1);
      tourPositions.getPointAt(eased, basePosition);
      tourTargets.getPointAt(eased, baseTarget);
      const fovBlend = (Math.sin(phase * Math.PI * 2 - Math.PI * 0.5) + 1) * 0.5;
      camera.fov = THREE.MathUtils.lerp(41, 48, fovBlend);
    } else {
      const preset = presets[state.preset];
      basePosition.set(...preset.position);
      baseTarget.set(...preset.target);
      camera.fov = THREE.MathUtils.lerp(camera.fov, preset.fov, smoothing);
    }

    offset.copy(basePosition).sub(baseTarget);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.orbit.x);
    const right = new THREE.Vector3().crossVectors(offset, new THREE.Vector3(0, 1, 0)).normalize();
    offset.applyAxisAngle(right, state.orbit.y);
    offset.multiplyScalar(state.dolly);
    desiredPosition.copy(baseTarget).add(offset);
    desiredPosition.x += state.pointer.x * 0.08;
    desiredPosition.y += state.pointer.y * 0.05;
    desiredTarget.copy(baseTarget);

    camera.position.lerp(desiredPosition, smoothing * 0.72);
    lookTarget.lerp(desiredTarget, smoothing * 0.82);
    camera.lookAt(lookTarget);
    camera.updateProjectionMatrix();
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    internalRatio = chooseInternalRatio(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    hud.resize(width, height);
    if (state.nativeReflections) {
      const size = drawingBufferSize();
      if (!reflectionRenderer.resize(size.x, size.y)) {
        state.nativeReflections = false;
        hud.setNativeReflectionsActive(false);
      }
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

  let previousTime = performance.now();
  let elapsed = 0;
  let adaptiveStatusFrame = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
    previousTime = now;
    elapsed += delta;
    observatoryClock.value = elapsed;
    updateCamera(elapsed, delta);
    observatory.update(elapsed, delta);
    marbles.update(delta);

    let nativeRendered = false;
    if (state.nativeReflections) {
      reflectionRenderer.updateInstanceGroups([
        marbles.rayTracingInstanceUpdate(),
      ]);
      nativeRendered = reflectionRenderer.render(scene, camera, {
        directionalLightDirection: raySunDirection,
        reflectionStrength: state.lightPath ? 1.10 : 0.92,
        maxDistance: 165,
        rayBias: 0.008,
        roughnessCutoff: state.cinematic ? 0.9 : 0.72,
        environmentColor: [0.011, 0.025, 0.036],
        environmentIntensity: state.lightPath ? 0.92 : 0.72,
        highQuality: state.cinematic,
      });
    }

    if (!nativeRendered) {
      if (state.nativeReflections) {
        state.nativeReflections = false;
        hud.setNativeReflectionsActive(false);
        console.warn("[Light Transport Observatory] Native transport stopped; raster presentation restored.");
      }
      const size = internalRenderSize();
      const rasterRendered = reflectionRenderer.renderRaster(
        scene,
        camera,
        size.x,
        size.y,
      );
      const hudTexture = hud.renderToTexture();
      if (!rasterRendered ||
          !reflectionRenderer.present(hudTexture, reflectionRenderer.rasterTarget?.texture)) {
        // Last-resort canvas path for hosts that cannot allocate an FP16
        // offscreen target. Normal native and raster operation each submit
        // exactly one composited canvas frame.
        renderer.setRenderTarget(null);
        renderer.setMRT(null);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
        renderer.clearDepth();
        hud.render();
      }
    } else {
      const hudTexture = hud.renderToTexture();
      if (!reflectionRenderer.present(hudTexture)) {
        state.nativeReflections = false;
        hud.setNativeReflectionsActive(false);
      }
    }

    // Streamline status is asynchronous. Updating at a low cadence keeps the
    // bitmap HUD cheap while reporting ACTIVE features rather than capability.
    if ((adaptiveStatusFrame++ % 15) === 0) {
      hud.setAdaptiveStatus(reflectionRenderer.getAdaptiveStatus());
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
    hud.dispose();
    marbles.dispose();
    reflectionRenderer.dispose();
    reflectionPipeline?.destroy?.();
    environmentTarget.dispose();
    mirrorEnvironmentTarget.dispose();
    if (rtx?.capabilities?.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    scene.traverse(object => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    renderer.dispose();
  });
}

await main();
