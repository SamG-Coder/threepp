import * as THREE from "three/webgpu";

import { createSeededRandom, MORPHO_SEED } from "./morpho-model.mjs";

const POLLEN_COUNT = 48;
const MAX_POLLEN_COUNT = 100_000;
const TAU = Math.PI * 2;

const scratchColor = new THREE.Color();
const scratchEuler = new THREE.Euler();
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const integer = Math.trunc(finite(value, fallback));
  return integer > 0 ? integer : fallback;
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function tintForMote(random) {
  const roll = random();
  if (roll < 0.08) {
    // Sparse teal bounce off the Morpho wing, still a pollen grain.
    return {
      r: 0.28 + random() * 0.22,
      g: 0.62 + random() * 0.22,
      b: 0.78 + random() * 0.18,
    };
  }
  if (roll < 0.22) {
    return {
      r: 1,
      g: 0.48 + random() * 0.18,
      b: 0.14 + random() * 0.12,
    };
  }
  if (roll < 0.55) {
    return {
      r: 0.96 + random() * 0.04,
      g: 0.84 + random() * 0.1,
      b: 0.58 + random() * 0.14,
    };
  }
  return {
    r: 1,
    g: 0.74 + random() * 0.16,
    b: 0.32 + random() * 0.18,
  };
}

function authorMotes(random, count) {
  const motes = new Array(count);
  for (let index = 0; index < count; ++index) {
    const fillBox = index % 5 === 0;
    const theta = random() * TAU;
    const radial = Math.pow(random(), 0.62);
    const homeX = fillBox ? (random() - 0.5) * 3.4 : Math.cos(theta) * radial * 1.8;
    const homeZ = fillBox ? (random() - 0.5) * 2.6 : Math.sin(theta) * radial * 1.6;
    const homeY = 0.55 + random() * 1.35;
    const tint = tintForMote(random);
    motes[index] = Object.freeze({
      index,
      homeX,
      homeY,
      homeZ,
      radius: 0.012 + random() * 0.04,
      radiusY: 0.008 + random() * 0.028,
      speed: 0.045 + random() * 0.16,
      bob: 0.55 + random() * 0.7,
      phase: random() * TAU,
      windFetch: 0.12 + random() * 0.55,
      windRate: 0.22 + random() * 0.55,
      spinX: (random() - 0.5) * 0.55,
      spinY: (random() - 0.5) * 0.85,
      spinZ: (random() - 0.5) * 0.4,
      tilt: random() * TAU,
      yaw: random() * TAU,
      roll: random() * TAU,
      size: 0.0028 + random() * 0.006,
      aspect: 0.62 + random() * 0.55,
      r: tint.r,
      g: tint.g,
      b: tint.b,
      luminance: 0.55 + random() * 0.7,
    });
  }
  return Object.freeze(motes);
}

function writeMoteMatrix(mote, elapsed, wind) {
  const orbit = elapsed * mote.speed + mote.phase;
  const sway = Math.sin(wind * mote.windRate + mote.phase);
  const drift = Math.cos(wind * mote.windRate * 0.73 + mote.phase * 1.17);
  scratchPosition.set(
    mote.homeX + Math.cos(orbit) * mote.radius + sway * mote.windFetch,
    mote.homeY + Math.sin(orbit * mote.bob) * mote.radiusY + Math.sin(wind * 0.31 + mote.phase) * 0.07,
    mote.homeZ + Math.sin(orbit) * mote.radius + drift * mote.windFetch,
  );
  scratchEuler.set(
    mote.tilt + elapsed * mote.spinX + wind * 0.05,
    mote.yaw + elapsed * mote.spinY,
    mote.roll + wind * mote.spinZ,
  );
  scratchQuaternion.setFromEuler(scratchEuler);
  scratchScale.set(mote.size, mote.size * mote.aspect, mote.size);
  scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
}

/**
 * Instanced additive pollen disks that drift on seeded orbits.
 * Raster-only motes: tagged rtxIgnore so they never enter the static BLAS.
 */
export function createPollen({ seed = MORPHO_SEED, count = POLLEN_COUNT } = {}) {
  const total = positiveInteger(count, POLLEN_COUNT);
  if (total > MAX_POLLEN_COUNT) {
    throw new RangeError("Pollen count exceeds the safe authoring limit.");
  }

  const random = createSeededRandom(seed);
  const motes = authorMotes(random, total);

  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Drifting greenhouse pollen";

  const geometry = new THREE.CircleGeometry(1, 10);
  geometry.name = "Pollen mote disk";

  const material = new THREE.MeshBasicNodeMaterial({
    name: "Additive pollen motes",
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
  });
  material.userData.rtxIgnore = true;

  const mesh = ignoreDynamicRtx(new THREE.InstancedMesh(geometry, material, total));
  mesh.name = "Instanced pollen motes";
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 26;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = total;

  for (const mote of motes) {
    writeMoteMatrix(mote, 0, 0);
    mesh.setMatrixAt(mote.index, scratchMatrix);
    scratchColor.setRGB(
      mote.r * mote.luminance,
      mote.g * mote.luminance,
      mote.b * mote.luminance,
      THREE.LinearSRGBColorSpace,
    );
    mesh.setColorAt(mote.index, scratchColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);

  let elapsed = 0;

  function update(dt, windPhase) {
    const step = Math.min(0.05, Math.max(0, finite(dt)));
    elapsed += step;
    const wind = finite(windPhase);
    for (const mote of motes) {
      writeMoteMatrix(mote, elapsed, wind);
      mesh.setMatrixAt(mote.index, scratchMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return Object.freeze({ group, update, count: total });
}
