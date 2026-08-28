import * as THREE from "three/webgpu";
import { createAtmosphere } from "../atmosphere.mjs";
import { createFaceOnCamera } from "../camera.mjs";
import { createGameHud } from "../game/game-hud.mjs";
import {
  completeLocationObjective,
  createLocationProgress,
  getAvailableObjectives,
  getLocation,
  resolveLocationTravel,
} from "../game/location-graph.mjs";
import { createLocationWorld } from "../game/location-world.mjs";
import { LOCATION_REGISTRY } from "../game/locations.mjs";
import { runtimePathProfile } from "../game/path-profile.mjs";
import { createInput } from "../input.mjs";
import {
  NativeRtxRenderer,
  prepareRtxGuideMaterials,
} from "../native-rtx-renderer.mjs";
import { setPathProfile } from "../path.mjs";
import { collectStaticRiverScene } from "../rtx-scene.mjs";
import { createWalker } from "../walker.mjs";

const TOTAL_OBJECTIVES = LOCATION_REGISTRY.locations.reduce(
  (total, location) => total + location.objectives.length,
  0,
);
const cutoutTintColor = new THREE.Color();

function positiveSize(value) {
  return Math.max(1, Math.round(Number(value) || 1));
}

function smooth01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function mapLocationId(locationId) {
  return String(locationId).includes("first-branch") ? "first-branch" : "wisemans-ferry";
}

function distanceTo(position, target) {
  return Math.hypot(position.x - target.x, position.z - target.z);
}

function exitIsNear(exit, position, margin = 2.8) {
  if (position.z < exit.trigger.zRange[0] || position.z > exit.trigger.zRange[1]) return false;
  if (exit.trigger.comparison === ">=") return position.x >= exit.trigger.value - margin;
  return position.x <= exit.trigger.value + margin;
}

function applyCutoutTint(preset, world, walker) {
  const tint = preset?.treeTint ?? [1, 1, 1];
  cutoutTintColor.setRGB(tint[0], tint[1], tint[2]);
  world.setTint(cutoutTintColor);
  walker.setTint?.(cutoutTintColor);
}

