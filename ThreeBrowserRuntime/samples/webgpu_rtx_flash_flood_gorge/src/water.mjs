import * as THREE from "three/webgpu";
import {
  attribute,
  bumpMap,
  cameraPosition,
  color,
  dot,
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalMap,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import {
  SURFACE_TEXTURE_FAMILIES,
  getSurfaceTextureSet,
} from "./surface-textures.mjs";

const floodTime = uniform(0);
// Retained as a compatibility name for the public setter; the live value is
// the scene's dominant celestial key (the low sunset sun in this demo).
const moonDirection = uniform(new THREE.Vector3(0.22, 0.24, -0.946).normalize());
const RENDER_UPSAMPLE = 2;
const SURFACE_SMOOTHING = 0.62;
const MAX_SMOOTHING_DELTA = 0.42;
const WET_DEPTH_THRESHOLD = 0.012;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 1 ? number : fallback;
}

function scalarCellSize(model) {
  const value = model?.cellSize;
  if (Number.isFinite(Number(value))) return Math.max(0.05, Number(value));
  if (value && Number.isFinite(Number(value.x))) return Math.max(0.05, Number(value.x));
  return 4;
}

function modelLayout(model) {
  const width = positiveInteger(model?.width, 64);
  const height = positiveInteger(model?.height, 160);
  const cellSize = scalarCellSize(model);
  const cellSizeX = Math.max(0.05, finite(model?.cellSizeX, cellSize));
  const cellSizeZ = Math.max(0.05, finite(model?.cellSizeZ, cellSize));
  const originX = finite(model?.originX ?? model?.config?.originX, -width * cellSizeX * 0.5);
  const originZ = finite(model?.originZ ?? model?.config?.originZ, -height * cellSizeZ * 0.5);
  return { width, height, cellSizeX, cellSizeZ, originX, originZ };
}

