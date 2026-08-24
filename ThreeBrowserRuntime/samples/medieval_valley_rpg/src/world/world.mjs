import * as THREE from "three/webgpu";
import { createAtmosphere, createFireVisuals } from "../graphics/atmosphere.mjs";
import { createMaterialLibrary } from "../graphics/materials.mjs";
import { updateGraphicsUniforms } from "../graphics/state.mjs";
import { createVegetation } from "../graphics/vegetation.mjs";
import { createRiver } from "../graphics/water.mjs";
import {
  createTerrain,
  createTerrainRibbon,
  sampleOldNorthRoad,
  terrainHeight,
  trailCenterX,
  WORLD_BOUNDS,
} from "./terrain.mjs";
import { createWorldStructures } from "./structures.mjs";

export const WORLD_ZONES = Object.freeze({
  starting_meadow: Object.freeze({ id: "starting_meadow", name: "Southern Meadow", center: [0, terrainHeight(0, 190), 190], radius: 42, tags: ["safe", "spawn"] }),
  farms: Object.freeze({ id: "farms", name: "Greywater Farms", center: [0, terrainHeight(0, 112), 112], halfExtents: [122, 18, 48], tags: ["safe", "harvest"] }),
  river: Object.freeze({ id: "river", name: "Greywater River", center: [0, terrainHeight(0, 62) + 1.65, 62], halfExtents: [210, 12, 28], tags: ["water", "crossing"] }),
  village: Object.freeze({ id: "village", name: "Greywater Village", center: [0, terrainHeight(0, 4), 4], radius: 72, tags: ["safe", "settlement"] }),
  west_forest: Object.freeze({ id: "west_forest", name: "Hunter's Wood", center: [-118, terrainHeight(-118, -65), -65], radius: 77, tags: ["forest", "hunting"] }),
  east_forest: Object.freeze({ id: "east_forest", name: "Shadowpine Wood", center: [119, terrainHeight(119, -78), -78], radius: 78, tags: ["forest", "corrupted"] }),
  north_forest: Object.freeze({ id: "north_forest", name: "Old North Wood", center: [0, terrainHeight(0, -112), -112], halfExtents: [104, 35, 55], tags: ["forest", "route"] }),
  fortress: Object.freeze({ id: "fortress", name: "Keepfall Ruins", center: [0, terrainHeight(0, -190), -190], radius: 58, tags: ["fortress", "corrupted", "finale"] }),
});

const PROGRESS_PHASES = Object.freeze({
  arrival: Object.freeze({ stage: "arrival", amount: 0, fortressUnlocked: false, beaconRepaired: false, beaconLit: false, villageSafe: false, corruption: 0.86 }),
  village: Object.freeze({ stage: "village", amount: 0.25, fortressUnlocked: false, beaconRepaired: false, beaconLit: false, villageSafe: true, corruption: 0.76 }),
  forest: Object.freeze({ stage: "forest", amount: 0.48, fortressUnlocked: false, beaconRepaired: false, beaconLit: false, villageSafe: true, corruption: 0.66 }),
  beacon_repaired: Object.freeze({ stage: "beacon_repaired", amount: 0.60, fortressUnlocked: false, beaconRepaired: true, beaconLit: false, villageSafe: true, corruption: 0.58 }),
  fortress: Object.freeze({ stage: "fortress", amount: 0.76, fortressUnlocked: true, beaconRepaired: true, beaconLit: true, villageSafe: true, corruption: 0.42 }),
  complete: Object.freeze({ stage: "complete", amount: 1, fortressUnlocked: true, beaconRepaired: true, beaconLit: true, villageSafe: true, corruption: 0.04 }),
});

function progressFromAmount(amount) {
  const clamped = THREE.MathUtils.clamp(Number(amount) || 0, 0, 1);
  const phase = clamped >= 0.96
    ? "complete"
    : clamped >= 0.70
      ? "fortress"
      : clamped >= 0.56
        ? "beacon_repaired"
        : clamped >= 0.34
          ? "forest"
          : clamped >= 0.12
            ? "village"
            : "arrival";
  return { ...PROGRESS_PHASES[phase], amount: clamped };
}

