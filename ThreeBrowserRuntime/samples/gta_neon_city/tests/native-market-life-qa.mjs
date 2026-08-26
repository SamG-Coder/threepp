import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  MARKET_SURPLUS_DECISIONS,
  MINA_MARKET_STAFF,
  MINA_MARKET_STATIONS,
  MINA_MARKET_WORKPLACE,
  MINA_OKAFOR,
} from "../src/game/market-shift.mjs";
import { RESIDENTIAL_LIMITS } from "../src/game/residential-life.mjs";

const pipePath = process.argv[2];
const marketScreenshotPath = path.resolve(
  process.argv[3] ?? path.join(process.cwd(), "artifacts", "gta-neon-market-life-native.png"),
);
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-market-life-qa.mjs <pipe> [market.png]");
}

const MARKET_ID = "mina_market_kitchen";
const MARKET_BUILDING_ID = "mina-market-building";
const MARKET_HOST_BUILDING_ID = "building-009";
const MARKET_ADDRESS = "84 Market Street";
const GROCERY_ITEM_ID = "weekly_grocery_bag";
const GROCERY_UNITS = 5;
const GROCERY_COST = 18;
const VALID_OCCUPANCY_PHASES = new Set([
  "to_exterior",
  "to_threshold",
  "to_interior",
  "dwell",
  "to_threshold_exit",
  "to_exterior_exit",
]);

