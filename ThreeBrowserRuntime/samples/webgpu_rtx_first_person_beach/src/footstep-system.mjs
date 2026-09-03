import * as THREE from "three/webgpu";
import { float, positionWorld, texture, uniform, vec2 } from "three/tsl";
import {
  FOOTSTEP_SURFACES,
  advanceStride,
  classifyBeachSurface,
  createStrideTracker,
  footprintFacing,
} from "./footstep-logic.mjs";
import { WATER_LEVEL, terrainHeight } from "./terrain.mjs";

const IMPRESSION_COUNT = 64;
const MASK_SIZE = 1024;
const MASK_WORLD_SIZE = 42;
const SOLE_MIN_Z = -0.142;
const SOLE_MAX_Z = 0.145;
const SOLE_PROFILE = [
  [SOLE_MIN_Z, 0.004], [-0.13, 0.035], [-0.085, 0.062], [-0.02, 0.07],
  [0.06, 0.059], [0.125, 0.04], [SOLE_MAX_Z, 0.004],
];

function soleHalfWidth(z) {
  for (let i = 1; i < SOLE_PROFILE.length; i += 1) {
    const previous = SOLE_PROFILE[i - 1];
    const next = SOLE_PROFILE[i];
    if (z <= next[0]) {
      const amount = (z - previous[0]) / Math.max(1e-6, next[0] - previous[0]);
      return THREE.MathUtils.lerp(previous[1], next[1], THREE.MathUtils.clamp(amount, 0, 1));
    }
  }
  return 0;
}

function treadDepth(across, along, row, column) {
  const transverse = row % 5 === 1 ? 0.0024 : 0;
  const staggeredLug = (row + Math.floor(column / 2)) % 4 === 0 ? 0.0017 : 0;
  const centreGroove = Math.abs(across) < 0.22 && along > 0.18 && along < 0.82 ? 0.0015 : 0;
  return transverse + staggeredLug + centreGroove;
}

