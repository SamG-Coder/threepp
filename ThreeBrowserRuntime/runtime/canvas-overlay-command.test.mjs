import assert from 'node:assert/strict';
import test from 'node:test';

import cmd, { OP } from '../../host/ThreeBrowser/web/three-webgpu-cmd.js';

test('Canvas2D overlay command carries CSS bounds separately from bitmap dimensions', () => {
  const buffer = new ArrayBuffer(4096);
  cmd.attach(buffer);
  const pixels = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
  ]);

  cmd.canvasOverlay({
    left: 12,
    top: 18,
    width: 200,
    height: 100,
    sourceWidth: 2,
    sourceHeight: 1,
    rowBytes: 8,
    pixels,
  });

  assert.equal(cmd.used(), 56);
  assert.deepEqual(Array.from(new Uint32Array(buffer, 0, 12)), [
    OP.CANVAS_OVERLAY, 56,
    1, 1, 12, 18, 200, 100, 2, 1, 8, 8,
  ]);
  assert.deepEqual(Array.from(new Uint8Array(buffer, 48, 8)), Array.from(pixels));
  cmd.submitNow(true);
});
