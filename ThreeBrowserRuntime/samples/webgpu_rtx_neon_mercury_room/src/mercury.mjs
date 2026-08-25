import * as THREE from "three/webgpu";
import {
  attribute,
  bumpMap,
  color,
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  uniform,
  vec3,
} from "three/tsl";

const mercuryTime = uniform(0);
const RTX_REFLECTION_RADIANCE = Object.freeze([0.0072, 0.0026, 0.00028, 1]);
const RTX_REFLECTION_SURFACE = Object.freeze([0.71, 0.31, 0.022, 0.055]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 1 ? number : fallback;
}

function createMercuryMaterial() {
  const agitation = attribute("mercuryAgitation", "float").clamp(0, 1);
  const curvature = attribute("mercuryCurvature", "float").clamp(-1, 1);

  // The finite-volume solver exclusively owns the silhouette. These two
  // aperiodic fields only perturb the resolved shading normal by a fraction of
  // a millimetre, giving a liquid-metal shimmer without travelling scan lines.
  const broad = mx_fractal_noise_float(vec3(
    positionWorld.x.mul(2.7).add(mercuryTime.mul(0.18)),
    positionWorld.z.mul(2.3).sub(mercuryTime.mul(0.13)),
    mercuryTime.mul(0.21),
  ), 3, 2.11, 0.48);
  const capillary = mx_noise_float(vec3(
    positionWorld.x.mul(14.7).sub(positionWorld.z.mul(1.9)),
    positionWorld.z.mul(13.1).add(positionWorld.x.mul(2.2)),
    mercuryTime.mul(2.7),
  ));
  const microHeight = broad.mul(0.0011)
    .add(capillary.mul(float(0.00022).add(agitation.mul(0.00075))));

  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Opaque molten electrum mercury",
    color: 0xe5ad36,
    metalness: 1,
    roughness: 0.055,
    clearcoat: 0.18,
    clearcoatRoughness: 0.035,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.positionNode = positionLocal;
  material.normalNode = bumpMap(microHeight, 0.085);

  const warmGold = color(0xe0a12d);
  const brightGold = color(0xffd66e);
  const coolMercury = color(0xa99c82);
  const crest = smoothstep(0.06, 0.54, curvature.abs());
  material.colorNode = mix(
    mix(warmGold, brightGold, agitation.mul(0.28)),
    coolMercury,
    crest.mul(0.11),
  );
  material.roughnessNode = float(0.038)
    .add(agitation.mul(0.055))
    .add(crest.mul(0.018))
    .clamp(0.032, 0.12);

  // The dynamic surface remains outside the immutable static TLAS but writes
  // live position/normal/roughness/F0 guides into the primary MRT. Native
  // reflection transport therefore follows every solver wave each frame.
  material.rtxUsesResolvedPbr = 1;
  material.rtxReflectionMask = 1;
  material.userData.rtxIgnore = true;
  material.userData.rtxDynamicGuideSurface = true;
  return material;
}

