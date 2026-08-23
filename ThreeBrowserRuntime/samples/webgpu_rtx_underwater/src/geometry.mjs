import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedMesh,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  SphereGeometry,
} from "three/webgpu";

// All assets in this sample are generated here. The deterministic noise keeps
// captures reproducible while avoiding a tiled height/normal texture.
function hash2(x, z, seed = 0) {
  const h = Math.sin(x * 127.1 + z * 311.7 + seed * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function smoothNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - ux) + b * ux) * (1 - uz) + (c * (1 - ux) + d * ux) * uz;
}

function fbm(x, z, seed = 0) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 5; ++octave) {
    value += smoothNoise(x * frequency, z * frequency, seed + octave * 19) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.49;
  }
  return value / 0.96875;
}

export function terrainHeight(x, z) {
  const broad = (fbm(x * 0.045, z * 0.045, 4) - 0.5) * 0.68;
  const shelf = (fbm(x * 0.105 + 7.3, z * 0.105 - 5.1, 29) - 0.5) * 0.16;
  const rippleWarp = (smoothNoise(x * 0.13 - 2.7, z * 0.13 + 4.1, 17) - 0.5) * 1.10;
  const rippleEnvelope = 0.45 + smoothNoise(x * 0.075 + 1.8, z * 0.075 - 3.4, 41) * 0.55;
  // A single prevailing current lays down long, gently wandering sand ridges.
  // The former crossed sine field looked like a procedural wire pattern once lit.
  const current = x * 2.75 + z * 0.46 + rippleWarp * 0.72;
  const ripples = Math.sin(current) * 0.024 * rippleEnvelope
    + Math.sin(current * 2.06 + rippleWarp * 0.45) * 0.0075;
  const grains = (fbm(x * 0.31, z * 0.31, 61) - 0.5) * 0.030;
  const channel = -0.145 * Math.exp(-Math.pow((x + 2.2 + Math.sin(z * 0.13) * 1.3) / 5.8, 2));
  return broad + shelf + ripples + grains + channel;
}

