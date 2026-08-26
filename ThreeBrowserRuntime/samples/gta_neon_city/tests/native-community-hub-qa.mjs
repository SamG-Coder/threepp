import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  COMMUNITY_HUB_ROLES,
  COMMUNITY_HUB_STAFF,
  COMMUNITY_HUB_STATIONS,
} from "../src/game/community-hub.mjs";

const pipePath = process.argv[2];
const interiorScreenshotPath = process.argv[3] ?? null;
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-community-hub-qa.mjs <pipe> [interior.png]");
}

const HUB_ID = "harbour-skills-house";
const HUB_BUILDING_ID = "harbour-skills-house-building";
const HUB_ADDRESS = "42 Mariner Walk";
const ROLE_IDS = Object.freeze(["community_kitchen", "repair_cafe", "local_archive"]);
const STAFF_IDS = Object.freeze(["asha_malik", "tomas_varga", "priya_nwosu"]);
const ZONE_KEYS = Object.freeze(["reception", "kitchen", "workshop", "classroom", "breakRoom"]);
const WORLD_STATION_KEYS = Object.freeze([
  "reception",
  "kitchenPrep",
  "kitchenServe",
  "kitchenClean",
  "repairIntake",
  "repairBench",
  "classroom",
  "photoDesk",
  "breakArea",
]);
const KITCHEN_ROLE = COMMUNITY_HUB_ROLES.find(role => role.id === "community_kitchen");

assert.ok(KITCHEN_ROLE, "community kitchen role definition is missing");
assert.deepEqual(COMMUNITY_HUB_ROLES.map(role => role.id), ROLE_IDS);
assert.deepEqual(COMMUNITY_HUB_STAFF.map(staff => staff.id), STAFF_IDS);

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = new Map();
    this.sequence = 0;
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.consume(chunk));
  }

  consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const end = this.buffer.indexOf("\n");
      if (end < 0) return;
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "native community-hub control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = op === "screenshot" || op === "advance" ? 60_000 : 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native community-hub request timed out: ${op}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() {
    this.socket.end();
  }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function connectWithRetry(target, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const socket = net.createConnection(target);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }
  throw lastError ?? new Error("native community-hub pipe did not become ready");
}

function stateFrom(response) {
  return response?.state ?? response;
}

function positionOf(state) {
  const value = state?.player?.position;
  assert.ok(Array.isArray(value) && value.length >= 3, "native player snapshot has no position");
  return value;
}

function distance2D(left, right) {
  return Math.hypot(Number(left?.[0]) - Number(right?.[0]), Number(left?.[2]) - Number(right?.[2]));
}

function angleDistance(left, right) {
  const fullTurn = Math.PI * 2;
  const delta = Math.abs(Number(left) - Number(right)) % fullTurn;
  return Math.min(delta, fullTurn - delta);
}

function pointInsideBounds(position, bounds, tolerance = 0.35) {
  return Number(position?.[0]) >= Number(bounds?.minX) - tolerance &&
    Number(position?.[0]) <= Number(bounds?.maxX) + tolerance &&
    Number(position?.[2]) >= Number(bounds?.minZ) - tolerance &&
    Number(position?.[2]) <= Number(bounds?.maxZ) + tolerance;
}

function skillExperience(profile, skillId) {
  const value = profile?.skillById?.[skillId] ?? profile?.skills?.find(skill => skill.id === skillId);
  assert.ok(value, `life profile has no ${skillId} skill`);
  return Number(value.experience);
}

function durableLifeProfileSave(profile) {
  const { elapsed: _elapsed, needs: _needs, ...durable } = profile;
  return durable;
}

function firstChoiceId(state) {
  return state?.choice?.options?.[0]?.id ?? null;
}

function commandResult(response) {
  return response?.result ?? response;
}

function communityState(response) {
  const value = response?.communityHub ?? response?.community ?? response;
  assert.ok(value?.house && Array.isArray(value.roles), "community shift response has no hub snapshot");
  return value;
}

function communityBundle(response) {
  const hub = communityState(response);
  return {
    result: response?.result ?? null,
    hub,
    lifeProfile: response?.lifeProfile ?? null,
    player: response?.player ?? null,
    communityTrust: response?.communityTrust,
    environment: response?.environment ?? null,
  };
}

