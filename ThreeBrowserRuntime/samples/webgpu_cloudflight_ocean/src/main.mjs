import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createFlightModel } from "./flight-model.mjs";
import { createPrecipitation } from "./precipitation.mjs";
import { createCockpit } from "./cockpit.mjs";
import { createFlightHud } from "./hud.mjs";
import { createWindscreenRain } from "./windscreen-rain.mjs";
import {
  createProceduralOceanMaterial,
  createVolumetricCloudCompositorMaterial,
  reflectedWeatherSkyNode,
  updateWeather,
  weatherCloudBase,
  weatherCloudTop,
  weatherSunDirection,
  weatherUniforms,
} from "./weather.mjs";

document.title = "Cloudflight Ocean — ThreeBrowser Runtime";

const MAX_DISPLAY_RATIO = 1.5;
const WORLD_TARGET_TYPE = THREE.HalfFloatType;
const WEATHER_PRESETS = Object.freeze([
  Object.freeze({ name: "FRONTAL PASSAGE", coverage: 0.72, density: 0.92, storm: 0.72, rain: 0.66 }),
  Object.freeze({ name: "BROKEN MARINE", coverage: 0.54, density: 0.78, storm: 0.36, rain: 0.18 }),
  Object.freeze({ name: "SQUALL LINE", coverage: 0.86, density: 1.12, storm: 0.96, rain: 0.94 }),
]);

function createWorldTarget(width, height) {
  const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
  depthTexture.name = "Cloudflight linear scene depth";
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.FloatType;
  const target = new THREE.RenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: WORLD_TARGET_TYPE,
    colorSpace: THREE.LinearSRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    // The world is presented through a post pass, so constructor antialiasing
    // alone does not cover cockpit/ocean edges. Resolve this offscreen scene
    // before the weather compositor samples it.
    samples: 4,
    generateMipmaps: false,
    depthTexture,
  });
  target.texture.name = "Cloudflight opaque HDR scene";
  return target;
}

