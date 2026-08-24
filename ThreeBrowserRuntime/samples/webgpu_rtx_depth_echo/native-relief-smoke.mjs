// Manual-only native validation, intentionally excluded from the pull
// manifest/default tests. Run through ThreeBrowserRuntime/run.ps1 so the
// sibling requiresWebGPU manifest installs the real navigator.gpu bridge.
import { createReliefEstimator } from "./src/relief-estimator.mjs";

const OUTPUT = 224;
const ROW_BYTES = OUTPUT * 4 * Float32Array.BYTES_PER_ELEMENT;

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Native relief smoke failed: ${message}`);
}

function sourceFrame() {
  const width = 96;
  const height = 80;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      const u = x / (width - 1);
      const v = y / (height - 1);
      const dx = (u - 0.5) / 0.28;
      const dy = (v - 0.48) / 0.39;
      const subject = Math.max(0, 1 - dx * dx - dy * dy);
      const stripe = ((x >> 3) & 1) * 20;
      const offset = (y * width + x) * 4;
      data[offset] = 20 + Math.round(subject * 205);
      data[offset + 1] = 32 + Math.round(subject * 136) + stripe;
      data[offset + 2] = 56 + Math.round(subject * 72);
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, sequence: 1 };
}

async function readPositions(device, texture) {
  const byteLength = ROW_BYTES * OUTPUT;
  const buffer = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow: ROW_BYTES, rowsPerImage: OUTPUT },
    { width: OUTPUT, height: OUTPUT, depthOrArrayLayers: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ, 0, byteLength);
  const values = new Float32Array(buffer.getMappedRange(0, byteLength).slice(0));
  buffer.unmap();
  buffer.destroy();
  return values;
}

let device;
let estimator;
try {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  requireCondition(adapter, "no native WebGPU adapter");
  device = await adapter.requestDevice();
  estimator = createReliefEstimator({ device });
  await estimator.init();
  const source = sourceFrame();
  const first = await estimator.update({ source });
  const values = await readPositions(device, first.positionsTexture);
  requireCondition(values.length === OUTPUT * OUTPUT * 4, `float count ${values.length}`);

  let zMinimum = Infinity;
  let zMaximum = -Infinity;
  let confidenceMinimum = Infinity;
  let confidenceMaximum = -Infinity;
  for (let index = 0; index < values.length; index += 4) {
    const [x, y, z, confidence] = values.subarray(index, index + 4);
    requireCondition(
      Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) && Number.isFinite(confidence),
      `non-finite texel ${index / 4}`,
    );
    zMinimum = Math.min(zMinimum, z);
    zMaximum = Math.max(zMaximum, z);
    confidenceMinimum = Math.min(confidenceMinimum, confidence);
    confidenceMaximum = Math.max(confidenceMaximum, confidence);
  }
  const topLeft = 0;
  const topRight = (OUTPUT - 1) * 4;
  const bottomLeft = (OUTPUT - 1) * OUTPUT * 4;
  requireCondition(Math.abs(values[topLeft] + 3.2) < 1e-4, `left x ${values[topLeft]}`);
  requireCondition(Math.abs(values[topRight] - 3.2) < 1e-4, `right x ${values[topRight]}`);
  requireCondition(Math.abs(values[topLeft + 1] - 3.2) < 1e-4, `top y ${values[topLeft + 1]}`);
  requireCondition(Math.abs(values[bottomLeft + 1] + 3.2) < 1e-4, `bottom y ${values[bottomLeft + 1]}`);
  requireCondition(zMinimum >= -0.2001 && zMaximum <= 1.3501, `z range ${zMinimum}..${zMaximum}`);
  requireCondition(confidenceMinimum >= 0 && confidenceMaximum <= 1, `confidence range ${confidenceMinimum}..${confidenceMaximum}`);
  requireCondition(confidenceMaximum - confidenceMinimum > 0.1, "confidence field has no useful variation");

  source.sequence += 1;
  const mirrored = await estimator.update({ source, mirrorX: true });
  requireCondition(mirrored.positionsTexture === first.positionsTexture, "output texture identity changed");
  const mirroredValues = await readPositions(device, mirrored.positionsTexture);
  requireCondition(Math.abs(mirroredValues[topLeft] - 3.2) < 1e-4, `mirrored left x ${mirroredValues[topLeft]}`);
  requireCondition(Math.abs(mirroredValues[topRight] + 3.2) < 1e-4, `mirrored right x ${mirroredValues[topRight]}`);

  console.log(
    `[Depth Echo native smoke] PASS 224x224 rgba32float` +
    ` z=${zMinimum.toFixed(5)}..${zMaximum.toFixed(5)}` +
    ` confidence=${confidenceMinimum.toFixed(5)}..${confidenceMaximum.toFixed(5)}` +
    ` encode+submit=${first.encodeSubmitMs.toFixed(3)}ms` +
    ` persistent=true mirror=true`,
  );
} finally {
  estimator?.dispose?.();
  device?.destroy?.();
}

setImmediate(() => process.exit(0));