function normalizedProgress(next, previous) {
  if (typeof next === "number") return progressFromAmount(next);
  if (typeof next === "string") return { ...(PROGRESS_PHASES[next] ?? PROGRESS_PHASES.arrival) };
  if (!next || typeof next !== "object") return { ...previous };
  const phaseSource = next.stage ?? next.phase;
  const phase = typeof phaseSource === "string" ? PROGRESS_PHASES[phaseSource] : null;
  const base = phase ? { ...phase } : { ...previous };
  if (next.amount !== undefined || next.progress !== undefined) {
    Object.assign(base, progressFromAmount(next.amount ?? next.progress), next);
  } else {
    Object.assign(base, next);
  }
  base.stage = String(base.stage ?? base.phase ?? previous.stage);
  const repairProgress = Number(next.beaconRepairProgress);
  const explicitFortressUnlocked = next.fortressUnlocked ?? next.routeUnlocked ?? next.fortressRouteUnlocked;
  const explicitBeaconRepaired = next.beaconRepaired ?? next.beaconRestored;
  const explicitBeaconLit = next.beaconLit ?? next.lightRestored;
  const explicitVillageSafe = next.villageSafe ?? next.villageDefended;
  if (explicitFortressUnlocked !== undefined) base.fortressUnlocked = Boolean(explicitFortressUnlocked);
  if (explicitBeaconRepaired !== undefined) base.beaconRepaired = Boolean(explicitBeaconRepaired);
  else if (Number.isFinite(repairProgress)) base.beaconRepaired = repairProgress >= 0.999;
  if (explicitBeaconLit !== undefined) base.beaconLit = Boolean(explicitBeaconLit);
  if (base.beaconLit) base.beaconRepaired = true;
  if (explicitVillageSafe !== undefined) base.villageSafe = Boolean(explicitVillageSafe);
  else if (Number.isFinite(Number(next.villageSafety))) base.villageSafe = Number(next.villageSafety) >= 0.45;
  if (next.wardenDefeated) {
    base.fortressUnlocked = true;
    base.beaconRepaired = true;
    base.beaconLit = true;
  }
  if (next.mainQuestComplete || next.postVictory) {
    Object.assign(base, PROGRESS_PHASES.complete, next);
  }
  if (next.amount === undefined && next.progress === undefined && phaseSource === undefined) {
    if (next.mainQuestComplete || next.postVictory) base.amount = 1;
    else if (next.wardenDefeated) base.amount = Math.max(Number(base.amount) || 0, 0.92);
    else if (base.fortressUnlocked || base.beaconLit) base.amount = Math.max(Number(base.amount) || 0, 0.76);
    else if (base.beaconRepaired) base.amount = Math.max(Number(base.amount) || 0, 0.60);
    else if (Number.isFinite(repairProgress) && repairProgress > 0) base.amount = Math.max(Number(base.amount) || 0, 0.38 + repairProgress * 0.2);
    else if (next.beaconInspected) base.amount = Math.max(Number(base.amount) || 0, 0.25);
  }
  base.amount = THREE.MathUtils.clamp(Number(base.amount ?? previous.amount) || 0, 0, 1);
  if (next.stage === undefined && next.phase === undefined) {
    if (next.mainQuestComplete || next.postVictory) base.stage = "complete";
    else if (next.wardenDefeated || base.fortressUnlocked) base.stage = "fortress";
    else if (base.beaconRepaired) base.stage = "beacon_repaired";
    else if (Number.isFinite(repairProgress) && repairProgress > 0) base.stage = "forest";
    else if (next.beaconInspected || base.villageSafe) base.stage = "village";
  }
  base.corruption = THREE.MathUtils.clamp(
    Number(next.corruption ?? next.corruptionStrength ?? (next.wardenDefeated ? 0 : base.corruption ?? (base.beaconLit ? 0.42 : previous.corruption))) || 0,
    0,
    1,
  );
  return base;
}

