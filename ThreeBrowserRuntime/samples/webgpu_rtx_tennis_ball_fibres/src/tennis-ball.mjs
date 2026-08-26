import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraPosition,
  color,
  dot,
  float,
  length,
  mix,
  mx_fractal_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  uv,
  vec3,
} from "three/tsl";
import {
  fibreModelConstants,
  mulberry32,
  seamDistanceForNormal,
} from "./fibre-model.mjs";

export const STUDIO_ROOM_EXTENT = 36;
export const STUDIO_ROOM_TOP = 32;
export const STUDIO_TABLE_HEIGHT = -1.003;
export const KITCHEN_FLOOR_HEIGHT = -19;
export const KITCHEN_BENCH_HALF_X = 19;
export const KITCHEN_BENCH_HALF_Z = 10;

export function createSeamGeometry({
  radius = 0.9895,
  halfWidth = 0.039,
  edgeLift = 0.0022,
  segments = 640,
  crossSegments = 8,
} = {}) {
  const lanes = crossSegments + 1;
  const positions = new Float32Array((segments + 1) * lanes * 3);
  const uvs = new Float32Array((segments + 1) * lanes * 2);
  const indices = new Uint32Array(segments * crossSegments * 6);
  const radial = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const across = new THREE.Vector3();
  const left = new THREE.Vector3();

  for (let segment = 0; segment <= segments; ++segment) {
    const longitude = (segment / segments) * Math.PI * 2;
    const latitude = fibreModelConstants.seamAmplitude * Math.sin(longitude * 2);
    const latitudeDerivative = fibreModelConstants.seamAmplitude * 2 * Math.cos(longitude * 2);
    const cosLat = Math.cos(latitude);
    const sinLat = Math.sin(latitude);
    const cosLon = Math.cos(longitude);
    const sinLon = Math.sin(longitude);
    radial.set(cosLat * cosLon, sinLat, cosLat * sinLon).normalize();
    tangent.set(
      -cosLat * sinLon - sinLat * latitudeDerivative * cosLon,
      cosLat * latitudeDerivative,
      cosLat * cosLon - sinLat * latitudeDerivative * sinLon,
    ).normalize();
    across.crossVectors(tangent, radial).normalize();
    for (let lane = 0; lane < lanes; ++lane) {
      // Keep the lane order from +across to -across so triangle winding faces
      // outward. A raised edge and lower middle make the seam visibly inset.
      const q = 1 - 2 * (lane / crossSegments);
      const widthNoise = 1 + Math.sin(longitude * 37 + 0.7) * 0.028 +
        Math.sin(longitude * 91 - 1.3) * 0.013;
      const angularOffset = q * halfWidth * widthNoise;
      const poreRelief = Math.sin(longitude * 113 + q * 17) * 0.00016 *
        (1 - Math.pow(Math.abs(q), 1.4));
      const crossRadius = radius + edgeLift * Math.pow(Math.abs(q), 1.55) + poreRelief;
      const point = left.copy(radial).multiplyScalar(Math.cos(angularOffset))
        .addScaledVector(across, Math.sin(angularOffset))
        .normalize().multiplyScalar(crossRadius);
      const vertex = segment * lanes + lane;
      positions[vertex * 3] = point.x;
      positions[vertex * 3 + 1] = point.y;
      positions[vertex * 3 + 2] = point.z;
      uvs[vertex * 2] = segment / segments;
      uvs[vertex * 2 + 1] = lane / crossSegments;
    }

    if (segment < segments) {
      for (let lane = 0; lane < crossSegments; ++lane) {
        const index = (segment * crossSegments + lane) * 6;
        const base = segment * lanes + lane;
        indices[index] = base;
        indices[index + 1] = base + lanes;
        indices[index + 2] = base + lanes + 1;
        indices[index + 3] = base;
        indices[index + 4] = base + lanes + 1;
        indices[index + 5] = base + 1;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createDepressedBallGeometry({
  radius = 1,
  seamHalfWidth = 0.056,
  seamDepth = 0.0135,
  widthSegments = 256,
  heightSegments = 160,
} = {}) {
  const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);
  const positions = geometry.getAttribute("position");
  const normal = new THREE.Vector3();
  for (let vertex = 0; vertex < positions.count; ++vertex) {
    normal.fromBufferAttribute(positions, vertex).normalize();
    const distance = seamDistanceForNormal(normal.x, normal.y, normal.z);
    const normalized = THREE.MathUtils.clamp(distance / seamHalfWidth, 0, 1);
    const eased = normalized * normalized * (3 - 2 * normalized);
    const displacedRadius = radius - seamDepth * (1 - eased);
    const x = normal.x * displacedRadius;
    let y = normal.y * displacedRadius;
    const z = normal.z * displacedRadius;
    // A real ball settles by a fraction of a millimetre.  This tiny, smooth
    // contact flattening removes the mathematically-perfect hovering sphere
    // cue while the fibre layers supply the final compressed contact edge.
    if (y < -0.982) {
      const contact = THREE.MathUtils.clamp((-y - 0.982) / 0.018, 0, 1);
      const easedContact = contact * contact * (3 - 2 * contact);
      y = THREE.MathUtils.lerp(y, -0.9975, easedContact);
    }
    positions.setXYZ(vertex, x, y, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createGlobalUndercoatGeometry({
  count = 420_000,
  radius = 1.0012,
  seed = 0x51a7f311,
} = {}) {
  const verticesPerFibre = 5;
  const indicesPerFibre = 9;
  const positions = new Float32Array(count * verticesPerFibre * 3);
  const colors = new Float32Array(count * verticesPerFibre * 3);
  const indices = new Uint32Array(count * indicesPerFibre);
  const random = mulberry32(seed);
  const goldenAngle = fibreModelConstants.goldenAngle;
  const normal = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const bitangent = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const side = new THREE.Vector3();
  const root = new THREE.Vector3();
  const leftRoot = new THREE.Vector3();
  const rightRoot = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const leftMiddle = new THREE.Vector3();
  const rightMiddle = new THREE.Vector3();
  const tip = new THREE.Vector3();

  for (let fibre = 0; fibre < count; ++fibre) {
    const y = 1 - 2 * ((fibre + 0.5) / count);
    const radial = Math.sqrt(Math.max(0, 1 - y * y));
    const longitude = fibre * goldenAngle + (random() - 0.5) * 0.006;
    normal.set(Math.cos(longitude) * radial, y, Math.sin(longitude) * radial);
    if (Math.abs(normal.y) < 0.985) {
      tangent.set(-normal.z, 0, normal.x).normalize();
    } else {
      tangent.set(normal.y, -normal.x, 0).normalize();
    }
    bitangent.crossVectors(normal, tangent).normalize();
    const roll = random() * Math.PI * 2;
    direction.copy(tangent).multiplyScalar(Math.cos(roll))
      .addScaledVector(bitangent, Math.sin(roll)).normalize();
    side.crossVectors(normal, direction).normalize();

    const seamDistance = seamDistanceForNormal(normal.x, normal.y, normal.z);
    const seam = seamDistance < 0.061;
    const channel = 1 - THREE.MathUtils.smoothstep(seamDistance, 0, 0.075);
    let rootRadius = radius - channel * 0.0135;
    let length = 0.012 + Math.pow(random(), 1.55) * 0.027;
    if (random() > 0.985) length += 0.018 + random() * 0.025;
    if (seam) {
      // Keep fixed topology but bury the microscopic triangle below the
      // recessed adhesive. No undercoat strand is visible on the seam.
      rootRadius = 0.968;
      length = 0.00012;
    }
    const kind = random();
    let middleHeight = 0.16 + random() * 0.15;
    let tipHeight = 0.045 + random() * 0.12;
    let reach = 0.70 + random() * 0.27;
    let curl = (random() - 0.5) * 0.88;
    if (kind > 0.94) {
      middleHeight = 0.38 + random() * 0.20;
      tipHeight = 0.06 + random() * 0.16;
      reach = 0.62 + random() * 0.20;
      curl *= 1.35;
    }
    if (kind > 0.985) {
      middleHeight = 0.46 + random() * 0.18;
      tipHeight = 0.62 + random() * 0.20;
      reach = 0.38 + random() * 0.20;
      curl *= 0.72;
    }
    const width = seam ? 0.000012 : 0.00034 + random() * 0.00026;
    root.copy(normal).multiplyScalar(rootRadius);
    middle.copy(normal).multiplyScalar(rootRadius + length * middleHeight)
      .addScaledVector(direction, length * reach * 0.52)
      .addScaledVector(bitangent, length * curl * 0.28);
    tip.copy(normal).multiplyScalar(rootRadius + length * tipHeight)
      .addScaledVector(direction, length * reach)
      .addScaledVector(bitangent, length * curl);

    const shade = random();
    const baseColor = seam
      ? [0.43 + shade * 0.10, 0.44 + shade * 0.09, 0.34 + shade * 0.07]
      : [0.62 + shade * 0.13, 0.82 + shade * 0.14, 0.026 + shade * 0.036];
    leftRoot.copy(root).addScaledVector(side, -width);
    rightRoot.copy(root).addScaledVector(side, width);
    leftMiddle.copy(middle).addScaledVector(side, -width * 0.68);
    rightMiddle.copy(middle).addScaledVector(side, width * 0.68);
    // The table is the physical collision plane for the compressed underside
    // nap.  Clamping here avoids the thin global layer poking through the
    // reflector while retaining every fibre in the fixed topology.
    leftRoot.y = Math.max(leftRoot.y, -1.0016);
    rightRoot.y = Math.max(rightRoot.y, -1.0016);
    leftMiddle.y = Math.max(leftMiddle.y, -1.0016);
    rightMiddle.y = Math.max(rightMiddle.y, -1.0016);
    tip.y = Math.max(tip.y, -1.0016);
    for (let local = 0; local < verticesPerFibre; ++local) {
      const fibrePoint = local === 0 ? leftRoot
        : local === 1 ? rightRoot
          : local === 2 ? leftMiddle
            : local === 3 ? rightMiddle
              : tip;
      const vertex = fibre * verticesPerFibre + local;
      positions[vertex * 3] = fibrePoint.x;
      positions[vertex * 3 + 1] = fibrePoint.y;
      positions[vertex * 3 + 2] = fibrePoint.z;
      const lift = local === 4 ? 1.09 : local >= 2 ? 1.0 : 0.86;
      colors[vertex * 3] = baseColor[0] * lift;
      colors[vertex * 3 + 1] = baseColor[1] * lift;
      colors[vertex * 3 + 2] = baseColor[2] * lift;
    }
    const vertexBase = fibre * verticesPerFibre;
    const indexBase = fibre * indicesPerFibre;
    indices[indexBase] = vertexBase;
    indices[indexBase + 1] = vertexBase + 2;
    indices[indexBase + 2] = vertexBase + 3;
    indices[indexBase + 3] = vertexBase;
    indices[indexBase + 4] = vertexBase + 3;
    indices[indexBase + 5] = vertexBase + 1;
    indices[indexBase + 6] = vertexBase + 2;
    indices[indexBase + 7] = vertexBase + 4;
    indices[indexBase + 8] = vertexBase + 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createProceduralFeltMaterial() {
  const broad = mx_fractal_noise_float(
    positionLocal.mul(vec3(13.0, 11.0, 15.0)), 4, 2.07, 0.51,
  ).mul(0.5).add(0.5);
  const nap = mx_fractal_noise_float(
    positionLocal.add(vec3(3.7, -2.1, 5.9)).mul(vec3(185.0, 171.0, 193.0)),
    3, 2.11, 0.48,
  ).mul(0.5).add(0.5);
  const micro = mx_fractal_noise_float(
    positionLocal.add(vec3(-7.3, 4.9, 2.8)).mul(vec3(920.0, 1040.0, 870.0)),
    2, 2.17, 0.47,
  ).mul(0.5).add(0.5);
  const pore = smoothstep(0.67, 0.91, nap.mul(0.63).add(micro.mul(0.37)));
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Procedural compressed optic-yellow felt backing",
    color: 0xa9cf24,
    roughness: 0.9,
    metalness: 0,
    sheen: 0.74,
    sheenColor: new THREE.Color(0xdaf06a),
    sheenRoughness: 0.88,
    clearcoat: 0,
  });
  // Keep broad value variation restrained.  Large albedo blobs read as moss
  // at product distance; real tennis felt gets most of its variation from the
  // dense nap and grazing sheen.
  const feltVariation = broad.mul(0.16).add(nap.mul(0.12)).add(0.42);
  material.colorNode = mix(color(0x7d9e08), color(0xc8ed27), feltVariation)
    .mul(float(1).sub(pore.mul(0.08)))
    .mul(micro.mul(0.035).add(0.982));
  material.normalNode = bumpMap(
    broad.mul(0.0015).add(nap.mul(0.0012)).add(micro.mul(0.00045)),
    0.035,
  );
  material.roughnessNode = mix(float(0.84), float(0.95), nap.mul(0.65).add(pore.mul(0.35)));
  return material;
}

function createProceduralSeamMaterial() {
  const grain = mx_fractal_noise_float(
    positionLocal.add(vec3(1.3, 8.7, -3.2)).mul(vec3(510.0, 760.0, 530.0)),
    3, 2.08, 0.49,
  ).mul(0.5).add(0.5);
  const pores = smoothstep(0.62, 0.88, mx_fractal_noise_float(
    positionLocal.mul(vec3(1450.0, 1320.0, 1510.0)), 2, 2.13, 0.47,
  ).mul(0.5).add(0.5));
  const across = abs(uv().y.sub(0.5)).mul(2);
  const edgeShade = smoothstep(0.70, 0.98, across);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Porous recessed tennis seam",
    color: 0x96988e,
    roughness: 0.98,
    metalness: 0,
    sheen: 0.26,
    sheenColor: new THREE.Color(0xc7c8b7),
    sheenRoughness: 0.94,
    side: THREE.DoubleSide,
  });
  const seamBody = mix(color(0xaaa79a), color(0xdad5c4), grain)
    .mul(float(1).sub(pores.mul(0.22)));
  material.colorNode = mix(seamBody, color(0x77766a), edgeShade.mul(0.28));
  material.normalNode = bumpMap(grain.mul(0.0014).add(pores.mul(0.0011)), 0.026);
  material.roughnessNode = mix(float(0.89), float(1.0), pores);
  return material;
}

function createReflectiveTableMaterial() {
  const broad = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.48, 0.08, 0.53)), 4, 2.07, 0.51,
  ).mul(0.5).add(0.5);
  const polish = mx_fractal_noise_float(
    positionWorld.add(vec3(5.7, 0, -3.1)).mul(vec3(8.2, 0.12, 7.6)),
    3, 2.13, 0.47,
  ).mul(0.5).add(0.5);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Stable clear-coated black quartz kitchen bench",
    color: 0x111713,
    roughness: 0.14,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.10,
    ior: 1.52,
    specularIntensity: 1,
  });
  material.colorNode = mix(color(0x0b100d), color(0x27312b), broad.mul(0.58));
  material.normalNode = bumpMap(broad.mul(0.0014).add(polish.mul(0.00042)), 0.012);
  material.roughnessNode = mix(float(0.095), float(0.18), polish);
  // Physical clearcoat + the HDR kitchen environment provides stable glossy
  // highlights without a second camera/render target. The former planar
  // reflector fed the native RTX composite recursively and flashed as its
  // offscreen target resized or crossed thin coplanar kitchen geometry.
  return material;
}

