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

    const renderer = new THREE.WebGLRenderer();
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
  } finally {
    host.stop();
  }
});
