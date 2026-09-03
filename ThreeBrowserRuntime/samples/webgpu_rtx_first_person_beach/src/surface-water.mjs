import * as THREE from "three/webgpu";
import { float, mix, positionWorld, texture, vec2, vec3 } from "three/tsl";
import { HEIGHT_BOUNDS, WATER_LEVEL, terrainHeight } from "./terrain.mjs";

const FIELD_SIZE = 96;
const FLOW_STEP = 1 / 12;
const RIPPLE_COUNT = 72;
const SPLASH_COUNT = 720;
const BEAD_COUNT = 520;
const GRAVITY = 9.81;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function fieldIndex(x, z) {
  const u = clamp01((x - HEIGHT_BOUNDS.minX) / (HEIGHT_BOUNDS.maxX - HEIGHT_BOUNDS.minX));
  const v = clamp01((z - HEIGHT_BOUNDS.minZ) / (HEIGHT_BOUNDS.maxZ - HEIGHT_BOUNDS.minZ));
  return {
    x: Math.min(FIELD_SIZE - 1, Math.floor(u * FIELD_SIZE)),
    z: Math.min(FIELD_SIZE - 1, Math.floor(v * FIELD_SIZE)),
  };
}

function attachTerrainWetness(world, wetnessTexture) {
  const material = world?.terrain?.material;
  if (!material?.isMeshStandardNodeMaterial) return;
  const spanX = HEIGHT_BOUNDS.maxX - HEIGHT_BOUNDS.minX;
  const spanZ = HEIGHT_BOUNDS.maxZ - HEIGHT_BOUNDS.minZ;
  const uv = vec2(
    positionWorld.x.sub(HEIGHT_BOUNDS.minX).div(spanX),
    positionWorld.z.sub(HEIGHT_BOUNDS.minZ).div(spanZ),
  );
  const rainWetness = texture(wetnessTexture, uv).r;
  const wetBlend = rainWetness.mul(0.92);
  const originalColor = material.colorNode;
  const originalRoughness = material.roughnessNode;
  material.colorNode = mix(
    originalColor,
    originalColor.mul(vec3(0.46, 0.55, 0.62)),
    wetBlend,
  );
  material.roughnessNode = mix(originalRoughness, float(0.11), wetBlend);
  material.userData.rainWetnessTexture = wetnessTexture;
  material.needsUpdate = true;
}

