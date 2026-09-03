import * as THREE from "three/webgpu";
import {
  FOOTSTEP_SURFACES,
  advanceStride,
  classifyBeachSurface,
  createStrideTracker,
} from "./footstep-logic.mjs";
import { WATER_LEVEL, terrainHeight } from "./terrain.mjs";

const IMPRESSION_COUNT = 64;
const UP = new THREE.Vector3(0, 1, 0);

function createFootprintGeometry() {
  // A tapered, asymmetric bare-foot/sole outline with a shallow concave bed.
  // The raised perimeter catches light while the darker centre reads as an
  // impression without modifying the large terrain heightfield every step.
  const outline = [
    [-0.105, -0.26], [-0.145, -0.17], [-0.15, -0.04], [-0.125, 0.12],
    [-0.08, 0.25], [0, 0.29], [0.085, 0.25], [0.13, 0.12],
    [0.14, -0.04], [0.125, -0.17], [0.075, -0.265], [0, -0.285],
  ];
  const positions = [];
  const indices = [];
  for (const [x, z] of outline) positions.push(x, 0.012, z);
  for (const [x, z] of outline) positions.push(x * 0.73, -0.006, z * 0.77 + 0.008);
  positions.push(0, -0.009, 0.012);
  const count = outline.length;
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    indices.push(i, next, count + i, next, count + next, count + i);
    indices.push(count * 2, count + i, count + next);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createImpressionPool(scene, wet) {
  const geometry = createFootprintGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: wet ? 0.3 : 0.96,
    metalness: 0,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, IMPRESSION_COUNT);
  mesh.name = wet ? "Wet sand footprint impressions" : "Dry sand footprint impressions";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.userData.rtxIgnore = true;
  const instances = Array.from({ length: IMPRESSION_COUNT }, () => ({ life: 0, lifetime: 1 }));
  const transform = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const color = new THREE.Color();
  for (let i = 0; i < IMPRESSION_COUNT; i += 1) {
    mesh.setMatrixAt(i, hidden);
    mesh.setColorAt(i, color.setRGB(0, 0, 0));
  }
  scene.add(mesh);
  return { mesh, geometry, material, instances, cursor: 0, transform };
}

function createNativeAudioBank() {
  const bank = new Map();
  for (const surface of FOOTSTEP_SURFACES) {
    const voices = [];
    for (let variant = 1; variant <= 2; variant += 1) {
      const source = new URL(`../assets/audio/footstep-${surface}-${variant}.wav`, import.meta.url).href;
      for (let voiceIndex = 0; voiceIndex < 2; voiceIndex += 1) {
        const voice = new Audio(source);
        voice.preload = "auto";
        voices.push(voice);
      }
    }
    bank.set(surface, { voices, cursor: 0 });
  }
  let armed = false;
  return {
    arm() {
      if (armed) return;
      armed = true;
      for (const entry of bank.values()) for (const voice of entry.voices) voice.load?.();
    },
    play(surface, intensity = 0.7) {
      const entry = bank.get(surface) ?? bank.get("dry-sand");
      if (!entry) return;
      try {
        const voice = entry.voices[entry.cursor++ % entry.voices.length];
        voice.pause();
        voice.currentTime = 0;
        voice.volume = THREE.MathUtils.clamp(0.12 + intensity * 0.28, 0.12, 0.4);
        voice.playbackRate = 0.96 + (entry.cursor % 4) * 0.018;
        voice.play()?.catch?.(error => {
          console.warn(`[First-Person Beach] Footstep playback failed: ${error?.message || error}`);
        });
      } catch (error) {
        console.warn(`[First-Person Beach] Footstep sound failed: ${error?.message || error}`);
      }
    },
    dispose() {
      for (const entry of bank.values()) for (const voice of entry.voices) {
        voice.pause();
        voice.close?.();
      }
    },
  };
}

function createWalkableColliders(world) {
  const colliders = [];
  world.dressing?.updateWorldMatrix?.(true, true);
  for (const object of world.dressing?.children ?? []) {
    const name = String(object.name || "").toLowerCase();
    if (!name.includes("rock") && !name.includes("driftwood")) continue;
    const bounds = new THREE.Box3().setFromObject(object);
    if (!bounds.isEmpty()) colliders.push({ bounds, kind: name.includes("driftwood") ? "wood" : "rock" });
  }
  return colliders;
}

