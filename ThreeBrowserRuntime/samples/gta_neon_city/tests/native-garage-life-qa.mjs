import assert from "node:assert/strict";
import net from "node:net";
import { GARAGE_FAULTS } from "../src/game/garage-shift.mjs";

const pipePath = process.argv[2];
const screenshotPath = process.argv[3] ?? null;
if (!pipePath) throw new TypeError("Usage: node tests/native-garage-life-qa.mjs <pipe> [garage.png]");

async function connect(path, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.createConnection(path);
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch {
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  throw new Error("garage QA could not connect to the native game");
}

const socket = await connect(pipePath);
socket.setEncoding("utf8");
let sequence = 0;
let buffer = "";
const pending = new Map();
socket.on("data", chunk => {
  buffer += chunk;
  for (;;) {
    const end = buffer.indexOf("\n");
    if (end < 0) break;
    const value = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const callback = pending.get(value.id);
    if (!callback) continue;
    pending.delete(value.id);
    value.ok ? callback.resolve(value.result) : callback.reject(new Error(value.error));
  }
});
const request = (op, values = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.write(`${JSON.stringify({ id, op, ...values })}\n`);
});

try {
  await request("garageShift", { action: "reset" });
  await request("setTime", { hours: 8.25 });
  await request("teleport", { x: -153, z: 84.7 });
  await request("face", { x: -153, z: 80 });
  const started = await request("startGarageShift");
  assert.equal(started.status, "active", JSON.stringify(started));
  assert.equal(started.stage, "customer_greeting");

  let state = (await request("advance", { steps: 30 })).state;
  assert.equal(state.world.pulseGarageInterior.stats.stations, 4);
  assert.equal(state.world.pulseGarageInterior.stats.renderMeshes >= 40, true);
  assert.equal(state.diagnostics.simulationWarmup.garageShiftPrepared.ready, true);
  assert.equal(state.diagnostics.simulationWarmup.lifeProfilePrepared.ready, true);
  assert.equal(
    state.population.some(actor => actor.presentationKind === "garage-customer" && actor.presentationVisible &&
      actor.displayName === state.garageShift.customerName),
    true,
    JSON.stringify({
      staged: state.population.filter(actor => actor.presentationKind || actor.presentationKey),
      ordinary: state.population.filter(actor => !actor.police && !actor.storyRole && actor.active && actor.alive)
        .map(actor => ({ id: actor.id, state: actor.state, locked: actor.storyLocked, protected: actor.storyProtected })),
      reserve: state.diagnostics.populationSpawnReserve,
    }),
  );
  if (screenshotPath) await request("screenshot", { path: screenshotPath, width: 1280, height: 720 });

  await request("garageShift", { action: "greet" });
  for (let index = 0; index < 3; ++index) await request("garageShift", { action: "inspect" });

  let confirmedFault = null;
  for (const fault of GARAGE_FAULTS) {
    const result = await request("garageShift", { action: "diagnose", diagnosisId: fault.id });
    if (result.garageShift.stage === "parts") {
      confirmedFault = fault;
      break;
    }
  }
  assert.ok(confirmedFault, "one authored diagnosis must fit the seeded work order");
  await request("garageShift", { action: "parts", partIds: confirmedFault.parts });
  await request("garageShift", { action: "repair", seconds: 30 });
  state = await request("snapshot");
  assert.equal(state.garageShift.stage, "safety_check");
  for (const check of state.garageShift.safetyChecks) {
    await request("garageShift", { action: "safety", checkId: check.id });
  }

  const cashBefore = (await request("snapshot")).player.cash;
  const completion = await request("garageShift", { action: "invoice" });
  assert.equal(completion.garageShift.status, "completed");
  assert.equal(completion.lifeProfile.shiftsCompleted, 1);
  assert.equal(completion.lifeProfile.skillById.mechanics.experience > 0, true);
  assert.equal(completion.player.cash > cashBefore, true);

  const save = await request("save");
  const restored = await request("restore", { snapshot: save });
  assert.equal(restored.version, 14);
  state = await request("snapshot");
  assert.equal(state.lifeProfile.shiftsCompleted, 1);
  assert.equal(state.garageShift.totalEarned > 0, true);
  console.log(JSON.stringify({
    screenshotPath,
    garage: state.garageShift,
    profile: state.lifeProfile,
  }, null, 2));
} finally {
  socket.end();
}
