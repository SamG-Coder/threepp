import assert from "node:assert/strict";
import net from "node:net";

const pipePath = process.argv[2];
if (!pipePath) throw new TypeError("Usage: node tests/native-performance-qa.mjs <pipe>");

class Client {
  constructor(socket) {
    this.socket = socket;
    this.pending = new Map();
    this.buffer = "";
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
      else pending.reject(new Error(response.error || "native performance control request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native performance request timed out: ${op}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

async function connectWithRetry(target, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const socket = await new Promise((resolve, reject) => {
        const candidate = net.createConnection(target);
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("native performance pipe did not become ready");
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function verifyWindow(label, timing) {
  if (timing.stallFrames > 0 || timing.maximumMs >= 50 || timing.phases.maximumMs.worldStage >= 25) {
    console.error(JSON.stringify({ label, timing }, null, 2));
  }
  assert.ok(timing.samples >= 20, `${label} collected only ${timing.samples} real presentation frames`);
  assert.ok(timing.p95Ms < 50, `${label} p95 frame time was ${timing.p95Ms.toFixed(1)}ms`);
  assert.equal(timing.stallFrames, 0,
    `${label} contained ${timing.stallFrames} >50ms frame(s); startup warmup must prevent mode-switch stalls`);
  assert.ok(timing.maximumMs < 50,
    `${label} contained a ${timing.maximumMs.toFixed(1)}ms hitch`);
  assert.ok(timing.phases.maximumMs.worldStage < 25,
    `${label} spent ${timing.phases.maximumMs.worldStage.toFixed(1)}ms in one world submission`);
}

async function clearBlockingStory(control) {
  let state = await control.request("snapshot");
  for (let guard = 0; guard < 10 && state.story.active; ++guard) {
    if (state.story.choice) await control.request("story", { action: "choose", option: "protect" });
    else await control.request("story", { action: "advance", skip: true });
    state = await control.request("snapshot");
  }
  return state;
}

async function measure(control, milliseconds = 1_250) {
  await control.request("resetFrameTiming");
  await wait(milliseconds);
  return (await control.request("snapshot")).diagnostics.frameTiming;
}

async function main() {
  const control = await connectWithRetry(pipePath);
  try {
    let state = await clearBlockingStory(control);
    assert.equal(state.ready, true);
    assert.equal(state.diagnostics.backend, "NATIVE WEBGPU");
    assert.equal(state.diagnostics.pipelineWarmup.passes.length, 2);
    assert.equal(state.diagnostics.pipelineWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.pipelineWarmup.diskCache, false);
    assert.equal(state.diagnostics.pipelineWarmup.renderDrivenPasses, 2,
      "startup must use real reveal-all renders instead of Three's per-object frame-yielding compile path");
    assert.equal(state.diagnostics.pipelineWarmup.asyncCompilePasses, 0);
    assert.ok(state.diagnostics.pipelineWarmup.passes.every(pass => pass.compileMode === "render"));
    assert.equal(state.diagnostics.pipelineWarmup.textureStorage, "memory-only");
    assert.equal(state.diagnostics.pipelineWarmup.textureDiskCache, false);
    assert.equal(state.diagnostics.pipelineWarmup.textureUploadPolicy, "explicit-initTexture-plus-real-render");
    assert.equal(state.diagnostics.pipelineWarmup.allTextureSourcesReady, true);
    assert.deepEqual(state.diagnostics.pipelineWarmup.pendingTextureSources, []);
    assert.ok(state.diagnostics.pipelineWarmup.textures >= 30,
      "authored surfaces, generated PBR maps, room boxes and HUD atlases must all enter startup preload");
    assert.equal(state.diagnostics.pipelineWarmup.explicitTextureUploads,
      state.diagnostics.pipelineWarmup.textures,
      "every discovered gameplay texture must be explicitly uploaded before READY");
    assert.ok(state.diagnostics.pipelineWarmup.passes.every(pass => pass.textureSourcesReady === pass.textures));
    assert.equal(state.diagnostics.pipelineWarmup.queueSettledBeforePlay, true);
    assert.equal(state.diagnostics.simulationWarmup.ready, true);
    assert.equal(state.diagnostics.simulationWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.simulationWarmup.ragdollPrepared, true);
    assert.equal(state.diagnostics.simulationWarmup.residualEffects, 0);
    assert.ok(state.diagnostics.simulationWarmup.policeInReserve >= 7);
    assert.ok(state.diagnostics.simulationWarmup.spawnReservePrepared.available >= 2);
    for (const key of [
      "authoredFacadeTexture", "authoredStoneTexture", "authoredBrickTexture", "authoredRoadTexture",
      "authoredPavementTexture", "authoredCourtTexture", "authoredDepotTexture",
    ]) assert.equal(state.world.stats[key], true, `${key} must decode and bind before READY`);
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, 0);
    assert.equal(state.diagnostics.headlights.stableLightSet, true,
      "vehicle headlights must switch with intensity rather than invalidating Three's scene-light cache");

    if (state.player.inVehicle) await control.request("exitVehicle");
    await control.request("clearWanted");
    await control.request("setTime", { hours: 12.5 });
    await control.request("setWeather", { rain: 0, immediate: true });
    const baseline = await measure(control);
    verifyWindow("dry daylight baseline", baseline);

    await control.request("resetFrameTiming");
    const aimStart = performance.now();
    await control.request("aim", { down: true });
    await wait(950);
    state = await control.request("render");
    const firstAimRoundTripMs = performance.now() - aimStart - 950;
    const aim = state.diagnostics.frameTiming;
    assert.equal(state.diagnostics.camera.perspective, "first-person-aim");
    assert.equal(state.diagnostics.firstPersonWeapon.visible, true);
    assert.ok(firstAimRoundTripMs < 250,
      `first prewarmed aim presentation took ${firstAimRoundTripMs.toFixed(1)}ms after transition time`);
    verifyWindow("first-person aim", aim);
    await control.request("aim", { down: false });
    await wait(450);

    await control.request("teleport", { x: -8, z: 7 });
    await control.request("setTime", { hours: 23 });
    await control.request("setWeather", { rain: 0.95, immediate: true });
    await control.request("setWanted", { heat: 90 });
    const pedestrianId = await control.request("spawnPed", { id: "native-perf-ragdoll", x: -8, z: 1, routine: "nightlife" });
    const shot = await control.request("shootAt", { target: pedestrianId });
    if (!shot.hit || shot.target !== pedestrianId) {
      await control.request("damage", { target: pedestrianId, amount: 45, source: "native performance setup" });
    }
    await control.request("damage", { target: pedestrianId, amount: 90, source: "native performance setup" });
    const impactState = await control.request("snapshot");
    const ragdollAtImpact = impactState.population.find(actor => actor.id === pedestrianId);
    assert.equal(ragdollAtImpact?.ragdoll, true,
      "a severe human impact should immediately enter the articulated ragdoll simulation");
    const heavyScene = await measure(control, 1_500);
    state = await control.request("snapshot");
    const ragdolled = state.population.find(actor => actor.id === pedestrianId);
    assert.ok(ragdolled && !ragdolled.alive,
      "the impact victim should settle into the pooled down-state after the ragdoll completes");
    assert.ok(state.vehicles.some(vehicle => vehicle.driver === "police" && vehicle.visibleOccupants === 2),
      "the performance scene should include occupied response cars");
    assert.ok(state.diagnostics.effects.active > 0, "the performance scene should retain pooled impact/blood effects");
    assert.equal(state.diagnostics.populationSpawnReserve.claimed, 1,
      "the native test pedestrian should claim one startup-prepared actor");
    assert.equal(state.diagnostics.populationSpawnReserve.runtimeActorAllocations, 0,
      "gameplay must not construct a pedestrian render hierarchy after startup warmup");
    verifyWindow("night rain, police, blood and ragdoll", heavyScene);

    console.log(JSON.stringify({
      backend: state.diagnostics.backend,
      warmup: state.diagnostics.pipelineWarmup,
      simulationWarmup: state.diagnostics.simulationWarmup,
      populationSpawnReserve: state.diagnostics.populationSpawnReserve,
      baseline,
      aim,
      firstAimRoundTripMs,
      heavyScene,
      policeOccupants: state.vehicles.filter(vehicle => vehicle.driver === "police").map(vehicle => ({
        id: vehicle.id,
        visibleOccupants: vehicle.visibleOccupants,
      })),
      ragdollAtImpact,
      ragdoll: ragdolled,
      activeEffects: state.diagnostics.effects.active,
    }, null, 2));
  } finally {
    await control.request("aim", { down: false }).catch(() => {});
    await control.request("clearWanted").catch(() => {});
    control.close();
  }
}

await main();
