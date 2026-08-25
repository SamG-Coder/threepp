import assert from "node:assert/strict";
import net from "node:net";

const pipePath = process.argv[2];
if (!pipePath) throw new TypeError("Usage: node tests/native-spatial-audio-qa.mjs <pipe>");

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
      else pending.reject(new Error(response.error || "native spatial-audio request failed"));
    }
  }
  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native spatial-audio request timed out: ${op}`));
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
  throw lastError ?? new Error("native spatial-audio pipe did not become ready");
}

function addScaled(origin, direction, scale) {
  return origin.map((value, index) => value + direction[index] * scale);
}

function assertFiniteVector(value, label) {
  assert.ok(Array.isArray(value) && value.length === 3 && value.every(Number.isFinite), `${label}: ${value}`);
}

async function main() {
  const control = await connectWithRetry(pipePath);
  try {
    await control.request("advance", { steps: 2 });
    let state = await control.request("snapshot");
    assert.equal(state.ready, true);
    const baseline = state.diagnostics.audio;
    assert.equal(baseline.backend, "native-html-audio-stereo-file-pairs");
    assert.equal(baseline.policy, "startup-preloaded-fixed-stereo-pairs");
    assert.equal(baseline.filesReady, true);
    assert.equal(baseline.runtimeElementAllocations, 0);
    assert.equal(baseline.runtimeSourceLoads, 0);
    assert.equal(baseline.currentElementCount, baseline.startupElementCount);
    assert.ok(baseline.precreatedVoicePairs >= 24);
    for (const key of ["position", "forward", "right", "up"]) {
      assertFiniteVector(baseline.listener[key], `listener.${key}`);
    }
    const camera = state.diagnostics.camera.position;
    assert.ok(Math.hypot(...baseline.listener.position.map((value, index) => value - camera[index])) < 0.02,
      "audio listener must follow the resolved active camera");

    const rightPosition = addScaled(baseline.listener.position, baseline.listener.right, 12);
    const leftPosition = addScaled(baseline.listener.position, baseline.listener.right, -12);
    let result = await control.request("audio", {
      action: "playAt", name: "gunshot", volume: 0.8,
      x: rightPosition[0], y: rightPosition[1], z: rightPosition[2],
    });
    const rightEvent = result.event;
    result = await control.request("audio", {
      action: "playAt", name: "gunshot", volume: 0.8,
      x: leftPosition[0], y: leftPosition[1], z: leftPosition[2],
    });
    const leftEvent = result.event;
    assert.ok(rightEvent.pan > 0.99 && leftEvent.pan < -0.99);
    assert.ok(rightEvent.rightGain > rightEvent.leftGain && leftEvent.leftGain > leftEvent.rightGain);
    const expectedPower = (0.8 * rightEvent.attenuation) ** 2;
    assert.ok(Math.abs(rightEvent.leftGain ** 2 + rightEvent.rightGain ** 2 - expectedPower) < 1e-8);

    const nearPosition = addScaled(baseline.listener.position, baseline.listener.forward, 6);
    const farPosition = addScaled(baseline.listener.position, baseline.listener.forward, 60);
    const rejectedPosition = addScaled(baseline.listener.position, baseline.listener.forward, 181);
    const near = (await control.request("audio", {
      action: "playAt", name: "gunshot", volume: 1,
      x: nearPosition[0], y: nearPosition[1], z: nearPosition[2],
    })).event;
    const far = (await control.request("audio", {
      action: "playAt", name: "gunshot", volume: 1,
      x: farPosition[0], y: farPosition[1], z: farPosition[2],
    })).event;
    const rejected = (await control.request("audio", {
      action: "playAt", name: "gunshot", volume: 1,
      x: rejectedPosition[0], y: rejectedPosition[1], z: rejectedPosition[2],
    })).event;
    assert.ok(far.attenuation < near.attenuation * 0.2);
    assert.equal(rejected.accepted, false);

    const pairCount = baseline.pairCounts.gunshot;
    const wrappedIndices = [];
    for (let index = 0; index <= pairCount; ++index) {
      wrappedIndices.push((await control.request("audio", {
        action: "playAt", name: "gunshot", volume: 0.4,
        x: nearPosition[0], y: nearPosition[1], z: nearPosition[2],
      })).event.voiceIndex);
    }
    const expectedIndices = Array.from({ length: pairCount + 1 }, (_, index) =>
      (far.voiceIndex + 1 + index) % pairCount);
    assert.deepEqual(wrappedIndices, expectedIndices,
      "fixed voice cursor must wrap rather than allocate");
    state = await control.request("snapshot");
    assert.equal(state.diagnostics.audio.currentElementCount, baseline.currentElementCount);
    assert.equal(state.diagnostics.audio.runtimeElementAllocations, 0);
    assert.equal(state.diagnostics.audio.runtimeSourceLoads, 0);

    await control.request("setWanted", { heat: 90 });
    await control.request("advance", { steps: 4 });
    state = await control.request("snapshot");
    assert.ok(state.diagnostics.audio.activeSirenSource,
      "wanted response must route the nearest occupied police car into the prestarted siren pair");
    assert.equal(state.diagnostics.audio.siren.active, true);
    assert.ok(Number.isFinite(state.diagnostics.audio.siren.pan));
    await control.request("clearWanted");
    await control.request("advance", { steps: 2 });
    state = await control.request("snapshot");
    assert.equal(state.diagnostics.audio.activeSirenSource, null);
    assert.equal(state.diagnostics.audio.siren.leftGain, 0);
    assert.equal(state.diagnostics.audio.siren.rightGain, 0);
    assert.equal(state.diagnostics.audio.currentElementCount, baseline.currentElementCount);

    console.log(JSON.stringify({
      ready: state.ready,
      baseline,
      rightEvent,
      leftEvent,
      near,
      far,
      rejected,
      wrappedIndices,
      final: state.diagnostics.audio,
    }, null, 2));
  } finally {
    control.close();
  }
}

await main();