function progressSnapshot(progress) {
  return {
    stage: progress.stage,
    amount: progress.amount,
    fortressUnlocked: progress.fortressUnlocked,
    beaconRepaired: progress.beaconRepaired,
    beaconLit: progress.beaconLit,
    villageSafe: progress.villageSafe,
    corruption: progress.corruption,
  };
}

function safeSubscribe(source, callback) {
  if (!source || typeof source.subscribe !== "function") return null;
  try {
    const subscription = source.subscribe(callback);
    if (typeof subscription === "function") return subscription;
    if (typeof subscription?.unsubscribe === "function") return () => subscription.unsubscribe();
    return null;
  } catch {
    return null;
  }
}

function subscribeToSnapshots(source, callback) {
  return safeSubscribe(source, (event) => {
    const snapshot = event?.state ?? event?.snapshot ?? source?.snapshot?.() ?? source?.state ?? event;
    if (snapshot && typeof snapshot === "object") callback(snapshot);
  });
}

function createLocationIndex(landmarks, interactables) {
  const locations = Object.assign(Object.create(null), landmarks);
  for (const item of interactables) {
    if (item.id !== item.landmarkId || !landmarks[item.landmarkId]) continue;
    locations[item.id] = {
      ...landmarks[item.landmarkId],
      position: [...item.position],
      interactionId: item.id,
    };
  }
  const alias = (id, targetId) => {
    const target = landmarks[targetId] ?? locations[targetId];
    if (!target) return;
    locations[id] = { ...target, id, aliasOf: targetId };
  };
  alias("forge", "blacksmith");
  alias("village_square", "market");
  alias("village_gate", "south_watch_post");
  alias("forest_trail", "old_north_road");
  alias("hunter_camp_shelter", "hunter_camp");
  alias("herbGarden", "herb_garden");
  alias("resinGrove", "resin_grove");
  alias("beacon_repair_site", "village_beacon");
  alias("inn_market_room", "inn");
  alias("nearest_shelter", "inn");
  const fortressGate = interactables.find((item) => item.id === "fortress_gate");
  if (fortressGate) {
    locations.fortress_gate = {
      id: "fortress_gate",
      name: "Keepfall Fortress Gate",
      kind: "gate",
      zone: "fortress",
      position: [...fortressGate.position],
      radius: fortressGate.radius,
      tags: [...fortressGate.tags],
    };
  }
  return locations;
}

function makeVillagePaths(material) {
  const group = new THREE.Group();
  group.name = "Conforming village footpaths";
  const routeSpecs = [
    { name: "Market to inn path", points: [[0, 40], [8, 30], [17, 23], [25, 15]], width: 2.2 },
    { name: "Market to chapel path", points: [[0, 40], [13, 28], [29, 9], [46, -14]], width: 2.0 },
    { name: "Market to forge path", points: [[0, 40], [-9, 32], [-19, 24], [-28, 17]], width: 2.1 },
    { name: "Market to stable path", points: [[0, 40], [-14, 42], [-32, 43], [-53, 43]], width: 2.0 },
    { name: "Market to beacon path", points: [[0, 40], [1, 19], [-3, 0], [-10, -20], [-20, -37]], width: 2.2 },
  ];
  const ribbons = [];
  for (const spec of routeSpecs) {
    const points = [];
    for (let index = 0; index < spec.points.length - 1; ++index) {
      const start = spec.points[index];
      const end = spec.points[index + 1];
      const steps = 5;
      for (let step = 0; step < steps; ++step) {
        const amount = step / steps;
        points.push({ x: THREE.MathUtils.lerp(start[0], end[0], amount), z: THREE.MathUtils.lerp(start[1], end[1], amount) });
      }
    }
    const last = spec.points.at(-1);
    points.push({ x: last[0], z: last[1] });
    const ribbon = createTerrainRibbon(points, material, { width: spec.width, yOffset: 0.085, name: spec.name });
    ribbons.push(ribbon);
    group.add(ribbon);
  }
  return {
    group,
    dispose() {
      for (const ribbon of ribbons) ribbon.geometry.dispose();
    },
  };
}

