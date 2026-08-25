import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import net from "node:net";

const pipePath = process.argv[2];
const thirdPersonPath = process.argv[3] ?? null;
const ironSightsPath = process.argv[4] ?? null;
if (!pipePath) throw new TypeError("Usage: node tests/native-camera-qa.mjs <pipe> [third-person.png] [iron-sights.png]");

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
      clearTimeout(pending.timeout);
      if (response.ok) pending.resolve(response.result);
      else pending.reject(new Error(response.error));
    }
  }
  request(op, values = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native camera request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.write(`${JSON.stringify({ id, op, ...values })}\n`);
    });
  }
  close() { this.socket.end(); }
}

async function connectWithRetry(path, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const socket = await new Promise((resolve, reject) => {
        const candidate = net.createConnection(path);
        candidate.once("connect", () => resolve(candidate));
        candidate.once("error", reject);
      });
      return new Client(socket);
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw lastError ?? new Error("native camera pipe did not become ready");
}

function finiteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

async function main() {
  const control = await connectWithRetry(pipePath);
  try {
    await control.request("aim", { down: false });
    let state = await control.request("snapshot");
    for (let index = 0; index < 4 && state.story.active; ++index) {
      await control.request("story", { action: "advance", skip: true });
      await control.request("advance", { steps: 2 });
      state = await control.request("snapshot");
    }
    await control.request("look", { x: 260, y: 92 });
    await control.request("advance", { steps: 75 });
    state = await control.request("render");
    assert.equal(state.diagnostics.camera.perspective, "third-person");
    assert.ok(Math.abs(state.diagnostics.camera.rotation[2]) < 1e-6, state.diagnostics.camera);
    assert.ok(state.diagnostics.camera.worldUp[1] > 0.72, state.diagnostics.camera);
    assert.ok(finiteVector(state.diagnostics.camera.quaternion, 4));
    assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1);
    assert.ok(state.diagnostics.presentation.presentations >= 1);
    assert.equal(state.diagnostics.pipelineWarmup.ready, true);
    assert.equal(state.diagnostics.pipelineWarmup.passes.length, 2);
    assert.equal(state.diagnostics.pipelineWarmup.storage, "memory-only");
    assert.equal(state.diagnostics.pipelineWarmup.diskCache, false);
    assert.equal(state.diagnostics.pipelineWarmup.queueSettledBeforePlay, true);
    assert.equal(state.diagnostics.firstPersonWeapon.visible, false);
    if (thirdPersonPath) {
      await control.request("screenshot", { path: thirdPersonPath, width: 1280, height: 720 });
      assert.ok((await stat(thirdPersonPath)).size > 40_000);
    }

    const ammoBeforeHipFire = state.player.ammo.clip;
    await control.request("action", { action: "fire" });
    await control.request("advance", { steps: 1 });
    state = await control.request("snapshot");
    assert.equal(state.player.ammo.clip, ammoBeforeHipFire, "native hip fire must be blocked");

    await control.request("aim", { down: true });
    await control.request("advance", { steps: 55 });
    const aimRenderStarted = performance.now();
    state = await control.request("render");
    const aimRenderMs = performance.now() - aimRenderStarted;
    assert.ok(aimRenderMs < 250, `prewarmed first-person presentation stalled for ${aimRenderMs.toFixed(1)}ms`);
    assert.equal(state.diagnostics.camera.perspective, "first-person-aim");
    assert.equal(state.diagnostics.firstPersonWeapon.mode, "iron-sights");
    assert.equal(state.diagnostics.firstPersonWeapon.visible, true);
    assert.ok(Math.abs(state.diagnostics.camera.rotation[2]) < 1e-6, state.diagnostics.camera);
    assert.ok(state.diagnostics.camera.worldUp[1] > 0.72, state.diagnostics.camera);
    const playerEye = [state.player.position[0], state.player.position[1] + 1.65, state.player.position[2]];
    const eyeDistance = Math.hypot(...state.diagnostics.camera.position.map((value, index) => value - playerEye[index]));
    assert.ok(eyeDistance < 0.48, { eyeDistance, camera: state.diagnostics.camera.position, playerEye });
    if (ironSightsPath) {
      await control.request("screenshot", { path: ironSightsPath, width: 1280, height: 720 });
      assert.ok((await stat(ironSightsPath)).size > 40_000);
    }
    const ammoBeforeSightedFire = state.player.ammo.clip;
    await control.request("action", { action: "fire" });
    await control.request("advance", { steps: 1 });
    state = await control.request("snapshot");
    assert.equal(state.player.ammo.clip, ammoBeforeSightedFire - 1, "iron-sight fire should consume one round");
    await control.request("aim", { down: false });
    await control.request("advance", { steps: 55 });
    state = await control.request("snapshot");
    assert.equal(state.diagnostics.camera.perspective, "third-person");
    assert.equal(state.diagnostics.firstPersonWeapon.visible, false);
    console.log(JSON.stringify({
      ready: state.ready,
      presentation: state.diagnostics.presentation,
      pipelineWarmup: state.diagnostics.pipelineWarmup,
      camera: state.diagnostics.camera,
      weapon: state.diagnostics.firstPersonWeapon,
      frameTiming: state.diagnostics.frameTiming,
      staticLights: state.world.stats.staticLights,
      virtualInteriorStyles: state.world.stats.virtualInteriorStyles,
      aimRenderMs,
      thirdPersonPath,
      ironSightsPath,
    }, null, 2));
  } finally {
    control.close();
  }
}

await main();
