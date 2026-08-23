import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import {
  causticStrength,
  createFishMaterial,
  createRockMaterial,
  createSandMaterial,
  createSkyMaterial,
  createWaterMaterial,
  updateWaterTime,
} from "./materials.mjs";
import {
  createFish,
  createLeaf,
  createPebbleField,
  createRock,
  createSandGeometry,
  createSimpleMaterial,
  terrainHeight,
} from "./geometry.mjs";
import { NativeDlssSuperResolution } from "./dlss-super-resolution.mjs";
import { collectStaticTriangleScene } from "./rtx-static-scene.mjs";
import {
  createUnderwaterVegetation,
  updateVegetationTime,
} from "./vegetation.mjs";

document.title = "RTX Underwater — ThreeBrowser Runtime";

function makeWaterGeometry(width = 58, depth = 58, columns = 180, rows = 180) {
  const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
  const uvs = new Float32Array((columns + 1) * (rows + 1) * 2);
  let p = 0;
  let q = 0;
  for (let row = 0; row <= rows; ++row) {
    const v = row / rows;
    for (let column = 0; column <= columns; ++column) {
      const u = column / columns;
      positions[p++] = (u - 0.5) * width;
      positions[p++] = 0;
      positions[p++] = 12 - v * depth;
      uvs[q++] = u;
      uvs[q++] = v;
    }
  }
  const indices = new Uint32Array(columns * rows * 6);
  const stride = columns + 1;
  let i = 0;
  for (let row = 0; row < rows; ++row) {
    for (let column = 0; column < columns; ++column) {
      const a = row * stride + column;
      const b = a + stride;
      indices[i++] = a;
      indices[i++] = a + 1;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = a + 1;
      indices[i++] = b + 1;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createParticleCloud(count = 1080) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let state = 0xa113f17e;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < count; ++i) {
    positions[i * 3] = (random() * 2 - 1) * 17;
    positions[i * 3 + 1] = 0.10 + random() * 3.15;
    positions[i * 3 + 2] = 7 - random() * 39;
    const luminance = 0.58 + random() * 0.34;
    colors[i * 3] = luminance * 0.70;
    colors[i * 3 + 1] = luminance * 0.94;
    colors[i * 3 + 2] = luminance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsNodeMaterial({
    size: 0.018,
    transparent: true,
    opacity: 0.25,
    vertexColors: true,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function addSunShafts(scene) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0xe9fff4,
    transparent: true,
    opacity: 0.024,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shafts = new THREE.Group();
  const placements = [
    [-5.3, -10, 0.8, 0.11],
    [2.4, -13, 1.45, -0.12],
    [6.8, -18, 0.92, 0.15],
  ];
  for (const [x, z, width, lean] of placements) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.36, width, 7.5, 18, 1, true), material);
    beam.position.set(x, 2.7, z);
    beam.rotation.z = lean;
    beam.renderOrder = 2;
    shafts.add(beam);
  }
  scene.add(shafts);
  return shafts;
}

function configureShadow(light) {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -12;
  light.shadow.camera.right = 12;
  light.shadow.camera.top = 10;
  light.shadow.camera.bottom = -10;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 55;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.008;
  light.shadow.radius = 3.0;
}

const RTX_FEATURE_LABELS = {
  reflex: "NVIDIA Reflex",
  dlssSuperResolution: "DLSS Super Resolution",
  dlssFrameGeneration: "DLSS Frame Generation",
  dlssRayReconstruction: "DLSS Ray Reconstruction",
  nativeRayTracing: "Native ray traversal",
};

function reportRtxStatus(status, phase = "startup") {
  if (!status) {
    console.warn(`[RTX ${phase}] ThreeBrowser RTX status API is unavailable.`);
    return;
  }
  const capabilities = status.capabilities ?? {};
  console.log(
    `[RTX ${phase}] backend=${status.backend || "unknown"}` +
    ` · adapter=${capabilities.adapterName || "unknown"}` +
    ` · Streamline=${Boolean(capabilities.streamlineInitialized)}` +
    ` · Vulkan attached=${Boolean(capabilities.vulkanAttached)}`,
  );
  for (const [name, feature] of Object.entries(status.features ?? {})) {
    const details = name === "reflex"
      ? ` · requestedMode=${feature.requestedMode} · activeMode=${feature.activeMode}`
      : name === "dlssSuperResolution"
        ? ` · mode=${feature.modeName || feature.mode || "off"}` +
          ` · render=${feature.renderWidth || 0}×${feature.renderHeight || 0}` +
          ` → output=${feature.outputWidth || 0}×${feature.outputHeight || 0}` +
          ` · evaluations=${feature.evaluationCount || 0}` +
          ` · failures=${feature.failureCount || 0}` +
          ` · lastResult=${feature.lastResult ?? 0}`
        : name === "dlssFrameGeneration"
          ? ` · lastPresented=${feature.lastFramesPresented || 0}` +
            ` · generated=${feature.generatedFrameCount || 0}` +
            ` · failures=${feature.failureCount || 0}` +
            ` · lastResult=${feature.lastResult ?? 0}` +
            ` · lastStatus=${feature.lastStatus ?? 0}`
        : "";
    const line =
      `[RTX ${phase}] ${RTX_FEATURE_LABELS[name] || name}` +
      ` · supported=${Boolean(feature.supported)}` +
      ` · requested=${Boolean(feature.requested)}` +
      ` · configured=${Boolean(feature.configured)}` +
      ` · active=${Boolean(feature.active)}` + details +
      ` · ${feature.reason || "No status detail."}`;
    if (feature.requested && !feature.active) console.warn(line);
    else console.log(line);
  }
}

async function waitForNativeRayScene(rtx, timeoutMs = 5000) {
  const deadline = performance.now() + timeoutMs;
  let status = rtx?.getStatus?.() ?? rtx?.status ?? null;
  while (performance.now() < deadline) {
    const feature = status?.features?.nativeRayTracing;
    if (feature?.active) return { ready: true, status, feature };
    if (feature && feature.supported === false) {
      return { ready: false, status, feature };
    }
    await new Promise(resolve => setTimeout(resolve, 8));
    status = rtx?.getStatus?.() ?? rtx?.status ?? status;
  }
  return {
    ready: false,
    status,
    feature: status?.features?.nativeRayTracing ?? null,
  };
}

async function main() {
  if (!WebGPU.isAvailable()) throw new Error("Native WebGPU is required; this sample has no WebGL fallback.");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x288f89);
  scene.fog = new THREE.FogExp2(0x439d94, 0.034);

  const camera = new THREE.PerspectiveCamera(82, innerWidth / Math.max(1, innerHeight), 0.02, 90);
  const cameraBase = new THREE.Vector3(-0.10, 0.40, 6.15);
  const cameraTarget = new THREE.Vector3(-0.34, -0.45, -7.2);
  camera.position.copy(cameraBase);
  camera.lookAt(cameraTarget);

  const renderer = new THREE.WebGPURenderer({ antialias: true, trackTimestamp: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(scene.background, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) throw new Error("WebGPURenderer did not initialize its WebGPU backend.");

  const device = renderer.backend.device;
  if (device && typeof device.addEventListener === "function") {
    device.addEventListener("uncapturederror", event => {
      console.error("[webgpu validation]", event.error?.message || event.error || event);
    });
  }

  // Reflex is independent of the frame resources below. The DLSS adapter can
  // request Frame Generation only when the native API is available and then
  // supplies a post-tonemapped HUD-less target, depth and dense motion vectors.
  // Ray Reconstruction remains off because the native ray-query pass produces
  // deterministic visibility and AO rather than a noisy radiance buffer with
  // the complete denoiser guide set.
  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  const requestedRtxFeatures = {
    dlssFrameGeneration: false,
    dlssRayReconstruction: false,
  };
  if (capabilities.reflex) requestedRtxFeatures.reflex = "boost";
  let initialRtxStatus = rtx?.requestFeatures?.(requestedRtxFeatures) ?? rtx?.status ?? null;

  const dlssPipeline = new NativeDlssSuperResolution(renderer, camera, rtx);
  const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const dlssConfigured = dlssPipeline.configure(drawingBufferSize.x, drawingBufferSize.y);
  initialRtxStatus = rtx?.getStatus?.() ?? initialRtxStatus;
  reportRtxStatus(initialRtxStatus);
  if (!dlssConfigured) {
    console.warn(`[DLSS] Full-resolution fallback is active. ${dlssPipeline.failure}`);
  }
  console.warn("[RTX boundary] DLSS Super Resolution is evaluated only when native configuration succeeds. Frame Generation is requested only when supported and is tagged with the sample's real post-tonemapped RGBA8 HUD-less color, native depth and dense TSL motion vectors; it is reported active only after Streamline confirms more than one frame from Present. On a ray-query-capable Vulkan device, static world geometry is registered in a native BLAS/TLAS and the HDR pass receives generic directional-light visibility and RTAO. The page's TSL water material owns its wave-matched caustic field. Ray Reconstruction remains off because this deterministic pass does not manufacture noisy radiance or denoiser guides.");

  const sky = new THREE.Mesh(new THREE.SphereGeometry(72, 56, 32), createSkyMaterial());
  sky.material.side = THREE.BackSide;
  sky.material.depthWrite = false;
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  scene.add(sky);

  const sunLight = new THREE.DirectionalLight(0xfff3dc, 3.25);
  sunLight.position.set(-7.5, 18.5, 5.0);
  sunLight.target.position.set(-1.5, -0.1, -12.5);
  configureShadow(sunLight);
  scene.add(sunLight, sunLight.target);
  scene.add(new THREE.HemisphereLight(0xcaf2e8, 0x627d73, 0.68));
  scene.add(new THREE.AmbientLight(0x86aaa3, 0.14));

  const sandMaterial = createSandMaterial(0xaaa99d);
  const rtxStaticObjects = [];
  const seabed = new THREE.Mesh(createSandGeometry(), sandMaterial);
  seabed.receiveShadow = true;
  scene.add(seabed);
  rtxStaticObjects.push(seabed);

  const rockMaterials = [
    createRockMaterial(0x74776f),
    createRockMaterial(0x898980),
    createRockMaterial(0x676d68),
  ];
  const rockSpecs = [
    // Uneven depth layers avoid the staged "rocks on a horizon" composition.
    { x: -5.65, z: 3.05, radius: 1.48, scale: [1.34, 0.68, 1.12], rotation: 0.45, seed: 2, detail: 5 },
    { x: -0.72, z: 1.46, radius: 1.18, scale: [1.30, 0.54, 1.08], rotation: -0.35, seed: 4, detail: 5 },
    { x: 4.72, z: -3.65, radius: 1.02, scale: [1.28, 0.70, 1.02], rotation: -0.68, seed: 19, detail: 5 },
    { x: 1.86, z: -6.10, radius: 0.54, scale: [1.16, 0.76, 0.98], rotation: 0.82, seed: 22, detail: 4 },
    { x: 4.2, z: -9.8, radius: 0.72, scale: [1.2, 0.79, 0.9], rotation: 1.3, seed: 7 },
    { x: -7.7, z: -13.5, radius: 1.05, scale: [1.55, 0.68, 1.18], rotation: 2.1, seed: 9 },
    { x: 8.4, z: -20.5, radius: 1.32, scale: [1.35, 0.76, 1.0], rotation: -0.7, seed: 12 },
    { x: -1.6, z: -23.5, radius: 0.68, scale: [1.25, 0.70, 0.9], rotation: 0.2, seed: 15 },
    { x: 7.2, z: -4.2, radius: 0.44, scale: [1.42, 0.56, 0.86], rotation: 0.9, seed: 18 },
  ];
  rockSpecs.forEach((spec, index) => {
    const rock = createRock(rockMaterials[index % rockMaterials.length], spec);
    scene.add(rock);
    rtxStaticObjects.push(rock);
  });
  const pebbleField = createPebbleField(rockMaterials[1]);
  scene.add(pebbleField);
  rtxStaticObjects.push(pebbleField);

  const vegetationPatches = [
    { x: -5.0, z: 1.35, radius: 2.25, weight: 1.25 },
    { x: 2.65, z: 0.45, radius: 1.75, weight: 1.10 },
    { x: -0.1, z: -2.8, radius: 2.10, weight: 0.92 },
    { x: 4.65, z: -3.9, radius: 2.25, weight: 1.05 },
    { x: -6.3, z: -7.8, radius: 3.0, weight: 1.15 },
    { x: 5.7, z: -11.2, radius: 3.5, weight: 1.25 },
    { x: -3.2, z: -17.8, radius: 4.1, weight: 0.90 },
  ];
  const vegetationExclusions = rockSpecs.map(spec => ({
    x: spec.x,
    z: spec.z,
    radius: spec.radius * Math.max(spec.scale[0], spec.scale[2]) * 0.72,
  }));
  const vegetation = createUnderwaterVegetation({
    heightAt: terrainHeight,
    patches: vegetationPatches,
    exclusions: vegetationExclusions,
    seagrassCount: 720,
    kelpCount: 14,
    currentStrength: 0.82,
  });
  scene.add(vegetation);

  const water = new THREE.Mesh(makeWaterGeometry(), createWaterMaterial());
  water.position.y = 2.72;
  water.frustumCulled = false;
  water.receiveShadow = true;
  water.renderOrder = 8;
  scene.add(water);

  const shafts = addSunShafts(scene);
  const particles = createParticleCloud();
  scene.add(particles);

  const eyeMaterial = createSimpleMaterial(0x08110f, 0.35, 0.05);
  const hero = createFish(
    createFishMaterial(0x3b7278, 0x0b262b),
    createFishMaterial(0xaa9238, 0x332f12),
    eyeMaterial,
    0.92,
  );
  hero.userData.hero = true;
  scene.add(hero);

  const distantFish = [];
  const distantPalettes = [
    [0x2f777b, 0xd1b84b],
    [0x5d7d68, 0xbfc58c],
    [0x316b7a, 0xe1d67f],
    [0x667a6f, 0xcb9e57],
  ];
  const distantRoutes = [
    { phase: 0.35, speed: 0.23, centerX: -3.2, centerZ: -8.5, radiusX: 3.8, radiusZ: 2.5, height: 1.08 },
    { phase: 2.10, speed: 0.18, centerX: 3.6, centerZ: -12.5, radiusX: 4.6, radiusZ: 3.1, height: 1.36 },
    { phase: 4.15, speed: 0.15, centerX: -1.4, centerZ: -17.0, radiusX: 6.0, radiusZ: 3.8, height: 1.58 },
    { phase: 5.45, speed: 0.12, centerX: 4.8, centerZ: -22.0, radiusX: 5.5, radiusZ: 3.4, height: 1.72 },
  ];
  for (let i = 0; i < distantPalettes.length; ++i) {
    const fish = createFish(
      createFishMaterial(distantPalettes[i][0]),
      createFishMaterial(distantPalettes[i][1]),
      eyeMaterial,
      0.40 + i * 0.048,
    );
    fish.userData.route = distantRoutes[i];
    scene.add(fish);
    distantFish.push(fish);
  }

  const leafMaterial = createRockMaterial(0x76583a);
  leafMaterial.roughness = 0.9;

  // A quiet bed of sunken leaves anchors the middle distance throughout the
  // shot. A second set below drifts past late in the loop like the reference.
  const settledDebris = new THREE.Group();
  const debrisPositions = [
    [-0.94, -2.18, 0.98, 0.22], [-0.42, -2.02, 1.20, -0.34], [0.20, -2.32, 1.06, 0.56],
    [0.82, -2.08, 0.90, -0.74], [-0.68, -2.68, 0.84, 1.04], [0.08, -2.78, 1.02, -1.18],
    [1.00, -2.52, 0.78, 0.88],
  ];
  for (const [x, z, size, yaw] of debrisPositions) {
    const leaf = createLeaf(leafMaterial, size);
    leaf.position.set(x, terrainHeight(x, z) + 0.045, z);
    leaf.rotation.set(0.13 + Math.sin(yaw * 2.1) * 0.08, yaw, Math.cos(yaw * 1.7) * 0.11);
    leaf.receiveShadow = true;
    settledDebris.add(leaf);
  }
  const twigGeometry = new THREE.CylinderGeometry(0.018, 0.032, 1.25, 6);
  for (let i = 0; i < 3; ++i) {
    const twig = new THREE.Mesh(twigGeometry, leafMaterial);
    twig.position.set(-0.28 + i * 0.30, terrainHeight(-0.28 + i * 0.30, -2.4) + 0.075, -2.38 - i * 0.18);
    twig.rotation.set(0, i * 0.64 - 0.5, Math.PI * 0.5 + (i - 1) * 0.12);
    twig.castShadow = true;
    settledDebris.add(twig);
  }
  scene.add(settledDebris);
  rtxStaticObjects.push(settledDebris);

  const leaves = [];
  for (let i = 0; i < 12; ++i) {
    const leaf = createLeaf(leafMaterial, 0.50 + (i % 5) * 0.08);
    leaf.userData.offset = i * 0.28;
    leaf.visible = false;
    scene.add(leaf);
    leaves.push(leaf);
  }

  let nativeRayLightingActive = false;
  if (capabilities.nativeRayTracing &&
      typeof rtx?.registerStaticScene === "function" &&
      typeof rtx?.evaluateRayLighting === "function") {
    try {
      scene.updateMatrixWorld(true);
      const staticScene = collectStaticTriangleScene(rtxStaticObjects);
      const registration = rtx.registerStaticScene(staticScene);
      const nativeScene = registration?.queued
        ? await waitForNativeRayScene(rtx)
        : { ready: false, status: null, feature: null };
      nativeRayLightingActive = nativeScene.ready;
      if (!nativeRayLightingActive) {
        const reason = nativeScene.feature?.reason ||
          "The native worker did not report a ready BLAS/TLAS after scene submission.";
        rtx.destroyStaticScene?.();
        throw new Error(reason);
      }
      if (nativeRayLightingActive) {
        dlssPipeline.configureRayLighting({
          directionalLightDirection: new THREE.Vector3(0.42, 0.88, -0.22).normalize(),
          directionalLightIntensity: 1,
          directionalAngularRadius: 0.0065,
          directionalSampleCount: 1,
          aoSampleCount: 2,
          maxDistance: 10000,
          rayBias: 0.002,
          shadowStrength: 0.56,
          aoStrength: 0.18,
          aoRadius: 0.92,
        });
        console.log(
          `[RTX lighting] Static BLAS/TLAS ready: ${staticScene.vertexCount.toLocaleString()} vertices` +
          ` · ${staticScene.triangleCount.toLocaleString()} triangles` +
          " · generic ray-query shadows and RTAO enabled; TSL owns water caustics.",
        );
      }
    } catch (error) {
      console.warn(`[RTX lighting] Static scene registration failed: ${error?.message || error}`);
    }
  }

  causticStrength.value = 0.76;
  let previousFrameTime = performance.now();
  let elapsed = 0;
  let diagnosticTimer = 0;
  let timestampPending = false;
  let gpuMs = -1;

  function updateHeroFish(time) {
    const cycle = ((time - 0.45) % 10.8 + 10.8) % 10.8;
    const travelTime = 7.2;
    hero.visible = cycle < travelTime;
    if (!hero.visible) return;

    // Keep the tang predominantly side-on as it crosses the lens. A shallow
    // depth arc preserves parallax without the fish turning into a front-on disc.
    const p = THREE.MathUtils.clamp(cycle / travelTime, 0, 1);
    const u = 1 - p;
    const b0 = u * u * u;
    const b1 = 3 * u * u * p;
    const b2 = 3 * u * p * p;
    const b3 = p * p * p;
    const x = b0 * 7.5 + b1 * 3.4 + b2 * -3.5 + b3 * -7.4;
    const y = b0 * 0.88 + b1 * 1.08 + b2 * 0.64 + b3 * 0.86;
    const z = b0 * 0.10 + b1 * 1.42 + b2 * 1.58 + b3 * -0.02;
    const dx = 3 * u * u * (3.4 - 7.5) + 6 * u * p * (-3.5 - 3.4) + 3 * p * p * (-7.4 + 3.5);
    const dy = 3 * u * u * (1.08 - 0.88) + 6 * u * p * (0.64 - 1.08) + 3 * p * p * (0.86 - 0.64);
    const dz = 3 * u * u * (1.42 - 0.10) + 6 * u * p * (1.58 - 1.42) + 3 * p * p * (-0.02 - 1.58);
    hero.position.set(x, y, z);
    hero.rotation.y = Math.atan2(dx, dz);
    hero.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
    hero.rotation.z = Math.sin(p * Math.PI) * -0.055 + Math.sin(time * 1.7) * 0.018;
    hero.userData.tail.rotation.y = Math.sin(time * 11.6) * 0.50;
  }

  function updateDistantFish(time) {
    for (let i = 0; i < distantFish.length; ++i) {
      const fish = distantFish[i];
      const route = fish.userData.route;
      const phase = time * route.speed + route.phase;
      const x = route.centerX + Math.sin(phase) * route.radiusX + Math.sin(phase * 0.43 + i) * 0.42;
      const z = route.centerZ + Math.cos(phase * 0.71) * route.radiusZ;
      const floor = terrainHeight(x, z);
      const y = Math.max(
        floor + 0.34,
        route.height + Math.sin(phase * 1.37 + i * 0.8) * 0.13,
      );
      const dx = Math.cos(phase) * route.radiusX + Math.cos(phase * 0.43 + i) * 0.181;
      const dz = -Math.sin(phase * 0.71) * route.radiusZ * 0.71;
      const dy = Math.cos(phase * 1.37 + i * 0.8) * 0.178;
      fish.position.set(x, y, z);
      fish.rotation.y = Math.atan2(dx, dz);
      fish.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
      fish.rotation.z = Math.sin(phase * 0.83 + i) * 0.045;
      fish.userData.tail.rotation.y = Math.sin(time * (7.1 + i * 0.42) + i) * 0.40;
    }
  }

  function updateLeaves(time) {
    const cycle = ((time - 12.3) % 20 + 20) % 20;
    for (let i = 0; i < leaves.length; ++i) {
      const leaf = leaves[i];
      const local = cycle - leaf.userData.offset;
      leaf.visible = local >= 0 && local < 5.2;
      if (!leaf.visible) continue;
      const p = local / 5.2;
      leaf.position.set(
        8.5 - p * 15.5 + Math.sin(time * 0.9 + i) * 0.42,
        0.48 + Math.sin(time * 1.5 + i * 1.7) * 0.22,
        2.25 - i * 0.12 - p * 1.2,
      );
      leaf.rotation.set(
        Math.sin(time * 0.74 + i) * 0.22,
        time * (0.16 + i * 0.004) + i * 0.7,
        Math.cos(time * 0.61 + i * 0.8) * 0.16,
      );
    }
  }

  const cameraSway = new THREE.Vector3();
  const cameraLookTarget = new THREE.Vector3();

  function updateCamera(time, delta) {
    cameraSway.set(
      Math.sin(time * 0.16) * 0.105 + Math.sin(time * 0.047 + 1.4) * 0.035,
      Math.sin(time * 0.21 + 0.7) * 0.042,
      Math.sin(time * 0.12 + 1.8) * 0.070,
    );
    camera.position.copy(cameraBase).add(cameraSway);
    cameraLookTarget.copy(cameraTarget);
    cameraLookTarget.x += Math.sin(time * 0.105) * 0.24;
    cameraLookTarget.y += Math.sin(time * 0.14 + 2.1) * 0.065;
    cameraLookTarget.z += Math.sin(time * 0.073 + 0.4) * 0.12;
    camera.lookAt(cameraLookTarget);
    camera.rotateZ(Math.sin(time * 0.105) * 0.007);
    sky.position.copy(camera.position);
    particles.position.y = Math.sin(time * 0.09) * 0.08;
    particles.rotation.y += delta * 0.0025;
    shafts.position.x = Math.sin(time * 0.07) * 0.15;
  }

  addEventListener("resize", () => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    const size = renderer.getDrawingBufferSize(drawingBufferSize);
    dlssPipeline.resize(size.x, size.y);
  });
  addEventListener("beforeunload", () => {
    dlssPipeline.dispose();
    if (nativeRayLightingActive) rtx?.destroyStaticScene?.();
    if (rtx && capabilities.reflex) rtx.requestFeatures?.({ reflexMode: previousReflexMode });
  });

  renderer.setAnimationLoop(() => {
    const frameTime = performance.now();
    const delta = Math.min(Math.max(0, (frameTime - previousFrameTime) / 1000), 0.05);
    previousFrameTime = frameTime;
    elapsed += delta;
    updateWaterTime(elapsed);
    updateVegetationTime(elapsed);
    updateHeroFish(elapsed);
    updateDistantFish(elapsed);
    updateLeaves(elapsed);
    updateCamera(elapsed, delta);
    if (!dlssPipeline.render(scene, camera, { waterTime: elapsed })) renderer.render(scene, camera);

    diagnosticTimer += delta;
    if (diagnosticTimer >= 5) {
      diagnosticTimer = 0;
      if (renderer.backend.trackTimestamp && !timestampPending) {
        timestampPending = true;
        renderer.resolveTimestampsAsync("render")
          .then(() => { gpuMs = renderer.info.render.timestamp; })
          .catch(() => {})
          .finally(() => { timestampPending = false; });
      }
      const renderInfo = renderer.info.render;
      const liveRtxStatus = rtx?.getStatus?.() ?? initialRtxStatus;
      const reflex = liveRtxStatus?.features?.reflex;
      const dlss = liveRtxStatus?.features?.dlssSuperResolution;
      const frameGeneration = liveRtxStatus?.features?.dlssFrameGeneration;
      const configuredCount = Object.values(liveRtxStatus?.features ?? {})
        .filter(feature => feature.configured).length;
      const activeCount = Object.values(liveRtxStatus?.features ?? {})
        .filter(feature => feature.active).length;
      console.log(
        `[underwater] WebGPU frame stable · calls=${renderInfo.calls} · triangles=${renderInfo.triangles}` +
        `${gpuMs >= 0 ? ` · GPU=${gpuMs.toFixed(2)}ms` : ""} · fish=${1 + distantFish.length}` +
        ` · RTX=${Boolean(capabilities.rtx)} · requested/configured/active=` +
        `${Object.values(liveRtxStatus?.features ?? {}).filter(feature => feature.requested).length}/${configuredCount}/${activeCount}` +
        ` · Reflex=${reflex?.activeMode ?? rtx?.reflexMode ?? 0}` +
        ` · DLSS=${dlss?.active ? "active" : (dlss?.configured ? "configured" : "off")}` +
        ` · evaluations=${dlss?.evaluationCount ?? 0}` +
        ` · failures=${dlss?.failureCount ?? 0}` +
        ` · lastResult=${dlss?.lastResult ?? 0}` +
        ` · DLSS-G=${frameGeneration?.active ? "active" : (frameGeneration?.configured ? "configured" : "off")}` +
        ` · presented=${frameGeneration?.lastFramesPresented ?? 0}` +
        ` · generated=${frameGeneration?.generatedFrameCount ?? 0}` +
        ` · fgFailures=${frameGeneration?.failureCount ?? 0}`,
      );
    }
  });

  console.log("[underwater] Ready: 67k-triangle procedural seabed, 58k-triangle deforming surface, irregular rocks, instanced stones, one-draw-call GPU-swaying seagrass/kelp, dynamic fish/leaves, " +
    (nativeRayLightingActive ? "native ray-query directional-light visibility and RTAO plus phase-locked TSL caustics" : "phase-locked TSL caustics") +
    ", soft shadows, particles and depth haze." +
    (dlssConfigured
      ? ` Native DLSS DLAA uses ${dlssPipeline.renderWidth}×${dlssPipeline.renderHeight} inputs for ${dlssPipeline.outputWidth}×${dlssPipeline.outputHeight} output.`
      : " Native DLSS is unavailable, so the scene is rendered at full resolution."));
}

main().catch(error => {
  console.error("[underwater fatal]", error?.stack || error);
  throw error;
});
