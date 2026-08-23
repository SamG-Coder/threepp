import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshPhysicalNodeMaterial,
} from "three/webgpu";
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
  uniform,
  vec3,
} from "three/tsl";

// One uniform animates every frond in the merged field. The CPU only updates a
// single float each frame; all current response is evaluated by WebGPU/TSL.
export const vegetationTime = uniform(0);

export const DEFAULT_VEGETATION_PATCHES = Object.freeze([
  Object.freeze({ x: -8.2, z: 1.2, radius: 2.7, weight: 1.0 }),
  Object.freeze({ x: 7.7, z: -1.8, radius: 2.8, weight: 1.0 }),
  Object.freeze({ x: -7.0, z: -7.4, radius: 3.2, weight: 1.2 }),
  Object.freeze({ x: 6.6, z: -10.8, radius: 3.7, weight: 1.3 }),
  Object.freeze({ x: -9.4, z: -17.8, radius: 3.8, weight: 1.15 }),
  Object.freeze({ x: 8.5, z: -21.0, radius: 3.6, weight: 1.0 }),
]);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPatch(random, patches) {
  let total = 0;
  for (const patch of patches) total += Math.max(0, patch.weight ?? 1);
  if (total <= 0) return patches[0];
  let value = random() * total;
  for (const patch of patches) {
    value -= Math.max(0, patch.weight ?? 1);
    if (value <= 0) return patch;
  }
  return patches[patches.length - 1];
}

function insideExclusion(x, z, exclusions) {
  for (const exclusion of exclusions) {
    const dx = x - (exclusion.x ?? 0);
    const dz = z - (exclusion.z ?? 0);
    const radius = Math.max(0, exclusion.radius ?? 0);
    if (dx * dx + dz * dz < radius * radius) return true;
  }
  return false;
}

function choosePlacement(random, patches, exclusions, acceptPlacement, species) {
  for (let attempt = 0; attempt < 32; ++attempt) {
    const patch = weightedPatch(random, patches);
    const angle = random() * Math.PI * 2;
    // Bias toward patch interiors so each clump has a natural dense heart and
    // feathered perimeter instead of a hard circular boundary.
    const distance = Math.pow(random(), 0.68) * patch.radius;
    const x = patch.x + Math.cos(angle) * distance;
    const z = patch.z + Math.sin(angle) * distance;
    if (insideExclusion(x, z, exclusions)) continue;
    if (acceptPlacement && !acceptPlacement(x, z, species)) continue;
    return { x, z };
  }
  return null;
}

function pushRibbon(buffers, spec) {
  const {
    x,
    y,
    z,
    height,
    width,
    yaw,
    phase,
    turbulence,
    species,
    segments,
    tint,
    lean,
  } = spec;
  const baseVertex = buffers.positions.length / 3;
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);
  const forwardX = Math.sin(yaw);
  const forwardZ = Math.cos(yaw);

  for (let row = 0; row <= segments; ++row) {
    const flex = row / segments;
    const curvedFlex = flex * flex;
    const centerLean = curvedFlex * height * lean;
    const edgeRipple = Math.sin(flex * Math.PI * (species > 0.5 ? 4.1 : 1.25) + phase)
      * width * (species > 0.5 ? 0.19 : 0.055) * flex;
    const profile = species > 0.5
      ? Math.pow(Math.sin(Math.PI * Math.min(0.995, flex * 0.94 + 0.025)), 0.58)
      : Math.max(0.025, Math.pow(1 - flex, 0.72) * (0.66 + Math.sin(flex * Math.PI) * 0.34));
    const halfWidth = width * profile * 0.5;
    const centerX = x + forwardX * centerLean + rightX * edgeRipple;
    const centerY = y + flex * height;
    const centerZ = z + forwardZ * centerLean + rightZ * edgeRipple;

    for (let side = -1; side <= 1; side += 2) {
      buffers.positions.push(
        centerX + rightX * halfWidth * side,
        centerY,
        centerZ + rightZ * halfWidth * side,
      );
      buffers.uvs.push((side + 1) * 0.5, flex);
      buffers.roots.push(x, y, z);
      buffers.phases.push(phase);
      buffers.flexes.push(flex);
      buffers.species.push(species);
      buffers.turbulence.push(turbulence);
      buffers.colors.push(tint.r, tint.g, tint.b);
    }
  }

  for (let row = 0; row < segments; ++row) {
    const a = baseVertex + row * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    buffers.indices.push(a, b, c, c, b, d);
  }
}

