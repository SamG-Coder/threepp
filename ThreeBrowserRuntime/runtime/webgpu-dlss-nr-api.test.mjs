import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterUrl = pathToFileURL(path.resolve(
  here,
  "../../host/ThreeBrowser/web/three-webgpu-gpu.js",
));

const identity = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function constants() {
  return {
    cameraViewToClip: identity,
    clipToCameraView: identity,
    clipToLensClip: identity,
    clipToPrevClip: identity,
    prevClipToClip: identity,
    jitterOffset: [0, 0],
    motionVectorScale: [0.5, -0.5],
    cameraPinholeOffset: [0, 0],
    cameraPosition: [0, 0, 0],
    cameraUp: [0, 1, 0],
    cameraRight: [1, 0, 0],
    cameraForward: [0, 0, -1],
    cameraNear: 0.1,
    cameraFar: 1000,
    cameraFov: 1,
    cameraAspectRatio: 16 / 9,
  };
}

test("Neural Rendering options expose only styles 0, 1, and 2", async () => {
  const { normalizeNeuralRenderingOptions, replayCommandBuffer } = await import(
    `${adapterUrl.href}?dlss-nr-options-test`
  );

  for (const style of [0, 1, 2]) {
    assert.equal(normalizeNeuralRenderingOptions({ style }).style, style);
  }
  for (const style of [-1, 3, 1.5, "1", null]) {
    assert.throws(
      () => normalizeNeuralRenderingOptions({ style }),
      /options\.style must be exactly one of the integers 0, 1, or 2/,
    );
  }
  assert.equal(normalizeNeuralRenderingOptions({}).performanceMode, 6);
  for (const performanceMode of [1, 2, 3, 4, 5, "quality"]) {
    assert.throws(
      () => normalizeNeuralRenderingOptions({ performanceMode }),
      /same-resolution Neural Rendering path requires performanceMode DLAA/,
    );
  }

  const calls = [];
  const sink = new Proxy({}, {
    get(_target, property) {
      return (...args) => calls.push([property, ...args]);
    },
  });
  const packed = { options: normalizeNeuralRenderingOptions({ style: 2 }) };
  replayCommandBuffer({
    _h: 17,
    _commands: [["dlssNeuralRenderingEvaluate", packed]],
  }, sink);
  assert.deepEqual(calls, [
    ["encBegin", 17],
    ["dlssNeuralRenderingEvaluate", 17, packed],
    ["submitEncoders", [17]],
  ]);
});

test("Neural Rendering skips unavailable runtimes and records supported frames", async () => {
  const saved = {
    chrome: Object.getOwnPropertyDescriptor(globalThis, "chrome"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    htmlCanvas: Object.getOwnPropertyDescriptor(globalThis, "HTMLCanvasElement"),
  };
  let supported = false;
  let apiLoaded = false;
  const featureReason = () => !supported
    ? "feature unavailable"
    : !apiLoaded
      ? "API not loaded"
      : "ready";
  const capabilities = () => ({
    vendorId: 0x10de,
    deviceId: 1,
    rtx: true,
    streamlinePresent: true,
    streamlineInitialized: true,
    vulkanAttached: true,
    dlssNeuralRendering: supported,
    dlssNeuralRenderingApiLoaded: apiLoaded,
    adapterName: "Test NVIDIA adapter",
    status: featureReason(),
  });
  const native = {
    WebGpuCapabilities: capabilities,
    WebGpuFeatureStatus: () => ({
      apiVersion: 1,
      available: true,
      backend: "test",
      capabilities: capabilities(),
      features: {
        dlssNeuralRendering: {
          supported,
          requested: false,
          requestSpecified: true,
          configured: false,
          active: false,
          apiLoaded,
          evaluationCount: 0,
          failureCount: 0,
          lastResult: 0,
          reason: featureReason(),
        },
      },
    }),
  };

  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { webview: { hostObjects: { sync: { native } } } },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {},
  });
  Object.defineProperty(globalThis, "HTMLCanvasElement", {
    configurable: true,
    value: class HTMLCanvasElement {
      getContext() { return null; }
    },
  });

  try {
    const { install } = await import(`${adapterUrl.href}?dlss-nr-api-test`);
    install();
    const rtx = globalThis.navigator.gpu.threeBrowserRTX;
    const reported = rtx.capabilities;
    assert.equal(reported.dlssNeuralRendering, false);
    assert.equal(reported.dlssNeuralRenderingApiLoaded, false);
    assert.equal("dlssNeuralRenderingDllLoaded" in reported, false);
    assert.equal("dlssNeuralRenderingDirectSupported" in reported, false);
    assert.equal("dlssNeuralRenderingNgxMappingPatched" in reported, false);

    const adapter = await globalThis.navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const unavailableEncoder = device.createCommandEncoder();
    const unavailable = rtx.evaluateNeuralRendering({
      commandEncoder: unavailableEncoder,
      options: { style: 1 },
    });
    assert.equal(unavailable.queued, false);
    assert.match(unavailable.reason, /unavailable/);
    assert.deepEqual(unavailableEncoder._commands, []);
    assert.throws(
      () => rtx.evaluateNeuralRendering({
        commandEncoder: unavailableEncoder,
        options: { style: 3 },
      }),
      /options\.style must be exactly one of the integers 0, 1, or 2/,
    );

    supported = true;
    const apiMissingEncoder = device.createCommandEncoder();
    const apiMissing = rtx.evaluateNeuralRendering({
      commandEncoder: apiMissingEncoder,
      options: { style: 2 },
    });
    assert.equal(apiMissing.queued, false);
    assert.match(apiMissing.reason, /API not loaded/);
    assert.deepEqual(apiMissingEncoder._commands, []);

    apiLoaded = true;
    const texture = (format, usage) => device.createTexture({
      size: { width: 8, height: 8, depthOrArrayLayers: 1 },
      format,
      usage,
    });
    const resource = textureValue => ({ texture: textureValue, vulkanLayout: 1 });
    const controlMask = resource(texture("r8unorm", 0x04));
    const encoder = device.createCommandEncoder();
    const queued = rtx.evaluateNeuralRendering({
      commandEncoder: encoder,
      viewport: 4,
      colorInput: resource(texture("rgba16float", 0x04)),
      colorOutput: resource(texture("rgba16float", 0x08)),
      depth: resource(texture("depth32float", 0x04)),
      motionVectors: resource(texture("rg16float", 0x04)),
      controlMask,
      options: { style: 2, useAutoMask: true },
      constants: constants(),
    });
    assert.equal(queued.queued, true);
    assert.equal(queued.viewport, 4);
    assert.equal(encoder._commands.length, 1);
    assert.equal(encoder._commands[0][0], "dlssNeuralRenderingEvaluate");
    assert.equal(encoder._commands[0][1].options.style, 2);
    assert.equal(encoder._commands[0][1].options.useAutoMask, false);
  } finally {
    for (const [name, descriptor] of [
      ["chrome", saved.chrome],
      ["navigator", saved.navigator],
      ["HTMLCanvasElement", saved.htmlCanvas],
    ]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
