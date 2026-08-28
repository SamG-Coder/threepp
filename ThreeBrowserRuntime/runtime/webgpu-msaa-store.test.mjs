import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const nativeSource = await readFile(
  new URL('../../native/webgpu/three_webgpu.cpp', import.meta.url),
  'utf8',
);

test('MSAA render attachments honor storeOp across later transmission passes', () => {
  assert.match(
    nativeSource,
    /attachment\.storeOp\s*=\s*storeOpFrom\(input\.store\)/,
  );
  assert.doesNotMatch(
    nativeSource,
    /attachment\.storeOp\s*=\s*attachment\.resolveTarget\s*\?\s*WGPUStoreOp_Discard/,
  );
  assert.match(nativeSource, /if \(v == 2 \|\| v == static_cast<uint32_t>\(WGPUStoreOp_Discard\)\)/);
  assert.match(nativeSource, /da\.depthStoreOp\s*=\s*storeOpFrom\(depthStore\)/);
});
