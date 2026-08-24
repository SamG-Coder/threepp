import * as THREE from "three/webgpu";
import {
  abs,
  attribute,
  color,
  float,
  mix,
  positionLocal,
  pow,
  sin,
  smoothstep,
  vec3,
} from "three/tsl";
import { graphicsTime, worldStorm, worldWind } from "./state.mjs";
import { riverCenterZ, terrainHeight, terrainNormal, trailCenterX } from "../world/terrain.mjs";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function insideExclusion(x, z, exclusions) {
  for (const exclusion of exclusions) {
    const dx = x - Number(exclusion.x ?? exclusion.center?.[0] ?? 0);
    const dz = z - Number(exclusion.z ?? exclusion.center?.[2] ?? 0);
    const radius = Number(exclusion.radius ?? Math.max(exclusion.halfExtents?.[0] ?? 0, exclusion.halfExtents?.[2] ?? 0));
    if (dx * dx + dz * dz < (radius + 1.5) * (radius + 1.5)) return true;
  }
  return false;
}

function makeGrassMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "One-draw wind-reactive valley grass",
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
    roughness: 0.91,
    metalness: 0,
  });
  const root = attribute("grassRoot", "vec3");
  const phase = attribute("grassPhase", "float");
  const flex = attribute("grassFlex", "float");
  const tint = attribute("grassTint", "vec3");
  const tip = pow(smoothstep(0, 1, flex), 1.7);
  const gust = sin(
    graphicsTime.mul(1.7)
      .add(phase)
      .add(root.x.mul(0.087))
      .sub(root.z.mul(0.061)),
  );
  const cross = sin(
    graphicsTime.mul(2.31)
      .add(phase.mul(1.91))
      .add(root.z.mul(0.104)),
  );
  const strength = worldStorm.mul(0.34).add(0.13).mul(tip);
  material.positionNode = vec3(
    positionLocal.x.add(gust.mul(worldWind.x).mul(strength)),
    positionLocal.y.sub(abs(gust).mul(strength).mul(flex).mul(0.12)),
    positionLocal.z.add(cross.mul(worldWind.y).mul(strength)),
  );
  const tipLight = mix(float(0.68), float(1.12), flex);
  material.colorNode = tint.mul(tipLight).mul(sin(positionLocal.y.mul(8).add(phase)).mul(0.025).add(0.975));
  material.roughnessNode = mix(float(0.96), float(0.82), flex);
  return material;
}

