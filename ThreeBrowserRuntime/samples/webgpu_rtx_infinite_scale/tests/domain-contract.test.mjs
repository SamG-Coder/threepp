import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import {
  buildAtomicDomain,
  buildBccCrystalDomain,
  buildEnergyDomain,
  buildNucleusDomain,
} from "../src/atomic-domains.mjs";
import { buildForgeDomain } from "../src/forge-domain.mjs";
import { buildMicrostructureDomain, buildSurfaceDomain } from "../src/mesoscale-domains.mjs";

function verifyDomain(factory, expectedId) {
  const domain = factory();
  assert.equal(domain.id, expectedId);
  assert.ok(domain.root?.isGroup);
  assert.equal(typeof domain.sampleCamera, "function");
  assert.equal(typeof domain.update, "function");
  assert.equal(typeof domain.dispose, "function");
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.001, 100);
  const target = new THREE.Vector3();
  domain.sampleCamera(0, camera, target);
  const entryDistance = camera.position.distanceTo(target);
  domain.sampleCamera(1, camera, target);
  const exitDistance = camera.position.distanceTo(target);
  assert.ok(Number.isFinite(entryDistance) && entryDistance > 2);
  assert.ok(Number.isFinite(exitDistance) && exitDistance > 0.2);
  assert.ok(exitDistance < entryDistance, `${expectedId} camera must descend toward its gateway`);
  domain.update(1.5, 1 / 60, 0.5);
  domain.dispose();
}

test("inner scale domains honor the normalized camera/update/dispose contract", () => {
  verifyDomain(buildSurfaceDomain, "surface");
  verifyDomain(buildMicrostructureDomain, "microstructure");
  verifyDomain(buildBccCrystalDomain, "crystal");
  verifyDomain(buildAtomicDomain, "atomic");
  verifyDomain(buildNucleusDomain, "nucleus");
  verifyDomain(buildEnergyDomain, "energy");
});

test("crystal domain is body-centred cubic and nucleus is iron-56", () => {
  const crystal = buildBccCrystalDomain();
  assert.equal(crystal.root.userData.scaleDomain, "CRYSTAL");
  assert.ok(crystal.root.getObjectByName("BCC shared corner atoms")?.count > 500);
  assert.ok(crystal.root.getObjectByName("BCC body-centre atoms")?.count > 300);
  crystal.dispose();

  const nucleus = buildNucleusDomain();
  assert.equal(nucleus.root.userData.protons, 26);
  assert.equal(nucleus.root.userData.neutrons, 30);
  nucleus.dispose();
});

test("the forge gateway lands near the centre of the blade face", () => {
  const forge = buildForgeDomain();
  forge.root.updateWorldMatrix(true, true);
  const blade = forge.root.getObjectByName("Scratched steel blade");
  blade.geometry.computeBoundingBox();
  const localGateway = forge.gatewayPosition.clone().applyMatrix4(
    blade.matrixWorld.clone().invert(),
  );
  assert.ok(Math.abs(localGateway.y) < 0.03, localGateway.toArray());
  assert.ok(
    Math.abs(localGateway.z - blade.geometry.boundingBox.min.z) < 0.01,
    localGateway.toArray(),
  );
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.001, 100);
  const target = new THREE.Vector3();
  forge.sampleCamera(1, camera, target);
  const faceNormal = new THREE.Vector3(0, 0, -1).transformDirection(blade.matrixWorld);
  const toCamera = camera.position.clone().sub(forge.gatewayPosition).normalize();
  assert.ok(Math.abs(faceNormal.dot(toCamera)) > Math.sin(THREE.MathUtils.degToRad(34)));
  forge.dispose();
});

test("the surface entry frame lands on real displaced steel", () => {
  const surface = buildSurfaceDomain();
  const camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.001, 100);
  const target = new THREE.Vector3();
  surface.sampleCamera(0, camera, target);
  const terrain = surface.root.getObjectByName("Blade relief — texture detail resolved as geometry");
  const positions = terrain.geometry.getAttribute("position");
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let index = 0; index < positions.count; ++index) {
    const distance = positions.getX(index) ** 2 + positions.getY(index) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  assert.ok(nearestDistance < 1e-10);
  assert.ok(Math.abs(target.z - positions.getZ(nearest)) < 1e-5);
  surface.dispose();
});