function createAccumulationField(world) {
  let water = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  let next = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  const memory = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  const heights = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  const pixels = new Uint8Array(FIELD_SIZE * FIELD_SIZE * 4);
  const spanX = HEIGHT_BOUNDS.maxX - HEIGHT_BOUNDS.minX;
  const spanZ = HEIGHT_BOUNDS.maxZ - HEIGHT_BOUNDS.minZ;

  for (let z = 0; z < FIELD_SIZE; z += 1) {
    for (let x = 0; x < FIELD_SIZE; x += 1) {
      const wx = HEIGHT_BOUNDS.minX + (x + 0.5) / FIELD_SIZE * spanX;
      const wz = HEIGHT_BOUNDS.minZ + (z + 0.5) / FIELD_SIZE * spanZ;
      heights[z * FIELD_SIZE + x] = terrainHeight(wx, wz);
      pixels[(z * FIELD_SIZE + x) * 4 + 3] = 255;
    }
  }

  const wetnessTexture = new THREE.DataTexture(
    pixels,
    FIELD_SIZE,
    FIELD_SIZE,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  wetnessTexture.name = "Rain accumulation and downhill runoff";
  wetnessTexture.colorSpace = THREE.NoColorSpace;
  wetnessTexture.minFilter = THREE.LinearFilter;
  wetnessTexture.magFilter = THREE.LinearFilter;
  wetnessTexture.wrapS = THREE.ClampToEdgeWrapping;
  wetnessTexture.wrapT = THREE.ClampToEdgeWrapping;
  wetnessTexture.generateMipmaps = false;
  wetnessTexture.needsUpdate = true;
  attachTerrainWetness(world, wetnessTexture);

  function deposit(x, z, amount) {
    const cell = fieldIndex(x, z);
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const px = cell.x + dx;
        const pz = cell.z + dz;
        if (px < 0 || pz < 0 || px >= FIELD_SIZE || pz >= FIELD_SIZE) continue;
        const index = pz * FIELD_SIZE + px;
        const weight = dx === 0 && dz === 0 ? 0.48 : (dx === 0 || dz === 0 ? 0.085 : 0.045);
        water[index] = Math.min(1.5, water[index] + amount * weight);
        memory[index] = Math.min(1, memory[index] + amount * weight * 5.5);
      }
    }
  }

  function wetnessAt(x, z) {
    const cell = fieldIndex(x, z);
    const index = cell.z * FIELD_SIZE + cell.x;
    return clamp01(memory[index] + water[index] * 3.8);
  }

  function standingWaterDepthAt(x, z) {
    const cell = fieldIndex(x, z);
    return Math.max(0, water[cell.z * FIELD_SIZE + cell.x] * 0.42);
  }

  function registerDepression(x, z, radius, depth) {
    const centre = fieldIndex(x, z);
    const cellRadiusX = Math.max(1, Math.ceil(radius / (spanX / FIELD_SIZE)));
    const cellRadiusZ = Math.max(1, Math.ceil(radius / (spanZ / FIELD_SIZE)));
    for (let dz = -cellRadiusZ; dz <= cellRadiusZ; dz += 1) {
      for (let dx = -cellRadiusX; dx <= cellRadiusX; dx += 1) {
        const px = centre.x + dx;
        const pz = centre.z + dz;
        if (px < 1 || pz < 1 || px >= FIELD_SIZE - 1 || pz >= FIELD_SIZE - 1) continue;
        const distance = Math.hypot(dx / cellRadiusX, dz / cellRadiusZ);
        if (distance > 1.42) continue;
        const weight = 1 - THREE.MathUtils.smoothstep(distance, 0.25, 1.42);
        const index = pz * FIELD_SIZE + px;
        const wx = HEIGHT_BOUNDS.minX + (px + 0.5) / FIELD_SIZE * spanX;
        const wz = HEIGHT_BOUNDS.minZ + (pz + 0.5) / FIELD_SIZE * spanZ;
        heights[index] = Math.min(heights[index], terrainHeight(wx, wz) - depth * weight);
      }
    }
  }

  function removeStandingWater(x, z, amount) {
    const cell = fieldIndex(x, z);
    const index = cell.z * FIELD_SIZE + cell.x;
    const removed = Math.min(water[index], Math.max(0, amount));
    water[index] -= removed;
    return removed * 0.42;
  }

  const neighbours = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];

  function flowStep() {
    next.set(water);
    for (let z = 1; z < FIELD_SIZE - 1; z += 1) {
      for (let x = 1; x < FIELD_SIZE - 1; x += 1) {
        const index = z * FIELD_SIZE + x;
        const amount = water[index];
        if (amount <= 0.00001) {
          memory[index] *= 0.9992;
          continue;
        }
        if (heights[index] < WATER_LEVEL - 0.02) {
          next[index] *= 0.58;
          memory[index] *= 0.996;
          continue;
        }
        const head = heights[index] + amount * 0.42;
        let lowestIndex = index;
        let lowestHead = head;
        for (const [dx, dz] of neighbours) {
          const neighbour = (z + dz) * FIELD_SIZE + x + dx;
          const neighbourHead = heights[neighbour] + water[neighbour] * 0.42;
          if (neighbourHead < lowestHead) {
            lowestHead = neighbourHead;
            lowestIndex = neighbour;
          }
        }
        if (lowestIndex !== index) {
          const slope = Math.max(0, head - lowestHead);
          const transfer = Math.min(amount * 0.3, slope * 0.12 + amount * 0.025);
          next[index] -= transfer;
          next[lowestIndex] += transfer;
        }
        next[index] *= 0.9994;
        memory[index] = Math.max(memory[index] * 0.9992, clamp01(amount * 4.2));
      }
    }
    [water, next] = [next, water];
    for (let i = 0; i < water.length; i += 1) {
      const visible = clamp01(memory[i] + water[i] * 3.8);
      const value = Math.round(visible * 255);
      const pixel = i * 4;
      pixels[pixel] = value;
      pixels[pixel + 1] = value;
      pixels[pixel + 2] = value;
    }
    wetnessTexture.needsUpdate = true;
  }

  let accumulator = 0;
  return {
    texture: wetnessTexture,
    deposit,
    wetnessAt,
    standingWaterDepthAt,
    registerDepression,
    removeStandingWater,
    update(dt) {
      accumulator += Math.min(0.05, Math.max(0, dt));
      let steps = 0;
      while (accumulator >= FLOW_STEP && steps < 3) {
        flowStep();
        accumulator -= FLOW_STEP;
        steps += 1;
      }
    },
    dispose() {
      wetnessTexture.dispose();
    },
  };
}

