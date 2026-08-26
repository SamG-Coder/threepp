import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const interiorScreenshotPath = process.argv[3] ?? null;
if (!pipePath) {
  throw new TypeError("Usage: node tests/native-residential-life-qa.mjs <pipe> [interior.png]");
}

const FIXED_STEP = 1 / 60;
const HOME_ID = "southline_studio_3b";
const BUILDING_ID = "southline_court";
const HOME_ADDRESS = "18 Calder Street, Apt 3B";
const RESIDENT_ID = "luis_moreno";

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
      else pending.reject(new Error(response.error || "native residential control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeoutMs = op === "screenshot" || op === "advance" ? 60_000 : 30_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native residential request timed out: ${op}`));
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
  throw lastError ?? new Error("native residential pipe did not become ready");
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

function wrappedHoursAfter(hours, gameMinutes) {
  return ((Number(hours) + Number(gameMinutes) / 60) % 24 + 24) % 24;
}

function currentHome(residential) {
  const homes = residential?.homes ?? [];
  return homes.find(home => home.playerResidence) ??
    homes.find(home => home.id === residential?.player?.currentHomeId) ?? null;
}

function fixtureById(residential, fixtureId) {
  return currentHome(residential)?.fixtures?.find(fixture => fixture.id === fixtureId) ?? null;
}

function skillExperience(profile, skillId) {
  const value = profile?.skillById?.[skillId] ?? profile?.skills?.find(skill => skill.id === skillId);
  assert.ok(value, `life profile has no ${skillId} skill`);
  return Number(value.experience);
}

function firstChoiceId(state) {
  return state?.choice?.options?.[0]?.id ?? null;
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
        "an authored narrative retained player controls during residential QA");
      break;
    }
    state = await client.request("snapshot");
    if (guard === 127) throw new Error("blocking narrative did not settle within 128 authored transitions");
  }
  if (state.neighbourhood?.menuOpen) {
    await client.request("closeBusiness");
    state = await client.request("snapshot");
  }
  if (state.activity?.status === "active") {
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
  assert.equal(state.phone?.open, false, "residential QA could not close the pre-existing phone view");
  return state;
}

async function tapKey(client, code) {
  await client.request("key", { code, down: true });
  const pressed = stateFrom(await client.request("advance", { steps: 1 }));
  await client.request("key", { code, down: false });
  const released = stateFrom(await client.request("advance", { steps: 1 }));
  return { pressed, released };
}

async function walkToward(client, target, {
  label = "target",
  stopDistance = 0.62,
  burstSteps = 6,
  maximumBursts = 96,
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
    `${label} remained ${finalDistance.toFixed(2)} m away after real player movement`);
  assert.ok(distance2D(start, finalPosition) > 0.2, `${label} traversal did not move the player`);
  return { state, start, finalPosition, finalDistance };
}