function makeLightning(scene) {
  const material = new THREE.LineBasicNodeMaterial({
    color: 0xe8f7ff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: true,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  const geometry = new THREE.BufferGeometry();
  const bolt = new THREE.Line(geometry, material);
  bolt.name = "Page-authored weather lightning channel";
  bolt.visible = false;
  bolt.renderOrder = 42;
  bolt.userData.rtxIgnore = true;
  scene.add(bolt);

  const light = new THREE.PointLight(0xb9ddff, 0, 8_000, 1.45);
  light.name = "Lightning volumetric flash light";
  light.userData.rtxIgnore = true;
  scene.add(light);

  let strikePosition = new THREE.Vector3();
  let seed = 0x1a7e57;
  function random() {
    seed = Math.imul(seed ^ (seed >>> 16), 0x45d9f3b) >>> 0;
    return seed / 0xffffffff;
  }

  function rebuild(camera, forward, right) {
    const distance = 2_400 + random() * 3_600;
    strikePosition.copy(camera.position)
      .addScaledVector(forward, distance)
      .addScaledVector(right, (random() - 0.5) * 3_800);
    strikePosition.y = 90;
    const cloudTop = Number(weatherCloudTop.value ?? 2_100);
    const points = [];
    const segments = 21;
    let x = strikePosition.x;
    let z = strikePosition.z;
    for (let index = 0; index <= segments; ++index) {
      const amount = index / segments;
      if (index > 0 && index < segments) {
        x += (random() - 0.5) * (42 + amount * 24);
        z += (random() - 0.5) * (42 + amount * 24);
      }
      points.push(new THREE.Vector3(
        x,
        THREE.MathUtils.lerp(cloudTop - 90, 110, amount),
        z,
      ));
    }
    bolt.geometry.dispose();
    bolt.geometry = new THREE.BufferGeometry().setFromPoints(points);
    light.position.copy(strikePosition).setY(cloudTop * 0.56);
  }

  function update(flash) {
    const strength = THREE.MathUtils.clamp(Number(flash) || 0, 0, 1);
    bolt.visible = strength > 0.08;
    material.opacity = Math.pow(strength, 0.36);
    light.intensity = strength * 5_500_000;
  }

  function dispose() {
    scene.remove(bolt, light);
    geometry.dispose();
    bolt.geometry.dispose();
    material.dispose();
  }

  return { bolt, light, rebuild, update, get position() { return strikePosition; }, dispose };
}

function lightningEnvelope(time, strikeTime) {
  const age = time - strikeTime;
  if (age < 0 || age > 0.72) return 0;
  const first = Math.exp(-Math.pow((age - 0.045) / 0.032, 2));
  const returnStroke = Math.exp(-Math.pow((age - 0.19) / 0.055, 2)) * 0.68;
  const afterglow = Math.exp(-Math.max(age - 0.22, 0) * 6.5) * (age > 0.22 ? 0.18 : 0);
  return THREE.MathUtils.clamp(first + returnStroke + afterglow, 0, 1);
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Cloudflight Ocean requires the native WebGPU backend.");
  }

  document.documentElement.style.background = "#07111a";
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#07111a";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  renderer.setPixelRatio(Math.min(MAX_DISPLAY_RATIO, Math.max(1, Number(devicePixelRatio || 1))));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
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

  const scene = new THREE.Scene();
  scene.name = "Cloudflight Ocean JS/TSL world";
  scene.background = new THREE.Color(0x081724);
  scene.fog = new THREE.FogExp2(0x77909d, 0.000055);

  const camera = new THREE.PerspectiveCamera(
    58,
    innerWidth / Math.max(1, innerHeight),
    0.04,
    62_000,
  );
  camera.position.set(0, 1_260, 180);
  scene.add(camera);

  const oceanGeometry = new THREE.PlaneGeometry(52_000, 52_000, 384, 384);
  oceanGeometry.rotateX(-Math.PI * 0.5);
  const ocean = new THREE.Mesh(oceanGeometry, createProceduralOceanMaterial());
  ocean.name = "High-altitude procedural ocean";
  ocean.receiveShadow = true;
  ocean.frustumCulled = false;
  ocean.renderOrder = 5;
  ocean.userData.rtxIgnore = true;
  scene.add(ocean);

  const sun = new THREE.DirectionalLight(0xffe2bb, 2.3);
  sun.name = "Weather-filtered late-afternoon sun";
  sun.position.set(-4_000, 3_200, -7_500);
  sun.target.position.set(0, 0, -3_000);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -160;
  sun.shadow.camera.right = 160;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -95;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1_400;
  sun.shadow.bias = -0.00018;
  sun.shadow.normalBias = 0.045;
  const ambient = new THREE.HemisphereLight(0xa9c9de, 0x0b1820, 0.56);
  scene.add(sun, sun.target, ambient);

  const cockpit = createCockpit({
    camera,
    scene,
    glassReflectionNode: reflectedWeatherSkyNode,
  });
  const windscreenRain = createWindscreenRain({ renderer, size: 512, maxDrops: 112 });
  const precipitation = createPrecipitation(camera);
  const flight = createFlightModel(camera);
  flight.installInput(renderer.domElement);
  const lightning = makeLightning(scene);

  const displaySize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const worldTarget = createWorldTarget(displaySize.x, displaySize.y);
  const hud = createFlightHud({ renderer });
  hud.resize(innerWidth, innerHeight);
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMaterial = createVolumetricCloudCompositorMaterial(
    worldTarget.texture,
    worldTarget.depthTexture,
    hud.texture,
    windscreenRain.texture,
  );
  const postMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial);
  postMesh.name = "Depth-aware volumetric weather composite";
  postMesh.frustumCulled = false;
  postMesh.renderOrder = 0;
  postScene.add(postMesh);

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const previousReflexMode = rtx?.reflexMode ?? 0;
  let reflexLabel = "PUBLIC WEBGPU";
  if (rtx?.capabilities?.reflex) {
    try {
      rtx.requestFeatures?.({
        reflex: "boost",
        dlssSuperResolution: false,
        dlssFrameGeneration: false,
        dlssRayReconstruction: false,
      });
      const reflex = rtx.getStatus?.().features?.reflex;
      reflexLabel = reflex?.configured || reflex?.supported ? "REFLEX BOOST" : "RTX BRIDGE READY";
    } catch (error) {
      console.warn(`[Cloudflight] Reflex request failed: ${error?.message || error}`);
    }
  }

  // Open on broken marine weather so the first frame reads as flight through
  // real cloud gaps with the ocean below. The denser frontal passage and
  // squall line remain available through the C weather-cycle control.
  let weatherIndex = 1;
  let manualRain = true;
  let hudVisible = true;
  let nextStrikeTime = 4.5;
  let strikeTime = -10;
  let forceStrike = false;
  const clock = new THREE.Clock();
  let simulationTime = 0;
  let previousHudUpdate = -1;
  let performanceElapsed = 0;
  let performanceFrames = 0;
  let displayFps = 0;
  let disposed = false;
  let lastTelemetry = null;

  function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (key === "c") weatherIndex = (weatherIndex + 1) % WEATHER_PRESETS.length;
    else if (key === "r") manualRain = !manualRain;
    else if (key === "l") forceStrike = true;
    else if (key === "h") {
      hudVisible = !hudVisible;
      hud.setVisible?.(hudVisible);
    }
  }
  globalThis.addEventListener("keydown", onKeyDown);

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    worldTarget.setSize(size.x, size.y);
    hud.resize(width, height);
  }
  globalThis.addEventListener("resize", resize);

  function cleanup() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    flight.removeInput(renderer.domElement);
    cockpit.dispose?.();
    windscreenRain.dispose();
    precipitation.dispose();
    lightning.dispose();
    hud.dispose?.();
    worldTarget.dispose();
    postMesh.geometry.dispose();
    postMaterial.dispose();
    oceanGeometry.dispose();
    ocean.material.dispose();
    if (rtx?.capabilities?.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
    renderer.dispose();
  }
  globalThis.addEventListener("beforeunload", cleanup, { once: true });

  renderer.setAnimationLoop(() => {
    if (disposed) return;
    const delta = Math.min(clock.getDelta(), 0.05);
    simulationTime += delta;
    const preset = WEATHER_PRESETS[weatherIndex];
    const altitudeBeforeFlight = lastTelemetry?.altitude ?? camera.position.y;
    const base = Number(weatherCloudBase.value ?? 620);
    const top = Number(weatherCloudTop.value ?? 2_050);
    const cloudImmersion = THREE.MathUtils.smoothstep(altitudeBeforeFlight, base - 110, base + 220)
      * (1 - THREE.MathUtils.smoothstep(altitudeBeforeFlight, top - 260, top + 80));
    const telemetry = flight.update(simulationTime, delta, {
      storm: preset.storm,
      cloudImmersion,
    });
    lastTelemetry = telemetry;

    if (forceStrike || simulationTime >= nextStrikeTime) {
      strikeTime = simulationTime;
      lightning.rebuild(camera, telemetry.forward, telemetry.right);
      nextStrikeTime = simulationTime + 5.5 + Math.random() * 11;
      forceStrike = false;
    }
    const flash = lightningEnvelope(simulationTime, strikeTime);
    lightning.update(flash);

    const belowCloudTop = 1 - THREE.MathUtils.smoothstep(
      altitudeBeforeFlight,
      top - 40,
      top + 180,
    );
    const rainAmount = manualRain
      ? preset.rain
        * THREE.MathUtils.lerp(0.68, 1, cloudImmersion)
        * belowCloudTop
      : 0;
    updateWeather(simulationTime, delta, camera, {
      coverage: preset.coverage,
      density: preset.density,
      storm: preset.storm,
      lightningFlash: flash,
      lightningPosition: lightning.position,
      aircraftPosition: telemetry.position,
    });

    precipitation.update(
      delta,
      rainAmount,
      Number(weatherUniforms.wind?.value?.x ?? 0),
      {
        cloudBase: Number(weatherCloudBase.value),
        cloudTop: Number(weatherCloudTop.value),
        airspeedMps: telemetry.airspeedMps,
      },
    );
    cockpit.update?.({
      time: simulationTime,
      delta,
      flight: telemetry,
      controls: telemetry.controls,
      weather: {
        rainIntensity: rainAmount,
        turbulence: preset.storm * (0.35 + cloudImmersion * 0.95),
        lightning: flash,
        label: preset.name,
      },
    });
    windscreenRain.update({
      delta,
      rain: rainAmount,
      rollRadians: telemetry.rollRadians ?? telemetry.bankRadians ?? telemetry.roll ?? 0,
      airspeedMps: telemetry.airspeedMps,
      crosswind: Number(weatherUniforms.wind?.value?.x ?? 0),
    });
    const paneCorners = cockpit.projectWindscreenCorners?.();
    const paneControls = postMaterial.userData.windscreenRain;
    if (paneCorners?.length === 4 && paneControls) {
      paneControls.bottomLeft.value.copy(paneCorners[0]);
      paneControls.bottomRight.value.copy(paneCorners[1]);
      paneControls.topRight.value.copy(paneCorners[2]);
      paneControls.topLeft.value.copy(paneCorners[3]);
      paneControls.wetness.value = windscreenRain.wetness;
    }

    // Snap the finite surface beneath the aircraft while keeping the material
    // phase in absolute world coordinates. This behaves as a simple floating
    // ocean ring without leaking a ruler-straight edge into the atmosphere.
    ocean.position.x = Math.round(camera.position.x / 500) * 500;
    ocean.position.z = Math.round(camera.position.z / 500) * 500;
    sun.target.position.copy(camera.position).addScaledVector(telemetry.forward, 350);
    sun.position.copy(sun.target.position).addScaledVector(
      weatherSunDirection.value,
      1_000,
    );
    sun.intensity = 2.15 + flash * 5.5;

    renderer.setRenderTarget(worldTarget);
    renderer.setClearColor(0x07131e, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    // The wet pane is another offscreen JS render. It restores worldTarget,
    // so the only render that ever reaches the swapchain remains the final
    // weather/pane/HUD composite below.
    windscreenRain.renderToTexture();

    performanceElapsed += delta;
    performanceFrames += 1;
    if (performanceElapsed >= 0.5) {
      displayFps = performanceFrames / Math.max(performanceElapsed, 1e-4);
      performanceElapsed = 0;
      performanceFrames = 0;
    }
    if (simulationTime - previousHudUpdate > 0.08) {
      previousHudUpdate = simulationTime;
      hud.update?.({
        flight: telemetry,
        weather: {
          label: preset.name,
          cloudBaseM: Number(weatherCloudBase.value),
          cloudCoverage: preset.coverage,
          visibilityKm: THREE.MathUtils.lerp(42, 2.8, cloudImmersion * preset.density),
          windSpeedMps: weatherUniforms.wind.value.length(),
          windDirectionDegrees: THREE.MathUtils.radToDeg(
            Math.atan2(weatherUniforms.wind.value.x, weatherUniforms.wind.value.y),
          ),
          rainIntensity: rainAmount,
          cloudImmersion,
          lightning: flash,
        },
        runtime: reflexLabel,
        performance: {
          fps: displayFps,
          renderScale: renderer.getPixelRatio(),
        },
      });
    }
    hud.renderToTexture?.();

    // Exactly one render reaches the swapchain. The world, weather, and HUD
    // are first produced offscreen, then presented together atomically. Do
    // not issue an explicit default-target clear: the native host can submit
    // that as its own presentable pass. autoClear folds the clear into this
    // one final render pass instead.
    renderer.setRenderTarget(null);
    renderer.setMRT(null);
    renderer.setClearColor(0x03080c, 1);
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = true;
      renderer.render(postScene, postCamera);
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  });
}

main().catch(error => {
  console.error(error);
  throw error;
});
