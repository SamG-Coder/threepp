import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sampleRoot = new URL("../", import.meta.url);
const entry = await readFile(new URL("site-entry.mjs", sampleRoot), "utf8");
const estimator = await readFile(
  new URL("src/relief-estimator.mjs", sampleRoot),
  "utf8",
);
const manifest = JSON.parse(
  await readFile(new URL("threebrowser.pull.json", sampleRoot), "utf8"),
);

test("the fixed topology fits its deliberately tight position atlas", () => {
  const currentVertexCount = 223 * 223 * 4;
  const echoVertexCount = 63 * 63 * 4;
  const vertexCount = currentVertexCount + 4 * echoVertexCount;
  const triangleCount = 223 * 223 * 2 + 4 * 63 * 63 * 2;

  assert.equal(vertexCount, 262_420);
  assert.equal(triangleCount, 131_210);
  assert.ok(512 * 513 >= vertexCount);
  assert.ok(512 * 512 < vertexCount);
  assert.match(entry, /POSITION_ATLAS_WIDTH = 512/);
  assert.match(entry, /POSITION_ATLAS_HEIGHT = 513/);
  assert.match(entry, /for \(let vertex = 0; vertex < DYNAMIC_VERTEX_COUNT; vertex \+= 4\)/);
});

test("low-confidence current and echo cells collapse to shared anchors", () => {
  assert.match(entry, /let anchor = sourcePosition\(cellPixel\)\.xyz/);
  assert.match(entry, /let anchorPixel = echoPixel\(cellPixel\)/);
  assert.match(
    entry,
    /if \(confidence < params\.shape\.y\) \{\s*point = echoTransform\(slot, sourcePosition\(anchorPixel\)\.xyz\)/,
  );
  assert.match(entry, /echoConfidence\(cellPixel\)/);
});

test("each RTX frame preserves pack, refit, lighting, submit order", () => {
  const frame = entry.slice(entry.indexOf("async function renderFrame"));
  const pack = frame.indexOf("positionPacker.record(encoder");
  const refit = frame.indexOf("rtx.refitDynamicTriangleMesh");
  const gate = frame.indexOf("if (state.raysEnabled)");
  const lighting = frame.indexOf("rtx.evaluateRayLighting");
  const submit = frame.indexOf("device.queue.submit([encoder.finish()])");

  assert.ok(pack >= 0 && pack < refit);
  assert.ok(refit < gate && gate < lighting);
  assert.ok(lighting < submit);
  assert.doesNotMatch(entry, /mapAsync|getMappedRange|copyTextureToBuffer/);
});

test("the production sample is clean-room MJS with explicit heuristic labels", () => {
  const production = `${entry}\n${estimator}\n${JSON.stringify(manifest)}`;
  assert.doesNotMatch(production, /ChronoLight|DepthART|TypeGPU|world[ -]?first/i);
  assert.match(production, /NON-NEURAL \/ NON-METRIC/);
  assert.match(entry, /createReliefEstimator\(\{ device, historyBlend: 0 \}\)/);
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.requiresWebGPU, true);
});