/**
 * Creates the shared physically-lit vegetation material.
 *
 * The material deforms the merged ribbon vertices in the vertex stage. Roots
 * remain fixed while tips respond to two current bands and a small gust field.
 */
export function createVegetationMaterial({
  currentStrength = 1,
  roughness = 0.82,
} = {}) {
  const material = new MeshPhysicalNodeMaterial({
    name: "Procedural underwater vegetation",
    side: DoubleSide,
    shadowSide: DoubleSide,
    metalness: 0,
    roughness,
    clearcoat: 0.018,
    clearcoatRoughness: 0.82,
    sheen: 0.10,
    sheenRoughness: 0.78,
    sheenColor: 0x76916a,
  });

  const root = attribute("plantRoot", "vec3");
  const phase = attribute("plantPhase", "float");
  const flex = attribute("plantFlex", "float");
  const species = attribute("plantSpecies", "float");
  const turbulence = attribute("plantTurbulence", "float");
  const tint = attribute("plantColor", "vec3");
  const tipResponse = pow(smoothstep(0.0, 1.0, flex), mix(float(1.72), float(1.34), species));
  const localCurrent = vegetationTime.mul(0.64)
    .add(phase)
    .add(root.x.mul(0.071))
    .sub(root.z.mul(0.046));
  const longSwell = sin(localCurrent);
  const crossCurrent = sin(
    vegetationTime.mul(1.03)
      .add(phase.mul(1.73))
      .add(root.z.mul(0.083)),
  );
  const fineGust = sin(
    vegetationTime.mul(1.82)
      .add(phase.mul(2.41))
      .add(root.x.add(root.z).mul(0.13)),
  );
  const amplitude = mix(float(0.11), float(0.30), species)
    .mul(turbulence)
    .mul(tipResponse)
    .mul(currentStrength);
  const swayX = longSwell.mul(amplitude)
    .add(fineGust.mul(amplitude).mul(0.13));
  const swayZ = crossCurrent.mul(amplitude).mul(0.44)
    .add(longSwell.mul(amplitude).mul(0.16));
  const drag = abs(longSwell).mul(amplitude).mul(flex).mul(0.085);

  material.positionNode = vec3(
    positionLocal.x.add(swayX),
    positionLocal.y.sub(drag),
    positionLocal.z.add(swayZ),
  );

  // Dark, olive roots transition to sunlit emerald tips. Subtle longitudinal
  // banding breaks up large blades while keeping a natural coastal palette.
  const tipLight = mix(float(0.72), float(1.08), smoothstep(0.06, 0.96, flex));
  const bladeBand = sin(positionLocal.y.mul(7.4).add(phase))
    .mul(0.035)
    .add(0.965);
  const kelpWarmth = mix(color(0x3e6245), color(0x71804d), species.mul(0.36));
  const litPlantColor = mix(kelpWarmth, tint, 0.88)
    .mul(tipLight)
    .mul(bladeBand);
  material.colorNode = litPlantColor;
  // A small chlorophyll-like fill keeps back-facing blades readable under the
  // water volume without making them self-lit.
	material.emissiveNode = litPlantColor.mul(0.055);
  material.roughnessNode = mix(float(0.92), float(0.72), species)
    .add(abs(crossCurrent).mul(0.035))
    .min(1.0);

  return material;
}

/**
 * Builds a deterministic one-draw-call field of segmented seagrass and kelp.
 * Pass the sample's terrainHeight function as `heightAt` so every root follows
 * the procedural seabed. `exclusions` accepts `{ x, z, radius }` entries and
 * `acceptPlacement` can reject additional locations such as rock footprints.
 */
