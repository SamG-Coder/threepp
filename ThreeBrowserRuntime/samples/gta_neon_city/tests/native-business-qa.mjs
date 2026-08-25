import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3];
if (!pipePath || !outputDirectory) {
  throw new TypeError("Usage: node tests/native-business-qa.mjs <pipe> <output-directory>");
}

const MINA = Object.freeze({
  id: "mina_market_kitchen",
  position: Object.freeze([-148, 0.2, 127.7]),
  keeperPosition: Object.freeze([-148, 0.2, 131.35]),
});

class Client {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.pending = new Map();
    this.sequence = 0;
    socket.setEncoding("utf8");
    socket.on("data", chunk => this.consume(chunk));
    socket.on("error", error => {
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
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
      else pending.reject(new Error(response.error || "native Open Doors request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native Open Doors request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

async function connect(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
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
  throw lastError ?? new Error("native Open Doors pipe did not become ready");
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function capture(client, filename) {
  const destination = path.resolve(outputDirectory, filename);
  const result = await client.request("screenshot", { path: destination, width: 1280, height: 720 });
  assert.ok((await stat(result.path)).size > 40_000, `${filename} is unexpectedly small`);
  return result.path;
}

async function clearBlockingStory(client) {
  let state = await client.request("snapshot");
  for (let guard = 0; guard < 12 && state.story.active; ++guard) {
    if (state.story.choice) {
      const option = state.story.choice.options?.[0]?.id ?? "protect";
      await client.request("story", { action: "choose", option });
    } else {
      await client.request("story", { action: "advance", skip: true });
    }
    await client.request("advance", { steps: 2 });
    state = await client.request("snapshot");
  }
  assert.equal(state.story.active, false, "opening story should hand control to the native player");
  return state;
}

function verifyFirstUseTiming(timing) {
  assert.ok(timing.samples >= 20,
    `first shop presentation collected only ${timing.samples} real native frames`);
  assert.ok(timing.p95Ms < 50,
    `first shop presentation p95 was ${timing.p95Ms.toFixed(1)}ms`);
  // Windows may contribute one isolated scheduling frame around 50ms even
  // with a fully warm GPU. A compiled-on-demand pipeline would be hundreds or
  // thousands of milliseconds and is rejected by both the count and maximum.
  assert.ok(timing.stallFrames <= 1,
    `first shop presentation contained ${timing.stallFrames} >50ms frame(s)`);
  assert.ok(timing.maximumMs < 100,
    `first shop presentation contained a ${timing.maximumMs.toFixed(1)}ms hitch`);
}

function assertMenuShape(neighbourhood) {
  assert.equal(neighbourhood.menuOpen, true);
  assert.equal(neighbourhood.businessId, MINA.id);
  assert.equal(neighbourhood.businessName, "MINA'S MARKET KITCHEN");
  assert.equal(neighbourhood.keeperName, "MINA OKAFOR");
  assert.equal(neighbourhood.menuItems.length, 4);
  assert.equal(neighbourhood.menuItems[3].id, "pay_a_meal_forward");
  assert.equal(neighbourhood.menuItems[3].heal, 0);
  assert.equal(neighbourhood.menuItems[3].stamina, 0);
  assert.equal(neighbourhood.menuItems[3].appetite, 0);
  assert.match(neighbourhood.keeperLine, /MINA OKAFOR:/);
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const client = await connect();
  const captures = {};
  let timing = null;
  let firstMenuRoundTripMs = null;
  let mealTransaction = null;
  let payForwardTransaction = null;
  let acknowledgedBefore = 0;
  try {
    let state = await client.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1);
    assert.equal(state.world.stats.northMarketArcade, true);
    assert.equal(state.world.stats.northMarketStalls, 4);
    assert.equal(state.world.stats.northMarketVisitorAnchors, 4);
    assert.equal(state.world.stats.northMarketBusinessAnchors, 4);
    assert.equal(state.world.stats.northMarketPracticalLights, 3);
    assert.equal(state.world.stats.northMarketPropInstances, 60);
    assert.equal(state.world.stats.businessLocations, 4);
    assert.equal(state.world.stats.businessFrontages, 3);
    assert.equal(state.world.stats.businessFrontagePropInstances, 27);
    assert.equal(state.world.stats.businessPracticalLights, 3);
    assert.equal(state.world.stats.instancedMeshes, 64);
    assert.equal(state.world.stats.instances, 5_535);
    assert.equal(state.world.stats.staticLights, 80);
    assert.equal(state.neighbourhood.businesses.length, 4);
    assert.equal(state.neighbourhood.businessCount, 4);
    assert.equal(state.diagnostics.pipelineWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.pipelineWarmup.diskCache, false);
    assert.equal(state.diagnostics.simulationWarmup.storage, "memory-only");
    assert.ok(state.diagnostics.simulationWarmup.branches.includes("neighbourhood-business-meal-and-menu"));
    assert.deepEqual(state.diagnostics.simulationWarmup.neighbourhoodPrepared, {
      menusPrepared: 4,
      purchasePrepared: true,
      consumePrepared: true,
      acknowledgementPrepared: true,
      storage: "memory-only",
    });
    assert.ok(state.population.some(actor => actor.id === `shopkeeper-${MINA.id}` && actor.alive),
      "Mina should physically occupy her North Market counter");

    state = await clearBlockingStory(client);
    if (state.player.inVehicle) await client.request("exitVehicle");
    if (state.activity?.status === "active") await client.request("cancelActivity");
    // Let the one-time quick-controls card finish before visual QA so the
    // authored market arcade is not obscured in the evidence frame.
    await client.request("advance", { steps: 430 });
    await client.request("closeBusiness");
    await client.request("clearWanted");
    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 12.5 });

    // Prove that the three formerly coordinate-only businesses now read as
    // distinct physical places. Each camera stays on the public approach and
    // each capture uses the real opening-hours light gate.
    await client.request("setTime", { hours: 8 });
    await client.request("teleport", { x: -40, z: -17.2 });
    await client.request("face", { x: -40, z: -13.75 });
    await client.request("advance", { steps: 12 });
    state = await client.request("snapshot");
    assert.equal(state.neighbourhood.businesses.find(value => value.id === "common_ground_cafe")?.open, true);
    captures.commonGround = await capture(client, "01a-common-ground-morning-frontage.png");

    await client.request("setWeather", { rain: 0.24, immediate: true });
    await client.request("setTime", { hours: 23 });
    await client.request("teleport", { x: 151.5, z: 143.5 });
    await client.request("face", { x: 145.75, z: 148 });
    await client.request("advance", { steps: 12 });
    state = await client.request("snapshot");
    assert.equal(state.neighbourhood.businesses.find(value => value.id === "harbour_lantern")?.open, true);
    captures.harbourLantern = await capture(client, "01b-harbour-lantern-rainy-night-frontage.png");

    await client.request("setTime", { hours: 1 });
    await client.request("teleport", { x: -126, z: -113 });
    await client.request("face", { x: -132, z: -108.05 });
    await client.request("advance", { steps: 12 });
    state = await client.request("snapshot");
    assert.equal(state.neighbourhood.businesses.find(value => value.id === "southline_diner")?.open, true);
    captures.southlineDiner = await capture(client, "01c-southline-diner-late-night-frontage.png");

    await client.request("setWeather", { rain: 0, immediate: true });
    await client.request("setTime", { hours: 12.5 });

    // Create visible room for all three ordinary meal benefits. This is real
    // native movement and damage, not direct mutation of routine state.
    await client.request("damage", { target: "player", amount: 25, ignoreArmor: true });
    await client.request("key", { code: "ShiftLeft", down: true });
    await client.request("key", { code: "KeyW", down: true });
    await client.request("advance", { steps: 240 });
    await client.request("key", { code: "KeyW", down: false });
    await client.request("key", { code: "ShiftLeft", down: false });
    await client.request("teleport", { x: MINA.position[0], z: MINA.position[2] });
    await client.request("face", { x: MINA.keeperPosition[0], z: MINA.keeperPosition[2] });
    await client.request("advance", { steps: 12 });
    state = await client.request("snapshot");
    assert.ok(state.player.health <= 75.01, "meal QA setup should leave health below full");
    assert.ok(state.player.stamina < 100, "native sprint should leave stamina below full");
    assert.equal(state.neighbourhood.businesses.find(value => value.id === MINA.id)?.open, true);
    captures.dayArcade = await capture(client, "01-north-market-day-arcade.png");

    // Reset after all setup and readback. The first real modal presentation is
    // then measured by the native animation loop, including any GPU work.
    await client.request("resetFrameTiming");
    const openedAt = performance.now();
    const opened = await client.request("openBusiness", { businessId: MINA.id });
    firstMenuRoundTripMs = performance.now() - openedAt;
    assertMenuShape(opened);
    acknowledgedBefore = opened.acknowledgedPayForwards;
    assert.ok(firstMenuRoundTripMs < 250,
      `opening the prewarmed menu took ${firstMenuRoundTripMs.toFixed(1)}ms`);
    await wait(1_050);
    state = await client.request("snapshot");
    assertMenuShape(state.neighbourhood);
    timing = state.diagnostics.frameTiming;
    verifyFirstUseTiming(timing);
    captures.menu = await capture(client, "02-open-doors-mina-menu.png");

    const beforeMeal = await client.request("snapshot");
    const selectedMeal = beforeMeal.neighbourhood.selectedItem;
    assert.equal(selectedMeal.id, "market_jollof_box");
    const bought = await client.request("shopBuy");
    mealTransaction = bought.transaction;
    assert.equal(mealTransaction.accepted, true);
    assert.equal(mealTransaction.serial, beforeMeal.neighbourhood.transactionSerial + 1);
    assert.equal(mealTransaction.itemId, selectedMeal.id);
    assert.equal(bought.player.cash, beforeMeal.player.cash - selectedMeal.cost,
      "one accepted transaction should subtract its price exactly once");
    assert.equal(bought.player.health, Math.min(100, beforeMeal.player.health + selectedMeal.heal));
    assert.equal(bought.player.stamina, Math.min(100, beforeMeal.player.stamina + selectedMeal.stamina));
    assert.equal(bought.neighbourhood.appetite, Math.min(100, beforeMeal.neighbourhood.appetite + selectedMeal.appetite));
    assert.equal(bought.neighbourhood.consuming, true);

    const duplicate = await client.request("shopBuy");
    assert.equal(duplicate.transaction.accepted, false);
    assert.equal(duplicate.transaction.reason, "still_consuming");
    assert.equal(duplicate.neighbourhood.transactionSerial, mealTransaction.serial);
    assert.equal(duplicate.player.cash, bought.player.cash,
      "a rejected duplicate purchase must not spend money twice");

    // Persistent saves must retain a partially consumed meal exactly and must
    // not replay its already-applied cash/stat transaction on restore.
    await client.request("advance", { steps: 24 });
    const midConsumeSave = await client.request("save");
    assert.equal(midConsumeSave.neighbourhood.consumeBusinessId, MINA.id);
    assert.ok(midConsumeSave.neighbourhood.consumeElapsed > 0);
    assert.ok(midConsumeSave.neighbourhood.consumeElapsed < midConsumeSave.neighbourhood.consumeDuration);
    await client.request("advance", { steps: 60 });
    const laterConsume = await client.request("neighbourhood");
    assert.ok(laterConsume.consumeElapsed > midConsumeSave.neighbourhood.consumeElapsed);
    const restored = await client.request("restore", { snapshot: midConsumeSave });
    assert.deepEqual(restored.neighbourhood, midConsumeSave.neighbourhood,
      "mid-consume routine state should restore bit-for-bit");
    assert.equal(restored.player.cash, midConsumeSave.player.cash,
      "restoring must not apply the saved transaction a second time");
    assert.equal(restored.neighbourhoodAppliedSerial, mealTransaction.serial);

    await client.request("advance", { steps: 240 });
    let routine = await client.request("neighbourhood");
    assert.equal(routine.consuming, false);
    assert.equal(routine.lastEvent, "meal_finished");

    // Pay-forward is intentionally not a stat exploit: it spends exactly its
    // listed price, grants no buff, then earns one human acknowledgement only
    // after the clock crosses into a later game day.
    await client.request("setTime", { hours: 20 });
    await client.request("advance", { steps: 1 });
    routine = await client.request("shopSelect", { direction: -1 });
    assert.equal(routine.selectedItem.id, "pay_a_meal_forward");
    const beforePayForward = await client.request("snapshot");
    const paidForward = await client.request("shopBuy");
    payForwardTransaction = paidForward.transaction;
    assert.equal(payForwardTransaction.accepted, true);
    assert.equal(payForwardTransaction.itemId, "pay_a_meal_forward");
    assert.equal(payForwardTransaction.heal, 0);
    assert.equal(payForwardTransaction.stamina, 0);
    assert.equal(payForwardTransaction.appetite, 0);
    assert.equal(paidForward.player.cash, beforePayForward.player.cash - payForwardTransaction.cost);
    assert.equal(paidForward.player.health, beforePayForward.player.health);
    assert.equal(paidForward.player.stamina, beforePayForward.player.stamina);
    assert.equal(paidForward.neighbourhood.pendingPayForwards, 1);
    assert.equal(paidForward.neighbourhood.lineReason, "pay_forward_purchase");
    await client.request("closeBusiness");

    await client.request("setTime", { hours: 23 });
    await client.request("advance", { steps: 1 });
    await client.request("setTime", { hours: 7.5 });
    await client.request("advance", { steps: 1 });
    const acknowledged = await client.request("openBusiness", { businessId: MINA.id });
    assertMenuShape(acknowledged);
    assert.equal(acknowledged.lineReason, "pay_forward_acknowledgement");
    assert.equal(acknowledged.pendingPayForwards, 0);
    assert.equal(acknowledged.acknowledgedPayForwards, acknowledgedBefore + 1);
    assert.match(acknowledged.keeperLine, /reached someone|being seen/i);
    captures.acknowledgement = await capture(client, "03-pay-forward-acknowledgement.png");
    await client.request("closeBusiness");

    await client.request("setWeather", { rain: 0.22, immediate: true });
    await client.request("setTime", { hours: 22.4 });
    await client.request("teleport", { x: -144, z: 119.5 });
    await client.request("face", { x: -144, z: 131 });
    await client.request("advance", { steps: 12 });
    state = await client.request("snapshot");
    assert.ok(state.environment.night > 0.95);
    assert.ok(state.diagnostics.lighting.practicalLightsOn >= 65);
    captures.nightArcade = await capture(client, "04-north-market-night-pendants.png");

    // A modal cannot retain input ownership after Kai is wasted. Otherwise
    // the hidden menu consumes T before the normal hospital respawn handler.
    await client.request("setTime", { hours: 12.5 });
    await client.request("teleport", { x: MINA.position[0], z: MINA.position[2] });
    await client.request("openBusiness", { businessId: MINA.id });
    await client.request("damage", { target: "player", amount: 500, ignoreArmor: true });
    await client.request("advance", { steps: 2 });
    state = await client.request("snapshot");
    assert.equal(state.player.alive, false);
    assert.equal(state.neighbourhood.menuOpen, false,
      "being wasted at a counter must release modal input ownership");
    await client.request("action", { action: "restart" });
    await client.request("advance", { steps: 2 });
    state = await client.request("snapshot");
    assert.equal(state.player.alive, true, "T should respawn normally after a shop-side death");

    console.log(JSON.stringify({
      ready: state.ready,
      world: {
        northMarketArcade: state.world.stats.northMarketArcade,
        stalls: state.world.stats.northMarketStalls,
        practicalLights: state.world.stats.northMarketPracticalLights,
        businessLocations: state.world.stats.businessLocations,
        instances: state.world.stats.instances,
        instancedMeshes: state.world.stats.instancedMeshes,
      },
      warmup: state.diagnostics.simulationWarmup.neighbourhoodPrepared,
      firstUse: { roundTripMs: firstMenuRoundTripMs, frameTiming: timing },
      mealTransaction,
      payForwardTransaction,
      acknowledgementVerified: true,
      midConsumeSaveRestoreVerified: true,
      wastedMenuRecoveryVerified: true,
      captures,
    }, null, 2));
  } finally {
    await client.request("key", { code: "KeyW", down: false }).catch(() => {});
    await client.request("key", { code: "ShiftLeft", down: false }).catch(() => {});
    await client.request("closeBusiness").catch(() => {});
    client.close();
  }
}

await main();
