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

import {
  FIRE_PATTERN_NODE_COUNT,
  FIRE_PATTERN_SEED,
  createFirePatternNodes,
  hashFirePatternSeed,
} from "./fire-pattern.mjs";

const EMBER_COUNT = 720;
const SMOKE_COUNT = 96;
const TAU = Math.PI * 2;

const clamp01 = value => THREE.MathUtils.clamp(Number(value) || 0, 0, 1);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const fract = value => value - Math.floor(value);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function markRtxIgnored(object) {
  if (object) object.userData.rtxIgnore = true;
  const values = Array.isArray(object?.material) ? object.material : [object?.material];
  for (const material of values) {
    if (!material) continue;
    material.userData.rtxIgnore = true;
    material.rtxReflectionMask = 0;
  }
  return object;
}

function setRtxSurface(material, reflectionMask, surface) {
  material.rtxReflectionMask = reflectionMask;
  material.userData.rtxUsesResolvedPbr = 1;
  material.userData.rtxTriangleSurface = [...surface];
  return material;
}

function setRtxRadiance(material, radiance) {
  material.userData.rtxTriangleRadiance = [...radiance];
  return material;
}

function makeSmokeTexture(size = 96) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const radius = Math.hypot(u * 0.94, v);
      const envelope = THREE.MathUtils.smoothstep(1 - radius, 0, 0.82);
      const billow = Math.sin(u * 8.2 + Math.sin(v * 5.3) * 1.9) *
        Math.cos(v * 9.7 - Math.cos(u * 4.4) * 1.4);
      const detail = Math.sin((u + v) * 21.0) * Math.sin((u - v) * 15.0);
      const density = clamp01(envelope * (0.72 + billow * 0.17 + detail * 0.08));
      const offset = (y * size + x) * 4;
      data[offset] = 202;
      data[offset + 1] = 178;
      data[offset + 2] = 166;
      data[offset + 3] = Math.round(Math.pow(density, 1.34) * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Pattern 233 procedural smoke density";
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createFlameMaterial() {
  const time = uniform(0);
  const energy = uniform(0.72);
  const turbulence = uniform(0.48);
  const phase = sin(
    positionWorld.y.mul(7.6)
      .sub(time.mul(float(8.4).add(turbulence.mul(5.2))))
      .add(positionWorld.x.mul(2.8))
      .sub(positionWorld.z.mul(2.15)),
  ).mul(0.5).add(0.5);
  const vertical = smoothstep(0.02, 0.94, positionLocal.y);
  const tipFade = float(1).sub(smoothstep(0.60, 1.96, positionLocal.y));
  const baseHeat = float(1).sub(smoothstep(0.04, 1.56, positionLocal.y));
  const colorHeat = smoothstep(
    0.08,
    0.94,
    baseHeat.mul(0.82).add(phase.mul(0.18)),
  );
  const material = new THREE.MeshBasicNodeMaterial({
    name: "CIN SIN additive flame volume",
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(color(0xff2606), color(0xffe58a), pow(colorHeat, 1.18))
    .mul(float(0.96).add(energy.mul(1.85)));
  material.opacityNode = max(
    float(0),
    tipFade.mul(float(0.70).add(phase.mul(0.20))),
  ).mul(float(0.38).add(energy.mul(0.48)));
  const sway = sin(time.mul(6.7).sub(positionLocal.y.mul(5.6)))
    .mul(vertical)
    .mul(float(0.045).add(turbulence.mul(0.090)));
  const curl = sin(time.mul(10.1).add(positionLocal.y.mul(8.1)))
    .mul(vertical)
    .mul(float(0.026).add(turbulence.mul(0.052)));
  material.positionNode = vec3(
    positionLocal.x.add(sway),
    positionLocal.y,
    positionLocal.z.add(curl),
  );
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  material.rtxReflectionMask = 0;
  return { material, uniforms: { time, energy, turbulence } };
}

function createFlameGeometry() {
  // A swept, pinched tongue keeps the 233 flames organic from overhead and
  // close cameras. Its off-axis crown also makes the CIN/SIN counter-winding
  // readable without relying on a flat billboard.
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
      const angle = side / sides * TAU + ringIndex * 0.11;
      const irregularity = 1 + Math.sin(side * 2.17 + ringIndex * 1.73) * 0.075;
      positions.push(
        ring.x + Math.cos(angle) * ring.radius * irregularity,
        ring.y * 2.08,
        ring.z + Math.sin(angle) * ring.radius * 0.72 * irregularity,
      );
      uvs.push(side / sides, ring.y);
    }
  }
  for (let ringIndex = 0; ringIndex < rings.length - 1; ++ringIndex) {
    const current = ringIndex * sides;
    const next = (ringIndex + 1) * sides;
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
  geometry.name = "Bent irregular CIN SIN flame tongue";
  return geometry;
}

function createCrackMaterial() {
  const time = uniform(0);
  const energy = uniform(0.45);
  const ripple = sin(
    positionWorld.x.mul(3.9)
      .add(positionWorld.z.mul(5.1))
      .sub(time.mul(5.6)),
  ).mul(0.5).add(0.5);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "233 score-reactive floor fissures",
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  material.colorNode = mix(color(0x9f1203), color(0xffc14d), pow(ripple, 2.1))
    .mul(float(0.55).add(energy.mul(3.2)));
  material.opacityNode = energy.mul(float(0.48).add(ripple.mul(0.46)));
  material.toneMapped = true;
  material.userData.rtxIgnore = true;
  material.rtxReflectionMask = 0;
  return { material, uniforms: { time, energy } };
}

function createEmberField(nodes, random, ownedGeometries, ownedMaterials) {
  const positions = new Float32Array(EMBER_COUNT * 3);
  const colors = new Float32Array(EMBER_COUNT * 3);
  const specs = [];
  const warm = new THREE.Color();
  for (let index = 0; index < EMBER_COUNT; ++index) {
    const anchorIndex = Math.floor(random() * nodes.length) % nodes.length;
    const hue = 0.045 + random() * 0.085;
    warm.setHSL(hue, 1, 0.56 + random() * 0.23);
    colors[index * 3] = warm.r;
    colors[index * 3 + 1] = warm.g;
    colors[index * 3 + 2] = warm.b;
    specs.push(Object.freeze({
      anchorIndex,
      phase: random(),
      speed: 0.10 + random() * 0.24,
      radius: 0.18 + random() * 1.35,
      lift: 2.2 + random() * 8.8,
      curl: random() * TAU,
      central: random() < 0.34,
    }));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = "720 deterministic score-reactive embers";
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setDrawRange(0, EMBER_COUNT);
  const material = new THREE.PointsNodeMaterial({
    name: "Hot additive ember motes",
    color: 0xffa642,
    size: 0.105,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    vertexColors: true,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  const points = markRtxIgnored(new THREE.Points(geometry, material));
  points.name = "CIN SIN ember ascent field";
  points.frustumCulled = false;
  ownedGeometries.add(geometry);
  ownedMaterials.add(material);
  return { points, geometry, material, positions, specs };
}

function createSmokeField(nodes, random, texture, ownedGeometries, ownedMaterials) {
  const geometry = new THREE.PlaneGeometry(2, 2);
  geometry.name = "Reusable smoke billboard";
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Layered score-reactive smoke",
    color: 0x4a3836,
    map: texture,
    transparent: true,
    opacity: 0.18,
    alphaTest: 0.002,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = markRtxIgnored(new THREE.InstancedMesh(geometry, material, SMOKE_COUNT));
  mesh.name = "96 camera-facing smoke billows";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 40;
  const specs = Array.from({ length: SMOKE_COUNT }, (_, index) => Object.freeze({
    anchorIndex: (index * 37 + Math.floor(random() * nodes.length)) % nodes.length,
    phase: random(),
    speed: 0.035 + random() * 0.085,
    drift: 0.5 + random() * 1.8,
    lift: 8 + random() * 15,
    scale: 1.6 + random() * 3.8,
    spin: (random() * 2 - 1) * 1.1,
  }));
  ownedGeometries.add(geometry);
  ownedMaterials.add(material);
  return { mesh, material, specs };
}

/**
 * Build the cinematic Pattern of Fire world.  The opaque stage, rings, core
 * and one 233-instance monolith mesh are returned through `staticMeshes` for
 * native RTX collection.  Every moving translucent effect stays raster-only.
 */
export function createFirePatternScene(scene, { seed = FIRE_PATTERN_SEED } = {}) {
  if (!scene?.isScene) throw new TypeError("createFirePatternScene requires a THREE.Scene.");
  const nodes = createFirePatternNodes({ seed, count: FIRE_PATTERN_NODE_COUNT });
  if (nodes.length !== FIRE_PATTERN_NODE_COUNT) {
    throw new Error(`Pattern of Fire requires exactly ${FIRE_PATTERN_NODE_COUNT} nodes.`);
  }

  const random = mulberry32(hashFirePatternSeed(seed) ^ 0xf1233a5e);
  const root = new THREE.Group();
  root.name = "Pattern of Fire 233 cinematic world";
  scene.add(root);

  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const ownedBackground = previousBackground == null ? new THREE.Color(0x020103) : null;
  const ownedFog = previousFog == null ? new THREE.FogExp2(0x080307, 0.0125) : null;
  if (ownedBackground) scene.background = ownedBackground;
  if (ownedFog) scene.fog = ownedFog;

  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const ownedTextures = new Set();
  const staticMeshes = [];

  const obsidianMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Polished black volcanic glass stage",
    color: 0x09070e,
    roughness: 0.105,
    metalness: 0.76,
    clearcoat: 1,
    clearcoatRoughness: 0.025,
    envMapIntensity: 2.65,
  }), 0.94, [0.035, 0.024, 0.050, 0.105]);
  const stageGeometry = new THREE.CylinderGeometry(40, 42, 0.9, 112, 1, false);
  const stage = new THREE.Mesh(stageGeometry, obsidianMaterial);
  stage.name = "Polished obsidian reflection arena";
  stage.position.y = -0.45;
  stage.receiveShadow = true;
  root.add(stage);
  staticMeshes.push(stage);
  ownedGeometries.add(stageGeometry);
  ownedMaterials.add(obsidianMaterial);

  const daisMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Fire core obsidian plinth",
    color: 0x12080b,
    roughness: 0.16,
    metalness: 0.62,
    clearcoat: 0.94,
    clearcoatRoughness: 0.035,
    envMapIntensity: 2.25,
  }), 0.83, [0.055, 0.024, 0.030, 0.16]);
  const daisGeometry = new THREE.CylinderGeometry(3.4, 4.5, 0.72, 72, 2, false);
  const dais = new THREE.Mesh(daisGeometry, daisMaterial);
  dais.name = "Central fire-core plinth";
  dais.position.y = 0.34;
  root.add(dais);
  staticMeshes.push(dais);
  ownedGeometries.add(daisGeometry);
  ownedMaterials.add(daisMaterial);

  const monolithMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "233 faceted obsidian resonators",
    color: 0x0d0913,
    roughness: 0.145,
    metalness: 0.82,
    clearcoat: 1,
    clearcoatRoughness: 0.028,
    envMapIntensity: 2.9,
  }), 0.91, [0.046, 0.028, 0.062, 0.14]);
  const monolithGeometry = new THREE.CylinderGeometry(0.48, 0.68, 1, 5, 2, false);
  monolithGeometry.name = "Reusable five-sided obsidian monolith";
  const monoliths = new THREE.InstancedMesh(
    monolithGeometry,
    monolithMaterial,
    FIRE_PATTERN_NODE_COUNT,
  );
  monoliths.name = "Exactly 233 CIN SIN spiral monoliths";
  monoliths.castShadow = true;
  monoliths.receiveShadow = true;
  monoliths.userData.patternNodeCount = FIRE_PATTERN_NODE_COUNT;
  const transform = new THREE.Object3D();
  for (const node of nodes) {
    transform.position.set(node.x, node.monolithHeight * 0.5 + 0.025, node.z);
    transform.rotation.set(node.monolithLean * node.sin, -node.angle + Math.PI * 0.5, node.monolithLean * node.cin);
    transform.scale.set(node.monolithWidth, node.monolithHeight, node.monolithWidth * (0.78 + node.tier * 0.055));
    transform.updateMatrix();
    monoliths.setMatrixAt(node.index, transform.matrix);
  }
  monoliths.instanceMatrix.needsUpdate = true;
  root.add(monoliths);
  staticMeshes.push(monoliths);
  ownedGeometries.add(monolithGeometry);
  ownedMaterials.add(monolithMaterial);

  const ringMaterial = setRtxRadiance(setRtxSurface(new THREE.MeshStandardNodeMaterial({
    name: "Molten inlay rings",
    color: 0x4b1206,
    emissive: 0xff3b08,
    emissiveIntensity: 2.4,
    roughness: 0.25,
    metalness: 0.52,
  }), 0.18, [0.24, 0.055, 0.012, 0.24]), [4.8, 0.30, 0.035, 1]);
  ownedMaterials.add(ringMaterial);
  for (const [index, radius] of [4.9, 11.7, 21.8, 34.9].entries()) {
    const geometry = new THREE.TorusGeometry(radius, index === 0 ? 0.11 : 0.065, 10, 128);
    const ring = new THREE.Mesh(geometry, ringMaterial);
    ring.name = `Molten score ring ${index + 1}`;
    ring.rotation.x = Math.PI * 0.5;
    ring.position.y = 0.025 + index * 0.001;
    root.add(ring);
    staticMeshes.push(ring);
    ownedGeometries.add(geometry);
  }

  const coreMaterial = setRtxRadiance(setRtxSurface(new THREE.MeshStandardNodeMaterial({
    name: "Opaque radiant fire heart",
    color: 0x6d1706,
    emissive: 0xff3608,
    emissiveIntensity: 5.8,
    roughness: 0.22,
    metalness: 0.14,
  }), 0.08, [0.38, 0.055, 0.010, 0.20]), [12.5, 0.58, 0.055, 1]);
  const coreGeometry = new THREE.IcosahedronGeometry(1.54, 2);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.name = "Central RTX-visible fire core";
  core.position.y = 2.05;
  root.add(core);
  staticMeshes.push(core);
  ownedGeometries.add(coreGeometry);
  ownedMaterials.add(coreMaterial);

  const { material: flameMaterial, uniforms: flameUniforms } = createFlameMaterial();
  const flameGeometry = createFlameGeometry();
  const flames = markRtxIgnored(new THREE.InstancedMesh(
    flameGeometry,
    flameMaterial,
    FIRE_PATTERN_NODE_COUNT,
  ));
  flames.name = "Exactly 233 score-linked flame anchors";
  flames.userData.patternNodeCount = FIRE_PATTERN_NODE_COUNT;
  flames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  flames.frustumCulled = false;
  flames.renderOrder = 30;
  root.add(flames);
  ownedGeometries.add(flameGeometry);
  ownedMaterials.add(flameMaterial);

  const innerFlameMaterial = new THREE.MeshBasicNodeMaterial({
    name: "White-hot inner flame filaments",
    color: 0xffedaa,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  innerFlameMaterial.toneMapped = true;
  const innerFlames = markRtxIgnored(new THREE.InstancedMesh(
    flameGeometry,
    innerFlameMaterial,
    FIRE_PATTERN_NODE_COUNT,
  ));
  innerFlames.name = "Exactly 233 white-hot flame hearts";
  innerFlames.userData.patternNodeCount = FIRE_PATTERN_NODE_COUNT;
  innerFlames.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  innerFlames.frustumCulled = false;
  innerFlames.renderOrder = 32;
  root.add(innerFlames);
  ownedMaterials.add(innerFlameMaterial);

  const { material: crackMaterial, uniforms: crackUniforms } = createCrackMaterial();
  const crackGeometry = new THREE.PlaneGeometry(1, 1);
  crackGeometry.rotateX(-Math.PI * 0.5);
  crackGeometry.name = "Reusable floor-fire fissure";
  const cracks = markRtxIgnored(new THREE.InstancedMesh(
    crackGeometry,
    crackMaterial,
    FIRE_PATTERN_NODE_COUNT,
  ));
  cracks.name = "Exactly 233 CIN SIN molten cracks";
  cracks.userData.patternNodeCount = FIRE_PATTERN_NODE_COUNT;
  cracks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cracks.frustumCulled = false;
  cracks.renderOrder = 12;
  root.add(cracks);
  ownedGeometries.add(crackGeometry);
  ownedMaterials.add(crackMaterial);

  const coreFlameGeometry = createFlameGeometry();
  coreFlameGeometry.scale(1.36, 2.35, 1.36);
  coreFlameGeometry.name = "Swept central fire crown geometry";
  const coreFlame = markRtxIgnored(new THREE.Mesh(coreFlameGeometry, flameMaterial));
  coreFlame.name = "Central transparent fire crown";
  coreFlame.position.y = 0.68;
  coreFlame.renderOrder = 31;
  root.add(coreFlame);
  ownedGeometries.add(coreFlameGeometry);

  const cinRibbonMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Counter-wound CIN plasma ribbon",
    color: 0xff6a12,
    emissive: 0xff3108,
    emissiveIntensity: 2.2,
    roughness: 0.23,
    metalness: 0.34,
    transparent: true,
    opacity: 0.88,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sinRibbonMaterial = new THREE.MeshStandardNodeMaterial({
    name: "Counter-wound SIN plasma ribbon",
    color: 0xffd05c,
    emissive: 0xff7a16,
    emissiveIntensity: 1.7,
    roughness: 0.18,
    metalness: 0.22,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const cinRibbonGeometry = new THREE.TorusKnotGeometry(2.38, 0.115, 192, 12, 2, 3);
  const sinRibbonGeometry = new THREE.TorusKnotGeometry(2.02, 0.085, 192, 10, 3, 5);
  const cinRibbon = markRtxIgnored(new THREE.Mesh(cinRibbonGeometry, cinRibbonMaterial));
  const sinRibbon = markRtxIgnored(new THREE.Mesh(sinRibbonGeometry, sinRibbonMaterial));
  cinRibbon.name = "Animated CIN orbital fire ribbon";
  sinRibbon.name = "Animated SIN orbital fire ribbon";
  cinRibbon.position.y = 2.35;
  sinRibbon.position.y = 2.35;
  cinRibbon.rotation.set(0.42, 0.15, -0.28);
  sinRibbon.rotation.set(-0.36, 0.31, 0.48);
  cinRibbon.renderOrder = 33;
  sinRibbon.renderOrder = 34;
  root.add(cinRibbon, sinRibbon);
  ownedGeometries.add(cinRibbonGeometry);
  ownedGeometries.add(sinRibbonGeometry);
  ownedMaterials.add(cinRibbonMaterial);
  ownedMaterials.add(sinRibbonMaterial);

  const smokeTexture = makeSmokeTexture();
  ownedTextures.add(smokeTexture);
  const smokeField = createSmokeField(nodes, random, smokeTexture, ownedGeometries, ownedMaterials);
  root.add(smokeField.mesh);
  const emberField = createEmberField(nodes, random, ownedGeometries, ownedMaterials);
  root.add(emberField.points);

  const lights = [];
  const hemisphere = new THREE.HemisphereLight(0x24334f, 0x170203, 0.48);
  hemisphere.name = "Cool night against ember ground ambience";
  root.add(hemisphere);
  lights.push(hemisphere);

  const coreLight = new THREE.PointLight(0xff4e16, 68, 34, 2);
  coreLight.name = "Central Pattern 233 fire light";
  coreLight.position.set(0, 5.2, 0);
  coreLight.castShadow = false;
  root.add(coreLight);
  lights.push(coreLight);

  const satelliteLights = [28, 82, 139, 196].map((nodeIndex, index) => {
    const node = nodes[nodeIndex];
    const light = new THREE.PointLight(index % 2 ? 0xff2f0b : 0xff721e, 18, 21, 2);
    light.name = `Spiral fire relay ${index + 1}`;
    light.position.set(node.x, 3.5 + node.tier * 0.45, node.z);
    light.castShadow = false;
    root.add(light);
    lights.push(light);
    return light;
  });

  const smokeDummy = new THREE.Object3D();
  const smokeSpin = new THREE.Quaternion();
  const smokeAxis = new THREE.Vector3(0, 0, 1);
  let disposed = false;
  let frameCount = 0;
  let manualEnvelope = 0;
  let lastCueId = 0;
  const cueEnvelopes = new Float32Array(FIRE_PATTERN_NODE_COUNT);
  let lastReactive = Object.freeze({ energy: 0, flame: 0, smoke: 0, spark: 0, section: "silence" });

  function update(music = {}, time = 0, delta = 0, camera = null, manualPulse = 0) {
    if (disposed) return false;
    const scoreTime = finite(music.timeSeconds, finite(time, 0));
    const safeDelta = THREE.MathUtils.clamp(finite(delta, 0), 0, 0.1);
    manualEnvelope = Math.max(clamp01(manualPulse), manualEnvelope * Math.exp(-safeDelta * 6.8));
    const pulse = Math.max(clamp01(music.pulse), manualEnvelope);
    const bass = clamp01(music.bass);
    const mid = clamp01(music.mid);
    const air = clamp01(music.air);
    const energy = clamp01(music.energy);
    const heat = clamp01(music.heat ?? energy);
    const flame = clamp01(music.flame ?? Math.max(energy, bass));
    const smoke = clamp01(music.smoke ?? energy * 0.72);
    const turbulence = clamp01(music.turbulence ?? mid);
    const spark = clamp01(music.spark ?? air);
    const flare = clamp01(music.flare ?? pulse);
    const crown = clamp01(music.crown ?? energy);
    const accent = Math.max(clamp01(music.accent), flare, manualEnvelope);
    const beat = Math.max(0, Math.floor(finite(music.beat, scoreTime * 2)));
    const activePulseGroup = beat % 16;
    const cueDecay = Math.exp(-safeDelta * 4.6);
    for (let index = 0; index < cueEnvelopes.length; ++index) cueEnvelopes[index] *= cueDecay;
    const triggerCue = (value, strength = 1) => {
      const cueId = Math.trunc(Number(value));
      if (!Number.isFinite(cueId) || cueId < 1 || cueId > FIRE_PATTERN_NODE_COUNT) return;
      cueEnvelopes[cueId - 1] = Math.max(cueEnvelopes[cueId - 1], clamp01(strength));
    };
    const currentCueId = Math.trunc(Number(music.cueId) || 0);
    if (currentCueId !== lastCueId) {
      triggerCue(currentCueId, Math.max(0.72, accent));
      lastCueId = currentCueId;
    }
    if (Array.isArray(music.cuePackets)) {
      for (const packet of music.cuePackets) {
        triggerCue(packet?.cueId, packet?.strength ?? packet?.accent ?? 1);
      }
    }

    flameUniforms.time.value = scoreTime;
    flameUniforms.energy.value = clamp01(0.18 + flame * 0.70 + accent * 0.28);
    flameUniforms.turbulence.value = clamp01(0.18 + turbulence * 0.66 + spark * 0.20);
    crackUniforms.time.value = scoreTime;
    crackUniforms.energy.value = clamp01(0.15 + heat * 0.57 + bass * 0.16 + accent * 0.28);

    for (const node of nodes) {
      const band = node.band === 0 ? bass : node.band === 1 ? mid : node.band === 2 ? air : energy;
      const wave = 0.5 + 0.5 * Math.sin(scoreTime * node.frequency * (1.55 + turbulence * 0.42) + node.phase);
      const groupAccent = node.pulseGroup === activePulseGroup ? pulse : pulse * 0.16;
      const tierAccent = node.tier === 3 ? accent * 0.52 : node.tier === 2 ? accent * 0.24 : 0;
      const cueAccent = cueEnvelopes[node.index];
      const height = node.flameScale * (
        0.36 + flame * 1.16 + band * 0.42 + wave * turbulence * 0.28 +
        groupAccent * 0.82 + tierAccent + cueAccent * 1.42
      );
      const width = node.flameScale * (
        0.31 + heat * 0.25 + wave * 0.13 + groupAccent * 0.16 + cueAccent * 0.28
      );
      // Every score node becomes a torch: the outer and white-hot flame
      // volumes begin near the monolith crown instead of being hidden behind
      // several metres of opaque obsidian.
      const flameRootY = Math.max(0.22, node.monolithHeight * 0.82);
      transform.position.set(node.x, flameRootY, node.z);
      transform.rotation.set(
        node.sin * 0.045 * turbulence,
        -node.angle + node.cin * 0.12 + Math.sin(scoreTime * 0.44 + node.phase) * 0.025,
        node.cin * 0.055 * turbulence,
      );
      transform.scale.set(width, Math.max(0.08, height), width * (0.82 + node.tier * 0.06));
      transform.updateMatrix();
      flames.setMatrixAt(node.index, transform.matrix);

      transform.position.y = flameRootY + 0.025;
      transform.scale.set(
        width * 0.43,
        Math.max(0.07, height * (0.56 + cueAccent * 0.08)),
        width * 0.38,
      );
      transform.updateMatrix();
      innerFlames.setMatrixAt(node.index, transform.matrix);

      const crackPulse = 0.72 + heat * 0.36 + band * 0.18 + groupAccent * 0.36 + cueAccent * 0.74;
      transform.position.set(node.x, 0.041 + node.tier * 0.0006, node.z);
      transform.rotation.set(0, node.angle + node.sin * 0.16, 0);
      transform.scale.set(
        node.crackWidth * (0.82 + accent * 0.34),
        1,
        node.crackLength * crackPulse,
      );
      transform.updateMatrix();
      cracks.setMatrixAt(node.index, transform.matrix);
    }
    flames.instanceMatrix.needsUpdate = true;
    innerFlames.instanceMatrix.needsUpdate = true;
    cracks.instanceMatrix.needsUpdate = true;

    const coreSurge = 1 + pulse * 0.12 + flare * 0.23 + crown * 0.16 + manualEnvelope * 0.25;
    coreFlame.scale.set(
      0.88 + heat * 0.31 + accent * 0.12,
      (0.72 + flame * 0.56 + crown * 0.34) * coreSurge,
      0.88 + heat * 0.31 + accent * 0.12,
    );
    coreMaterial.emissiveIntensity = 1.45 + heat * 2.15 + flare * 1.35;
    ringMaterial.emissiveIntensity = 0.92 + heat * 1.65 + accent * 1.10;
    const ribbonPulse = 0.84 + heat * 0.18 + flare * 0.16 + manualEnvelope * 0.12;
    cinRibbon.rotation.y = scoreTime * (0.12 + turbulence * 0.08);
    cinRibbon.rotation.z = -0.28 + Math.sin(scoreTime * 0.16) * 0.19;
    sinRibbon.rotation.y = -scoreTime * (0.15 + turbulence * 0.09);
    sinRibbon.rotation.x = -0.36 + Math.cos(scoreTime * 0.13) * 0.17;
    cinRibbon.scale.setScalar(ribbonPulse);
    sinRibbon.scale.setScalar(0.91 + ribbonPulse * 0.10 + crown * 0.08);
    cinRibbonMaterial.emissiveIntensity = 1.35 + heat * 1.45 + flare * 1.2;
    sinRibbonMaterial.emissiveIntensity = 1.05 + air * 1.1 + crown * 1.0;

    const visibleSmoke = THREE.MathUtils.clamp(Math.round(20 + smoke * 76), 0, SMOKE_COUNT);
    smokeField.material.opacity = 0.055 + smoke * 0.155;
    for (let index = 0; index < SMOKE_COUNT; ++index) {
      const spec = smokeField.specs[index];
      const node = nodes[spec.anchorIndex];
      const age = fract(scoreTime * spec.speed + spec.phase);
      const active = index < visibleSmoke;
      const sourceMix = index % 5 === 0 ? 0.16 : 1;
      const baseX = node.x * sourceMix;
      const baseZ = node.z * sourceMix;
      const curl = spec.drift * age * (0.55 + turbulence * 0.75);
      smokeDummy.position.set(
        baseX + Math.sin(spec.phase * TAU + age * 4.8) * curl,
        0.65 + age * spec.lift * (0.68 + heat * 0.38),
        baseZ + Math.cos(spec.phase * TAU * 0.83 + age * 4.1) * curl,
      );
      if (camera?.quaternion) smokeDummy.quaternion.copy(camera.quaternion);
      else smokeDummy.quaternion.identity();
      smokeSpin.setFromAxisAngle(smokeAxis, spec.spin * age);
      smokeDummy.quaternion.multiply(smokeSpin);
      const envelope = Math.sin(Math.PI * age);
      const size = active ? spec.scale * (0.34 + envelope * 0.88) * (0.78 + smoke * 0.45) : 0;
      smokeDummy.scale.set(size, size * (0.82 + age * 0.44), size);
      smokeDummy.updateMatrix();
      smokeField.mesh.setMatrixAt(index, smokeDummy.matrix);
    }
    smokeField.mesh.count = SMOKE_COUNT;
    smokeField.mesh.instanceMatrix.needsUpdate = true;

    const visibleEmbers = THREE.MathUtils.clamp(Math.round(96 + spark * 430 + flame * 154 + accent * 40), 0, EMBER_COUNT);
    emberField.geometry.setDrawRange(0, visibleEmbers);
    emberField.material.opacity = 0.58 + spark * 0.34;
    emberField.material.size = 0.105 + spark * 0.095 + accent * 0.032;
    for (let index = 0; index < EMBER_COUNT; ++index) {
      const spec = emberField.specs[index];
      const node = nodes[spec.anchorIndex];
      const age = fract(scoreTime * spec.speed * (0.82 + turbulence * 0.46) + spec.phase);
      const sourceScale = spec.central ? 0.12 : 1;
      const radial = spec.radius * (0.25 + age * 0.9);
      const angle = spec.curl + age * (2.4 + turbulence * 2.1);
      const offset = index * 3;
      emberField.positions[offset] = node.x * sourceScale + Math.cos(angle) * radial;
      emberField.positions[offset + 1] = 0.45 + age * spec.lift * (0.74 + heat * 0.42);
      emberField.positions[offset + 2] = node.z * sourceScale + Math.sin(angle) * radial;
    }
    emberField.geometry.getAttribute("position").needsUpdate = true;

    hemisphere.intensity = 0.30 + energy * 0.28;
    coreLight.intensity = 16 + heat * 38 + bass * 15 + flare * 24 + manualEnvelope * 21;
    coreLight.distance = 22 + flame * 12 + crown * 4;
    satelliteLights.forEach((light, index) => {
      const relayPulse = activePulseGroup % 4 === index ? pulse : pulse * 0.16;
      light.intensity = 3.5 + energy * 10 + heat * 7 + relayPulse * 16 + accent * (index === beat % 4 ? 8 : 1.5);
      light.distance = 12 + flame * 8;
    });

    frameCount += 1;
    lastReactive = Object.freeze({
      energy,
      flame,
      smoke,
      spark,
      heat,
      accent,
      section: String(music.section ?? "silence"),
      timeSeconds: scoreTime,
      cueId: currentCueId,
      cueNodeId: currentCueId >= 1 && currentCueId <= nodes.length
        ? nodes[currentCueId - 1].id
        : null,
    });
    return true;
  }

  function stats() {
    return {
      seed: String(seed),
      nodeCount: nodes.length,
      monolithCount: monoliths.count,
      crackCount: cracks.count,
      flameAnchorCount: flames.count,
      innerFlameAnchorCount: innerFlames.count,
      emberCapacity: EMBER_COUNT,
      smokeCapacity: SMOKE_COUNT,
      staticMeshCount: staticMeshes.length,
      lightCount: lights.length,
      frameCount,
      disposed,
      reactive: { ...lastReactive },
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(root);
    for (const geometry of ownedGeometries) geometry.dispose?.();
    for (const material of ownedMaterials) material.dispose?.();
    for (const texture of ownedTextures) texture.dispose?.();
    if (ownedBackground && scene.background === ownedBackground) scene.background = previousBackground;
    if (ownedFog && scene.fog === ownedFog) scene.fog = previousFog;
  }

  update({}, 0, 0, null, 0);

  return Object.freeze({
    root,
    staticMeshes: Object.freeze([...staticMeshes]),
    lights: Object.freeze([...lights]),
    nodes,
    update,
    stats,
    dispose,
  });
}

export default createFirePatternScene;
