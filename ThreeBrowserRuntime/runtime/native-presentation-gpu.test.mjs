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
    assert.ok(document.createElement('form') instanceof HTMLFormElement);
    assert.ok(!(document.createElement('div') instanceof HTMLFormElement), 'form identity must not match every element');
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
    const batchScene = new T.Scene();
    const instances = new T.InstancedMesh(new T.PlaneGeometry(1, 2),
      new T.MeshBasicMaterial({ color: 0xff0000, toneMapped: false }), 2);
    instances.frustumCulled = false;
    batchScene.add(instances);
    const batchFirst = new T.WebGLRenderTarget(4,4), batchSecond = new T.WebGLRenderTarget(4,4);
    const instancePose = new T.Matrix4();
    instances.setMatrixAt(0, instancePose.makeTranslation(-.5,0,0));
    instances.setMatrixAt(1, instancePose.makeTranslation(.5,0,0));
    renderer.setRenderTarget(batchFirst); renderer.render(batchScene,camera);
    instances.setMatrixAt(0, instancePose.makeTranslation(10,0,0));
    instances.setMatrixAt(1, instancePose.makeTranslation(11,0,0));
    renderer.setRenderTarget(batchSecond); renderer.render(batchScene,camera);
    cmd.submit();
    const batchPixel = new Uint8Array(4);
    renderer.readRenderTargetPixels(batchFirst,0,0,1,1,batchPixel);
    assert.equal(batchPixel[0],255,'the first draw must see the earlier batched instance positions');
    renderer.readRenderTargetPixels(batchSecond,0,0,1,1,batchPixel);
    assert.equal(batchPixel[0],0,'the second draw must see the later instance positions');
    renderer.setRenderTarget(null);
    batchFirst.dispose(); batchSecond.dispose();
    const readCoverage = () => {
      renderer.setRenderTarget(coverageTarget); renderer.render(coverageScene, camera); cmd.submit();
      const pixels = new Uint8Array(64);
      renderer.readRenderTargetPixels(coverageTarget, 0, 0, 4, 4, pixels);
      renderer.setRenderTarget(null); return pixels[0];
    };
    // Reusing a material in multiple passes must observe in-place mutations,
    // while unchanged values should not cross the command boundary again.
    const dynamicVector = new T.Vector3(.1, 0, 0);
    const dynamicMatrix = new T.Matrix4(); dynamicMatrix.elements[0] = .1;
    const dynamicArray = new Float32Array([.1, 0]);
    const dynamicMaterial = new T.ShaderMaterial({
      uniforms: { direction: { value: dynamicVector }, transform: { value: dynamicMatrix }, weights: { value: dynamicArray } },
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 direction; uniform mat4 transform; uniform float weights[2]; void main(){gl_FragColor=vec4(direction.x+transform[0][0]+weights[0],0.,0.,1.);}',
      toneMapped: false,
    });
    coverageScene.children[0].material = dynamicMaterial;
    const uniformWrites = [];
    const originalUniform = cmd.shaderUniform;
    cmd.shaderUniform = function(handle, name, kind, values) {
      if (handle === dynamicMaterial.__h) uniformWrites.push(name);
      return originalUniform.call(this, handle, name, kind, values);
    };
    try {
      assert.ok(Math.abs(readCoverage() - 77) <= 1);
      uniformWrites.length = 0;
      readCoverage();
      assert.equal(uniformWrites.length, 0, 'unchanged uniforms must not be resent');
      dynamicVector.x = .2;
      assert.ok(Math.abs(readCoverage() - 102) <= 1, 'next pass must observe a vector mutated in place');
      dynamicMatrix.elements[0] = .2;
      assert.ok(Math.abs(readCoverage() - 128) <= 1, 'next pass must observe matrix elements mutated in place');
      dynamicArray[0] = .2;
      assert.ok(Math.abs(readCoverage() - 153) <= 1, 'next pass must observe a typed array mutated in place');
      assert.deepEqual(uniformWrites, ['direction', 'transform', 'weights']);
      dynamicMaterial.uniformsGroups = [{ name: 'Parameters', uniforms: [{ value: .25 }] }];
      const dynamicFragment = dynamicMaterial.fragmentShader;
      dynamicMaterial.fragmentShader = 'uniform Parameters { float gain; };\n' + dynamicFragment;
      uniformWrites.length = 0;
      readCoverage();
      assert.ok(uniformWrites.includes('gain'), 'a changed shader source must refresh uniform block members');
      dynamicMaterial.fragmentShader = 'uniform Parameters { float amplitude; };\n' + dynamicFragment;
      uniformWrites.length = 0;
      readCoverage();
      assert.ok(uniformWrites.includes('amplitude'), 'a renamed block member must use the new layout');
      assert.ok(!uniformWrites.includes('gain'), 'the old block member must no longer be flushed');
      dynamicMaterial.uniformsGroups[0].uniforms[0].value = .5;
      uniformWrites.length = 0;
      readCoverage();
      assert.deepEqual(uniformWrites, ['amplitude'], 'cached block layout must still read live values');
    } finally { cmd.shaderUniform = originalUniform; }
    coverageScene.children[0].material = coverageMaterial;
    const retypedUniform = new T.ShaderMaterial({
      uniforms: { selector: { value: 1 } }, toneMapped: false,
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform float selector; void main(){gl_FragColor=vec4(selector*.25,0.,0.,1.);}',
    });
    coverageScene.children[0].material = retypedUniform;
    assert.ok(Math.abs(readCoverage() - 64) <= 1);
    retypedUniform.fragmentShader = 'uniform int selector; void main(){gl_FragColor=vec4(float(selector)*.5,0.,0.,1.);}';
    assert.ok(Math.abs(readCoverage() - 128) <= 1, 'source recompilation must re-upload unchanged values with the new declared type');
    let integerHook = false;
    const retypedHook = new T.MeshBasicMaterial({ toneMapped: false });
    retypedHook.onBeforeCompile = shader => {
      shader.uniforms.selector = { value: 1 };
      shader.fragmentShader = integerHook
        ? 'uniform int selector; void main(){gl_FragColor=vec4(float(selector)*.5,0.,0.,1.);}'
        : 'uniform float selector; void main(){gl_FragColor=vec4(selector*.25,0.,0.,1.);}';
    };
    coverageScene.children[0].material = retypedHook;
    assert.ok(Math.abs(readCoverage() - 64) <= 1);
    integerHook = true;
    retypedHook.needsUpdate = true;
    assert.ok(Math.abs(readCoverage() - 128) <= 1, 'onBeforeCompile rebuilds must refresh uniform types too');
    coverageScene.children[0].material = coverageMaterial;
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
    const falloffMaterial = new T.ShaderMaterial({
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: '#include <common>\n#include <lights_pars_begin>\nvoid main(){gl_FragColor=vec4(vec3(getDistanceAttenuation(2.,0.,2.)),1.);}',
    });
    coverageScene.children[0].material = falloffMaterial;
    const falloff = readCoverage();
    assert.ok(Math.abs(falloff - 64) <= 1, `ShaderMaterial light attenuation must match Three.js inverse-square falloff, got ${falloff}`);
    // Stock CubeUV puts +X in the first face tile, not an equirectangular strip.
    const atlasBytes = new Uint8Array(768 * 1024 * 4);
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 768; x++) {
      const offset = (y * 768 + x) * 4;
      atlasBytes[offset + (x < 256 && y < 256 ? 0 : 2)] = 255;
      atlasBytes[offset + 3] = 255;
    }
    const atlas = new T.DataTexture(atlasBytes, 768, 1024);
    atlas.mapping = T.CubeUVReflectionMapping; atlas.flipY = false;
    atlas.generateMipmaps = false; atlas.needsUpdate = true;
    const atlasMaterial = new T.MeshStandardMaterial({ toneMapped: false, envMap: atlas });
    atlasMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
        'gl_FragColor = textureCubeUV(envMap, vec3(1.,0.,0.), 0.);');
    };
    coverageScene.environment = atlas;
    coverageScene.children[0].material = atlasMaterial;
    assert.equal(readCoverage(), 255, 'stock CubeUV +X must sample the red face tile');
    const atlasPixels = new Uint8Array(64);
    renderer.readRenderTargetPixels(coverageTarget, 0, 0, 4, 4, atlasPixels);
    assert.equal(atlasPixels[2], 0, 'stock CubeUV must not sample the blue strip location');
    const atlasTarget = new T.WebGLRenderTarget(768, 1024);
    atlasTarget.texture.mapping = T.CubeUVReflectionMapping;
    coverageScene.children[0].material = new T.ShaderMaterial({
      uniforms: { source: { value: atlas } },
      vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform sampler2D source;void main(){gl_FragColor=texture2D(source,gl_FragCoord.xy/vec2(768.,1024.));}',
    });
    renderer.setRenderTarget(atlasTarget); renderer.render(coverageScene, camera); cmd.submit();
    const renderedAtlasMaterial = new T.MeshStandardMaterial({ toneMapped: false, envMap: atlasTarget.texture });
    renderedAtlasMaterial.onBeforeCompile = atlasMaterial.onBeforeCompile;
    coverageScene.children[0].material = renderedAtlasMaterial;
    assert.equal(readCoverage(), 255, 'GPU-generated CubeUV must preserve its mapping and rendered pixels');
    // The runtime's own PMREM generator uses a different, explicitly tagged layout.
    const equirectBytes = new Uint8Array(16 * 8 * 4);
    for (let i = 0; i < equirectBytes.length; i += 4) {
      equirectBytes[i + 1] = 255; equirectBytes[i + 3] = 255;
    }
    const equirect = new T.DataTexture(equirectBytes, 16, 8);
    equirect.mapping = T.EquirectangularReflectionMapping; equirect.needsUpdate = true;
    const equirectMaterial = new T.MeshStandardMaterial({ toneMapped: false, envMap: equirect });
    equirectMaterial.onBeforeCompile = atlasMaterial.onBeforeCompile;
    coverageScene.children[0].material = equirectMaterial;
    readCoverage();
    renderer.readRenderTargetPixels(coverageTarget, 0, 0, 4, 4, atlasPixels);
    assert.ok(atlasPixels[1] >= 254 && atlasPixels[0] === 0 && atlasPixels[2] === 0,
      `native PMREM must retain its equirectangular-strip sampler: ${atlasPixels.slice(0,4)}`);
    coverageScene.environment = null;
    renderer.toneMappingExposure = .92;
    coverageScene.children[0].material = new T.RawShaderMaterial({
      uniforms: { toneMappingExposure: { value: .92 } },
      vertexShader: 'precision highp float;uniform mat4 projectionMatrix;uniform mat4 modelViewMatrix;attribute vec3 position;void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'precision highp float;\n#include <tonemapping_pars_fragment>\n#include <colorspace_pars_fragment>\nvoid main(){gl_FragColor=sRGBTransferOETF(vec4(ACESFilmicToneMapping(vec3(.2,.4,.8)),1.));}',
    });
    readCoverage();
    const displayPixels = new Uint8Array(64);
    renderer.readRenderTargetPixels(coverageTarget, 0, 0, 4, 4, displayPixels);
    const multiply = (rows, values) => rows.map(row => row.reduce((sum, v, i) => sum + v * values[i], 0));
    const acesInput = multiply([[.59719,.35458,.04823],[.076,.90834,.01566],[.0284,.13383,.83777]], [.2,.4,.8].map(v => v * .92 / .6));
    const fitted = acesInput.map(v => (v * (v + .0245786) - .000090537) / (v * (.983729 * v + .4329510) + .238081));
    const expectedDisplay = multiply([[1.60475,-.53108,-.07367],[-.10208,1.10813,-.00605],[-.00327,-.07276,1.07602]], fitted)
      .map(v => Math.max(0, Math.min(1, v))).map(v => Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055)));
    for (let i = 0; i < 3; ++i) assert.ok(Math.abs(displayPixels[i] - expectedDisplay[i]) <= 1,
      `ACES/sRGB output channel ${i} must match the Three.js formula: ${displayPixels[i]} vs ${expectedDisplay[i]}`);
    const thinScene = new T.Scene();
    const thinMesh = new T.Mesh(new T.PlaneGeometry(.13, 4), new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    thinMesh.rotation.z = .4; thinScene.add(thinMesh);
    const thinTarget = new T.WebGLRenderTarget(32, 32, { type: T.HalfFloatType, samples: 4 });
    thinTarget.depthTexture = new T.DepthTexture(32, 32);
    const partialEdges = () => {
      renderer.setRenderTarget(thinTarget); renderer.render(thinScene, camera); cmd.submit();
      const pixels = new Uint8Array(32 * 32 * 4);
      renderer.readRenderTargetPixels(thinTarget, 0, 0, 32, 32, pixels);
      renderer.setRenderTarget(null);
      return pixels.filter((v, i) => i % 4 === 0 && v > 0 && v < 255).length;
    };
    assert.ok(partialEdges() > 10, 'thin opaque geometry must retain fractional coverage through half-float MSAA/depth resolve');
    thinTarget.samples = 0;
    assert.equal(partialEdges(), 0, 'the single-sample control must have hard geometry edges');
  } finally {
    globalThis.__threeBrowserInAnimationFrame = false; host.stop();
  }
});