function createSurfaceGeometry(model) {
  const width = positiveInteger(model?.width, 88);
  const height = positiveInteger(model?.height, 104);
  const poolWidth = Math.max(0.2, finite(model?.poolWidth, 4.4));
  const poolDepth = Math.max(0.2, finite(model?.poolDepth, 5.2));
  const cellSizeX = Math.max(0.001, finite(model?.cellSizeX, poolWidth / width));
  const cellSizeZ = Math.max(0.001, finite(model?.cellSizeZ, poolDepth / height));
  const originX = finite(model?.originX, -poolWidth * 0.5);
  const originZ = finite(model?.originZ, -poolDepth * 0.5);
  const vertexCount = width * height;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const agitation = new Float32Array(vertexCount);
  const curvature = new Float32Array(vertexCount);
  const speed = new Float32Array(vertexCount);
  const uv = new Float32Array(vertexCount * 2);
  for (let z = 0; z < height; ++z) {
    for (let x = 0; x < width; ++x) {
      const index = z * width + x;
      const offset = index * 3;
      positions[offset] = originX + (x + 0.5) * cellSizeX;
      positions[offset + 2] = originZ + (z + 0.5) * cellSizeZ;
      normals[offset + 1] = 1;
      uv[index * 2] = x / Math.max(1, width - 1);
      uv[index * 2 + 1] = z / Math.max(1, height - 1);
    }
  }

  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let cursor = 0;
  for (let z = 0; z < height - 1; ++z) {
    for (let x = 0; x < width - 1; ++x) {
      const a = z * width + x;
      const b = a + 1;
      const c = a + width;
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
  geometry.name = "Conserved heavy-liquid surface grid";
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("mercuryAgitation", new THREE.BufferAttribute(agitation, 1));
  geometry.setAttribute("mercuryCurvature", new THREE.BufferAttribute(curvature, 1));
  geometry.setAttribute("mercurySpeed", new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const value of Object.values(geometry.attributes)) {
    if (value !== geometry.getAttribute("uv")) value.setUsage(THREE.DynamicDrawUsage);
  }
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(-poolWidth * 0.51, -0.15, -poolDepth * 0.51),
    new THREE.Vector3(poolWidth * 0.51, 0.65, poolDepth * 0.51),
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0.15, 0),
    Math.hypot(poolWidth, poolDepth) * 0.58,
  );
  return {
    geometry,
    width,
    height,
    poolWidth,
    poolDepth,
    cellSizeX,
    cellSizeZ,
    originX,
    originZ,
  };
}

/**
 * Bind a MercuryPoolModel to one opaque, dynamic RTX-guide surface.
 */