function objectSurfaceAt(colliders, x, z, ground) {
  let hit = null;
  for (const collider of colliders) {
    const bounds = collider.bounds;
    if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
    // Ignore tall intersections that the terrain-only player is actually
    // walking through rather than standing on.
    if (bounds.max.y < ground - 0.04 || bounds.max.y > ground + 0.72) continue;
    if (!hit || bounds.max.y > hit.height) hit = { kind: collider.kind, height: bounds.max.y };
  }
  return hit;
}

function terrainNormalAt(x, z, target) {
  const radius = 0.11;
  const dx = terrainHeight(x + radius, z) - terrainHeight(x - radius, z);
  const dz = terrainHeight(x, z + radius) - terrainHeight(x, z - radius);
  return target.set(-dx / (radius * 2), 1, -dz / (radius * 2)).normalize();
}

export function createBeachFootstepSystem(scene, world, surfaceWater = null) {
  const audio = createNativeAudioBank();
  const colliders = createWalkableColliders(world);
  const dryPool = createImpressionPool(scene, false);
  const wetPool = createImpressionPool(scene, true);
  const tracker = createStrideTracker();
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const color = new THREE.Color();

  function leaveImpression(surface, step, ground) {
    const pool = surface === "wet-sand" ? wetPool : dryPool;
    const side = step.leftFoot ? -1 : 1;
    forward.set(step.directionX, 0, step.directionZ).normalize();
    terrainNormalAt(step.x, step.z, normal);
    forward.addScaledVector(normal, -forward.dot(normal)).normalize();
    right.crossVectors(normal, forward).normalize();
    const x = step.x + right.x * side * 0.105;
    const z = step.z + right.z * side * 0.105;
    const index = pool.cursor++ % IMPRESSION_COUNT;
    const record = pool.instances[index];
    record.life = record.lifetime = surface === "wet-sand" ? 34 : 72;
    basis.makeBasis(right, normal, forward);
    basis.setPosition(x, ground + 0.012, z);
    pool.mesh.setMatrixAt(index, basis);
    const shade = surface === "wet-sand" ? 0.19 : 0.43;
    pool.mesh.setColorAt(index, color.setRGB(shade * 0.82, shade * 0.72, shade * 0.55));
    pool.mesh.instanceMatrix.needsUpdate = true;
    if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
  }

  function updatePool(pool, dt) {
    let matricesChanged = false;
    for (let index = 0; index < pool.instances.length; index += 1) {
      const record = pool.instances[index];
      if (record.life <= 0) continue;
      record.life -= dt;
      if (record.life <= 0) {
        pool.mesh.setMatrixAt(index, new THREE.Matrix4().makeScale(0, 0, 0));
        matricesChanged = true;
      }
    }
    if (matricesChanged) pool.mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    arm: audio.arm,
    update(dt, view) {
      updatePool(dryPool, dt);
      updatePool(wetPool, dt);
      const step = advanceStride(tracker, view.x, view.z, view.speed);
      if (!step) return null;
      const ground = terrainHeight(step.x, step.z);
      const objectHit = objectSurfaceAt(colliders, step.x, step.z, ground);
      const surface = classifyBeachSurface({
        groundHeight: ground,
        waterLevel: WATER_LEVEL,
        wetness: surfaceWater?.wetnessAt?.(step.x, step.z) ?? 0,
        objectKind: objectHit?.kind,
      });
      audio.play(surface, step.intensity);
      if (surface === "dry-sand" || surface === "wet-sand") {
        leaveImpression(surface, step, ground);
      } else if (surface === "shallow-water") {
        surfaceWater?.impact?.({
          x: step.x,
          y: WATER_LEVEL + 0.025,
          z: step.z,
          kind: "water",
          intensity: 0.55 + step.intensity * 0.35,
        });
      }
      return surface;
    },
    dispose() {
      audio.dispose();
      for (const pool of [dryPool, wetPool]) {
        scene.remove(pool.mesh);
        pool.geometry.dispose();
        pool.material.dispose();
      }
    },
  };
}
