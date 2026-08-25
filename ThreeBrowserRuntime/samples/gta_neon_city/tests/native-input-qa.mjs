import assert from "node:assert/strict";
import net from "node:net";

const pipePath = process.argv[2];
if (!pipePath) throw new TypeError("Usage: node tests/native-input-qa.mjs <pipe>");

const RENDER_ONLY_FRAMES = 4;
const VEHICLE_CYCLES = 4;

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
      else pending.reject(new Error(response.error || "native input request failed"));
    }
  }

  request(op, detail = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native input request timed out: ${op}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...detail, id, op })}\n`);
    });
  }

  close() { this.socket.end(); }
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function connectWithRetry(target, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
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
      await wait(250);
    }
  }
  throw lastError ?? new Error("native input pipe did not become ready");
}

function presentationCount(state) {
  return Number(state?.diagnostics?.presentation?.presentations) || 0;
}

async function renderOnlyFrames(control, count = RENDER_ONLY_FRAMES) {
  const before = await control.request("snapshot");
  let latest = before;
  for (let index = 0; index < count; ++index) latest = await control.request("render");
  const presented = presentationCount(latest) - presentationCount(before);
  assert.ok(presented >= count,
    `${count} explicit render-only frames produced only ${presented} presentations`);
  return { before, latest, presented };
}

async function tapAcrossRenderOnlyFrames(control, action) {
  await control.request("action", { action });
  const presentation = await renderOnlyFrames(control);
  // If a natural 60 Hz tick did not interleave with the explicit high-refresh
  // presentations, this one bounded step is the first gameplay consumer. If
  // one did interleave, the same step proves the edge cannot fire twice.
  const stepped = await control.request("advance", { steps: 1 });
  return { presentation, state: stepped.state };
}

function firstChoiceId(state) {
  return state?.choice?.options?.[0]?.id ?? null;
}

async function clearBlockingNarrative(control) {
  let state = await control.request("snapshot");
  for (let guard = 0; guard < 128; ++guard) {
    if (state.nightRoute?.controlsLocked) {
      const option = firstChoiceId(state.nightRoute);
      await control.request("nightRoute", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else if (state.chapterTwo?.active || state.chapterTwo?.choice) {
      const option = firstChoiceId(state.chapterTwo);
      await control.request("chapterTwo", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else if (state.story?.active || state.story?.choice) {
      const option = firstChoiceId(state.story);
      await control.request("story", option
        ? { action: "choose", option }
        : { action: "advance", skip: true });
    } else {
      assert.equal(state.narrative?.controlsLocked, false,
        "a narrative retained control after all dialogue and choices were cleared");
      return state;
    }
    state = await control.request("snapshot");
  }
  throw new Error("blocking narrative did not settle within 128 authored transitions");
}

function chooseStableVehicle(state) {
  const candidates = state.vehicles.filter(vehicle =>
    vehicle.health > 0 && !vehicle.driver && !vehicle.police && !vehicle.missionTarget &&
    Array.isArray(vehicle.position) && vehicle.position.length >= 3);
  assert.ok(candidates.length > 0, "the native world has no stable enterable vehicle for input QA");
  return candidates.find(vehicle => vehicle.authorized && vehicle.kind !== "van") ??
    candidates.find(vehicle => vehicle.authorized) ??
    candidates.find(vehicle => vehicle.kind === "sedan") ??
    candidates[0];
}

async function stageBesideVehicle(control, vehicleId) {
  let state = await control.request("snapshot");
  if (state.player.inVehicle) {
    await control.request("exitVehicle");
    state = await control.request("snapshot");
  }
  const vehicle = state.vehicles.find(value => value.id === vehicleId);
  assert.ok(vehicle?.health > 0, `input QA vehicle ${vehicleId} is no longer enterable`);
  await control.request("teleport", {
    x: vehicle.position[0] + 2.25,
    z: vehicle.position[2],
  });
  await control.request("clearWanted");
  await control.request("advance", { steps: 1 });
  state = await control.request("render");
  assert.equal(state.player.inVehicle, null, "staging unexpectedly entered a vehicle");
  assert.match(state.prompt ?? "", /\bF\b.*(?:DRIVE|TAKE)/i,
    `staging did not expose the F vehicle affordance: ${state.prompt ?? "<missing>"}`);
  return state;
}

function storyBeat(state) {
  return {
    sequenceId: state.story.sequenceId,
    lineIndex: Number(state.story.lineIndex),
    lineText: state.story.line?.text ?? null,
  };
}

async function verifyOpeningStoryTap(control, initial) {
  if (!initial.story?.active || !initial.story?.line || !Number.isFinite(Number(initial.story.lineIndex))) {
    return null;
  }
  const before = storyBeat(initial);
  const result = await tapAcrossRenderOnlyFrames(control, "interact");
  const after = storyBeat(result.state);
  const changedSequence = after.sequenceId !== before.sequenceId;
  if (!changedSequence) {
    assert.equal(after.lineIndex, before.lineIndex + 1,
      "one buffered E tap did not advance exactly one authored story line");
  } else {
    assert.notEqual(after.lineText, before.lineText,
      "story sequence changed without leaving the opening line");
  }
  await control.request("advance", { steps: 2 });
  const settled = await control.request("snapshot");
  const settledBeat = storyBeat(settled);
  if (settledBeat.sequenceId === after.sequenceId) {
    assert.equal(settledBeat.lineIndex, after.lineIndex,
      "the single E edge repeated on a later simulation tick");
  }
  return {
    before,
    after,
    renderOnlyPresentations: result.presentation.presented,
  };
}

async function main() {
  const control = await connectWithRetry(pipePath);
  try {
    let state = await control.request("snapshot");
    assert.equal(state.ready, true, "native runtime was not ready for input QA");
    assert.equal(state.paused, false, "native input QA requires an unpaused game");

    const storyTap = await verifyOpeningStoryTap(control, state);
    state = await clearBlockingNarrative(control);
    if (state.neighbourhood?.menuOpen) await control.request("closeBusiness");
    if (state.player.inVehicle) await control.request("exitVehicle");
    state = await control.request("snapshot");

    const selected = chooseStableVehicle(state);
    const cycles = [];
    for (let cycle = 0; cycle < VEHICLE_CYCLES; ++cycle) {
      await stageBesideVehicle(control, selected.id);

      const entered = await tapAcrossRenderOnlyFrames(control, "enterExit");
      assert.equal(entered.state.player.inVehicle, selected.id,
        `cycle ${cycle + 1}: one buffered F tap did not enter ${selected.id}`);
      await control.request("advance", { steps: 3 });
      state = await control.request("snapshot");
      assert.equal(state.player.inVehicle, selected.id,
        `cycle ${cycle + 1}: the entry edge repeated and exited the vehicle`);

      const exited = await tapAcrossRenderOnlyFrames(control, "enterExit");
      assert.equal(exited.state.player.inVehicle, null,
        `cycle ${cycle + 1}: one buffered F tap did not exit ${selected.id}`);
      await control.request("advance", { steps: 3 });
      state = await control.request("snapshot");
      assert.equal(state.player.inVehicle, null,
        `cycle ${cycle + 1}: the exit edge repeated and re-entered the vehicle`);

      cycles.push({
        cycle: cycle + 1,
        vehicleId: selected.id,
        entryRenderOnlyPresentations: entered.presentation.presented,
        exitRenderOnlyPresentations: exited.presentation.presented,
      });
    }

    console.log(JSON.stringify({
      ready: state.ready,
      storyTap,
      vehicle: { id: selected.id, kind: selected.kind, authorized: selected.authorized },
      cycles,
      finalInVehicle: state.player.inVehicle,
      presentation: state.diagnostics.presentation,
      frameTiming: state.diagnostics.frameTiming,
    }, null, 2));
  } finally {
    control.close();
  }
}

await main();
