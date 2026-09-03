import * as THREE from "three/webgpu";
import { float, positionWorld, texture, uniform, vec2 } from "three/tsl";
import {
  FOOTSTEP_SURFACES,
  advanceStride,
  classifyBeachSurface,
  createStrideTracker,
  footprintFacing,
} from "./footstep-logic.mjs";
import { createWaterMaterial } from "./materials.mjs";
import { HEIGHT_BOUNDS, WATER_LEVEL, terrainHeight } from "./terrain.mjs";

const IMPRESSION_COUNT = 64;
const DIG_COUNT = 128;
const MASK_SIZE = 1024;
const MASK_WORLD_SIZE = 42;
const DIG_RADIUS_X = 0.2;
const DIG_RADIUS_Z = 0.26;
const DIG_DEPTH = 0.16;
const TERRAIN_COLUMNS = 300;
const TERRAIN_ROWS = 260;
const TERRAIN_UV_SCALE = 0.24;
const DIG_CELL_SUBDIVISIONS = 12;
const SOLE_MIN_Z = -0.142;
const SOLE_MAX_Z = 0.145;
const SEAM_COLLAR = 0.035;
const HOLE_SIDE_INSET = 0.014;
const HOLE_END_INSET = 0.02;
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
  // The level collar is wider than the filtered terrain opening. It carries
  // the exact terrain material and overlaps the uncut ground, preventing the
  // water/sky below the terrain from appearing as a coloured fringe.
  const rows = 33;
  const columns = 17;
  const positions = new Float32Array(rows * columns * 3);
  const uvs = new Float32Array(rows * columns * 2);
  const indices = [];
  let p = 0;
  let q = 0;
  for (let row = 0; row < rows; row += 1) {
    const along = row / (rows - 1);
    const z = THREE.MathUtils.lerp(
      SOLE_MIN_Z - SEAM_COLLAR,
      SOLE_MAX_Z + SEAM_COLLAR,
      along,
    );
    const soleZ = THREE.MathUtils.clamp(z, SOLE_MIN_Z, SOLE_MAX_Z);
    const soleWidth = soleHalfWidth(soleZ);
    const patchWidth = soleWidth + SEAM_COLLAR;
    for (let column = 0; column < columns; column += 1) {
      const across = column / (columns - 1) * 2 - 1;
      const x = patchWidth * across;
      const soleAcross = x / Math.max(0.001, soleWidth);
      const soleAlong = (z - SOLE_MIN_Z) / (SOLE_MAX_Z - SOLE_MIN_Z);
      const insideSole = z >= SOLE_MIN_Z && z <= SOLE_MAX_Z && Math.abs(soleAcross) <= 1;
      const edge = Math.pow(Math.min(1, Math.abs(soleAcross)), 3.2);
      const endFade = insideSole
        ? Math.pow(Math.sin(Math.PI * soleAlong), 0.38)
        : 0;
      // These are real vertices below the surrounding terrain surface. Tread
      // blocks press slightly deeper than the already concave sole bed. The
      // surrounding collar remains level to close the terrain-mask seam.
      const depression = insideSole
        ? 0.021 * (1 - edge) * endFade
          + treadDepth(soleAcross, soleAlong, row, column) * (1 - edge) * endFade
        : 0;
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

function createDigState(scene, heightMap) {
  const waterGeometry = new THREE.CircleGeometry(1, 32);
  waterGeometry.rotateX(-Math.PI * 0.5);
  // This is the beach water material itself, evaluated in local-pool mode so
  // its colour, reflections, cloud lighting, normals and transparency match
  // the ocean while each depression retains its own CPU-controlled height.
  const waterMaterial = createWaterMaterial(heightMap, null, {
    localPool: true,
    depth: 0.12,
  });
  const water = new THREE.InstancedMesh(waterGeometry, waterMaterial, DIG_COUNT);
  water.name = "Water retained inside shovel cuts";
  water.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  water.frustumCulled = false;
  water.renderOrder = 5;
  water.userData.rtxIgnore = true;

  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const records = Array.from({ length: DIG_COUNT }, (_, index) => ({
    index,
    active: false,
    x: 0,
    z: 0,
    forwardX: 0,
    forwardZ: 1,
    rightX: 1,
    rightZ: 0,
    rimHeight: 0,
    depth: DIG_DEPTH,
    waterDepth: 0,
    seaConnected: false,
  }));
  for (let index = 0; index < DIG_COUNT; index += 1) {
    water.setMatrixAt(index, hidden);
  }
  water.instanceMatrix.needsUpdate = true;
  scene.add(water);
  return {
    water,
    waterGeometry,
    waterMaterial,
    hidden,
    records,
    cursor: 0,
  };
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
          if (
            localZ < SOLE_MIN_Z + HOLE_END_INSET
            || localZ > SOLE_MAX_Z - HOLE_END_INSET
          ) continue;
          const width = soleHalfWidth(localZ) - HOLE_SIDE_INSET;
          if (width <= 0 || Math.abs(localX) >= width) continue;
          const edgeDistance = Math.min(
            width - Math.abs(localX),
            localZ - (SOLE_MIN_Z + HOLE_END_INSET),
            (SOLE_MAX_Z - HOLE_END_INSET) - localZ,
          );
          if (edgeDistance > 0) {
            // Keep the alpha-tested opening safely inside both the depressed
            // sole and its level collar. The short feather only anti-aliases
            // inward, so a filtered texel can never expose the background.
            const feather = THREE.MathUtils.clamp(edgeDistance * 110, 0, 1);
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

function createEditedTerrainGeometry(heightAt, digRecords, baseGeometry) {
  const { minX, maxX, minZ, maxZ } = HEIGHT_BOUNDS;
  const cellWidth = (maxX - minX) / TERRAIN_COLUMNS;
  const cellDepth = (maxZ - minZ) / TERRAIN_ROWS;
  const refined = new Set();

  // Every vertex samples the shared collision height function. Overlapping
  // and repeated cuts therefore become one continuous edited terrain surface
  // instead of intersecting replacement bowls.
  for (const record of digRecords) {
    if (!record.active) continue;
    const radius = Math.max(DIG_RADIUS_X, DIG_RADIUS_Z);
    const minColumn = Math.max(0, Math.floor((record.x - radius - minX) / cellWidth) - 1);
    const maxColumn = Math.min(TERRAIN_COLUMNS - 1, Math.floor((record.x + radius - minX) / cellWidth) + 1);
    const minRow = Math.max(0, Math.floor((record.z - radius - minZ) / cellDepth) - 1);
    const maxRow = Math.min(TERRAIN_ROWS - 1, Math.floor((record.z + radius - minZ) / cellDepth) + 1);
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let column = minColumn; column <= maxColumn; column += 1) {
        refined.add(row * TERRAIN_COLUMNS + column);
      }
    }
  }

  const basePositions = baseGeometry.getAttribute("position");
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const normalStep = 0.045;

  function addVertex(x, y, z) {
    const dx = heightAt(x + normalStep, z) - heightAt(x - normalStep, z);
    const dz = heightAt(x, z + normalStep) - heightAt(x, z - normalStep);
    const nx = -dx / (normalStep * 2);
    const nz = -dz / (normalStep * 2);
    const inverseLength = 1 / Math.hypot(nx, 1, nz);
    const index = positions.length / 3;
    positions.push(x, y, z);
    normals.push(nx * inverseLength, inverseLength, nz * inverseLength);
    uvs.push(x * TERRAIN_UV_SCALE, z * TERRAIN_UV_SCALE);
    return index;
  }

  for (const key of refined) {
    const row = Math.floor(key / TERRAIN_COLUMNS);
    const column = key % TERRAIN_COLUMNS;
    const stride = TERRAIN_COLUMNS + 1;
    const corner00 = basePositions.getY(row * stride + column);
    const corner10 = basePositions.getY(row * stride + column + 1);
    const corner01 = basePositions.getY((row + 1) * stride + column);
    const corner11 = basePositions.getY((row + 1) * stride + column + 1);
    const patch = new Uint32Array((DIG_CELL_SUBDIVISIONS + 1) ** 2);
    for (let localRow = 0; localRow <= DIG_CELL_SUBDIVISIONS; localRow += 1) {
      const v = localRow / DIG_CELL_SUBDIVISIONS;
      const z = minZ + (row + v) * cellDepth;
      for (let localColumn = 0; localColumn <= DIG_CELL_SUBDIVISIONS; localColumn += 1) {
        const u = localColumn / DIG_CELL_SUBDIVISIONS;
        const x = minX + (column + u) * cellWidth;
        // The outer edge follows the exact two triangles of the neighbouring
        // coarse cell. This prevents the white/sky cracks visible between the
        // editable terrain and the unchanged beach.
        const diagonalFirst = u <= v;
        const coarseHeight = diagonalFirst
          ? corner00 * (1 - v) + corner01 * (v - u) + corner11 * u
          : corner00 * (1 - u) + corner11 * v + corner10 * (u - v);
        const leftOpen = localColumn === 0
          && (column === 0 || !refined.has(key - 1));
        const rightOpen = localColumn === DIG_CELL_SUBDIVISIONS
          && (column === TERRAIN_COLUMNS - 1 || !refined.has(key + 1));
        const nearOpen = localRow === 0
          && (row === 0 || !refined.has(key - TERRAIN_COLUMNS));
        const farOpen = localRow === DIG_CELL_SUBDIVISIONS
          && (row === TERRAIN_ROWS - 1 || !refined.has(key + TERRAIN_COLUMNS));
        const boundary = leftOpen || rightOpen || nearOpen || farOpen;
        const y = boundary ? coarseHeight : heightAt(x, z);
        patch[localRow * (DIG_CELL_SUBDIVISIONS + 1) + localColumn] = addVertex(x, y, z);
      }
    }
    for (let localRow = 0; localRow < DIG_CELL_SUBDIVISIONS; localRow += 1) {
      for (let localColumn = 0; localColumn < DIG_CELL_SUBDIVISIONS; localColumn += 1) {
        const a = patch[localRow * (DIG_CELL_SUBDIVISIONS + 1) + localColumn];
        const b = patch[(localRow + 1) * (DIG_CELL_SUBDIVISIONS + 1) + localColumn];
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = "Refined editable beach heightfield";
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, refined };
}

function createUneditedTerrainIndex(refined) {
  const indices = new Uint32Array((TERRAIN_COLUMNS * TERRAIN_ROWS - refined.size) * 6);
  const stride = TERRAIN_COLUMNS + 1;
  let offset = 0;
  for (let row = 0; row < TERRAIN_ROWS; row += 1) {
    for (let column = 0; column < TERRAIN_COLUMNS; column += 1) {
      if (refined.has(row * TERRAIN_COLUMNS + column)) continue;
      const a = row * stride + column;
      const b = a + stride;
      indices[offset++] = a;
      indices[offset++] = b;
      indices[offset++] = a + 1;
      indices[offset++] = a + 1;
      indices[offset++] = b;
      indices[offset++] = b + 1;
    }
  }
  return new THREE.Uint32BufferAttribute(indices, 1);
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
  const digs = createDigState(scene, world.heightMap);
  const holes = createTerrainHoleMask(world.terrain.material);
  const originalTerrainGeometry = world.terrain.geometry;
  const originalTerrainIndex = originalTerrainGeometry.getIndex();
  const editableTerrain = new THREE.Mesh(new THREE.BufferGeometry(), world.terrain.material);
  editableTerrain.name = "Locally editable beach terrain cells";
  editableTerrain.receiveShadow = true;
  editableTerrain.castShadow = true;
  editableTerrain.userData.rtxIgnore = true;
  let refinedSignature = "";
  const tracker = createStrideTracker();
  const normal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const scaledForward = new THREE.Vector3();
  const scaledRight = new THREE.Vector3();
  const scaledNormal = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const waterTransform = new THREE.Object3D();
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

  function rebuildTerrainGeometry() {
    if (!collisionWorld?.terrainHeightAt) return;
    const edit = createEditedTerrainGeometry(
      collisionWorld.terrainHeightAt,
      digs.records,
      originalTerrainGeometry,
    );
    const nextSignature = [...edit.refined].sort((a, b) => a - b).join(",");
    if (nextSignature !== refinedSignature) {
      originalTerrainGeometry.setIndex(createUneditedTerrainIndex(edit.refined));
      refinedSignature = nextSignature;
    }
    const previousGeometry = editableTerrain.geometry;
    editableTerrain.geometry = edit.geometry;
    previousGeometry.dispose();
    if (!editableTerrain.parent) scene.add(editableTerrain);
  }

  function eraseFootprintsNearDig(record) {
    let erased = 0;
    for (let index = 0; index < pool.records.length; index += 1) {
      const footprint = pool.records[index];
      if (footprint.life <= 0) continue;
      const dx = footprint.x - record.x;
      const dz = footprint.z - record.z;
      // Treat each sole as a compact swept area rather than testing only its
      // centre. A shovel cut that clips the heel or toe must remove the whole
      // impression; leaving half of the alpha opening would expose the sky or
      // water underneath the edited terrain cell.
      const soleReach = 0.13 * footprint.planarScale;
      const localX = dx * record.rightX + dz * record.rightZ;
      const localZ = dx * record.forwardX + dz * record.forwardZ;
      const overlap = Math.pow(Math.abs(localX) / (DIG_RADIUS_X + soleReach), 3)
        + Math.pow(Math.abs(localZ) / (DIG_RADIUS_Z + soleReach), 3);
      if (overlap > 1) continue;
      footprint.life = 0;
      pool.mesh.setMatrixAt(index, pool.hidden);
      erased += 1;
    }
    if (erased > 0) {
      pool.mesh.instanceMatrix.needsUpdate = true;
      maskDirty = true;
    }
    return erased;
  }

  function digSand(hit) {
    const x = Number(hit.x);
    const z = Number(hit.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    let record = digs.records.find(candidate => candidate.active
      && Math.hypot(candidate.x - x, candidate.z - z) < 0.16);
    if (record) {
      record.depth = Math.min(0.3, record.depth + 0.055);
      record.rimHeight = Math.max(record.rimHeight, terrainHeight(x, z));
    } else {
      record = digs.records[digPoolCursor()];
      record.active = true;
      record.x = x;
      record.z = z;
      record.forwardX = Number(hit.forwardX) || 0;
      record.forwardZ = Number(hit.forwardZ) || 1;
      const length = Math.hypot(record.forwardX, record.forwardZ) || 1;
      record.forwardX /= length;
      record.forwardZ /= length;
      record.rightX = record.forwardZ;
      record.rightZ = -record.forwardX;
      record.rimHeight = terrainHeight(x, z);
      record.depth = DIG_DEPTH;
      record.waterDepth = 0;
    }
    record.seaConnected = record.rimHeight <= WATER_LEVEL + 0.2
      && record.rimHeight - record.depth < WATER_LEVEL;
    const captured = surfaceWater?.removeStandingWater?.(x, z, 0.2) ?? 0;
    record.waterDepth = Math.min(record.depth - 0.008, record.waterDepth + captured);
    const erasedFootprints = eraseFootprintsNearDig(record);
    collisionWorld?.setTerrainDepression?.(record.index, {
      x: record.x,
      z: record.z,
      forwardX: record.forwardX,
      forwardZ: record.forwardZ,
      rightX: record.rightX,
      rightZ: record.rightZ,
      radiusX: DIG_RADIUS_X,
      radiusZ: DIG_RADIUS_Z,
      depth: record.depth,
    });
    digs.lastEdited = record;
    rebuildTerrainGeometry();
    const erasedLabel = erasedFootprints > 0 ? ` · erased ${erasedFootprints} footprint(s)` : "";
    console.log(`[First-Person Beach] Removed shovel-sized sand chunk at ${x.toFixed(2)}, ${z.toFixed(2)}${erasedLabel}`);
    return true;
  }

  function digPoolCursor() {
    const index = digs.cursor;
    digs.cursor = (digs.cursor + 1) % DIG_COUNT;
    return index;
  }

  function updateDigWater(dt) {
    for (let i = 0; i < digs.records.length; i += 1) {
      const a = digs.records[i];
      if (!a.active) continue;
      for (let j = i + 1; j < digs.records.length; j += 1) {
        const b = digs.records[j];
        if (!b.active || Math.hypot(a.x - b.x, a.z - b.z) > 0.48) continue;
        if (a.seaConnected || b.seaConnected) a.seaConnected = b.seaConnected = true;
        const aSurface = a.rimHeight - a.depth + a.waterDepth;
        const bSurface = b.rimHeight - b.depth + b.waterDepth;
        const transfer = THREE.MathUtils.clamp((aSurface - bSurface) * dt * 0.8, -0.02, 0.02);
        a.waterDepth = THREE.MathUtils.clamp(a.waterDepth - transfer, 0, a.depth - 0.008);
        b.waterDepth = THREE.MathUtils.clamp(b.waterDepth + transfer, 0, b.depth - 0.008);
      }
    }

    for (const record of digs.records) {
      if (!record.active) continue;
      const bottom = record.rimHeight - record.depth;
      const seaDepth = record.seaConnected
        ? THREE.MathUtils.clamp(WATER_LEVEL - bottom, 0, record.depth - 0.008)
        : 0;
      const runoffDepth = surfaceWater?.standingWaterDepthAt?.(record.x, record.z) ?? 0;
      // Wet sand is not standing water. A cut only exposes water when it
      // reaches the sea table or runoff actually enters the depression.
      const targetDepth = Math.max(seaDepth, runoffDepth);
      const rate = targetDepth > record.waterDepth ? 0.08 : 0.025;
      record.waterDepth = THREE.MathUtils.damp(record.waterDepth, targetDepth, rate * 60, dt);
      if (record.waterDepth > 0.006) {
        waterTransform.position.set(record.x, bottom + record.waterDepth + 0.004, record.z);
        waterTransform.rotation.set(0, Math.atan2(record.forwardX, record.forwardZ), 0);
        const fill = THREE.MathUtils.clamp(record.waterDepth / record.depth, 0, 1);
        waterTransform.scale.set(DIG_RADIUS_X * (0.62 + fill * 0.28), 1, DIG_RADIUS_Z * (0.62 + fill * 0.28));
        waterTransform.updateMatrix();
        digs.water.setMatrixAt(record.index, waterTransform.matrix);
      } else {
        digs.water.setMatrixAt(record.index, digs.hidden);
      }
    }
    digs.water.instanceMatrix.needsUpdate = true;
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
    dig: digSand,
    update(dt, view) {
      updateImpressions(dt, view);
      updateDigWater(dt);
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
      scene.remove(pool.mesh, digs.water, editableTerrain);
      originalTerrainGeometry.setIndex(originalTerrainIndex);
      editableTerrain.geometry.dispose();
      pool.geometry.dispose();
      pool.material.dispose();
      digs.waterGeometry.dispose();
      digs.waterMaterial.dispose();
      holes.texture.dispose();
    },
  };
}