function createFloodMaterial() {
  const flowMaps = getSurfaceTextureSet(SURFACE_TEXTURE_FAMILIES.WATER_FLOW, {
    size: 512,
    anisotropy: 12,
  });
  const depth = attribute("waterDepth", "float").max(0);
  const foam = attribute("waterFoam", "float").clamp(0, 1);
  const turbulence = attribute("waterTurbulence", "float").clamp(0, 1);
  const speed = attribute("flowSpeed", "float").max(0);
  // waterWetness remains a one-to-one copy of the solver mask at its exact
  // sample locations. waterCoverage is the smoothly reconstructed render
  // footprint between those samples.
  const wetness = attribute("waterCoverage", "float").clamp(0, 1);

  // Advect an aperiodic field through one fixed gorge-space frame. Infinite
  // travelling sine planes read as slow line scans from the aerial cameras,
  // even at physically fast phase speeds. The low-frequency field bends the
  // body of the flow, the fBm supplies finite rolling cells, and the last
  // field breaks them into fast detail. Time never multiplies a per-vertex
  // velocity or rotation, so neighbouring fragments stay temporally coherent.
  const flowAcross = positionLocal.x.mul(0.135).add(positionLocal.z.mul(0.028));
  const flowAlong = positionLocal.z.mul(0.215).sub(positionLocal.x.mul(0.018));
  const eddyNoise = mx_noise_float(vec3(
    flowAcross.mul(0.43).add(floodTime.mul(0.19)),
    flowAlong.mul(0.42).sub(floodTime.mul(1.45)),
    floodTime.mul(0.31),
  ));
  const rollingNoise = mx_fractal_noise_float(vec3(
    flowAcross.add(eddyNoise.mul(0.32)),
    flowAlong.sub(floodTime.mul(4.5)).add(eddyNoise.mul(0.46)),
    floodTime.mul(0.64),
  ), 3, 2.07, 0.50);
  const fineNoise = mx_noise_float(vec3(
    positionLocal.x.mul(0.61)
      .sub(positionLocal.z.mul(0.08))
      .add(floodTime.mul(0.48))
      .add(rollingNoise.mul(0.16)),
    positionLocal.z.mul(0.92)
      .add(positionLocal.x.mul(0.12))
      .sub(floodTime.mul(19.5))
      .sub(rollingNoise.mul(0.24)),
    floodTime.mul(1.8),
  ));
  const waveAmount = smoothstep(0.025, 0.18, depth)
    .mul(float(0.025).add(speed.mul(0.0035)).add(turbulence.mul(0.045)))
    .mul(wetness);
  const microHeight = rollingNoise.mul(0.42)
    .add(fineNoise.mul(0.48))
    .add(eddyNoise.mul(0.10))
    .mul(waveAmount);

  // Two independently oriented flow-map layers translate downstream at
  // approximately 18 and 20 m/s. They provide persistent fine surface texture
  // without freezing to the mesh or exposing a periodic travelling stripe.
  const flowUvA = vec2(
    positionLocal.x.mul(0.061)
      .add(positionLocal.z.mul(0.005))
      .sub(floodTime.mul(0.141)),
    positionLocal.z.mul(0.026)
      .sub(positionLocal.x.mul(0.003))
      .sub(floodTime.mul(0.479)),
  );
  const flowUvB = vec2(
    positionLocal.x.mul(0.118)
      .sub(positionLocal.z.mul(0.009))
      .add(floodTime.mul(0.269)),
    positionLocal.z.mul(0.061)
      .add(positionLocal.x.mul(0.007))
      .sub(floodTime.mul(1.338)),
  );
  const mappedFlowNormal = normalMap(
    mix(
      texture(flowMaps.normal, flowUvA).rgb,
      texture(flowMaps.normal, flowUvB).rgb,
      0.42,
    ),
    vec2(0.24, 0.13),
  );

  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Dynamic sunset-lit flash-flood water",
    color: 0xffffff,
    metalness: 0,
    roughness: 0.12,
    clearcoat: 0.34,
    clearcoatRoughness: 0.08,
    ior: 1.333,
    transparent: true,
    opacity: 0.86,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });

  // The solver and cubic reconstruction exclusively own the silhouette.
  // Shader ripples are normal-only, removing the broad pushed-gel swell while
  // retaining fast detail in both the raster and native MRT normal guide.
  material.positionNode = vec3(positionLocal.x, positionLocal.y, positionLocal.z);
  const proceduralFlowNormal = bumpMap(microHeight, 0.16);
  material.normalNode = normalize(mix(proceduralFlowNormal, mappedFlowNormal, 0.48));

  const depthMix = smoothstep(0.08, 2.8, depth);
  const sediment = smoothstep(2.2, 7.5, speed).mul(float(1).sub(foam));
  const clearShallow = color(0x17373d);
  const coldDepth = color(0x03131d);
  const mineralRapid = color(0x1d302b);
  const body = mix(mix(clearShallow, coldDepth, depthMix), mineralRapid, sediment.mul(0.38));
  const mappedFlowAlbedo = mix(
    texture(flowMaps.albedo, flowUvA).rgb,
    texture(flowMaps.albedo, flowUvB).rgb,
    0.42,
  );
  const mappedBodyWeight = smoothstep(0.03, 0.16, depth).mul(wetness).mul(0.11);
  const texturedBody = mix(body, mappedFlowAlbedo, mappedBodyWeight);
  // Reuse the advected fields as a genuinely broken whitewater mask. This
  // hides the solver's four-metre scalar interpolation without adding texture
  // fetches or reintroducing periodic crest ribbons.
  const rollingUnit = rollingNoise.mul(0.5).add(0.5).clamp(0, 1);
  const fineUnit = fineNoise.mul(0.5).add(0.5).clamp(0, 1);
  const eddyUnit = eddyNoise.mul(0.5).add(0.5).clamp(0, 1);
  const foamBody = smoothstep(
    0.50,
    0.74,
    rollingUnit.mul(0.36).add(eddyUnit.mul(0.12)).add(fineUnit.mul(0.52)),
  );
  const foamFleck = smoothstep(0.68, 0.90, fineUnit)
    .mul(smoothstep(0.43, 0.66, rollingUnit));
  const foamBreakup = float(0.24)
    .add(foamBody.mul(0.78))
    .add(foamFleck.mul(0.52))
    .clamp(0, 1.25);
  const foamCoverage = foam.mul(0.62).add(turbulence.mul(0.23)).clamp(0, 1)
    .mul(foamBreakup)
    .mul(wetness)
    .clamp(0, 1);
  material.colorNode = mix(texturedBody, color(0xc6d5cf), foamCoverage.mul(0.88));
  const mappedFlowRoughness = mix(
    texture(flowMaps.roughness, flowUvA).g,
    texture(flowMaps.roughness, flowUvB).g,
    0.42,
  );
  const clearWaterRoughness = float(0.08)
    .add(mappedFlowRoughness.mul(0.24))
    .add(turbulence.mul(0.035));
  material.roughnessNode = mix(clearWaterRoughness, float(0.56), foamCoverage)
    .add(turbulence.mul(0.06)).clamp(0.11, 0.66);

  const view = normalize(cameraPosition.sub(positionWorld));
  const reflected = reflect(view.negate(), normalWorld);
  const moonGlint = pow(dot(reflected, moonDirection).max(0), 48)
    .mul(float(1).sub(foamCoverage))
    .mul(smoothstep(0.03, 0.18, wetness));
  const fresnel = float(0.02037).add(
    float(0.97963).mul(pow(float(1).sub(dot(normalWorld, view).abs().clamp(0, 1)), 5)),
  );
  material.emissiveNode = color(0xffb879).mul(moonGlint.mul(0.64))
    .add(color(0x35405f).mul(fresnel.mul(0.042)))
    .add(color(0xd4c6bd).mul(foamCoverage.mul(0.018)));
  const opacityCoverage = smoothstep(0.018, 0.82, wetness);
  material.opacityNode = mix(
    float(0),
    mix(float(0.58), float(0.86), depthMix),
    opacityCoverage,
  );
  // Transparent zero-coverage triangles must not populate depth, including in
  // the preserved-transparency native MRT path.
  material.alphaTest = 0.012;

  // Generic native reflections consume the live normal, roughness and mask
  // guides emitted by this ordinary Three.js/TSL material. The moving water
  // deliberately stays outside the static TLAS.
  material.rtxUsesResolvedPbr = 1;
  material.rtxReflectionMask = 0.98;
  // Keep shallow alpha in the native MRT. Coverage-weighted normals and the
  // reflection mask remain strong enough for rays while submerged gorge
  // detail and caustics can show through the water colour attachment.
  material.rtxPreserveTransparency = 1;
  material.userData.rtxIgnore = true;
  material.userData.surfaceTextureFamily = flowMaps.family;
  material.userData.surfaceTextureResolution = flowMaps.size;
  return material;
}

