import assert from "node:assert/strict";
import test from "node:test";

import * as THREE from "three/webgpu";

import { createFloodEffects } from "../src/effects.mjs";
import FlashFloodModel from "../src/fluid-model.mjs";
import { createFlashFloodWater } from "../src/water.mjs";

function smallFlood() {
  return new FlashFloodModel({
    width: 11,
    height: 32,
    cellSize: 2,
    originX: -11,
    originZ: -32,
    fixedStepSeconds: 0.05,
    bed: ({ gridX, gridZ }) => Math.pow(Math.abs(gridX - 5) / 5, 4) * 7 - gridZ * 0.08,
    gateWidthCells: 5,
    gateStartSeconds: 0,
    gateRiseSeconds: 1,
    gateHoldSeconds: 60,
    gatePeakDischarge: 40,
    maxDepth: 6,
    maxVelocity: 18,
  });
}

function assertFiniteArray(array, label) {
  assert.ok(array && typeof array.length === "number", `${label} must be array-like`);
  for (let index = 0; index < array.length; ++index) {
    assert.ok(Number.isFinite(array[index]), `${label}[${index}] is not finite: ${array[index]}`);
  }
}

function changedValues(before, after, epsilon = 1e-6) {
  let changed = 0;
  for (let index = 0; index < Math.min(before.length, after.length); ++index) {
    if (Math.abs(before[index] - after[index]) > epsilon) changed += 1;
  }
  return changed;
}

