import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3];
if (!pipePath || !outputDirectory) {
  throw new TypeError("Usage: node tests/native-basketball-qa.mjs <pipe> <output-directory>");
}

const SHOTS = Object.freeze([
  [140.6, -96],
  [137.2, -105.4],
  [137.2, -86.6],
  [143.0, -109.0],
  [143.0, -83.0],
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
      else pending.reject(new Error(response.error || "native basketball request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native basketball request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

async function connect() {
  let lastError = null;
  for (let attempt = 0; attempt < 80; ++attempt) {
    try {
      const socket = net.createConnection(pipePath);
      await new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("native basketball pipe did not become ready");
}

async function capture(client, filename) {
  const destination = path.join(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 40_000, `${filename} is unexpectedly small`);
  return result.path;
}

async function skipOpening(client) {
  for (let index = 0; index < 4; ++index) {
    const state = await client.request("snapshot");
    if (!state.story.active) return;
    await client.request("story", { action: "advance", skip: true });
    await client.request("advance", { steps: 2 });
  }
}

async function armPerfectShot(client, [x, z]) {
  await client.request("teleport", { x, z });
  await client.request("action", { action: "interact" });
  await client.request("advance", { steps: 1 });
  let state = await client.request("activity");
  assert.equal(state.stage, "charging");
  for (let step = 0; step < 180; ++step) {
    state = await client.request("activity");
    if (Math.abs(state.charge - state.targetRelease) < 0.022) break;
    await client.request("advance", { steps: 1 });
  }
  assert.ok(Math.abs(state.charge - state.targetRelease) < 0.035,
    `shot meter should be inside the sweet spot, got ${state.charge}`);
  return state;
}

async function releaseAndFinish(client, { midFlightSteps = 18 } = {}) {
  await client.request("action", { action: "interact" });
  await client.request("advance", { steps: 1 });
  let state = await client.request("activity");
  assert.equal(state.stage, "ball_flight");
  assert.equal(state.releaseRating, "PERFECT");
  assert.equal(state.ballVisible, true);
  await client.request("advance", { steps: midFlightSteps });
  state = await client.request("activity");
  assert.equal(state.stage, "ball_flight");
  assert.ok(state.ballPosition.every(Number.isFinite));
  await client.request("advance", { steps: 70 });
  return client.request("activity");
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  const captures = {};
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.world.stats.harbourCourt, true);
    assert.equal(state.world.stats.authoredCourtTexture, true);
    assert.equal(state.world.stats.harbourCourtPracticalLights, 2);
    assert.equal(state.world.stats.harbourCourtShotSpots, 5);
    assert.equal(state.diagnostics.simulationWarmup.basketballPrepared.preparedMadeFlight, true);
    assert.equal(state.diagnostics.simulationWarmup.basketballPrepared.preparedMissFlight, true);
    assert.ok(state.lifeActivities.some(activity => activity.id === "harbour_court"));
    await skipOpening(client);
    if ((await client.request("snapshot")).activity?.status === "active") await client.request("cancelActivity");
    // Let the first-play control card and any cancelled prior activity finish
    // their authored fade before judging the court composition.
    await client.request("advance", { steps: 430 });

    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 15.5 });
    await client.request("teleport", { x: 131.2, z: -96 });
    await client.request("startBasketball");
    const roundStart = await client.request("snapshot");
    const driveable = roundStart.vehicles.find(vehicle => vehicle.health > 0);
    assert.ok(driveable, "expected a live vehicle for the court-exit lock check");
    await assert.rejects(
      client.request("enterVehicle", { vehicleId: driveable.id }),
      /No enterable vehicle was found/,
      "an active round must not let the player enter a vehicle and freeze the ball state",
    );
    assert.equal((await client.request("snapshot")).player.inVehicle, null);
    await armPerfectShot(client, SHOTS[0]);
    captures.chargeMeter = await capture(client, "01-harbour-court-charge-meter.png");

    // GPU readback intentionally takes wall time while the real native loop
    // keeps running, so restart the round before making the scored evidence
    // shot. This validates gameplay timing rather than freezing the game for
    // a screenshot.
    await client.request("cancelActivity");
    await client.request("startBasketball");
    await armPerfectShot(client, SHOTS[0]);

    await client.request("action", { action: "interact" });
    await client.request("advance", { steps: 20 });
    state = await client.request("activity");
    assert.equal(state.stage, "ball_flight");
    assert.equal(state.ballVisible, true);
    captures.ballFlight = await capture(client, "02-harbour-court-ball-flight.png");
    await client.request("advance", { steps: 70 });
    state = await client.request("activity");
    assert.equal(state.made, 1);

    // A live mid-flight save/restore must preserve the exact shot state.
    await armPerfectShot(client, SHOTS[1]);
    await client.request("action", { action: "interact" });
    await client.request("advance", { steps: 17 });
    const beforeSave = await client.request("activity");
    const save = await client.request("save");
    await client.request("restore", { snapshot: save });
    const afterRestore = await client.request("activity");
    assert.equal(afterRestore.stage, beforeSave.stage);
    assert.equal(afterRestore.shotIndex, beforeSave.shotIndex);
    assert.equal(afterRestore.releaseRating, beforeSave.releaseRating);
    assert.equal(afterRestore.ballVisible, true);
    await client.request("advance", { steps: 72 });

    for (let index = 2; index < SHOTS.length; ++index) {
      await armPerfectShot(client, SHOTS[index]);
      state = await releaseAndFinish(client);
    }
    assert.equal(state.status, "completed");
    assert.equal(state.made, 5);
    assert.equal(state.points, 14);
    assert.equal(state.payout, 805);
    assert.ok((await client.request("snapshot")).communityTrust >= 2);

    await client.request("setWeather", { rain: 0.18, immediate: true });
    await client.request("setTime", { hours: 22.4 });
    await client.request("teleport", { x: 132.5, z: -96 });
    await client.request("face", { x: 149.05, z: -96 });
    await client.request("advance", { steps: 8 });
    state = await client.request("snapshot");
    assert.ok(state.environment.night > 0.95);
    assert.ok(state.diagnostics.lighting.practicalLightsOn >= 65);
    captures.nightCourt = await capture(client, "03-harbour-court-night-floodlights.png");

    console.log(JSON.stringify({
      ready: state.ready,
      world: {
        harbourCourt: state.world.stats.harbourCourt,
        authoredCourtTexture: state.world.stats.authoredCourtTexture,
        courtLights: state.world.stats.harbourCourtPracticalLights,
        instances: state.world.stats.instances,
        instancedMeshes: state.world.stats.instancedMeshes,
      },
      activity: await client.request("activity"),
      communityTrust: state.communityTrust,
      warmup: state.diagnostics.simulationWarmup.basketballPrepared,
      captures,
    }, null, 2));
  } finally {
    client.close();
  }
}

await main();