/**
 * Build the complete medieval valley scene.
 *
 * `services` is optional. Recognised adapters are:
 * - `camera`, `time`, `weather`, `fire`, `progress`
 * - `registerLandmark(record)`, `registerInteractable(record)`
 * - `onWorldEvent(type, payload)` and `onWorldBuilt(world)`
 *
 * The returned contract is synchronous and stable:
 * `{ terrainHeight, zones, landmarks, blockers, interactables, fires,
 *    staticRoots, staticLights, update, setProgress, applyWeather, dispose }`.
 * Dynamic/transparent objects are tagged `userData.rtxIgnore`; `staticRoots`
 * can therefore be handed directly to the sample's native RTX snapshotter.
 */
export function buildWorld(scene, services = {}) {
  if (!scene || typeof scene.add !== "function") {
    throw new TypeError("buildWorld(scene, services) requires a THREE.Scene-compatible object.");
  }
  const runtimeServices = {
    ...services,
    camera: services.camera ?? services.render?.camera ?? null,
    time: services.time ?? services.timeSystem ?? null,
    weather: services.weather ?? services.weatherSystem ?? null,
    fire: services.fire ?? services.fireSystem ?? null,
    progress: services.progress ?? services.progression ?? services.worldProgression ?? null,
  };

  const root = new THREE.Group();
  root.name = "Medieval Valley RPG World";
  root.userData.sample = "medieval_valley_rpg";
  root.userData.worldBounds = { ...WORLD_BOUNDS };
  scene.add(root);

  const materials = createMaterialLibrary();
  const terrain = createTerrain(materials.terrain);
  const oldRoadPoints = sampleOldNorthRoad(3.5);
  const roadSouth = createTerrainRibbon(
    oldRoadPoints.filter((point) => point.z > 75),
    materials.trail,
    { width: 5.6, name: "South approach road" },
  );
  const roadNorth = createTerrainRibbon(
    oldRoadPoints.filter((point) => point.z < 51),
    materials.trail,
    { width: 4.4, name: "Old north road to Keepfall" },
  );
  const villagePaths = makeVillagePaths(materials.trail);
  const structures = createWorldStructures(materials, runtimeServices);
  const vegetationExclusions = structures.blockers.map((blocker) => ({
    x: blocker.center[0],
    z: blocker.center[2],
    radius: Math.hypot(blocker.halfExtents[0], blocker.halfExtents[2]),
  }));
  const vegetation = createVegetation(materials, { exclusions: vegetationExclusions });
  const river = createRiver(materials);
  const atmosphere = createAtmosphere(scene, runtimeServices);
  const fireVisuals = createFireVisuals(structures.fireDefinitions, runtimeServices);

  root.add(
    terrain.group,
    roadSouth,
    roadNorth,
    villagePaths.group,
    structures.group,
    vegetation.group,
    river.group,
    fireVisuals.group,
    atmosphere.group,
  );

  let disposed = false;
  let elapsed = 0;
  let progress = { ...PROGRESS_PHASES.arrival };
  let visualCorruption = progress.corruption;
  let beaconVisual = 0;
  let manualTimeOfDay = null;
  const progressTargets = structures.progressTargets;
  const beaconFire = fireVisuals.get("village_beacon");
  const beaconBaseY = progressTargets.beaconCrystal.position.y;
  const gateClosedY = progressTargets.fortressGate.position.y;
  const gateOpenY = gateClosedY + 14;

  function emit(type, payload) {
    runtimeServices.onWorldEvent?.(type, payload);
    runtimeServices.events?.emit?.(type, payload);
  }

  function applyProgressVisualFlags() {
    progressTargets.fortressGateBlocker.active = !progress.fortressUnlocked;
    const gateInteractable = structures.interactables.find((item) => item.id === "fortress_gate");
    if (gateInteractable) gateInteractable.prompt = progress.fortressUnlocked ? "Pass through the opened fortress gate" : "Inspect the sealed fortress gate";
    const beaconInteractable = structures.interactables.find((item) => item.id === "village_beacon");
    if (beaconInteractable) {
      beaconInteractable.enabled = true;
      beaconInteractable.prompt = progress.beaconLit
        ? "Stand in the restored beacon's light"
        : progress.beaconRepaired
          ? "Light the restored village beacon"
          : "Inspect the damaged village beacon";
    }
    beaconFire?.setLit(progress.beaconLit, "world-progress");
  }

  function setProgress(next) {
    const previous = progressSnapshot(progress);
    progress = normalizedProgress(next, progress);
    applyProgressVisualFlags();
    const current = progressSnapshot(progress);
    emit("world-progress", { previous, current });
    return current;
  }

  function applyWeather(next) {
    const weather = atmosphere.applyWeather(next);
    emit("weather-visuals", weather);
    return weather;
  }

  function setTimeOfDay(hour) {
    const value = Number(hour);
    if (Number.isFinite(value)) manualTimeOfDay = ((value % 24) + 24) % 24;
    return manualTimeOfDay;
  }

  function update(timeSeconds, deltaSeconds, context = {}) {
    if (disposed) return null;
    const delta = Math.min(0.1, Math.max(0, Number(deltaSeconds) || 0));
    elapsed = Number.isFinite(Number(timeSeconds)) ? Number(timeSeconds) : elapsed + delta;
    const serviceHour = runtimeServices.time?.timeOfDay ?? runtimeServices.time?.hour ?? runtimeServices.time?.state?.hour;
    const frameContext = {
      ...context,
      camera: context.camera ?? runtimeServices.camera ?? null,
      timeOfDay: context.timeOfDay ?? manualTimeOfDay ?? serviceHour ?? 9,
    };
    const weather = atmosphere.update(elapsed, delta, frameContext);
    visualCorruption = THREE.MathUtils.damp(visualCorruption, progress.corruption, 1.35, delta);
    beaconVisual = THREE.MathUtils.damp(beaconVisual, progress.beaconLit ? 1 : (progress.beaconRepaired ? 0.23 : 0), 2.8, delta);
    updateGraphicsUniforms(elapsed, delta, {
      wetness: weather.wetness,
      rain: weather.rain,
      storm: weather.storm,
      wind: weather.wind,
      night: weather.night,
      corruption: visualCorruption,
      beacon: beaconVisual,
    });
    fireVisuals.update(elapsed, delta, weather);
    river.update(elapsed, delta, { flow: 1 + weather.rain * 0.7 });
    vegetation.update(elapsed, delta, weather);

    const gateTargetY = progress.fortressUnlocked ? gateOpenY : gateClosedY;
    progressTargets.fortressGate.position.y = THREE.MathUtils.damp(
      progressTargets.fortressGate.position.y,
      gateTargetY,
      3.5,
      delta,
    );
    progressTargets.beaconCrystal.rotation.y += delta * (0.3 + beaconVisual * 1.8);
    progressTargets.beaconCrystal.position.y = beaconBaseY + Math.sin(elapsed * 1.6) * (0.08 + beaconVisual * 0.28);
    progressTargets.beaconRouteSignal.visible = beaconVisual > 0.012;
    progressTargets.beaconRouteSignal.rotation.y += delta * (0.08 + beaconVisual * 0.28);
    progressTargets.corruptionGroup.visible = visualCorruption > 0.025;
    progressTargets.corruptionGroup.scale.setScalar(0.72 + visualCorruption * 0.28);

    return {
      time: elapsed,
      weather,
      progress: progressSnapshot(progress),
      playerTerrainHeight: frameContext.playerPosition
        ? terrainHeight(frameContext.playerPosition.x, frameContext.playerPosition.z)
        : null,
    };
  }

  const priorityLightIds = [
    "village_beacon",
    "fortress_gate_west_torch",
    "fortress_gate_east_torch",
    "forge_hearth",
    "village_brazier_west",
    "village_brazier_east",
    "hunter_campfire",
    "mill_lantern",
  ];
  const staticLights = priorityLightIds
    .map((id) => fireVisuals.get(id)?.light)
    .filter(Boolean)
    .slice(0, 8);
  const staticRoots = [
    terrain.group,
    roadSouth,
    roadNorth,
    villagePaths.group,
    structures.group,
    vegetation.group,
  ];
  const unsubscribeWeather = subscribeToSnapshots(runtimeServices.weather, applyWeather);
  const unsubscribeProgress = subscribeToSnapshots(runtimeServices.progress, setProgress);
  const locations = createLocationIndex(structures.landmarks, structures.interactables);

  function groundHeightOnly(x, z) {
    let height = terrainHeight(x, z);
    let surfaceId = null;
    for (const surface of structures.walkableSurfaces) {
      if (surface.active === false) continue;
      const center = surface.center ?? [0, 0, 0];
      const halfExtents = surface.halfExtents ?? [0, 0, 0];
      const contains = surface.contains?.(x, z) ?? (
        Math.abs(x - center[0]) <= halfExtents[0]
        && Math.abs(z - center[2]) <= halfExtents[2]
      );
      if (!contains) continue;
      const surfaceHeight = Number(surface.heightAt?.(x, z) ?? center[1] + halfExtents[1]);
      if (Number.isFinite(surfaceHeight) && surfaceHeight >= height) {
        height = surfaceHeight;
        surfaceId = surface.id;
      }
    }
    return { height, surfaceId };
  }

  function sampleGround(x, z) {
    const center = groundHeightOnly(x, z);
    const sample = 0.45;
    const left = groundHeightOnly(x - sample, z).height;
    const right = groundHeightOnly(x + sample, z).height;
    const back = groundHeightOnly(x, z - sample).height;
    const front = groundHeightOnly(x, z + sample).height;
    const normal = new THREE.Vector3(left - right, sample * 2, back - front).normalize();
    return { height: center.height, normal, surfaceId: center.surfaceId };
  }

  const initialProgress = runtimeServices.progress?.snapshot?.() ?? runtimeServices.progress?.state;
  if (initialProgress && typeof initialProgress === "object") setProgress(initialProgress);
  else applyProgressVisualFlags();

  const world = {
    root,
    terrainHeight,
    zones: WORLD_ZONES,
    landmarks: structures.landmarks,
    locations,
    blockers: structures.blockers,
    walkableSurfaces: structures.walkableSurfaces,
    interactables: structures.interactables,
    fireDefinitions: structures.fireDefinitions,
    fires: fireVisuals.fires,
    staticRoots,
    staticLights,
    bounds: { ...WORLD_BOUNDS },
    sampleGround,
    update,
    setProgress,
    applyWeather,
    setTimeOfDay,
    getLocation(id) {
      return locations[id] ?? null;
    },
    get state() {
      return {
        progress: progressSnapshot(progress),
        weather: atmosphere.state,
        time: elapsed,
        timeOfDay: manualTimeOfDay,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeWeather?.();
      unsubscribeProgress?.();
      if (root.parent) root.parent.remove(root);
      fireVisuals.dispose();
      atmosphere.dispose();
      river.dispose();
      vegetation.dispose();
      structures.dispose();
      villagePaths.dispose();
      roadSouth.geometry.dispose();
      roadNorth.geometry.dispose();
      terrain.dispose();
      materials.dispose();
      root.clear();
      emit("world-disposed", { sample: "medieval_valley_rpg" });
    },
  };

  runtimeServices.onWorldBuilt?.(world);
  emit("world-built", {
    sample: "medieval_valley_rpg",
    landmarkCount: Object.keys(world.landmarks).length,
    blockerCount: world.blockers.length,
    interactableCount: world.interactables.length,
  });
  return world;
}

export { terrainHeight } from "./terrain.mjs";
