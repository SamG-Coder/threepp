import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const pipePath = process.argv[2];
const outputDirectory = process.argv[3];
if (!pipePath || !outputDirectory) {
  throw new TypeError("Usage: node tests/native-story-life-qa.mjs <pipe> <output-directory>");
}

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
      else pending.reject(new Error(response.error));
    }
  }
  request(op, values = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`native story/life request timed out: ${op}`));
      }, op === "screenshot" ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...values, id, op })}\n`);
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
  throw lastError ?? new Error("native story/life pipe did not become ready");
}

async function capture(control, name) {
  const file = path.join(outputDirectory, `${name}.png`);
  await control.request("screenshot", { path: file, width: 1280, height: 720 });
  assert.ok((await stat(file)).size > 30_000, `${name} native frame is unexpectedly small`);
  return file;
}

async function main() {
  const control = await connectWithRetry(pipePath);
  const captures = {};
  try {
    let state = await control.request("snapshot");
    assert.equal(state.ready, true);
    assert.equal(state.capture.locked, true);
    assert.equal(state.capture.synthetic, true);
    assert.equal(state.diagnostics.presentation.swapchainRendersPerFrame, 1);
    assert.equal(state.diagnostics.pipelineWarmup.ready, true);
    assert.equal(state.world.stats.authoredFacadeTexture, true,
      "the bundled weathered facade bitmap should load through the native virtual URL");
    assert.equal(state.world.stats.authoredBrickTexture, true,
      "the bundled aged-brick bitmap should load through the native virtual URL");
    assert.equal(state.world.stats.authoredRoadTexture, true,
      "the authored worn asphalt should be decoded before startup warmup");
    assert.equal(state.world.stats.authoredPavementTexture, true,
      "the authored aggregate pavement should be decoded before startup warmup");
    assert.equal(state.world.stats.authoredDepotTexture, true,
      "Southline's authored corrugated cladding should be decoded before startup warmup");
    assert.ok(state.world.stats.cafeFurniture >= 24);
    assert.ok(state.world.stats.streetClutter >= 20);
    assert.ok(state.lifeActivities.length >= 4);
    assert.equal(state.story.chapter.title, "HOME AGAIN");

    await control.request("setWeather", { rain: 0, immediate: true });
    await control.request("setTime", { hours: 12 });
    await control.request("advance", { steps: 3 });
    state = await control.request("render");
    assert.ok(state.environment.daylight > 0.98, state.environment);
    assert.ok(state.diagnostics.lighting.streetlightFactor < 0.01, state.diagnostics.lighting);
    assert.equal(state.diagnostics.lighting.practicalLightsOn, 0);
    captures.noon = await capture(control, "01-noon-practicals-off");

    await control.request("setTime", { hours: 17.75 });
    await control.request("advance", { steps: 3 });
    state = await control.request("render");
    assert.ok(state.environment.phase === "golden-hour" || state.environment.phase === "sunset", state.environment);
    captures.goldenHour = await capture(control, "02-golden-hour-transition");

    await control.request("setTime", { hours: 23 });
    await control.request("advance", { steps: 3 });
    state = await control.request("render");
    assert.ok(state.environment.night > 0.95, state.environment);
    assert.ok(state.diagnostics.lighting.streetlightFactor > 0.98, state.diagnostics.lighting);
    assert.ok(state.diagnostics.lighting.practicalLightsOn >= 40, state.diagnostics.lighting);
    assert.ok(state.vehicles.some(vehicle => vehicle.headlightsOn), "night traffic should cast real low-beam light");
    captures.night = await capture(control, "03-night-practicals-on");

    await control.request("setTime", { hours: 9.5 });
    const life = await control.request("startLife", { activityId: "city_lens" });
    assert.equal(life.kind, "photography");
    assert.equal(life.status, "active");
    await control.request("advance", { steps: 3 });
    state = await control.request("render");
    assert.equal(state.activity.title, "CITY LENS");
    assert.match(state.activity.objective, /PRESS E/i);
    captures.life = await capture(control, "04-peaceful-city-lens");
    await control.request("cancelActivity");
    await control.request("advance", { steps: 420 });

    let story = await control.request("story", { action: "begin" });
    assert.equal(story.sequenceId, "homecoming");
    await control.request("advance", { steps: 60 });
    state = await control.request("render");
    assert.equal(state.story.cinematic, true);
    assert.equal(state.diagnostics.cinematic.active, true);
    assert.equal(state.story.line.speaker, "NEON CITY");
    captures.opening = await capture(control, "05-story-homecoming");

    story = await control.request("story", { action: "advance", skip: true });
    assert.equal(story.phase, "meet_juno");
    await control.request("teleport", { x: state.mission.startPosition[0], z: state.mission.startPosition[2] });
    story = await control.request("story", { action: "notify", event: "contact_interacted" });
    assert.equal(story.sequenceId, "garage_briefing");
    await control.request("advance", { steps: 75 });
    state = await control.request("render");
    assert.equal(state.story.line.speaker, "JUNO");
    assert.match(state.story.line.text, /Marisol/i);
    assert.equal(state.story.controlsLocked, true);
    captures.briefing = await capture(control, "06-story-garage-briefing");

    story = await control.request("story", { action: "advance" });
    assert.equal(story.line.speaker, "RIN");
    assert.equal(story.line.shot, "rin_close");
    await control.request("advance", { steps: 24 });
    state = await control.request("render");
    captures.rinForgery = await capture(control, "07-story-rin-forged-order");

    story = await control.request("story", { action: "advance" });
    assert.equal(story.line.speaker, "RIN");
    assert.equal(story.line.shot, "garage_two_shot");
    assert.match(story.line.text, /threatened their families/i);
    await control.request("advance", { steps: 24 });
    state = await control.request("render");
    captures.rinEvidence = await capture(control, "08-story-rin-coerced-sources");

    story = await control.request("story", { action: "advance" });
    assert.equal(story.line.speaker, "KAI");
    assert.equal(story.line.shot, "kai_garage_close");
    await control.request("advance", { steps: 24 });
    state = await control.request("render");
    captures.kaiResponse = await capture(control, "09-story-kai-response");

    story = await control.request("story", { action: "advance" });
    assert.equal(story.line.speaker, "JUNO");
    assert.equal(story.line.shot, "juno_close");
    await control.request("advance", { steps: 24 });
    state = await control.request("render");
    captures.junoInstruction = await capture(control, "10-story-juno-instruction");

    console.log(JSON.stringify({
      ready: state.ready,
      chapter: state.story.chapter,
      story: {
        phase: state.story.phase,
        sequenceId: state.story.sequenceId,
        speaker: state.story.line?.speaker,
      },
      storyActors: state.population.filter(actor => actor.storyRole).map(actor => ({
        id: actor.id,
        role: actor.storyRole,
        position: actor.position,
      })),
      cinematic: state.diagnostics.cinematic,
      camera: state.diagnostics.camera,
      peacefulActivities: state.lifeActivities.map(activity => activity.title),
      lighting: state.diagnostics.lighting,
      presentation: state.diagnostics.presentation,
      pipelineWarmupMs: state.diagnostics.pipelineWarmup.durationMs,
      captures,
    }, null, 2));
  } finally {
    control.close();
  }
}

await main();