function createDepressedFootprintGeometry() {
  const rows = 29;
  const columns = 13;
  const positions = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];
  let p = 0;
  let q = 0;
  for (let row = 0; row < rows; row += 1) {
    const along = row / (rows - 1);
    const z = THREE.MathUtils.lerp(SOLE_MIN_Z, SOLE_MAX_Z, along);
    const width = soleHalfWidth(z);
    for (let column = 0; column < columns; column += 1) {
      const across = column / (columns - 1) * 2 - 1;
      const x = width * across;
      const edge = Math.pow(Math.abs(across), 3.2);
      const endFade = Math.pow(Math.sin(Math.PI * along), 0.38);
      // These are real vertices below the surrounding terrain surface. Tread
      // blocks press slightly deeper than the already concave sole bed.
      const depression = 0.021 * (1 - edge) * endFade
        + treadDepth(across, along, row, column) * (1 - edge);
      positions[p++] = x;
      positions[p++] = 0.002 - depression;
      positions[p++] = z;
      uvs[q++] = column / (columns - 1);
      uvs[q++] = along;
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const a = row * columns + column;
      const b = a + columns;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createTerrainHoleMask(terrainMaterial) {
  const pixels = new Uint8Array(MASK_SIZE * MASK_SIZE);
  const maskTexture = new THREE.DataTexture(
    pixels,
    MASK_SIZE,
    MASK_SIZE,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  maskTexture.name = "Dynamic terrain footprint openings";
  maskTexture.colorSpace = THREE.NoColorSpace;
  maskTexture.minFilter = THREE.LinearFilter;
  maskTexture.magFilter = THREE.LinearFilter;
  maskTexture.wrapS = THREE.ClampToEdgeWrapping;
  maskTexture.wrapT = THREE.ClampToEdgeWrapping;
  maskTexture.generateMipmaps = false;
  maskTexture.needsUpdate = true;

  const origin = new THREE.Vector2(-MASK_WORLD_SIZE * 0.5, -MASK_WORLD_SIZE * 0.5);
  const originNode = uniform(origin);
  const maskUv = vec2(
    positionWorld.x.sub(originNode.x).div(MASK_WORLD_SIZE),
    positionWorld.z.sub(originNode.y).div(MASK_WORLD_SIZE),
  );
  const hole = texture(maskTexture, maskUv).r;
  terrainMaterial.opacityNode = float(1).sub(hole);
  terrainMaterial.alphaTestNode = float(0.5);
  terrainMaterial.needsUpdate = true;

  function redraw(records, centreX, centreZ) {
    origin.set(
      Math.floor((centreX - MASK_WORLD_SIZE * 0.5) * 4) / 4,
      Math.floor((centreZ - MASK_WORLD_SIZE * 0.5) * 4) / 4,
    );
    pixels.fill(0);
    const pixelsPerWorld = MASK_SIZE / MASK_WORLD_SIZE;
    for (const record of records) {
      if (record.life <= 0) continue;
      const centrePixelX = (record.x - origin.x) * pixelsPerWorld;
      const centrePixelZ = (record.z - origin.y) * pixelsPerWorld;
      const radiusPixels = Math.ceil(0.17 * record.planarScale * pixelsPerWorld);
      const minX = Math.max(1, Math.floor(centrePixelX - radiusPixels));
      const maxX = Math.min(MASK_SIZE - 2, Math.ceil(centrePixelX + radiusPixels));
      const minZ = Math.max(1, Math.floor(centrePixelZ - radiusPixels));
      const maxZ = Math.min(MASK_SIZE - 2, Math.ceil(centrePixelZ + radiusPixels));
      for (let pz = minZ; pz <= maxZ; pz += 1) {
        const worldZ = origin.y + (pz + 0.5) / pixelsPerWorld;
        for (let px = minX; px <= maxX; px += 1) {
          const worldX = origin.x + (px + 0.5) / pixelsPerWorld;
          const dx = worldX - record.x;
          const dz = worldZ - record.z;
          const localX = (dx * record.rightX + dz * record.rightZ) / record.planarScale;
          const localZ = (dx * record.forwardX + dz * record.forwardZ) / record.planarScale;
          if (localZ < SOLE_MIN_Z || localZ > SOLE_MAX_Z) continue;
          const width = soleHalfWidth(localZ);
          const signedEdge = Math.abs(localX) / Math.max(0.001, width);
          if (signedEdge <= 1.02) {
            const feather = THREE.MathUtils.clamp((1.05 - signedEdge) * 18, 0, 1);
            pixels[pz * MASK_SIZE + px] = Math.max(
              pixels[pz * MASK_SIZE + px],
              Math.round(feather * 255),
            );
          }
        }
      }
    }
    originNode.value.copy(origin);
    maskTexture.needsUpdate = true;
  }

  return { texture: maskTexture, origin, redraw };
}

function createImpressionPool(scene, world) {
  // Clone after the weather system has attached its wetness/runoff nodes. The
  // patch therefore evaluates the exact same dry/wet sand maps, normals,
  // roughness, cloud shadows, shoreline wash and accumulated rain as terrain.
  const material = world.terrain.material.clone();
  material.name = "Terrain-owned depressed footprint material";
  material.alphaTestNode = null;
  material.alphaTest = 0;
  material.opacityNode = null;
  material.depthWrite = true;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  material.needsUpdate = true;
  const geometry = createDepressedFootprintGeometry();
  const mesh = new THREE.InstancedMesh(geometry, material, IMPRESSION_COUNT);
  mesh.name = "Vertex-depressed terrain footprint impressions";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 3;
  mesh.userData.rtxIgnore = true;
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const records = Array.from({ length: IMPRESSION_COUNT }, () => ({
    life: 0,
    lifetime: 1,
    x: 0,
    z: 0,
    forwardX: 0,
    forwardZ: 1,
    rightX: 1,
    rightZ: 0,
    planarScale: 1,
    matrix: new THREE.Matrix4(),
  }));
  for (let i = 0; i < IMPRESSION_COUNT; i += 1) mesh.setMatrixAt(i, hidden);
  scene.add(mesh);
  return { mesh, geometry, material, hidden, records, cursor: 0 };
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

function terrainNormalAt(x, z, target) {
  const radius = 0.11;
  const dx = terrainHeight(x + radius, z) - terrainHeight(x - radius, z);
  const dz = terrainHeight(x, z + radius) - terrainHeight(x, z - radius);
  return target.set(-dx / (radius * 2), 1, -dz / (radius * 2)).normalize();
}

export function createBeachFootstepSystem(scene, world, surfaceWater = null, collisionWorld = null) {
  const audio = createNativeAudioBank();
  const pool = createImpressionPool(scene, world);
  const holes = createTerrainHoleMask(world.terrain.material);
  const tracker = createStrideTracker();
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const scaledForward = new THREE.Vector3();
  const scaledRight = new THREE.Vector3();
  const scaledNormal = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  let maskCentreX = 0;
  let maskCentreZ = 0;
  let maskDirty = true;

  function leaveImpression(surface, step, ground, planarScale = 1, depthScale = 1) {
    const side = step.leftFoot ? -1 : 1;
    forward.set(step.directionX, 0, step.directionZ).normalize();
    terrainNormalAt(step.x, step.z, normal);
    forward.addScaledVector(normal, -forward.dot(normal)).normalize();
    right.crossVectors(normal, forward).normalize();
    const x = step.x + right.x * side * 0.09;
    const z = step.z + right.z * side * 0.09;
    const index = pool.cursor++ % IMPRESSION_COUNT;
    const record = pool.records[index];
    record.life = record.lifetime = surface === "wet-sand" ? 34 : 72;
    record.x = x;
    record.z = z;
    record.forwardX = forward.x;
    record.forwardZ = forward.z;
    record.rightX = right.x;
    record.rightZ = right.z;
    record.planarScale = planarScale;
    scaledRight.copy(right).multiplyScalar(planarScale);
    scaledForward.copy(forward).multiplyScalar(planarScale);
    scaledNormal.copy(normal).multiplyScalar(depthScale);
    basis.makeBasis(scaledRight, scaledNormal, scaledForward);
    basis.setPosition(x, ground + 0.0015, z);
    record.matrix.copy(basis);
    pool.mesh.setMatrixAt(index, basis);
    pool.mesh.instanceMatrix.needsUpdate = true;
    maskDirty = true;
  }

  function surfaceAt(x, z) {
    const support = collisionWorld?.surfaceAt?.(x, z)
      ?? { height: terrainHeight(x, z), kind: "terrain" };
    return {
      support,
      surface: classifyBeachSurface({
        groundHeight: support.height,
        waterLevel: WATER_LEVEL,
        wetness: surfaceWater?.wetnessAt?.(x, z) ?? 0,
        objectKind: support.kind === "terrain" ? null : support.kind,
      }),
    };
  }

  function handleLanding(view) {
    const impactSpeed = Number(view.landingImpact) || 0;
    if (impactSpeed <= 0.5) return null;
    const { directionX, directionZ } = footprintFacing(view.yaw);
    const response = surfaceAt(view.x, view.z);
    const force = THREE.MathUtils.clamp((impactSpeed - 2.5) / 5, 0, 1);
    const intensity = THREE.MathUtils.clamp(impactSpeed / 6.5, 0.55, 1);
    audio.play(response.surface, intensity);
    if (response.surface === "dry-sand" || response.surface === "wet-sand") {
      const landingStep = {
        x: view.x,
        z: view.z,
        directionX,
        directionZ,
        leftFoot: true,
      };
      const planarScale = 1.08 + force * 0.3;
      const depthScale = 1.3 + force * 1.05;
      leaveImpression(response.surface, landingStep, response.support.height, planarScale, depthScale);
      landingStep.leftFoot = false;
      leaveImpression(response.surface, landingStep, response.support.height, planarScale, depthScale);
    } else if (response.surface === "shallow-water") {
      surfaceWater?.impact?.({
        x: view.x,
        y: WATER_LEVEL + 0.025,
        z: view.z,
        kind: "water",
        intensity: 0.8 + force * 0.9,
      });
    }
    return response.surface;
  }

  function updateImpressions(dt, view) {
    let matricesChanged = false;
    for (let index = 0; index < pool.records.length; index += 1) {
      const record = pool.records[index];
      if (record.life <= 0) continue;
      record.life -= dt;
      if (record.life <= 0) {
        pool.mesh.setMatrixAt(index, pool.hidden);
        matricesChanged = true;
        maskDirty = true;
      }
    }
    if (matricesChanged) pool.mesh.instanceMatrix.needsUpdate = true;
    if (Math.hypot(view.x - maskCentreX, view.z - maskCentreZ) > 4) maskDirty = true;
    if (maskDirty) {
      maskCentreX = view.x;
      maskCentreZ = view.z;
      holes.redraw(pool.records, maskCentreX, maskCentreZ);
      maskDirty = false;
    }
  }

  return {
    arm: audio.arm,
    update(dt, view) {
      updateImpressions(dt, view);
      const landingSurface = handleLanding(view);
      if (landingSurface) {
        advanceStride(tracker, view.x, view.z, 0);
        return landingSurface;
      }
      const step = advanceStride(tracker, view.x, view.z, view.grounded ? view.speed : 0);
      if (!step) return null;
      // A footprint belongs to the player, not the velocity vector. In
      // particular, A/D strafing moves the next contact sideways while the
      // heel-to-toe axis continues to follow the direction the player faces.
      Object.assign(step, footprintFacing(view.yaw));
      const response = surfaceAt(step.x, step.z);
      audio.play(response.surface, step.intensity);
      if (response.surface === "dry-sand" || response.surface === "wet-sand") {
        leaveImpression(response.surface, step, response.support.height);
      } else if (response.surface === "shallow-water") {
        surfaceWater?.impact?.({
          x: step.x,
          y: WATER_LEVEL + 0.025,
          z: step.z,
          kind: "water",
          intensity: 0.55 + step.intensity * 0.35,
        });
      }
      return response.surface;
    },
    dispose() {
      audio.dispose();
      scene.remove(pool.mesh);
      pool.geometry.dispose();
      pool.material.dispose();
      holes.texture.dispose();
    },
  };
}