function createGeometry(model) {
  const layout = modelLayout(model);
  const renderWidth = (layout.width - 1) * RENDER_UPSAMPLE + 1;
  const renderHeight = (layout.height - 1) * RENDER_UPSAMPLE + 1;
  const renderCellSizeX = layout.cellSizeX / RENDER_UPSAMPLE;
  const renderCellSizeZ = layout.cellSizeZ / RENDER_UPSAMPLE;
  const vertexCount = renderWidth * renderHeight;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const depths = new Float32Array(vertexCount);
  const foam = new Float32Array(vertexCount);
  const turbulence = new Float32Array(vertexCount);
  const speed = new Float32Array(vertexCount);
  const wetness = new Float32Array(vertexCount);
  const coverage = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);
  const sourceX0 = new Uint32Array(renderWidth);
  const sourceX1 = new Uint32Array(renderWidth);
  const sourceMixX = new Float32Array(renderWidth);
  const sourceZ0 = new Uint32Array(renderHeight);
  const sourceZ1 = new Uint32Array(renderHeight);
  const sourceMixZ = new Float32Array(renderHeight);
  const cubicSourceX = new Uint32Array(renderWidth * 4);
  const cubicWeightX = new Float32Array(renderWidth * 4);
  const cubicSourceZ = new Uint32Array(renderHeight * 4);
  const cubicWeightZ = new Float32Array(renderHeight * 4);
  const solverSample = new Int32Array(vertexCount);
  solverSample.fill(-1);

  for (let x = 0; x < renderWidth; ++x) {
    const sourceX = x / RENDER_UPSAMPLE;
    sourceX0[x] = Math.min(layout.width - 1, Math.floor(sourceX));
    sourceX1[x] = Math.min(layout.width - 1, sourceX0[x] + 1);
    sourceMixX[x] = sourceX - sourceX0[x];
    const t = sourceMixX[x];
    const oneMinusT = 1 - t;
    const t2 = t * t;
    const t3 = t2 * t;
    const offset = x * 4;
    cubicSourceX[offset] = Math.max(0, sourceX0[x] - 1);
    cubicSourceX[offset + 1] = sourceX0[x];
    cubicSourceX[offset + 2] = sourceX1[x];
    cubicSourceX[offset + 3] = Math.min(layout.width - 1, sourceX0[x] + 2);
    cubicWeightX[offset] = oneMinusT * oneMinusT * oneMinusT / 6;
    cubicWeightX[offset + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    cubicWeightX[offset + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    cubicWeightX[offset + 3] = t3 / 6;
  }
  for (let z = 0; z < renderHeight; ++z) {
    const sourceZ = z / RENDER_UPSAMPLE;
    sourceZ0[z] = Math.min(layout.height - 1, Math.floor(sourceZ));
    sourceZ1[z] = Math.min(layout.height - 1, sourceZ0[z] + 1);
    sourceMixZ[z] = sourceZ - sourceZ0[z];
    const t = sourceMixZ[z];
    const oneMinusT = 1 - t;
    const t2 = t * t;
    const t3 = t2 * t;
    const offset = z * 4;
    cubicSourceZ[offset] = Math.max(0, sourceZ0[z] - 1);
    cubicSourceZ[offset + 1] = sourceZ0[z];
    cubicSourceZ[offset + 2] = sourceZ1[z];
    cubicSourceZ[offset + 3] = Math.min(layout.height - 1, sourceZ0[z] + 2);
    cubicWeightZ[offset] = oneMinusT * oneMinusT * oneMinusT / 6;
    cubicWeightZ[offset + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    cubicWeightZ[offset + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    cubicWeightZ[offset + 3] = t3 / 6;
  }
  for (let z = 0; z < renderHeight; ++z) {
    for (let x = 0; x < renderWidth; ++x) {
      const index = z * renderWidth + x;
      const offset = index * 3;
      positions[offset] = layout.originX + (x / RENDER_UPSAMPLE + 0.5) * layout.cellSizeX;
      positions[offset + 2] = layout.originZ + (z / RENDER_UPSAMPLE + 0.5) * layout.cellSizeZ;
      normals[offset + 1] = 1;
      uvs[index * 2] = x / Math.max(1, renderWidth - 1);
      uvs[index * 2 + 1] = z / Math.max(1, renderHeight - 1);
      if (x % RENDER_UPSAMPLE === 0 && z % RENDER_UPSAMPLE === 0) {
        solverSample[index] = sourceZ0[z] * layout.width + sourceX0[x];
      }
    }
  }

  const indices = new Uint32Array((renderWidth - 1) * (renderHeight - 1) * 6);
  let cursor = 0;
  for (let z = 0; z < renderHeight - 1; ++z) {
    for (let x = 0; x < renderWidth - 1; ++x) {
      const a = z * renderWidth + x;
      const b = a + 1;
      const c = a + renderWidth;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = "Dynamic shallow-water gorge ribbon";
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("waterDepth", new THREE.BufferAttribute(depths, 1));
  geometry.setAttribute("waterFoam", new THREE.BufferAttribute(foam, 1));
  geometry.setAttribute("waterTurbulence", new THREE.BufferAttribute(turbulence, 1));
  geometry.setAttribute("flowSpeed", new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute("waterWetness", new THREE.BufferAttribute(wetness, 1));
  geometry.setAttribute("waterCoverage", new THREE.BufferAttribute(coverage, 1));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const attribute of Object.values(geometry.attributes)) {
    attribute.setUsage(THREE.DynamicDrawUsage);
  }
  const bounds = model?.worldBounds ?? {};
  const centerX = (finite(bounds.minX, layout.originX) + finite(
    bounds.maxX,
    layout.originX + layout.width * layout.cellSizeX,
  )) * 0.5;
  const centerZ = (finite(bounds.minZ, layout.originZ) + finite(
    bounds.maxZ,
    layout.originZ + layout.height * layout.cellSizeZ,
  )) * 0.5;
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(centerX, 20, centerZ),
    Math.hypot(layout.width * layout.cellSizeX, layout.height * layout.cellSizeZ, 160),
  );
  return {
    geometry,
    layout,
    renderLayout: {
      width: renderWidth,
      height: renderHeight,
      cellSizeX: renderCellSizeX,
      cellSizeZ: renderCellSizeZ,
      sourceX0,
      sourceX1,
      sourceMixX,
      sourceZ0,
      sourceZ1,
      sourceMixZ,
      cubicSourceX,
      cubicWeightX,
      cubicSourceZ,
      cubicWeightZ,
      solverSample,
    },
  };
}

function arrayValue(array, index, fallback = 0) {
  return array && index < array.length ? finite(array[index], fallback) : fallback;
}

export function createFlashFloodWater({ model, bedHeight = null, moon = null } = {}) {
  if (!model) throw new Error("createFlashFloodWater requires a FlashFloodModel.");
  const { geometry, layout, renderLayout } = createGeometry(model);
  const material = createFloodMaterial();
  const surface = new THREE.Mesh(geometry, material);
  surface.name = "Travelling flash-flood surge surface";
  surface.frustumCulled = false;
  surface.castShadow = false;
  surface.receiveShadow = true;
  surface.renderOrder = 11;
  surface.userData.rtxIgnore = true;

  const positionAttribute = geometry.getAttribute("position");
  const normalAttribute = geometry.getAttribute("normal");
  const depthAttribute = geometry.getAttribute("waterDepth");
  const foamAttribute = geometry.getAttribute("waterFoam");
  const turbulenceAttribute = geometry.getAttribute("waterTurbulence");
  const speedAttribute = geometry.getAttribute("flowSpeed");
  const wetnessAttribute = geometry.getAttribute("waterWetness");
  const coverageAttribute = geometry.getAttribute("waterCoverage");
  const positions = positionAttribute.array;
  const normals = normalAttribute.array;
  const simulationCellCount = layout.width * layout.height;
  const renderVertexCount = renderLayout.width * renderLayout.height;
  const rawSurface = new Float64Array(simulationCellCount);
  const smoothSurface = new Float64Array(simulationCellCount);
  const sampledBed = new Float64Array(simulationCellCount);
  const sampledDepth = new Float64Array(simulationCellCount);
  const sampledWetness = new Uint8Array(simulationCellCount);
  const renderHeights = new Float64Array(renderVertexCount);
  let renderWetVertices = 0;
  let geometryTick = Number.NaN;
  let geometryInitialized = false;

  function update(time = 0) {
    floodTime.value = finite(time, 0);
    if (moon?.isVector3) moonDirection.value.copy(moon).normalize();
    else if (Array.isArray(moon) || ArrayBuffer.isView(moon)) {
      moonDirection.value.set(finite(moon[0], 0.22), finite(moon[1], 0.24), finite(moon[2], -0.946)).normalize();
    }
    // The solver owns a fixed clock. Between ticks every geometry-driving
    // array is unchanged, while the TSL micro-waves above still receive the
    // current render time. Avoid rebuilding and re-uploading an identical
    // 2x ribbon on those render-only frames.
    const currentTick = Number(model.tick);
    if (geometryInitialized && Number.isFinite(currentTick) && currentTick === geometryTick) return;

    const depthValues = model.depth;
    const bedValues = model.bed;
    const surfaceValues = model.surface;
    const foamValues = model.foam;
    const turbulenceValues = model.turbulence;
    const speedValues = model.speed;
    const wetMask = model.wetMask;
    for (let z = 0; z < layout.height; ++z) {
      for (let x = 0; x < layout.width; ++x) {
        const index = z * layout.width + x;
        const worldX = layout.originX + (x + 0.5) * layout.cellSizeX;
        const worldZ = layout.originZ + (z + 0.5) * layout.cellSizeZ;
        const storedBed = bedValues && index < bedValues.length
          ? Number(bedValues[index])
          : Number.NaN;
        const bed = Number.isFinite(storedBed)
          ? storedBed
          : typeof bedHeight === "function" ? finite(bedHeight(worldX, worldZ)) : 0;
        const depth = Math.max(0, arrayValue(depthValues, index));
        const isWet = wetMask
          ? arrayValue(wetMask, index) > 0.5 ? 1 : 0
          : depth > WET_DEPTH_THRESHOLD ? 1 : 0;
        const waterSurface = arrayValue(surfaceValues, index, bed + depth);
        sampledBed[index] = bed;
        sampledDepth[index] = depth;
        sampledWetness[index] = isWet;
        rawSurface[index] = waterSurface;
      }
    }

    // One bounded wet-aware low-pass removes solver-cell steps without
    // changing the simulation. Dry banks never contribute to wet heights.
    for (let z = 0; z < layout.height; ++z) {
      for (let x = 0; x < layout.width; ++x) {
        const index = z * layout.width + x;
        if (!sampledWetness[index]) {
          smoothSurface[index] = rawSurface[index];
          continue;
        }
        let total = rawSurface[index] * 4;
        let weight = 4;
        const minZ = Math.max(0, z - 1);
        const maxZ = Math.min(layout.height - 1, z + 1);
        const minX = Math.max(0, x - 1);
        const maxX = Math.min(layout.width - 1, x + 1);
        for (let nz = minZ; nz <= maxZ; ++nz) {
          for (let nx = minX; nx <= maxX; ++nx) {
            if (nx === x && nz === z) continue;
            const neighbour = nz * layout.width + nx;
            if (!sampledWetness[neighbour]) continue;
            const neighbourWeight = nx === x || nz === z ? 2 : 1;
            total += rawSurface[neighbour] * neighbourWeight;
            weight += neighbourWeight;
          }
        }
        const average = total / weight;
        const delta = THREE.MathUtils.clamp(
          (average - rawSurface[index]) * SURFACE_SMOOTHING,
          -MAX_SMOOTHING_DELTA,
          MAX_SMOOTHING_DELTA,
        );
        smoothSurface[index] = rawSurface[index] + delta;
      }
    }

    renderWetVertices = 0;
    for (let z = 0; z < renderLayout.height; ++z) {
      const z0 = renderLayout.sourceZ0[z];
      const z1 = renderLayout.sourceZ1[z];
      const tz = renderLayout.sourceMixZ[z];
      const oneMinusZ = 1 - tz;
      for (let x = 0; x < renderLayout.width; ++x) {
        const x0 = renderLayout.sourceX0[x];
        const x1 = renderLayout.sourceX1[x];
        const tx = renderLayout.sourceMixX[x];
        const oneMinusX = 1 - tx;
        const i00 = z0 * layout.width + x0;
        const i10 = z0 * layout.width + x1;
        const i01 = z1 * layout.width + x0;
        const i11 = z1 * layout.width + x1;
        const w00 = oneMinusX * oneMinusZ;
        const w10 = tx * oneMinusZ;
        const w01 = oneMinusX * tz;
        const w11 = tx * tz;
        const wet00 = sampledWetness[i00];
        const wet10 = sampledWetness[i10];
        const wet01 = sampledWetness[i01];
        const wet11 = sampledWetness[i11];
        const wetWeight = w00 * wet00 + w10 * wet10 + w01 * wet01 + w11 * wet11;
        const edge = THREE.MathUtils.clamp((wetWeight - 0.04) / 0.96, 0, 1);
        const coverage = edge * edge * (3 - 2 * edge);
        const index = z * renderLayout.width + x;
        const offset = index * 3;
        const bed = sampledBed[i00] * w00 + sampledBed[i10] * w10 +
          sampledBed[i01] * w01 + sampledBed[i11] * w11;

        let waterSurface = bed;
        let depth = 0;
        let foam = 0;
        let turbulence = 0;
        let speed = 0;
        if (wetWeight > 1e-6) {
          const inverseWetWeight = 1 / wetWeight;
          const ww00 = w00 * wet00;
          const ww10 = w10 * wet10;
          const ww01 = w01 * wet01;
          const ww11 = w11 * wet11;
          waterSurface = (smoothSurface[i00] * ww00 + smoothSurface[i10] * ww10 +
            smoothSurface[i01] * ww01 + smoothSurface[i11] * ww11) * inverseWetWeight;
          // A positive tensor-product cubic B-spline removes the visible
          // piecewise-planar crease at solver-cell boundaries. It is only
          // used across a completely wet local footprint: shorelines retain
          // the coverage-weighted reconstruction above, and dry kernel
          // samples never contribute. Positive weights plus the local-range
          // clamp make overshoot impossible even around hydraulic jumps.
          if (wet00 && wet10 && wet01 && wet11) {
            const cubicXOffset = x * 4;
            const cubicZOffset = z * 4;
            let cubicSurface = 0;
            let cubicWeight = 0;
            for (let kernelZ = 0; kernelZ < 4; ++kernelZ) {
              const sourceZ = renderLayout.cubicSourceZ[cubicZOffset + kernelZ];
              const weightZ = renderLayout.cubicWeightZ[cubicZOffset + kernelZ];
              const sourceRow = sourceZ * layout.width;
              for (let kernelX = 0; kernelX < 4; ++kernelX) {
                const sourceX = renderLayout.cubicSourceX[cubicXOffset + kernelX];
                const sourceIndex = sourceRow + sourceX;
                if (!sampledWetness[sourceIndex]) continue;
                const weight = weightZ * renderLayout.cubicWeightX[cubicXOffset + kernelX];
                cubicSurface += smoothSurface[sourceIndex] * weight;
                cubicWeight += weight;
              }
            }
            if (cubicWeight > 1e-8) {
              const localMinimum = Math.min(
                smoothSurface[i00],
                smoothSurface[i10],
                smoothSurface[i01],
                smoothSurface[i11],
              );
              const localMaximum = Math.max(
                smoothSurface[i00],
                smoothSurface[i10],
                smoothSurface[i01],
                smoothSurface[i11],
              );
              waterSurface = THREE.MathUtils.clamp(
                cubicSurface / cubicWeight,
                localMinimum,
                localMaximum,
              );
            }
          }
          depth = (sampledDepth[i00] * ww00 + sampledDepth[i10] * ww10 +
            sampledDepth[i01] * ww01 + sampledDepth[i11] * ww11) * inverseWetWeight;
          foam = (arrayValue(foamValues, i00) * ww00 + arrayValue(foamValues, i10) * ww10 +
            arrayValue(foamValues, i01) * ww01 + arrayValue(foamValues, i11) * ww11) * inverseWetWeight;
          turbulence = (arrayValue(turbulenceValues, i00) * ww00 + arrayValue(turbulenceValues, i10) * ww10 +
            arrayValue(turbulenceValues, i01) * ww01 + arrayValue(turbulenceValues, i11) * ww11) * inverseWetWeight;
          speed = (arrayValue(speedValues, i00) * ww00 + arrayValue(speedValues, i10) * ww10 +
            arrayValue(speedValues, i01) * ww01 + arrayValue(speedValues, i11) * ww11) * inverseWetWeight;
        }

        const height = coverage > 1e-4 ? waterSurface + 0.028 : bed - 0.16;
        positions[offset + 1] = height;
        renderHeights[index] = height;
        depthAttribute.array[index] = Math.max(0, depth);
        foamAttribute.array[index] = THREE.MathUtils.clamp(foam, 0, 1);
        turbulenceAttribute.array[index] = THREE.MathUtils.clamp(turbulence, 0, 1);
        speedAttribute.array[index] = Math.max(0, speed);
        coverageAttribute.array[index] = coverage;
        const sampleIndex = renderLayout.solverSample[index];
        wetnessAttribute.array[index] = sampleIndex >= 0 ? sampledWetness[sampleIndex] : 0;
        if (coverage > 0.01) renderWetVertices++;
      }
    }

    for (let z = 0; z < renderLayout.height; ++z) {
      const beforeZ = Math.max(0, z - 1);
      const afterZ = Math.min(renderLayout.height - 1, z + 1);
      for (let x = 0; x < renderLayout.width; ++x) {
        const beforeX = Math.max(0, x - 1);
        const afterX = Math.min(renderLayout.width - 1, x + 1);
        const index = z * renderLayout.width + x;
        const centerHeight = renderHeights[index];
        const leftIndex = z * renderLayout.width + beforeX;
        const rightIndex = z * renderLayout.width + afterX;
        const beforeIndex = beforeZ * renderLayout.width + x;
        const afterIndex = afterZ * renderLayout.width + x;
        const leftHeight = coverageAttribute.array[leftIndex] > 0.01
          ? renderHeights[leftIndex] : centerHeight;
        const rightHeight = coverageAttribute.array[rightIndex] > 0.01
          ? renderHeights[rightIndex] : centerHeight;
        const beforeHeight = coverageAttribute.array[beforeIndex] > 0.01
          ? renderHeights[beforeIndex] : centerHeight;
        const afterHeight = coverageAttribute.array[afterIndex] > 0.01
          ? renderHeights[afterIndex] : centerHeight;
        const dx = coverageAttribute.array[index] > 0.01
          ? (rightHeight - leftHeight) / Math.max(
            renderLayout.cellSizeX,
            (afterX - beforeX) * renderLayout.cellSizeX,
          )
          : 0;
        const dz = coverageAttribute.array[index] > 0.01
          ? (afterHeight - beforeHeight) / Math.max(
            renderLayout.cellSizeZ,
            (afterZ - beforeZ) * renderLayout.cellSizeZ,
          )
          : 0;
        const inverseLength = 1 / Math.hypot(dx, 1, dz);
        const offset = index * 3;
        normals[offset] = -dx * inverseLength;
        normals[offset + 1] = inverseLength;
        normals[offset + 2] = -dz * inverseLength;
      }
    }

    for (const attribute of [
      positionAttribute,
      normalAttribute,
      depthAttribute,
      foamAttribute,
      turbulenceAttribute,
      speedAttribute,
      wetnessAttribute,
      coverageAttribute,
    ]) attribute.needsUpdate = true;
    geometryInitialized = true;
    geometryTick = currentTick;
  }

  update(0);
  return {
    surface,
    geometry,
    material,
    layout: { ...layout },
    update,
    stats() {
      const simulationVertices = layout.width * layout.height;
      const simulationTriangles = (layout.width - 1) * (layout.height - 1) * 2;
      return {
        // Keep the original counters as solver-complexity counters for callers
        // that chart simulation cost. Render counters expose the denser ribbon.
        vertices: simulationVertices,
        triangles: simulationTriangles,
        simulationVertices,
        simulationTriangles,
        renderVertices: renderVertexCount,
        renderTriangles: (renderLayout.width - 1) * (renderLayout.height - 1) * 2,
        renderWetVertices,
        renderUpsample: RENDER_UPSAMPLE,
        surfaceSmoothing: SURFACE_SMOOTHING,
        surfaceReconstruction: "wet-aware-positive-cubic-b-spline",
        surfaceTextureFamily: material.userData.surfaceTextureFamily,
        surfaceTextureResolution: material.userData.surfaceTextureResolution,
        wetCells: Number(model.stats?.().wetCells ?? 0),
      };
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function updateFloodWaterTime(seconds, direction = null) {
  floodTime.value = finite(seconds, 0);
  if (direction?.isVector3) moonDirection.value.copy(direction).normalize();
}
