import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createNightAtmosphere } from "./atmosphere.mjs";
import { createBushfireEffects } from "./fire-effects.mjs";
import { WildfireModel } from "./fire-model.mjs";
import { createProceduralForest } from "./forest.mjs";
import {
  collectStaticTriangleScene,
  NativeRtxLightingRenderer,
} from "./native-rtx-lighting.mjs";
import {
  createMountainside,
  terrainFuel,
  terrainHeight,
} from "./terrain.mjs";

document.title = "RTX Bushfire Mountainside — ThreeBrowser Runtime";

const DISPLAY_PIXEL_RATIO_CAP = 1.45;
const WIND = Object.freeze({ x: 0.82, z: -0.36, speed: 5 });

function createWildfire() {
  const model = new WildfireModel({
    // The live fuel field now covers a 192 x 264 metre mountainside core.
    // Keeping three-metre cells preserves slow local propagation while the
    // wider domain lets the front read across the valley rather than as a
    // handful of adjacent board-game tiles.
    width: 64,
    height: 88,
    cellSize: 3,
    originX: -96,
    originZ: -210,
    fixedStepSeconds: 0.5,
    spreadTimeSeconds: 52,
    burnDurationSeconds: 172,
    preheatRetentionSeconds: 210,
    ignitionThreshold: 1,
    seed: 0xb057f1ae,
    wind: WIND,
    fuel: ({ x, z }) => terrainFuel(x, z),
    moisture: ({ x, z }) => {
      const sheltered = Math.exp(-Math.pow((x + 7 - Math.sin(z * 0.046) * 7.2) / 8.5, 2));
      const variation = Math.sin(x * 0.117 + z * 0.081) * 0.5 + 0.5;
      return THREE.MathUtils.clamp(0.09 + sheltered * 0.16 + variation * 0.07, 0.07, 0.42);
    },
    elevation: ({ x, z }) => terrainHeight(x, z),
  });

  // A wide, broken ignition line creates several distinct tree-fire columns.
  // The gaps still have to preheat and join through the simulation.
  model.igniteWorld(-67, -62, { radius: 2, intensity: 0.96 });
  model.igniteWorld(-55, -68, { radius: 1, intensity: 0.88 });
  model.igniteWorld(-42, -73, { radius: 2, intensity: 1 });
  model.igniteWorld(-27, -77, { radius: 1, intensity: 0.90 });
  model.igniteWorld(-12, -82, { radius: 2, intensity: 0.97 });
  model.igniteWorld(4, -86, { radius: 1, intensity: 0.86 });
  model.igniteWorld(19, -91, { radius: 2, intensity: 0.94 });
  // Start with a mature front: older ignition pockets have already crossed
  // into ash while the downwind edge is still actively spreading. This makes
  // the persistent burned-log wake visible immediately; R still resets to a
  // completely fresh ignition line for watching the full progression.
  model.advance(150);
  return model;
}

function makeCameraPresets() {
  return [
    {
      name: "valley overlook",
      // A low track-side long lens keeps individual tree scale legible while
      // showing the complete broken front and several mountain depth planes.
      position: new THREE.Vector3(17.3, terrainHeight(17.3, 20) + 10.5, 20),
      target: new THREE.Vector3(-23, terrainHeight(-23, -83) + 8.0, -83),
      drift: 0.85,
    },
    {
      name: "fireline",
      // The management track is kept free of tree placements, giving this
      // close view a clear fireline composition instead of clipping through a
      // foreground crown.
      position: new THREE.Vector3(9, terrainHeight(9, -23) + 7.4, -23),
      target: new THREE.Vector3(-28, terrainHeight(-28, -76) + 6.2, -76),
      drift: 0.28,
    },
    {
      name: "aerial survey",
      position: new THREE.Vector3(148, 116, 18),
      target: new THREE.Vector3(-18, terrainHeight(-18, -92) + 6, -92),
      drift: 2.2,
    },
  ];
}

