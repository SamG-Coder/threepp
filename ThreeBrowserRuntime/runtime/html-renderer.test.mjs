import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HtmlRenderer, matchesSelector, length } from './html-renderer.mjs';

test('viewport lengths preserve their units', () => {
  const viewport = { width: 1200, height: 800 };
  assert.equal(length('50vw', 100, 0, 16, viewport), 600);
  assert.equal(length('50dvh', 100, 0, 16, viewport), 400);
  assert.equal(length('clamp(30px, 5vw, 80px)', 100, 0, 16, viewport), 60);
});

const addon = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
test('HTML painter uses CSS layout, native pixels, live DOM state, and original control handlers', {
  skip: !fs.existsSync(addon),
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = addon;
  const host = await import('./browser-host.mjs');
  const renderer = new HtmlRenderer({ document, viewport: () => ({ width: 640, height: 360 }), createCanvas: () => document.createElement('canvas') });
  try {
    globalThis.__threeBrowserHydrateDocument(`<head><style>
      :root { --ink: #ffffff; }
      #hud { position:fixed; left:20px; top:18px; width:240px; padding:12px; background-color:#123456; color:var(--ink); }
      #hud > button { width:160px; height:40px; background-color:#357933; }
      .unrelated button { display:none; }
      .off { display:none; }
    </style></head><body><div id="hud"><span>Renderer controls</span><button id="action">Apply</button>
    <input id="check" type="checkbox"><input id="text" placeholder="Name"></div></body>`);
    const hud = document.getElementById('hud'), action = document.getElementById('action');
    let clicks = 0, changes = 0;
    action.addEventListener('click', () => clicks++);
    document.getElementById('check').addEventListener('change', () => changes++);
    assert.equal(matchesSelector(action, '#hud > button'), true);
    assert.equal(matchesSelector(action, '.unrelated button'), false);
    assert.equal(matchesSelector(action, '.\\@container\\/field-group'), false, 'escaped utility classes must never match every element');
    action.classList.add('@container/field-group');
    assert.equal(matchesSelector(action, '.\\@container\\/field-group'), true);
    renderer.update(0, true);
    const box = renderer.boxes.find(b => b.node === hud);
    assert.deepEqual([box.x, box.y, box.width], [20, 18, 240]);
    assert.equal(renderer.style(hud).color, '#ffffff');
    const pixel = renderer.context.getImageData(21, 19, 1, 1).data;
    assert.deepEqual([...pixel], [18, 52, 86, 255]);
    const click = node => {
      const box = renderer.boxes.find(b => b.node === node);
      assert.ok(box);
      assert.equal(renderer.consumeNativeInput({ type: 'pointerup', code: 1, x: box.x + 4, y: box.y + 4 }), true);
    };
    click(action); assert.equal(clicks, 1);
    click(document.getElementById('check')); assert.equal(changes, 1);
    assert.equal(document.getElementById('check').checked, true);
    click(document.getElementById('text'));
    renderer.consumeNativeInput({ type: 'keydown', code: 65 });
    assert.equal(document.getElementById('text').value, 'a');
    assert.equal(renderer.consumeNativeInput({ type: 'pointerup', code: 1, x: 600, y: 330 }), false);
    action.textContent = 'Saved'; renderer.update(100, true);
    assert.equal(renderer.boxes.find(b => b.node === action).text, 'Saved');
    const signature = renderer.signature;
    renderer.update(200, true); assert.equal(renderer.signature, signature);
    hud.classList.add('off'); renderer.update(300, true);
    assert.equal(renderer.canvas.parentNode, null);
    hud.classList.remove('off'); renderer.update(400, true);
    assert.equal(renderer.canvas.parentNode, document.body);
    const link = document.createElement('link');
    link.setAttribute('rel', 'stylesheet');
    link.setAttribute('href', 'data:text/css,' + encodeURIComponent('#hud { width: 280px; }'));
    const loaded = new Promise((resolve, reject) => { link.addEventListener('load', resolve); link.addEventListener('error', reject); });
    document.head.appendChild(link);
    await loaded;
    renderer.update(500, true);
    assert.equal(renderer.boxes.find(b => b.node === hud).width, 280);
    globalThis.__threeBrowserHydrateDocument(`<head><style>
      body { display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100dvh; }
      #surface { position:relative; width:50vw; height:50dvh; container-type:size; }
      canvas { width:100%; height:100%; }
      #badge {position:absolute; left:10%; top:10%; width:100px; height:40px; z-index:10; background:#123456;}
      @container (width<=400px) { #badge { color:#00ff00; } }
      @media (height>=300px) { #badge { font-size:18px; } }
    </style></head><body><div id="surface"><canvas></canvas><div id="badge"><span>Visible</span></div></div></body>`);
    renderer.presentedCanvas = () => document.querySelectorAll('canvas').find(n => !n.dataset.threeBrowserOwned);
    renderer.update(600, true);
    const surface = renderer.boxes.find(b => b.node.id === 'surface');
    assert.deepEqual([surface.x, surface.y, surface.width, surface.height], [0, 0, 640, 360]);
    const badge = renderer.boxes.find(b => b.node.id === 'badge');
    assert.equal(badge.s.color, '#00ff00');
    assert.equal(badge.s.fontSize, '18px');
    assert.deepEqual([badge.x, badge.y], [64, 36]);
    assert.ok(renderer.boxes.indexOf(badge) < renderer.boxes.findIndex(b => b.text === 'Visible'));
  } finally { renderer.hide(); host.stop(); }
});