export function createMercurySurface({ model, baseY = 0.075 } = {}) {
  if (!model) throw new Error("createMercurySurface requires a MercuryPoolModel.");
  const layout = createSurfaceGeometry(model);
  const material = createMercuryMaterial();
  const surface = new THREE.Mesh(layout.geometry, material);
  surface.name = "Mouse-weighted molten gold mercury pool";
  surface.frustumCulled = false;
  surface.castShadow = false;
  surface.receiveShadow = true;
  surface.renderOrder = 7;
  surface.userData.rtxIgnore = true;

  // A dark submerged body prevents grazing views from exposing an infinitely
  // thin sheet. The mirror-room lip occludes its top edge.
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    name: "Submerged liquid-metal body",
    color: 0x755018,
    metalness: 0.96,
    roughness: 0.14,
    side: THREE.DoubleSide,
  });
  bodyMaterial.userData.rtxIgnore = true;
  const bodyGeometry = new THREE.BoxGeometry(
    layout.poolWidth - layout.cellSizeX * 1.15,
    0.12,
    layout.poolDepth - layout.cellSizeZ * 1.15,
  );
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = "Opaque gold mercury volume beneath surface";
  body.position.y = baseY + 0.015;
  body.castShadow = false;
  body.receiveShadow = true;
  body.userData.rtxIgnore = true;

  const group = new THREE.Group();
  group.name = "Dynamic molten gold mercury assembly";
  group.userData.rtxIgnore = true;
  group.add(body, surface);

  const positionAttribute = layout.geometry.getAttribute("position");
  const normalAttribute = layout.geometry.getAttribute("normal");
  const agitationAttribute = layout.geometry.getAttribute("mercuryAgitation");
  const curvatureAttribute = layout.geometry.getAttribute("mercuryCurvature");
  const speedAttribute = layout.geometry.getAttribute("mercurySpeed");
  const positions = positionAttribute.array;
  const normals = normalAttribute.array;
  const heights = new Float64Array(layout.width * layout.height);
  // Native dynamic BLAS vertices are one rgba32float texel apiece. This stable
  // array is updated alongside the exact raster position attribute, so both
  // paths consume the same Float32 silhouette without a readback or resample.
  const rayPositions = new Float32Array(layout.width * layout.height * 4);
  for (let index = 0; index < layout.width * layout.height; ++index) {
    const positionOffset = index * 3;
    const rayOffset = index * 4;
    rayPositions[rayOffset] = positions[positionOffset];
    rayPositions[rayOffset + 2] = positions[positionOffset + 2];
    rayPositions[rayOffset + 3] = 1;
  }
  const rayMesh = Object.freeze({
    width: layout.width,
    height: layout.height,
    vertexCount: layout.width * layout.height,
    positions: rayPositions,
    indices: layout.geometry.getIndex().array,
    reflectionMaterial: Object.freeze({
      radiance: RTX_REFLECTION_RADIANCE,
      surface: RTX_REFLECTION_SURFACE,
    }),
  });
  let geometryTick = Number.NaN;
  let maximumSlope = 0;

  function update(seconds = model.elapsedSeconds ?? 0) {
    mercuryTime.value = finite(seconds, 0);
    const tick = Number(model.tick);
    if (Number.isFinite(tick) && tick === geometryTick) return false;
    const surfaceValues = model.surface ?? model.depth;
    const agitationValues = model.agitation;
    const curvatureValues = model.curvature;
    const velocityX = model.velocityX;
    const velocityZ = model.velocityZ;
    for (let index = 0; index < heights.length; ++index) {
      const height = baseY + finite(surfaceValues?.[index], 0.11);
      heights[index] = height;
      positions[index * 3 + 1] = height;
      rayPositions[index * 4 + 1] = height;
      agitationAttribute.array[index] = THREE.MathUtils.clamp(
        finite(agitationValues?.[index], 0),
        0,
        1,
      );
      curvatureAttribute.array[index] = THREE.MathUtils.clamp(
        finite(curvatureValues?.[index], 0),
        -1,
        1,
      );
      speedAttribute.array[index] = Math.hypot(
        finite(velocityX?.[index], 0),
        finite(velocityZ?.[index], 0),
      );
    }

    maximumSlope = 0;
    for (let z = 0; z < layout.height; ++z) {
      const beforeZ = Math.max(0, z - 1);
      const afterZ = Math.min(layout.height - 1, z + 1);
      for (let x = 0; x < layout.width; ++x) {
        const beforeX = Math.max(0, x - 1);
        const afterX = Math.min(layout.width - 1, x + 1);
        const index = z * layout.width + x;
        const dx = (heights[z * layout.width + afterX] - heights[z * layout.width + beforeX]) /
          Math.max(layout.cellSizeX, (afterX - beforeX) * layout.cellSizeX);
        const dz = (heights[afterZ * layout.width + x] - heights[beforeZ * layout.width + x]) /
          Math.max(layout.cellSizeZ, (afterZ - beforeZ) * layout.cellSizeZ);
        const inverseLength = 1 / Math.hypot(dx, 1, dz);
        const offset = index * 3;
        normals[offset] = -dx * inverseLength;
        normals[offset + 1] = inverseLength;
        normals[offset + 2] = -dz * inverseLength;
        maximumSlope = Math.max(maximumSlope, Math.hypot(dx, dz));
      }
    }
    for (const value of [
      positionAttribute,
      normalAttribute,
      agitationAttribute,
      curvatureAttribute,
      speedAttribute,
    ]) value.needsUpdate = true;
    geometryTick = tick;
    return true;
  }

  update(0);
  return {
    group,
    surface,
    body,
    material,
    layout: Object.freeze({
      width: layout.width,
      height: layout.height,
      poolWidth: layout.poolWidth,
      poolDepth: layout.poolDepth,
      cellSizeX: layout.cellSizeX,
      cellSizeZ: layout.cellSizeZ,
    }),
    update,
    rtxDynamicMesh: rayMesh,
    stats() {
      return {
        vertices: layout.width * layout.height,
        triangles: (layout.width - 1) * (layout.height - 1) * 2,
        maximumSlope,
        geometryTick,
        dynamicRayMesh: {
          vertices: rayMesh.vertexCount,
          triangles: rayMesh.indices.length / 3,
          textureWidth: rayMesh.width,
          textureHeight: rayMesh.height,
          simulationTick: geometryTick,
          exactRasterTopology: true,
        },
        silhouetteSource: "conservative-finite-volume-solver",
        microDetail: "normal-only-aperiodic-capillary-field",
      };
    },
    dispose() {
      group.removeFromParent();
      layout.geometry.dispose();
      material.dispose();
      bodyGeometry.dispose();
      bodyMaterial.dispose();
    },
  };
}

export default createMercurySurface;