async function clearBlockingNarrative(client) {
  let state = await client.request("snapshot");
  if (state.paused) {
    await client.request("action", { action: "pause" });
    state = stateFrom(await client.request("advance", { steps: 2 }));
  }
  for (let guard = 0; guard < 128; ++guard) {
    if (state.nightRoute?.controlsLocked) {
      const option = firstChoiceId(state.nightRoute);
      await client.request("nightRoute", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else if (state.chapterTwo?.active || state.chapterTwo?.choice) {
      const option = firstChoiceId(state.chapterTwo);
      await client.request("chapterTwo", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else if (state.story?.active || state.story?.choice) {
      const option = firstChoiceId(state.story);
      await client.request("story", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else {
      assert.equal(state.narrative?.controlsLocked, false,
        "an authored narrative retained player controls during community-hub QA");
      break;
    }
    state = await client.request("snapshot");
    if (guard === 127) throw new Error("blocking narrative did not settle within 128 authored transitions");
  }
  if (state.neighbourhood?.menuOpen) {
    await client.request("closeBusiness");
    state = await client.request("snapshot");
  }
  if (state.selectedActivity === "community") {
    await client.request("communityShift", { action: "reset" });
    state = await client.request("snapshot");
  } else if (state.activity?.status === "active") {
    await client.request("cancelActivity");
    state = await client.request("snapshot");
  }
  if (state.player?.inVehicle) {
    await client.request("exitVehicle");
    state = await client.request("snapshot");
  }
  for (let guard = 0; guard < 3 && state.phone?.open; ++guard) {
    await client.request("action", { action: "phone" });
    state = stateFrom(await client.request("advance", { steps: 2 }));
  }
  assert.equal(state.phone?.open, false, "community-hub QA could not close the pre-existing phone view");
  await client.request("clearWanted");
  return state;
}

async function tapKey(client, code) {
  await client.request("key", { code, down: true });
  const pressed = stateFrom(await client.request("advance", { steps: 1 }));
  await client.request("key", { code, down: false });
  const released = stateFrom(await client.request("advance", { steps: 1 }));
  return { pressed, released };
}

async function closePhone(client) {
  let state = await client.request("snapshot");
  for (let guard = 0; guard < 3 && state.phone?.open; ++guard) {
    await client.request("action", { action: "phone" });
    state = stateFrom(await client.request("advance", { steps: 2 }));
  }
  assert.equal(state.phone?.open, false, "phone did not return through app, launcher, and closed states");
  return state;
}

async function openPhoneApp(client, selection, appId, title) {
  await closePhone(client);
  await client.request("action", { action: "phone" });
  let state = stateFrom(await client.request("advance", { steps: 2 }));
  assert.equal(state.phone.open, true);
  assert.equal(state.phone.app, null);
  assert.equal(state.phone.items.length, 7);
  state = stateFrom(await client.request("advance", { steps: 30 }));
  assert.equal(state.phone.openProgress, 1);
  for (let index = 0; index < selection; ++index) state = (await tapKey(client, "KeyS")).released;
  assert.equal(state.phone.selection, selection);
  state = (await tapKey(client, "KeyE")).released;
  assert.equal(state.phone.app, appId);
  assert.equal(state.phone.title, title);
  state = stateFrom(await client.request("advance", { steps: 30 }));
  assert.equal(state.phone.appProgress, 1);
  return client.request("render");
}

async function verifyPhoneDirectory(client, contract) {
  const places = await openPhoneApp(client, 1, "places", "OPEN DOORS");
  const hubPlace = places.phone.items.find(item => item.title === contract.label);
  assert.ok(hubPlace, "Open Doors does not list Harbour Skills House");
  assert.match(hubPlace.detail, new RegExp(HUB_ADDRESS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));

  const work = await openPhoneApp(client, 2, "work", "CITY WORK");
  const hubWork = work.phone.items.find(item => /HARBOUR SKILLS HOUSE.*3 SHIFTS/i.test(item.title));
  assert.ok(hubWork, "City Work does not list the three Harbour Skills House roles");
  assert.match(hubWork.detail, /KITCHEN/i);
  assert.match(hubWork.detail, /REPAIR/i);
  assert.match(hubWork.detail, /ARCHIVE/i);

  const contacts = await openPhoneApp(client, 3, "contacts", "CONTACTS");
  for (const definition of COMMUNITY_HUB_STAFF) {
    const item = contacts.phone.items.find(candidate => candidate.title === definition.name);
    assert.ok(item, `Contacts does not list ${definition.name}`);
    assert.match(item.detail, new RegExp(definition.jobTitle, "i"));
  }
  await closePhone(client);
  return { places: hubPlace, work: hubWork, contacts: STAFF_IDS };
}

async function walkToward(client, target, {
  label = "target",
  stopDistance = 0.68,
  burstSteps = 6,
  maximumBursts = 144,
} = {}) {
  let state = await client.request("snapshot");
  const start = [...positionOf(state)];
  let previousDistance = distance2D(start, target);
  let stagnantBursts = 0;
  try {
    for (let burst = 0; burst < maximumBursts && previousDistance > stopDistance; ++burst) {
      await client.request("face", { x: target[0], z: target[2] });
      await client.request("key", { code: "KeyW", down: true });
      state = stateFrom(await client.request("advance", { steps: burstSteps }));
      await client.request("key", { code: "KeyW", down: false });
      const nextDistance = distance2D(positionOf(state), target);
      if (nextDistance >= previousDistance - 0.003) stagnantBursts += 1;
      else stagnantBursts = 0;
      if (stagnantBursts >= 12) break;
      previousDistance = nextDistance;
    }
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
  }
  state = await client.request("snapshot");
  const finalPosition = [...positionOf(state)];
  const finalDistance = distance2D(finalPosition, target);
  assert.ok(finalDistance <= stopDistance,
    `${label} remained ${finalDistance.toFixed(2)} m away after normal collision-resolved movement`);
  assert.ok(distance2D(start, finalPosition) > 0.2, `${label} traversal did not move the player`);
  return { state, start, finalPosition, finalDistance };
}

const STATIONS_BY_ZONE = Object.freeze({
  reception: Object.freeze(["reception", "repairIntake"]),
  kitchen: Object.freeze(["kitchenPrep", "kitchenServe", "kitchenClean"]),
  workshop: Object.freeze(["repairBench"]),
  classroom: Object.freeze(["classroom", "photoDesk"]),
  breakRoom: Object.freeze(["breakArea"]),
});

function stationApproachWaypoints(contract, zoneKey, stationKey) {
  if (zoneKey !== "classroom" || stationKey !== "photoDesk") return [];
  const zone = contract.zones.classroom;
  const station = contract.stations.photoDesk;
  // The two shared class tables sit between the classroom doorway and the
  // photo desk. A player walking straight at the desk correctly collides with
  // table two, so use the authored east-side aisle before crossing the clear
  // north end of the room. This remains real collision-resolved movement;
  // only the initial per-zone staging uses the QA teleport above.
  return [[zone.bounds.maxX - 1.10, contract.bounds.floorY, station.position[2] - 0.45]];
}

async function inspectPhysicalHub(client, contract) {
  const centerX = (contract.bounds.minX + contract.bounds.maxX) * 0.5;
  const floorY = contract.bounds.floorY;
  const zoneEvidence = {};
  const stationEvidence = {};
  for (const zoneKey of ZONE_KEYS) {
    const zone = contract.zones[zoneKey];
    assert.ok(zone, `physical hub has no ${zoneKey} zone`);
    await client.request("teleport", {
      x: contract.entrance.interior[0],
      z: contract.entrance.interior[2],
    });
    if (zoneKey !== "reception") {
      const doorway = contract.doorways[zoneKey];
      assert.ok(doorway, `physical hub has no ${zoneKey} doorway`);
      await walkToward(client, [centerX, floorY, doorway.position[2]], {
        label: `${zone.label} corridor approach`,
        stopDistance: 0.55,
      });
    }
    const entered = await walkToward(client, zone.position, {
      label: `${zone.label} physical room`,
      stopDistance: 0.68,
    });
    assert.ok(pointInsideBounds(entered.finalPosition, zone.bounds),
      `${zone.label} waypoint is not inside its authored room bounds`);
    zoneEvidence[zoneKey] = entered.finalPosition;

    for (const stationKey of STATIONS_BY_ZONE[zoneKey]) {
      const station = contract.stations[stationKey];
      assert.ok(station, `physical hub has no ${stationKey} station`);
      const current = positionOf(await client.request("snapshot"));
      if (distance2D(current, zone.position) > 0.9) {
        await walkToward(client, zone.position, {
          label: `${zone.label} circulation point`,
          stopDistance: 0.72,
        });
      }
      for (const [waypointIndex, waypoint] of stationApproachWaypoints(contract, zoneKey, stationKey).entries()) {
        await walkToward(client, waypoint, {
          label: `${station.label} aisle waypoint ${waypointIndex + 1}`,
          stopDistance: 0.62,
        });
      }
      const staged = await walkToward(client, station.position, {
        label: `${station.label} station`,
        // The class interaction is deliberately staged at the shared table's
        // centre; normal collision should stop Kai at its usable edge.
        stopDistance: stationKey === "classroom" ? 1.25 : 0.72,
      });
      const control = await client.request("communityHub", { radius: 3.0 });
      assert.equal(control.inside, true, `${station.label} was not classified inside the Skills House`);
      assert.equal(control.nearestStation?.id, station.id,
        `${station.label} did not become the nearest physical station`);
      stationEvidence[stationKey] = staged.finalPosition;
    }
  }
  assert.deepEqual(Object.keys(zoneEvidence).sort(), [...ZONE_KEYS].sort());
  assert.deepEqual(Object.keys(stationEvidence).sort(), [...WORLD_STATION_KEYS].sort());
  return { zones: zoneEvidence, stations: stationEvidence };
}

async function stageAtLogicalStation(client, contract, stationId) {
  const logical = COMMUNITY_HUB_STATIONS.find(station => station.id === stationId);
  assert.ok(logical, `logical community station ${stationId} is missing`);
  const station = contract.stations[logical.worldStationId];
  assert.ok(station, `${stationId} has no ${logical.worldStationId} physical station`);
  await client.request("teleport", { x: station.position[0], z: station.position[2] });
  const state = stateFrom(await client.request("advance", { steps: 2 }));
  const control = await client.request("communityHub", { radius: 3.0 });
  assert.equal(control.inside, true);
  assert.equal(control.nearestStation?.id, station.id);
  assert.ok(distance2D(positionOf(state), station.position) < 0.2,
    `${stationId} staging teleport did not place the real player at its physical fixture`);
  return { logical, station, state };
}

async function startStation(client, stationId, {
  action = "interact",
  quality = 100,
  safetyConfirmed = true,
} = {}) {
  const response = await client.request("communityShift", {
    action,
    stationId,
    quality,
    safetyConfirmed,
  });
  const result = commandResult(response);
  assert.equal(result?.accepted, true, JSON.stringify(result));
  assert.equal(result.stationId, stationId);
  assert.ok(result.durationSeconds > 0);
  return { response, result };
}

async function finishStation(client, started, expectedOutcome) {
  const response = await client.request("communityShift", {
    action: "advance",
    seconds: started.result.durationSeconds + 0.25,
  });
  const bundle = communityBundle(response);
  const result = bundle.hub.lastStationResult;
  assert.equal(result.stationId, started.result.stationId);
  assert.equal(result.outcome, expectedOutcome);
  assert.equal(result.passed, expectedOutcome === "passed");
  assert.equal(bundle.hub.appliedStationResultSerial, result.serial,
    "station need/time effects were not applied through the exactly-once cursor");
  return bundle;
}

function verifyTimingIfAvailable(timing) {
  if (!timing || Number(timing.samples) < 20) return { checked: false, samples: Number(timing?.samples) || 0 };
  assert.equal(timing.stallFrames, 0,
    `community-hub entry contained ${timing.stallFrames} >50ms presentation stalls`);
  assert.ok(timing.maximumMs < 50,
    `community-hub entry contained a ${timing.maximumMs.toFixed(1)}ms presentation hitch`);
  if (timing.phases?.maximumMs) {
    assert.ok(timing.phases.maximumMs.worldStage < 25,
      `community-hub entry spent ${timing.phases.maximumMs.worldStage.toFixed(1)}ms in one world submission`);
  }
  return { checked: true, samples: timing.samples, maximumMs: timing.maximumMs };
}

async function main() {
  const client = await connectWithRetry(pipePath);
  let originalSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true, "native runtime was not ready for community-hub QA");
    assert.equal(state.diagnostics?.backend, "NATIVE WEBGPU");

    const prepared = state.diagnostics?.simulationWarmup?.communityHubPrepared;
    assert.equal(prepared?.ready, true, "community-hub branches were not prewarmed at startup");
    assert.equal(prepared.storage, "memory-only");
    assert.equal(prepared.diskResources, 0);
    assert.equal(prepared.rendererResources, 0);
    assert.equal(prepared.houseRoomsPrepared, 7);
    assert.equal(prepared.rolesPrepared, 3);
    assert.equal(prepared.stationsPrepared, COMMUNITY_HUB_STATIONS.length);
    assert.equal(prepared.staffPrepared, 3);
    assert.equal(prepared.saveRestorePrepared, true);
    assert.equal(prepared.liveStatePreserved, true);
    assert.ok(state.diagnostics.simulationWarmup.branches.some(branch =>
      /harbour.*skills|community.*kitchen.*repair.*archive/i.test(branch)),
    "simulation warmup does not advertise the Harbour Skills House branches");

    const contract = state.world?.communityHub;
    assert.ok(contract, "world snapshot has no physical community-hub contract");
    assert.equal(contract.id, HUB_ID);
    assert.equal(contract.buildingId, HUB_BUILDING_ID);
    assert.equal(contract.address, HUB_ADDRESS);
    assert.equal(contract.stats.rooms, 5);
    assert.equal(contract.stats.doorways, 5);
    assert.equal(contract.stats.stations, 9);
    assert.ok(contract.stats.collisionVolumes >= 20);
    assert.deepEqual(Object.keys(contract.zones), ZONE_KEYS);
    assert.deepEqual(Object.keys(contract.stations), WORLD_STATION_KEYS);
    assert.ok(Array.isArray(contract.entrance?.exterior) && Array.isArray(contract.entrance?.interior));

    const hubControl = await client.request("communityHub");
    assert.equal(hubControl.worldContract.id, HUB_ID);
    assert.deepEqual(hubControl.worldContract.entrance, contract.entrance);
    assert.equal(hubControl.staff.length, 3);
    assert.deepEqual(hubControl.staff.map(staff => staff.id), STAFF_IDS);
    assert.equal(hubControl.staffActors.length, 3);
    assert.deepEqual(hubControl.staffActors.map(actor => actor.staffId), STAFF_IDS);
    for (const definition of COMMUNITY_HUB_STAFF) {
      const staff = hubControl.staff.find(value => value.id === definition.id);
      const staffActor = hubControl.staffActors.find(value => value.staffId === definition.id);
      assert.equal(staff.name, definition.name);
      assert.equal(staff.roleId, definition.roleId);
      assert.ok(Array.isArray(staffActor.position) && staffActor.position.length >= 3);
      const schedule = await client.request("communityStaffSchedule", { staffId: definition.id });
      assert.equal(schedule.id, definition.id);
      assert.equal(schedule.roleId, definition.roleId);
      assert.ok(Array.isArray(schedule.actorPosition) && schedule.actorPosition.length >= 3);
      assert.ok(schedule.routineDestination === null || Array.isArray(schedule.routineDestination));
    }

    originalSave = await client.request("save");
    assert.equal(originalSave.version, 14);
    const originalStaffRuntime = structuredClone(originalSave.activities.communityRuntime.staffActors);
    await client.request("setTime", { dayIndex: 1, hours: 12.5 });
    const movedScheduleSave = await client.request("save");
    assert.ok(movedScheduleSave.activities.communityRuntime.staffActors.some((entry, index) =>
      JSON.stringify(entry.destination) !== JSON.stringify(originalStaffRuntime[index]?.destination)),
    "the staff restore check did not first exercise a different reconstructed schedule");
    await client.request("restore", { snapshot: originalSave });
    const staffRoundTrip = await client.request("save");
    const restoredStaffRuntime = staffRoundTrip.activities.communityRuntime.staffActors;
    const originalStaffById = new Map(originalStaffRuntime.map(entry => [entry.staffId, entry]));
    assert.equal(restoredStaffRuntime.length, originalStaffRuntime.length,
      "save v11 changed the number of persistent staff actors");
    for (const restoredStaff of restoredStaffRuntime) {
      const originalStaff = originalStaffById.get(restoredStaff.staffId);
      assert.ok(originalStaff, `save v11 introduced unknown staff actor ${restoredStaff.staffId}`);
      assert.deepEqual(restoredStaff.destination, originalStaff.destination,
        `${restoredStaff.staffId} destination changed across save v11 restore`);
      assert.equal(restoredStaff.locationId, originalStaff.locationId,
        `${restoredStaff.staffId} location changed across save v11 restore`);
      assert.equal(restoredStaff.activity, originalStaff.activity,
        `${restoredStaff.staffId} activity changed across save v11 restore`);
      assert.equal(restoredStaff.arrived, originalStaff.arrived,
        `${restoredStaff.staffId} arrival state changed across save v11 restore`);
      assert.ok(distance2D(restoredStaff.position, originalStaff.position) <= 0.12,
        `${restoredStaff.staffId} advanced too far between restore and the immediate save`);
      assert.ok(angleDistance(restoredStaff.yaw, originalStaff.yaw) <= 0.25,
        `${restoredStaff.staffId} turned too far between restore and the immediate save`);
    }
    await client.request("communityShift", { action: "reset" });
    state = await clearBlockingNarrative(client);
    await client.request("setTime", { hours: 8.25 });

    for (const role of COMMUNITY_HUB_ROLES) {
      const availability = commandResult(await client.request("communityShift", {
        action: "availability",
        roleId: role.id,
      }));
      assert.equal(availability.roleId, role.id);
      assert.deepEqual(availability.postedHours, role.postedHours);
      assert.equal(availability.nextStationId, role.stationIds[0]);
    }
    const kitchenAvailability = commandResult(await client.request("communityShift", {
      action: "availability",
      roleId: KITCHEN_ROLE.id,
    }));
    assert.equal(kitchenAvailability.canBegin, true, JSON.stringify(kitchenAvailability));

    const phoneEvidence = await verifyPhoneDirectory(client, contract);
    const allocationsBefore = Number((await client.request("snapshot")).diagnostics
      ?.populationSpawnReserve?.runtimeActorAllocations);
    assert.equal(allocationsBefore, 0,
      "community staff should be allocated before READY, never from live-play reserve exhaustion");

    await client.request("resetFrameTiming");
    await client.request("teleport", {
      x: contract.entrance.exterior[0],
      z: contract.entrance.exterior[2],
    });
    await client.request("face", {
      x: contract.entrance.interior[0],
      z: contract.entrance.interior[2],
    });
    let physicalControl = await client.request("communityHub");
    assert.equal(physicalControl.inside, false,
      "the authored exterior point is already classified as inside Harbour Skills House");
    const exteriorPosition = [...positionOf(await client.request("snapshot"))];
    const crossed = await walkToward(client, contract.entrance.interior, {
      label: "Harbour Skills House front threshold",
      stopDistance: 0.55,
      burstSteps: 5,
      maximumBursts: 84,
    });
    physicalControl = await client.request("communityHub");
    assert.equal(physicalControl.inside, true,
      "walking through the visible doorway did not enter Harbour Skills House");
    assert.ok(distance2D(exteriorPosition, crossed.finalPosition) > 2.2,
      "the exterior-to-interior traversal was too short to cross the physical threshold");

    const physicalEvidence = await inspectPhysicalHub(client, contract);
    // Measure only normal gameplay. A requested GPU readback is a development
    // capture operation and may deliberately block while the image is copied.
    await wait(1_250);
    state = await client.request("snapshot");
    const timing = verifyTimingIfAvailable(state.diagnostics?.frameTiming);
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, allocationsBefore,
      "entering and inspecting Harbour Skills House allocated a new actor hierarchy at runtime");
    if (interiorScreenshotPath) {
      await mkdir(path.dirname(path.resolve(interiorScreenshotPath)), { recursive: true });
      const capture = await client.request("screenshot", {
        path: path.resolve(interiorScreenshotPath),
        width: 1280,
        height: 720,
      });
      const capturePath = capture?.path ?? path.resolve(interiorScreenshotPath);
      assert.ok((await stat(capturePath)).size > 25_000, "community-hub screenshot is unexpectedly small");
    }

    const baselineResponse = await client.request("communityShift", { action: "snapshot" });
    const baseline = communityBundle(baselineResponse);
    const baselineCash = Number(baseline.player.cash);
    const baselineTrust = Number(baseline.communityTrust);
    const baselineShiftCount = Number(baseline.lifeProfile.shiftsCompleted);
    const baselineTransactionSerial = Number(baseline.hub.serials.transaction);
    const baselineExperience = Object.fromEntries(baseline.lifeProfile.skills.map(skill => [
      skill.id,
      Number(skill.experience),
    ]));

    await stageAtLogicalStation(client, contract, KITCHEN_ROLE.stationIds[0]);
    const begunResponse = await client.request("communityShift", {
      action: "begin",
      roleId: KITCHEN_ROLE.id,
    });
    let begun = communityBundle(begunResponse);
    assert.equal(begun.hub.activeShift?.roleId, KITCHEN_ROLE.id);
    assert.equal(begun.hub.activeShift?.nextStationId, KITCHEN_ROLE.stationIds[0]);

    let started = await startStation(client, KITCHEN_ROLE.stationIds[0], {
      action: "interact",
      quality: 100,
      safetyConfirmed: false,
    });
    let progressed = await finishStation(client, started, "safety_rework");
    assert.equal(progressed.hub.activeShift.nextStationId, KITCHEN_ROLE.stationIds[0]);
    assert.equal(progressed.hub.activeShift.reworkCount, 1);

    started = await startStation(client, KITCHEN_ROLE.stationIds[0], {
      action: "perform",
      quality: 100,
      safetyConfirmed: true,
    });
    progressed = await finishStation(client, started, "passed");
    assert.deepEqual(progressed.hub.activeShift.completedStationIds, [KITCHEN_ROLE.stationIds[0]]);

    await stageAtLogicalStation(client, contract, KITCHEN_ROLE.stationIds[1]);
    started = await startStation(client, KITCHEN_ROLE.stationIds[1], {
      action: "interact",
      quality: 0,
      safetyConfirmed: true,
    });
    progressed = await finishStation(client, started, "quality_rework");
    assert.equal(progressed.hub.activeShift.nextStationId, KITCHEN_ROLE.stationIds[1]);
    assert.equal(progressed.hub.activeShift.reworkCount, 2);

    started = await startStation(client, KITCHEN_ROLE.stationIds[1], {
      action: "perform",
      quality: 100,
      safetyConfirmed: true,
    });
    progressed = await finishStation(client, started, "passed");
    assert.deepEqual(progressed.hub.activeShift.completedStationIds, KITCHEN_ROLE.stationIds.slice(0, 2));

    await stageAtLogicalStation(client, contract, KITCHEN_ROLE.stationIds[2]);
    started = await startStation(client, KITCHEN_ROLE.stationIds[2], {
      action: "interact",
      quality: 100,
      safetyConfirmed: true,
    });
    let partialResponse = await client.request("communityShift", {
      action: "advance",
      seconds: started.result.durationSeconds * 0.37,
    });
    let partial = communityBundle(partialResponse);
    assert.equal(partial.hub.activeShift.task.stationId, KITCHEN_ROLE.stationIds[2]);

    const cancelledResponse = await client.request("communityShift", { action: "cancel" });
    const cancelledResult = commandResult(cancelledResponse);
    assert.equal(cancelledResult.accepted, true, JSON.stringify(cancelledResult));
    const cancelled = communityBundle(cancelledResponse);
    assert.equal(cancelled.hub.activeShift.status, "paused");
    assert.equal(cancelled.hub.activeShift.task.stationId, KITCHEN_ROLE.stationIds[2]);
    const pausedTask = structuredClone(cancelled.hub.activeShift.task);

    const midShiftSave = await client.request("save");
    assert.equal(midShiftSave.version, 14);
    assert.equal(midShiftSave.activities.selected, null,
      "pausing a community shift should release the active HUD slot while retaining the work ledger");
    assert.equal(midShiftSave.activities.community.shift.status, "paused");
    assert.equal(midShiftSave.activities.community.shift.task.stationId, KITCHEN_ROLE.stationIds[2]);
    assert.equal(midShiftSave.activities.community.shift.task.elapsedSeconds, pausedTask.elapsedSeconds);
    assert.ok(midShiftSave.activities.community.shift.task.elapsedSeconds > 0 &&
      midShiftSave.activities.community.shift.task.elapsedSeconds <
        midShiftSave.activities.community.shift.task.durationSeconds,
    "save v11 did not retain a genuinely partial station task");

    await client.request("communityShift", { action: "begin", roleId: KITCHEN_ROLE.id });
    await client.request("communityShift", { action: "advance", seconds: 0.2 });
    const restored = await client.request("restore", { snapshot: midShiftSave });
    assert.equal(restored.version, 14);
    const restoredBundle = communityBundle(await client.request("communityShift", { action: "snapshot" }));
    assert.equal(restoredBundle.hub.activeShift.status, "paused");
    assert.deepEqual(restoredBundle.hub.activeShift.task, pausedTask,
      "save v11 did not restore the paused physical task exactly");
    assert.equal(restoredBundle.hub.appliedStationResultSerial,
      midShiftSave.activities.communityRuntime.appliedStationResultSerial);
    assert.equal(restoredBundle.hub.appliedTransactionSerial,
      midShiftSave.activities.communityRuntime.appliedTransactionSerial);

    const resumedResponse = await client.request("communityShift", {
      action: "begin",
      roleId: KITCHEN_ROLE.id,
    });
    const resumed = communityBundle(resumedResponse);
    assert.equal(resumed.hub.activeShift.status, "active");
    assert.deepEqual(resumed.hub.activeShift.task, pausedTask,
      "resuming the saved shift discarded or restarted its in-progress station");
    progressed = communityBundle(await client.request("communityShift", {
      action: "advance",
      seconds: pausedTask.durationSeconds + 0.25,
    }));
    assert.equal(progressed.hub.lastStationResult.outcome, "passed");
    assert.equal(progressed.hub.lastStationResult.stationId, KITCHEN_ROLE.stationIds[2]);

    await stageAtLogicalStation(client, contract, KITCHEN_ROLE.stationIds[3]);
    started = await startStation(client, KITCHEN_ROLE.stationIds[3], {
      action: "interact",
      quality: 100,
      safetyConfirmed: true,
    });
    const completed = await finishStation(client, started, "passed");
    assert.equal(completed.hub.activeShift, null);
    assert.deepEqual(completed.hub.lastStationResult.transaction, completed.hub.lastTransaction);
    const transaction = completed.hub.lastTransaction;
    assert.equal(transaction.roleId, KITCHEN_ROLE.id);
    assert.equal(transaction.serial, baselineTransactionSerial + 1);
    assert.equal(completed.hub.appliedTransactionSerial, transaction.serial);
    assert.equal(completed.hub.roles.find(role => role.roleId === KITCHEN_ROLE.id)?.completedToday, true);

    const profileShift = completed.lifeProfile.shiftHistory.at(-1);
    assert.equal(completed.lifeProfile.shiftsCompleted, baselineShiftCount + 1);
    assert.equal(profileShift.id, transaction.sourceId);
    assert.equal(profileShift.activityId, KITCHEN_ROLE.id);
    assert.equal(completed.player.cash, baselineCash + profileShift.wage,
      "the community wage was not added to player cash exactly once");
    const expectedTrust = Math.max(2, 4 + Math.round(transaction.quality / 20) - transaction.reworkCount);
    assert.equal(completed.communityTrust, baselineTrust + expectedTrust,
      "community trust was not awarded exactly once from the completed shift");
    for (const award of profileShift.awards) {
      assert.equal(skillExperience(completed.lifeProfile, award.skillId),
        baselineExperience[award.skillId] + award.experience,
      `${award.skillId} experience was not awarded exactly once`);
    }

    for (let index = 0; index < 4; ++index) await client.request("render");
    await client.request("communityShift", { action: "advance", seconds: 5 });
    const stable = communityBundle(await client.request("communityShift", { action: "snapshot" }));
    assert.equal(stable.player.cash, completed.player.cash, "render/update replayed the community wage");
    assert.equal(stable.communityTrust, completed.communityTrust, "render/update replayed community trust");
    assert.equal(stable.lifeProfile.shiftsCompleted, completed.lifeProfile.shiftsCompleted,
      "render/update filed a duplicate life-profile shift");
    assert.equal(stable.hub.appliedTransactionSerial, transaction.serial);
    for (const award of profileShift.awards) {
      assert.equal(skillExperience(stable.lifeProfile, award.skillId),
        skillExperience(completed.lifeProfile, award.skillId),
      `render/update replayed ${award.skillId} experience`);
    }

    const completedSave = await client.request("save");
    assert.equal(completedSave.version, 14);
    await client.request("restore", { snapshot: completedSave });
    const roundTrip = await client.request("save");
    assert.deepEqual(roundTrip.activities.community, completedSave.activities.community,
      "save v11 did not round-trip community shifts and their source ledger exactly");
    assert.equal(roundTrip.activities.communityRuntime.appliedTransactionSerial, transaction.serial);
    assert.equal(roundTrip.player.cash, completedSave.player.cash);
    assert.equal(roundTrip.communityTrust, completedSave.communityTrust);
    assert.deepEqual(durableLifeProfileSave(roundTrip.lifeProfile),
      durableLifeProfileSave(completedSave.lifeProfile),
    "save v11 replayed or lost durable skills, history, serials, source IDs, or activity ledgers");
    const profileElapsedAdvance = roundTrip.lifeProfile.elapsed - completedSave.lifeProfile.elapsed;
    assert.ok(profileElapsedAdvance >= 0 && profileElapsedAdvance <= 1,
      `life-profile elapsed time advanced ${profileElapsedAdvance.toFixed(4)}s during the save round-trip`);
    for (const [needId, maximumDecayPerSecond] of [["energy", 0.014], ["hygiene", 0.006]]) {
      const before = Number(completedSave.lifeProfile.needs[needId]);
      const after = Number(roundTrip.lifeProfile.needs[needId]);
      const decay = before - after;
      assert.ok(decay >= -1e-9,
        `${needId} increased unexpectedly during the save round-trip (${before} -> ${after})`);
      assert.ok(decay <= profileElapsedAdvance * maximumDecayPerSecond + 1e-8,
        `${needId} decayed ${decay} during only ${profileElapsedAdvance.toFixed(4)}s of normal simulation`);
    }

    state = await client.request("snapshot");
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, allocationsBefore,
      "community shift, save, and restore allocated a new actor hierarchy during live play");
    console.log(JSON.stringify({
      ready: state.ready,
      hub: {
        id: contract.id,
        address: contract.address,
        exteriorPosition,
        interiorPosition: crossed.finalPosition,
        zonesInspected: Object.keys(physicalEvidence.zones),
        stationsInspected: Object.keys(physicalEvidence.stations),
        staffInspected: STAFF_IDS,
      },
      role: {
        id: transaction.roleId,
        completedStationIds: KITCHEN_ROLE.stationIds,
        reworkCount: transaction.reworkCount,
        wage: profileShift.wage,
        trust: expectedTrust,
        awards: profileShift.awards,
      },
      phone: phoneEvidence,
      timing,
      saveVersion: roundTrip.version,
      interiorScreenshotPath,
    }, null, 2));
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "KeyS", down: false }).catch(() => {});
    await client.request("key", { code: "KeyE", down: false }).catch(() => {});
    if (originalSave) await client.request("restore", { snapshot: originalSave }).catch(() => {});
    client.close();
  }
}

await main();
