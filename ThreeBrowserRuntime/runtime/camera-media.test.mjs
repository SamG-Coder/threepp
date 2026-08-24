import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const addon = path.resolve(here, "../build/bin/three_browser_runtime.node");

test("camera media contract is explicit and hardware-independent", {
  skip: fs.existsSync(addon) ? false : `native addon not built at ${addon}`,
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = addon;
  await import(`${pathToFileURL(path.join(here, "browser-host.mjs")).href}?camera-media-test`);

  assert.equal(typeof navigator.mediaDevices.getUserMedia, "function");
  assert.equal(typeof navigator.mediaDevices.enumerateDevices, "function");
  assert.deepEqual(navigator.mediaDevices.getSupportedConstraints(), {
    deviceId: true,
    width: true,
    height: true,
    frameRate: true,
    facingMode: false,
    resizeMode: false,
  });
  const devices = await navigator.mediaDevices.enumerateDevices();
  assert.ok(Array.isArray(devices));
  for (const device of devices) {
    assert.equal(device.kind, "videoinput");
    assert.equal(typeof device.deviceId, "string");
    assert.equal(typeof device.label, "string");
  }
  await assert.rejects(
    navigator.mediaDevices.getUserMedia({ audio: true }),
    error => error?.name === "NotSupportedError",
  );
  await assert.rejects(
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: "user" } } }),
    error => error?.name === "OverconstrainedError" && error.constraint === "facingMode",
  );

  const bitmap = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([12, 34, 56, 255]),
  };
  const frame = new VideoFrame(bitmap, { timestamp: 1234 });
  assert.equal(frame.displayWidth, 1);
  assert.equal(frame.displayHeight, 1);
  assert.equal(frame.timestamp, 1234);
  assert.equal(frame.allocationSize(), 4);
  assert.deepEqual(Array.from(frame.__threeBrowserExternalFrame().data), [12, 34, 56, 255]);
  bitmap.data[0] = 99;
  assert.deepEqual(
    Array.from(frame.__threeBrowserExternalFrame().data),
    [12, 34, 56, 255],
    "VideoFrame must snapshot a reusable camera/image buffer",
  );
  frame.close();
  assert.throws(() => frame.__threeBrowserExternalFrame(), error => error?.name === "InvalidStateError");

  const exactRate = new MediaStreamTrack({
    handle: 0,
    width: 640,
    height: 480,
    frameRate: 24,
  }, { frameRate: { exact: 24 } });
  assert.equal(exactRate.getSettings().frameRate, 24);
  exactRate.stop();
  const mismatchedExactRate = new MediaStreamTrack({
    handle: 0,
    width: 640,
    height: 480,
    frameRate: 60,
  }, { frameRate: { exact: 24 } });
  assert.equal(
    mismatchedExactRate.getSettings().frameRate,
    60,
    "an exact constraint must not be faked by a coarse delivery throttle",
  );
  mismatchedExactRate.stop();
  const unknownRate = new MediaStreamTrack({
    handle: 0,
    width: 640,
    height: 480,
    frameRate: 0,
  }, { frameRate: { exact: 24 } });
  assert.equal(unknownRate.getSettings().frameRate, 0);
  unknownRate.stop();
});

test("video frame callbacks share one presented camera frame", {
  skip: fs.existsSync(addon) ? false : `native addon not built at ${addon}`,
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = addon;
  if (!globalThis.HTMLVideoElement) {
    await import(`${pathToFileURL(path.join(here, "browser-host.mjs")).href}?camera-rvfc-test`);
  }
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const scheduled = new Map();
  let nextId = 1;
  globalThis.requestAnimationFrame = callback => {
    const id = nextId++;
    scheduled.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = id => scheduled.delete(id);
  try {
    const video = new HTMLVideoElement();
    video._cameraTrack = { readyState: "live", _nativeHandle: 1 };
    video.paused = false;
    let acquisitions = 0;
    video._acquireCameraFrame = () => {
      acquisitions++;
      video._presentedFrames++;
      video.videoWidth = 2;
      video.videoHeight = 1;
      video.currentTime = 0.25;
      return true;
    };
    const delivered = [];
    video.requestVideoFrameCallback((_now, metadata) => delivered.push(metadata));
    video.requestVideoFrameCallback((_now, metadata) => delivered.push(metadata));
    const polls = [...scheduled.values()];
    scheduled.clear();
    for (const poll of polls) poll(100);
    assert.equal(acquisitions, 1);
    assert.equal(delivered.length, 2);
    assert.deepEqual(delivered.map(value => value.presentedFrames), [1, 1]);
  } finally {
    globalThis.requestAnimationFrame = originalRequest;
    globalThis.cancelAnimationFrame = originalCancel;
  }
});

test("external-texture WGSL lowering matches the RGBA sampled-texture shim", async () => {
  const adapterUrl = pathToFileURL(path.resolve(
    here,
    "../../host/ThreeBrowser/web/three-webgpu-gpu.js",
  ));
  const { GPUDevice, lowerExternalTextureWgsl } = await import(`${adapterUrl.href}?camera-wgsl-test`);
  const lowered = lowerExternalTextureWgsl(`
    @group(0) @binding(0) var frame: texture_external;
    @group(0) @binding(1) var frameSampler: sampler;
    fn sampleFrame(uv: vec2<f32>) -> vec4<f32> {
      return textureSampleBaseClampToEdge(
        frame,
        frameSampler,
        vec2<f32>(uv.x, uv.y)
      );
    }
  `);
  assert.doesNotMatch(lowered, /\btexture_external\b/);
  assert.match(lowered, /texture_2d<f32>/);
  assert.match(lowered, /textureSampleLevel\([\s\S]*vec2<f32>\(uv\.x, uv\.y\)[\s\S]*, 0\.0\)/);

  const writes = [];
  const created = [];
  let nextView = 100;
  const device = Object.create(GPUDevice.prototype);
  device._externalTextures = new Map();
  device.queue = {
    writeTexture(destination, data, layout, size) {
      writes.push({ destination, data, layout, size });
    },
  };
  device.createTexture = descriptor => {
    const texture = {
      _destroyed: false,
      descriptor,
      destroyCount: 0,
      createView() {
        return { _h: nextView++, _desc: {}, _tex: texture };
      },
      destroy() {
        texture._destroyed = true;
        texture.destroyCount++;
      },
    };
    created.push(texture);
    return texture;
  };
  let current = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([1, 2, 3, 255]),
    sequence: 1,
  };
  const source = { __threeBrowserExternalFrame: () => current };
  assert.throws(
    () => device.importExternalTexture({
      source: {
        __threeBrowserExternalFrame: () => ({
          width: 1,
          height: 1,
          data: new Float32Array(4),
          sequence: 1,
        }),
      },
    }),
    /no current RGBA frame/,
    "float-backed providers must not be reinterpreted as byte RGBA",
  );
  const first = device.importExternalTexture({ source });
  const repeated = device.importExternalTexture({ source });
  assert.equal(first._h, repeated._h);
  assert.equal(created.length, 1);
  assert.equal(writes.length, 1, "the same camera sequence uploads once");
  current = { ...current, data: new Uint8ClampedArray([4, 5, 6, 255]), sequence: 2 };
  const updated = device.importExternalTexture({ source });
  assert.equal(updated._h, first._h);
  assert.equal(writes.length, 2, "a new camera sequence updates the persistent texture");
  current = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
    sequence: 3,
  };
  device.importExternalTexture({ source });
  assert.equal(created.length, 2);
  assert.equal(created[0].destroyCount, 1, "a dimension change replaces the backing texture");
  assert.equal(writes.length, 3);
});
