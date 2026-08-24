import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import {
  NativeReflectionRenderer,
  prepareReflectionGuideMaterials,
} from "../../webgpu_rtx_light_transport_observatory/src/native-reflections.mjs";
import { collectStaticReflectionScene } from "../../webgpu_rtx_light_transport_observatory/src/rtx-scene.mjs";
import {
  disposeDistrictProceduralTextures,
  districtClock,
  getDistrictProceduralTextureStats,
  palette,
} from "./materials.mjs";
import { buildNeonRainDistrict } from "./scene.mjs";

document.title = "RTX Neon Rain District — ThreeBrowser Runtime";

const MAX_RASTER_PIXELS = 6_300_000;
const MAX_RASTER_RATIO = 2.35;

function chooseRasterRatio(width, height) {
  const viewportPixels = Math.max(1, width * height);
  const displayRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  return Math.max(
    1,
    Math.min(MAX_RASTER_RATIO, displayRatio, Math.sqrt(MAX_RASTER_PIXELS / viewportPixels)),
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

function createDistrictEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x01040a);
  const canyon = new THREE.Mesh(
    new THREE.BoxGeometry(42, 28, 70),
    new THREE.MeshBasicNodeMaterial({
      color: 0x09121b,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  canyon.position.set(0, 5, -18);
  environmentScene.add(canyon);

  addEnvironmentPanel(environmentScene, [5.5, 12], [-18, 3, -5], [0, Math.PI * 0.5, 0], palette.cyan, 8.2);
  addEnvironmentPanel(environmentScene, [4.5, 10], [18, 2, -18], [0, -Math.PI * 0.5, 0], palette.magenta, 8.8);
  // A narrow warm source gives windows a plausible sodium-vapour accent.  It
  // must not behave like an amber cyclorama: that turned the whole wet avenue
  // bronze once the native reflection pass integrated the environment.
  addEnvironmentPanel(environmentScene, [6.5, 0.72], [0, 8, -31], [0, 0, 0], 0xe6b77d, 2.15);
  addEnvironmentPanel(environmentScene, [3.5, 8], [-16, 1, -37], [0, Math.PI * 0.5, 0], palette.jade, 5.2);
  addEnvironmentPanel(environmentScene, [15, 0.42], [0, -7, -7], [Math.PI * 0.5, 0, 0], 0xa8d8ed, 3.8);
  addEnvironmentPanel(environmentScene, [6, 12], [13, 2, 14], [0, Math.PI, 0], 0x8bb9d2, 3.0);

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.028,
    0.1,
    90,
    { size: 192, position: new THREE.Vector3(0, 2.0, -14) },
  );
  generator.dispose();
  environmentScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}

function reportRtxStatus(rtx) {
  const capabilities = rtx?.capabilities ?? {};
  console.log(
    `[Neon Rain District] adapter=${capabilities.adapterName || "unknown"}` +
    ` · RTX=${Boolean(capabilities.rtx)}` +
    ` · nativeTraversal=${Boolean(capabilities.rayQuery ?? capabilities.nativeRayTracing)}` +
    " · shader=generic runtime bridge",
  );
  console.log(
    "[Neon Rain District] Controls: A cinematic camera · 1–4 compositions · " +
    "R rain · Q reflection quality · drag orbit · wheel dolly",
  );
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Native WebGPU is required; Neon Rain District has no WebGL fallback.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#01040a";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  let rasterRatio = chooseRasterRatio(innerWidth, innerHeight);
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(palette.night, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.90;
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
    console.error("[Neon Rain District WebGPU]", event.error?.message || event.error || event);
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const previousReflexMode = rtx?.reflexMode ?? 0;
  reportRtxStatus(rtx);

  const scene = new THREE.Scene();
  scene.name = "Neon Rain District world";
  scene.background = new THREE.Color(palette.night);
  scene.fog = new THREE.FogExp2(0x07111b, 0.0148);

  const camera = new THREE.PerspectiveCamera(
    42,
    innerWidth / Math.max(1, innerHeight),
    0.035,
    230,
  );
  // The automatic rig replaces this bootstrap pose with a ground-skimming
  // offset behind the designated SUV before the first presented frame.
  camera.position.set(1.62, 0.24, 18.2);
  camera.lookAt(2.35, 0.78, -24);

  const environmentTarget = createDistrictEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.78;
  scene.environmentRotation.y = -0.44;

  const district = buildNeonRainDistrict(scene, environmentTarget.texture);
  const proceduralTextureStats = getDistrictProceduralTextureStats();
  console.log(
    `[Neon Rain District] procedural maps=${proceduralTextureStats.textureCount}` +
    ` shared textures / ${proceduralTextureStats.setCount} material families` +
    ` / ${(proceduralTextureStats.estimatedMipByteLength / 1048576).toFixed(2)} MiB estimated`,
  );
  prepareReflectionGuideMaterials(scene);

  district.moon.updateWorldMatrix(true, false);
  district.moon.target.updateWorldMatrix(true, false);
  const moonPosition = district.moon.getWorldPosition(new THREE.Vector3());
  const moonTarget = district.moon.target.getWorldPosition(new THREE.Vector3());
  const rayMoonDirection = moonPosition.sub(moonTarget).normalize();

  const reflectionRenderer = new NativeReflectionRenderer(renderer, camera, rtx, null);
  let staticReflectionScene = null;
  if (typeof rtx?.evaluateRayReflections === "function") {
    try {
      staticReflectionScene = collectStaticReflectionScene(
        district.staticRoots,
        district.staticLights,
      );
      if (district.rtxInstanceGroup) {
        staticReflectionScene.instanceGroups = [district.rtxInstanceGroup];
      }
    } catch (error) {
      console.warn(`[Neon Rain District] Static RTX scene failed: ${error?.message || error}`);
    }
  }
  const displaySize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const nativeConfigured = staticReflectionScene
    ? await reflectionRenderer.configure(displaySize.x, displaySize.y, staticReflectionScene)
    : false;
  district.setNativeReflectionMode(nativeConfigured);

  const state = {
    autoCamera: true,
    cinematic: true,
    rain: true,
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
    heroCameraPrimed: false,
  };

  const presets = [
    { position: [1.62, 0.24, 18.2], target: [2.35, 0.78, -24], fov: 43 },
    { position: [-5.72, 0.82, 6.5], target: [1.1, 0.92, -34], fov: 45 },
    { position: [5.76, 0.64, -13.5], target: [-1.2, 0.96, -55], fov: 42 },
    { position: [-1.05, 0.34, -35], target: [1.4, 0.88, -89], fov: 39 },
  ];

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  function disableTour(reason = "manual camera") {
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
    state.orbitTarget.x = THREE.MathUtils.clamp(state.orbitTarget.x - dx * 0.0027, -0.72, 0.72);
    state.orbitTarget.y = THREE.MathUtils.clamp(state.orbitTarget.y + dy * 0.0022, -0.32, 0.38);
    disableTour("camera drag");
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.dollyTarget = THREE.MathUtils.clamp(
      state.dollyTarget + Math.sign(event.deltaY) * 0.065,
      0.75,
      1.28,
    );
    disableTour("camera dolly");
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === "a") {
      state.autoCamera = !state.autoCamera;
      state.heroCameraPrimed = false;
      state.orbitTarget.set(0, 0);
      reflectionRenderer.resetTemporalHistory("cinematic camera toggled");
      console.log(`[Neon Rain District] cinematic camera=${state.autoCamera ? "on" : "off"}`);
      return;
    }
    if (key === "r") {
      state.rain = !state.rain;
      district.setRainEnabled(state.rain);
      console.log(`[Neon Rain District] rain=${state.rain ? "on" : "off"}`);
      return;
    }
    if (key === "q") {
      state.cinematic = !state.cinematic;
      district.setReflectionQuality(state.cinematic);
      reflectionRenderer.resetTemporalHistory("reflection quality changed");
      console.log(`[Neon Rain District] reflections=${state.cinematic ? "cinematic" : "balanced"}`);
      return;
    }
    const number = Number.parseInt(event.key, 10);
    if (!Number.isInteger(number) || number < 1 || number > presets.length) return;
    state.preset = number - 1;
    state.orbitTarget.set(0, 0);
    state.dollyTarget = 1;
    disableTour("camera composition changed");
    reflectionRenderer.resetTemporalHistory("camera composition changed");
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);

  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const basePosition = new THREE.Vector3(...presets[0].position);
  const baseTarget = new THREE.Vector3(...presets[0].target);
  const lookTarget = baseTarget.clone();
  const offset = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3();
  const heroRight = new THREE.Vector3();
  const previousHeroPosition = new THREE.Vector3();
  const heroPose = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(),
    up: new THREE.Vector3(),
  };
  function updateCamera(time, delta) {
    const smoothing = 1 - Math.exp(-delta * 8.4);
    state.pointer.lerp(state.pointerTarget, smoothing);
    state.orbit.lerp(state.orbitTarget, smoothing);
    state.dolly = THREE.MathUtils.lerp(state.dolly, state.dollyTarget, smoothing);

    if (state.autoCamera && district.traffic?.cinematicAnchor) {
      const pose = district.traffic.cinematicAnchor.getPose(heroPose);
      heroRight.crossVectors(pose.forward, pose.up).normalize();

      // Ground-skimming rear three-quarter tracking shot: the camera inherits
      // the hero SUV's fixed-speed lane motion, so no traffic can cross its
      // near plane.  The offset mirrors the supplied wet-street reference.
      basePosition.copy(pose.position)
        .addScaledVector(pose.forward, -4.35)
        .addScaledVector(pose.up, -0.54)
        .addScaledVector(heroRight, -0.82);
      baseTarget.copy(pose.position)
        .addScaledVector(pose.forward, 4.8)
        .addScaledVector(pose.up, 0.08);
      basePosition.y += Math.sin(time * 0.73) * 0.006;
      camera.fov = THREE.MathUtils.lerp(camera.fov, 43, smoothing);

      const wrapped = state.heroCameraPrimed &&
        previousHeroPosition.distanceToSquared(pose.position) > 900;
      if (!state.heroCameraPrimed || wrapped) {
        camera.position.copy(basePosition);
        lookTarget.copy(baseTarget);
        state.heroCameraPrimed = true;
        if (wrapped) reflectionRenderer.resetTemporalHistory("hero traffic loop cut");
      }
      previousHeroPosition.copy(pose.position);
    } else {
      const preset = presets[state.preset];
      basePosition.set(...preset.position);
      baseTarget.set(...preset.target);
      camera.fov = THREE.MathUtils.lerp(camera.fov, preset.fov, smoothing);
    }

    offset.copy(basePosition).sub(baseTarget);
    offset.applyAxisAngle(up, state.orbit.x);
    right.crossVectors(offset, up).normalize();
    offset.applyAxisAngle(right, state.orbit.y);
    offset.multiplyScalar(state.dolly);
    desiredPosition.copy(baseTarget).add(offset);
    desiredPosition.x += state.pointer.x * 0.07;
    desiredPosition.y += state.pointer.y * 0.035;
    desiredTarget.copy(baseTarget);

    camera.position.lerp(desiredPosition, smoothing * 0.68);
    lookTarget.lerp(desiredTarget, smoothing * 0.78);
    camera.lookAt(lookTarget);
    camera.rotateZ(Math.sin(time * 0.083) * 0.0028);
    camera.updateProjectionMatrix();
  }

  const rasterRenderSize = () => new THREE.Vector2(
    Math.max(1, Math.round(innerWidth * rasterRatio)),
    Math.max(1, Math.round(innerHeight * rasterRatio)),
  );

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    rasterRatio = chooseRasterRatio(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (state.nativeReflections) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!reflectionRenderer.resize(size.x, size.y)) {
        state.nativeReflections = false;
        district.setNativeReflectionMode(false);
      }
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

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
    districtClock.value = elapsed;
    district.update(elapsed, delta, camera);
    updateCamera(elapsed, delta);

    let nativeRendered = false;
    if (state.nativeReflections) {
      const trafficUpdate = district.rayTracingInstanceUpdate();
      if (trafficUpdate) reflectionRenderer.updateInstanceGroups([trafficUpdate]);
      nativeRendered = reflectionRenderer.render(scene, camera, {
        directionalLightDirection: rayMoonDirection,
        reflectionStrength: state.cinematic ? 0.74 : 0.60,
        maxDistance: 185,
        rayBias: 0.009,
        // Keep every asphalt roughness sample inside the ray pass.  A low hard
        // cutoff made wheel-rut guide values cross an on/off threshold and
        // exposed a long screen-space seam.  Roughness, F0 and the authored
        // mask now attenuate the response continuously instead.
        roughnessCutoff: 0.86,
        environmentColor: [0.009, 0.022, 0.038],
        environmentIntensity: state.cinematic ? 0.44 : 0.34,
        highQuality: state.cinematic,
      });
    }

    if (nativeRendered) {
      if (!reflectionRenderer.present(null)) {
        state.nativeReflections = false;
        district.setNativeReflectionMode(false);
      }
    } else {
      if (state.nativeReflections) {
        state.nativeReflections = false;
        district.setNativeReflectionMode(false);
        console.warn("[Neon Rain District] Native transport stopped; restored planar wet-road reflections.");
      }
      const size = rasterRenderSize();
      const rasterRendered = reflectionRenderer.renderRaster(scene, camera, size.x, size.y);
      if (!rasterRendered ||
          !reflectionRenderer.present(null, reflectionRenderer.rasterTarget?.texture)) {
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
        `[Neon Rain District] fps=${fps}` +
        ` · drawCalls=${calls}` +
        ` · triangles=${Number(triangles).toLocaleString()}` +
        ` · reflections=${state.nativeReflections ? "native-rays" : "planar-road"}` +
        ` · quality=${state.cinematic ? "cinematic" : "balanced"}` +
        ` · rain=${state.rain ? "on" : "off"}`,
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
    district.dispose();
    reflectionRenderer.dispose();
    environmentTarget.dispose();
    if (rtx?.capabilities?.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    scene.traverse(object => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
    });
    disposeDistrictProceduralTextures();
    renderer.dispose();
  });
}

await main();