function rtxSnapshot(renderer) {
  try {
    let raw = null;
    if (typeof renderer?.snapshot === "function") raw = renderer.snapshot();
    else if (renderer?.snapshot && typeof renderer.snapshot === "object") raw = { ...renderer.snapshot };
    else if (typeof renderer?.status === "function") raw = renderer.status();
    else if (renderer?.status && typeof renderer.status === "object") raw = { ...renderer.status };
    if (raw) {
      return {
        ...raw,
        active: Boolean(raw.enabled && raw.configured && (raw.feature?.active ?? true)),
        reason: raw.failure || raw.feature?.reason || "",
      };
    }
  } catch (error) {
    return { active: false, reason: error?.message || String(error) };
  }
  return { active: false, reason: "not configured" };
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("RTX Bushfire Mountainside requires native WebGPU; there is no WebGL fallback.");
  }

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#02050a";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  renderer.setPixelRatio(Math.min(
    DISPLAY_PIXEL_RATIO_CAP,
    Math.max(1, Number(globalThis.devicePixelRatio || 1)),
  ));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.30;
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

  if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
    throw new Error("WebGPURenderer did not initialize the native WebGPU backend.");
  }
  const device = renderer.backend.device;
  const validationErrors = [];
  device.addEventListener?.("uncapturederror", event => {
    const message = event.error?.message || String(event.error || event);
    validationErrors.push(message);
    console.error("[Bushfire WebGPU validation]", message);
  });

  const scene = new THREE.Scene();
  scene.name = "9 PM bushfire mountainside";
  scene.background = new THREE.Color(0x02050a);
  scene.fog = new THREE.FogExp2(0x0b0f10, 0.00275);

  const camera = new THREE.PerspectiveCamera(
    47,
    innerWidth / Math.max(1, innerHeight),
    0.12,
    1200,
  );
  const presets = makeCameraPresets();
  camera.position.copy(presets[0].position);
  camera.lookAt(presets[0].target);

  const wildfire = createWildfire();
  const mountainside = createMountainside();
  scene.add(mountainside.group);
  const forest = createProceduralForest({
    heightAt: terrainHeight,
    fireCellAt: (x, z) => wildfire.cellAtWorld(x, z),
    seed: 0xdecafbad,
  });
  scene.add(forest.group);

  const atmosphere = createNightAtmosphere(scene);
  const fire = createBushfireEffects({
    scene,
    heightAt: terrainHeight,
    wind: new THREE.Vector2(WIND.x, WIND.z),
    treeRecords: forest.treeRecords,
  });

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  if (capabilities.reflex) {
    try {
      rtx.requestFeatures?.({
        reflex: "boost",
        dlssSuperResolution: false,
        dlssFrameGeneration: false,
        dlssRayReconstruction: false,
      });
    } catch (error) {
      console.warn(`[Bushfire RTX] Reflex request was rejected: ${error?.message || error}`);
    }
  }

  const nativeRenderer = new NativeRtxLightingRenderer(renderer, camera, rtx, {
    timeoutMs: 30_000,
  });
  let nativeConfigured = false;
  let staticSceneStats = null;

  // Compile raster variants before the potentially expensive static BLAS
  // snapshot. Native ThreeBrowser cannot block top-level module evaluation on
  // compileAsync because its pipeline callback is serviced by the first live
  // frame pump, so prewarming is deliberately fire-and-forget here.
  forest.update(0, wildfire);
  fire.update(0, 0, wildfire, camera);
  renderer.compileAsync?.(scene, camera)?.catch?.(error => {
    console.warn(`[Bushfire] Asynchronous shader prewarm deferred: ${error?.message || error}`);
  });

  if (rtx && typeof rtx.registerStaticScene === "function" && typeof rtx.evaluateRayLighting === "function") {
    try {
      const staticScene = await collectStaticTriangleScene(
        [
          ...mountainside.rtxRoots,
          ...(forest.rtxRoots ?? []),
        ],
        {
          maxTriangles: 1_550_000,
          // Module loading precedes the first requestAnimationFrame pump in
          // the native host; a zero-delay timer keeps cooperative collection
          // progressing during this startup phase.
          yieldToHost: () => new Promise(resolve => setTimeout(resolve, 0)),
        },
      );
      staticSceneStats = {
        triangles: staticScene.triangleCount,
        vertices: staticScene.vertexCount,
      };
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      nativeConfigured = await nativeRenderer.configure(size.x, size.y, staticScene);
      console.log(
        `[Bushfire RTX] static forest registered=${nativeConfigured}` +
        ` · triangles=${staticScene.triangleCount.toLocaleString()}` +
        ` · vertices=${staticScene.vertexCount.toLocaleString()}`,
      );
    } catch (error) {
      console.warn(`[Bushfire RTX] Static moon-lighting setup failed; raster fallback remains active: ${error?.message || error}`);
    }
  }

  const state = {
    preset: 0,
    cameraName: presets[0].name,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    yaw: 0,
    yawTarget: 0,
    pitch: 0,
    pitchTarget: 0,
    dolly: 1,
    dollyTarget: 1,
    paused: false,
    speed: 1,
    forceRaster: false,
    elapsed: 0,
    fps: 0,
  };

  function setPreset(index) {
    const next = THREE.MathUtils.clamp(Math.trunc(index), 0, presets.length - 1);
    state.preset = next;
    state.cameraName = presets[next].name;
    state.yawTarget = 0;
    state.pitchTarget = 0;
    state.dollyTarget = 1;
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.defaultPrevented) return;
    state.dragging = true;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.previousPointer.set(event.clientX, event.clientY);
    state.yawTarget = THREE.MathUtils.clamp(state.yawTarget - dx * 0.0031, -1.05, 1.05);
    state.pitchTarget = THREE.MathUtils.clamp(state.pitchTarget + dy * 0.0025, -0.52, 0.58);
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    state.dollyTarget = THREE.MathUtils.clamp(
      state.dollyTarget + Math.sign(event.deltaY) * 0.085,
      0.58,
      1.42,
    );
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "1" || key === "2" || key === "3") setPreset(Number(key) - 1);
    else if (key === " ") state.paused = !state.paused;
    else if (key === "[") state.speed = Math.max(0.25, state.speed * 0.5);
    else if (key === "]") state.speed = Math.min(4, state.speed * 2);
    else if (key === "r") wildfire.reignite();
    else if (key === "x") state.forceRaster = !state.forceRaster;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);

  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const baseDirection = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  function updateCamera(time, delta) {
    const ease = 1 - Math.exp(-delta * 5.2);
    state.yaw = THREE.MathUtils.lerp(state.yaw, state.yawTarget, ease);
    state.pitch = THREE.MathUtils.lerp(state.pitch, state.pitchTarget, ease);
    state.dolly = THREE.MathUtils.lerp(state.dolly, state.dollyTarget, ease);

    const preset = presets[state.preset];
    desiredPosition.copy(preset.position);
    desiredTarget.copy(preset.target);
    if (!state.dragging) {
      const drift = preset.drift;
      desiredPosition.x += Math.sin(time * 0.041 + state.preset) * 1.8 * drift;
      desiredPosition.y += Math.sin(time * 0.057 + 0.7) * 0.32 * drift;
      desiredPosition.z += Math.cos(time * 0.034 + state.preset * 0.9) * 0.85 * drift;
      desiredTarget.x += Math.sin(time * 0.029) * 0.72 * drift;
    }

    baseDirection.subVectors(desiredTarget, desiredPosition);
    const baseDistance = Math.max(1, baseDirection.length());
    spherical.setFromVector3(baseDirection);
    spherical.theta += state.yaw;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + state.pitch, 0.32, Math.PI - 0.25);
    viewDirection.setFromSpherical(spherical).normalize();
    desiredPosition.copy(desiredTarget).addScaledVector(viewDirection, -baseDistance * state.dolly);
    camera.position.lerp(desiredPosition, ease * 0.86);
    camera.lookAt(desiredTarget);
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    if (nativeConfigured) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      if (!nativeRenderer.resize(size.x, size.y)) nativeConfigured = false;
    }
  }
  globalThis.addEventListener("resize", resize);
  resize();

  let previousTime = performance.now();
  let diagnosticTimer = 0;
  let diagnosticFrames = 0;
  let diagnosticWallSeconds = 0;

  function snapshot() {
    return {
      time: state.elapsed,
      paused: state.paused,
      speed: state.speed,
      camera: state.cameraName,
      fire: { ...wildfire.stats() },
      residue: fire.getResidueStats?.() ?? null,
      rtx: rtxSnapshot(nativeRenderer),
      staticScene: staticSceneStats ? { ...staticSceneStats } : null,
      validationErrors: [...validationErrors],
      render: {
        fps: state.fps,
        drawCalls: renderer.info?.render?.drawCalls ?? 0,
        triangles: renderer.info?.render?.triangles ?? 0,
      },
    };
  }

  globalThis.__BUSHFIRE_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      pause(value = true) { state.paused = Boolean(value); },
      resume() { state.paused = false; },
      setSpeed(value) {
        state.speed = THREE.MathUtils.clamp(Number(value) || 1, 0.25, 4);
        return state.speed;
      },
      setCamera(value) {
        if (typeof value === "string") {
          const index = presets.findIndex(item => item.name.startsWith(value.toLowerCase()));
          if (index >= 0) setPreset(index);
        } else setPreset(Number(value) || 0);
        return state.cameraName;
      },
      reignite() { wildfire.reignite(); },
    }),
  });

  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.05, wallDelta);
    previousTime = now;
    state.elapsed += delta;
    diagnosticFrames += 1;
    diagnosticWallSeconds += wallDelta;
    if (!state.paused) wildfire.advance(delta * state.speed);

    updateCamera(state.elapsed, delta);
    atmosphere.update(state.elapsed, camera);
    forest.update(state.elapsed, wildfire);
    fire.update(state.elapsed, delta, wildfire, camera);

    renderer.info.reset();
    let nativeRendered = false;
    if (nativeConfigured && !state.forceRaster) {
      const fireLightVisibility = fire.lights.map(light => light.visible);
      // Native RTX evaluates these same source slots with ray-tested
      // visibility. Hide their ordinary Three lights only while the offscreen
      // linear scene is recorded so the native path cannot add each fire pool
      // twice. The finally block restores raster fallback before it can run.
      for (const light of fire.lights) light.visible = false;
      try {
        nativeRendered = nativeRenderer.render(scene, camera, {
          directionalLightDirection: atmosphere.moonDirection,
          fireEmitters: fire.getRtxEmitters?.(3) ?? [],
        });
      } finally {
        fire.lights.forEach((light, index) => {
          light.visible = fireLightVisibility[index];
        });
      }
      if (!nativeRendered) {
        nativeConfigured = false;
        console.warn("[Bushfire RTX] Native moon lighting stopped; restored raster WebGPU presentation.");
      }
    }
    if (!nativeRendered) {
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      renderer.clear(true, true, true);
      renderer.render(scene, camera);
    }

    diagnosticTimer += delta;
    if (diagnosticTimer >= 6) {
      diagnosticTimer = 0;
      state.fps = diagnosticWallSeconds > 0
        ? diagnosticFrames / diagnosticWallSeconds
        : 0;
      const stats = wildfire.stats();
      const residueState = fire.getResidueStats?.() ?? {};
      const rtxState = rtxSnapshot(nativeRenderer);
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      console.log(
        `[Bushfire] fps=${Math.round(state.fps)}` +
        ` · drawCalls=${renderer.info?.render?.drawCalls ?? 0}` +
        ` · triangles=${Number(renderer.info?.render?.triangles ?? 0).toLocaleString()}` +
        ` · buffer=${buffer.x}×${buffer.y}` +
        ` · burning=${stats.burning}` +
        ` · heating=${stats.heating}` +
        ` · charred=${stats.burned}` +
        ` · logs=${residueState.fallenLogs ?? 0}` +
        ` · logGlow=${residueState.logEmberCracks ?? 0}` +
        ` · RTX=${nativeConfigured && !state.forceRaster && rtxState.active !== false ? "moon+rtao+fire" : "raster-fallback"}` +
        ` · rayFire=${rtxState.fireLighting?.lastEmitterCount ?? 0}`,
      );
      diagnosticFrames = 0;
      diagnosticWallSeconds = 0;
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
    nativeRenderer.dispose();
    fire.dispose();
    atmosphere.dispose();
    forest.dispose();
    mountainside.dispose();
    if (rtx && capabilities.reflex) {
      rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    }
    renderer.dispose();
    delete globalThis.__BUSHFIRE_DEMO__;
  });
}

await main();
