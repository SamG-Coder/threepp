import * as THREE from "three/webgpu";
import {
  color,
  float,
  max,
  mix,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

// These are renderer capacities, not a mandate to fill the whole valley. The
// live counts still follow the simulation, while the wider ceilings let a
// mature 50-90 metre broken front retain tree/crown detail instead of dropping
// down to one marker per cell.
const MAX_VISIBLE_CELLS = 180;
const MAX_FLAME_ANCHORS = 1_280;
const MAX_GROUND_FLAMES = 44;
const MAX_EMISSION_SOURCES = 96;
const MAX_SMOKE = 1_080;
const EMBER_COUNT = 1_800;
const MAX_FALLEN_LOGS = 160;
const MAX_LOG_EMBER_CRACKS = MAX_FALLEN_LOGS * 2;
const MAX_CHAR_BRANCHES = 420;
const MAX_ASH_BEDS = 320;
const MAX_GLOW_FISSURES = 640;
const MAX_GLOW_COALS = 900;
const RESIDUAL_GLOW_DECAY_SECONDS = 210;
// The native path receives the full, shadow-tested emitter energy below. The
// ordinary Three point lights are intentionally softer and shorter ranged so
// the raster fallback reads as warm bounce instead of circular white pools.
const RASTER_LIGHT_INTENSITY_SCALE = 0.42;
const RASTER_LIGHT_RANGE_SCALE = 0.62;
const MAX_RASTER_LIGHT_RANGE = 18;
const fireTime = uniform(0);

function seededRandom(seed = 0x66697265) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeSmokeTexture(size = 128) {
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(u * 0.96, v);
      const edge = THREE.MathUtils.smoothstep(1 - radius, 0, 0.72);
      const billow = Math.sin(u * 8.7 + Math.sin(v * 5.1) * 1.4)
        * Math.sin(v * 9.3 - Math.cos(u * 4.7) * 1.2);
      const fine = Math.sin((u + v) * 23.2) * Math.sin((u - v) * 17.4);
      const density = THREE.MathUtils.clamp(edge * (0.72 + billow * 0.18 + fine * 0.10), 0, 1);
      const offset = (y * size + x) * 4;
      bytes[offset] = 236;
      bytes[offset + 1] = 229;
      bytes[offset + 2] = 216;
      bytes[offset + 3] = Math.round(Math.pow(density, 1.3) * 255);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Procedural soft turbulent smoke atlas";
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function makeFlameMaterial(name, low, high, opacity, intensity) {
  const phase = sin(
    positionWorld.y.mul(6.9)
      .sub(fireTime.mul(9.6))
      .add(positionWorld.x.mul(2.7))
      .sub(positionWorld.z.mul(1.9)),
  ).mul(0.5).add(0.5);
  const vertical = smoothstep(0.02, 0.9, positionLocal.y);
  const tipFade = float(1).sub(smoothstep(0.58, 1.02, positionLocal.y));
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(color(low), color(high), pow(phase, 1.65))
    .mul(float(intensity).mul(vertical.mul(0.24).add(0.76)));
  material.opacityNode = max(float(0), tipFade.mul(0.72).add(phase.mul(0.22))).mul(opacity);
  const sway = sin(fireTime.mul(7.4).sub(positionLocal.y.mul(5.7)))
    .mul(vertical)
    .mul(0.075);
  const curl = sin(fireTime.mul(10.8).add(positionLocal.y.mul(8.3)))
    .mul(vertical)
    .mul(0.045);
  material.positionNode = vec3(
    positionLocal.x.add(sway),
    positionLocal.y,
    positionLocal.z.add(curl),
  );
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  return material;
}

function createFlameGeometry() {
  // A bent, pinched volume reads as a wind-pulled flame from every camera
  // angle. Straight cones made each simulation cell look like a campfire
  // marker, especially in the close fireline view.
  const sides = 9;
  const rings = [
    { y: 0.00, radius: 0.50, x: -0.04, z: 0.02 },
    { y: 0.10, radius: 0.96, x: 0.00, z: 0.00 },
    { y: 0.29, radius: 0.79, x: 0.035, z: -0.025 },
    { y: 0.50, radius: 0.59, x: 0.10, z: 0.035 },
    { y: 0.70, radius: 0.40, x: 0.19, z: 0.075 },
    { y: 0.87, radius: 0.21, x: 0.30, z: 0.045 },
    { y: 1.00, radius: 0.012, x: 0.46, z: 0.12 },
  ];
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let ringIndex = 0; ringIndex < rings.length; ++ringIndex) {
    const ring = rings[ringIndex];
    for (let side = 0; side < sides; ++side) {
      const angle = side / sides * Math.PI * 2 + ringIndex * 0.11;
      const irregularity = 1 + Math.sin(side * 2.17 + ringIndex * 1.73) * 0.075;
      positions.push(
        ring.x + Math.cos(angle) * ring.radius * irregularity,
        ring.y,
        ring.z + Math.sin(angle) * ring.radius * 0.72 * irregularity,
      );
      uvs.push(side / sides, ring.y);
    }
  }
  for (let ringIndex = 0; ringIndex < rings.length - 1; ++ringIndex) {
    const next = (ringIndex + 1) * sides;
    const current = ringIndex * sides;
    for (let side = 0; side < sides; ++side) {
      const following = (side + 1) % sides;
      indices.push(
        current + side, next + side, current + following,
        current + following, next + side, next + following,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Bent irregular volumetric flame tongue";
  return geometry;
}

function createIrregularGroundPatchGeometry(name, segments, phase) {
  const positions = [0, 0, 0];
  const uvs = [0.5, 0.5];
  const indices = [];
  for (let side = 0; side < segments; ++side) {
    const angle = side / segments * Math.PI * 2;
    const radius = 0.72
      + Math.sin(side * 2.37 + phase) * 0.17
      + Math.sin(side * 4.11 - phase * 0.7) * 0.09;
    positions.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius * (0.72 + Math.sin(side * 1.73 + phase) * 0.08),
      0,
    );
    uvs.push(Math.cos(angle) * radius * 0.5 + 0.5, Math.sin(angle) * radius * 0.5 + 0.5);
    indices.push(0, side + 1, (side + 1) % segments + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = name;
  return geometry;
}

function createEmberFissureGeometry() {
  const segments = 6;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let segment = 0; segment <= segments; ++segment) {
    const along = segment / segments;
    const x = along - 0.5;
    const bend = Math.sin(segment * 2.31) * 0.075 + Math.sin(segment * 4.17) * 0.025;
    const halfWidth = 0.034 + Math.sin(segment * 1.79 + 0.8) * 0.012;
    positions.push(x, bend - halfWidth, 0, x, bend + halfWidth, 0);
    uvs.push(along, 0, along, 1);
  }
  for (let segment = 0; segment < segments; ++segment) {
    const current = segment * 2;
    const next = current + 2;
    indices.push(current, next, current + 1, current + 1, next, next + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Jagged glowing fissure ribbon";
  return geometry;
}

function createLogEmberCrackGeometry() {
  const segments = 8;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let segment = 0; segment <= segments; ++segment) {
    const along = segment / segments;
    const y = along - 0.5;
    const bend = Math.sin(segment * 2.19 + 0.4) * 0.040
      + Math.sin(segment * 4.73) * 0.014;
    const halfWidth = 0.021 + Math.sin(segment * 1.61 + 0.7) * 0.006;
    // The companion trunk tapers from radius .29 to .21 along local Y.
    // A slight lift keeps this ribbon visibly on its upper bark surface.
    const surface = THREE.MathUtils.lerp(0.29, 0.21, along) + 0.014;
    positions.push(bend - halfWidth, y, surface, bend + halfWidth, y, surface);
    uvs.push(along, 0, along, 1);
  }
  for (let segment = 0; segment < segments; ++segment) {
    const current = segment * 2;
    const next = current + 2;
    indices.push(current, next, current + 1, current + 1, next, next + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Axial jagged ember crack for fallen timber";
  return geometry;
}

function createBurnedResidue(group) {
  const logMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Deep-char fallen timber",
    color: 0x130d09,
    roughness: 0.98,
    metalness: 0,
  });
  logMaterial.toneMapped = true;
  logMaterial.userData.rtxIgnore = true;
  const logGeometry = new THREE.CylinderGeometry(0.21, 0.29, 1, 8, 2, false);
  logGeometry.name = "Low-poly fire-felled trunk section";
  const logs = new THREE.InstancedMesh(logGeometry, logMaterial, MAX_FALLEN_LOGS);
  logs.name = "Persistent fallen charred trunks";

  const logCrackMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Fading ember cracks attached to fallen trunks",
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  logCrackMaterial.toneMapped = true;
  logCrackMaterial.userData.rtxIgnore = true;
  const logCracks = new THREE.InstancedMesh(
    createLogEmberCrackGeometry(),
    logCrackMaterial,
    MAX_LOG_EMBER_CRACKS,
  );
  logCracks.name = "Long-lived log-attached ember cracks";

  const branchMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Blackened fallen branch material",
    color: 0x1b110b,
    roughness: 1,
    metalness: 0,
  });
  branchMaterial.toneMapped = true;
  branchMaterial.userData.rtxIgnore = true;
  const branchGeometry = new THREE.CylinderGeometry(0.075, 0.12, 1, 7, 1, false);
  branchGeometry.name = "Broken charred branch section";
  const branches = new THREE.InstancedMesh(
    branchGeometry,
    branchMaterial,
    MAX_CHAR_BRANCHES,
  );
  branches.name = "Persistent charred branch sections";

  const ashMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Pale moonlit ash",
    color: 0xb2aa99,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  ashMaterial.toneMapped = true;
  ashMaterial.polygonOffset = true;
  ashMaterial.polygonOffsetFactor = -1;
  ashMaterial.polygonOffsetUnits = -1;
  ashMaterial.userData.rtxIgnore = true;
  const ashGeometry = createIrregularGroundPatchGeometry(
    "Lobed non-circular ash-bed patch",
    15,
    4.29,
  );
  const ash = new THREE.InstancedMesh(ashGeometry, ashMaterial, MAX_ASH_BEDS);
  ash.name = "Pale irregular ash beds";

  const fissureMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Long-lived ember fissure emission",
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  fissureMaterial.toneMapped = true;
  fissureMaterial.userData.rtxIgnore = true;
  const fissures = new THREE.InstancedMesh(
    createEmberFissureGeometry(),
    fissureMaterial,
    MAX_GLOW_FISSURES,
  );
  fissures.name = "Long-lived orange-red ember fissures";

  const coalMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Long-lived coal fragment emission",
    color: 0xffffff,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  coalMaterial.toneMapped = true;
  coalMaterial.userData.rtxIgnore = true;
  const coalGeometry = new THREE.IcosahedronGeometry(1, 0);
  coalGeometry.name = "Angular glowing coal fragment";
  const coals = new THREE.InstancedMesh(coalGeometry, coalMaterial, MAX_GLOW_COALS);
  coals.name = "Long-lived glowing coal fragments";

  const meshes = [logs, logCracks, branches, ash, fissures, coals];
  meshes.forEach((mesh, index) => {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = [4, 14, 5, 3, 12, 13][index];
    mesh.userData.rtxIgnore = true;
    group.add(mesh);
  });
  logs.receiveShadow = true;
  branches.receiveShadow = true;
  return { logs, logCracks, branches, ash, fissures, coals };
}

function createFlames(group) {
  const geometry = createFlameGeometry();
  const definitions = [
    { name: "Dim red-orange flame envelope", material: makeFlameMaterial("Dim red-orange flame envelope", 0xb91c06, 0xff6512, 0.24, 1.9), widthScale: 1, heightScale: 1 },
    { name: "Turbulent orange flame body", material: makeFlameMaterial("Turbulent orange flame body", 0xff4a08, 0xffb62e, 0.38, 2.55), widthScale: 0.68, heightScale: 0.82 },
    { name: "Sparse white-hot flame cores", material: makeFlameMaterial("Sparse white-hot flame cores", 0xffa126, 0xfff0b0, 0.54, 3.1), widthScale: 0.36, heightScale: 0.57 },
  ];
  return definitions.map((definition, layerIndex) => {
    const mesh = new THREE.InstancedMesh(
      geometry,
      definition.material,
      MAX_FLAME_ANCHORS,
    );
    mesh.name = definition.name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 20 + layerIndex;
    mesh.userData.rtxIgnore = true;
    group.add(mesh);
    return { ...definition, mesh };
  });
}

function createGroundGlow(group) {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Restrained amber ember-bed radiance",
    color: new THREE.Color(0xff751f).multiplyScalar(1.7),
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  const geometry = createIrregularGroundPatchGeometry(
    "Broken non-circular ember-bed patch",
    11,
    1.73,
  );
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_GROUND_FLAMES + 32);
  mesh.name = "Small irregular ember beds beneath active trees";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 18;
  mesh.userData.rtxIgnore = true;
  group.add(mesh);
  return mesh;
}

function createScorchMarks(group, capacity = 520) {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Burned fuel and blackened soil",
    color: 0x090706,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.toneMapped = false;
  const geometry = createIrregularGroundPatchGeometry(
    "Broken non-circular char footprint",
    13,
    3.11,
  );
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = "Persistent charred fire footprint";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.rtxIgnore = true;
  group.add(mesh);
  return mesh;
}

function createSmoke(group, texture) {
  const layers = [
    { color: 0x211d1a, opacity: 0.17, size: 0.84, order: 31 },
    { color: 0x46413c, opacity: 0.105, size: 1.18, order: 30 },
    { color: 0x76736d, opacity: 0.058, size: 1.58, order: 29 },
  ];
  return layers.map((layer, index) => {
    const material = new THREE.MeshBasicNodeMaterial({
      name: `Volumetric smoke layer ${index + 1}`,
      map: texture,
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      alphaTest: 0.018,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    material.toneMapped = false;
    material.userData.rtxIgnore = true;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2), material, Math.ceil(MAX_SMOKE / 3));
    mesh.name = `Wind-sheared bushfire smoke ${index + 1}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = layer.order;
    mesh.userData.rtxIgnore = true;
    group.add(mesh);
    return { ...layer, mesh };
  });
}

function createEmbers(group, random) {
  const positions = new Float32Array(EMBER_COUNT * 3);
  const colors = new Float32Array(EMBER_COUNT * 3);
  const particles = [];
  for (let index = 0; index < EMBER_COUNT; ++index) {
    particles.push({
      active: false,
      age: 0,
      life: 1,
      velocity: new THREE.Vector3(),
    });
    colors[index * 3] = 1;
    colors[index * 3 + 1] = 0.18 + random() * 0.55;
    colors[index * 3 + 2] = 0.025;
    positions[index * 3 + 1] = -1000;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsNodeMaterial({
    name: "Windborne embers and firebrands",
    size: 0.082,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  const points = new THREE.Points(geometry, material);
  points.name = "Rising orange embers";
  points.frustumCulled = false;
  points.renderOrder = 40;
  points.userData.rtxIgnore = true;
  group.add(points);
  return { points, geometry, positions, particles };
}

function burningCells(model) {
  return (model?.cells ?? [])
    .filter(cell => cell.state === "burning" && Number(cell.burn) > 0.018)
    .sort((a, b) => (b.burn * (0.35 + b.fuel)) - (a.burn * (0.35 + a.fuel)));
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

function finiteHeight(heightAt, x, z, fallback = 0) {
  try {
    const height = Number(heightAt?.(x, z));
    return Number.isFinite(height) ? height : fallback;
  } catch {
    return fallback;
  }
}

function cellForTree(tree, model) {
  const index = Number.isInteger(tree?.fireCellIndex)
    ? tree.fireCellIndex
    : Number.isInteger(tree?.cellIndex) ? tree.cellIndex : -1;
  if (index >= 0 && model?.cells?.[index]) return model.cells[index];
  if (tree?.fireCell && typeof tree.fireCell === "object") return tree.fireCell;
  if (typeof model?.cellAtWorld === "function") {
    try {
      const cell = model.cellAtWorld(tree.x, tree.z);
      return Number.isInteger(cell) ? model.cells?.[cell] ?? null : cell;
    } catch {
      return null;
    }
  }
  return null;
}

function burningTreeSources(model, treeRecords, heightAt) {
  const sources = [];
  for (const tree of treeRecords ?? []) {
    const cell = cellForTree(tree, model);
    const burn = THREE.MathUtils.clamp(Number(cell?.burn) || 0, 0, 1);
    if (cell?.state !== "burning" || burn <= 0.018) continue;
    const scale = THREE.MathUtils.clamp(Number(tree.scale) || 1, 0.45, 1.8);
    const index = Number.isInteger(tree.id) ? tree.id : Number(cell.index) || sources.length;
    const x = Number(tree.x) || 0;
    const z = Number(tree.z) || 0;
    const y = Number.isFinite(Number(tree.y)) ? Number(tree.y) : finiteHeight(heightAt, x, z);
    const fuel = THREE.MathUtils.clamp(Number(cell.fuel) || 0, 0, 1);
    sources.push({
      tree,
      cell,
      index,
      x,
      y,
      z,
      scale,
      burn,
      fuel,
      energy: burn * (0.38 + fuel * 0.62) * (tree.lod === "hero" ? 1.12 : 1),
    });
  }
  return sources.sort((a, b) => b.energy - a.energy);
}

function chooseSpatialSources(sources, count, minimumDistance = 9.5) {
  const chosen = [];
  for (const source of sources) {
    if (chosen.every(other => Math.hypot(other.x - source.x, other.z - source.z) > minimumDistance)) {
      chosen.push(source);
      if (chosen.length >= count) break;
    }
  }
  return chosen;
}

function makeTreeFlameAnchors(treeSources, cells, heightAt) {
  const anchors = [];
  const groundAnchors = [];
  const push = (source, kind, ordinal, x, y, z, width, height, strength = 1) => {
    if (anchors.length >= MAX_FLAME_ANCHORS) return;
    anchors.push({
      source,
      kind,
      x,
      y,
      z,
      // Keep every tongue human/tree scale. A large front comes from more
      // separated anchors and depth layers, never billboard-sized flames.
      width: THREE.MathUtils.clamp(width, 0.075, 0.78),
      height: THREE.MathUtils.clamp(height, 0.22, 3.35),
      strength,
      seed: source.index * 17.371 + ordinal * 3.117 + kind.length * 0.719,
    });
  };

  for (const source of treeSources) {
    if (anchors.length >= MAX_FLAME_ANCHORS - 32) break;
    const { burn, scale } = source;
    const baseAngle = hash01(source.index * 13 + 7) * Math.PI * 2;
    const baseCount = 3 + Math.floor(burn * 2.2);
    for (let tongue = 0; tongue < baseCount; ++tongue) {
      const angle = baseAngle + tongue * 2.39996323;
      const radius = scale * (0.13 + hash01(source.index * 31 + tongue) * 0.48);
      const anchor = {
        x: source.x + Math.cos(angle) * radius,
        y: source.y + 0.025,
        z: source.z + Math.sin(angle) * radius,
      };
      push(source, "trunk-base", tongue, anchor.x, anchor.y, anchor.z,
        scale * (0.13 + burn * 0.15), scale * (0.52 + burn * 1.0), 0.86);
      if (tongue === 0 && groundAnchors.length < 32) groundAnchors.push({ ...anchor, burn, seed: source.index });
    }

    // A tree burns in discontinuous pockets up its trunk and branches. The
    // gaps between these volumes provide the visual scale cues that a single
    // tall cone cannot.
    const trunkCount = 3 + Math.floor(burn * 4.6);
    for (let level = 0; level < trunkCount; ++level) {
      const angle = baseAngle + level * 2.17;
      const radius = scale * (0.16 + hash01(source.index * 43 + level) * 0.30);
      push(
        source,
        "trunk",
        level,
        source.x + Math.cos(angle) * radius,
        source.y + scale * (0.54 + level * 0.70),
        source.z + Math.sin(angle) * radius,
        scale * (0.11 + burn * 0.14),
        scale * (0.62 + burn * 0.96),
        0.82,
      );
    }

    if (burn > 0.10) {
      const branchCount = 4 + Math.floor(burn * 5.0);
      for (let branch = 0; branch < branchCount; ++branch) {
        const angle = baseAngle + branch * 2.39996323 + hash01(source.index * 59 + branch) * 0.38;
        const radius = scale * (0.62 + hash01(source.index * 61 + branch) * 1.72);
        push(
          source,
          "lower-branch",
          branch,
          source.x + Math.cos(angle) * radius,
          source.y + scale * (2.25 + (branch % 5) * 0.72 + hash01(source.index * 67 + branch) * 0.74),
          source.z + Math.sin(angle) * radius,
          scale * (0.14 + burn * 0.20),
          scale * (0.70 + burn * 1.20),
          0.94,
        );
      }
    }

    if (burn > 0.24) {
      const crownCount = 3 + Math.floor((burn - 0.24) * 12.0);
      for (let crown = 0; crown < crownCount; ++crown) {
        const angle = baseAngle + crown * 2.39996323 + hash01(source.index * 71 + crown) * 0.54;
        const radius = scale * (1.05 + hash01(source.index * 73 + crown) * 2.92);
        push(
          source,
          "crown",
          crown,
          source.x + Math.cos(angle) * radius,
          source.y + scale * (4.65 + hash01(source.index * 79 + crown) * 4.55),
          source.z + Math.sin(angle) * radius,
          scale * (0.18 + burn * 0.29),
          scale * (0.92 + burn * 1.46),
          1.08,
        );
      }
    }
  }

  // Surface fire remains visible between trees, but it is intentionally sparse
  // and small so the front does not read as one luminous red disc per grid cell.
  const selectedGround = [];
  for (const cell of cells) {
    if (selectedGround.length >= MAX_GROUND_FLAMES) break;
    if (treeSources.some(tree => Math.hypot(tree.x - cell.x, tree.z - cell.z) < 2.8)) continue;
    if (selectedGround.some(other => Math.hypot(other.x - cell.x, other.z - cell.z) < 3.45)) continue;
    const burn = THREE.MathUtils.clamp(Number(cell.burn) || 0, 0, 1);
    const seed = Number(cell.index) || selectedGround.length;
    const angle = hash01(seed * 83 + 3) * Math.PI * 2;
    const radius = hash01(seed * 89 + 5) * 0.55;
    const ground = {
      x: cell.x + Math.cos(angle) * radius,
      y: finiteHeight(heightAt, cell.x, cell.z) + 0.025,
      z: cell.z + Math.sin(angle) * radius,
      burn,
      seed,
    };
    selectedGround.push(ground);
    groundAnchors.push(ground);
    const source = { ...cell, burn, fuel: cell.fuel, energy: burn, index: seed };
    const tongueCount = 2 + Math.floor(burn * 2.8);
    for (let tongue = 0; tongue < tongueCount; ++tongue) {
      const localAngle = angle + tongue * 2.39996323;
      const localRadius = tongue === 0
        ? 0
        : 0.24 + hash01(seed * 101 + tongue) * 0.82;
      push(
        source,
        "underbrush",
        seed * 5 + tongue,
        ground.x + Math.cos(localAngle) * localRadius,
        ground.y,
        ground.z + Math.sin(localAngle) * localRadius,
        0.10 + burn * (0.12 + hash01(seed * 103 + tongue) * 0.09),
        0.34 + burn * (0.56 + hash01(seed * 107 + tongue) * 0.36),
        tongue === 0 ? 0.70 : 0.58,
      );
    }
  }
  return { anchors, groundAnchors };
}

function makeEmissionSources(treeSources, groundAnchors, cells, heightAt) {
  const candidates = [];
  for (const source of treeSources.slice(0, MAX_VISIBLE_CELLS)) {
    candidates.push({
      ...source,
      y: source.y + source.scale * (3.45 + source.burn * 3.75),
      plumeSpread: source.scale * (1.20 + source.burn * 0.82),
      plumeScale: 0.92 + source.scale * 0.22 + source.burn * 0.24,
      lifeScale: 0.94 + source.burn * 0.18,
      columnPhase: hash01(source.index * 109 + 13) * Math.PI * 2,
    });
  }

  for (const ground of groundAnchors) {
    const burn = THREE.MathUtils.clamp(Number(ground.burn) || 0, 0, 1);
    candidates.push({
      ...ground,
      fuel: 0.5,
      energy: burn * 0.72,
      index: Number(ground.seed) || candidates.length,
      plumeSpread: 0.88 + burn * 0.78,
      plumeScale: 0.78 + burn * 0.27,
      lifeScale: 0.88 + burn * 0.12,
      columnPhase: hash01((Number(ground.seed) || 0) * 113 + 17) * Math.PI * 2,
    });
  }

  // Burning-cell sources fill the spaces between tree columns. They are smoke
  // and ember sources only; visible ground fire remains the sparse clusters
  // above, avoiding a repeated grid of luminous markers.
  for (const cell of cells.slice(0, MAX_VISIBLE_CELLS)) {
    const burn = THREE.MathUtils.clamp(Number(cell.burn) || 0, 0, 1);
    const index = Number(cell.index) || candidates.length;
    candidates.push({
      cell,
      tree: null,
      index,
      x: Number(cell.x) || 0,
      y: finiteHeight(heightAt, cell.x, cell.z) + 0.42 + burn * 0.35,
      z: Number(cell.z) || 0,
      burn,
      fuel: THREE.MathUtils.clamp(Number(cell.fuel) || 0, 0, 1),
      energy: burn * (0.34 + (Number(cell.fuel) || 0) * 0.48),
      plumeSpread: 0.92 + burn * 0.92,
      plumeScale: 0.78 + burn * 0.34,
      lifeScale: 0.88 + burn * 0.15,
      columnPhase: hash01(index * 127 + 19) * Math.PI * 2,
    });
  }

  candidates.sort((a, b) => b.energy - a.energy);
  return chooseSpatialSources(candidates, MAX_EMISSION_SOURCES, 2.55);
}

export function createBushfireEffects({
  scene,
  heightAt = () => 0,
  treeRecords = [],
  wind = new THREE.Vector2(0.82, -0.36),
}) {
  const group = new THREE.Group();
  group.name = "Slow-spreading procedural bushfire";
  group.userData.rtxIgnore = true;
  scene.add(group);

  const random = seededRandom(0xb057f1ae);
  const flames = createFlames(group);
  const glow = createGroundGlow(group);
  const scorch = createScorchMarks(group);
  const residue = createBurnedResidue(group);
  const smokeTexture = makeSmokeTexture();
  const smokeLayers = createSmoke(group, smokeTexture);
  const smokeParticles = Array.from({ length: MAX_SMOKE }, (_, index) => ({
    layer: index % smokeLayers.length,
    active: false,
    age: 0,
    life: 1,
    position: new THREE.Vector3(0, -1000, 0),
    velocity: new THREE.Vector3(),
    size: 1,
    spin: 0,
    phase: random() * Math.PI * 2,
  }));
  const embers = createEmbers(group, random);
  const lights = [];
  for (let index = 0; index < 5; ++index) {
    const light = new THREE.PointLight(index === 0 ? 0xff7a29 : 0xff5012, 0, 24, 2);
    light.name = `Elevated burning-tree bounce ${index + 1}`;
    light.visible = false;
    light.castShadow = false;
    scene.add(light);
    lights.push(light);
  }
  const lightSlots = lights.map(() => ({
    key: "",
    kind: "active",
    source: null,
    position: new THREE.Vector3(),
    intensity: 0,
    range: 0,
    color: new THREE.Color(0xff5012),
    initialized: false,
  }));

  const dummy = new THREE.Object3D();
  const billboardRotation = new THREE.Quaternion();
  const spinRotation = new THREE.Quaternion();
  const terrainRotation = new THREE.Quaternion();
  const yawRotation = new THREE.Quaternion();
  const terrainBasis = new THREE.Matrix4();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const upAxis = new THREE.Vector3(0, 1, 0);
  const terrainNormal = new THREE.Vector3(0, 1, 0);
  const terrainDirection = new THREE.Vector3(1, 0, 0);
  const terrainRadial = new THREE.Vector3(0, 1, 0);
  const terrainSide = new THREE.Vector3(1, 0, 0);
  const residueColor = new THREE.Color();
  const residueCells = new Map();
  const residueTrees = new Map();
  let smokeCursor = 0;
  let emberCursor = 0;
  let emissionRemainder = 0;
  let emberEmissionRemainder = 0;
  let prewarmed = false;
  let lastScorchCount = -1;
  let lastModelElapsed = -1;
  let rtxEmitters = [];
  let residualLightSources = [];
  let residueStats = Object.freeze({
    fallenLogs: 0,
    logEmberCracks: 0,
    branchSections: 0,
    ashBeds: 0,
    glowingFissures: 0,
    glowingCoals: 0,
    residualEmitters: 0,
  });

  function resetSmoke(particle, source, age = 0) {
    const burn = THREE.MathUtils.clamp(Number(source.burn) || 0, 0, 1);
    const sourceY = Number.isFinite(Number(source.y))
      ? Number(source.y)
      : finiteHeight(heightAt, source.x, source.z) + 0.45;
    const plumeSpread = THREE.MathUtils.clamp(Number(source.plumeSpread) || 1.2, 0.65, 3.2);
    const plumeScale = THREE.MathUtils.clamp(Number(source.plumeScale) || 1, 0.65, 1.55);
    const lifeScale = THREE.MathUtils.clamp(Number(source.lifeScale) || 1, 0.75, 1.35);
    const columnPhase = Number(source.columnPhase) || 0;
    const radial = Math.sqrt(random()) * plumeSpread;
    const angle = random() * Math.PI * 2;
    const crosswind = (random() - 0.5) * plumeSpread * 0.36;
    particle.active = true;
    particle.life = (10.5 + random() * 10.5) * lifeScale;
    particle.age = Math.min(Math.max(0, age), particle.life * 0.88);
    particle.position.set(
      source.x + Math.cos(angle) * radial - wind.y * crosswind,
      sourceY + 0.16 + random() * (0.7 + plumeSpread * 0.22),
      source.z + Math.sin(angle) * radial + wind.x * crosswind,
    );
    particle.velocity.set(
      wind.x * (0.82 + random() * 0.72) + Math.cos(columnPhase) * 0.13 + (random() - 0.5) * 0.28,
      1.42 + random() * 1.52 + burn * 0.82,
      wind.y * (0.82 + random() * 0.72) + Math.sin(columnPhase) * 0.13 + (random() - 0.5) * 0.28,
    );
    particle.size = (0.78 + random() * 1.58) * plumeScale;
    particle.spin = (random() - 0.5) * 0.19;
    if (particle.age > 0) {
      particle.position.addScaledVector(particle.velocity, particle.age);
      particle.position.y += particle.age * particle.age * 0.085;
    }
  }

  function resetEmber(index, source, age = 0) {
    const particle = embers.particles[index];
    const offset = index * 3;
    const sourceY = Number.isFinite(Number(source.y))
      ? Number(source.y)
      : finiteHeight(heightAt, source.x, source.z) + 0.25;
    const spread = THREE.MathUtils.clamp(Number(source.plumeSpread) || 1.1, 0.55, 2.8);
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * spread * 0.72;
    particle.active = true;
    particle.life = 2.0 + random() * 5.1;
    particle.age = Math.min(Math.max(0, age), particle.life * 0.88);
    particle.velocity.set(
      wind.x * (0.9 + random() * 2.2) + (random() - 0.5) * 0.92,
      2.2 + random() * 5.5,
      wind.y * (0.9 + random() * 2.2) + (random() - 0.5) * 0.92,
    );
    embers.positions[offset] = source.x + Math.cos(angle) * radius;
    embers.positions[offset + 1] = sourceY + 0.12 + random() * 1.0;
    embers.positions[offset + 2] = source.z + Math.sin(angle) * radius;
    if (particle.age > 0) {
      embers.positions[offset] += particle.velocity.x * particle.age;
      embers.positions[offset + 1] += particle.velocity.y * particle.age - particle.age * particle.age * 0.575;
      embers.positions[offset + 2] += particle.velocity.z * particle.age;
    }
  }

  function prewarm(sources) {
    if (prewarmed || sources.length === 0) return;
    prewarmed = true;
    const smokeWarmCount = Math.floor(MAX_SMOKE * 0.64);
    for (let index = 0; index < smokeWarmCount; ++index) {
      const particle = smokeParticles[index];
      resetSmoke(
        particle,
        sources[index % Math.min(sources.length, 72)],
        random() * 12.5,
      );
    }
    for (let index = 0; index < EMBER_COUNT * 0.64; ++index) {
      resetEmber(
        index,
        sources[index % Math.min(sources.length, 72)],
        random() * 4.8,
      );
    }
  }

  function sampleTerrainNormal(x, z, target = terrainNormal) {
    const step = 0.72;
    const left = finiteHeight(heightAt, x - step, z);
    const right = finiteHeight(heightAt, x + step, z);
    const near = finiteHeight(heightAt, x, z - step);
    const far = finiteHeight(heightAt, x, z + step);
    return target.set(left - right, step * 2, near - far).normalize();
  }

  function orientGroundPatch(x, z, yaw, target) {
    sampleTerrainNormal(x, z, terrainNormal);
    terrainRotation.setFromUnitVectors(zAxis, terrainNormal);
    yawRotation.setFromAxisAngle(terrainNormal, yaw);
    return target.copy(yawRotation).multiply(terrainRotation);
  }

  function placeFallenSection(mesh, instance, x, z, angle, length, radiusScale) {
    const halfLength = length * 0.5;
    const dx = Math.cos(angle) * halfLength;
    const dz = Math.sin(angle) * halfLength;
    const firstHeight = finiteHeight(heightAt, x - dx, z - dz);
    const secondHeight = finiteHeight(heightAt, x + dx, z + dz);
    terrainDirection.set(
      Math.cos(angle) * length,
      secondHeight - firstHeight,
      Math.sin(angle) * length,
    ).normalize();
    terrainRadial.copy(upAxis).addScaledVector(
      terrainDirection,
      -upAxis.dot(terrainDirection),
    );
    if (terrainRadial.lengthSq() < 1e-6) terrainRadial.copy(zAxis);
    terrainRadial.normalize();
    terrainSide.crossVectors(terrainDirection, terrainRadial).normalize();
    terrainBasis.makeBasis(terrainSide, terrainDirection, terrainRadial);
    dummy.position.set(x, (firstHeight + secondHeight) * 0.5, z)
      .addScaledVector(terrainRadial, 0.16 * radiusScale);
    dummy.quaternion.setFromRotationMatrix(terrainBasis);
    dummy.scale.set(radiusScale, length, radiusScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(instance, dummy.matrix);
  }

  function residueCompletion(cell) {
    if (cell?.state === "burned") return 1;
    if (cell?.state !== "burning") return 0;
    const fuel = THREE.MathUtils.clamp(Number(cell.fuel) || 0, 0, 1);
    const burn = THREE.MathUtils.clamp(Number(cell.burn) || 0, 0, 1);
    return THREE.MathUtils.clamp((0.34 - fuel) / 0.34 * 0.78 + burn * 0.22, 0, 1);
  }

  function createCellResidueRecord(cell, elapsed) {
    const index = Number.isInteger(cell.index) ? cell.index : residueCells.size;
    const seed = index * 157 + 43;
    const offsetAngle = hash01(seed) * Math.PI * 2;
    return {
      cell,
      index,
      x: Number(cell.x) || 0,
      z: Number(cell.z) || 0,
      offsetAngle,
      offsetRadius: 0.28 + hash01(seed + 1) * 0.92,
      yaw: hash01(seed + 2) * Math.PI * 2,
      ashScaleX: 1.55 + hash01(seed + 3) * 1.18,
      ashScaleY: 1.18 + hash01(seed + 4) * 0.92,
      fissureCount: 1 + Math.floor(hash01(seed + 5) * 3),
      coalCount: 2 + Math.floor(hash01(seed + 6) * 4),
      branchCount: 1 + Math.floor(hash01(seed + 7) * 2),
      burnedAt: cell.state === "burned" ? elapsed : null,
      glow: 0,
      completion: residueCompletion(cell),
    };
  }

  function clearResidue() {
    residueCells.clear();
    residueTrees.clear();
    residualLightSources = [];
    for (const mesh of Object.values(residue)) {
      mesh.count = 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    residueStats = Object.freeze({
      fallenLogs: 0,
      logEmberCracks: 0,
      branchSections: 0,
      ashBeds: 0,
      glowingFissures: 0,
      glowingCoals: 0,
      residualEmitters: 0,
    });
  }

  function updateBurnedResidue(model, delta) {
    const modelElapsed = Number(model?.elapsedSeconds);
    const safeDelta = Math.max(0, Number(delta) || 0);
    const elapsed = Number.isFinite(modelElapsed)
      ? Math.max(0, modelElapsed)
      : Math.max(0, lastModelElapsed < 0 ? 0 : lastModelElapsed + safeDelta);
    if (lastModelElapsed >= 0 && elapsed + 1e-6 < lastModelElapsed) clearResidue();
    lastModelElapsed = elapsed;

    for (const cell of model?.cells ?? []) {
      const fuel = THREE.MathUtils.clamp(Number(cell?.fuel) || 0, 0, 1);
      const qualifies = cell?.state === "burned" ||
        (cell?.state === "burning" && fuel < 0.34 && Number(cell.burn) > 0.05);
      if (!qualifies) continue;
      const key = Number.isInteger(cell.index) ? cell.index : `${cell.x}:${cell.z}`;
      if (!residueCells.has(key) && residueCells.size < MAX_ASH_BEDS) {
        residueCells.set(key, createCellResidueRecord(cell, elapsed));
      }
      const record = residueCells.get(key);
      if (!record) continue;
      record.cell = cell;
      record.completion = residueCompletion(cell);
      if (cell.state === "burned" && record.burnedAt === null) record.burnedAt = elapsed;
      if (cell.state === "burned") {
        const age = Math.max(0, elapsed - (record.burnedAt ?? elapsed));
        const fuelWeight = 0.68 + (1 - fuel) * 0.32;
        record.glow = fuelWeight * (
          0.62 * Math.exp(-age / RESIDUAL_GLOW_DECAY_SECONDS) + 0.025
        );
      } else {
        record.glow = (0.16 + record.completion * 0.64) * (0.72 + (1 - fuel) * 0.28);
      }
    }

    for (const tree of treeRecords ?? []) {
      if (residueTrees.size >= MAX_FALLEN_LOGS) break;
      const cell = cellForTree(tree, model);
      if (cell?.state !== "burned") continue;
      const id = Number.isInteger(tree.id) ? tree.id : residueTrees.size;
      if (residueTrees.has(id)) continue;
      const scale = THREE.MathUtils.clamp(Number(tree.scale) || 1, 0.45, 1.8);
      const seed = id * 173 + 47;
      residueTrees.set(id, {
        id,
        tree,
        cell,
        x: Number(tree.x) || 0,
        z: Number(tree.z) || 0,
        angle: Number(tree.yaw) + (hash01(seed) - 0.5) * 1.35,
        length: 4.6 + scale * 3.9 + hash01(seed + 1) * 1.7,
        radiusScale: 0.76 + scale * 0.26 + hash01(seed + 2) * 0.24,
        branchCount: 2 + Math.floor(hash01(seed + 3) * 3),
        crackCount: 1 + Math.floor(hash01(seed + 4) * 2),
        burnedAt: elapsed,
        seed,
      });
    }

    let ashCount = 0;
    let fissureCount = 0;
    let coalCount = 0;
    let cellBranchCount = 0;
    for (const record of residueCells.values()) {
      const x = record.x + Math.cos(record.offsetAngle) * record.offsetRadius;
      const z = record.z + Math.sin(record.offsetAngle) * record.offsetRadius;
      const y = finiteHeight(heightAt, x, z);
      dummy.position.set(x, y + 0.038, z);
      orientGroundPatch(x, z, record.yaw, dummy.quaternion);
      const ashGrowth = 0.68 + record.completion * 0.32;
      dummy.scale.set(record.ashScaleX * ashGrowth, record.ashScaleY * ashGrowth, 1);
      dummy.updateMatrix();
      residue.ash.setMatrixAt(ashCount, dummy.matrix);
      const ashVariation = 0.78 + hash01(record.index * 179 + 53) * 0.18;
      residueColor.setRGB(ashVariation, ashVariation * 0.95, ashVariation * 0.84);
      residue.ash.setColorAt(ashCount, residueColor);
      ashCount += 1;

      if (record.cell?.state === "burned" && record.index % 3 !== 1) {
        for (let branch = 0;
          branch < record.branchCount && cellBranchCount < MAX_CHAR_BRANCHES;
          ++branch) {
          const branchSeed = record.index * 181 + branch * 17;
          const branchAngle = hash01(branchSeed) * Math.PI * 2;
          const branchRadius = 0.34 + hash01(branchSeed + 1) * 1.15;
          placeFallenSection(
            residue.branches,
            cellBranchCount++,
            x + Math.cos(branchAngle) * branchRadius,
            z + Math.sin(branchAngle) * branchRadius,
            branchAngle + (hash01(branchSeed + 2) - 0.5) * 0.8,
            1.15 + hash01(branchSeed + 3) * 1.75,
            0.72 + hash01(branchSeed + 4) * 0.42,
          );
        }
      }

      if (record.glow <= 0.016) continue;
      for (let fissure = 0;
        fissure < record.fissureCount && fissureCount < MAX_GLOW_FISSURES;
        ++fissure) {
        const fissureSeed = record.index * 191 + fissure * 23;
        const fissureAngle = record.yaw + hash01(fissureSeed) * Math.PI * 2;
        const fissureRadius = hash01(fissureSeed + 1) * 1.08;
        const fx = x + Math.cos(fissureAngle) * fissureRadius;
        const fz = z + Math.sin(fissureAngle) * fissureRadius;
        dummy.position.set(fx, finiteHeight(heightAt, fx, fz) + 0.062, fz);
        orientGroundPatch(fx, fz, fissureAngle, dummy.quaternion);
        dummy.scale.set(0.82 + hash01(fissureSeed + 2) * 1.34, 0.72 + record.glow * 0.38, 1);
        dummy.updateMatrix();
        residue.fissures.setMatrixAt(fissureCount, dummy.matrix);
        residueColor.setRGB(
          record.glow * 2.25,
          record.glow * 0.34,
          record.glow * 0.045,
        );
        residue.fissures.setColorAt(fissureCount++, residueColor);
      }

      for (let coal = 0;
        coal < record.coalCount && coalCount < MAX_GLOW_COALS;
        ++coal) {
        const coalSeed = record.index * 193 + coal * 29;
        const coalAngle = hash01(coalSeed) * Math.PI * 2;
        const coalRadius = 0.18 + hash01(coalSeed + 1) * 1.34;
        const cx = x + Math.cos(coalAngle) * coalRadius;
        const cz = z + Math.sin(coalAngle) * coalRadius;
        dummy.position.set(cx, finiteHeight(heightAt, cx, cz) + 0.10, cz);
        dummy.rotation.set(
          hash01(coalSeed + 2) * Math.PI,
          hash01(coalSeed + 3) * Math.PI,
          coalAngle,
        );
        const coalScale = (0.075 + hash01(coalSeed + 4) * 0.13) *
          (0.72 + record.glow * 0.28);
        dummy.scale.set(coalScale * 1.45, coalScale, coalScale * 0.82);
        dummy.updateMatrix();
        residue.coals.setMatrixAt(coalCount, dummy.matrix);
        residueColor.setRGB(
          record.glow * 2.42,
          record.glow * 0.29,
          record.glow * 0.036,
        );
        residue.coals.setColorAt(coalCount++, residueColor);
      }
    }

    let logCount = 0;
    let logCrackCount = 0;
    let branchCount = cellBranchCount;
    const rawResidualSources = [];
    for (const record of residueTrees.values()) {
      if (logCount >= MAX_FALLEN_LOGS) break;
      placeFallenSection(
        residue.logs,
        logCount++,
        record.x,
        record.z,
        record.angle,
        record.length,
        record.radiusScale,
      );

      const cellIndex = Number.isInteger(record.cell?.index) ? record.cell.index : null;
      const cellRecord = cellIndex === null ? null : residueCells.get(cellIndex);
      const fallbackGlow = 0.62 * Math.exp(
        -Math.max(0, elapsed - record.burnedAt) / RESIDUAL_GLOW_DECAY_SECONDS,
      ) + 0.025;
      const strength = THREE.MathUtils.clamp(
        Number(cellRecord?.glow ?? fallbackGlow) || 0,
        0,
        1,
      );

      // placeFallenSection leaves the exact slope-aligned trunk transform in
      // `dummy`. Reuse that frame so these ribbons run along the upper bark,
      // rather than appearing as unrelated ground fissures beside the log.
      const logX = dummy.position.x;
      const logY = dummy.position.y;
      const logZ = dummy.position.z;
      terrainRotation.copy(dummy.quaternion);
      if (strength > 0.016) {
        for (let crack = 0;
          crack < record.crackCount && logCrackCount < MAX_LOG_EMBER_CRACKS;
          ++crack) {
          const roll = (hash01(record.seed + crack * 59 + 9) - 0.5) * 0.74
            + (crack === 0 ? -0.17 : 0.27);
          dummy.position.set(logX, logY, logZ);
          yawRotation.setFromAxisAngle(upAxis, roll);
          dummy.quaternion.copy(terrainRotation).multiply(yawRotation);
          dummy.scale.set(record.radiusScale, record.length, record.radiusScale);
          dummy.updateMatrix();
          residue.logCracks.setMatrixAt(logCrackCount, dummy.matrix);
          residueColor.setRGB(
            strength * 2.65,
            strength * (crack === 0 ? 0.39 : 0.29),
            strength * 0.045,
          );
          residue.logCracks.setColorAt(logCrackCount++, residueColor);
        }
      }

      for (let branch = 0;
        branch < record.branchCount && branchCount < MAX_CHAR_BRANCHES;
        ++branch) {
        const branchAngle = record.angle + 0.75 + branch * 1.91;
        const branchRadius = 0.65 + hash01(record.seed + branch * 31) * 1.7;
        placeFallenSection(
          residue.branches,
          branchCount++,
          record.x + Math.cos(branchAngle) * branchRadius,
          record.z + Math.sin(branchAngle) * branchRadius,
          branchAngle + (hash01(record.seed + branch * 37 + 1) - 0.5) * 0.72,
          1.35 + hash01(record.seed + branch * 41 + 2) * 2.35,
          0.68 + hash01(record.seed + branch * 43 + 3) * 0.48,
        );
      }

      if (strength > 0.018) {
        rawResidualSources.push({
          residual: true,
          tree: record.tree,
          cell: record.cell,
          index: record.id,
          x: record.x,
          y: finiteHeight(heightAt, record.x, record.z) + 0.42,
          z: record.z,
          burn: strength,
          fuel: Number(record.cell?.fuel) || 0,
          energy: strength * 0.24,
          glowStrength: strength,
        });
      }
    }

    // Keep the complete bounded log-source set here. Light-slot hysteresis
    // needs to find its previously assigned identity even when a newer coal
    // cluster becomes brighter; spatial selection happens only on refill.
    residualLightSources = rawResidualSources.sort(
      (a, b) => b.glowStrength - a.glowStrength,
    );

    residue.logs.count = logCount;
    residue.logCracks.count = logCrackCount;
    residue.branches.count = branchCount;
    residue.ash.count = ashCount;
    residue.fissures.count = fissureCount;
    residue.coals.count = coalCount;
    for (const mesh of Object.values(residue)) mesh.instanceMatrix.needsUpdate = true;
    if (residue.ash.instanceColor) residue.ash.instanceColor.needsUpdate = true;
    if (residue.logCracks.instanceColor) residue.logCracks.instanceColor.needsUpdate = true;
    if (residue.fissures.instanceColor) residue.fissures.instanceColor.needsUpdate = true;
    if (residue.coals.instanceColor) residue.coals.instanceColor.needsUpdate = true;
    residueStats = Object.freeze({
      fallenLogs: logCount,
      logEmberCracks: logCrackCount,
      branchSections: branchCount,
      ashBeds: ashCount,
      glowingFissures: fissureCount,
      glowingCoals: coalCount,
      residualEmitters: residualLightSources.length,
    });
    return residualLightSources;
  }

  function updateFlames(time, flameAnchors, groundAnchors) {
    for (const [layerIndex, layer] of flames.entries()) {
      let instance = 0;
      for (let anchorIndex = 0; anchorIndex < flameAnchors.length; ++anchorIndex) {
        if (instance >= MAX_FLAME_ANCHORS) break;
        const anchor = flameAnchors[anchorIndex];
        if (layerIndex === 2 && (anchor.strength < 0.8 || (anchorIndex + Math.floor(anchor.seed)) % 4 === 0)) continue;
        const burn = THREE.MathUtils.clamp(Number(anchor.source.burn) || 0, 0.04, 1);
        const seed = anchor.seed + layerIndex * 0.83;
        const pulse = 0.83 + Math.sin(time * (6.1 + layerIndex * 1.15) + seed) * 0.12
          + Math.sin(time * 12.7 + seed * 1.91) * 0.055;
        const width = anchor.width * layer.widthScale * (0.82 + burn * 0.22);
        const height = anchor.height * layer.heightScale * Math.max(0.42, pulse) * (0.76 + burn * 0.28);
        const sway = Math.sin(time * 2.35 + seed) * (0.035 + height * 0.018);
        dummy.position.set(
          anchor.x + sway * wind.x,
          anchor.y,
          anchor.z + sway * wind.y,
        );
        dummy.rotation.set(
          wind.y * (0.035 + burn * 0.035) + Math.sin(seed * 1.7) * 0.035,
          seed + time * 0.075,
          -wind.x * (0.045 + burn * 0.05) - sway * 0.08,
        );
        dummy.scale.set(width, Math.max(0.04, height), width * (0.68 + layerIndex * 0.08));
        dummy.updateMatrix();
        layer.mesh.setMatrixAt(instance++, dummy.matrix);
      }
      layer.mesh.count = instance;
      layer.mesh.instanceMatrix.needsUpdate = true;
    }

    let glowCount = 0;
    for (const anchor of groundAnchors.slice(0, glow.instanceMatrix.count)) {
      const burn = THREE.MathUtils.clamp(Number(anchor.burn) || 0, 0.02, 1);
      dummy.position.set(anchor.x, anchor.y + 0.025, anchor.z);
      dummy.rotation.set(-Math.PI * 0.5, 0, anchor.seed * 0.41);
      dummy.scale.set(0.34 + burn * 0.48, 0.25 + burn * 0.35, 1);
      dummy.updateMatrix();
      glow.setMatrixAt(glowCount++, dummy.matrix);
    }
    glow.count = glowCount;
    glow.instanceMatrix.needsUpdate = true;
  }

  function updateScorch(model) {
    const burned = (model?.cells ?? []).filter(cell => cell.state === "burned" || (cell.state === "burning" && cell.fuel < 0.23));
    if (burned.length === lastScorchCount) return;
    lastScorchCount = burned.length;
    let count = 0;
    for (const cell of burned.slice(-scorch.instanceMatrix.count)) {
      const angle = hash01(cell.index * 131 + 23) * Math.PI * 2;
      const jitter = 0.16 + hash01(cell.index * 137 + 29) * 0.68;
      const x = cell.x + Math.cos(angle) * jitter;
      const z = cell.z + Math.sin(angle) * jitter;
      dummy.position.set(x, finiteHeight(heightAt, x, z) + 0.045, z);
      dummy.rotation.set(-Math.PI * 0.5, 0, angle + hash01(cell.index * 139 + 31) * 1.7);
      dummy.scale.set(
        1.34 + hash01(cell.index * 149 + 37) * 0.58,
        1.04 + hash01(cell.index * 151 + 41) * 0.50,
        1,
      );
      dummy.updateMatrix();
      scorch.setMatrixAt(count++, dummy.matrix);
    }
    scorch.count = count;
    scorch.instanceMatrix.needsUpdate = true;
  }

  function updateSmoke(delta, sources, camera) {
    const energy = sources.reduce(
      (sum, source) => sum + Math.max(0, Number(source.energy ?? source.burn) || 0),
      0,
    );
    if (sources.length === 0) emissionRemainder = 0;
    else emissionRemainder += delta * Math.min(150, 9 + sources.length * 1.7 + energy * 0.75);
    while (emissionRemainder >= 1 && sources.length) {
      resetSmoke(
        smokeParticles[smokeCursor],
        sources[smokeCursor % Math.min(sources.length, MAX_EMISSION_SOURCES)],
      );
      smokeCursor = (smokeCursor + 1) % smokeParticles.length;
      emissionRemainder -= 1;
    }

    const perLayer = smokeLayers.map(() => 0);
    if (camera?.quaternion) billboardRotation.copy(camera.quaternion);
    else billboardRotation.identity();
    for (const particle of smokeParticles) {
      if (!particle.active) continue;
      particle.age += delta;
      if (particle.age >= particle.life) {
        particle.active = false;
        continue;
      }
      const ageRatio = particle.age / particle.life;
      const buoyancy = 0.14 + (1 - ageRatio) * 0.16;
      particle.velocity.y += buoyancy * delta;
      particle.velocity.x += Math.sin(particle.age * 0.47 + particle.phase) * 0.038 * delta;
      particle.velocity.z += Math.cos(particle.age * 0.39 + particle.phase) * 0.032 * delta;
      particle.position.addScaledVector(particle.velocity, delta);
      const layer = smokeLayers[particle.layer];
      const instance = perLayer[particle.layer]++;
      const fade = Math.min(1, particle.age * 1.7, (particle.life - particle.age) * 0.58);
      const expansion = particle.size * layer.size * (0.84 + particle.age * 0.32) * Math.max(0.06, fade);
      dummy.position.copy(particle.position);
      spinRotation.setFromAxisAngle(zAxis, particle.spin * particle.age + particle.phase);
      dummy.quaternion.copy(billboardRotation).multiply(spinRotation);
      dummy.scale.set(
        expansion * (1.18 + ageRatio * 0.48),
        expansion * (0.94 + ageRatio * 0.12),
        1,
      );
      dummy.updateMatrix();
      layer.mesh.setMatrixAt(instance, dummy.matrix);
    }
    smokeLayers.forEach((layer, index) => {
      layer.mesh.count = perLayer[index];
      layer.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  function updateEmbers(delta, sources) {
    const energy = sources.reduce(
      (sum, source) => sum + Math.max(0, Number(source.energy ?? source.burn) || 0),
      0,
    );
    const targetActive = Math.min(EMBER_COUNT, 220 + sources.length * 22);
    const emissionRate = Math.min(460, 34 + targetActive * 0.27 + energy * 2.4);
    if (sources.length === 0) emberEmissionRemainder = 0;
    else emberEmissionRemainder += delta * emissionRate;
    let spawned = 0;
    while (emberEmissionRemainder >= 1 && sources.length && spawned < 32) {
      resetEmber(
        emberCursor,
        sources[(emberCursor + spawned * 11) % Math.min(sources.length, MAX_EMISSION_SOURCES)],
      );
      emberCursor = (emberCursor + 1) % EMBER_COUNT;
      emberEmissionRemainder -= 1;
      spawned += 1;
    }
    for (let index = 0; index < EMBER_COUNT; ++index) {
      const particle = embers.particles[index];
      const offset = index * 3;
      if (!particle.active) continue;
      particle.age += delta;
      particle.velocity.y -= 1.15 * delta;
      embers.positions[offset] += particle.velocity.x * delta;
      embers.positions[offset + 1] += particle.velocity.y * delta;
      embers.positions[offset + 2] += particle.velocity.z * delta;
      if (particle.age >= particle.life) {
        particle.active = false;
        embers.positions[offset + 1] = -1000;
      }
    }
    embers.geometry.attributes.position.needsUpdate = true;
  }

  function lightSourceKey(source, kind) {
    if (kind === "residual") {
      return `residual:${Number.isInteger(source?.tree?.id) ? source.tree.id : source.index}`;
    }
    if (source?.tree) {
      return `tree:${Number.isInteger(source.tree.id) ? source.tree.id : source.index}`;
    }
    return `cell:${Number.isInteger(source?.cell?.index) ? source.cell.index : source.index}`;
  }

  function activeLightSample(source) {
    const burn = THREE.MathUtils.clamp(Number(source.burn) || 0, 0, 1);
    // Wide-area illumination has no periodic animation. Only the smoothly
    // damped simulation energy below can change it; the flame meshes retain
    // their independent fast turbulent motion.
    const treeLift = source.tree
      ? source.scale * (2.65 + burn * 3.15)
      : 2.55 + burn * 0.45;
    const offset = source.tree ? source.scale * 0.58 : 0;
    const lateralX = hash01(source.index * 97 + 11) * 2 - 1;
    const lateralZ = hash01(source.index * 149 + 29) * 2 - 1;
    const inverseLateralLength = 1 / Math.max(0.001, Math.hypot(lateralX, lateralZ));
    return {
      source,
      residual: false,
      position: [
        source.x + lateralX * inverseLateralLength * offset,
        source.y + treeLift,
        source.z + lateralZ * inverseLateralLength * offset,
      ],
      // Tree crowns remain strong native RTX emitters. Isolated cell sources
      // are lifted above the surface and kept materially dimmer/shorter so
      // they cannot burn white discs into the ground below them.
      intensity: source.tree ? 16 + burn * 36 : 4.5 + burn * 11.5,
      range: source.tree ? 17 + burn * 13 : 8.5 + burn * 6.5,
      color: source.tree ? 0xff5d18 : 0xff4810,
    };
  }

  function residualLightSample(source) {
    const strength = THREE.MathUtils.clamp(Number(source.glowStrength) || 0, 0, 1);
    return {
      source,
      residual: true,
      position: [source.x, source.y, source.z],
      intensity: 2.4 + strength * 5.6,
      range: 7 + strength * 5.5,
      color: 0xff3b14,
    };
  }

  function updateLights(delta, treeSources, cells, residualSources = residualLightSources) {
    const fallbackSources = cells.slice(0, MAX_VISIBLE_CELLS).map(cell => ({
      tree: null,
      cell,
      index: Number(cell.index) || 0,
      x: Number(cell.x) || 0,
      y: finiteHeight(heightAt, cell.x, cell.z),
      z: Number(cell.z) || 0,
      scale: 1,
      burn: THREE.MathUtils.clamp(Number(cell.burn) || 0, 0, 1),
      fuel: THREE.MathUtils.clamp(Number(cell.fuel) || 0, 0, 1),
      energy: (Number(cell.burn) || 0) * 0.46,
    })).filter(source => treeSources.every(tree => Math.hypot(tree.x - source.x, tree.z - source.z) > 4.2));
    const activeCandidates = [...treeSources, ...fallbackSources]
      .sort((a, b) => Number(b.energy || 0) - Number(a.energy || 0));
    const activeByKey = new Map(activeCandidates.map(source => [
      lightSourceKey(source, "active"),
      source,
    ]));
    const residualByKey = new Map(residualSources.map(source => [
      lightSourceKey(source, "residual"),
      source,
    ]));
    const hasResidual = residualSources.length > 0;
    const usedKeys = new Set();
    const assignedSources = [];

    // Preserve every viable identity first. Energy-order changes cannot move
    // an assigned light to another tree/cell; only a dead source frees a slot.
    lightSlots.forEach((slot, index) => {
      const desiredKind = hasResidual && index === lightSlots.length - 1
        ? "residual"
        : "active";
      const sourceMap = desiredKind === "residual" ? residualByKey : activeByKey;
      if (slot.key && slot.kind === desiredKind && sourceMap.has(slot.key)) {
        slot.source = sourceMap.get(slot.key);
        usedKeys.add(slot.key);
        assignedSources.push(slot.source);
        return;
      }
      slot.key = "";
      slot.kind = desiredKind;
      slot.source = null;
    });

    const sourceIsSeparated = (source, minimumDistance) => assignedSources.every(other =>
      Math.hypot(other.x - source.x, other.z - source.z) > minimumDistance);
    lightSlots.forEach(slot => {
      if (slot.source || (slot.initialized && slot.intensity > 0.08)) return;
      const candidates = slot.kind === "residual" ? residualSources : activeCandidates;
      const minimumDistance = slot.kind === "residual" ? 7.5 : 9.5;
      let source = candidates.find(candidate => {
        const key = lightSourceKey(candidate, slot.kind);
        return !usedKeys.has(key) && sourceIsSeparated(candidate, minimumDistance);
      });
      source ??= candidates.find(candidate => !usedKeys.has(lightSourceKey(candidate, slot.kind)));
      if (!source) return;
      slot.key = lightSourceKey(source, slot.kind);
      slot.source = source;
      usedKeys.add(slot.key);
      assignedSources.push(source);
      const sample = slot.kind === "residual"
        ? residualLightSample(source)
        : activeLightSample(source);
      // Reposition only while the old slot is dark, then ease its energy in.
      // This prevents a visible light from sweeping across the entire valley.
      slot.position.fromArray(sample.position);
      slot.range = sample.range;
      slot.color.setHex(sample.color);
      slot.intensity = Math.min(slot.intensity, 0.08);
      slot.initialized = true;
    });

    const safeDelta = THREE.MathUtils.clamp(Number(delta) || 0, 0, 0.1);
    const positionAlpha = Math.min(0.08, 1 - Math.exp(-safeDelta * 5.0));
    const intensityStepFraction = Math.min(0.045, safeDelta * 2.7);
    const rangeAlpha = Math.min(0.06, 1 - Math.exp(-safeDelta * 3.8));
    lightSlots.forEach((slot, index) => {
      const sample = slot.source
        ? slot.kind === "residual"
          ? residualLightSample(slot.source)
          : activeLightSample(slot.source)
        : null;
      if (sample) {
        dummy.position.fromArray(sample.position);
        slot.position.lerp(dummy.position, positionAlpha);
        slot.range = THREE.MathUtils.lerp(slot.range, sample.range, rangeAlpha);
        residueColor.setHex(sample.color);
        slot.color.lerp(residueColor, rangeAlpha);
      }
      const targetIntensity = sample?.intensity ?? 0;
      const intensityDelta = targetIntensity - slot.intensity;
      const maximumIntensityStep = intensityStepFraction * Math.max(slot.intensity, 1);
      slot.intensity += THREE.MathUtils.clamp(
        intensityDelta,
        -maximumIntensityStep,
        maximumIntensityStep,
      );

      const light = lights[index];
      light.visible = slot.initialized && slot.intensity > 0.01;
      light.position.copy(slot.position);
      light.intensity = light.visible
        ? slot.intensity * RASTER_LIGHT_INTENSITY_SCALE
        : 0;
      light.distance = Math.max(
        0.01,
        Math.min(MAX_RASTER_LIGHT_RANGE, slot.range * RASTER_LIGHT_RANGE_SCALE),
      );
      light.color.copy(slot.color);
      light.userData.residual = Boolean(slot.source && slot.kind === "residual");
      light.userData.sourceKey = slot.key;
    });

    // RTX consumes the same smoothed slot states as raster lighting. That
    // removes a second independent selector and therefore a second source of
    // discontinuities/double-light amplification.
    // Keep fixed RTX channels 0, 1 and 4. Slot 4 may carry active fire before
    // logs exist, then fades that exact emitter almost to black before it is
    // repurposed for the reserved residual source. Including an unassigned
    // fading tail avoids an abrupt native-light removal; excluding values
    // below 0.12 hides the eventual dark reposition/refill.
    const rtxSlots = [lightSlots[0], lightSlots[1], lightSlots[lightSlots.length - 1]]
      .filter(slot => slot.initialized && slot.intensity > 0.12);
    rtxEmitters = rtxSlots.map(slot => ({
      position: slot.position.toArray(),
      intensity: slot.intensity,
      range: slot.range,
    }));
  }

  return {
    group,
    lights,
    wind,
    getRtxEmitters(maximum = 3) {
      const limit = THREE.MathUtils.clamp(
        Math.trunc(Number(maximum) || 0),
        0,
        Math.min(3, rtxEmitters.length),
      );
      return rtxEmitters.slice(0, limit).map(emitter => ({
        position: [...emitter.position],
        intensity: emitter.intensity,
        range: emitter.range,
      }));
    },
    getResidueStats() {
      return { ...residueStats };
    },
    update(time, delta, model, camera) {
      fireTime.value = time;
      const cells = burningCells(model);
      const treeSources = burningTreeSources(model, treeRecords, heightAt);
      const residualSources = updateBurnedResidue(model, delta);
      const fireClusters = makeTreeFlameAnchors(treeSources, cells, heightAt);
      const emissionSources = makeEmissionSources(
        treeSources,
        fireClusters.groundAnchors,
        cells,
        heightAt,
      );
      prewarm(emissionSources);
      updateFlames(time, fireClusters.anchors, fireClusters.groundAnchors);
      updateScorch(model);
      updateSmoke(Math.min(0.05, delta), emissionSources, camera);
      updateEmbers(Math.min(0.05, delta), emissionSources);
      updateLights(delta, treeSources, cells, residualSources);
    },
    dispose() {
      clearResidue();
      scene.remove(group);
      for (const light of lights) scene.remove(light);
      smokeTexture.dispose();
      group.traverse(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material?.dispose?.());
        else object.material?.dispose?.();
      });
    },
  };
}