function pushGrassBlade(buffers, spec) {
  const segments = 3;
  const base = buffers.positions.length / 3;
  const rightX = Math.cos(spec.yaw);
  const rightZ = -Math.sin(spec.yaw);
  for (let row = 0; row <= segments; ++row) {
    const flex = row / segments;
    const width = spec.width * Math.max(0.03, Math.pow(1 - flex, 0.74));
    const lean = flex * flex * spec.height * spec.lean;
    const centerX = spec.x + Math.sin(spec.yaw) * lean;
    const centerZ = spec.z + Math.cos(spec.yaw) * lean;
    for (const side of [-1, 1]) {
      buffers.positions.push(
        centerX + rightX * width * 0.5 * side,
        spec.y + flex * spec.height,
        centerZ + rightZ * width * 0.5 * side,
      );
      buffers.uvs.push((side + 1) * 0.5, flex);
      buffers.roots.push(spec.x, spec.y, spec.z);
      buffers.phases.push(spec.phase);
      buffers.flexes.push(flex);
      buffers.tints.push(spec.tint.r, spec.tint.g, spec.tint.b);
    }
  }
  for (let row = 0; row < segments; ++row) {
    const a = base + row * 2;
    buffers.indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
}

function createGrass(exclusions, seed = 0x67726173) {
  const random = seededRandom(seed);
  const buffers = {
    positions: [],
    uvs: [],
    roots: [],
    phases: [],
    flexes: [],
    tints: [],
    indices: [],
  };
  const greenTints = [new THREE.Color(0x395132), new THREE.Color(0x4c653b), new THREE.Color(0x68744a)];
  const cropTints = [new THREE.Color(0x927b3a), new THREE.Color(0xb39b4d), new THREE.Color(0xc0a85a)];
  const candidates = 2550;
  let placed = 0;
  for (let index = 0; index < candidates && placed < 1850; ++index) {
    let x;
    let z;
    let crop = false;
    if (index < 650) {
      crop = true;
      const fieldSide = index & 1 ? 1 : -1;
      x = fieldSide * (46 + random() * 53);
      z = 84 + random() * 55;
    } else {
      x = -190 + random() * 380;
      z = -160 + random() * 355;
    }
    if (Math.abs(z - riverCenterZ(x)) < 12) continue;
    if (!crop && Math.abs(x - trailCenterX(z)) < 5.4) continue;
    if (insideExclusion(x, z, exclusions)) continue;
    const normal = terrainNormal(x, z);
    if (normal.y < 0.82) continue;
    const tintList = crop ? cropTints : greenTints;
    pushGrassBlade(buffers, {
      x,
      y: terrainHeight(x, z) + 0.03,
      z,
      height: crop ? 1.0 + random() * 0.55 : 0.35 + random() * 0.72,
      width: crop ? 0.08 + random() * 0.06 : 0.05 + random() * 0.08,
      yaw: random() * Math.PI * 2,
      lean: (random() - 0.5) * 0.15,
      phase: random() * Math.PI * 2,
      tint: tintList[Math.floor(random() * tintList.length)],
    });
    placed += 1;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute("grassRoot", new THREE.Float32BufferAttribute(buffers.roots, 3));
  geometry.setAttribute("grassPhase", new THREE.Float32BufferAttribute(buffers.phases, 1));
  geometry.setAttribute("grassFlex", new THREE.Float32BufferAttribute(buffers.flexes, 1));
  geometry.setAttribute("grassTint", new THREE.Float32BufferAttribute(buffers.tints, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 2;
  const material = makeGrassMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `Merged grass and crop field (${placed} blades)`;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.userData.rtxIgnore = true;
  return { mesh, material, geometry, placed };
}

function treeAllowed(x, z, exclusions) {
  if (Math.abs(z - riverCenterZ(x)) < 18) return false;
  if (Math.abs(x - trailCenterX(z)) < 10) return false;
  if (x * x + (z - 5) * (z - 5) < 70 * 70) return false;
  if (insideExclusion(x, z, exclusions)) return false;
  return terrainNormal(x, z).y > 0.72;
}

function chooseTreePosition(random, patch, exclusions) {
  for (let attempt = 0; attempt < 28; ++attempt) {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * patch.radius;
    const x = patch.x + Math.cos(angle) * distance;
    const z = patch.z + Math.sin(angle) * distance;
    if (treeAllowed(x, z, exclusions)) return { x, z };
  }
  return null;
}

function makeCanopyMaterial(baseMaterial, name, pine = false) {
  const material = baseMaterial.clone();
  material.name = name;
  const phase = attribute("treePhase", "float");
  const flex = smoothstep(pine ? -3 : -1, pine ? 5 : 3.6, positionLocal.y);
  const gust = sin(graphicsTime.mul(0.92).add(phase).add(positionLocal.y.mul(0.21)));
  const strength = worldStorm.mul(0.22).add(0.055).mul(flex);
  material.positionNode = vec3(
    positionLocal.x.add(gust.mul(worldWind.x).mul(strength)),
    positionLocal.y.sub(abs(gust).mul(strength).mul(0.04)),
    positionLocal.z.add(gust.mul(worldWind.y).mul(strength)),
  );
  const natural = sin(positionLocal.x.mul(2.3).add(positionLocal.z.mul(1.7))).mul(0.5).add(0.5);
  material.colorNode = mix(
    color(pine ? 0x112b20 : 0x234329),
    color(pine ? 0x31533a : 0x4c6335),
    natural,
  );
  return material;
}

function createTrees(materials, exclusions, seed = 0x74726565) {
  const random = seededRandom(seed);
  const patches = [
    { x: -126, z: -57, radius: 76, pineChance: 0.35 },
    { x: 124, z: -70, radius: 75, pineChance: 0.55 },
    { x: -15, z: -113, radius: 78, pineChance: 0.68 },
    { x: -154, z: 126, radius: 47, pineChance: 0.25 },
    { x: 158, z: 132, radius: 45, pineChance: 0.30 },
  ];
  const placements = [];
  for (let index = 0; index < 360; ++index) {
    const patch = patches[Math.floor(random() * patches.length)];
    const point = chooseTreePosition(random, patch, exclusions);
    if (!point) continue;
    placements.push({
      ...point,
      pine: random() < patch.pineChance,
      scale: 0.72 + random() * 0.72,
      yaw: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
    });
  }
  const broadleaf = placements.filter((item) => !item.pine);
  const pines = placements.filter((item) => item.pine);
  const trunkGeometry = new THREE.CylinderGeometry(0.45, 0.72, 7.2, 7, 1);
  trunkGeometry.translate(0, 3.6, 0);
  const canopyGeometry = new THREE.DodecahedronGeometry(3.2, 1);
  canopyGeometry.scale(1.1, 1.35, 1.05);
  canopyGeometry.translate(0, 7.7, 0);
  const pineGeometry = new THREE.ConeGeometry(4.0, 9.2, 9, 3);
  pineGeometry.translate(0, 7.4, 0);
  const broadleafMaterial = makeCanopyMaterial(materials.leaf, "Instanced broadleaf canopy", false);
  const pineMaterial = makeCanopyMaterial(materials.pine, "Instanced pine canopy", true);
  canopyGeometry.setAttribute("treePhase", new THREE.InstancedBufferAttribute(new Float32Array(broadleaf.map((item) => item.phase)), 1));
  pineGeometry.setAttribute("treePhase", new THREE.InstancedBufferAttribute(new Float32Array(pines.map((item) => item.phase)), 1));

  const trunks = new THREE.InstancedMesh(trunkGeometry, materials.wood, placements.length);
  const crowns = new THREE.InstancedMesh(canopyGeometry, broadleafMaterial, broadleaf.length);
  const pineCrowns = new THREE.InstancedMesh(pineGeometry, pineMaterial, pines.length);
  trunks.name = `Shared tree trunks (${placements.length})`;
  crowns.name = `Wind-reactive broadleaf crowns (${broadleaf.length})`;
  pineCrowns.name = `Wind-reactive pine crowns (${pines.length})`;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  let broadleafIndex = 0;
  let pineIndex = 0;
  for (let index = 0; index < placements.length; ++index) {
    const item = placements[index];
    position.set(item.x, terrainHeight(item.x, item.z), item.z);
    quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, item.yaw);
    scale.set(item.scale, item.scale, item.scale);
    matrix.compose(position, quaternion, scale);
    trunks.setMatrixAt(index, matrix);
    if (item.pine) pineCrowns.setMatrixAt(pineIndex++, matrix);
    else crowns.setMatrixAt(broadleafIndex++, matrix);
  }
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  pineCrowns.instanceMatrix.needsUpdate = true;
  trunks.castShadow = true;
  trunks.receiveShadow = true;
  crowns.castShadow = true;
  pineCrowns.castShadow = true;
  crowns.userData.rtxIgnore = true;
  pineCrowns.userData.rtxIgnore = true;
  return {
    trunks,
    crowns,
    pineCrowns,
    placements,
    materials: [broadleafMaterial, pineMaterial],
    geometries: [trunkGeometry, canopyGeometry, pineGeometry],
  };
}

/** Build shared instanced trees plus one merged field of grass and barley. */
export function createVegetation(materials, { exclusions = [], seed } = {}) {
  const group = new THREE.Group();
  group.name = "Instanced forest and merged valley vegetation";
  const grass = createGrass(exclusions, seed ?? 0x67726173);
  const trees = createTrees(materials, exclusions, (seed ?? 0x67726173) ^ 0x13198a2e);
  group.add(trees.trunks, trees.crowns, trees.pineCrowns, grass.mesh);
  return {
    group,
    treePlacements: trees.placements,
    grassCount: grass.placed,
    update() {},
    dispose() {
      grass.geometry.dispose();
      grass.material.dispose();
      for (const geometry of trees.geometries) geometry.dispose();
      for (const material of trees.materials) material.dispose();
    },
  };
}

export function createWindBanner(materials, {
  colorValue = 0x7f2c2c,
  width = 2.6,
  height = 5.2,
  phase = 0,
  name = "Wind banner",
} = {}) {
  const group = new THREE.Group();
  group.name = name;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, height + 3, 8), materials.wood);
  pole.position.y = (height + 3) * 0.5;
  pole.castShadow = true;
  group.add(pole);
  const geometry = new THREE.PlaneGeometry(width, height, 8, 12);
  geometry.translate(width * 0.5 + 0.12, height * 0.5 + 2.1, 0);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: `${name} cloth`,
    color: colorValue,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const horizontalFlex = smoothstep(0.1, width + 0.2, positionLocal.x);
  const ripple = sin(
    graphicsTime.mul(3.0)
      .add(positionLocal.x.mul(3.2))
      .add(positionLocal.y.mul(0.44))
      .add(phase),
  );
  const push = worldStorm.mul(0.32).add(0.12).mul(horizontalFlex);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y.sub(abs(ripple).mul(push).mul(0.12)),
    positionLocal.z.add(ripple.mul(push).mul(worldWind.x)),
  );
  material.colorNode = mix(color(colorValue).mul(0.56), color(colorValue), smoothstep(0, height + 2.1, positionLocal.y));
  const cloth = new THREE.Mesh(geometry, material);
  cloth.name = `${name} wind-reactive cloth`;
  cloth.castShadow = true;
  cloth.userData.rtxIgnore = true;
  group.add(cloth);
  return {
    group,
    dispose() {
      pole.geometry.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