export function createSandGeometry(width = 42, depth = 50, columns = 168, rows = 200) {
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let p = 0;
  let q = 0;
  for (let row = 0; row <= rows; ++row) {
    const v = row / rows;
    const z = 10 - v * depth;
    for (let column = 0; column <= columns; ++column) {
      const u = column / columns;
      const x = (u - 0.5) * width;
      positions[p++] = x;
      positions[p++] = terrainHeight(x, z);
      positions[p++] = z;
      uvs[q++] = u * 8;
      uvs[q++] = v * 10;
    }
  }

  const indices = new Uint32Array(columns * rows * 6);
  let i = 0;
  const stride = columns + 1;
  for (let row = 0; row < rows; ++row) {
    for (let column = 0; column < columns; ++column) {
      const a = row * stride + column;
      const b = a + stride;
      indices[i++] = a;
      indices[i++] = a + 1;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = a + 1;
      indices[i++] = b + 1;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createIrregularRockGeometry(radius = 1, seed = 1, detail = 3) {
  const geometry = new SphereGeometry(radius, 24 + detail * 4, 14 + detail * 3);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; ++i) {
    let x = positions.getX(i);
    let y = positions.getY(i);
    let z = positions.getZ(i);
    const length = Math.max(1e-6, Math.hypot(x, y, z));
    const nx = x / length;
    const ny = y / length;
    const nz = z / length;
    const azimuth = Math.atan2(nz, nx);
    const broadErosion = fbm(nx * 2.15 + seed * 0.73, nz * 2.15 - seed * 0.41, seed + 9) - 0.5;
    const edgeLobes = Math.sin(azimuth * 3 + seed * 1.37) * 0.085
      + Math.sin(azimuth * 5 - seed * 0.61) * 0.048
      + Math.cos(azimuth * 4 + seed * 0.47) * 0.052;
    const chippedEdge = Math.max(0, Math.sin(azimuth * 7.0 + seed * 2.11))
      * Math.max(0, 0.70 - Math.abs(ny)) * 0.038;
    const pore = Math.sin(nx * 31.0 + ny * 19.0 - nz * 23.0 + seed * 3.7) * 0.018
      + Math.sin(nx * 53.0 - ny * 37.0 + nz * 41.0 - seed * 1.9) * 0.011;
    const radial = 0.95 + broadErosion * 0.19 + edgeLobes - chippedEdge + pore;

    // Weathered river stones keep a rounded, eroded crown. Expand the shoulder
    // only slightly: flattening the whole sphere produced obvious flying-saucer
    // silhouettes once the camera dropped close to the bed.
    const shoulder = Math.max(0, 1 - Math.abs(ny) * 1.42);
	const plateauBoost = ny > 0
	      ? Math.min(1.42, 1 / Math.sqrt(Math.max(0.44, 1 - ny * ny)))
      : 1;
    const horizontal = radial * (1 + shoulder * 0.075) * plateauBoost;
    x *= horizontal * (1 + 0.105 * Math.sin(seed * 1.9));
    z *= horizontal * (0.92 + 0.085 * Math.cos(seed * 1.3));

    if (ny >= 0) {
      // Water-worn slabs have a broad shoulder and a subdued crown, unlike a
      // uniformly scaled sphere. Keep the transition continuous at ny=0.30.
      const crown = ny < 0.30
        ? ny * 0.78
        : 0.234 + (ny - 0.30) * 0.40;
      y = radius * crown * (0.98 + broadErosion * 0.12 + pore * 0.7);
    } else {
      y = radius * ny * (0.48 + broadErosion * 0.04);
      const floor = -radius * (0.43 + 0.022 * Math.sin(azimuth * 4 + seed));
      y = Math.max(y, floor);
    }

    const crownShear = Math.max(0, ny) * radius * 0.055;
    x += crownShear * Math.sin(seed * 2.23);
    z += crownShear * Math.cos(seed * 1.71);
    positions.setXYZ(i, x, y, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createRock(material, {
  x = 0,
  z = 0,
  radius = 1,
  scale = [1, 1, 1],
  rotation = 0,
  seed = 1,
  detail = 3,
} = {}) {
  const mesh = new Mesh(createIrregularRockGeometry(radius, seed, detail), material);
  // Keep the clipped underside just below the sand, while leaving enough of the
  // shoulder exposed to avoid the broad black intersection band of the old pass.
	mesh.position.set(x, terrainHeight(x, z) + radius * 0.32 * scale[1], z);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createPebbleField(material, count = 180, seed = 0x5eabed) {
  const geometry = createIrregularRockGeometry(0.085, 8, 2);
  const field = new InstancedMesh(geometry, material, count);
  const dummy = new Object3D();
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let index = 0; index < count; ++index) {
    let x = (random() * 2 - 1) * 16;
    let z = -1 - random() * 30;
    const size = 0.28 + Math.pow(random(), 2.25) * 1.18;
    dummy.position.set(x, terrainHeight(x, z) + 0.019 * size, z);
    dummy.rotation.set((random() - 0.5) * 0.30, random() * Math.PI * 2, (random() - 0.5) * 0.30);
    dummy.scale.set(
      size * (0.76 + random() * 0.62),
      size * (0.36 + random() * 0.32),
      size * (0.82 + random() * 0.48),
    );
    dummy.updateMatrix();
    field.setMatrixAt(index, dummy.matrix);
  }
  field.instanceMatrix.needsUpdate = true;
  field.castShadow = true;
  field.receiveShadow = true;
  return field;
}

function triangleGeometry(points) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function createFishBodyGeometry() {
  // An asymmetric spindle reads as a fish from both the side and three-quarter
  // views without relying on a visibly stretched primitive.
  const stations = [
    { z: -0.64, height: 0.035, thickness: 0.022 },
    { z: -0.51, height: 0.165, thickness: 0.076 },
    { z: -0.20, height: 0.295, thickness: 0.142 },
    { z: 0.17, height: 0.335, thickness: 0.158 },
    { z: 0.49, height: 0.195, thickness: 0.088 },
    { z: 0.64, height: 0.035, thickness: 0.022 },
  ];
  const ringSegments = 20;
  const positions = [];
  const indices = [];

  for (const station of stations) {
    for (let segment = 0; segment < ringSegments; segment += 1) {
      const angle = (segment / ringSegments) * Math.PI * 2;
      const side = Math.cos(angle);
      const vertical = Math.sin(angle);
      const shoulder = 1 - Math.pow(Math.abs(vertical), 3) * 0.055;
      positions.push(
        side * station.thickness * shoulder,
        vertical * station.height,
        station.z + Math.cos(angle * 2) * 0.004,
      );
    }
  }

  for (let ring = 0; ring < stations.length - 1; ring += 1) {
    for (let segment = 0; segment < ringSegments; segment += 1) {
      const next = (segment + 1) % ringSegments;
      const a = ring * ringSegments + segment;
      const b = ring * ringSegments + next;
      const c = (ring + 1) * ringSegments + segment;
      const d = (ring + 1) * ringSegments + next;
      indices.push(a, b, c, b, d, c);
    }
  }

  const tailCap = positions.length / 3;
  positions.push(0, 0, stations[0].z - 0.012);
  const noseCap = positions.length / 3;
  positions.push(0, 0, stations[stations.length - 1].z + 0.012);
  const noseRing = (stations.length - 1) * ringSegments;
  for (let segment = 0; segment < ringSegments; segment += 1) {
    const next = (segment + 1) % ringSegments;
    indices.push(tailCap, next, segment);
    indices.push(noseCap, noseRing + segment, noseRing + next);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createForkedTailGeometry() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    0, 0.12, 0,
    0, 0.27, -0.34,
    0, 0.05, -0.25,
    0, -0.27, -0.34,
    0, -0.12, 0,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 4, 2, 3, 4]);
  geometry.computeVertexNormals();
  return geometry;
}

export function createFish(bodyMaterial, tailMaterial, eyeMaterial, scale = 1) {
  const root = new Object3D();
  // A tang-like body is laterally thin and vertically deep. Keeping local +Z as
  // the swimming direction also makes the tail animation inexpensive.
  const body = new Mesh(createFishBodyGeometry(), bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  root.add(body);

  const tailPivot = new Object3D();
  tailPivot.position.z = -0.62;
  const tail = new Mesh(createForkedTailGeometry(), tailMaterial);
  tail.material.side = DoubleSide;
  tail.castShadow = true;
  tailPivot.add(tail);
  root.add(tailPivot);

  const dorsalGeometry = triangleGeometry([
    0, 0.20, 0.24,
    0, 0.47, -0.02,
    0, 0.34, -0.34,
    0, 0.16, -0.20,
  ]);
  const finTop = new Mesh(dorsalGeometry, bodyMaterial);
  finTop.material.side = DoubleSide;
  finTop.castShadow = true;
  root.add(finTop);

  const finBottom = new Mesh(dorsalGeometry, bodyMaterial);
  finBottom.scale.y = -1;
  finBottom.material.side = DoubleSide;
  finBottom.castShadow = true;
  root.add(finBottom);

  const pectoral = new Mesh(triangleGeometry([
    0, 0.04, 0.22,
    0, -0.22, -0.02,
    0, -0.05, -0.30,
    0, 0.08, -0.03,
  ]), bodyMaterial);
  pectoral.position.x = 0.15;
  pectoral.rotation.z = -0.18;
  pectoral.material.side = DoubleSide;
  root.add(pectoral);

  // Only the camera-facing eye is needed for the side-on reference pass; two
  // protruding eyes made the previous fish read as a cartoon character.
  const eye = new Mesh(new SphereGeometry(0.027, 12, 8), eyeMaterial);
  eye.position.set(0.151, 0.092, 0.45);
  eye.castShadow = true;
  root.add(eye);
  root.scale.set(scale * 0.92, scale, scale * 1.26);
  root.userData.tail = tailPivot;
  root.userData.phase = 0;
  return root;
}

export function createLeaf(material, size = 1) {
  const geometry = triangleGeometry([
    0, 0, 0.48,
    -0.32, 0.035, -0.04,
    0, 0, -0.52,
    0.34, -0.025, -0.06,
  ]);
  const leaf = new Mesh(geometry, material);
  leaf.scale.set(size, size, size);
  leaf.castShadow = true;
  leaf.material.side = DoubleSide;
  return leaf;
}

export function createSimpleMaterial(color, roughness = 0.75, metalness = 0) {
  const material = new MeshStandardNodeMaterial({ color, roughness, metalness });
  return material;
}
