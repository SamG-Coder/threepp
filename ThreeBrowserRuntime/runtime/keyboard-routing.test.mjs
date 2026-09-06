import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('native movement keys reach document and window once, with and without focus', async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
  const host = await import('./browser-host.mjs');
  const seen = [], held = new Set();
  const onDocument = event => {
    seen.push(['document', event.type, event.key, event.code, event.target]);
    if (event.type === 'keydown') held.add(event.key);
    else held.delete(event.key);
  };
  const onWindow = event => seen.push(['window', event.type]);
  for (const type of ['keydown', 'keyup']) {
    document.addEventListener(type, onDocument);
    addEventListener(type, onWindow);
  }
  const field = document.createElement('input'); document.body.appendChild(field);
  try {
    for (const focus of [null, field]) {
      document.activeElement = focus;
      seen.length = 0;
      host.dispatchNativeKeyboardEvent({ type: 'keydown', code: 87 });
      assert.ok(held.has('w'));
      host.dispatchNativeKeyboardEvent({ type: 'keyup', code: 87 });
      assert.equal(held.size, 0);
      assert.deepEqual(seen.map(row => row.slice(0, 2)), [
        ['document', 'keydown'], ['window', 'keydown'], ['document', 'keyup'], ['window', 'keyup'],
      ]);
      assert.equal(seen[0][3], 'KeyW');
      assert.equal(seen[0][4], focus || document.body);
    }
    field.remove(); seen.length = 0;
    host.dispatchNativeKeyboardEvent({ type: 'keydown', code: 65 });
    assert.equal(seen[0][4], document.body, 'a detached focused element cannot swallow keys');
    document.body.addEventListener('keydown', event => event.stopPropagation(), { once: true });
    seen.length = 0;
    host.dispatchNativeKeyboardEvent({ type: 'keydown', code: 68 });
    assert.equal(seen.length, 0, 'stopped events must not be sent separately to window');
  } finally {
    for (const type of ['keydown', 'keyup']) {
      document.removeEventListener(type, onDocument);
      removeEventListener(type, onWindow);
    }
    document.activeElement = null; field.remove(); host.stop();
  }
});
