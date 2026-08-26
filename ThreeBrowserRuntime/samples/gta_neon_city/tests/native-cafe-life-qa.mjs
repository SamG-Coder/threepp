import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  ASHA_PATEL,
  CAFE_SHIFT_STATIONS,
  COMMON_GROUND_CAFE,
  COMMON_GROUND_CAFE_STAFF,
  COMMON_GROUND_SHIFT_ROLE,
} from "../src/game/cafe-shift.mjs";

const pipePath = process.argv[2];
const interiorScreenshotPath = process.argv[3] ?? null;
const prepCompletionMode = process.argv.includes("--control-prep") ? "control-loop" : "real-time";
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-cafe-life-qa.mjs <pipe> [interior.png] [--control-prep]");
}

const CAFE_ID = "common_ground_cafe";
const CAFE_BUILDING_ID = "common-ground-cafe-building";
const CAFE_ADDRESS = "16 Common Ground Lane";
const STAFF_IDS = Object.freeze(["asha_patel", "dani_okoro", "rafael_chen"]);
const ZONE_KEYS = Object.freeze([
  "dining",
  "service",
  "kitchen",
  "dishes",
  "stock",
  "staffNook",
  "toilet",
]);
const WORLD_STATION_KEYS = Object.freeze([
  "handover",
  "till",
  "prep",
  "serve",
  "dishes",
  "stock",
  "break",
  "customerTable1",
  "customerTable2",
]);
const LAUNCHER_TITLES = Object.freeze([
  "PULSE PAY",
  "OPEN DOORS",
  "CITY WORK",
  "CONTACTS",
  "LIFE PROFILE",
  "MY HOME",
  "NEON MAP",
]);

assert.equal(COMMON_GROUND_CAFE.id, CAFE_ID);
assert.equal(COMMON_GROUND_CAFE.buildingId, CAFE_BUILDING_ID);
assert.equal(COMMON_GROUND_CAFE.address, CAFE_ADDRESS);
assert.equal(COMMON_GROUND_SHIFT_ROLE.id, "common_ground_shift");
assert.deepEqual(COMMON_GROUND_CAFE_STAFF.map(staff => staff.id), STAFF_IDS);
assert.deepEqual(CAFE_SHIFT_STATIONS.map(station => station.id), [
  "cafe-handover",
  "cafe-till",
  "cafe-prep",
  "cafe-serve",
  "cafe-dishes",
  "cafe-stock",
]);

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
      else pending.reject(new Error(response.error || "native Common Ground Cafe control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = op === "screenshot" || op === "advance" ? 60_000 : 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native Common Ground Cafe request timed out: ${op}`));
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
  throw lastError ?? new Error("native Common Ground Cafe pipe did not become ready");
}

function stateFrom(response) {
  return response?.state ?? response;
}

function commandResult(response) {
  return response?.result ?? response;
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

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number(value)));
}

function normalizedMinute(value) {
  return ((Math.trunc(Number(value)) % 1440) + 1440) % 1440;
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

function cafeState(response) {
  const value = response?.cafeShift ?? response?.cafe ?? response;
  assert.equal(value?.cafe?.id, CAFE_ID, "cafe shift response has no Common Ground snapshot");
  assert.ok(Array.isArray(value.staff), "cafe shift response has no staff directory");
  return value;
}

function cafeBundle(response) {
  const cafe = cafeState(response);
  return {
    result: response?.result ?? null,
    cafe,
    lifeProfile: response?.lifeProfile ?? null,
    player: response?.player ?? null,
    communityTrust: response?.communityTrust,
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
        "an authored narrative retained player controls during cafe QA");
      break;
    }
    state = await client.request("snapshot");
    if (guard === 127) throw new Error("blocking narrative did not settle within 128 authored transitions");
  }
  if (state.neighbourhood?.menuOpen) {
    await client.request("closeBusiness");
    state = await client.request("snapshot");
  }
  if (state.selectedActivity === "cafe") {
    await client.request("cafeShift", { action: "reset" });
    state = await client.request("snapshot");
  } else if (state.selectedActivity === "community") {
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
  assert.equal(state.phone?.open, false, "cafe QA could not close the pre-existing phone view");
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
  assert.deepEqual(state.phone.items.map(item => item.title), LAUNCHER_TITLES,
    "the cafe integration must preserve all seven launcher apps");
  state = stateFrom(await client.request("advance", { steps: 30 }));
  assert.equal(state.phone.openProgress, 1);
  for (let index = 0; index < selection; ++index) state = (await tapKey(client, "KeyS")).released;
  assert.equal(state.phone.selection, selection);
  state = (await tapKey(client, "KeyE")).released;
  assert.equal(state.phone.app, appId);
  assert.equal(state.phone.title, title);
  assert.ok(state.phone.appProgress > 0 && state.phone.appProgress < 1,
    `${title} skipped its retained bottom-up opening transition`);
  state = stateFrom(await client.request("advance", { steps: 30 }));
  assert.equal(state.phone.appProgress, 1);
  return client.request("render");
}

