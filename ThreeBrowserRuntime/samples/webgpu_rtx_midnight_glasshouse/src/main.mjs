import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createGlasshouseHud } from "./hud.mjs";
import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "./native-reflections.mjs";
import { palette, waterClock } from "./materials.mjs";
import { collectStaticReflectionScene } from "./rtx-scene.mjs";
import { buildMidnightGlasshouse } from "./scene.mjs";

document.title = "RTX Midnight Glasshouse — ThreeBrowser Runtime";

const MAX_SUPERSAMPLED_PIXELS = 8_300_000;
// A 1280x720 demo window now resolves a true 3840x2160 HDR frame.  The pixel
// budget still tapers this automatically for larger windows, so fullscreen 4K
// never allocates an accidental 12K render target.
const MAX_RENDER_PIXEL_RATIO = 3;

function chooseRenderPixelRatio(width, height) {
  const viewportPixels = Math.max(1, width * height);
  const displayRatio = Math.min(
    Math.max(globalThis.devicePixelRatio || 1, 1),
    MAX_RENDER_PIXEL_RATIO,
  );
  const budgetRatio = Math.sqrt(MAX_SUPERSAMPLED_PIXELS / viewportPixels);
  // Spend the large 720p/1080p headroom on real image quality, but taper the
  // linear scale as the window approaches 4K. The floor of 1 avoids an
  // accidental undersampled fullscreen image.
  return Math.max(1, Math.min(MAX_RENDER_PIXEL_RATIO, Math.max(displayRatio, budgetRatio)));
}

function addEnvironmentPanel(scene, size, position, rotation, color, intensity) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    side: THREE.DoubleSide,
    fog: false,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  panel.position.set(...position);
  panel.rotation.set(...rotation);
  scene.add(panel);
}

function createReflectionEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x02070b);

  const room = new THREE.Mesh(
    new THREE.BoxGeometry(28, 15, 28),
    new THREE.MeshBasicNodeMaterial({
      color: 0x0c151a,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  room.position.y = 2.2;
  environmentScene.add(room);

  addEnvironmentPanel(environmentScene, [7.5, 0.7], [0, 5.7, -9], [0, 0, 0], palette.amber, 8.5);
  addEnvironmentPanel(environmentScene, [4.2, 6.8], [-10.5, 1.8, 0], [0, Math.PI * 0.5, 0], 0x6aa7c2, 5.2);
  addEnvironmentPanel(environmentScene, [3.4, 5.6], [10.5, 0.8, 1], [0, -Math.PI * 0.5, 0], 0xf2c085, 4.8);
  addEnvironmentPanel(environmentScene, [9.5, 0.35], [0, -4.8, 4], [Math.PI * 0.5, 0, 0], 0x82b5c9, 3.6);
  addEnvironmentPanel(environmentScene, [2.0, 8.5], [2.8, 1.7, 10.4], [0, Math.PI, 0], 0xdbe9ed, 2.8);

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.035,
    0.1,
    60,
    { size: 128, position: new THREE.Vector3(0, 2.3, 0) },
  );
  generator.dispose();
  environmentScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

function reportRtxStatus(rtx, status) {
  if (!rtx) {
    console.warn("[Midnight Glasshouse] navigator.gpu.threeBrowserRTX is unavailable; WebGPU reflections remain active.");
    return;
  }
  const capabilities = status?.capabilities ?? rtx.capabilities ?? {};
  const native = status?.features?.nativeRayTracing;
  const reflex = status?.features?.reflex;
  console.log(
    `[Midnight Glasshouse] RTX bridge detected` +
    ` · adapter=${capabilities.adapterName || "unknown"}` +
    ` · nativeRayTraversal=${Boolean(native?.supported ?? capabilities.nativeRayTracing)}` +
    ` · Reflex configured=${Boolean(reflex?.configured)}` +
    ` · Reflex active=${Boolean(reflex?.active)}`,
  );
  console.log(
    `[Midnight Glasshouse] Reflection API=${typeof rtx.evaluateRayReflections === "function" ? "native ray reflections available" : "planar fallback"}` +
    " · fallback uses three public WebGPU planar reflectors plus GGX-prefiltered IBL.",
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Native WebGPU is required; Midnight Glasshouse has no WebGL fallback.");
  }

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  let renderPixelRatio = chooseRenderPixelRatio(innerWidth, innerHeight);
  // The Runtime's native swapchain must stay at the window/display density.
  // RTX supersampling belongs to the offscreen HDR/MRT targets; applying it to
  // renderer.setPixelRatio() enlarges the swapchain viewport and presents only
  // the upper-left portion of the cinematic frame.
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(palette.night, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
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
  const device = renderer.backend.device;
  device?.addEventListener?.("uncapturederror", event => {
    console.error("[Midnight Glasshouse WebGPU validation]", event.error?.message || event.error || event);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  const requestedFeatures = {
    dlssFrameGeneration: false,
    dlssRayReconstruction: false,
  };
  if (capabilities.reflex) requestedFeatures.reflex = "boost";
  const requestedStatus = rtx?.requestFeatures?.(requestedFeatures) ?? rtx?.status ?? null;
  const rtxStatus = rtx?.getStatus?.() ?? requestedStatus;
  reportRtxStatus(rtx, rtxStatus);

  const scene = new THREE.Scene();
  scene.name = "Midnight Glasshouse world";
  scene.background = new THREE.Color(palette.night);
  scene.fog = new THREE.FogExp2(0x07131b, 0.0135);

  const camera = new THREE.PerspectiveCamera(
    49,
    innerWidth / Math.max(1, innerHeight),
    0.04,
    110,
  );
  camera.position.set(4.9, 2.65, 13.8);
  camera.lookAt(0.2, 2.35, -1.2);

  const environmentTarget = createReflectionEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.82;
  scene.environmentRotation.y = -0.48;

  const glasshouse = buildMidnightGlasshouse(scene, environmentTarget.texture);
  prepareReflectionGuideMaterials(scene);

  const internalRenderSize = (scale = 1) => new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * renderPixelRatio * scale)),
    Math.max(1, Math.round(innerHeight * renderPixelRatio * scale)),
  );
  glasshouse.lights.moon.updateWorldMatrix(true, false);
  glasshouse.lights.moon.target.updateWorldMatrix(true, false);
  const rayMoonPosition = glasshouse.lights.moon.getWorldPosition(new THREE.Vector3());
  const rayMoonTarget = glasshouse.lights.moon.target.getWorldPosition(new THREE.Vector3());
  const rayMoonDirection = rayMoonPosition.sub(rayMoonTarget).normalize();

  const reflectionRenderer = new NativeReflectionRenderer(renderer, camera, rtx);
  let staticReflectionScene = null;
  if (typeof rtx?.evaluateRayReflections === "function") {
    try {
      staticReflectionScene = collectStaticReflectionScene([
        glasshouse.architecture.architecture,
        glasshouse.pool.poolGroup,
        glasshouse.exterior,
        ...glasshouse.lights.fixtureGeometry,
      ], [
        ...glasshouse.lights.fixtures,
        ...glasshouse.lights.windowBeams,
        glasshouse.lights.sculptureSpot,
      ]);
    } catch (error) {
      console.warn(`[RTX reflections] Static-scene collection failed: ${error?.message || error}`);
    }
  }
  const initialBufferSize = internalRenderSize();
  const nativeReflectionsConfigured = staticReflectionScene
    ? await reflectionRenderer.configure(initialBufferSize.x, initialBufferSize.y, staticReflectionScene)
    : false;
  glasshouse.setNativeReflectionMode(nativeReflectionsConfigured);

  const state = {
    autoCamera: true,
    rain: true,
    fullReflections: true,
    dragging: false,
    pointer: new THREE.Vector2(),
    pointerTarget: new THREE.Vector2(),
    lookOffset: new THREE.Vector2(),
    lookOffsetTarget: new THREE.Vector2(),
    dolly: 1,
    dollyTarget: 1,
    previousPointer: new THREE.Vector2(),
    nativeReflections: nativeReflectionsConfigured,
  };

  const nativeRtxAvailable = Boolean(
    rtx && (rtxStatus?.features?.nativeRayTracing?.supported ?? capabilities.nativeRayTracing),
  );
  let hud = null;
  hud = createGlasshouseHud({
    renderer,
    nativeRtxAvailable,
    nativeReflectionsActive: nativeReflectionsConfigured,
    onAutoCamera: enabled => { state.autoCamera = enabled; },
    onRain: enabled => {
      state.rain = enabled;
      glasshouse.setRainEnabled(enabled);
    },
    onReflectionQuality: enabled => {
      state.fullReflections = enabled;
      glasshouse.setReflectionQuality(enabled);
      if (state.nativeReflections) {
        const scale = enabled ? 1 : 0.70;
        const size = internalRenderSize(scale);
        if (!reflectionRenderer.resize(
          size.x,
          size.y,
        )) {
          state.nativeReflections = false;
          glasshouse.setNativeReflectionMode(false);
          hud?.setNativeReflectionsActive(false);
        }
      }
    },
  });

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
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
    state.lookOffsetTarget.x = THREE.MathUtils.clamp(state.lookOffsetTarget.x - dx * 0.0032, -0.9, 0.9);
    state.lookOffsetTarget.y = THREE.MathUtils.clamp(state.lookOffsetTarget.y + dy * 0.0025, -0.42, 0.48);
    if (state.autoCamera) {
      state.autoCamera = false;
      hud.buttons[0].setActive(false);
    }
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.dollyTarget = THREE.MathUtils.clamp(
      state.dollyTarget + Math.sign(event.deltaY) * 0.075,
      0.72,
      1.34,
    );
    event.preventDefault?.();
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  const cameraTarget = new THREE.Vector3();
  const cameraDesired = new THREE.Vector3();
  const cameraLook = new THREE.Vector3();
  function updateCamera(time, delta) {
    const easing = 1 - Math.exp(-delta * 6.5);
    state.pointer.lerp(state.pointerTarget, easing);
    state.lookOffset.lerp(state.lookOffsetTarget, easing);
    state.dolly = THREE.MathUtils.lerp(state.dolly, state.dollyTarget, easing);

    if (state.autoCamera) {
      cameraDesired.set(
        2.7 + Math.sin(time * 0.087) * 5.4 + Math.sin(time * 0.031) * 1.15,
        2.55 + Math.sin(time * 0.11 + 0.8) * 0.34,
        13.35 + Math.cos(time * 0.069) * 1.05,
      );
      cameraTarget.set(
        -0.35 + Math.sin(time * 0.052) * 1.1,
        2.26 + Math.sin(time * 0.081) * 0.16,
        -1.05 + Math.cos(time * 0.047) * 0.9,
      );
    } else {
      cameraDesired.set(
        4.4 + Math.sin(state.lookOffset.x) * 6.4,
        2.65 + state.lookOffset.y * 2.4,
        13.4 - Math.abs(state.lookOffset.x) * 1.2,
      );
      cameraTarget.set(
        -0.2 - state.lookOffset.x * 2.9,
        2.25 - state.lookOffset.y * 1.2,
        -1.1,
      );
    }

    cameraDesired.multiplyScalar(state.dolly);
    cameraDesired.x += state.pointer.x * 0.17;
    cameraDesired.y += state.pointer.y * 0.08;
    camera.position.lerp(cameraDesired, easing * 0.72);
    cameraLook.lerp(cameraTarget, easing * 0.82);
    camera.lookAt(cameraLook);
    camera.rotateZ(Math.sin(time * 0.095) * 0.0055);
    glasshouse.sky.position.copy(camera.position);
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const nextPixelRatio = chooseRenderPixelRatio(width, height);
    if (Math.abs(nextPixelRatio - renderPixelRatio) > 0.005) {
      renderPixelRatio = nextPixelRatio;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    hud.resize(width, height);
    if (state.nativeReflections) {
      const scale = state.fullReflections ? 1 : 0.70;
      const size = internalRenderSize(scale);
      if (!reflectionRenderer.resize(
        size.x,
        size.y,
      )) {
        state.nativeReflections = false;
        glasshouse.setNativeReflectionMode(false);
        hud.setNativeReflectionsActive(false);
      }
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

  let previousTime = performance.now();
  let elapsed = 0;
  let diagnostics = 0;
  let diagnosticFrames = 0;
  let diagnosticSeconds = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.05, wallDelta);
    previousTime = now;
    elapsed += delta;
    diagnosticFrames += 1;
    diagnosticSeconds += wallDelta;
    waterClock.value = elapsed;
    updateCamera(elapsed, delta);
    glasshouse.update(elapsed, delta);

    renderer.info.reset();
    let nativeRendered = false;
    if (state.nativeReflections) {
      nativeRendered = reflectionRenderer.render(scene, camera, {
        directionalLightDirection: rayMoonDirection,
      });
    }
    if (!nativeRendered) {
      if (state.nativeReflections) {
        state.nativeReflections = false;
        glasshouse.setNativeReflectionMode(false);
        hud.setNativeReflectionsActive(false);
        console.warn("[RTX reflections] Restored the three-planar-reflector fallback.");
      }
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
      renderer.clearDepth();
      hud.render();
    } else {
      // OP84 and the JS HUD remain offscreen. The known-good native presenter
      // then draws the reflected world plus transparent HUD in one canvas pass,
      // so the two layers can never compete for separate swapchain images.
      const hudTexture = hud.renderToTexture();
      if (!reflectionRenderer.present(hudTexture)) {
        state.nativeReflections = false;
        glasshouse.setNativeReflectionMode(false);
        hud.setNativeReflectionsActive(false);
        console.warn("[RTX reflections] Presentation failed; restored the planar fallback.");
      }
    }

    diagnostics += delta;
    if (diagnostics >= 8) {
      diagnostics = 0;
      const calls = renderer.info?.render?.drawCalls ?? 0;
      const triangles = renderer.info?.render?.triangles ?? 0;
      const drawingBuffer = state.nativeReflections
        ? new THREE.Vector2(reflectionRenderer.width, reflectionRenderer.height)
        : renderer.getDrawingBufferSize(new THREE.Vector2());
      const measuredFps = diagnosticSeconds > 0
        ? Math.round(diagnosticFrames / diagnosticSeconds)
        : 0;
      console.log(
        `[Midnight Glasshouse] fps=${measuredFps}` +
        ` · drawCalls=${calls}` +
        ` · triangles=${Number(triangles).toLocaleString()}` +
        ` · internal=${drawingBuffer.x}×${drawingBuffer.y}` +
        ` @${renderPixelRatio.toFixed(2)}x` +
        ` · reflectionQuality=${state.fullReflections ? "full" : "economy"}` +
        ` · reflectionPath=${state.nativeReflections ? "native-rays" : "planar-fallback"}` +
        ` · rain=${state.rain ? "on" : "off"}`,
      );
      diagnosticFrames = 0;
      diagnosticSeconds = 0;
    }
  });

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    globalThis.removeEventListener("resize", resize);
    hud.dispose();
    reflectionRenderer.dispose();
    for (const reflection of glasshouse.reflectors) reflection.dispose?.();
    environmentTarget.dispose();
    if (rtx && capabilities.reflex) {
      rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    }
    renderer.dispose();
  });
}

await main();
