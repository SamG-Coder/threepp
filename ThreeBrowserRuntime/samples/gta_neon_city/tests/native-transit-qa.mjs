import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3];
if (!pipePath || !outputDirectory) {
  throw new TypeError("Usage: node tests/native-transit-qa.mjs <pipe> <output-directory>");
}

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = new Map();
    this.serial = 0;
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
      else pending.reject(new Error(response.error || "native transit request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native transit request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function connect(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const socket = await new Promise((resolve, reject) => {
        const candidate = net.createConnection(pipePath);
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }
  throw lastError ?? new Error("native transit pipe did not become ready");
}

async function capture(client, filename) {
  const destination = path.resolve(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 30_000, `${filename} is unexpectedly small`);
  return result.path;
}

async function settle(client, steps = 3) {
  await client.request("advance", { steps });
  return client.request("snapshot");
}

async function clearPresentation(client) {
  let state = await client.request("snapshot");
  if (state.activity?.status === "active") await client.request("cancelActivity");
  if (state.player.inVehicle) await client.request("exitVehicle");
  for (let guard = 0; guard < 20 && state.narrative?.controlsLocked; ++guard) {
    if (state.chapterTwo?.chapterStarted) {
      if (state.chapterTwo.choice) {
        await client.request("chapterTwo", { action: "choose", option: state.chapterTwo.choice.options[0].id });
      } else {
        await client.request("chapterTwo", { action: "advance", skip: true });
      }
    } else if (state.story?.choice) {
      await client.request("story", { action: "choose", option: state.story.choice.options[0].id });
    } else {
      await client.request("story", { action: "advance", skip: true });
    }
    state = await settle(client, 2);
  }
  assert.equal(state.narrative?.controlsLocked, false, "authored presentation did not release for transit QA");
  return state;
}

function assertSinglePresent(state, label) {
  assert.equal(state.diagnostics.presentation.path, "single-surface-offscreen-composite", `${label} presentation path`);
  assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1, `${label} rendered the swap chain more than once`);
}

function transitVehicle(state) {
  return state.vehicles.find(vehicle => vehicle.id === state.world.pulseTransit.vehicleId);
}

function assertTransitVehicle(state) {
  const vehicle = transitVehicle(state);
  assert.ok(vehicle, "Pulse Line minibus is absent");
  assert.equal(vehicle.kind, "van");
  assert.equal(vehicle.access, "pulse-line");
  assert.equal(vehicle.authorized, true);
  assert.equal(vehicle.transitService, true);
  assert.equal(vehicle.transitVisualParts, 8);
  assert.equal(vehicle.visibleOccupants, 4);
  return vehicle;
}

