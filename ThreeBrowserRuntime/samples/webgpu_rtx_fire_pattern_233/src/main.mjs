import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";

import {
  FIRE_PATTERN_SEED,
  FIRE_SCORE_SECTIONS,
  FIRE_SCORE_TRACK,
  createFireScoreAudioController,
  sampleFireScore,
} from "./fire-score.mjs";
import { createFirePatternScene } from "./fire-scene.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "./native-rtx-renderer.mjs";
import { collectStaticRtxScene } from "./rtx-scene.mjs";

document.title = "RTX Fire Pattern 233 — ThreeBrowser Runtime";

const PIXEL_RATIO_CAP = 1.5;
const CAMERA_MIN_DISTANCE_SCALE = 0.58;
const CAMERA_MAX_DISTANCE_SCALE = 1.56;
const scratchColor = new THREE.Color();

const CAMERA_SHOTS = Object.freeze([
  Object.freeze({ time: 0, position: [0, 15.5, 30], target: [0, 0.5, 0], fov: 51 }),
  Object.freeze({ time: 15, position: [-19, 10, 23], target: [-1.5, 0.8, -1], fov: 48 }),
  Object.freeze({ time: 31, position: [-10, 5.4, 13], target: [0.7, 1.4, -1.8], fov: 57 }),
  Object.freeze({ time: 47, position: [15, 8.6, 17], target: [0, 1.4, 0], fov: 49 }),
  Object.freeze({ time: 62, position: [0, 27, 6], target: [0, 0.1, 0], fov: 43 }),
  Object.freeze({ time: 79, position: [21, 12, -14], target: [0, 1.2, 0], fov: 53 }),
  Object.freeze({ time: 96, position: [7, 4.4, 11], target: [-2.4, 1.2, -1.2], fov: 60 }),
  Object.freeze({ time: 112, position: [-22, 13, -18], target: [0, 2.0, 0], fov: 46 }),
  Object.freeze({ time: 132, position: [-3, 6, -12], target: [0, 1.9, 0], fov: 62 }),
  Object.freeze({ time: 148, position: [23, 17, 11], target: [0, 2.1, 0], fov: 44 }),
  Object.freeze({ time: 162, position: [-10, 6, 11], target: [0, 1.5, 0], fov: 57 }),
  Object.freeze({ time: 173, position: [0, 15, 27], target: [0, 1.0, 0], fov: 48 }),
  Object.freeze({ time: 180, position: [0, 12, 35], target: [0, 0.8, 0], fov: 51 }),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value), 0, 1);
}

function smoothUnit(value) {
  const unit = clamp01(value);
  return unit * unit * (3 - 2 * unit);
}

function formatTime(seconds) {
  const value = THREE.MathUtils.clamp(Math.floor(finite(seconds)), 0, FIRE_SCORE_TRACK.durationSeconds);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function normalizedMusic(music, timeSeconds) {
  const fallback = sampleFireScore(timeSeconds);
  const value = music && typeof music === "object" ? music : fallback;
  return Object.freeze({
    ...fallback,
    ...value,
    timeSeconds: finite(value.timeSeconds ?? value.currentTime, timeSeconds),
    pulse: clamp01(value.pulse ?? value.kick ?? fallback.pulse),
    bass: clamp01(value.bass ?? value.low ?? fallback.bass),
    energy: clamp01(value.energy ?? value.heat ?? fallback.energy),
    flare: clamp01(value.flare ?? value.cuePulse ?? fallback.flare),
    ember: clamp01(value.ember ?? value.shimmer ?? fallback.ember),
    playing: Boolean(value.playing),
    available: value.available !== false,
    section: String(value.section ?? value.sectionId ?? fallback.section ?? "cinder-breath"),
  });
}

function createFireEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x050102);
  const owned = [];

  const shellMaterial = new THREE.MeshBasicMaterial({
    color: 0x130508,
    side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 16), shellMaterial);
  environmentScene.add(shell);
  owned.push(shell.geometry, shellMaterial);

  const cards = [
    { color: 0xff3908, energy: 10.5, size: [8, 13], position: [-18, 5, -7], rotation: [0, Math.PI * 0.44, 0] },
    { color: 0xffb020, energy: 8.2, size: [7, 11], position: [17, 4, 2], rotation: [0, -Math.PI * 0.48, 0] },
    { color: 0xff164d, energy: 5.8, size: [13, 4], position: [0, 12, -20], rotation: [0.2, 0, 0] },
    { color: 0x6120ff, energy: 3.8, size: [11, 5], position: [-4, 8, 20], rotation: [0, Math.PI, 0] },
    { color: 0xffe8a8, energy: 5.2, size: [5, 3], position: [0, 15, 0], rotation: [Math.PI * 0.5, 0, 0] },
  ];
  for (const card of cards) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(card.color).multiplyScalar(card.energy),
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const geometry = new THREE.PlaneGeometry(...card.size);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...card.position);
    mesh.rotation.set(...card.rotation);
    environmentScene.add(mesh);
    owned.push(geometry, material);
  }

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.035,
    0.1,
    52,
    { size: 256, position: new THREE.Vector3(0, 4, 0) },
  );
  generator.dispose();
  for (const value of owned) value.dispose?.();
  return target;
}

