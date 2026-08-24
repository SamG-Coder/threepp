import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  createEmissiveMaterial,
  createGlassMaterial,
  createHaloMaterial,
  createMetalMaterial,
  createMistMaterial,
  createRubberMaterial,
  createVehiclePaint,
  palette,
} from "./materials.mjs";

const VEHICLE_COUNT = 6;
const RTX_INSTANCE_GROUP_ID = "neon-rain-district-traffic";
// Keep every vehicle—and the low rear tracking camera—inside the authored
// asphalt plane (z = -132..22).  The former +36 turnaround let traffic leave
// the street before wrapping.
const STREET_MIN_Z = -122;
const STREET_MAX_Z = 10;
const STREET_SPAN = STREET_MAX_Z - STREET_MIN_Z;
const ROAD_Y = 0.004;
const VEHICLES_PER_DIRECTION = VEHICLE_COUNT / 2;
const CONVOY_SPACING = STREET_SPAN / VEHICLES_PER_DIRECTION;
const DIRECTION_SPEED = Object.freeze({ forward: 9.15, reverse: 8.85 });

const MODELS = Object.freeze([
  { kind: "sedan", length: 4.45, width: 1.82, wheelRadius: 0.36, cabinLength: 2.10, cabinHeight: 0.62 },
  { kind: "taxi", length: 4.62, width: 1.84, wheelRadius: 0.36, cabinLength: 2.20, cabinHeight: 0.65, taxiSign: true },
  { kind: "van", length: 5.28, width: 1.98, wheelRadius: 0.39, cabinLength: 1.48, cabinHeight: 0.82, van: true },
  { kind: "suv", length: 4.72, width: 1.93, wheelRadius: 0.42, cabinLength: 2.48, cabinHeight: 0.78, roofRack: true },
  { kind: "coupe", length: 4.18, width: 1.80, wheelRadius: 0.37, cabinLength: 1.76, cabinHeight: 0.52 },
  { kind: "wagon", length: 4.70, width: 1.86, wheelRadius: 0.37, cabinLength: 2.62, cabinHeight: 0.69, roofRack: true },
]);

const PAINT_COLORS = Object.freeze([
  0x6d1329,
  0xd99b21,
  0x183e78,
  0x293139,
  0x641c61,
  0x7b1e29,
]);

function createRandom(seed = 0x4e524454) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function addBox(parent, geometry, material, name, size, position, {
  castShadow = true,
  receiveShadow = true,
} = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.scale.set(size[0], size[1], size[2]);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  parent.add(mesh);
  return mesh;
}

function createSprayGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.18, 0.00, 0.05,
     0.18, 0.00, 0.05,
     0.00, 0.60, -1.72,
    -0.18, 0.00, 0.05,
     0.00, 0.60, -1.72,
    -0.04, 0.08, -1.24,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createStreakRibbonGeometry(segments = 16) {
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let segment = 0; segment <= segments; ++segment) {
    const t = segment / segments;
    // Taper to a point at both ends. The alpha texture adds the much softer
    // optical falloff; this outline ensures even a missing texture cannot turn
    // the effect back into a rectangular card in the color/guide MRT.
    const halfWidth = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.48) * 0.5;
    const y = t - 0.5;
    positions.push(-halfWidth, y, 0, halfWidth, y, 0);
    uvs.push(0, t, 1, t);
    if (segment === segments) continue;
    const row = segment * 2;
    indices.push(row, row + 1, row + 3, row, row + 3, row + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createStreakAlphaTexture() {
  const width = 32;
  const height = 128;
  const bytes = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; ++row) {
    const t = row / (height - 1);
    const longitudinal = Math.pow(Math.max(0, Math.sin(Math.PI * t)), 1.42);
    const silhouette = Math.max(0.001, Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.48));
    for (let column = 0; column < width; ++column) {
      const x = (column / (width - 1)) * 2 - 1;
      const lateral = Math.pow(Math.max(0, 1 - Math.abs(x) / silhouette), 1.85);
      const softCore = 0.62 + Math.exp(-x * x * 10) * 0.38;
      const value = Math.round(255 * longitudinal * lateral * softCore);
      const offset = (row * width + column) * 4;
      // Mesh alphaMap reads the green channel; writing neutral RGB also keeps
      // this texture useful on runtimes that lower node alpha maps differently.
      bytes[offset] = value;
      bytes[offset + 1] = value;
      bytes[offset + 2] = value;
      bytes[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    bytes,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "Soft tapered wet-road light falloff";
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createContactShadowTexture() {
  const size = 48;
  const bytes = new Uint8Array(size * size * 4);
  for (let row = 0; row < size; ++row) {
    const y = (row / (size - 1)) * 2 - 1;
    for (let column = 0; column < size; ++column) {
      const x = (column / (size - 1)) * 2 - 1;
      const radius = Math.hypot(x, y);
      const falloff = Math.pow(THREE.MathUtils.clamp(1 - radius, 0, 1), 1.7);
      const value = Math.round(falloff * 255);
      const offset = (row * size + column) * 4;
      bytes[offset] = value;
      bytes[offset + 1] = value;
      bytes[offset + 2] = value;
      bytes[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    bytes,
    size,
    size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = "Soft tire contact shadow";
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createSlopedHoodGeometry() {
  const geometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.12);
  const positions = geometry.getAttribute("position");
  for (let vertex = 0; vertex < positions.count; ++vertex) {
    const z = positions.getZ(vertex);
    const front = THREE.MathUtils.clamp(z + 0.5, 0, 1);
    const y = positions.getY(vertex);
    const upper = THREE.MathUtils.clamp(y + 0.5, 0, 1);
    const x = positions.getX(vertex) * (1 - front * 0.10);
    positions.setXYZ(vertex, x, y - front * upper * 0.38, z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendProxyBox(target, size, position, radiance, surface) {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2], 1, 1, 1);
  geometry.translate(position[0], position[1], position[2]);
  const attribute = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const vertexOffset = target.positions.length / 3;

  for (let vertex = 0; vertex < attribute.count; ++vertex) {
    target.positions.push(attribute.getX(vertex), attribute.getY(vertex), attribute.getZ(vertex));
  }
  for (let element = 0; element < index.count; element += 3) {
    target.indices.push(
      vertexOffset + index.getX(element),
      vertexOffset + index.getX(element + 1),
      vertexOffset + index.getX(element + 2),
    );
    target.radiance.push(...radiance);
    target.surface.push(...surface);
  }
  geometry.dispose();
}

/**
 * One deliberately cheap proxy is shared by every visual vehicle. It includes
 * low-poly body/cabin volumes and tiny emissive front/rear lamps, then per-car
 * affine transforms scale that common mesh to each silhouette. Native code
 * therefore only refits the existing TLAS; no changing vehicle mesh is rebuilt.
 */
function createRtxProxy() {
  const target = { positions: [], indices: [], radiance: [], surface: [] };
  const bodyRadiance = [0.003, 0.004, 0.006, 1];
  const bodySurface = [0.11, 0.15, 0.19, 0.14];
  const glassRadiance = [0.001, 0.002, 0.003, 1];
  const glassSurface = [0.018, 0.034, 0.048, 0.08];
  const headRadiance = [11.0, 7.2, 3.4, 1];
  const headSurface = [1.0, 0.72, 0.38, 0.19];
  const tailRadiance = [8.5, 0.08, 0.18, 1];
  const tailSurface = [0.92, 0.015, 0.035, 0.23];

  appendProxyBox(target, [1.82, 0.55, 4.40], [0, 0.66, 0], bodyRadiance, bodySurface);
  appendProxyBox(target, [1.43, 0.62, 2.08], [0, 1.18, -0.10], glassRadiance, glassSurface);
  appendProxyBox(target, [1.54, 0.09, 2.16], [0, 1.52, -0.10], bodyRadiance, bodySurface);
  appendProxyBox(target, [0.42, 0.14, 0.08], [-0.48, 0.69, 2.23], headRadiance, headSurface);
  appendProxyBox(target, [0.42, 0.14, 0.08], [0.48, 0.69, 2.23], headRadiance, headSurface);
  appendProxyBox(target, [0.36, 0.13, 0.08], [-0.50, 0.70, -2.23], tailRadiance, tailSurface);
  appendProxyBox(target, [0.36, 0.13, 0.08], [0.50, 0.70, -2.23], tailRadiance, tailSurface);

  return {
    positions: new Float32Array(target.positions),
    indices: new Uint32Array(target.indices),
    triangleRadiance: new Float32Array(target.radiance),
    triangleSurface: new Float32Array(target.surface),
  };
}

function makeWheel(parent, shared, x, z, radius, wheelWidth, wheelList, name) {
  const tire = new THREE.Mesh(shared.wheelGeometry, shared.rubberMaterial);
  tire.name = `${name} tire`;
  tire.position.set(x, radius, z);
  // The unit torus is 0.56 units thick around its X axle and one unit in
  // rolling radius; scaling preserves a rounded sidewall instead of a cylinder.
  tire.scale.set(wheelWidth / 0.56, radius, radius);
  tire.castShadow = true;
  tire.receiveShadow = true;
  parent.add(tire);

  const side = Math.sign(x) || 1;
  const rim = new THREE.Mesh(shared.rimGeometry, shared.rimMaterial);
  rim.name = `${name} wet alloy rim`;
  rim.position.set(x + side * (wheelWidth * 0.52 + 0.006), radius, z);
  rim.scale.set(0.035, radius * 0.56, radius * 0.56);
  rim.castShadow = true;
  parent.add(rim);

  const contact = new THREE.Mesh(shared.contactShadowGeometry, shared.contactShadowMaterial);
  contact.name = `${name} soft tire contact shadow`;
  contact.rotation.x = -Math.PI * 0.5;
  contact.position.set(x, 0.001, z);
  contact.scale.set(radius * 0.72, radius * 1.20, 1);
  contact.renderOrder = 2;
  parent.add(contact);
  wheelList.push(tire, rim);
}

function addLampPair(parent, shared, model, front, material, haloMaterial) {
  const z = (front ? 1 : -1) * (model.length * 0.5 + 0.045);
  const y = model.wheelRadius + (model.van ? 0.43 : 0.31);
  const x = model.width * 0.29;
  const width = model.van ? 0.38 : 0.43;
  const meshes = [];

  for (const side of [-1, 1]) {
    const housing = addBox(
      parent,
      shared.roundedDetailGeometry,
      front ? shared.lampHousingMaterial : shared.tailHousingMaterial,
      front ? "Recessed headlamp housing" : "Recessed tail-lamp housing",
      [width, front ? 0.17 : 0.16, 0.085],
      [side * x, y, z],
      { castShadow: false, receiveShadow: false },
    );
    meshes.push(housing);

    // Two small luminous optics sit inside each dark housing. At distance they
    // resolve as a lamp signature, never as a single flat white rectangle.
    for (const optic of [-1, 1]) {
      const lens = new THREE.Mesh(shared.lampLensGeometry, material);
      lens.name = front ? "Projector LED optic" : "Tail-lamp LED optic";
      lens.position.set(
        side * x + optic * width * 0.20,
        y,
        z + (front ? 0.050 : -0.050),
      );
      lens.scale.set(width * 0.13, front ? 0.052 : 0.047, 0.034);
      lens.castShadow = false;
      lens.renderOrder = 6;
      parent.add(lens);
      meshes.push(lens);
    }

    const halo = new THREE.Mesh(shared.haloGeometry, haloMaterial);
    halo.name = front ? "Headlamp rain halo" : "Tail-lamp rain halo";
    halo.position.set(side * x, y, z + (front ? 0.066 : -0.066));
    halo.scale.set(front ? 0.42 : 0.36, front ? 0.20 : 0.18, 1);
    if (!front) halo.rotation.y = Math.PI;
    halo.renderOrder = 7;
    parent.add(halo);
    meshes.push(halo);
  }
  return meshes;
}

function addRoadStreaks(parent, shared, model, list) {
  const headX = model.width * 0.29;
  const tailX = model.width * 0.28;
  const headLength = model.van ? 4.8 : 4.15;
  const tailLength = model.van ? 3.15 : 2.65;

  for (const side of [-1, 1]) {
    const head = new THREE.Mesh(shared.streakGeometry, shared.headStreakMaterial);
    head.name = "Headlamp wet-road reflection streak";
    head.rotation.x = -Math.PI * 0.5;
    head.position.set(side * headX, 0.012, model.length * 0.5 + headLength * 0.48);
    head.scale.set(model.van ? 0.34 : 0.28, headLength, 1);
    head.userData.baseStreakWidth = head.scale.x;
    head.renderOrder = 5;
    parent.add(head);
    list.push(head);

    const tail = new THREE.Mesh(shared.streakGeometry, shared.tailStreakMaterial);
    tail.name = "Tail-lamp wet-road reflection streak";
    tail.rotation.x = -Math.PI * 0.5;
    tail.position.set(side * tailX, 0.011, -model.length * 0.5 - tailLength * 0.47);
    tail.scale.set(0.25, tailLength, 1);
    tail.userData.baseStreakWidth = tail.scale.x;
    tail.renderOrder = 5;
    parent.add(tail);
    list.push(tail);
  }
}

function addTireSpray(parent, shared, model, sprays) {
  const rearZ = -model.length * (model.van ? 0.34 : 0.36);
  for (const side of [-1, 1]) {
    for (const yaw of [-0.13, 0.13]) {
      const spray = new THREE.Mesh(shared.sprayGeometry, shared.sprayMaterial);
      spray.name = "Tire atomization fan";
      spray.position.set(side * model.width * 0.47, 0.04, rearZ);
      spray.rotation.y = yaw + side * 0.035;
      spray.scale.set(model.van ? 1.18 : 0.95, model.van ? 1.15 : 0.92, 1);
      spray.renderOrder = 6;
      parent.add(spray);
      sprays.push(spray);
    }
  }
}

function addRoofRack(parent, shared, model, roofY) {
  // A single low-profile rail on each side sits directly on the headliner.
  // The old crossbar stack floated above distant cars and obscured the roof.
  for (const x of [-model.width * 0.36, model.width * 0.36]) {
    addBox(
      parent,
      shared.roundedDetailGeometry,
      shared.rimMaterial,
      "Flush roof rail",
      [0.045, 0.040, model.cabinLength * 0.64],
      [x, roofY + 0.064, -0.08],
    );
  }
}

function addWindowPanel(parent, shared, name, position, scale, rotation) {
  const window = new THREE.Mesh(shared.windowGeometry, shared.glassMaterial);
  window.name = name;
  window.position.set(...position);
  window.scale.set(scale[0], scale[1], 1);
  window.rotation.set(...rotation);
  window.castShadow = false;
  window.receiveShadow = true;
  window.renderOrder = 3;
  parent.add(window);
  return window;
}

function addCabinAssembly(parent, shared, model, paintMaterial, centerY, centerZ) {
  const width = model.width * (model.van ? 0.78 : 0.73);
  const height = model.cabinHeight;
  const length = model.cabinLength;
  const roofY = centerY + height * 0.54;

  // A dark inner tub and real seat backs remain visible behind the separate
  // glass panels. They also stop a transparent cabin from reading as an open bed.
  addBox(
    parent,
    shared.roundedDetailGeometry,
    shared.interiorMaterial,
    "Closed shadowed cabin tub",
    [width * 0.90, height * 0.35, length * 0.82],
    [0, centerY - height * 0.24, centerZ],
  );
  const seatZ = centerZ + length * 0.10;
  for (const side of [-1, 1]) {
    addBox(
      parent,
      shared.seatGeometry,
      shared.seatMaterial,
      "Dark front seat back",
      [width * 0.25, height * 0.54, length * 0.12],
      [side * width * 0.23, centerY - height * 0.02, seatZ],
    );
    addBox(
      parent,
      shared.seatGeometry,
      shared.seatMaterial,
      "Dark front headrest",
      [width * 0.18, height * 0.18, length * 0.10],
      [side * width * 0.23, centerY + height * 0.30, seatZ - length * 0.015],
    );
  }

  const frontSlope = Math.atan2(length * 0.23, height * 0.78);
  addWindowPanel(
    parent,
    shared,
    "Distinct sloped front windshield",
    [0, centerY, centerZ + length * 0.385],
    [width * 0.84, Math.hypot(height * 0.72, length * 0.23)],
    [-frontSlope, 0, 0],
  );
  if (!model.van && model.kind !== "wagon" && model.kind !== "suv") {
    const rearSlope = Math.atan2(length * 0.16, height * 0.78);
    addWindowPanel(
      parent,
      shared,
      "Distinct sloped rear windshield",
      [0, centerY, centerZ - length * 0.42],
      [width * 0.82, Math.hypot(height * 0.70, length * 0.16)],
      [rearSlope, Math.PI, 0],
    );
  }

  // Two panels per side plus an opaque B-pillar make the glazing readable in
  // telephoto views instead of collapsing into one disappearing transparent box.
  const sideWindowLength = length * 0.34;
  for (const side of [-1, 1]) {
    const sideRotation = side * Math.PI * 0.5;
    for (const zOffset of [-length * 0.20, length * 0.20]) {
      addWindowPanel(
        parent,
        shared,
        zOffset > 0 ? "Front side window" : "Rear side window",
        [side * width * 0.51, centerY, centerZ + zOffset],
        [sideWindowLength, height * 0.58],
        [0, sideRotation, 0],
      );
    }

    addBox(
      parent,
      shared.roundedDetailGeometry,
      paintMaterial,
      "Opaque painted beltline",
      [0.070, 0.12, length * 0.94],
      [side * width * 0.52, centerY - height * 0.34, centerZ],
    );
    addBox(
      parent,
      shared.roundedDetailGeometry,
      paintMaterial,
      "Opaque window headliner rail",
      [0.075, 0.10, length * 0.94],
      [side * width * 0.52, centerY + height * 0.35, centerZ],
    );
    for (const zOffset of [-length * 0.43, 0, length * 0.43]) {
      addBox(
        parent,
        shared.unitBox,
        paintMaterial,
        zOffset === 0 ? "Opaque B-pillar" : "Opaque window corner pillar",
        [0.075, height * 0.88, 0.090],
        [side * width * 0.52, centerY, centerZ + zOffset],
      );
    }
  }

  addBox(
    parent,
    shared.roundedDetailGeometry,
    paintMaterial,
    `${model.kind} closed roof and headliner`,
    [width * 1.08, 0.12, length * 0.92],
    [0, roofY, centerZ],
  );
  for (const zOffset of [-length * 0.47, length * 0.47]) {
    addBox(
      parent,
      shared.roundedDetailGeometry,
      paintMaterial,
      "Opaque windshield cowl",
      [width * 1.06, 0.12, 0.11],
      [0, centerY - height * 0.34, centerZ + zOffset],
    );
    addBox(
      parent,
      shared.roundedDetailGeometry,
      paintMaterial,
      "Opaque windshield headliner",
      [width * 1.06, 0.10, 0.11],
      [0, centerY + height * 0.35, centerZ + zOffset],
    );
  }
  return roofY;
}

function buildVehicle(shared, model, paintMaterial, index) {
  const root = new THREE.Group();
  root.name = `${model.kind} traffic vehicle ${String(index + 1).padStart(2, "0")}`;

  const wheelY = model.wheelRadius;
  const sillY = wheelY + 0.25;
  const bodyHeight = model.van ? 0.60 : model.kind === "suv" ? 0.62 : 0.52;
  const bodyY = sillY + bodyHeight * 0.34;
  addBox(
    root,
    shared.roundedBodyGeometry,
    paintMaterial,
    `${model.kind} rain-beaded lower body`,
    [model.width, bodyHeight, model.length],
    [0, bodyY, 0],
  );

  addBox(
    root,
    shared.roundedDetailGeometry,
    shared.bumperMaterial,
    "Front graphite bumper",
    [model.width * 0.91, 0.16, 0.11],
    [0, wheelY + 0.10, model.length * 0.5 + 0.035],
  );
  addBox(
    root,
    shared.roundedDetailGeometry,
    shared.bumperMaterial,
    "Rear graphite bumper",
    [model.width * 0.91, 0.15, 0.11],
    [0, wheelY + 0.09, -model.length * 0.5 - 0.035],
  );
  addBox(
    root,
    shared.unitBox,
    shared.grilleMaterial,
    "Front cooling grille",
    [model.width * (model.van ? 0.56 : 0.48), 0.19, 0.055],
    [0, wheelY + 0.22, model.length * 0.5 + 0.094],
    { castShadow: false, receiveShadow: true },
  );

  // True half-torus arches trace each tire instead of placing a solid block in
  // front of it. This keeps wheel contact readable in the ultra-low rear view.
  const fenderX = model.width * 0.475;
  const frontFenderZ = model.length * (model.van ? 0.32 : 0.34);
  const rearFenderZ = -model.length * (model.van ? 0.34 : 0.32);
  for (const x of [-fenderX, fenderX]) {
    for (const z of [frontFenderZ, rearFenderZ]) {
      const arch = new THREE.Mesh(shared.wheelArchGeometry, paintMaterial);
      arch.name = "Rounded painted wheel arch";
      arch.position.set(x, model.wheelRadius, z);
      arch.scale.setScalar(model.wheelRadius * 1.08);
      arch.castShadow = true;
      arch.receiveShadow = true;
      root.add(arch);
    }
  }

  let roofY;
  if (model.van) {
    const cargoLength = model.delivery ? model.length * 0.58 : model.length * 0.53;
    const cargoZ = -model.length * 0.15;
    addBox(
      root,
      shared.roundedBodyGeometry,
      paintMaterial,
      model.delivery ? "Tall delivery cargo body" : "Tall van body",
      [model.width * 0.91, model.delivery ? 1.28 : 1.18, cargoLength],
      [0, 1.10, cargoZ],
    );
    const cabinZ = model.length * 0.27;
    roofY = addCabinAssembly(root, shared, model, paintMaterial, 1.04, cabinZ);

    if (model.delivery) {
      for (const side of [-1, 1]) {
        addBox(
          root,
          shared.unitBox,
          index % 2 ? shared.magentaAdvertMaterial : shared.cyanAdvertMaterial,
          "Courier neon side identity",
          [0.035, 0.22, cargoLength * 0.62],
          [side * model.width * 0.465, 1.18, cargoZ],
          { castShadow: false, receiveShadow: false },
        );
      }
    }
  } else {
    const cabinZ = model.kind === "hatch" || model.kind === "wagon" || model.kind === "suv"
      ? -0.16
      : -0.12;
    const cabinY = model.kind === "suv" ? 1.10 : 1.02;
    roofY = addCabinAssembly(root, shared, model, paintMaterial, cabinY, cabinZ);

    const hoodLength = model.kind === "hatch" ? model.length * 0.22 : model.length * 0.28;
    addBox(
      root,
      shared.slopedHoodGeometry,
      paintMaterial,
      "Sloping front hood mass",
      [model.width * 0.91, 0.18, hoodLength],
      [0, wheelY + 0.52, model.length * 0.5 - hoodLength * 0.52],
    );
    if (model.kind === "wagon" || model.kind === "suv") {
      const hatchLength = model.length * 0.22;
      const hatchZ = -model.length * 0.5 + hatchLength * 0.52;
      const hatchY = cabinY - model.cabinHeight * 0.06;
      addBox(
        root,
        shared.roundedBodyGeometry,
        paintMaterial,
        "Closed rounded rear quarter and hatch",
        [model.width * 0.90, model.cabinHeight * 0.78, hatchLength],
        [0, hatchY, hatchZ],
      );
      addWindowPanel(
        root,
        shared,
        "Readable dark rear hatch window",
        [0, hatchY + model.cabinHeight * 0.08, -model.length * 0.5 - 0.061],
        [model.width * 0.62, model.cabinHeight * 0.42],
        [0, Math.PI, 0],
      );
      addBox(
        root,
        shared.roundedDetailGeometry,
        paintMaterial,
        "Integrated rear roof spoiler",
        [model.width * 0.74, 0.07, 0.20],
        [0, roofY - 0.08, -model.length * 0.5 - 0.035],
      );
    } else {
      const deckLength = model.length * 0.22;
      addBox(
        root,
        shared.roundedDetailGeometry,
        paintMaterial,
        "Rear deck mass",
        [model.width * 0.90, 0.16, deckLength],
        [0, wheelY + 0.50, -model.length * 0.5 + deckLength * 0.52],
      );
    }
  }

  if (model.taxiSign) {
    addBox(
      root,
      shared.roundedDetailGeometry,
      shared.taxiSignMaterial,
      "Amber district taxi roof beacon",
      [0.54, 0.18, 0.24],
      [0, roofY + 0.16, -0.12],
      { castShadow: false, receiveShadow: false },
    );
  }
  if (model.roofRack) addRoofRack(root, shared, model, roofY);

  // Mirrors and wet chrome door pulls provide small, readable moving glints.
  const mirrorZ = model.van ? model.length * 0.33 : model.cabinLength * 0.33;
  for (const side of [-1, 1]) {
    addBox(
      root,
      shared.roundedDetailGeometry,
      shared.rimMaterial,
      "Wet side mirror",
      [0.16, 0.10, 0.20],
      [side * model.width * 0.54, model.van ? 1.09 : 1.02, mirrorZ],
    );
    for (const z of [-model.length * 0.15, model.length * 0.16]) {
      addBox(
        root,
        shared.unitBox,
        shared.rimMaterial,
        "Door handle glint",
        [0.025, 0.035, 0.22],
        [side * model.width * 0.505, model.van ? 1.03 : 0.89, z],
        { castShadow: false, receiveShadow: true },
      );
    }
  }

  const plateY = wheelY + 0.18;
  addBox(
    root,
    shared.unitBox,
    shared.plateMaterial,
    "Front license plate",
    [0.48, 0.12, 0.025],
    [0, plateY, model.length * 0.5 + 0.103],
    { castShadow: false, receiveShadow: false },
  );
  addBox(
    root,
    shared.unitBox,
    shared.plateMaterial,
    "Rear license plate",
    [0.48, 0.12, 0.025],
    [0, plateY, -model.length * 0.5 - 0.103],
    { castShadow: false, receiveShadow: false },
  );

  const wheels = [];
  const wheelWidth = model.van ? 0.25 : 0.22;
  const wheelX = model.width * 0.49;
  const frontAxle = model.length * (model.van ? 0.32 : 0.34);
  const rearAxle = -model.length * (model.van ? 0.34 : 0.32);
  for (const x of [-wheelX, wheelX]) {
    makeWheel(root, shared, x, frontAxle, model.wheelRadius, wheelWidth, wheels, "Front");
    makeWheel(root, shared, x, rearAxle, model.wheelRadius, wheelWidth, wheels, "Rear");
  }

  const coolHeadlights = index % 3 !== 1;
  addLampPair(
    root,
    shared,
    model,
    true,
    coolHeadlights ? shared.coolHeadlightMaterial : shared.warmHeadlightMaterial,
    coolHeadlights ? shared.coolHeadHaloMaterial : shared.warmHeadHaloMaterial,
  );
  addLampPair(root, shared, model, false, shared.tailLightMaterial, shared.tailHaloMaterial);

  const streaks = [];
  addRoadStreaks(root, shared, model, streaks);
  const sprays = [];
  addTireSpray(root, shared, model, sprays);

  return { root, wheels, sprays, streaks, model };
}

export function createTrafficSystem(scene, environment = null) {
  const random = createRandom();
  const group = new THREE.Group();
  group.name = "Bidirectional neon rain traffic";
  scene.add(group);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const roundedBodyGeometry = new RoundedBoxGeometry(1, 1, 1, 4, 0.16);
  const roundedDetailGeometry = new RoundedBoxGeometry(1, 1, 1, 3, 0.18);
  const slopedHoodGeometry = createSlopedHoodGeometry();
  const wheelGeometry = new THREE.TorusGeometry(0.72, 0.28, 12, 32);
  wheelGeometry.rotateY(Math.PI * 0.5);
  const rimGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 2, false);
  rimGeometry.rotateZ(Math.PI * 0.5);
  const wheelArchGeometry = new THREE.TorusGeometry(0.84, 0.16, 8, 28, Math.PI);
  wheelArchGeometry.rotateY(Math.PI * 0.5);
  const windowGeometry = new THREE.PlaneGeometry(1, 1);
  const seatGeometry = new RoundedBoxGeometry(1, 1, 1, 2, 0.16);
  const lampLensGeometry = new THREE.SphereGeometry(1, 16, 10);
  const contactShadowGeometry = new THREE.CircleGeometry(1, 32);
  const haloGeometry = new THREE.PlaneGeometry(1, 1);
  const streakGeometry = createStreakRibbonGeometry();
  const sprayGeometry = createSprayGeometry();
  const streakAlphaTexture = createStreakAlphaTexture();
  const contactShadowTexture = createContactShadowTexture();
  const textures = [streakAlphaTexture, contactShadowTexture];
  const geometries = [
    unitBox,
    roundedBodyGeometry,
    roundedDetailGeometry,
    slopedHoodGeometry,
    wheelGeometry,
    rimGeometry,
    wheelArchGeometry,
    windowGeometry,
    seatGeometry,
    lampLensGeometry,
    contactShadowGeometry,
    haloGeometry,
    streakGeometry,
    sprayGeometry,
  ];

  const rubberMaterial = createRubberMaterial();
  const rimMaterial = createMetalMaterial(0x8b969d, 0.18, 0.92);
  const bumperMaterial = createMetalMaterial(0x11161b, 0.32, 0.72);
  const grilleMaterial = createMetalMaterial(0x05080b, 0.47, 0.82);
  const glassMaterial = createGlassMaterial(0x09141c, 0.46);
  const interiorMaterial = createMetalMaterial(0x05070a, 0.78, 0.01);
  const seatMaterial = createMetalMaterial(0x090b0e, 0.69, 0.02);
  const lampHousingMaterial = createMetalMaterial(0x10171d, 0.24, 0.56);
  const tailHousingMaterial = createMetalMaterial(0x26070f, 0.27, 0.32);
  const coolHeadlightMaterial = createEmissiveMaterial(0xc9f5ff, 13.5, "Cool traffic LED");
  const warmHeadlightMaterial = createEmissiveMaterial(palette.warm, 11.8, "Warm traffic LED");
  const tailLightMaterial = createEmissiveMaterial(palette.red, 9.4, "Traffic tail LED");
  const plateMaterial = createEmissiveMaterial(0xc4dcdf, 0.72, "Reflective license plate");
  const taxiSignMaterial = createEmissiveMaterial(palette.amber, 4.8, "Taxi roof practical");
  const cyanAdvertMaterial = createEmissiveMaterial(palette.cyan, 2.8, "Courier cyan identity");
  const magentaAdvertMaterial = createEmissiveMaterial(palette.magenta, 2.6, "Courier magenta identity");
  const coolHeadHaloMaterial = createHaloMaterial(0xb9efff, 0.105);
  const warmHeadHaloMaterial = createHaloMaterial(palette.warm, 0.10);
  const tailHaloMaterial = createHaloMaterial(palette.red, 0.105);
  const headStreakMaterial = createHaloMaterial(0x8edfff, 0.125);
  const tailStreakMaterial = createHaloMaterial(palette.red, 0.105);
  for (const material of [headStreakMaterial, tailStreakMaterial]) {
    material.alphaMap = streakAlphaTexture;
    material.needsUpdate = true;
  }
  const contactShadowMaterial = createHaloMaterial(0x000000, 0.34);
  contactShadowMaterial.name = "Soft grounded tire contact shadow";
  contactShadowMaterial.alphaMap = contactShadowTexture;
  contactShadowMaterial.blending = THREE.NormalBlending;
  contactShadowMaterial.polygonOffset = true;
  contactShadowMaterial.polygonOffsetFactor = -2;
  contactShadowMaterial.needsUpdate = true;
  const sprayMaterial = createMistMaterial(0x86aebe, 0.075);
  const materials = new Set([
    rubberMaterial,
    rimMaterial,
    bumperMaterial,
    grilleMaterial,
    glassMaterial,
    interiorMaterial,
    seatMaterial,
    lampHousingMaterial,
    tailHousingMaterial,
    coolHeadlightMaterial,
    warmHeadlightMaterial,
    tailLightMaterial,
    plateMaterial,
    taxiSignMaterial,
    cyanAdvertMaterial,
    magentaAdvertMaterial,
    coolHeadHaloMaterial,
    warmHeadHaloMaterial,
    tailHaloMaterial,
    headStreakMaterial,
    tailStreakMaterial,
    contactShadowMaterial,
    sprayMaterial,
  ]);

  const shared = {
    unitBox,
    roundedBodyGeometry,
    roundedDetailGeometry,
    slopedHoodGeometry,
    wheelGeometry,
    rimGeometry,
    wheelArchGeometry,
    windowGeometry,
    seatGeometry,
    lampLensGeometry,
    contactShadowGeometry,
    haloGeometry,
    streakGeometry,
    sprayGeometry,
    rubberMaterial,
    rimMaterial,
    bumperMaterial,
    grilleMaterial,
    glassMaterial,
    interiorMaterial,
    seatMaterial,
    lampHousingMaterial,
    tailHousingMaterial,
    coolHeadlightMaterial,
    warmHeadlightMaterial,
    tailLightMaterial,
    plateMaterial,
    taxiSignMaterial,
    cyanAdvertMaterial,
    magentaAdvertMaterial,
    coolHeadHaloMaterial,
    warmHeadHaloMaterial,
    tailHaloMaterial,
    headStreakMaterial,
    tailStreakMaterial,
    contactShadowMaterial,
    sprayMaterial,
  };

  const vehicles = [];
  const perDirection = VEHICLE_COUNT / 2;
  const longestVehicle = Math.max(...MODELS.map(model => model.length));
  if (CONVOY_SPACING <= longestVehicle + 8) {
    throw new Error("Traffic loop is too short for the fixed non-overlapping convoys.");
  }
  for (let index = 0; index < VEHICLE_COUNT; ++index) {
    const model = MODELS[index];
    const paintMaterial = createVehiclePaint(
      PAINT_COLORS[index],
      environment,
      model.kind === "van" || model.kind === "delivery" ? 0.16 : 0.105 + random() * 0.035,
    );
    materials.add(paintMaterial);
    const vehicle = buildVehicle(shared, model, paintMaterial, index);
    const direction = index < perDirection ? 1 : -1;
    const directionIndex = index % perDirection;
    const laneX = direction > 0 ? -2.35 : 2.35;
    // Three vehicles share the single lane in each direction, exactly one
    // third-loop apart. A common direction speed makes their order and very
    // generous longitudinal clearance invariant across every loop wrap.
    const offset = directionIndex * CONVOY_SPACING;
    const speed = direction > 0 ? DIRECTION_SPEED.forward : DIRECTION_SPEED.reverse;
    const proxyScale = new THREE.Matrix4().makeScale(
      model.width / 1.82,
      model.van ? 1.20 : model.kind === "suv" ? 1.10 : 1,
      model.length / 4.40,
    );
    Object.assign(vehicle, {
      direction,
      laneX,
      offset,
      speed,
      phase: random() * Math.PI * 2,
      proxyScale,
    });
    vehicle.root.rotation.y = direction > 0 ? 0 : Math.PI;
    group.add(vehicle.root);
    vehicles.push(vehicle);
  }

  const heroVehicle = vehicles.find(vehicle => vehicle.model.kind === "suv" && vehicle.direction < 0);
  if (!heroVehicle) throw new Error("The reverse-direction cinematic SUV was not created.");
  heroVehicle.root.userData.cinematicHero = true;
  const heroRearAnchor = new THREE.Object3D();
  heroRearAnchor.name = "Hero SUV read-only rear camera pose";
  heroRearAnchor.position.set(0, 0.72, -heroVehicle.model.length * 0.5 - 0.16);
  heroVehicle.root.add(heroRearAnchor);

  // Callers receive copies in their own reusable vectors; the authored anchor
  // itself is deliberately not exposed, so scene code cannot move the vehicle.
  const cinematicAnchor = Object.freeze({
    vehicleName: heroVehicle.root.name,
    direction: heroVehicle.direction,
    speed: heroVehicle.speed,
    getPose(target = {}) {
      const position = target.position?.isVector3 ? target.position : new THREE.Vector3();
      const quaternion = target.quaternion?.isQuaternion ? target.quaternion : new THREE.Quaternion();
      const forward = target.forward?.isVector3 ? target.forward : new THREE.Vector3();
      const up = target.up?.isVector3 ? target.up : new THREE.Vector3();
      heroRearAnchor.updateWorldMatrix(true, false);
      heroRearAnchor.getWorldPosition(position);
      heroRearAnchor.getWorldQuaternion(quaternion);
      forward.set(0, 0, 1).applyQuaternion(quaternion).normalize();
      up.set(0, 1, 0).applyQuaternion(quaternion).normalize();
      return { position, quaternion, forward, up };
    },
  });

  const proxy = createRtxProxy();
  const rtxInstanceGroup = Object.freeze({
    id: RTX_INSTANCE_GROUP_ID,
    capacity: VEHICLE_COUNT,
    positions: proxy.positions,
    indices: proxy.indices,
    triangleRadiance: proxy.triangleRadiance,
    triangleSurface: proxy.triangleSurface,
  });
  const rtxMatrices = new Float32Array(VEHICLE_COUNT * 12);
  const rtxMasks = new Uint32Array(VEHICLE_COUNT);
  const rtxWorldMatrix = new THREE.Matrix4();
  let rainEnabled = true;
  let sprayClock = 0;

  function update(time, delta) {
    const t = Number.isFinite(Number(time)) ? Number(time) : 0;
    const dt = THREE.MathUtils.clamp(Number(delta) || 0, 0, 0.05);
    sprayClock += dt;

    for (let index = 0; index < vehicles.length; ++index) {
      const vehicle = vehicles[index];
      const distance = positiveModulo(vehicle.offset + t * vehicle.speed, STREET_SPAN);
      const z = vehicle.direction > 0
        ? STREET_MIN_Z + distance
        : STREET_MAX_Z - distance;
      // The tire torus has unit outer radius before scaling, so this fixed root
      // height keeps every sidewall tangent to the road instead of hovering.
      vehicle.root.position.set(vehicle.laneX, ROAD_Y, z);

      const wheelAngle = -positiveModulo(vehicle.offset + t * vehicle.speed, Math.PI * 2 * vehicle.model.wheelRadius) /
        vehicle.model.wheelRadius;
      for (const wheel of vehicle.wheels) wheel.rotation.x = wheelAngle;

      for (let sprayIndex = 0; sprayIndex < vehicle.sprays.length; ++sprayIndex) {
        const spray = vehicle.sprays[sprayIndex];
        const flutter = 0.86 + Math.sin(sprayClock * 8.4 + vehicle.phase + sprayIndex * 1.7) * 0.16;
        spray.visible = rainEnabled;
        spray.scale.z = flutter;
        spray.scale.y = flutter * (vehicle.model.van ? 1.13 : 0.94);
      }
      for (let streakIndex = 0; streakIndex < vehicle.streaks.length; ++streakIndex) {
        const streak = vehicle.streaks[streakIndex];
        streak.visible = rainEnabled;
        const shimmer = 0.94 + Math.sin(t * 4.3 + vehicle.phase + streakIndex) * 0.055;
        streak.scale.x = streak.userData.baseStreakWidth * shimmer;
      }
    }
  }

  function setRainEnabled(enabled) {
    rainEnabled = Boolean(enabled);
    for (const vehicle of vehicles) {
      for (const spray of vehicle.sprays) spray.visible = rainEnabled;
      for (const streak of vehicle.streaks) streak.visible = rainEnabled;
    }
  }

  function rayTracingInstanceUpdate() {
    group.updateWorldMatrix(true, true);
    for (let slot = 0; slot < VEHICLE_COUNT; ++slot) {
      const vehicle = vehicles[slot];
      rtxWorldMatrix.multiplyMatrices(vehicle.root.matrixWorld, vehicle.proxyScale);
      const e = rtxWorldMatrix.elements;
      const offset = slot * 12;
      rtxMatrices[offset] = e[0];
      rtxMatrices[offset + 1] = e[4];
      rtxMatrices[offset + 2] = e[8];
      rtxMatrices[offset + 3] = e[12];
      rtxMatrices[offset + 4] = e[1];
      rtxMatrices[offset + 5] = e[5];
      rtxMatrices[offset + 6] = e[9];
      rtxMatrices[offset + 7] = e[13];
      rtxMatrices[offset + 8] = e[2];
      rtxMatrices[offset + 9] = e[6];
      rtxMatrices[offset + 10] = e[10];
      rtxMatrices[offset + 11] = e[14];
      rtxMasks[slot] = 0xff;
    }
    return { id: RTX_INSTANCE_GROUP_ID, matrices: rtxMatrices, masks: rtxMasks };
  }

  // Populate visual and native transforms before the first frame is rendered.
  update(0, 0);

  function dispose() {
    scene.remove(group);
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  }

  return {
    group,
    rtxInstanceGroup,
    rayTracingInstanceUpdate,
    update,
    setRainEnabled,
    cinematicAnchor,
    dispose,
  };
}