assert.equal(MINA_MARKET_WORKPLACE.id, MARKET_ID);
assert.equal(MINA_MARKET_WORKPLACE.propertyId, MARKET_BUILDING_ID);
assert.equal(MINA_MARKET_WORKPLACE.buildingId, MARKET_HOST_BUILDING_ID);
assert.equal(MINA_MARKET_WORKPLACE.address, MARKET_ADDRESS);
assert.deepEqual(MINA_MARKET_STAFF.map(staff => staff.id), ["mina_okafor", "emi_sato"]);
assert.equal(MARKET_SURPLUS_DECISIONS.find(decision => decision.id === "donate")?.communityTrust, 4);
assert.deepEqual(MINA_MARKET_STATIONS.map(station => station.id), [
  "mina-order-counter",
  "mina-cold-case",
  "mina-produce-scale",
  "mina-pantry-shelf",
  "mina-packing-bench",
  "mina-grocery-checkout",
  "mina-dish-sink",
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
      else pending.reject(new Error(response.error || "native Mina's Market control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = op === "screenshot" || op === "advance" ? 60_000 : 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native Mina's Market request timed out: ${op}`));
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
  throw lastError ?? new Error("native Mina's Market pipe did not become ready");
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

function pointInsideBounds(position, bounds, tolerance = 0.35) {
  return Number(position?.[0]) >= Number(bounds?.minX) - tolerance &&
    Number(position?.[0]) <= Number(bounds?.maxX) + tolerance &&
    Number(position?.[2]) >= Number(bounds?.minZ) - tolerance &&
    Number(position?.[2]) <= Number(bounds?.maxZ) + tolerance;
}

function firstChoiceId(state) {
  return state?.choice?.options?.[0]?.id ?? null;
}

function skillExperience(profile, skillId) {
  const skill = profile?.skillById?.[skillId] ?? profile?.skills?.find(value => value.id === skillId);
  assert.ok(skill, `life profile has no ${skillId} skill`);
  return Number(skill.experience);
}

function marketBundle(response) {
  const marketShift = response?.marketShift ?? response?.market ?? response;
  assert.equal(marketShift?.market?.id, MARKET_ID, "market response has no Mina's Market workplace");
  return {
    result: response?.result ?? null,
    marketShift,
    lifeProfile: response?.lifeProfile ?? null,
    player: response?.player ?? null,
    communityTrust: Number(response?.communityTrust),
  };
}

function currentHome(residential) {
  const homeId = residential?.player?.currentHomeId;
  const home = residential?.homes?.find(value => value.id === homeId) ?? null;
  assert.ok(home, "residential snapshot has no current physical home");
  return home;
}

function assertUniqueReservations(occupancy, label) {
  assert.ok(Array.isArray(occupancy?.occupants), `${label} has no occupant directory`);
  assert.ok(Array.isArray(occupancy?.reservations), `${label} has no reservation directory`);
  const keys = occupancy.reservations.map(value => value.key);
  assert.equal(new Set(keys).size, keys.length, `${label} duplicated a physical reservation key`);
  assert.equal(new Set(occupancy.occupants.map(value => value.actorId)).size, occupancy.occupants.length,
    `${label} leased one actor more than once`);
  assert.equal(new Set(occupancy.occupants.map(value => value.reservationKey)).size, occupancy.occupants.length,
    `${label} placed two civilians in one room slot`);
  assert.ok(occupancy.occupants.every(value => VALID_OCCUPANCY_PHASES.has(value.phase)),
    `${label} contains an invalid traversal phase`);
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
        "an authored narrative retained player controls during market QA");
      break;
    }
    state = await client.request("snapshot");
    if (guard === 127) throw new Error("blocking narrative did not settle within 128 authored transitions");
  }
  if (state.neighbourhood?.menuOpen) {
    await client.request("closeBusiness");
    state = await client.request("snapshot");
  }
  if (state.selectedActivity === "market") {
    await client.request("marketShift", { action: "reset" });
    state = await client.request("snapshot");
  } else if (state.selectedActivity === "cafe") {
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
  assert.equal(state.phone?.open, false, "market QA could not close the pre-existing phone view");
  await client.request("clearWanted");
  return state;
}

async function setPaused(client, paused) {
  let state = await client.request("snapshot");
  if (Boolean(state.paused) !== Boolean(paused)) {
    await client.request("action", { action: "pause" });
    state = stateFrom(await client.request("advance", { steps: 2 }));
  }
  assert.equal(Boolean(state.paused), Boolean(paused), `could not ${paused ? "pause" : "resume"} native QA`);
  return state;
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

async function verifyStaffSchedules(client) {
  await client.request("setTime", { dayIndex: 1, hours: 7.49 });
  const minaFloor = await client.request("marketStaffSchedule", { staffId: MINA_OKAFOR.id });
  const emiHome = await client.request("marketStaffSchedule", { staffId: "emi_sato" });
  assert.equal(minaFloor.activity, "supervise_floor");
  assert.equal(minaFloor.locationId, MARKET_ID);
  assert.equal(minaFloor.atWork, true);
  assert.equal(minaFloor.home?.id, "mina-okafor-home");
  assert.equal(minaFloor.home?.address, "84 Market Street, Flat 2");
  assert.equal(emiHome.activity, "home");
  assert.equal(emiHome.locationId, "emi-sato-home");
  assert.equal(emiHome.atWork, false);
  assert.equal(emiHome.home?.id, "emi-sato-home");
  assert.equal(emiHome.home?.address, "18 Lantern Court");

  await client.request("setTime", { dayIndex: 1, hours: 7.51 });
  const emiBoundary = await client.request("marketStaffSchedule", { staffId: "emi_sato" });
  assert.equal(emiBoundary.activity, "commute");
  assert.equal(emiBoundary.locationId, "north-market-walk");
  assert.ok(distance2D(emiHome.routineDestination, emiBoundary.routineDestination) > 30,
    "Emi's home-to-market schedule boundary did not assign a cross-city commute");
  assert.ok(distance2D(emiHome.actorPosition, emiBoundary.actorPosition) < 0.08,
    "changing Emi's schedule teleported her on the boundary frame");
  // The shared planner resolves one queued full route per simulation tick, so
  // give the resident/staff queue time to drain before judging continuous
  // movement. Which actor wins the first two seconds is not part of the game
  // contract; moving without teleporting is.
  stateFrom(await client.request("advance", { steps: 600 }));
  const emiMoving = await client.request("marketStaffSchedule", { staffId: "emi_sato" });
  const movement = distance2D(emiBoundary.actorPosition, emiMoving.actorPosition);
  const initialRemaining = distance2D(emiBoundary.actorPosition, emiBoundary.routineDestination);
  const remaining = distance2D(emiMoving.actorPosition, emiMoving.routineDestination);
  assert.ok(movement > 0.04, `Emi moved only ${movement.toFixed(3)} m during the commute window`);
  assert.ok(movement < 8, `Emi moved ${movement.toFixed(2)} m during the commute window, indicating a teleport`);
  assert.ok(remaining < initialRemaining, "Emi did not make progress toward Mina's Market");

  await client.request("setTime", { dayIndex: 1, hours: 9 });
  const minaWork = await client.request("marketStaffSchedule", { staffId: MINA_OKAFOR.id });
  const emiWork = await client.request("marketStaffSchedule", { staffId: "emi_sato" });
  assert.equal(minaWork.locationId, MARKET_ID);
  assert.equal(emiWork.locationId, MARKET_ID);
  assert.equal(emiWork.activity, "stock_and_checkout");
  assert.equal(emiWork.roomId, "mina-grocery-checkout");
  assert.ok(Array.isArray(minaWork.routineDestination));
  assert.ok(Array.isArray(emiWork.routineDestination));

  await client.request("setTime", { dayIndex: 6, hours: 9 });
  const emiWeekend = await client.request("marketStaffSchedule", { staffId: "emi_sato" });
  assert.equal(emiWeekend.workingDay, false);
  assert.equal(emiWeekend.activity, "home");
  assert.equal(emiWeekend.locationId, "emi-sato-home");
  return { minaFloor, emiHome, emiBoundary, emiMoving, minaWork, emiWork, emiWeekend, movement };
}

async function verifyInteriorOccupancy(client, initialState) {
  let occupancy = await client.request("interiorOccupancy");
  assert.equal(occupancy.saveVersion, 1);
  assert.equal(occupancy.ownerId, "interior-occupancy");
  assert.deepEqual(occupancy.eligibleActorIds,
    Array.from({ length: 13 }, (_, index) => `civilian-${index + 18}`));
  assert.deepEqual(occupancy.buildings.map(value => value.id).sort(), [
    "common_ground_cafe",
    "harbour-skills-house",
    MARKET_ID,
    "pulse-garage-left-service-bay",
  ].sort());
  assert.ok(occupancy.occupants.length > 0, "the open daytime city scheduled no interior visitors");
  assert.ok(occupancy.occupants.some(value => value.buildingId === MARKET_ID),
    "the open market scheduled no deterministic shoppers");
  assertUniqueReservations(occupancy, "initial interior occupancy");
  const populationCount = initialState.population.length;
  const allocationCount = initialState.diagnostics.populationSpawnReserve.runtimeActorAllocations;
  const beforeById = new Map(occupancy.occupants.map(value => [value.actorId, [...value.position]]));

  stateFrom(await client.request("advance", { steps: 120 }));
  occupancy = await client.request("interiorOccupancy");
  assertUniqueReservations(occupancy, "moving interior occupancy");
  const displacements = occupancy.occupants
    .filter(value => beforeById.has(value.actorId))
    .map(value => ({ actorId: value.actorId, distance: distance2D(beforeById.get(value.actorId), value.position) }));
  assert.ok(displacements.length > 0, "all leased visitors disappeared instead of following their routes");
  const maximumMovement = Math.max(...displacements.map(value => value.distance));
  assert.ok(maximumMovement > 0.08,
    `leased civilians moved at most ${maximumMovement.toFixed(3)} m in two seconds`);
  assert.ok(maximumMovement < 8,
    `a leased civilian moved ${maximumMovement.toFixed(2)} m in two seconds, indicating a teleport`);
  const afterState = await client.request("snapshot");
  assert.equal(afterState.population.length, populationCount,
    "interior visits constructed or destroyed a population actor");
  assert.equal(afterState.diagnostics.populationSpawnReserve.runtimeActorAllocations, allocationCount,
    "interior visits allocated a runtime actor instead of leasing an existing civilian");
  return { occupancy, displacements, maximumMovement };
}

async function enterPhysicalMarket(client, contract) {
  assert.equal(contract.entrance.transition, "continuous-world");
  assert.equal(contract.entrance.loading, false);
  assert.equal(contract.entrance.teleport, false);
  assert.ok(contract.entrance.clearWidth >= 1.5, "Mina's street doorway is not a usable public entrance");
  assert.ok(contract.entrance.arcadeGapBounds?.width >= 2.2,
    "the retained arcade counters do not leave a usable approach to Mina's doorway");
  await client.request("teleport", { x: contract.entrance.street[0], z: contract.entrance.street[2] });
  let state = await client.request("snapshot");
  assert.equal((await client.request("minaMarket")).inside, false,
    "Mina's authored street staging point is already inside the building");
  const exteriorPosition = [...positionOf(state)];
  const points = [
    ["arcade opening", contract.entrance.arcadeGap],
    ["weather apron", contract.entrance.apron],
    ["market threshold", contract.entrance.threshold],
    ["market interior", contract.entrance.interior],
  ];
  const pathEvidence = [];
  for (const [label, target] of points) {
    const crossing = await walkToward(client, target, { label, maximumBursts: 72 });
    pathEvidence.push({ label, position: crossing.finalPosition });
  }
  state = await client.request("snapshot");
  const control = await client.request("minaMarket");
  assert.equal(control.inside, true, "walking through the visible doorway did not enter Mina's Market");
  assert.ok(pointInsideBounds(positionOf(state), contract.bounds), "market interior anchor is outside its bounds");
  assert.ok(distance2D(exteriorPosition, positionOf(state)) > 5,
    "street-to-interior traversal was too short to cross the arcade and doorway");
  assert.ok(Math.abs(Number(positionOf(state)[1]) - Number(contract.bounds.floorY)) < 0.35,
    "Kai did not stay on the continuous market floor");
  return { exteriorPosition, interiorPosition: [...positionOf(state)], pathEvidence };
}

async function inspectCounter(client, station, expected) {
  await client.request("teleport", { x: station.position[0], z: station.position[2] });
  const state = stateFrom(await client.request("advance", { steps: 2 }));
  const control = await client.request("minaMarket");
  assert.equal(control.inside, true, `${station.label} is outside the market`);
  assert.equal(control.nearestStation?.id, station.id, `${station.label} is not its nearest physical fixture`);
  assert.ok(distance2D(positionOf(state), station.position) <= 0.43,
    `${station.label} cannot be reached within Kai's collision radius`);
  assert.equal(station.action, expected.action);
  assert.equal(station.transactionKind, expected.transactionKind);
  return { state, control };
}

async function capturePhysicalMarket(client, contract) {
  await client.request("teleport", {
    x: contract.entrance.interior[0],
    z: contract.entrance.interior[2],
  });
  await client.request("face", {
    x: contract.zones.salesFloor.position[0],
    z: contract.zones.salesFloor.position[2],
  });
  stateFrom(await client.request("advance", { steps: 24 }));
  await mkdir(path.dirname(marketScreenshotPath), { recursive: true });
  const capture = await client.request("screenshot", {
    path: marketScreenshotPath,
    width: 1280,
    height: 720,
  });
  const capturePath = capture?.path ?? marketScreenshotPath;
  assert.ok((await stat(capturePath)).size > 25_000, "Mina's Market screenshot is unexpectedly small");
  return capturePath;
}

async function buyCarryAndUseGroceries(client, marketContract, homeContract) {
  const checkout = marketContract.stations.groceryCheckout;
  await inspectCounter(client, checkout, {
    action: "buy_groceries",
    transactionKind: "household_supplies",
  });
  await setPaused(client, true);
  const opened = await client.request("openBusiness", { businessId: MARKET_ID });
  assert.equal(opened.menuOpen, true, "the physical grocery checkout did not open Mina's menu");
  assert.equal(opened.businessId, MARKET_ID);
  assert.equal(opened.selectionIndex, 0);
  assert.equal(opened.menuItems.length, 5);
  assert.equal(opened.menuItems[4].id, GROCERY_ITEM_ID);
  assert.equal(opened.menuItems[4].kind, "household_supplies");
  assert.deepEqual(opened.menuItems[4].inventoryEffects, { groceries: GROCERY_UNITS });

  const selected = await client.request("shopSelect", { direction: 4 });
  assert.equal(selected.selectionIndex, 4);
  assert.equal(selected.selectedItem.id, GROCERY_ITEM_ID);
  const beforeState = await client.request("snapshot");
  const beforeResidential = await client.request("residential", { action: "snapshot" });
  assert.equal(beforeState.player.groceryCarry.units, 0,
    "market QA requires a fresh empty tote so the receipt is exact");
  const consumeBefore = {
    appetite: selected.appetite,
    consuming: selected.consuming,
    consumeItemId: selected.consumeItemId,
    consumeBusinessId: selected.consumeBusinessId,
    consumeElapsed: selected.consumeElapsed,
    consumeDuration: selected.consumeDuration,
  };
  const bought = await client.request("shopBuy");
  assert.equal(bought.transaction?.accepted, true, JSON.stringify(bought.transaction));
  assert.equal(bought.transaction.itemId, GROCERY_ITEM_ID);
  assert.equal(bought.transaction.kind, "household_supplies");
  assert.equal(bought.transaction.cost, GROCERY_COST);
  assert.deepEqual(bought.transaction.inventoryEffects, { groceries: GROCERY_UNITS });
  assert.equal(bought.player.cash, beforeState.player.cash - GROCERY_COST);
  assert.deepEqual({
    appetite: bought.neighbourhood.appetite,
    consuming: bought.neighbourhood.consuming,
    consumeItemId: bought.neighbourhood.consumeItemId,
    consumeBusinessId: bought.neighbourhood.consumeBusinessId,
    consumeElapsed: bought.neighbourhood.consumeElapsed,
    consumeDuration: bought.neighbourhood.consumeDuration,
  }, consumeBefore, "buying household stock changed appetite or started a fake meal");
  assert.equal(bought.player.groceryCarry.units, GROCERY_UNITS);
  assert.equal(bought.player.groceryCarry.visible, true);
  assert.equal(bought.player.groceryCarry.precreated, true);
  assert.equal(bought.player.groceryCarry.storage, "memory-only");
  assert.equal(bought.player.groceryCarry.geometryCount, 6);
  assert.equal(bought.player.groceryCarry.runtimeAllocations, 0);
  let state = await client.request("snapshot");
  assert.equal(state.residential.carriedSupplies.groceries, GROCERY_UNITS);
  await client.request("closeBusiness");

  const grocerySave = await client.request("save");
  assert.equal(grocerySave.version, 14);
  assert.equal(grocerySave.player.groceryCarry.units, GROCERY_UNITS);
  assert.equal(grocerySave.residential.player.carriedSupplies.groceries, GROCERY_UNITS);
  assert.ok(Array.isArray(grocerySave.residential.supplySources) || Array.isArray(grocerySave.residential.recordedSources),
    "save v14 omitted the household supply idempotency ledger");

  await client.request("teleport", {
    x: homeContract.stations.stove.position[0],
    z: homeContract.stations.stove.position[2],
  });
  const probe = await client.request("unpackGroceries", {
    sourceId: "native-market-qa:unpack-roundtrip",
  });
  assert.equal(probe.transaction?.accepted, true, JSON.stringify(probe.transaction));
  assert.ok(probe.transaction.groceriesAdded > 0);
  assert.ok(probe.residential.player.carriedSupplies.groceries < GROCERY_UNITS);

  const restored = await client.request("restore", { snapshot: grocerySave });
  assert.equal(restored.version, 14);
  state = await client.request("snapshot");
  assert.equal(state.player.groceryCarry.units, GROCERY_UNITS);
  assert.equal(state.player.groceryCarry.visible, true);
  assert.equal(state.residential.carriedSupplies.groceries, GROCERY_UNITS);
  const groceryRoundTrip = await client.request("save");
  assert.deepEqual(groceryRoundTrip.residential, grocerySave.residential,
    "save v14 did not restore carried groceries and their source ledger exactly");
  assert.equal(groceryRoundTrip.player.cash, grocerySave.player.cash);
  assert.equal(groceryRoundTrip.player.groceryCarry.units, GROCERY_UNITS);

  await client.request("teleport", {
    x: homeContract.stations.stove.position[0],
    z: homeContract.stations.stove.position[2],
  });
  const pantryBefore = currentHome(beforeResidential.residential);
  const expectedAdded = Math.min(GROCERY_UNITS, RESIDENTIAL_LIMITS.maxGroceries - pantryBefore.groceries);
  const unpacked = await client.request("unpackGroceries", {
    sourceId: "native-market-qa:unpack-roundtrip",
  });
  assert.equal(unpacked.transaction?.accepted, true, JSON.stringify(unpacked.transaction));
  assert.equal(unpacked.transaction.kind, "supplies_unpacked");
  assert.equal(unpacked.transaction.groceriesAdded, expectedAdded);
  assert.equal(unpacked.transaction.carriedGroceries, GROCERY_UNITS - expectedAdded);
  const unpackedHome = currentHome(unpacked.residential);
  assert.equal(unpackedHome.groceries, pantryBefore.groceries + expectedAdded);
  assert.equal(unpacked.player.groceryCarry.units, GROCERY_UNITS - expectedAdded);
  assert.equal(unpacked.player.groceryCarry.visible, GROCERY_UNITS - expectedAdded > 0);

  const beforeCook = await client.request("residential", { action: "snapshot" });
  const cookHomeBefore = currentHome(beforeCook.residential);
  const cookHospitalityBefore = skillExperience(beforeCook.lifeProfile, "hospitality");
  const cookAppetiteBefore = (await client.request("snapshot")).neighbourhood.appetite;
  const cooked = await client.request("residential", { action: "perform", activityId: "cook", force: true });
  assert.equal(cooked.result?.accepted, true, JSON.stringify(cooked.result));
  assert.equal(cooked.result.actionId, "cook");
  const cookHomeAfter = currentHome(cooked.residential);
  assert.equal(cookHomeAfter.groceries, cookHomeBefore.groceries - 1);
  assert.equal(cookHomeAfter.preparedMeals,
    Math.min(RESIDENTIAL_LIMITS.maxPreparedMeals, cookHomeBefore.preparedMeals + 2));
  const cookAward = cooked.result.effects.skills.find(value => value.skillId === "hospitality")?.experience ?? 0;
  assert.equal(skillExperience(cooked.lifeProfile, "hospitality"), cookHospitalityBefore + cookAward,
    "cooking experience was not applied exactly once");
  assert.equal((await client.request("snapshot")).neighbourhood.appetite,
    Math.min(100, cookAppetiteBefore + cooked.result.effects.appetite));

  const eatHomeBefore = currentHome(cooked.residential);
  const eatHospitalityBefore = skillExperience(cooked.lifeProfile, "hospitality");
  const eatAppetiteBefore = (await client.request("snapshot")).neighbourhood.appetite;
  const eaten = await client.request("residential", { action: "perform", activityId: "eat", force: true });
  assert.equal(eaten.result?.accepted, true, JSON.stringify(eaten.result));
  assert.equal(eaten.result.actionId, "eat");
  assert.equal(currentHome(eaten.residential).preparedMeals, eatHomeBefore.preparedMeals - 1);
  const eatAward = eaten.result.effects.skills.find(value => value.skillId === "hospitality")?.experience ?? 0;
  assert.equal(skillExperience(eaten.lifeProfile, "hospitality"), eatHospitalityBefore + eatAward,
    "eating experience was not applied exactly once");
  assert.equal((await client.request("snapshot")).neighbourhood.appetite,
    Math.min(100, eatAppetiteBefore + eaten.result.effects.appetite),
  "the home meal did not feed the authoritative neighbourhood appetite exactly once");
  return { bought, grocerySave, unpacked, cooked, eaten };
}

async function stageAtMarketStation(client, contract, stationId) {
  const logical = MINA_MARKET_STATIONS.find(value => value.id === stationId);
  assert.ok(logical, `logical market station ${stationId} is missing`);
  const acceptedIds = [logical.worldStationId ?? logical.id, ...(logical.alternateWorldStationIds ?? [])];
  const entry = Object.entries(contract.stations).find(([, station]) => acceptedIds.includes(station.id));
  assert.ok(entry, `${stationId} has no physical station in Mina's building`);
  const [stationKey, station] = entry;
  await client.request("teleport", { x: station.position[0], z: station.position[2] });
  const state = stateFrom(await client.request("advance", { steps: 2 }));
  const control = await client.request("minaMarket");
  assert.equal(control.inside, true, `${stationId} is outside the market`);
  assert.equal(control.nearestStation?.id, station.id,
    `${stationId} did not stage at its real ${station.id} fixture`);
  assert.ok(distance2D(positionOf(state), station.position) <= 0.43,
    `${stationId} is not reachable within Kai's collision radius`);
  return { logical, station, stationKey, state };
}

async function completePhysicalMarketShift(client, contract) {
  await stageAtMarketStation(client, contract, "mina-order-counter");
  const before = marketBundle(await client.request("marketShift", { action: "snapshot" }));
  const beforeCash = Number(before.player.cash);
  const beforeTrust = Number(before.communityTrust);
  const beforeShiftSerial = Number(before.lifeProfile.shiftSerial);
  const beforeExperience = Object.fromEntries(["hospitality", "community", "fitness"]
    .map(skillId => [skillId, skillExperience(before.lifeProfile, skillId)]));
  const began = marketBundle(await client.request("marketShift", { action: "begin" }));
  assert.equal(began.result?.id, "mina_market_shift");
  assert.equal(began.marketShift.activeShift?.status, "active");
  assert.equal(began.marketShift.activeShift?.nextStationId, "mina-order-counter");

  const stationResults = [];
  let donation = null;
  for (let index = 0; index < MINA_MARKET_STATIONS.length; ++index) {
    const definition = MINA_MARKET_STATIONS[index];
    const staged = await stageAtMarketStation(client, contract, definition.id);
    const started = marketBundle(await client.request("marketShift", {
      action: "perform",
      quality: 100,
      safetyConfirmed: true,
    }));
    assert.equal(started.result?.accepted, true, JSON.stringify(started.result));
    assert.equal(started.result.stationId, definition.id);
    assert.equal(started.result.physicalStationId, staged.station.id);
    assert.ok(started.result.durationSeconds > 0);
    const finished = marketBundle(await client.request("marketShift", {
      action: "advance",
      seconds: started.result.durationSeconds + 0.25,
    }));
    const stationResult = finished.marketShift.lastStationResult;
    assert.equal(stationResult.stationId, definition.id);
    assert.equal(stationResult.physicalStationId, staged.station.id);
    assert.equal(stationResult.passed, true);
    assert.equal(stationResult.outcome, "passed");
    assert.equal(stationResult.serial, index + 1);
    stationResults.push(stationResult);

    if (index === 3) {
      assert.equal(finished.marketShift.activeShift?.surplusDecisionRequired, true);
      await stageAtMarketStation(client, contract, "mina-pantry-shelf");
      const decision = marketBundle(await client.request("marketShift", {
        action: "chooseSurplus",
        decisionId: "donate",
      }));
      assert.equal(decision.result?.accepted, true, JSON.stringify(decision.result));
      assert.equal(decision.result.result?.decisionId, "donate");
      assert.equal(decision.result.result?.communityTrust, 4);
      assert.equal(decision.result.result?.edibleUnitsSaved, 6);
      assert.equal(decision.result.result?.discardedUnits, 0);
      assert.match(decision.result.result?.tradeoff, /feeds|cold-chain|extra/i);
      assert.equal(decision.marketShift.activeShift?.surplusDecisionId, "donate");
      donation = decision.result.result;
    }
  }
  assert.ok(donation, "the physical market shift never recorded its surplus decision");

  const completed = marketBundle(await client.request("marketShift", { action: "snapshot" }));
  const transaction = completed.marketShift.lastTransaction;
  assert.ok(transaction, "the seven-station market shift produced no wage transaction");
  assert.equal(transaction.kind, "lawful_market_shift_wage");
  assert.equal(transaction.callerOwned, true);
  assert.equal(transaction.callerMustApplyOnce, true);
  assert.equal(transaction.surplusDecision.decisionId, "donate");
  assert.equal(transaction.communityTrust, donation.communityTrust);
  assert.equal(transaction.stockEffects.edibleUnitsSaved, donation.edibleUnitsSaved);
  assert.equal(transaction.stockEffects.discardedUnits, 0);
  assert.deepEqual(transaction.externalLedgerEffects,
    { customerPurchases: 0, tillCents: 0, householdGroceries: 0 });
  assert.equal(completed.player.cash, beforeCash + transaction.cashEffect,
    "market wage was not applied exactly once to player cash");
  assert.equal(completed.communityTrust, beforeTrust + transaction.communityTrust,
    "donation trust was not applied exactly once");
  assert.equal(completed.lifeProfile.shiftSerial, beforeShiftSerial + 1,
    "market work did not record exactly one completed life-profile shift");
  for (const effect of transaction.skillEffects) {
    assert.equal(skillExperience(completed.lifeProfile, effect.skillId),
      beforeExperience[effect.skillId] + effect.experience,
    `${effect.skillId} market experience was not applied exactly once`);
  }

  for (let index = 0; index < 4; ++index) await client.request("render");
  const stable = marketBundle(await client.request("marketShift", { action: "snapshot" }));
  assert.equal(stable.player.cash, completed.player.cash, "rendering replayed the market wage");
  assert.equal(stable.communityTrust, completed.communityTrust, "rendering replayed donation trust");
  assert.equal(stable.lifeProfile.shiftSerial, completed.lifeProfile.shiftSerial,
    "rendering replayed the market shift record");
  for (const effect of transaction.skillEffects) {
    assert.equal(skillExperience(stable.lifeProfile, effect.skillId),
      skillExperience(completed.lifeProfile, effect.skillId),
    `rendering replayed ${effect.skillId} market experience`);
  }

  // The direct station control advances the authoritative game clock without
  // running a presented fixed tick. Re-submit that same clock once so the
  // market, named staff, and occupancy save sections all share one instant.
  const synchronizedClock = await client.request("snapshot");
  await client.request("setTime", {
    dayIndex: synchronizedClock.neighbourhood.dayIndex,
    hours: synchronizedClock.environment.timeHours,
  });
  const shiftSave = await client.request("save");
  assert.equal(shiftSave.version, 14);
  assert.equal(shiftSave.activities.market.serials.transaction, transaction.serial);
  assert.equal(shiftSave.activities.marketRuntime.appliedTransactionSerial, transaction.serial);
  assert.equal(shiftSave.activities.marketRuntime.appliedStationResultSerial, stationResults.length);
  assert.equal(shiftSave.activities.market.lastTransaction.idempotencySourceId, transaction.idempotencySourceId);
  assert.ok(shiftSave.interiorOccupancy?.occupants, "save v14 omitted active interior visitors");

  const reset = marketBundle(await client.request("marketShift", { action: "reset" }));
  assert.equal(reset.marketShift.serials.transaction, 0);
  const restored = await client.request("restore", { snapshot: shiftSave });
  assert.equal(restored.version, 14);
  const roundTrip = await client.request("save");
  assert.deepEqual(roundTrip.activities.market, shiftSave.activities.market,
    "save v14 did not restore Mina's shift, station, surplus, and transaction ledgers exactly");
  assert.deepEqual(roundTrip.activities.marketRuntime, shiftSave.activities.marketRuntime,
    "save v14 did not restore market exactly-once cursors and named staff runtime exactly");
  assert.deepEqual(roundTrip.lifeProfile, shiftSave.lifeProfile,
    "save v14 did not restore market wages and skill history exactly");
  assert.equal(roundTrip.player.cash, shiftSave.player.cash);
  assert.equal(roundTrip.communityTrust, shiftSave.communityTrust);
  assert.deepEqual(roundTrip.interiorOccupancy, shiftSave.interiorOccupancy,
    "save v14 did not restore interior visitor poses and reservations exactly");

  for (let index = 0; index < 3; ++index) await client.request("render");
  const afterRestore = marketBundle(await client.request("marketShift", { action: "snapshot" }));
  assert.equal(afterRestore.player.cash, completed.player.cash, "restore replayed the market wage");
  assert.equal(afterRestore.communityTrust, completed.communityTrust, "restore replayed donation trust");
  assert.equal(afterRestore.marketShift.availability?.reason ??
    (await client.request("marketShift", { action: "availability" })).result?.reason,
  "already_completed_today", "the completed daily shift became payable again after restore");
  return { stationResults, donation, transaction, shiftSave, roundTrip };
}

function verifyFrameTiming(timing) {
  if (timing.stallFrames > 0 || timing.maximumMs >= 50 || timing.phases.maximumMs.worldStage >= 25) {
    console.error(JSON.stringify({ label: "Mina's occupied market", timing }, null, 2));
  }
  assert.ok(timing.samples >= 20, `market timing collected only ${timing.samples} real presentation frames`);
  assert.ok(timing.p95Ms < 50, `market p95 frame time was ${timing.p95Ms.toFixed(1)}ms`);
  assert.equal(timing.stallFrames, 0,
    `the occupied market contained ${timing.stallFrames} >50ms frame(s)`);
  assert.ok(timing.maximumMs < 50,
    `the occupied market contained a ${timing.maximumMs.toFixed(1)}ms hitch`);
  assert.ok(timing.phases.maximumMs.worldStage < 25,
    `the occupied market spent ${timing.phases.maximumMs.worldStage.toFixed(1)}ms in one world submission`);
}

async function main() {
  const client = await connectWithRetry(pipePath);
  let originalSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true, "native runtime was not ready for Mina's Market QA");
    assert.equal(state.diagnostics?.backend, "NATIVE WEBGPU");
    const warmup = state.diagnostics.simulationWarmup;
    assert.equal(warmup?.ready, true);
    assert.equal(warmup.storage, "memory-only");
    assert.ok(warmup.branches.includes(
      "minas-market-cold-chain-produce-stock-packing-till-wash-up-and-surplus-ledger"));
    assert.ok(warmup.branches.includes(
      "ambient-civilians-enter-dwell-in-and-leave-four-walk-in-buildings"));
    assert.equal(warmup.marketShiftPrepared?.ready, true);
    assert.equal(warmup.marketShiftPrepared?.storage, "memory-only");
    assert.equal(warmup.marketShiftPrepared?.diskResources, 0);
    assert.equal(warmup.marketShiftPrepared?.runtimeAssetsCreated, 0);
    assert.equal(warmup.marketShiftPrepared?.stationsPrepared, MINA_MARKET_STATIONS.length);
    assert.equal(warmup.marketShiftPrepared?.surplusBranchesPrepared, MARKET_SURPLUS_DECISIONS.length);
    assert.equal(warmup.marketShiftPrepared?.liveStatePreserved, true);
    assert.equal(warmup.interiorOccupancyPrepared?.ready, true);
    assert.equal(warmup.interiorOccupancyPrepared?.storage, "memory-only");
    assert.equal(warmup.interiorOccupancyPrepared?.diskResources, 0);
    assert.equal(warmup.interiorOccupancyPrepared?.runtimeActorAllocations, 0);
    assert.equal(warmup.interiorOccupancyPrepared?.routeSearches, 0);
    assert.equal(warmup.interiorOccupancyPrepared?.liveStateMutations, 0);
    assert.equal(warmup.interiorOccupancyPrepared?.buildingsPrepared, 4);
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, 0);

    const contract = state.world?.minaMarketKitchen;
    assert.ok(contract, "world snapshot has no physical Mina's Market contract");
    assert.equal(contract.id, MARKET_ID);
    assert.equal(contract.buildingId, MARKET_BUILDING_ID);
    assert.equal(contract.hostBuildingRecordId, MARKET_HOST_BUILDING_ID);
    assert.equal(contract.address, MARKET_ADDRESS);
    assert.equal(contract.stats.rooms, 8);
    assert.equal(contract.stats.doorways, 7);
    assert.equal(contract.stats.stations, 8);
    assert.ok(contract.stats.renderInstances >= 120);
    assert.ok(contract.stats.collisionVolumes >= 30);
    assert.equal(contract.stats.practicalLights, 3);
    assert.equal(contract.stats.emissiveMaterials, 0);
    assert.equal(contract.occupancySlots.length, contract.stats.occupancySlots);
    assert.ok(contract.itineraries.length >= 4);

    const marketControl = await client.request("minaMarket");
    assert.equal(marketControl.worldContract.id, contract.id);
    assert.deepEqual(marketControl.worldContract.entrance, contract.entrance);
    assert.deepEqual(marketControl.worldContract.renderBudget, {
      geometriesAdded: 0,
      materialsAdded: 0,
      instancedBatchesAdded: 0,
      lightsAdded: 2,
    });
    assert.equal(marketControl.worldContract.glass.emissive, false);
    assert.equal(marketControl.worldContract.glass.neon, false);
    assert.equal(marketControl.worldContract.lighting.kind, "focus-bounded-warm-market-practicals");

    originalSave = await client.request("save");
    assert.equal(originalSave.version, 14);
    state = await clearBlockingNarrative(client);
    const cleanSave = await client.request("save");
    const schedules = await verifyStaffSchedules(client);
    await client.request("restore", { snapshot: cleanSave });
    state = await clearBlockingNarrative(client);
    await client.request("setTime", { dayIndex: 1, hours: 10 });
    await client.request("setWeather", { rain: 0.12, immediate: true });
    state = await client.request("snapshot");

    const occupancy = await verifyInteriorOccupancy(client, state);
    const entrance = await enterPhysicalMarket(client, contract);
    const orderCounter = await inspectCounter(client, contract.stations.orderCounter, {
      action: "open_menu",
      transactionKind: "prepared_food",
    });
    const orderMenu = await client.request("openBusiness", { businessId: MARKET_ID });
    assert.equal(orderMenu.menuOpen, true, "the deli order counter did not open Mina's prepared-food menu");
    assert.equal(orderMenu.businessId, MARKET_ID);
    assert.ok(orderMenu.menuItems.slice(0, 4).every(item => item.kind !== "household_supplies"),
      "prepared-food rows were replaced by the grocery receipt");
    await client.request("closeBusiness");
    assert.ok(distance2D(contract.stations.orderCounter.position, contract.stations.groceryCheckout.position) > 1,
      "the deli order counter and grocery checkout occupy the same fixture");
    const capturePath = await capturePhysicalMarket(client, contract);

    const groceries = await buyCarryAndUseGroceries(client, contract, state.world.residentialInterior);
    const marketShift = await completePhysicalMarketShift(client, contract);
    await setPaused(client, false);
    await client.request("teleport", {
      x: contract.entrance.interior[0],
      z: contract.entrance.interior[2],
    });
    await client.request("face", {
      x: contract.zones.salesFloor.position[0],
      z: contract.zones.salesFloor.position[2],
    });
    await client.request("render");
    await client.request("resetFrameTiming");
    await wait(1_300);
    state = await client.request("snapshot");
    const timing = state.diagnostics.frameTiming;
    verifyFrameTiming(timing);
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, 0,
      "market life QA caused a runtime pedestrian hierarchy allocation");
    assert.equal(state.player.groceryCarry.runtimeAllocations, 0,
      "the grocery tote allocated renderer assets during play");
    assertUniqueReservations(state.interiorOccupancy, "final occupied market frame");

    console.log(JSON.stringify({
      ready: state.ready,
      market: {
        id: contract.id,
        address: contract.address,
        buildingId: contract.buildingId,
        entrance,
        orderCounter: orderCounter.control.nearestStation.id,
        groceryCounter: contract.stations.groceryCheckout.id,
        screenshot: capturePath,
      },
      groceries: {
        itemId: groceries.bought.transaction.itemId,
        cost: groceries.bought.transaction.cost,
        carried: groceries.bought.player.groceryCarry.units,
        unpacked: groceries.unpacked.transaction.groceriesAdded,
        cooked: groceries.cooked.result.actionId,
        eaten: groceries.eaten.result.actionId,
      },
      schedules: {
        minaHome: schedules.minaFloor.home,
        emiHome: schedules.emiHome.home,
        emiCommuteMovement: schedules.movement,
      },
      shift: {
        stations: marketShift.stationResults.map(result => result.stationId),
        decision: marketShift.donation.decisionId,
        wage: marketShift.transaction.cashEffect,
        trust: marketShift.transaction.communityTrust,
        skills: marketShift.transaction.skillEffects,
        transactionId: marketShift.transaction.transactionId,
      },
      occupancy: {
        occupants: occupancy.occupancy.occupants.length,
        reservations: occupancy.occupancy.reservations.length,
        maximumTwoSecondMovement: occupancy.maximumMovement,
      },
      frameTiming: timing,
      saveVersion: marketShift.roundTrip.version,
    }, null, 2));
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "KeyS", down: false }).catch(() => {});
    await client.request("key", { code: "KeyE", down: false }).catch(() => {});
    if (originalSave) await client.request("restore", { snapshot: originalSave }).catch(() => {});
    await setPaused(client, false).catch(() => {});
    client.close();
  }
}

await main();