test("surge data drives finite water geometry, foam, caustics, spray, and debris", () => {
  const model = smallFlood();
  const bedHeight = (x, z) => model.sample(x, z)?.bed ?? 0;
  const water = createFlashFloodWater({
    model,
    bedHeight,
    moon: new THREE.Vector3(-0.31, 0.86, -0.39),
  });
  const effects = createFloodEffects({
    model,
    bedHeight,
    channelCenterX: () => 0,
    channelHalfWidth: () => 9,
  });
  const scene = new THREE.Group();
  scene.add(water.surface, effects.group);

  const waterDisposed = { geometry: 0, material: 0 };
  water.geometry.addEventListener("dispose", () => { waterDisposed.geometry += 1; });
  water.material.addEventListener("dispose", () => { waterDisposed.material += 1; });

  try {
    const position = water.geometry.getAttribute("position");
    const normal = water.geometry.getAttribute("normal");
    const depth = water.geometry.getAttribute("waterDepth");
    const foam = water.geometry.getAttribute("waterFoam");
    const turbulence = water.geometry.getAttribute("waterTurbulence");
    const speed = water.geometry.getAttribute("flowSpeed");
    const wetness = water.geometry.getAttribute("waterWetness");
    const coverage = water.geometry.getAttribute("waterCoverage");
    const dryPositions = position.array.slice();

    assert.equal(water.stats().wetCells, 0);
    assert.equal(wetness.array.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(coverage.array.reduce((sum, value) => sum + value, 0), 0);
    assert.equal(water.stats().vertices, model.width * model.height);
    assert.equal(
      water.stats().triangles,
      (model.width - 1) * (model.height - 1) * 2,
    );

    model.advance(14);
    water.update(model.elapsedSeconds);
    const wetStats = model.stats();
    assert.ok(wetStats.wetCells > model.gate.cellCount * 10, wetStats);
    assert.ok(wetStats.frontGridZ > model.height * 0.5, wetStats);
    assert.equal(water.stats().wetCells, wetStats.wetCells);
    assert.equal(
      wetness.array.reduce((sum, value) => sum + (value > 0.5 ? 1 : 0), 0),
      wetStats.wetCells,
    );
    assert.ok(
      changedValues(dryPositions, position.array) >= wetStats.wetCells,
      "wet surface vertices should rise from the hidden dry ribbon",
    );

    for (const [label, attribute] of [
      ["water position", position],
      ["water normal", normal],
      ["water depth", depth],
      ["water foam", foam],
      ["water turbulence", turbulence],
      ["water speed", speed],
      ["water wetness", wetness],
      ["water coverage", coverage],
    ]) assertFiniteArray(attribute.array, label);

    for (let index = 0; index < normal.count; ++index) {
      const offset = index * 3;
      const length = Math.hypot(
        normal.array[offset],
        normal.array[offset + 1],
        normal.array[offset + 2],
      );
      assert.ok(Math.abs(length - 1) < 1e-5, `normal ${index} is not unit length`);
      assert.ok(depth.array[index] >= 0 && depth.array[index] <= model.config.maxDepth);
      assert.ok(foam.array[index] >= 0 && foam.array[index] <= 1);
      assert.ok(turbulence.array[index] >= 0 && turbulence.array[index] <= 1);
      assert.ok(speed.array[index] >= 0 && speed.array[index] <= model.config.maxVelocity);
      assert.ok(wetness.array[index] === 0 || wetness.array[index] === 1);
      assert.ok(coverage.array[index] >= 0 && coverage.array[index] <= 1);
    }

    assert.equal(water.surface.userData.rtxIgnore, true);
    assert.equal(water.material.userData.rtxIgnore, true);
    assert.equal(water.material.rtxUsesResolvedPbr, 1);
    assert.ok(water.material.rtxReflectionMask > 0.9);
    assert.equal(water.material.alphaTest, 0.012);
    assert.equal(water.stats().surfaceReconstruction, "wet-aware-positive-cubic-b-spline");
    assert.equal(water.stats().surfaceTextureFamily, "waterFlow");
    assert.equal(water.stats().surfaceTextureResolution, 512);

    const logs = effects.group.children.find(object => object.name.includes("storm-felled logs"));
    assert.ok(logs?.isInstancedMesh, "floating log instances must exist");
    const initialLogMatrices = logs.instanceMatrix.array.slice();
    for (let frame = 0; frame < 180; ++frame) {
      effects.update(model.elapsedSeconds + frame / 60, 1 / 60);
    }
    const effectStats = effects.stats();
    assert.ok(effectStats.foamPatches > 0 && effectStats.foamPatches <= 720, effectStats);
    assert.ok(effectStats.causticPatches > 0 && effectStats.causticPatches <= 320, effectStats);
    assert.ok(effectStats.sprayParticles > 0 && effectStats.sprayParticles <= 980, effectStats);
    assert.ok(effectStats.mistParticles > 0 && effectStats.mistParticles <= 260, effectStats);
    assert.equal(effectStats.floatingLogs, 36);
    assert.ok(
      changedValues(initialLogMatrices, logs.instanceMatrix.array) > 0,
      "flood velocity should move or rotate floating debris",
    );

    effects.group.traverse(object => {
      for (const [name, attribute] of Object.entries(object.geometry?.attributes ?? {})) {
        assertFiniteArray(attribute.array, `${object.name || object.type}.${name}`);
      }
      if (object.instanceMatrix) {
        assertFiniteArray(object.instanceMatrix.array, `${object.name}.instanceMatrix`);
      }
    });

    for (const object of effects.group.children) {
      assert.equal(object.userData.rtxIgnore, true, `${object.name} must stay outside the moving TLAS`);
      if (object !== logs) {
        assert.equal(
          object.material?.userData?.rtxIgnore,
          true,
          `${object.name} material must stay outside RTX geometry`,
        );
      }
    }
    assert.equal(logs.material.userData.rtxIgnore, undefined);
    assert.ok(
      logs.material.rtxReflectionMask > 0 && logs.material.rtxReflectionMask <= 1,
      "wet wood may retain a reflective PBR guide while its moving instances are ignored by TLAS",
    );
  } finally {
    assert.doesNotThrow(() => effects.dispose());
    assert.equal(effects.group.parent, null);
    assert.doesNotThrow(() => water.dispose());
    water.surface.removeFromParent();
  }

  assert.deepEqual(waterDisposed, { geometry: 1, material: 1 });
});