export function createUnderwaterVegetation({
  seed = 0x51ea9a55,
  heightAt = () => 0,
  patches = DEFAULT_VEGETATION_PATCHES,
  exclusions = [],
  acceptPlacement = null,
  seagrassCount = 360,
  kelpCount = 52,
  currentStrength = 1,
  material = null,
} = {}) {
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("createUnderwaterVegetation requires at least one placement patch.");
  }

  const random = mulberry32(seed);
  const buffers = {
    positions: [],
    uvs: [],
    roots: [],
    phases: [],
    flexes: [],
    species: [],
    turbulence: [],
    colors: [],
    indices: [],
  };
  let grassPlaced = 0;
  let kelpPlaced = 0;

	const grassColors = [0x2f6847, 0x427a4c, 0x568954, 0x3d713f, 0x718d57];
  for (let index = 0; index < Math.max(0, seagrassCount); ++index) {
    const placement = choosePlacement(random, patches, exclusions, acceptPlacement, "seagrass");
    if (!placement) continue;
    const x = placement.x;
    const z = placement.z;
    const y = Number(heightAt(x, z)) || 0;
	    const height = 0.18 + Math.pow(random(), 0.72) * 0.48;
    const tint = new Color(grassColors[Math.floor(random() * grassColors.length)]);
    pushRibbon(buffers, {
      x,
      y: y + 0.012,
      z,
      height,
      width: 0.022 + random() * 0.038,
      yaw: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      turbulence: 0.72 + random() * 0.54,
      species: 0,
      segments: 6,
      tint,
      lean: (random() - 0.5) * 0.075,
    });
    grassPlaced += 1;
  }

	const kelpColors = [0x355f39, 0x497343, 0x5f8049, 0x71874c, 0x416a3b];
  for (let index = 0; index < Math.max(0, kelpCount); ++index) {
    const placement = choosePlacement(random, patches, exclusions, acceptPlacement, "kelp");
    if (!placement) continue;
    const x = placement.x;
    const z = placement.z;
    const y = Number(heightAt(x, z)) || 0;
	    const height = 0.56 + Math.pow(random(), 0.80) * 0.64;
    const tint = new Color(kelpColors[Math.floor(random() * kelpColors.length)]);
    pushRibbon(buffers, {
      x,
      y: y + 0.018,
      z,
      height,
	      width: 0.09 + random() * 0.10,
      yaw: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      turbulence: 0.78 + random() * 0.45,
      species: 1,
	      segments: 9,
      tint,
      lean: (random() - 0.5) * 0.12,
    });
    kelpPlaced += 1;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(buffers.positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(buffers.uvs), 2));
  geometry.setAttribute("plantRoot", new BufferAttribute(new Float32Array(buffers.roots), 3));
  geometry.setAttribute("plantPhase", new BufferAttribute(new Float32Array(buffers.phases), 1));
  geometry.setAttribute("plantFlex", new BufferAttribute(new Float32Array(buffers.flexes), 1));
  geometry.setAttribute("plantSpecies", new BufferAttribute(new Float32Array(buffers.species), 1));
  geometry.setAttribute("plantTurbulence", new BufferAttribute(new Float32Array(buffers.turbulence), 1));
  geometry.setAttribute("plantColor", new BufferAttribute(new Float32Array(buffers.colors), 3));
  geometry.setIndex(new BufferAttribute(new Uint32Array(buffers.indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (geometry.boundingBox) {
    geometry.boundingBox.min.x -= 0.42;
    geometry.boundingBox.max.x += 0.42;
    geometry.boundingBox.min.y -= 0.08;
    geometry.boundingBox.max.y += 0.08;
    geometry.boundingBox.min.z -= 0.24;
    geometry.boundingBox.max.z += 0.24;
  }
  if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.48;

  const vegetation = new Mesh(
    geometry,
    material ?? createVegetationMaterial({ currentStrength }),
  );
  vegetation.name = "Procedural seagrass and kelp field";
  vegetation.castShadow = true;
  vegetation.receiveShadow = true;
  vegetation.userData.vegetation = Object.freeze({
    seed,
    seagrassCount: grassPlaced,
    kelpCount: kelpPlaced,
    drawCalls: 1,
    triangles: buffers.indices.length / 3,
  });
  return vegetation;
}

export function updateVegetationTime(seconds) {
  vegetationTime.value = Number.isFinite(seconds) ? seconds : 0;
}