function createCheckerFloorGeometry({ extent = STUDIO_ROOM_EXTENT, tiles = 16 } = {}) {
  const tileSpan = (extent * 2) / tiles;
  // Keep the checker as one contiguous depth surface. The previous inset
  // exposed a second full-size grout plane only 0.012 units below; in a wide
  // room view that separation fell below one depth-buffer ULP and alternated
  // by scanline. Vertex colors retain the physical black/ivory tile layout
  // without any overlapping raster surface.
  const inset = 0;
  const verticesPerTile = 4;
  const positions = new Float32Array(tiles * tiles * verticesPerTile * 3);
  const normals = new Float32Array(positions.length);
  const colors = new Float32Array(positions.length);
  const indices = new Uint32Array(tiles * tiles * 6);
  const ivory = new THREE.Color(0xe8e2d4);
  const charcoal = new THREE.Color(0x151918);
  let vertexCursor = 0;
  let indexCursor = 0;
  for (let row = 0; row < tiles; ++row) {
    for (let column = 0; column < tiles; ++column) {
      const x0 = -extent + column * tileSpan + inset;
      const x1 = -extent + (column + 1) * tileSpan - inset;
      const z0 = -extent + row * tileSpan + inset;
      const z1 = -extent + (row + 1) * tileSpan - inset;
      const baseVertex = vertexCursor / 3;
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
        positions[vertexCursor] = x;
        positions[vertexCursor + 1] = 0;
        positions[vertexCursor + 2] = z;
        normals[vertexCursor + 1] = 1;
        const tileColor = (row + column) % 2 === 0 ? ivory : charcoal;
        colors[vertexCursor] = tileColor.r;
        colors[vertexCursor + 1] = tileColor.g;
        colors[vertexCursor + 2] = tileColor.b;
        vertexCursor += 3;
      }
      indices.set([
        baseVertex, baseVertex + 2, baseVertex + 1,
        baseVertex, baseVertex + 3, baseVertex + 2,
      ], indexCursor);
      indexCursor += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function createStudioRoom(scene) {
  const room = new THREE.Group();
  room.name = "Complete procedural kitchen room";
  scene.add(room);

  const wallNoise = mx_fractal_noise_float(
    positionWorld.add(vec3(2.7, -1.1, 4.3)).mul(vec3(0.16, 0.21, 0.18)),
    4,
    2.03,
    0.52,
  ).mul(0.5).add(0.5);
  const wallGrain = mx_fractal_noise_float(
    positionWorld.add(vec3(-1.8, 3.2, 0.7)).mul(vec3(8.4, 9.2, 8.7)),
    3,
    2.11,
    0.48,
  ).mul(0.5).add(0.5);
  const wallMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Smoky blue hand-trowelled kitchen plaster",
    color: 0x879695,
    roughness: 0.89,
    metalness: 0,
    clearcoat: 0.02,
    clearcoatRoughness: 0.90,
    side: THREE.DoubleSide,
  });
  // Real trowelled plaster varies by only a few percent at room scale. The
  // former full-range cloudy noise made the walls read as an oversized rock.
  wallMaterial.colorNode = mix(
    color(0x758889),
    color(0xaab5b1),
    wallNoise.mul(0.20).add(0.39),
  ).mul(wallGrain.mul(0.026).add(0.982));
  wallMaterial.normalNode = bumpMap(
    wallNoise.mul(0.0018).add(wallGrain.mul(0.00042)),
    0.016,
  );
  wallMaterial.roughnessNode = mix(float(0.86), float(0.93), wallNoise);

  const roomExtent = STUDIO_ROOM_EXTENT;
  const roomBottom = KITCHEN_FLOOR_HEIGHT;
  const roomTop = STUDIO_ROOM_TOP;
  const roomHeight = roomTop - roomBottom;
  const roomCentreY = (roomTop + roomBottom) * 0.5;
  const wallGeometry = new THREE.PlaneGeometry(roomExtent * 2, roomHeight, 1, 1);
  const sideGeometry = new THREE.PlaneGeometry(roomExtent * 2, roomHeight, 1, 1);
  const ceilingGeometry = new THREE.PlaneGeometry(roomExtent * 2, roomExtent * 2, 1, 1);
  const roomSurfaces = [];

  const back = new THREE.Mesh(wallGeometry, wallMaterial);
  back.name = "Kitchen rear wall";
  back.position.set(0, roomCentreY, -roomExtent);
  const front = new THREE.Mesh(wallGeometry, wallMaterial);
  front.name = "Kitchen front wall";
  front.position.set(0, roomCentreY, roomExtent);
  front.rotation.y = Math.PI;
  const right = new THREE.Mesh(sideGeometry, wallMaterial);
  right.name = "Kitchen right wall";
  right.position.set(roomExtent, roomCentreY, 0);
  right.rotation.y = -Math.PI * 0.5;
  const ceiling = new THREE.Mesh(ceilingGeometry, wallMaterial);
  ceiling.name = "Kitchen ceiling";
  ceiling.position.set(0, roomTop, 0);
  ceiling.rotation.x = Math.PI * 0.5;
  // A true 18 x 14 aperture is cut into the left wall. Four wall panels leave
  // real depth through to the layered exterior instead of painting blue over
  // an opaque wall.
  const leftWindowParts = [];
  for (const [width, height, centreY, centreZ, name] of [
    [72, 23, -7.5, 0, "Left wall below the window"],
    [72, 14, 25, 0, "Left wall above the window"],
    [16, 14, 11, -28, "Left wall behind the window"],
    [38, 14, 11, 17, "Left wall ahead of the window"],
  ]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 1), wallMaterial);
    panel.name = name;
    panel.position.set(-roomExtent, centreY, centreZ);
    panel.rotation.y = Math.PI * 0.5;
    leftWindowParts.push(panel);
  }
  for (const surface of [back, front, ...leftWindowParts, right, ceiling]) {
    surface.receiveShadow = true;
    room.add(surface);
    roomSurfaces.push(surface);
  }

  const staticMeshes = [];
  const addKitchenMesh = ({
    geometry,
    material,
    position,
    rotation = [0, 0, 0],
    name,
    castShadow = true,
    receiveShadow = true,
  }) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    room.add(mesh);
    staticMeshes.push(mesh);
    return mesh;
  };

  const cabinetMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Satin sage kitchen cabinetry",
    color: 0x526557,
    roughness: 0.62,
    metalness: 0.02,
    clearcoat: 0.10,
    clearcoatRoughness: 0.58,
  });
  const cabinetPaintVariation = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.72, 0.18, 0.72)),
    3,
    2.13,
    0.49,
  ).mul(0.5).add(0.5);
  cabinetMaterial.colorNode = mix(
    color(0x435448),
    color(0x697969),
    cabinetPaintVariation.mul(0.42).add(0.30),
  );
  cabinetMaterial.normalNode = bumpMap(cabinetPaintVariation.mul(0.0018), 0.018);
  const cabinetFrontMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Warm ivory shaker cabinet fronts",
    color: 0xcfc9b8,
    roughness: 0.68,
    metalness: 0,
    clearcoat: 0.06,
    clearcoatRoughness: 0.62,
  });
  const frontPaintVariation = mx_fractal_noise_float(
    positionWorld.add(vec3(5.3, 1.7, -2.1)).mul(vec3(0.38, 0.92, 0.38)),
    3,
    2.01,
    0.46,
  ).mul(0.5).add(0.5);
  cabinetFrontMaterial.colorNode = mix(
    color(0xbdb5a1),
    color(0xe3decd),
    frontPaintVariation.mul(0.24).add(0.42),
  );
  cabinetFrontMaterial.normalNode = bumpMap(frontPaintVariation.mul(0.0012), 0.012);
  const stainlessMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Brushed kitchen stainless steel",
    color: 0x8b9492,
    roughness: 0.30,
    metalness: 0.88,
    clearcoat: 0.18,
    clearcoatRoughness: 0.26,
  });
  const darkApplianceMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Black glass kitchen appliance",
    color: 0x090d0c,
    roughness: 0.12,
    metalness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
  const tileMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Handmade warm ceramic backsplash",
    color: 0xd8d0bc,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.52,
    clearcoatRoughness: 0.20,
  });
  const groutMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Recessed kitchen tile grout",
    color: 0x6e6b62,
    roughness: 0.96,
    metalness: 0,
  });
  const woodMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Oiled oak kitchen board",
    color: 0x8b5f36,
    roughness: 0.48,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.42,
  });
  const porcelainMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Warm glazed kitchen porcelain",
    color: 0xe0dbce,
    roughness: 0.24,
    metalness: 0,
    clearcoat: 0.74,
    clearcoatRoughness: 0.18,
  });
  const terracottaMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Hand-thrown terracotta kitchen pottery",
    color: 0x9a6245,
    roughness: 0.82,
    metalness: 0,
  });
  const warmWoodMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Warm solid oak architectural trim",
    color: 0x765138,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.48,
  });
  const kitchenFloorMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Black and ivory checkerboard ceramic tiles",
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.43,
    metalness: 0.01,
    clearcoat: 0.18,
    clearcoatRoughness: 0.36,
  });
  const rearCounterMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Honed charcoal rear kitchen worktop",
    color: 0x202522,
    roughness: 0.36,
    metalness: 0.03,
    clearcoat: 0.34,
    clearcoatRoughness: 0.31,
  });
  const rearStoneNoise = mx_fractal_noise_float(
    positionWorld.add(vec3(-3.1, 0.4, 2.8)).mul(vec3(1.8, 4.0, 1.8)),
    4,
    2.07,
    0.50,
  ).mul(0.5).add(0.5);
  rearCounterMaterial.colorNode = mix(
    color(0x171b19),
    color(0x3a403b),
    rearStoneNoise.mul(0.36).add(0.21),
  );
  rearCounterMaterial.normalNode = bumpMap(rearStoneNoise.mul(0.0020), 0.020);
  addKitchenMesh({
    geometry: createCheckerFloorGeometry({ extent: roomExtent, tiles: 16 }),
    material: kitchenFloorMaterial,
    position: [0, KITCHEN_FLOOR_HEIGHT + 0.012, 0],
    name: "Complete black and ivory checkerboard kitchen floor",
    // A room floor should receive cabinet/ball shadows, but contributing the
    // huge coplanar tile surface to both shadow maps only creates self-acne.
    castShadow: false,
  });

  // Continuous skirting and ceiling cornice make the shell read as a compact,
  // finished room in wide orbits instead of an empty studio box.
  for (const [position, size, name] of [
    [[0, KITCHEN_FLOOR_HEIGHT + 0.72, -35.70], [71.4, 1.30, 0.38], "Rear wall painted skirting"],
    [[0, KITCHEN_FLOOR_HEIGHT + 0.72, 35.70], [71.4, 1.30, 0.38], "Front wall painted skirting"],
    [[-35.70, KITCHEN_FLOOR_HEIGHT + 0.72, 0], [0.38, 1.30, 71.4], "Left wall painted skirting"],
    [[35.70, KITCHEN_FLOOR_HEIGHT + 0.72, 0], [0.38, 1.30, 71.4], "Right wall painted skirting"],
    [[0, STUDIO_ROOM_TOP - 0.58, -35.58], [71.2, 0.72, 0.55], "Rear ceiling cornice"],
    [[0, STUDIO_ROOM_TOP - 0.58, 35.58], [71.2, 0.72, 0.55], "Front ceiling cornice"],
    [[-35.58, STUDIO_ROOM_TOP - 0.58, 0], [0.55, 0.72, 71.2], "Left ceiling cornice"],
    [[35.58, STUDIO_ROOM_TOP - 0.58, 0], [0.55, 0.72, 71.2], "Right ceiling cornice"],
  ]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(...size),
      material: cabinetFrontMaterial,
      position,
      name,
    });
  }

  // Rear counter carcass and doors establish the countertop as a kitchen
  // bench rather than an abstract floor plane.
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(51.5, 17.2, 7.0),
    material: cabinetMaterial,
    position: [-4.75, -9.65, -32.5],
    name: "Continuous rear kitchen base cabinets",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(52.5, 0.64, 8.0),
    material: rearCounterMaterial,
    position: [-4.25, -0.68, -32.0],
    name: "Continuous honed rear kitchen worktop",
  });
  for (let door = 0; door < 5; ++door) {
    const x = -25.0 + door * 10.0;
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(9.2, 15.7, 0.30),
      material: cabinetFrontMaterial,
      position: [x, -9.25, -28.83],
      name: "Shaker lower cabinet door",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.082, 0.082, 2.8, 16),
      material: stainlessMaterial,
      position: [x + 3.35, -4.80, -28.62],
      name: "Lower cabinet handle",
    });
  }

  // Toe kicks, a narrow crown, and a slim shadow line stop the cabinetry from
  // reading as oversized floating boxes when the camera is down at ball level.
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(50.7, 1.15, 0.95),
    material: darkApplianceMaterial,
    position: [-4.75, KITCHEN_FLOOR_HEIGHT + 0.62, -29.45],
    name: "Recessed rear cabinet toe kick",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(52.5, 0.18, 0.32),
    material: stainlessMaterial,
    position: [-4.25, -1.08, -28.72],
    name: "Rear worktop brushed metal reveal",
  });

  // The inset rails and stiles give the large front faces real Shaker depth.
  for (let door = 0; door < 5; ++door) {
    const x = -25.0 + door * 10.0;
    for (const [dx, dy, sx, sy, label] of [
      [-4.18, 0, 0.24, 14.6, "left stile"],
      [4.18, 0, 0.24, 14.6, "right stile"],
      [0, 6.72, 8.1, 0.24, "top rail"],
      [0, -6.72, 8.1, 0.24, "bottom rail"],
    ]) {
      addKitchenMesh({
        geometry: new THREE.BoxGeometry(sx, sy, 0.12),
        material: cabinetFrontMaterial,
        position: [x + dx, -9.25 + dy, -28.62],
        name: `Rear shaker door ${label}`,
      });
    }
  }

  addKitchenMesh({
    geometry: new THREE.PlaneGeometry(59, 9.2),
    material: tileMaterial,
    position: [0, 3.7, -35.86],
    name: "Ceramic tiled kitchen backsplash",
    castShadow: false,
  });
  for (let column = -6; column <= 6; ++column) {
    addKitchenMesh({
      geometry: new THREE.PlaneGeometry(0.075, 9.1),
      material: groutMaterial,
      position: [column * 4.45, 3.7, -35.82],
      name: "Vertical backsplash grout joint",
      castShadow: false,
    });
  }
  for (const y of [0.7, 3.7, 6.7]) {
    addKitchenMesh({
      geometry: new THREE.PlaneGeometry(58.9, 0.075),
      material: groutMaterial,
      position: [0, y, -35.81],
      name: "Horizontal backsplash grout joint",
      castShadow: false,
    });
  }

  for (const x of [-23.0, -12.7, -2.4]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(9.5, 15.2, 4.0),
      material: cabinetMaterial,
      position: [x, 16.0, -33.7],
      name: "Upper kitchen cabinet carcass",
    });
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(8.95, 14.5, 0.26),
      material: cabinetFrontMaterial,
      position: [x, 16.0, -31.55],
      name: "Upper shaker cabinet door",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.075, 0.075, 2.6, 16),
      material: stainlessMaterial,
      position: [x + 3.3, 13.1, -31.34],
      name: "Upper cabinet handle",
    });
    for (const [dx, dy, sx, sy, label] of [
      [-4.02, 0, 0.22, 13.4, "left stile"],
      [4.02, 0, 0.22, 13.4, "right stile"],
      [0, 6.15, 7.9, 0.22, "top rail"],
      [0, -6.15, 7.9, 0.22, "bottom rail"],
    ]) {
      addKitchenMesh({
        geometry: new THREE.BoxGeometry(sx, sy, 0.11),
        material: cabinetFrontMaterial,
        position: [x + dx, 16.0 + dy, -31.34],
        name: `Upper shaker door ${label}`,
      });
    }
  }

  addKitchenMesh({
    geometry: new THREE.BoxGeometry(31.0, 1.6, 4.25),
    material: cabinetMaterial,
    position: [-12.7, 24.35, -33.70],
    name: "Built-in bulkhead above the upper cabinets",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(31.4, 0.28, 0.30),
    material: cabinetFrontMaterial,
    position: [-12.7, 23.55, -31.46],
    name: "Upper cabinet crown moulding",
  });

  addKitchenMesh({
    geometry: new THREE.BoxGeometry(10.0, 42.0, 7.0),
    material: stainlessMaterial,
    position: [27.0, 2.0, -32.5],
    name: "Full-height stainless refrigerator",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(9.45, 0.12, 0.24),
    material: darkApplianceMaterial,
    position: [27.0, 3.8, -28.85],
    name: "Refrigerator door division shadow",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(2.6, 3.2, 0.28),
    material: darkApplianceMaterial,
    position: [24.7, 2.6, -28.70],
    name: "Refrigerator chilled-water dispenser",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(0.18, 13.5, 0.24),
    material: darkApplianceMaterial,
    position: [23.2, 9.2, -28.60],
    name: "Refrigerator pull handle",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(8.8, 3.5, 4.4),
    material: stainlessMaterial,
    position: [10.0, 11.3, -33.0],
    name: "Brushed steel range hood",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(3.6, 15.6, 2.5),
    material: stainlessMaterial,
    position: [10.0, 20.0, -34.0],
    name: "Range hood chimney",
  });

  // Real left-wall window: a deep painted reveal surrounds a lightly glazed
  // opening. The view beyond is several metres deep and uses separated sky,
  // cloud, hill and house layers, so orbiting produces visible parallax.
  for (const [position, size, name] of [
    [[-35.60, 18.30, -11.0], [0.80, 0.65, 19.0], "Window top reveal"],
    [[-35.60, 3.70, -11.0], [0.80, 0.65, 19.0], "Deep kitchen window sill"],
    [[-35.60, 11.0, -20.30], [0.80, 14.6, 0.65], "Rear window reveal"],
    [[-35.60, 11.0, -1.70], [0.80, 14.6, 0.65], "Front window reveal"],
    [[-35.43, 11.0, -11.0], [0.48, 14.0, 0.34], "Window centre mullion"],
    [[-35.43, 11.0, -11.0], [0.48, 0.34, 18.0], "Window centre transom"],
  ]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(...size),
      material: cabinetFrontMaterial,
      position,
      name,
    });
  }

  const addExteriorMesh = (mesh) => {
    mesh.userData.rtxIgnore = true;
    room.add(mesh);
    return mesh;
  };
  const skyMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Natural daylight exterior sky gradient",
    color: 0x83b7d5,
    side: THREE.DoubleSide,
    fog: false,
  });
  skyMaterial.toneMapped = false;
  skyMaterial.colorNode = mix(
    color(0xeed4b7),
    color(0x669fc9),
    smoothstep(-18, 18, positionLocal.y),
  );
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(66, 52), skyMaterial);
  sky.name = "Deep daylight sky beyond the kitchen window";
  sky.position.set(-72.0, 12.0, -11.0);
  sky.rotation.y = Math.PI * 0.5;
  addExteriorMesh(sky);

  const outdoorGroundMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Mown exterior garden lawn",
    color: 0x405d3b,
    roughness: 0.98,
    metalness: 0,
  });
  const lawnVariation = mx_fractal_noise_float(
    positionWorld.mul(vec3(0.32, 1.2, 0.32)),
    4,
    2.08,
    0.50,
  ).mul(0.5).add(0.5);
  outdoorGroundMaterial.colorNode = mix(
    color(0x2b4430),
    color(0x6f8250),
    lawnVariation.mul(0.52).add(0.18),
  );
  const outdoorGround = new THREE.Mesh(
    // Keep the lawn wholly beyond the exterior face of the left wall.  The
    // previous 70-unit X span reached from x=-87 to x=-17, so half of this
    // outdoor plane visibly sliced through the kitchen at y=1.
    new THREE.PlaneGeometry(28, 60),
    outdoorGroundMaterial,
  );
  outdoorGround.name = "Deep exterior lawn perspective plane";
  outdoorGround.position.set(-51.5, 1.0, -11.0);
  outdoorGround.rotation.x = -Math.PI * 0.5;
  addExteriorMesh(outdoorGround);

  const hillMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Atmospheric blue-green distant hills",
    color: 0x426a67,
    roughness: 1,
    metalness: 0,
  });
  for (const [x, y, z, scale] of [
    [-67.0, 1.8, -25.0, [3.0, 7.2, 15.0]],
    [-66.0, 0.8, -9.0, [2.7, 8.4, 18.0]],
    [-64.0, 1.5, 8.0, [2.2, 6.7, 13.0]],
  ]) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), hillMaterial);
    hill.name = "Far layered exterior hill";
    hill.position.set(x, y, z);
    hill.scale.set(...scale);
    addExteriorMesh(hill);
  }

  const exteriorHouseMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Sun-warmed rendered neighbouring house",
    color: 0xc3a482,
    roughness: 0.83,
    metalness: 0,
  });
  const exteriorRoofMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered charcoal neighbouring roof",
    color: 0x30383b,
    roughness: 0.82,
    metalness: 0.02,
  });
  const exteriorWindowMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Warm neighbouring window glow",
    color: new THREE.Color(0xffd394).multiplyScalar(1.1),
    fog: false,
  });
  exteriorWindowMaterial.toneMapped = false;
  for (const [x, y, z, width] of [
    [-57.5, 5.6, -18.0, 8.2],
    [-61.0, 5.0, -4.2, 10.0],
  ]) {
    const house = new THREE.Mesh(new THREE.BoxGeometry(4.8, 8.0, width), exteriorHouseMaterial);
    house.name = "Parallax neighbouring house volume";
    house.position.set(x, y, z);
    addExteriorMesh(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(width * 0.72, 3.0, 4), exteriorRoofMaterial);
    roof.name = "Parallax neighbouring pitched roof";
    roof.position.set(x + 0.1, y + 5.3, z);
    roof.rotation.y = Math.PI * 0.25;
    roof.scale.x = 0.38;
    addExteriorMesh(roof);
    for (const windowZ of [-width * 0.24, width * 0.24]) {
      const neighbourWindow = new THREE.Mesh(
        new THREE.PlaneGeometry(1.7, 2.5),
        exteriorWindowMaterial,
      );
      neighbourWindow.name = "Warm lit neighbouring house window";
      neighbourWindow.position.set(x + 2.43, y + 0.5, z + windowZ);
      neighbourWindow.rotation.y = Math.PI * 0.5;
      addExteriorMesh(neighbourWindow);
    }
  }

  const fenceMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered cedar garden fence",
    color: 0x8a6c4f,
    roughness: 0.92,
    metalness: 0,
  });
  for (let slat = 0; slat < 15; ++slat) {
    const z = -24.0 + slat * 1.85;
    const fenceSlat = new THREE.Mesh(new THREE.BoxGeometry(0.28, 5.1, 1.55), fenceMaterial);
    fenceSlat.name = "Individual parallax cedar fence slat";
    fenceSlat.position.set(-46.5, 3.5 + Math.sin(slat * 2.1) * 0.08, z);
    addExteriorMesh(fenceSlat);
  }
  for (const y of [2.25, 4.75]) {
    const fenceRail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 29.0), fenceMaterial);
    fenceRail.name = "Garden fence horizontal rail";
    fenceRail.position.set(-46.25, y, -11.0);
    addExteriorMesh(fenceRail);
  }

  const treeTrunkMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Natural exterior tree bark",
    color: 0x554336,
    roughness: 0.98,
    metalness: 0,
  });
  const treeLeafMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Layered exterior tree foliage",
    color: 0x456646,
    roughness: 0.95,
    metalness: 0,
  });
  for (const [x, z, height, canopyScale] of [
    [-50.0, -22.0, 10.5, 1.15],
    [-52.5, 1.0, 12.0, 1.38],
  ]) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.70, height, 10),
      treeTrunkMaterial,
    );
    trunk.name = "Exterior tree trunk with perspective depth";
    trunk.position.set(x, 1.0 + height * 0.5, z);
    addExteriorMesh(trunk);
    for (const [dy, dz, scale] of [
      [height * 0.78, 0, 3.2],
      [height * 0.96, -1.9, 2.6],
      [height * 0.94, 2.0, 2.9],
    ]) {
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), treeLeafMaterial);
      canopy.name = "Clustered exterior tree canopy";
      canopy.position.set(x, 1.0 + dy, z + dz);
      canopy.scale.set(scale * 0.78 * canopyScale, scale * canopyScale, scale * canopyScale);
      addExteriorMesh(canopy);
    }
  }

  const shrubMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Dense garden shrub foliage",
    color: 0x54744b,
    roughness: 0.98,
    metalness: 0,
  });
  for (let shrubIndex = 0; shrubIndex < 7; ++shrubIndex) {
    const shrub = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), shrubMaterial);
    shrub.name = "Foreground exterior garden shrub";
    shrub.position.set(-43.5 - (shrubIndex % 2) * 0.7, 2.1, -22.0 + shrubIndex * 3.7);
    shrub.scale.set(1.25, 1.55 + (shrubIndex % 3) * 0.18, 1.7);
    addExteriorMesh(shrub);
  }

  const cloudMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Soft exterior cloud",
    color: new THREE.Color(0xe9eff0).multiplyScalar(1.15),
    fog: false,
  });
  cloudMaterial.toneMapped = false;
  for (const [x, y, z, sx] of [
    [-69.5, 21.0, -20.5, 3.2],
    [-68.0, 17.5, 1.5, 2.3],
  ]) {
    const cloud = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), cloudMaterial);
    cloud.name = "Distant layered exterior cloud";
    cloud.position.set(x, y, z);
    cloud.scale.set(0.65, 0.72, sx);
    addExteriorMesh(cloud);
  }
  const sunMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Exterior low sun",
    color: new THREE.Color(0xffd79e).multiplyScalar(1.55),
    side: THREE.DoubleSide,
    fog: false,
  });
  sunMaterial.toneMapped = false;
  const sun = new THREE.Mesh(new THREE.CircleGeometry(2.1, 48), sunMaterial);
  sun.name = "Exterior low daylight sun disc";
  sun.position.set(-71.5, 21.5, -23.0);
  sun.rotation.y = Math.PI * 0.5;
  addExteriorMesh(sun);

  const glassMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Subtle kitchen window glass",
    color: 0xb9d3df,
    roughness: 0.08,
    metalness: 0,
    transmission: 0.18,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(18.0, 14.0), glassMaterial);
  glass.name = "Thin window glazing over the 3D exterior";
  glass.position.set(-35.82, 11.0, -11.0);
  glass.rotation.y = Math.PI * 0.5;
  addExteriorMesh(glass);

  // Small sill plants and the window latch establish the near-plane scale
  // while leaving most of the layered outside view unobstructed.
  for (const [z, scale] of [[-16.8, 0.86], [-5.3, 0.72]]) {
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.78 * scale, 0.58 * scale, 1.45 * scale, 18),
      material: terracottaMaterial,
      position: [-35.0, 4.72, z],
      name: "Terracotta herb pot on the window sill",
    });
    for (let leafIndex = 0; leafIndex < 6; ++leafIndex) {
      const angle = leafIndex * Math.PI * 0.333 + 0.25;
      addKitchenMesh({
        geometry: new THREE.SphereGeometry(0.48 * scale, 12, 8),
        material: outdoorGroundMaterial,
        position: [
          -34.95 + Math.sin(angle) * 0.30 * scale,
          5.72 + (leafIndex % 3) * 0.30 * scale,
          z + Math.cos(angle) * 0.50 * scale,
        ],
        name: "Kitchen-window culinary herb leaf cluster",
      });
    }
  }
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(0.22, 1.35, 0.38),
    material: stainlessMaterial,
    position: [-35.12, 10.9, -10.70],
    rotation: [Math.PI * 0.5, 0, 0],
    name: "Brushed window casement latch",
  });

  // A full-height L-counter sits below the left window. Its quartz top and
  // cabinet carcass are split around the opening, making the stainless basin
  // genuinely recessed rather than a decal or plate on top of the worktop.
  for (const [position, size, name] of [
    [[-32.75, -9.65, -21.60], [6.5, 17.2, 10.8], "Rear left-counter cabinet bank"],
    [[-32.75, -9.65, 0.10], [6.5, 17.2, 11.8], "Front left-counter cabinet bank"],
  ]) {
    addKitchenMesh({ geometry: new THREE.BoxGeometry(...size), material: cabinetMaterial, position, name });
  }
  for (const [position, size, name] of [
    [[-35.65, -0.68, -10.5], [0.70, 0.64, 33.0], "Window-side worktop strip"],
    [[-29.10, -0.68, -10.5], [1.20, 0.64, 33.0], "Room-side worktop strip"],
    [[-32.50, -0.68, -21.6], [5.60, 0.64, 10.8], "Rear worktop bridge around sink"],
    [[-32.50, -0.68, 0.10], [5.60, 0.64, 11.8], "Front worktop bridge around sink"],
  ]) {
    addKitchenMesh({ geometry: new THREE.BoxGeometry(...size), material: rearCounterMaterial, position, name });
  }
  for (const [z, length] of [[-21.6, 10.0], [0.1, 11.0]]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(0.28, 15.7, length),
      material: cabinetFrontMaterial,
      position: [-29.36, -9.25, z],
      name: "Left-counter shaker cabinet front",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.082, 0.082, 2.8, 16),
      material: stainlessMaterial,
      position: [-29.17, -4.80, z + length * 0.28],
      name: "Left-counter cabinet handle",
    });
  }
  for (const [z, length] of [[-21.6, 10.0], [0.1, 11.0]]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(0.44, 1.15, length - 0.40),
      material: darkApplianceMaterial,
      position: [-29.48, KITCHEN_FLOOR_HEIGHT + 0.62, z],
      name: "Recessed left-counter toe kick",
    });
  }

  for (const [position, size, name] of [
    [[-32.50, -3.00, -11.0], [5.18, 0.18, 9.55], "Deep stainless sink basin bottom"],
    [[-35.15, -1.67, -11.0], [0.18, 2.60, 9.85], "Sink basin window-side wall"],
    [[-29.85, -1.67, -11.0], [0.18, 2.60, 9.85], "Sink basin room-side wall"],
    [[-32.50, -1.67, -15.85], [5.48, 2.60, 0.18], "Sink basin rear wall"],
    [[-32.50, -1.67, -6.15], [5.48, 2.60, 0.18], "Sink basin front wall"],
    [[-35.24, -0.29, -11.0], [0.15, 0.09, 10.25], "Sink window-side rim"],
    [[-29.76, -0.29, -11.0], [0.15, 0.09, 10.25], "Sink room-side rim"],
    [[-32.50, -0.29, -16.05], [5.62, 0.09, 0.15], "Sink rear rim"],
    [[-32.50, -0.29, -5.95], [5.62, 0.09, 0.15], "Sink front rim"],
  ]) {
    addKitchenMesh({ geometry: new THREE.BoxGeometry(...size), material: stainlessMaterial, position, name });
  }

  const faucetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-35.15, -0.25, -11.0),
    new THREE.Vector3(-35.15, 3.20, -11.0),
    new THREE.Vector3(-33.80, 4.85, -11.0),
    new THREE.Vector3(-31.70, 3.40, -11.0),
    new THREE.Vector3(-31.35, 2.05, -11.0),
  ]);
  addKitchenMesh({
    geometry: new THREE.TubeGeometry(faucetCurve, 52, 0.22, 16, false),
    material: stainlessMaterial,
    position: [0, 0, 0],
    name: "Correctly oriented gooseneck kitchen tap",
  });
  addKitchenMesh({
    geometry: new THREE.CylinderGeometry(0.40, 0.48, 0.24, 28),
    material: stainlessMaterial,
    position: [-35.15, -0.20, -11.0],
    name: "Kitchen tap base collar",
  });

  addKitchenMesh({
    geometry: new THREE.BoxGeometry(11.4, 0.045, 6.6),
    material: darkApplianceMaterial,
    position: [10.0, -0.325, -32.0],
    name: "Flush black induction cooktop",
  });
  for (const [x, z, radius] of [
    [7.35, -33.55, 1.38], [12.65, -33.55, 1.18],
    [7.35, -30.45, 1.08], [12.65, -30.45, 1.42],
  ]) {
    addKitchenMesh({
      geometry: new THREE.TorusGeometry(radius, 0.055, 8, 48),
      material: stainlessMaterial,
      position: [x, -0.292, z],
      rotation: [Math.PI * 0.5, 0, 0],
      name: "Induction cooking ring",
    });
  }
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(8.7, 8.0, 0.34),
    material: darkApplianceMaterial,
    position: [10.0, -8.1, -28.58],
    name: "Built-in oven below the aligned induction cooktop",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(6.3, 0.20, 0.22),
    material: stainlessMaterial,
    position: [10.0, -5.35, -28.35],
    name: "Built-in oven horizontal pull handle",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(8.6, 15.3, 0.36),
    material: stainlessMaterial,
    position: [-25.0, -9.2, -28.54],
    name: "Integrated dishwasher front",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(5.6, 0.16, 0.22),
    material: darkApplianceMaterial,
    position: [-25.0, -3.05, -28.31],
    name: "Integrated dishwasher recessed pull",
  });
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(9.8, 0.34, 4.8),
    material: woodMaterial,
    position: [-3.0, -0.08, -31.6],
    name: "Oiled oak chopping board",
  });

  // A fitted pantry/oven wall closes the previously empty right-hand side and
  // gives the room a believable compact galley plan around the island.
  for (const z of [-8.5, 1.5, 11.5, 21.5]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(6.4, 42.0, 9.4),
      material: cabinetMaterial,
      position: [32.35, 2.0, z],
      name: "Full-height right-wall pantry carcass",
    });
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(0.28, 40.8, 8.75),
      material: cabinetFrontMaterial,
      position: [29.02, 2.0, z],
      name: "Full-height right-wall shaker pantry door",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.085, 0.085, 4.0, 16),
      material: stainlessMaterial,
      position: [28.82, 4.2, z + 3.1],
      name: "Long right-wall pantry pull",
    });
  }
  for (const [y, label] of [[-4.0, "lower"], [6.5, "upper"]]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(0.34, 7.4, 7.6),
      material: darkApplianceMaterial,
      position: [28.72, y, 1.5],
      name: `Integrated ${label} wall oven glass door`,
    });
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(0.14, 0.20, 4.9),
      material: stainlessMaterial,
      position: [28.49, y + 2.35, 1.5],
      name: `Integrated ${label} wall oven handle`,
    });
  }

  // A shallow sideboard and framed wall pieces make the front elevation feel
  // occupied without narrowing the circulation around the island.
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(21.0, 8.4, 4.2),
    material: warmWoodMaterial,
    position: [-19.0, KITCHEN_FLOOR_HEIGHT + 4.25, 33.45],
    name: "Shallow oak kitchen sideboard",
  });
  for (const x of [-25.5, -19.0, -12.5]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(5.8, 7.4, 0.24),
      material: cabinetFrontMaterial,
      position: [x, KITCHEN_FLOOR_HEIGHT + 4.35, 31.22],
      name: "Oak sideboard inset cabinet door",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.07, 0.07, 1.5, 14),
      material: stainlessMaterial,
      position: [x + 1.7, KITCHEN_FLOOR_HEIGHT + 5.0, 31.02],
      name: "Oak sideboard cabinet pull",
    });
  }
  for (const [x, y, width, height] of [
    [-24.0, 11.0, 6.4, 8.2],
    [-15.8, 12.2, 7.6, 10.4],
  ]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(width, height, 0.38),
      material: warmWoodMaterial,
      position: [x, y, 35.55],
      name: "Oak framed botanical kitchen print",
    });
    addKitchenMesh({
      geometry: new THREE.PlaneGeometry(width - 0.62, height - 0.62),
      material: porcelainMaterial,
      position: [x, y, 35.31],
      rotation: [0, Math.PI, 0],
      name: "Matte botanical artwork panel",
    });
  }

  // Everyday counter objects establish human scale. They are deliberately
  // kept on the perimeter benches so free-play remains clear on the island.
  addKitchenMesh({
    geometry: new THREE.BoxGeometry(3.7, 2.2, 2.4),
    material: stainlessMaterial,
    position: [-20.0, 0.55, -31.3],
    name: "Brushed steel two-slice toaster",
  });
  for (const x of [-20.75, -19.25]) {
    addKitchenMesh({
      geometry: new THREE.BoxGeometry(0.90, 0.08, 1.35),
      material: darkApplianceMaterial,
      position: [x, 1.69, -31.3],
      name: "Toaster bread slot",
    });
  }
  addKitchenMesh({
    geometry: new THREE.SphereGeometry(1.40, 22, 14),
    material: stainlessMaterial,
    position: [-14.6, 1.18, -31.3],
    name: "Rounded brushed steel electric kettle",
  });
  addKitchenMesh({
    geometry: new THREE.TorusGeometry(1.35, 0.18, 10, 28, Math.PI * 1.55),
    material: darkApplianceMaterial,
    position: [-14.6, 1.65, -31.20],
    rotation: [0, 0, Math.PI * 0.12],
    name: "Electric kettle curved handle",
  });
  addKitchenMesh({
    geometry: new THREE.ConeGeometry(0.60, 1.9, 16),
    material: stainlessMaterial,
    position: [-12.95, 1.55, -31.3],
    rotation: [0, 0, -Math.PI * 0.42],
    name: "Electric kettle pouring spout",
  });
  for (const [x, height] of [[16.0, 2.5], [18.8, 3.2], [21.6, 2.7]]) {
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.92, 0.98, height, 20),
      material: porcelainMaterial,
      position: [x, -0.35 + height * 0.5, -31.4],
      name: "Lidded ceramic pantry canister",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.72, 0.72, 0.18, 20),
      material: warmWoodMaterial,
      position: [x, -0.22 + height, -31.4],
      name: "Pantry canister oak lid",
    });
  }

  // Sink hardware and countertop ephemera add close-up cues around the real
  // recessed basin, including a drain, lever, soap and drying rack.
  addKitchenMesh({
    geometry: new THREE.TorusGeometry(0.58, 0.12, 10, 30),
    material: darkApplianceMaterial,
    position: [-32.5, -2.88, -11.0],
    rotation: [Math.PI * 0.5, 0, 0],
    name: "Sink basket drain ring",
  });
  addKitchenMesh({
    geometry: new THREE.CylinderGeometry(0.22, 0.28, 1.5, 16),
    material: stainlessMaterial,
    position: [-34.8, 0.58, -8.9],
    rotation: [Math.PI * 0.5, 0, 0],
    name: "Kitchen mixer control lever",
  });
  addKitchenMesh({
    geometry: new THREE.CylinderGeometry(0.42, 0.50, 1.55, 18),
    material: porcelainMaterial,
    position: [-35.05, 0.48, -5.1],
    name: "Ceramic kitchen soap dispenser",
  });
  addKitchenMesh({
    geometry: new THREE.CylinderGeometry(0.12, 0.16, 0.62, 14),
    material: stainlessMaterial,
    position: [-35.05, 1.56, -5.1],
    name: "Soap dispenser pump",
  });
  for (let rackBar = 0; rackBar < 7; ++rackBar) {
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.055, 0.055, 4.2, 10),
      material: stainlessMaterial,
      position: [-29.35, 0.08, -17.5 + rackBar * 0.52],
      rotation: [0, 0, Math.PI * 0.5],
      name: "Stainless sink drying-rack bar",
    });
  }

  // Two properly sized pendants break up the high ceiling and visually anchor
  // the island as the centre of the kitchen.
  for (const x of [-8.2, 8.2]) {
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.065, 0.065, 12.0, 10),
      material: darkApplianceMaterial,
      position: [x, 26.0, 0],
      name: "Pendant light suspension cable",
    });
    addKitchenMesh({
      geometry: new THREE.CylinderGeometry(0.65, 2.20, 1.95, 28, 1, true),
      material: darkApplianceMaterial,
      position: [x, 19.2, 0],
      name: "Dark enamel kitchen pendant shade",
    });
    addKitchenMesh({
      geometry: new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      material: porcelainMaterial,
      position: [x, 18.65, 0],
      rotation: [Math.PI, 0, 0],
      name: "Pendant opal glass diffuser",
    });
  }

  const stripMaterial = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(0xc9d7c8).multiplyScalar(1.55),
    side: THREE.DoubleSide,
    fog: false,
  });
  stripMaterial.toneMapped = false;
  const addStrip = (position, rotation, size) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), stripMaterial);
    strip.name = "Kitchen under-cabinet practical";
    strip.position.set(...position);
    strip.rotation.set(...rotation);
    strip.userData.rtxIgnore = true;
    room.add(strip);
  };
  addStrip([-14.5, 7.92, -31.41], [0, 0, 0], [8.8, 0.14]);
  addStrip([-4.2, 7.92, -31.41], [0, 0, 0], [8.8, 0.14]);
  addStrip([10.0, 9.42, -30.74], [0, 0, 0], [7.4, 0.12]);

  return {
    room,
    roomSurfaces,
    staticMeshes,
    wallMaterial,
    stripMaterial,
    roomExtent,
    roomTop,
  };
}

