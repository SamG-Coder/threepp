// Client-only ThreeBrowser Runtime sample. Camera capture is consumed through
// the existing browser-compatible media surface; all tracking, simulation,
// rendering, composition and UI below are JavaScript/TSL owned by this sample.
globalThis.__threeBrowserSourceURL =
  "https://webgpu-camera-light-sculpture.runtime.threebrowser.local/";

import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { pass } from "three/tsl";

import {
  CAMERA_TEXTURE_HEIGHT,
  CAMERA_TEXTURE_WIDTH,
  compositePersonMatteRgba,
  coverPlaneSize,
  fillSyntheticCameraFrame,
  texturePointToWorld,
} from "./src/camera-background.mjs";
import { createLightSculptureHud } from "./src/hud.mjs";
import {
  GESTURE_CLOSED,
  GESTURE_NONE,
  GESTURE_OPEN,
  GESTURE_POINT,
  GESTURE_SWIPE,
  createMotionTracker,
  downsampleRgba,
} from "./src/motion-tracker.mjs";
import { createPersonMatte } from "./src/person-matte.mjs";
import { createParticleField } from "./src/particle-field.mjs";

const SOURCE_STAGED = "AUTONOMOUS FIELD / CAMERA OFF";
const SOURCE_CONNECTING = "REQUESTING CAMERA ACCESS...";
const SOURCE_WAITING = "CAMERA ALLOWED / WAITING FOR VIDEO...";
const SOURCE_CALIBRATING = "PERSON MATTE / MOVE TO REVEAL";
const SOURCE_CAMERA = "LIVE YCBCR PERSON MATTE";
const MAX_DELTA = 1 / 30;
const TRACK_INTERVAL_MS = 33;

const clamp01 = value => Math.min(1, Math.max(0, Number(value) || 0));

function cameraFailureMessage(error) {
  const name = String(error?.name || "");
  if (name === "NotAllowedError") return "ACCESS BLOCKED - ENABLE WINDOWS CAMERA PRIVACY, THEN PRESS C";
  if (name === "NotFoundError") return "NO CAMERA FOUND - CONNECT ONE, THEN PRESS C";
  if (name === "NotReadableError") return "CAMERA BUSY OR UNREADABLE - CLOSE OTHER CAMERA APPS, THEN PRESS C";
  return error?.message || String(error);
}

function cameraFrame(video, fallbackCanvas) {
  if (typeof video?.__threeBrowserExternalFrame === "function") {
    return video.__threeBrowserExternalFrame();
  }
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  try {
    if (fallbackCanvas.width !== video.videoWidth) fallbackCanvas.width = video.videoWidth;
    if (fallbackCanvas.height !== video.videoHeight) fallbackCanvas.height = video.videoHeight;
    const context = fallbackCanvas.getContext("2d");
    context.drawImage(video, 0, 0, fallbackCanvas.width, fallbackCanvas.height);
    const image = context.getImageData(0, 0, fallbackCanvas.width, fallbackCanvas.height);
    return {
      width: image.width,
      height: image.height,
      data: image.data,
      sequence: Math.round((video.currentTime || performance.now() / 1000) * 1000),
    };
  } catch {
    return null;
  }
}

const ACTIVE_GESTURES = Object.freeze([
  GESTURE_POINT,
  GESTURE_CLOSED,
  GESTURE_OPEN,
  GESTURE_SWIPE,
]);

function resolvedGesture(slot) {
  // Point is the interaction's hard priority. Even a fast pointing motion
  // remains a fingertip follower instead of being reinterpreted as a swipe.
  if (slot?.poseGesture === GESTURE_POINT) return GESTURE_POINT;
  if (ACTIVE_GESTURES.includes(slot?.gesture)) return slot.gesture;
  // Ease into the fingertip follower before the stricter point-pose
  // hysteresis confirms. Compact/open silhouettes still take precedence as
  // soon as their two-frame confirmation completes.
  if (
    slot?.visible !== false &&
    Number(slot?.confidence) >= 0.2 &&
    Number(slot?.pointing) >= 0.28 &&
    Number(slot?.tip?.confidence) >= 0.2
  ) return GESTURE_POINT;
  return GESTURE_NONE;
}

