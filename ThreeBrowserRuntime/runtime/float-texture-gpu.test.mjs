import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('float uploads preserve sampler state, resized storage and earlier offscreen draws', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1',
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
  const host = await import('./browser-host.mjs');
  const T = host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/', import.meta.url)));
  try {
    const renderer = new T.WebGLRenderer();
    const scene = new T.Scene(), camera = new T.OrthographicCamera(-1,1,1,-1,.1,10);
    camera.position.z = 2;
    const texture = new T.DataTexture(new Float32Array([1,0,0,1]),1,1,T.RGBAFormat,T.FloatType);
    texture.needsUpdate = true;
    const material = new T.ShaderMaterial({
      uniforms: { source: { value: texture } },
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform sampler2D source;void main(){gl_FragColor=texture2D(source,vec2(.75,.5));}',
    });
    const mesh = new T.Mesh(new T.PlaneGeometry(2,2), material); scene.add(mesh);
    const a = new T.WebGLRenderTarget(4,4), b = new T.WebGLRenderTarget(4,4);
    const render = target => { renderer.setRenderTarget(target); renderer.render(scene,camera); };
    const read = target => { const pixels = new Uint8Array(64); renderer.readRenderTargetPixels(target,0,0,4,4,pixels); return [...pixels.slice(0,4)]; };
    render(a);
    texture.image.data.set([0,1,0,1]); texture.needsUpdate = true;
    render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(a),[255,0,0,255], 'later upload cannot alter earlier pass');
    assert.deepEqual(read(b),[0,255,0,255], 'matching allocation must receive new pixels');
    texture.image = { width:2, height:1, data:new Float32Array([1,0,0,1, 0,0,1,1]) };
    texture.needsUpdate = true; render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(b),[0,0,255,255], 'resize must reallocate storage');
    texture.image.data.set([0,1,0,1, 1,0,0,1]); texture.needsUpdate=true;
    render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(b),[255,0,0,255], 'new dimensions must become reusable');
    // Repeat and offset must remain intact across compatible data updates.
    texture.wrapS = T.RepeatWrapping; texture.offset.x = .5;
    material.fragmentShader = 'uniform sampler2D source;void main(){gl_FragColor=texture2D(source,vec2(1.25,.5));}';
    material.needsUpdate = true;
    render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(b),[0,255,0,255], 'repeat sampler must select the first texel');
    texture.image.data.set([0,0,1,1, 1,0,0,1]); texture.needsUpdate=true;
    render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(b),[0,0,255,255], 'matching float upload must preserve repeat sampler');
    texture.image = {width:1,height:1,data:new Uint8Array([0,0,255,255])}; texture.type=T.UnsignedByteType;
    texture.needsUpdate=true; render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(b),[0,0,255,255], 'format transition must invalidate float allocation');
    texture.image = {width:1,height:1,data:new Float32Array([0,1,0,1])}; texture.type=T.FloatType;
    texture.needsUpdate=true; render(b); globalThis.__TN.cmd.submit();
    assert.deepEqual(read(b),[0,255,0,255], 'float transition must allocate correct GPU format');
    let calls = 0;
    mesh.onBeforeRender = () => { calls++; mesh.material = [material]; };
    render(a); render(b); globalThis.__TN.cmd.submit();
    assert.equal(calls,2,'preparation must preserve callbacks on each pass');
    assert.deepEqual(read(b),[0,255,0,255], 'material replacement during callback must be observed');
    const rotation = () => T._environmentRotationMatrix?.(scene) || globalThis.__TN._environmentRotationMatrix(scene);
    const initial = rotation(); assert.equal(rotation(),initial,'unchanged scene rotation reuses its matrix');
    for(const order of ['XYZ','ZYX','YXZ']) {
      scene.environmentRotation.set(.2,.3,.4,order);
      const expected = new T.Matrix3().setFromMatrix4(new T.Matrix4().makeRotationFromEuler(scene.environmentRotation)).transpose();
      assert.deepEqual([...rotation().elements],[...expected.elements]);
    }
    scene.environmentRotation.x += .1;
    assert.notEqual(rotation(),initial,'in-place Euler changes invalidate the cache');
  } finally { host.stop(); }
});
