import * as THREE from "three/webgpu";
import { createCharacterNameplate } from "./actors/character-nameplate.mjs";
import { createPopulationSystem } from "./actors/population.mjs";
import { createFirstPersonWeapon } from "./actors/first-person-weapon.mjs";
import { createPlayer } from "./actors/player.mjs";
import { createVehicleSystem } from "./actors/vehicles.mjs";
import { createFrameCapture } from "./core/capture.mjs";
import { createChaseCamera } from "./core/chase-camera.mjs";
import { createDevelopmentControlServer } from "./core/control-pipe.mjs";
import { createInput } from "./core/input.mjs";
import { warmRendererPipelines } from "./core/pipeline-warmup.mjs";
import {
  collectRenderOnlyDrawables,
  collectRenderOnlyLights,
  createSingleSurfacePresenter,
} from "./core/single-surface-presenter.mjs";
import { createGameAudio } from "./game/audio.mjs";
import { createArrestSystem } from "./game/arrest.mjs";
import {
  RACE_STAGES,
  TAXI_DIALOGUE_KINDS,
  TAXI_STAGES,
  createStreetRaceActivity,
  createTaxiActivity,
} from "./game/activities.mjs";
import { BASKETBALL_STAGES, createBasketballActivity } from "./game/basketball.mjs";
import {
  ASHA_PATEL,
  CAFE_SHIFT_STATIONS,
  COMMON_GROUND_CAFE_STAFF,
  COMMON_GROUND_SHIFT_ROLE,
  createCafeShiftSystem,
} from "./game/cafe-shift.mjs";
import {
  CHAPTER_TWO_AFFECTED_PERSON,
  CHAPTER_TWO_CLUES,
  CHAPTER_TWO_PHASES,
  createBorrowedTimeChapter,
} from "./game/chapter-two.mjs";
import {
  COMMUNITY_HUB_ROLES,
  COMMUNITY_HUB_STAFF,
  createCommunityHubSystem,
} from "./game/community-hub.mjs";
import { createCinematicDirector } from "./game/cinematics.mjs";
import { createCityEnvironment } from "./game/environment.mjs";
import { createGameEffects } from "./game/effects.mjs";
import { GARAGE_FAULTS, GARAGE_SHIFT_STAGES, createGarageShiftSystem } from "./game/garage-shift.mjs";
import { createInteriorOccupancySystem } from "./game/interior-occupancy.mjs";
import { stageConversationSeparation } from "./game/interaction-staging.mjs";
import { createLifeActivitySystem } from "./game/life-activities.mjs";
import { createLifeProfile } from "./game/life-profile.mjs";
import { createMapNavigation } from "./game/map-navigation.mjs";
import {
  MARKET_SURPLUS_DECISIONS,
  MINA_MARKET_SHIFT_ROLE,
  MINA_MARKET_STAFF,
  MINA_MARKET_STATIONS,
  MINA_OKAFOR,
  createMarketShiftSystem,
} from "./game/market-shift.mjs";
import { MISSION_STAGES, createVehicleRecoveryMission } from "./game/mission.mjs";
import { createNeighbourhoodRoutine } from "./game/neighbourhood-routine.mjs";
import { createResidentialLife } from "./game/residential-life.mjs";
import {
  NIGHT_ROUTE_CHARACTERS,
  NIGHT_ROUTE_PHASES,
  createNightRouteStory,
} from "./game/night-route.mjs";
import { ROADSIDE_PHASES, createRoadsideResponseSystem } from "./game/roadside-response.mjs";
import { createSaveService } from "./game/save.mjs";
import { STORY_PHASES, createStoryCampaign } from "./game/story.mjs";
import { createWantedSystem } from "./game/wanted.mjs";
import { createGtaHud, isAuthoredNarrativePresentation } from "./ui/hud.mjs";
import { buildCity } from "./world/city.mjs";
import { createDesertOutskirts } from "./world/desert-outskirts.mjs";

document.title = "GTA Neon City — Native ThreeBrowser Runtime";

const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const MAX_INTERNAL_PIXELS = 4_600_000;
const TELEMETRY_INTERVAL = 10;
const FRAME_TIMING_WINDOW = 240;
const HUD_ENTITY_REFRESH_STEP = 1 / 20;
// Presentation-only HUD work does not need to rebuild frozen view models every
// render tick.  Gameplay simulation, input, camera and 3D rendering stay at
// their full rates; only the text overlay is capped at a visually smooth 30 Hz.
const HUD_MIN_REFRESH_MS = 1000 / 30;
const NIGHT_ROUTE_STAGE_CHARACTERS = Object.freeze([
  NIGHT_ROUTE_CHARACTERS.malik,
  NIGHT_ROUTE_CHARACTERS.evelyn,
  NIGHT_ROUTE_CHARACTERS.desmond,
  NIGHT_ROUTE_CHARACTERS.nadiya,
]);
const NIGHT_ROUTE_PRESENTATION_PHASE_EVENTS = new Set([
  "ordinary_story_started",
  "sequence_started",
  "survey_started",
  "choice_requested",
  "aftermath_started",
]);
const NIGHT_ROUTE_GROUP_SEQUENCES = new Set([
  "briefing",
  "anonymous_epilogue",
  "signed_epilogue",
]);
const NIGHT_ROUTE_DINER_OFFSETS = Object.freeze({
  malik_reed: Object.freeze([-2.40, 0, 0.90]),
  evelyn_cho: Object.freeze([-2.60, 0, -1.10]),
  desmond_vale: Object.freeze([-0.80, 0, -2.00]),
  nadiya_khoury: Object.freeze([1.00, 0, -1.10]),
});

function displayPixelRatio(width, height) {
  const display = Math.max(1, Number(globalThis.devicePixelRatio || 1));
  return Math.max(1, Math.min(1.75, display, Math.sqrt(MAX_INTERNAL_PIXELS / Math.max(1, width * height))));
}

function vectorFrom(value, fallback = [0, 0, 0]) {
  if (value?.isVector3) return value.clone();
  const source = value?.position ?? value ?? fallback;
  if (Array.isArray(source)) return new THREE.Vector3(Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0);
  return new THREE.Vector3(Number(source?.x) || 0, Number(source?.y) || 0, Number(source?.z) || 0);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

async function loadOptionalTexture(relativePath, name) {
  const source = new URL(relativePath, import.meta.url);
  try {
    const texture = await new THREE.TextureLoader().loadAsync(source.href);
    texture.name = String(name || source.pathname.split("/").at(-1) || "authored texture");
    return texture;
  } catch (error) {
    console.warn(`[GTA Neon City] optional texture unavailable; procedural fallback active (${source.pathname}): ${error?.message || error}`);
    return null;
  }
}

async function main() {
  const renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
    trackTimestamp: true,
  });
  renderer.setPixelRatio(displayPixelRatio(innerWidth, innerHeight));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x07101a, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  if (!renderer.backend?.isWebGPUBackend) throw new Error("WebGPURenderer did not initialize a native WebGPU backend.");
  renderer.backend.device?.addEventListener?.("uncapturederror", event => {
    console.error("[GTA Neon City WebGPU]", event.error?.message || event.error || event);
  });

  const scene = new THREE.Scene();
  scene.name = "GTA Neon City open world";
  scene.background = new THREE.Color(0x07101a);
  scene.fog = new THREE.FogExp2(0x10263b, 0.0029);
  const gameplayAmbient = new THREE.AmbientLight(0x6e97ba, 0.52);
  const gameplayAmbientDayColor = new THREE.Color(0xb7d6e8);
  gameplayAmbient.name = "Gameplay readability ambience";
  scene.add(gameplayAmbient);
  const camera = new THREE.PerspectiveCamera(58, innerWidth / Math.max(1, innerHeight), 0.08, 680);
  camera.position.set(-8, 5, 15);
  scene.add(camera);
  const audioListenerForward = new THREE.Vector3(0, 0, -1);
  const audioListenerUp = new THREE.Vector3(0, 1, 0);
  const firstPersonWeapon = createFirstPersonWeapon(camera);
  const gameplayFill = new THREE.PointLight(0xb9ddff, 24, 18, 2);
  gameplayFill.name = "Player and vehicle readability fill";
  scene.add(gameplayFill);
  const headlightRig = new THREE.Group();
  headlightRig.name = "Player vehicle dynamic headlight rig";
  // Keep the light IDs in Three's scene-light cache at all times. Toggling the
  // parent visibility changes LightsNode's cache key and invalidates render
  // objects for every hidden branch; the first later ADS frame then rebuilds
  // all 39 viewmodel meshes. Zero intensity is the stable, visually identical
  // off state and lets startup prewarm remain valid for the entire session.
  headlightRig.visible = true;
  const headlightLamps = [];
  let headlightsActive = false;
  for (const side of [-1, 1]) {
    const target = new THREE.Object3D();
    target.position.set(side * 0.48, -1.05, -28);
    const lamp = new THREE.SpotLight(0xd9f2ff, 0, 38, 0.31, 0.78, 1.35);
    lamp.name = `${side < 0 ? "Left" : "Right"} player headlight throw`;
    lamp.position.set(side * 0.55, 0.72, -1.62);
    lamp.castShadow = false;
    lamp.target = target;
    headlightRig.add(lamp, target);
    headlightLamps.push(lamp);
  }
  const headlightFill = new THREE.PointLight(0xb8e6ff, 0, 9, 2);
  headlightFill.name = "Wet road headlight bounce";
  headlightFill.position.set(0, 0.42, -2.2);
  headlightRig.add(headlightFill);
  scene.add(headlightRig);

  const input = createInput(renderer.domElement);
  // Decode every authored bitmap before world creation. Texture upload and
  // material compilation therefore happen during the explicit startup warmup,
  // never on the first drive into a district.
  const [authoredFacadeTexture, authoredStoneTexture, authoredBrickTexture, authoredRoadTexture, authoredPavementTexture,
    authoredCourtTexture, authoredDepotTexture] = await Promise.all([
    loadOptionalTexture(
      "../assets/textures/facade-concrete-weathered-v1.png",
      "Weathered coastal concrete facade v1",
    ),
    loadOptionalTexture(
      "../assets/textures/facade-stone-coastal-panel-v3.png",
      "Salt-aged coastal stone panel facade v3",
    ),
    loadOptionalTexture(
      "../assets/textures/facade-brick-coastal-aged-v1.png",
      "Aged coastal brick facade v1",
    ),
    loadOptionalTexture(
      "../assets/textures/asphalt-coastal-worn-v1.png",
      "Worn coastal asphalt v1",
    ),
    loadOptionalTexture(
      "../assets/textures/pavement-concrete-aggregate-v1.png",
      "Weathered concrete aggregate pavement v1",
    ),
    loadOptionalTexture(
      "../assets/textures/court-painted-coastal-worn-v1.png",
      "Salt-worn painted waterfront basketball court v1",
    ),
    loadOptionalTexture(
      "../assets/textures/depot-corrugated-coastal-v1.png",
      "Weathered coastal corrugated depot cladding v1",
    ),
  ]);
  const world = buildCity(scene, {
    authoredFacadeTexture,
    authoredStoneTexture,
    authoredBrickTexture,
    authoredRoadTexture,
    authoredPavementTexture,
    authoredCourtTexture,
    authoredDepotTexture,
  });
  let player = null;
  const desertOutskirts = createDesertOutskirts({
    scene,
    world,
    onPlayerDamage: amount => player?.damage(amount),
  });
  const desertRuinsPosition = new THREE.Vector3(0, 0, 505);
  let desertCutsceneAnnounced = false;
  let desertRescueAnnounced = false;
  const pulseTransitPracticalLights = Object.freeze(world.staticLights.filter(light =>
    light.userData?.practicalKind === "pulse-transit"));
  const practicalWorldLights = Object.freeze(world.staticLights.slice(2));
  const celestialKeyLight = world.staticLights.find(light => light.isDirectionalLight) ?? null;
  const environment = createCityEnvironment({ scene, world });
  environment.setTime(7.2);
  environment.setRain(0.08, true);
  const contactPosition = vectorFrom(world.missionPoints.pulseGarage);
  const targetSpawn = vectorFrom(world.missionPoints.firstRide);
  const dropoffPosition = contactPosition.clone();
  const hospitalPosition = vectorFrom(world.spawnPoints.player);
  const policeReleasePosition = hospitalPosition.clone().add(new THREE.Vector3(11, 0, -3));
  policeReleasePosition.y = Number(world.terrainHeight?.(policeReleasePosition.x, policeReleasePosition.z) ?? 0);
  const chapterTwoWorld = world.chapterTwo ?? {};
  const chapterTwoGarageClueFallbacks = Object.freeze({
    failed_brake_hose: [-151.5, 0.2, 79.6],
    supplier_invoice: [-144, 0.2, 79.6],
    service_log: [-136.5, 0.2, 79.6],
  });
  const chapterTwoGarageCluePositions = new Map(CHAPTER_TWO_CLUES.map(clue => [
    clue.id,
    vectorFrom(chapterTwoWorld.garageClues?.[clue.id] ?? chapterTwoGarageClueFallbacks[clue.id]),
  ]));
  const chapterTwoCinematicAnchors = chapterTwoWorld.cinematicAnchors ?? {};
  const chapterTwoEvidenceCinematicPositions = new Map(CHAPTER_TWO_CLUES.map(clue => [
    clue.id,
    vectorFrom(chapterTwoCinematicAnchors[clue.id] ?? chapterTwoGarageCluePositions.get(clue.id)),
  ]));
  const chapterTwoLeahPosition = vectorFrom(chapterTwoWorld.leahAnchor ?? [-44, 0.2, -16.5]);
  const chapterTwoLeahInteractionPosition = vectorFrom(
    chapterTwoWorld.leahInteractionAnchor ?? chapterTwoWorld.conversationAnchors?.leah ?? [-41, 0.2, -17],
  );
  const chapterTwoDepotManifestPosition = vectorFrom(
    chapterTwoWorld.manifestDesk ?? chapterTwoWorld.interactAnchors?.manifestDesk ?? [-180.35, 0.2, -136],
  );
  const chapterTwoDepotManifestInteractionPosition = vectorFrom(
    chapterTwoWorld.manifestInteractionAnchor ?? chapterTwoWorld.conversationAnchors?.manifest ?? chapterTwoDepotManifestPosition,
  );
  const chapterTwoRecallDeskPosition = chapterTwoGarageCluePositions.get("supplier_invoice").clone();
  const chapterTwoDepotManifestCinematicPosition = vectorFrom(
    chapterTwoCinematicAnchors.depot_manifest ?? chapterTwoDepotManifestPosition,
  );
  const chapterTwoRecallBoardCinematicPosition = vectorFrom(
    chapterTwoCinematicAnchors.recall_board ?? chapterTwoRecallDeskPosition,
  );
  const chapterTwoRecallCustomerPosition = vectorFrom(
    chapterTwoWorld.aftermathAnchors?.recallCustomer ?? [-140.35, 0.2, 78.55],
  );
  const wanted = createWantedSystem();
  const arrest = createArrestSystem();
  const taxiActivity = createTaxiActivity();
  const raceActivity = createStreetRaceActivity();
  const lifeActivity = createLifeActivitySystem();
  const lifeProfile = createLifeProfile();
  const residentialInterior = world.residentialInterior;
  const residentialLife = createResidentialLife({
    seed: world.seed,
    initialHomeId: residentialInterior.homeId,
    initialTenure: "rented",
    initialMinuteOfDay: Math.trunc(environment.snapshot().timeHours * 60),
  });
  const pulseGarageInterior = world.pulseGarageInterior;
  const garageShift = createGarageShiftSystem({
    seed: world.seed,
    anchors: {
      clockIn: pulseGarageInterior.stations.office.position,
      serviceDesk: pulseGarageInterior.customerAnchor,
      inspectionBay: pulseGarageInterior.stations.diagnostics.position,
      partsCounter: pulseGarageInterior.stations.parts.position,
      liftBay: pulseGarageInterior.stations.lift.position,
      safetyLane: pulseGarageInterior.entrance.interior,
      office: pulseGarageInterior.stations.office.position,
    },
  });
  const garageClockPosition = vectorFrom(garageShift.anchors.clockIn);
  const initialGarageShiftSave = garageShift.save();
  const communityHubWorld = world.communityHub;
  if (!communityHubWorld) throw new Error("Harbour Skills House physical world contract is missing.");
  const communityHubLife = createCommunityHubSystem({
    seed: world.seed ^ 0x534b494c,
    initialDayIndex: 0,
    initialMinuteOfDay: Math.trunc(environment.snapshot().timeHours * 60),
  });
  const initialCommunityHubSave = communityHubLife.save();
  const commonGroundCafeWorld = world.commonGroundCafe;
  if (!commonGroundCafeWorld) throw new Error("Common Ground Cafe physical world contract is missing.");
  const cafeShift = createCafeShiftSystem({
    seed: world.seed ^ 0x43414645,
    initialDayIndex: 0,
    initialMinuteOfDay: Math.trunc(environment.snapshot().timeHours * 60),
  });
  const initialCafeShiftSave = cafeShift.save();
  const minaMarketWorld = world.minaMarketKitchen;
  if (!minaMarketWorld) throw new Error("Mina's Market Kitchen physical world contract is missing.");
  const marketShift = createMarketShiftSystem({ seed: world.seed ^ 0x4d494e41 });
  const initialMarketShiftSave = marketShift.save();
  const initialLifeProfileSave = lifeProfile.save();
  const initialResidentialLifeSave = residentialLife.save();
  const basketballActivity = createBasketballActivity({
    scene,
    hubPosition: world.missionPoints.harbourCourt.position,
    hoopPosition: world.missionPoints.harbourCourtHoop.position,
  });
  const businessPositionOverrides = Object.fromEntries((world.businesses ?? []).map(location => [
    String(location.id),
    String(location.id) === "common_ground_cafe"
      ? commonGroundCafeWorld.customerAnchors.queue[0]
      : location.interactionPosition ?? location.position,
  ]));
  const neighbourhoodRoutine = createNeighbourhoodRoutine({ businessPositions: businessPositionOverrides });
  const initialNeighbourhoodSave = neighbourhoodRoutine.save();
  const nightRoute = createNightRouteStory({
    anchors: {
      southlineDiner: businessPositionOverrides.southline_diner,
    },
  });
  const initialNightRouteSave = nightRoute.save();
  const nightRouteDinerPosition = vectorFrom(nightRoute.snapshot().hubPosition);
  const nightRouteKaiStagePosition = nightRouteDinerPosition.clone().add(new THREE.Vector3(-0.25, 0, 1.15));
  nightRouteKaiStagePosition.y = Number(
    world.terrainHeight?.(nightRouteKaiStagePosition.x, nightRouteKaiStagePosition.z) ?? nightRouteKaiStagePosition.y,
  );
  const nightRouteDinerParticipantPositions = new Map(Object.entries(NIGHT_ROUTE_DINER_OFFSETS).map(([characterId, value]) => {
    const position = nightRouteDinerPosition.clone().add(new THREE.Vector3(...value));
    position.y = Number(world.terrainHeight?.(position.x, position.z) ?? position.y);
    return [characterId, position];
  }));
  const story = createStoryCampaign();
  const chapterTwo = createBorrowedTimeChapter();
  const initialChapterTwoSave = chapterTwo.save();
  function mapPlacePosition(value) {
    return value?.entrance?.exterior ?? value?.entrance?.threshold ?? value?.entrance ??
      value?.hubPosition ?? value?.hub ?? value?.position;
  }
  function mapPlaceDirectory() {
    const places = [];
    const ids = new Set();
    const add = (idValue, title, category, position, details = {}) => {
      const id = String(idValue ?? "").trim();
      if (!id || ids.has(id) || !position) return;
      ids.add(id);
      places.push(Object.freeze({
        id,
        title,
        category,
        position,
        icon: details.icon ?? category,
        address: details.address ?? "",
        description: details.description ?? "",
        open: details.open ?? true,
        priority: details.priority ?? 0,
      }));
    };
    add(residentialInterior.homeId, residentialInterior.label, "home", residentialInterior.entrance.exterior, {
      address: residentialInterior.address,
      description: "KAI'S CURRENT HOME",
      priority: 80,
    });
    add("pulse_garage", "PULSE GARAGE", "work", pulseGarageInterior.entrance.exterior, {
      description: "APPRENTICE MECHANIC WORK AND STORY CONTACT",
      priority: 72,
    });
    add(communityHubWorld.id, communityHubWorld.label, "work", communityHubWorld.entrance.exterior, {
      address: communityHubWorld.address,
      description: "COMMUNITY KITCHEN, REPAIR CAFE, AND SUPPORT DESK",
      priority: 70,
    });
    const availableBusinesses = neighbourhoodRoutine.available({
      timeHours: environment.snapshot().timeHours,
      weather: environment.snapshot().weather,
      story: story.snapshot(),
    });
    const businessById = new Map(availableBusinesses.map(business => [business.id, business]));
    add("common_ground_cafe", commonGroundCafeWorld.label, "work", commonGroundCafeWorld.entrance.exterior, {
      address: commonGroundCafeWorld.address,
      description: "CAFE, MEALS, AND PAID HOSPITALITY SHIFTS",
      open: businessById.get("common_ground_cafe")?.open,
      priority: 68,
    });
    add("mina_market_kitchen", minaMarketWorld.label, "work", minaMarketWorld.entrance.exterior, {
      address: minaMarketWorld.address,
      description: "GROCERIES, MEALS, AND PAID MARKET SHIFTS",
      open: businessById.get("mina_market_kitchen")?.open,
      priority: 68,
    });
    add(world.pulseTransit.id, world.pulseTransit.title, "transit", world.pulseTransit.entrance, {
      description: "PULSE LINE COMMUNITY SHUTTLE",
      priority: 66,
    });
    for (const business of availableBusinesses) {
      if (business.id === "common_ground_cafe" || business.id === "mina_market_kitchen") continue;
      add(business.id, business.name, "business", business.position, {
        description: `${business.keeperName} / ${business.openingHours?.label ?? "LOCAL BUSINESS"}`,
        open: business.open,
        priority: 50,
      });
    }
    for (const activity of lifeActivity.available(lifeUnlockContext())) {
      if (activity.id === "pulse_line") continue;
      const kind = String(activity.kind ?? "");
      const category = ["courier", "mechanic", "taxi"].includes(kind) ? "work" : "activity";
      add(activity.id, activity.title, category, activity.hubPosition, {
        description: activity.description,
        priority: category === "work" ? 58 : 42,
      });
    }
    const court = basketballActivity.available();
    add(court.id ?? "harbour_court", court.title ?? "HARBOUR COURT", "activity", court.hubPosition, {
      description: court.description ?? "PUBLIC BASKETBALL COURT",
      priority: 44,
    });
    add("ashwind_breach", "ASHWIND BREACH", "transit", [0, 0, 196], {
      description: "THE NARROW NORTHERN ROAD INTO ASHWIND",
      priority: 64,
    });
    add("ashwind_ruins", "ASHWIND RUINS", "activity", [0, 0, 505], {
      description: "REMOTE RUINS BEYOND THE CITY",
      priority: 60,
    });
    return Object.freeze(places);
  }
  const mapNavigation = createMapNavigation({
    places: mapPlaceDirectory(),
    bounds: world.mapFeatures.bounds,
    viewport: { width: 312, height: 312 },
    initialCenter: world.spawnPoints.player.position,
    initialZoom: 2.4,
    minZoom: 1,
    maxZoom: 8,
  });
  const initialMapNavigationSave = mapNavigation.save();
  mapNavigation.prewarm();
  let businessLightingMinute = -1;
  function syncBusinessLighting(timeHours, weather) {
    const wrappedHours = ((Number(timeHours) % 24) + 24) % 24;
    const minute = Math.trunc(wrappedHours * 60) % (24 * 60);
    if (minute === businessLightingMinute) return 0;
    businessLightingMinute = minute;
    const businessStates = neighbourhoodRoutine.available({
      timeHours: wrappedHours,
      weather,
      story: story.snapshot(),
    });
    for (const business of businessStates) mapNavigation.setPlaceOpen(business.id, business.open);
    return world.setBusinessOpenStates?.(businessStates) ?? 0;
  }
  const initialLightingEnvironment = environment.snapshot();
  syncBusinessLighting(initialLightingEnvironment.timeHours, initialLightingEnvironment.weather);
  const saveService = createSaveService();
  let gameAudio = {
    start() {},
    play() { return false; },
    playAt() { return null; },
    updateListener() {},
    update() {},
    snapshot() { return null; },
    dispose() {},
  };
  try {
    gameAudio = await createGameAudio();
    camera.getWorldDirection(audioListenerForward);
    audioListenerUp.copy(camera.up).applyQuaternion(camera.quaternion).normalize();
    gameAudio.updateListener(camera.position, audioListenerForward, audioListenerUp);
    gameAudio.start();
  } catch (error) {
    console.warn(`[GTA Neon City] native audio unavailable; continuing silently: ${error?.message || error}`);
  }
  let elapsed = 0;
  // Presentation time keeps native UI animations and mouse-up interactions
  // alive while the phone intentionally pauses the world and releases pointer
  // lock. It is independent from the saved simulation clock.
  let presentationElapsed = 0;
  let disposed = false;
  let paused = false;
  let controlServer = null;
  let toast = "WELCOME TO NEON CITY";
  let toastUntil = 4;
  let deathAt = null;
  let lastStage = MISSION_STAGES.AVAILABLE;
  let lastWantedStars = 0;
  let lastLightning = 0;
  let thunderAt = null;
  let telemetryAt = TELEMETRY_INTERVAL;
  let lastFrame = Number(globalThis.performance?.now?.() ?? Date.now()) * 0.001;
  let accumulator = 0;
  let smoothedFps = 60;
  const frameTimesMs = new Float32Array(FRAME_TIMING_WINDOW);
  const frameTimeBuckets = new Uint8Array(FRAME_TIMING_WINDOW);
  const frameTimeHistogram = new Uint16Array(101);
  let frameTimingCount = 0;
  let frameTimingCursor = 0;
  let frameTimingTotalMs = 0;
  let latestFrameMs = 0;
  const framePhaseKeys = Object.freeze(["simulation", "worldStage", "hud", "present", "animation"]);
  const framePhaseLatestMs = Object.seal({ simulation: 0, worldStage: 0, hud: 0, present: 0, animation: 0 });
  const framePhaseMaximumMs = Object.seal({ simulation: 0, worldStage: 0, hud: 0, present: 0, animation: 0 });
  const crimeTimes = new Map();
  let selectedActivity = null;
  const phoneApps = Object.freeze([
    Object.freeze({ id: "wallet", name: "PULSE PAY", subtitle: "MONEY AND COMMUNITY TRUST" }),
    Object.freeze({ id: "places", name: "OPEN DOORS", subtitle: "LOCAL STORES AND HOURS" }),
    Object.freeze({ id: "work", name: "CITY WORK", subtitle: "LAWFUL JOBS AND ACTIVITIES" }),
    Object.freeze({ id: "contacts", name: "CONTACTS", subtitle: "PEOPLE WHO KNOW KAI" }),
    Object.freeze({ id: "profile", name: "LIFE PROFILE", subtitle: "SKILLS, ENERGY, AND WORK HISTORY" }),
    Object.freeze({ id: "home", name: "MY HOME", subtitle: "ROOMS, ROUTINES, AND HOUSEHOLD" }),
    Object.freeze({ id: "map", name: "NEON MAP", subtitle: "PLACES, ROUTES, AND LIVE NAVIGATION" }),
  ]);
  let phoneOpen = false;
  let phoneApp = null;
  let phoneSelection = 0;
  let phoneScroll = 0;
  let phoneHover = -1;
  let phonePressed = false;
  let phonePressTarget = null;
  let phoneMapPointerX = 0;
  let phoneMapPointerY = 0;
  let phoneOpenedAt = -Infinity;
  let phoneAppTransitionAt = -Infinity;
  const phoneRecentApps = [];
  let communityTrust = 0;
  let lastActivityStage = null;
  let lastTaxiDialogueSerial = 0;
  let lastNightRouteHandledEventSerial = 0;
  let nightRouteCompletionEventsHandled = 0;
  let lastNightRouteHandledEvent = null;
  let activityPresentationUntil = 0;
  let lastRaceCountdownSecond = null;
  let lastBasketballEvent = null;
  let garageDiagnosisIndex = 0;
  let garageConfirmedDiagnosisId = null;
  let garageCustomerActor = null;
  let garageCustomerReleaseAt = -Infinity;
  let lastNeighbourhoodTransactionSerial = 0;
  let lastResidentialTransactionSerial = 0;
  let lastResidentialInteractionSerial = 0;
  let lastCommunityStationResultSerial = 0;
  let lastCommunityTransactionSerial = 0;
  let lastCommunityScheduleMinute = -1;
  let lastCommunityPresentationEvent = null;
  let communityRoleSelectionIndex = 0;
  const communityRuntimeClockContext = {
    dayIndex: 0,
    minuteOfDay: Math.trunc(environment.snapshot().timeHours * 60),
    captureSnapshot: false,
  };
  let communityRuntimeView = communityHubLife.update(0, {
    timeHours: environment.snapshot().timeHours,
    captureSnapshot: false,
  });
  let lastCafeStationResultSerial = 0;
  let lastCafeTransactionSerial = 0;
  let lastCafeScheduleMinute = -1;
  let lastCafePresentationEvent = null;
  const cafeRuntimeClockContext = {
    dayIndex: 0,
    minuteOfDay: Math.trunc(environment.snapshot().timeHours * 60),
    captureSnapshot: false,
  };
  let cafeRuntimeView = cafeShift.update(0, {
    timeHours: environment.snapshot().timeHours,
    captureSnapshot: false,
  });
  let lastMarketStationResultSerial = 0;
  let lastMarketTransactionSerial = 0;
  let lastMarketScheduleMinute = -1;
  let lastMarketPresentationEvent = null;
  const marketRuntimeClockContext = {
    dayIndex: 0,
    minuteOfDay: Math.trunc(environment.snapshot().timeHours * 60),
    captureSnapshot: false,
  };
  let marketRuntimeView = marketShift.update(0, {
    timeHours: environment.snapshot().timeHours,
    captureSnapshot: false,
  });
  let residentialRevision = 0;
  let residentialRuntimeView = residentialLife.update(0, {
    timeHours: environment.snapshot().timeHours,
    captureSnapshot: false,
  });
  let residentialFullSnapshotCache = null;
  let residentialFullSnapshotCacheKey = "";
  let pipelineWarmupState = Object.freeze({ ready: false, policy: "startup-preload-all-authored-branches", passes: [] });
  let simulationWarmupState = Object.freeze({ ready: false, policy: "startup-memory-micro-simulation", steps: 0 });
  let controlStepping = false;
  let suppressFrameTimingFrames = 0;
  let developmentCaptured = false;
  let lastCaptureLocked = false;
  let cinematicWasActive = false;
  let cachedVehicleSnapshots = null;
  let cachedPopulationSnapshots = null;
  let nextHudEntitySnapshotAt = -Infinity;
  let lastHudRefreshAtMs = -Infinity;

  let vehicles = null;
  let population = null;
  let roadsideResponse = null;
  let lastRoadsidePhase = ROADSIDE_PHASES.IDLE;
  let taxiPassengerActor = null;
  let taxiPresentationSignature = "";
  const nightRouteParticipantActors = new Map();
  const residentialActors = new Map();
  const residentialActorSignatures = new Map();
  const communityStaffActors = new Map();
  const communityStaffSignatures = new Map();
  const cafeStaffActors = new Map();
  const cafeStaffSignatures = new Map();
  const marketStaffActors = new Map();
  const marketStaffSignatures = new Map();
  let marketStaffStates = Object.freeze([]);
  let interiorOccupancy = null;
  let residentialActorStates = Object.freeze([]);
  let lastResidentialScheduleMinute = -1;
  let nightRouteParticipantLayoutSignature = "";
  let cachedNightRouteNarrativeSource = null;
  let cachedNightRouteNarrative = null;
  let effects = null;
  let hud = null;
  let frameCapture = null;

  function resetFrameTiming() {
    frameTimesMs.fill(0);
    frameTimeBuckets.fill(0);
    frameTimeHistogram.fill(0);
    frameTimingCount = 0;
    frameTimingCursor = 0;
    frameTimingTotalMs = 0;
    latestFrameMs = 0;
    for (const phase of framePhaseKeys) {
      framePhaseLatestMs[phase] = 0;
      framePhaseMaximumMs[phase] = 0;
    }
    suppressFrameTimingFrames = 0;
    lastFrame = Number(globalThis.performance?.now?.() ?? Date.now()) * 0.001;
  }

  function recordFrameTiming(millisecondsValue) {
    const milliseconds = Math.max(0, Number(millisecondsValue) || 0);
    const replacing = frameTimingCount === FRAME_TIMING_WINDOW;
    if (replacing) {
      frameTimingTotalMs -= frameTimesMs[frameTimingCursor];
      const oldBucket = frameTimeBuckets[frameTimingCursor];
      if (frameTimeHistogram[oldBucket] > 0) frameTimeHistogram[oldBucket] -= 1;
    } else frameTimingCount += 1;
    const bucket = Math.min(100, Math.floor(milliseconds));
    frameTimesMs[frameTimingCursor] = milliseconds;
    frameTimeBuckets[frameTimingCursor] = bucket;
    frameTimeHistogram[bucket] += 1;
    frameTimingTotalMs += milliseconds;
    latestFrameMs = milliseconds;
    frameTimingCursor = (frameTimingCursor + 1) % FRAME_TIMING_WINDOW;
  }

  function recordFramePhases() {
    for (const phase of framePhaseKeys) {
      framePhaseMaximumMs[phase] = Math.max(framePhaseMaximumMs[phase], framePhaseLatestMs[phase]);
    }
  }

  function phaseTimingSnapshot() {
    return Object.freeze({
      latestMs: Object.freeze({ ...framePhaseLatestMs }),
      maximumMs: Object.freeze({ ...framePhaseMaximumMs }),
    });
  }

  function frameTimingSnapshot() {
    if (frameTimingCount === 0) {
      return Object.freeze({
        samples: 0,
        latestMs: 0,
        averageMs: 0,
        p95Ms: 0,
        maximumMs: 0,
        overBudgetFrames: 0,
        stallFrames: 0,
        phases: phaseTimingSnapshot(),
      });
    }
    const percentileTarget = Math.max(1, Math.ceil(frameTimingCount * 0.95));
    let percentileCount = 0;
    let p95Ms = 100;
    for (let bucket = 0; bucket < frameTimeHistogram.length; ++bucket) {
      percentileCount += frameTimeHistogram[bucket];
      if (percentileCount >= percentileTarget) {
        p95Ms = bucket;
        break;
      }
    }
    let maximumMs = 0;
    let overBudgetFrames = 0;
    let stallFrames = 0;
    for (let index = 0; index < frameTimingCount; ++index) {
      const value = frameTimesMs[index];
      maximumMs = Math.max(maximumMs, value);
      if (value > 20) overBudgetFrames += 1;
      if (value > 50) stallFrames += 1;
    }
    return Object.freeze({
      samples: frameTimingCount,
      latestMs: latestFrameMs,
      averageMs: frameTimingTotalMs / frameTimingCount,
      p95Ms,
      maximumMs,
      overBudgetFrames,
      stallFrames,
      phases: phaseTimingSnapshot(),
    });
  }

  function showToast(message, duration = 3.2) {
    toast = String(message || "");
    toastUntil = elapsed + Math.max(0.5, Number(duration) || 3.2);
  }

  function controlledPosition() {
    return vehicles?.playerVehicle?.root?.position ?? player.root.position;
  }

  function updatePlayerHeadlights(vehicle, environmentState) {
    const darkness = clamp(Number(environmentState?.streetlight ?? (1 - Number(environmentState?.daylight ?? 0.25))), 0, 1);
    const weatherDemand = clamp((Number(environmentState?.rain) || 0) * 0.82, 0, 0.82);
    const demand = Math.max(darkness, weatherDemand);
    const active = Boolean(vehicle?.root?.position && vehicle.health > 0 && demand > 0.035);
    headlightsActive = active;
    vehicles?.setExternalPlayerHeadlightsActive?.(active);
    if (!active) {
      for (const lamp of headlightLamps) lamp.intensity = 0;
      headlightFill.intensity = 0;
      return;
    }
    headlightRig.position.copy(vehicle.root.position);
    headlightRig.quaternion.copy(vehicle.root.quaternion);
    const wetBoost = 1 + clamp(environmentState?.wetness ?? environmentState?.rain ?? 0, 0, 1) * 0.08;
    const damageRatio = clamp(1 - vehicle.health / Math.max(1, vehicle.maxHealth), 0, 1);
    for (let index = 0; index < headlightLamps.length; ++index) {
      const damagedLamp = damageRatio > 0.68 && index === 1;
      headlightLamps[index].intensity = damagedLamp ? 0 : (70 + demand * 260) * wetBoost;
    }
    headlightFill.intensity = (2 + demand * 14) * wetBoost;
  }

  function selectedActivitySystem() {
    return selectedActivity === "taxi" ? taxiActivity :
      selectedActivity === "race" ? raceActivity :
      selectedActivity === "life" ? lifeActivity :
      selectedActivity === "garage" ? garageShift :
      selectedActivity === "basketball" ? basketballActivity :
      selectedActivity === "nightRoute" ? nightRoute : null;
  }

  const cafeStationById = new Map(CAFE_SHIFT_STATIONS.map(station => [station.id, station]));
  const cafeWorldStationById = new Map(Object.values(commonGroundCafeWorld.stations).map(station => [station.id, station]));
  const cafeWorldStationPositions = new Map([...cafeWorldStationById].map(([id, station]) => [
    id,
    vectorFrom(station.position),
  ]));
  const cafeHandoverPosition = cafeWorldStationPositions.get("cafe-handover");

  function cafeClockContext(detail = {}) {
    const environmentState = environment.snapshot();
    return {
      dayIndex: neighbourhoodRoutine.snapshot().dayIndex,
      timeHours: environmentState.timeHours,
      ...detail,
    };
  }

  function insideCommonGroundCafe(positionValue = controlledPosition()) {
    const position = positionValue?.isVector3 ? positionValue : positionValue?.position ?? positionValue ?? {};
    const x = Array.isArray(position) ? Number(position[0]) : Number(position.x);
    const z = Array.isArray(position) ? Number(position[2]) : Number(position.z);
    const bounds = commonGroundCafeWorld.bounds;
    return x >= bounds.minX - 0.15 && x <= bounds.maxX + 0.15 &&
      z >= bounds.minZ - 0.15 && z <= bounds.maxZ + 0.15;
  }

  let cafeActivityCacheKey = "";
  let cafeActivityCache = null;
  let cafeQuality = 0;
  let cafeReworkCount = 0;
  function cafeActivitySnapshot() {
    const station = cafeStationById.get(cafeRuntimeView.stationId) ?? null;
    const worldStation = cafeWorldStationById.get(station?.worldStationId ?? station?.id) ?? null;
    const active = Boolean(station && ["active", "paused"].includes(cafeRuntimeView.status));
    const working = active && cafeRuntimeView.taskActive;
    const taskIndex = station ? Math.max(0, CAFE_SHIFT_STATIONS.findIndex(value => value.id === station.id)) : CAFE_SHIFT_STATIONS.length;
    const key = `${station?.id}:${cafeRuntimeView.status}:${Math.round(cafeRuntimeView.taskProgress * 1000)}:` +
      `${cafeRuntimeView.lastStationResultSerial}:${cafeRuntimeView.transactionSerial}:${cafeQuality}:${cafeReworkCount}`;
    if (key === cafeActivityCacheKey && cafeActivityCache) return cafeActivityCache;
    cafeActivityCacheKey = key;
    cafeActivityCache = Object.freeze({
      id: COMMON_GROUND_SHIFT_ROLE.id,
      kind: "cafe",
      title: COMMON_GROUND_SHIFT_ROLE.name,
      status: active ? "active" : "completed",
      stage: working ? "working" : station?.id ?? "complete",
      objective: active
        ? working
          ? `${station.name}  ${Math.round(cafeRuntimeView.taskProgress * 100)}%`
          : station.instruction
        : "SHIFT FILED — THE NEXT CREW INHERITS AN HONEST HANDOVER",
      targetKind: "interaction",
      targetPosition: active && worldStation ? worldStation.position : null,
      stationId: station?.id ?? null,
      actionId: station?.actionId ?? null,
      taskProgress: cafeRuntimeView.taskProgress,
      taskIndex,
      taskCount: CAFE_SHIFT_STATIONS.length,
      estimatedWage: COMMON_GROUND_SHIFT_ROLE.baseWage,
      quality: cafeQuality,
      reworkCount: cafeReworkCount,
      safetyRequired: Boolean(station?.safetyRequired),
      primarySkill: station?.primarySkill ?? null,
      paused: cafeRuntimeView.status === "paused",
    });
    return cafeActivityCache;
  }

  const marketStationById = new Map(MINA_MARKET_STATIONS.map(station => [station.id, station]));
  const marketWorldStationById = new Map(Object.values(minaMarketWorld.stations).map(station => [station.id, station]));
  const marketWorldStationPositions = new Map([...marketWorldStationById].map(([id, station]) => [
    id,
    vectorFrom(station.position),
  ]));
  const marketHandoverPosition = marketWorldStationPositions.get("mina-order-counter");

  function marketClockContext(detail = {}) {
    const environmentState = environment.snapshot();
    return {
      dayIndex: neighbourhoodRoutine.snapshot().dayIndex,
      timeHours: environmentState.timeHours,
      minuteOfDay: Math.trunc(environmentState.timeHours * 60) % 1440,
      ...detail,
    };
  }

  function insideMinaMarket(positionValue = controlledPosition()) {
    const position = positionValue?.isVector3 ? positionValue : positionValue?.position ?? positionValue ?? {};
    const x = Array.isArray(position) ? Number(position[0]) : Number(position.x);
    const z = Array.isArray(position) ? Number(position[2]) : Number(position.z);
    const bounds = minaMarketWorld.bounds;
    return x >= bounds.minX - 0.15 && x <= bounds.maxX + 0.15 &&
      z >= bounds.minZ - 0.15 && z <= bounds.maxZ + 0.15;
  }

  function marketWorldStation(logicalStationValue) {
    const logical = typeof logicalStationValue === "string"
      ? marketStationById.get(logicalStationValue)
      : logicalStationValue;
    if (!logical) return null;
    const stationIds = [logical.worldStationId ?? logical.id, ...(logical.alternateWorldStationIds ?? [])];
    return stationIds.map(id => marketWorldStationById.get(id)).find(Boolean) ?? null;
  }

  let marketActivityCacheKey = "";
  let marketActivityCache = null;
  let marketQuality = 0;
  let marketReworkCount = 0;
  let marketDecisionIndex = 1;
  function marketActivitySnapshot() {
    const decisionRequired = Boolean(marketRuntimeView.decisionRequired);
    const logicalStation = decisionRequired
      ? marketStationById.get("mina-pantry-shelf")
      : marketStationById.get(marketRuntimeView.stationId);
    const worldStation = marketWorldStation(logicalStation);
    const active = Boolean(logicalStation && ["active", "paused"].includes(marketRuntimeView.status));
    const working = active && marketRuntimeView.taskActive;
    const taskIndex = logicalStation
      ? Math.max(0, MINA_MARKET_STATIONS.findIndex(value => value.id === logicalStation.id))
      : MINA_MARKET_STATIONS.length;
    const key = `${logicalStation?.id}:${marketRuntimeView.status}:${Math.round(marketRuntimeView.taskProgress * 1000)}:` +
      `${marketRuntimeView.stationResultSerial}:${marketRuntimeView.transactionSerial}:${marketQuality}:` +
      `${marketReworkCount}:${decisionRequired}`;
    if (key === marketActivityCacheKey && marketActivityCache) return marketActivityCache;
    marketActivityCacheKey = key;
    marketActivityCache = Object.freeze({
      id: MINA_MARKET_SHIFT_ROLE.id,
      kind: "market",
      title: MINA_MARKET_SHIFT_ROLE.name,
      status: active ? "active" : "completed",
      stage: decisionRequired ? "surplus-decision" : working ? "working" : logicalStation?.id ?? "complete",
      objective: active
        ? decisionRequired
          ? "DECIDE WHAT HAPPENS TO SAFE SURPLUS: MARK DOWN, DONATE, OR DISCARD"
          : working
            ? `${logicalStation.name}  ${Math.round(marketRuntimeView.taskProgress * 100)}%`
            : logicalStation.instruction
        : "SHIFT FILED — STOCK, TILL, CLEANING, AND SURPLUS RECORDS AGREE",
      targetKind: "interaction",
      targetPosition: active && worldStation ? worldStation.position : null,
      stationId: logicalStation?.id ?? null,
      worldStationId: worldStation?.id ?? null,
      actionId: logicalStation?.actionId ?? null,
      taskProgress: marketRuntimeView.taskProgress,
      taskIndex,
      taskCount: MINA_MARKET_STATIONS.length,
      estimatedWage: MINA_MARKET_SHIFT_ROLE.baseWage,
      quality: marketQuality,
      reworkCount: marketReworkCount,
      decisionRequired,
      surplusChoices: decisionRequired ? MARKET_SURPLUS_DECISIONS : Object.freeze([]),
      safetyRequired: Boolean(logicalStation?.safetyRequired),
      primarySkill: logicalStation?.primarySkill ?? null,
      paused: marketRuntimeView.status === "paused",
    });
    return marketActivityCache;
  }

  const communityRoleById = new Map(COMMUNITY_HUB_ROLES.map(role => [role.id, role]));
  const communityStationById = new Map(communityHubLife.stations.map(station => [station.id, station]));
  const communityWorldStationPositions = new Map(Object.entries(communityHubWorld.stations).map(([key, station]) => [
    key,
    new THREE.Vector3(...station.position),
  ]));
  const communityReceptionPosition = communityWorldStationPositions.get("reception");

  function communityClockContext(detail = {}) {
    const environmentState = environment.snapshot();
    return {
      dayIndex: neighbourhoodRoutine.snapshot().dayIndex,
      timeHours: environmentState.timeHours,
      ...detail,
    };
  }

  function insideCommunityHub(positionValue = controlledPosition()) {
    const position = positionValue?.isVector3 ? positionValue : positionValue?.position ?? positionValue ?? {};
    const x = Array.isArray(position) ? Number(position[0]) : Number(position.x);
    const z = Array.isArray(position) ? Number(position[2]) : Number(position.z);
    const bounds = communityHubWorld.bounds;
    return x >= bounds.minX - 0.15 && x <= bounds.maxX + 0.15 &&
      z >= bounds.minZ - 0.15 && z <= bounds.maxZ + 0.15;
  }

  function communityWorldStation(logicalStationId) {
    const definition = communityStationById.get(String(logicalStationId ?? ""));
    return definition ? communityHubWorld.stations?.[definition.worldStationId] ?? null : null;
  }

  function communityWorldStationPosition(logicalStationId) {
    const definition = communityStationById.get(String(logicalStationId ?? ""));
    return definition ? communityWorldStationPositions.get(definition.worldStationId) ?? null : null;
  }

  let communityActivityCacheKey = "";
  let communityActivityCache = null;
  function communityActivitySnapshot() {
    const role = communityRoleById.get(communityRuntimeView.activeRoleId) ?? null;
    const station = communityStationById.get(communityRuntimeView.stationId) ?? null;
    const worldStation = communityWorldStation(station?.id);
    const active = Boolean(role && ["active", "paused"].includes(communityRuntimeView.status));
    const working = active && communityRuntimeView.taskProgress > 0;
    const taskIndex = role && station ? Math.max(0, role.stationIds.indexOf(station.id)) : 0;
    const taskCount = role?.stationIds.length ?? 0;
    const key = `${role?.id}:${station?.id}:${communityRuntimeView.status}:${communityRuntimeView.taskProgress}:` +
      `${communityRuntimeView.lastStationResultSerial}:${communityRuntimeView.transactionSerial}`;
    if (key === communityActivityCacheKey && communityActivityCache) return communityActivityCache;
    communityActivityCacheKey = key;
    communityActivityCache = Object.freeze({
      id: role?.id ?? "harbour-skills-house",
      kind: "community",
      title: role?.name ?? "HARBOUR SKILLS HOUSE",
      status: active ? "active" : "completed",
      stage: working ? "working" : station?.id ?? "complete",
      objective: active
        ? working
          ? `${station.name}  ${Math.round(communityRuntimeView.taskProgress * 100)}%`
          : station.instruction
        : "SHIFT FILED — THE HOUSE REMAINS OPEN TO THE NEIGHBOURHOOD",
      targetKind: "interaction",
      targetPosition: active && worldStation ? worldStation.position : null,
      roleId: role?.id ?? null,
      stationId: station?.id ?? null,
      worldStationId: station?.worldStationId ?? null,
      taskProgress: communityRuntimeView.taskProgress,
      taskIndex,
      taskCount,
      estimatedWage: role?.baseWage ?? 0,
      safetyRequired: Boolean(station?.safetyRequired),
      primarySkill: station?.primarySkill ?? null,
      paused: communityRuntimeView.status === "paused",
    });
    return communityActivityCache;
  }

  let communityFullSnapshotCache = communityHubLife.snapshot();
  let communityFullSnapshotCacheKey = "";
  let communityDirectoryCache = null;
  let communityDirectoryCacheKey = "";
  function communityDirectorySnapshot() {
    const clock = communityClockContext();
    const key = `${clock.dayIndex}:${Math.trunc(clock.timeHours * 60)}:${communityRuntimeView.commandSerial}:` +
      `${communityRuntimeView.transactionSerial}:${communityRuntimeView.status}`;
    if (key !== communityDirectoryCacheKey) {
      communityDirectoryCacheKey = key;
      communityDirectoryCache = communityHubLife.context(clock);
    }
    return communityDirectoryCache;
  }
  function communityPresentationSnapshot() {
    const key = `${communityRuntimeView.commandSerial}:${communityRuntimeView.lastStationResultSerial}:` +
      `${communityRuntimeView.transactionSerial}:${communityRuntimeView.activeRoleId}:${communityRuntimeView.stationId}:` +
      `${communityRuntimeView.status}:${communityRuntimeView.dayIndex}:${communityRuntimeView.minuteOfDay}`;
    if (key !== communityFullSnapshotCacheKey) {
      communityFullSnapshotCacheKey = key;
      communityFullSnapshotCache = communityHubLife.snapshot();
    }
    const cachedShift = communityFullSnapshotCache.activeShift;
    const activeShift = cachedShift ? Object.freeze({
      ...cachedShift,
      task: cachedShift.task ? Object.freeze({
        ...cachedShift.task,
        elapsedSeconds: cachedShift.task.durationSeconds * communityRuntimeView.taskProgress,
        progress: communityRuntimeView.taskProgress,
      }) : null,
    }) : null;
    return Object.freeze({
      ...communityFullSnapshotCache,
      clock: Object.freeze({ dayIndex: communityRuntimeView.dayIndex, minuteOfDay: communityRuntimeView.minuteOfDay }),
      activeShift,
      runtime: Object.freeze({ ...communityRuntimeView }),
      activity: selectedActivity === "community" ? communityActivitySnapshot() : null,
      appliedStationResultSerial: lastCommunityStationResultSerial,
      appliedTransactionSerial: lastCommunityTransactionSerial,
    });
  }

  function selectedActivitySnapshot() {
    if (selectedActivity === "community") return communityActivitySnapshot();
    if (selectedActivity === "cafe") return cafeActivitySnapshot();
    if (selectedActivity === "market") return marketActivitySnapshot();
    return selectedActivitySystem()?.snapshot() ?? null;
  }

  function chapterTwoUnlocked() {
    const chapterOne = story.snapshot();
    return chapterOne.chapterCompleted && (chapterOne.choiceResult === "publish" || chapterOne.choiceResult === "protect");
  }

  function chapterTwoMissionActive() {
    const state = chapterTwo.snapshot();
    return state.chapterStarted && (!state.chapterCompleted || state.active);
  }

  function narrativePresentation() {
    const nightRouteState = nightRoute.snapshot();
    if (selectedActivity === "nightRoute" && nightRouteState.controlsLocked) {
      if (cachedNightRouteNarrativeSource !== nightRouteState) {
        const duration = nightRouteState.lineElapsed + nightRouteState.dialogue.remaining;
        const establishing = nightRouteState.lineIndex === 0 &&
          NIGHT_ROUTE_GROUP_SEQUENCES.has(nightRouteState.activeSequenceId);
        const cameraShot = establishing ? "night_diner_group" :
          nightRouteState.dialogue.speaker === NIGHT_ROUTE_CHARACTERS.kai.name
            ? "night_diner_kai"
            : "night_diner_speaker";
        cachedNightRouteNarrativeSource = nightRouteState;
        cachedNightRouteNarrative = Object.freeze({
          ...nightRouteState,
          active: true,
          cinematic: true,
          titleCard: nightRouteState.activeSequenceId === "briefing" && nightRouteState.lineIndex === 0
            ? "THE NIGHT COUNT"
            : null,
          choice: nightRouteState.choice ? Object.freeze({
            ...nightRouteState.choice,
            cameraShot: "night_diner_choice",
          }) : null,
          line: nightRouteState.dialogue.active ? Object.freeze({
            speaker: nightRouteState.dialogue.speaker,
            role: nightRouteState.dialogue.role,
            text: nightRouteState.dialogue.text,
            tone: "grounded",
            radio: false,
            shot: cameraShot,
            progress: duration > 0 ? clamp(nightRouteState.lineElapsed / duration, 0, 1) : 0,
          }) : null,
        });
      }
      return cachedNightRouteNarrative;
    }
    const chapterOne = story.snapshot();
    const second = chapterTwo.snapshot();
    return second.chapterStarted ? second : chapterOne;
  }

  function activeNarrativeSystem() {
    if (selectedActivity === "nightRoute" && nightRoute.snapshot().controlsLocked) return nightRoute;
    return chapterTwo.snapshot().chapterStarted ? chapterTwo : story;
  }

  function narrativeMissionBusy() {
    return theftMissionBusy() || chapterTwoMissionActive();
  }

  function lifeUnlockContext() {
    const chapterOne = story.snapshot();
    const second = chapterTwo.snapshot();
    return {
      choiceResult: chapterOne.choiceResult,
      chapterOneChoice: chapterOne.choiceResult,
      chapterTwoChoice: second.choiceResult,
      chapterTwoCompleted: second.chapterCompleted,
    };
  }

  function nightRouteUnlockContext() {
    return {
      life: lifeActivity.snapshot(),
      taxi: taxiActivity.snapshot(),
      neighbourhoodSave: neighbourhoodRoutine.save(),
    };
  }

  function neighbourhoodContext(detail = {}) {
    const environmentState = environment.snapshot();
    return {
      timeHours: environmentState.timeHours,
      weather: environmentState.weather,
      story: story.snapshot(),
      chapterTwo: chapterTwo.snapshot(),
      chapterTwoChoice: chapterTwo.snapshot().choiceResult,
      position: controlledPosition(),
      inVehicle: Boolean(vehicles?.playerVehicle),
      paused,
      ...detail,
    };
  }

  function explainBusinessRejection(result, fallback = "SHOP UNAVAILABLE") {
    const reason = String(result?.reason ?? "");
    if (reason === "insufficient_cash") return "NOT ENOUGH CASH — COME BACK WHEN IT WILL NOT HURT THE RENT";
    if (reason === "carrying_capacity") return "YOUR SHOPPING TOTE IS FULL — TAKE IT HOME AND UNPACK IT FIRST";
    if (reason === "no_supplies") return "THERE IS NOTHING TO BAG";
    if (reason === "still_consuming") return "FINISH WHAT YOU HAVE — THERE IS NO RUSH";
    if (reason === "closed") return "THE SHUTTERS ARE DOWN — CHECK THE OPENING HOURS";
    if (reason === "on_foot_required") return "PARK FIRST — THE COUNTER IS FOR PEOPLE, NOT CARS";
    if (reason === "too_far") return "STEP UP TO THE COUNTER";
    return fallback;
  }

  function applyNeighbourhoodTransaction(result) {
    if (!result?.accepted) {
      showToast(explainBusinessRejection(result), 2.8);
      return false;
    }
    if (result.serial <= lastNeighbourhoodTransactionSerial) return false;
    if (result.kind === "household_supplies") {
      const sourceId = `neighbourhood:${result.businessId}:${result.serial}`;
      const receipt = residentialLife.receiveSupplies(result.inventoryEffects, { sourceId });
      if (!receipt.accepted) {
        showToast(explainBusinessRejection(receipt, "THE GROCERIES COULD NOT BE BAGGED"), 3.0);
        return false;
      }
      lastNeighbourhoodTransactionSerial = result.serial;
      player.addCash(-result.cost);
      invalidateResidentialView();
      player.setCarriedGroceries(receipt.carriedGroceries);
      gameAudio.play("pickup", 0.32);
      showToast(`GROCERIES BAGGED — ${receipt.groceriesReceived} UNITS / TAKE THEM HOME`, 3.4);
      return true;
    }
    lastNeighbourhoodTransactionSerial = result.serial;
    player.addCash(-result.cost);
    player.heal(result.heal);
    player.restoreStamina(result.stamina);
    gameAudio.play(result.itemId === "pay_a_meal_forward" ? "mission" : "pickup", result.itemId === "pay_a_meal_forward" ? 0.36 : 0.28);
    showToast(result.itemId === "pay_a_meal_forward"
      ? "MEAL PAID FORWARD — NO NAME, NO DEBT ATTACHED"
      : `${result.itemId.replaceAll("_", " ").toUpperCase()}  -$${result.cost}`, 2.8);
    return true;
  }

  function buySelectedNeighbourhoodItem() {
    const menu = neighbourhoodRoutine.snapshot();
    const selected = menu.menuItems?.[Math.max(0, Math.trunc(menu.selectionIndex))] ?? null;
    if (selected?.kind === "household_supplies" || selected?.inventoryEffects) {
      const quote = residentialLife.quoteSupplyReceipt(selected.inventoryEffects);
      if (!quote.accepted) {
        showToast(explainBusinessRejection(quote, "THE GROCERIES WILL NOT FIT IN YOUR TOTE"), 3.0);
        return quote;
      }
    }
    const result = neighbourhoodRoutine.purchase({
      ...neighbourhoodContext(),
      cash: player.snapshot().cash,
    });
    applyNeighbourhoodTransaction(result);
    return result;
  }

  function residentialClockContext(detail = {}) {
    const environmentState = environment.snapshot();
    return {
      dayIndex: residentialRuntimeView.dayIndex,
      timeHours: environmentState.timeHours,
      ...detail,
    };
  }

  function insideResidentialHome(position = controlledPosition()) {
    if (vehicles?.playerVehicle || !position) return false;
    const bounds = residentialInterior.bounds;
    return position.x >= bounds.minX - 0.2 && position.x <= bounds.maxX + 0.2 &&
      position.z >= bounds.minZ - 0.2 && position.z <= bounds.maxZ + 0.2;
  }

  function nearbyResidentialStation(position = controlledPosition(), radius = 2.35) {
    if (!insideResidentialHome(position)) return null;
    let nearest = null;
    let nearestSquared = radius * radius;
    for (const station of Object.values(residentialInterior.stations)) {
      if (!["sleep", "shower", "cook", "eat", "clean", "study", "relax"].includes(station.action)) continue;
      const target = vectorFrom(station.position);
      const squared = position.distanceToSquared(target);
      if (squared > nearestSquared) continue;
      nearest = station;
      nearestSquared = squared;
    }
    return nearest;
  }

  function residentialFullSnapshot() {
    const key = `${residentialRuntimeView.dayIndex}:${Number(residentialRuntimeView.visitorActive)}:${residentialRuntimeView.visitorResidentId ?? ""}:${Number(residentialRuntimeView.rentDue)}:${residentialRevision}`;
    if (key !== residentialFullSnapshotCacheKey || !residentialFullSnapshotCache) {
      residentialFullSnapshotCache = residentialLife.snapshot();
      residentialFullSnapshotCacheKey = key;
    }
    return residentialFullSnapshotCache;
  }

  function invalidateResidentialView() {
    residentialRevision += 1;
    residentialFullSnapshotCache = null;
    residentialFullSnapshotCacheKey = "";
  }

  function explainResidentialRejection(result, fallback = "HOME ACTION UNAVAILABLE") {
    const reason = String(result?.reason ?? "");
    if (reason === "insufficient_cash") return `NOT ENOUGH CASH — $${Math.max(0, Math.trunc(result?.cost ?? result?.amount ?? 0))} REQUIRED`;
    if (reason === "groceries_required") return "THE PANTRY IS EMPTY — BUY GROCERIES AT MINA'S MARKET AND BRING THEM HOME";
    if (reason === "prepared_meal_required") return "COOK FIRST — THERE IS NO PREPARED MEAL";
    if (reason === "fixture_needs_repair") return "THIS FIXTURE NEEDS REPAIR BEFORE IT IS SAFE";
    if (reason === "inside_home_required" || reason === "current_home_required" || reason === "home_required") return "YOU NEED TO BE INSIDE YOUR CURRENT HOME";
    if (reason === "on_foot_required") return "PARK OUTSIDE BEFORE USING THE FLAT";
    if (reason === "busy") return "FINISH WHAT YOU ARE DOING FIRST";
    if (reason === "nothing_due") return "RENT IS UP TO DATE";
    if (reason === "already_owned") return "THIS HOME IS ALREADY YOURS";
    if (reason === "pantry_full") return "THE PANTRY IS ALREADY STOCKED";
    if (reason === "no_carried_groceries") return "YOUR SHOPPING TOTE IS EMPTY — BUY GROCERIES AT MINA'S MARKET";
    if (reason === "carrying_capacity") return "THE SHOPPING TOTE IS FULL — UNPACK IT AT HOME";
    if (reason === "duplicate_source") return "THOSE SUPPLIES HAVE ALREADY BEEN PUT AWAY";
    if (reason.startsWith("resident_")) return "THEY ARE NOT FREE TO VISIT RIGHT NOW";
    return fallback;
  }

  function applyResidentialTransaction(result, { advanceClock = true, toastLabel = null } = {}) {
    if (!result?.accepted) {
      showToast(explainResidentialRejection(result), 2.8);
      return false;
    }
    if (result.serial <= lastResidentialTransactionSerial) return false;
    lastResidentialTransactionSerial = result.serial;
    player.addCash(-Math.max(0, Number(result.cost) || 0));
    if (result.effects) {
      const needResult = lifeProfile.applyNeedEffects({
        energy: Number(result.effects.energy) || 0,
        hygiene: Number(result.effects.hygiene) || 0,
      });
      neighbourhoodRoutine.applyAppetiteEffect(Number(result.effects.appetite) || 0);
      if (needResult.energy > 0) player.restoreStamina(needResult.energy * 0.72);
      for (const award of result.effects.skills ?? []) {
        lifeProfile.awardExperience(award.skillId, award.experience, {
          sourceId: `residential:${result.serial}:${award.skillId}`,
        });
      }
    }
    if (advanceClock && Number(result.gameMinutes) > 0) {
      const before = environment.snapshot().timeHours;
      const totalHours = before + Number(result.gameMinutes) / 60;
      const dayAdvance = Math.max(0, Math.floor(totalHours / 24));
      environment.setTime(totalHours);
      residentialRuntimeView = residentialLife.update(0, {
        dayIndex: residentialRuntimeView.dayIndex + dayAdvance,
        timeHours: totalHours,
        captureSnapshot: false,
      });
    }
    invalidateResidentialView();
    syncResidentialActors(true);
    const label = toastLabel ?? String(result.actionId ?? result.kind ?? "HOME UPDATED").replaceAll("_", " ").toUpperCase();
    const money = Number(result.cost) > 0 ? `  -$${Math.trunc(result.cost)}` : "";
    showToast(`${label}${money}`, 3.2);
    gameAudio.play(Number(result.gameMinutes) >= 60 ? "mission" : "pickup", 0.28);
    return true;
  }

  function performResidentialActivity(actionId, { force = false } = {}) {
    const station = Object.values(residentialInterior.stations).find(value => value.action === actionId) ?? null;
    if (!station) return { accepted: false, reason: "station_missing", actionId };
    const atHome = force || insideResidentialHome();
    if (!force && nearbyResidentialStation()?.action !== actionId) {
      const result = { accepted: false, reason: "current_home_required", actionId };
      showToast(explainResidentialRejection(result), 2.6);
      return result;
    }
    if (!force && wanted.snapshot().stars > 0) {
      const result = { accepted: false, reason: "busy", actionId };
      showToast("LOSE THE POLICE BEFORE SETTLING IN AT HOME", 2.8);
      return result;
    }
    const needs = lifeProfile.snapshot().needs;
    const appetite = neighbourhoodRoutine.snapshot().appetite;
    const studySkill = lifeProfile.snapshot().skills.reduce((selected, skill) =>
      !selected || skill.experience < selected.experience ? skill : selected, null)?.id ?? "community";
    const result = residentialLife.performHomeActivity(actionId, residentialClockContext({
      atHome,
      homeId: residentialInterior.homeId,
      inVehicle: Boolean(vehicles?.playerVehicle),
      busy: narrativeMissionBusy() || Boolean(selectedActivitySnapshot()?.status === "active"),
      cash: player.cash,
      needs: { energy: needs.energy, hygiene: needs.hygiene, appetite },
      skillId: studySkill,
    }));
    applyResidentialTransaction(result, { toastLabel: station.label });
    return result;
  }

  function carriedGroceryUnits() {
    return Math.max(0, Math.trunc(Number(residentialFullSnapshot().player?.carriedSupplies?.groceries) || 0));
  }

  function atHomeUnpackPoint(position = controlledPosition(), radius = 2.75) {
    if (!insideResidentialHome(position)) return false;
    const station = residentialInterior.stations?.stove;
    return Boolean(station && position.distanceToSquared(vectorFrom(station.position)) <= radius * radius);
  }

  function unpackResidentialSupplies({ force = false, sourceId = null } = {}) {
    const result = residentialLife.unpackSupplies(residentialClockContext({
      atHome: force || insideResidentialHome(),
      homeId: residentialInterior.homeId,
      inVehicle: Boolean(vehicles?.playerVehicle),
      ...(sourceId == null ? {} : { sourceId }),
    }));
    const accepted = applyResidentialTransaction(result, {
      advanceClock: false,
      toastLabel: result?.groceriesAdded > 0 ? `PANTRY +${result.groceriesAdded}` : "GROCERIES UNPACKED",
    });
    if (accepted) player.setCarriedGroceries(result.carriedGroceries);
    return result;
  }

  function homePhoneItems() {
    const state = residentialFullSnapshot();
    const home = state.homes.find(value => value.id === state.player.currentHomeId) ?? null;
    if (!home) return [{ id: "no_home", title: "NO CURRENT HOME", detail: "VISIT AN AVAILABLE PROPERTY" }];
    const purchaseCost = Math.max(0, home.market.purchasePrice - state.player.depositHeld);
    const carried = Math.max(0, Math.trunc(Number(state.player.carriedSupplies?.groceries) || 0));
    return [
      { id: "address", title: home.name, detail: home.address },
      { id: "tenure", title: state.player.tenure === "owned" ? "OWNED HOME" : "RENTED HOME", detail: state.player.tenure === "owned" ? "NO RENT DUE" : `DEPOSIT HELD  $${state.player.depositHeld}` },
      { id: "rent", title: state.player.outstandingRent > 0 ? `PAY RENT  $${state.player.outstandingRent}` : "RENT UP TO DATE", detail: state.player.tenure === "rented" ? `NEXT DUE  DAY ${state.player.nextRentDueDay}` : "THE TITLE IS IN KAI'S NAME", action: state.player.outstandingRent > 0 ? "pay_rent" : null },
      {
        id: "pantry",
        title: `PANTRY  ${home.groceries}/12  /  TOTE ${carried}/10`,
        detail: carried > 0
          ? `${home.preparedMeals} PREPARED MEALS  /  UNPACK INSIDE YOUR HOME`
          : `${home.preparedMeals} PREPARED MEALS  /  BUY A BAG AT MINA'S MARKET`,
        action: carried > 0 ? "unpack" : null,
      },
      { id: "condition", title: `HOME CONDITION  ${Math.round(home.condition)}%`, detail: `CLEANLINESS  ${Math.round(home.cleanliness)}%  /  ${home.roomCount} ROOMS` },
      state.player.tenure === "rented"
        ? { id: "purchase", title: `BUY THIS HOME  $${purchaseCost.toLocaleString("en-US")}`, detail: "YOUR HELD DEPOSIT COUNTS TOWARD THE PRICE", action: "purchase" }
        : { id: "household", title: "HOUSEHOLD", detail: state.visitor ? `${state.visitor.residentName} IS VISITING` : "NO VISITOR RIGHT NOW" },
    ];
  }

  function activateHomePhoneItem(index) {
    const item = homePhoneItems()[Math.max(0, Math.trunc(index))];
    if (!item?.action) {
      showToast(item?.detail ?? "HOME DETAILS", 2.2);
      return null;
    }
    let result = null;
    if (item.action === "pay_rent") {
      result = residentialLife.payRent(residentialClockContext({ cash: player.cash }));
    } else if (item.action === "unpack") {
      return unpackResidentialSupplies();
    } else if (item.action === "purchase") {
      const progressionTier = Math.max(0, ...lifeProfile.snapshot().skills.map(skill => skill.level - 1));
      result = residentialLife.acquireHome(residentialInterior.homeId, residentialClockContext({
        mode: "buy",
        cash: player.cash,
        progressionTier,
      }));
    }
    if (result) applyResidentialTransaction(result, {
      advanceClock: false,
      toastLabel: item.action === "pay_rent" ? "RENT PAID" : "HOME PURCHASED",
    });
    return result;
  }

  function openNeighbourhoodBusiness(businessId) {
    const result = neighbourhoodRoutine.openMenu(businessId, neighbourhoodContext());
    if (!result?.menuOpen) {
      showToast(explainBusinessRejection(result), 2.8);
      return result;
    }
    let keeper = shopkeeperActors.get(result.businessId);
    if (result.businessId === "common_ground_cafe" && !insideCommonGroundCafe(keeper?.root?.position)) {
      const onDuty = cafeStaffStates.find(state => state.locationId === commonGroundCafeWorld.id);
      keeper = cafeStaffActors.get(onDuty?.id) ?? keeper;
    }
    if (result.businessId === "mina_market_kitchen" && !insideMinaMarket(keeper?.root?.position)) {
      const onDuty = marketStaffStates.find(state => state.locationId === minaMarketWorld.id);
      keeper = marketStaffActors.get(onDuty?.id) ?? keeper;
    }
    if (keeper?.root?.position) {
      const dx = player.root.position.x - keeper.root.position.x;
      const dz = player.root.position.z - keeper.root.position.z;
      keeper.root.rotation.y = Math.atan2(-dx, -dz);
      player.root.rotation.y = Math.atan2(dx, dz);
    }
    gameAudio.play("pickup", 0.18);
    return result;
  }

  function nearbyNeighbourhoodBusiness(position, radius = 5.5) {
    const business = neighbourhoodRoutine.nearby(position, radius, neighbourhoodContext());
    if (business?.id === "common_ground_cafe") {
      const orderPoint = vectorFrom(commonGroundCafeWorld.customerAnchors.queue[0]);
      return vectorFrom(position).distanceToSquared(orderPoint) <= 3.5 * 3.5 ? business : null;
    }
    if (business?.id === "mina_market_kitchen") {
      if (!insideMinaMarket(position)) return null;
      const point = vectorFrom(position);
      const orderPoint = vectorFrom(minaMarketWorld.stations.orderCounter.position);
      const checkoutPoint = vectorFrom(minaMarketWorld.stations.groceryCheckout.position);
      return Math.min(point.distanceToSquared(orderPoint), point.distanceToSquared(checkoutPoint)) <= 3.65 * 3.65
        ? business
        : null;
    }
    return business;
  }

  function theftMissionBusy() {
    const stage = mission?.snapshot?.().stage;
    return stage === MISSION_STAGES.STEAL || stage === MISSION_STAGES.ESCAPE || stage === MISSION_STAGES.DELIVER;
  }

  function commitCrime(event = {}) {
    const type = String(event.type ?? event.kind ?? "crime");
    const previous = crimeTimes.get(type) ?? -Infinity;
    const minimumGap = type === "gunfire" ? 0.72 : type.includes("assault") ? 0.24 : 0.1;
    if (elapsed - previous < minimumGap) return wanted.snapshot();
    crimeTimes.set(type, elapsed);
    const heat = Math.max(0, Number(event.heat ?? event.amount) || 0);
    const state = wanted.add(heat, type.replaceAll("_", " "));
    population?.alert(controlledPosition(), type);
    if (heat >= 20) showToast(type.includes("police") ? "POLICE ASSAULT REPORTED" : "CRIME WITNESSED", 2.2);
    return state;
  }

  player = createPlayer({
    scene,
    world,
    input,
    position: vectorFrom(world.spawnPoints.player),
    onShoot: request => fireWeapon(request),
    onMelee: request => performMelee(request),
    onCrime: commitCrime,
    onSound: (name, volume) => name === "footstep" || name === "melee"
      ? gameAudio.playAt(name, volume, player.root.position)
      : gameAudio.play(name, volume),
  });
  player.setCarriedGroceries(residentialLife.snapshot().player.carriedSupplies.groceries);
  const chaseCamera = createChaseCamera(camera, input, world);
  const cinematicDirector = createCinematicDirector(camera);

  function cameraShakeAt(sourcePosition, amplitude, duration, maximumDistance = 90) {
    const source = sourcePosition?.position ?? sourcePosition;
    if (!source) return 0;
    const listener = controlledPosition();
    const distance = Math.hypot(
      (Number(source.x) || 0) - listener.x,
      (Number(source.y) || 0) - listener.y,
      (Number(source.z) || 0) - listener.z,
    );
    const gain = clamp(1 - distance / Math.max(1, maximumDistance), 0, 1) ** 1.65;
    if (gain < 0.012) return 0;
    chaseCamera.shake(amplitude * gain, duration * (0.72 + gain * 0.28));
    return gain;
  }

  function playerGroundHeight(x, z, currentY = 0) {
    let height = Number(world.terrainHeight?.(x, z) ?? 0) || 0;
    height = desertOutskirts.supportHeightAt(x, z, currentY, height);
    for (const vehicle of vehicles?.vehicles ?? []) {
      if (vehicle === vehicles.playerVehicle) continue;
      const dx = x - vehicle.root.position.x;
      const dz = z - vehicle.root.position.z;
      const cosine = Math.cos(vehicle.state.yaw);
      const sine = Math.sin(vehicle.state.yaw);
      const localX = dx * cosine - dz * sine;
      const localZ = dx * sine + dz * cosine;
      if (Math.abs(localX) > vehicle.width * 0.5 || Math.abs(localZ) > vehicle.length * 0.5) continue;
      const roof = vehicle.root.position.y + vehicle.height;
      if (currentY >= roof - 0.72) height = Math.max(height, roof);
    }
    return height;
  }

  function constrainPlayerAgainstVehicleBoxes(position, radius = 0.43) {
    for (const vehicle of vehicles?.vehicles ?? []) {
      if (vehicle === vehicles.playerVehicle) continue;
      const roof = vehicle.root.position.y + vehicle.height;
      if (position.y >= roof - 0.72) continue;
      const dx = position.x - vehicle.root.position.x;
      const dz = position.z - vehicle.root.position.z;
      const cosine = Math.cos(vehicle.state.yaw);
      const sine = Math.sin(vehicle.state.yaw);
      let localX = dx * cosine - dz * sine;
      let localZ = dx * sine + dz * cosine;
      const halfWidth = vehicle.width * 0.5 + radius;
      const halfLength = vehicle.length * 0.5 + radius;
      if (Math.abs(localX) >= halfWidth || Math.abs(localZ) >= halfLength) continue;
      const pushX = halfWidth - Math.abs(localX);
      const pushZ = halfLength - Math.abs(localZ);
      if (pushX < pushZ) localX = (localX < 0 ? -1 : 1) * halfWidth;
      else localZ = (localZ < 0 ? -1 : 1) * halfLength;
      position.x = vehicle.root.position.x + localX * cosine + localZ * sine;
      position.z = vehicle.root.position.z - localX * sine + localZ * cosine;
    }
  }

  const vehicleWorld = {
    ...world,
    bounds: world.traversableBounds,
    roadRoutes: world.routes,
    spawnPoints: {
      vehicles: world.spawnPoints.vehicles.map(value => ({ ...value, yaw: value.heading, parked: true })),
      police: world.spawnPoints.police.map(value => ({ ...value, yaw: value.heading, police: true })),
    },
    surfaceGrip(x, z) {
      const surface = world.sampleGround?.(x, z)?.surfaceId ?? (world.isRoad?.(x, z) ? "road" : "sidewalk");
      const dryGrip = surface === "road" ? 1 : surface === "park" ? 0.48 : 0.61;
      const wetness = environment.snapshot().wetness;
      return Math.max(0.36, dryGrip * (1 - wetness * (surface === "road" ? 0.24 : 0.14)));
    },
  };
  vehicles = createVehicleSystem({
    scene,
    world: vehicleWorld,
    input,
    externalPlayerHeadlights: true,
    onCrime: commitCrime,
    onImpact(detail) {
      const speed = Math.abs(Number(detail.speed) || 0);
      if (speed < 4) return;
      gameAudio.playAt("impact", Math.min(0.8, 0.25 + speed * 0.018),
        detail.position ?? detail.vehicle?.root?.position ?? detail.other?.root?.position);
      cameraShakeAt(detail.position ?? detail.vehicle?.root?.position ?? detail.other?.root?.position,
        Math.min(0.34, 0.035 + speed * 0.009), Math.min(0.62, 0.18 + speed * 0.012), 72);
      if (selectedActivity === "taxi" && (detail.vehicle === vehicles.playerVehicle || detail.other === vehicles.playerVehicle)) {
        taxiActivity.notify({ type: "collision", severity: speed });
      }
      if (detail.vehicle) vehicles.damage(detail.vehicle, Math.max(1, (speed - 3) * 0.7));
      if (detail.other) vehicles.damage(detail.other, Math.max(1, (speed - 3) * 0.42));
      const roadsideTarget = detail.vehicle === vehicles.playerVehicle ? detail.other : detail.vehicle;
      roadsideResponse?.report({ vehicleId: roadsideTarget?.id, impactSpeed: speed });
      if (detail.vehicle === vehicles.playerVehicle && speed > 10) player.damage((speed - 8) * 0.48);
    },
  });
  if (vehicles.targetVehicle) {
    vehicles.teleport(vehicles.targetVehicle.id, targetSpawn.x, targetSpawn.z, Math.PI * 0.5);
    vehicles.targetVehicle.health = vehicles.targetVehicle.maxHealth;
  }

  const mission = createVehicleRecoveryMission({
    id: "marisols_comet",
    title: "HOME AGAIN",
    targetVehicleId: vehicles.targetVehicle?.id,
    reward: 5000,
    startPosition: contactPosition,
    dropoffPosition,
    legalRecovery: true,
    objectives: {
      available: "MEET JUNO AT PULSE GARAGE",
      steal: "RECOVER MARISOL'S COMET FROM THE VOSS IMPOUND",
      escape: "GET CLEAR WITHOUT HURTING ANYONE",
      deliver: "RETURN THE COMET AND AUDIT DRIVE TO PULSE GARAGE",
      complete: "MARISOL'S CAR IS SAFE — EXPLORE, WORK, AND HELP THE CITY",
    },
  });
  population = createPopulationSystem({
    scene,
    world,
    civilianCount: 30,
    policeCount: 7,
    onCrime: commitCrime,
    onPlayerDamage: event => {
      const source = event.source?.root?.position;
      if (source) {
        const origin = source.clone().setY(source.y + 1.42);
        const target = controlledPosition().clone().setY(controlledPosition().y + (player.vehicle ? 0.85 : 1.1));
        effects?.shot(origin, target, { hit: true });
        gameAudio.playAt("gunshot", 0.28, origin);
        gameAudio.playAt("impact", 0.2, target);
        cameraShakeAt(origin, 0.042, 0.15, 70);
      }
      return player.damage(event.amount);
    },
  });
  const minaOkaforHome = Object.freeze({
    id: "mina-okafor-home",
    name: "Okafor flat",
    address: "84 Market Street, Flat 2",
    position: Object.freeze([-103.5, 0.2, 105.5]),
  });
  const namedCharacterHomes = Object.freeze({
    "juno-mercer": Object.freeze({ name: "Mercer apartment", address: "12 Cypress Walk", position: Object.freeze([-103.5, 0.2, 101.5]) }),
    "rin-alvarez": Object.freeze({ name: "Alvarez apartment", address: "8 Lantern Court", position: Object.freeze([101.5, 0.2, 105.5]) }),
    "leah_moreno": Object.freeze({ name: "Moreno flat", address: "31 Marisol Row", position: Object.freeze([-105.5, 0.2, -101.5]) }),
    "mara-velez": Object.freeze({ name: "Velez apartment", address: "6 Cypress Walk", position: Object.freeze([-99.5, 0.2, 107.5]) }),
    "dara-ibarra": Object.freeze({ name: "Ibarra flat", address: "19 Southline Terrace", position: Object.freeze([103.5, 0.2, -105.5]) }),
    [ASHA_PATEL.id]: Object.freeze({ name: "Patel apartment", address: "14 Foundry Court", position: Object.freeze([-101.5, 0.2, 97.5]) }),
    [MINA_OKAFOR.id]: minaOkaforHome,
    "shopkeeper-mina_market_kitchen": minaOkaforHome,
  });
  const junoPosition = contactPosition.clone().add(new THREE.Vector3(2.3, 0, 0.04));
  if (world.isBlockedCircle?.(junoPosition.x, junoPosition.z, 0.36)) junoPosition.copy(contactPosition);
  junoPosition.y = Number(world.terrainHeight?.(junoPosition.x, junoPosition.z) ?? junoPosition.y);
  const junoActor = population.spawn({
    id: "juno-mercer",
    name: "Juno Mercer",
    role: "sister-and-mechanic",
    x: junoPosition.x,
    z: junoPosition.z,
    yaw: Math.PI * 0.5,
    stationary: true,
    protected: true,
  });
  const rinPosition = contactPosition.clone().add(new THREE.Vector3(-2.5, 0, -0.04));
  if (world.isBlockedCircle?.(rinPosition.x, rinPosition.z, 0.36)) rinPosition.copy(contactPosition).add(new THREE.Vector3(-2.2, 0, 0));
  rinPosition.y = Number(world.terrainHeight?.(rinPosition.x, rinPosition.z) ?? rinPosition.y);
  const rinActor = population.spawn({
    id: "rin-alvarez",
    name: "Rin Alvarez",
    role: "friend-and-data-analyst",
    x: rinPosition.x,
    z: rinPosition.z,
    yaw: -Math.PI * 0.46,
    stationary: true,
    protected: true,
  });
  const worldBusinessById = new Map((world.businesses ?? []).map(location => [String(location.id), location]));
  const shopkeeperActors = new Map();
  for (const business of neighbourhoodRoutine.businesses) {
    const location = worldBusinessById.get(business.id);
    const keeperPosition = vectorFrom(location?.keeperPosition ?? [
      business.position[0],
      business.position[1],
      business.position[2] + 1.35,
    ]);
    keeperPosition.y = Number(world.terrainHeight?.(keeperPosition.x, keeperPosition.z) ?? keeperPosition.y);
    const actor = population.spawn({
      id: `shopkeeper-${business.id}`,
      name: business.keeperName,
      role: `shopkeeper-${business.id}`,
      x: keeperPosition.x,
      z: keeperPosition.z,
      yaw: Number(location?.keeperYaw) || Math.PI,
      stationary: business.id !== "common_ground_cafe" && business.id !== "mina_market_kitchen",
      protected: true,
    });
    if (business.id === "common_ground_cafe") {
      actor.root.userData.namedResident = true;
      actor.root.userData.cafeStaff = ASHA_PATEL.id;
      cafeStaffActors.set(ASHA_PATEL.id, actor);
    }
    if (business.id === "mina_market_kitchen") {
      actor.root.userData.namedResident = true;
      actor.root.userData.marketStaff = MINA_OKAFOR.id;
      marketStaffActors.set(MINA_OKAFOR.id, actor);
    }
    shopkeeperActors.set(business.id, actor);
  }
  chapterTwoLeahPosition.y = Number(world.terrainHeight?.(chapterTwoLeahPosition.x, chapterTwoLeahPosition.z) ?? chapterTwoLeahPosition.y);
  const leahActor = population.spawn({
    id: CHAPTER_TWO_AFFECTED_PERSON.id,
    name: "Leah Moreno",
    role: "night-care-driver-and-pulse-customer",
    x: chapterTwoLeahPosition.x,
    z: chapterTwoLeahPosition.z,
    yaw: Math.PI * 0.62,
    stationary: true,
    protected: true,
  });
  chapterTwoRecallCustomerPosition.y = Number(
    world.terrainHeight?.(chapterTwoRecallCustomerPosition.x, chapterTwoRecallCustomerPosition.z) ??
    chapterTwoRecallCustomerPosition.y,
  );
  const maraActor = population.spawn({
    id: "mara-velez",
    name: "Mara Velez",
    role: "grounded-night-bus-driver-and-recall-customer",
    x: chapterTwoRecallCustomerPosition.x,
    z: chapterTwoRecallCustomerPosition.z,
    yaw: -0.68,
    stationary: true,
    protected: false,
  });
  desertOutskirts.bindFriend(maraActor, { returnPosition: namedCharacterHomes["mara-velez"].position });
  const depotClerkPosition = vectorFrom(chapterTwoWorld.keeperWitnessAnchor ?? chapterTwoWorld.witnessAnchor ?? [-183.1, 0.2, -136]);
  depotClerkPosition.y = Number(world.terrainHeight?.(depotClerkPosition.x, depotClerkPosition.z) ?? depotClerkPosition.y);
  const depotClerkActor = population.spawn({
    id: "dara-ibarra",
    name: "Dara Ibarra",
    role: "southline-depot-clerk-and-union-steward",
    x: depotClerkPosition.x,
    z: depotClerkPosition.z,
    yaw: -Math.PI * 0.5,
    stationary: true,
    protected: true,
  });
  const mainCharacters = Object.freeze([
    Object.freeze({ actor: junoActor, label: "JUNO" }),
    Object.freeze({ actor: rinActor, label: "RIN" }),
    Object.freeze({ actor: leahActor, label: "LEAH" }),
    Object.freeze({ actor: maraActor, label: "MARA", existingLabel: true }),
    Object.freeze({ actor: depotClerkActor, label: "DARA" }),
    Object.freeze({ actor: cafeStaffActors.get(ASHA_PATEL.id), label: "ASHA" }),
    Object.freeze({ actor: marketStaffActors.get(MINA_OKAFOR.id), label: "MINA" }),
  ]);
  for (const character of mainCharacters) {
    const home = namedCharacterHomes[character.actor.id];
    character.actor.root.userData.mainCharacter = true;
    character.actor.root.userData.home = home;
    if (!character.existingLabel) createCharacterNameplate(character.actor.root, character.label);
  }

  const residentialHomeById = new Map(residentialLife.homes.map(home => [home.id, home]));
  function nearestResidentialNavigationAnchor(value) {
    const requested = vectorFrom(value);
    let selected = requested;
    let selectedSquared = Infinity;
    for (const candidateValue of world.pedestrianNodes) {
      const candidate = vectorFrom(candidateValue);
      const squared = candidate.distanceToSquared(requested);
      if (squared >= selectedSquared || world.isBlockedCircle?.(candidate.x, candidate.z, 0.38)) continue;
      selected = candidate;
      selectedSquared = squared;
    }
    selected = selected.clone();
    selected.y = Number(world.terrainHeight?.(selected.x, selected.z) ?? selected.y);
    return selected;
  }
  const residentialLocationAnchors = new Map([
    ["southline_studio_3b", vectorFrom(residentialInterior.stations.resident.position)],
    ["amara_home_4d", nearestResidentialNavigationAnchor([-104, 0.2, 101])],
    ["luis_home_2a", nearestResidentialNavigationAnchor([-104, 0.2, -101])],
    ["nia_home_5f", nearestResidentialNavigationAnchor([104, 0.2, 101])],
    ["mercy_clinic", nearestResidentialNavigationAnchor([-96, 0.2, -16.5])],
    ["pulse_garage", vectorFrom(pulseGarageInterior.customerAnchor)],
    ["city_lens_studio", nearestResidentialNavigationAnchor([150, 0.2, 100])],
    ["cypress_night_garden", nearestResidentialNavigationAnchor([-48, 0.2, -48])],
    ["harbour_lantern", nearestResidentialNavigationAnchor([139, 0.2, 28])],
    ["southline_diner", vectorFrom(worldBusinessById.get("southline_diner")?.interactionPosition ?? [101, 0.2, -108])],
    ["harbour_court", vectorFrom(world.missionPoints.harbourCourt.position)],
    ["market_square", vectorFrom(world.northMarket.focus)],
    ["common_ground_cafe", vectorFrom(commonGroundCafeWorld.customerAnchors.seating[0])],
    ["river_walk", nearestResidentialNavigationAnchor([139, 0.2, 76])],
  ]);

  function residentialAnchorFor(state) {
    if (state.activity === "visiting" && state.locationId === residentialInterior.homeId) {
      return vectorFrom(residentialInterior.stations.visitor.position);
    }
    const anchor = residentialLocationAnchors.get(state.locationId);
    if (!anchor) throw new RangeError(`No physical residential anchor for ${state.locationId}`);
    return anchor;
  }

  for (const definition of residentialLife.residents) {
    const state = residentialLife.residentState(definition.id, residentialClockContext());
    const position = residentialAnchorFor(state);
    const actor = population.spawn({
      id: definition.id,
      name: definition.name,
      role: `named-resident-${definition.role.toLowerCase().replaceAll(" ", "-")}`,
      x: position.x,
      z: position.z,
      yaw: 0,
      stationary: false,
      protected: false,
    });
    const home = residentialHomeById.get(definition.homeId);
    actor.root.userData.namedResident = true;
    actor.root.userData.home = home ? Object.freeze({
      id: home.id,
      name: home.name,
      address: home.address,
      position: Object.freeze(residentialLocationAnchors.get(home.id)?.toArray?.() ?? position.toArray()),
    }) : null;
    createCharacterNameplate(actor.root, definition.name.split(" ")[0]);
    residentialActors.set(definition.id, actor);
  }

  function syncResidentialActors(force = false, rebuildRouteIds = null) {
    if (!population) return Object.freeze([]);
    if (force) {
      const environmentState = environment.snapshot();
      residentialRuntimeView = residentialLife.update(0, {
        timeHours: environmentState.timeHours,
        captureSnapshot: false,
      });
    }
    const minute = residentialRuntimeView.dayIndex * 1440 + residentialRuntimeView.minuteOfDay;
    if (!force && minute === lastResidentialScheduleMinute) return residentialActorStates;
    lastResidentialScheduleMinute = minute;
    const states = [];
    for (const definition of residentialLife.residents) {
      const state = residentialLife.residentState(definition.id, {
        dayIndex: residentialRuntimeView.dayIndex,
        minuteOfDay: residentialRuntimeView.minuteOfDay,
      });
      const actor = residentialActors.get(definition.id);
      const anchor = residentialAnchorFor(state);
      const signature = `${state.activity}:${state.locationId}:${anchor.x.toFixed(2)}:${anchor.z.toFixed(2)}`;
      if (actor && actor.alive && (force || residentialActorSignatures.get(definition.id) !== signature)) {
        const request = {
          position: anchor,
          locationId: state.locationId,
          activity: state.activity,
          arrivalRadius: state.activity === "sleep" ? 0.55 : 0.85,
          speedScale: state.activity === "work" ? 1.12 : 1,
          rebuildRoute: rebuildRouteIds instanceof Set && rebuildRouteIds.has(definition.id),
        };
        if (population.setRoutineDestination) population.setRoutineDestination(actor, request);
        else population.pin(actor, { ...request, locked: true, protected: false });
        actor.root.userData.residentialSchedule = Object.freeze({
          activity: state.activity,
          locationId: state.locationId,
          dayIndex: state.dayIndex,
          minuteOfDay: state.minuteOfDay,
        });
        residentialActorSignatures.set(definition.id, signature);
      }
      states.push(Object.freeze({
        id: state.id,
        name: state.name,
        role: state.role,
        homeId: state.homeId,
        address: residentialHomeById.get(state.homeId)?.address ?? "NEON CITY",
        activity: state.activity,
        locationId: state.locationId,
        availableForVisit: state.availableForVisit,
        relationship: state.relationship,
      }));
    }
    residentialActorStates = Object.freeze(states);
    return residentialActorStates;
  }
  syncResidentialActors(true);

  function residentialActorRuntimeSnapshot() {
    return [...residentialActors].map(([residentId, actor]) => ({
      residentId,
      position: actor.root.position.toArray(),
      yaw: actor.root.rotation.y,
      destination: actor.routineDestinationActive
        ? actor.routineDestination.toArray()
        : null,
      locationId: actor.routineLocation ?? null,
      activity: actor.routineActivity ?? null,
      arrived: Boolean(actor.routineDestinationArrived),
    }));
  }

  function restoreResidentialActorRuntime(entries) {
    const movementBounds = world.traversableBounds ?? world.bounds;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.residentId ?? ""), entry]));
    const restoredIds = new Set();
    for (const [residentId, actor] of residentialActors) {
      const entry = byId.get(residentId);
      const x = Number(entry?.position?.[0]);
      const z = Number(entry?.position?.[2]);
      if (!Number.isFinite(x) || !Number.isFinite(z) ||
          x < movementBounds.minX || x > movementBounds.maxX ||
          z < movementBounds.minZ || z > movementBounds.maxZ ||
          // Runtime movement resolves against the actor's real body radius.
          // Requiring extra destination clearance here rejected legitimate
          // collision-resolved mid-route save poses beside walls and kerbs.
          world.isBlockedCircle?.(x, z, actor.radius)) continue;
      actor.root.position.set(x, world.terrainHeight(x, z), z);
      if (Number.isFinite(Number(entry.yaw))) actor.root.rotation.y = Number(entry.yaw);
      actor.velocity.set(0, 0, 0);
      actor.steering.set(0, 0, 0);
      actor.speed = 0;
      restoredIds.add(residentId);
    }
    return restoredIds;
  }

  function restoreResidentialActorArrivalState(entries, restoredIds) {
    if (!(restoredIds instanceof Set) || restoredIds.size === 0) return 0;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.residentId ?? ""), entry]));
    let restored = 0;
    for (const residentId of restoredIds) {
      const entry = byId.get(residentId);
      const actor = residentialActors.get(residentId);
      const destination = entry?.destination;
      if (!actor?.routineDestinationActive || !Array.isArray(destination) || destination.length < 3) continue;
      const [x, y, z] = destination.map(Number);
      if (![x, y, z].every(Number.isFinite)) continue;
      const reconstructed = actor.routineDestination;
      if (Math.abs(reconstructed.x - x) > 1e-4 || Math.abs(reconstructed.y - y) > 0.05 ||
          Math.abs(reconstructed.z - z) > 1e-4) continue;
      const dx = actor.root.position.x - reconstructed.x;
      const dz = actor.root.position.z - reconstructed.z;
      const radius = actor.routineArrivalRadius + actor.radius * 2;
      actor.routineDestinationArrived = entry.arrived === true && dx * dx + dz * dz <= radius * radius + 1e-8;
      if (actor.routineDestinationArrived) {
        actor.velocity.set(0, 0, 0);
        actor.steering.set(0, 0, 0);
        actor.speed = 0;
        actor.routineCrossingWaypoint = -1;
        actor.crossing = null;
        actor.crossingDestinationIndex = -1;
      }
      restored += 1;
    }
    return restored;
  }

  function nearbyResidentialActor(position = controlledPosition(), radius = 2.65) {
    let nearest = null;
    let nearestSquared = radius * radius;
    for (const [residentId, actor] of residentialActors) {
      if (!actor.active || !actor.alive || !actor.root.visible) continue;
      const squared = actor.root.position.distanceToSquared(position);
      if (squared > nearestSquared) continue;
      nearest = { residentId, actor };
      nearestSquared = squared;
    }
    return nearest;
  }

  function residentConversationLine(state, bond) {
    if (state.activity === "work" && state.role === "PARAMEDIC") {
      return "AMARA: A quiet shift is not an empty one. It means somebody got home before the worst minute of their life.";
    }
    if (state.activity === "work" && state.role === "VEHICLE TECHNICIAN") {
      return "LUIS: A repair is a promise. If I miss one bolt, somebody else pays for my hurry.";
    }
    if (state.activity === "work" && state.role === "FREELANCE PHOTOGRAPHER") {
      return "NIA: The city poses for towers. I photograph the people carrying groceries between them.";
    }
    if (state.activity === "sleep") return `${state.name.split(" ")[0]} IS ASLEEP — COME BACK WHEN THE LIGHTS ARE ON.`;
    if (state.activity === "visiting") return `${state.name.split(" ")[0]}: Thanks for making room. A home feels different when nobody has to earn the chair.`;
    if (bond >= 30) return `${state.name.split(" ")[0]}: You keep showing up when nothing is on fire. That is rarer than heroics.`;
    return `${state.name.split(" ")[0]}: Everyone talks about surviving Neon City. I am trying to build a week worth repeating.`;
  }

  function interactResidentialActor(residentId, { force = false, kind = "talk" } = {}) {
    const actor = residentialActors.get(String(residentId));
    const nearby = actor && controlledPosition().distanceToSquared(actor.root.position) <= 2.65 * 2.65;
    if (!actor || (!force && !nearby)) {
      const result = { accepted: false, reason: "resident_too_far", residentId };
      showToast("STEP CLOSER BEFORE STARTING A CONVERSATION", 2.4);
      return result;
    }
    const result = residentialLife.recordResidentInteraction(residentId, residentialClockContext({ kind }));
    if (!result.accepted) {
      showToast(explainResidentialRejection(result, "THE CONVERSATION DOES NOT LAND"), 2.4);
      return result;
    }
    if (result.serial > lastResidentialInteractionSerial) {
      lastResidentialInteractionSerial = result.serial;
      for (const award of result.skillEffects ?? []) {
        lifeProfile.awardExperience(award.skillId, award.experience, {
          sourceId: `resident:${result.serial}:${result.residentId}:${award.skillId}`,
        });
      }
      invalidateResidentialView();
    }
    const state = residentialLife.residentState(residentId, residentialClockContext());
    showToast(residentConversationLine(state, result.bond), 5.4);
    return result;
  }

  const cafeStaffSpawnById = new Map(commonGroundCafeWorld.spawnPoints.staff.map(spawn => [spawn.id, spawn]));
  const cafeStaffLocationAnchors = new Map([
    ["asha-patel-home", nearestResidentialNavigationAnchor(namedCharacterHomes[ASHA_PATEL.id].position)],
    ["dani_okoro-home", nearestResidentialNavigationAnchor([101.5, 0.2, 101.5])],
    ["rafael_chen-home", nearestResidentialNavigationAnchor([-101.5, 0.2, -101.5])],
    ["pulse-core-walk", vectorFrom(commonGroundCafeWorld.entrance.exterior)],
    ["north-market", vectorFrom(world.northMarket.focus)],
    ["river-walk", nearestResidentialNavigationAnchor([139, 0.2, 76])],
  ]);

  function cafeStaffHomeId(definition) {
    return definition.homeLocationId ?? `${definition.id}-home`;
  }

  function cafeStaffAnchor(definition, state) {
    if (state.locationId === commonGroundCafeWorld.id) {
      if (state.activity === "opening_setup") return vectorFrom(commonGroundCafeWorld.jobAnchors.prep);
      if (state.activity === "break") return vectorFrom(commonGroundCafeWorld.jobAnchors.break);
      if (state.activity === "close_down") return vectorFrom(commonGroundCafeWorld.jobAnchors.handover);
      const spawn = cafeStaffSpawnById.get(definition.worldAnchorId);
      if (spawn) return vectorFrom(spawn.position);
    }
    return vectorFrom(cafeStaffLocationAnchors.get(state.locationId) ?? commonGroundCafeWorld.entrance.exterior);
  }

  const initialCafeStaffStates = cafeShift.context(cafeClockContext()).staff;
  for (const definition of COMMON_GROUND_CAFE_STAFF) {
    const state = initialCafeStaffStates.find(value => value.id === definition.id);
    const position = cafeStaffAnchor(definition, state);
    const workSpawn = cafeStaffSpawnById.get(definition.worldAnchorId);
    let actor = cafeStaffActors.get(definition.id);
    if (!actor) {
      actor = population.spawn({
        id: definition.id,
        name: definition.name,
        role: `cafe-staff-${definition.id}`,
        x: position.x,
        z: position.z,
        yaw: Number(workSpawn?.heading) || 0,
        stationary: false,
        protected: true,
      });
      createCharacterNameplate(actor.root, definition.name.split(" ")[0]);
      cafeStaffActors.set(definition.id, actor);
    }
    const homeId = cafeStaffHomeId(definition);
    const homePosition = vectorFrom(cafeStaffLocationAnchors.get(homeId) ?? position);
    actor.root.userData.namedResident = true;
    actor.root.userData.cafeStaff = definition.id;
    actor.root.userData.home = actor.root.userData.home ?? Object.freeze({
      id: homeId,
      name: `${definition.name.split(" ")[0]}'s home`,
      address: definition.id === ASHA_PATEL.id ? namedCharacterHomes[ASHA_PATEL.id].address :
        definition.id === "dani_okoro" ? "22 Lantern Court" : "7 Marisol Row",
      position: Object.freeze(homePosition.toArray()),
    });
  }

  let cafeStaffStates = Object.freeze(initialCafeStaffStates);
  function syncCafeStaff(force = false, clockOverride = null, rebuildRouteIds = null) {
    const clock = clockOverride ?? cafeClockContext();
    const dayIndex = Math.max(0, Math.trunc(Number(clock.dayIndex) || 0));
    const minuteOfDay = ((Math.trunc(Number(clock.minuteOfDay ?? Number(clock.timeHours) * 60) || 0) % 1440) + 1440) % 1440;
    const absoluteMinute = dayIndex * 1440 + minuteOfDay;
    if (!force && absoluteMinute === lastCafeScheduleMinute) return cafeStaffStates;
    const state = cafeShift.context({ dayIndex, minuteOfDay });
    lastCafeScheduleMinute = absoluteMinute;
    for (const definition of COMMON_GROUND_CAFE_STAFF) {
      const schedule = state.staff.find(value => value.id === definition.id);
      const actor = cafeStaffActors.get(definition.id);
      if (!schedule || !actor?.alive) continue;
      const anchor = cafeStaffAnchor(definition, schedule);
      const signature = `${schedule.activity}:${schedule.locationId}:${anchor.x.toFixed(2)}:${anchor.z.toFixed(2)}`;
      if (force || cafeStaffSignatures.get(definition.id) !== signature) {
        population.setRoutineDestination(actor, {
          position: anchor,
          locationId: schedule.locationId,
          activity: schedule.activity,
          arrivalRadius: ["service", "opening_setup", "close_down"].includes(schedule.activity) ? 0.66 : 0.86,
          speedScale: schedule.activity === "commute" ? 1.18 : 1,
          rebuildRoute: rebuildRouteIds instanceof Set && rebuildRouteIds.has(definition.id),
        });
        actor.root.userData.cafeSchedule = Object.freeze({
          activity: schedule.activity,
          locationId: schedule.locationId,
          roomId: schedule.roomId,
          dayIndex,
          minuteOfDay,
        });
        cafeStaffSignatures.set(definition.id, signature);
      }
    }
    cafeStaffStates = Object.freeze(state.staff);
    return cafeStaffStates;
  }
  syncCafeStaff(true);

  function cafeStaffRuntimeSnapshot() {
    return [...cafeStaffActors].map(([staffId, actor]) => ({
      staffId,
      position: actor.root.position.toArray(),
      yaw: actor.root.rotation.y,
      destination: actor.routineDestinationActive ? actor.routineDestination.toArray() : null,
      locationId: actor.routineLocation ?? null,
      activity: actor.routineActivity ?? null,
      arrived: Boolean(actor.routineDestinationArrived),
    }));
  }

  function restoreCafeStaffRuntime(entries) {
    const movementBounds = world.traversableBounds ?? world.bounds;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.staffId ?? ""), entry]));
    const restoredIds = new Set();
    for (const [staffId, actor] of cafeStaffActors) {
      const entry = byId.get(staffId);
      const x = Number(entry?.position?.[0]);
      const z = Number(entry?.position?.[2]);
      if (!Number.isFinite(x) || !Number.isFinite(z) ||
          x < movementBounds.minX || x > movementBounds.maxX ||
          z < movementBounds.minZ || z > movementBounds.maxZ ||
          // A saved runtime pose only needs the same clearance used by normal
          // movement; the +0.08 destination margin rejects valid wall-adjacent
          // commute positions and prevents exact restoration.
          world.isBlockedCircle?.(x, z, actor.radius)) continue;
      actor.root.position.set(x, world.terrainHeight(x, z), z);
      if (Number.isFinite(Number(entry.yaw))) actor.root.rotation.y = Number(entry.yaw);
      actor.velocity.set(0, 0, 0);
      actor.steering.set(0, 0, 0);
      actor.speed = 0;
      restoredIds.add(staffId);
    }
    return restoredIds;
  }

  function restoreCafeStaffArrivalState(entries, restoredIds) {
    if (!(restoredIds instanceof Set) || restoredIds.size === 0) return 0;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.staffId ?? ""), entry]));
    let restored = 0;
    for (const staffId of restoredIds) {
      const entry = byId.get(staffId);
      const actor = cafeStaffActors.get(staffId);
      const destination = entry?.destination;
      if (!actor?.routineDestinationActive || !Array.isArray(destination) || destination.length < 3) continue;
      const [x, y, z] = destination.map(Number);
      if (![x, y, z].every(Number.isFinite)) continue;
      const reconstructed = actor.routineDestination;
      if (Math.abs(reconstructed.x - x) > 1e-4 || Math.abs(reconstructed.y - y) > 0.05 ||
          Math.abs(reconstructed.z - z) > 1e-4) continue;
      const dx = actor.root.position.x - reconstructed.x;
      const dz = actor.root.position.z - reconstructed.z;
      const radius = actor.routineArrivalRadius + actor.radius * 2;
      actor.routineDestinationArrived = entry.arrived === true && dx * dx + dz * dz <= radius * radius + 1e-8;
      if (actor.routineDestinationArrived) {
        actor.velocity.set(0, 0, 0);
        actor.steering.set(0, 0, 0);
        actor.speed = 0;
        actor.routineCrossingWaypoint = -1;
        actor.crossing = null;
        actor.crossingDestinationIndex = -1;
      }
      restored += 1;
    }
    return restored;
  }

  function nearbyCafeStaff(position = controlledPosition(), radius = 2.75) {
    let nearest = null;
    let nearestSquared = radius * radius;
    for (const definition of COMMON_GROUND_CAFE_STAFF) {
      const actor = cafeStaffActors.get(definition.id);
      if (!actor?.active || !actor.alive || !actor.root.visible) continue;
      const squared = actor.root.position.distanceToSquared(position);
      if (squared > nearestSquared) continue;
      nearest = {
        definition,
        actor,
        state: cafeStaffStates.find(value => value.id === definition.id) ?? null,
      };
      nearestSquared = squared;
    }
    return nearest;
  }

  const marketStaffLocationAnchors = new Map([
    ["mina-okafor-home", nearestResidentialNavigationAnchor(namedCharacterHomes["shopkeeper-mina_market_kitchen"].position)],
    ["emi-sato-home", nearestResidentialNavigationAnchor([101.5, 0.2, 97.5])],
    ["north-market-walk", vectorFrom(minaMarketWorld.entrance.street)],
  ]);

  function marketStaffAnchor(definition, state) {
    if (state.locationId === minaMarketWorld.id) {
      if (["meal_break", "admin_break"].includes(state.activity)) return vectorFrom(minaMarketWorld.staffAnchors.break);
      if (state.activity === "opening_checks") return vectorFrom(minaMarketWorld.stations.coldCase.position);
      if (state.activity === "supervise_floor") return vectorFrom(minaMarketWorld.stations.produceScale.position);
      if (state.activity === "supervise_close") return vectorFrom(minaMarketWorld.stations.dishSink.position);
      if (state.activity === "orders_and_packing") return vectorFrom(minaMarketWorld.stations.packingBench.position);
      if (state.activity === "stock_and_checkout" || state.activity === "checkout_close") {
        return vectorFrom(minaMarketWorld.staffAnchors.checkout);
      }
      if (state.activity === "orders_and_till") return vectorFrom(minaMarketWorld.staffAnchors.order);
      return vectorFrom(minaMarketWorld.staffAnchors[definition.id === MINA_OKAFOR.id ? "keeper" : "checkout"]);
    }
    return vectorFrom(marketStaffLocationAnchors.get(state.locationId) ?? minaMarketWorld.entrance.exterior);
  }

  const initialMarketStaffStates = marketShift.context(marketClockContext()).staff;
  for (const definition of MINA_MARKET_STAFF) {
    const state = initialMarketStaffStates.find(value => value.id === definition.id);
    const position = marketStaffAnchor(definition, state);
    let actor = marketStaffActors.get(definition.id);
    if (!actor) {
      actor = population.spawn({
        id: definition.id,
        name: definition.name,
        role: `market-staff-${definition.id}`,
        x: position.x,
        z: position.z,
        yaw: Math.PI,
        stationary: false,
        protected: true,
      });
      createCharacterNameplate(actor.root, definition.name.split(" ")[0]);
      marketStaffActors.set(definition.id, actor);
    }
    const homePosition = vectorFrom(marketStaffLocationAnchors.get(definition.homeLocationId) ?? position);
    actor.root.userData.namedResident = true;
    actor.root.userData.marketStaff = definition.id;
    actor.root.userData.home = actor.root.userData.home ?? Object.freeze({
      id: definition.homeLocationId,
      name: `${definition.name.split(" ")[0]}'s home`,
      address: definition.id === MINA_OKAFOR.id ? "84 Market Street, Flat 2" : "18 Lantern Court",
      position: Object.freeze(homePosition.toArray()),
    });
  }

  function syncMarketStaff(force = false, clockOverride = null, rebuildRouteIds = null) {
    const clock = clockOverride ?? marketClockContext();
    const dayIndex = Math.max(0, Math.trunc(Number(clock.dayIndex) || 0));
    const minuteOfDay = ((Math.trunc(Number(clock.minuteOfDay ?? Number(clock.timeHours) * 60) || 0) % 1440) + 1440) % 1440;
    const absoluteMinute = dayIndex * 1440 + minuteOfDay;
    if (!force && absoluteMinute === lastMarketScheduleMinute) return marketStaffStates;
    const state = marketShift.context({ dayIndex, minuteOfDay });
    lastMarketScheduleMinute = absoluteMinute;
    for (const definition of MINA_MARKET_STAFF) {
      const schedule = state.staff.find(value => value.id === definition.id);
      const actor = marketStaffActors.get(definition.id);
      if (!schedule || !actor?.alive) continue;
      const anchor = marketStaffAnchor(definition, schedule);
      const signature = `${schedule.activity}:${schedule.locationId}:${anchor.x.toFixed(2)}:${anchor.z.toFixed(2)}`;
      if (force || marketStaffSignatures.get(definition.id) !== signature) {
        population.setRoutineDestination(actor, {
          position: anchor,
          locationId: schedule.locationId,
          activity: schedule.activity,
          arrivalRadius: schedule.atWork ? 0.68 : 0.86,
          speedScale: schedule.activity === "commute" ? 1.18 : 1,
          rebuildRoute: rebuildRouteIds instanceof Set && rebuildRouteIds.has(definition.id),
        });
        actor.root.userData.marketSchedule = Object.freeze({
          activity: schedule.activity,
          locationId: schedule.locationId,
          roomId: schedule.roomId,
          dayIndex,
          minuteOfDay,
        });
        marketStaffSignatures.set(definition.id, signature);
      }
    }
    marketStaffStates = Object.freeze(state.staff);
    return marketStaffStates;
  }
  syncMarketStaff(true);

  function marketStaffRuntimeSnapshot() {
    return [...marketStaffActors].map(([staffId, actor]) => ({
      staffId,
      position: actor.root.position.toArray(),
      yaw: actor.root.rotation.y,
      destination: actor.routineDestinationActive ? actor.routineDestination.toArray() : null,
      locationId: actor.routineLocation ?? null,
      activity: actor.routineActivity ?? null,
      arrived: Boolean(actor.routineDestinationArrived),
    }));
  }

  function restoreMarketStaffRuntime(entries) {
    const movementBounds = world.traversableBounds ?? world.bounds;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.staffId ?? ""), entry]));
    const restoredIds = new Set();
    for (const [staffId, actor] of marketStaffActors) {
      const entry = byId.get(staffId);
      const x = Number(entry?.position?.[0]);
      const z = Number(entry?.position?.[2]);
      if (!Number.isFinite(x) || !Number.isFinite(z) || x < movementBounds.minX || x > movementBounds.maxX ||
          z < movementBounds.minZ || z > movementBounds.maxZ || world.isBlockedCircle?.(x, z, actor.radius)) continue;
      actor.root.position.set(x, world.terrainHeight(x, z), z);
      if (Number.isFinite(Number(entry.yaw))) actor.root.rotation.y = Number(entry.yaw);
      actor.velocity.set(0, 0, 0);
      actor.steering.set(0, 0, 0);
      actor.speed = 0;
      restoredIds.add(staffId);
    }
    return restoredIds;
  }

  function restoreMarketStaffArrivalState(entries, restoredIds) {
    if (!(restoredIds instanceof Set) || restoredIds.size === 0) return 0;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.staffId ?? ""), entry]));
    let restored = 0;
    for (const staffId of restoredIds) {
      const entry = byId.get(staffId);
      const actor = marketStaffActors.get(staffId);
      const destination = entry?.destination;
      if (!actor?.routineDestinationActive || !Array.isArray(destination) || destination.length < 3) continue;
      const [x, y, z] = destination.map(Number);
      if (![x, y, z].every(Number.isFinite)) continue;
      const reconstructed = actor.routineDestination;
      if (Math.abs(reconstructed.x - x) > 1e-4 || Math.abs(reconstructed.y - y) > 0.05 ||
          Math.abs(reconstructed.z - z) > 1e-4) continue;
      const dx = actor.root.position.x - reconstructed.x;
      const dz = actor.root.position.z - reconstructed.z;
      const radius = actor.routineArrivalRadius + actor.radius * 2;
      actor.routineDestinationArrived = entry.arrived === true && dx * dx + dz * dz <= radius * radius + 1e-8;
      if (actor.routineDestinationArrived) {
        actor.velocity.set(0, 0, 0);
        actor.steering.set(0, 0, 0);
        actor.speed = 0;
        actor.routineCrossingWaypoint = -1;
        actor.crossing = null;
        actor.crossingDestinationIndex = -1;
      }
      restored += 1;
    }
    return restored;
  }

  function nearbyMarketStaff(position = controlledPosition(), radius = 2.75) {
    let nearest = null;
    let nearestSquared = radius * radius;
    for (const definition of MINA_MARKET_STAFF) {
      const actor = marketStaffActors.get(definition.id);
      if (!actor?.active || !actor.alive || !actor.root.visible) continue;
      const squared = actor.root.position.distanceToSquared(position);
      if (squared > nearestSquared) continue;
      nearest = { definition, actor, state: marketStaffStates.find(value => value.id === definition.id) ?? null };
      nearestSquared = squared;
    }
    return nearest;
  }

  const communityStaffSpawnByRole = new Map([
    ["community_kitchen", communityHubWorld.spawnPoints.staff.find(value => value.role === "kitchen")],
    ["repair_cafe", communityHubWorld.spawnPoints.staff.find(value => value.role === "repair")],
    ["local_archive", communityHubWorld.spawnPoints.staff.find(value => value.role === "teacher")],
  ]);
  const communityStaffLocationAnchors = new Map([
    ["harbour-skills-house", vectorFrom(communityHubWorld.entrance.interior)],
    ["harbour_walk", vectorFrom(communityHubWorld.entrance.exterior)],
    ["foundry_lane", nearestResidentialNavigationAnchor([92, 0.2, 28])],
    ["market_library", vectorFrom(world.northMarket.focus)],
    ["harbour_garden", nearestResidentialNavigationAnchor([139, 0.2, 76])],
    ["canal_bench", nearestResidentialNavigationAnchor([139, 0.2, 28])],
    ["asha_home", nearestResidentialNavigationAnchor([-104, 0.2, 101])],
    ["tomas_home", nearestResidentialNavigationAnchor([-104, 0.2, -101])],
    ["priya_home", nearestResidentialNavigationAnchor([104, 0.2, 101])],
  ]);

  function communityStaffAnchor(definition, state) {
    if (state.locationId === communityHubWorld.id) {
      const spawn = communityStaffSpawnByRole.get(definition.roleId);
      if (spawn) return vectorFrom(spawn.position);
    }
    return vectorFrom(communityStaffLocationAnchors.get(state.locationId) ?? communityHubWorld.entrance.exterior);
  }

  const initialCommunityStaffStates = communityDirectorySnapshot().staff;
  for (const definition of COMMUNITY_HUB_STAFF) {
    const state = initialCommunityStaffStates.find(value => value.id === definition.id);
    const position = communityStaffAnchor(definition, state);
    const workSpawn = communityStaffSpawnByRole.get(definition.roleId);
    const actor = population.spawn({
      id: definition.id,
      name: definition.name,
      role: `community-staff-${definition.roleId}`,
      x: position.x,
      z: position.z,
      yaw: Number(workSpawn?.heading) || 0,
      stationary: false,
      protected: true,
    });
    actor.root.userData.namedResident = true;
    actor.root.userData.communityStaff = true;
    actor.root.userData.home = Object.freeze({
      id: definition.homeLocationId,
      name: `${definition.name.split(" ")[0]}'s home`,
      address: definition.id === "asha_malik" ? "17 Cypress Walk" :
        definition.id === "tomas_varga" ? "28 Foundry Lane" : "9 Market Library Court",
      position: Object.freeze(vectorFrom(communityStaffLocationAnchors.get(definition.homeLocationId)).toArray()),
    });
    createCharacterNameplate(actor.root, definition.name.split(" ")[0]);
    communityStaffActors.set(definition.id, actor);
  }

  function syncCommunityStaff(force = false, clockOverride = null, rebuildRouteIds = null) {
    const clock = clockOverride ?? communityClockContext();
    const minute = Math.max(0, Math.trunc(Number(clock.dayIndex) || 0)) * 1440 +
      ((Math.trunc(Number(clock.minuteOfDay ?? Number(clock.timeHours) * 60) || 0) % 1440) + 1440) % 1440;
    if (!force && minute === lastCommunityScheduleMinute) return communityDirectoryCache?.staff ?? Object.freeze([]);
    const state = communityHubLife.context(clock);
    lastCommunityScheduleMinute = minute;
    for (const definition of COMMUNITY_HUB_STAFF) {
      const schedule = state.staff.find(value => value.id === definition.id);
      const actor = communityStaffActors.get(definition.id);
      if (!schedule || !actor?.alive) continue;
      const anchor = communityStaffAnchor(definition, schedule);
      const signature = `${schedule.activity}:${schedule.locationId}:${anchor.x.toFixed(2)}:${anchor.z.toFixed(2)}`;
      if (force || communityStaffSignatures.get(definition.id) !== signature) {
        population.setRoutineDestination(actor, {
          position: anchor,
          locationId: schedule.locationId,
          activity: schedule.activity,
          arrivalRadius: schedule.activity === "work" ? 0.68 : 0.86,
          speedScale: schedule.activity === "commute" ? 1.18 : 1,
          rebuildRoute: rebuildRouteIds instanceof Set && rebuildRouteIds.has(definition.id),
        });
        actor.root.userData.communitySchedule = Object.freeze({
          activity: schedule.activity,
          locationId: schedule.locationId,
          roomId: schedule.roomId,
          dayIndex: state.clock.dayIndex,
          minuteOfDay: state.clock.minuteOfDay,
        });
        communityStaffSignatures.set(definition.id, signature);
      }
    }
    return state.staff;
  }
  syncCommunityStaff(true);

  function communityStaffRuntimeSnapshot() {
    return [...communityStaffActors].map(([staffId, actor]) => ({
      staffId,
      position: actor.root.position.toArray(),
      yaw: actor.root.rotation.y,
      destination: actor.routineDestinationActive ? actor.routineDestination.toArray() : null,
      locationId: actor.routineLocation ?? null,
      activity: actor.routineActivity ?? null,
      arrived: Boolean(actor.routineDestinationArrived),
    }));
  }

  function restoreCommunityStaffRuntime(entries) {
    const movementBounds = world.traversableBounds ?? world.bounds;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.staffId ?? ""), entry]));
    const restoredIds = new Set();
    for (const [staffId, actor] of communityStaffActors) {
      const entry = byId.get(staffId);
      const x = Number(entry?.position?.[0]);
      const z = Number(entry?.position?.[2]);
      if (!Number.isFinite(x) || !Number.isFinite(z) ||
          x < movementBounds.minX || x > movementBounds.maxX ||
          z < movementBounds.minZ || z > movementBounds.maxZ ||
          // Match population movement clearance so a valid collision-resolved
          // mid-commute pose restores exactly instead of being mistaken for a
          // blocked schedule destination.
          world.isBlockedCircle?.(x, z, actor.radius)) continue;
      actor.root.position.set(x, world.terrainHeight(x, z), z);
      if (Number.isFinite(Number(entry.yaw))) actor.root.rotation.y = Number(entry.yaw);
      actor.velocity.set(0, 0, 0);
      actor.steering.set(0, 0, 0);
      actor.speed = 0;
      restoredIds.add(staffId);
    }
    return restoredIds;
  }

  function restoreCommunityStaffArrivalState(entries, restoredIds) {
    if (!(restoredIds instanceof Set) || restoredIds.size === 0) return 0;
    const byId = new Map((Array.isArray(entries) ? entries : []).map(entry => [String(entry?.staffId ?? ""), entry]));
    let restored = 0;
    for (const staffId of restoredIds) {
      const entry = byId.get(staffId);
      const actor = communityStaffActors.get(staffId);
      const destination = entry?.destination;
      if (!actor?.routineDestinationActive || !Array.isArray(destination) || destination.length < 3) continue;
      const x = Number(destination[0]);
      const y = Number(destination[1]);
      const z = Number(destination[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const reconstructed = actor.routineDestination;
      const destinationMatches = Math.abs(reconstructed.x - x) <= 1e-4 &&
        Math.abs(reconstructed.y - y) <= 0.05 && Math.abs(reconstructed.z - z) <= 1e-4;
      if (!destinationMatches) continue;
      const dx = actor.root.position.x - reconstructed.x;
      const dz = actor.root.position.z - reconstructed.z;
      // Population arrival is sticky until a genuinely new routine destination
      // is assigned. Preserve that saved state across restore while allowing for
      // the small collision displacement that can leave an arrived body just
      // outside the initial approach radius. The extra allowance is deliberately
      // capped at one body diameter so a hostile save cannot pin remote staff.
      const stickyArrivalRadius = actor.routineArrivalRadius + actor.radius * 2;
      const safelyArrived = entry.arrived === true &&
        dx * dx + dz * dz <= stickyArrivalRadius * stickyArrivalRadius + 1e-8;
      actor.routineDestinationArrived = safelyArrived;
      if (safelyArrived) {
        actor.velocity.set(0, 0, 0);
        actor.steering.set(0, 0, 0);
        actor.speed = 0;
        actor.routineCrossingWaypoint = -1;
        actor.crossing = null;
        actor.crossingDestinationIndex = -1;
      }
      restored += 1;
    }
    return restored;
  }

  function nearbyCommunityStaff(position = controlledPosition(), radius = 2.8) {
    const staffStates = communityDirectorySnapshot().staff;
    let nearest = null;
    let nearestSquared = radius * radius;
    for (const definition of COMMUNITY_HUB_STAFF) {
      const actor = communityStaffActors.get(definition.id);
      if (!actor?.active || !actor.alive || !actor.root.visible) continue;
      const squared = actor.root.position.distanceToSquared(position);
      if (squared > nearestSquared) continue;
      nearest = { definition, actor, state: staffStates.find(value => value.id === definition.id) };
      nearestSquared = squared;
    }
    return nearest;
  }

  // A complete ordinary civilian rig is reserved at startup for workshop
  // customers. It lives offscreen until borrowed, so clocking in can never
  // depend on an ambient pedestrian happening to be idle on that exact frame.
  const garageCustomerPresentationKey = "garage-shift:customer";
  const garageCustomerReservePosition = Object.freeze([world.bounds.maxX + 420, 0, world.bounds.maxZ + 420]);
  const garageCustomerReserveActor = population.spawn({
    id: "pulse-garage-customer-reserve",
    name: "Pulse Garage Customer",
    x: garageCustomerReservePosition[0],
    z: garageCustomerReservePosition[2],
  });
  garageCustomerReserveActor.root.visible = false;
  const garageCustomerReserveStage = population.stage(garageCustomerReserveActor, {
    key: garageCustomerPresentationKey,
    kind: "garage-customer-reserve",
    phase: "reserve",
    position: garageCustomerReservePosition,
    visible: false,
    locked: true,
    protected: true,
  });
  if (!garageCustomerReserveStage.accepted) throw new Error(`Pulse Garage customer reserve failed: ${garageCustomerReserveStage.reason}`);
  const occupancyActors = Object.freeze(Array.from({ length: 13 }, (_, index) => `civilian-${index + 18}`));
  const marketCustomerSlots = minaMarketWorld.occupancySlots
    .filter(slot => slot.role === "shopper" || slot.role === "customer")
    .map((slot, index) => ({
      id: slot.id,
      position: slot.position,
      dwellMinutes: index < 4 ? [7, 18] : index < 7 ? [3, 9] : [8, 16],
      activity: slot.role === "shopper" ? "shopping" : "market-meal",
      idleMode: index % 3 === 0 ? "phone" : index >= 7 ? "coffee" : "hands",
    }));
  interiorOccupancy = createInteriorOccupancySystem({
    population,
    seed: world.seed ^ 0x4f434355,
    bucketMinutes: 30,
    actorIds: occupancyActors,
    buildings: [
      {
        id: minaMarketWorld.id,
        exterior: minaMarketWorld.entrance.exterior,
        threshold: minaMarketWorld.entrance.threshold,
        capacity: Math.min(6, marketCustomerSlots.length),
        visitChance: 0.78,
        openingHours: { openMinute: 7 * 60, closeMinute: 21 * 60, openDays: [0, 1, 2, 3, 4, 5, 6] },
        arrivalRadius: 0.58,
        speedScale: 1.02,
        occupancySlots: marketCustomerSlots,
      },
      {
        id: commonGroundCafeWorld.id,
        exterior: commonGroundCafeWorld.entrance.exterior,
        threshold: commonGroundCafeWorld.entrance.threshold,
        capacity: 3,
        visitChance: 0.56,
        openingHours: { openMinute: 6 * 60, closeMinute: 18 * 60, openDays: [0, 1, 2, 3, 4, 5, 6] },
        occupancySlots: commonGroundCafeWorld.customerAnchors.seating.slice(0, 3).map((position, index) => ({
          id: `common-ground-customer-${index + 1}`,
          position,
          dwellMinutes: [12, 28],
          activity: "cafe-visit",
          idleMode: index === 1 ? "phone" : "coffee",
        })),
      },
      {
        id: communityHubWorld.id,
        exterior: communityHubWorld.entrance.exterior,
        threshold: communityHubWorld.entrance.threshold,
        capacity: 2,
        visitChance: 0.38,
        openingHours: { openMinute: 8 * 60, closeMinute: 20 * 60, openDays: [0, 1, 2, 3, 4, 5, 6] },
        occupancySlots: communityHubWorld.spawnPoints.public.slice(0, 2).map((entry, index) => ({
          id: `skills-house-public-${index + 1}`,
          position: entry.position,
          dwellMinutes: [14, 34],
          activity: "community-visit",
          idleMode: index ? "hands" : "phone",
        })),
      },
      {
        id: pulseGarageInterior.id,
        exterior: pulseGarageInterior.entrance.exterior,
        threshold: pulseGarageInterior.entrance.threshold,
        capacity: 1,
        visitChance: 0.22,
        openingHours: { openMinute: 8 * 60, closeMinute: 19 * 60, openDays: [0, 1, 2, 3, 4, 5, 6] },
        occupancySlots: [{
          id: "pulse-garage-waiting-customer",
          position: pulseGarageInterior.customerAnchor,
          dwellMinutes: [10, 24],
          activity: "garage-visit",
          idleMode: "phone",
        }],
      },
    ],
  });
  const initialInteriorOccupancySave = interiorOccupancy.save();
  taxiPassengerActor = population.actors.find(actor =>
    actor !== garageCustomerReserveActor && !actor.police && !actor.storyRole && actor.active && actor.alive) ?? null;
  roadsideResponse = createRoadsideResponseSystem({
    vehicles: vehicles.roadsideAdapter,
    population,
  });
  lastRoadsidePhase = roadsideResponse.snapshot().phase;
  effects = createGameEffects({ scene, world });
  hud = createGtaHud({ renderer });
  const presenter = createSingleSurfacePresenter({ renderer, hudTexture: hud.texture });
  frameCapture = createFrameCapture({ renderer, scene, camera, hud });
  const pulseTransitVehicle = vehicles.get(world.pulseTransit?.vehicleId);
  // Suppress only draw submissions, never the vehicle root. Every vehicle owns
  // a resident SpotLight; hiding its parent would change the active light graph
  // and force thousands of material pipelines to rebuild when the bus returns.
  const nightRouteDinerRenderHidden = collectRenderOnlyDrawables(pulseTransitVehicle?.root);
  const nightRouteDinerRenderZeroIntensity = collectRenderOnlyLights(
    pulseTransitVehicle?.root,
    headlightRig,
  );
  const nightRouteDinerRenderOptions = Object.freeze({
    renderOnlyHidden: nightRouteDinerRenderHidden,
    renderOnlyZeroIntensity: nightRouteDinerRenderZeroIntensity,
  });

  const ray = new THREE.Ray();
  const rayBox = new THREE.Box3();
  const rayHit = new THREE.Vector3();
  const boxMin = new THREE.Vector3();
  const boxMax = new THREE.Vector3();
  const aimOrigin = new THREE.Vector3();
  const aimDirection = new THREE.Vector3();
  const fpsMuzzleOrigin = new THREE.Vector3();
  const diagnosticDirection = new THREE.Vector3();
  const diagnosticUp = new THREE.Vector3();
  const audioControlPosition = new THREE.Vector3();
  const thunderSourcePosition = new THREE.Vector3();
  const observerOrigin = new THREE.Vector3();
  const observerDirection = new THREE.Vector3();
  const observerForward = new THREE.Vector3();
  const spreadRight = new THREE.Vector3();
  const spreadUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const cityStoryAnchor = new THREE.Vector3(0, 5, -28);
  const positionBeforeUpdate = new THREE.Vector3();

  function worldRayDistance(origin, direction, maximum) {
    ray.set(origin, direction);
    let distance = maximum;
    for (const blocker of world.blockers) {
      if (blocker.active === false || blocker.shape !== "aabb") continue;
      const [cx, cy, cz] = blocker.center;
      const [hx, hy, hz] = blocker.halfExtents;
      boxMin.set(cx - hx, cy - hy, cz - hz);
      boxMax.set(cx + hx, cy + hy, cz + hz);
      rayBox.set(boxMin, boxMax);
      const point = ray.intersectBox(rayBox, rayHit);
      if (point) distance = Math.min(distance, origin.distanceTo(point));
    }
    return distance;
  }

  function fireWeapon(request = {}) {
    if (!request.aiming) return { hit: false, blocked: true, reason: "aim-required", crimeHandled: true };
    chaseCamera.shake(0.032, 0.14);
    const origin = firstPersonWeapon.getMuzzleWorld(fpsMuzzleOrigin).clone();
    gameAudio.playAt("gunshot", 0.72, origin);
    let direction = request.direction?.isVector3 ? request.direction.clone() : null;
    if (!direction || direction.lengthSq() < 0.5) direction = chaseCamera.aimRay(aimOrigin, aimDirection).direction.clone();
    direction.normalize();
    const playerState = player.snapshot();
    const spread = 0.0017 + Math.min(0.0025, playerState.speed * 0.00028);
    const shotPhase = (playerState.shotsFired + 1) * 2.399963 + elapsed * 0.17;
    spreadRight.crossVectors(direction, worldUp);
    if (spreadRight.lengthSq() < 0.001) spreadRight.set(1, 0, 0);
    else spreadRight.normalize();
    spreadUp.crossVectors(spreadRight, direction).normalize();
    direction.addScaledVector(spreadRight, Math.sin(shotPhase) * spread)
      .addScaledVector(spreadUp, Math.cos(shotPhase * 1.37) * spread)
      .normalize();
    const maximum = worldRayDistance(origin, direction, 125);
    const personHit = population?.raycast(origin, direction, maximum);
    const vehicleHit = vehicles?.raycast(origin, direction, maximum);
    const huskHit = desertOutskirts.raycast(origin, direction, maximum);
    const personDistance = personHit?.distance ?? Infinity;
    const vehicleDistance = vehicleHit?.distance ?? Infinity;
    const huskDistance = huskHit?.distance ?? Infinity;
    let hitDistance = maximum;
    const hitWorld = maximum < 124.999;
    let result = { hit: hitWorld, hitWorld, crimeHandled: false };
    if (huskDistance <= personDistance && huskDistance <= vehicleDistance && huskDistance <= maximum) {
      hitDistance = huskDistance;
      const damage = desertOutskirts.damage(huskHit.actor, clamp(request.damage ?? 42, 1, 80));
      result = {
        hit: true,
        crimeHandled: true,
        target: damage.id,
        damage: damage.damage,
        defeatedHusk: damage.defeated,
      };
    } else if (personDistance <= vehicleDistance && personDistance <= maximum) {
      hitDistance = personDistance;
      const hitHeight = (personHit.point?.y ?? personHit.actor.root.position.y + 1.1) - personHit.actor.root.position.y;
      const headshot = hitHeight > 1.5;
      const baseDamage = clamp(request.damage ?? 42, 1, 80);
      const damage = population.damage(personHit.actor, headshot ? Math.min(88, baseDamage * 1.75) : baseDamage, "player");
      result = {
        hit: true,
        crimeHandled: true,
        target: damage.id,
        headshot,
        damage: damage.damage,
        hitPolice: damage.police,
        hitCivilian: !damage.police,
      };
    } else if (vehicleDistance <= maximum) {
      hitDistance = vehicleDistance;
      const damage = vehicles.damage(vehicleHit.vehicle, request.weapon === "minigun" ? 10 : 18);
      if (vehicleHit.vehicle.police) commitCrime({ type: "damage_police_vehicle", heat: 24 });
      result = { hit: true, crimeHandled: vehicleHit.vehicle.police, target: damage?.id, hitVehicle: true };
    }
    const end = origin.clone().addScaledVector(direction, hitDistance);
    effects?.shot(origin, end, result);
    if (result.hit) gameAudio.playAt("impact", result.hitVehicle ? 0.5 : 0.36, end);
    population?.alert(origin, "gunfire");
    return result;
  }

  function performMelee(request = {}) {
    const origin = request.origin?.isVector3
      ? request.origin.clone()
      : player.root.position.clone().add(new THREE.Vector3(0, 1.12, 0));
    const direction = request.direction?.isVector3
      ? request.direction.clone().setY(0)
      : new THREE.Vector3(-Math.sin(player.root.rotation.y), 0, -Math.cos(player.root.rotation.y));
    if (direction.lengthSq() < 0.01) direction.set(0, 0, -1);
    direction.normalize();
    const reach = clamp(request.reach ?? 2.15, 0.5, 3);
    const maximum = worldRayDistance(origin, direction, reach);
    const personHit = population?.raycast(origin, direction, maximum);
    const vehicleHit = vehicles?.raycast(origin, direction, maximum);
    const personDistance = personHit?.distance ?? Infinity;
    const vehicleDistance = vehicleHit?.distance ?? Infinity;
    let result = { hit: false, crimeHandled: false };
    let point = origin.clone().addScaledVector(direction, maximum);

    if (personDistance <= vehicleDistance && personDistance <= maximum) {
      point = personHit.point?.clone?.() ?? origin.clone().addScaledVector(direction, personDistance);
      const damage = population.damage(personHit.actor, clamp(request.damage ?? 32, 1, 80), "player");
      result = {
        hit: true,
        crimeHandled: true,
        target: damage.id,
        damage: damage.damage,
        hitPolice: damage.police,
        hitCivilian: !damage.police,
        comboIndex: request.comboIndex ?? 1,
      };
    } else if (vehicleDistance <= maximum) {
      point = vehicleHit.point?.clone?.() ?? origin.clone().addScaledVector(direction, vehicleDistance);
      const damage = vehicles.damage(vehicleHit.vehicle, 8 + clamp(request.comboIndex ?? 1, 1, 3) * 2);
      commitCrime({
        type: vehicleHit.vehicle.police ? "damage_police_vehicle" : "vehicle_vandalism",
        heat: vehicleHit.vehicle.police ? 28 : 12,
      });
      population?.alert(point, "vehicle assault");
      result = {
        hit: true,
        crimeHandled: true,
        target: damage?.id,
        hitVehicle: true,
        hitPolice: Boolean(vehicleHit.vehicle.police),
        comboIndex: request.comboIndex ?? 1,
      };
    }

    if (result.hit) {
      effects?.impact(point, { ...result, heavy: true });
      gameAudio.playAt("impact", result.hitVehicle ? 0.55 : 0.42, point);
      chaseCamera.shake(result.hitVehicle ? 0.085 : 0.065, 0.18);
    }
    return result;
  }

  function beginRecoveryMission() {
    const current = mission.snapshot();
    if (current.stage !== MISSION_STAGES.AVAILABLE && current.stage !== MISSION_STAGES.COMPLETE) return current;
    if (!vehicles.targetVehicle || vehicles.targetVehicle.health <= 0) {
      const target = vehicles.targetVehicle;
      if (target) {
        target.health = target.maxHealth;
        target.root.scale.y = 1;
        vehicles.teleport(target.id, targetSpawn.x, targetSpawn.z, Math.PI * 0.5);
      }
    }
    if (current.stage === MISSION_STAGES.COMPLETE) mission.reset(vehicles.targetVehicle?.id);
    const started = mission.begin(vehicles.targetVehicle?.id);
    gameAudio.play("mission", 0.55);
    showToast("HOME AGAIN — RECOVER MARISOL'S COMET", 3.6);
    return started;
  }

  function processStoryEvents() {
    for (const event of story.drainEvents()) {
      if (event.type === "start_recovery") beginRecoveryMission();
      else if (event.type === "chapter_started") showToast("CHAPTER ONE — HOME AGAIN", 3.8);
      else if (event.type === "choice_requested") {
        showToast("THE DRIVE NAMES VICTIMS AS WELL AS OFFENDERS", 4.5);
      } else if (event.type === "choice_made") {
        showToast(event.optionId === "publish"
          ? "THE FILES GO PUBLIC — THE SOURCES ARE EXPOSED"
          : "THE SOURCES ARE SEALED — VOSS KEEPS OPERATING", 5.2);
      }
      else if (event.type === "chapter_completed") {
        gameAudio.play("mission", 0.8);
        showToast("CHAPTER COMPLETE — HOME AGAIN", 6);
      } else if (event.type === "recovery_failed") {
        showToast("MARISOL'S CAR WAS DESTROYED — RETURN TO JUNO", 4);
      }
    }
  }

  function processChapterTwoEvents() {
    for (const event of chapterTwo.drainEvents()) {
      if (event.type === "chapter_started") {
        neighbourhoodRoutine.close("chapter_two_started");
        gameAudio.play("mission", 0.58);
        showToast("CHAPTER TWO — BORROWED TIME", 4.5);
      } else if (event.type === "clue_recorded") {
        gameAudio.play("pickup", 0.3);
        showToast(`EVIDENCE RECORDED  ${event.count}/${event.total}`, 2.8);
      } else if (event.type === "affected_person_spoken") {
        showToast("LEAH'S ACCOUNT RECORDED — HER FAILURE IS NOT A STORY PROP", 3.8);
      } else if (event.type === "manifest_recorded") {
        gameAudio.play("pickup", 0.34);
        showToast("SOUTHLINE MANIFEST PRESERVED", 3.4);
      } else if (event.type === "choice_requested") {
        showToast("ELEVEN DRIVERS — SEVEN NAMES — NO COST-FREE ANSWER", 5);
      } else if (event.type === "choice_made") {
        showToast(event.optionId === "report_now"
          ? "PUBLIC RECALL FILED — UNKNOWN DRIVERS WARNED, PEOPLE EXPOSED"
          : "SEVEN CARS PARKED — FOUR DRIVERS UNKNOWN, EVIDENCE WINDOW OPEN", 5.8);
      } else if (event.type === "chapter_completed") {
        gameAudio.play("mission", 0.78);
        showToast("CHAPTER COMPLETE — BORROWED TIME", 6);
      } else if (event.type === "aftermath_unlocked" && event.hook?.title) {
        showToast(`${event.hook.title} UNLOCKED — THE CONSEQUENCE IS PLAYABLE`, 5.2);
      } else if (event.type === "aftermath_epilogue_started") {
        neighbourhoodRoutine.close("chapter_two_aftermath_epilogue");
        gameAudio.play("mission", 0.58);
        showToast("PEOPLE BEHIND THE LEDGER — THE CONSEQUENCE HAS A FACE", 5.2);
      } else if (event.type === "aftermath_epilogue_completed") {
        gameAudio.play("mission", 0.66);
        showToast("EPILOGUE COMPLETE — THE LEDGER REMAINS OPEN", 5.2);
      }
    }
  }

  function processLifeActivityEvents() {
    let handedOff = 0;
    for (const event of lifeActivity.drainEvents()) {
      if (event.type !== "aftermath_completed") continue;
      chapterTwo.notify(event);
      handedOff += 1;
    }
    if (handedOff > 0) processChapterTwoEvents();
    return handedOff;
  }

  function garageSkillScore() {
    const skill = lifeProfile.skill("mechanics");
    return clamp(((skill.level - 1) + skill.levelProgress) / 5 * 100, 0, 100);
  }

  function garageShiftContext(detail = {}) {
    const environmentState = environment.snapshot();
    return {
      dayIndex: neighbourhoodRoutine.snapshot().dayIndex,
      timeHours: environmentState.timeHours,
      mechanicSkill: garageSkillScore(),
      position: controlledPosition(),
      inVehicle: Boolean(vehicles?.playerVehicle),
      ...detail,
    };
  }

  function releaseGarageCustomerPresentation() {
    if (!garageCustomerActor) return false;
    population?.stage?.(garageCustomerReserveActor, {
      key: garageCustomerPresentationKey,
      kind: "garage-customer-reserve",
      phase: "reserve",
      name: "Pulse Garage Customer",
      position: garageCustomerReservePosition,
      visible: false,
      locked: true,
      protected: true,
    });
    garageCustomerActor = null;
    garageCustomerReleaseAt = -Infinity;
    return true;
  }

  function syncGarageCustomerPresentation() {
    const state = garageShift.snapshot();
    if (!state.active || !state.customerId) return null;
    const key = garageCustomerPresentationKey;
    if (!garageCustomerActor) {
      const request = {
        key,
        kind: "garage-customer",
        phase: state.stage,
        name: state.customerName,
        position: pulseGarageInterior.customerAnchor,
        radius: 260,
        idleMode: "hands",
        locked: true,
        protected: true,
        visible: true,
        yaw: Math.PI,
      };
      let result = population?.stage?.(garageCustomerReserveActor, request);
      // A shift can start while every nearby civilian is walking. The public
      // stage selector intentionally accepts only calm idle actors, so fall
      // back to the nearest unclaimed ordinary civilian and authoritatively
      // put that already-preloaded rig on customer duty.
      if (!result?.accepted) {
        let candidate = null;
        let nearestSquared = Infinity;
        const anchor = vectorFrom(pulseGarageInterior.customerAnchor);
        for (const actor of population.actors) {
          if (actor.police || actor.storyRole || actor.storyLocked || actor.storyProtected ||
              !actor.active || !actor.alive || actor.ragdollActive || actor.socialPartner || actor.presentationKey) continue;
          const squared = actor.root.position.distanceToSquared(anchor);
          if (squared < nearestSquared) {
            candidate = actor;
            nearestSquared = squared;
          }
        }
        result = candidate ? population.stage(candidate, request) : result;
      }
      garageCustomerActor = result?.accepted
        ? population.actors.find(actor => actor.id === result.actorId) ?? null
        : null;
    } else {
      population.stage(garageCustomerActor, {
        key,
        phase: state.stage,
        position: pulseGarageInterior.customerAnchor,
        visible: true,
        yaw: Math.PI,
      });
    }
    return garageCustomerActor;
  }

  function processGarageShiftEvents() {
    let handled = 0;
    for (const event of garageShift.drainEvents()) {
      handled += 1;
      if (event.type === "garage_shift_clocked_in") {
        syncGarageCustomerPresentation();
        gameAudio.play("mission", 0.42);
        showToast("SHIFT CLOCKED IN — LISTEN BEFORE YOU TOUCH THE CAR", 3.4);
      } else if (event.type === "garage_customer_greeted") {
        showToast(garageShift.snapshot().request, 4.4);
      } else if (event.type === "garage_clue_found") {
        const clue = garageShift.snapshot().inspectionClues.at(-1);
        gameAudio.play("pickup", 0.22);
        showToast(clue?.observation ?? "INSPECTION CLUE RECORDED", 4);
      } else if (event.type === "garage_inspection_completed") {
        garageDiagnosisIndex = 0;
        showToast("INSPECTION COMPLETE — W / S CHOOSE A DIAGNOSIS, E CONFIRM", 3.8);
      } else if (event.type === "garage_diagnosis_rework") {
        showToast("THAT DIAGNOSIS DOES NOT FIT ALL THE EVIDENCE — RECHECK IT", 3.5);
      } else if (event.type === "garage_diagnosis_confirmed") {
        garageConfirmedDiagnosisId = event.diagnosisId;
        showToast("DIAGNOSIS LOGGED — COLLECT ONLY THE REQUIRED PARTS", 3.3);
      } else if (event.type === "garage_parts_collected") {
        showToast("PARTS VERIFIED — MOVE TO THE LIFT AND COMPLETE THE REPAIR", 3.3);
      } else if (event.type === "garage_repair_completed") {
        gameAudio.play("pickup", 0.28);
        showToast("REPAIR COMPLETE — THREE SAFETY CHECKS BEFORE RELEASE", 3.6);
      } else if (event.type === "garage_vehicle_safe") {
        showToast("SAFETY CHECK PASSED — WRITE AN HONEST INVOICE", 3.2);
      } else if (event.type === "garage_shift_completed") {
        const profileTransaction = lifeProfile.recordShift({
          id: event.workOrderId,
          activityId: "garage_apprentice",
          dayIndex: garageShift.snapshot().dayIndex,
          durationMinutes: event.workMinutes,
          quality: event.quality / 100,
          baseWage: event.wage,
          experience: event.mechanicXp,
        });
        if (profileTransaction.accepted) player.addCash(profileTransaction.wage);
        gameAudio.play("mission", 0.76);
        showToast(profileTransaction.accepted
          ? `SAFE REPAIR FILED  +$${profileTransaction.wage}  MECHANICS XP +${event.mechanicXp}`
          : "SHIFT ALREADY FILED — NO DUPLICATE WAGE", 5.5);
        garageCustomerReleaseAt = elapsed + 5;
        activityPresentationUntil = elapsed + 6;
      }
    }
    syncGarageCustomerPresentation();
    return handled;
  }

  function processNightRouteEvents() {
    let handled = 0;
    for (const event of nightRoute.drainEvents()) {
      if (event.serial <= lastNightRouteHandledEventSerial) continue;
      lastNightRouteHandledEventSerial = event.serial;
      lastNightRouteHandledEvent = event.type;
      handled += 1;
      if (event.type === "ordinary_story_started") {
        neighbourhoodRoutine.close("night_route_started");
        gameAudio.play("mission", 0.54);
        showToast("THE NIGHT COUNT — WHO GETS COUNTED WHEN THE MACHINE FAILS", 5.2);
      } else if (event.type === "dialogue_started") {
        gameAudio.play(event.speaker === NIGHT_ROUTE_CHARACTERS.evelyn.name ? "radio" : "pickup", 0.12);
      } else if (event.type === "survey_started") {
        showToast("TAKE THE PULSE LINE — COUNT RIDERS, NOT THEIR PRIVATE LIVES", 4.2);
      } else if (event.type === "survey_stop_completed") {
        gameAudio.play("pickup", 0.3);
        showToast(`NIGHT COUNT RECORDED  ${event.stopIndex + 1}/${nightRoute.surveyStops.length}`, 2.8);
      } else if (event.type === "choice_requested") {
        gameAudio.play("mission", 0.42);
        showToast("A SECURE ROUTE, OR PRIVATE LIVES — NEITHER FILE IS CLEAN", 5.2);
      } else if (event.type === "choice_made") {
        showToast(event.optionId === "anonymous_trial"
          ? "ANONYMOUS COUNT — SIXTY NIGHTS, TWO LATE RUNS CUT"
          : "SIGNED YEAR — FULL SERVICE, FIVE WORK PATTERNS MADE PUBLIC", 5.4);
      } else if (event.type === "aftermath_started") {
        showToast("THE DECISION IS FILED — NOW CARRY ITS COST THROUGH SOUTHLINE", 4.5);
      } else if (event.type === "aftermath_task_completed") {
        gameAudio.play("pickup", 0.28);
        showToast(`CONSEQUENCE RECORDED  ${event.taskIndex + 1}/${nightRoute.snapshot().aftermathCount}`, 2.8);
      } else if (event.type === "ordinary_story_completed") {
        nightRouteCompletionEventsHandled += 1;
        gameAudio.play("mission", 0.76);
        showToast("THE NIGHT COUNT FILED — THE COST REMAINS ON THE LEDGER", 6);
        activityPresentationUntil = elapsed + 6;
        releaseNightRouteParticipants();
      }
      if (NIGHT_ROUTE_PRESENTATION_PHASE_EVENTS.has(event.type)) syncNightRouteParticipantPresentation();
    }
    return handled;
  }

  function beginChapterTwo(force = false) {
    const chapterOne = story.snapshot();
    const current = chapterTwo.snapshot();
    if (!chapterOne.chapterCompleted || !chapterOne.choiceResult) {
      showToast("FINISH HOME AGAIN'S EVIDENCE DECISION FIRST", 3);
      return current;
    }
    if (current.chapterStarted) {
      showToast(current.chapterCompleted
        ? `${current.aftermathHook?.title ?? "BORROWED TIME"} IS NOW AVAILABLE`
        : current.objective, 3.2);
      return current;
    }
    if (selectedActivitySnapshot()?.status === "active") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.5);
      return current;
    }
    if (vehicles.playerVehicle && !force) {
      showToast("PARK AND MEET JUNO ON FOOT", 2.6);
      return current;
    }
    if (vehicles.playerVehicle && force) exitVehicle();
    if (wanted.snapshot().stars > 0 && !force) {
      showToast("LOSE THE POLICE ATTENTION BEFORE YOU INVOLVE THE GARAGE", 3.2);
      return current;
    }
    if (!force && controlledPosition().distanceToSquared(contactPosition) > 7 * 7) {
      showToast("MEET JUNO AT PULSE GARAGE", 2.8);
      return current;
    }
    if (selectedActivity) {
      selectedActivity = null;
      lastActivityStage = null;
    }
    const started = chapterTwo.begin({ chapterOneChoice: chapterOne.choiceResult });
    processChapterTwoEvents();
    return started;
  }

  function interactWithChapterTwo() {
    const state = chapterTwo.snapshot();
    if (!state.chapterStarted || state.chapterCompleted || state.active || state.choice) return false;
    const position = controlledPosition();
    const nearbyClue = state.phase === CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE
      ? nearbyChapterTwoClue(position)
      : null;
    const target = nearbyClue ? chapterTwoGarageCluePositions.get(nearbyClue.id) : chapterTwoTargetPosition(state);
    if (!target || position.distanceToSquared(target) > 5.2 * 5.2) return false;
    if (vehicles.playerVehicle) {
      showToast("PARK AND CHECK THIS ON FOOT", 2.5);
      return true;
    }
    if (wanted.snapshot().stars > 0) {
      showToast("DO NOT BRING A PURSUIT TO A WITNESS OR AN EVIDENCE SITE", 3.2);
      return true;
    }
    if (state.phase === CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE) {
      const clue = nearbyClue;
      if (!clue) return false;
      chapterTwo.inspect(clue.id);
      gameAudio.play("pickup", 0.24);
    } else if (state.phase === CHAPTER_TWO_PHASES.SPEAK_TO_LEAH) {
      stageConversationSeparation({
        player,
        actor: leahActor,
        world,
        preferredPlayerPosition: chapterTwoLeahInteractionPosition,
        minimumSeparation: 1.8,
      });
      chapterTwo.speak(CHAPTER_TWO_AFFECTED_PERSON.id);
    } else if (state.phase === CHAPTER_TWO_PHASES.INSPECT_DEPOT) {
      stageConversationSeparation({
        player,
        actor: depotClerkActor,
        world,
        preferredPlayerPosition: chapterTwoDepotManifestInteractionPosition,
        minimumSeparation: 2.2,
      });
      chapterTwo.recordManifest("photograph");
    } else return false;
    processChapterTwoEvents();
    return true;
  }

  function startCurrentGarageChapter(force = false) {
    return story.snapshot().chapterCompleted ? beginChapterTwo(force) : startMission(force);
  }

  function startMission(force = false) {
    if (selectedActivitySnapshot()?.status === "active") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.5);
      return mission.snapshot();
    }
    if (selectedActivity) {
      selectedActivity = null;
      lastActivityStage = null;
    }
    const current = mission.snapshot();
    if (current.stage !== MISSION_STAGES.AVAILABLE && current.stage !== MISSION_STAGES.COMPLETE) return current;
    if (force) {
      story.notify({ type: "force_recovery" });
      processStoryEvents();
      return beginRecoveryMission();
    }
    if (!force && controlledPosition().distanceToSquared(contactPosition) > 7 * 7) {
      showToast("MEET JUNO AT PULSE GARAGE", 2.8);
      return current;
    }
    if (!story.snapshot().briefingCompleted) {
      story.notify({ type: "contact_interacted" });
      processStoryEvents();
      gameAudio.play("mission", 0.4);
      return mission.snapshot();
    }
    return beginRecoveryMission();
  }

  function clearTaxiPassengerPresentation() {
    if (taxiPassengerActor?.presentationKey?.startsWith("taxi:")) {
      population.release(taxiPassengerActor);
    }
    taxiPresentationSignature = "";
  }

  function syncTaxiPassengerPresentation(state = selectedActivity === "taxi" ? taxiActivity.snapshot() : null) {
    if (!state?.fareId || selectedActivity !== "taxi") {
      clearTaxiPassengerPresentation();
      return null;
    }
    const visible = state.stage !== TAXI_STAGES.DROPOFF;
    const boardedBeforeFailure = Boolean(state.seenDialogueMask & 1);
    const position = state.stage === TAXI_STAGES.COMPLETE
      ? state.fare.dropoff
      : state.stage === TAXI_STAGES.DROPOFF
        ? state.fare.dropoff
        : state.stage === TAXI_STAGES.FAILED && boardedBeforeFailure
          ? controlledPosition()
          : state.fare.pickup;
    const phase = state.stage === TAXI_STAGES.DROPOFF ? "on-board" :
      state.stage === TAXI_STAGES.COMPLETE ? "arrived" :
        state.stage === TAXI_STAGES.FAILED ? "fare-ended" : state.stage;
    const signature = `${state.fareId}|${phase}|${visible ? 1 : 0}`;
    if (signature === taxiPresentationSignature && taxiPassengerActor?.presentationKey === `taxi:${state.fareId}`) {
      return taxiPassengerActor;
    }
    const pickup = state.fare.pickup;
    const dropoff = state.fare.dropoff;
    const yaw = Math.atan2(-(dropoff[0] - pickup[0]), -(dropoff[2] - pickup[2]));
    const request = {
      key: `taxi:${state.fareId}`,
      kind: "night-shift-passenger",
      phase,
      name: state.passenger,
      position,
      visible,
      protected: true,
      locked: true,
      idleMode: "hands",
      yaw,
    };
    let result = population.stage(taxiPassengerActor, request);
    if (!result?.accepted) result = population.stage(null, request);
    if (!result?.accepted) return null;
    taxiPassengerActor = population.actors.find(actor => actor.id === result.actorId) ?? taxiPassengerActor;
    taxiPresentationSignature = signature;
    return taxiPassengerActor;
  }

  function nightRouteUsesDinerTableau(state = nightRoute.snapshot()) {
    return Boolean(state.controlsLocked && (state.activeSequenceId || state.choice));
  }

  function nightRouteRenderOnlyHidden() {
    return selectedActivity === "nightRoute" && nightRouteUsesDinerTableau()
      ? nightRouteDinerRenderHidden
      : null;
  }

  function nightRouteParticipantPosition(characterId, dinerTableau = false) {
    if (dinerTableau) {
      return (nightRouteDinerParticipantPositions.get(characterId) ?? nightRouteDinerPosition).clone();
    }
    if (characterId === NIGHT_ROUTE_CHARACTERS.evelyn.id) {
      const diner = vectorFrom(nightRoute.snapshot().hubPosition);
      const candidates = [
        diner.clone().add(new THREE.Vector3(-2.2, 0, 0.7)),
        diner.clone().add(new THREE.Vector3(-2.2, 0, -0.7)),
        diner.clone().add(new THREE.Vector3(2.2, 0, 0.7)),
        diner.clone().add(new THREE.Vector3(2.2, 0, -0.7)),
      ];
      const safe = candidates.find(value =>
        !world.isBlockedCircle?.(value.x, value.z, 0.38) && !world.isRoad?.(value.x, value.z)) ??
        candidates.find(value => !world.isBlockedCircle?.(value.x, value.z, 0.38)) ?? diner;
      safe.y = Number(world.terrainHeight?.(safe.x, safe.z) ?? safe.y);
      return safe;
    }
    const stop = nightRoute.surveyStops.find(value => value.characterId === characterId);
    const waiting = world.pulseTransit?.waitingAnchors ?? [];
    let closest = null;
    let closestDistance = Infinity;
    for (const anchor of waiting) {
      const distance = Math.abs(Number(anchor[0]) - Number(stop?.position?.[0]));
      if (distance < closestDistance) {
        closest = anchor;
        closestDistance = distance;
      }
    }
    const position = vectorFrom(closest ?? stop?.position ?? nightRoute.snapshot().hubPosition);
    if (stop?.position) position.x = Number(stop.position[0]);
    if (world.isBlockedCircle?.(position.x, position.z, 0.38) && closest) position.copy(vectorFrom(closest));
    position.y = Number(world.terrainHeight?.(position.x, position.z) ?? position.y);
    return position;
  }

  function nightRouteParticipantRequest(
    character,
    phase = nightRoute.snapshot().phase,
    dinerTableau = nightRouteUsesDinerTableau(),
  ) {
    const position = nightRouteParticipantPosition(character.id, dinerTableau);
    const facing = dinerTableau ? nightRouteKaiStagePosition : nightRouteDinerPosition;
    const yaw = dinerTableau || character.id === NIGHT_ROUTE_CHARACTERS.evelyn.id
      ? Math.atan2(-(facing.x - position.x), -(facing.z - position.z))
      : 0;
    return {
      key: `night-route:${character.id}`,
      kind: "night-route-participant",
      phase: `the-night-count:${phase}:${dinerTableau ? "diner" : "route"}`,
      name: character.name,
      position,
      visible: true,
      protected: true,
      locked: true,
      idleMode: character.id === NIGHT_ROUTE_CHARACTERS.evelyn.id ? "phone" : "hands",
      yaw,
    };
  }

  function nightRouteParticipantDefinitions() {
    return NIGHT_ROUTE_STAGE_CHARACTERS;
  }

  function releaseNightRouteParticipants() {
    let released = 0;
    for (const actor of nightRouteParticipantActors.values()) {
      if (actor?.presentationKey?.startsWith("night-route:")) {
        released += Number(Boolean(population.release(actor)?.accepted));
      }
    }
    nightRouteParticipantActors.clear();
    nightRouteParticipantLayoutSignature = "";
    return released;
  }

  function syncNightRouteParticipantPresentation() {
    if (!nightRouteParticipantActors.size) return 0;
    const state = nightRoute.snapshot();
    const dinerTableau = nightRouteUsesDinerTableau(state);
    const signature = `${dinerTableau ? "diner" : "route"}:${state.phase}`;
    if (signature === nightRouteParticipantLayoutSignature) return 0;
    let updated = 0;
    for (const character of nightRouteParticipantDefinitions()) {
      const actor = nightRouteParticipantActors.get(character.id);
      if (!actor) continue;
      updated += Number(Boolean(population.stage(
        actor,
        nightRouteParticipantRequest(character, state.phase, dinerTableau),
      )?.accepted));
    }
    if (updated === nightRouteParticipantActors.size) nightRouteParticipantLayoutSignature = signature;
    return updated;
  }

  function stageNightRouteParticipants(
    preferredActorIds = null,
    phase = nightRoute.snapshot().phase,
    dinerTableau = nightRouteUsesDinerTableau(),
  ) {
    releaseNightRouteParticipants();
    const staged = [];
    for (const character of nightRouteParticipantDefinitions()) {
      const preferredId = preferredActorIds?.[character.id] ?? null;
      const preferred = preferredId
        ? population.actors.find(actor => actor.id === String(preferredId)) ?? null
        : null;
      if (preferredId && !preferred) {
        for (const value of staged) population.release(value);
        nightRouteParticipantActors.clear();
        return Object.freeze({
          accepted: false,
          reason: "saved_actor_missing",
          characterId: character.id,
          preferredActorId: preferredId,
        });
      }
      const request = nightRouteParticipantRequest(character, phase, dinerTableau);
      const result = preferredId
        ? population.stage(preferred, request)
        : population.stage(null, request);
      if (!result?.accepted) {
        for (const actor of staged) population.release(actor);
        nightRouteParticipantActors.clear();
        return Object.freeze({
          accepted: false,
          reason: preferredId && !preferred ? "saved_actor_missing" : result?.reason ?? "no_actor_available",
          characterId: character.id,
          preferredActorId: preferredId,
        });
      }
      const actor = population.actors.find(value => value.id === result.actorId);
      if (!actor) {
        for (const value of staged) population.release(value);
        nightRouteParticipantActors.clear();
        return Object.freeze({ accepted: false, reason: "staged_actor_missing", characterId: character.id });
      }
      staged.push(actor);
      nightRouteParticipantActors.set(character.id, actor);
    }
    nightRouteParticipantLayoutSignature = `${dinerTableau ? "diner" : "route"}:${phase}`;
    return Object.freeze({
      accepted: true,
      actorIds: Object.freeze(Object.fromEntries(
        [...nightRouteParticipantActors].map(([characterId, actor]) => [characterId, actor.id]),
      )),
    });
  }

  function savedNightRouteParticipantIds() {
    return Object.fromEntries(
      [...nightRouteParticipantActors].map(([characterId, actor]) => [characterId, actor.id]),
    );
  }

  function nightRouteSpeakerAnchor(state = nightRoute.snapshot()) {
    const speaker = state.dialogue?.speaker;
    if (speaker === NIGHT_ROUTE_CHARACTERS.kai.name) return nightRouteKaiStagePosition;
    if (speaker === NIGHT_ROUTE_CHARACTERS.rosa.name) {
      return shopkeeperActors.get("southline_diner")?.root ?? nightRouteDinerPosition;
    }
    for (const character of NIGHT_ROUTE_STAGE_CHARACTERS) {
      if (character.name !== speaker) continue;
      return nightRouteParticipantActors.get(character.id)?.root ??
        nightRouteDinerParticipantPositions.get(character.id) ?? nightRouteDinerPosition;
    }
    return nightRouteDinerPosition;
  }

  function nightRouteParticipantSnapshot() {
    return Object.freeze(nightRouteParticipantDefinitions().map(character => {
      const actor = nightRouteParticipantActors.get(character.id) ?? null;
      return Object.freeze({
        characterId: character.id,
        name: character.name,
        role: character.role,
        actorId: actor?.id ?? null,
        staged: Boolean(actor?.presentationKey === `night-route:${character.id}`),
        visible: Boolean(actor?.root?.visible),
        position: actor?.root?.position ? Object.freeze(actor.root.position.toArray()) : null,
      });
    }));
  }

  function beginNightRoute({ force = false } = {}) {
    const current = nightRoute.snapshot();
    if (current.started) {
      showToast(current.completed ? "THE NIGHT COUNT IS ALREADY FILED" : current.objective, 3.2);
      return current;
    }
    const access = nightRoute.availability(nightRouteUnlockContext());
    if (!access.unlocked) {
      const missing = access.missing.length;
      showToast(`THE NIGHT COUNT NEEDS MORE SOUTHLINE LIFE — ${missing} CONNECTION${missing === 1 ? "" : "S"} MISSING`, 3.8);
      return nightRoute.begin(nightRouteUnlockContext());
    }
    if (narrativeMissionBusy() || narrativePresentation().controlsLocked) {
      showToast("FINISH THE CURRENT CHAPTER BEFORE YOU BRING PEOPLE INTO THE COUNT", 3.2);
      return current;
    }
    if (selectedActivitySnapshot()?.status === "active" && selectedActivity !== "nightRoute") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.6);
      return current;
    }
    if (vehicles.playerVehicle && !force) {
      showToast("PARK AND MEET ROSA ON FOOT", 2.5);
      return current;
    }
    if (vehicles.playerVehicle && force) exitVehicle();
    if (wanted.snapshot().stars > 0 && !force) {
      showToast("LOSE THE POLICE ATTENTION BEFORE THE ROUTE MEETING", 2.8);
      return current;
    }
    const hub = vectorFrom(access.hubPosition);
    if (!force && controlledPosition().distanceToSquared(hub) > 7 * 7) {
      showToast("MEET ROSA AT SOUTHLINE DINER", 2.6);
      return current;
    }
    neighbourhoodRoutine.close("night_route_started");
    clearTaxiPassengerPresentation();
    const presentation = stageNightRouteParticipants(null, NIGHT_ROUTE_PHASES.BRIEFING, true);
    if (!presentation.accepted) {
      showToast("THE ROUTE MEETING CANNOT ASSEMBLE YET — GIVE THE STREET A MOMENT", 3.2);
      return current;
    }
    const started = nightRoute.begin(nightRouteUnlockContext());
    if (!started.accepted) {
      releaseNightRouteParticipants();
      return nightRoute.snapshot();
    }
    selectedActivity = "nightRoute";
    lastActivityStage = nightRoute.snapshot().phase;
    activityPresentationUntil = Infinity;
    processNightRouteEvents();
    return nightRoute.snapshot();
  }

  function beginSideActivity(kind, request = {}) {
    const vehicle = vehicles.playerVehicle;
    if (!vehicle) {
      showToast(kind === "taxi" ? "ENTER A CITY CAB FIRST" : "ENTER A SPORTS CAR FIRST", 2.3);
      return null;
    }
    if (narrativeMissionBusy()) {
      showToast(chapterTwoMissionActive() ? "FINISH BORROWED TIME FIRST" : "FINISH MARISOL'S RECOVERY FIRST", 2.3);
      return null;
    }
    if (kind === "taxi" && vehicle.kind !== "taxi") {
      showToast("TAXI SHIFTS REQUIRE A CITY CAB", 2.3);
      return null;
    }
    if (kind === "race" && vehicle.kind !== "sports") {
      showToast("HARBOUR LOOP REQUIRES A SPORTS CAR", 2.3);
      return null;
    }
    const current = selectedActivitySnapshot();
    if (current?.status === "active" && selectedActivity !== kind) {
      showToast("ANOTHER ACTIVITY IS ALREADY ACTIVE", 2.3);
      return current;
    }
    selectedActivity = kind;
    const system = selectedActivitySystem();
    if (kind === "taxi") clearTaxiPassengerPresentation();
    const storyChoices = lifeUnlockContext();
    const started = system.begin(kind === "taxi" ? {
      vehicleId: vehicle.id,
      fareId: request.fareId,
      chapterOneChoice: storyChoices.chapterOneChoice,
      chapterTwoChoice: storyChoices.chapterTwoChoice,
    } : { vehicleId: vehicle.id });
    lastActivityStage = started.stage;
    if (kind === "taxi") {
      lastTaxiDialogueSerial = started.dialogueSerial;
      gameAudio.play("taxiMeter", 0.42);
      syncTaxiPassengerPresentation(started);
    }
    activityPresentationUntil = Infinity;
    lastRaceCountdownSecond = null;
    gameAudio.play("mission", 0.48);
    showToast(kind === "taxi"
      ? `NIGHT SHIFT STORIES — PICK UP ${started.passenger?.toUpperCase?.() ?? "YOUR PASSENGER"}`
      : "HARBOUR LOOP ENTERED", 3.4);
    return started;
  }

  function processTaxiDialogue(state) {
    if (!state || state.dialogueSerial <= lastTaxiDialogueSerial) return false;
    lastTaxiDialogueSerial = state.dialogueSerial;
    const kind = state.dialogue?.kind;
    if (kind === TAXI_DIALOGUE_KINDS.BOARD) {
      gameAudio.play("taxiDoor", 0.56);
      gameAudio.play("seatbelt", 0.34);
    } else if (kind === TAXI_DIALOGUE_KINDS.SAFE || kind === TAXI_DIALOGUE_KINDS.ROUGH) {
      gameAudio.play("taxiMeter", 0.38);
      gameAudio.play("taxiDoor", 0.5);
    }
    return true;
  }

  function processRoadsidePresentation(state, playerPosition) {
    if (!state || state.phase === lastRoadsidePhase) return false;
    lastRoadsidePhase = state.phase;
    const dx = Number(state.x ?? state.position?.[0]) - Number(playerPosition?.x);
    const dz = Number(state.z ?? state.position?.[2]) - Number(playerPosition?.z);
    const nearby = Number.isFinite(dx) && Number.isFinite(dz) && dx * dx + dz * dz <= 72 * 72;
    const canPresent = nearby && !narrativePresentation().controlsLocked &&
      selectedActivitySnapshot()?.status !== "active";
    if (!canPresent) return false;
    if (state.phase === ROADSIDE_PHASES.REPORTED) {
      gameAudio.play("radio", 0.2);
      showToast("A NEIGHBOUR CALLED IT IN — PULSE ROADSIDE NOTIFIED", 3.2);
    } else if (state.phase === ROADSIDE_PHASES.RESPONDING) {
      showToast("PULSE ROADSIDE EN ROUTE — SLOW DOWN AND GIVE THEM SPACE", 3.2);
    } else if (state.phase === ROADSIDE_PHASES.REPAIRING) {
      gameAudio.play("pickup", 0.22);
      showToast("PULSE ROADSIDE — CREW ON SCENE", 2.8);
    }
    return true;
  }

  function beginLifeActivity(id, { force = false } = {}) {
    if (narrativeMissionBusy()) {
      showToast(chapterTwoMissionActive() ? "FINISH BORROWED TIME FIRST" : "FINISH MARISOL'S RECOVERY FIRST", 2.4);
      return null;
    }
    if (selectedActivitySnapshot()?.status === "active" && selectedActivity !== "life") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.5);
      return selectedActivitySnapshot();
    }
    const nearbyRadius = vehicles.playerVehicle ? 10 : 7;
    const definition = force
      ? lifeActivity.available(lifeUnlockContext()).find(activity => activity.id === String(id))
      : lifeActivity.nearby(controlledPosition(), nearbyRadius, lifeUnlockContext());
    const activityId = String(id ?? definition?.id ?? "");
    if (!definition || definition.id !== activityId) {
      showToast("GO TO AN ACTIVITY HUB TO START", 2.2);
      return null;
    }
    const vehicle = vehicles.playerVehicle;
    const started = lifeActivity.begin(activityId, {
      inVehicle: Boolean(vehicle),
      vehicleKind: vehicle?.kind ?? null,
      vehicleAccess: vehicle?.access ?? null,
      ...lifeUnlockContext(),
    });
    if (started.accepted === false) {
      const requirement = started.reason === "on_foot_required"
        ? "START THIS ACTIVITY ON FOOT"
        : started.reason === "vehicle_access_required"
          ? "THIS SHIFT REQUIRES THE PULSE LINE SHUTTLE"
        : `THIS JOB REQUIRES A ${String(definition.requiredVehicleKind ?? "WORK VEHICLE").toUpperCase()}`;
      showToast(requirement, 2.8);
      return started;
    }
    selectedActivity = "life";
    lastActivityStage = started.stage;
    activityPresentationUntil = Infinity;
    gameAudio.play("mission", 0.46);
    showToast(`${started.title} STARTED — ${definition.description}`, 4.2);
    return started;
  }

  function beginGarageShift({ force = false, workOrderId = null } = {}) {
    if (!force && !story.snapshot().chapterCompleted) {
      showToast("FINISH HOME AGAIN BEFORE TAKING A GARAGE SHIFT", 3);
      return null;
    }
    if (!force && narrativeMissionBusy()) {
      showToast(chapterTwoMissionActive() ? "FINISH BORROWED TIME FIRST" : "FINISH MARISOL'S RECOVERY FIRST", 2.6);
      return null;
    }
    if (selectedActivitySnapshot()?.status === "active" && selectedActivity !== "garage") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.5);
      return selectedActivitySnapshot();
    }
    const context = garageShiftContext({
      workOrderId,
      // Native development control is allowed to exercise the complete
      // in-memory shift without first moving Kai between every authored
      // station. Normal player interaction always supplies the live position.
      ...(force ? { position: undefined, inVehicle: false } : {}),
    });
    const clock = vectorFrom(garageShift.anchors.clockIn);
    if (!force && controlledPosition().distanceToSquared(clock) > 5.5 * 5.5) {
      showToast("WALK INTO THE LEFT SERVICE BAY AND USE THE OFFICE CLOCK", 3);
      return null;
    }
    const started = garageShift.clockIn(context);
    if (!started.accepted) {
      const message = started.reason === "one_shift_per_day" ? "ONE CAREFUL SHIFT IS ENOUGH FOR TODAY" :
        started.reason === "not_open_yet" ? "PULSE OPENS AT 07:30" :
          started.reason === "clock_in_closed" || started.reason === "closed_day" ? "THE GARAGE SHIFT BOARD IS CLOSED" :
            started.reason === "on_foot_required" ? "PARK BEFORE CLOCKING IN" :
              started.reason === "too_far" ? "USE THE OFFICE CLOCK INSIDE THE SERVICE BAY" : "SHIFT UNAVAILABLE";
      showToast(message, 3);
      return started;
    }
    selectedActivity = "garage";
    lastActivityStage = garageShift.snapshot().stage;
    activityPresentationUntil = Infinity;
    garageDiagnosisIndex = 0;
    garageConfirmedDiagnosisId = null;
    processGarageShiftEvents();
    return garageShift.snapshot();
  }

  function interactWithGarageShift() {
    const before = garageShift.snapshot();
    if (selectedActivity !== "garage" || before.status !== "active") return false;
    const context = garageShiftContext();
    let result = null;
    if (before.stage === GARAGE_SHIFT_STAGES.CUSTOMER_GREETING) result = garageShift.greetCustomer(context);
    else if (before.stage === GARAGE_SHIFT_STAGES.INSPECTION) result = garageShift.inspect(context);
    else if (before.stage === GARAGE_SHIFT_STAGES.DIAGNOSIS) {
      const choice = before.diagnosisChoices[garageDiagnosisIndex];
      result = garageShift.diagnose(choice?.id, context);
    } else if (before.stage === GARAGE_SHIFT_STAGES.PARTS) {
      const fault = GARAGE_FAULTS.find(candidate => candidate.id === garageConfirmedDiagnosisId);
      result = garageShift.collectParts(fault?.parts ?? [], context);
    } else if (before.stage === GARAGE_SHIFT_STAGES.SAFETY_CHECK) {
      const next = before.safetyChecks.find(check => !check.completed);
      result = garageShift.performSafetyCheck(next?.id, context);
    } else if (before.stage === GARAGE_SHIFT_STAGES.INVOICE) result = garageShift.submitInvoice(context);
    else {
      showToast(before.stage === GARAGE_SHIFT_STAGES.REPAIR
        ? `REPAIR ${Math.round(before.repairProgress * 100)}% — STAY AT THE LIFT`
        : before.objective, 2.2);
      return true;
    }
    processGarageShiftEvents();
    if (!result?.accepted) {
      const message = result?.reason === "too_far" ? `GO TO ${before.targetAnchorKey?.replaceAll("_", " ")?.toUpperCase?.() ?? "THE WORK STATION"}` :
        result?.reason === "on_foot_required" ? "LEAVE THE VEHICLE FIRST" : before.objective;
      showToast(message, 2.6);
    }
    return true;
  }

  function communitySkillLevels() {
    return Object.fromEntries(lifeProfile.snapshot().skills.map(skill => [
      skill.id,
      clamp(((skill.level - 1) + skill.levelProgress) / 5 * 100, 0, 100),
    ]));
  }

  function communityWorkContext(detail = {}) {
    const profile = lifeProfile.snapshot();
    return communityClockContext({
      atHouse: insideCommunityHub(),
      inVehicle: Boolean(vehicles.playerVehicle),
      wantedStars: wanted.snapshot().stars,
      skillLevels: communitySkillLevels(),
      energy: profile.needs.energy,
      hygiene: profile.needs.hygiene,
      ...detail,
    });
  }

  function explainCommunityRejection(result, fallback = "THE SHIFT CANNOT START YET") {
    const reason = String(result?.reason ?? "");
    if (reason === "outside_start_hours") return `CHECK THE POSTED HOURS — THIS SHIFT IS NOT TAKING NEW STARTS`;
    if (reason === "closed_day") return "THIS TEAM IS OFF TODAY — THE NEXT OPEN DAY IS POSTED";
    if (reason === "already_completed_today") return "ONE CAREFUL SHIFT IN THIS ROLE IS ENOUGH FOR TODAY";
    if (reason === "shift_in_progress" || reason === "paused_shift_pending") return "FINISH OR RESUME YOUR CURRENT HOUSE SHIFT";
    if (reason === "inside_harbour_skills_house_required") return "WALK INSIDE HARBOUR SKILLS HOUSE FIRST";
    if (reason === "wrong_station") return "GO TO THE HIGHLIGHTED WORK STATION";
    if (reason === "task_in_progress") return "FINISH THE CURRENT TASK BEFORE STARTING ANOTHER";
    if (reason === "shift_paused") return "RESUME THE SHIFT AT RECEPTION";
    return fallback;
  }

  function atCommunityReception(position = controlledPosition(), radius = 3.15) {
    const value = position?.isVector3 ? position : vectorFrom(position);
    return insideCommunityHub(value) && value.distanceToSquared(communityReceptionPosition) <= radius * radius;
  }

  function selectedCommunityRole() {
    return COMMUNITY_HUB_ROLES[(communityRoleSelectionIndex % COMMUNITY_HUB_ROLES.length + COMMUNITY_HUB_ROLES.length) % COMMUNITY_HUB_ROLES.length];
  }

  function advanceCommunityWorldClock(gameMinutes) {
    const minutes = Math.max(0, Number(gameMinutes) || 0);
    if (minutes <= 0) return environment.snapshot();
    const beforeEnvironment = environment.snapshot();
    const beforeDay = neighbourhoodRoutine.snapshot().dayIndex;
    const totalHours = beforeEnvironment.timeHours + minutes / 60;
    const dayAdvance = Math.max(0, Math.floor(totalHours / 24));
    const nextEnvironment = environment.setTime(totalHours);
    neighbourhoodRoutine.update(0, {
      dayIndex: beforeDay + dayAdvance,
      timeHours: nextEnvironment.timeHours,
      weather: nextEnvironment.weather,
      story: story.snapshot(),
      paused: false,
      captureSnapshot: false,
    });
    residentialRuntimeView = residentialLife.update(0, {
      dayIndex: residentialRuntimeView.dayIndex + dayAdvance,
      timeHours: nextEnvironment.timeHours,
      captureSnapshot: false,
    });
    communityRuntimeView = communityHubLife.update(0, {
      dayIndex: beforeDay + dayAdvance,
      timeHours: nextEnvironment.timeHours,
      captureSnapshot: false,
    });
    cafeRuntimeView = cafeShift.update(0, {
      dayIndex: beforeDay + dayAdvance,
      timeHours: nextEnvironment.timeHours,
      captureSnapshot: false,
    });
    marketRuntimeView = marketShift.update(0, {
      dayIndex: beforeDay + dayAdvance,
      timeHours: nextEnvironment.timeHours,
      captureSnapshot: false,
    });
    communityRuntimeClockContext.dayIndex = beforeDay + dayAdvance;
    communityRuntimeClockContext.minuteOfDay = Math.trunc(nextEnvironment.timeHours * 60) % 1440;
    cafeRuntimeClockContext.dayIndex = beforeDay + dayAdvance;
    cafeRuntimeClockContext.minuteOfDay = Math.trunc(nextEnvironment.timeHours * 60) % 1440;
    marketRuntimeClockContext.dayIndex = beforeDay + dayAdvance;
    marketRuntimeClockContext.minuteOfDay = Math.trunc(nextEnvironment.timeHours * 60) % 1440;
    lastResidentialScheduleMinute = -1;
    lastCommunityScheduleMinute = -1;
    lastCafeScheduleMinute = -1;
    lastMarketScheduleMinute = -1;
    // Re-evaluate the jumped clock, but preserve each actor's current route
    // when its authored schedule signature did not change. Forcing all twelve
    // named residents and workers through route setup in the station-complete
    // frame produced visible CPU spikes despite identical destinations.
    syncResidentialActors();
    syncCommunityStaff();
    syncCafeStaff();
    syncMarketStaff();
    syncBusinessLighting(nextEnvironment.timeHours, nextEnvironment.weather);
    return nextEnvironment;
  }

  function processCommunityHubResults() {
    const stationSerial = Math.max(0, Math.trunc(Number(communityRuntimeView.lastStationResultSerial) || 0));
    const transactionSerial = Math.max(0, Math.trunc(Number(communityRuntimeView.transactionSerial) || 0));
    if (stationSerial <= lastCommunityStationResultSerial && transactionSerial <= lastCommunityTransactionSerial) return false;
    const state = communityHubLife.snapshot();
    const stationResult = state.lastStationResult;
    if (stationResult && stationResult.serial > lastCommunityStationResultSerial) {
      lastCommunityStationResultSerial = stationResult.serial;
      const needs = stationResult.needEffects ?? stationResult.effects?.needs ?? {};
      const needResult = lifeProfile.applyNeedEffects({
        energy: Number(needs.energy) || 0,
        hygiene: Number(needs.hygiene) || 0,
      });
      neighbourhoodRoutine.applyAppetiteEffect(Number(needs.appetite) || 0);
      if (needResult.energy > 0) player.restoreStamina(needResult.energy * 0.72);
      advanceCommunityWorldClock(stationResult.gameMinutes);
      gameAudio.play(stationResult.passed ? "pickup" : "impact", stationResult.passed ? 0.34 : 0.22);
      showToast(stationResult.line, stationResult.passed ? 5.4 : 6.2);
      lastCommunityPresentationEvent = `${stationResult.serial}:${stationResult.outcome}`;
    }
    const transaction = state.lastTransaction;
    if (transaction && transaction.serial > lastCommunityTransactionSerial) {
      lastCommunityTransactionSerial = transaction.serial;
      const experience = transaction.skillEffects.reduce((sum, effect) => sum + Math.max(0, Number(effect.experience) || 0), 0);
      const profileTransaction = lifeProfile.recordShift({
        id: transaction.sourceId,
        activityId: transaction.roleId,
        dayIndex: transaction.dayIndex,
        durationMinutes: transaction.gameMinutes,
        quality: clamp(transaction.quality / 100, 0, 1),
        baseWage: transaction.wage,
        experience,
      });
      if (profileTransaction.accepted) {
        player.addCash(profileTransaction.wage);
        const trust = Math.max(2, 4 + Math.round(transaction.quality / 20) - transaction.reworkCount);
        communityTrust += trust;
        gameAudio.play("mission", 0.72);
        showToast(`${transaction.dialogue}  +$${profileTransaction.wage}  TRUST +${trust}`, 7.2);
      }
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = elapsed + 6;
    }
    return true;
  }

  function beginCommunityShift(roleId, { force = false } = {}) {
    const definition = communityRoleById.get(String(roleId ?? ""));
    if (!definition) throw new RangeError(`Unknown Harbour Skills House role: ${roleId}`);
    if (!force && narrativeMissionBusy()) {
      showToast("FINISH THE CURRENT STORY WORK FIRST", 2.8);
      return null;
    }
    const current = selectedActivitySnapshot();
    if (current?.status === "active" && selectedActivity !== "community") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.6);
      return current;
    }
    if (!force && vehicles.playerVehicle) {
      showToast("PARK OUTSIDE BEFORE CLOCKING IN", 2.5);
      return null;
    }
    if (!force && (!insideCommunityHub() || wanted.snapshot().stars > 0)) {
      showToast(wanted.snapshot().stars > 0 ? "LOSE THE POLICE BEFORE ENTERING A PUBLIC SHIFT" : "WALK INSIDE HARBOUR SKILLS HOUSE", 3);
      return null;
    }
    const result = communityHubLife.begin(definition.id, communityClockContext({
      atHouse: force || insideCommunityHub(),
      inVehicle: force ? false : Boolean(vehicles.playerVehicle),
    }));
    communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
    if (!result.accepted) {
      showToast(explainCommunityRejection(result), 3.4);
      return result;
    }
    selectedActivity = "community";
    lastActivityStage = communityRuntimeView.stationId;
    activityPresentationUntil = Infinity;
    gameAudio.play("mission", 0.48);
    showToast(result.dialogue, 6.6);
    return communityActivitySnapshot();
  }

  function interactWithCommunityShift({ force = false, quality = null, safetyConfirmed = true } = {}) {
    if (selectedActivity !== "community" || !communityRuntimeView.activeRoleId) return false;
    if (communityRuntimeView.taskActive) {
      showToast(`${communityActivitySnapshot().objective} — KEEP WORKING CAREFULLY`, 1.8);
      return true;
    }
    const logicalStation = communityStationById.get(communityRuntimeView.stationId);
    const worldStation = communityWorldStation(logicalStation?.id);
    if (!logicalStation || !worldStation) throw new Error(`No physical station for ${communityRuntimeView.stationId}`);
    const nearby = controlledPosition().distanceToSquared(vectorFrom(worldStation.position)) <= 2.85 * 2.85;
    if (!force && !nearby) {
      showToast(`GO TO ${worldStation.label}`, 2.6);
      return true;
    }
    const profile = lifeProfile.snapshot();
    const primarySkill = profile.skills.find(skill => skill.id === logicalStation.primarySkill);
    const skillScore = primarySkill ? clamp(((primarySkill.level - 1) + primarySkill.levelProgress) / 5 * 100, 0, 100) : 0;
    const workQuality = quality == null
      ? clamp(72 + skillScore * 0.18 + profile.needs.energy * 0.05, 0, 100)
      : clamp(quality, 0, 100);
    const result = communityHubLife.performStation(logicalStation.id, communityWorkContext({
      atHouse: force || insideCommunityHub(),
      inVehicle: false,
      quality: workQuality,
      safetyConfirmed: Boolean(safetyConfirmed),
    }));
    communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
    if (!result.accepted) showToast(explainCommunityRejection(result), 2.8);
    else {
      gameAudio.play("pickup", 0.26);
      showToast(`${result.instruction}  ${result.honestLine}`, 6.4);
    }
    return result;
  }

  function updateCommunityActivity(delta) {
    const position = controlledPosition();
    const stationPosition = communityWorldStationPosition(communityRuntimeView.stationId);
    const atActiveStation = Boolean(stationPosition && insideCommunityHub(position) &&
      position.distanceToSquared(stationPosition) <= 3.15 * 3.15);
    const workingDelta = communityRuntimeView.taskActive && atActiveStation ? delta : 0;
    communityRuntimeView = communityHubLife.update(workingDelta, communityRuntimeClockContext);
    processCommunityHubResults();
    if (selectedActivity !== "community") return null;
    const after = communityActivitySnapshot();
    if (after.stage !== lastActivityStage) lastActivityStage = after.stage;
    return after;
  }

  function explainCafeRejection(result, fallback = "THE CAFE SHIFT CANNOT START YET") {
    const reason = String(result?.reason ?? "");
    if (reason === "cafe_closed") return `COMMON GROUND IS CLOSED — ${cafeShift.cafe.openingHours.label}`;
    if (reason === "outside_clock_in_hours") return `THE CAFE IS OPEN, BUT TODAY'S SHIFT CLOCK-IN HAS CLOSED`;
    if (reason === "supervisor_off_day") return "ASHA IS OFF TODAY — THE NEXT SUPERVISED TRAINING SHIFT IS POSTED";
    if (reason === "supervisor_unavailable") return "ASHA IS NOT AT THE CAFE — RESUME WHEN THE SHIFT LEAD RETURNS";
    if (reason === "already_completed_today") return "ONE COMPLETE CAFE SHIFT IS ENOUGH FOR TODAY";
    if (reason === "already_active") return "YOUR COMMON GROUND SHIFT IS ALREADY ACTIVE";
    if (reason === "inside_common_ground_cafe_required") return "WALK INSIDE COMMON GROUND CAFE FIRST";
    if (reason === "wrong_station") return "GO TO THE HIGHLIGHTED CAFE WORK STATION";
    if (reason === "task_in_progress") return "FINISH THE CURRENT CAFE TASK FIRST";
    if (reason === "shift_paused") return "RESUME WITH ASHA AT THE HANDOVER POINT";
    return fallback;
  }

  function atCafeHandover(position = controlledPosition(), radius = 1.75) {
    const value = position?.isVector3 ? position : vectorFrom(position);
    return insideCommonGroundCafe(value) && value.distanceToSquared(cafeHandoverPosition) <= radius * radius;
  }

  function processCafeShiftResults() {
    const stationSerial = Math.max(0, Math.trunc(Number(cafeRuntimeView.lastStationResultSerial) || 0));
    const transactionSerial = Math.max(0, Math.trunc(Number(cafeRuntimeView.transactionSerial) || 0));
    if (stationSerial <= lastCafeStationResultSerial && transactionSerial <= lastCafeTransactionSerial) return false;
    const state = cafeShift.snapshot();
    const stationResult = state.lastStationResult;
    if (stationResult && stationResult.serial > lastCafeStationResultSerial) {
      lastCafeStationResultSerial = stationResult.serial;
      cafeQuality = Math.max(0, Math.round(Number(stationResult.score) || 0));
      cafeReworkCount = Math.max(0, Math.trunc(Number(stationResult.reworkCount) || 0));
      const needs = stationResult.needEffects ?? stationResult.effects?.needs ?? {};
      const needResult = lifeProfile.applyNeedEffects({
        energy: Number(needs.energy) || 0,
        hygiene: Number(needs.hygiene) || 0,
      });
      neighbourhoodRoutine.applyAppetiteEffect(Number(needs.appetite) || 0);
      if (needResult.energy > 0) player.restoreStamina(needResult.energy * 0.72);
      advanceCommunityWorldClock(stationResult.gameMinutes);
      gameAudio.play(stationResult.passed ? "pickup" : "impact", stationResult.passed ? 0.32 : 0.22);
      showToast(stationResult.line, stationResult.passed ? 5.5 : 6.4);
      lastCafePresentationEvent = `${stationResult.serial}:${stationResult.outcome}`;
    }
    const transaction = state.lastTransaction;
    if (transaction && transaction.serial > lastCafeTransactionSerial) {
      lastCafeTransactionSerial = transaction.serial;
      const experience = transaction.skillEffects.reduce((sum, effect) =>
        sum + Math.max(0, Number(effect.experience) || 0), 0);
      const profileTransaction = lifeProfile.recordShift({
        id: transaction.sourceId,
        activityId: transaction.activityId,
        dayIndex: transaction.dayIndex,
        durationMinutes: transaction.gameMinutes,
        quality: clamp(transaction.quality / 100, 0, 1),
        baseWage: transaction.wage,
        experience,
      });
      if (profileTransaction.accepted) {
        player.addCash(profileTransaction.wage);
        communityTrust += Math.max(0, Math.trunc(Number(transaction.trustReward) || 0));
        gameAudio.play("mission", 0.68);
        showToast(`${transaction.dialogue}  +$${profileTransaction.wage}  TRUST +${transaction.trustReward}`, 7.4);
      }
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = elapsed + 6;
    }
    cafeActivityCacheKey = "";
    return true;
  }

  function beginCafeShift({ force = false } = {}) {
    if (!force && narrativeMissionBusy()) {
      showToast("FINISH THE CURRENT STORY WORK FIRST", 2.8);
      return null;
    }
    const current = selectedActivitySnapshot();
    if (current?.status === "active" && selectedActivity !== "cafe") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.6);
      return current;
    }
    if (!force && vehicles.playerVehicle) {
      showToast("PARK OUTSIDE BEFORE CLOCKING IN", 2.5);
      return null;
    }
    const supervisor = cafeShift.staffState(ASHA_PATEL.id, cafeClockContext());
    const supervisorActor = cafeStaffActors.get(ASHA_PATEL.id);
    const supervisorPresent = supervisor?.workingDay && supervisor?.locationId === commonGroundCafeWorld.id &&
      supervisorActor?.alive && insideCommonGroundCafe(supervisorActor.root.position);
    if (!force && !supervisorPresent) {
      showToast(supervisor?.workingDay
        ? "ASHA IS STILL ON HER WAY — THE HANDOVER STARTS WHEN THE SHIFT LEAD ARRIVES"
        : "ASHA IS OFF TODAY — THE NEXT SUPERVISED TRAINING SHIFT IS POSTED", 4.2);
      return null;
    }
    if (!force && (!insideCommonGroundCafe() || !atCafeHandover() || wanted.snapshot().stars > 0)) {
      showToast(wanted.snapshot().stars > 0
        ? "LOSE THE POLICE BEFORE STARTING A PUBLIC SHIFT"
        : "GO TO THE SHIFT HANDOVER INSIDE COMMON GROUND", 3);
      return null;
    }
    const result = cafeShift.begin(cafeClockContext());
    cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
    if (!result.accepted) {
      showToast(explainCafeRejection(result), 3.4);
      return result;
    }
    selectedActivity = "cafe";
    lastActivityStage = cafeRuntimeView.stationId;
    activityPresentationUntil = Infinity;
    const shiftState = cafeShift.snapshot().activeShift;
    cafeQuality = Math.max(0, Math.round(Number(shiftState?.quality) || 0));
    cafeReworkCount = Math.max(0, Math.trunc(Number(shiftState?.reworkCount) || 0));
    cafeActivityCacheKey = "";
    gameAudio.play("mission", 0.46);
    showToast(result.dialogue, 6.8);
    return cafeActivitySnapshot();
  }

  function interactWithCafeShift({ force = false, quality = null, safetyConfirmed = true } = {}) {
    if (selectedActivity !== "cafe" || !cafeRuntimeView.stationId) return false;
    if (cafeRuntimeView.taskActive) {
      showToast(`${cafeActivitySnapshot().objective} — STAY AT THE WORK STATION`, 1.8);
      return true;
    }
    const station = cafeStationById.get(cafeRuntimeView.stationId);
    const worldStation = cafeWorldStationById.get(station?.worldStationId ?? station?.id);
    if (!station || !worldStation) throw new Error(`No physical cafe station for ${cafeRuntimeView.stationId}`);
    const nearby = controlledPosition().distanceToSquared(vectorFrom(worldStation.position)) <= 2.85 * 2.85;
    if (!force && !nearby) {
      showToast(`GO TO ${worldStation.label}`, 2.6);
      return true;
    }
    const profile = lifeProfile.snapshot();
    const primarySkill = profile.skills.find(skill => skill.id === station.primarySkill);
    const skillScore = primarySkill ? clamp(((primarySkill.level - 1) + primarySkill.levelProgress) / 5 * 100, 0, 100) : 0;
    const workQuality = quality == null
      ? clamp(70 + skillScore * 0.2 + profile.needs.energy * 0.06 + profile.needs.hygiene * 0.04, 0, 100)
      : clamp(quality, 0, 100);
    const result = cafeShift.performStation(station.id, cafeClockContext({
      insideCafe: force || insideCommonGroundCafe(),
      quality: workQuality,
      skillLevels: { [station.primarySkill]: skillScore },
      safetyConfirmed: Boolean(safetyConfirmed),
    }));
    cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
    cafeActivityCacheKey = "";
    if (!result.accepted) showToast(explainCafeRejection(result), 2.8);
    else {
      gameAudio.play("pickup", 0.25);
      showToast(`${result.instruction}  ${result.honestLine}`, 6.6);
    }
    return result;
  }

  function updateCafeActivity(delta) {
    const position = controlledPosition();
    const stationPosition = cafeWorldStationPositions.get(cafeRuntimeView.stationId);
    const atActiveStation = Boolean(stationPosition && insideCommonGroundCafe(position) &&
      position.distanceToSquared(stationPosition) <= 3.15 * 3.15);
    const workingDelta = cafeRuntimeView.taskActive && atActiveStation ? delta : 0;
    cafeRuntimeView = cafeShift.update(workingDelta, cafeRuntimeClockContext);
    processCafeShiftResults();
    if (selectedActivity !== "cafe") return null;
    const after = cafeActivitySnapshot();
    if (after.stage !== lastActivityStage) lastActivityStage = after.stage;
    return after;
  }

  function explainMarketRejection(result, fallback = "MINA'S MARKET SHIFT CANNOT START YET") {
    const reason = String(result?.reason ?? "");
    if (reason === "market_closed") return `MINA'S MARKET IS CLOSED — ${marketShift.postedHours.label}`;
    if (reason === "outside_clock_in_hours") return "THE MARKET IS OPEN, BUT TODAY'S SHIFT CLOCK-IN HAS CLOSED";
    if (reason === "already_completed_today") return "ONE COMPLETE MARKET SHIFT IS ENOUGH FOR TODAY";
    if (reason === "already_active") return "YOUR MARKET SHIFT IS ALREADY ACTIVE";
    if (reason === "on_foot_required") return "PARK OUTSIDE BEFORE STARTING MARKET WORK";
    if (reason === "wrong_station" || reason === "station_too_far") return "GO TO THE HIGHLIGHTED MARKET WORK STATION";
    if (reason === "task_in_progress") return "FINISH THE CURRENT MARKET TASK FIRST";
    if (reason === "surplus_decision_required") return "RETURN TO THE PANTRY SHELF AND RECORD A SURPLUS DECISION";
    if (reason === "shift_paused") return "RESUME WITH MINA AT THE HANDOVER COUNTER";
    if (reason === "duplicate_source") return "THAT MARKET ACTION HAS ALREADY BEEN RECORDED";
    return fallback;
  }

  function atMarketHandover(position = controlledPosition(), radius = 2.05) {
    const value = position?.isVector3 ? position : vectorFrom(position);
    return insideMinaMarket(value) && value.distanceToSquared(marketHandoverPosition) <= radius * radius;
  }

  function marketCommandSource(kind, stationId = "") {
    const serial = Math.max(0, Math.trunc(Number(marketShift.snapshot().serials.command) || 0)) + 1;
    return `market:${kind}:${marketClockContext().dayIndex}:${stationId}:${serial}`;
  }

  function processMarketShiftResults() {
    const stationSerial = Math.max(0, Math.trunc(Number(marketRuntimeView.stationResultSerial) || 0));
    const transactionSerial = Math.max(0, Math.trunc(Number(marketRuntimeView.transactionSerial) || 0));
    if (stationSerial <= lastMarketStationResultSerial && transactionSerial <= lastMarketTransactionSerial) return false;
    const state = marketShift.snapshot();
    const stationResult = state.lastStationResult;
    if (stationResult && stationResult.serial > lastMarketStationResultSerial) {
      lastMarketStationResultSerial = stationResult.serial;
      const needs = stationResult.effects?.needs ?? {};
      const needResult = lifeProfile.applyNeedEffects({
        energy: Number(needs.energy) || 0,
        hygiene: Number(needs.hygiene) || 0,
      });
      neighbourhoodRoutine.applyAppetiteEffect(Number(needs.appetite) || 0);
      if (needResult.energy > 0) player.restoreStamina(needResult.energy * 0.72);
      advanceCommunityWorldClock(stationResult.effects?.gameMinutes ?? 0);
      const active = state.activeShift;
      marketQuality = active?.passedStations
        ? Math.round(active.qualityTotal / Math.max(1, active.passedStations))
        : Math.max(0, Math.round(Number(stationResult.quality) || 0));
      marketReworkCount = Math.max(0, Math.trunc(Number(active?.reworkCount) || 0));
      gameAudio.play(stationResult.passed ? "pickup" : "impact", stationResult.passed ? 0.32 : 0.22);
      showToast(stationResult.line, stationResult.passed ? 5.8 : 6.6);
      lastMarketPresentationEvent = `${stationResult.serial}:${stationResult.outcome}`;
    }
    const transaction = state.lastTransaction;
    if (transaction && transactionSerial > lastMarketTransactionSerial) {
      lastMarketTransactionSerial = transactionSerial;
      const experience = transaction.skillEffects.reduce((sum, effect) =>
        sum + Math.max(0, Number(effect.experience) || 0), 0);
      const profileTransaction = lifeProfile.recordShift({
        id: transaction.idempotencySourceId,
        activityId: transaction.activityId,
        dayIndex: transaction.dayIndex,
        durationMinutes: transaction.gameMinutes,
        quality: clamp(transaction.quality / 100, 0, 1),
        baseWage: transaction.wage,
        exactWage: transaction.cashEffect,
        experience,
      });
      if (profileTransaction.accepted) {
        player.addCash(transaction.cashEffect);
        communityTrust = Math.max(0, communityTrust + Math.trunc(Number(transaction.communityTrust) || 0));
        gameAudio.play("mission", 0.7);
        showToast(`${transaction.completionLine}  +$${transaction.cashEffect}  TRUST ${transaction.communityTrust >= 0 ? "+" : ""}${transaction.communityTrust}`, 8);
      }
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = elapsed + 6;
    }
    marketActivityCacheKey = "";
    return true;
  }

  function beginMarketShift({ force = false } = {}) {
    if (!force && narrativeMissionBusy()) {
      showToast("FINISH THE CURRENT STORY WORK FIRST", 2.8);
      return null;
    }
    const current = selectedActivitySnapshot();
    if (current?.status === "active" && selectedActivity !== "market") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.6);
      return current;
    }
    if (!force && vehicles.playerVehicle) {
      showToast("PARK OUTSIDE BEFORE CLOCKING IN", 2.5);
      return null;
    }
    const supervisor = marketShift.staffState(MINA_OKAFOR.id, marketClockContext());
    const supervisorActor = marketStaffActors.get(MINA_OKAFOR.id);
    const supervisorPresent = supervisor?.atWork && supervisorActor?.alive && insideMinaMarket(supervisorActor.root.position);
    if (!force && !supervisorPresent) {
      showToast("MINA IS NOT ON THE FLOOR — RETURN DURING THE POSTED SUPERVISED HOURS", 4.2);
      return null;
    }
    if (!force && (!atMarketHandover() || wanted.snapshot().stars > 0)) {
      showToast(wanted.snapshot().stars > 0
        ? "LOSE THE POLICE BEFORE STARTING PUBLIC-FACING WORK"
        : "GO TO MINA'S HANDOVER COUNTER INSIDE THE MARKET", 3.2);
      return null;
    }
    const pausedShift = marketShift.snapshot().activeShift?.status === "paused";
    const resumeStation = pausedShift
      ? marketWorldStation(marketShift.snapshot().activeShift?.nextStationId)
      : null;
    const startContext = marketClockContext({
      onFoot: true,
      nearbyStationId: resumeStation?.id ?? "mina-order-counter",
      sourceId: marketCommandSource(pausedShift ? "resume" : "begin", "mina-order-counter"),
    });
    const result = pausedShift ? marketShift.resume(startContext) : marketShift.begin(startContext);
    marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
    if (!result.accepted) {
      showToast(explainMarketRejection(result), 3.5);
      return result;
    }
    selectedActivity = "market";
    lastActivityStage = marketRuntimeView.stationId;
    activityPresentationUntil = Infinity;
    marketQuality = 0;
    marketReworkCount = 0;
    marketDecisionIndex = 1;
    marketActivityCacheKey = "";
    gameAudio.play("mission", 0.48);
    showToast(result.briefing ?? "MINA: Your task record is preserved. Continue from the highlighted station and leave the handover honest.", 8);
    return marketActivitySnapshot();
  }

  function chooseMarketSurplus({ force = false, decisionId = null } = {}) {
    if (selectedActivity !== "market" || !marketRuntimeView.decisionRequired) return false;
    const pantry = marketWorldStationById.get("mina-pantry-shelf");
    const nearby = pantry && controlledPosition().distanceToSquared(vectorFrom(pantry.position)) <= 2.85 * 2.85;
    if (!force && !nearby) {
      showToast("RETURN TO THE PANTRY SHELF TO RECORD THE SURPLUS DECISION", 3);
      return true;
    }
    const decision = MARKET_SURPLUS_DECISIONS.find(value => value.id === decisionId) ??
      MARKET_SURPLUS_DECISIONS[marketDecisionIndex] ?? MARKET_SURPLUS_DECISIONS[0];
    const result = marketShift.chooseSurplus(decision.id, marketClockContext({
      onFoot: true,
      nearbyStationId: "mina-pantry-shelf",
      sourceId: marketCommandSource("surplus", decision.id),
    }));
    marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
    marketActivityCacheKey = "";
    if (!result.accepted) {
      showToast(explainMarketRejection(result), 3);
      return result;
    }
    const needs = result.result?.needEffects ?? {};
    lifeProfile.applyNeedEffects({ energy: Number(needs.energy) || 0, hygiene: Number(needs.hygiene) || 0 });
    neighbourhoodRoutine.applyAppetiteEffect(Number(needs.appetite) || 0);
    advanceCommunityWorldClock(result.result?.gameMinutes ?? 0);
    showToast(`${result.result.line}  ${result.result.tradeoff}`, 9);
    return result;
  }

  function interactWithMarketShift({ force = false, quality = null, safetyConfirmed = true, decisionId = null } = {}) {
    if (selectedActivity !== "market") return false;
    if (marketRuntimeView.decisionRequired) return chooseMarketSurplus({ force, decisionId });
    if (!marketRuntimeView.stationId) return false;
    if (marketRuntimeView.taskActive) {
      showToast(`${marketActivitySnapshot().objective} — STAY AT THE WORK STATION`, 1.8);
      return true;
    }
    const station = marketStationById.get(marketRuntimeView.stationId);
    const worldStation = marketWorldStation(station);
    if (!station || !worldStation) throw new Error(`No physical market station for ${marketRuntimeView.stationId}`);
    const nearby = controlledPosition().distanceToSquared(vectorFrom(worldStation.position)) <= 2.85 * 2.85;
    if (!force && !nearby) {
      showToast(`GO TO ${worldStation.label}`, 2.6);
      return true;
    }
    const profile = lifeProfile.snapshot();
    const primarySkill = profile.skills.find(skill => skill.id === station.primarySkill);
    const skillScore = primarySkill ? clamp(((primarySkill.level - 1) + primarySkill.levelProgress) / 5 * 100, 0, 100) : 0;
    const workQuality = quality == null
      ? clamp(72 + skillScore * 0.18 + profile.needs.energy * 0.05 + profile.needs.hygiene * 0.03, 0, 100)
      : clamp(quality, 0, 100);
    const result = marketShift.performStation(station.id, marketClockContext({
      onFoot: true,
      nearbyStationId: worldStation.id,
      quality: workQuality,
      skillLevels: { [station.primarySkill]: skillScore },
      safetyConfirmed: Boolean(safetyConfirmed),
      sourceId: marketCommandSource("station", station.id),
    }));
    marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
    marketActivityCacheKey = "";
    if (!result.accepted) showToast(explainMarketRejection(result), 2.9);
    else {
      gameAudio.play("pickup", 0.25);
      showToast(`${result.instruction}  ${result.supervisorLine}`, 7.2);
    }
    return result;
  }

  function updateMarketActivity(delta) {
    const logical = marketRuntimeView.decisionRequired
      ? marketStationById.get("mina-pantry-shelf")
      : marketStationById.get(marketRuntimeView.stationId);
    const station = marketWorldStation(logical);
    const position = controlledPosition();
    const atActiveStation = Boolean(station && insideMinaMarket(position) &&
      position.distanceToSquared(vectorFrom(station.position)) <= 3.15 * 3.15);
    const workingDelta = marketRuntimeView.taskActive && atActiveStation ? delta : 0;
    marketRuntimeView = marketShift.update(workingDelta, marketRuntimeClockContext);
    processMarketShiftResults();
    if (selectedActivity !== "market") return null;
    const after = marketActivitySnapshot();
    if (after.stage !== lastActivityStage) lastActivityStage = after.stage;
    return after;
  }

  function beginBasketballActivity({ force = false } = {}) {
    if (narrativeMissionBusy()) {
      showToast(chapterTwoMissionActive() ? "FINISH BORROWED TIME FIRST" : "FINISH MARISOL'S RECOVERY FIRST", 2.4);
      return null;
    }
    if (vehicles.playerVehicle) {
      showToast("HARBOUR COURT STARTS ON FOOT", 2.5);
      return null;
    }
    const current = selectedActivitySnapshot();
    if (current?.status === "active" && selectedActivity !== "basketball") {
      showToast("FINISH OR CANCEL YOUR CURRENT ACTIVITY", 2.5);
      return current;
    }
    const hub = vectorFrom(world.missionPoints.harbourCourt);
    if (!force && controlledPosition().distanceToSquared(hub) > 7 * 7) {
      showToast("GO TO THE HARBOUR COURT BALL RACK", 2.4);
      return null;
    }
    selectedActivity = "basketball";
    const started = basketballActivity.begin({ inVehicle: false });
    lastActivityStage = started.stage;
    lastBasketballEvent = started.lastEvent;
    activityPresentationUntil = Infinity;
    gameAudio.play("mission", 0.46);
    showToast("HARBOUR COURT — FIVE SHOTS, PRESS E TO SET AND RELEASE", 4.2);
    return started;
  }

  function updateSideActivity(delta) {
    if (selectedActivity === "community") return updateCommunityActivity(delta);
    if (selectedActivity === "cafe") return updateCafeActivity(delta);
    if (selectedActivity === "market") return updateMarketActivity(delta);
    const system = selectedActivitySystem();
    if (!system) return null;
    const before = system.snapshot();

    if (selectedActivity === "garage") {
      const target = before.targetPosition ? vectorFrom(before.targetPosition) : null;
      const working = before.stage !== GARAGE_SHIFT_STAGES.REPAIR ||
        Boolean(target && controlledPosition().distanceToSquared(target) <= 5.5 * 5.5);
      const after = garageShift.update(delta, { working, captureSnapshot: true });
      processGarageShiftEvents();
      const activityStage = after.stage;
      if (activityStage !== lastActivityStage) lastActivityStage = activityStage;
      if (after.status === "completed" && elapsed >= activityPresentationUntil) {
        releaseGarageCustomerPresentation();
        garageShift.reset();
        selectedActivity = null;
        lastActivityStage = null;
        garageDiagnosisIndex = 0;
        garageConfirmedDiagnosisId = null;
      }
      return after;
    }

    const vehicle = vehicles.playerVehicle;
    const assigned = before.assignedVehicleId ? vehicles.get(before.assignedVehicleId) : vehicle;
    const position = vehicle?.root?.position ?? controlledPosition();
    const speed = Math.abs(Number(vehicle?.state?.speed) || 0);
    const common = {
      position,
      vehicleId: vehicle?.id ?? null,
      speed,
      wantedStars: wanted.snapshot().stars,
      vehicleDestroyed: Boolean(before.assignedVehicleId && (!assigned || assigned.health <= 0)),
      offRoad: !world.isRoad?.(position.x, position.z),
      isTaxi: vehicle?.kind === "taxi",
      validVehicle: Boolean(vehicle),
      inVehicle: Boolean(vehicle),
      vehicleKind: vehicle?.kind ?? null,
      vehicleAccess: vehicle?.access ?? null,
    };
    const after = system.update(delta, common);
    if (selectedActivity === "life") processLifeActivityEvents();
    if (selectedActivity === "taxi") processTaxiDialogue(after);
    if (selectedActivity === "nightRoute") processNightRouteEvents();
    const activityStage = after.stage ?? after.phase;

    if (selectedActivity === "race" && after.stage === RACE_STAGES.COUNTDOWN) {
      const second = Math.max(1, Math.ceil(after.countdownRemaining));
      if (second !== lastRaceCountdownSecond) {
        lastRaceCountdownSecond = second;
        gameAudio.play("pickup", 0.32);
        showToast(String(second), 0.72);
      }
    }
    if (selectedActivity === "basketball" && after.lastEvent !== lastBasketballEvent) {
      lastBasketballEvent = after.lastEvent;
      if (after.lastEvent === "perfect_basket") {
        gameAudio.play("pickup", 0.62);
        showToast(`PERFECT — ${after.points} POINTS`, 1.8);
      } else if (after.lastEvent === "basket_scored") {
        gameAudio.play("pickup", 0.48);
        showToast(`BUCKET — ${after.made}/${after.stopCount} MADE`, 1.7);
      } else if (after.lastEvent === "basket_missed") {
        gameAudio.playAt("impact", 0.24, world.missionPoints.harbourCourt);
        showToast(`OFF THE RIM — ${after.stopCount - after.stopIndex} SHOTS LEFT`, 1.6);
      }
    }
    if (activityStage !== lastActivityStage) {
      if (selectedActivity === "taxi" && after.stage === TAXI_STAGES.DROPOFF) {
        showToast(`${after.passenger?.toUpperCase?.() ?? "PASSENGER"} ON BOARD`, 2.5);
      } else if (selectedActivity === "race" && after.stage === RACE_STAGES.RACING) {
        gameAudio.play("mission", 0.56);
        showToast("GO!", 1.4);
      } else if (after.status === "completed" && selectedActivity !== "nightRoute") {
        player.addCash(after.payout);
        const earnsTrust = selectedActivity === "life" || selectedActivity === "basketball";
        if (earnsTrust) communityTrust += Math.max(0, Number(after.trustReward) || 0);
        const profileActivityId = selectedActivity === "life" ? after.id :
          selectedActivity === "basketball" ? "harbour_court" :
            selectedActivity === "taxi" ? "taxi" :
              selectedActivity === "race" ? "harbour_loop" : null;
        if (profileActivityId) {
          lifeProfile.awardActivityExperience(
            profileActivityId,
            selectedActivity === "life" ? 52 : selectedActivity === "basketball" ? 42 : 48,
            { sourceId: `${profileActivityId}:completion:${Math.max(1, Math.trunc(Number(after.completedCount) || 1))}` },
          );
        }
        gameAudio.play("mission", 0.72);
        showToast(`${after.title} COMPLETE +$${after.payout}${earnsTrust ? `  TRUST +${after.trustReward}` : ""}`, 5);
        activityPresentationUntil = elapsed + 6;
      } else if (after.status === "failed") {
        showToast(`${after.title} FAILED — ${String(after.failureReason ?? "TRY AGAIN").replaceAll("_", " ").toUpperCase()}`, 4);
        activityPresentationUntil = elapsed + 5;
      }
      lastActivityStage = activityStage;
    }
    if ((after.status === "completed" || after.status === "failed") && elapsed >= activityPresentationUntil) {
      selectedActivity = null;
      lastActivityStage = null;
      lastTaxiDialogueSerial = 0;
      lastRaceCountdownSecond = null;
      lastBasketballEvent = null;
      cachedNightRouteNarrativeSource = null;
      cachedNightRouteNarrative = null;
    }
    return after;
  }

  function enterVehicle(value = null) {
    if (!player.alive || player.vehicle) return null;
    const courtRound = selectedActivity === "basketball" ? basketballActivity.snapshot() : null;
    if (courtRound?.status === "active") return null;
    const vehicle = value
      ? typeof value === "string" ? vehicles.get(value) : value
      : vehicles.nearestEnterable(player.root.position, 3.6);
    if (!vehicle) return null;
    if (selectedActivity === "cafe" && cafeRuntimeView.status === "active") {
      cafeShift.pause(cafeClockContext());
      cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = 0;
      cafeActivityCacheKey = "";
      showToast("COMMON GROUND SHIFT PAUSED — RESUME AT THE HANDOVER POINT", 3.6);
    }
    if (selectedActivity === "market" && marketRuntimeView.status === "active") {
      marketShift.pause(marketClockContext({ sourceId: marketCommandSource("pause", "vehicle") }));
      marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = 0;
      marketActivityCacheKey = "";
      showToast("MINA'S MARKET SHIFT PAUSED — RESUME AT THE HANDOVER COUNTER", 3.8);
    }
    const entered = vehicles.enter(vehicle, { authorized: vehicle.authorized && !vehicle.missionTarget });
    if (!entered) return null;
    player.enterVehicle(entered);
    chaseCamera.snapBehind(entered.state?.yaw ?? entered.root.rotation.y);
    const missionBefore = mission.snapshot();
    const result = mission.notify({
      type: "vehicle_entered",
      vehicleId: entered.id,
      wantedStars: wanted.snapshot().stars,
    });
    const recoveredTarget = entered.missionTarget && missionBefore.stage === MISSION_STAGES.STEAL && result.stage !== MISSION_STAGES.STEAL;
    if (recoveredTarget) {
      story.notify({ type: "vehicle_recovered", vehicleId: entered.id });
      processStoryEvents();
      showToast("MARISOL'S COMET RECOVERED — VOSS FILED A FALSE THEFT FLAG", 4.2);
    } else {
      showToast(entered.authorized ? `DRIVING ${entered.kind.toUpperCase()}` : `TOOK ${entered.kind.toUpperCase()}`, 2.2);
    }
    return entered;
  }

  function exitVehicle() {
    if (!player.vehicle) return null;
    const side = selectedActivitySnapshot();
    if (side?.status === "active") {
      if (selectedActivity === "taxi" && side.stage === TAXI_STAGES.DROPOFF) taxiActivity.notify({ type: "passenger_abandoned" });
      else if (selectedActivity === "race") raceActivity.notify({ type: "race_cancelled" });
    }
    const position = vehicles.exit();
    if (!position) return null;
    player.exitVehicle(position);
    return position;
  }

  function respawnPlayer() {
    if (vehicles.playerVehicle) vehicles.exit();
    if (selectedActivity === "garage") {
      releaseGarageCustomerPresentation();
      garageShift.restore(initialGarageShiftSave);
      selectedActivity = null;
      lastActivityStage = null;
      garageDiagnosisIndex = 0;
      garageConfirmedDiagnosisId = null;
      activityPresentationUntil = 0;
    }
    if (selectedActivity === "community") {
      communityHubLife.cancel(communityClockContext());
      communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = 0;
    }
    if (selectedActivity === "cafe") {
      cafeShift.pause(cafeClockContext());
      cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = 0;
    }
    if (selectedActivity === "market") {
      marketShift.pause(marketClockContext({ sourceId: marketCommandSource("pause", "respawn") }));
      marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
      selectedActivity = null;
      lastActivityStage = null;
      activityPresentationUntil = 0;
      marketActivityCacheKey = "";
    }
    player.exitVehicle(hospitalPosition);
    player.respawn(hospitalPosition);
    player.addCash(-500);
    wanted.clear();
    deathAt = null;
    chaseCamera.snapBehind(Math.PI);
    showToast("WASTED — HOSPITAL FEE $500", 3.5);
  }

  function persistentWorldClock(environmentValue = environment.snapshot(), neighbourhoodValue = neighbourhoodRoutine.snapshot(), explicit = null) {
    const rawHours = Number(environmentValue?.timeHours);
    const hours = Number.isFinite(rawHours) ? ((rawHours % 24) + 24) % 24 : 0;
    const environmentMinute = Math.trunc(hours * 60) % 1440;
    const explicitMinute = Number(explicit?.minuteOfDay);
    const minuteOfDay = Number.isFinite(explicitMinute)
      ? ((Math.trunc(explicitMinute) % 1440) + 1440) % 1440
      : environmentMinute;
    const explicitDay = Number(explicit?.dayIndex);
    let dayIndex = Number.isFinite(explicitDay)
      ? Math.max(0, Math.trunc(explicitDay))
      : Math.max(0, Math.trunc(Number(neighbourhoodValue?.dayIndex) || 0));
    if (!Number.isFinite(explicitDay)) {
      const routineMinute = ((Math.trunc(Number(neighbourhoodValue?.minuteOfDay) || 0) % 1440) + 1440) % 1440;
      // The environment advances after the daily systems in fixedUpdate. On
      // the single frame that crosses midnight it is already on minute zero
      // while the routine clock still reports 23:59; attribute that frame to
      // the new day so a save can never contain split calendar identities.
      if (minuteOfDay < routineMinute - 720) dayIndex += 1;
    }
    return Object.freeze({ dayIndex, minuteOfDay, timeHours: hours });
  }

  function persistentSnapshot() {
    const environmentSave = environment.snapshot();
    const neighbourhoodSave = neighbourhoodRoutine.save();
    const clock = persistentWorldClock(environmentSave, neighbourhoodSave);
    neighbourhoodSave.dayIndex = clock.dayIndex;
    neighbourhoodSave.minuteOfDay = clock.minuteOfDay;
    neighbourhoodSave.previousMinuteOfDay = clock.minuteOfDay;
    const residentialSave = residentialLife.save();
    residentialSave.clock = {
      ...residentialSave.clock,
      dayIndex: clock.dayIndex,
      minuteOfDay: clock.minuteOfDay,
      previousMinuteOfDay: clock.minuteOfDay,
    };
    const communitySave = communityHubLife.save();
    communitySave.clock = { dayIndex: clock.dayIndex, minuteOfDay: clock.minuteOfDay };
    const cafeSave = cafeShift.save();
    cafeSave.clock = { dayIndex: clock.dayIndex, minuteOfDay: clock.minuteOfDay };
    const marketSave = marketShift.save();
    return {
      version: 14,
      clock,
      elapsed,
      player: player.snapshot(),
      wanted: wanted.snapshot(),
      mission: mission.snapshot(),
      story: story.save(),
      chapterTwo: chapterTwo.save(),
      communityTrust,
      vehicles: vehicles.snapshot(),
      environment: environmentSave,
      neighbourhood: neighbourhoodSave,
      neighbourhoodAppliedSerial: lastNeighbourhoodTransactionSerial,
      lifeProfile: lifeProfile.save(),
      residential: residentialSave,
      residentialApplied: {
        transactionSerial: lastResidentialTransactionSerial,
        interactionSerial: lastResidentialInteractionSerial,
      },
      residentialActors: residentialActorRuntimeSnapshot(),
      interiorOccupancy: interiorOccupancy.save(),
      mapNavigation: mapNavigation.save(),
      roadside: roadsideResponse?.save() ?? null,
      activities: {
        selected: selectedActivity,
        taxi: taxiActivity.save(),
        race: raceActivity.save(),
        life: lifeActivity.save(),
        basketball: basketballActivity.save(),
        garage: garageShift.save(),
        garageRuntime: {
          confirmedDiagnosisId: garageConfirmedDiagnosisId,
        },
        community: communitySave,
        communityRuntime: {
          appliedStationResultSerial: lastCommunityStationResultSerial,
          appliedTransactionSerial: lastCommunityTransactionSerial,
          selectedRoleIndex: communityRoleSelectionIndex,
          staffActors: communityStaffRuntimeSnapshot(),
        },
        cafe: cafeSave,
        cafeRuntime: {
          appliedStationResultSerial: lastCafeStationResultSerial,
          appliedTransactionSerial: lastCafeTransactionSerial,
          staffActors: cafeStaffRuntimeSnapshot(),
        },
        market: marketSave,
        marketRuntime: {
          appliedStationResultSerial: lastMarketStationResultSerial,
          appliedTransactionSerial: lastMarketTransactionSerial,
          decisionIndex: marketDecisionIndex,
          staffActors: marketStaffRuntimeSnapshot(),
        },
        nightRoute: nightRoute.save(),
        nightRouteRuntime: {
          participantActorIds: savedNightRouteParticipantIds(),
          handledEventSerial: lastNightRouteHandledEventSerial,
          completionEventsHandled: nightRouteCompletionEventsHandled,
          lastHandledEvent: lastNightRouteHandledEvent,
        },
        presentationUntil: activityPresentationUntil,
      },
    };
  }

  function restorePersistent(value = {}) {
    const saveVersion = Math.trunc(Number(value.version ?? 1));
    if (!Number.isInteger(saveVersion) || saveVersion < 1 || saveVersion > 14) {
      throw new RangeError(`Unsupported GTA Neon City save version: ${value.version}`);
    }
    const savedEnvironment = value.environment ?? environment.snapshot();
    const savedNeighbourhood = value.neighbourhood ?? initialNeighbourhoodSave;
    const restoredClock = persistentWorldClock(savedEnvironment, savedNeighbourhood, value.clock ?? null);
    environment.setTime(restoredClock.timeHours);
    if (value.environment) environment.setRain(value.environment.targetRain ?? value.environment.rain, true);
    neighbourhoodRoutine.restore(savedNeighbourhood);
    neighbourhoodRoutine.update(0, {
      dayIndex: restoredClock.dayIndex,
      minuteOfDay: restoredClock.minuteOfDay,
      captureSnapshot: false,
    });
    lastNeighbourhoodTransactionSerial = Math.max(
      0,
      Math.trunc(Number(value.neighbourhoodAppliedSerial ?? neighbourhoodRoutine.snapshot().transactionSerial) || 0),
    );
    communityRuntimeClockContext.dayIndex = restoredClock.dayIndex;
    communityRuntimeClockContext.minuteOfDay = restoredClock.minuteOfDay;
    cafeRuntimeClockContext.dayIndex = restoredClock.dayIndex;
    cafeRuntimeClockContext.minuteOfDay = restoredClock.minuteOfDay;
    marketRuntimeClockContext.dayIndex = restoredClock.dayIndex;
    marketRuntimeClockContext.minuteOfDay = restoredClock.minuteOfDay;
    communityFullSnapshotCacheKey = "";
    communityDirectoryCacheKey = "";
    communityActivityCacheKey = "";
    communityActivityCache = null;
    cafeActivityCacheKey = "";
    cafeActivityCache = null;
    marketActivityCacheKey = "";
    marketActivityCache = null;
    if (vehicles.playerVehicle) vehicles.exit();
    player.exitVehicle(player.root.position);
    clearTaxiPassengerPresentation();
    releaseGarageCustomerPresentation();
    roadsideResponse?.reset();
    releaseNightRouteParticipants();
    for (const savedVehicle of value.vehicles ?? []) {
      const vehicle = vehicles.get(savedVehicle.id);
      if (!vehicle) continue;
      vehicles.teleport(vehicle.id, savedVehicle.position?.[0], savedVehicle.position?.[2], savedVehicle.yaw);
      vehicle.health = clamp(savedVehicle.health, 0, vehicle.maxHealth);
      vehicle.root.scale.y = vehicle.health > 0 ? 1 : 0.82;
    }
    player.restore(value.player);
    wanted.restore(value.wanted);
    mission.restore(value.mission);
    communityTrust = Math.max(0, Math.trunc(Number(value.communityTrust) || 0));
    lifeProfile.restore(saveVersion >= 8 && value.lifeProfile ? value.lifeProfile : initialLifeProfileSave);
    residentialLife.restore(saveVersion >= 9 && value.residential ? value.residential : initialResidentialLifeSave);
    residentialRuntimeView = residentialLife.update(0, {
      dayIndex: restoredClock.dayIndex,
      minuteOfDay: restoredClock.minuteOfDay,
      captureSnapshot: false,
    });
    player.setCarriedGroceries(residentialLife.snapshot().player.carriedSupplies.groceries);
    const restoredResidentialSave = residentialLife.save();
    lastResidentialTransactionSerial = saveVersion >= 9
      ? Math.max(0, Math.trunc(Number(restoredResidentialSave.transactionSerial) || 0))
      : 0;
    lastResidentialInteractionSerial = saveVersion >= 9
      ? Math.max(0, Math.trunc(Number(restoredResidentialSave.interactionSerial) || 0))
      : 0;
    invalidateResidentialView();
    if (value.story) story.restore(value.story);
    else if (mission.snapshot().stage !== MISSION_STAGES.AVAILABLE) story.notify({ type: "force_recovery" });
    story.drainEvents();
    chapterTwo.restore(value.chapterTwo ?? initialChapterTwoSave);
    chapterTwo.drainEvents();
    if (value.activities) {
      taxiActivity.restore(value.activities.taxi);
      raceActivity.restore(value.activities.race);
      lifeActivity.restore(value.activities.life);
      basketballActivity.restore(value.activities.basketball);
      garageShift.restore(saveVersion >= 8 && value.activities.garage
        ? value.activities.garage
        : initialGarageShiftSave);
      communityHubLife.restore(saveVersion >= 10 && value.activities.community
        ? value.activities.community
        : initialCommunityHubSave);
      const communityRuntime = saveVersion >= 10 ? value.activities.communityRuntime ?? {} : {};
      const communitySavedSnapshot = communityHubLife.snapshot();
      lastCommunityStationResultSerial = Math.min(
        Math.max(0, Math.trunc(Number(communityRuntime.appliedStationResultSerial) || 0)),
        Math.max(0, Math.trunc(Number(communitySavedSnapshot.lastStationResult?.serial) || 0)),
      );
      lastCommunityTransactionSerial = Math.min(
        Math.max(0, Math.trunc(Number(communityRuntime.appliedTransactionSerial) || 0)),
        Math.max(0, Math.trunc(Number(communitySavedSnapshot.serials.transaction) || 0)),
      );
      communityRoleSelectionIndex = Math.max(0, Math.trunc(Number(communityRuntime.selectedRoleIndex) || 0)) % COMMUNITY_HUB_ROLES.length;
      communityRuntimeView = communityHubLife.update(0, communityRuntimeClockContext);
      cafeShift.restore(saveVersion >= 11 && value.activities.cafe
        ? value.activities.cafe
        : initialCafeShiftSave);
      const cafeRuntime = saveVersion >= 11 ? value.activities.cafeRuntime ?? {} : {};
      const cafeSavedSnapshot = cafeShift.snapshot();
      lastCafeStationResultSerial = Math.min(
        Math.max(0, Math.trunc(Number(cafeRuntime.appliedStationResultSerial) || 0)),
        Math.max(0, Math.trunc(Number(cafeSavedSnapshot.lastStationResult?.serial) || 0)),
      );
      lastCafeTransactionSerial = Math.min(
        Math.max(0, Math.trunc(Number(cafeRuntime.appliedTransactionSerial) || 0)),
        Math.max(0, Math.trunc(Number(cafeSavedSnapshot.serials.transaction) || 0)),
      );
      cafeRuntimeView = cafeShift.update(0, cafeRuntimeClockContext);
      cafeQuality = Math.max(0, Math.round(Number(cafeSavedSnapshot.activeShift?.quality ?? cafeSavedSnapshot.lastStationResult?.score) || 0));
      cafeReworkCount = Math.max(0, Math.trunc(Number(cafeSavedSnapshot.activeShift?.reworkCount ?? cafeSavedSnapshot.lastStationResult?.reworkCount) || 0));
      marketShift.restore(saveVersion >= 13 && value.activities.market
        ? value.activities.market
        : initialMarketShiftSave);
      const marketRuntime = saveVersion >= 13 ? value.activities.marketRuntime ?? {} : {};
      const marketSavedSnapshot = marketShift.snapshot();
      lastMarketStationResultSerial = Math.min(
        Math.max(0, Math.trunc(Number(marketRuntime.appliedStationResultSerial) || 0)),
        Math.max(0, Math.trunc(Number(marketSavedSnapshot.lastStationResult?.serial) || 0)),
      );
      lastMarketTransactionSerial = Math.min(
        Math.max(0, Math.trunc(Number(marketRuntime.appliedTransactionSerial) || 0)),
        Math.max(0, Math.trunc(Number(marketSavedSnapshot.serials.transaction) || 0)),
      );
      marketDecisionIndex = Math.max(0, Math.trunc(Number(marketRuntime.decisionIndex) || 0)) % MARKET_SURPLUS_DECISIONS.length;
      marketRuntimeView = marketShift.update(0, marketRuntimeClockContext);
      marketQuality = marketSavedSnapshot.activeShift?.passedStations
        ? Math.round(marketSavedSnapshot.activeShift.qualityTotal / Math.max(1, marketSavedSnapshot.activeShift.passedStations))
        : Math.max(0, Math.round(Number(marketSavedSnapshot.lastStationResult?.quality) || 0));
      marketReworkCount = Math.max(0, Math.trunc(Number(marketSavedSnapshot.activeShift?.reworkCount) || 0));
      nightRoute.restore(value.activities.nightRoute ?? initialNightRouteSave);
      const nightRouteRuntime = value.activities.nightRouteRuntime ?? {};
      lastNightRouteHandledEventSerial = Math.max(0, Math.trunc(Number(nightRouteRuntime.handledEventSerial) || 0));
      nightRouteCompletionEventsHandled = Math.max(0, Math.trunc(Number(nightRouteRuntime.completionEventsHandled) || 0));
      lastNightRouteHandledEvent = nightRouteRuntime.lastHandledEvent === null || nightRouteRuntime.lastHandledEvent === undefined
        ? null
        : String(nightRouteRuntime.lastHandledEvent);
      selectedActivity = ["taxi", "race", "life", "garage", "community", "cafe", "market", "basketball", "nightRoute"].includes(value.activities.selected)
        ? value.activities.selected
        : null;
      if (selectedActivity === "nightRoute" && !nightRoute.snapshot().started) selectedActivity = null;
      if (selectedActivity === "garage" && garageShift.snapshot().stage === GARAGE_SHIFT_STAGES.CLOCK_IN) {
        selectedActivity = null;
      }
      if (selectedActivity === "community" &&
          (!communityRuntimeView.activeRoleId || communityRuntimeView.status === "paused")) selectedActivity = null;
      if (selectedActivity === "cafe" && cafeRuntimeView.status !== "active") selectedActivity = null;
      if (selectedActivity === "market" && marketRuntimeView.status !== "active") selectedActivity = null;
      const savedDiagnosisId = value.activities.garageRuntime?.confirmedDiagnosisId;
      garageConfirmedDiagnosisId = GARAGE_FAULTS.some(fault => fault.id === savedDiagnosisId)
        ? savedDiagnosisId
        : null;
      garageDiagnosisIndex = 0;
      lastActivityStage = selectedActivitySnapshot()?.stage ?? selectedActivitySnapshot()?.phase ?? null;
      lastTaxiDialogueSerial = selectedActivity === "taxi"
        ? selectedActivitySnapshot()?.dialogueSerial ?? 0
        : 0;
      lastBasketballEvent = selectedActivity === "basketball" ? selectedActivitySnapshot()?.lastEvent ?? null : null;
      activityPresentationUntil = Math.max(0, Number(value.activities.presentationUntil) || 0);
      lastRaceCountdownSecond = null;
      processLifeActivityEvents();
      processGarageShiftEvents();
    } else {
      taxiActivity.reset();
      raceActivity.reset();
      lifeActivity.reset();
      basketballActivity.reset();
      garageShift.restore(initialGarageShiftSave);
      communityHubLife.restore(initialCommunityHubSave);
      communityRuntimeView = communityHubLife.update(0, communityRuntimeClockContext);
      cafeShift.restore(initialCafeShiftSave);
      cafeRuntimeView = cafeShift.update(0, cafeRuntimeClockContext);
      marketShift.restore(initialMarketShiftSave);
      marketRuntimeView = marketShift.update(0, marketRuntimeClockContext);
      nightRoute.restore(initialNightRouteSave);
      selectedActivity = null;
      lastActivityStage = null;
      lastTaxiDialogueSerial = 0;
      lastBasketballEvent = null;
      garageDiagnosisIndex = 0;
      garageConfirmedDiagnosisId = null;
      lastCommunityStationResultSerial = 0;
      lastCommunityTransactionSerial = 0;
      communityRoleSelectionIndex = 0;
      lastCafeStationResultSerial = 0;
      lastCafeTransactionSerial = 0;
      cafeQuality = 0;
      cafeReworkCount = 0;
      lastMarketStationResultSerial = 0;
      lastMarketTransactionSerial = 0;
      marketQuality = 0;
      marketReworkCount = 0;
      marketDecisionIndex = 1;
      lastNightRouteHandledEventSerial = 0;
      nightRouteCompletionEventsHandled = 0;
      lastNightRouteHandledEvent = null;
      activityPresentationUntil = 0;
    }
    if (chapterTwoMissionActive() && selectedActivitySnapshot()?.status === "active") {
      if (selectedActivity === "nightRoute") {
        releaseNightRouteParticipants();
        lastNightRouteHandledEventSerial = 0;
        nightRouteCompletionEventsHandled = 0;
        lastNightRouteHandledEvent = null;
      }
      if (selectedActivity === "garage") {
        releaseGarageCustomerPresentation();
        garageShift.restore(initialGarageShiftSave);
      } else if (selectedActivity === "community") {
        communityHubLife.restore(initialCommunityHubSave);
        communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
        lastCommunityStationResultSerial = 0;
        lastCommunityTransactionSerial = 0;
      } else if (selectedActivity === "cafe") {
        cafeShift.pause(cafeClockContext());
        cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
      } else if (selectedActivity === "market") {
        marketShift.pause(marketClockContext({ sourceId: marketCommandSource("pause", "narrative") }));
        marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
      } else selectedActivitySystem()?.reset?.();
      selectedActivity = null;
      lastActivityStage = null;
      lastTaxiDialogueSerial = 0;
      lastBasketballEvent = null;
      activityPresentationUntil = 0;
    }
    if (nightRoute.snapshot().started && !nightRoute.snapshot().completed) {
      const restoredPresentation = stageNightRouteParticipants(value.activities?.nightRouteRuntime?.participantActorIds ?? null);
      if (!restoredPresentation.accepted) {
        throw new RangeError(
          `Night Route participant restore failed for ${restoredPresentation.characterId}: ${restoredPresentation.reason}`,
        );
      }
    }
    if (narrativePresentation().controlsLocked) neighbourhoodRoutine.close("narrative_restore");
    if (value.roadside) roadsideResponse?.restore(value.roadside);
    else roadsideResponse?.reset();
    lastRoadsidePhase = roadsideResponse?.snapshot().phase ?? ROADSIDE_PHASES.IDLE;
    elapsed = Math.max(0, Number(value.elapsed) || elapsed);
    const savedVehicle = value.player?.inVehicle ? vehicles.get(value.player.inVehicle) : null;
    if (savedVehicle?.health > 0) {
      vehicles.enter(savedVehicle);
      player.enterVehicle(savedVehicle);
    }
    syncTaxiPassengerPresentation(selectedActivity === "taxi" ? taxiActivity.snapshot() : null);
    const savedResidentialActorRuntime = saveVersion >= 9 ? value.residentialActors : null;
    const restoredResidentialActorIds = restoreResidentialActorRuntime(savedResidentialActorRuntime);
    const savedCommunityStaffRuntime = saveVersion >= 10 ? value.activities?.communityRuntime?.staffActors : null;
    const restoredCommunityStaffIds = restoreCommunityStaffRuntime(savedCommunityStaffRuntime);
    const savedCafeStaffRuntime = saveVersion >= 11 ? value.activities?.cafeRuntime?.staffActors : null;
    const restoredCafeStaffIds = restoreCafeStaffRuntime(savedCafeStaffRuntime);
    const savedMarketStaffRuntime = saveVersion >= 13 ? value.activities?.marketRuntime?.staffActors : null;
    const restoredMarketStaffIds = restoreMarketStaffRuntime(savedMarketStaffRuntime);
    lastResidentialScheduleMinute = -1;
    lastCommunityScheduleMinute = -1;
    lastCafeScheduleMinute = -1;
    lastMarketScheduleMinute = -1;
    syncResidentialActors(true, restoredResidentialActorIds);
    communityRuntimeView = communityHubLife.update(0, communityRuntimeClockContext);
    syncCommunityStaff(true, communityRuntimeClockContext, restoredCommunityStaffIds);
    cafeRuntimeView = cafeShift.update(0, cafeRuntimeClockContext);
    syncCafeStaff(true, cafeRuntimeClockContext, restoredCafeStaffIds);
    marketRuntimeView = marketShift.update(0, marketRuntimeClockContext);
    syncMarketStaff(true, marketRuntimeClockContext, restoredMarketStaffIds);
    restoreResidentialActorArrivalState(savedResidentialActorRuntime, restoredResidentialActorIds);
    restoreCommunityStaffArrivalState(savedCommunityStaffRuntime, restoredCommunityStaffIds);
    restoreCafeStaffArrivalState(savedCafeStaffRuntime, restoredCafeStaffIds);
    restoreMarketStaffArrivalState(savedMarketStaffRuntime, restoredMarketStaffIds);
    if (saveVersion >= 13 && value.interiorOccupancy) interiorOccupancy.restore(value.interiorOccupancy);
    else interiorOccupancy.restore(initialInteriorOccupancySave);
    interiorOccupancy.update(0, {
      dayIndex: restoredClock.dayIndex,
      minuteOfDay: restoredClock.minuteOfDay,
      captureSnapshot: false,
    });
    mapNavigation.refreshPlaces(mapPlaceDirectory());
    mapNavigation.restore(saveVersion >= 14 && value.mapNavigation
      ? value.mapNavigation
      : initialMapNavigationSave);
    // Phone UI itself is modal/transient; the pan, zoom, selection and route
    // persist, while loading always returns control to the game world.
    mapNavigation.setOpen(false);
    phoneOpen = false;
    phoneApp = null;
    phonePressTarget = null;
    input.setUiPointerMode?.(false);
    showToast("QUICKSAVE LOADED", 2.5);
    return persistentSnapshot();
  }

  function handleActions() {
    if (input.actionPressed("pause")) paused = !paused;
    const narrativeSystem = activeNarrativeSystem();
    const storyBeforeInput = narrativePresentation();
    if (storyBeforeInput.choice) {
      const first = input.actionPressed("left") || input.consumeCode("Digit1");
      const second = input.actionPressed("right") || input.consumeCode("Digit2");
      if (first || second) {
        const option = storyBeforeInput.choice.options?.[first ? 0 : 1];
        if (option?.id) narrativeSystem.choose(option.id);
        if (narrativeSystem === nightRoute) processNightRouteEvents();
        else if (narrativeSystem === chapterTwo) processChapterTwoEvents();
        else processStoryEvents();
      }
      return;
    }
    const advanceDialogue = input.actionPressed("interact") ||
      (storyBeforeInput.active && input.consumeCode("Space"));
    if (storyBeforeInput.active && advanceDialogue) {
      if (narrativeSystem === nightRoute) narrativeSystem.update(0, { skip: true });
      else narrativeSystem.advanceLine();
      if (narrativeSystem === nightRoute) processNightRouteEvents();
      else if (narrativeSystem === chapterTwo) processChapterTwoEvents();
      else processStoryEvents();
      return;
    }
    if (narrativePresentation().controlsLocked) return;
    const neighbourhoodBeforeInput = neighbourhoodRoutine.snapshot();
    const garageBeforeInput = selectedActivity === "garage" ? garageShift.snapshot() : null;
    if (!phoneOpen && !neighbourhoodBeforeInput.menuOpen &&
        garageBeforeInput?.status === "active" && garageBeforeInput.stage === GARAGE_SHIFT_STAGES.DIAGNOSIS) {
      const choiceCount = Math.max(1, garageBeforeInput.diagnosisChoices.length);
      if (input.actionPressed("forward")) garageDiagnosisIndex = (garageDiagnosisIndex - 1 + choiceCount) % choiceCount;
      if (input.actionPressed("backward")) garageDiagnosisIndex = (garageDiagnosisIndex + 1) % choiceCount;
    }
    if (!phoneOpen && !neighbourhoodBeforeInput.menuOpen && selectedActivity === "market" && marketRuntimeView.decisionRequired) {
      const choiceCount = Math.max(1, MARKET_SURPLUS_DECISIONS.length);
      if (input.actionPressed("forward")) marketDecisionIndex = (marketDecisionIndex - 1 + choiceCount) % choiceCount;
      if (input.actionPressed("backward")) marketDecisionIndex = (marketDecisionIndex + 1) % choiceCount;
    }
    if (!phoneOpen && !neighbourhoodBeforeInput.menuOpen && !selectedActivity && atCommunityReception()) {
      if (input.actionPressed("left")) communityRoleSelectionIndex =
        (communityRoleSelectionIndex - 1 + COMMUNITY_HUB_ROLES.length) % COMMUNITY_HUB_ROLES.length;
      if (input.actionPressed("right")) communityRoleSelectionIndex =
        (communityRoleSelectionIndex + 1) % COMMUNITY_HUB_ROLES.length;
    }
    if (phoneOpen) {
      if (input.actionPressed("phone") || input.actionPressed("melee") || input.actionPressed("enterExit")) {
        if (phoneApp) {
          mapNavigation.cancelPointer();
          mapNavigation.setOpen(false);
          phoneApp = null;
        }
        else {
          phoneOpen = false;
          mapNavigation.setOpen(false);
          input.setUiPointerMode?.(false);
        }
        return;
      }
      const phoneItems = phoneApp === "places"
        ? [{ id: communityHubWorld.id }, ...neighbourhoodRoutine.available(neighbourhoodContext())]
          : phoneApp === "work" ? [
            garageShift.availability(garageShiftContext()),
            cafeShift.availability(cafeClockContext()),
            marketShift.availability(marketClockContext()),
            { id: communityHubWorld.id },
            ...lifeActivity.available(lifeUnlockContext()),
            basketballActivity.available(),
          ]
          : phoneApp === "profile" ? [lifeProfile.snapshot().needs, ...lifeProfile.snapshot().skills, ...lifeProfile.snapshot().shiftHistory.slice(-1)]
          : phoneApp === "home" ? homePhoneItems()
          : phoneApp === "contacts" ? [
              ...mainCharacters.filter(character => character.actor !== cafeStaffActors.get(ASHA_PATEL.id) &&
                character.actor !== marketStaffActors.get(MINA_OKAFOR.id)),
              ...residentialActorStates,
              ...cafeStaffStates,
              ...marketStaffStates,
              ...COMMUNITY_HUB_STAFF,
            ]
          : phoneApp === "map" ? mapNavigation.snapshot().places
          : phoneApp === "recents" ? phoneRecentApps : phoneApps;
      const phoneHit = hud?.phoneHitTest?.(input.pointer.x, input.pointer.y) ?? null;
      const wheel = input.consumeWheel?.() ?? 0;
      if (phoneApp && wheel) {
        if (phoneApp === "map") {
          const anchor = phoneHit?.type === "map" ? { x: phoneHit.x, y: phoneHit.y } : null;
          mapNavigation.zoomWheel(wheel * 120, anchor);
        } else {
          phoneScroll = Math.max(0, Math.min(Math.max(0, phoneItems.length - 5), phoneScroll + Math.sign(wheel)));
          phoneSelection = Math.max(phoneScroll, Math.min(phoneItems.length - 1, phoneSelection));
        }
      }
      phoneHover = phoneHit?.type === "item" ? phoneHit.index : -1;
      if (input.actionPressed("fire")) {
        phonePressTarget = phoneHit ? { ...phoneHit } : null;
        if (phoneHit?.type === "map") {
          phoneMapPointerX = phoneHit.x;
          phoneMapPointerY = phoneHit.y;
          mapNavigation.pointerDown({ x: phoneMapPointerX, y: phoneMapPointerY, pointerId: 0 });
        }
      }
      phonePressed = Boolean(phonePressTarget && input.actionDown("fire") &&
        phonePressTarget.type === phoneHit?.type && phonePressTarget.index === phoneHit?.index);
      if (phoneApp === "map" && phonePressTarget?.type === "map" && input.actionDown("fire")) {
        const drag = input.consumeLookDelta?.() ?? { x: 0, y: 0 };
        if (phoneHit?.type === "map") {
          phoneMapPointerX = phoneHit.x;
          phoneMapPointerY = phoneHit.y;
        } else {
          phoneMapPointerX += Number(drag.x) || 0;
          phoneMapPointerY += Number(drag.y) || 0;
        }
        mapNavigation.pointerMove({ x: phoneMapPointerX, y: phoneMapPointerY, pointerId: 0 });
      } else if (phoneApp === "recents" && input.actionDown("fire")) {
        const swipe = input.consumeLookDelta?.() ?? { x: 0 };
        if (Math.abs(swipe.x) > 18) {
          phoneScroll = Math.max(0, Math.min(Math.max(0, phoneItems.length - 1), phoneScroll - Math.sign(swipe.x)));
        }
      }
      if (input.actionReleased?.("fire")) {
        if (phonePressTarget?.type === "map") {
          if (phoneHit?.type === "map") {
            phoneMapPointerX = phoneHit.x;
            phoneMapPointerY = phoneHit.y;
          }
          const result = mapNavigation.pointerUp({ x: phoneMapPointerX, y: phoneMapPointerY, pointerId: 0 });
          phonePressTarget = null;
          phonePressed = false;
          if (result.kind === "navigate") showToast(`ROUTE SET — ${result.place.title}`, 2.4);
          else if (result.kind === "drop_pin") showToast("WAYPOINT DROPPED", 2);
          return;
        }
        const activation = phonePressTarget && phonePressTarget.type === phoneHit?.type &&
          phonePressTarget.index === phoneHit?.index ? phoneHit : null;
        phonePressTarget = null;
        phonePressed = false;
        if (activation?.type === "back") {
          if (phoneApp) {
            mapNavigation.cancelPointer();
            mapNavigation.setOpen(false);
            phoneApp = null;
            phoneSelection = 0;
            phoneScroll = 0;
          } else {
            phoneOpen = false;
            mapNavigation.setOpen(false);
            input.setUiPointerMode?.(false);
          }
          phoneScroll = 0;
        } else if (activation?.type === "home") {
          mapNavigation.cancelPointer();
          mapNavigation.setOpen(false);
          phoneApp = null;
          phoneSelection = 0;
          phoneScroll = 0;
        } else if (activation?.type === "recent") {
          mapNavigation.cancelPointer();
          mapNavigation.setOpen(false);
          phoneApp = "recents";
          phoneAppTransitionAt = presentationElapsed;
          phoneSelection = 0;
          phoneScroll = 0;
        } else if (activation?.type === "closeAll") {
          phoneRecentApps.length = 0;
          mapNavigation.cancelPointer();
          mapNavigation.setOpen(false);
          phoneApp = null;
          phoneSelection = 0;
          phoneScroll = 0;
        } else if (activation?.type === "item" && !phoneApp) {
          phoneApp = phoneApps[activation.index]?.id ?? null;
          mapNavigation.setOpen(phoneApp === "map");
          if (phoneApp) {
            phoneAppTransitionAt = presentationElapsed;
            const existing = phoneRecentApps.indexOf(phoneApp);
            if (existing >= 0) phoneRecentApps.splice(existing, 1);
            phoneRecentApps.unshift(phoneApp);
          }
          phoneSelection = 0;
          phoneScroll = 0;
        } else if (activation?.type === "item" && phoneApp === "recents") {
          phoneApp = phoneRecentApps[phoneScroll + activation.index] ?? null;
          mapNavigation.setOpen(phoneApp === "map");
          phoneAppTransitionAt = presentationElapsed;
          phoneSelection = 0;
          phoneScroll = 0;
        } else if (activation?.type === "item" && phoneApp === "home") {
          activateHomePhoneItem(phoneScroll + activation.index);
        } else if (activation?.type === "mapRoute" && phoneApp === "map") {
          const mapState = mapNavigation.snapshot();
          if (mapState.navigation) {
            mapNavigation.clearNavigation();
            showToast("GPS ROUTE CLEARED", 1.8);
          } else if (mapState.selectedPlaceId) {
            const route = mapNavigation.setNavigation(mapState.selectedPlaceId);
            if (route) showToast(`ROUTE SET — ${route.title}`, 2.4);
          }
        }
        return;
      }
      if (phoneApp !== "map" && input.actionPressed("forward")) phoneSelection = (phoneSelection - 1 + Math.max(1, phoneItems.length)) % Math.max(1, phoneItems.length);
      if (phoneApp !== "map" && input.actionPressed("backward")) phoneSelection = (phoneSelection + 1) % Math.max(1, phoneItems.length);
      if (!phoneApp && (advanceDialogue || input.actionPressed("interact"))) {
        phoneApp = phoneApps[phoneSelection]?.id ?? null;
        mapNavigation.setOpen(phoneApp === "map");
        if (phoneApp) phoneAppTransitionAt = presentationElapsed;
        if (phoneApp && !phoneRecentApps.includes(phoneApp)) phoneRecentApps.unshift(phoneApp);
        phoneSelection = 0;
        phoneScroll = 0;
      }
      return;
    }
    if (neighbourhoodBeforeInput.menuOpen) {
      if (input.actionPressed("enterExit") || input.actionPressed("melee")) {
        neighbourhoodRoutine.close("player_closed");
        showToast("BACK TO THE STREET", 1.4);
        return;
      }
      if (input.actionPressed("forward")) neighbourhoodRoutine.moveSelection(-1);
      if (input.actionPressed("backward")) neighbourhoodRoutine.moveSelection(1);
      if (advanceDialogue || input.actionPressed("interact")) {
        buySelectedNeighbourhoodItem();
      }
      if (input.actionPressed("quickSave")) {
        void saveService.save("quicksave", persistentSnapshot())
          .then(() => showToast("GAME SAVED", 2))
          .catch(error => showToast(`SAVE FAILED ${error?.message || error}`, 3));
      }
      if (input.actionPressed("quickLoad")) {
        void saveService.load("quicksave")
          .then(value => value ? restorePersistent(value) : showToast("NO QUICKSAVE FOUND", 2))
          .catch(error => showToast(`LOAD FAILED ${error?.message || error}`, 3));
      }
      return;
    }
    if (input.actionPressed("phone")) {
      if (player.vehicle) showToast("PUT THE VEHICLE IN PARK TO USE THE PHONE", 2);
      else {
        phoneOpen = true;
        phoneApp = null;
        mapNavigation.cancelPointer();
        mapNavigation.setOpen(false);
        phoneSelection = 0;
        phoneScroll = 0;
        phoneHover = -1;
        phonePressed = false;
        phonePressTarget = null;
        phoneOpenedAt = presentationElapsed;
        input.setUiPointerMode?.(true);
      }
      return;
    }
    if (input.actionPressed("enterExit")) {
      if (player.vehicle) exitVehicle();
      else if (selectedActivity === "basketball" && selectedActivitySnapshot()?.status === "active") {
        showToast("FINISH OR CANCEL THE ROUND BEFORE LEAVING THE COURT", 2.4);
      } else if (!enterVehicle()) showToast("NO VEHICLE CLOSE ENOUGH", 1.5);
    }
    if (advanceDialogue || input.actionPressed("interact")) {
      const storyState = story.snapshot();
      if (!storyState.briefingCompleted && storyState.phase === STORY_PHASES.MEET_JUNO &&
          player.root.position.distanceToSquared(contactPosition) < 7 * 7) {
        startCurrentGarageChapter(false);
        return;
      }
      if (storyState.chapterCompleted && !chapterTwo.snapshot().chapterStarted &&
          player.root.position.distanceToSquared(contactPosition) < 7 * 7) {
        startCurrentGarageChapter(false);
        return;
      }
      if (interactWithChapterTwo()) return;
      const side = selectedActivitySnapshot();
      if (side?.status === "active" && selectedActivity === "community") {
        interactWithCommunityShift();
        return;
      }
      if (side?.status === "active" && selectedActivity === "cafe") {
        interactWithCafeShift();
        return;
      }
      if (side?.status === "active" && selectedActivity === "market") {
        interactWithMarketShift();
        return;
      }
      if (side?.status === "active" && selectedActivity === "garage") {
        interactWithGarageShift();
        return;
      }
      if (side?.status === "active" && selectedActivity === "nightRoute") {
        const vehicle = vehicles.playerVehicle;
        const result = nightRoute.interact({
          position: controlledPosition(),
          inVehicle: Boolean(vehicle),
          vehicleAccess: vehicle?.access ?? null,
          speed: Math.abs(Number(vehicle?.state?.speed) || 0),
        });
        processNightRouteEvents();
        if (!result.accepted) {
          const message = result.reason === "vehicle_must_stop" ? "STOP THE PULSE LINE BEFORE YOU COUNT" :
            result.reason === "pulse_line_vehicle_required" ? "THIS COUNT MUST BE RUN IN THE AUTHORIZED PULSE LINE" :
            result.reason === "continue_on_foot" ? "PARK FIRST — THE CONSEQUENCE WORK IS ON FOOT" :
            result.reason === "dialogue_active" ? "LET THE CONVERSATION FINISH" : nightRoute.snapshot().objective;
          showToast(message, 2.6);
        }
        return;
      }
      if (side?.status === "active" && selectedActivity === "basketball") {
        const interacted = basketballActivity.interact({
          position: controlledPosition(),
          inVehicle: Boolean(vehicles.playerVehicle),
        });
        lastBasketballEvent = interacted.lastEvent;
        if (interacted.lastEvent === "shot_armed") {
          const hoop = vectorFrom(world.missionPoints.harbourCourtHoop);
          const direction = hoop.sub(player.root.position);
          const yaw = Math.atan2(-direction.x, -direction.z);
          player.root.rotation.y = yaw;
          chaseCamera.snapBehind(yaw);
          gameAudio.play("pickup", 0.28);
          showToast("METER LIVE — PRESS E IN THE GREEN WINDOW", 2.1);
        } else if (interacted.lastEvent === "perfect_release") {
          gameAudio.play("pickup", 0.42);
          showToast("PERFECT RELEASE", 1.25);
        } else if (interacted.lastEvent === "good_release") {
          showToast("GOOD RELEASE", 1.25);
        } else if (interacted.lastEvent === "missed_release") {
          showToast(interacted.releaseRating === "SHORT" ? "EARLY RELEASE" : "LATE RELEASE", 1.25);
        } else showToast(interacted.objective, 1.8);
      }
      else if (side?.status === "active" && selectedActivity === "life") {
        const interacted = lifeActivity.notify({
          type: "interact",
          position: controlledPosition(),
          inVehicle: Boolean(vehicles.playerVehicle),
        });
        processLifeActivityEvents();
        showToast(interacted.lastEvent === "stop_completed" || interacted.lastEvent === "activity_completed"
          ? `${interacted.title} — ${interacted.lastEvent === "activity_completed" ? "ALL TASKS COMPLETE" : "TASK COMPLETE"}`
          : interacted.objective, 2.1);
      }
      else if (side?.status === "active") showToast(side.objective, 2.1);
      else if (vehicles.playerVehicle?.kind === "taxi") beginSideActivity("taxi");
      else if (vehicles.playerVehicle?.kind === "sports") beginSideActivity("race");
      else {
        const homeStation = nearbyResidentialStation();
        const nearbyResident = nearbyResidentialActor();
        const nearbyHubStaff = nearbyCommunityStaff();
        const nearbyCafeTeamMember = nearbyCafeStaff();
        const nearbyMarketTeamMember = nearbyMarketStaff();
        const atHubReception = atCommunityReception();
        const atCafeClock = atCafeHandover();
        const atMarketClock = atMarketHandover();
        const basketballHub = vectorFrom(world.missionPoints.harbourCourt);
        const nearbyLife = lifeActivity.nearby(controlledPosition(), vehicles.playerVehicle ? 10 : 7, lifeUnlockContext());
        const nightRouteAccess = nightRoute.availability(nightRouteUnlockContext());
        const atNightRouteHub = !nightRoute.snapshot().started && nightRouteAccess.unlocked &&
          controlledPosition().distanceToSquared(vectorFrom(nightRouteAccess.hubPosition)) <= 7 * 7;
        const nearbyBusiness = nearbyNeighbourhoodBusiness(controlledPosition());
        const atGarageClock = controlledPosition().distanceToSquared(garageClockPosition) <= 5.5 * 5.5;
        if (atCafeClock) beginCafeShift();
        else if (nearbyBusiness?.id === "common_ground_cafe" && nearbyBusiness.open) openNeighbourhoodBusiness(nearbyBusiness.id);
        else if (nearbyBusiness?.id === "common_ground_cafe") showToast(
          `${nearbyBusiness.name} CLOSED  ${nearbyBusiness.openingHours.label}`, 3);
        else if (nearbyCafeTeamMember) showToast(nearbyCafeTeamMember.state?.dialogue ??
          `${nearbyCafeTeamMember.definition.name}: The shift notes are posted by the handover point.`, 5.2);
        else if (atMarketClock) beginMarketShift();
        else if (nearbyBusiness?.id === "mina_market_kitchen" && nearbyBusiness.open) openNeighbourhoodBusiness(nearbyBusiness.id);
        else if (nearbyBusiness?.id === "mina_market_kitchen") showToast(
          `${nearbyBusiness.name} CLOSED  ${nearbyBusiness.openingHours.label}`, 3);
        else if (nearbyMarketTeamMember) showToast(nearbyMarketTeamMember.state?.dialogue ??
          `${nearbyMarketTeamMember.definition.name}: The stock and till roster is posted at the handover counter.`, 5.4);
        else if (nearbyHubStaff?.state?.activity === "work") beginCommunityShift(nearbyHubStaff.definition.roleId);
        else if (atHubReception) beginCommunityShift(selectedCommunityRole().id);
        else if (nearbyHubStaff) showToast(nearbyHubStaff.state?.dialogue ?? "THE NEXT SHIFT HOURS ARE POSTED AT THE HOUSE", 4.5);
        else if (homeStation?.action === "cook" && carriedGroceryUnits() > 0 && atHomeUnpackPoint()) unpackResidentialSupplies();
        else if (homeStation) performResidentialActivity(homeStation.action);
        else if (nearbyResident) interactResidentialActor(nearbyResident.residentId);
        else if (atGarageClock) beginGarageShift();
        else if (atNightRouteHub) beginNightRoute({ force: false });
        else if (nearbyBusiness?.open) openNeighbourhoodBusiness(nearbyBusiness.id);
        else if (nearbyBusiness) showToast(`${nearbyBusiness.name} CLOSED  ${nearbyBusiness.openingHours.label}`, 3);
        else if (controlledPosition().distanceToSquared(basketballHub) <= 7 * 7) beginBasketballActivity();
        else if (nearbyLife) beginLifeActivity(nearbyLife.id);
        else showToast("VISIT A SHOP, WORKPLACE, CITY-LIFE HUB, TAXI, OR MOTOR CLUB", 2.8);
      }
    }
    if (input.actionPressed("mission")) {
      const access = nightRoute.availability(nightRouteUnlockContext());
      const atSouthline = controlledPosition().distanceToSquared(vectorFrom(access.hubPosition)) <= 7 * 7;
      if (!nightRoute.snapshot().started && access.unlocked && atSouthline) beginNightRoute({ force: false });
      else startCurrentGarageChapter(false);
    }
    if (input.actionPressed("horn") && player.vehicle) {
      const hornPosition = vehicles.playerVehicle?.root?.position ?? player.root.position;
      gameAudio.playAt("horn", 0.58, hornPosition);
      population?.alert(hornPosition, "horn");
    }
    if (input.actionPressed("restart") && !player.alive) respawnPlayer();
    if (input.actionPressed("quickSave")) {
      void saveService.save("quicksave", persistentSnapshot())
        .then(() => showToast("GAME SAVED", 2))
        .catch(error => showToast(`SAVE FAILED ${error?.message || error}`, 3));
    }
    if (input.actionPressed("quickLoad")) {
      void saveService.load("quicksave")
        .then(value => value ? restorePersistent(value) : showToast("NO QUICKSAVE FOUND", 2))
        .catch(error => showToast(`LOAD FAILED ${error?.message || error}`, 3));
    }
  }

  function policeObserving(position) {
    const visibleTo = (source, yaw, range) => {
      observerDirection.copy(position).sub(source).setY(0);
      const distance = observerDirection.length();
      if (distance <= 0.01 || distance > range) return false;
      observerDirection.multiplyScalar(1 / distance);
      observerForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      if (observerForward.dot(observerDirection) < -0.28 && distance > 9) return false;
      observerOrigin.copy(source).setY(source.y + 1.25);
      const sightDirection = observerDirection.clone();
      sightDirection.y = ((Number(position.y) || 0) + 1.05 - observerOrigin.y) / distance;
      sightDirection.normalize();
      return worldRayDistance(observerOrigin, sightDirection, distance) >= distance - 0.3;
    };
    const officerNearby = population.actors.some(actor => actor.police && actor.active && actor.alive &&
      visibleTo(actor.root.position, actor.root.rotation.y, 42));
    const cruiserNearby = vehicles.vehicles.some(vehicle => vehicle.police && vehicle.health > 0 &&
      visibleTo(vehicle.root.position, vehicle.state.yaw, 58));
    return officerNearby || cruiserNearby;
  }

  function applyPickups(position) {
    for (const pickup of effects.collect(position)) {
      let message = `${pickup.label ?? pickup.type.toUpperCase()} +${pickup.amount}`;
      if (pickup.type === "health") {
        player.heal(pickup.amount);
        message = `USED ${pickup.label ?? "FIRST AID"}  +${pickup.amount} HEALTH`;
      } else if (pickup.type === "armor") {
        player.addArmor(pickup.amount);
        message = `EQUIPPED ${pickup.label ?? "SAFETY VEST"}  +${pickup.amount} PROTECTION`;
      } else if (pickup.type === "lost_property") {
        player.addCash(pickup.amount);
        communityTrust += 1;
        message = `RETURNED ${pickup.label ?? "LOST PROPERTY"}  OWNER REWARD $${pickup.amount}  TRUST +1`;
      }
      gameAudio.play("pickup", 0.5);
      showToast(message, 3.2);
    }
  }

  function updateMission(delta) {
    const before = mission.snapshot();
    mission.update(delta, { wantedStars: wanted.snapshot().stars });
    let current = mission.snapshot();
    if (current.stage === MISSION_STAGES.STEAL && vehicles.targetVehicle?.health <= 0) {
      mission.notify({ type: "target_destroyed", vehicleId: vehicles.targetVehicle.id });
      story.notify({ type: "target_destroyed", vehicleId: vehicles.targetVehicle.id });
      processStoryEvents();
      showToast("RECOVERY FAILED — MARISOL'S CAR WAS DESTROYED", 3.8);
      current = mission.snapshot();
    }
    if (current.stage === MISSION_STAGES.DELIVER && vehicles.playerVehicle?.id === current.targetVehicleId) {
      const distance = vehicles.playerVehicle.root.position.distanceTo(dropoffPosition);
      if (distance <= 6.2 && Math.abs(vehicles.playerVehicle.state.speed) < 3.2) {
        const complete = mission.notify({ type: "vehicle_delivered", vehicleId: vehicles.playerVehicle.id });
        if (complete.stage === MISSION_STAGES.COMPLETE) {
          const deliveredVehicleId = vehicles.playerVehicle.id;
          player.addCash(complete.reward);
          wanted.clear();
          exitVehicle();
          story.notify({ type: "vehicle_delivered", vehicleId: deliveredVehicleId });
          processStoryEvents();
          gameAudio.play("mission", 0.72);
          showToast(`CUSTOMER RECOVERY FEE +$${complete.reward}`, 5);
        }
      }
    }
    current = mission.snapshot();
    if (current.stage !== lastStage) {
      if (current.stage === MISSION_STAGES.DELIVER) {
        story.notify({ type: "police_lost" });
        processStoryEvents();
        showToast("FALSE FLAG CLEARED — RETURN MARISOL'S CAR", 3.4);
      }
      lastStage = current.stage;
    }
    return { previous: before, current };
  }

  function chapterTwoTargetPosition(state = chapterTwo.snapshot()) {
    if (!state.chapterStarted) return chapterTwoUnlocked() ? contactPosition : null;
    if (state.phase === CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE) {
      const clue = CHAPTER_TWO_CLUES.find(value => value.targetKey === state.targetKey);
      return clue ? chapterTwoGarageCluePositions.get(clue.id) : contactPosition;
    }
    if (state.phase === CHAPTER_TWO_PHASES.OPENING || state.phase === CHAPTER_TWO_PHASES.CONSEQUENCE) {
      return chapterTwoRecallDeskPosition;
    }
    if (state.phase === CHAPTER_TWO_PHASES.SPEAK_TO_LEAH) return chapterTwoLeahInteractionPosition;
    if (state.phase === CHAPTER_TWO_PHASES.INSPECT_DEPOT || state.phase === CHAPTER_TWO_PHASES.DECISION) {
      return chapterTwoDepotManifestInteractionPosition;
    }
    if (state.phase === CHAPTER_TWO_PHASES.COMPLETE && state.aftermathHook?.id) {
      const consequence = lifeActivity.available(lifeUnlockContext()).find(value => value.id === state.aftermathHook.id);
      return consequence?.hubPosition ? vectorFrom(consequence.hubPosition) : null;
    }
    return null;
  }

  function nearbyChapterTwoClue(position = controlledPosition(), radius = 5.2) {
    const inspected = chapterTwo.snapshot().inspectedClues;
    let nearest = null;
    let nearestDistance = Math.max(0, Number(radius) || 5.2) ** 2;
    for (const clue of CHAPTER_TWO_CLUES) {
      if (inspected.includes(clue.id)) continue;
      const target = chapterTwoGarageCluePositions.get(clue.id);
      const squared = target ? position.distanceToSquared(target) : Infinity;
      if (squared <= nearestDistance) {
        nearest = clue;
        nearestDistance = squared;
      }
    }
    return nearest;
  }

  function chapterTwoMissionView() {
    const state = chapterTwo.snapshot();
    if (!state.chapterStarted && !chapterTwoUnlocked()) return null;
    const target = chapterTwoTargetPosition(state);
    return Object.freeze({
      id: "borrowed_time",
      kind: "story_chapter",
      title: state.chapter.title,
      description: state.chapter.subtitle,
      stage: state.phase,
      status: state.chapterCompleted ? "completed" : state.chapterStarted ? "active" : "available",
      objective: state.chapterStarted ? state.objective : "MEET JUNO AT PULSE GARAGE ABOUT LEAH'S BRAKES",
      targetKind: "interaction",
      targetPosition: target?.toArray?.() ?? null,
      clueProgress: state.clueProgress,
      hudDetail: !state.chapterStarted
        ? "CHAPTER TWO AVAILABLE  /  AN ORDINARY JOB WENT WRONG"
        : state.chapterCompleted
        ? `CONSEQUENCE  ${state.aftermathHook?.title ?? "RECORDED"}`
        : `EVIDENCE ${state.clueProgress}  /  NO VIOLENCE REQUIRED`,
      choiceResult: state.choiceResult,
      aftermathHook: state.aftermathHook,
    });
  }

  function updateMissionMarker() {
    // Authored dialogue owns the frame even when it intentionally retains the
    // gameplay camera (for example the Southline manifest evidence read).
    // Clearing the target here prevents the tall 3D guidance beam from being
    // re-enabled between HUD updates and painting over the dialogue card.
    if (isAuthoredNarrativePresentation(narrativePresentation())) {
      effects.setMissionTarget(null, null);
      return;
    }
    const activity = selectedActivitySnapshot();
    if (activity?.status === "active" && activity.targetPosition) {
      const target = vectorFrom(activity.targetPosition);
      const kind = activity.kind === "mechanic" ? "interior" :
        activity.targetKind === "pickup" || activity.targetKind === "start" || activity.targetKind === "interaction" ? "contact" :
        activity.targetKind === "checkpoint" ? "vehicle" : "dropoff";
      effects.setMissionTarget(kind, target, null);
      return;
    }
    const chapterState = chapterTwo.snapshot();
    const chapterTarget = chapterTwoTargetPosition(chapterState);
    if (chapterTarget && chapterState.chapterStarted && !chapterState.chapterCompleted) {
      effects.setMissionTarget("contact", chapterTarget);
      return;
    }
    const current = mission.snapshot();
    if (current.stage === MISSION_STAGES.STEAL) {
      effects.setMissionTarget("vehicle", vehicles.targetVehicle?.root?.position ?? targetSpawn, vehicles.targetVehicle);
    } else if (current.stage === MISSION_STAGES.DELIVER) {
      effects.setMissionTarget("dropoff", dropoffPosition);
    } else {
      const manualTarget = mapNavigation.snapshot().routeTarget;
      if (manualTarget) effects.setMissionTarget("dropoff", vectorFrom(manualTarget));
      else if (activity) effects.setMissionTarget(null, null);
      else if (chapterTarget && chapterTwoUnlocked()) effects.setMissionTarget("contact", chapterTarget);
      else if (current.stage === MISSION_STAGES.AVAILABLE || current.stage === MISSION_STAGES.COMPLETE) {
        effects.setMissionTarget("contact", contactPosition);
      } else effects.setMissionTarget(null, null);
    }
  }

  function targetForHud() {
    const activity = selectedActivitySnapshot();
    if (activity?.status === "active" && activity.targetPosition) return vectorFrom(activity.targetPosition);
    const chapterState = chapterTwo.snapshot();
    const chapterTarget = chapterTwoTargetPosition(chapterState);
    if (chapterTarget && chapterState.chapterStarted && !chapterState.chapterCompleted) return chapterTarget;
    const current = mission.snapshot();
    if (current.stage === MISSION_STAGES.STEAL) return vehicles.targetVehicle?.root?.position ?? targetSpawn;
    if (current.stage === MISSION_STAGES.DELIVER) return dropoffPosition;
    const manualTarget = mapNavigation.snapshot().routeTarget;
    if (manualTarget) return vectorFrom(manualTarget);
    if (activity) return null;
    if (chapterTarget && chapterTwoUnlocked()) return chapterTarget;
    if (current.stage === MISSION_STAGES.AVAILABLE || current.stage === MISSION_STAGES.COMPLETE) return contactPosition;
    return null;
  }

  function contextPrompt() {
    if (!player.alive) return "T  RESPAWN AT HOSPITAL";
    if (paused) return "P  RESUME";
    const storyState = narrativePresentation();
    if (storyState.choice) {
      const options = storyState.choice.options ?? [];
      return `A / 1  ${options[0]?.label ?? "OPTION ONE"}     D / 2  ${options[1]?.label ?? "OPTION TWO"}`;
    }
    if (storyState.controlsLocked) return "E / SPACE  CONTINUE";
    const neighbourhoodState = neighbourhoodRoutine.snapshot();
    if (neighbourhoodState.menuOpen) return "W / S  SELECT     E  BUY     Q / F  LEAVE";
    if (player.vehicle) {
      const activity = selectedActivitySnapshot();
      if (activity?.status === "active" && selectedActivity === "nightRoute") {
        return activity.phase === NIGHT_ROUTE_PHASES.SURVEY
          ? `F EXIT   E  ${activity.objective}`
          : `F EXIT   ${activity.objective}`;
      }
      if (activity?.status === "active") return `F EXIT   ${activity.objective}`;
      const nearbyVehicleLife = !narrativeMissionBusy()
        ? lifeActivity.nearby(controlledPosition(), 10, lifeUnlockContext())
        : null;
      const vehicle = vehicles.playerVehicle;
      if (nearbyVehicleLife &&
          (!nearbyVehicleLife.requiredVehicleKind || nearbyVehicleLife.requiredVehicleKind === vehicle?.kind) &&
          (!nearbyVehicleLife.requiredVehicleAccess || nearbyVehicleLife.requiredVehicleAccess === vehicle?.access)) {
        return `F EXIT   E START ${nearbyVehicleLife.title}`;
      }
      if (vehicles.playerVehicle?.kind === "taxi" && !narrativeMissionBusy()) return "F EXIT   E START TAXI SHIFT";
      if (vehicles.playerVehicle?.kind === "sports" && !narrativeMissionBusy()) return "F EXIT   E ENTER HARBOUR LOOP";
      return "F  EXIT VEHICLE";
    }
    const activeLife = selectedActivity === "life" ? selectedActivitySnapshot() : null;
    if (activeLife?.status === "active") return `E  ${activeLife.objective}`;
    const activeCommunity = selectedActivity === "community" ? selectedActivitySnapshot() : null;
    if (activeCommunity?.status === "active") {
      if (communityRuntimeView.taskActive) return `${activeCommunity.objective} — STAY AT THE WORK STATION`;
      const station = communityWorldStation(activeCommunity.stationId);
      const nearStation = station && controlledPosition().distanceToSquared(vectorFrom(station.position)) <= 2.85 * 2.85;
      return nearStation ? `E  ${station.label} — WORK CAREFULLY` : `GO TO ${station?.label ?? "THE NEXT HOUSE STATION"}`;
    }
    const activeCafe = selectedActivity === "cafe" ? selectedActivitySnapshot() : null;
    if (activeCafe?.status === "active") {
      if (cafeRuntimeView.taskActive) return `${activeCafe.objective} — STAY AT THE CAFE WORK STATION`;
      const station = cafeWorldStationById.get(activeCafe.stationId);
      const nearStation = station && controlledPosition().distanceToSquared(vectorFrom(station.position)) <= 2.85 * 2.85;
      return nearStation ? `E  ${station.label} — WORK CAREFULLY` : `GO TO ${station?.label ?? "THE NEXT CAFE STATION"}`;
    }
    const activeMarket = selectedActivity === "market" ? selectedActivitySnapshot() : null;
    if (activeMarket?.status === "active") {
      if (activeMarket.decisionRequired) {
        const choice = MARKET_SURPLUS_DECISIONS[marketDecisionIndex] ?? MARKET_SURPLUS_DECISIONS[0];
        const pantry = marketWorldStationById.get("mina-pantry-shelf");
        const nearPantry = pantry && controlledPosition().distanceToSquared(vectorFrom(pantry.position)) <= 2.85 * 2.85;
        return nearPantry
          ? `W / S  CHOOSE     E  ${choice.label} — ${choice.tradeoff}`
          : "RETURN TO THE PANTRY SHELF — THE SURPLUS DECISION MUST BE RECORDED BESIDE THE STOCK";
      }
      if (marketRuntimeView.taskActive) return `${activeMarket.objective} — STAY AT THE MARKET WORK STATION`;
      const station = marketWorldStation(activeMarket.stationId);
      const nearStation = station && controlledPosition().distanceToSquared(vectorFrom(station.position)) <= 2.85 * 2.85;
      return nearStation ? `E  ${station.label} — WORK CAREFULLY` : `GO TO ${station?.label ?? "THE NEXT MARKET STATION"}`;
    }
    const activeGarage = selectedActivity === "garage" ? garageShift.snapshot() : null;
    if (activeGarage?.status === "active") {
      if (activeGarage.stage === GARAGE_SHIFT_STAGES.DIAGNOSIS) {
        const choice = activeGarage.diagnosisChoices[garageDiagnosisIndex] ?? activeGarage.diagnosisChoices[0];
        return `W / S  CHOOSE     E  CONFIRM ${choice?.label ?? "DIAGNOSIS"}`;
      }
      if (activeGarage.stage === GARAGE_SHIFT_STAGES.REPAIR) {
        return `REPAIR ${Math.round(activeGarage.repairProgress * 100)}% — STAY AT THE LIFT`;
      }
      return `E  ${activeGarage.objective}`;
    }
    const activeNightRoute = selectedActivity === "nightRoute" ? selectedActivitySnapshot() : null;
    if (activeNightRoute?.status === "active") return `E  ${activeNightRoute.objective}`;
    const activeBasketball = selectedActivity === "basketball" ? selectedActivitySnapshot() : null;
    if (activeBasketball?.status === "active") {
      return activeBasketball.stage === BASKETBALL_STAGES.CHARGING
        ? "E  RELEASE SHOT IN THE GREEN WINDOW"
        : activeBasketball.stage === BASKETBALL_STAGES.FLIGHT
          ? "FOLLOW THE SHOT"
          : `E  ${activeBasketball.objective}`;
    }
    const chapterState = chapterTwo.snapshot();
    const chapterTarget = chapterTwoTargetPosition(chapterState);
    const atChapterTarget = chapterTarget && controlledPosition().distanceToSquared(chapterTarget) <= 5.2 * 5.2;
    const nearbyClue = chapterState.phase === CHAPTER_TWO_PHASES.INVESTIGATE_GARAGE
      ? nearbyChapterTwoClue(controlledPosition())
      : null;
    if (chapterState.chapterStarted && !chapterState.chapterCompleted && (atChapterTarget || nearbyClue)) {
      if (nearbyClue) return `E  INSPECT ${nearbyClue.label}`;
      if (chapterState.phase === CHAPTER_TWO_PHASES.SPEAK_TO_LEAH) return "E  SPEAK TO LEAH MORENO";
      if (chapterState.phase === CHAPTER_TWO_PHASES.INSPECT_DEPOT) return "E  PHOTOGRAPH SOUTHLINE'S MANIFEST";
    }
    if (!chapterState.chapterStarted && chapterTwoUnlocked() &&
        player.root.position.distanceToSquared(contactPosition) < 7 * 7) {
      return "E  START CHAPTER TWO — BORROWED TIME";
    }
    if (atCafeHandover()) {
      const access = cafeShift.availability(cafeClockContext());
      const supervisor = cafeShift.staffState(ASHA_PATEL.id, cafeClockContext());
      const supervisorActor = cafeStaffActors.get(ASHA_PATEL.id);
      const supervisorPresent = supervisor?.workingDay && supervisor?.locationId === commonGroundCafeWorld.id &&
        supervisorActor?.alive && insideCommonGroundCafe(supervisorActor.root.position);
      return access.canBegin && supervisorPresent
        ? "E  CLOCK IN — COMMON GROUND CAFE SHIFT"
        : access.reason === "already_completed_today"
          ? "COMMON GROUND — TODAY'S SHIFT IS FILED"
          : !supervisorPresent
            ? "COMMON GROUND — SHIFT LEAD NOT YET AT HANDOVER"
            : `COMMON GROUND  ${access.postedHours.label}`;
    }
    const cafeOrderBusiness = nearbyNeighbourhoodBusiness(player.root.position);
    if (cafeOrderBusiness?.id === "common_ground_cafe") return cafeOrderBusiness.open
      ? "E  ORDER AT COMMON GROUND COUNTER"
      : `${cafeOrderBusiness.name} CLOSED  ${cafeOrderBusiness.openingHours.label}`;
    const nearbyCafeTeamMember = nearbyCafeStaff();
    if (nearbyCafeTeamMember) return `E  TALK TO ${nearbyCafeTeamMember.definition.name}`;
    if (atMarketHandover()) {
      const access = marketShift.availability(marketClockContext());
      const supervisor = marketShift.staffState(MINA_OKAFOR.id, marketClockContext());
      const supervisorActor = marketStaffActors.get(MINA_OKAFOR.id);
      const supervisorPresent = supervisor?.atWork && supervisorActor?.alive && insideMinaMarket(supervisorActor.root.position);
      return (access.canBegin || access.paused) && supervisorPresent
        ? `E  ${access.paused ? "RESUME" : "CLOCK IN"} — MINA'S MARKET STOCK AND TILL SHIFT`
        : access.reason === "already_completed_today"
          ? "MINA'S MARKET — TODAY'S SHIFT IS FILED"
          : !supervisorPresent
            ? "MINA'S MARKET — SUPERVISOR NOT YET ON THE FLOOR"
            : `MINA'S MARKET  ${marketShift.postedHours.label}`;
    }
    const marketOrderBusiness = nearbyNeighbourhoodBusiness(player.root.position);
    if (marketOrderBusiness?.id === "mina_market_kitchen") return marketOrderBusiness.open
      ? "E  SHOP OR ORDER AT MINA'S MARKET COUNTER"
      : `${marketOrderBusiness.name} CLOSED  ${marketOrderBusiness.openingHours.label}`;
    const nearbyMarketTeamMember = nearbyMarketStaff();
    if (nearbyMarketTeamMember) return `E  TALK TO ${nearbyMarketTeamMember.definition.name}`;
    const homeStation = nearbyResidentialStation();
    if (homeStation?.action === "cook" && carriedGroceryUnits() > 0 && atHomeUnpackPoint()) {
      return `E  UNPACK ${carriedGroceryUnits()} GROCERIES INTO THE PANTRY`;
    }
    if (homeStation) return `E  ${homeStation.label} — ${residentialInterior.label}`;
    const nearbyResident = nearbyResidentialActor();
    if (nearbyResident) return `E  TALK TO ${nearbyResident.actor.displayName}`;
    const nearbyHubStaff = nearbyCommunityStaff();
    if (nearbyHubStaff) return nearbyHubStaff.state?.activity === "work"
      ? `E  ASK ${nearbyHubStaff.definition.name} ABOUT ${communityRoleById.get(nearbyHubStaff.definition.roleId)?.name ?? "A SHIFT"}`
      : `E  TALK TO ${nearbyHubStaff.definition.name}`;
    if (atCommunityReception()) {
      const role = selectedCommunityRole();
      const access = communityHubLife.availability(role.id, communityClockContext());
      return access.canBegin
        ? `A / D  CHOOSE ROLE     E  CLOCK IN — ${role.name}`
        : `A / D  CHOOSE ROLE     ${role.name} — ${access.postedHours?.label ?? "HOURS POSTED"}`;
    }
    const near = vehicles.nearestEnterable(player.root.position, 3.6);
    if (near) return near.authorized
      ? `F  DRIVE ${near.displayName ?? near.kind.toUpperCase()}`
      : `F  TAKE ${near.kind.toUpperCase()}  /  THIS MAY BE REPORTED`;
    const nightRouteAccess = nightRoute.availability(nightRouteUnlockContext());
    const atNightRouteHub = !nightRoute.snapshot().started && nightRouteAccess.unlocked &&
      player.root.position.distanceToSquared(vectorFrom(nightRouteAccess.hubPosition)) <= 7 * 7;
    const nearbyBusiness = cafeOrderBusiness ?? marketOrderBusiness ?? nearbyNeighbourhoodBusiness(player.root.position);
    if (atNightRouteHub) return "M / E  START THE NIGHT COUNT WITH ROSA";
    if (nearbyBusiness) return nearbyBusiness.open
      ? `E  ${nearbyBusiness.id === "common_ground_cafe" ? "ORDER AT" : nearbyBusiness.id === "mina_market_kitchen" ? "SHOP AT" : "ENTER"} ${nearbyBusiness.name}`
      : `${nearbyBusiness.name} CLOSED  ${nearbyBusiness.openingHours.label}`;
    const stage = mission.snapshot().stage;
    if (!story.snapshot().chapterCompleted &&
        (stage === MISSION_STAGES.AVAILABLE || stage === MISSION_STAGES.COMPLETE) &&
        player.root.position.distanceToSquared(contactPosition) < 7 * 7) {
      return story.snapshot().briefingCompleted ? "E  CONTINUE HOME AGAIN" : "E  TALK TO JUNO";
    }
    if (player.root.position.distanceToSquared(garageClockPosition) <= 5.5 * 5.5) {
      const access = garageShift.availability(garageShiftContext());
      return access.canClockIn
        ? "E  CLOCK IN — PULSE GARAGE APPRENTICE"
        : access.reason === "one_shift_per_day"
          ? "PULSE GARAGE — TODAY'S SHIFT IS COMPLETE"
          : `PULSE GARAGE  ${access.postedHours?.label ?? garageShift.postedHours.label}`;
    }
    const nearbyLife = !narrativeMissionBusy()
      ? lifeActivity.nearby(player.root.position, 7, lifeUnlockContext())
      : null;
    if (!narrativeMissionBusy() && player.root.position.distanceToSquared(vectorFrom(world.missionPoints.harbourCourt)) <= 7 * 7) {
      return "E  START HARBOUR COURT FIVE-SHOT ROUND";
    }
    if (nearbyLife) return `E  START ${nearbyLife.title}`;
    return "";
  }

  function entitySnapshots(reuseForHud) {
    const refresh = !reuseForHud || !cachedVehicleSnapshots || !cachedPopulationSnapshots ||
      elapsed + 1e-9 >= nextHudEntitySnapshotAt;
    if (refresh) {
      cachedVehicleSnapshots = vehicles.snapshot();
      cachedPopulationSnapshots = population.snapshot();
      nextHudEntitySnapshotAt = elapsed + HUD_ENTITY_REFRESH_STEP;
    }
    return { vehicles: cachedVehicleSnapshots, population: cachedPopulationSnapshots };
  }

  function phoneSnapshot() {
    const environmentState = environment.snapshot();
    const playerState = player.snapshot();
    let title = "NEON LIFE";
    let subtitle = "YOUR CITY IN YOUR POCKET";
    let items = phoneApps.map(app => ({ title: app.name, detail: app.subtitle }));
    if (phoneApp === "wallet") {
      title = "PULSE PAY";
      subtitle = `AVAILABLE  $${Math.max(0, Math.trunc(playerState.cash)).toLocaleString("en-US")}`;
      items = [
        { title: "CASH", detail: `$${Math.max(0, Math.trunc(playerState.cash)).toLocaleString("en-US")} AVAILABLE` },
        { title: "COMMUNITY TRUST", detail: `${Math.max(0, Math.trunc(communityTrust))} / EARNED BY HELPING` },
        { title: "HOUSEHOLD", detail: `${carriedGroceryUnits()} GROCERIES IN TOTE / RENT $${Math.max(0, Math.trunc(residentialRuntimeView.rentDue))} DUE` },
        { title: "SPENDING", detail: "FOOD, LOCAL STORES, AND ORDINARY LIFE" },
      ];
    } else if (phoneApp === "places") {
      title = "OPEN DOORS";
      subtitle = "NEIGHBOURHOOD DIRECTORY";
      const neighbourhoodPlaces = neighbourhoodRoutine.available({
        timeHours: environmentState.timeHours,
        weather: environmentState.weather,
        story: story.snapshot(),
      }).map(place => ({
        title: place.name,
        detail: place.id === "common_ground_cafe"
          ? `${place.open ? "OPEN" : "CLOSED"} / WALK THROUGH THE STREET DOOR · COUNTER, TABLES, KITCHEN, STAFF ROOMS`
          : place.id === "mina_market_kitchen"
            ? `${place.open ? "OPEN" : "CLOSED"} / WALK-IN PRODUCE · GROCERIES · DELI · KITCHEN · STOCKROOMS`
            : `${place.open ? "OPEN" : "CLOSED"}  ${place.openingHours?.label ?? "HOURS POSTED"}`,
      }));
      items = [{
        title: communityHubWorld.label,
        detail: `${communityHubWorld.address} / WALK-IN ROOMS AND POSTED SHIFT HOURS`,
      }, ...neighbourhoodPlaces];
    } else if (phoneApp === "work") {
      title = "CITY WORK";
      subtitle = "JOBS, SPORT, AND COMMUNITY LIFE";
      const garageAccess = garageShift.availability(garageShiftContext());
      const garageListing = {
        title: "PULSE GARAGE APPRENTICE",
        detail: garageAccess.canClockIn
          ? `SHIFT OPEN / ${garageAccess.workOrders.length} CUSTOMER JOBS POSTED`
          : garageAccess.reason === "one_shift_per_day"
            ? "TODAY'S CAREFUL SHIFT IS COMPLETE"
            : `HOURS  ${garageAccess.postedHours.label}`,
      };
      const cafeAccess = cafeShift.availability(cafeClockContext());
      const cafeListing = {
        title: "COMMON GROUND CAFE — PAID SHIFT",
        detail: cafeAccess.canBegin
          ? "OPEN NOW / HANDOVER · TILL · PREP · SERVICE · DISHES · STOCK"
          : cafeAccess.reason === "already_completed_today"
            ? "TODAY'S SHIFT IS FILED / COME BACK TOMORROW"
            : cafeAccess.reason === "supervisor_off_day"
              ? "ASHA'S TRAINING ROSTER IS OFF TODAY / CAFE SERVICE CONTINUES"
            : `${cafeAccess.postedHours.label} / CLOCK IN AT THE INSIDE HANDOVER POINT`,
      };
      const marketAccess = marketShift.availability(marketClockContext());
      const marketListing = {
        title: "MINA'S MARKET — PAID STOCK + TILL SHIFT",
        detail: marketAccess.canBegin
          ? "OPEN NOW / COLD CHAIN · PRODUCE · STOCK · PACKING · TILL · WASH-UP"
          : marketAccess.reason === "already_completed_today"
            ? "TODAY'S SHIFT IS FILED / COME BACK TOMORROW"
            : `${marketShift.postedHours.label} / CLOCK IN AT THE INSIDE HANDOVER COUNTER`,
      };
      const communityContext = communityDirectorySnapshot();
      const openCommunityRoles = communityContext.roles.filter(role => role.canBegin).length;
      const communityListing = {
        title: "HARBOUR SKILLS HOUSE — 3 SHIFTS",
        detail: openCommunityRoles > 0
          ? `${openCommunityRoles} OPEN NOW / KITCHEN · REPAIR · LOCAL ARCHIVE`
          : "KITCHEN · REPAIR · LOCAL ARCHIVE / POSTED HOURS AT 42 MARINER WALK",
      };
      items = [garageListing, cafeListing, marketListing, communityListing, ...[...lifeActivity.available(lifeUnlockContext()), basketballActivity.available()].map(activity => ({
        title: activity.title,
        detail: activity.locked ? "LOCKED / KEEP LIVING THE STORY" : activity.description ?? activity.objective ?? "AVAILABLE IN THE CITY",
      }))];
    } else if (phoneApp === "contacts") {
      title = "CONTACTS";
      subtitle = "PEOPLE, NOT QUEST MARKERS";
      const communityStaff = communityDirectorySnapshot().staff;
      items = [...mainCharacters.filter(character => character.actor !== cafeStaffActors.get(ASHA_PATEL.id) &&
        character.actor !== marketStaffActors.get(MINA_OKAFOR.id)).map(character => ({
        title: character.actor.displayName,
        detail: character.actor.root.userData.home?.address ?? character.actor.storyRole?.replaceAll("-", " ") ?? "NEON CITY",
      })), ...residentialActorStates.map(resident => ({
        title: resident.name,
        detail: `${resident.activity.toUpperCase()} / ${resident.address}`,
      })), ...cafeStaffStates.map(staff => ({
        title: staff.name,
        detail: `${staff.jobTitle} / ${staff.activity.toUpperCase()} / ${staff.locationId === commonGroundCafeWorld.id ? commonGroundCafeWorld.address : cafeStaffActors.get(staff.id)?.root.userData.home?.address ?? "NEON CITY"}`,
      })), ...marketStaffStates.map(staff => ({
        title: staff.name,
        detail: `${staff.jobTitle} / ${staff.activity.toUpperCase()} / ${staff.locationId === minaMarketWorld.id ? minaMarketWorld.address : marketStaffActors.get(staff.id)?.root.userData.home?.address ?? "NEON CITY"}`,
      })), ...communityStaff.map(staff => ({
        title: staff.name,
        detail: `${staff.jobTitle} / ${staff.activity.toUpperCase()} / ${communityHubWorld.address}`,
      }))];
    } else if (phoneApp === "profile") {
      const profile = lifeProfile.snapshot();
      const latestShift = profile.shiftHistory.at(-1) ?? null;
      title = "LIFE PROFILE";
      const appetiteState = neighbourhoodRoutine.snapshot();
      subtitle = `${profile.needs.energyStatus} / ${profile.needs.hygieneStatus} / ${appetiteState.appetiteStatus}`;
      items = [
        {
          title: `ENERGY ${Math.round(profile.needs.energy)}% / HYGIENE ${Math.round(profile.needs.hygiene)}% / APPETITE ${Math.round(appetiteState.appetite)}%`,
          detail: "REST, WASH, SHOP, COOK, AND EAT — ORDINARY ROUTINES MATTER",
        },
        ...profile.skills.map(skill => ({
          title: `${skill.name}  LV ${skill.level} ${skill.levelName}`,
          detail: skill.experienceToNextLevel > 0
            ? `${skill.experience} XP / ${skill.experienceToNextLevel} TO NEXT LEVEL`
            : `${skill.experience} XP / EXPERT`,
        })),
        {
          title: latestShift ? "LATEST SHIFT" : "WORK HISTORY",
          detail: latestShift
            ? `${latestShift.activityId.replaceAll("_", " ").toUpperCase()}  $${latestShift.wage}  QUALITY ${Math.round(latestShift.quality * 100)}%`
            : "NO SHIFTS FILED YET — ORDINARY WORK BUILDS A LIFE",
        },
      ];
    } else if (phoneApp === "home") {
      const home = residentialFullSnapshot().homes.find(value => value.id === residentialRuntimeView.currentHomeId);
      title = "MY HOME";
      subtitle = home ? `${home.name} / ${home.address}` : "NO CURRENT HOME";
      items = homePhoneItems();
    } else if (phoneApp === "map") {
      const navigation = mapNavigation.snapshot();
      title = "NEON MAP";
      subtitle = navigation.navigation
        ? `NAVIGATING TO ${navigation.navigation.title}`
        : "TAP A PLACE OR DROP A WAYPOINT";
      // The map viewport and bottom sheet are fixed GPU meshes; listing rows
      // would obscure the shared retained GPS texture.
      items = [];
    } else if (phoneApp === "recents") {
      title = "RECENT APPS";
      subtitle = "TAP AN APP TO RETURN";
      items = phoneRecentApps.map(id => {
        const app = phoneApps.find(candidate => candidate.id === id);
        return { title: app?.name ?? id, detail: "RUNNING IN MEMORY" };
      });
    }
    return Object.freeze({
      open: phoneOpen,
      app: phoneApp,
      title,
      subtitle,
      selection: phoneSelection,
      scroll: phoneScroll,
      hover: phoneHover,
      pressed: phonePressed,
      openProgress: Math.max(0, Math.min(1, (presentationElapsed - phoneOpenedAt) / 0.28)),
      appProgress: phoneApp ? Math.max(0, Math.min(1, (presentationElapsed - phoneAppTransitionAt) / 0.24)) : 1,
      time: environmentState.timeLabel,
      mapNavigation: mapNavigation.snapshot(),
      items: Object.freeze(items.map(item => Object.freeze(item))),
    });
  }

  function serializableSnapshot({ reuseEntitiesForHud = false } = {}) {
    const playerState = player.snapshot();
    const vehicleObject = vehicles.playerVehicle;
    const vehicleState = vehicleObject ? { ...vehicleObject.snapshot(), maxHealth: vehicleObject.maxHealth } : null;
    const target = targetForHud();
    const position = controlledPosition();
    const district = world.districtAt?.(position.x, position.z) ?? null;
    const environmentState = environment.snapshot();
    const neighbourhoodState = neighbourhoodRoutine.snapshot();
    const effectsState = effects.snapshot();
    const roadsideState = roadsideResponse?.snapshot() ?? null;
    const entities = entitySnapshots(reuseEntitiesForHud);
    return {
      ready: pipelineWarmupState.ready,
      elapsed,
      paused,
      capture: Object.freeze({
        ...input.captureSnapshot(),
        locked: input.pointer.locked || input.uiPointerMode || developmentCaptured,
        synthetic: developmentCaptured && !input.pointer.locked,
      }),
      player: playerState,
      vehicle: vehicleState,
      wanted: wanted.snapshot(),
      mission: mission.snapshot(),
      story: story.snapshot(),
      chapterTwo: chapterTwo.snapshot(),
      nightRoute: nightRoute.snapshot(),
      nightRouteAvailability: nightRoute.availability(nightRouteUnlockContext()),
      narrative: desertOutskirts.presentation() ?? narrativePresentation(),
      chapterTwoMission: chapterTwoMissionView(),
      communityTrust,
      neighbourhood: Object.freeze({
        ...neighbourhoodState,
        businesses: neighbourhoodRoutine.available({
          timeHours: environmentState.timeHours,
          weather: environmentState.weather,
          story: story.snapshot(),
        }),
      }),
      selectedActivity,
      activity: selectedActivitySnapshot(),
      garageShift: garageShift.snapshot(),
      garageShiftAvailability: garageShift.availability(garageShiftContext()),
      communityHub: communityPresentationSnapshot(),
      cafeShift: cafeShift.snapshot(),
      cafeShiftAvailability: cafeShift.availability(cafeClockContext()),
      marketShift: marketShift.snapshot(),
      marketShiftAvailability: marketShift.availability(marketClockContext()),
      interiorOccupancy: interiorOccupancy.snapshot(),
      lifeProfile: lifeProfile.snapshot(),
      residential: Object.freeze({
        dayIndex: residentialRuntimeView.dayIndex,
        minuteOfDay: residentialRuntimeView.minuteOfDay,
        currentHomeId: residentialRuntimeView.currentHomeId,
        inside: insideResidentialHome(position),
        visitorActive: residentialRuntimeView.visitorActive,
        visitorResidentId: residentialRuntimeView.visitorResidentId,
        rentDue: residentialRuntimeView.rentDue,
        carriedSupplies: residentialFullSnapshot().player.carriedSupplies,
        residents: residentialActorStates,
      }),
      roadside: roadsideState,
      lifeActivities: [
        Object.freeze({
          ...garageShift.snapshot(),
          availability: garageShift.availability(garageShiftContext()),
        }),
        Object.freeze({
          id: communityHubWorld.id,
          title: communityHubWorld.label,
          description: "THREE STAFFED LAWFUL SHIFTS INSIDE A REAL WALK-IN PUBLIC BUILDING",
          roles: communityDirectorySnapshot().roles,
        }),
        Object.freeze({
          id: COMMON_GROUND_SHIFT_ROLE.id,
          title: COMMON_GROUND_SHIFT_ROLE.name,
          description: "PAID HOSPITALITY WORK INSIDE A REAL WALK-IN CAFE",
          availability: cafeShift.availability(cafeClockContext()),
        }),
        Object.freeze({
          id: MINA_MARKET_SHIFT_ROLE.id,
          title: MINA_MARKET_SHIFT_ROLE.name,
          description: "PAID STOCK, COLD-CHAIN, PACKING, TILL, CLEANING, AND SURPLUS WORK INSIDE A WALK-IN MARKET",
          availability: marketShift.availability(marketClockContext()),
        }),
        ...lifeActivity.available(lifeUnlockContext()),
        basketballActivity.available(),
      ],
      vehicles: entities.vehicles,
      population: entities.population,
      phone: phoneSnapshot(),
      mainCharacters: mainCharacters.map(character => Object.freeze({
        id: character.actor.id,
        name: character.actor.displayName,
        home: character.actor.root.userData.home,
        position: Object.freeze(character.actor.root.position.toArray()),
      })),
      communityStaff: communityDirectorySnapshot().staff.map(state => {
        const actor = communityStaffActors.get(state.id);
        return Object.freeze({
          ...state,
          position: Object.freeze(actor?.root.position.toArray() ?? []),
          destination: actor?.routineDestinationActive ? Object.freeze(actor.routineDestination.toArray()) : null,
          arrived: Boolean(actor?.routineDestinationActive && actor.routineDestinationArrived),
        });
      }),
      cafeStaff: cafeStaffStates.map(state => {
        const actor = cafeStaffActors.get(state.id);
        return Object.freeze({
          ...state,
          position: Object.freeze(actor?.root.position.toArray() ?? []),
          destination: actor?.routineDestinationActive ? Object.freeze(actor.routineDestination.toArray()) : null,
          arrived: Boolean(actor?.routineDestinationActive && actor.routineDestinationArrived),
        });
      }),
      marketStaff: marketStaffStates.map(state => {
        const actor = marketStaffActors.get(state.id);
        return Object.freeze({
          ...state,
          position: Object.freeze(actor?.root.position.toArray() ?? []),
          destination: actor?.routineDestinationActive ? Object.freeze(actor.routineDestination.toArray()) : null,
          arrived: Boolean(actor?.routineDestinationActive && actor.routineDestinationArrived),
        });
      }),
      desertOutskirts: desertOutskirts.snapshot(),
      pickups: effectsState,
      prompt: contextPrompt(),
      toast,
      toastUntil,
      targetPosition: target?.toArray?.() ?? null,
      targetDistance: target ? position.distanceTo(target) : null,
      world: {
        bounds: world.bounds,
        stats: world.stats,
        pulseTransit: world.pulseTransit,
        pulseGarageInterior: Object.freeze({
          id: pulseGarageInterior.id,
          seed: pulseGarageInterior.seed,
          bounds: pulseGarageInterior.bounds,
          entrance: pulseGarageInterior.entrance,
          stations: pulseGarageInterior.stations,
          stats: pulseGarageInterior.stats,
        }),
        residentialInterior: Object.freeze({
          id: residentialInterior.id,
          homeId: residentialInterior.homeId,
          label: residentialInterior.label,
          address: residentialInterior.address,
          buildingId: residentialInterior.buildingId,
          bounds: residentialInterior.bounds,
          entrance: residentialInterior.entrance,
          zones: residentialInterior.zones,
          stations: residentialInterior.stations,
          spawnPoints: residentialInterior.spawnPoints,
          stats: residentialInterior.stats,
        }),
        communityHub: Object.freeze({
          id: communityHubWorld.id,
          label: communityHubWorld.label,
          address: communityHubWorld.address,
          buildingId: communityHubWorld.buildingId,
          hostBuildingRecordId: communityHubWorld.hostBuildingRecordId,
          bounds: communityHubWorld.bounds,
          entrance: communityHubWorld.entrance,
          zones: communityHubWorld.zones,
          doorways: communityHubWorld.doorways,
          stations: communityHubWorld.stations,
          spawnPoints: communityHubWorld.spawnPoints,
          stats: communityHubWorld.stats,
        }),
        commonGroundCafe: Object.freeze({
          id: commonGroundCafeWorld.id,
          label: commonGroundCafeWorld.label,
          address: commonGroundCafeWorld.address,
          buildingId: commonGroundCafeWorld.buildingId,
          hostBuildingRecordId: commonGroundCafeWorld.hostBuildingRecordId,
          bounds: commonGroundCafeWorld.bounds,
          entrance: commonGroundCafeWorld.entrance,
          zones: commonGroundCafeWorld.zones,
          doorways: commonGroundCafeWorld.doorways,
          stations: commonGroundCafeWorld.stations,
          customerAnchors: commonGroundCafeWorld.customerAnchors,
          spawnPoints: commonGroundCafeWorld.spawnPoints,
          stats: commonGroundCafeWorld.stats,
        }),
        minaMarketKitchen: Object.freeze({
          id: minaMarketWorld.id,
          label: minaMarketWorld.label,
          address: minaMarketWorld.address,
          buildingId: minaMarketWorld.buildingId,
          hostBuildingRecordId: minaMarketWorld.hostBuildingRecordId,
          bounds: minaMarketWorld.bounds,
          entrance: minaMarketWorld.entrance,
          zones: minaMarketWorld.zones,
          doorways: minaMarketWorld.doorways,
          stations: minaMarketWorld.stations,
          staffAnchors: minaMarketWorld.staffAnchors,
          customerAnchors: minaMarketWorld.customerAnchors,
          spawnPoints: minaMarketWorld.spawnPoints,
          occupancySlots: minaMarketWorld.occupancySlots,
          itineraries: minaMarketWorld.itineraries,
          stats: minaMarketWorld.stats,
        }),
        roadSpacing: 48,
        roadCenters: world.roadCenters,
        mapFeatures: world.mapFeatures,
        minimapRadius: 104,
        district,
      },
      environment: environmentState,
      diagnostics: {
        backend: "NATIVE WEBGPU",
        phoneCanvasRedraws: hud?.phoneCanvasRedrawCount ?? 0,
        calls: Number(renderer.info.render.calls) || 0,
        triangles: Number(renderer.info.render.triangles) || 0,
        fps: smoothedFps,
        camera: {
          ...chaseCamera.snapshot(),
          position: camera.position.toArray(),
          rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
          quaternion: camera.quaternion.toArray(),
          worldDirection: camera.getWorldDirection(diagnosticDirection).toArray(),
          worldUp: diagnosticUp.set(0, 1, 0).applyQuaternion(camera.quaternion).toArray(),
        },
        audio: gameAudio.snapshot?.() ?? null,
        firstPersonWeapon: firstPersonWeapon.snapshot(),
        cinematic: cinematicDirector.snapshot(),
        playerRootRoll: player.root.rotation.z,
        headlights: {
          active: headlightsActive,
          stableLightSet: headlightRig.visible,
          intensity: headlightLamps.reduce((sum, light) => sum + light.intensity, 0),
        },
        effects: {
          active: Number(effectsState.activeEffects) || 0,
        },
        populationSpawnReserve: population.spawnReserveSnapshot(),
        roadside: roadsideState,
        basketball: basketballActivity.snapshot(),
        neighbourhood: {
          transactionSerial: neighbourhoodState.transactionSerial,
          businessCount: neighbourhoodState.businessCount,
          appetite: neighbourhoodState.appetite,
          menuOpen: neighbourhoodState.menuOpen,
        },
        chapterTwo: {
          phase: chapterTwo.snapshot().phase,
          chapterStarted: chapterTwo.snapshot().chapterStarted,
          chapterCompleted: chapterTwo.snapshot().chapterCompleted,
          clueProgress: chapterTwo.snapshot().clueProgress,
          choiceResult: chapterTwo.snapshot().choiceResult,
        },
        nightRoute: {
          phase: nightRoute.snapshot().phase,
          started: nightRoute.snapshot().started,
          completed: nightRoute.snapshot().completed,
          choiceResult: nightRoute.snapshot().choiceResult,
          moralLedger: nightRoute.snapshot().moralLedger,
          handledEventSerial: lastNightRouteHandledEventSerial,
          completionEventsHandled: nightRouteCompletionEventsHandled,
          lastHandledEvent: lastNightRouteHandledEvent,
          participantKind: "night-route-participant",
          participantLayout: nightRouteParticipantLayoutSignature,
          participants: nightRouteParticipantSnapshot(),
          rosaActorId: shopkeeperActors.get("southline_diner")?.id ?? null,
          pulseTransitVehicleId: pulseTransitVehicle?.id ?? null,
          pulseTransitVehicleVisible: Boolean(pulseTransitVehicle?.root?.visible),
          pulseTransitRenderDrawables: nightRouteDinerRenderHidden.length,
          pulseTransitRenderLights: nightRouteDinerRenderZeroIntensity.length,
        },
        hud: {
          maximumRefreshHz: 30,
          entityRefreshHz: 20,
        },
        minimap: Object.freeze({
          rasterWidth: Number(hud?.minimapTexture?.image?.width) || 0,
          rasterHeight: Number(hud?.minimapTexture?.image?.height) || 0,
          rasterScale: Number(hud?.minimapTexture?.userData?.minimapRasterScale) || 1,
          placeIconPolicy: String(hud?.minimapTexture?.userData?.placeIconPolicy ?? ""),
          placeIconStats: hud?.minimapPlaceIconStats ?? Object.freeze({}),
        }),
        lighting: {
          phase: environmentState.phase,
          daylight: environmentState.daylight,
          night: environmentState.night,
          sunElevation: environmentState.sunElevation,
          streetlightFactor: environmentState.streetlight,
          practicalLightsOn: practicalWorldLights.reduce((count, light) =>
            count + Number(light.intensity > 0.1), 0),
          pulseTransitPracticalLightsOn: pulseTransitPracticalLights.reduce((count, light) =>
            count + Number(light.intensity > 0.1), 0),
          practicalIntensity: practicalWorldLights.reduce((sum, light) => sum + Number(light.intensity || 0), 0),
          celestialKeyIntensity: Number(celestialKeyLight?.intensity || 0),
        },
        presentation: presenter.snapshot(),
        pipelineWarmup: pipelineWarmupState,
        simulationWarmup: simulationWarmupState,
        frameTiming: frameTimingSnapshot(),
      },
    };
  }

  function fixedUpdate(delta, { captureSnapshot = true } = {}) {
    presentationElapsed += Math.max(0, Number(delta) || 0);
    const physicalCapture = Boolean(input.pointer.locked);
    const gameplayCaptured = physicalCapture || developmentCaptured || controlStepping;
    const interactive = gameplayCaptured || Boolean(input.uiPointerMode);
    if (physicalCapture && !lastCaptureLocked) {
      story.notify({ type: "capture_started" });
      processStoryEvents();
    }
    lastCaptureLocked = physicalCapture;
    if (interactive) handleActions();
    // Opening the phone is a deliberate soft pause: cursor-driven UI keeps
    // ticking at 60 Hz while traffic, combat, needs and story time stand still.
    const dt = paused || !gameplayCaptured || input.uiPointerMode ? 0 : delta;
    if (dt > 0) {
      story.update(dt);
      processStoryEvents();
      chapterTwo.update(dt);
      processChapterTwoEvents();
    }
    if (dt > 0) {
      const positionBefore = positionBeforeUpdate.copy(controlledPosition());
      const healthBefore = player.health;
      const wantedState = wanted.update(dt, { observed: policeObserving(positionBefore) });
      if (wantedState.stars !== lastWantedStars) {
        if (wantedState.stars > lastWantedStars) gameAudio.play("radio", Math.min(0.7, 0.32 + wantedState.stars * 0.07));
        mission.notify({ type: "wanted_changed", stars: wantedState.stars });
        lastWantedStars = wantedState.stars;
      }

      const rainAmount = environment.snapshot().rain;
      const lightingBeforeUpdate = environment.snapshot();
      const neighbourhoodState = neighbourhoodRoutine.update(dt, {
        timeHours: lightingBeforeUpdate.timeHours,
        weather: lightingBeforeUpdate.weather,
        story: story.snapshot(),
        paused: false,
        captureSnapshot: false,
      });
      const activeSideActivity = selectedActivitySnapshot();
      lifeProfile.update(dt, {
        paused: false,
        working: activeSideActivity?.status === "active",
        sprinting: input.actionDown("sprint"),
        captureSnapshot: false,
      });
      residentialRuntimeView = residentialLife.update(dt, {
        timeHours: lightingBeforeUpdate.timeHours,
        captureSnapshot: false,
      });
      syncResidentialActors(false);
      communityRuntimeClockContext.dayIndex = residentialRuntimeView.dayIndex;
      communityRuntimeClockContext.minuteOfDay = residentialRuntimeView.minuteOfDay;
      const communityMinuteStamp = communityRuntimeClockContext.dayIndex * 1440 + communityRuntimeClockContext.minuteOfDay;
      if (selectedActivity !== "community" && communityMinuteStamp !== lastCommunityScheduleMinute) {
        communityRuntimeView = communityHubLife.update(0, communityRuntimeClockContext);
      }
      if (communityMinuteStamp !== lastCommunityScheduleMinute) {
        syncCommunityStaff(false, communityRuntimeClockContext);
      }
      cafeRuntimeClockContext.dayIndex = residentialRuntimeView.dayIndex;
      cafeRuntimeClockContext.minuteOfDay = residentialRuntimeView.minuteOfDay;
      const cafeMinuteStamp = cafeRuntimeClockContext.dayIndex * 1440 + cafeRuntimeClockContext.minuteOfDay;
      if (selectedActivity !== "cafe" && cafeMinuteStamp !== lastCafeScheduleMinute) {
        cafeRuntimeView = cafeShift.update(0, cafeRuntimeClockContext);
      }
      if (cafeMinuteStamp !== lastCafeScheduleMinute) syncCafeStaff(false, cafeRuntimeClockContext);
      marketRuntimeClockContext.dayIndex = residentialRuntimeView.dayIndex;
      marketRuntimeClockContext.minuteOfDay = residentialRuntimeView.minuteOfDay;
      const marketMinuteStamp = marketRuntimeClockContext.dayIndex * 1440 + marketRuntimeClockContext.minuteOfDay;
      if (selectedActivity !== "market" && marketMinuteStamp !== lastMarketScheduleMinute) {
        marketRuntimeView = marketShift.update(0, marketRuntimeClockContext);
      }
      if (marketMinuteStamp !== lastMarketScheduleMinute) syncMarketStaff(false, marketRuntimeClockContext);
      const roadsideState = roadsideResponse?.update(dt, {
        playerX: positionBefore.x,
        playerZ: positionBefore.z,
        wantedStars: wantedState.stars,
        narrativeBusy: narrativeMissionBusy() || narrativePresentation().controlsLocked,
        activityBusy: activeSideActivity?.status === "active",
        rain: lightingBeforeUpdate.rain,
        timeHours: lightingBeforeUpdate.timeHours,
      });
      processRoadsidePresentation(roadsideState, positionBefore);
      const taxiBeforeVehicles = selectedActivity === "taxi" ? taxiActivity.snapshot() : null;
      vehicles.update(dt, {
        targetPosition: positionBefore,
        wantedStars: wantedState.stars,
        lightLevel: Math.max(lightingBeforeUpdate.streetlight, lightingBeforeUpdate.rain * 0.62),
        taxiPassengerVehicleId: taxiBeforeVehicles?.passengerOnBoard
          ? taxiBeforeVehicles.assignedVehicleId
          : null,
        captureSnapshot: false,
      });
      updatePlayerHeadlights(vehicles.playerVehicle, lightingBeforeUpdate);
      for (const vehicle of vehicles.vehicles) {
        const damageRatio = clamp(1 - vehicle.health / Math.max(1, vehicle.maxHealth), 0, 1);
        if (damageRatio > 0.42) {
          effects.vehicleDamage(vehicle.root.position, vehicle.state.yaw, damageRatio, {
            id: vehicle.id,
            burning: vehicle.health <= 0 || damageRatio > 0.86,
          });
        }
      }
      if (vehicles.playerVehicle) {
        const driven = vehicles.playerVehicle;
        const throttle = Math.max(Number(driven.lastControls?.throttle) || 0, Number(driven.lastControls?.reverse) || 0);
        effects.exhaust(driven.root.position, driven.state.yaw, 0.18 + throttle * 0.82);
        const slip = Math.min(1, Math.abs(driven.state.lateralSpeed ?? 0) / 5.5 +
          (driven.lastControls?.handbrake && Math.abs(driven.state.speed) > 4 ? 0.68 : 0));
        if (slip > 0.26 && world.isRoad?.(driven.state.x, driven.state.z)) {
          effects.skid(driven.root.position, driven.state.yaw, driven.radius, slip);
        }
        if (rainAmount > 0.08 && world.isRoad?.(driven.state.x, driven.state.z)) {
          const sprayIntensity = rainAmount * clamp((Math.abs(driven.state.speed) - 2) / 20, 0, 1);
          effects.tireSpray(driven.root.position, driven.state.yaw, driven.radius, sprayIntensity);
        }
      }
      if (player.vehicle && !vehicles.playerVehicle) {
        player.exitVehicle(player.root.position);
        player.damage(28, { ignoreArmor: true });
        showToast("VEHICLE DESTROYED", 2.8);
      }
      const storyState = desertOutskirts.presentation() ?? narrativePresentation();
      const basketballState = selectedActivity === "basketball" ? basketballActivity.snapshot() : null;
      const basketballLocksPlayer = basketballState?.stage === BASKETBALL_STAGES.CHARGING ||
        basketballState?.stage === BASKETBALL_STAGES.FLIGHT;
      const businessLocksPlayer = neighbourhoodState.menuOpen || phoneOpen;
      const firstPersonAim = !storyState.controlsLocked && !basketballLocksPlayer && !businessLocksPlayer &&
        !vehicles.playerVehicle && input.actionDown("aim");
      player.setFirstPerson?.(firstPersonAim);
      const aim = chaseCamera.aimRay(aimOrigin, aimDirection);
      player.update(dt, {
        elapsed,
        vehicle: vehicles.playerVehicle,
        cameraForward: chaseCamera.flatForward,
        cameraRight: chaseCamera.right,
        aimDirection: aim.direction,
        canShoot: chaseCamera.snapshot().aimBlend > 0.88,
        // The prop and pose are precreated with Kai's rig.  Story state only
        // supplies a level-triggered flag, so entering a call cannot allocate
        // geometry or discover a new material/pipeline on a gameplay frame.
        phoneCall: Boolean(storyState.line?.radio),
        disabled: storyState.controlsLocked || basketballLocksPlayer || businessLocksPlayer,
        staminaRecoveryMultiplier: neighbourhoodState.recoveryMultiplier * lifeProfile.staminaRecoveryMultiplier(),
        groundHeight: playerGroundHeight,
        constrainMotion: constrainPlayerAgainstVehicleBoxes,
        captureSnapshot: false,
      });
      const focus = controlledPosition();
      gameplayFill.position.copy(focus);
      gameplayFill.position.x += 2.5;
      gameplayFill.position.y += 5.5;
      gameplayFill.position.z += 3.5;
      interiorOccupancy.update(dt, {
        dayIndex: residentialRuntimeView.dayIndex,
        minuteOfDay: residentialRuntimeView.minuteOfDay,
        captureSnapshot: false,
      });
      // Stuck named-resident repairs are queued by the population hot loop and
      // drained one at a time here, before the next actor update. This keeps a
      // full navigation search out of population.update and bounds frame cost.
      population.flushRoutineRouteSearches?.(1);
      population.update(dt, {
        targetPosition: focus,
        wantedStars: wantedState.stars,
        vehicles: vehicles.vehicles,
        playerVehicle: vehicles.playerVehicle,
        timeHours: lightingBeforeUpdate.timeHours,
        rain: rainAmount,
        daylight: lightingBeforeUpdate.daylight,
        captureSnapshot: false,
      });
      desertOutskirts.update(dt, focus);
      const desertState = desertOutskirts.snapshot();
      if (desertState.cutsceneActive && !desertCutsceneAnnounced) {
        desertCutsceneAnnounced = true;
        showToast("ASHWIND RESCUE — FIND MARA IN THE RUINS", 7.2);
      }
      if (desertState.friend.rescued && !desertRescueAnnounced) {
        desertRescueAnnounced = true;
        showToast("MARA IS SAFE — THE RUINS ARE QUIET", 6);
      }
      for (const vehicle of vehicles.vehicles) {
        const pedestrianImpacts = population.hitByVehicle(
          vehicle.root.position,
          vehicle.radius,
          vehicle.state.speed,
          vehicle === vehicles.playerVehicle,
          { width: vehicle.width, length: vehicle.length, yaw: vehicle.state.yaw },
        );
        for (const impact of pedestrianImpacts) {
          if (!impact?.accepted || !impact.position) continue;
          const point = vectorFrom(impact.position);
          point.y += 0.92;
          effects.impact(point, {
            hitPolice: Boolean(impact.police),
            hitCivilian: !impact.police,
            heavy: Boolean(impact.ragdoll),
            severity: clamp((impact.impactSpeed ?? Math.abs(vehicle.state.speed)) / 7, 0.7, 2.2),
          });
          gameAudio.playAt("impact",
            (vehicle === vehicles.playerVehicle ? 0.42 : 0.28) + Math.min(0.28, Math.abs(vehicle.state.speed) * 0.018),
            point);
          if (vehicle === vehicles.playerVehicle) {
            chaseCamera.shake(Math.min(0.18, 0.045 + Math.abs(vehicle.state.speed) * 0.006), 0.22);
          }
        }
        const playerDx = player.root.position.x - vehicle.root.position.x;
        const playerDz = player.root.position.z - vehicle.root.position.z;
        const vehicleCos = Math.cos(vehicle.state.yaw);
        const vehicleSin = Math.sin(vehicle.state.yaw);
        const playerLocalX = playerDx * vehicleCos - playerDz * vehicleSin;
        const playerLocalZ = playerDx * vehicleSin + playerDz * vehicleCos;
        const playerInsideVehicleBox = Math.abs(playerLocalX) <= vehicle.width * 0.5 + 0.43 &&
          Math.abs(playerLocalZ) <= vehicle.length * 0.5 + 0.43;
        if (!player.vehicle && player.alive && Math.abs(vehicle.state.speed) > 4.2 && playerInsideVehicleBox) {
          player.damage(Math.min(48, Math.abs(vehicle.state.speed) * 1.8));
        }
      }
      applyPickups(focus);
      const activityAfterUpdate = updateSideActivity(dt);
      if (garageCustomerActor && elapsed >= garageCustomerReleaseAt) releaseGarageCustomerPresentation();
      syncTaxiPassengerPresentation(selectedActivity === "taxi" ? activityAfterUpdate : null);
      updateMission(dt);
      updateMissionMarker();
      effects.update(dt, elapsed, {
        targetObject: mission.snapshot().stage === MISSION_STAGES.STEAL ? vehicles.targetVehicle : null,
        guidanceVisible: !isAuthoredNarrativePresentation(narrativePresentation()),
      });
      const environmentState = environment.update(dt, elapsed, focus);
      if (environmentState.lightning > 0.38 && lastLightning <= 0.38 && thunderAt === null) {
        thunderAt = elapsed + 0.32 + (Math.sin(elapsed * 1.713) + 1) * 0.19;
      }
      if (thunderAt !== null && elapsed >= thunderAt) {
        const thunderDistance = 130 + environmentState.rain * 90;
        const thunderAngle = elapsed * 1.713 + environmentState.rain * 2.1;
        thunderSourcePosition.set(
          focus.x + Math.cos(thunderAngle) * thunderDistance,
          focus.y + 58 + environmentState.rain * 44,
          focus.z + Math.sin(thunderAngle) * thunderDistance,
        );
        gameAudio.playAt("thunder", 0.42 + environmentState.rain * 0.32, thunderSourcePosition);
        chaseCamera.shake(0.018 + environmentState.rain * 0.012, 0.42);
        thunderAt = null;
      }
      lastLightning = environmentState.lightning;
      world.setTimeOfDay?.(environmentState.timeHours);
      world.setWetness?.(environmentState.wetness);
      syncBusinessLighting(environmentState.timeHours, environmentState.weather);
      world.update(elapsed, focus);
      gameplayAmbient.intensity = 0.24 + environmentState.daylight * 0.56 + environmentState.night * 0.18 - environmentState.rain * 0.045;
      gameplayAmbient.color.setHex(0x6e97ba).lerp(gameplayAmbientDayColor, environmentState.daylight);
      gameplayFill.intensity = 9 + environmentState.night * 18 + environmentState.rain * 3;
      renderer.toneMappingExposure += ((0.92 + environmentState.daylight * 0.10 + environmentState.night * 0.04 - environmentState.rain * 0.04) - renderer.toneMappingExposure) *
        (1 - Math.exp(-dt * 0.7));
      const healthAfterDamage = player.health;
      if (healthAfterDamage < healthBefore) {
        chaseCamera.shake(Math.min(0.28, 0.08 + (healthBefore - healthAfterDamage) * 0.006), 0.34);
      }
      // Camera ownership is exclusive.  Letting the gameplay chase rig write
      // first on every cinematic frame caused the authored director to blend
      // only a few percent away from third person, so every supposed cut read
      // as ordinary gameplay.  The chase rig resumes and snaps behind only
      // after the sequence ends.
      const storyForCamera = desertOutskirts.presentation() ?? narrativePresentation();
      if (!storyForCamera.cinematic) {
        chaseCamera.update(dt, vehicles.playerVehicle ?? player, {
          driving: Boolean(vehicles.playerVehicle),
          speed: vehicles.playerVehicle?.state?.speed ?? 0,
          steering: vehicles.playerVehicle?.state?.steering ?? 0,
          lateralSpeed: vehicles.playerVehicle?.state?.lateralSpeed ?? 0,
          aiming: firstPersonAim,
        });
      }
      const cinematicResult = cinematicDirector.update(dt, storyForCamera, {
        player: player.root,
        juno: junoActor.root,
        rin: rinActor.root,
        garage: contactPosition,
        comet: vehicles.targetVehicle?.root ?? targetSpawn,
        city: cityStoryAnchor,
        leah: leahActor.root,
        mara: maraActor.root,
        dara: depotClerkActor.root,
        cafe: chapterTwoLeahPosition,
        depot: chapterTwoWorld.focus ?? chapterTwoDepotManifestPosition,
        manifest: chapterTwoDepotManifestPosition,
        manifestProp: chapterTwoDepotManifestCinematicPosition,
        evidenceTable: chapterTwoEvidenceCinematicPositions.get("supplier_invoice"),
        evidenceHose: chapterTwoEvidenceCinematicPositions.get("failed_brake_hose"),
        evidenceInvoice: chapterTwoEvidenceCinematicPositions.get("supplier_invoice"),
        evidenceLog: chapterTwoEvidenceCinematicPositions.get("service_log"),
        evidenceHoseStage: chapterTwoGarageCluePositions.get("failed_brake_hose"),
        evidenceInvoiceStage: chapterTwoGarageCluePositions.get("supplier_invoice"),
        evidenceLogStage: chapterTwoGarageCluePositions.get("service_log"),
        recallBoard: chapterTwoRecallBoardCinematicPosition,
        recallStage: chapterTwoRecallDeskPosition,
        nightDiner: nightRouteDinerPosition,
        nightKaiStage: nightRouteKaiStagePosition,
        nightSpeaker: nightRouteSpeakerAnchor(),
        nightRosa: shopkeeperActors.get("southline_diner")?.root ?? nightRouteDinerPosition,
        nightMalik: nightRouteParticipantActors.get(NIGHT_ROUTE_CHARACTERS.malik.id)?.root ?? null,
        nightEvelyn: nightRouteParticipantActors.get(NIGHT_ROUTE_CHARACTERS.evelyn.id)?.root ?? null,
        nightDesmond: nightRouteParticipantActors.get(NIGHT_ROUTE_CHARACTERS.desmond.id)?.root ?? null,
        desertRuins: desertRuinsPosition,
        desertFriend: desertOutskirts.friend,
        nightNadiya: nightRouteParticipantActors.get(NIGHT_ROUTE_CHARACTERS.nadiya.id)?.root ?? null,
      });
      if (cinematicResult.ended || (cinematicWasActive && !cinematicResult.active)) {
        chaseCamera.snapBehind(vehicles.playerVehicle?.state?.yaw ?? player.root.rotation.y);
      }
      cinematicWasActive = cinematicResult.active;
      camera.getWorldDirection(audioListenerForward);
      audioListenerUp.copy(camera.up).applyQuaternion(camera.quaternion).normalize();
      gameAudio.updateListener(camera.position, audioListenerForward, audioListenerUp);
      let nearestSirenVehicle = null;
      let nearestSirenDistanceSq = Infinity;
      if (wantedState.stars > 0) {
        for (const vehicle of vehicles.vehicles) {
          if (!vehicle.police || vehicle.health <= 0 || vehicle.driver !== "police") continue;
          const dx = vehicle.root.position.x - camera.position.x;
          const dy = vehicle.root.position.y - camera.position.y;
          const dz = vehicle.root.position.z - camera.position.z;
          const distanceSq = dx * dx + dy * dy + dz * dz;
          if (distanceSq >= nearestSirenDistanceSq) continue;
          nearestSirenDistanceSq = distanceSq;
          nearestSirenVehicle = vehicle;
        }
      }
      gameAudio.update({
        driving: Boolean(vehicles.playerVehicle),
        speed: vehicles.playerVehicle?.state?.speed ?? 0,
        wantedStars: wantedState.stars,
        rain: rainAmount,
        timeHours: lightingBeforeUpdate.timeHours,
        tireSlip: vehicles.playerVehicle
          ? Math.min(1, Math.abs(vehicles.playerVehicle.state?.lateralSpeed ?? 0) / 7 +
            (input.actionDown("handbrake") && Math.abs(vehicles.playerVehicle.state?.speed ?? 0) > 5 ? 0.62 : 0))
          : 0,
        sirenPosition: nearestSirenVehicle?.root?.position ?? null,
        sirenSourceId: nearestSirenVehicle?.id ?? null,
      });
      firstPersonWeapon.update(dt, {
        aiming: firstPersonAim,
        weapon: player.weapon,
        muzzleFlash: player.muzzleFlash,
        speed: player.speed,
        elapsed,
      });
      if (!player.alive && deathAt === null) {
        deathAt = elapsed;
        neighbourhoodRoutine.close("player_wasted");
        if (vehicles.playerVehicle) exitVehicle();
        showToast("WASTED", 8);
      }
      if (player.alive) deathAt = null;
    }
    return captureSnapshot ? serializableSnapshot() : null;
  }

  let lastSnapshot = null;
  function renderFrame({ forceHud = false } = {}) {
    renderer.info.reset();
    const stageStartedAt = Number(globalThis.performance?.now?.() ?? Date.now());
    presenter.stage(scene, camera, nightRouteRenderOnlyHidden() ? nightRouteDinerRenderOptions : null);
    framePhaseLatestMs.worldStage = Math.max(0, Number(globalThis.performance?.now?.() ?? Date.now()) - stageStartedAt);
    const nowMs = Number(globalThis.performance?.now?.() ?? Date.now());
    framePhaseLatestMs.hud = 0;
    if (forceHud || !lastSnapshot || nowMs - lastHudRefreshAtMs >= HUD_MIN_REFRESH_MS) {
      const hudStartedAt = Number(globalThis.performance?.now?.() ?? Date.now());
      lastSnapshot = serializableSnapshot({ reuseEntitiesForHud: true });
      hud.update(lastSnapshot);
      hud.renderToTexture();
      framePhaseLatestMs.hud = Math.max(0, Number(globalThis.performance?.now?.() ?? Date.now()) - hudStartedAt);
      lastHudRefreshAtMs = nowMs;
    }
    const presentStartedAt = Number(globalThis.performance?.now?.() ?? Date.now());
    if (!presenter.present()) throw new Error("The single-surface swap-chain presentation failed");
    framePhaseLatestMs.present = Math.max(0, Number(globalThis.performance?.now?.() ?? Date.now()) - presentStartedAt);
  }

  function animate(timestampMs) {
    const animationStartedAt = Number(globalThis.performance?.now?.() ?? Date.now());
    if (disposed) return;
    const now = Number(timestampMs) * 0.001;
    const rawFrameDelta = Math.max(0, now - lastFrame);
    const frameDelta = Math.min(MAX_FRAME_DELTA, rawFrameDelta);
    const syntheticControlFrame = controlStepping || suppressFrameTimingFrames > 0;
    if (suppressFrameTimingFrames > 0) suppressFrameTimingFrames -= 1;
    if (pipelineWarmupState.ready && !syntheticControlFrame && rawFrameDelta > 0.0001) recordFrameTiming(rawFrameDelta * 1000);
    if (frameDelta > 0.0001) smoothedFps += (1 / frameDelta - smoothedFps) * 0.08;
    lastFrame = now;
    accumulator = Math.min(MAX_FRAME_DELTA * 2, accumulator + frameDelta);
    const simulationStartedAt = Number(globalThis.performance?.now?.() ?? Date.now());
    let fixedSteps = 0;
    while (accumulator >= FIXED_STEP) {
      if (!paused && (input.pointer.locked || developmentCaptured || controlStepping)) elapsed += FIXED_STEP;
      fixedUpdate(FIXED_STEP, { captureSnapshot: false });
      accumulator -= FIXED_STEP;
      fixedSteps += 1;
    }
    framePhaseLatestMs.simulation = Math.max(0, Number(globalThis.performance?.now?.() ?? Date.now()) - simulationStartedAt);
    renderFrame();
    framePhaseLatestMs.animation = Math.max(0, Number(globalThis.performance?.now?.() ?? Date.now()) - animationStartedAt);
    if (!syntheticControlFrame) recordFramePhases();
    input.endFrame({ simulationAdvanced: fixedSteps > 0 });
    if (elapsed >= telemetryAt) {
      telemetryAt = (Math.floor(elapsed / TELEMETRY_INTERVAL) + 1) * TELEMETRY_INTERVAL;
      const state = lastSnapshot ?? serializableSnapshot();
      console.log(
        `[GTA Neon City] t=${elapsed.toFixed(1)}s mode=${state.vehicle ? "DRIVING" : "ON FOOT"}` +
        ` wanted=${state.wanted.stars} mission=${state.mission.stage}` +
        ` weather=${state.environment.weather.toLowerCase()} time=${state.environment.timeLabel}` +
        ` calls=${state.diagnostics.calls} triangles=${state.diagnostics.triangles}`,
      );
    }
  }

  function onResize() {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setPixelRatio(displayPixelRatio(width, height));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    hud.resize(width, height);
    presenter.resize();
    lastHudRefreshAtMs = -Infinity;
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    renderer.setAnimationLoop(null);
    globalThis.removeEventListener("resize", onResize);
    await controlServer?.close?.();
    frameCapture.dispose();
    gameAudio.dispose();
    basketballActivity.dispose();
    presenter.dispose();
    hud.dispose();
    effects.dispose();
    desertOutskirts.dispose();
    environment.dispose();
    clearTaxiPassengerPresentation();
    releaseGarageCustomerPresentation();
    releaseNightRouteParticipants();
    roadsideResponse?.reset();
    interiorOccupancy?.dispose?.();
    population.dispose();
    vehicles.dispose();
    player.dispose();
    firstPersonWeapon.dispose();
    input.dispose();
    world.dispose();
    headlightRig.removeFromParent();
    headlightRig.clear();
    renderer.dispose();
  }

  async function control(request = {}) {
    // The named native control pipe is a deliberate development player. Treat
    // it as captured so automated native QA sees gameplay rather than the
    // click-to-play card; real users still require an actual pointer lock.
    developmentCaptured = true;
    switch (request.op) {
      case "ping": return { pong: true, elapsed };
      case "snapshot": return serializableSnapshot();
      case "mapNavigation": {
        const action = String(request.action ?? "snapshot");
        if (action === "open") {
          phoneOpen = true;
          phoneApp = "map";
          phoneOpenedAt = presentationElapsed - 0.28;
          phoneAppTransitionAt = presentationElapsed - 0.24;
          mapNavigation.setOpen(true);
          input.setUiPointerMode?.(true);
        } else if (action === "close") {
          mapNavigation.cancelPointer();
          mapNavigation.setOpen(false);
          if (phoneApp === "map") phoneApp = null;
        } else if (action === "select") {
          mapNavigation.selectPlace(request.id ?? request.placeId ?? null);
        } else if (action === "setRoute" || action === "route") {
          const placeId = request.id ?? request.placeId;
          if (placeId != null) mapNavigation.setNavigation(placeId);
          else mapNavigation.setRouteTarget(
            request.position ?? [request.x, request.y ?? 0, request.z],
            { title: request.title, category: request.category, source: request.source },
          );
        } else if (action === "clear") {
          mapNavigation.clearNavigation();
        } else if (action === "pan") {
          mapNavigation.panBy(request.x ?? request.deltaX ?? 0, request.y ?? request.deltaY ?? 0);
        } else if (action === "zoom") {
          if (request.wheel != null) mapNavigation.zoomWheel(request.wheel, request.anchor ?? null);
          else mapNavigation.setZoom(request.value ?? request.zoom, request.anchor ?? null);
        } else if (action !== "snapshot") {
          throw new RangeError(`Unknown map navigation action: ${action}`);
        }
        updateMissionMarker();
        return {
          mapNavigation: mapNavigation.snapshot(),
          phone: phoneSnapshot(),
          targetPosition: targetForHud()?.toArray?.() ?? null,
        };
      }
      case "action": input.injectAction(request.action); return { action: request.action };
      case "key": input.injectKey(request.code, request.down !== false); return { code: request.code, down: request.down !== false };
      case "aim": {
        input.injectHeldAction("aim", request.down !== false);
        return { aiming: request.down !== false };
      }
      case "look": {
        input.injectLook(request.x, request.y, request.wheel);
        return { x: Number(request.x) || 0, y: Number(request.y) || 0, wheel: Number(request.wheel) || 0 };
      }
      case "render": {
        renderFrame({ forceHud: true });
        suppressFrameTimingFrames = Math.max(suppressFrameTimingFrames, 2);
        return serializableSnapshot();
      }
      case "advance": {
        const steps = Math.trunc(clamp(request.steps ?? 1, 1, 36_000));
        controlStepping = true;
        try {
          for (let index = 0; index < steps; ++index) {
            elapsed += FIXED_STEP;
            fixedUpdate(FIXED_STEP, { captureSnapshot: false });
          }
          lastSnapshot = serializableSnapshot();
          return { elapsed, steps, state: lastSnapshot };
        } finally {
          controlStepping = false;
          // A native QA fast-forward is deliberately synchronous and may run
          // thousands of fixed ticks. It is not a presented frame and must not
          // contaminate the real animation-loop hitch window.
          suppressFrameTimingFrames = Math.max(suppressFrameTimingFrames, 2);
          lastFrame = Number(globalThis.performance?.now?.() ?? Date.now()) * 0.001;
        }
      }
      case "teleport": {
        const movementBounds = world.traversableBounds ?? world.bounds;
        const x = clamp(request.x, movementBounds.minX + 2, movementBounds.maxX - 2);
        const z = clamp(request.z, movementBounds.minZ + 2, movementBounds.maxZ - 2);
        if (vehicles.playerVehicle) return vehicles.teleport(vehicles.playerVehicle.id, x, z, request.yaw);
        return { position: player.teleport(x, z).toArray() };
      }
      case "vehicle": {
        const vehicleId = request.vehicleId ?? request.target;
        const result = vehicles.teleport(vehicleId, request.x, request.z, request.yaw);
        if (!result) throw new RangeError(`Unknown vehicle: ${vehicleId}`);
        return result;
      }
      case "enterVehicle": {
        const result = enterVehicle(request.vehicleId ?? request.target ?? null);
        if (!result) throw new RangeError("No enterable vehicle was found");
        return result.snapshot();
      }
      case "exitVehicle": return { position: exitVehicle()?.toArray?.() ?? null };
      case "startMission": return startMission(true);
      case "startChapterTwo": return beginChapterTwo(Boolean(request.force ?? true));
      case "startCurrentChapter": return startCurrentGarageChapter(Boolean(request.force ?? true));
      case "startTaxi": return beginSideActivity("taxi", { fareId: request.fareId });
      case "startRace": return beginSideActivity("race");
      case "startLife": return beginLifeActivity(request.activityId ?? request.id, { force: true });
      case "startGarageShift": return beginGarageShift({ force: true, workOrderId: request.workOrderId ?? null });
      case "startCommunityShift": return beginCommunityShift(request.roleId ?? request.id ?? "community_kitchen", { force: true });
      case "startCafeShift": return beginCafeShift({ force: true });
      case "startMarketShift": return beginMarketShift({ force: true });
      case "startBasketball": return beginBasketballActivity({ force: true });
      case "startNightRoute": return beginNightRoute({ force: Boolean(request.force ?? true) });
      case "garageShift": {
        const action = String(request.action ?? "snapshot");
        if (action === "availability") return garageShift.availability(garageShiftContext({ position: undefined, inVehicle: false }));
        if (action === "begin" || action === "clockIn") {
          return beginGarageShift({ force: true, workOrderId: request.workOrderId ?? null });
        }
        const context = garageShiftContext({ position: undefined, inVehicle: false });
        let result = null;
        if (action === "greet") result = garageShift.greetCustomer(context);
        else if (action === "inspect") result = garageShift.inspect(context);
        else if (action === "diagnose") result = garageShift.diagnose(request.diagnosisId ?? request.id, context);
        else if (action === "parts") result = garageShift.collectParts(request.partIds ?? request.parts ?? [], context);
        else if (action === "repair" || action === "advance") {
          let remaining = clamp(request.seconds ?? request.delta ?? 1, 0, 120);
          while (remaining > 0) {
            const step = Math.min(1, remaining);
            garageShift.update(step, { working: true, captureSnapshot: false });
            remaining -= step;
          }
          result = garageShift.snapshot();
        } else if (action === "safety") result = garageShift.performSafetyCheck(request.checkId ?? request.id, context);
        else if (action === "invoice") result = garageShift.submitInvoice(context);
        else if (action === "reset") {
          releaseGarageCustomerPresentation();
          garageShift.restore(initialGarageShiftSave);
          if (selectedActivity === "garage") selectedActivity = null;
          garageDiagnosisIndex = 0;
          garageConfirmedDiagnosisId = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          result = garageShift.snapshot();
        } else if (action !== "snapshot") throw new RangeError(`Unknown Garage shift action: ${action}`);
        processGarageShiftEvents();
        return {
          result,
          garageShift: garageShift.snapshot(),
          lifeProfile: lifeProfile.snapshot(),
          player: player.snapshot(),
        };
      }
      case "communityHub": {
        const position = controlledPosition();
        let nearestStation = null;
        let nearestDistance = Infinity;
        for (const [key, station] of Object.entries(communityHubWorld.stations)) {
          const distance = position.distanceTo(vectorFrom(station.position));
          if (distance >= nearestDistance) continue;
          nearestDistance = distance;
          nearestStation = { key, ...station, distance };
        }
        return {
          inside: insideCommunityHub(position),
          nearestStation,
          worldContract: communityHubWorld,
          staff: communityPresentationSnapshot().staff,
          staffActors: communityStaffRuntimeSnapshot(),
          activity: selectedActivity === "community" ? communityActivitySnapshot() : null,
        };
      }
      case "communityStaffSchedule": {
        const staffId = String(request.staffId ?? request.id ?? "");
        const state = communityDirectorySnapshot().staff.find(value => value.id === staffId);
        const actor = communityStaffActors.get(staffId);
        if (!state || !actor) throw new RangeError(`Unknown Harbour Skills House staff member: ${staffId}`);
        return {
          ...state,
          actorPosition: actor.root.position.toArray(),
          routineDestination: actor.routineDestinationActive ? actor.routineDestination.toArray() : null,
          routineArrived: actor.routineDestinationActive ? Boolean(actor.routineDestinationArrived) : null,
        };
      }
      case "communityShift": {
        const action = String(request.action ?? "snapshot");
        let result = null;
        if (action === "availability") {
          const roleId = request.roleId ?? request.id;
          result = roleId
            ? communityHubLife.availability(roleId, communityClockContext())
            : communityDirectorySnapshot().roles;
        } else if (action === "begin") {
          result = beginCommunityShift(request.roleId ?? request.id ?? "community_kitchen", { force: true });
        } else if (action === "perform" || action === "interact") {
          result = interactWithCommunityShift({
            force: true,
            quality: request.quality ?? 88,
            safetyConfirmed: request.safetyConfirmed !== false,
          });
        } else if (action === "advance") {
          let remaining = clamp(request.seconds ?? request.delta ?? 1, 0, 180);
          while (remaining > 0 && selectedActivity === "community") {
            const step = Math.min(1, remaining);
            communityRuntimeView = communityHubLife.update(step, {
              ...communityClockContext({ atHouse: true, inVehicle: false }),
              captureSnapshot: false,
            });
            remaining -= step;
            if (communityRuntimeView.lastStationResultSerial > lastCommunityStationResultSerial) processCommunityHubResults();
          }
          result = selectedActivity === "community" ? communityActivitySnapshot() : null;
        } else if (action === "complete") {
          let guard = 0;
          while (selectedActivity === "community" && guard++ < 40) {
            if (!communityRuntimeView.taskActive) interactWithCommunityShift({ force: true, quality: 96, safetyConfirmed: true });
            communityRuntimeView = communityHubLife.update(180, {
              ...communityClockContext({ atHouse: true, inVehicle: false }),
              captureSnapshot: false,
            });
            processCommunityHubResults();
          }
          result = selectedActivity === "community" ? communityActivitySnapshot() : null;
        } else if (action === "cancel") {
          result = communityHubLife.cancel(communityClockContext());
          communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
          selectedActivity = null;
          lastActivityStage = null;
        } else if (action === "reset") {
          communityHubLife.restore(initialCommunityHubSave);
          communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
          lastCommunityStationResultSerial = 0;
          lastCommunityTransactionSerial = 0;
          lastCommunityPresentationEvent = null;
          communityRoleSelectionIndex = 0;
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          communityFullSnapshotCacheKey = "";
          communityDirectoryCacheKey = "";
          communityActivityCacheKey = "";
          communityActivityCache = null;
          result = communityPresentationSnapshot();
        } else if (action !== "snapshot") {
          throw new RangeError(`Unknown Harbour Skills House action: ${action}`);
        }
        return {
          result,
          communityHub: communityPresentationSnapshot(),
          lifeProfile: lifeProfile.snapshot(),
          player: player.snapshot(),
          communityTrust,
        };
      }
      case "commonGroundCafe": {
        const position = controlledPosition();
        let nearestStation = null;
        let nearestDistance = Infinity;
        for (const [key, station] of Object.entries(commonGroundCafeWorld.stations)) {
          const distance = position.distanceTo(vectorFrom(station.position));
          if (distance >= nearestDistance) continue;
          nearestDistance = distance;
          nearestStation = { key, ...station, distance };
        }
        return {
          inside: insideCommonGroundCafe(position),
          nearestStation,
          worldContract: commonGroundCafeWorld,
          staff: cafeStaffStates,
          staffActors: cafeStaffRuntimeSnapshot(),
          activity: selectedActivity === "cafe" ? cafeActivitySnapshot() : null,
        };
      }
      case "cafeStaffSchedule": {
        const staffId = String(request.staffId ?? request.id ?? ASHA_PATEL.id);
        const state = cafeShift.staffState(staffId, cafeClockContext());
        const actor = cafeStaffActors.get(staffId);
        if (!state || !actor) throw new RangeError(`Unknown Common Ground Cafe staff member: ${staffId}`);
        return {
          ...state,
          actorId: actor.id,
          actorPosition: actor.root.position.toArray(),
          routineDestination: actor.routineDestinationActive ? actor.routineDestination.toArray() : null,
          routineArrived: actor.routineDestinationActive ? Boolean(actor.routineDestinationArrived) : null,
        };
      }
      case "cafeShift": {
        const action = String(request.action ?? "snapshot");
        let result = null;
        if (action === "availability") {
          result = cafeShift.availability(cafeClockContext());
        } else if (action === "begin" || action === "resume") {
          result = beginCafeShift({ force: true });
        } else if (action === "perform" || action === "interact") {
          result = interactWithCafeShift({
            force: true,
            quality: request.quality ?? 90,
            safetyConfirmed: request.safetyConfirmed !== false,
          });
        } else if (action === "advance") {
          let remaining = clamp(request.seconds ?? request.delta ?? 1, 0, 180);
          while (remaining > 0 && selectedActivity === "cafe") {
            const step = Math.min(1, remaining);
            cafeRuntimeView = cafeShift.update(step, {
              ...cafeClockContext({ insideCafe: true }),
              captureSnapshot: false,
            });
            remaining -= step;
            if (cafeRuntimeView.lastStationResultSerial > lastCafeStationResultSerial) processCafeShiftResults();
          }
          result = selectedActivity === "cafe" ? cafeActivitySnapshot() : null;
        } else if (action === "complete") {
          let guard = 0;
          while (selectedActivity === "cafe" && guard++ < 30) {
            if (!cafeRuntimeView.taskActive) interactWithCafeShift({ force: true, quality: 96, safetyConfirmed: true });
            cafeRuntimeView = cafeShift.update(180, {
              ...cafeClockContext({ insideCafe: true }),
              captureSnapshot: false,
            });
            processCafeShiftResults();
          }
          result = selectedActivity === "cafe" ? cafeActivitySnapshot() : null;
        } else if (action === "pause" || action === "cancel") {
          result = cafeShift.pause(cafeClockContext());
          cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
          selectedActivity = null;
          lastActivityStage = null;
          cafeActivityCacheKey = "";
        } else if (action === "reset") {
          cafeShift.restore(initialCafeShiftSave);
          cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
          lastCafeStationResultSerial = 0;
          lastCafeTransactionSerial = 0;
          lastCafePresentationEvent = null;
          cafeQuality = 0;
          cafeReworkCount = 0;
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          cafeActivityCacheKey = "";
          cafeActivityCache = null;
          result = cafeShift.snapshot();
        } else if (action !== "snapshot") {
          throw new RangeError(`Unknown Common Ground Cafe shift action: ${action}`);
        }
        return {
          result,
          cafeShift: cafeShift.snapshot(),
          lifeProfile: lifeProfile.snapshot(),
          player: player.snapshot(),
          communityTrust,
        };
      }
      case "minaMarket": {
        const position = controlledPosition();
        let nearestStation = null;
        let nearestDistance = Infinity;
        for (const [key, station] of Object.entries(minaMarketWorld.stations)) {
          const distance = position.distanceTo(vectorFrom(station.position));
          if (distance >= nearestDistance) continue;
          nearestDistance = distance;
          nearestStation = { key, ...station, distance };
        }
        return {
          inside: insideMinaMarket(position),
          nearestStation,
          worldContract: minaMarketWorld,
          staff: marketStaffStates,
          staffActors: marketStaffRuntimeSnapshot(),
          occupants: interiorOccupancy.snapshot(),
          activity: selectedActivity === "market" ? marketActivitySnapshot() : null,
        };
      }
      case "marketStaffSchedule": {
        const staffId = String(request.staffId ?? request.id ?? MINA_OKAFOR.id);
        const state = marketShift.staffState(staffId, marketClockContext());
        const actor = marketStaffActors.get(staffId);
        if (!state || !actor) throw new RangeError(`Unknown Mina's Market staff member: ${staffId}`);
        return {
          ...state,
          actorId: actor.id,
          actorPosition: actor.root.position.toArray(),
          routineDestination: actor.routineDestinationActive ? actor.routineDestination.toArray() : null,
          routineArrived: actor.routineDestinationActive ? Boolean(actor.routineDestinationArrived) : null,
          home: actor.root.userData.home,
        };
      }
      case "marketShift": {
        const action = String(request.action ?? "snapshot");
        let result = null;
        if (action === "availability") {
          result = marketShift.availability(marketClockContext());
        } else if (action === "begin" || action === "resume") {
          result = beginMarketShift({ force: true });
        } else if (action === "perform" || action === "interact") {
          result = interactWithMarketShift({
            force: true,
            quality: request.quality ?? 92,
            safetyConfirmed: request.safetyConfirmed !== false,
            decisionId: request.decisionId,
          });
        } else if (action === "chooseSurplus" || action === "decision") {
          result = chooseMarketSurplus({ force: true, decisionId: request.decisionId ?? request.id ?? "donate" });
        } else if (action === "advance") {
          let remaining = clamp(request.seconds ?? request.delta ?? 1, 0, 180);
          while (remaining > 0 && selectedActivity === "market") {
            const step = Math.min(1, remaining);
            marketRuntimeView = marketShift.update(step, {
              ...marketClockContext(),
              captureSnapshot: false,
            });
            remaining -= step;
            if (marketRuntimeView.stationResultSerial > lastMarketStationResultSerial) processMarketShiftResults();
          }
          result = selectedActivity === "market" ? marketActivitySnapshot() : null;
        } else if (action === "complete") {
          let guard = 0;
          while (selectedActivity === "market" && guard++ < 40) {
            if (marketRuntimeView.decisionRequired) {
              chooseMarketSurplus({ force: true, decisionId: request.decisionId ?? "donate" });
            } else if (!marketRuntimeView.taskActive) {
              interactWithMarketShift({ force: true, quality: request.quality ?? 96, safetyConfirmed: true });
            }
            marketRuntimeView = marketShift.update(180, {
              ...marketClockContext(),
              captureSnapshot: false,
            });
            processMarketShiftResults();
          }
          result = selectedActivity === "market" ? marketActivitySnapshot() : null;
        } else if (action === "pause" || action === "cancel") {
          result = marketShift.pause(marketClockContext({ sourceId: marketCommandSource("pause", "control") }));
          marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
          selectedActivity = null;
          lastActivityStage = null;
          marketActivityCacheKey = "";
        } else if (action === "reset") {
          marketShift.restore(initialMarketShiftSave);
          marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
          lastMarketStationResultSerial = 0;
          lastMarketTransactionSerial = 0;
          lastMarketPresentationEvent = null;
          marketQuality = 0;
          marketReworkCount = 0;
          marketDecisionIndex = 1;
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          marketActivityCacheKey = "";
          marketActivityCache = null;
          result = marketShift.snapshot();
        } else if (action !== "snapshot") {
          throw new RangeError(`Unknown Mina's Market shift action: ${action}`);
        }
        return {
          result,
          marketShift: marketShift.snapshot(),
          lifeProfile: lifeProfile.snapshot(),
          player: player.snapshot(),
          communityTrust,
        };
      }
      case "interiorOccupancy": return interiorOccupancy.snapshot();
      case "lifeProfile": return lifeProfile.snapshot();
      case "home": {
        const station = nearbyResidentialStation(undefined, request.radius ?? 2.35);
        return {
          inside: insideResidentialHome(),
          homeId: residentialRuntimeView.currentHomeId,
          logicalCurrentHomeId: residentialRuntimeView.currentHomeId,
          physicalHomeId: residentialInterior.homeId,
          nearestStation: station,
          worldContract: residentialInterior,
        };
      }
      case "residentSchedule": {
        const residentId = String(request.residentId ?? request.id ?? "");
        const state = residentialLife.residentState(residentId, residentialClockContext());
        const actor = residentialActors.get(residentId);
        if (!state || !actor) throw new RangeError(`Unknown residential resident: ${residentId}`);
        return {
          ...state,
          actorPosition: actor.root.position.toArray(),
          routineDestination: actor.routineDestination?.toArray?.() ?? null,
          routineArrived: actor.routineDestinationActive
            ? Boolean(actor.routineDestinationArrived)
            : null,
        };
      }
      case "residential": {
        const action = String(request.action ?? "snapshot");
        let result = null;
        if (action === "perform") {
          result = performResidentialActivity(request.activityId ?? request.id, { force: Boolean(request.force) });
        } else if (action === "restock") {
          result = residentialLife.restockHome(residentialClockContext({
            atHome: Boolean(request.force) || insideResidentialHome(),
            homeId: request.homeId ?? residentialInterior.homeId,
            inVehicle: Boolean(vehicles.playerVehicle),
            cash: player.cash,
          }));
          applyResidentialTransaction(result, { advanceClock: false, toastLabel: "GROCERIES RESTOCKED" });
        } else if (action === "payRent") {
          result = residentialLife.payRent(residentialClockContext({ cash: player.cash }));
          applyResidentialTransaction(result, { advanceClock: false, toastLabel: "RENT PAID" });
        } else if (action === "acquire") {
          const requestedHomeId = String(request.homeId ?? residentialInterior.homeId);
          if (requestedHomeId !== residentialInterior.homeId) {
            result = Object.freeze({
              accepted: false,
              reason: "physical_interior_required",
              homeId: requestedHomeId,
              physicalHomeId: residentialInterior.homeId,
            });
          } else {
            result = residentialLife.acquireHome(requestedHomeId, residentialClockContext({
              mode: request.mode ?? "rent",
              cash: player.cash,
              progressionTier: 20,
            }));
            applyResidentialTransaction(result, { advanceClock: false, toastLabel: request.mode === "buy" ? "HOME PURCHASED" : "TENANCY STARTED" });
          }
        } else if (action === "invite") {
          result = residentialLife.inviteVisitor(request.residentId ?? request.id, residentialClockContext({
            atHome: Boolean(request.force) || insideResidentialHome(),
            durationMinutes: request.durationMinutes ?? 90,
          }));
          if (result.accepted) {
            lastResidentialInteractionSerial = Math.max(lastResidentialInteractionSerial, result.serial);
            invalidateResidentialView();
            syncResidentialActors(true);
          } else showToast(explainResidentialRejection(result), 2.6);
        } else if (action === "interactResident") {
          result = interactResidentialActor(request.residentId ?? request.id, {
            force: Boolean(request.force),
            kind: request.kind ?? "talk",
          });
        } else if (action !== "snapshot") {
          throw new RangeError(`Unknown residential action: ${action}`);
        }
        return {
          result,
          residential: residentialLife.snapshot(),
          lifeProfile: lifeProfile.snapshot(),
          player: player.snapshot(),
          environment: environment.snapshot(),
        };
      }
      case "roadside": {
        const action = String(request.action ?? "snapshot");
        if (action === "force") roadsideResponse?.force(request.vehicleId ?? request.target ?? null, request.kind);
        else if (action === "report") roadsideResponse?.report({
          vehicleId: request.vehicleId ?? request.target,
          impactSpeed: request.impactSpeed ?? request.speed ?? 12,
        });
        else if (action === "reset") roadsideResponse?.reset();
        else if (action !== "snapshot") throw new RangeError(`Unknown roadside action: ${action}`);
        return roadsideResponse?.snapshot() ?? null;
      }
      case "audio": {
        const action = String(request.action ?? "snapshot");
        camera.getWorldDirection(audioListenerForward);
        audioListenerUp.copy(camera.up).applyQuaternion(camera.quaternion).normalize();
        gameAudio.updateListener(camera.position, audioListenerForward, audioListenerUp);
        if (action === "playAt") {
          audioControlPosition.set(
            Number.isFinite(Number(request.x)) ? Number(request.x) : camera.position.x,
            Number.isFinite(Number(request.y)) ? Number(request.y) : camera.position.y,
            Number.isFinite(Number(request.z)) ? Number(request.z) : camera.position.z,
          );
          const event = gameAudio.playAt(request.name ?? "gunshot", request.volume ?? 0.65, audioControlPosition);
          return { event: event ? { ...event } : null, audio: gameAudio.snapshot?.() ?? null };
        }
        if (action !== "snapshot") throw new RangeError(`Unknown audio action: ${action}`);
        return gameAudio.snapshot?.() ?? null;
      }
      case "story": {
        const action = String(request.action ?? "snapshot");
        if (action === "begin") story.notify({ type: "capture_started" });
        else if (action === "advance") story.update(0, { advance: true, skip: Boolean(request.skip) });
        else if (action === "choose") story.choose(request.option ?? request.choice);
        else if (action === "notify") story.notify({ type: request.event, ...(request.detail ?? {}) });
        else if (action !== "snapshot") throw new RangeError(`Unknown story action: ${action}`);
        processStoryEvents();
        return story.snapshot();
      }
      case "chapterTwo": {
        const action = String(request.action ?? "snapshot");
        if (action === "begin") beginChapterTwo(Boolean(request.force));
        else if (action === "advance") chapterTwo.update(0, { advance: true, skip: Boolean(request.skip) });
        else if (action === "choose") chapterTwo.choose(request.option ?? request.choice);
        else if (action === "inspect") chapterTwo.inspect(request.clueId ?? request.id);
        else if (action === "speak") chapterTwo.speak(request.personId ?? CHAPTER_TWO_AFFECTED_PERSON.id);
        else if (action === "manifest") chapterTwo.recordManifest(request.method ?? "photograph");
        else if (action === "interact") interactWithChapterTwo();
        else if (action === "notify") chapterTwo.notify({ type: request.event, ...(request.detail ?? {}) });
        else if (action !== "snapshot") throw new RangeError(`Unknown Chapter Two action: ${action}`);
        processChapterTwoEvents();
        return chapterTwo.snapshot();
      }
      case "nightRoute": {
        const action = String(request.action ?? "snapshot");
        if (action === "availability") return nightRoute.availability(nightRouteUnlockContext());
        if (action === "begin") return beginNightRoute({ force: Boolean(request.force ?? true) });
        if (action === "advance") {
          nightRoute.update(0, { skip: request.skip !== false });
        } else if (action === "choose") {
          nightRoute.choose(request.option ?? request.choice);
        } else if (action === "interact") {
          const vehicle = vehicles.playerVehicle;
          const suppliedPosition = request.position ??
            (Number.isFinite(Number(request.x)) && Number.isFinite(Number(request.z))
              ? [Number(request.x), Number(request.y) || 0, Number(request.z)]
              : controlledPosition());
          nightRoute.interact({
            position: suppliedPosition,
            inVehicle: request.inVehicle ?? Boolean(vehicle),
            vehicleAccess: request.vehicleAccess ?? vehicle?.access ?? null,
            speed: request.speed ?? Math.abs(Number(vehicle?.state?.speed) || 0),
          });
        } else if (action === "reset") {
          releaseNightRouteParticipants();
          nightRoute.reset();
          lastNightRouteHandledEventSerial = 0;
          nightRouteCompletionEventsHandled = 0;
          lastNightRouteHandledEvent = null;
          if (selectedActivity === "nightRoute") {
            selectedActivity = null;
            lastActivityStage = null;
            activityPresentationUntil = 0;
          }
        } else if (action !== "snapshot") {
          throw new RangeError(`Unknown Night Route action: ${action}`);
        }
        processNightRouteEvents();
        return nightRoute.snapshot();
      }
      case "neighbourhood": return serializableSnapshot().neighbourhood;
      case "openBusiness": {
        const businessId = request.businessId ?? request.id;
        if (request.force) {
          return neighbourhoodRoutine.openMenu(businessId, { ...neighbourhoodContext(), position: undefined, inVehicle: false });
        }
        return openNeighbourhoodBusiness(businessId);
      }
      case "shopSelect": return neighbourhoodRoutine.moveSelection(request.direction ?? request.delta ?? 1);
      case "shopBuy": {
        const result = buySelectedNeighbourhoodItem();
        return { transaction: result, neighbourhood: neighbourhoodRoutine.snapshot(), player: player.snapshot() };
      }
      case "unpackGroceries": {
        const result = unpackResidentialSupplies({
          force: Boolean(request.force),
          sourceId: request.sourceId ?? null,
        });
        return { transaction: result, residential: residentialLife.snapshot(), player: player.snapshot() };
      }
      case "closeBusiness": return neighbourhoodRoutine.close("player_closed");
      case "activity": return selectedActivitySnapshot();
      case "cancelActivity": {
        if (selectedActivity === "community") {
          const result = communityHubLife.cancel(communityClockContext());
          communityRuntimeView = communityHubLife.update(0, { ...communityClockContext(), captureSnapshot: false });
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          return result;
        }
        if (selectedActivity === "cafe") {
          const result = cafeShift.pause(cafeClockContext());
          cafeRuntimeView = cafeShift.update(0, { ...cafeClockContext(), captureSnapshot: false });
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          cafeActivityCacheKey = "";
          return result;
        }
        if (selectedActivity === "market") {
          const result = marketShift.pause(marketClockContext({ sourceId: marketCommandSource("pause", "cancel") }));
          marketRuntimeView = marketShift.update(0, { ...marketClockContext(), captureSnapshot: false });
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          marketActivityCacheKey = "";
          return result;
        }
        const system = selectedActivitySystem();
        if (!system) return null;
        if (selectedActivity === "garage") {
          return { accepted: false, reason: "finish_shift", garageShift: garageShift.snapshot() };
        }
        if (selectedActivity === "nightRoute") {
          releaseNightRouteParticipants();
          const result = nightRoute.reset();
          selectedActivity = null;
          lastActivityStage = null;
          activityPresentationUntil = 0;
          lastNightRouteHandledEventSerial = 0;
          nightRouteCompletionEventsHandled = 0;
          lastNightRouteHandledEvent = null;
          return result;
        }
        const result = system.notify({ type: "cancel" });
        lastActivityStage = result.stage;
        activityPresentationUntil = elapsed + 3;
        return result;
      }
      case "setWanted": {
        wanted.clear();
        if (Number(request.heat) > 0) wanted.add(request.heat, "development control");
        return wanted.snapshot();
      }
      case "clearWanted": return wanted.clear();
      case "setWeather": return environment.setRain(request.rain ?? request.amount, request.immediate !== false);
      case "setTime": {
        const result = environment.setTime(request.hours ?? request.time);
        const requestedDayIndex = request.dayIndex === undefined
          ? null
          : Math.max(0, Math.trunc(Number(request.dayIndex) || 0));
        const neighbourhoodClock = {
          timeHours: result.timeHours,
          weather: result.weather,
          story: story.snapshot(),
          paused: false,
          captureSnapshot: false,
        };
        if (requestedDayIndex != null) neighbourhoodClock.dayIndex = requestedDayIndex;
        neighbourhoodRoutine.update(0, neighbourhoodClock);
        // The capture-free neighbourhood view intentionally contains only
        // menu and recovery hot-path fields. Read the authoritative clock from
        // its cached public snapshot so an explicit control day propagates to
        // housing, community work, and cafe saves instead of becoming
        // undefined and silently leaving those systems on day zero.
        const dayIndex = neighbourhoodRoutine.snapshot().dayIndex;
        residentialRuntimeView = residentialLife.update(0, {
          dayIndex,
          timeHours: result.timeHours,
          captureSnapshot: false,
        });
        lastResidentialScheduleMinute = -1;
        syncResidentialActors(true);
        communityRuntimeView = communityHubLife.update(0, {
          dayIndex,
          timeHours: result.timeHours,
          captureSnapshot: false,
        });
        communityRuntimeClockContext.dayIndex = dayIndex;
        communityRuntimeClockContext.minuteOfDay = Math.trunc(result.timeHours * 60) % 1440;
        lastCommunityScheduleMinute = -1;
        communityDirectoryCacheKey = "";
        syncCommunityStaff(true, communityRuntimeClockContext);
        cafeRuntimeView = cafeShift.update(0, {
          dayIndex,
          timeHours: result.timeHours,
          captureSnapshot: false,
        });
        cafeRuntimeClockContext.dayIndex = dayIndex;
        cafeRuntimeClockContext.minuteOfDay = Math.trunc(result.timeHours * 60) % 1440;
        lastCafeScheduleMinute = -1;
        syncCafeStaff(true, cafeRuntimeClockContext);
        marketRuntimeView = marketShift.update(0, {
          dayIndex,
          timeHours: result.timeHours,
          captureSnapshot: false,
        });
        marketRuntimeClockContext.dayIndex = dayIndex;
        marketRuntimeClockContext.minuteOfDay = Math.trunc(result.timeHours * 60) % 1440;
        lastMarketScheduleMinute = -1;
        syncMarketStaff(true, marketRuntimeClockContext);
        interiorOccupancy.update(0, {
          dayIndex,
          minuteOfDay: marketRuntimeClockContext.minuteOfDay,
          captureSnapshot: false,
        });
        return Object.freeze({ ...result, dayIndex });
      }
      case "resetFrameTiming": resetFrameTiming(); return frameTimingSnapshot();
      case "fire": {
        input.injectHeldAction("aim", true);
        for (let index = 0; index < 14; ++index) {
          elapsed += FIXED_STEP;
          fixedUpdate(FIXED_STEP, { captureSnapshot: false });
        }
        input.injectAction("fire");
        elapsed += FIXED_STEP;
        const result = fixedUpdate(FIXED_STEP).player;
        input.injectHeldAction("aim", false);
        return result;
      }
      case "melee": {
        input.injectAction("melee");
        elapsed += FIXED_STEP;
        return fixedUpdate(FIXED_STEP).player;
      }
      case "shootAt": {
        const actor = population.actors.find(value => value.id === request.target);
        const vehicle = vehicles.get(request.target);
        const target = actor?.root?.position ?? vehicle?.root?.position;
        if (!target) throw new RangeError(`Unknown shooting target: ${request.target}`);
        const origin = player.getMuzzle(new THREE.Vector3());
        const direction = target.clone().setY(target.y + (actor ? 1.1 : 0.72)).sub(origin).normalize();
        return fireWeapon({ origin, direction, aiming: true });
      }
      case "face": {
        const actor = population.actors.find(value => value.id === request.target);
        const vehicle = vehicles.get(request.target);
        const target = actor?.root?.position ?? vehicle?.root?.position ??
          (Number.isFinite(Number(request.x)) && Number.isFinite(Number(request.z))
            ? new THREE.Vector3(Number(request.x), 0, Number(request.z)) : null);
        if (!target) throw new TypeError("face requires a target id or x/z position");
        const direction = target.clone().sub(player.root.position);
        const yaw = Math.atan2(-direction.x, -direction.z);
        player.root.rotation.y = yaw;
        chaseCamera.snapBehind(yaw);
        return { target: actor?.id ?? vehicle?.id ?? null, yaw };
      }
      case "damage": {
        if (request.target === "player") return player.damage(request.amount, { ignoreArmor: request.ignoreArmor });
        const actor = population.actors.find(value => value.id === request.target);
        if (actor) {
          const result = population.damage(actor, request.amount, request.source ?? "control");
          if (result?.accepted && request.visual !== false) {
            const point = actor.root.position.clone();
            point.y += 0.95;
            effects.impact(point, {
              hitPolice: Boolean(result.police),
              hitCivilian: !result.police,
              heavy: Number(request.amount) >= 55,
              severity: clamp(Number(request.amount) / 42, 0.7, 2.4),
            });
          }
          return result;
        }
        const vehicle = vehicles.get(request.target);
        if (vehicle) return vehicles.damage(vehicle, request.amount);
        throw new RangeError(`Unknown damage target: ${request.target}`);
      }
      case "spawnPed": return population.spawn(request).id;
      case "save": return persistentSnapshot();
      case "restore": return restorePersistent(request.snapshot);
      case "writeSave": return { path: await saveService.save(request.slot ?? "control", persistentSnapshot()) };
      case "loadSave": {
        const value = await saveService.load(request.slot ?? "control");
        return value ? restorePersistent(value) : null;
      }
      case "screenshot": {
        controlStepping = true;
        try {
          // Native QA can fast-forward many fixed ticks without yielding to
          // the animation loop. Refresh the GPU HUD explicitly so an offscreen
          // evidence frame cannot combine a current world with stale UI.
          lastSnapshot = serializableSnapshot();
          hud.update(lastSnapshot);
          return await frameCapture.capture(request.path, {
            width: request.width,
            height: request.height,
            renderOnlyHidden: nightRouteRenderOnlyHidden(),
            renderOnlyZeroIntensity: nightRouteRenderOnlyHidden()
              ? nightRouteDinerRenderZeroIntensity
              : null,
          });
        } finally {
          controlStepping = false;
          suppressFrameTimingFrames = Math.max(suppressFrameTimingFrames, 2);
          lastFrame = Number(globalThis.performance?.now?.() ?? Date.now()) * 0.001;
        }
      }
      case "dispose":
        setTimeout(() => { void dispose(); }, 0);
        return { disposing: true };
      default: throw new RangeError(`Unknown control operation: ${request.op}`);
    }
  }

  globalThis.addEventListener("resize", onResize);
  globalThis.addEventListener("beforeunload", () => { void dispose(); }, { once: true });
  onResize();
  chaseCamera.update(FIXED_STEP, player, { driving: false, speed: 0 });
  updateMissionMarker();
  simulationWarmupState = warmRuntimeSimulationBranches();
  updateMissionMarker();
  lastSnapshot = fixedUpdate(0);
  const gameplayToneMapping = renderer.toneMapping;
  const gameplayExposure = renderer.toneMappingExposure;
  function prepareWarmupAtmosphere(hours, rain) {
    const previous = environment.snapshot();
    environment.setTime(hours);
    environment.setRain(rain, true);
    const warmed = environment.update(0, elapsed, controlledPosition());
    world.setTimeOfDay?.(warmed.timeHours);
    world.setWetness?.(warmed.wetness);
    world.update(elapsed, controlledPosition());
    return () => {
      environment.setTime(previous.timeHours);
      environment.setRain(previous.rain, true);
      const restored = environment.update(0, elapsed, controlledPosition());
      world.setTimeOfDay?.(restored.timeHours);
      world.setWetness?.(restored.wetness);
      world.update(elapsed, controlledPosition());
    };
  }

  function warmRuntimeSimulationBranches() {
    const started = Number(globalThis.performance?.now?.() ?? Date.now());
    // Runtime/dev spawns claim these hidden, fully rendered actors instead of
    // introducing a new hierarchy and GPU bindings after play has begun.
    const spawnReservePrepared = population.ensureSpawnReserve(2);
    const previousEnvironment = environment.snapshot();
    const basketballPrepared = basketballActivity.prewarm();
    const neighbourhoodPrepared = neighbourhoodRoutine.prewarm();
    const chapterTwoPrepared = chapterTwo.prewarm();
    const aftermathPrepared = lifeActivity.prewarm();
    const lifeProfilePrepared = lifeProfile.prewarm();
    const residentialPrepared = residentialLife.prewarm();
    const garageShiftPrepared = garageShift.prewarm();
    const communityHubPrepared = communityHubLife.prewarm();
    const cafeShiftPrepared = cafeShift.prewarm();
    const marketShiftPrepared = marketShift.prewarm();
    const interiorOccupancyPrepared = interiorOccupancy.prewarm();
    const nightRoutePrepared = nightRoute.prewarm();
    const roadsidePrepared = roadsideResponse.prewarm();
    const warmTaxi = createTaxiActivity({ seed: 0x4e534e54 });
    let taxiDialogueBeatsPrepared = 0;
    let taxiFaresPrepared = 0;
    for (const fare of warmTaxi.fares) {
      let fareState = warmTaxi.begin({
        vehicleId: "startup-memory-taxi",
        fareId: fare.id,
        chapterOneChoice: "publish",
        chapterTwoChoice: "recall_then_report",
      });
      const common = { vehicleId: "startup-memory-taxi", isTaxi: true, validVehicle: true, speed: 0, wantedStars: 0 };
      fareState = warmTaxi.update(0, { ...common, position: fare.pickup });
      fareState = warmTaxi.update(0.7, { ...common, position: fare.pickup });
      fareState = warmTaxi.update(0.7, { ...common, position: fare.pickup });
      taxiDialogueBeatsPrepared += Number(fareState.dialogue?.active);
      const midpoint = [
        (fare.pickup[0] + fare.dropoff[0]) * 0.5,
        (fare.pickup[1] + fare.dropoff[1]) * 0.5,
        (fare.pickup[2] + fare.dropoff[2]) * 0.5,
      ];
      fareState = warmTaxi.update(0.1, { ...common, position: midpoint, speed: 5.2 });
      taxiDialogueBeatsPrepared += Number(fareState.dialogue?.active);
      warmTaxi.notify({ type: "collision", severity: 7.5 });
      fareState = warmTaxi.update(0.8, { ...common, position: fare.dropoff });
      taxiDialogueBeatsPrepared += Number(fareState.dialogue?.active);
      taxiFaresPrepared += Number(fareState.stage === TAXI_STAGES.COMPLETE);
    }
    const offscreenTarget = new THREE.Vector3(world.bounds.maxX + 480, 0, world.bounds.maxZ + 480);
    const warmActor = population.actors.find(actor => !actor.police && !actor.storyRole && actor.alive);
    const warmPresentationPosition = warmActor?.root?.position?.clone?.() ?? offscreenTarget;
    const warmTaxiStage = population.stage(warmActor, {
      key: "startup:taxi-passenger",
      kind: "night-shift-passenger",
      phase: "curb",
      name: "Startup Passenger",
      position: warmPresentationPosition,
      visible: true,
    });
    const warmTaxiHidden = warmTaxiStage.accepted
      ? population.stage(warmActor, { key: "startup:taxi-passenger", phase: "on-board", visible: false })
      : null;
    const warmTaxiArrival = warmTaxiStage.accepted
      ? population.stage(warmActor, { key: "startup:taxi-passenger", phase: "arrived", visible: true })
      : null;
    const warmTaxiReleased = warmTaxiStage.accepted ? population.release(warmActor) : null;
    const warmNightRoutePresentation = stageNightRouteParticipants();
    const warmNightRouteActorIds = warmNightRoutePresentation.accepted
      ? Object.freeze([...nightRouteParticipantActors.values()].map(actor => actor.id))
      : Object.freeze([]);
    const warmNightRouteReleased = warmNightRoutePresentation.accepted
      ? releaseNightRouteParticipants()
      : 0;
    const observerCandidate = population.actors.find(actor =>
      !actor.police && !actor.storyRole && actor.active && actor.alive && actor.root.visible);
    const warmObserverId = observerCandidate
      ? population.observe("begin", "startup-roadside", "breakdown", observerCandidate.root.position.x, observerCandidate.root.position.z)
      : null;
    const warmObserverReleased = warmObserverId
      ? population.observe("clear", "startup-roadside", "breakdown", 0, 0)
      : null;
    let ragdollPrepared = false;
    if (warmActor) {
      const result = population.damage(warmActor, 55, "startup-memory-preload");
      ragdollPrepared = Boolean(result?.ragdoll);
      const point = warmActor.root.position.clone();
      point.y += 0.95;
      effects.impact(point, { hitCivilian: true, heavy: true, severity: 1.35 });
      effects.shot(point.clone().add(new THREE.Vector3(0, 0.18, 1.8)), point, {
        hit: true,
        hitCivilian: true,
        damage: 55,
      });
    }

    environment.setTime(23.2);
    environment.setRain(1, true);
    for (let index = 0; index < 36; ++index) environment.update(FIXED_STEP, 0, offscreenTarget);

    // Zero-delta vehicle calls execute pursuit steering, signal bypass, light
    // and occupant branches without advancing or damaging traffic state.
    for (let index = 0; index < 72; ++index) {
      vehicles.update(0, {
        targetPosition: offscreenTarget,
        wantedStars: 5,
        lightLevel: 1,
        captureSnapshot: false,
      });
    }
    for (let index = 0; index < 36; ++index) {
      vehicles.update(0, { targetPosition: null, wantedStars: 0, lightLevel: 0.08, captureSnapshot: false });
    }

    // Ten seconds are stepped without rendering or snapshot allocation.
    // Officers activate against a harmless out-of-bounds target and return to
    // reserve; the civilian completes the full ragdoll/recovery path.
    const simulationSteps = 600;
    for (let index = 0; index < simulationSteps; ++index) {
      population.update(FIXED_STEP, {
        targetPosition: offscreenTarget,
        wantedStars: index < 30 ? 5 : 0,
        vehicles: [],
        playerVehicle: null,
        timeHours: 23.2,
        rain: 1,
        daylight: 0,
        captureSnapshot: false,
      });
      effects.update(FIXED_STEP, index * FIXED_STEP, { targetObject: null, guidanceVisible: true });
    }
    if (warmActor) {
      warmActor.health = warmActor.maxHealth;
      warmActor.alive = true;
      warmActor.active = true;
      warmActor.root.visible = true;
    }
    for (let index = 0; index < 220; ++index) {
      effects.update(0.1, 10 + index * 0.1, { targetObject: null, guidanceVisible: true });
    }

    environment.setTime(previousEnvironment.timeHours);
    environment.setRain(previousEnvironment.rain, true);
    const restoredEnvironment = environment.update(0, 0, controlledPosition());
    world.setTimeOfDay?.(restoredEnvironment.timeHours);
    world.setWetness?.(restoredEnvironment.wetness);
    world.update(0, controlledPosition());
    const policeInReserve = population.actors.filter(actor => actor.police && !actor.active).length;
    const residualEffects = Number(effects.snapshot().activeEffects) || 0;
    const finished = Number(globalThis.performance?.now?.() ?? Date.now());
    return Object.freeze({
      ready: true,
      policy: "startup-memory-micro-simulation",
      storage: "memory-only",
      steps: simulationSteps,
      durationMs: Math.max(0, finished - started),
      branches: Object.freeze([
        "storm", "pursuit", "occupied-police-cars", "blood", "ragdoll",
        "basketball-made-and-miss-flight", "neighbourhood-business-meal-and-menu",
        "borrowed-time-investigation-and-both-costly-decisions",
        "borrowed-time-both-aftermath-routes",
        "persistent-life-skills-needs-wages-and-home-care",
        "physical-home-tenancy-rent-fixtures-meals-visitors-and-resident-schedules",
        "pulse-garage-customer-inspection-diagnosis-repair-safety-and-invoice",
        "harbour-skills-house-kitchen-repair-archive-safety-rework-and-wage-ledgers",
        "common-ground-cafe-handover-till-prep-service-dishes-stock-and-wage-ledger",
        "minas-market-cold-chain-produce-stock-packing-till-wash-up-and-surplus-ledger",
        "ambient-civilians-enter-dwell-in-and-leave-four-walk-in-buildings",
        "pulse-line-authorized-shuttle-route",
        "night-shift-named-passengers-dialogue-and-cabin-occupancy",
        "the-night-count-both-moral-ledgers-and-four-borrowed-participants",
        "ambient-roadside-witness-response-and-precreated-beacons",
      ]),
      ragdollPrepared,
      basketballPrepared,
      neighbourhoodPrepared,
      chapterTwoPrepared,
      aftermathPrepared,
      lifeProfilePrepared,
      residentialPrepared,
      garageShiftPrepared,
      communityHubPrepared,
      cafeShiftPrepared,
      marketShiftPrepared,
      interiorOccupancyPrepared,
      nightRoutePrepared,
      roadsidePrepared,
      taxiPrepared: Object.freeze({
        fares: taxiFaresPrepared,
        dialogueBeats: taxiDialogueBeatsPrepared,
        curb: Boolean(warmTaxiStage.accepted),
        hiddenOnBoard: Boolean(warmTaxiHidden?.accepted && !warmTaxiHidden.visible),
        arrival: Boolean(warmTaxiArrival?.accepted && warmTaxiArrival.visible),
        released: Boolean(warmTaxiReleased?.accepted),
      }),
      nightRoutePresentationPrepared: Object.freeze({
        accepted: Boolean(warmNightRoutePresentation.accepted),
        actorIds: warmNightRouteActorIds,
        released: warmNightRouteReleased,
        runtimeNodesCreated: 0,
      }),
      roadsideObserverPrepared: Boolean(warmObserverId && warmObserverReleased),
      spawnReservePrepared,
      policeInReserve,
      residualEffects,
    });
  }
  pipelineWarmupState = await warmRendererPipelines(renderer, [
    {
      label: "world-all-materials-effects-weather-aim-and-lighting",
      scene,
      camera,
      target: presenter.worldTarget,
      toneMapping: THREE.NoToneMapping,
      exposure: 1,
      revealAll: true,
      compileMode: "render",
      settleFrames: 1,
      prepare: () => prepareWarmupAtmosphere(23.2, 1),
    },
    {
      label: "hud-all-panels-and-reticle",
      scene: hud.scene,
      camera: hud.camera,
      target: hud.target,
      toneMapping: gameplayToneMapping,
      exposure: gameplayExposure,
      revealAll: true,
      compileMode: "render",
      clearDepth: false,
      settleFrames: 1,
    },
  ]);
  renderer.info.reset();
  renderFrame({ forceHud: true });
  // compileAsync can finish while the final reveal-all submissions are still
  // queued on the native device. Do not hand control to the player until that
  // work has retired; otherwise the first real ADS/night/police frame can pay
  // for startup work despite every pipeline already existing in RAM.
  const warmupQueue = renderer.backend?.device?.queue;
  const queueSettle = warmupQueue?.onSubmittedWorkDone?.();
  if (queueSettle?.then) await queueSettle;
  pipelineWarmupState = Object.freeze({
    ...pipelineWarmupState,
    queueSettledBeforePlay: Boolean(queueSettle?.then),
  });
  controlServer = await createDevelopmentControlServer(control);
  globalThis.__GTA_NEON_CITY__ = Object.freeze({ snapshot: serializableSnapshot, control });
  resetFrameTiming();
  renderer.setAnimationLoop(animate);
  console.log(
    `[GTA Neon City] READY · ${world.stats.buildings} buildings · ${vehicles.vehicles.length} vehicles` +
    ` · ${population.actors.length} people · ${pipelineWarmupState.passes.length} pipeline preload passes` +
    ` · native WebGPU · JS-only gameplay`,
  );
}

main().catch(error => {
  console.error("[GTA Neon City] Fatal startup error", error?.stack || error);
  throw error;
});
