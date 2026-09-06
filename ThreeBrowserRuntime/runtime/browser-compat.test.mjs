import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addonPath = path.resolve(here, "../build/bin/three_browser_runtime.node");
const shimDirectory = path.resolve(here, "../../host/ThreeBrowser/web/three");
const available = fs.existsSync(addonPath) && fs.existsSync(shimDirectory);

test("Web Audio compressor and external ShaderMaterial subclasses follow browser contracts", {
  skip: available ? false : "native addon or Three.js compatibility slices are not built",
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = addonPath;
  const native = require(addonPath);
  const host = await import(`${pathToFileURL(path.join(here, "browser-host.mjs")).href}?browser-compat-test`);
  try {
    const context = new AudioContext();
    const compressor = context.createDynamicsCompressor();
    assert.equal(compressor.threshold.value, -24);
    assert.equal(compressor.knee.value, 30);
    assert.equal(compressor.ratio.value, 12);
    assert.equal(compressor.attack.value, 0.003);
    assert.equal(compressor.release.value, 0.25);
    assert.equal(context.createGain().connect(compressor), compressor);
    assert.equal(compressor.connect(context.destination), context.destination);

    host.loadThreeShim(shimDirectory);
    const warnings = [];
    const originalWarn = console.warn;
    let THREE;
    let LineMaterial;
    try {
      console.warn = (...values) => warnings.push(values.map(String).join(" "));
      THREE = await import("three");
      ({ LineMaterial } = await import("three/addons/lines/LineMaterial.js"));
    } finally {
      console.warn = originalWarn;
    }
    assert.ok(!warnings.some(message => message.includes("Multiple instances of Three.js")));
    assert.ok(THREE.UniformsLib.common.diffuse);

    const ordinaryTabState = { pressedKeys: new Set(), active: false };
    assert.deepEqual(
      host.updateRuntimeOverlayChord(ordinaryTabState, { type: "keydown", code: 9, shiftKey: false }),
      { consume: false, toggle: false },
    );
    const shiftedTabState = { pressedKeys: new Set(), active: false };
    assert.deepEqual(
      host.updateRuntimeOverlayChord(shiftedTabState, { type: "keydown", code: 16, shiftKey: true }),
      { consume: false, toggle: false },
    );
    assert.deepEqual(
      host.updateRuntimeOverlayChord(shiftedTabState, { type: "keydown", code: 9, shiftKey: true }),
      { consume: true, toggle: true },
    );
    assert.deepEqual(
      host.updateRuntimeOverlayChord(shiftedTabState, { type: "keydown", code: 9, shiftKey: true }),
      { consume: true, toggle: false },
    );
    assert.equal(host.updateRuntimeOverlayChord(
      shiftedTabState, { type: "keyup", code: 9, shiftKey: true },
    ).consume, true);
    assert.equal(host.updateRuntimeOverlayChord(
      shiftedTabState, { type: "keyup", code: 16, shiftKey: false },
    ).consume, true);
    assert.equal(shiftedTabState.active, false);
    const lostReleaseState = { pressedKeys: new Set([16, 9]), active: true };
    assert.deepEqual(
      host.updateRuntimeOverlayChord(lostReleaseState, { type: "keydown", code: 16, shiftKey: true }),
      { consume: false, toggle: false },
    );
    assert.deepEqual(
      host.updateRuntimeOverlayChord(lostReleaseState, { type: "keydown", code: 9, shiftKey: true }),
      { consume: true, toggle: true },
    );

    const skinnedGeometry = new THREE.BufferGeometry();
    skinnedGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ], 3));
    skinnedGeometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ], 4));
    skinnedGeometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([
      1, 0, 0, 0,
      1, 0, 0, 0,
      1, 0, 0, 0,
    ], 4));
    const animatedBone = new THREE.Bone();
    animatedBone.name = "AnimatedBone";
    const skinnedMesh = new THREE.SkinnedMesh(skinnedGeometry, new THREE.MeshBasicMaterial());
    skinnedMesh.add(animatedBone);
    skinnedMesh.bind(new THREE.Skeleton([animatedBone]));
    const skinClip = new THREE.AnimationClip("move", 1, [
      new THREE.VectorKeyframeTrack("AnimatedBone.position", [0, 1], [0, 0, 0, 2, 0, 0]),
    ]);
    const skinMixer = new THREE.AnimationMixer(skinnedMesh);
    skinMixer.clipAction(skinClip).play();
    skinMixer.setTime(0.5);
    skinnedMesh.updateMatrixWorld(true);
    const skinnedVertex = skinnedMesh.getVertexPosition(0, new THREE.Vector3());
    assert.ok(Math.abs(animatedBone.position.x - 1) < 1e-6);
    assert.ok(Math.abs(skinnedVertex.x - 2) < 1e-6);

    const movingSkinParent = new THREE.Group();
    movingSkinParent.position.set(10, 5, -3);
    movingSkinParent.add(skinnedMesh);
    movingSkinParent.updateMatrixWorld(true);
    const parentedSkinnedVertex = skinnedMesh.getVertexPosition(0, new THREE.Vector3());
    assert.ok(Math.abs(parentedSkinnedVertex.x - 2) < 1e-6);
    assert.ok(Math.abs(parentedSkinnedVertex.y) < 1e-6);
    assert.ok(Math.abs(parentedSkinnedVertex.z) < 1e-6);

    const zeroTimeTarget = new THREE.Group();
    zeroTimeTarget.name = "ZeroTimeTarget";
    const zeroTimeMixer = new THREE.AnimationMixer(zeroTimeTarget);
    zeroTimeMixer.clipAction(new THREE.AnimationClip("initial-pose", 0.1, [
      new THREE.VectorKeyframeTrack("ZeroTimeTarget.position", [0], [7, 8, 9]),
    ])).play();
    zeroTimeMixer.update(0);
    assert.deepEqual(zeroTimeTarget.position.toArray(), [7, 8, 9]);

    const invisibleHitbox = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    invisibleHitbox.position.set(0, 0, -5);
    invisibleHitbox.updateMatrixWorld(true);
    const hitboxRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    const hitboxHits = hitboxRaycaster.intersectObject(invisibleHitbox, false);
    assert.ok(hitboxHits.length > 0);
    assert.ok(Math.abs(hitboxHits[0].distance - 4) < 1e-6);

    const material = new LineMaterial({ color: 0xffffff, linewidth: 2 });
    assert.equal(material.color.getHex(), 0xffffff);
    material.color = new THREE.Color(0x123456);
    assert.equal(material.color.getHex(), 0x123456);

    const instances = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      7 / 3,
    );
    assert.equal(instances.count, 2);
    assert.equal(instances.instanceMatrix.array.length, 32);
    const bounded = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial(), 2);
    bounded.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-5, 0, 0));
    bounded.setMatrixAt(1, new THREE.Matrix4().makeTranslation(5, 0, 0));
    bounded.computeBoundingBox();
    bounded.computeBoundingSphere();
    assert.equal(bounded.boundingBox.min.x, -6);
    assert.equal(bounded.boundingBox.max.x, 6);
    assert.ok(Math.abs(bounded.boundingSphere.radius - (5 + Math.sqrt(3))) < 1e-5);
    const element = document.createElement("input");
    element.setAttribute("id", "hydration-input");
    element.setAttribute("class", "slider");
    const attributes = element.attributes;
    while (attributes.length) element.removeAttributeNode(attributes[0]);
    assert.deepEqual(element.getAttributeNames(), []);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(element, 12);
    assert.equal(element.value, "12");

    const renderer = new THREE.WebGLRenderer();
    assert.match(renderer.getContext().getParameter(renderer.getContext().RENDERER), /ThreeBrowser/);
    assert.equal(renderer.state.buffers.depth.getReversed(), false);
    assert.equal(typeof renderer.getContext().flush, "function");
    assert.equal(typeof renderer.getContext().finish, "function");
    assert.doesNotThrow(() => renderer.getContext().finish());
    assert.equal(typeof globalThis.__TN.cmd.submitComposite, "function");
    assert.equal(typeof globalThis.__TN.cmd.setPoseQuat, "function");
    let pointerLockChanges = 0;
    document.addEventListener("pointerlockchange", () => pointerLockChanges++);
    await renderer.domElement.requestPointerLock();
    assert.equal(document.pointerLockElement, renderer.domElement);
    assert.equal(pointerLockChanges, 1);
    assert.equal(host.setRuntimeOverlayVisible(true), true);
    assert.equal(document.pointerLockElement, renderer.domElement);
    assert.equal(pointerLockChanges, 1);
    let coveredDomClicks = 0;
    document.body.addEventListener("click", () => coveredDomClicks++);
    const menuClick = { type: "pointerup", code: 1, x: 12, y: 12 };
    if (!host.consumeRuntimeOverlayInput(menuClick)) {
      document.body.dispatchEvent(new Event("click"));
    }
    assert.equal(coveredDomClicks, 0);
    assert.equal(host.consumeRuntimeOverlayInput({ type: "pointerdown", code: 1, x: 12, y: 12 }), true);
    assert.equal(host.consumeRuntimeOverlayInput({ type: "wheelhorizontal", code: 120, x: 12, y: 12 }), true);
    assert.equal(host.setRuntimeOverlayVisible(false), true);
    assert.equal(host.consumeRuntimeOverlayInput(menuClick), false);
    assert.equal(document.pointerLockElement, renderer.domElement);
    assert.equal(pointerLockChanges, 1);
    document.exitPointerLock();
    assert.equal(pointerLockChanges, 2);
    renderer.clearDepth();
    assert.equal(renderer._nativeClearDepthPending, true);
    const manualScene = new THREE.Scene();
    const manualRoot = new THREE.Group();
    manualRoot.matrixAutoUpdate = false;
    manualRoot.matrix.makeRotationY(Math.PI / 2).setPosition(4, 5, 6);
    manualScene.add(manualRoot);
    renderer.render(manualScene, new THREE.PerspectiveCamera());
    assert.ok(manualRoot.matrix.elements.every((value, index) =>
      Math.abs(manualRoot._nativeManualMatrix[index] - value) < 1e-6));
    assert.equal(manualRoot._manualMatrixDirty, false);
    class Derived3DTarget extends THREE.WebGLRenderTarget {
      constructor() {
        super(8, 4);
        this.texture = new THREE.Data3DTexture(null, 8, 4, 2);
        this._setTextureOptions({ wrapR: THREE.RepeatWrapping, generateMipmaps: true });
      }
    }
    const derivedTarget = new Derived3DTarget();
    assert.equal(derivedTarget.texture.wrapR, THREE.RepeatWrapping);
    assert.equal(derivedTarget.texture.generateMipmaps, true);
    assert.equal(derivedTarget.texture.flipY, false);
    assert.equal(derivedTarget.textures[0], derivedTarget.texture);
    derivedTarget.dispose();
    const readbackTarget = new THREE.WebGLRenderTarget(8,8,{type:THREE.HalfFloatType});
    const readbackQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'void main(){gl_FragColor=vec4(.25,.5,.75,1.);}',
    }));
    renderer.setRenderTarget(readbackTarget);
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    const floatPixel = new Float32Array(4);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[.25,.5,.75,1], 'float readback must return the GPU values, not a zero-filled probe');
    const bytePixel = new Uint8Array(4);
    const scalarTexture=new THREE.DataTexture(new Float32Array([-1.75]),1,1,THREE.RedFormat,THREE.FloatType);
    scalarTexture.needsUpdate=true;
    const scalarMaterial=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
      uniforms:{data:{value:scalarTexture}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'uniform sampler2D data;void main(){gl_FragColor=texture2D(data,vec2(.5));}'});
    const initialMaterial=readbackQuad.material;
    readbackQuad.material=scalarMaterial;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[-1.75,0,0,1],'single-channel simulation textures must preserve negative floating-point values');
    const halfTexture=new THREE.DataTexture(new Uint16Array([0xbe00,0x4200]),1,1,THREE.RGFormat,THREE.HalfFloatType);
    halfTexture.needsUpdate=true;
    scalarMaterial.uniforms.data.value=halfTexture;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[-1.5,3,0,1],'half-float channels must not be tone-mapped into display bytes');
    const largePixels=new Float32Array(1024*513*4).fill(-.625);
    const largeTexture=new THREE.DataTexture(largePixels,1024,513,THREE.RGBAFormat,THREE.FloatType);
    largeTexture.needsUpdate=true;
    scalarMaterial.uniforms.data.value=largeTexture;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(largeTexture._h,'an upload larger than the initial command buffer must create a native texture');
    assert.deepEqual([...floatPixel],[-.625,-.625,-.625,-.625],'oversized float uploads must reach the GPU intact');
    halfTexture.dispose();largeTexture.dispose();
    readbackQuad.material=initialMaterial;
    scalarMaterial.dispose();scalarTexture.dispose();
    const originalReadbackMaterial=readbackQuad.material;
    const simulationTargets=[0,1].map(()=>new THREE.WebGLRenderTarget(8,8,{count:2,type:THREE.HalfFloatType,depthBuffer:false}));
    const simulationMaterial=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,
      uniforms:{previous:{value:simulationTargets[0].textures[0]},history:{value:simulationTargets[0].textures[1]},initialize:{value:1},dt:{value:.125}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'uniform sampler2D previous;uniform sampler2D history;uniform float initialize;uniform float dt;layout(location=0) out vec4 state;layout(location=1) out vec4 memory;void main(){state=initialize>.5?vec4(-.5,0.,0.,1.):texture(previous,vec2(.5))+vec4(dt,0.,0.,0.);memory=initialize>.5?vec4(.25,0.,0.,1.):texture(history,vec2(.5))+vec4(dt*2.,0.,0.,0.);}'
    });
    readbackQuad.material=simulationMaterial;
    const simulationCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    let simulationIndex=0;
    for(let step=0;step<4;step++){
      simulationMaterial.uniforms.previous.value=simulationTargets[simulationIndex].textures[0];
      simulationMaterial.uniforms.history.value=simulationTargets[simulationIndex].textures[1];
      simulationMaterial.uniforms.initialize.value=step===0?1:0;
      simulationIndex=1-simulationIndex;
      renderer.setRenderTarget(simulationTargets[simulationIndex]);
      renderer.render(readbackQuad,simulationCamera);
    }
    const simulationRead=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,
      uniforms:{state:{value:simulationTargets[simulationIndex].textures[0]},history:{value:simulationTargets[simulationIndex].textures[1]}},
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'uniform sampler2D state;uniform sampler2D history;void main(){gl_FragColor=vec4(texture2D(state,vec2(.5)).r,texture2D(history,vec2(.5)).r,0.,1.);}'
    });
    readbackQuad.material=simulationRead;
    renderer.setRenderTarget(readbackTarget);
    renderer.render(readbackQuad,simulationCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[-.125,1,0,1],'multiple simulation substeps must preserve signed state and the second attachment');
    simulationTargets.forEach(target=>target.dispose());simulationMaterial.dispose();simulationRead.dispose();
    readbackQuad.material=originalReadbackMaterial;
    renderer.render(readbackQuad,simulationCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,bytePixel);
    assert.ok(Math.abs(bytePixel[0]-64)<=1 && Math.abs(bytePixel[1]-128)<=1 && Math.abs(bytePixel[2]-191)<=1 && bytePixel[3]===255);
    const normalMap = new THREE.DataTexture(new Uint8Array([128,128,255,255]),1,1);
    const outputHook = new THREE.MeshBasicMaterial({toneMapped:false});
    let compileCalls=0, drawCallbacks=0;
    outputHook.onBeforeCompile = shader => {
      compileCalls++;
      assert.ok(shader.fragmentShader.includes('#include <opaque_fragment>'));
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>','gl_FragColor=vec4(.125,.25,.5,1.);');
    };
    readbackQuad.material=outputHook;
    readbackQuad.onBeforeRender=()=>drawCallbacks++;
    await renderer.compileAsync(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    assert.equal(compileCalls,1);
    assert.equal(drawCallbacks,0,'compilation must not invoke draw callbacks');
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[.25,.5,.75,1],'compilation must not draw over the target');
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[.125,.25,.5,1],'opaque output hook must change actual GPU pixels');
    readbackQuad.onBeforeRender=()=>{};
    outputHook.dispose();
    normalMap.needsUpdate = true;
    const hookedMaterial = new THREE.MeshStandardMaterial({normalMap});
    hookedMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = `
        void main() {
        #ifdef USE_NORMALMAP_TANGENTSPACE
          mat3 frame = getTangentFrame(vec3(gl_FragCoord.xy,0.),vec3(0.,0.,1.),gl_FragCoord.xy);
          gl_FragColor = vec4(frame[0].x*.25,frame[1].y*.5,frame[2].z*.75,1.);
        #else
          gl_FragColor = vec4(1.,0.,0.,1.);
        #endif
        }`;
    };
    readbackQuad.material = hookedMaterial;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[.25,.5,.75,1], 'modern normal-map defines and explicit-UV tangent frames must execute in native hooked materials');
    hookedMaterial.dispose();
    normalMap.dispose();
    const mipTarget = new THREE.WebGLRenderTarget(8,8,{
      type:THREE.HalfFloatType, minFilter:THREE.LinearMipmapLinearFilter, generateMipmaps:true,
    });
    const mipSourceMaterial = new THREE.ShaderMaterial({
      depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'void main(){float c=mod(floor(gl_FragCoord.x)+floor(gl_FragCoord.y),2.);gl_FragColor=vec4(c,c,c,1.);}',
    });
    readbackQuad.material = mipSourceMaterial;
    renderer.setRenderTarget(mipTarget);
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    const mipSampleMaterial = new THREE.ShaderMaterial({
      uniforms:{image:{value:mipTarget.texture}},depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'uniform sampler2D image;void main(){gl_FragColor=textureLod(image,vec2(.5),3.);}',
    });
    readbackQuad.material = mipSampleMaterial;
    renderer.setRenderTarget(readbackTarget);
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.deepEqual([...floatPixel],[.5,.5,.5,1], 'render-target mip levels must contain filtered rendered pixels');
    mipTarget.dispose();
    mipSourceMaterial.dispose();
    mipSampleMaterial.dispose();
    const colourTexture = new THREE.DataTexture(new Uint8Array([128,128,128,255]),1,1);
    colourTexture.colorSpace = THREE.SRGBColorSpace;
    colourTexture.needsUpdate = true;
    const colourSampleMaterial = new THREE.ShaderMaterial({
      uniforms:{image:{value:colourTexture}},depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'uniform sampler2D image;void main(){gl_FragColor=texture2D(image,vec2(.5));}',
    });
    readbackQuad.material = colourSampleMaterial;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-.21586)<.001, `custom shader sRGB sample must be linear, got ${floatPixel[0]}`);
    const builtinColourMaterial = new THREE.MeshBasicMaterial({map:colourTexture,toneMapped:false});
    readbackQuad.material = builtinColourMaterial;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-.21586)<.001, `built-in material must not decode twice, got ${floatPixel[0]}`);
    colourTexture.colorSpace = THREE.NoColorSpace;
    colourTexture.needsUpdate = true;
    readbackQuad.material = colourSampleMaterial;
    renderer.render(readbackQuad,new THREE.OrthographicCamera(-1,1,1,-1,0,1));
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-128/255)<.001, 'data textures must keep their untransformed channel values');
    colourTexture.dispose();
    colourSampleMaterial.dispose();
    builtinColourMaterial.dispose();
    const fogScene = new THREE.Scene();
    const fogMaterial = new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
    const fogMesh = new THREE.Mesh(new THREE.PlaneGeometry(2,2),fogMaterial);
    fogMesh.position.z=-2;
    fogScene.add(fogMesh);
    const fogCamera = new THREE.OrthographicCamera(-1,1,1,-1,.1,10);
    fogCamera.position.set(0,0,3);
    fogCamera.lookAt(0,0,-2);
    fogScene.fog = new THREE.FogExp2(0xff0000,20);
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(floatPixel[0]>.99 && floatPixel[2]<.01,'initial fog must reach the GPU: '+JSON.stringify([...floatPixel]));
    fogScene.fog.color.set(0x0000ff);
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(floatPixel[0]<.01 && floatPixel[2]>.99,'mutating an existing fog colour must update GPU uniforms');
    fogScene.fog=null;
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(floatPixel[0]>.99 && floatPixel[2]>.99,'clearing fog must restore unfogged pixels');
    const environmentMaterial = new THREE.MeshStandardMaterial({toneMapped:false});
    environmentMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = 'uniform float envMapIntensity;\nuniform mat3 envMapRotation;\n'+shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>',
        'gl_FragColor=vec4(envMapIntensity,abs(envMapRotation[0].xy),1.);');
    };
    fogMesh.material=environmentMaterial;
    fogScene.environmentIntensity=.375;
    fogScene.environmentRotation.z=Math.PI/2;
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-.375)<.001 && floatPixel[1]<.001 && floatPixel[2]>.99,
      'scene environment intensity and rotation must reach built-in material uniforms: '+JSON.stringify([...floatPixel]));
    fogMesh.material=fogMaterial;
    environmentMaterial.dispose();
    const shadowLight=new THREE.DirectionalLight(0xffffff,1);
    shadowLight.castShadow=true;
    shadowLight.shadow.mapSize.set(8,8);
    shadowLight.shadow.intensity=.25;
    fogScene.add(shadowLight);
    renderer.shadowMap.enabled=true;
    const shadowApiMaterial=new THREE.MeshStandardMaterial({toneMapped:false});
    shadowApiMaterial.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        DirectionalLightShadow s=directionalLightShadows[0];
        gl_FragColor=vec4(s.shadowIntensity,getShadow(directionalShadowMap[0],s.shadowMapSize,s.shadowIntensity,s.shadowBias,s.shadowRadius,vDirectionalShadowCoord[0]),0.,1.);
      `);
    };
    fogMesh.material=shadowApiMaterial;
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-.25)<.001,'modern shadow API must compile and upload intensity');
    shadowLight.shadow.intensity=.75;
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-.75)<.001,'shadow intensity changes must reach the GPU');
    const pointLight=new THREE.PointLight(0xffffff,1);
    pointLight.position.z=6;
    fogScene.add(pointLight);
    const rawLightMaterial=new THREE.ShaderMaterial({lights:true,depthTest:false,depthWrite:false,
      vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:`
        #include <common>
        #include <packing>
        #include <lights_pars_begin>
        #include <shadowmap_pars_fragment>
        void main(){
          IncidentLight light;getPointLightInfo(pointLights[0],vec3(0.),light);
          DirectionalLightShadow s=directionalLightShadows[0];
          gl_FragColor=vec4(s.shadowIntensity,getShadow(directionalShadowMap[0],s.shadowMapSize,s.shadowIntensity,s.shadowBias,s.shadowRadius,vec4(0.,0.,0.,1.)),light.direction.z,1.);
        }`});
    fogMesh.material=rawLightMaterial;
    renderer.render(fogScene,fogCamera);
    renderer.readRenderTargetPixels(readbackTarget,2,2,1,1,floatPixel);
    assert.ok(Math.abs(floatPixel[0]-.75)<.001 && floatPixel[2]>.99,
      'ShaderMaterial must support modern shadow and light-position overloads: '+JSON.stringify([...floatPixel]));
    fogScene.remove(pointLight);
    rawLightMaterial.dispose();
    fogMesh.material=fogMaterial;
    fogScene.remove(shadowLight);
    renderer.shadowMap.enabled=false;
    shadowApiMaterial.dispose();
    const customDepth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
    const customDistance=new THREE.MeshDistanceMaterial();
    let depthCompiles=0,distanceCompiles=0;
    customDepth.onBeforeCompile=shader=>{depthCompiles++;assert.ok(shader.fragmentShader.includes('DEPTH_PACKING'));};
    customDistance.onBeforeCompile=shader=>{distanceCompiles++;assert.ok(shader.fragmentShader.includes('referencePosition'));};
    fogMesh.customDepthMaterial=customDepth;
    fogMesh.customDistanceMaterial=customDistance;
    await renderer.compileAsync(fogScene,fogCamera);
    assert.ok(customDepth._h && customDistance._h && customDepth._h!==customDistance._h);
    assert.equal(depthCompiles,1);
    assert.equal(distanceCompiles,1);
    assert.equal(fogMesh._nativeShadowMaterials,`${customDepth._h}:${customDistance._h}`);
    fogMesh.customDepthMaterial=null;
    fogMesh.customDistanceMaterial=null;
    await renderer.compileAsync(fogScene,fogCamera);
    assert.equal(fogMesh._nativeShadowMaterials,'0:0');
    const uploadTexture=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);
    uploadTexture.anisotropy=8;
    renderer.initTexture(uploadTexture);
    assert.ok(uploadTexture._h,'eager upload must allocate a texture handle');
    const originalTextureParams=globalThis.__TN.cmd.texParams;
    let textureParameterCommands=0;
    try {
      globalThis.__TN.cmd.texParams=(...args)=>{textureParameterCommands++;return originalTextureParams(...args);};
      for(let i=0;i<5;i++)globalThis.__TN._ensureTextureNative(uploadTexture);
      assert.equal(textureParameterCommands,0,'unchanged texture sampling must not resend native parameters');
      uploadTexture.anisotropy=4;
      globalThis.__TN._ensureTextureNative(uploadTexture);
      globalThis.__TN._ensureTextureNative(uploadTexture);
      assert.equal(textureParameterCommands,1,'changed sampler parameters must be transferred exactly once');
    } finally { globalThis.__TN.cmd.texParams=originalTextureParams; }
    const originalEnvironmentCommand=globalThis.__TN.cmd.sceneEnvironment;
    const originalBarrier=globalThis.__TN.cmd.submit;
    let environmentCommands=0,environmentBarriers=0;
    try {
      globalThis.__TN.cmd.sceneEnvironment=(...args)=>{environmentCommands++;return originalEnvironmentCommand(...args);};
      globalThis.__TN.cmd.submit=(...args)=>{environmentBarriers++;return originalBarrier(...args);};
      fogScene.environment=uploadTexture;
      fogScene.environment=uploadTexture;
      assert.ok(uploadTexture._environmentScenes.has(fogScene));
      fogScene.environment=null;
      assert.equal(environmentCommands,2,'reassigning the same environment must not rebind it');
      assert.equal(environmentBarriers,0,'environment changes must stay in the ordered command batch');
      assert.ok(!uploadTexture._environmentScenes.has(fogScene));
    } finally {
      globalThis.__TN.cmd.sceneEnvironment=originalEnvironmentCommand;
      globalThis.__TN.cmd.submit=originalBarrier;
    }
    const pngCanvas=document.createElement('canvas');
    pngCanvas.width=2;pngCanvas.height=2;
    pngCanvas.getContext('2d').fillRect(0,0,2,2);
    let synchronous=true;
    const blobPromise=new Promise(resolve=>pngCanvas.toBlob(blob=>{assert.equal(synchronous,false);resolve(blob)}));
    synchronous=false;
    const pngBlob=await blobPromise;
    assert.equal(pngBlob.type,'image/png');
    assert.deepEqual([...new Uint8Array(await pngBlob.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
    customDepth.dispose();customDistance.dispose();uploadTexture.dispose();fogMaterial.dispose();
    renderer.setRenderTarget(null);
    const presentedScene=new THREE.Scene();
    presentedScene.background=new THREE.Color(0x00ff00);
    renderer.render(presentedScene,fogCamera);
    globalThis.__TN.cmd.submit();
    const presentedBlob=await new Promise(resolve=>renderer.domElement.toBlob(resolve));
    assert.ok(presentedBlob && presentedBlob.size>0,'native canvas export must return an encoded image');
    const presentedImage=native.decodeImage(new Uint8Array(await presentedBlob.arrayBuffer()));
    assert.equal(presentedImage.width,renderer.domElement.width);
    assert.equal(presentedImage.height,renderer.domElement.height);
    assert.deepEqual([...presentedImage.pixels.slice(0,4)],[0,255,0,255],
      'canvas export must contain the presented native framebuffer');
    readbackTarget.dispose();
    const cmd = globalThis.__TN.cmd;
    const originalRenderPass = cmd.renderPass;
    const originalSubmitFrame = cmd.submitFrame;
    const originalPipeline = process.env.THREEBROWSER_NATIVE_POST_PROCESSING;
    const destinations = [];
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const passTarget = new THREE.WebGLRenderTarget(8, 8);
    try {
      process.env.THREEBROWSER_NATIVE_POST_PROCESSING = '1';
      cmd.renderPass = (_scene, _camera, target) => destinations.push(target);
      cmd.submitFrame = () => destinations.push(0);
      renderer.setRenderTarget(passTarget);
      renderer.render(quad, passCamera);
      assert.deepEqual(destinations, [passTarget._h], 'a fullscreen mesh must preserve the bound offscreen destination');
      destinations.length = 0;
      renderer.render(quad, passCamera, null);
      assert.deepEqual(destinations, [0], 'an explicit legacy null destination still means the window');
      const originalProjection = cmd.cameraProjection;
      const projectionCommands = [];
      try {
        cmd.cameraProjection = (_id, near, far, elements) => projectionCommands.push({near, far, elements:[...elements]});
        passCamera.projectionMatrix.elements[8] = 0.375;
        renderer.render(quad, passCamera);
        assert.equal(projectionCommands.at(-1).elements[8], 0.375, 'direct projection edits must cross the native boundary');
        const passCalls = [];
        cmd.renderPass = (...args) => passCalls.push(args);
        passTarget.viewport.set(2, 3, 4, 5);
        passTarget.scissor.set(1, 2, 3, 4);
        passTarget.scissorTest = true;
        renderer.autoClear = false;
        renderer.render(quad, passCamera);
        assert.equal(passCalls.at(-1)[6] & 4, 0, 'an accumulating pass must preserve its target');
        assert.deepEqual(passCalls.at(-1).slice(7,9).map(v => v.toArray()), [[2,3,4,5],[1,2,3,4]]);
        assert.equal(passCalls.at(-1)[9], true);
      } finally {
        cmd.cameraProjection = originalProjection;
        renderer.autoClear = true;
      }
      const uniformCommands = [];
      const originalUniform = cmd.shaderUniform;
      const direction = new THREE.Vector2(1, 0);
      const blur = new THREE.ShaderMaterial({
        uniforms: { direction: { value: direction }, weights: { value: [0.25, 0.75] }, tints: { value: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)] } },
        vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }',
        fragmentShader: 'uniform vec2 direction; uniform float weights[2]; uniform vec3 tints[2]; void main() { gl_FragColor = vec4(direction, weights[0] + tints[0].r, 1.0); }',
      });
      quad.material = blur;
      void blur._h;
      try {
        cmd.shaderUniform = (id, name, kind, values) => uniformCommands.push({name, values: [...values]});
        renderer.render(quad, passCamera);
        direction.set(0, 1);
        blur.uniforms.weights.value[0] = 0.5;
        blur.uniforms.tints.value[1].set(0, 0, 1);
        renderer.render(quad, passCamera);
        assert.ok(uniformCommands.some(c => c.name === 'direction' && c.values[0] === 0 && c.values[1] === 1),
          'a later pass in the same animation frame must upload its changed vector uniform');
        assert.ok(uniformCommands.some(c => c.name === 'weights' && c.values[0] === 0.5 && c.values[1] === 0.75));
        assert.ok(uniformCommands.some(c => c.name === 'tints' && c.values.join(',') === '1,0,0,0,0,1'));
      } finally {
        cmd.shaderUniform = originalUniform;
      }
    } finally {
      cmd.renderPass = originalRenderPass;
      cmd.submitFrame = originalSubmitFrame;
      if (originalPipeline === undefined) delete process.env.THREEBROWSER_NATIVE_POST_PROCESSING;
      else process.env.THREEBROWSER_NATIVE_POST_PROCESSING = originalPipeline;
      renderer.setRenderTarget(null);
      passTarget.dispose();
    }
    renderer.dispose();

    const interactions = await import("./html-interaction-bridge.mjs");
    globalThis.__threeBrowserHydrateDocument(`
      <main id="access-gate" data-screen="login" role="dialog">
        <form id="access-form">
          <label for="player-name">Player name</label>
          <input id="player-name" name="player" required>
          <button id="continue-button" data-action="continue">Continue</button>
        </form>
      </main>
      <script>throw new Error("hydration must not execute scripts")</script>
    `);
    const input = document.getElementById("player-name");
    const button = document.getElementById("continue-button");
    const form = document.getElementById("access-form");
    assert.equal(document.getElementById("access-gate").form, null);
    let inputEvents = 0;
    let changeEvents = 0;
    let clicks = 0;
    let submissions = 0;
    input.addEventListener("input", () => inputEvents++);
    input.addEventListener("change", () => changeEvents++);
    button.addEventListener("click", () => clicks++);
    form.addEventListener("submit", event => { submissions++; event.preventDefault(); });

    const gate = interactions.collectHtmlInteractionGate(document);
    assert.equal(gate.screen, "login");
    assert.deepEqual(gate.controls.map(control => control.label), ["Player name", "Continue"]);
    assert.equal(interactions.setHtmlControlValue(gate.controls[0], "Sam", { commit: true }), true);
    assert.equal(input.value, "Sam");
    assert.equal(inputEvents, 1);
    assert.equal(changeEvents, 1);
    assert.equal(interactions.activateHtmlControl(gate.controls[1]), true);
    assert.equal(clicks, 1);
    assert.equal(submissions, 1);
    assert.equal(typeof native.canvasOverlaySet, "function");
    assert.doesNotThrow(() => native.canvasOverlaySet(false));

    const bridge = new interactions.HtmlInteractionBridge({
      document,
      viewport: () => ({ width: 800, height: 600 }),
      createCanvas: () => document.createElement("canvas"),
    });
    assert.equal(bridge.update(0, true), true);
    assert.equal(bridge.canvas.id, "threebrowser-html-interaction-overlay");
    assert.equal(bridge.consumeNativeInput({ type: "keydown", code: 65, shiftKey: false }), true);
    assert.equal(input.value, "Sama");
    bridge.consumeNativeInput({ type: "keydown", code: 9, shiftKey: false });
    bridge.consumeNativeInput({ type: "keydown", code: 13, shiftKey: false });
    assert.equal(clicks, 2);
    assert.equal(submissions, 2);
    bridge.hide();
    assert.equal(document.getElementById("threebrowser-html-interaction-overlay"), null);

    globalThis.__threeBrowserHydrateDocument(`
      <aside class="water-controls">
        <div id="settings-header">Water settings</div>
        <select aria-label="Quality"><option value="high">High</option></select>
        <input type="range" aria-label="Wind speed">
      </aside>
      <div id="hud-overlay"><button id="audio-toggle" aria-label="Toggle audio">Audio</button></div>
      <div class="fps-counter" aria-label="Frames per second"><span data-fps>72</span><span>FPS</span></div>
    `);
    document.getElementById("settings-header").addEventListener("click", () => {});
    document.getElementById("audio-toggle").addEventListener("click", () => {});
    assert.equal(interactions.collectHtmlInteractionGate(document), null,
      "permanent settings controls must not become a page-input gate");
    assert.equal(interactions.collectHtmlStatusHud(document).value, "72");
    assert.equal(bridge.update(1, true), true);
    assert.equal(bridge.mode, "status");
    assert.equal(bridge.canvas.width, 188);
    assert.equal(bridge.consumeNativeInput({ type: "pointerdown", code: 1, x: 30, y: 30 }), false,
      "a status HUD must not capture native input");
    bridge.hide();

    globalThis.__threeBrowserHydrateDocument(`
      <div id="title-screen" data-screen="start"><div id="start-anywhere">Start</div></div>
    `);
    const startAnywhere = document.getElementById("start-anywhere");
    startAnywhere.addEventListener("click", () => clicks++);
    const syntheticGate = interactions.collectHtmlInteractionGate(document);
    assert.equal(syntheticGate.controls[0].label, "Play");
    assert.equal(interactions.activateHtmlControl(syntheticGate.controls[0]), true);
    assert.equal(clicks, 3);
  } finally {
    host.stop();
  }
});
