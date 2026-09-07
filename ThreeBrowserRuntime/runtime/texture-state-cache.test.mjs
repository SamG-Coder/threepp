import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../../host/ThreeBrowser/web/three/09-textures-loaders.js', import.meta.url), 'utf8');
function harness() {
  const calls = [];
  const TN = { cmd: { texParams: (...args) => calls.push(args) } };
  vm.runInNewContext(source, { __TN: TN });
  const texture = { _h: 1, image: { width: 1, height: 1 }, isRenderTargetTexture: true,
    wrapS: 1000, wrapT: 1000, colorSpace: 'srgb', encoding: 3001,
    magFilter: 1006, minFilter: 1008, channel: 0, anisotropy: 1, mapping: 300,
    offset: { x: 0, y: 0 }, repeat: { x: 1, y: 1 } };
  return { TN, calls, texture, ensure: () => TN._ensureTextureNative(texture) };
}

test('texture fast checks preserve all native sampler changes and mutable UV transforms', () => {
  const { calls, texture, ensure } = harness();
  ensure(); ensure();
  assert.equal(calls.length, 1);
  const cases = [
    [() => texture.wrapS = 1001, 1, 1001], [() => texture.wrapT = 1002, 2, 1002],
    [() => texture.colorSpace = 'srgb-linear', 3, 0xffffffff],
    [() => texture.magFilter = 1003, 4, 1003], [() => texture.minFilter = 1006, 5, 1006],
    [() => texture.channel = 1, 6, 1],
    [() => texture.offset.x = .25, 7, .25], [() => texture.offset.y = .5, 8, .5],
    [() => texture.repeat.x = 2, 9, 2], [() => texture.repeat.y = 3, 10, 3],
    [() => texture.anisotropy = 16, 11, 16], [() => texture.mapping = 306, 12, 306],
    [() => texture._h = 2, 0, 2],
  ];
  for (const [change, index, expected] of cases) {
    const before = calls.length;
    change(); ensure(); ensure();
    assert.equal(calls.length, before + 1);
    assert.equal(calls.at(-1)[index], expected);
  }
  texture.colorSpace = ''; texture.encoding = 3000; ensure();
  const before = calls.length;
  texture.encoding = 3001; ensure(); ensure();
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1)[3], 3001, 'legacy encoding must remain live');
  texture.anisotropy = 100; ensure();
  const clamped = calls.length;
  texture.anisotropy = 200; ensure(); ensure();
  assert.equal(calls.length, clamped, 'equivalent normalized inputs must not resend');
});

test('failed texture parameter submission remains retryable', () => {
  const { TN, calls, ensure } = harness();
  const send = TN.cmd.texParams;
  TN.cmd.texParams = () => { throw new Error('submission failure'); };
  assert.throws(ensure, /submission failure/);
  TN.cmd.texParams = send;
  ensure(); ensure();
  assert.equal(calls.length, 1);
});