function createObjectColliders(world) {
  const colliders = [];
  world?.dressing?.updateWorldMatrix?.(true, true);
  for (const object of world?.dressing?.children ?? []) {
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) continue;
    const name = String(object.name || "").toLowerCase();
    const kind = name.includes("palm") ? "foliage"
      : name.includes("driftwood") ? "wood"
        : "rock";
    colliders.push({ object, bounds, kind });
  }
  return colliders;
}

function createRipples(scene) {
  const geometry = new THREE.RingGeometry(0.78, 1, 28);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicMaterial({
    color: 0x9ed9ef,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, RIPPLE_COUNT);
  mesh.name = "Rain impact water ripples";
  mesh.frustumCulled = false;
  mesh.renderOrder = 28;
  mesh.userData.rtxIgnore = true;
  const impacts = Array.from({ length: RIPPLE_COUNT }, () => ({ life: 0, x: 0, z: 0 }));
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < RIPPLE_COUNT; i += 1) {
    transform.scale.setScalar(0);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, color.setRGB(0, 0, 0));
  }
  scene.add(mesh);
  let cursor = 0;
  return {
    mesh,
    spawn(x, z) {
      const impact = impacts[cursor];
      cursor = (cursor + 1) % impacts.length;
      impact.life = 1;
      impact.x = x;
      impact.z = z;
    },
    update(dt) {
      for (let i = 0; i < impacts.length; i += 1) {
        const impact = impacts[i];
        impact.life = Math.max(0, impact.life - dt * 1.8);
        const progress = 1 - impact.life;
        const scale = impact.life > 0 ? 0.08 + progress * 0.68 : 0;
        transform.position.set(impact.x, WATER_LEVEL + 0.035, impact.z);
        transform.scale.setScalar(scale);
        transform.updateMatrix();
        mesh.setMatrixAt(i, transform.matrix);
        const brightness = impact.life * impact.life;
        mesh.setColorAt(i, color.setRGB(brightness * 0.55, brightness * 0.82, brightness));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}

function createPointPool(scene, count, name, size, opacity) {
  const positions = new Float32Array(count * 3);
  positions.fill(-1000);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute);
  const material = new THREE.PointsMaterial({
    color: 0xc9efff,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = name;
  points.frustumCulled = false;
  points.renderOrder = 29;
  points.userData.rtxIgnore = true;
  scene.add(points);
  return { positions, attribute, geometry, material, points };
}

export function createSurfaceWaterSystem(scene, world, random = Math.random) {
  const accumulation = createAccumulationField(world);
  const colliders = createObjectColliders(world);
  const ripples = createRipples(scene);
  const splashPool = createPointPool(scene, SPLASH_COUNT, "Rain impact splash droplets", 0.065, 0.78);
  const beadPool = createPointPool(scene, BEAD_COUNT, "Rain beads on wet surfaces", 0.052, 0.64);
  const splashes = Array.from({ length: SPLASH_COUNT }, () => ({ life: 0, vx: 0, vy: 0, vz: 0 }));
  const beads = Array.from({ length: BEAD_COUNT }, () => ({ life: 0 }));
  let splashCursor = 0;
  let beadCursor = 0;

  function findObjectImpact(x, z, previousY, nextY) {
    let result = null;
    for (const collider of colliders) {
      const { bounds } = collider;
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      const surfaceY = bounds.max.y;
      if (previousY >= surfaceY && nextY <= surfaceY
        && surfaceY > terrainHeight(x, z) + 0.12
        && (!result || surfaceY > result.y)) {
        result = { x, y: surfaceY + 0.025, z, kind: collider.kind, object: collider.object };
      }
    }
    return result;
  }

  function spawnSplash(x, y, z, kind, intensity) {
    const count = kind === "water" ? 6 : kind === "terrain" ? 3 : 5;
    const spread = kind === "foliage" ? 1.05 : 0.68;
    for (let i = 0; i < count; i += 1) {
      const index = splashCursor;
      splashCursor = (splashCursor + 1) % SPLASH_COUNT;
      const particle = splashes[index];
      particle.life = 0.18 + random() * 0.28;
      particle.vx = (random() * 2 - 1) * spread;
      particle.vy = (0.48 + random() * 1.25) * intensity;
      particle.vz = (random() * 2 - 1) * spread;
      const offset = index * 3;
      splashPool.positions[offset] = x;
      splashPool.positions[offset + 1] = y;
      splashPool.positions[offset + 2] = z;
    }
  }

  function spawnBead(x, y, z, kind) {
    const index = beadCursor;
    beadCursor = (beadCursor + 1) % BEAD_COUNT;
    beads[index].life = kind === "terrain" ? 2.5 + random() * 3.5 : 4 + random() * 6;
    const offset = index * 3;
    beadPool.positions[offset] = x + (random() * 2 - 1) * 0.08;
    beadPool.positions[offset + 1] = y + 0.018 + random() * 0.035;
    beadPool.positions[offset + 2] = z + (random() * 2 - 1) * 0.08;
  }

  function impact(hit) {
    const intensity = Math.max(0.25, Number(hit.intensity) || 1);
    if (hit.kind === "water") {
      ripples.spawn(hit.x, hit.z);
      spawnSplash(hit.x, hit.y, hit.z, "water", intensity);
      return;
    }
    if (hit.kind === "terrain") {
      const before = accumulation.wetnessAt(hit.x, hit.z);
      accumulation.deposit(hit.x, hit.z, 0.024 * intensity);
      spawnSplash(hit.x, hit.y, hit.z, "terrain", 0.42 + before * 0.72);
      if (before > 0.14 || random() < 0.18) spawnBead(hit.x, hit.y, hit.z, "terrain");
      return;
    }
    spawnSplash(hit.x, hit.y, hit.z, hit.kind, 0.75 + intensity * 0.35);
    spawnBead(hit.x, hit.y, hit.z, hit.kind);
  }

  function updatePoints(dt) {
    for (let i = 0; i < splashes.length; i += 1) {
      const particle = splashes[i];
      if (particle.life <= 0) continue;
      particle.life -= dt;
      const offset = i * 3;
      if (particle.life <= 0) {
        splashPool.positions[offset + 1] = -1000;
        continue;
      }
      particle.vy -= GRAVITY * dt;
      splashPool.positions[offset] += particle.vx * dt;
      splashPool.positions[offset + 1] += particle.vy * dt;
      splashPool.positions[offset + 2] += particle.vz * dt;
    }
    for (let i = 0; i < beads.length; i += 1) {
      const bead = beads[i];
      if (bead.life <= 0) continue;
      bead.life -= dt;
      if (bead.life <= 0) beadPool.positions[i * 3 + 1] = -1000;
    }
    splashPool.attribute.needsUpdate = true;
    beadPool.attribute.needsUpdate = true;
  }

  return {
    texture: accumulation.texture,
    findObjectImpact,
    impact,
    wetnessAt: accumulation.wetnessAt,
    standingWaterDepthAt: accumulation.standingWaterDepthAt,
    registerDepression: accumulation.registerDepression,
    removeStandingWater: accumulation.removeStandingWater,
    update(dt) {
      accumulation.update(dt);
      ripples.update(dt);
      updatePoints(dt);
    },
    dispose() {
      accumulation.dispose();
      ripples.dispose();
      for (const pool of [splashPool, beadPool]) {
        scene.remove(pool.points);
        pool.geometry.dispose();
        pool.material.dispose();
      }
    },
  };
}
