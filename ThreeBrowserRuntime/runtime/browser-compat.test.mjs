import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const addonPath = path.resolve(here, "../build/bin/three_browser_runtime.node");
const shimDirectory = path.resolve(here, "../../host/ThreeBrowser/web/three");
const available = fs.existsSync(addonPath) && fs.existsSync(shimDirectory);

test("Web Audio compressor and external ShaderMaterial subclasses follow browser contracts", {
  skip: available ? false : "native addon or Three.js compatibility slices are not built",
}, async () => {
  process.env.THREEBROWSER_RUNTIME_ADDON = addonPath;
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
  } finally {
    host.stop();
  }
});
