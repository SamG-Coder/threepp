import assert from "node:assert/strict";
import net from "node:net";

const pipePath = process.argv[2];
const homeScreenshotPath = process.argv[3] ?? null;
const screenshotPath = process.argv[4] ?? homeScreenshotPath;
const transitionScreenshotPath = process.argv[5] ?? null;
if (!pipePath) throw new TypeError("Usage: node tests/native-phone-qa.mjs <pipe> [phone.png]");

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
  throw new Error("phone QA could not connect to the native game");
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
  await request("action", { action: "phone" });
  let state = (await request("advance", { steps: 2 })).state;
  assert.equal(state.phone.open, true);
  assert.equal(state.phone.title, "NEON LIFE");
  assert.equal(state.phone.items.length, 7);
  assert.equal(state.phone.items[4]?.title, "LIFE PROFILE");
  assert.equal(state.phone.items[5]?.title, "MY HOME");
  assert.equal(state.phone.items[6]?.title, "NEON MAP");
  assert.equal(state.diagnostics.phoneCanvasRedraws, 1,
    "the complete launcher must already be rasterized before the first visible phone frame");
  const residentRedraws = state.diagnostics.phoneCanvasRedraws;
  state = (await request("advance", { steps: 30 })).state;
  assert.equal(state.phone.openProgress, 1);
  if (homeScreenshotPath) await request("screenshot", { path: homeScreenshotPath });
  await request("action", { action: "interact" });
  state = (await request("advance", { steps: 2 })).state;
  assert.equal(state.phone.app, "wallet");
  assert.match(state.phone.subtitle, /AVAILABLE/);
  assert.ok(state.phone.appProgress > 0 && state.phone.appProgress < 1,
    "the first app frames should exercise the retained-launcher reveal");
  assert.equal(state.diagnostics.phoneCanvasRedraws, residentRedraws,
    "first app open must select a prewarmed texture and never dirty a CanvasTexture");
  if (transitionScreenshotPath) await request("screenshot", { path: transitionScreenshotPath });
  state = (await request("advance", { steps: 30 })).state;
  assert.equal(state.phone.appProgress, 1);
  assert.equal(state.diagnostics.phoneCanvasRedraws, residentRedraws,
    "the complete app transition must remain texture-upload free");
  if (screenshotPath) await request("screenshot", { path: screenshotPath });
  state = await request("render");
  const redrawsBeforeClockAdvance = state.diagnostics.phoneCanvasRedraws;
  await request("advance", { steps: 600 });
  state = await request("render");
  assert.equal(
    state.diagnostics.phoneCanvasRedraws,
    redrawsBeforeClockAdvance,
    "accelerated clock ticks must not redraw the resident phone canvas",
  );
  console.log(JSON.stringify({ phone: state.phone, screenshotPath }, null, 2));
} finally {
  socket.end();
}