async function stageStreetView(client) {
  // Approach from Street 04's open south curb. The north-east angle sits
  // behind the exchange tower and proves only a blank podium wall.
  await client.request("teleport", { x: 65, z: -32 });
  await client.request("face", { x: 48, z: -15.2 });
  return settle(client, 75);
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  let initialSave = null;
  const captures = {};
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.capture.locked, true);
    assertSinglePresent(state, "startup");
    initialSave = await client.request("save");

    const transit = state.world.pulseTransit;
    assert.equal(transit.id, "pulse-street-exchange");
    assert.equal(transit.vehicleId, "vehicle-06");
    assert.deepEqual(transit.westboundCurbStops.map(point => point[0]), [48, 0, -48, -96, -144]);
    assert.equal(state.world.stats.pulseTransitExchange, true);
    assert.equal(state.world.stats.pulseTransitShelters, 5);
    assert.equal(state.world.stats.pulseTransitPracticalLights, 2);
    assert.equal(state.world.stats.pulseTransitAllocatedInstances, 39);
    assert.equal(state.world.stats.instancedMeshes, 64);
    assert.equal(state.world.stats.instances, 5_733);
    assert.equal(state.vehicles.length, 19);
    assert.equal(state.vehicles.filter(vehicle => vehicle.transitService).length, 1);
    assertTransitVehicle(state);

    const rendererWarmup = state.diagnostics.pipelineWarmup;
    const simulationWarmup = state.diagnostics.simulationWarmup;
    assert.equal(rendererWarmup.ready, true);
    assert.equal(rendererWarmup.storage, "memory-only");
    assert.equal(rendererWarmup.diskCache, false);
    assert.equal(rendererWarmup.passes.length, 2);
    assert.equal(simulationWarmup.storage, "memory-only");
    assert.ok(simulationWarmup.branches.includes("pulse-line-authorized-shuttle-route"));
    assert.equal(simulationWarmup.aftermathPrepared.activitiesPrepared, 3);
    assert.equal(simulationWarmup.aftermathPrepared.vehicleRoutesPrepared, 2);
    assert.equal(simulationWarmup.aftermathPrepared.accessRoutesPrepared, 1);
    assert.equal(simulationWarmup.aftermathPrepared.stopsPrepared, 15);
    assert.equal(simulationWarmup.aftermathPrepared.completionsPrepared, 3);
    assert.equal(simulationWarmup.aftermathPrepared.vehicleAccessRejectionsPrepared, 1);
    assert.equal(simulationWarmup.aftermathPrepared.liveStatePreserved, true);

    state = await clearPresentation(client);
    await client.request("clearWanted");

    // Same street camera, three clock/weather states. Morning and evening
    // exercise real commuter routing; night proves the bounded practicals.
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 8 });
    await client.request("advance", { steps: 1_200 });
    state = await stageStreetView(client);
    const morningRiders = state.population.filter(actor => actor.transitPhase === "morning");
    assert.ok(morningRiders.length > 0, "morning commuters never selected Pulse Line");
    assert.ok(morningRiders.some(actor => actor.transitWaiting), "morning queue never reached a shelter");
    assert.ok(morningRiders.every(actor => actor.transitCovered === false));
    assert.equal(state.diagnostics.lighting.pulseTransitPracticalLightsOn, 0);
    assertTransitVehicle(state);
    captures.morning = await capture(client, "01-pulse-exchange-morning-commute.png");

    await client.request("setTime", { hours: 17.9 });
    await client.request("setWeather", { rain: 1, immediate: true });
    await client.request("advance", { steps: 480 });
    state = await stageStreetView(client);
    const eveningRiders = state.population.filter(actor => actor.transitPhase === "evening");
    assert.ok(eveningRiders.length > 0, "evening commuters never selected Pulse Line");
    assert.ok(eveningRiders.every(actor => actor.transitCovered), "rain commuters ignored the covered anchors");
    assert.ok(state.diagnostics.lighting.pulseTransitPracticalLightsOn > 0,
      "exchange practicals did not begin their dusk transition");
    captures.rainyDusk = await capture(client, "02-pulse-exchange-rainy-dusk.png");

    await client.request("setTime", { hours: 23 });
    await client.request("setWeather", { rain: 0, immediate: true });
    state = await stageStreetView(client);
    assert.equal(state.diagnostics.lighting.pulseTransitPracticalLightsOn, 2);
    assert.ok(state.population.every(actor => actor.transitPhase === null), "the commute queue occupied shelters all night");
    captures.night = await capture(client, "03-pulse-exchange-deep-night.png");

    await client.request("setTime", { hours: 10 });
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("vehicle", {
      vehicleId: transit.vehicleId,
      x: transit.dispatchBay[0],
      z: transit.dispatchBay[2],
      yaw: Math.PI * 0.5,
    });
    await client.request("teleport", { x: transit.dispatchBay[0], z: transit.dispatchBay[2] + 2.7 });
    await client.request("face", { target: transit.vehicleId });
    await client.request("enterVehicle", { vehicleId: transit.vehicleId });
    state = await settle(client, 3);
    assert.equal(state.vehicle.access, "pulse-line");
    assert.equal(state.vehicle.authorized, true);
    assert.match(state.prompt, /START PULSE LINE/i);

    const baseline = Object.freeze({
      cash: state.player.cash,
      trust: state.communityTrust,
      shots: state.player.shotsFired,
    });
    await client.request("resetFrameTiming");
    const startAt = performance.now();
    let activity = await client.request("startLife", { activityId: "pulse_line" });
    const startRoundTripMs = performance.now() - startAt;
    assert.equal(activity.id, "pulse_line");
    assert.equal(activity.kind, "transit");
    assert.equal(activity.status, "active");
    assert.equal(activity.requiredVehicleKind, "van");
    assert.equal(activity.requiredVehicleAccess, "pulse-line");
    assert.equal(activity.stopCount, 5);
    assert.ok(startRoundTripMs < 250, `first Pulse Line start took ${startRoundTripMs.toFixed(1)}ms`);

    let partialSave = null;
    for (let index = 0; index < 5; ++index) {
      const target = activity.targetPosition;
      assert.deepEqual(target, transit.westboundCurbStops[index]);
      await client.request("teleport", { x: target[0], z: target[2], yaw: Math.PI * 0.5 });
      await client.request("advance", { steps: 30 });
      activity = await client.request("activity");
      assert.equal(activity.stopIndex, index, `stop ${index + 1} completed without a full dwell`);
      assert.ok(activity.dwell > 0.45 && activity.dwell < 0.55, activity);

      if (index === 0) {
        partialSave = await client.request("save");
        await client.request("advance", { steps: 24 });
        const restoredPersistent = await client.request("restore", { snapshot: partialSave });
        assert.equal(restoredPersistent.activities.life.stopIndex, partialSave.activities.life.stopIndex);
        assert.equal(restoredPersistent.activities.life.dwell, partialSave.activities.life.dwell,
          "the restore operation itself must reinstate the exact saved dwell");
        const restored = await client.request("activity");
        assert.equal(restored.stopIndex, activity.stopIndex);
        assert.ok(restored.dwell >= activity.dwell && restored.dwell <= activity.dwell + 0.10,
          "only real native frames after restoration may advance the reinstated dwell");
        assert.equal(restored.requiredVehicleAccess, "pulse-line");
      }

      await client.request("advance", { steps: 125 });
      activity = await client.request("activity");
      assert.equal(activity.stopIndex, index + 1, `stop ${index + 1} did not complete after its dwell`);
    }

    assert.equal(activity.status, "completed");
    assert.equal(activity.completedCount, 1);
    assert.ok(activity.payout >= 340 && activity.payout <= 422, activity);
    state = await client.request("snapshot");
    assert.equal(state.player.cash, baseline.cash + activity.payout);
    assert.equal(state.communityTrust, baseline.trust + 2);
    assert.equal(state.player.shotsFired, baseline.shots);
    assert.equal(state.wanted.stars, 0);
    assertSinglePresent(state, "completed shift");

    await client.request("advance", { steps: 300 });
    state = await client.request("snapshot");
    assert.equal(state.player.cash, baseline.cash + activity.payout, "completed shift paid twice");
    assert.equal(state.communityTrust, baseline.trust + 2, "completed shift added trust twice");
    assert.equal(state.activity.completedCount, 1);
    await wait(1_250);
    state = await client.request("snapshot");
    const timing = state.diagnostics.frameTiming;
    assert.ok(timing.samples >= 20, timing);
    assert.ok(timing.p95Ms < 50, timing);
    assert.ok(timing.maximumMs < 250, timing);
    assert.equal(timing.stallFrames, 0, `Pulse Line produced ${timing.stallFrames} post-warmup stall frames`);

    const completed = Object.freeze({
      payout: activity.payout,
      trustEarned: 2,
      stops: activity.stopCount,
      startRoundTripMs,
      frameTiming: timing,
      partialRestoreVerified: Boolean(partialSave),
    });

    await client.request("restore", { snapshot: initialSave });
    const restoredState = await client.request("snapshot");
    assert.equal(restoredState.player.cash, initialSave.player.cash);
    assert.equal(restoredState.communityTrust, initialSave.communityTrust);
    assert.equal(restoredState.activity?.status === "active", false);
    assert.equal(restoredState.wanted.stars, initialSave.wanted.stars);

    console.log(JSON.stringify({
      ready: restoredState.ready,
      backend: restoredState.diagnostics.backend,
      pulseTransit: transit,
      worldStats: {
        instances: state.world.stats.instances,
        instancedMeshes: state.world.stats.instancedMeshes,
        vehicles: state.vehicles.length,
        people: state.population.length,
      },
      rendererWarmup,
      activityWarmup: simulationWarmup.aftermathPrepared,
      completed,
      presentation: state.diagnostics.presentation,
      captures,
    }, null, 2));
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "KeyS", down: false }).catch(() => {});
    await client.request("key", { code: "KeyE", down: false }).catch(() => {});
    await client.request("clearWanted").catch(() => {});
    if (initialSave) await client.request("restore", { snapshot: initialSave }).catch(() => {});
    client.close();
  }
}

await main();
