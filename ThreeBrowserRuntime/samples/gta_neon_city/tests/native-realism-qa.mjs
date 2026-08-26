import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3];
if (!pipePath || !outputDirectory) {
  throw new TypeError("Usage: node tests/native-realism-qa.mjs <pipe> <output-directory>");
}

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
      else pending.reject(new Error(response.error || "native realism control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native realism request timed out: ${op}`));
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
  throw lastError ?? new Error("native realism pipe did not become ready");
}

async function capture(client, filename) {
  const destination = path.join(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 40_000, `${filename} is unexpectedly small`);
  await client.request("resetFrameTiming");
  return result.path;
}

async function settle(client, steps = 45) {
  await client.request("advance", { steps });
  return client.request("render");
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  const captures = {};
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1);
    assert.equal(state.world.stats.authoredFacadeTexture, true);
    assert.equal(state.world.stats.authoredRoadTexture, true);
    assert.equal(state.world.stats.authoredPavementTexture, true);
    assert.equal(state.world.stats.authoredCourtTexture, true);
    assert.equal(state.world.stats.authoredDepotTexture, true);
    assert.equal(state.world.stats.harbourCourt, true);
    assert.equal(state.world.stats.harbourCourtPracticalLights, 2);
    assert.equal(state.world.stats.harbourCourtShotSpots, 5);
    assert.equal(state.world.stats.northMarketArcade, true);
    assert.equal(state.world.stats.northMarketStalls, 4);
    assert.equal(state.world.stats.northMarketVisitorAnchors, 4);
    assert.equal(state.world.stats.northMarketBusinessAnchors, 4);
    assert.equal(state.world.stats.northMarketPracticalLights, 3);
    assert.equal(state.world.stats.northMarketPropInstances, 60);
    assert.equal(state.world.stats.businessLocations, 4);
    assert.equal(state.world.stats.chapterTwoDepot, true);
    assert.equal(state.world.stats.chapterTwoEvidenceAnchors, 4);
    assert.equal(state.world.stats.chapterTwoGarageClues, 3);
    assert.equal(state.world.stats.chapterTwoLeahAnchor, true);
    assert.equal(state.world.stats.chapterTwoPracticalLights, 2);
    assert.equal(state.world.stats.chapterTwoConversationAnchors, 2);
    assert.equal(state.world.stats.chapterTwoEvidencePartInstances, 10);
    assert.equal(state.world.stats.chapterTwoPropInstances, 20);
    assert.equal(state.world.stats.instancedMeshes, 64);
    assert.equal(state.world.stats.instances, 5_733);
    assert.equal(state.world.stats.staticLights, 80);
    assert.equal(state.world.stats.distantLights, 59);
    assert.equal(state.world.stats.linearLaneDividers, 0);
    assert.equal(state.world.stats.intersectionAsphaltCaps, 56);
    assert.ok(state.world.stats.cafeFurniture >= 24);
    assert.ok(state.world.stats.streetClutter >= 20);
    assert.ok(state.world.stats.pedestrianNodes >= 800);
    assert.equal(state.world.stats.pedestrianNodes, 1_058);
    assert.equal(state.world.stats.plazaPracticalLights, 4);
    assert.ok(state.population.filter(actor => !actor.police && !actor.storyRole).length >= 30);
    assert.equal(state.population.length, 55);
    assert.ok(state.population.some(actor =>
      actor.id === "leah_moreno" && actor.storyRole === "night-care-driver-and-pulse-customer"));
    assert.ok(state.population.some(actor =>
      actor.id === "dara-ibarra" && actor.storyRole === "southline-depot-clerk-and-union-steward"));
    assert.equal(state.chapterTwo.chapter.title, "BORROWED TIME");
    assert.equal(state.chapterTwo.chapterStarted, false);
    assert.equal(state.chapterTwo.phase, "locked");
    assert.equal(state.chapterTwo.clueProgress, "0/3");
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("basketball-made-and-miss-flight"));
    assert.equal(state.diagnostics.simulationWarmup.basketballPrepared.preparedMadeFlight, true);
    assert.equal(state.diagnostics.simulationWarmup.basketballPrepared.preparedMissFlight, true);
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("neighbourhood-business-meal-and-menu"));
    assert.equal(state.diagnostics.simulationWarmup.neighbourhoodPrepared.menusPrepared, 4);
    assert.equal(state.diagnostics.simulationWarmup.neighbourhoodPrepared.purchasePrepared, true);
    assert.equal(state.diagnostics.simulationWarmup.neighbourhoodPrepared.consumePrepared, true);
    assert.equal(state.diagnostics.simulationWarmup.neighbourhoodPrepared.acknowledgementPrepared, true);
    assert.equal(state.diagnostics.simulationWarmup.neighbourhoodPrepared.storage, "memory-only");
    assert.ok(state.diagnostics.simulationWarmup.branches.includes(
      "borrowed-time-investigation-and-both-costly-decisions"));
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.ready, true);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.storage, "memory-only");
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.rendererResources, 0);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.sequencesPrepared, 11);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.dialogueLinesPrepared, 47);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.aftermathEpiloguesPrepared, 2);
    assert.ok(state.diagnostics.simulationWarmup.chapterTwoPrepared.dialogueCharactersTouched > 10_000);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.clueStatesPrepared, 3);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.priorChoiceStatesPrepared, 2);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.branchStatesPrepared, 2);
    assert.equal(state.diagnostics.simulationWarmup.chapterTwoPrepared.aftermathHooksPrepared, 2);
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("borrowed-time-both-aftermath-routes"));
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.ready, true);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.storage, "memory-only");
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.rendererResources, 0);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.diskResources, 0);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.activitiesPrepared, 3);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.completionsPrepared, 3);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.stopsPrepared, 15);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.accessRoutesPrepared, 1);
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.vehicleAccessRejectionsPrepared, 1);
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("pulse-line-authorized-shuttle-route"));
    assert.equal(state.diagnostics.simulationWarmup.aftermathPrepared.liveStatePreserved, true);
    assert.equal(state.neighbourhood.businesses.length, 4);
    assert.equal(new Set(state.neighbourhood.businesses.map(business => business.keeperName)).size, 4);
    assert.ok(state.neighbourhood.businesses.every(business => business.itemCount === 4));
    assert.equal(state.neighbourhood.businesses.filter(business => business.openingHours.overnight).length, 2);
    assert.equal(state.diagnostics.neighbourhood.businessCount, 4);
    assert.ok(Number.isFinite(state.neighbourhood.appetite));
    assert.equal(state.population.filter(actor => actor.storyRole?.startsWith("shopkeeper-")).length, 4);
    const harbourCourtActivity = state.lifeActivities.find(activity => activity.id === "harbour_court");
    assert.equal(harbourCourtActivity?.kind, "basketball");
    assert.equal(harbourCourtActivity?.onFoot, true);

    for (let index = 0; index < 3 && state.story.active; ++index) {
      await client.request("story", { action: "advance", skip: true });
      await client.request("advance", { steps: 2 });
      state = await client.request("snapshot");
    }
    if (state.activity?.status === "active") await client.request("cancelActivity");
    // Let the one-time control card complete its short fade before visual QA.
    await settle(client, 430);

    // North Market uses only the authored weathered-concrete façade styles.
    await client.request("teleport", { x: -120, z: 120 });
    await client.request("face", { x: -145, z: 145 });
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 13 });
    state = await settle(client, 55);
    assert.equal(state.world.stats.authoredFacadeTexture, true);
    assert.ok(state.environment.rain < 0.01);
    assert.equal(state.diagnostics.lighting.practicalLightsOn, 0);
    captures.dryFacade = await capture(client, "01-north-market-dry-facade.png");

    await client.request("setWeather", { rain: 0.88, immediate: true });
    await client.request("setTime", { hours: 16.25 });
    await client.request("teleport", { x: -14, z: 0 });
    await client.request("face", { x: 0, z: 0 });
    // A control-pipe teleport crosses several city blocks instantly. Give the
    // intentionally spring-smoothed camera enough fixed updates to reach the
    // new anchor instead of capturing its transit through intervening walls.
    state = await settle(client, 55);
    assert.ok(state.environment.rain > 0.87);
    assert.ok(state.environment.daylight > 0.9);
    const ambientCivilians = state.population.filter(actor => !actor.police && !actor.storyRole);
    const umbrellaCount = ambientCivilians.filter(actor => actor.carryingUmbrella).length;
    assert.ok(umbrellaCount >= 26,
      `heavy rain raised only ${umbrellaCount}/${ambientCivilians.length} ambient umbrellas`);
    assert.equal(new Set(ambientCivilians.map(actor => actor.routine)).size, 6);
    captures.wetStreetLife = await capture(client, "02-pulse-core-rain-street-life.png");

    await client.request("setWeather", { rain: 0.12, immediate: true });
    await client.request("setTime", { hours: 22.5 });
    await client.request("teleport", { x: -14, z: 0 });
    await client.request("face", { x: 0, z: 0 });
    state = await settle(client, 55);
    assert.ok(state.environment.night > 0.98);
    assert.ok(state.diagnostics.lighting.practicalLightsOn >= 60);
    assert.ok(state.vehicles.some(vehicle => vehicle.headlightsOn));
    assert.ok(state.population.filter(actor => actor.schedule === "nightlife").length >= 4);
    captures.nightOccupation = await capture(client, "03-pulse-core-nightlife.png");

    console.log(JSON.stringify({
      ready: state.ready,
      world: state.world.stats,
      environment: state.environment,
      lighting: state.diagnostics.lighting,
      pipelineWarmupMs: state.diagnostics.pipelineWarmup.durationMs,
      population: {
        actors: state.population.length,
        ambientCivilians: state.population.filter(actor => !actor.police && !actor.storyRole).length,
        routines: [...new Set(state.population.filter(actor => !actor.police).map(actor => actor.routine))],
        umbrellas: state.population.filter(actor => actor.carryingUmbrella).length,
      },
      captures,
    }, null, 2));
  } finally {
    client.close();
  }
}

await main();
