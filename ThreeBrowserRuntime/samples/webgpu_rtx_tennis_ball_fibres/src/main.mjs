import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { createGpuFibreSystem } from "./fibre-gpu.mjs";
import { surfaceDistanceMillimetres } from "./fibre-model.mjs";
import { createMacroHud } from "./hud.mjs";
import {
  createKitchenCollisionWorld,
  TENNIS_COLLISION_RADIUS,
} from "./kitchen-colliders.mjs";
import { TennisRayRenderer } from "./native-ray-renderer.mjs";
import {
  createMacroStudioEnvironment,
  createTennisBallScene,
  STUDIO_ROOM_EXTENT,
  STUDIO_ROOM_TOP,
} from "./tennis-ball.mjs";

document.title = "RTX Tennis Felt — Kitchen Bench Free-Play";

const MAX_INTERNAL_PIXELS = 2_250_000;
const MIN_CAMERA_DISTANCE = 1.12;
const MAX_CAMERA_DISTANCE = 32.0;
const LIGHT_DIRECTION = new THREE.Vector3(-0.28, 0.68, 0.72).normalize();

function chooseInternalRatio(width, height) {
  const displayRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  const budgetRatio = Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height));
  return Math.max(0.5, Math.min(displayRatio, budgetRatio));
}

function smoothstep(value) {
  const x = THREE.MathUtils.clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

function createTennisImpactAudio() {
  const source = new URL("../assets/tennis-table-impact.wav", import.meta.url).href;
  const voices = Array.from({ length: 4 }, () => {
    const voice = new Audio(source);
    voice.preload = "auto";
    return voice;
  });
  let voiceIndex = 0;

  function arm() {
    for (const voice of voices) voice.load?.();
  }

  function play(impactSpeed = 5) {
    try {
      const amount = THREE.MathUtils.clamp(Number(impactSpeed) / 8, 0.16, 1);
      const voice = voices[voiceIndex++ % voices.length];
      voice.pause();
      voice.currentTime = 0;
      // Native HTMLAudioElement volume is linear. Keep even the hardest hit at
      // five percent and retain a little velocity variation below that.
      voice.volume = THREE.MathUtils.lerp(0.014, 0.05, amount);
      voice.playbackRate = 0.94 + amount * 0.08 + (voiceIndex % 3) * 0.006;
      const playback = voice.play();
      playback?.catch?.(error => {
        console.warn(`[RTX Tennis Felt] Native impact playback failed: ${error?.message || error}`);
      });
    } catch (error) {
      console.warn(`[RTX Tennis Felt] Impact sound failed: ${error?.message || error}`);
    }
  }

  function dispose() {
    for (const voice of voices) {
      voice.pause();
      voice.close?.();
    }
  }

  return { arm, play, dispose };
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Native WebGPU is required for the GPU-resident tennis-felt sample.");
  }

  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  // Keep the native swapchain at the window/display density. The adaptive RTX
  // ratio is applied only to the offscreen HDR, depth and DOF targets below;
  // using it as renderer.pixelRatio presents a reduced upper-left viewport
  // after a native maximize/resize.
  const displayPixelRatio = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  renderer.setPixelRatio(displayPixelRatio);
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
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
  renderer.domElement.style.cursor = "grab";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error("WebGPURenderer did not initialize its WebGPU backend.");
  }
  const device = renderer.backend.device;
  device?.addEventListener?.("uncapturederror", event => {
    console.error("[RTX Tennis Felt WebGPU]", event.error?.message || event.error || event);
  });

  const scene = new THREE.Scene();
  scene.name = "RTX tennis felt on a procedural kitchen bench";
  scene.background = new THREE.Color(0x060806);
  scene.fog = new THREE.FogExp2(0x070a08, 0.032);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.004, 30);
  camera.position.set(0.32, 0.64, 4.55);
  camera.lookAt(0, 0, 0);

  const environmentTarget = createMacroStudioEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 1.04;
  scene.environmentRotation.y = -0.42;

  const tennis = createTennisBallScene(scene);
  const kitchenCollisions = createKitchenCollisionWorld({
    sceneRoot: scene,
  });
  const key = new THREE.DirectionalLight(0xffedcf, 1.25);
  key.name = "Large warm macro softbox key";
  key.position.copy(LIGHT_DIRECTION).multiplyScalar(7.5);
  key.target.position.set(0, -0.06, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2.5;
  key.shadow.camera.right = 2.5;
  key.shadow.camera.top = 2.5;
  key.shadow.camera.bottom = -2.5;
  key.shadow.camera.near = 0.2;
  key.shadow.camera.far = 18;
  key.shadow.bias = -0.00018;
  key.shadow.normalBias = 0.006;
  scene.add(key, key.target);

  const softboxKey = new THREE.SpotLight(0xffe8c7, 450, 80, Math.PI * 0.06, 0.48, 2);
  softboxKey.name = "Focused tungsten follow spotlight";
  softboxKey.position.copy(LIGHT_DIRECTION).multiplyScalar(22);
  softboxKey.target.position.set(0, -0.05, 0);
  softboxKey.castShadow = true;
  softboxKey.shadow.mapSize.set(2048, 2048);
  softboxKey.shadow.bias = -0.00015;
  softboxKey.shadow.normalBias = 0.004;
  softboxKey.shadow.radius = 4;
  softboxKey.shadow.camera.near = 0.35;
  softboxKey.shadow.camera.far = 80;
  scene.add(softboxKey, softboxKey.target);

  const softboxMaterial = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0xffdfb2).multiplyScalar(1.72),
    side: THREE.DoubleSide,
    fog: false,
  });
  softboxMaterial.toneMapped = false;
  const softboxPanel = new THREE.Mesh(new THREE.CircleGeometry(0.43, 64), softboxMaterial);
  softboxPanel.name = "Warm glass spotlight emitter";
  softboxPanel.position.copy(softboxKey.position);
  softboxPanel.lookAt(0, 0, 0);
  softboxPanel.userData.rtxIgnore = true;
  scene.add(softboxPanel);

  const fixtureMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Blackened steel spotlight housing",
    color: 0x111412,
    roughness: 0.27,
    metalness: 0.82,
    clearcoat: 0.32,
    clearcoatRoughness: 0.24,
  });
  const spotlightFixture = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.52, 0.82, 48, 1, true),
    fixtureMaterial,
  );
  spotlightFixture.name = "Physical kitchen accent spotlight housing";
  const fixtureDirection = new THREE.Vector3();
  const fixtureAxis = new THREE.Vector3(0, -1, 0);
  function aimSpotlightAt(target) {
    softboxKey.target.position.copy(target);
    fixtureDirection.copy(target).sub(softboxKey.position).normalize();
    softboxPanel.position.copy(softboxKey.position).addScaledVector(fixtureDirection, 0.012);
    softboxPanel.lookAt(target);
    spotlightFixture.position.copy(softboxKey.position)
      .addScaledVector(fixtureDirection, -0.34);
    spotlightFixture.quaternion.setFromUnitVectors(fixtureAxis, fixtureDirection);
  }
  aimSpotlightAt(softboxKey.target.position);
  spotlightFixture.castShadow = true;
  spotlightFixture.userData.rtxIgnore = true;
  scene.add(spotlightFixture);

  const coolFill = new THREE.PointLight(0xd7e7ff, 6.5, 8, 2);
  coolFill.name = "Cool kitchen window edge fill";
  coolFill.position.set(3.7, 1.8, 1.2);
  scene.add(coolFill);
  const warmBounce = new THREE.PointLight(0xffd29b, 3.8, 7, 2);
  warmBounce.name = "Warm floor bounce";
  warmBounce.position.set(-2.5, -0.55, 2.2);
  scene.add(warmBounce);

  // Play mode brings up the recessed kitchen practicals instead of simply
  // multiplying the hero key. The point sources use inverse-square falloff;
  // the hemisphere wash represents the many indirect bounces in the room.
  const roomLightingGroup = new THREE.Group();
  roomLightingGroup.name = "L-toggle full kitchen lighting rig";
  const roomWash = new THREE.HemisphereLight(0xf3f7ec, 0x263126, 0);
  roomWash.name = "Indirect full-room wash";
  roomLightingGroup.add(roomWash);
  const roomPanelGeometry = new THREE.CircleGeometry(1.18, 48);
  const roomPanelOffColor = new THREE.Color(0x101411);
  const roomPanelOnColor = new THREE.Color(0xfff4d9).multiplyScalar(1.72);
  const roomPanelMaterial = new THREE.MeshBasicNodeMaterial({
    color: roomPanelOffColor.clone(),
    side: THREE.DoubleSide,
    fog: false,
  });
  roomPanelMaterial.toneMapped = false;
  const roomLights = [];
  const kitchenStripOffColor = tennis.studioStripMaterial.color.clone();
  const kitchenStripOnColor = new THREE.Color(0xe2eadb).multiplyScalar(2.15);
  for (const [x, z] of [[-11, -11], [11, -11], [-11, 11], [11, 11]]) {
    const panel = new THREE.Mesh(roomPanelGeometry, roomPanelMaterial);
    panel.name = "Dimmable recessed kitchen downlight";
    panel.position.set(x, STUDIO_ROOM_TOP - 0.025, z);
    panel.rotation.x = Math.PI * 0.5;
    panel.userData.rtxIgnore = true;
    roomLightingGroup.add(panel);
    const light = new THREE.PointLight(0xf0f5e8, 0, 54, 2);
    light.name = "Inverse-square kitchen ceiling light";
    light.position.set(x, STUDIO_ROOM_TOP - 1.35, z);
    roomLightingGroup.add(light);
    roomLights.push(light);
  }
  scene.add(roomLightingGroup);

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const fibres = await createGpuFibreSystem({ device, rtx });
  const rayRenderer = new TennisRayRenderer(renderer, camera, rtx);
  const nativeReady = await rayRenderer.configure(tennis.staticScene, fibres);
  const hud = createMacroHud(renderer, fibres.stats);
  hud.setVisible(false);
  const impactAudio = createTennisImpactAudio();

  const state = {
    autoCamera: true,
    dragging: false,
    brushing: false,
    distance: 4.55,
    targetDistance: 4.55,
    azimuth: 0.075,
    targetAzimuth: 0.075,
    elevation: 0.14,
    targetElevation: 0.14,
    pointer: new THREE.Vector2(0, 0),
    previousPointer: new THREE.Vector2(),
    brushNormal: new THREE.Vector3(0, 0, 1),
    brushDirection: new THREE.Vector3(1, 0, 0),
    brushStrength: 0,
    gust: 0,
    frameIndex: 1,
    resetRequested: false,
    failed: false,
    lastError: "",
    hudVisible: false,
    bounceActive: false,
    bouncePending: false,
    bounceCountdown: 0,
    bounceHeight: 0,
    bounceVelocity: 0,
    deformation: 0,
    deformationVelocity: 0,
    playMode: false,
    roomLightLevel: 0,
    jumpHeld: false,
    jumpBoostRemaining: 0,
    grounded: true,
    linearVelocity: new THREE.Vector3(),
    wallImpactCooldown: 0,
    supportHeight: 0,
  };
  const heldMovementKeys = new Set();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.0015);
  const raycaster = new THREE.Raycaster();
  const brushPoint = new THREE.Vector3();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const ballScale = new THREE.Vector3(1, 1, 1);
  const ballOffset = new THREE.Vector3();
  const ballQuaternion = new THREE.Quaternion();
  const inverseBallQuaternion = new THREE.Quaternion();
  const rollingQuaternion = new THREE.Quaternion();
  const rollingAxis = new THREE.Vector3();
  const controlForward = new THREE.Vector3();
  const controlRight = new THREE.Vector3();
  const controlDirection = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const fibreLightDirection = new THREE.Vector3();
  const physicsPosition = new THREE.Vector3();
  const physicsVelocity = new THREE.Vector3();

  function launchBounce() {
    if (state.bouncePending || state.bounceActive) return;
    impactAudio.arm();
    if (state.supportHeight < -1) {
      ballOffset.x = 0;
      ballOffset.z = 0;
      state.linearVelocity.set(0, 0, 0);
      state.bounceHeight = 0;
      state.supportHeight = 0;
      state.grounded = true;
    }
    state.autoCamera = false;
    state.bouncePending = true;
    state.bounceCountdown = 0.72;
    state.bounceActive = false;
    state.bounceHeight = 0;
    state.bounceVelocity = 0;
    state.deformation = 0;
    state.deformationVelocity = 0;
    state.gust = Math.max(state.gust, 0.32);
    // A short anticipation pullback keeps the camera outside every fibre and
    // reveals the complete kitchen before the high launch begins.
    state.targetDistance = Math.max(state.targetDistance, 14.5);
    state.targetElevation = 0.16;
  }

  function setPlayMode(enabled) {
    state.playMode = Boolean(enabled);
    state.autoCamera = false;
    state.jumpHeld = false;
    state.jumpBoostRemaining = 0;
    heldMovementKeys.clear();
    if (state.playMode) {
      impactAudio.arm();
      state.bouncePending = false;
      state.bounceCountdown = 0;
      state.grounded = state.bounceHeight <= 0.0001 && state.bounceVelocity <= 0;
      // Start free-play in a wider three-quarter view that establishes the
      // island, the real left-wall window and the L-counter below it.
      state.targetDistance = 18.0;
      state.targetAzimuth = 1.12;
      state.targetElevation = 0.18;
    }
    console.log(`[RTX Tennis Felt] Free-play ${state.playMode ? "enabled" : "disabled"}`);
  }

  function beginPlayerJump() {
    if (!state.playMode || !state.grounded || state.jumpHeld) return;
    state.jumpHeld = true;
    state.jumpBoostRemaining = 0.48;
    state.grounded = false;
    state.bounceActive = true;
    state.bouncePending = false;
    state.bounceVelocity = 8.5;
    state.deformationVelocity -= 0.24;
    state.gust = Math.max(state.gust, 0.36);
    console.log("[RTX Tennis Felt] Variable-height jump started");
  }

  function endPlayerJump() {
    state.jumpHeld = false;
    state.jumpBoostRemaining = 0;
  }

  function pointerNdc(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
  }

  function updateBrush(ndc, dx, dy) {
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectSphere(sphere, brushPoint);
    if (!hit) return;
    state.brushNormal.copy(hit).sub(ballOffset).normalize();
    cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
    state.brushDirection.copy(cameraRight).multiplyScalar(dx)
      .addScaledVector(cameraUp, -dy);
    state.brushDirection.addScaledVector(
      state.brushNormal,
      -state.brushDirection.dot(state.brushNormal),
    );
    // Simulation state is ball-local; undo visible rolling before sending the
    // brush vector to the spring solver.
    inverseBallQuaternion.copy(ballQuaternion).invert();
    state.brushNormal.applyQuaternion(inverseBallQuaternion);
    state.brushDirection.applyQuaternion(inverseBallQuaternion);
    if (state.brushDirection.lengthSq() > 1e-8) state.brushDirection.normalize();
    const motion = Math.hypot(dx, dy);
    state.brushStrength = Math.max(
      state.brushStrength,
      THREE.MathUtils.clamp(motion * 0.035, 0, 1.35),
    );
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    state.brushing = event.button === 2 || event.shiftKey;
    state.dragging = !state.brushing;
    state.autoCamera = false;
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.style.cursor = state.dragging ? "grabbing" : "crosshair";
    renderer.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  }

  function onPointerMove(event) {
    const ndc = pointerNdc(event);
    // client-coordinate deltas are reliable in the native runtime; movementX/Y
    // can remain zero even while a captured pointer is moving.
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.pointer.copy(ndc);
    if (state.brushing) updateBrush(ndc, dx, dy);
    if (state.dragging) {
      state.targetAzimuth -= dx * 0.0032;
      state.targetElevation = THREE.MathUtils.clamp(
        state.targetElevation + dy * 0.00265,
        0.04,
        0.78,
      );
    }
    state.previousPointer.set(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    state.dragging = false;
    state.brushing = false;
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function onWheel(event) {
    state.autoCamera = false;
    const minimum = state.bouncePending || state.bounceActive
      ? 8.5
      : MIN_CAMERA_DISTANCE;
    state.targetDistance = THREE.MathUtils.clamp(
      state.targetDistance * Math.exp(Math.sign(event.deltaY) * 0.092),
      minimum,
      MAX_CAMERA_DISTANCE,
    );
    event.preventDefault?.();
  }

  function onKeyDown(event) {
    if (state.playMode && ["KeyW", "KeyA", "KeyS", "KeyD"].includes(event.code)) {
      heldMovementKeys.add(event.code);
      event.preventDefault?.();
      return;
    }
    if (event.repeat) return;
    const keyName = String(event.key || "").toLowerCase();
    if (keyName === "l") {
      setPlayMode(!state.playMode);
    } else if (event.code === "Space" || event.key === " ") {
      if (state.playMode) {
        beginPlayerJump();
      } else {
        launchBounce();
      }
      event.preventDefault?.();
    } else if (keyName === "x") {
      rayRenderer.raysEnabled = !rayRenderer.raysEnabled;
    } else if (keyName === "h") {
      state.hudVisible = !state.hudVisible;
      hud.setVisible(state.hudVisible);
    } else if (keyName === "r") {
      state.resetRequested = true;
      state.gust = 0;
      state.bounceActive = false;
      state.bouncePending = false;
      state.bounceCountdown = 0;
      state.bounceHeight = 0;
      state.bounceVelocity = 0;
      state.deformation = 0;
      state.deformationVelocity = 0;
      state.linearVelocity.set(0, 0, 0);
      state.grounded = true;
      state.jumpHeld = false;
      state.jumpBoostRemaining = 0;
      state.wallImpactCooldown = 0;
      state.supportHeight = 0;
      ballOffset.set(0, 0, 0);
      ballQuaternion.identity();
    } else if (keyName === "t") {
      state.autoCamera = !state.autoCamera;
    }
  }

  function onKeyUp(event) {
    heldMovementKeys.delete(event.code);
    if (event.code === "Space" || event.key === " ") {
      endPlayerJump();
      event.preventDefault?.();
    }
  }

  function onBlur() {
    heldMovementKeys.clear();
    state.jumpHeld = false;
    state.jumpBoostRemaining = 0;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("contextmenu", onContextMenu);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("keyup", onKeyUp);
  globalThis.addEventListener("blur", onBlur);

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const internalRatio = chooseInternalRatio(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    // Match the Runtime's other native RTX samples: the canvas and swapchain
    // always cover the whole window, while expensive ray targets may render at
    // an independent scale and are stretched by the fullscreen present pass.
    renderer.setSize(width, height);
    rayRenderer.resize(
      Math.max(1, Math.round(width * internalRatio)),
      Math.max(1, Math.round(height * internalRatio)),
    );
    hud.resize(width, height);
  }
  globalThis.addEventListener("resize", resize);
  resize();

  function updateCamera(elapsed, delta) {
    if (state.autoCamera) {
      const cycle = elapsed % 36;
      let macro = 0;
      if (cycle >= 10 && cycle < 18) macro = smoothstep((cycle - 10) / 8);
      else if (cycle >= 18 && cycle < 28) macro = 1;
      else if (cycle >= 28) macro = 1 - smoothstep((cycle - 28) / 8);
      state.targetDistance = THREE.MathUtils.lerp(4.70, 1.36, macro);
      state.targetAzimuth = THREE.MathUtils.lerp(0.16, 0.045, macro) +
        Math.sin(elapsed * 0.12) * THREE.MathUtils.lerp(0.10, 0.055, macro);
      state.targetElevation = THREE.MathUtils.lerp(0.16, 0.055, macro) +
        Math.sin(elapsed * 0.15 + 0.6) * 0.035;
    }
    const response = 1 - Math.exp(-delta * 5.7);
    state.distance = THREE.MathUtils.lerp(state.distance, state.targetDistance, response);
    state.azimuth = THREE.MathUtils.lerp(state.azimuth, state.targetAzimuth, response);
    state.elevation = THREE.MathUtils.lerp(state.elevation, state.targetElevation, response);
    const cosElevation = Math.cos(state.elevation);
    // Cinematic mode lets the ball climb within the composition; free-play
    // tracks its full height so even the longest held jump cannot leave frame.
    const shotTargetY = ballOffset.y * (state.playMode ? 1.0 : 0.42);
    cameraTarget.set(
      ballOffset.x,
      shotTargetY + (state.distance > 1.45 ? -0.035 : 0),
      ballOffset.z,
    );
    cameraPosition.set(
      Math.sin(state.azimuth) * cosElevation,
      Math.sin(state.elevation),
      Math.cos(state.azimuth) * cosElevation,
    ).multiplyScalar(state.distance);
    if (state.playMode) {
      const cameraLimit = STUDIO_ROOM_EXTENT - 0.45;
      const xBlend = smoothstep(
        (Math.abs(ballOffset.x) - (cameraLimit - state.distance * 0.9)) /
        Math.max(1, state.distance * 0.9),
      );
      const zBlend = smoothstep(
        (Math.abs(ballOffset.z) - (cameraLimit - state.distance * 0.9)) /
        Math.max(1, state.distance * 0.9),
      );
      if (Math.sign(ballOffset.x) * cameraPosition.x > 0) {
        cameraPosition.x = THREE.MathUtils.lerp(cameraPosition.x, -cameraPosition.x, xBlend);
      }
      if (Math.sign(ballOffset.z) * cameraPosition.z > 0) {
        cameraPosition.z = THREE.MathUtils.lerp(cameraPosition.z, -cameraPosition.z, zBlend);
      }
    }
    cameraPosition.add(cameraTarget);
    if (state.playMode) {
      const cameraLimit = STUDIO_ROOM_EXTENT - 0.45;
      const unclippedX = cameraPosition.x;
      const unclippedZ = cameraPosition.z;
      cameraPosition.x = THREE.MathUtils.clamp(cameraPosition.x, -cameraLimit, cameraLimit);
      cameraPosition.z = THREE.MathUtils.clamp(cameraPosition.z, -cameraLimit, cameraLimit);
      // When the player reaches a wall, trade clipped horizontal boom length
      // for height. The camera stays the requested distance from the ball
      // instead of crossing the wall or collapsing inside the felt.
      if (cameraPosition.x !== unclippedX || cameraPosition.z !== unclippedZ) {
        const horizontal = Math.hypot(
          cameraPosition.x - cameraTarget.x,
          cameraPosition.z - cameraTarget.z,
        );
        const lifted = Math.sqrt(Math.max(0, state.distance * state.distance - horizontal * horizontal));
        cameraPosition.y = Math.max(cameraPosition.y, cameraTarget.y + lifted);
      }
      cameraPosition.y = Math.min(cameraPosition.y, STUDIO_ROOM_TOP - 0.45);
    }
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
    const macroLens = 1 - smoothstep((state.distance - 1.24) / 1.30);
    camera.fov = THREE.MathUtils.lerp(38, 27, macroLens);
    const cameraToBallDistance = camera.position.distanceTo(ballOffset);
    const nearestFibreClearance = Math.max(0.002, cameraToBallDistance - 1.066);
    // Preserve the sub-millimetre macro near plane only while it is needed.
    // A 0.018 near plane across the whole 100-unit kitchen compressed almost
    // all D32 precision at the floor and amplified coplanar scanline acne.
    const roomDepthPrecision = smoothstep((state.distance - 2.2) / 5.8);
    const maximumNear = THREE.MathUtils.lerp(0.018, 0.16, roomDepthPrecision);
    camera.near = THREE.MathUtils.clamp(
      nearestFibreClearance * 0.17,
      0.00028,
      maximumNear,
    );
    camera.far = 100;
    camera.updateProjectionMatrix();
  }

  function updateRoomLighting(delta) {
    const target = state.playMode ? 1 : 0;
    const response = 1 - Math.exp(-delta * 4.8);
    state.roomLightLevel = THREE.MathUtils.lerp(state.roomLightLevel, target, response);
    const level = smoothstep(state.roomLightLevel);
    roomWash.intensity = level * 1.48;
    for (const light of roomLights) light.intensity = level * 1_050;
    roomPanelMaterial.color.lerpColors(roomPanelOffColor, roomPanelOnColor, level);
    tennis.studioStripMaterial.color.lerpColors(kitchenStripOffColor, kitchenStripOnColor, level);
    scene.environmentIntensity = THREE.MathUtils.lerp(1.04, 1.52, level);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.88, 1.02, level);
    scene.fog.density = THREE.MathUtils.lerp(0.032, 0.009, level);
  }

  function updatePlayerPhysics(delta) {
    const stepCount = Math.min(8, Math.max(1, Math.ceil(delta * 120)));
    const step = delta / stepCount;

    for (let iteration = 0; iteration < stepCount; ++iteration) {
      state.wallImpactCooldown = Math.max(0, state.wallImpactCooldown - step);
      controlForward.set(
        ballOffset.x - camera.position.x,
        0,
        ballOffset.z - camera.position.z,
      );
      if (controlForward.lengthSq() < 1e-6) controlForward.set(0, 0, -1);
      else controlForward.normalize();
      controlRight.crossVectors(controlForward, worldUp).normalize();
      const forwardInput = Number(heldMovementKeys.has("KeyW")) -
        Number(heldMovementKeys.has("KeyS"));
      const rightInput = Number(heldMovementKeys.has("KeyD")) -
        Number(heldMovementKeys.has("KeyA"));
      controlDirection.copy(controlForward).multiplyScalar(forwardInput)
        .addScaledVector(controlRight, rightInput);
      const hasInput = controlDirection.lengthSq() > 1e-6;
      if (hasInput) {
        controlDirection.normalize();
        state.linearVelocity.addScaledVector(
          controlDirection,
          (state.grounded ? 8.5 : 3.5) * step,
        );
      }
      const drag = state.grounded ? (hasInput ? 0.08 : 0.72) : 0.025;
      state.linearVelocity.multiplyScalar(Math.exp(-drag * step));
      const planarSpeed = Math.hypot(state.linearVelocity.x, state.linearVelocity.z);
      if (planarSpeed > 12) state.linearVelocity.multiplyScalar(12 / planarSpeed);

      if (state.jumpHeld && state.jumpBoostRemaining > 0 && state.bounceVelocity > 0) {
        state.bounceVelocity += 44 * step;
        state.jumpBoostRemaining = Math.max(0, state.jumpBoostRemaining - step);
      }
      if (!state.grounded) {
        // Scene units are ball radii, not metres. Earth gravity expressed in
        // those units must be much stronger than 9.8 or the ball hangs in air.
        state.bounceVelocity -= 28 * step;
      }

      const previousX = ballOffset.x;
      const previousZ = ballOffset.z;
      physicsPosition.set(ballOffset.x, state.bounceHeight, ballOffset.z);
      physicsVelocity.set(
        state.linearVelocity.x,
        state.bounceVelocity,
        state.linearVelocity.z,
      );
      physicsPosition.addScaledVector(physicsVelocity, step);
      const collision = kitchenCollisions.resolveSphere(
        physicsPosition,
        physicsVelocity,
        TENNIS_COLLISION_RADIUS,
      );
      ballOffset.x = physicsPosition.x;
      state.bounceHeight = physicsPosition.y;
      ballOffset.z = physicsPosition.z;
      state.linearVelocity.x = physicsVelocity.x;
      state.linearVelocity.z = physicsVelocity.z;
      state.bounceVelocity = physicsVelocity.y;
      state.supportHeight = collision.supportY;

      if (collision.lateralImpactSpeed > 0.8 && state.wallImpactCooldown <= 0) {
        impactAudio.play(collision.lateralImpactSpeed * 0.58);
        state.wallImpactCooldown = 0.075;
        state.gust = Math.max(
          state.gust,
          Math.min(1.1, collision.lateralImpactSpeed * 0.055),
        );
        console.log(
          `[RTX Tennis Felt] Solid impact ${collision.lateralImpactSpeed.toFixed(2)} m/s` +
          ` on ${collision.strongestContactName || "kitchen fixture"}` +
          ` at (${ballOffset.x.toFixed(2)}, ${ballOffset.z.toFixed(2)})`,
        );
      }

      if (collision.ceilingImpactSpeed > 0) {
        state.gust = Math.max(state.gust, 0.6);
      }

      if (collision.groundImpactSpeed > 0) {
        const impactSpeed = collision.groundImpactSpeed;
        state.deformationVelocity += impactSpeed * 0.14;
        state.gust = Math.max(state.gust, Math.min(1.0, impactSpeed * 0.16));
        if (impactSpeed > 1.18) {
          impactAudio.play(impactSpeed);
          state.grounded = false;
        } else {
          state.bounceVelocity = 0;
          state.bounceActive = false;
          state.grounded = true;
        }
      } else if (collision.grounded) {
        state.bounceVelocity = 0;
        state.bounceActive = false;
        state.grounded = true;
      } else {
        state.grounded = false;
        state.bounceActive = true;
      }

      const travelledX = ballOffset.x - previousX;
      const travelledZ = ballOffset.z - previousZ;
      const travel = Math.hypot(travelledX, travelledZ);
      if (travel > 1e-8) {
        rollingAxis.set(travelledZ, 0, -travelledX).normalize();
        rollingQuaternion.setFromAxisAngle(rollingAxis, travel / 1.0015);
        ballQuaternion.premultiply(rollingQuaternion).normalize();
      }
    }
  }

  function updateBounce(delta) {
    if (state.playMode) {
      updatePlayerPhysics(delta);
    } else if (state.bouncePending) {
      state.bounceCountdown -= delta;
      if (state.bounceCountdown <= 0) {
        state.bouncePending = false;
        state.bounceActive = true;
        state.grounded = false;
        state.bounceHeight = 0;
        state.bounceVelocity = 14.0;
        state.deformation = 0.075;
        state.deformationVelocity = -0.42;
        state.gust = Math.max(state.gust, 1.08);
      }
    }

    if (!state.playMode && state.bounceActive) {
      state.bounceVelocity -= 16.0 * delta;
      state.bounceHeight += state.bounceVelocity * delta;
      if (state.bounceHeight <= 0 && state.bounceVelocity < 0) {
        const impactSpeed = -state.bounceVelocity;
        impactAudio.play(impactSpeed);
        state.bounceHeight = 0;
        state.deformationVelocity += impactSpeed * 0.18;
        state.gust = Math.max(state.gust, Math.min(1.2, impactSpeed * 0.24));
        if (impactSpeed > 0.72) {
          state.bounceVelocity = impactSpeed * 0.52;
        } else {
          state.bounceVelocity = 0;
          state.bounceActive = false;
          state.grounded = true;
        }
      }
    }

    const deformationAcceleration =
      -155 * state.deformation - 17 * state.deformationVelocity;
    state.deformationVelocity += deformationAcceleration * delta;
    state.deformation += state.deformationVelocity * delta;
    state.deformation = THREE.MathUtils.clamp(state.deformation, -0.028, 0.095);
    if (!state.bounceActive && Math.abs(state.deformation) < 0.0002 &&
        Math.abs(state.deformationVelocity) < 0.002) {
      state.deformation = 0;
      state.deformationVelocity = 0;
    }

    const scaleY = 1 - state.deformation;
    const scaleXZ = 1 / Math.sqrt(Math.max(0.82, scaleY));
    ballScale.set(scaleXZ, scaleY, scaleXZ);
    tennis.ballGroup.scale.copy(ballScale);
    // Translate the raster shell and the GPU/BLAS fibre atlas identically.
    // Subtracting deformation holds the lower pole on its supporting surface while the
    // shell squashes, avoiding the visual split that occurred when only the
    // floor was moved as a bounce illusion.
    ballOffset.y = state.bounceHeight - state.deformation;
    tennis.ballGroup.position.copy(ballOffset);
    tennis.ballRotationGroup.quaternion.copy(ballQuaternion);
    sphere.center.copy(ballOffset);
    sphere.radius = 1.0015 * Math.max(ballScale.x, ballScale.y, ballScale.z);

    const compression = Math.max(0, state.deformation);
    tennis.contact.material.opacity = THREE.MathUtils.clamp(
      0.44 * Math.exp(-(state.bounceHeight - state.supportHeight) * 11) *
        (1 + compression * 1.8),
      0,
      0.62,
    );
    tennis.contact.scale.set(1 + compression * 1.8, 0.30 + compression * 0.75, 1);
    tennis.contact.position.x = ballOffset.x;
    tennis.contact.position.y = state.supportHeight - 1.00255;
    tennis.contact.position.z = ballOffset.z;
    return { ballScale, ballOffset };
  }

  let previousTime = performance.now();
  let elapsed = 0;
  let hudAccumulator = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
    previousTime = now;
    elapsed += delta;
    updateBounce(delta);
    updateRoomLighting(delta);
    // A real operator-followed studio spot keeps its optical axis on the
    // moving subject. The inverse-square light remains fixed in the room;
    // only the target, lens and housing orientation track the ball.
    aimSpotlightAt(ballOffset);
    updateCamera(elapsed, delta);
    state.gust *= Math.exp(-delta * 1.75);
    state.brushStrength *= Math.exp(-delta * 8.5);
    const wind = [
      0.30 + Math.sin(elapsed * 0.37) * 0.13,
      0.045 + Math.cos(elapsed * 0.29) * 0.035,
      -0.15 + Math.sin(elapsed * 0.23 + 1.4) * 0.11,
    ];
    const simulationFrame = state.resetRequested ? 0 : state.frameIndex++;
    state.resetRequested = false;
    const photographicMacro = 1 - smoothstep((state.distance - 1.24) / 1.30);
    // The sparse lens kernel is a deliberate macro-camera effect. At room
    // scale it turned every high-contrast tile/cabinet edge into coherent
    // horizontal trails, so fade the pass completely out before the kitchen
    // product view instead of retaining a permanently blurred minimum.
    const macroDof = smoothstep(photographicMacro);
    const spotDistance = fibreLightDirection.copy(softboxKey.position)
      .sub(ballOffset).length();
    fibreLightDirection.normalize();
    const roomLight = smoothstep(state.roomLightLevel);
    const rendered = rayRenderer.render(scene, camera, {
      simulation: {
        time: elapsed,
        delta,
        gust: state.gust,
        wind,
        brushNormal: state.brushNormal.toArray(),
        brushDirection: state.brushDirection.toArray(),
        brushStrength: state.brushStrength,
        brushRadius: state.distance < 1.35 ? 0.17 : 0.235,
        ballScale: ballScale.toArray(),
        ballOffset: ballOffset.toArray(),
        ballRotation: ballQuaternion.toArray(),
        frameIndex: simulationFrame,
      },
      lightDirection: fibreLightDirection.toArray(),
      lightDistance: spotDistance,
      lightAngularRadius: Math.atan(0.43 / Math.max(0.43, spotDistance)),
      lightIntensity: THREE.MathUtils.lerp(1.18, 1.34, roomLight),
      lightColor: [1.0, 0.94, 0.82],
      environmentColor: [
        THREE.MathUtils.lerp(0.38, 0.58, roomLight),
        THREE.MathUtils.lerp(0.43, 0.61, roomLight),
        THREE.MathUtils.lerp(0.24, 0.46, roomLight),
      ],
      environmentIntensity: THREE.MathUtils.lerp(0.68, 1.04, roomLight),
      dof: {
        focusDistance: Math.max(0.004, camera.position.distanceTo(ballOffset) - 1.0045),
        maximumCoc: 9.5 * macroDof,
        strength: 0.92 * macroDof,
        aperturePixels: 42 * macroDof,
      },
    });
    if (!rendered) {
      state.failed = true;
      state.lastError = rayRenderer.failure;
      renderer.setAnimationLoop(null);
      throw new Error(`Tennis-felt frame failed: ${state.lastError}`);
    }

    hudAccumulator += delta;
    if (hudAccumulator >= 0.1) {
      hudAccumulator = 0;
      hud.update({
        status: rayRenderer.status,
        surfaceMillimetres: surfaceDistanceMillimetres(camera.position.distanceTo(ballOffset)),
        gust: state.gust,
      });
    }
    rayRenderer.present(hud.renderToTexture());
  });

  globalThis.__tennisFeltSample = {
    state,
    stats: fibres.stats,
    get rtx() { return rayRenderer.status; },
    gust() { state.gust = 1.25; },
    reset() { state.resetRequested = true; },
    bounce() { launchBounce(); },
    play(enabled = true) { setPlayMode(enabled); },
    impact() { impactAudio.arm(); impactAudio.play(6.5); },
    setDistance(value) {
      state.autoCamera = false;
      state.targetDistance = THREE.MathUtils.clamp(Number(value), MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE);
    },
  };

  console.log(
    `[RTX Tennis Felt] ${fibres.stats.fibreCount.toLocaleString()} GPU springs` +
    ` · ${fibres.stats.vertexCount.toLocaleString()} shared raster/BLAS vertices` +
    ` · ${fibres.stats.triangleCount.toLocaleString()} dynamic triangles` +
    ` · nativeRayQuery=${nativeReady}`,
  );

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    renderer.domElement.removeEventListener("wheel", onWheel);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("keyup", onKeyUp);
    globalThis.removeEventListener("blur", onBlur);
    globalThis.removeEventListener("resize", resize);
    hud.dispose();
    rayRenderer.dispose();
    fibres.dispose();
    tennis.dispose();
    environmentTarget.dispose();
    key.dispose?.();
    softboxKey.dispose?.();
    softboxPanel.geometry.dispose();
    softboxPanel.material.dispose();
    spotlightFixture.geometry.dispose();
    spotlightFixture.material.dispose();
    coolFill.dispose?.();
    warmBounce.dispose?.();
    scene.remove(roomLightingGroup);
    for (const light of roomLights) light.dispose?.();
    roomWash.dispose?.();
    roomPanelGeometry.dispose();
    roomPanelMaterial.dispose();
    impactAudio.dispose();
    renderer.dispose();
    delete globalThis.__tennisFeltSample;
  }, { once: true });
}

await main();
