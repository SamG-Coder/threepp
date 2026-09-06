import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('GPU command uploads do not present stale scenes and overlays preserve scene textures', {
  skip: process.env.THREEBROWSER_RUN_GPU_TESTS !== '1',
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = fileURLToPath(new URL('../build/bin/three_browser_runtime.node', import.meta.url));
  const host = await import('./browser-host.mjs');
  const T = host.loadThreeShim(fileURLToPath(new URL('../../host/ThreeBrowser/web/three/', import.meta.url)));
  try {
    const renderer = new T.WebGLRenderer({ antialias: true });
    assert.ok(host.native.stats().samples >= 2, 'antialias request must allocate a multisampled native window');
    assert.equal(renderer.getContextAttributes().antialias, true);
    assert.equal(renderer.getContext().getParameter(renderer.getContext().SAMPLES), host.native.stats().samples);
    const cmd = globalThis.__TN.cmd, originalShadowState = cmd.shadowState;
    let lastShadowState;
    cmd.shadowState = function(state) { lastShadowState = { ...state }; return originalShadowState.call(this, state); };
    document.body.appendChild(renderer.domElement);
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-1, 1, 1, -1, .1, 10); camera.position.z = 2;
    const a = new T.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); a.needsUpdate = true;
    const b = new T.DataTexture(new Uint8Array([0, 255, 0, 255]), 1, 1); b.needsUpdate = true;
    const material = new T.ShaderMaterial({
      uniforms: { a: { value: a }, b: { value: b } },
      vertexShader: 'varying vec2 uv0; void main(){uv0=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform sampler2D a;uniform sampler2D b;varying vec2 uv0;void main(){gl_FragColor=.5*(texture2D(a,uv0)+texture2D(b,uv0));}',
    });
    scene.add(new T.Mesh(new T.PlaneGeometry(2, 2), material));
    const draw = async () => { renderer.render(scene, camera); globalThis.__TN.cmd.submit(); await new Promise(r => setTimeout(r, 80)); };
    await draw();
    assert.equal(lastShadowState.autoUpdate, renderer.shadowMap.autoUpdate, 'window passes must synchronize shadow state');
    cmd.shadowState = originalShadowState;
    const pixel = () => {
      const { width, height } = host.native.stats();
      const image = host.native.decodeImage(host.native.rendererCapturePng(width, height));
      const offset = ((height >> 1) * width + (width >> 1)) * 4;
      return [...image.pixels.slice(offset, offset + 4)];
    };
    const before = pixel();
    assert.ok(before[0] > 100 && before[1] > 100 && before[2] < 5, `Expected two sampled textures: ${before}`);
    const presents = host.native.stats().presents;
    for (let i = 0; i < 4; ++i) {
      globalThis.__TN.cmd.shaderUniform(material._h, 'unusedValue', 1, [i]);
      if (i % 2) globalThis.__TN.cmd.submitAsync();
      else globalThis.__TN.cmd.submit();
    }
    await new Promise(r => setTimeout(r, 100));
    assert.equal(host.native.stats().presents, presents, 'uniform uploads must not draw the previous screen scene');
    globalThis.__threeBrowserInAnimationFrame = true;
    cmd.submitFrame(scene._h, camera._h);
    cmd.submitComposite(scene._h, camera._h, scene._h, camera._h);
    globalThis.__threeBrowserInAnimationFrame = false;
    cmd.flushPresentation();
    await new Promise(r => setTimeout(r, 100));
    assert.equal(host.native.stats().presents, presents + 1, 'world plus viewmodel composite must present once per animation callback');
    host.native.toggleFpsOverlay();
    await draw(); await draw();
    assert.deepEqual(pixel(), before, 'FPS upload must preserve scene texture bindings');
    host.native.toggleFpsOverlay();
    await draw();
    assert.deepEqual(pixel(), before, 'texture state must survive dismissing the overlay');
    const shadowScene = new T.Scene();
    const floor = new T.Mesh(new T.PlaneGeometry(4, 4), new T.MeshStandardMaterial({ color: 0xffffff }));
    floor.receiveShadow = true; shadowScene.add(floor);
    const transparent = new T.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1); transparent.needsUpdate = true;
    const caster = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshStandardMaterial({ map: transparent, alphaTest: .5, side: T.DoubleSide }));
    caster.position.z = 1;
    caster.position.x = 1;
    caster.customDepthMaterial = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking });
    shadowScene.add(caster);
    const sun = new T.DirectionalLight(0xffffff, 3); sun.position.set(3, 0, 3); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 250 });
    shadowScene.add(sun, new T.AmbientLight(0xffffff, .2));
    camera.position.z = 4;
    renderer.shadowMap.enabled = true;
    const shadowDraw = async () => { renderer.render(shadowScene, camera); cmd.submit(); await new Promise(r => setTimeout(r, 60)); return pixel(); };
    renderer.shadowMap.autoUpdate = false;
    caster.castShadow = false; const unobstructed = await shadowDraw();
    assert.ok(!host.native.debugScene().includes(`shadowProjection[${sun._h}]=`), 'renderer autoUpdate=false must not allocate a shadow map');
    renderer.shadowMap.autoUpdate = true;
    const cutoutMaterial = caster.material;
    caster.castShadow = true; caster.material = new T.MeshStandardMaterial({ color: 0xffffff, side: T.DoubleSide });
    const opaqueShadow = await shadowDraw();
    assert.ok(opaqueShadow[0] < unobstructed[0] - 30, `a shadow map allocated after a no-update pass must bind to the receiver: ${opaqueShadow} vs ${unobstructed}`);
    camera.position.x = .7; camera.lookAt(0, 0, 0);
    const movedShadow = await shadowDraw();
    assert.ok(movedShadow[0] < unobstructed[0] - 30, `camera motion must retain the shadow at the same world point: ${movedShadow}`);
    camera.position.x = 0; camera.lookAt(0, 0, 0);
    caster.material = cutoutMaterial;
    caster.castShadow = true; const cutout = await shadowDraw();
    assert.deepEqual(cutout, unobstructed, 'transparent source pixels must remain transparent in a custom depth material');
    const checkShadowProjection = () => {
      const metadata = host.native.debugScene();
      const projection = metadata.split(`shadowProjection[${sun._h}]=`)[1]?.split(',').slice(0, 16).map(Number);
      assert.ok(projection, 'native shadow map must be allocated');
      for (let i = 0; i < 16; ++i) assert.ok(Math.abs(projection[i] - sun.shadow.camera.projectionMatrix.elements[i]) < 1e-5,
        `shadow projection component ${i}: native ${projection[i]}, JS ${sun.shadow.camera.projectionMatrix.elements[i]}`);
    };
    checkShadowProjection();
    Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44 });
    sun.shadow.mapSize.set(256, 256);
    await shadowDraw();
    checkShadowProjection();
    const intermediate = new T.WebGLRenderTarget(4, 4);
    const intermediateScene = new T.Scene();
    intermediateScene.add(new T.Mesh(new T.PlaneGeometry(4, 4), new T.MeshBasicMaterial({ color: 0x808080 })));
    renderer.toneMapping = T.ReinhardToneMapping;
    const readIntermediate = exposure => {
      renderer.toneMappingExposure = exposure;
      renderer.setRenderTarget(intermediate); renderer.render(intermediateScene, camera); cmd.submit();
      const pixels = new Uint8Array(64);
      renderer.readRenderTargetPixels(intermediate, 0, 0, 4, 4, pixels);
      renderer.setRenderTarget(null);
      return [...pixels];
    };
    assert.deepEqual(readIntermediate(.25), readIntermediate(2), 'intermediate render targets must retain linear light before the output pass applies exposure');
    renderer.toneMappingExposure = .25;
    renderer.render(intermediateScene, camera); cmd.submit();
    const dimScreen = pixel();
    renderer.toneMappingExposure = 2;
    renderer.render(intermediateScene, camera); cmd.submit();
    assert.ok(pixel()[0] > dimScreen[0], 'returning to the screen must restore display tone mapping');
    const outputMaterial = intermediateScene.children[0].material;
    outputMaterial.toneMapped = false;
    const readScreen = exposure => {
      renderer.toneMappingExposure = exposure;
      renderer.render(intermediateScene, camera); cmd.submit(); return pixel();
    };
    assert.deepEqual(readScreen(.25), readScreen(2), 'material toneMapped=false must reach the native shader');
    outputMaterial.colorWrite = false;
    renderer.setClearColor(0x000000, 1);
    assert.deepEqual(readScreen(2), [0, 0, 0, 255], 'material colorWrite=false must reach the GPU color mask');
    const coverageScene = new T.Scene();
    const coverageMaterial = new T.ShaderMaterial({
      alphaToCoverage: true, blending: T.NoBlending,
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'void main(){gl_FragColor=vec4(1.,1.,1.,.5);}',
    });
    coverageScene.add(new T.Mesh(new T.PlaneGeometry(4,4), coverageMaterial));
    renderer.setClearColor(0x000000, 1);
    const coverageTarget = new T.WebGLRenderTarget(4, 4, { samples: 4 });
    const readCoverage = () => {
      renderer.setRenderTarget(coverageTarget); renderer.render(coverageScene, camera); cmd.submit();
      const pixels = new Uint8Array(64);
      renderer.readRenderTargetPixels(coverageTarget, 0, 0, 4, 4, pixels);
      renderer.setRenderTarget(null); return pixels[0];
    };
    const covered = readCoverage();
    assert.ok(covered > 40 && covered < 220, `MSAA resolve must preserve partial alpha coverage, got ${covered}`);
    coverageTarget.samples = 0;
    assert.equal(readCoverage(), 255, 'changing samples must recreate the native target without alpha-to-coverage');
    const foliage = new T.MeshBasicMaterial({ color: 0xffffff, alphaTest: .475, alphaToCoverage: true, toneMapped: false });
    foliage.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.a = .5 + .1 * (gl_FragCoord.x - .5);');
    };
    coverageScene.children[0].material = foliage;
    coverageTarget.samples = 4;
    const smoothCoverage = readCoverage();
    assert.ok(smoothCoverage > 0 && smoothCoverage < 100, `built-in alpha test must smooth coverage at the cutoff, got ${smoothCoverage}`);
    foliage.alphaToCoverage = false;
    assert.equal(readCoverage(), 255, 'disabling coverage must restore the built-in hard alpha test');
  } finally {
    globalThis.__threeBrowserInAnimationFrame = false; host.stop();
  }
});