async function openHomePhoneApp(client) {
  await client.request("action", { action: "phone" });
  let state = stateFrom(await client.request("advance", { steps: 2 }));
  assert.equal(state.phone.open, true);
  assert.equal(state.phone.app, null);
  assert.equal(state.phone.items.length, 7);
  assert.equal(state.phone.items[5]?.title, "MY HOME");
  state = stateFrom(await client.request("advance", { steps: 30 }));
  assert.equal(state.phone.openProgress, 1, "phone shell did not finish its retained opening animation");
  state = await client.request("render");

  for (let index = 0; index < 5; ++index) {
    state = (await tapKey(client, "KeyS")).released;
  }
  assert.equal(state.phone.selection, 5, "five real KeyS edges did not select the sixth launcher app");
  const launcherRedraws = state.diagnostics.phoneCanvasRedraws;

  state = (await tapKey(client, "KeyE")).released;
  assert.equal(state.phone.app, "home", "the sixth launcher tile did not open My Home");
  assert.equal(state.phone.title, "MY HOME");
  assert.ok(state.phone.appProgress > 0 && state.phone.appProgress < 1,
    `the first My Home frame skipped its bottom-up transition (${state.phone.appProgress})`);
  assert.ok(state.diagnostics.phoneCanvasRedraws <= launcherRedraws + 1,
    "opening My Home rerasterized more than its one cached app surface");
  const firstProgress = state.phone.appProgress;
  state = await client.request("render");
  const transitionRedraws = state.diagnostics.phoneCanvasRedraws;

  state = stateFrom(await client.request("advance", { steps: 4 }));
  assert.ok(state.phone.appProgress > firstProgress && state.phone.appProgress < 1,
    "My Home did not animate smoothly from bottom to top");
  assert.equal(state.diagnostics.phoneCanvasRedraws, transitionRedraws,
    "animation frames must transform the cached app surface without rerasterizing it");
  state = stateFrom(await client.request("advance", { steps: 30 }));
  assert.equal(state.phone.appProgress, 1);
  state = await client.request("render");

  const settledRedraws = state.diagnostics.phoneCanvasRedraws;
  const frozenWorldHour = state.environment.timeHours;
  state = stateFrom(await client.request("advance", { steps: 600 }));
  state = await client.request("render");
  assert.equal(state.environment.timeHours, frozenWorldHour,
    "the phone must soft-pause the authoritative world clock");
  assert.equal(state.diagnostics.phoneCanvasRedraws, settledRedraws,
    "status-clock ticks must not redraw the cached phone app canvas");
  return { state, launcherRedraws, settledRedraws };
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

async function verifyResidentScheduleTravel(client) {
  await client.request("setTime", { hours: 7.49 });
  const before = await client.request("residentSchedule", { residentId: RESIDENT_ID });
  assert.equal(before.activity, "home");
  assert.equal(before.locationId, "luis_home_2a");
  assert.ok(Array.isArray(before.actorPosition));
  assert.ok(Array.isArray(before.routineDestination));

  await client.request("setTime", { hours: 7.51 });
  const boundary = await client.request("residentSchedule", { residentId: RESIDENT_ID });
  assert.equal(boundary.activity, "work");
  assert.equal(boundary.locationId, "pulse_garage");
  assert.ok(Array.isArray(boundary.routineDestination));
  assert.ok(distance2D(before.routineDestination, boundary.routineDestination) > 25,
    "the work boundary did not assign a materially different authored destination");
  assert.ok(distance2D(before.actorPosition, boundary.actorPosition) < 0.08,
    "changing a resident schedule teleported the actor on the boundary frame");
  assert.equal(boundary.routineArrived, false);

  stateFrom(await client.request("advance", { steps: 60 }));
  const moving = await client.request("residentSchedule", { residentId: RESIDENT_ID });
  const movement = distance2D(boundary.actorPosition, moving.actorPosition);
  const initialRemaining = distance2D(boundary.actorPosition, boundary.routineDestination);
  const remaining = distance2D(moving.actorPosition, moving.routineDestination);
  assert.ok(movement > 0.08, `scheduled resident moved only ${movement.toFixed(3)} m in one second`);
  assert.ok(movement < 5.0,
    `scheduled resident moved ${movement.toFixed(2)} m in one second, indicating a teleport`);
  assert.ok(remaining > 1.0 && movement < initialRemaining - 1,
    "scheduled resident reached a cross-city workplace instantaneously");
  assert.equal(moving.routineArrived, false);
  return { before, boundary, moving, movement, initialRemaining, remaining };
}

async function main() {
  const client = await connectWithRetry(pipePath);
  let originalSave = null;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true, "native runtime was not ready for residential QA");
    assert.equal(state.diagnostics?.backend, "NATIVE WEBGPU");
    assert.equal(state.diagnostics?.simulationWarmup?.residentialPrepared?.ready, true,
      "residential branches were not preloaded into memory at startup");
    assert.equal(state.diagnostics.simulationWarmup.residentialPrepared.storage, "memory-only");
    assert.equal(state.diagnostics.simulationWarmup.residentialPrepared.diskResources, 0);
    assert.equal(state.diagnostics.simulationWarmup.residentialPrepared.liveStatePreserved, true);
    assert.ok(state.diagnostics.simulationWarmup.branches.includes(
      "physical-home-tenancy-rent-fixtures-meals-visitors-and-resident-schedules"));

    const contract = state.world?.residentialInterior;
    assert.ok(contract, "world snapshot has no physical residential contract");
    assert.equal(contract.id, HOME_ID);
    assert.equal(contract.homeId, HOME_ID);
    assert.equal(contract.buildingId, BUILDING_ID);
    assert.equal(contract.address, HOME_ADDRESS);
    assert.equal(state.residential.currentHomeId, contract.homeId,
      "logical tenancy and the physical apartment identify different homes");
    assert.equal(contract.stats.rooms, 5);
    assert.equal(contract.stats.stations, 10);
    assert.ok(contract.stats.collisionVolumes >= 20);
    assert.ok(Array.isArray(contract.entrance?.exterior) && Array.isArray(contract.entrance?.interior));

    const homeControl = await client.request("home");
    assert.equal(homeControl.homeId, HOME_ID);
    assert.equal(homeControl.worldContract.id, contract.id);
    assert.deepEqual(homeControl.worldContract.entrance, contract.entrance);
    originalSave = await client.request("save");
    assert.equal(originalSave.version, 14);

    state = await clearBlockingNarrative(client);
    await client.request("teleport", {
      x: contract.entrance.exterior[0],
      z: contract.entrance.exterior[2],
    });
    await client.request("face", {
      x: contract.entrance.interior[0],
      z: contract.entrance.interior[2],
    });
    state = await client.request("snapshot");
    assert.equal(state.residential.inside, false,
      "the authored exterior staging point is already classified as inside");
    const exteriorPosition = [...positionOf(state)];
    const crossed = await walkToward(client, contract.entrance.interior, {
      label: "apartment interior threshold",
      stopDistance: 0.55,
      burstSteps: 5,
      maximumBursts: 72,
    });
    state = crossed.state;
    const enteredHome = await client.request("home");
    assert.equal(enteredHome.inside, true,
      "walking through the visible doorway did not enter the physical home");
    assert.equal(state.residential.inside, true);
    assert.ok(distance2D(exteriorPosition, positionOf(state)) > 1.5,
      "the exterior-to-interior traversal was too short to cross the doorway");
    assert.ok(positionOf(state)[0] >= contract.bounds.minX && positionOf(state)[0] <= contract.bounds.maxX);
    assert.ok(positionOf(state)[2] >= contract.bounds.minZ && positionOf(state)[2] <= contract.bounds.maxZ);

    const sofa = contract.stations.sofa;
    const sofaApproach = [sofa.position[0], sofa.position[1], sofa.position[2] - 3.15];
    await walkToward(client, sofaApproach, {
      label: "living-room circulation waypoint",
      stopDistance: 0.72,
      maximumBursts: 96,
    });
    await walkToward(client, sofa.position, {
      label: "sofa interaction station",
      stopDistance: 0.72,
      maximumBursts: 72,
    });
    const stagedAtFixture = await client.request("home");
    assert.equal(stagedAtFixture.inside, true);
    assert.equal(stagedAtFixture.nearestStation?.action, "relax",
      `expected the sofa fixture, got ${stagedAtFixture.nearestStation?.action ?? "none"}`);

    await client.request("face", {
      x: contract.zones.living.position[0],
      z: contract.zones.living.position[2],
    });
    state = stateFrom(await client.request("advance", { steps: 24 }));
    if (interiorScreenshotPath) {
      await mkdir(path.dirname(path.resolve(interiorScreenshotPath)), { recursive: true });
      const capture = await client.request("screenshot", {
        path: path.resolve(interiorScreenshotPath),
        width: 1280,
        height: 720,
      });
      const capturePath = capture?.path ?? path.resolve(interiorScreenshotPath);
      assert.ok((await stat(capturePath)).size > 25_000, "residential interior screenshot is unexpectedly small");
    }

    const beforeTransaction = await client.request("residential", { action: "snapshot" });
    const beforeSerial = beforeTransaction.residential.transactionSerial;
    const beforeCommunityXp = skillExperience(beforeTransaction.lifeProfile, "community");
    const beforeEnergy = Number(beforeTransaction.lifeProfile.needs.energy);
    const beforeCash = Number(beforeTransaction.player.cash);
    const beforeHour = Number(beforeTransaction.environment.timeHours);
    const transaction = await client.request("residential", {
      action: "perform",
      activityId: "relax",
    });
    assert.equal(transaction.result?.accepted, true, JSON.stringify(transaction.result));
    assert.equal(transaction.result.actionId, "relax");
    assert.equal(transaction.result.fixtureId, fixtureById(transaction.residential,
      transaction.result.fixtureId)?.id);
    assert.equal(transaction.residential.transactionSerial, beforeSerial + 1);
    assert.equal(transaction.result.serial, transaction.residential.transactionSerial);
    assert.equal(transaction.player.cash, beforeCash - transaction.result.cost);
    assert.ok(Math.abs(transaction.lifeProfile.needs.energy -
      Math.min(100, beforeEnergy + transaction.result.effects.energy)) < 1e-6,
      "home energy effect was not applied exactly once within the need cap");
    for (const award of transaction.result.effects.skills) {
      const beforeXp = award.skillId === "community"
        ? beforeCommunityXp
        : skillExperience(beforeTransaction.lifeProfile, award.skillId);
      assert.equal(skillExperience(transaction.lifeProfile, award.skillId), beforeXp + award.experience,
        `${award.skillId} home-activity experience was not applied exactly once`);
    }
    assert.equal(transaction.environment.timeHours,
      wrappedHoursAfter(beforeHour, transaction.result.gameMinutes));
    const fixtureBefore = fixtureById(beforeTransaction.residential, transaction.result.fixtureId);
    const fixtureAfter = fixtureById(transaction.residential, transaction.result.fixtureId);
    assert.ok(fixtureBefore && fixtureAfter);
    assert.equal(fixtureAfter.useCount, fixtureBefore.useCount + 1,
      "one home interaction did not produce exactly one fixture use");

    for (let index = 0; index < 4; ++index) await client.request("render");
    const stableTransaction = await client.request("residential", { action: "snapshot" });
    assert.equal(stableTransaction.residential.transactionSerial, transaction.residential.transactionSerial,
      "rendering replayed the residential transaction");
    assert.equal(fixtureById(stableTransaction.residential, transaction.result.fixtureId)?.useCount,
      fixtureAfter.useCount, "rendering replayed fixture wear");
    for (const award of transaction.result.effects.skills) {
      assert.equal(skillExperience(stableTransaction.lifeProfile, award.skillId),
        skillExperience(transaction.lifeProfile, award.skillId),
      "rendering replayed home-activity skill experience");
    }

    const transactionSave = await client.request("save");
    assert.equal(transactionSave.version, 14);
    assert.equal(transactionSave.residential.transactionSerial, transaction.result.serial);
    assert.equal(transactionSave.residentialApplied.transactionSerial, transaction.result.serial);

    const phone = await openHomePhoneApp(client);
    assert.equal(phone.state.phone.items.some(item => item.detail === HOME_ADDRESS), true,
      "My Home did not present the current tenancy");
    const pantryPhoneRow = phone.state.phone.items.find(item => item.title?.startsWith("PANTRY"));
    assert.ok(pantryPhoneRow, "My Home did not expose the physical pantry and carried-tote state");
    assert.match(pantryPhoneRow.detail, /MINA'S MARKET|UNPACK INSIDE YOUR HOME/);
    assert.doesNotMatch(pantryPhoneRow.detail, /RESTOCK \$18/,
      "the phone must not create groceries remotely");
    await closePhone(client);

    const schedule = await verifyResidentScheduleTravel(client);

    const restored = await client.request("restore", { snapshot: transactionSave });
    assert.equal(restored.version, 14);
    assert.equal(restored.residentialApplied.transactionSerial, transaction.result.serial);
    const roundTrip = await client.request("save");
    assert.equal(roundTrip.version, 14);
    assert.deepEqual(roundTrip.residential, transactionSave.residential,
      "save v12 did not restore residential tenancy, pantry, fixtures, carried stock, and schedules exactly");
    assert.deepEqual(roundTrip.residentialApplied, transactionSave.residentialApplied,
      "save v12 lost exactly-once residential transaction cursors");
    assert.equal(roundTrip.player.cash, transactionSave.player.cash);

    state = await client.request("snapshot");
    console.log(JSON.stringify({
      ready: state.ready,
      home: {
        id: contract.id,
        buildingId: contract.buildingId,
        address: contract.address,
        exteriorPosition,
        interiorPosition: crossed.finalPosition,
        fixture: transaction.result.fixtureId,
        transactionSerial: transaction.result.serial,
      },
      phone: {
        app: phone.state.phone.app,
        launcherRedraws: phone.launcherRedraws,
        settledRedraws: phone.settledRedraws,
      },
      residentSchedule: {
        residentId: RESIDENT_ID,
        from: schedule.before.locationId,
        to: schedule.boundary.locationId,
        movement: schedule.movement,
        remaining: schedule.remaining,
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
