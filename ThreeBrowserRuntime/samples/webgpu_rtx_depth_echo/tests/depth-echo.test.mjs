import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relative => fs.readFileSync(path.join(sampleRoot, relative), "utf8");
const source = read("site-entry.mjs");
const manifest = JSON.parse(read("threebrowser.pull.json"));

test("fixed independent-quad topology fits one rgba32float atlas", () => {
  const currentCells = 223 * 223;
  const echoCells = 4 * 63 * 63;
  assert.equal((currentCells + echoCells) * 4, 262_420);
  assert.equal((currentCells + echoCells) * 2, 131_210);
  assert.ok(512 * 513 >= 262_420);
  assert.match(source, /CURRENT_CELL_WIDTH = RELIEF_WIDTH - 1/);
  assert.match(source, /ECHO_COUNT = 4/);
  assert.match(source, /POSITION_ATLAS_WIDTH = 512/);
  assert.match(source, /POSITION_ATLAS_HEIGHT = 513/);
  assert.match(source, /for \(let vertex = 0; vertex < DYNAMIC_VERTEX_COUNT; vertex \+= 4\)/);
});

test("GPU pack uses confidence-degenerate quads and bounded frozen echo sampling", () => {
  assert.match(source, /texture_storage_2d<rgba32float, write>/);
  assert.match(source, /@compute @workgroup_size\(64, 1, 1\)/);
  assert.match(source, /fn echoPixel\(pixel: vec2<u32>\)/);
  assert.match(source, /fn echoConfidence\(cellPixel: vec2<u32>\)/);
  assert.match(source, /let anchorPixel = echoPixel\(cellPixel\)/);
  assert.match(source, /point = echoTransform\(slot, sourcePosition\(anchorPixel\)\.xyz\)/);
  assert.doesNotMatch(source, /confidenceForCell\(samplePixel, stride\)/);
});

test("dynamic build and lighting preserve the documented in-order contract", () => {
  const initialPack = source.indexOf("positionPacker.record(createEncoder");
  const create = source.indexOf("rtx.createDynamicTriangleMesh({", initialPack);
  assert.ok(initialPack >= 0 && create > initialPack, "initial pack must precede dynamic create");

  const frameEncoder = source.indexOf('label: "Depth Echo pack refit and ray-tested shadows"');
  const framePack = source.indexOf("positionPacker.record(encoder", frameEncoder);
  const refit = source.indexOf("rtx.refitDynamicTriangleMesh({", framePack);
  const lighting = source.indexOf("rtx.evaluateRayLighting({", refit);
  const submit = source.indexOf("device.queue.submit([encoder.finish()])", lighting);
  assert.ok(frameEncoder >= 0 && framePack > frameEncoder);
  assert.ok(refit > framePack && lighting > refit && submit > lighting);
  assert.match(source, /positionsVulkanLayout: createLayout/);
  assert.match(source, /positionsVulkanLayout: currentPositionLayout/);
  assert.match(source, /vulkanLayout = "transferDestination"/);
  assert.match(source, /vulkanLayout = "general"/);
});

test("Q gates only ray evaluation while C remains explicit camera opt-in", () => {
  assert.match(source, /if \(key === "q"\) state\.raysEnabled = !state\.raysEnabled/);
  assert.match(source, /if \(state\.raysEnabled\) \{\s*camera\.updateMatrixWorld\(\)/);
  assert.match(source, /if \(key === "c"\) startCamera\(\)/);
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(source, /STAGED PROCEDURAL RGBA \/ NO CAMERA/);
  assert.match(source, /LIVE CAMERA \/ UNMIRRORED/);
});

test("sample is explicit about heuristic scope and has no inference dependency", () => {
  const estimator = read("src/relief-estimator.mjs");
  assert.match(estimator, /HEURISTIC LUMA\+EDGE RELIEF \/ NON-NEURAL \/ NON-METRIC/);
  assert.match(source, /createReliefEstimator\(\{ device, historyBlend: 0 \}\)/);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:typegpu|depthart)/i);
  assert.doesNotMatch(estimator, /from\s+["'][^"']*(?:typegpu|depthart)/i);
  assert.doesNotMatch(source + estimator, /fetch\s*\(|\.onnx\b|\.tflite\b|model weights/i);
});

test("pull manifest is a lean, closed three-file runtime package", () => {
  assert.equal(manifest.entry, "site-entry.mjs");
  assert.equal(manifest.requiresWebGPU, true);
  const paths = manifest.files.map(file => file.path).sort();
  assert.deepEqual(paths, ["index.html", "site-entry.mjs", "src/relief-estimator.mjs"]);
  for (const relative of paths) {
    assert.equal(fs.existsSync(path.join(sampleRoot, relative)), true, relative + " must exist");
  }
  assert.equal(manifest.compatibility.canvasOnly, true);
  assert.equal(manifest.compatibility.htmlOverlay, false);
  assert.ok(fs.statSync(path.join(sampleRoot, "site-entry.mjs")).size < 80_000);
});