function appendStaticMesh(mesh, positions, indices) {
  mesh.updateWorldMatrix(true, false);
  const attribute = mesh.geometry.getAttribute("position");
  const geometryIndex = mesh.geometry.getIndex();
  const vertexOffset = positions.length / 3;
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < attribute.count; ++vertex) {
    point.fromBufferAttribute(attribute, vertex).applyMatrix4(mesh.matrixWorld);
    positions.push(point.x, point.y, point.z);
  }
  const count = geometryIndex ? geometryIndex.count : attribute.count;
  for (let cursor = 0; cursor < count; ++cursor) {
    indices.push(vertexOffset + (geometryIndex ? geometryIndex.getX(cursor) : cursor));
  }
}

export function collectTennisStaticScene(meshes) {
  const positions = [];
  const indices = [];
  for (const mesh of meshes) appendStaticMesh(mesh, positions, indices);
  if (positions.length === 0 || indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error("The tennis-felt static RTX scene is empty or malformed.");
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
  };
}

export function createTennisBallScene(scene) {
  const ballGroup = new THREE.Group();
  ballGroup.name = "World-axis deformable tennis ball pose";
  scene.add(ballGroup);
  // Rotation lives below the world-axis squash node. This composes T * S * R,
  // so impact compression remains vertical even after the seam has visibly
  // rolled across the shell.
  const ballRotationGroup = new THREE.Group();
  ballRotationGroup.name = "Rolling regulation tennis ball";
  ballGroup.add(ballRotationGroup);

  const shellMaterial = createProceduralFeltMaterial();
  const shell = new THREE.Mesh(createDepressedBallGeometry(), shellMaterial);
  shell.name = "Regulation tennis ball compressed felt shell";
  shell.castShadow = true;
  shell.receiveShadow = true;
  ballRotationGroup.add(shell);

  const undercoatMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Always-resident global tennis-felt undercoat",
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    sheen: 0.76,
    sheenColor: new THREE.Color(0xe4f285),
    sheenRoughness: 0.82,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const undercoatToEye = cameraPosition.sub(positionWorld);
  const undercoatDistance = length(undercoatToEye);
  const undercoatGrazing = pow(
    saturate(float(1).sub(abs(dot(normalize(normalWorld), normalize(undercoatToEye))))),
    2.2,
  );
  const nearNap = float(1).sub(smoothstep(0.55, 1.8, undercoatDistance));
  // Never cull or swap the nap.  Only its continuous optical coverage changes:
  // faint on the face of a distant ball, dense in macro, and strong at the rim.
  undercoatMaterial.opacityNode = saturate(
    float(0.055).add(nearNap.mul(0.32)).add(undercoatGrazing.mul(0.34)),
  );
  const undercoat = new THREE.Mesh(createGlobalUndercoatGeometry(), undercoatMaterial);
  undercoat.name = "420,000 fixed global curved micro-felt fibres";
  undercoat.castShadow = true;
  undercoat.receiveShadow = true;
  ballRotationGroup.add(undercoat);

  const seam = new THREE.Mesh(
    createSeamGeometry({
      radius: 0.9893,
      halfWidth: 0.039,
      edgeLift: 0.0090,
      crossSegments: 16,
    }),
    createProceduralSeamMaterial(),
  );
  seam.name = "Wavy regulation seam ribbon";
  seam.castShadow = true;
  seam.receiveShadow = true;
  ballRotationGroup.add(seam);

  const studio = createStudioRoom(scene);
  const floorMaterial = createReflectiveTableMaterial();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(
    KITCHEN_BENCH_HALF_X * 2,
    KITCHEN_BENCH_HALF_Z * 2,
    1,
    1,
  ), floorMaterial);
  floor.name = "Planar-reflective polished kitchen island bench";
  floor.rotation.x = -Math.PI * 0.5;
  floor.position.y = STUDIO_TABLE_HEIGHT;
  floor.receiveShadow = true;
  scene.add(floor);

  const quartzEdgeMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Charcoal quartz island edge",
    color: 0x171c19,
    roughness: 0.16,
    metalness: 0.04,
    clearcoat: 0.92,
    clearcoatRoughness: 0.10,
  });
  const islandCabinetMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Sage kitchen island cabinetry",
    color: 0x526455,
    roughness: 0.58,
    metalness: 0.01,
    clearcoat: 0.12,
    clearcoatRoughness: 0.52,
  });
  const islandHandleMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Brushed island cabinet hardware",
    color: 0x777f7d,
    roughness: 0.28,
    metalness: 0.90,
  });
  const benchSlab = new THREE.Mesh(
    new THREE.BoxGeometry(KITCHEN_BENCH_HALF_X * 2, 0.64, KITCHEN_BENCH_HALF_Z * 2),
    quartzEdgeMaterial,
  );
  benchSlab.name = "Solid charcoal quartz kitchen bench slab";
  // Keep the physical slab below the shader surface to avoid coincident-depth
  // shimmer without creating a visible gap at the polished edge.
  benchSlab.position.y = STUDIO_TABLE_HEIGHT - 0.34;
  benchSlab.castShadow = true;
  benchSlab.receiveShadow = true;
  scene.add(benchSlab);

  const islandBase = new THREE.Mesh(
    new THREE.BoxGeometry(34.0, 17.10, 16.8),
    islandCabinetMaterial,
  );
  islandBase.name = "Kitchen island cabinet base";
  islandBase.position.y = -10.18;
  islandBase.castShadow = true;
  islandBase.receiveShadow = true;
  scene.add(islandBase);
  const islandFronts = [];
  for (let door = 0; door < 4; ++door) {
    const x = -12.75 + door * 8.5;
    const front = new THREE.Mesh(
      new THREE.BoxGeometry(8.0, 16.05, 0.24),
      islandCabinetMaterial,
    );
    front.name = "Kitchen island shaker door";
    front.position.set(x, -10.02, 8.52);
    front.castShadow = true;
    front.receiveShadow = true;
    scene.add(front);
    islandFronts.push(front);
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.070, 0.070, 2.55, 16),
      islandHandleMaterial,
    );
    handle.name = "Kitchen island door handle";
    handle.position.set(x + 2.75, -4.95, 8.72);
    handle.castShadow = true;
    scene.add(handle);
    islandFronts.push(handle);
  }
  const islandToeKick = new THREE.Mesh(
    new THREE.BoxGeometry(32.8, 1.18, 15.6),
    quartzEdgeMaterial,
  );
  islandToeKick.name = "Recessed kitchen island toe kick";
  islandToeKick.position.y = KITCHEN_FLOOR_HEIGHT + 0.62;
  islandToeKick.castShadow = true;
  islandToeKick.receiveShadow = true;
  scene.add(islandToeKick);
  const islandBackPanel = new THREE.Mesh(
    new THREE.BoxGeometry(33.1, 16.05, 0.24),
    islandCabinetMaterial,
  );
  islandBackPanel.name = "Kitchen island finished rear panel";
  islandBackPanel.position.set(0, -10.02, -8.52);
  islandBackPanel.castShadow = true;
  islandBackPanel.receiveShadow = true;
  scene.add(islandBackPanel);
  const islandEndPanels = [];
  for (const x of [-17.12, 17.12]) {
    const endPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 16.05, 15.8),
      islandCabinetMaterial,
    );
    endPanel.name = "Kitchen island finished end panel";
    endPanel.position.set(x, -10.02, 0);
    endPanel.castShadow = true;
    endPanel.receiveShadow = true;
    scene.add(endPanel);
    islandEndPanels.push(endPanel);
  }
  const fixedIslandMeshes = [
    benchSlab,
    islandBase,
    islandToeKick,
    islandBackPanel,
    ...islandEndPanels,
    ...islandFronts,
  ];

  const contactMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0x020302,
    transparent: true,
    opacity: 0.44,
    depthWrite: false,
  });
  const contact = new THREE.Mesh(new THREE.CircleGeometry(0.68, 96), contactMaterial);
  contact.name = "Soft contact underlay";
  contact.rotation.x = -Math.PI * 0.5;
  contact.position.y = floor.position.y + 0.00045;
  contact.scale.y = 0.30;
  contact.userData.rtxIgnore = true;
  scene.add(contact);

  // The shell, seam and undercoat move and squash with the ball. Keep the
  // native static scene limited to the genuinely fixed room/table; the exact
  // moving fibre tubes use their own refitted dynamic BLAS every frame.
  const staticScene = collectTennisStaticScene([
    ...studio.roomSurfaces,
    ...studio.staticMeshes,
    ...fixedIslandMeshes,
    floor,
  ]);

  function dispose() {
    scene.remove(ballGroup, floor, contact, studio.room, ...fixedIslandMeshes);
    const materials = new Set();
    for (const object of [shell, undercoat, seam, floor, contact]) {
      object.geometry.dispose();
      materials.add(object.material);
    }
    studio.room.traverse(object => {
      object.geometry?.dispose?.();
      if (object.material) materials.add(object.material);
    });
    for (const object of fixedIslandMeshes) {
      object.geometry.dispose();
      materials.add(object.material);
    }
    for (const material of materials) material.dispose();
  }

  return {
    ballGroup,
    ballRotationGroup,
    shell,
    undercoat,
    seam,
    floor,
    contact,
    studioRoom: studio.room,
    studioStripMaterial: studio.stripMaterial,
    roomExtent: studio.roomExtent,
    roomTop: studio.roomTop,
    staticScene,
    dispose,
  };
}

function addCard(scene, size, position, rotation, color, intensity) {
  const material = new THREE.MeshBasicNodeMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    side: THREE.DoubleSide,
    fog: false,
  });
  material.toneMapped = false;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  card.position.set(...position);
  card.rotation.set(...rotation);
  scene.add(card);
}

export function createMacroStudioEnvironment(renderer) {
  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x070a08);
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(18, 14, 18),
    new THREE.MeshBasicNodeMaterial({ color: 0x121713, side: THREE.BackSide, fog: false }),
  );
  environmentScene.add(room);
  addCard(environmentScene, [5.8, 2.2], [-3.4, 4.7, 3.7], [-0.68, 0.55, 0.2], 0xffe0b5, 7.4);
  addCard(environmentScene, [2.2, 5.2], [4.8, 1.8, 0.5], [0, -Math.PI * 0.5, 0], 0xb9d7ff, 4.1);
  addCard(environmentScene, [3.8, 0.5], [0.8, -4.6, 1.8], [Math.PI * 0.5, 0, 0], 0xaec4b4, 2.2);
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.025,
    0.1,
    30,
    { size: 256, position: new THREE.Vector3(0, 0.6, 0) },
  );
  generator.dispose();
  environmentScene.traverse(object => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  return target;
}
