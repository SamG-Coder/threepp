import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import net from "node:net";

const pipePath = process.argv[2];
const screenshotPath = process.argv[3] ?? null;
if (!pipePath) throw new TypeError("Usage: node tests/live-playtest.mjs <named-pipe-path> [screenshot.png]");

class ControlClient {
  constructor(path) {
    this.socket = net.createConnection(path);
    this.socket.setEncoding("utf8");
    this.pending = new Map();
    this.buffer = "";
    this.sequence = 0;
    this.socket.on("data", chunk => this.consume(chunk));
    this.socket.on("error", error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }
  async ready() {
    if (!this.socket.connecting) return;
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
  }
  request(op, values = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Control request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 45_000);
      this.pending.set(id, {
        resolve: value => { clearTimeout(timeout); resolve(value); },
        reject: error => { clearTimeout(timeout); reject(error); },
      });
      // Protocol correlation owns `id`; operation payloads use names such as
      // `vehicleId` and cannot accidentally replace it.
      this.socket.write(`${JSON.stringify({ ...values, id, op })}\n`);
    });
  }
  consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error || "Control request failed"));
    }
  }
  close() { this.socket.end(); }
}

async function main() {
  const control = new ControlClient(pipePath);
  await control.ready();
  try {
    assert.equal((await control.request("ping")).pong, true);
    let state = await control.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.ok(state.world.stats.buildings >= 50);
    assert.ok(state.world.stats.districts >= 5);
    assert.ok(state.world.stats.instances >= 5_000);
    assert.ok(state.world.stats.streetDetailInstances >= 1_000);
    assert.ok(state.world.stats.laneArrows >= 30);
    assert.ok(state.world.stats.storefronts >= 40);
    assert.ok(state.world.stats.distantLights >= 59);
    assert.equal(state.world.stats.authoredFacadeTexture, true);
    assert.equal(state.world.stats.authoredBrickTexture, true);
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
    assert.equal(state.world.stats.instances, 5_858);
    assert.equal(state.world.stats.staticLights, 82);
    assert.equal(state.world.stats.distantLights, 59);
    assert.equal(state.world.stats.linearLaneDividers, 0,
      "two-lane streets must not receive a duplicate internal white divider");
    assert.equal(state.world.stats.intersectionAsphaltCaps, 56,
      "every road crossing should have one stable asphalt junction cap");
    assert.ok(state.world.stats.cafeFurniture >= 24);
    assert.ok(state.world.stats.streetClutter >= 20);
    assert.ok(state.world.stats.pedestrianNodes >= 800);
    assert.equal(state.world.stats.pedestrianNodes, 1_103);
    assert.ok(state.vehicles.length >= 18);
    assert.ok(state.population.filter(actor => !actor.police && !actor.storyRole).length >= 30);
    assert.equal(state.population.length, 56);
    assert.ok(state.population.some(actor =>
      actor.id === "leah_moreno" && actor.storyRole === "night-care-driver-and-pulse-customer"));
    assert.ok(state.population.some(actor =>
      actor.id === "dara-ibarra" && actor.storyRole === "southline-depot-clerk-and-union-steward"));
    assert.equal(state.chapterTwo.chapter.title, "BORROWED TIME");
    assert.equal(state.chapterTwo.chapterStarted, false);
    assert.equal(state.chapterTwo.phase, "locked");
    assert.equal(state.chapterTwo.clueProgress, "0/3");
    assert.equal(new Set(state.population.filter(actor => !actor.police && !actor.storyRole).map(actor => actor.routine)).size, 6);
    assert.ok(["available", "steal_target"].includes(state.mission.stage),
      `live harness requires a fresh or just-briefed recovery, got ${state.mission.stage}`);
    assert.ok(Number.isFinite(state.environment.timeHours));
    assert.ok(Number.isFinite(state.environment.rain));
    assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1);
    assert.equal(state.diagnostics.pipelineWarmup.ready, true);
    assert.equal(state.diagnostics.pipelineWarmup.passes.length, 2);
    assert.equal(state.diagnostics.pipelineWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.pipelineWarmup.diskCache, false);
    assert.equal(state.diagnostics.simulationWarmup.ready, true);
    assert.equal(state.diagnostics.simulationWarmup.residualEffects, 0);
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
    assert.ok(state.neighbourhood.businesses.every(business =>
      business.itemCount === (business.id === "mina_market_kitchen" ? 5 : 4)));
    assert.equal(state.neighbourhood.businesses.filter(business => business.openingHours.overnight).length, 2);
    assert.equal(state.diagnostics.neighbourhood.businessCount, 4);
    assert.ok(Number.isFinite(state.neighbourhood.appetite));
    assert.equal(state.population.filter(actor => actor.storyRole?.startsWith("shopkeeper-")).length, 4);
    const harbourCourtActivity = state.lifeActivities.find(activity => activity.id === "harbour_court");
    assert.equal(harbourCourtActivity?.kind, "basketball");
    assert.equal(harbourCourtActivity?.onFoot, true);

    // Establish weather and clock explicitly: the live game starts at dawn,
    // while this harness must validate both ends of the lighting cycle without
    // depending on a random forecast or the wall-clock time of the test.
    await control.request("setWeather", { rain: 0, immediate: true });
    await control.request("setTime", { hours: 12 });
    await control.request("advance", { steps: 3 });
    state = await control.request("render");
    assert.ok(state.environment.daylight > 0.98);
    assert.equal(state.diagnostics.lighting.practicalLightsOn, 0,
      "street and garage practicals should be fully off at noon");

    await control.request("setTime", { hours: 23 });
    await control.request("advance", { steps: 3 });
    state = await control.request("render");
    assert.ok(state.environment.night > 0.95);
    assert.ok(state.diagnostics.lighting.practicalLightsOn >= 40,
      "authored practical lights should illuminate the night city");
    assert.ok(state.vehicles.some(vehicle => vehicle.headlightsOn),
      "night traffic should cast real low-beam light");

    await control.request("setWeather", { rain: 0.65, immediate: true });
    await control.request("setTime", { hours: 7.2 });
    await control.request("advance", { steps: 3 });
    state = await control.request("snapshot");
    assert.ok(state.environment.rain > 0.6);
    assert.ok(state.population.filter(actor => actor.carryingUmbrella).length >= 26,
      "ambient civilians should react to heavy rain with prewarmed umbrellas");

    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"]) {
      await control.request("key", { code, down: false });
    }

    // Visual QA may hand this harness a running native process while the final
    // briefing line is still on screen. Finish it before taking gameplay
    // control; this also makes the harness composable after story screenshots.
    state = await control.request("snapshot");
    if (state.story.active) {
      await control.request("story", { action: "advance", skip: true });
      await control.request("advance", { steps: 2 });
    }

    state = await control.request("startMission");
    assert.equal(state.stage, "steal_target");
    let snapshot = await control.request("snapshot");
    const target = snapshot.vehicles.find(vehicle => vehicle.id === snapshot.mission.targetVehicleId);
    assert.ok(target?.missionTarget, "mission target car should be present and marked");

    await control.request("teleport", { x: target.position[0] + 2.2, z: target.position[2] });
    // Hold meaningful heat across any first-use GPU pipeline compilation that
    // happens as the driving HUD becomes visible.
    await control.request("setWanted", { heat: 50 });
    const entered = await control.request("enterVehicle", { vehicleId: target.id });
    assert.equal(entered.id, target.id);
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.player.inVehicle, target.id);
    assert.equal(snapshot.mission.stage, "escape_police");
    assert.ok(snapshot.wanted.stars >= 2);

    const startPosition = [...snapshot.vehicle.position];
    await control.request("key", { code: "KeyW", down: true });
    await control.request("advance", { steps: 120 });
    await control.request("key", { code: "KeyW", down: false });
    snapshot = await control.request("snapshot");
    assert.ok(Math.hypot(
      snapshot.vehicle.position[0] - startPosition[0],
      snapshot.vehicle.position[2] - startPosition[2],
    ) > 2, "player car should move under injected native driving input");
    assert.ok(snapshot.population.some(actor => actor.police && actor.active && actor.state !== "reserve"),
      "wanted response should activate native police pursuit actors");
    assert.ok(snapshot.vehicles.some(vehicle => vehicle.driver === "police" && vehicle.visibleOccupants === 2),
      "responding police cars should visibly contain both an officer and partner");

    await control.request("clearWanted");
    await control.request("advance", { steps: 2 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.mission.stage, "deliver_target");
    const dropoff = snapshot.mission.dropoffPosition;
    await control.request("teleport", { x: dropoff[0], z: dropoff[2] });
    await control.request("advance", { steps: 3 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.mission.stage, "complete");
    assert.ok(snapshot.player.cash >= 6250, "mission reward should be credited");

    if (snapshot.story.active) {
      let resolvedStory = await control.request("story", { action: "advance", skip: true });
      assert.equal(resolvedStory.choice?.id, "audit_drive_release",
        "returning the evidence should ask the player to own a morally costly decision");
      resolvedStory = await control.request("story", { action: "choose", option: "publish" });
      assert.equal(resolvedStory.sequenceId, "public_release");
      resolvedStory = await control.request("story", { action: "advance", skip: true });
      assert.equal(resolvedStory.phase, "free_roam", "chapter resolution should hand control back to free roam");
      assert.deepEqual(resolvedStory.moralLedger, { publicPressure: 3, sourceSafety: -2 });
      await control.request("advance", { steps: 2 });
      const consequences = (await control.request("snapshot")).lifeActivities;
      assert.ok(consequences.some(activity => activity.id === "safe_passage"),
        "publishing should unlock witness-safety work for the people Kai exposed");
      assert.ok(!consequences.some(activity => activity.id === "paper_trail"),
        "the mutually exclusive protected-case aftermath must remain locked");
    }

    await control.request("exitVehicle");
    await control.request("teleport", { x: -8, z: 7 });
    await control.request("face", { x: -8, z: -30 });
    snapshot = await control.request("snapshot");
    const ammoBeforeHipFire = snapshot.player.ammo.clip;
    await control.request("action", { action: "fire" });
    await control.request("advance", { steps: 1 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.player.ammo.clip, ammoBeforeHipFire, "third-person hip fire must remain blocked");

    await control.request("aim", { down: true });
    await control.request("advance", { steps: 55 });
    snapshot = await control.request("render");
    assert.equal(snapshot.diagnostics.camera.perspective, "first-person-aim");
    const ammoBeforeSightedFire = snapshot.player.ammo.clip;
    await control.request("action", { action: "fire" });
    await control.request("advance", { steps: 1 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.player.ammo.clip, ammoBeforeSightedFire - 1,
      "first-person iron-sight fire should consume exactly one round");
    await control.request("aim", { down: false });
    await control.request("advance", { steps: 20 });
    await control.request("clearWanted");

    const save = await control.request("save");
    const savedPosition = save.player.position;
    await control.request("teleport", { x: 20, z: 24 });
    await control.request("setWeather", { rain: 0, immediate: true });
    await control.request("setTime", { hours: 12 });
    await control.request("restore", { snapshot: save });
    await control.request("face", { x: savedPosition[0], z: savedPosition[2] - 30 });
    await control.request("advance", { steps: 90 });
    snapshot = await control.request("snapshot");
    assert.deepEqual(snapshot.player.position, savedPosition);
    assert.ok(snapshot.environment.rain > 0.2, "save restore should retain native weather state");
    assert.ok(Math.abs(snapshot.diagnostics.playerRootRoll) < 0.01, "a restored living player should stand upright");

    await control.request("action", { action: "jump" });
    await control.request("advance", { steps: 1 });
    assert.equal((await control.request("snapshot")).player.grounded, false, "native on-foot jump should leave the ground");
    await control.request("advance", { steps: 70 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.player.grounded, true, "native on-foot jump should land deterministically");

    await control.request("clearWanted");
    const cashBeforeSideJobs = snapshot.player.cash;
    const taxiVehicle = snapshot.vehicles.find(vehicle => vehicle.kind === "taxi");
    assert.ok(taxiVehicle, "the city should contain a driveable taxi");
    await control.request("enterVehicle", { vehicleId: taxiVehicle.id });
    await control.request("clearWanted");
    snapshot = await control.request("snapshot");
    const hornWitness = snapshot.population.find(actor => !actor.police && actor.alive && actor.active);
    assert.ok(hornWitness, "a live civilian should be available for the horn reaction check");
    await control.request("teleport", {
      x: hornWitness.position[0],
      z: hornWitness.position[2] + 4,
    });
    await control.request("key", { code: "KeyH", down: true });
    await control.request("advance", { steps: 1 });
    await control.request("key", { code: "KeyH", down: false });
    await control.request("advance", { steps: 50 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.wanted.stars, 0, "using the horn should not be treated as a crime");
    assert.ok(snapshot.population.some(actor => !actor.police && actor.state === "yield"),
      "nearby civilians should step aside for the player's horn");
    let activity = await control.request("startTaxi");
    assert.equal(activity.stage, "pickup");
    await control.request("teleport", {
      x: activity.targetPosition[0],
      z: activity.targetPosition[2],
    });
    await control.request("advance", { steps: 90 });
    activity = (await control.request("snapshot")).activity;
    assert.equal(activity.stage, "dropoff", "taxi passenger should board while the cab waits at pickup");
    await control.request("teleport", {
      x: activity.targetPosition[0],
      z: activity.targetPosition[2],
    });
    await control.request("advance", { steps: 50 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.activity.status, "completed", "taxi fare should complete at the drop-off");
    assert.ok(snapshot.player.cash > cashBeforeSideJobs, "taxi work should pay the player");

    await control.request("exitVehicle");
    await control.request("clearWanted");
    const sportsVehicle = snapshot.vehicles.find(vehicle => vehicle.kind === "sports");
    assert.ok(sportsVehicle, "the city should contain a street-race sports car");
    await control.request("enterVehicle", { vehicleId: sportsVehicle.id });
    activity = await control.request("startRace");
    assert.equal(activity.stage, "staging");
    await control.request("teleport", {
      x: activity.targetPosition[0],
      z: activity.targetPosition[2],
    });
    await control.request("advance", { steps: 1 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.activity.stage, "countdown", "race should arm after stopping in the start grid");
    await control.request("advance", { steps: 181 });
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.activity.stage, "racing", "race countdown should transition to live racing");
    for (const checkpoint of snapshot.activity.course.checkpoints) {
      await control.request("teleport", { x: checkpoint[0], z: checkpoint[2] });
      await control.request("advance", { steps: 1 });
    }
    snapshot = await control.request("snapshot");
    assert.equal(snapshot.activity.status, "completed", "ordered checkpoints should finish Harbour Loop");
    assert.ok(snapshot.activity.payout > 0, "street racing should award a payout");

    await control.request("exitVehicle");
    await control.request("clearWanted");
    snapshot = await control.request("snapshot");
    const serviceVan = snapshot.vehicles.find(vehicle => vehicle.kind === "van");
    assert.ok(serviceVan, "Pulse Garage should have a legitimate roadside service van");

    async function completeLifeRoute(activityId) {
      let current = await control.request("startLife", { activityId });
      assert.equal(current.status, "active", `${activityId} should start in the native game`);
      let guard = 0;
      while (current.status === "active" && guard++ < 20) {
        if (current.targetKind === "destination") {
          const live = await control.request("snapshot");
          if (!live.player.inVehicle) await control.request("enterVehicle", { vehicleId: serviceVan.id });
          await control.request("teleport", { x: current.targetPosition[0], z: current.targetPosition[2] });
          await control.request("advance", { steps: 60 });
        } else {
          const live = await control.request("snapshot");
          if (live.player.inVehicle) await control.request("exitVehicle");
          await control.request("teleport", { x: current.targetPosition[0], z: current.targetPosition[2] });
          await control.request("action", { action: "interact" });
          await control.request("advance", { steps: 1 });
        }
        current = (await control.request("snapshot")).activity;
      }
      assert.equal(current.status, "completed", `${activityId} should complete through real travel and interaction states`);
      return current;
    }

    await control.request("enterVehicle", { vehicleId: serviceVan.id });
    const roadside = await completeLifeRoute("pulse_roadside");
    assert.equal(roadside.stopCount, 6);
    assert.ok(roadside.payout >= 960);
    if (!(await control.request("snapshot")).player.inVehicle) {
      await control.request("enterVehicle", { vehicleId: serviceVan.id });
    }
    const aftermath = await completeLifeRoute("safe_passage");
    assert.equal(aftermath.stopCount, 4);
    assert.ok(aftermath.payout >= 640);
    if ((await control.request("snapshot")).player.inVehicle) await control.request("exitVehicle");
    await control.request("clearWanted");
    // Finish on an unobstructed Pulse Core sidewalk looking down a live road,
    // so the optional frame capture presents traffic, storefronts and skyline
    // instead of a close-up of the central plaza sculpture.
    await control.request("teleport", { x: 32.5, z: 52 });
    await control.request("face", { x: 24, z: -60 });
    await control.request("advance", { steps: 45 });
    snapshot = await control.request("snapshot");

    let capture = null;
    if (screenshotPath) {
      capture = await control.request("screenshot", { path: screenshotPath, width: 1280, height: 720 });
      assert.ok((await stat(capture.path)).size > 20_000, "native frame capture should contain a non-trivial PNG");
    }

    const trafficBeforeSoak = new Map(snapshot.vehicles
      .filter(vehicle => vehicle.driver === "traffic" || vehicle.driver === "police")
      .map(vehicle => [vehicle.id, vehicle.position]));
    await control.request("advance", { steps: 10_800 });
    const soaked = await control.request("snapshot");
    const movingTraffic = soaked.vehicles.filter(vehicle => {
      const before = trafficBeforeSoak.get(vehicle.id);
      return before && Math.hypot(vehicle.position[0] - before[0], vehicle.position[2] - before[2]) > 2;
    }).length;
    assert.ok(movingTraffic >= 8, `denser traffic should remain mobile through a three-minute soak; moved ${movingTraffic}`);
    assert.ok(soaked.vehicles.every(vehicle => vehicle.position.every(Number.isFinite) && Number.isFinite(vehicle.speed)));
    assert.ok(soaked.population.every(actor => actor.position.every(Number.isFinite) && Number.isFinite(actor.speed)));
    assert.ok(Number.isFinite(soaked.environment.timeHours) && Number.isFinite(soaked.environment.rain));
    snapshot = soaked;

    console.log(JSON.stringify({
      ready: snapshot.ready,
      backend: snapshot.diagnostics.backend,
      world: snapshot.world.stats,
      vehicles: snapshot.vehicles.length,
      population: snapshot.population.length,
      drivingVerified: true,
      mission: snapshot.mission.status,
      gunplayVerified: true,
      wantedStars: snapshot.wanted.stars,
      saveRestoreVerified: true,
      environmentVerified: true,
      policeBehaviorVerified: true,
      playerMovementVerified: true,
      sideActivitiesVerified: true,
      roadsideWorkVerified: true,
      branchConsequenceVerified: true,
      hornReactionVerified: true,
      soakVerified: true,
      moralChoiceVerified: snapshot.story.choiceResult === "publish",
      frameTiming: snapshot.diagnostics.frameTiming,
      movingTraffic,
      capture,
    }, null, 2));
  } finally {
    control.close();
  }
}

await main();
