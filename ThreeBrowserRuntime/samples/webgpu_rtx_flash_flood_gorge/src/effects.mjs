import * as THREE from "three/webgpu";
import {
  SURFACE_TEXTURE_FAMILIES,
  applySurfaceTextureSet,
} from "./surface-textures.mjs";

const MAX_FOAM_PATCHES = 420;
const MAX_CAUSTIC_PATCHES = 320;
const SPRAY_COUNT = 980;
const MIST_COUNT = 260;
const DEBRIS_COUNT = 36;

function seededRandom(seed = 0xf10df10d) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hash01(value) {
  let state = (Number(value) || 0) >>> 0;
  state ^= state >>> 16;
  state = Math.imul(state, 0x7feb352d);
  state ^= state >>> 15;
  state = Math.imul(state, 0x846ca68b);
  state ^= state >>> 16;
  return (state >>> 0) / 4294967296;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function makeSoftTexture(size = 64, smoke = false) {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(u, v);
      const ripple = smoke
        ? Math.sin(u * 8.4 + Math.sin(v * 5.2)) * Math.sin(v * 7.1 - u * 2.3) * 0.10
        : 0;
      const density = THREE.MathUtils.clamp((1 - radius) * (1.22 + ripple), 0, 1);
      const offset = (y * size + x) * 4;
      bytes[offset] = smoke ? 206 : 225;
      bytes[offset + 1] = smoke ? 219 : 240;
      bytes[offset + 2] = smoke ? 224 : 246;
      bytes[offset + 3] = Math.round(Math.pow(density, smoke ? 1.65 : 0.72) * 255);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function centeredPointUvs(count) {
  // WebGPU point primitives do not expose a portable point-sprite UV. A
  // static centre sample keeps these one-pixel particles on the opaque core
  // of their soft mask and prevents the mapped material from requesting a
  // missing geometry attribute in each raster/native compile variant.
  const values = new Float32Array(count * 2);
  values.fill(0.5);
  return new THREE.BufferAttribute(values, 2);
}

function jaggedPatchGeometry(name, points = 10) {
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let index = 0; index < points; ++index) {
    const angle = index / points * Math.PI * 2;
    const radius = 0.72 + Math.sin(index * 2.17) * 0.17 + Math.sin(index * 4.41) * 0.08;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.42, 0);
    uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
    indices.push(0, index + 1, (index + 1) % points + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.name = name;
  return geometry;
}

function modelLayout(model) {
  const width = Math.max(2, Math.trunc(finite(model?.width, 64)));
  const height = Math.max(2, Math.trunc(finite(model?.height, 160)));
  const scalar = Math.max(0.05, finite(model?.cellSize, 4));
  return {
    width,
    height,
    cellSizeX: Math.max(0.05, finite(model?.cellSizeX, scalar)),
    cellSizeZ: Math.max(0.05, finite(model?.cellSizeZ, scalar)),
    originX: finite(model?.originX ?? model?.config?.originX, -width * scalar * 0.5),
    originZ: finite(model?.originZ ?? model?.config?.originZ, -height * scalar * 0.5),
  };
}

function sampleModel(model, x, z) {
  const sample = model?.sample?.(x, z) ?? null;
  if (sample && typeof sample === "object") return sample;
  return { depth: 0, surface: 0, velocityX: 0, velocityZ: 0, speed: 0, foam: 0, turbulence: 0 };
}

export function createFloodEffects({
  model,
  bedHeight = () => 0,
  channelCenterX = () => 0,
  channelHalfWidth = () => 42,
} = {}) {
  if (!model) throw new Error("createFloodEffects requires a FlashFloodModel.");
  const layout = modelLayout(model);
  const random = seededRandom();
  const group = new THREE.Group();
  group.name = "Flash-flood foam spray mist caustics and floating timber";

  const foamTexture = makeSoftTexture(64, false);
  foamTexture.name = "Feathered aerated-water parcel mask";
  const foamMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Broken white-water rafts",
    color: 0xb5cdcc,
    map: foamTexture,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  foamMaterial.toneMapped = true;
  foamMaterial.userData.rtxIgnore = true;
  const foamPatches = new THREE.InstancedMesh(
    jaggedPatchGeometry("Asymmetric white-water patch"),
    foamMaterial,
    MAX_FOAM_PATCHES,
  );
  foamPatches.name = "Velocity-aligned breaking foam rafts";
  foamPatches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  foamPatches.frustumCulled = false;
  foamPatches.count = 0;
  foamPatches.renderOrder = 15;
  foamPatches.userData.rtxIgnore = true;
  group.add(foamPatches);

  const causticMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Flood-bed refractive caustic lenses",
    color: 0x71c2c0,
    transparent: true,
    opacity: 0.065,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  causticMaterial.toneMapped = true;
  causticMaterial.userData.rtxIgnore = true;
  const caustics = new THREE.InstancedMesh(
    jaggedPatchGeometry("Soft refractive bed caustic", 12),
    causticMaterial,
    MAX_CAUSTIC_PATCHES,
  );
  caustics.name = "Moving shallow-water caustic patches";
  caustics.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  caustics.frustumCulled = false;
  caustics.count = 0;
  caustics.renderOrder = 3;
  caustics.userData.rtxIgnore = true;
  group.add(caustics);

  const sprayTexture = makeSoftTexture(48, false);
  const sprayPositions = new Float32Array(SPRAY_COUNT * 3);
  const sprayParticles = Array.from({ length: SPRAY_COUNT }, () => ({
    active: false,
    age: 0,
    life: 1,
    velocity: new THREE.Vector3(),
  }));
  sprayPositions.fill(0);
  for (let index = 0; index < SPRAY_COUNT; ++index) sprayPositions[index * 3 + 1] = -1000;
  const sprayGeometry = new THREE.BufferGeometry();
  sprayGeometry.setAttribute("position", new THREE.BufferAttribute(sprayPositions, 3));
  sprayGeometry.setAttribute("uv", centeredPointUvs(SPRAY_COUNT));
  const sprayMaterial = new THREE.PointsNodeMaterial({
    name: "Ballistic sunset-lit flood spray",
    map: sprayTexture,
    size: 0.21,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  sprayMaterial.toneMapped = false;
  sprayMaterial.userData.rtxIgnore = true;
  const spray = new THREE.Points(sprayGeometry, sprayMaterial);
  spray.name = "Breaking-wave spray droplets";
  spray.frustumCulled = false;
  spray.renderOrder = 24;
  spray.userData.rtxIgnore = true;
  group.add(spray);

  const mistTexture = makeSoftTexture(96, true);
  const mistPositions = new Float32Array(MIST_COUNT * 3);
  const mistSizes = new Float32Array(MIST_COUNT);
  const mistParticles = Array.from({ length: MIST_COUNT }, () => ({
    active: false,
    age: 0,
    life: 1,
    velocity: new THREE.Vector3(),
  }));
  for (let index = 0; index < MIST_COUNT; ++index) {
    mistPositions[index * 3 + 1] = -1000;
    mistSizes[index] = 1;
  }
  const mistGeometry = new THREE.BufferGeometry();
  mistGeometry.setAttribute("position", new THREE.BufferAttribute(mistPositions, 3));
  mistGeometry.setAttribute("size", new THREE.BufferAttribute(mistSizes, 1));
  mistGeometry.setAttribute("uv", centeredPointUvs(MIST_COUNT));
  const mistMaterial = new THREE.PointsNodeMaterial({
    name: "Low flood mist and entrained vapour",
    map: mistTexture,
    size: 2.8,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  mistMaterial.toneMapped = false;
  mistMaterial.userData.rtxIgnore = true;
  const mist = new THREE.Points(mistGeometry, mistMaterial);
  mist.name = "Flood-front mist veil";
  mist.frustumCulled = false;
  mist.renderOrder = 22;
  mist.userData.rtxIgnore = true;
  group.add(mist);

  const wetWood = new THREE.MeshPhysicalNodeMaterial({
    name: "Ray-visible soaked flood timber",
    color: 0x241a12,
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.42,
    clearcoatRoughness: 0.16,
  });
  applySurfaceTextureSet(wetWood, SURFACE_TEXTURE_FAMILIES.DEAD_SOAKED_WOOD, {
    tint: 0xa79d94,
    roughness: 0.72,
    normalStrength: 0.68,
  });
  wetWood.rtxReflectionMask = 0.28;
  const logGeometry = new THREE.CylinderGeometry(0.24, 0.32, 4.8, 9, 3);
  logGeometry.name = "Irregular floating log";
  const logs = new THREE.InstancedMesh(logGeometry, wetWood, DEBRIS_COUNT);
  logs.name = "Floating storm-felled logs and branches";
  logs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  logs.frustumCulled = false;
  logs.castShadow = true;
  logs.receiveShadow = true;
  logs.userData.rtxIgnore = true;
  group.add(logs);

  const candidateOrder = Array.from({ length: layout.width * layout.height }, (_, index) => index)
    .sort((a, b) => hash01(a * 97 + 13) - hash01(b * 97 + 13));
  const debris = Array.from({ length: DEBRIS_COUNT }, (_, index) => {
    const z = layout.originZ + (8 + random() * Math.min(88, layout.height * 0.42)) * layout.cellSizeZ;
    const center = finite(channelCenterX(z), 0);
    const half = Math.max(4, finite(channelHalfWidth(z), 34));
    return {
      x: center + (random() - 0.5) * half * 1.35,
      z,
      velocityX: 0,
      velocityZ: 0,
      yaw: random() * Math.PI * 2,
      roll: (random() - 0.5) * 0.3,
      length: 0.72 + random() * 0.72,
      radius: 0.72 + random() * 0.46,
      phase: random() * Math.PI * 2,
      // Different sizes and orientations couple to the fast surface current
      // differently.  Keeping this deterministic avoids a school of logs
      // accelerating as one rigid body.
      transport: 0.98 + random() * 0.18,
      response: 2.5 + random() * 1.9,
      wander: 0.18 + random() * 0.58,
      wanderRate: 0.48 + random() * 0.92,
      index,
    };
  });
  const initialDebris = debris.map(record => ({ ...record }));

  const dummy = new THREE.Object3D();
  const spraySources = [];
  let sprayCursor = 0;
  let mistCursor = 0;
  let sprayRemainder = 0;
  let mistRemainder = 0;
  let previousEffectTime = Number.NaN;

  function cellSource(index) {
    const zIndex = Math.floor(index / layout.width);
    const xIndex = index - zIndex * layout.width;
    const x = layout.originX + (xIndex + 0.5) * layout.cellSizeX;
    const z = layout.originZ + (zIndex + 0.5) * layout.cellSizeZ;
    const storedBed = model.bed && index < model.bed.length
      ? Number(model.bed[index])
      : Number.NaN;
    const bed = Number.isFinite(storedBed) ? storedBed : finite(bedHeight(x, z));
    const depth = Math.max(0, finite(model.depth?.[index]));
    return {
      index,
      x,
      z,
      bed,
      y: finite(model.surface?.[index], bed + depth),
      depth,
      foam: THREE.MathUtils.clamp(finite(model.foam?.[index]), 0, 1),
      turbulence: THREE.MathUtils.clamp(finite(model.turbulence?.[index]), 0, 1),
      speed: Math.max(0, finite(model.speed?.[index])),
      vx: finite(model.velocityX?.[index]),
      vz: finite(model.velocityZ?.[index]),
    };
  }

  function updateSurfaceDetail(time) {
    spraySources.length = 0;
    let foamCount = 0;
    let causticCount = 0;
    for (const index of candidateOrder) {
      const source = cellSource(index);
      if (source.depth < 0.025) continue;
      const score = source.foam * 0.72 + source.turbulence * 0.68 + Math.min(1, source.speed / 8) * 0.22;
      const foamSelection = hash01(index * 113 + 29);
      if (score > 0.21 && foamSelection > 0.37 && foamCount < MAX_FOAM_PATCHES) {
        // A solver cell is only the source of a foam parcel, not its render
        // position.  Advect parcels continuously along the local current and
        // stagger their recycle distance.  This hides the regular 4 m solver
        // lattice without lowering detail or adding any geometry.
        const velocityLength = Math.hypot(source.vx, source.vz);
        const directionX = velocityLength > 0.08 ? source.vx / velocityLength : 0;
        const directionZ = velocityLength > 0.08 ? source.vz / velocityLength : 1;
        const normalX = -directionZ;
        const normalZ = directionX;
        const travelSeed = hash01(index * 149 + 47);
        const laneSeed = hash01(index * 157 + 61);
        const breakupSeed = hash01(index * 163 + 73);
        const travelSpan = layout.cellSizeZ * (4.5 + travelSeed * 4.0);
        const advectiveSpeed = Math.max(1.8, velocityLength) * (0.76 + travelSeed * 0.34);
        const travelUnit = (travelSeed + time * advectiveSpeed / travelSpan) % 1;
        const along = (travelUnit - 0.5) * travelSpan;
        const cross = (laneSeed - 0.5) * layout.cellSizeX * 1.42 +
          Math.sin(time * (0.62 + breakupSeed * 0.74) + breakupSeed * Math.PI * 2) *
          layout.cellSizeX * (0.07 + source.turbulence * 0.14);
        let foamX = source.x + directionX * along + normalX * cross;
        let foamZ = source.z + directionZ * along + normalZ * cross;
        let advected = sampleModel(model, foamX, foamZ);
        if (finite(advected.depth) < 0.018) {
          // Near the advancing edge, keep the parcel in its wet source cell
          // while retaining both longitudinal and transverse jitter to break
          // the row.  A hash-staggered fallback is preferable to snapping
          // every bore parcel back onto the same solver-cell centre line.
          const safeAlong = (travelSeed - 0.5) * layout.cellSizeZ * 0.78;
          foamX = source.x + directionX * safeAlong + normalX * cross * 0.32;
          foamZ = source.z + directionZ * safeAlong + normalZ * cross * 0.32;
          advected = sampleModel(model, foamX, foamZ);
        }
        const foamY = finite(advected.surface, source.y);
        const advectedVx = finite(advected.velocityX ?? advected.vx, source.vx);
        const advectedVz = finite(advected.velocityZ ?? advected.vz, source.vz);
        const angle = Math.atan2(advectedVx, advectedVz);
        const breakup = 0.72 + Math.sin(
          time * (1.1 + breakupSeed * 1.7) + breakupSeed * Math.PI * 2,
        ) * 0.22;
        const width = (0.28 + score * 0.65 + hash01(index * 31) * 0.24) * breakup;
        dummy.position.set(foamX, foamY + 0.055, foamZ);
        dummy.rotation.set(-Math.PI * 0.5, 0, angle + (hash01(index * 37) - 0.5) * 0.82);
        // The source geometry is already vertically compressed, so a fuller
        // second scale makes broken rafts instead of long ruler-like strokes.
        dummy.scale.set(width, width * (1.0 + hash01(index * 41) * 0.8), 1);
        dummy.updateMatrix();
        foamPatches.setMatrixAt(foamCount++, dummy.matrix);
        if (score > 0.52 && spraySources.length < 96) {
          spraySources.push({
            ...source,
            x: foamX,
            y: foamY,
            z: foamZ,
            vx: advectedVx,
            vz: advectedVz,
            turbulence: THREE.MathUtils.clamp(
              Math.max(source.turbulence, finite(advected.turbulence)),
              0,
              1,
            ),
          });
        }
      }
      // The solver correctly produces a long aerated wake, so caustics cannot
      // require almost foam-free water. Retain them in the calmer gaps behind
      // the surge while suppressing only the most opaque hydraulic jumps.
      if (source.depth > 0.04 && source.depth < 2.35 &&
          source.foam < 0.82 && source.turbulence < 0.78 &&
          causticCount < MAX_CAUSTIC_PATCHES) {
        const phase = hash01(index * 173 + 19);
        const causticX = source.x + (hash01(index * 179 + 23) - 0.5) * layout.cellSizeX * 1.35 +
          Math.sin(time * 0.19 + phase * Math.PI * 2) * layout.cellSizeX * 0.12;
        const causticZ = source.z + (hash01(index * 181 + 31) - 0.5) * layout.cellSizeZ * 1.35 +
          Math.cos(time * 0.16 + phase * Math.PI * 2) * layout.cellSizeZ * 0.1;
        const causticSample = sampleModel(model, causticX, causticZ);
        const pulse = 0.75 + Math.sin(time * (0.58 + phase * 0.48) + phase * Math.PI * 2) * 0.18;
        dummy.position.set(causticX, finite(causticSample.bed, bedHeight(causticX, causticZ)) + 0.035, causticZ);
        dummy.rotation.set(-Math.PI * 0.5, 0, phase * Math.PI * 2 + time * (0.009 + phase * 0.018));
        dummy.scale.set((0.7 + source.depth * 0.55) * pulse, (0.38 + source.depth * 0.18) * pulse, 1);
        dummy.updateMatrix();
        caustics.setMatrixAt(causticCount++, dummy.matrix);
      }
      if (foamCount >= MAX_FOAM_PATCHES && causticCount >= MAX_CAUSTIC_PATCHES && spraySources.length >= 96) break;
    }
    foamPatches.count = foamCount;
    foamPatches.instanceMatrix.needsUpdate = true;
    caustics.count = causticCount;
    caustics.instanceMatrix.needsUpdate = true;
  }

  function spawnSpray(particle, source, mistParticle = false) {
    const radial = Math.sqrt(random()) * (mistParticle ? 2.5 : 0.72);
    const angle = random() * Math.PI * 2;
    const flowLength = Math.hypot(source.vx, source.vz);
    const sideX = flowLength > 0.08 ? -source.vz / flowLength : 1;
    const sideZ = flowLength > 0.08 ? source.vx / flowLength : 0;
    const transport = mistParticle ? 0.34 + random() * 0.18 : 0.72 + random() * 0.3;
    const lateral = (random() - 0.5) * (mistParticle ? 1.15 : 2.35) *
      (0.45 + source.turbulence * 0.85);
    particle.active = true;
    particle.age = 0;
    particle.life = mistParticle ? 4.5 + random() * 5.5 : 0.75 + random() * 1.35;
    particle.velocity.set(
      source.vx * transport + sideX * lateral + Math.cos(angle) * radial * 0.44,
      mistParticle ? 0.5 + random() * 0.7 : 3.0 + random() * 5.0 + source.turbulence * 3.2,
      source.vz * transport + sideZ * lateral + Math.sin(angle) * radial * 0.44,
    );
    return {
      x: source.x + Math.cos(angle) * radial,
      y: source.y + 0.12 + random() * 0.35,
      z: source.z + Math.sin(angle) * radial,
    };
  }

  function updateParticles(delta) {
    if (spraySources.length) {
      const sourceEnergy = spraySources.reduce((sum, source) => sum + source.turbulence + source.foam, 0);
      sprayRemainder += delta * Math.min(320, 24 + sourceEnergy * 7.5);
      mistRemainder += delta * Math.min(42, 2 + sourceEnergy * 0.65);
    }
    while (sprayRemainder >= 1 && spraySources.length) {
      const source = spraySources[sprayCursor % spraySources.length];
      const particle = sprayParticles[sprayCursor];
      const origin = spawnSpray(particle, source, false);
      const offset = sprayCursor * 3;
      sprayPositions[offset] = origin.x;
      sprayPositions[offset + 1] = origin.y;
      sprayPositions[offset + 2] = origin.z;
      sprayCursor = (sprayCursor + 1) % SPRAY_COUNT;
      sprayRemainder -= 1;
    }
    while (mistRemainder >= 1 && spraySources.length) {
      const source = spraySources[mistCursor % spraySources.length];
      const particle = mistParticles[mistCursor];
      const origin = spawnSpray(particle, source, true);
      const offset = mistCursor * 3;
      mistPositions[offset] = origin.x;
      mistPositions[offset + 1] = origin.y;
      mistPositions[offset + 2] = origin.z;
      mistSizes[mistCursor] = 1.6 + random() * 2.4;
      mistCursor = (mistCursor + 1) % MIST_COUNT;
      mistRemainder -= 1;
    }

    for (let index = 0; index < SPRAY_COUNT; ++index) {
      const particle = sprayParticles[index];
      if (!particle.active) continue;
      particle.age += delta;
      const offset = index * 3;
      particle.velocity.y -= 7.4 * delta;
      sprayPositions[offset] += particle.velocity.x * delta;
      sprayPositions[offset + 1] += particle.velocity.y * delta;
      sprayPositions[offset + 2] += particle.velocity.z * delta;
      if (particle.age >= particle.life || sprayPositions[offset + 1] < bedHeight(sprayPositions[offset], sprayPositions[offset + 2])) {
        particle.active = false;
        sprayPositions[offset + 1] = -1000;
      }
    }
    for (let index = 0; index < MIST_COUNT; ++index) {
      const particle = mistParticles[index];
      if (!particle.active) continue;
      particle.age += delta;
      const offset = index * 3;
      particle.velocity.y += 0.055 * delta;
      mistPositions[offset] += particle.velocity.x * delta;
      mistPositions[offset + 1] += particle.velocity.y * delta;
      mistPositions[offset + 2] += particle.velocity.z * delta;
      mistSizes[index] += delta * 0.42;
      if (particle.age >= particle.life) {
        particle.active = false;
        mistPositions[offset + 1] = -1000;
      }
    }
    sprayGeometry.getAttribute("position").needsUpdate = true;
    mistGeometry.getAttribute("position").needsUpdate = true;
    mistGeometry.getAttribute("size").needsUpdate = true;
  }

  function updateDebris(time, delta) {
    const bounds = model.worldBounds ?? {};
    const downstream = finite(bounds.maxZ, layout.originZ + layout.height * layout.cellSizeZ);
    const upstream = finite(bounds.minZ, layout.originZ);
    for (const record of debris) {
      let sample = sampleModel(model, record.x, record.z);
      const depth = Math.max(0, finite(sample.depth));
      if (depth > 0.08) {
        const targetVx = finite(sample.velocityX ?? sample.vx);
        const targetVz = finite(sample.velocityZ ?? sample.vz);
        const targetLength = Math.hypot(targetVx, targetVz);
        const sideX = targetLength > 0.08 ? -targetVz / targetLength : 1;
        const sideZ = targetLength > 0.08 ? targetVx / targetLength : 0;
        const turbulence = THREE.MathUtils.clamp(finite(sample.turbulence), 0, 1);
        const lateral = Math.sin(time * record.wanderRate + record.phase) * record.wander *
          (0.35 + turbulence * 0.95);
        const surge = 1 + Math.sin(time * (0.7 + record.wanderRate * 0.31) + record.phase * 1.7) *
          turbulence * 0.055;
        const advectedVx = targetVx * record.transport * surge + sideX * lateral;
        const advectedVz = targetVz * record.transport * surge + sideZ * lateral;
        const ease = 1 - Math.exp(-delta * record.response);
        record.velocityX = THREE.MathUtils.lerp(record.velocityX, advectedVx, ease);
        record.velocityZ = THREE.MathUtils.lerp(record.velocityZ, advectedVz, ease);
        record.x += record.velocityX * delta;
        record.z += record.velocityZ * delta;
        const center = finite(channelCenterX(record.z), 0);
        const half = Math.max(3, finite(channelHalfWidth(record.z), 32)) * 0.76;
        record.x = THREE.MathUtils.clamp(record.x, center - half, center + half);
        if (Math.hypot(record.velocityX, record.velocityZ) > 0.08) {
          const targetYaw = Math.atan2(record.velocityX, record.velocityZ) + Math.PI * 0.5;
          const yawDifference = Math.atan2(
            Math.sin(targetYaw - record.yaw),
            Math.cos(targetYaw - record.yaw),
          );
          record.yaw += yawDifference * (1 - Math.exp(-delta * 2.35));
        }
      } else {
        record.velocityX *= Math.exp(-delta * 2.2);
        record.velocityZ *= Math.exp(-delta * 2.2);
      }
      if (record.z > downstream - layout.cellSizeZ) {
        record.z = upstream + (8 + hash01(record.index * 127 + Math.floor(time) * 3) * 28) * layout.cellSizeZ;
        const center = finite(channelCenterX(record.z), 0);
        const half = Math.max(3, finite(channelHalfWidth(record.z), 32));
        record.x = center + (hash01(record.index * 131 + 7) - 0.5) * half;
      }
      sample = sampleModel(model, record.x, record.z);
      const sampledSurface = Number(sample.surface);
      const surfaceY = Number.isFinite(sampledSurface)
        ? sampledSurface
        : bedHeight(record.x, record.z) + finite(sample.depth);
      const bob = Math.sin(time * 1.6 + record.phase) * (0.025 + Math.min(0.12, finite(sample.turbulence) * 0.1));
      dummy.position.set(record.x, surfaceY + 0.18 + bob, record.z);
      dummy.rotation.set(Math.PI * 0.5 + record.roll + Math.sin(time * 0.8 + record.phase) * 0.04, record.yaw, 0);
      dummy.scale.set(record.radius, record.length, record.radius);
      dummy.updateMatrix();
      logs.setMatrixAt(record.index, dummy.matrix);
    }
    logs.instanceMatrix.needsUpdate = true;
  }

  function update(time, delta) {
    const safeTime = finite(time);
    const suppliedDelta = THREE.MathUtils.clamp(finite(delta), 0, 0.5);
    let motionDelta = suppliedDelta;
    if (suppliedDelta > 0 && Number.isFinite(previousEffectTime) && safeTime >= previousEffectTime) {
      // main.mjs deliberately caps visual delta more tightly than simulation
      // delta.  Recover that lost interval from simulation time so particles
      // and timber do not move at half speed on a busy GPU frame.
      motionDelta = Math.max(
        suppliedDelta,
        THREE.MathUtils.clamp(safeTime - previousEffectTime, 0, 0.5),
      );
    }
    previousEffectTime = safeTime;
    updateSurfaceDetail(safeTime);
    // Keep ballistic spray and buoyant timber stable while consuming the
    // entire interval instead of silently dropping everything beyond 50 ms.
    let remaining = motionDelta;
    let steppedTime = safeTime - motionDelta;
    while (remaining > 1e-6) {
      const step = Math.min(0.05, remaining);
      steppedTime += step;
      updateParticles(step);
      updateDebris(steppedTime, step);
      remaining -= step;
    }
    if (motionDelta <= 1e-6) updateDebris(safeTime, 0);
  }

  function reset() {
    sprayCursor = 0;
    mistCursor = 0;
    sprayRemainder = 0;
    mistRemainder = 0;
    previousEffectTime = Number.NaN;
    for (let index = 0; index < SPRAY_COUNT; ++index) {
      sprayParticles[index].active = false;
      sprayParticles[index].age = 0;
      sprayPositions[index * 3 + 1] = -1000;
    }
    for (let index = 0; index < MIST_COUNT; ++index) {
      mistParticles[index].active = false;
      mistParticles[index].age = 0;
      mistPositions[index * 3 + 1] = -1000;
      mistSizes[index] = 1;
    }
    debris.forEach((record, index) => Object.assign(record, initialDebris[index]));
    foamPatches.count = 0;
    caustics.count = 0;
    sprayGeometry.getAttribute("position").needsUpdate = true;
    mistGeometry.getAttribute("position").needsUpdate = true;
    mistGeometry.getAttribute("size").needsUpdate = true;
    updateDebris(0, 0);
  }

  update(0, 0);
  return {
    group,
    update,
    reset,
    stats() {
      return {
        foamPatches: foamPatches.count,
        causticPatches: caustics.count,
        sprayParticles: sprayParticles.filter(particle => particle.active).length,
        mistParticles: mistParticles.filter(particle => particle.active).length,
        floatingLogs: DEBRIS_COUNT,
      };
    },
    dispose() {
      group.removeFromParent();
      for (const object of [foamPatches, caustics, spray, mist, logs]) {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      }
      sprayTexture.dispose();
      mistTexture.dispose();
      foamTexture.dispose();
    },
  };
}