async function verifyPhoneDirectory(client, contract) {
  const places = await openPhoneApp(client, 1, "places", "OPEN DOORS");
  const cafePlace = places.phone.items.find(item => item.title === contract.label);
  assert.ok(cafePlace, "Open Doors does not list Common Ground Cafe");
  assert.match(cafePlace.detail, /WALK THROUGH THE STREET DOOR/i);
  assert.match(cafePlace.detail, /COUNTER/i);
  assert.match(cafePlace.detail, /KITCHEN/i);
  assert.match(cafePlace.detail, /STAFF ROOMS/i);

  const work = await openPhoneApp(client, 2, "work", "CITY WORK");
  const cafeWork = work.phone.items.find(item => /COMMON GROUND CAFE.*PAID SHIFT/i.test(item.title));
  assert.ok(cafeWork, "City Work does not list the paid Common Ground shift");
  assert.match(cafeWork.detail, /HANDOVER/i);
  assert.match(cafeWork.detail, /TILL/i);
  assert.match(cafeWork.detail, /PREP/i);
  assert.match(cafeWork.detail, /DISHES/i);
  assert.match(cafeWork.detail, /STOCK/i);

  const contacts = await openPhoneApp(client, 3, "contacts", "CONTACTS");
  for (const definition of COMMON_GROUND_CAFE_STAFF) {
    const matches = contacts.phone.items.filter(item => item.title === definition.name);
    assert.equal(matches.length, 1, `Contacts must list exactly one ${definition.name}`);
    assert.match(matches[0].detail, new RegExp(definition.jobTitle, "i"));
  }
  const asha = contacts.phone.items.find(item => item.title === ASHA_PATEL.name);
  assert.match(asha.detail, new RegExp(CAFE_ADDRESS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  await closePhone(client);
  return { places: cafePlace, work: cafeWork, contact: asha };
}

async function walkToward(client, target, {
  label = "target",
  stopDistance = 0.58,
  burstSteps = 5,
  maximumBursts = 120,
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
    `${label} remained ${finalDistance.toFixed(2)} m away after collision-resolved movement`);
  assert.ok(distance2D(start, finalPosition) > 0.2, `${label} traversal did not move the player`);
  return { state, start, finalPosition, finalDistance };
}

async function crossDoorway(client, doorway, axis, direction, label) {
  const offset = 1.24;
  const start = [...doorway.position];
  const target = [...doorway.position];
  if (axis === "x") {
    start[0] -= direction * offset;
    target[0] += direction * offset;
  } else {
    start[2] -= direction * offset;
    target[2] += direction * offset;
  }
  await client.request("teleport", { x: start[0], z: start[2] });
  const crossing = await walkToward(client, target, {
    label,
    stopDistance: 0.54,
    maximumBursts: 54,
  });
  assert.ok(distance2D(crossing.start, crossing.finalPosition) >= 1.75,
    `${label} did not actually cross the wall plane`);
  return crossing.finalPosition;
}

async function inspectPhysicalCafe(client, contract) {
  const doorwayEvidence = {};
  doorwayEvidence.exterior = await crossDoorway(client, contract.doorways.exterior, "z", 1,
    "Common Ground street doorway");
  let control = await client.request("commonGroundCafe");
  assert.equal(control.inside, true, "walking through the visible street doorway did not enter the cafe");

  doorwayEvidence.backOfHouse = await crossDoorway(client, contract.doorways.backOfHouse, "z", 1,
    "back-of-house doorway");
  doorwayEvidence.kitchenDishes = await crossDoorway(client, contract.doorways.kitchenDishes, "x", 1,
    "kitchen-to-dishes doorway");
  doorwayEvidence.stock = await crossDoorway(client, contract.doorways.stock, "z", 1,
    "stock-room doorway");
  doorwayEvidence.staffNook = await crossDoorway(client, contract.doorways.staffNook, "z", 1,
    "staff-nook doorway");
  doorwayEvidence.toilet = await crossDoorway(client, contract.doorways.toilet, "z", 1,
    "accessible-toilet doorway");

  const zones = {};
  for (const zoneKey of ZONE_KEYS) {
    const zone = contract.zones[zoneKey];
    assert.ok(zone, `physical cafe has no ${zoneKey} room`);
    await client.request("teleport", { x: zone.position[0], z: zone.position[2] });
    const state = stateFrom(await client.request("advance", { steps: 2 }));
    control = await client.request("commonGroundCafe");
    assert.equal(control.inside, true, `${zone.label} was not classified inside the cafe`);
    assert.ok(pointInsideBounds(positionOf(state), zone.bounds), `${zone.label} anchor is outside its room bounds`);
    assert.ok(Math.abs(Number(positionOf(state)[1]) - Number(contract.bounds.floorY)) < 0.35,
      `${zone.label} did not place Kai on the cafe floor`);
    zones[zoneKey] = [...positionOf(state)];
  }

  const stations = {};
  for (const stationKey of WORLD_STATION_KEYS) {
    const station = contract.stations[stationKey];
    assert.ok(station, `physical cafe has no ${stationKey} station`);
    await client.request("teleport", { x: station.position[0], z: station.position[2] });
    const state = stateFrom(await client.request("advance", { steps: 2 }));
    control = await client.request("commonGroundCafe");
    assert.equal(control.inside, true, `${station.label} is outside the cafe`);
    assert.equal(control.nearestStation?.id, station.id,
      `${station.label} did not become the nearest physical station`);
    assert.ok(distance2D(positionOf(state), station.position) <= 0.43,
      `${station.label} is not reachable within Kai's 0.43 m collision radius`);
    stations[stationKey] = [...positionOf(state)];
  }
  return { doorways: doorwayEvidence, zones, stations };
}

async function stageAtLogicalStation(client, contract, stationId) {
  const logical = CAFE_SHIFT_STATIONS.find(station => station.id === stationId);
  assert.ok(logical, `logical cafe station ${stationId} is missing`);
  const entry = Object.entries(contract.stations).find(([, station]) => station.id === logical.worldStationId);
  assert.ok(entry, `${stationId} has no ${logical.worldStationId} physical station`);
  const [stationKey, station] = entry;
  await client.request("teleport", { x: station.position[0], z: station.position[2] });
  const state = stateFrom(await client.request("advance", { steps: 2 }));
  const control = await client.request("commonGroundCafe");
  assert.equal(control.inside, true);
  assert.equal(control.nearestStation?.id, station.id);
  assert.ok(distance2D(positionOf(state), station.position) <= 0.43,
    `${stationId} staging did not place the real player at its physical fixture`);
  return { logical, station, stationKey, state };
}

async function startStation(client, stationId, {
  quality = 100,
  safetyConfirmed = true,
} = {}) {
  const response = await client.request("cafeShift", {
    action: "perform",
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
  const before = cafeBundle(await client.request("cafeShift", { action: "snapshot" }));
  const beforeWorld = await client.request("snapshot");
  const response = await client.request("cafeShift", {
    action: "advance",
    seconds: started.result.durationSeconds + 0.25,
  });
  const bundle = cafeBundle(response);
  const result = bundle.cafe.lastStationResult;
  assert.equal(result.stationId, started.result.stationId);
  assert.equal(result.outcome, expectedOutcome);
  assert.equal(result.passed, expectedOutcome === "passed");
  assert.equal(bundle.cafe.clock.minuteOfDay,
    normalizedMinute(before.cafe.clock.minuteOfDay + result.gameMinutes),
  `${result.stationId} did not advance the authoritative cafe clock exactly once`);

  for (const needId of ["energy", "hygiene"]) {
    const expected = clamp(Number(before.lifeProfile.needs[needId]) + Number(result.needEffects[needId] ?? 0), 0, 100);
    const actual = Number(bundle.lifeProfile.needs[needId]);
    assert.ok(Math.abs(actual - expected) <= 0.035,
      `${result.stationId} ${needId} effect was not applied exactly once (${expected} expected, ${actual} actual)`);
  }
  const afterWorld = await client.request("snapshot");
  const expectedAppetite = clamp(Number(beforeWorld.neighbourhood.appetite) +
    Number(result.needEffects.appetite ?? 0), 0, 100);
  assert.ok(Math.abs(Number(afterWorld.neighbourhood.appetite) - expectedAppetite) <= 0.06,
    `${result.stationId} appetite effect was not applied exactly once`);

  const save = await client.request("save");
  assert.equal(save.activities.cafeRuntime.appliedStationResultSerial, result.serial,
    `${result.stationId} did not advance the exactly-once station cursor`);
  return { ...bundle, result, beforeWorld, afterWorld };
}

async function finishStationInRealTime(client, started, expectedOutcome) {
  const before = cafeBundle(await client.request("cafeShift", { action: "snapshot" }));
  const beforeWorld = await client.request("snapshot");
  const activeTask = before.cafe.activeShift?.task;
  assert.equal(activeTask?.stationId, started.result.stationId);
  const remainingSeconds = Math.max(0,
    Number(activeTask.durationSeconds) - Number(activeTask.elapsedSeconds));
  await wait((remainingSeconds + 0.75) * 1_000);
  const bundle = cafeBundle(await client.request("cafeShift", { action: "snapshot" }));
  const result = bundle.cafe.lastStationResult;
  assert.equal(result.stationId, started.result.stationId);
  assert.equal(result.outcome, expectedOutcome);
  assert.equal(result.passed, expectedOutcome === "passed");

  const cafeMinuteDelta = normalizedMinute(
    bundle.cafe.clock.minuteOfDay - before.cafe.clock.minuteOfDay,
  );
  const cafeAmbientMinutes = normalizedMinute(cafeMinuteDelta - result.gameMinutes);
  assert.ok(cafeAmbientMinutes <= 5,
    `${result.stationId} real-time completion added ${cafeAmbientMinutes} unexplained cafe-clock minutes`);
  for (const needId of ["energy", "hygiene"]) {
    const expected = clamp(Number(before.lifeProfile.needs[needId]) + Number(result.needEffects[needId] ?? 0), 0, 100);
    const actual = Number(bundle.lifeProfile.needs[needId]);
    assert.ok(Math.abs(actual - expected) <= 0.12,
      `${result.stationId} ${needId} effect was not applied once during real-time work`);
  }
  const afterWorld = await client.request("snapshot");
  const expectedAppetite = clamp(Number(beforeWorld.neighbourhood.appetite) +
    Number(result.needEffects.appetite ?? 0), 0, 100);
  assert.ok(Math.abs(Number(afterWorld.neighbourhood.appetite) - expectedAppetite) <= 0.12,
    `${result.stationId} appetite effect was not applied once during real-time work`);
  const environmentMinuteDelta = normalizedMinute(Math.round(
    (Number(afterWorld.environment.timeHours) - Number(beforeWorld.environment.timeHours)) * 60,
  ));
  const environmentAmbientMinutes = normalizedMinute(environmentMinuteDelta - result.gameMinutes);
  assert.ok(environmentAmbientMinutes <= 5,
    `${result.stationId} real-time completion added ${environmentAmbientMinutes} unexplained environment minutes`);

  const save = await client.request("save");
  assert.equal(save.activities.cafeRuntime.appliedStationResultSerial, result.serial,
    `${result.stationId} did not advance the exactly-once cursor during real-time work`);
  return {
    ...bundle,
    result,
    beforeWorld,
    afterWorld,
    clockEvidence: {
      mode: "real-time",
      remainingSeconds,
      cafeBeforeMinute: before.cafe.clock.minuteOfDay,
      cafeAfterMinute: bundle.cafe.clock.minuteOfDay,
      cafeTaskMinutes: result.gameMinutes,
      cafeAmbientMinutes,
      environmentBeforeHours: beforeWorld.environment.timeHours,
      environmentAfterHours: afterWorld.environment.timeHours,
      environmentTaskMinutes: result.gameMinutes,
      environmentAmbientMinutes,
    },
  };
}

function verifyTiming(timing, label) {
  assert.ok(Number(timing?.samples) >= 20, `${label} has too few presented-frame samples`);
  assert.equal(timing.stallFrames, 0,
    `${label} contained ${timing.stallFrames} >50ms presentation stalls: ${JSON.stringify(timing)}`);
  assert.ok(timing.maximumMs < 50,
    `${label} contained a ${Number(timing.maximumMs).toFixed(1)}ms presentation hitch`);
  if (timing.phases?.maximumMs) {
    assert.ok(timing.phases.maximumMs.worldStage < 25,
      `${label} spent ${timing.phases.maximumMs.worldStage.toFixed(1)}ms in one world submission`);
  }
  return { samples: timing.samples, maximumMs: timing.maximumMs, p95Ms: timing.p95Ms };
}

async function captureTimingWindow(client, label, waitMs = 420) {
  await wait(waitMs);
  const state = await client.request("snapshot");
  const timing = state.diagnostics?.frameTiming;
  assert.ok(Number(timing?.samples) >= 20,
    `${label} has only ${Number(timing?.samples) || 0} presented-frame samples`);
  return {
    label,
    samples: timing.samples,
    latestMs: timing.latestMs,
    averageMs: timing.averageMs,
    p95Ms: timing.p95Ms,
    maximumMs: timing.maximumMs,
    overBudgetFrames: timing.overBudgetFrames,
    stallFrames: timing.stallFrames,
    phases: timing.phases,
  };
}

function verifyTimingWindows(windows, label, diagnostic = null) {
  const offenders = windows.filter(window => window.stallFrames > 0 || window.maximumMs >= 50);
  assert.equal(offenders.length, 0,
    `${label} contained >50ms windows: ${JSON.stringify({ offenders, diagnostic })}`);
  for (const window of windows) {
    assert.ok(window.phases.maximumMs.worldStage < 25,
      `${window.label} spent ${window.phases.maximumMs.worldStage.toFixed(1)}ms in one world submission`);
  }
  return windows.map(window => ({
    label: window.label,
    samples: window.samples,
    p95Ms: window.p95Ms,
    maximumMs: window.maximumMs,
  }));
}

async function verifyAshaScheduleAndPersistence(client, contract) {
  await client.request("setTime", { dayIndex: 0, hours: 5.15 });
  const home = await client.request("cafeStaffSchedule", { staffId: ASHA_PATEL.id });
  assert.equal(home.workingDay, true);
  assert.equal(home.activity, "home");
  assert.equal(home.locationId, ASHA_PATEL.homeLocationId);

  await client.request("setTime", { dayIndex: 0, hours: 5.20 });
  const commute = await client.request("cafeStaffSchedule", { staffId: ASHA_PATEL.id });
  assert.equal(commute.activity, "commute");
  assert.equal(commute.locationId, "pulse-core-walk");
  assert.ok(Array.isArray(commute.routineDestination));
  assert.ok(distance2D(home.routineDestination, commute.routineDestination) > 25,
    "Asha's commute did not assign a materially different destination");
  assert.ok(distance2D(home.actorPosition, commute.actorPosition) < 0.08,
    "crossing Asha's commute boundary teleported her actor");

  stateFrom(await client.request("advance", { steps: 60 }));
  const moving = await client.request("cafeStaffSchedule", { staffId: ASHA_PATEL.id });
  const movement = distance2D(commute.actorPosition, moving.actorPosition);
  assert.ok(movement > 0.08, `Asha moved only ${movement.toFixed(3)} m in one second`);
  assert.ok(movement < 5, `Asha moved ${movement.toFixed(2)} m in one second, indicating a teleport`);
  assert.ok(distance2D(moving.actorPosition, moving.routineDestination) > 1,
    "Asha completed a cross-city commute instantaneously");

  const midRouteSave = await client.request("save");
  assert.equal(midRouteSave.version, 14);
  const savedStaff = structuredClone(midRouteSave.activities.cafeRuntime.staffActors);
  const savedAsha = savedStaff.find(entry => entry.staffId === ASHA_PATEL.id);
  assert.ok(savedAsha && Array.isArray(savedAsha.destination));
  assert.equal(savedAsha.activity, "commute");

  await client.request("setTime", { dayIndex: 0, hours: 12 });
  await client.request("advance", { steps: 45 });
  const restored = await client.request("restore", { snapshot: midRouteSave });
  assert.equal(restored.version, 14);
  const immediateStaff = restored.activities.cafeRuntime.staffActors;
  const immediateById = new Map(immediateStaff.map(entry => [entry.staffId, entry]));
  for (const saved of savedStaff) {
    const immediate = immediateById.get(saved.staffId);
    assert.ok(immediate, `save v11 omitted cafe staff actor ${saved.staffId} during restore`);
    assert.deepEqual(immediate, saved,
      `${saved.staffId} was not restored exactly on the restore transaction`);
  }
  const roundTrip = await client.request("save");
  const restoredStaff = roundTrip.activities.cafeRuntime.staffActors;
  assert.equal(restoredStaff.length, savedStaff.length,
    "save v11 changed the number of persistent cafe staff actors");
  const savedById = new Map(savedStaff.map(entry => [entry.staffId, entry]));
  for (const current of restoredStaff) {
    const saved = savedById.get(current.staffId);
    assert.ok(saved, `save v11 introduced unknown cafe staff actor ${current.staffId}`);
    assert.deepEqual(current.destination, saved.destination,
      `${current.staffId} destination changed across save v11 restore`);
    assert.equal(current.locationId, saved.locationId);
    assert.equal(current.activity, saved.activity);
    assert.equal(current.arrived, saved.arrived);
    const restoreMovement = distance2D(current.position, saved.position);
    assert.ok(restoreMovement <= 0.75,
      `${current.staffId} advanced ${restoreMovement.toFixed(3)} m between restore and immediate save`);
    assert.ok(angleDistance(current.yaw, saved.yaw) <= Math.PI,
      `${current.staffId} produced an invalid yaw after restored route steering`);
  }

  const scheduleChecks = [];
  for (const [hours, activity, locationId] of [
    [5.51, "opening_setup", CAFE_ID],
    [6.00, "service", CAFE_ID],
    [11.51, "break", CAFE_ID],
    [12.00, "service", CAFE_ID],
    [18.10, "close_down", CAFE_ID],
    [18.60, "commute", "pulse-core-walk"],
  ]) {
    await client.request("setTime", { dayIndex: 0, hours });
    const schedule = await client.request("cafeStaffSchedule", { staffId: ASHA_PATEL.id });
    assert.equal(schedule.activity, activity, `Asha's ${hours} schedule activity is wrong`);
    assert.equal(schedule.locationId, locationId, `Asha's ${hours} schedule location is wrong`);
    scheduleChecks.push({ hours, activity, locationId });
  }
  await client.request("setTime", { dayIndex: 1, hours: 8.5 });
  const dayOff = await client.request("cafeStaffSchedule", { staffId: ASHA_PATEL.id });
  assert.equal(dayOff.workingDay, false);
  assert.equal(dayOff.locationId, ASHA_PATEL.homeLocationId);
  const dayOffAvailability = commandResult(await client.request("cafeShift", { action: "availability" }));
  assert.equal(dayOffAvailability.businessOpen, true);
  assert.equal(dayOffAvailability.canBegin, false,
    "the phone/control availability must not advertise Asha's supervised shift on her day off");
  assert.equal(dayOffAvailability.reason, "supervisor_off_day");

  await client.request("setTime", { dayIndex: 0, hours: 8.25 });
  const onDuty = await client.request("cafeStaffSchedule", { staffId: ASHA_PATEL.id });
  assert.equal(onDuty.locationId, CAFE_ID);
  assert.equal(onDuty.actorId, "shopkeeper-common_ground_cafe",
    "Asha must reuse Common Ground's original shopkeeper actor");
  const state = await client.request("snapshot");
  const byActorId = state.population.filter(actor => actor.id === onDuty.actorId);
  const byName = state.population.filter(actor =>
    String(actor.displayName).toUpperCase() === ASHA_PATEL.name.toUpperCase());
  assert.equal(byActorId.length, 1, "Asha's actor id is duplicated in the live population");
  assert.equal(byName.length, 1, "Asha Patel is represented by more than one live actor");
  assert.equal(byActorId[0].storyProtected, true);
  assert.equal(byActorId[0].storyLocked, false, "Asha must be a scheduled person, not a frozen prop");
  assert.ok(pointInsideBounds(onDuty.routineDestination, contract.bounds),
    "Asha's service destination is not inside the physical cafe");
  return { home, commute, moving, midRouteSave, scheduleChecks, dayOff, onDuty };
}

async function verifyMidnightClockRoundTrip(client) {
  const before = await client.request("save");
  try {
    await client.request("setTime", { dayIndex: 6, hours: 23.9999 });
    stateFrom(await client.request("advance", { steps: 1 }));
    const boundary = await client.request("save");
    const expected = boundary.clock;
    assert.deepEqual(expected, { dayIndex: 7, minuteOfDay: 0, timeHours: boundary.environment.timeHours });
    assert.equal(boundary.neighbourhood.dayIndex, expected.dayIndex);
    assert.equal(boundary.neighbourhood.minuteOfDay, expected.minuteOfDay);
    assert.equal(boundary.residential.clock.dayIndex, expected.dayIndex);
    assert.equal(boundary.residential.clock.minuteOfDay, expected.minuteOfDay);
    assert.equal(boundary.activities.community.clock.dayIndex, expected.dayIndex);
    assert.equal(boundary.activities.community.clock.minuteOfDay, expected.minuteOfDay);
    assert.equal(boundary.activities.cafe.clock.dayIndex, expected.dayIndex);
    assert.equal(boundary.activities.cafe.clock.minuteOfDay, expected.minuteOfDay);

    await client.request("setTime", { dayIndex: 2, hours: 12 });
    await client.request("restore", { snapshot: boundary });
    const roundTrip = await client.request("save");
    assert.equal(roundTrip.clock.dayIndex, expected.dayIndex, "midnight restore changed the authoritative saved day");
    assert.equal(roundTrip.clock.minuteOfDay, expected.minuteOfDay,
      "midnight restore split the restored systems across different minutes");
    assert.equal(roundTrip.neighbourhood.dayIndex, expected.dayIndex);
    assert.equal(roundTrip.residential.clock.dayIndex, expected.dayIndex);
    assert.equal(roundTrip.activities.community.clock.dayIndex, expected.dayIndex);
    assert.equal(roundTrip.activities.cafe.clock.dayIndex, expected.dayIndex);
    return expected;
  } finally {
    await client.request("restore", { snapshot: before });
  }
}

async function verifyNiaCafeRoute(client, contract) {
  let evidence = null;
  for (let dayIndex = 0; dayIndex < 42; ++dayIndex) {
    await client.request("setTime", { dayIndex, hours: 18 });
    const state = await client.request("residentSchedule", { residentId: "nia_okafor" });
    if (state.activity === "leisure" && state.locationId === CAFE_ID) {
      evidence = { dayIndex, ...state };
      break;
    }
  }
  assert.ok(evidence, "Nia never selected her seeded Common Ground leisure route in six weeks");
  assert.ok(Array.isArray(evidence.routineDestination));
  assert.ok(distance2D(evidence.routineDestination, contract.customerAnchors.seating[0]) <= 0.05,
    "Nia's Common Ground leisure route does not end at the authored customer seat");
  assert.ok(pointInsideBounds(evidence.routineDestination, contract.bounds),
    "Nia's cafe destination is outside the walk-in interior");
  return evidence;
}

async function main() {
  const client = await connectWithRetry(pipePath);
  let originalSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true, "native runtime was not ready for Common Ground Cafe QA");
    assert.equal(state.diagnostics?.backend, "NATIVE WEBGPU");

    const prepared = state.diagnostics?.simulationWarmup?.cafeShiftPrepared;
    assert.equal(prepared?.ready, true, "cafe branches were not prewarmed at startup");
    assert.equal(prepared.storage, "memory-only");
    assert.equal(prepared.diskResources, 0);
    assert.equal(prepared.rendererResources, 0);
    assert.equal(prepared.stationsPrepared, CAFE_SHIFT_STATIONS.length);
    assert.equal(prepared.outcomesPrepared, CAFE_SHIFT_STATIONS.length * 3);
    assert.equal(prepared.dailyBriefingsPrepared, 7);
    assert.equal(prepared.saveRestorePrepared, true);
    assert.equal(prepared.liveStatePreserved, true);
    assert.ok(state.diagnostics.simulationWarmup.branches.some(branch =>
      /common-ground-cafe.*handover.*till.*prep.*service.*dishes.*stock/i.test(branch)),
    "simulation warmup does not advertise all Common Ground work branches");
    assert.equal(state.diagnostics.pipelineWarmup.textureStorage, "memory-only");
    assert.equal(state.diagnostics.pipelineWarmup.textureDiskCache, false);
    assert.equal(state.diagnostics.pipelineWarmup.allTextureSourcesReady, true);
    assert.deepEqual(state.diagnostics.pipelineWarmup.pendingTextureSources, []);
    assert.equal(state.diagnostics.pipelineWarmup.explicitTextureUploads,
      state.diagnostics.pipelineWarmup.textures);
    assert.equal(state.diagnostics.pipelineWarmup.queueSettledBeforePlay, true);

    const snapshotContract = state.world?.commonGroundCafe;
    assert.ok(snapshotContract, "world snapshot has no physical Common Ground Cafe contract");
    assert.equal(snapshotContract.id, CAFE_ID);
    assert.equal(snapshotContract.buildingId, CAFE_BUILDING_ID);
    assert.equal(snapshotContract.address, CAFE_ADDRESS);
    assert.equal(snapshotContract.stats.rooms, 7);
    assert.equal(snapshotContract.stats.doorways, 6);
    assert.equal(snapshotContract.stats.stations, 9);
    assert.equal(snapshotContract.stats.staffSpawns, 3);
    assert.equal(snapshotContract.stats.customerSpawns, 4);
    assert.ok(snapshotContract.stats.collisionVolumes >= 20);
    assert.deepEqual(Object.keys(snapshotContract.zones), ZONE_KEYS);
    assert.deepEqual(Object.keys(snapshotContract.stations), WORLD_STATION_KEYS);
    assert.equal(snapshotContract.entrance.transition, "continuous-world");
    assert.equal(snapshotContract.entrance.loading, false);
    assert.equal(snapshotContract.entrance.teleport, false);

    const cafeControl = await client.request("commonGroundCafe");
    const contract = cafeControl.worldContract;
    assert.equal(contract.id, CAFE_ID);
    assert.deepEqual(contract.entrance, snapshotContract.entrance);
    assert.deepEqual(contract.renderBudget, {
      geometriesAdded: 0,
      materialsAdded: 0,
      instancedBatchesAdded: 0,
      lightsAdded: 0,
    }, "Common Ground must reuse startup render pools instead of allocating gameplay assets");
    assert.equal(contract.glass.emissive, false);
    assert.equal(contract.glass.neon, false);
    assert.equal(cafeControl.staff.length, 3);
    assert.deepEqual(cafeControl.staff.map(staff => staff.id), STAFF_IDS);
    assert.equal(cafeControl.staffActors.length, 3);
    assert.deepEqual(cafeControl.staffActors.map(actor => actor.staffId), STAFF_IDS);

    originalSave = await client.request("save");
    assert.equal(originalSave.version, 14);
    state = await clearBlockingNarrative(client);

    const scheduleEvidence = await verifyAshaScheduleAndPersistence(client, contract);
    const midnightClockEvidence = await verifyMidnightClockRoundTrip(client);
    const niaEvidence = await verifyNiaCafeRoute(client, contract);
    await client.request("cafeShift", { action: "reset" });
    await client.request("setTime", { dayIndex: 2, hours: 8.25 });

    const availability = commandResult(await client.request("cafeShift", { action: "availability" }));
    assert.equal(availability.businessId, CAFE_ID);
    assert.equal(availability.activityId, COMMON_GROUND_SHIFT_ROLE.id);
    assert.equal(availability.canBegin, true, JSON.stringify(availability));
    assert.equal(availability.nextStationId, CAFE_SHIFT_STATIONS[0].id);
    assert.deepEqual(availability.postedHours, COMMON_GROUND_CAFE.openingHours);

    const allocationsBefore = Number(state.diagnostics.populationSpawnReserve.runtimeActorAllocations);
    const audioBefore = state.diagnostics.audio;
    const warmupBefore = state.diagnostics.pipelineWarmup;
    assert.equal(allocationsBefore, 0,
      "cafe staff must be allocated before READY, never from the live-play reserve");
    assert.equal(audioBefore.runtimeElementAllocations, 0);
    assert.equal(audioBefore.runtimeSourceLoads, 0);

    const shiftTimingWindows = [];
    await client.request("resetFrameTiming");
    const phoneEvidence = await verifyPhoneDirectory(client, contract);
    await wait(1_250);
    state = await client.request("snapshot");
    const phoneTiming = verifyTiming(state.diagnostics.frameTiming, "Common Ground phone directory");

    await client.request("resetFrameTiming");
    await client.request("teleport", {
      x: contract.entrance.exterior[0],
      z: contract.entrance.exterior[2],
    });
    await client.request("face", {
      x: contract.entrance.interior[0],
      z: contract.entrance.interior[2],
    });
    let physicalControl = await client.request("commonGroundCafe");
    assert.equal(physicalControl.inside, false,
      "the authored exterior point is already classified as inside Common Ground");
    const exteriorPosition = [...positionOf(await client.request("snapshot"))];
    const crossed = await walkToward(client, contract.entrance.interior, {
      label: "Common Ground front threshold",
      stopDistance: 0.55,
      maximumBursts: 72,
    });
    physicalControl = await client.request("commonGroundCafe");
    assert.equal(physicalControl.inside, true,
      "walking through the visible doorway did not enter Common Ground Cafe");
    assert.ok(distance2D(exteriorPosition, crossed.finalPosition) > 1.5,
      "the exterior-to-interior traversal was too short to cross the physical threshold");

    const physicalEvidence = await inspectPhysicalCafe(client, contract);
    await wait(1_250);
    state = await client.request("snapshot");
    const traversalTiming = verifyTiming(state.diagnostics.frameTiming, "Common Ground physical traversal");
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, allocationsBefore,
      "entering and inspecting Common Ground allocated a new actor hierarchy");

    if (interiorScreenshotPath) {
      await client.request("teleport", {
        x: contract.zones.dining.position[0],
        z: contract.zones.dining.position[2],
      });
      await client.request("face", {
        x: contract.zones.service.position[0],
        z: contract.zones.service.position[2],
      });
      stateFrom(await client.request("advance", { steps: 24 }));
      await mkdir(path.dirname(path.resolve(interiorScreenshotPath)), { recursive: true });
      const capture = await client.request("screenshot", {
        path: path.resolve(interiorScreenshotPath),
        width: 1280,
        height: 720,
      });
      const capturePath = capture?.path ?? path.resolve(interiorScreenshotPath);
      assert.ok((await stat(capturePath)).size > 25_000, "Common Ground screenshot is unexpectedly small");
    }

    await client.request("cafeShift", { action: "reset" });
    await client.request("setTime", { dayIndex: 2, hours: 8.25 });
    const baseline = cafeBundle(await client.request("cafeShift", { action: "snapshot" }));
    const baselineWorld = await client.request("snapshot");
    const baselineCash = Number(baseline.player.cash);
    const baselineTrust = Number(baseline.communityTrust);
    const baselineShiftCount = Number(baseline.lifeProfile.shiftsCompleted);
    const baselineTransactionSerial = Number(baseline.cafe.serials.transaction);
    const baselineMinute = Number(baseline.cafe.clock.minuteOfDay);
    const baselineNeeds = {
      energy: Number(baseline.lifeProfile.needs.energy),
      hygiene: Number(baseline.lifeProfile.needs.hygiene),
      appetite: Number(baselineWorld.neighbourhood.appetite),
    };
    const baselineExperience = Object.fromEntries(baseline.lifeProfile.skills.map(skill => [
      skill.id,
      Number(skill.experience),
    ]));

    await client.request("resetFrameTiming");
    await stageAtLogicalStation(client, contract, CAFE_SHIFT_STATIONS[0].id);
    const begunResponse = await client.request("cafeShift", { action: "begin" });
    let begun = cafeBundle(begunResponse);
    assert.equal(begun.cafe.activeShift?.status, "active");
    assert.equal(begun.cafe.activeShift?.nextStationId, CAFE_SHIFT_STATIONS[0].id);

    const stationResults = [];
    let started = await startStation(client, CAFE_SHIFT_STATIONS[0].id, {
      quality: 100,
      safetyConfirmed: false,
    });
    let progressed = await finishStation(client, started, "safety_rework");
    stationResults.push(progressed.result);
    assert.equal(progressed.cafe.activeShift.nextStationId, CAFE_SHIFT_STATIONS[0].id);
    assert.equal(progressed.cafe.activeShift.reworkCount, 1);
    shiftTimingWindows.push(await captureTimingWindow(client, "handover safety rework"));

    await client.request("resetFrameTiming");
    started = await startStation(client, CAFE_SHIFT_STATIONS[0].id, {
      quality: 100,
      safetyConfirmed: true,
    });
    progressed = await finishStation(client, started, "passed");
    stationResults.push(progressed.result);
    assert.deepEqual(progressed.cafe.activeShift.completedStationIds, [CAFE_SHIFT_STATIONS[0].id]);
    shiftTimingWindows.push(await captureTimingWindow(client, "handover corrected pass"));

    await client.request("resetFrameTiming");
    await stageAtLogicalStation(client, contract, CAFE_SHIFT_STATIONS[1].id);
    started = await startStation(client, CAFE_SHIFT_STATIONS[1].id, {
      quality: 100,
      safetyConfirmed: true,
    });
    progressed = await finishStation(client, started, "passed");
    stationResults.push(progressed.result);
    shiftTimingWindows.push(await captureTimingWindow(client, "till and order queue"));

    const beforeContinuousPrepSave = await client.request("save");
    assert.equal(beforeContinuousPrepSave.activities.selected, "cafe");
    assert.equal(beforeContinuousPrepSave.activities.cafe.shift.task, null);
    assert.equal(beforeContinuousPrepSave.activities.cafe.shift.taskIndex, 2);
    await client.request("resetFrameTiming");
    await stageAtLogicalStation(client, contract, CAFE_SHIFT_STATIONS[2].id);
    const continuousPrepStarted = await startStation(client, CAFE_SHIFT_STATIONS[2].id, {
      quality: 100,
      safetyConfirmed: true,
    });
    const continuousPrep = await finishStationInRealTime(client, continuousPrepStarted, "passed");
    const continuousPrepClockEvidence = continuousPrep.clockEvidence;
    shiftTimingWindows.push(await captureTimingWindow(client, "prep continuous comparison (real-time)"));
    const continuousRestore = await client.request("restore", { snapshot: beforeContinuousPrepSave });
    assert.equal(continuousRestore.version, 14);
    const continuousRoundTrip = await client.request("save");
    assert.deepEqual(continuousRoundTrip.activities.cafe, beforeContinuousPrepSave.activities.cafe,
      "the continuous-prep diagnostic did not restore its pre-prep cafe ledger exactly");
    assert.equal(continuousRoundTrip.activities.cafeRuntime.appliedStationResultSerial,
      beforeContinuousPrepSave.activities.cafeRuntime.appliedStationResultSerial);

    await client.request("resetFrameTiming");
    await stageAtLogicalStation(client, contract, CAFE_SHIFT_STATIONS[2].id);
    started = await startStation(client, CAFE_SHIFT_STATIONS[2].id, {
      quality: 100,
      safetyConfirmed: true,
    });
    const partialResponse = await client.request("cafeShift", {
      action: "advance",
      seconds: started.result.durationSeconds * 0.37,
    });
    let partial = cafeBundle(partialResponse);
    assert.equal(partial.cafe.activeShift.task.stationId, CAFE_SHIFT_STATIONS[2].id);
    assert.ok(partial.cafe.activeShift.task.progress > 0 && partial.cafe.activeShift.task.progress < 1);

    const pausedResponse = await client.request("cafeShift", { action: "pause" });
    const pausedResult = commandResult(pausedResponse);
    assert.equal(pausedResult.accepted, true, JSON.stringify(pausedResult));
    const paused = cafeBundle(pausedResponse);
    assert.equal(paused.cafe.activeShift.status, "paused");
    const pausedTask = structuredClone(paused.cafe.activeShift.task);

    const midShiftSave = await client.request("save");
    assert.equal(midShiftSave.version, 14);
    assert.equal(midShiftSave.activities.selected, null,
      "pausing a cafe shift must release the active HUD slot while retaining its ledger");
    assert.equal(midShiftSave.activities.cafe.shift.status, "paused");
    assert.deepEqual(midShiftSave.activities.cafe.shift.task, {
      ...midShiftSave.activities.cafe.shift.task,
      stationId: CAFE_SHIFT_STATIONS[2].id,
    });
    assert.ok(midShiftSave.activities.cafe.shift.task.elapsedSeconds > 0 &&
      midShiftSave.activities.cafe.shift.task.elapsedSeconds <
        midShiftSave.activities.cafe.shift.task.durationSeconds,
    "save v11 did not retain a genuinely partial cafe task");

    await client.request("cafeShift", { action: "begin" });
    await client.request("cafeShift", { action: "advance", seconds: 0.2 });
    const restored = await client.request("restore", { snapshot: midShiftSave });
    assert.equal(restored.version, 14);
    const restoredBundle = cafeBundle(await client.request("cafeShift", { action: "snapshot" }));
    assert.equal(restoredBundle.cafe.activeShift.status, "paused");
    assert.deepEqual(restoredBundle.cafe.activeShift.task, pausedTask,
      "save v11 did not restore the paused cafe task exactly");
    const restoredSave = await client.request("save");
    assert.equal(restoredSave.activities.cafeRuntime.appliedStationResultSerial,
      midShiftSave.activities.cafeRuntime.appliedStationResultSerial);
    assert.equal(restoredSave.activities.cafeRuntime.appliedTransactionSerial,
      midShiftSave.activities.cafeRuntime.appliedTransactionSerial);
    shiftTimingWindows.push(await captureTimingWindow(client, "prep partial task, pause, save, and restore"));

    await client.request("resetFrameTiming");
    const resumedResponse = await client.request("cafeShift", { action: "begin" });
    const resumed = cafeBundle(resumedResponse);
    assert.equal(resumed.cafe.activeShift.status, "active");
    assert.deepEqual(resumed.cafe.activeShift.task, pausedTask,
      "resuming the saved shift discarded or restarted its partial task");
    const resumedPrepDescriptor = {
      result: {
        stationId: CAFE_SHIFT_STATIONS[2].id,
        durationSeconds: pausedTask.durationSeconds,
      },
    };
    progressed = prepCompletionMode === "control-loop"
      ? await finishStation(client, resumedPrepDescriptor, "passed")
      : await finishStationInRealTime(client, resumedPrepDescriptor, "passed");
    const resumedPrepClockEvidence = progressed.clockEvidence ?? {
      mode: "control-loop",
      cafeAfterMinute: progressed.cafe.clock.minuteOfDay,
      cafeTaskMinutes: progressed.result.gameMinutes,
      environmentAfterHours: progressed.afterWorld.environment.timeHours,
    };
    stationResults.push(progressed.result);
    shiftTimingWindows.push(await captureTimingWindow(client,
      `prep resumed completion (${prepCompletionMode})`));

    for (let stationIndex = 3; stationIndex < CAFE_SHIFT_STATIONS.length; ++stationIndex) {
      await client.request("resetFrameTiming");
      const station = CAFE_SHIFT_STATIONS[stationIndex];
      await stageAtLogicalStation(client, contract, station.id);
      started = await startStation(client, station.id, { quality: 100, safetyConfirmed: true });
      progressed = await finishStation(client, started, "passed");
      stationResults.push(progressed.result);
      shiftTimingWindows.push(await captureTimingWindow(client, station.name.toLowerCase()));
    }
    const completed = progressed;
    assert.equal(completed.cafe.activeShift, null);
    assert.deepEqual(completed.cafe.lastStationResult.transaction, completed.cafe.lastTransaction);
    const transaction = completed.cafe.lastTransaction;
    assert.equal(transaction.activityId, COMMON_GROUND_SHIFT_ROLE.id);
    assert.equal(transaction.serial, baselineTransactionSerial + 1);
    assert.equal(transaction.reworkCount, 1);
    assert.equal(transaction.safetyPasses, CAFE_SHIFT_STATIONS.length);
    assert.deepEqual(transaction.externalLedgerEffects, { customerPurchases: 0, payForwardCredits: 0 },
      "paid work must not forge customer purchases or pay-forward credits");
    assert.deepEqual(stationResults.map(result => result.stationId), [
      CAFE_SHIFT_STATIONS[0].id,
      ...CAFE_SHIFT_STATIONS.map(station => station.id),
    ]);
    assert.equal(transaction.gameMinutes,
      stationResults.reduce((total, result) => total + result.gameMinutes, 0));
    const expectedWorkMinute = normalizedMinute(baselineMinute + transaction.gameMinutes);
    const ambientMinutesDuringMeasuredWindows = normalizedMinute(
      completed.cafe.clock.minuteOfDay - expectedWorkMinute,
    );
    assert.ok(ambientMinutesDuringMeasuredWindows <= 12,
      `the measured real-time windows advanced ${ambientMinutesDuringMeasuredWindows} ambient minutes beyond exact task time`);

    const profileShift = completed.lifeProfile.shiftHistory.at(-1);
    assert.equal(completed.lifeProfile.shiftsCompleted, baselineShiftCount + 1);
    assert.equal(profileShift.id, transaction.sourceId);
    assert.equal(profileShift.activityId, COMMON_GROUND_SHIFT_ROLE.id);
    assert.equal(completed.player.cash, baselineCash + profileShift.wage,
      "the cafe wage was not added to player cash exactly once");
    assert.equal(completed.communityTrust, baselineTrust + transaction.trustReward,
      "the cafe trust reward was not added exactly once");
    for (const award of profileShift.awards) {
      assert.equal(skillExperience(completed.lifeProfile, award.skillId),
        baselineExperience[award.skillId] + award.experience,
      `${award.skillId} experience was not awarded exactly once`);
    }
    const finalWorld = await client.request("snapshot");
    const needTotals = stationResults.reduce((totals, result) => ({
      energy: totals.energy + Number(result.needEffects.energy ?? 0),
      hygiene: totals.hygiene + Number(result.needEffects.hygiene ?? 0),
      appetite: totals.appetite + Number(result.needEffects.appetite ?? 0),
    }), { energy: 0, hygiene: 0, appetite: 0 });
    assert.ok(Math.abs(Number(completed.lifeProfile.needs.energy) -
      clamp(baselineNeeds.energy + needTotals.energy, 0, 100)) <= 0.25,
    "the complete shift's energy effects were not applied once per attempt");
    assert.ok(Math.abs(Number(completed.lifeProfile.needs.hygiene) -
      clamp(baselineNeeds.hygiene + needTotals.hygiene, 0, 100)) <= 0.15,
    "the complete shift's hygiene effects were not applied once per attempt");
    assert.ok(Math.abs(Number(finalWorld.neighbourhood.appetite) -
      clamp(baselineNeeds.appetite + needTotals.appetite, 0, 100)) <= 0.25,
    "the complete shift's appetite effects were not applied once per attempt");
    const finalCafeClock = cafeBundle(await client.request("cafeShift", { action: "snapshot" }))
      .cafe.clock.minuteOfDay;
    assert.ok(Math.abs(Number(finalWorld.environment.timeHours) -
      finalCafeClock / 60) <= 0.02,
    "environment time and the cafe's authoritative clock diverged");

    const completionSave = await client.request("save");
    assert.equal(completionSave.activities.cafeRuntime.appliedTransactionSerial, transaction.serial);
    assert.equal(completionSave.activities.cafeRuntime.appliedStationResultSerial,
      completed.cafe.lastStationResult.serial);
    await client.request("resetFrameTiming");
    for (let index = 0; index < 4; ++index) await client.request("render");
    await client.request("cafeShift", { action: "advance", seconds: 5 });
    const stable = cafeBundle(await client.request("cafeShift", { action: "snapshot" }));
    assert.equal(stable.player.cash, completed.player.cash, "render/update replayed the cafe wage");
    assert.equal(stable.communityTrust, completed.communityTrust, "render/update replayed cafe trust");
    assert.equal(stable.lifeProfile.shiftsCompleted, completed.lifeProfile.shiftsCompleted,
      "render/update filed a duplicate cafe shift");
    const duplicateBegin = cafeBundle(await client.request("cafeShift", { action: "begin" }));
    assert.equal(duplicateBegin.result.accepted, false);
    assert.equal(duplicateBegin.result.reason, "already_completed_today");

    await client.request("restore", { snapshot: completionSave });
    const roundTrip = await client.request("save");
    assert.equal(roundTrip.version, 14);
    const { clock: completedCafeClock, ...completedCafeDurable } = completionSave.activities.cafe;
    const { clock: roundTripCafeClock, ...roundTripCafeDurable } = roundTrip.activities.cafe;
    assert.deepEqual(roundTripCafeDurable, completedCafeDurable,
      "save v11 did not round-trip the cafe shift and exact source ledger");
    assert.equal(roundTripCafeClock.dayIndex, completedCafeClock.dayIndex);
    const cafeClockAdvance = normalizedMinute(roundTripCafeClock.minuteOfDay - completedCafeClock.minuteOfDay);
    assert.ok(cafeClockAdvance <= 1,
      `the live cafe clock advanced ${cafeClockAdvance} minutes during its immediate save round-trip`);
    assert.equal(roundTrip.activities.cafeRuntime.appliedTransactionSerial, transaction.serial);
    assert.equal(roundTrip.player.cash, completionSave.player.cash);
    assert.equal(roundTrip.communityTrust, completionSave.communityTrust);
    assert.deepEqual(durableLifeProfileSave(roundTrip.lifeProfile),
      durableLifeProfileSave(completionSave.lifeProfile),
    "save v11 replayed or lost durable cafe skills, history, serials, or source IDs");

    shiftTimingWindows.push(await captureTimingWindow(client, "completion idempotency and save round-trip"));
    const shiftTiming = verifyTimingWindows(shiftTimingWindows, "Common Ground full paid shift", {
      prepCompletionMode,
      continuousPrepClockEvidence,
      resumedPrepClockEvidence,
    });
    state = await client.request("snapshot");
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, allocationsBefore,
      "cafe traversal, work, audio, save, or restore allocated a new actor hierarchy");
    assert.equal(state.diagnostics.audio.runtimeElementAllocations, audioBefore.runtimeElementAllocations,
      "cafe work allocated an audio element after READY");
    assert.equal(state.diagnostics.audio.runtimeSourceLoads, audioBefore.runtimeSourceLoads,
      "cafe work loaded an audio source after READY");
    assert.equal(state.diagnostics.audio.currentElementCount, audioBefore.currentElementCount,
      "cafe work changed the fixed audio element pool");
    assert.equal(state.diagnostics.pipelineWarmup.textures, warmupBefore.textures,
      "cafe traversal discovered a new runtime texture");
    assert.equal(state.diagnostics.pipelineWarmup.explicitTextureUploads, warmupBefore.explicitTextureUploads,
      "cafe traversal uploaded a new texture after READY");

    console.log(JSON.stringify({
      ready: state.ready,
      cafe: {
        id: contract.id,
        address: contract.address,
        exteriorPosition,
        interiorPosition: crossed.finalPosition,
        doorwaysInspected: Object.keys(physicalEvidence.doorways),
        zonesInspected: Object.keys(physicalEvidence.zones),
        stationsInspected: Object.keys(physicalEvidence.stations),
      },
      staff: {
        ids: STAFF_IDS,
        ashaActorId: scheduleEvidence.onDuty.actorId,
        commuteMovement: distance2D(scheduleEvidence.commute.actorPosition,
          scheduleEvidence.moving.actorPosition),
        restoredMidRoute: true,
        niaCafeDay: niaEvidence.dayIndex,
        midnightClock: midnightClockEvidence,
      },
      shift: {
        activityId: transaction.activityId,
        stationAttempts: stationResults.map(result => ({
          stationId: result.stationId,
          outcome: result.outcome,
          gameMinutes: result.gameMinutes,
        })),
        reworkCount: transaction.reworkCount,
        wage: profileShift.wage,
        trust: transaction.trustReward,
        awards: profileShift.awards,
        gameMinutes: transaction.gameMinutes,
        continuousPrepClockEvidence,
        resumedPrepClockEvidence,
      },
      phone: phoneEvidence,
      timing: { phone: phoneTiming, traversal: traversalTiming, shift: shiftTiming },
      allocations: {
        actors: state.diagnostics.populationSpawnReserve.runtimeActorAllocations,
        audioElements: state.diagnostics.audio.runtimeElementAllocations,
        audioSourceLoads: state.diagnostics.audio.runtimeSourceLoads,
        textureUploads: state.diagnostics.pipelineWarmup.explicitTextureUploads,
      },
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