function createHud() {
  const root = document.createElement("div");
  root.setAttribute("aria-label", "Fire Pattern 233 score and renderer status");
  Object.assign(root.style, {
    position: "fixed",
    left: "clamp(14px,2.2vw,38px)",
    top: "clamp(14px,2.2vw,34px)",
    zIndex: "10",
    color: "#fff1d5",
    fontFamily: "ui-monospace,SFMono-Regular,Consolas,monospace",
    textShadow: "0 0 16px rgba(255,81,12,.82)",
    pointerEvents: "none",
    userSelect: "none",
    letterSpacing: ".08em",
  });

  const title = document.createElement("div");
  title.textContent = "CIN / SIN  ·  FIRE PATTERN +233";
  Object.assign(title.style, {
    fontSize: "clamp(14px,1.3vw,23px)",
    fontWeight: "800",
    letterSpacing: ".18em",
  });
  const status = document.createElement("div");
  Object.assign(status.style, {
    marginTop: "7px",
    color: "#ffb27a",
    fontSize: "clamp(9px,.72vw,12px)",
    lineHeight: "1.65",
    whiteSpace: "pre-line",
  });
  const controls = document.createElement("div");
  controls.textContent = "DRAG ORBIT  ·  WHEEL DOLLY  ·  C CINEMA  ·  1–9 MOVEMENTS\nM MUSIC  ·  P PAUSE  ·  SPACE FLARE  ·  X RTX  ·  R RESTART";
  Object.assign(controls.style, {
    marginTop: "9px",
    padding: "8px 11px",
    borderLeft: "2px solid rgba(255,78,18,.78)",
    background: "linear-gradient(90deg,rgba(14,2,1,.70),rgba(14,2,1,0))",
    color: "rgba(255,235,213,.76)",
    fontSize: "clamp(8px,.62vw,10px)",
    lineHeight: "1.65",
    whiteSpace: "pre-line",
  });
  root.append(title, status, controls);
  document.body.append(root);

  return Object.freeze({
    update(music, renderStatus, worldStats, state) {
      const section = music.section.replaceAll("-", " ").toUpperCase();
      const transport = music.playing ? "SCORE LIVE" : "PRESS M / CLICK FOR SCORE";
      const path = String(renderStatus.lastPresentedPath ?? renderStatus.lastPath ?? "starting")
        .replaceAll("-", " ").toUpperCase();
      const cue = Math.max(0, Math.trunc(finite(
        music.cueIndex ?? music.cuesPassed ?? music.cueId ?? worldStats?.activeCue,
      )));
      status.textContent =
        `${formatTime(music.timeSeconds)} / 03:00  ·  ${transport}  ·  ${section}\n` +
        `CUE ${String(cue).padStart(3, "0")} / 233  ·  ${worldStats?.nodeCount ?? 233} LINKED FLAMES  ·  ${path}\n` +
        `${state.autoCamera ? "CINEMATIC FLIGHT" : "MANUAL ORBIT"}  ·  SEED ${String(worldStats?.seedHash ?? "P4-11C9").toUpperCase()}`;
    },
    dispose() { root.remove(); },
  });
}

function cameraShotAt(timeSeconds) {
  const time = THREE.MathUtils.clamp(finite(timeSeconds), 0, FIRE_SCORE_TRACK.durationSeconds);
  let index = 0;
  while (index + 1 < CAMERA_SHOTS.length && time >= CAMERA_SHOTS[index + 1].time) ++index;
  const first = CAMERA_SHOTS[index];
  const second = CAMERA_SHOTS[Math.min(index + 1, CAMERA_SHOTS.length - 1)];
  const duration = Math.max(0.001, second.time - first.time);
  const unit = first === second ? 0 : smoothUnit((time - first.time) / duration);
  return {
    position: new THREE.Vector3(...first.position).lerp(new THREE.Vector3(...second.position), unit),
    target: new THREE.Vector3(...first.target).lerp(new THREE.Vector3(...second.target), unit),
    fov: THREE.MathUtils.lerp(first.fov, second.fov, unit),
    shot: index,
  };
}