function createRetainedGameLoader(renderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Secret River loading screen needs Canvas2D.");
  let disposed = false;

  function paint(title = "ENTERING BROAD REACH", detail = "BUILDING THE RIVER WORLD  |  RTX SHADOWS STAY ON") {
    const sky = context.createLinearGradient(0, 0, 0, 720);
    sky.addColorStop(0, "#17323a");
    sky.addColorStop(0.52, "#68705f");
    sky.addColorStop(1, "#10191a");
    context.fillStyle = sky;
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = "#182725";
    context.beginPath();
    context.moveTo(0, 390);
    context.quadraticCurveTo(290, 260, 610, 405);
    context.quadraticCurveTo(920, 520, 1280, 320);
    context.lineTo(1280, 720);
    context.lineTo(0, 720);
    context.closePath();
    context.fill();
    context.fillStyle = "#30453f";
    context.beginPath();
    context.moveTo(0, 520);
    context.quadraticCurveTo(370, 450, 680, 560);
    context.quadraticCurveTo(940, 625, 1280, 505);
    context.lineTo(1280, 720);
    context.lineTo(0, 720);
    context.closePath();
    context.fill();
    context.fillStyle = "#f0dfb4";
    context.font = "700 58px Georgia, serif";
    context.textAlign = "center";
    context.fillText(title, 640, 262);
    context.fillStyle = "#c8bd98";
    context.font = "20px Segoe UI, sans-serif";
    context.fillText(detail, 640, 308);
    context.fillStyle = "rgba(223,196,119,0.18)";
    context.fillRect(410, 350, 460, 2);
    context.fillStyle = "rgba(225,218,192,0.68)";
    context.font = "15px Segoe UI, sans-serif";
    context.fillText("ESC  RETURN TO MAIN SCREEN", 640, 650);
  }
  paint();

  // Exactly the retained-phone pattern used by GTA Neon: paint once, upload
  // once, then animate only ordinary GPU meshes while the mode initialises.
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "Secret River retained loading artwork";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const backdropGeometry = new THREE.PlaneGeometry(2, 2);
  const backdropMaterial = new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false });
  backdropMaterial.toneMapped = false;
  const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
  backdrop.frustumCulled = false;
  scene.add(backdrop);

  const railGeometry = new THREE.PlaneGeometry(1, 1);
  const railMaterial = new THREE.MeshBasicMaterial({ color: 0x4b5548, transparent: true, opacity: 0.75, depthTest: false });
  railMaterial.toneMapped = false;
  const rail = new THREE.Mesh(railGeometry, railMaterial);
  rail.position.set(0, -0.13, 0.1);
  rail.scale.set(0.72, 0.012, 1);
  scene.add(rail);

  const fillGeometry = new THREE.PlaneGeometry(1, 1);
  const fillMaterial = new THREE.MeshBasicMaterial({ color: 0xe1c46e, transparent: true, opacity: 0.92, depthTest: false });
  fillMaterial.toneMapped = false;
  const fill = new THREE.Mesh(fillGeometry, fillMaterial);
  fill.position.z = 0.2;
  scene.add(fill);

  let elapsed = 0;
  function frame({ delta }) {
    if (disposed) return;
    elapsed += delta;
    const cycle = (elapsed * 0.24) % 1;
    const width = 0.10 + cycle * 0.32;
    fill.scale.set(width, 0.012, 1);
    fill.position.set(-0.36 + width * 0.5 + cycle * 0.40, -0.13, 0.2);
    fillMaterial.opacity = 0.68 + Math.sin(elapsed * 3.2) * 0.18;
    renderer.info.reset();
    renderer.setRenderTarget(null);
    renderer.setMRT(null);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
  }

  return {
    frame,
    setError(error) {
      if (disposed) return;
      paint("THE RIVER COULD NOT OPEN", String(error?.message || error || "UNKNOWN ERROR").toUpperCase().slice(0, 90));
      texture.needsUpdate = true;
      fillMaterial.color.setHex(0xd18f58);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.clear();
      backdropGeometry.dispose();
      backdropMaterial.dispose();
      railGeometry.dispose();
      railMaterial.dispose();
      fillGeometry.dispose();
      fillMaterial.dispose();
      texture.dispose();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

/**
 * Activates immediately, then hands off from a retained GPU loading surface
 * to the real world as soon as its painted assets are ready. RTX registration
 * continues in raster fallback and never blocks entry into play.
 */
export function createGameMode(context) {
  const loader = createRetainedGameLoader(context.renderer);
  let innerMode = null;
  let latestViewport = { ...context.viewport };
  let disposed = false;
  let loaderDisposed = false;

  function disposeLoader() {
    if (loaderDisposed) return;
    loaderDisposed = true;
    loader.dispose();
  }

  function onLoadingKey(event) {
    if (disposed || innerMode || event.repeat) return;
    if (String(event.code || "") !== "Escape") return;
    void context.requestMode?.("menu");
  }
  globalThis.addEventListener("keydown", onLoadingKey);

  const ready = createLoadedGameMode({ ...context, viewport: latestViewport })
    .then(async mode => {
      if (disposed) {
        await mode.dispose();
        return;
      }
      innerMode = mode;
      innerMode.resize(latestViewport);
      globalThis.removeEventListener("keydown", onLoadingKey);
      disposeLoader();
    })
    .catch(error => {
      console.error(`[Secret River Game] Startup failed: ${error?.message || error}`);
      loader.setError(error);
    });

  return {
    id: "game",
    resize(nextViewport) {
      latestViewport = { ...nextViewport };
      innerMode?.resize(latestViewport);
    },
    frame(frameContext) {
      if (disposed) return;
      if (innerMode) innerMode.frame(frameContext);
      else loader.frame(frameContext);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      globalThis.removeEventListener("keydown", onLoadingKey);
      disposeLoader();
      await ready;
      if (innerMode) await innerMode.dispose();
      innerMode = null;
    },
  };
}

/**
 * Two connected, map-derived Hawkesbury locations. The shared renderer and
 * day clock persist, while each crossing replaces the location's static RTX
 * scene before ray lighting resumes.
 */
async function createLoadedGameMode({ renderer, rtx, viewport, requestMode }) {
  if (!renderer) throw new TypeError("Secret River game needs the shared renderer.");
  let currentViewport = { ...viewport };
  let disposed = false;
  let elapsed = 0;
  let progress = createLocationProgress(LOCATION_REGISTRY);
  let location = getLocation(LOCATION_REGISTRY, progress.currentLocationId);
  let transition = null;
  let pendingSwap = null;
  let swapGeneration = 0;
  let interactionQueued = false;
  let menuRequested = false;
  let toast = "";
  let toastTime = 0;

  setPathProfile(runtimePathProfile(location));

  const scene = new THREE.Scene();
  scene.name = "Secret River connected-location game";
  scene.userData.renderer = renderer;
  const camera = new THREE.PerspectiveCamera(
    52,
    positiveSize(currentViewport.width) / positiveSize(currentViewport.height),
    0.15,
    280,
  );
  const atmosphere = createAtmosphere(scene);
  let world = await createLocationWorld(location);
  scene.add(world.root);

  const walker = await createWalker();
  const initialSpawn = location.spawnPoints.find(spawn => spawn.id === progress.currentSpawnId);
  walker.relocate(initialSpawn.position.x, initialSpawn.position.z);
  scene.add(walker.mesh);
  const follow = createFaceOnCamera(camera, walker);
  follow.resize(positiveSize(currentViewport.width), positiveSize(currentViewport.height));
  follow.snap();
  follow.update(1);
  atmosphere.updateFocus(walker.position, 1);
  const input = createInput();
  const hud = createGameHud(
    positiveSize(currentViewport.width * currentViewport.displayPixelRatio),
    positiveSize(currentViewport.height * currentViewport.displayPixelRatio),
  );

  let nativeRenderer = null;
  let nativeConfigured = false;

  function useNativePath() {
    return Boolean(nativeConfigured && nativeRenderer?.rayLightingReady);
  }

  function syncShadowPath() {
    atmosphere.setRayTracedShadows(useNativePath());
  }

  function makeStaticScene(locationWorld) {
    if (!rtx || (typeof rtx.evaluateRayLighting !== "function"
        && typeof rtx.evaluateRayReflections !== "function")) {
      locationWorld.hideProxies();
      return null;
    }
    try {
      scene.updateMatrixWorld(true);
      return collectStaticRiverScene(
        locationWorld.rtxRoots,
        atmosphere.campfire ? [atmosphere.campfire] : [],
      );
    } catch (error) {
      console.warn(`[Secret River Game RTX] Static-scene collection failed: ${error?.message || error}`);
      return null;
    } finally {
      locationWorld.hideProxies();
    }
  }

  async function configureNative(locationWorld, generation) {
    prepareRtxGuideMaterials(scene);
    locationWorld.river.mesh.material.rtxReflectionMask = 0;
    const staticScene = makeStaticScene(locationWorld);
    const candidate = new NativeRtxRenderer(renderer, camera, rtx);
    candidate.resize(
      positiveSize(currentViewport.internalWidth),
      positiveSize(currentViewport.internalHeight),
    );
    nativeRenderer = candidate;
    nativeConfigured = false;
    syncShadowPath();
    const configured = staticScene
      ? await candidate.configure(
        positiveSize(currentViewport.internalWidth),
        positiveSize(currentViewport.internalHeight),
        staticScene,
      )
      : false;
    if (disposed || generation !== swapGeneration || candidate !== nativeRenderer) {
      candidate.dispose();
      return false;
    }
    nativeConfigured = configured;
    syncShadowPath();
    return configured;
  }

  const initialNativeSetup = configureNative(world, swapGeneration).catch(error => {
    console.warn(`[Secret River Game RTX] Initial setup failed: ${error?.message || error}`);
    return false;
  });
  world.setCompleted(progress.completedObjectiveIds);
  applyCutoutTint(atmosphere.getPreset(), world, walker);

  function resize(nextViewport) {
    if (disposed) return;
    currentViewport = { ...nextViewport };
    follow.resize(positiveSize(currentViewport.width), positiveSize(currentViewport.height));
    hud.resize(
      positiveSize(currentViewport.width * currentViewport.displayPixelRatio),
      positiveSize(currentViewport.height * currentViewport.displayPixelRatio),
    );
    nativeRenderer?.resize(
      positiveSize(currentViewport.internalWidth),
      positiveSize(currentViewport.internalHeight),
    );
    syncShadowPath();
  }

  function onKeyDown(event) {
    if (event.repeat || disposed) return;
    const code = String(event.code || "");
    const key = String(event.key || "").toLowerCase();
    if (code === "Escape" || key === "escape") {
      if (transition || menuRequested) return;
      menuRequested = true;
      void requestMode?.("menu").finally(() => {
        if (!disposed) menuRequested = false;
      });
      return;
    }
    if (code === "KeyE" || key === "e" || code === "Enter") {
      interactionQueued = true;
    }
  }
  globalThis.addEventListener("keydown", onKeyDown);

  function nearbyObjective() {
    const available = getAvailableObjectives(LOCATION_REGISTRY, progress);
    let closest = null;
    let closestDistance = Infinity;
    for (const objective of available) {
      const distance = distanceTo(walker.position, objective.completion.position);
      if (distance <= objective.completion.radius + 1.4 && distance < closestDistance) {
        closest = objective;
        closestDistance = distance;
      }
    }
    return closest;
  }

  function nearbyExit() {
    return location.exits.find(exit => exitIsNear(exit, walker.position)) ?? null;
  }

  function objectiveLabel() {
    const available = getAvailableObjectives(LOCATION_REGISTRY, progress);
    if (available.length) return available[0].prompt;
    if (progress.completedObjectiveIds.length >= TOTAL_OBJECTIVES
        && location.id === LOCATION_REGISTRY.start.locationId) {
      return "Journey complete - Broad Reach and First Branch are connected.";
    }
    return "Reach the end of the bank to continue the journey.";
  }

  function interactionPrompt() {
    if (toastTime > 0 && toast) return toast;
    const objective = nearbyObjective();
    if (objective) return `E  |  OBSERVE - ${objective.title.toUpperCase()}`;
    const exit = nearbyExit();
    if (!exit) return "";
    const travel = resolveLocationTravel(LOCATION_REGISTRY, progress, exit.id);
    if (travel.ok) return `E  |  ${exit.label.toUpperCase()}`;
    return "THE RIVER AHEAD OPENS AFTER YOUR CURRENT OBSERVATION";
  }

  function startTravel(exit) {
    const result = resolveLocationTravel(LOCATION_REGISTRY, progress, exit.id);
    if (!result.ok) {
      toast = "COMPLETE THE RIVER OBSERVATION FIRST";
      toastTime = 2.4;
      return;
    }
    const destination = getLocation(LOCATION_REGISTRY, result.transition.toLocationId);
    progress = result.progress;
    transition = {
      phase: "out",
      alpha: 0,
      time: 0,
      destination,
      travel: result.transition,
      label: destination.name,
    };
  }

  function handleInteraction() {
    if (!interactionQueued || transition) return;
    interactionQueued = false;
    const objective = nearbyObjective();
    if (objective) {
      const result = completeLocationObjective(
        LOCATION_REGISTRY,
        progress,
        objective.id,
      );
      if (result.ok) {
        progress = result.progress;
        world.setCompleted(progress.completedObjectiveIds);
        toast = `${objective.title.toUpperCase()} COMPLETE`;
        toastTime = 2.6;
      }
      return;
    }
    const exit = nearbyExit();
    if (exit) startTravel(exit);
  }

  async function swapWorld(activeTransition) {
    const generation = ++swapGeneration;
    const oldLocation = location;
    const oldWorld = world;
    let candidateWorld = null;
    try {
      setPathProfile(runtimePathProfile(activeTransition.destination));
      candidateWorld = await createLocationWorld(activeTransition.destination);
      if (disposed || generation !== swapGeneration) {
        candidateWorld.dispose();
        return;
      }

      nativeRenderer?.dispose();
      nativeRenderer = null;
      nativeConfigured = false;
      syncShadowPath();

      oldWorld.root.removeFromParent();
      scene.add(candidateWorld.root);
      world = candidateWorld;
      location = activeTransition.destination;
      oldWorld.dispose();

      const spawn = activeTransition.travel.spawn.position;
      walker.relocate(spawn.x, spawn.z);
      follow.snap();
      follow.update(1);
      atmosphere.updateFocus(walker.position, 1);
      world.setCompleted(progress.completedObjectiveIds);
      applyCutoutTint(atmosphere.getPreset(), world, walker);

      await configureNative(world, generation);
      if (disposed || generation !== swapGeneration) return;
      activeTransition.phase = "in";
      activeTransition.alpha = 1;
      activeTransition.time = 0;
      toast = `ARRIVED | ${location.name.toUpperCase()}`;
      toastTime = 2.8;
    } catch (error) {
      console.error(`[Secret River Game] Location transition failed: ${error?.message || error}`);
      candidateWorld?.dispose();
      setPathProfile(runtimePathProfile(oldLocation));
      transition = null;
      toast = "THE CROSSING COULD NOT BE COMPLETED";
      toastTime = 3.2;
    } finally {
      pendingSwap = null;
    }
  }

  function updateTransition(delta) {
    if (!transition) return;
    if (transition.phase === "out") {
      transition.time += delta;
      transition.alpha = smooth01(transition.time / 0.46);
      if (transition.alpha >= 0.999 && !pendingSwap) {
        transition.phase = "loading";
        pendingSwap = swapWorld(transition);
      }
      return;
    }
    if (transition.phase === "loading") {
      transition.alpha = 1;
      return;
    }
    if (transition.phase === "in") {
      transition.time += delta;
      transition.alpha = 1 - smooth01(transition.time / 0.58);
      if (transition.alpha <= 0.002) transition = null;
    }
  }

  function hudState() {
    return {
      location: {
        id: mapLocationId(location.id),
        title: location.name,
      },
      objective: objectiveLabel(),
      progress: `${progress.completedObjectiveIds.length} / ${TOTAL_OBJECTIVES} RIVER OBSERVATIONS`,
      prompt: transition ? "" : interactionPrompt(),
      transitionAlpha: transition?.alpha ?? 0,
      transitionLabel: transition?.label ?? "",
      complete: progress.completedObjectiveIds.length >= TOTAL_OBJECTIVES,
    };
  }

  resize(currentViewport);

  return {
    id: "game",
    resize,
    frame({ delta, wallDelta }) {
      if (disposed) return;
      elapsed += delta;
      toastTime = Math.max(0, toastTime - delta);
      updateTransition(delta);

      const controlsFrozen = Boolean(transition || menuRequested);
      walker.update(delta, controlsFrozen ? { x: 0, z: 0, sprint: false } : input.axis());
      follow.update(delta);
      const preset = atmosphere.updateCycle(elapsed);
      applyCutoutTint(preset, world, walker);
      atmosphere.updateFocus(walker.position, delta);
      world.update(elapsed);
      handleInteraction();

      const hudTexture = hud.draw(hudState());
      renderer.info.reset();
      let nativeRendered = false;
      let offscreenRendered = false;
      if (useNativePath()) {
        nativeRendered = nativeRenderer.render(scene, camera, {
          skipReflections: true,
          skipLighting: false,
          celestialDirection: atmosphere.sunDirection,
          celestialIntensity: preset.rtxCelestialIntensity,
          shadowStrength: preset.rtxShadowStrength,
          aoStrength: preset.rtxAoStrength,
        });
      }
      if (!nativeRendered && nativeRenderer) {
        if (!nativeRenderer.rayLightingReady) syncShadowPath();
        offscreenRendered = nativeRenderer.renderRaster(scene, camera);
      }
      if (nativeRendered || offscreenRendered) {
        if (!nativeRenderer.present(hudTexture, 0, transition?.alpha ?? 0)) {
          nativeRendered = false;
          offscreenRendered = false;
        }
      }
      if (!nativeRendered && !offscreenRendered) {
        renderer.setRenderTarget(null);
        renderer.setMRT(null);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);
      }

      if (wallDelta > 0.5) {
        console.warn(`[Secret River Game] long frame ${(wallDelta * 1000).toFixed(0)}ms`);
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      swapGeneration += 1;
      globalThis.removeEventListener("keydown", onKeyDown);
      input.dispose();
      if (pendingSwap) await pendingSwap.catch(() => {});
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      nativeRenderer?.dispose();
      atmosphere.dispose();
      world.dispose();
      walker.dispose();
      hud.dispose();
      scene.clear();
      setPathProfile(null);
      await initialNativeSetup;
    },
  };
}