function slotCoordinate(slot, preferTip = false) {
  const source = preferTip && slot?.tip?.visible !== false
    ? slot.tip
    : slot;
  const position = source?.position || source?.point || source;
  return {
    x: Number(source?.rawX ?? source?.sourceX ?? position?.x),
    y: Number(source?.rawY ?? source?.sourceY ?? position?.y),
  };
}

function slotVelocity(slot, preferTip = false) {
  const source = preferTip
    ? slot?.tip?.velocity || slot?.tipVelocity || slot?.fingerVelocity || slot?.velocity || slot
    : slot?.velocity || slot;
  const velocity = source?.velocity || source;
  return {
    x: Number(source?.velocityX ?? velocity?.x) || 0,
    y: Number(source?.velocityY ?? velocity?.y) || 0,
  };
}

async function main() {
  document.title = "Camera Light Sculpture — ThreeBrowser Runtime";
  if (!WebGPU.isAvailable()) throw new Error("Camera Light Sculpture requires WebGPU.");

  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#020107";

  const query = new URLSearchParams(globalThis.location?.search || "");
  const bloomDisabled = query.get("bloom") === "0";

  const renderer = new THREE.WebGPURenderer({
    antialias: false,
    powerPreference: "high-performance",
    requiredLimits: { maxStorageBuffersInVertexStage: 2 },
  });
  renderer.setPixelRatio(Math.min(1.35, Math.max(1, Number(globalThis.devicePixelRatio || 1))));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) {
    throw new Error("Camera Light Sculpture did not receive a WebGPU backend.");
  }
  const directToneMapping = renderer.toneMapping;
  const directOutputColorSpace = renderer.outputColorSpace;
  const directXrEnabled = renderer.xr?.enabled ?? false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020107);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  camera.position.set(0, 0, 6);
  camera.lookAt(0, 0, 0);

  const framePixels = new Uint8Array(CAMERA_TEXTURE_WIDTH * CAMERA_TEXTURE_HEIGHT * 4);
  fillSyntheticCameraFrame(framePixels, CAMERA_TEXTURE_WIDTH, CAMERA_TEXTURE_HEIGHT, 0);
  const cameraTexture = new THREE.DataTexture(
    framePixels,
    CAMERA_TEXTURE_WIDTH,
    CAMERA_TEXTURE_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  cameraTexture.name = "Mirrored YCbCr person matte or synthetic background";
  cameraTexture.colorSpace = THREE.SRGBColorSpace;
  cameraTexture.flipY = true;
  cameraTexture.minFilter = THREE.LinearFilter;
  cameraTexture.magFilter = THREE.LinearFilter;
  cameraTexture.generateMipmaps = false;
  cameraTexture.needsUpdate = true;

  const backgroundMaterial = new THREE.MeshBasicNodeMaterial({
    map: cameraTexture,
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  backgroundMaterial.toneMapped = false;
  const background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundMaterial);
  background.position.z = -1.4;
  background.renderOrder = -10;
  background.frustumCulled = false;
  scene.add(background);

  const particleField = createParticleField(renderer);
  scene.add(particleField.object || particleField.mesh);

  const hud = createLightSculptureHud();
  scene.add(hud.mesh);

  const tracker = createMotionTracker({
    sampleWidth: 128,
    sampleHeight: 96,
    tipPositionSharpness: 36,
    targetAspect: CAMERA_TEXTURE_WIDTH / CAMERA_TEXTURE_HEIGHT,
    mirrorX: true,
  });
  const personMatte = createPersonMatte({
    temporalAttack: 0.72,
    temporalRelease: 0.12,
  });
  const fallbackCanvas = document.createElement("canvas");
  const state = {
    stream: null,
    video: null,
    pendingStream: null,
    cameraStarting: false,
    cameraGeneration: 0,
    cameraHasFrame: false,
    cameraError: "",
    sourceLabel: SOURCE_STAGED,
    frameSequence: -1,
    frameWidth: CAMERA_TEXTURE_WIDTH,
    frameHeight: CAMERA_TEXTURE_HEIGHT,
    lastTrackAt: -Infinity,
    tracking: null,
    personLayer: null,
    gestureEffects: Array.from({ length: 2 }, () => ({
      mode: GESTURE_NONE,
      lastPose: GESTURE_NONE,
      armed: 0,
      charge: 0,
      release: 0,
    })),
    lastSyntheticAt: -Infinity,
    planeSize: coverPlaneSize(innerWidth / Math.max(1, innerHeight)),
    bloomActive: !bloomDisabled,
    bloomGesture: 0,
    bloomError: "",
    gpuError: "",
    lastHudAt: -Infinity,
    disposed: false,
  };

  function onUncapturedGpuError(event) {
    state.gpuError = event?.error?.message || event?.message || "uncaptured WebGPU error";
    console.error("[Camera Light Sculpture] WebGPU error: " + state.gpuError);
  }
  renderer.backend.device?.addEventListener?.("uncapturederror", onUncapturedGpuError);

  function resetGestureEffects() {
    for (const effect of state.gestureEffects) {
      effect.mode = GESTURE_NONE;
      effect.lastPose = GESTURE_NONE;
      effect.armed = 0;
      effect.charge = 0;
      effect.release = 0;
    }
  }

  function updateGestureEffects(delta) {
    const slots = state.tracking?.slots || [];
    const pointPriority = slots.some(slot =>
      Number(slot?.confidence) >= 0.035 && resolvedGesture(slot) === GESTURE_POINT,
    );
    for (let index = 0; index < state.gestureEffects.length; ++index) {
      const effect = state.gestureEffects[index];
      const slot = slots.find(candidate => Number(candidate?.id) === index) || slots[index];
      const confidence = clamp01(slot?.confidence);
      const rawMode = confidence >= 0.035 ? resolvedGesture(slot) : GESTURE_NONE;
      const reportedPose = ACTIVE_GESTURES.includes(slot?.poseGesture) && slot.poseGesture !== GESTURE_SWIPE
        ? slot.poseGesture
        : rawMode !== GESTURE_SWIPE
          ? rawMode
          : effect.lastPose;

      if (pointPriority && rawMode !== GESTURE_POINT) {
        effect.mode = GESTURE_NONE;
        effect.armed *= Math.exp(-delta * 1.8);
        effect.charge *= Math.exp(-delta * 0.5);
        effect.release *= Math.exp(-delta * 3.2);
        continue;
      }

      const engagementDecay = rawMode === GESTURE_OPEN
        ? 0.9
        : rawMode === GESTURE_NONE ? 0.85 : 0.24;
      effect.armed *= Math.exp(-delta * engagementDecay);
      if (rawMode === GESTURE_POINT) effect.armed = 1;
      if (rawMode === GESTURE_SWIPE) effect.armed = Math.max(effect.armed, 0.82);
      if (rawMode === GESTURE_CLOSED && effect.armed > 0.04) {
        effect.armed = 1;
      }
      effect.mode = (
        rawMode === GESTURE_POINT ||
        rawMode === GESTURE_SWIPE ||
        effect.armed > 0.04
      ) ? rawMode : GESTURE_NONE;
      effect.release *= Math.exp(-delta * 2.15);

      if (effect.mode === GESTURE_CLOSED) {
        effect.charge = Math.min(1, effect.charge + delta * (0.48 + confidence * 0.78));
      } else {
        effect.charge *= Math.exp(-delta * (effect.mode === GESTURE_OPEN ? 2.8 : 0.34));
      }

      if (
        effect.mode === GESTURE_OPEN &&
        reportedPose === GESTURE_OPEN &&
        effect.lastPose !== GESTURE_OPEN
      ) {
        // Opening always creates a readable release; a preceding grip raises
        // it from a playful ripple to a full charged shockwave.
        effect.release = Math.max(effect.release, 0.5 + effect.charge * 0.5);
        effect.armed *= 0.58;
      }
      if (effect.mode !== GESTURE_NONE && reportedPose !== GESTURE_NONE) {
        effect.lastPose = reportedPose;
      }
    }
  }

  function resize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    const aspect = width / height;
    camera.left = -aspect;
    camera.right = aspect;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
    state.planeSize = coverPlaneSize(aspect);
    background.scale.set(state.planeSize.width * 0.5, state.planeSize.height * 0.5, 1);
    hud.resize(aspect);
    renderer.setSize(width, height);
  }
  resize();
  globalThis.addEventListener("resize", resize);

  let renderPipeline = null;
  let scenePassNode = null;
  let bloomNode = null;

  function disposePostProcessing() {
    bloomNode?.dispose?.();
    bloomNode = null;
    scenePassNode?.dispose?.();
    scenePassNode = null;
    renderPipeline?.dispose?.();
    renderPipeline = null;
  }

  if (!bloomDisabled) {
    try {
      renderPipeline = new THREE.RenderPipeline(renderer);
      scenePassNode = pass(scene, camera);
      const sceneColor = scenePassNode.getTextureNode("output");
      bloomNode = bloom(sceneColor, 1.12, 0.48, 0.64);
      renderPipeline.outputNode = sceneColor.add(bloomNode);
    } catch (error) {
      state.bloomActive = false;
      state.bloomError = error?.message || String(error);
      disposePostProcessing();
      console.warn("[Camera Light Sculpture] bloom unavailable; additive render retained: " + state.bloomError);
    }
  }

  function stopCamera() {
    state.cameraGeneration += 1;
    state.cameraStarting = false;
    state.pendingStream?.getTracks?.().forEach(track => track.stop());
    state.stream?.getTracks?.().forEach(track => track.stop());
    try {
      state.video?.pause?.();
      if (state.video) state.video.srcObject = null;
    } catch {
      // The native video surface may already have released its stream.
    }
    state.pendingStream = null;
    state.stream = null;
    state.video = null;
    state.cameraHasFrame = false;
    state.frameSequence = -1;
    state.lastTrackAt = -Infinity;
    state.sourceLabel = SOURCE_STAGED;
    state.tracking = null;
    state.personLayer = null;
    resetGestureEffects();
    tracker.reset?.();
    personMatte.reset?.();
    fillSyntheticCameraFrame(framePixels, CAMERA_TEXTURE_WIDTH, CAMERA_TEXTURE_HEIGHT, performance.now() / 1000);
    cameraTexture.needsUpdate = true;
  }

  async function startCamera() {
    if (state.disposed || state.cameraStarting || state.video) return;
    const generation = state.cameraGeneration + 1;
    state.cameraGeneration = generation;
    state.cameraStarting = true;
    state.cameraError = "";
    state.cameraHasFrame = false;
    state.sourceLabel = SOURCE_CONNECTING;
    let stream = null;
    const isCurrent = () => !state.disposed && state.cameraGeneration === generation;
    const stopPending = () => {
      stream?.getTracks?.().forEach(track => track.stop());
      if (state.pendingStream === stream) state.pendingStream = null;
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      if (!isCurrent()) {
        stopPending();
        return;
      }
      state.pendingStream = stream;
      const video = document.createElement("video");
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      if (!isCurrent()) {
        stopPending();
        try { video.srcObject = null; } catch { /* Native surface may already be gone. */ }
        return;
      }
      state.stream = stream;
      state.pendingStream = null;
      state.video = video;
      state.sourceLabel = SOURCE_WAITING;
      state.frameSequence = -1;
      state.lastTrackAt = -Infinity;
      tracker.reset?.();
      personMatte.reset?.();
      resetGestureEffects();
      for (const track of stream.getVideoTracks?.() || []) {
        track.addEventListener?.("ended", () => {
          if (state.stream !== stream || state.disposed) return;
          state.cameraError = "camera stream ended";
          console.warn("[Camera Light Sculpture] camera stream ended; autonomous field retained.");
          stopCamera();
        }, { once: true });
      }
      console.log("[Camera Light Sculpture] camera permission granted; waiting for the first video frame.");
    } catch (error) {
      stopPending();
      if (isCurrent()) {
        state.cameraError = cameraFailureMessage(error);
        state.sourceLabel = SOURCE_STAGED;
        console.warn("[Camera Light Sculpture] camera unavailable; autonomous field retained: " + state.cameraError);
      }
    } finally {
      if (state.cameraGeneration === generation) state.cameraStarting = false;
    }
  }

  function onKeyDown(event) {
    const key = String(event.key || "").toLowerCase();
    if (key === "c") {
      if (state.video || state.cameraStarting) stopCamera();
      else startCamera();
    } else if (key === "r") {
      particleField.reset();
      resetGestureEffects();
    } else if (key === "h") {
      hud.setVisible(!hud.visible);
    }
  }
  globalThis.addEventListener("keydown", onKeyDown);

  function updateFrame(now, time) {
    if (!state.video) {
      if (now - state.lastSyntheticAt >= 80) {
        fillSyntheticCameraFrame(framePixels, CAMERA_TEXTURE_WIDTH, CAMERA_TEXTURE_HEIGHT, time);
        cameraTexture.needsUpdate = true;
        state.lastSyntheticAt = now;
      }
      return;
    }

    const videoTracks = state.stream?.getVideoTracks?.() || [];
    if (videoTracks.length && videoTracks.every(track => track.readyState === "ended")) {
      state.cameraError = "camera stream ended";
      stopCamera();
      return;
    }

    const frame = cameraFrame(state.video, fallbackCanvas);
    if (!frame?.data || !frame.width || !frame.height) return;
    if (!state.cameraHasFrame) {
      state.cameraHasFrame = true;
      state.sourceLabel = SOURCE_CAMERA;
      state.cameraError = "";
      tracker.reset?.();
      console.log(`[Camera Light Sculpture] camera active at ${frame.width}x${frame.height}.`);
    }
    const sequence = Number(frame.sequence ?? frame.timestampUs ?? now);
    if (sequence === state.frameSequence) return;
    state.frameSequence = sequence;
    state.frameWidth = frame.width;
    state.frameHeight = frame.height;
    if (now - state.lastTrackAt >= TRACK_INTERVAL_MS) {
      state.tracking = tracker.update(frame.data, frame.width, frame.height, now);
      const matteSample = downsampleRgba(frame.data, frame.width, frame.height, {
        maxWidth: 128,
        maxHeight: 96,
      });
      state.personLayer = personMatte.update(
        matteSample.data,
        matteSample.width,
        matteSample.height,
      );
      state.sourceLabel = state.personLayer.coverage > 0.001
        ? SOURCE_CAMERA
        : SOURCE_CALIBRATING;
      state.lastTrackAt = now;
    }
    if (state.personLayer) {
      compositePersonMatteRgba(
        frame.data,
        frame.width,
        frame.height,
        framePixels,
        state.personLayer,
        CAMERA_TEXTURE_WIDTH,
        CAMERA_TEXTURE_HEIGHT,
        true,
      );
      cameraTexture.needsUpdate = true;
    }
  }

  function trackedAttractors() {
    if (!state.video || !state.tracking?.slots) return [];
    const result = [];
    for (const [slotIndex, slot] of state.tracking.slots.slice(0, 2).entries()) {
      const confidence = clamp01(slot?.confidence);
      if (confidence < 0.035) continue;
      const effectIndex = Number.isInteger(Number(slot?.id)) ? Number(slot.id) : slotIndex;
      const effect = state.gestureEffects[effectIndex] || state.gestureEffects[slotIndex];
      const mode = effect?.mode || GESTURE_NONE;
      if (mode === GESTURE_NONE) continue;
      const useFingertip = mode === GESTURE_POINT;
      if (useFingertip && slot?.tip?.visible !== true) continue;
      const coordinate = slotCoordinate(slot, useFingertip);
      if (!Number.isFinite(coordinate.x) || !Number.isFinite(coordinate.y)) continue;
      if (slot?.visible === false || coordinate.x < 0 || coordinate.x > 1 || coordinate.y < 0 || coordinate.y > 1) continue;
      const world = texturePointToWorld(coordinate, state.planeSize);
      const velocity = slotVelocity(slot, useFingertip);
      const worldVelocityX = velocity.x * state.planeSize.width;
      const worldVelocityY = -velocity.y * state.planeSize.height;
      const speed = Math.hypot(worldVelocityX, worldVelocityY);
      const gestureStrength = clamp01(slot?.gestureStrength);
      const modeStrength = mode === GESTURE_POINT
        ? 0.86 + gestureStrength * 0.42
        : mode === GESTURE_CLOSED
          ? 0.78 + effect.charge * 0.82
          : mode === GESTURE_OPEN
            ? 0.56 + gestureStrength * 0.38
            : 0.88 + gestureStrength * 0.54;
      result.push({
        position: [world.x, world.y, 0],
        velocity: [worldVelocityX, worldVelocityY, 0],
        mode,
        strength: Math.max(0.28, confidence) * modeStrength,
        openness: clamp01(slot?.openness ?? slot?.spread ?? 0.18),
        charge: effect.charge,
        release: effect.release,
        pulse: mode === GESTURE_OPEN
          ? clamp01(effect.release)
          : mode === GESTURE_SWIPE
            ? clamp01(speed * 0.16 + gestureStrength * 0.45)
            : 0,
      });
    }
    const fingertipFollowers = result.filter(attractor => attractor.mode === GESTURE_POINT);
    return fingertipFollowers.length ? fingertipFollowers : result;
  }

  function resolveAttractors() {
    const tracked = trackedAttractors();
    if (tracked.length) return tracked;
    return [];
  }

  function render() {
    if (state.bloomActive && renderPipeline) {
      try {
        renderPipeline.render();
        return;
      } catch (error) {
        state.bloomActive = false;
        state.bloomError = error?.message || String(error);
        renderer.toneMapping = directToneMapping;
        renderer.outputColorSpace = directOutputColorSpace;
        if (renderer.xr) renderer.xr.enabled = directXrEnabled;
        renderer.setRenderTarget(null);
        renderer.setMRT?.(null);
        disposePostProcessing();
        console.warn("[Camera Light Sculpture] bloom stopped; additive render retained: " + state.bloomError);
      }
    }
    renderer.render(scene, camera);
  }

  let previousNow = performance.now();
  renderer.setAnimationLoop(now => {
    if (state.disposed) return;
    const delta = Math.min(MAX_DELTA, Math.max(1 / 240, (now - previousNow) / 1000));
    previousNow = now;
    const time = now / 1000;
    updateFrame(now, time);
    updateGestureEffects(delta);
    const attractors = resolveAttractors();
    const gestureCandidates = (state.tracking?.slots || []).map((slot, index) => {
      const effectIndex = Number.isInteger(Number(slot?.id)) ? Number(slot.id) : index;
      return {
        slot,
        effect: state.gestureEffects[effectIndex] || state.gestureEffects[index],
      };
    }).filter(({ slot, effect }) =>
      slot?.visible !== false &&
      Number(slot?.confidence) > 0.12 &&
      effect?.mode !== GESTURE_NONE,
    );
    const pointGestureSlots = gestureCandidates.filter(({ effect }) => effect.mode === GESTURE_POINT);
    const gestureSlots = pointGestureSlots.length ? pointGestureSlots : gestureCandidates;
    const openBloomTarget = gestureSlots.reduce((maximum, { slot, effect }) => {
      const mode = effect.mode;
      if (mode === GESTURE_OPEN) return Math.max(maximum, 0.52 + (effect?.release || 0) * 0.68);
      if (mode === GESTURE_POINT) return Math.max(maximum, 0.12 + clamp01(slot.gestureStrength) * 0.12);
      if (mode === GESTURE_SWIPE) return Math.max(maximum, 0.28 + clamp01(slot.gestureStrength) * 0.24);
      return maximum;
    }, 0);
    const bloomResponse = 1 - Math.exp(-delta * (openBloomTarget > state.bloomGesture ? 9 : 3.2));
    state.bloomGesture += (openBloomTarget - state.bloomGesture) * bloomResponse;
    if (bloomNode) {
      bloomNode.strength.value = 1.08 + state.bloomGesture * 1.08;
      bloomNode.radius.value = 0.46 + state.bloomGesture * 0.22;
      bloomNode.threshold.value = 0.64 - state.bloomGesture * 0.16;
    }
    particleField.update({
      delta,
      time,
      aspect: innerWidth / Math.max(1, innerHeight),
      attractors,
    });
    if (now - state.lastHudAt > 140) {
      const trackedCount = state.tracking?.slots?.filter(slot => Number(slot?.confidence) > 0.12).length || 0;
      const gestureLabels = [...new Set(gestureSlots.map(({ effect }) => effect.mode.toUpperCase()))];
      const strongestCharge = Math.max(...state.gestureEffects.map(effect => effect.charge));
      const strongestRelease = Math.max(...state.gestureEffects.map(effect => effect.release));
      const cameraStatus = state.cameraStarting
        ? state.sourceLabel
        : state.video
          ? state.cameraHasFrame
            ? `${state.sourceLabel} / ${gestureLabels.length ? gestureLabels.join(" + ") : `${trackedCount} TARGET${trackedCount === 1 ? "" : "S"} / SHOW A GESTURE`}`
            : state.sourceLabel
          : state.sourceLabel;
      const fieldStatus = particleField.status?.() || particleField.status || {};
      const count = Number(fieldStatus.count || fieldStatus.particleCount || 65536).toLocaleString();
      const magicStatus = strongestRelease > 0.08
        ? `SHOCKWAVE ${Math.round(strongestRelease * 100)}%`
        : strongestCharge > 0.04
          ? `CHARGE ${Math.round(strongestCharge * 100)}%`
          : gestureLabels.includes("POINT")
            ? "FINGERTIP ORBIT"
            : state.bloomActive ? "BLOOM" : "ADDITIVE GLOW";
      hud.update({
        status: cameraStatus,
        detail: `${count} GPU PARTICLES / ${magicStatus}`,
        gestures: gestureLabels,
        hint: state.cameraError
          ? `CAMERA: ${state.cameraError}`.slice(0, 78)
          : "C CAMERA / R RESET / H HIDE",
      });
      state.lastHudAt = now;
    }
    render();
  });

  const debugApi = Object.freeze({
    startCamera,
    stopCamera,
    reset: () => {
      resetGestureEffects();
      return particleField.reset();
    },
    getState: () => ({
      camera: Boolean(state.video),
      cameraHasFrame: state.cameraHasFrame,
      cameraStarting: state.cameraStarting,
      cameraError: state.cameraError,
      bloomActive: state.bloomActive,
      bloomError: state.bloomError,
      gpuError: state.gpuError,
      tracking: state.tracking,
      personMatte: state.personLayer ? {
        label: state.personLayer.label,
        frameIndex: state.personLayer.frameIndex,
        coverage: state.personLayer.coverage,
        seedCoverage: state.personLayer.seedCoverage || 0,
        bounds: state.personLayer.bounds,
      } : null,
      gestureEffects: state.gestureEffects.map(effect => ({ ...effect })),
      field: typeof particleField.status === "function" ? particleField.status() : particleField.status,
    }),
  });
  globalThis.__threeBrowserLightSculpture = debugApi;

  function cleanup() {
    if (state.disposed) return;
    state.disposed = true;
    renderer.setAnimationLoop(null);
    stopCamera();
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("resize", resize);
    renderer.backend.device?.removeEventListener?.("uncapturederror", onUncapturedGpuError);
    disposePostProcessing();
    particleField.dispose();
    hud.dispose();
    background.geometry.dispose();
    backgroundMaterial.dispose();
    cameraTexture.dispose();
    renderer.dispose();
    delete globalThis.__threeBrowserLightSculpture;
  }
  globalThis.addEventListener("beforeunload", cleanup, { once: true });

  if (query.get("camera") !== "0") {
    startCamera();
  }
  console.log("[Camera Light Sculpture] ready; requesting camera access for gesture control.");
}

main().catch(error => {
  console.error("[Camera Light Sculpture] startup failed:", error);
  throw error;
});