async function main() {
  if (!WebGPU.isAvailable()) throw new Error("RTX Fire Pattern 233 requires WebGPU.");

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#030101";

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: false,
  });
  renderer.setPixelRatio(Math.min(
    PIXEL_RATIO_CAP,
    Math.max(1, finite(globalThis.devicePixelRatio, 1)),
  ));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x030101, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.94;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  Object.assign(renderer.domElement.style, {
    position: "fixed",
    inset: "0",
    width: "100%",
    height: "100%",
    touchAction: "none",
    cursor: "grab",
  });
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend || !renderer.backend?.device) {
    throw new Error("RTX Fire Pattern 233 did not receive the native WebGPU backend.");
  }

  const validationErrors = [];
  renderer.backend.device.addEventListener?.("uncapturederror", event => {
    const message = event.error?.message || String(event.error || event);
    validationErrors.push(message);
    console.error("[Fire Pattern WebGPU]", message);
  });

  const scene = new THREE.Scene();
  scene.name = "CIN SIN through-composed fire pattern with 233 linked nodes";
  scene.background = new THREE.Color(0x030101);
  scene.fog = new THREE.FogExp2(0x100304, 0.014);

  const camera = new THREE.PerspectiveCamera(
    CAMERA_SHOTS[0].fov,
    innerWidth / Math.max(1, innerHeight),
    0.04,
    180,
  );
  camera.position.set(...CAMERA_SHOTS[0].position);
  camera.lookAt(new THREE.Vector3(...CAMERA_SHOTS[0].target));

  const environmentTarget = createFireEnvironment(renderer);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.92;

  const fireWorld = createFirePatternScene(scene, { seed: FIRE_PATTERN_SEED });
  prepareRtxGuideMaterials(scene);
  const audio = createFireScoreAudioController();
  const hud = createHud();

  const rtx = navigator.gpu?.threeBrowserRTX ?? null;
  const capabilities = rtx?.capabilities ?? {};
  const previousReflexMode = rtx?.reflexMode ?? 0;
  try {
    const features = {
      dlssSuperResolution: false,
      dlssFrameGeneration: false,
      dlssRayReconstruction: false,
    };
    if (capabilities.reflex) features.reflex = "boost";
    rtx?.requestFeatures?.(features);
  } catch (error) {
    console.warn("[Fire Pattern RTX] Feature request rejected: " + (error?.message || error));
  }

  const nativeRenderer = new NativeRtxRenderer(renderer, camera, rtx, {
    timeoutMs: 30_000,
    directionalLightIntensity: 0.34,
    directionalAngularRadius: 0.014,
    directionalSampleCount: 8,
    aoSampleCount: 16,
    maxDistance: 150,
    rayBias: 0.006,
    shadowStrength: 0.42,
    aoStrength: 0.24,
    aoRadius: 1.8,
    reflectionStrength: 1.42,
    reflectionDistance: 145,
    reflectionRayBias: 0.008,
    roughnessCutoff: 0.82,
  });
  const bufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  nativeRenderer.resize(bufferSize.x, bufferSize.y);

  const state = {
    elapsed: 0,
    paused: false,
    forceRaster: false,
    nativeConfigured: false,
    setupFinished: false,
    staticSceneStats: null,
    autoCamera: true,
    dragging: false,
    previousPointer: new THREE.Vector2(),
    yaw: 0,
    targetYaw: 0,
    pitch: 0,
    targetPitch: 0,
    distanceScale: 1,
    targetDistanceScale: 1,
    manualPulse: 0,
    audioEngaged: false,
    lastHudTime: -Infinity,
    scoreTime: 0,
    currentShot: 0,
    manualPosition: camera.position.clone(),
    manualTarget: new THREE.Vector3(...CAMERA_SHOTS[0].target),
    manualFov: camera.fov,
  };

  async function ensureMusic({ restart = false } = {}) {
    const before = audio.status?.() ?? {};
    let started = false;
    if (restart && typeof audio.restart === "function") {
      started = await audio.restart();
    } else if (before.playing) {
      return true;
    } else if (before.ended && typeof audio.restart === "function") {
      started = await audio.restart();
    } else if (typeof audio.start === "function") {
      started = await audio.start();
    } else if (typeof audio.play === "function") {
      started = await audio.play();
    }
    if (started) {
      state.audioEngaged = true;
      state.paused = false;
    }
    return Boolean(started);
  }

  function setAutoCamera(value = true) {
    const next = Boolean(value);
    if (!next && state.autoCamera) {
      const rig = cameraShotAt(state.scoreTime);
      state.manualPosition.copy(camera.position);
      state.manualTarget.copy(rig.target);
      state.manualFov = camera.fov;
      state.targetYaw = 0;
      state.targetPitch = 0;
      state.targetDistanceScale = 1;
    } else if (next && !state.autoCamera) {
      state.targetYaw = 0;
      state.targetPitch = 0;
      state.targetDistanceScale = 1;
    }
    state.autoCamera = next;
    return state.autoCamera;
  }

  function restartExperience() {
    state.elapsed = 0;
    state.scoreTime = 0;
    state.paused = false;
    state.manualPulse = 1.45;
    setAutoCamera(true);
    state.targetYaw = 0;
    state.targetPitch = 0;
    state.targetDistanceScale = 1;
    if (typeof fireWorld.reset === "function") fireWorld.reset();
    void ensureMusic({ restart: true });
  }

  function onPointerDown(event) {
    void ensureMusic();
    if (event.button !== 0) return;
    state.dragging = true;
    setAutoCamera(false);
    state.previousPointer.set(event.clientX, event.clientY);
    renderer.domElement.style.cursor = "grabbing";
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!state.dragging) return;
    const dx = event.clientX - state.previousPointer.x;
    const dy = event.clientY - state.previousPointer.y;
    state.targetYaw -= dx * 0.0042;
    state.targetPitch = THREE.MathUtils.clamp(state.targetPitch + dy * 0.0032, -0.72, 0.72);
    state.previousPointer.set(event.clientX, event.clientY);
  }

  function onPointerUp(event) {
    state.dragging = false;
    renderer.domElement.style.cursor = "grab";
    renderer.domElement.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    setAutoCamera(false);
    state.targetDistanceScale = THREE.MathUtils.clamp(
      state.targetDistanceScale * Math.exp(Math.sign(event.deltaY) * 0.105),
      CAMERA_MIN_DISTANCE_SCALE,
      CAMERA_MAX_DISTANCE_SCALE,
    );
    event.preventDefault?.();
  }

  async function onKeyDown(event) {
    if (event.repeat) return;
    const key = String(event.key || "").toLowerCase();
    if (event.code === "Space") {
      event.preventDefault();
      void ensureMusic();
      state.manualPulse = event.shiftKey ? 2.5 : 1.55;
    } else if (key === "m") {
      if (typeof audio.toggle === "function") {
        const playing = await audio.toggle();
        state.audioEngaged ||= Boolean(playing);
      } else {
        await ensureMusic();
      }
    } else if (key === "p") {
      state.paused = !state.paused;
      if (state.paused) audio.pause?.();
      else await ensureMusic();
    } else if (key === "c") {
      setAutoCamera(!state.autoCamera);
    } else if (key === "x") {
      state.forceRaster = !state.forceRaster;
    } else if (key === "r") {
      restartExperience();
    } else if (/^[1-9]$/.test(key)) {
      const section = FIRE_SCORE_SECTIONS[Number(key) - 1];
      const nextTime = section?.startSeconds ?? 0;
      state.elapsed = nextTime;
      state.scoreTime = nextTime;
      audio.seek?.(nextTime);
      state.manualPulse = 1.1;
      await ensureMusic();
    } else {
      void ensureMusic();
    }
  }

  function onContextMenu(event) {
    event.preventDefault();
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (!nativeRenderer.resize(buffer.x, buffer.y)) state.nativeConfigured = false;
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointercancel", onPointerUp);
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
  renderer.domElement.addEventListener("contextmenu", onContextMenu);
  globalThis.addEventListener("keydown", onKeyDown);
  globalThis.addEventListener("resize", resize);

  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const viewDirection = new THREE.Vector3();
  const spherical = new THREE.Spherical();
  function updateCamera(delta, music) {
    const authoredRig = cameraShotAt(music.timeSeconds);
    const rig = state.autoCamera
      ? authoredRig
      : {
          position: state.manualPosition,
          target: state.manualTarget,
          fov: state.manualFov,
          shot: state.currentShot,
        };
    state.currentShot = rig.shot;
    const response = 1 - Math.exp(-Math.min(0.08, delta) * 5.4);
    state.yaw = THREE.MathUtils.lerp(state.yaw, state.targetYaw, response);
    state.pitch = THREE.MathUtils.lerp(state.pitch, state.targetPitch, response);
    state.distanceScale = THREE.MathUtils.lerp(
      state.distanceScale,
      state.targetDistanceScale,
      response,
    );

    desiredPosition.copy(rig.position);
    desiredTarget.copy(rig.target);
    const movement = state.autoCamera ? 1 : 0;
    desiredPosition.x += Math.sin(music.timeSeconds * 0.071 + rig.shot * 0.7) * 0.58 * movement;
    desiredPosition.y += Math.sin(music.timeSeconds * 0.113 + 0.4) * 0.18 * movement;
    desiredTarget.y += music.flare * 0.32;

    viewDirection.subVectors(desiredPosition, desiredTarget);
    spherical.setFromVector3(viewDirection);
    spherical.theta += state.yaw;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + state.pitch, 0.18, Math.PI - 0.18);
    spherical.radius = Math.max(3.2, spherical.radius * state.distanceScale);
    viewDirection.setFromSpherical(spherical);
    desiredPosition.copy(desiredTarget).add(viewDirection);

    camera.position.lerp(desiredPosition, response * (state.autoCamera ? 0.76 : 0.92));
    camera.fov = THREE.MathUtils.lerp(camera.fov, rig.fov - music.flare * 1.8, response * 0.58);
    camera.updateProjectionMatrix();
    camera.lookAt(desiredTarget);
  }

  function snapshot() {
    return {
      title: document.title,
      seed: FIRE_PATTERN_SEED,
      score: normalizedMusic(audio.status?.(), state.scoreTime),
      world: fireWorld.stats?.() ?? null,
      render: nativeRenderer.status(),
      nativeConfigured: state.nativeConfigured,
      setupFinished: state.setupFinished,
      staticScene: state.staticSceneStats ? { ...state.staticSceneStats } : null,
      camera: {
        auto: state.autoCamera,
        shot: state.currentShot,
        position: camera.position.toArray(),
      },
      forceRaster: state.forceRaster,
      validationErrors: [...validationErrors],
    };
  }

  globalThis.__FIRE_PATTERN_233_DEMO__ = Object.freeze({
    snapshot,
    control: Object.freeze({
      music: () => audio.toggle?.() ?? ensureMusic(),
      pause(value = true) {
        state.paused = Boolean(value);
        if (state.paused) audio.pause?.();
        else void ensureMusic();
        return state.paused;
      },
      flare(strength = 1.55) {
        state.manualPulse = THREE.MathUtils.clamp(finite(strength, 1.55), 0, 3);
        return state.manualPulse;
      },
      cinema: setAutoCamera,
      compareRaster(value = true) { state.forceRaster = Boolean(value); return state.forceRaster; },
      seek(seconds = 0) {
        const nextTime = THREE.MathUtils.clamp(
          finite(seconds),
          0,
          FIRE_SCORE_TRACK.durationSeconds,
        );
        state.elapsed = nextTime;
        state.scoreTime = nextTime;
        audio.seek?.(nextTime);
        return nextTime;
      },
      restart: restartExperience,
    }),
  });

  renderer.compileAsync?.(scene, camera)?.catch?.(error => {
    console.warn("[Fire Pattern] Shader prewarm deferred: " + (error?.message || error));
  });

  let previousTime = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const wallDelta = Math.max(0, (now - previousTime) / 1000);
    const delta = Math.min(0.075, wallDelta);
    previousTime = now;
    if (!state.paused) {
      state.elapsed = Math.min(FIRE_SCORE_TRACK.durationSeconds, state.elapsed + delta);
    }

    const audioState = audio.update?.() ?? audio.status?.() ?? null;
    const audioTime = finite(audioState?.timeSeconds ?? audioState?.currentTime, 0);
    const useAudioClock = state.audioEngaged || Boolean(audioState?.playing) || audioTime > 0.001;
    state.scoreTime = THREE.MathUtils.clamp(
      useAudioClock ? audioTime : state.elapsed,
      0,
      FIRE_SCORE_TRACK.durationSeconds,
    );
    const scoreAnalysis = normalizedMusic(
      useAudioClock ? audioState : sampleFireScore(state.scoreTime),
      state.scoreTime,
    );
    const music = Object.freeze({
      ...scoreAnalysis,
      cuePackets: audio.pollCues?.() ?? Object.freeze([]),
    });

    if (!state.paused) {
      fireWorld.update?.(
        music,
        state.scoreTime,
        delta,
        camera,
        state.manualPulse,
      );
      state.manualPulse = Math.max(0, state.manualPulse - delta * 3.2);
    }
    updateCamera(delta, music);

    let staged = false;
    if (state.nativeConfigured && !state.forceRaster) {
      scratchColor.setHSL(
        0.035 + music.ember * 0.015,
        0.92,
        0.48 + music.energy * 0.12,
        THREE.LinearSRGBColorSpace,
      );
      staged = nativeRenderer.renderNative(scene, camera, {
        directionalLightDirection: [-0.28, 0.88, -0.37],
        directionalLightIntensity: 0.26 + music.energy * 0.22,
        reflectionStrength: 1.26 + music.flare * 0.28 + music.energy * 0.10,
        reflectionDistance: 145,
        reflectionRayBias: 0.008,
        roughnessCutoff: 0.82,
        maxDistance: 150,
        rayBias: 0.006,
        environmentColor: [scratchColor.r * 0.02, scratchColor.g * 0.008, scratchColor.b * 0.004],
        environmentIntensity: 0.12,
        highQuality: true,
      });
      if (!staged && !nativeRenderer.status().configured) state.nativeConfigured = false;
    }
    if (!staged) staged = nativeRenderer.renderRaster(scene, camera);
    if (staged && !nativeRenderer.present()) {
      console.error("[Fire Pattern] Single-surface presentation failed.");
    }

    if (state.scoreTime - state.lastHudTime >= 0.10 || state.scoreTime < state.lastHudTime) {
      state.lastHudTime = state.scoreTime;
      hud.update(music, nativeRenderer.status(), fireWorld.stats?.(), state);
    }
  });

  const bridgeUsable = Boolean(
    rtx &&
    typeof rtx.registerStaticScene === "function" &&
    (typeof rtx.evaluateRayLighting === "function" || typeof rtx.evaluateRayReflections === "function"),
  );
  void (async () => {
    if (!bridgeUsable) {
      state.setupFinished = true;
      console.warn("[Fire Pattern RTX] Native bridge unavailable; WebGPU fallback remains active.");
      return;
    }
    try {
      const staticRoots = fireWorld.staticMeshes?.length
        ? fireWorld.staticMeshes
        : [fireWorld.root];
      const staticScene = await collectStaticRtxScene(staticRoots, {
        maxTriangles: 520_000,
        lights: fireWorld.lights ?? [],
        yieldToHost: () => new Promise(resolve => setTimeout(resolve, 0)),
      });
      state.staticSceneStats = {
        triangles: staticScene.triangleCount,
        vertices: staticScene.vertexCount,
        meshes: staticScene.sourceMeshCount,
        instances: staticScene.sourceInstanceCount,
        lights: staticScene.lightCount,
        truncated: staticScene.truncated,
      };
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      state.nativeConfigured = await nativeRenderer.configure(
        buffer.x,
        buffer.y,
        staticScene,
        null,
      );
      console.log(
        `[Fire Pattern RTX] registered=${state.nativeConfigured}` +
        ` · static=${staticScene.triangleCount.toLocaleString()} triangles` +
        ` · instances=${staticScene.sourceInstanceCount}` +
        ` · lights=${staticScene.lightCount}`,
      );
    } catch (error) {
      console.warn("[Fire Pattern RTX] Setup failed; raster remains active: " + (error?.message || error));
    } finally {
      state.setupFinished = true;
    }
  })();

  globalThis.addEventListener("beforeunload", () => {
    renderer.setAnimationLoop(null);
    renderer.domElement.removeEventListener("pointerdown", onPointerDown);
    renderer.domElement.removeEventListener("pointermove", onPointerMove);
    renderer.domElement.removeEventListener("pointerup", onPointerUp);
    renderer.domElement.removeEventListener("pointercancel", onPointerUp);
    renderer.domElement.removeEventListener("wheel", onWheel);
    renderer.domElement.removeEventListener("contextmenu", onContextMenu);
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    audio.dispose?.();
    hud.dispose();
    nativeRenderer.dispose();
    fireWorld.dispose?.();
    environmentTarget.dispose();
    if (rtx && capabilities.reflex) {
      try { rtx.requestFeatures?.({ reflexMode: previousReflexMode }); } catch { /* adapter teardown */ }
    }
    renderer.dispose();
    delete globalThis.__FIRE_PATTERN_233_DEMO__;
  }, { once: true });
}

await main();
