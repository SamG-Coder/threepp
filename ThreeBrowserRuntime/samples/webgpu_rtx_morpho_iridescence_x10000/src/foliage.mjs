import * as THREE from "three/webgpu";

import { createSeededRandom, MORPHO_SEED } from "./morpho-model.mjs";

const HERO_FERN_ORIGIN = Object.freeze([0.35, 0, 0.2]);
const HERO_FROND_COUNT = 8;
const HERO_PINNA_PAIRS = 16;
const PERCH_FROND_INDEX = 0;
const PERCH_T = 0.36;
const PERCH_PAD_LIFT = 0.016;

const scratchPosition = new THREE.Vector3();
const scratchTangent = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchSide = new THREE.Vector3();
const scratchLeafDir = new THREE.Vector3();
const scratchLeafNormal = new THREE.Vector3();
const scratchAxisX = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();
const scratchEuler = new THREE.Euler();
const dummy = new THREE.Object3D();

const MOSS_SITES = Object.freeze([
  Object.freeze([0.96, 0.78, 0.78, 0.16]),
  Object.freeze([1.18, -0.38, 0.92, 0.18]),
  Object.freeze([0.68, -1.08, 0.7, 0.14]),
  Object.freeze([-0.12, 1.14, 0.84, 0.17]),
  Object.freeze([-1.08, 0.74, 0.88, 0.19]),
  Object.freeze([-1.24, -0.52, 0.76, 0.15]),
  Object.freeze([-0.52, -1.2, 0.82, 0.16]),
  Object.freeze([1.4, 0.36, 0.64, 0.13]),
  Object.freeze([0.18, 1.36, 0.58, 0.12]),
]);

const COMPANION_FERNS = Object.freeze([
  Object.freeze({ x: 1.08, z: -0.58, scale: 0.58, yaw: 0.42, fronds: 6, pairs: 9 }),
  Object.freeze({ x: -0.98, z: 0.88, scale: 0.5, yaw: -1.15, fronds: 5, pairs: 8 }),
  Object.freeze({ x: 0.82, z: 1.18, scale: 0.44, yaw: 2.05, fronds: 5, pairs: 8 }),
]);

const WET_LEAF_SITES = Object.freeze([
  Object.freeze([0.58, 0.018, 0.46, 0.42, 0.18, 1.12, 0.22]),
  Object.freeze([0.18, 0.016, 0.72, -0.55, -0.12, 0.4, 0.2]),
  Object.freeze([-0.72, 0.02, 0.52, 1.05, 0.08, -0.6, 0.18]),
  Object.freeze([1.02, 0.02, -0.22, 0.22, -0.16, 2.3, 0.24]),
  Object.freeze([-0.38, 0.014, -0.96, 2.4, 0.1, 0.85, 0.19]),
  Object.freeze([0.74, 0.017, -0.82, -1.35, 0.14, -1.7, 0.21]),
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function shadow(object, cast = true, receive = true) {
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
}

function ignoreDetailedFronds(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function applyMossMap(material, texture) {
  if (!texture || !material) return material;
  const map = texture.clone();
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.35, 2.35);
  map.anisotropy = Math.max(finite(map.anisotropy, 1), 8);
  map.needsUpdate = true;
  material.map = map;
  material.needsUpdate = true;
  return material;
}

function createPhysicalMaterial(source, spec) {
  const material = source?.isMaterial
    ? source.clone()
    : new THREE.MeshPhysicalNodeMaterial();
  material.name = spec.name;
  if (material.color?.isColor) material.color.set(spec.color);
  else material.color = new THREE.Color(spec.color);
  material.roughness = spec.roughness;
  material.metalness = spec.metalness ?? 0;
  material.transparent = false;
  material.opacity = 1;
  material.transmission = 0;
  material.depthWrite = true;
  material.side = spec.side ?? THREE.FrontSide;
  material.flatShading = false;
  if (spec.map) applyMossMap(material, spec.map);
  if (spec.clearcoat != null) material.clearcoat = spec.clearcoat;
  if (spec.clearcoatRoughness != null) material.clearcoatRoughness = spec.clearcoatRoughness;
  if (spec.sheen != null) material.sheen = spec.sheen;
  if (spec.sheenColor != null) {
    if (material.sheenColor?.isColor) material.sheenColor.set(spec.sheenColor);
    else material.sheenColor = new THREE.Color(spec.sheenColor);
  }
  if (spec.sheenRoughness != null) material.sheenRoughness = spec.sheenRoughness;
  if (spec.ior != null) material.ior = spec.ior;
  if (Number.isFinite(spec.rtxReflectionMask)) {
    material.rtxReflectionMask = spec.rtxReflectionMask;
  }
  return material;
}

function createPinnaGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.name = "Fern pinna leaflet";
  const rows = 7;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; ++row) {
    const t = row / rows;
    const z = t * 0.108;
    const lobe = 1 + Math.sin(t * Math.PI * 7.5) * 0.07 * (1 - t);
    const width = 0.027 * Math.sin(Math.PI * Math.min(0.999, t * 0.9 + 0.05)) * (1 - t * 0.16) * lobe;
    const y = Math.sin(t * Math.PI) * 0.0038;
    positions.push(-width, y, z, width, y, z);
    uvs.push(0, t, 1, t);
    if (row === 0) continue;
    const a = (row - 1) * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createBroadLeafGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.name = "Broad wet greenhouse leaf";
  const lengthSegments = 12;
  const widthSegments = 8;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= lengthSegments; ++row) {
    const u = row / lengthSegments;
    for (let col = 0; col <= widthSegments; ++col) {
      const v = col / widthSegments - 0.5;
      const profile = Math.sin(Math.PI * Math.min(0.999, u * 0.92 + 0.04)) * (1 - u * 0.12);
      const boat = (0.5 - Math.abs(v) * 1.15) * Math.sin(Math.PI * u) * 0.055;
      const wave = Math.sin(u * 6.2 + v * 3.1) * 0.01 * (1 - Math.abs(v) * 1.4);
      positions.push(
        v * 0.46 * Math.max(0.04, profile),
        boat + wave,
        u * 0.62,
      );
      uvs.push(col / widthSegments, u);
    }
  }
  const stride = widthSegments + 1;
  for (let row = 0; row < lengthSegments; ++row) {
    for (let col = 0; col < widthSegments; ++col) {
      const a = row * stride + col;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createMossBlobGeometry(random) {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  geometry.name = "Lumpy wet moss mound";
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; ++index) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const radial = 0.78 + random() * 0.34 + Math.sin(x * 5.1 + z * 3.7) * 0.08;
    position.setXYZ(index, x * radial, y * radial * 0.58, z * radial);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFrondCurve({ length, height, yaw, lean, drop }) {
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const points = [];
  for (let step = 0; step <= 8; ++step) {
    const t = step / 8;
    const radial = length * (0.05 + 0.95 * t);
    const rise = height * Math.sin(t * Math.PI * 0.74) * (1 - t * drop);
    const side = lean * t * t;
    points.push(new THREE.Vector3(
      sinYaw * radial + cosYaw * side,
      rise,
      cosYaw * radial - sinYaw * side,
    ));
  }
  return new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.18);
}

function frondFrame(curve, t, targetNormal = scratchNormal, targetTangent = scratchTangent, targetSide = scratchSide) {
  curve.getTangent(t, targetTangent).normalize();
  targetSide.set(-targetTangent.z, 0, targetTangent.x);
  if (targetSide.lengthSq() < 1e-8) targetSide.set(1, 0, 0);
  targetSide.normalize();
  targetNormal.crossVectors(targetTangent, targetSide).normalize();
  if (targetNormal.y < 0) {
    targetNormal.negate();
    targetSide.negate();
  }
  targetSide.crossVectors(targetNormal, targetTangent).normalize();
  targetNormal.crossVectors(targetTangent, targetSide).normalize();
  return { normal: targetNormal, tangent: targetTangent, side: targetSide };
}

function orientationFromBasis(xAxis, yAxis, zAxis) {
  scratchMatrix.makeBasis(xAxis, yAxis, zAxis);
  return scratchQuaternion.setFromRotationMatrix(scratchMatrix);
}

function createFern({
  name,
  origin,
  yaw0,
  frondCount,
  pinnaPairs,
  length,
  height,
  scale = 1,
  random,
  pinnaGeometry,
  pinnaMaterial,
  rachisMaterial,
  crownMaterial,
  wetLeafMaterial,
  perchFrondIndex = -1,
}) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(origin[0], origin[1], origin[2]);

  const crown = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.058 * scale, 14, 10), crownMaterial));
  crown.name = `${name} rhizome crown`;
  crown.scale.set(1.35, 0.52, 1.32);
  crown.position.y = 0.045 * scale;
  group.add(crown);

  const pinnaCount = frondCount * (pinnaPairs * 2 + 1);
  const pinnae = ignoreDetailedFronds(
    new THREE.InstancedMesh(pinnaGeometry, pinnaMaterial, pinnaCount),
  );
  pinnae.name = `${name} detailed pinnae`;
  pinnae.castShadow = true;
  pinnae.receiveShadow = true;
  pinnae.frustumCulled = true;

  let pinnaIndex = 0;
  let perch = null;

  for (let frond = 0; frond < frondCount; ++frond) {
    const yaw = yaw0 + (frond / frondCount) * Math.PI * 2 + (random() - 0.5) * 0.17;
    const lengthScale = (0.82 + random() * 0.22) * scale;
    const heightScale = (0.88 + random() * 0.18) * scale;
    const curve = createFrondCurve({
      length: length * lengthScale,
      height: height * heightScale,
      yaw,
      lean: (random() - 0.5) * 0.12 * scale,
      drop: 0.22 + random() * 0.16,
    });
    const rachisRadius = 0.0064 * scale * (frond === perchFrondIndex ? 1.15 : 1);
    const rachis = shadow(new THREE.Mesh(
      new THREE.TubeGeometry(curve, 11, rachisRadius, 5, false),
      rachisMaterial,
    ));
    rachis.name = `${name} frond rachis ${frond + 1}`;
    group.add(rachis);

    if (frond === perchFrondIndex) {
      curve.getPoint(PERCH_T, scratchPosition);
      const frame = frondFrame(curve, PERCH_T);
      scratchPosition.addScaledVector(frame.normal, PERCH_PAD_LIFT * scale);
      const pad = shadow(new THREE.Mesh(pinnaGeometry, wetLeafMaterial));
      pad.name = `${name} Morpho perch pinna`;
      pad.position.copy(scratchPosition);
      scratchAxisX.crossVectors(frame.normal, frame.side).normalize();
      pad.quaternion.copy(orientationFromBasis(scratchAxisX, frame.normal, frame.side));
      pad.scale.set(2.8 * scale, 1.8 * scale, 4.4 * scale);
      group.add(pad);

      const world = scratchPosition.clone();
      world.x += origin[0];
      world.y += origin[1];
      world.z += origin[2];
      scratchEuler.setFromQuaternion(pad.quaternion, "XYZ");
      perch = Object.freeze({
        position: Object.freeze([world.x, world.y, world.z]),
        rotation: Object.freeze([scratchEuler.x, scratchEuler.y, scratchEuler.z]),
      });
    }

    for (let pair = 0; pair < pinnaPairs; ++pair) {
      const t = 0.12 + (pair / Math.max(1, pinnaPairs - 1)) * 0.82;
      curve.getPoint(t, scratchPosition);
      const frame = frondFrame(curve, t);
      const taper = 1.12 - t * 0.62;
      const lengthJitter = 0.86 + random() * 0.28;
      const sideX = frame.side.x;
      const sideY = frame.side.y;
      const sideZ = frame.side.z;
      const normalX = frame.normal.x;
      const normalY = frame.normal.y;
      const normalZ = frame.normal.z;
      for (const sign of [-1, 1]) {
        const droop = 0.18 + random() * 0.12;
        scratchLeafDir.set(sideX * sign, sideY * sign, sideZ * sign);
        scratchLeafNormal.set(normalX, normalY, normalZ);
        scratchLeafNormal.applyAxisAngle(scratchLeafDir, sign * droop * 0.35);
        scratchLeafNormal.normalize();
        if (scratchLeafNormal.y < 0) scratchLeafNormal.negate();
        scratchAxisX.crossVectors(scratchLeafNormal, scratchLeafDir).normalize();
        dummy.position.copy(scratchPosition);
        dummy.quaternion.copy(orientationFromBasis(scratchAxisX, scratchLeafNormal, scratchLeafDir));
        dummy.scale.set(
          taper * scale * (0.92 + random() * 0.18),
          scale,
          taper * lengthJitter * scale,
        );
        dummy.updateMatrix();
        pinnae.setMatrixAt(pinnaIndex++, dummy.matrix);
      }
    }

    curve.getPoint(0.97, scratchPosition);
    const tip = frondFrame(curve, 0.97);
    scratchAxisX.crossVectors(tip.normal, tip.tangent).normalize();
    dummy.position.copy(scratchPosition);
    dummy.quaternion.copy(orientationFromBasis(scratchAxisX, tip.normal, tip.tangent));
    dummy.scale.set(0.72 * scale, scale, 0.9 * scale);
    dummy.updateMatrix();
    pinnae.setMatrixAt(pinnaIndex++, dummy.matrix);
  }

  pinnae.count = pinnaIndex;
  pinnae.instanceMatrix.needsUpdate = true;
  pinnae.computeBoundingSphere();
  group.add(pinnae);
  return { group, pinnae, perch };
}

function fillMossMounds({ geometry, material, random, originAvoid, fernAvoid }) {
  const blobCount = MOSS_SITES.length * 3;
  const mesh = new THREE.InstancedMesh(geometry, material, blobCount);
  mesh.name = "Opaque wet moss mounds";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  let index = 0;
  for (const [siteX, siteZ, radius, height] of MOSS_SITES) {
    const x = siteX + (random() - 0.5) * 0.08;
    const z = siteZ + (random() - 0.5) * 0.08;
    const dxOrigin = x - originAvoid[0];
    const dzOrigin = z - originAvoid[1];
    if (dxOrigin * dxOrigin + dzOrigin * dzOrigin < 0.22 * 0.22) continue;
    const dxFern = x - fernAvoid[0];
    const dzFern = z - fernAvoid[1];
    const fernClear = dxFern * dxFern + dzFern * dzFern < 0.12 * 0.12;
    for (let blob = 0; blob < 3; ++blob) {
      const angle = blob * 2.15 + random() * 0.4;
      const spread = (blob === 0 ? 0 : 0.09 + random() * 0.07) * radius;
      dummy.position.set(
        x + Math.cos(angle) * spread,
        height * (0.42 + random() * 0.12) * (fernClear ? 0.72 : 1),
        z + Math.sin(angle) * spread,
      );
      dummy.rotation.set(random() * 0.35, random() * Math.PI * 2, random() * 0.28);
      const size = radius * (0.55 + random() * 0.38);
      dummy.scale.set(
        size * (0.9 + random() * 0.28),
        height * (0.85 + random() * 0.4),
        size * (0.88 + random() * 0.3),
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index++, dummy.matrix);
    }
  }
  mesh.count = index;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function fillWetLeaves({ geometry, material, random }) {
  const mesh = new THREE.InstancedMesh(geometry, material, WET_LEAF_SITES.length);
  mesh.name = "Broad wet clearcoat leaves";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  for (let index = 0; index < WET_LEAF_SITES.length; ++index) {
    const [x, y, z, yaw, pitch, roll, size] = WET_LEAF_SITES[index];
    dummy.position.set(
      x + (random() - 0.5) * 0.04,
      y,
      z + (random() - 0.5) * 0.04,
    );
    dummy.rotation.set(
      pitch + (random() - 0.5) * 0.06,
      yaw + (random() - 0.5) * 0.1,
      roll + (random() - 0.5) * 0.08,
    );
    const leafScale = size * (0.92 + random() * 0.14);
    dummy.scale.set(leafScale * (0.9 + random() * 0.16), leafScale, leafScale);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/**
 * Greenhouse understory: one Morpho perch fern, opaque moss mounds for the
 * static BLAS, and a handful of wet clearcoat leaves. Detailed pinnae stay on
 * the raster path so the triangle budget is spent on architecture and water.
 */
export function createFoliage({ materials, mossTexture, seed = MORPHO_SEED } = {}) {
  const random = createSeededRandom(finite(seed, MORPHO_SEED) >>> 0);
  const geoRandom = createSeededRandom((finite(seed, MORPHO_SEED) ^ 0x6d6f7373) >>> 0);

  const group = new THREE.Group();
  group.name = "Greenhouse foliage";

  const opaqueRoot = new THREE.Group();
  opaqueRoot.name = "Opaque greenhouse foliage";
  group.add(opaqueRoot);

  const mossMaterial = createPhysicalMaterial(materials?.moss, {
    name: "Wet greenhouse moss",
    color: 0x3a5a32,
    roughness: 0.86,
    metalness: 0,
    map: mossTexture,
    sheen: 0.18,
    sheenColor: 0x6a8a48,
    sheenRoughness: 0.82,
    rtxReflectionMask: 0.07,
  });
  const crownMaterial = createPhysicalMaterial(materials?.moss, {
    name: "Fern rhizome and mossy crown",
    color: 0x2c3d28,
    roughness: 0.9,
    metalness: 0,
    map: mossTexture,
    rtxReflectionMask: 0.05,
  });
  const rachisMaterial = createPhysicalMaterial(materials?.stone, {
    name: "Fern rachis chitin-green stem",
    color: 0x3d5a32,
    roughness: 0.68,
    metalness: 0,
    rtxReflectionMask: 0.06,
  });
  const pinnaMaterial = createPhysicalMaterial(materials?.moss, {
    name: "Fern pinna lamina",
    color: 0x1d4a30,
    roughness: 0.54,
    metalness: 0,
    side: THREE.DoubleSide,
    sheen: 0.22,
    sheenColor: 0x4f8a52,
    sheenRoughness: 0.55,
    rtxReflectionMask: 0.08,
  });
  const wetLeafMaterial = createPhysicalMaterial(materials?.moss, {
    name: "Broad wet leaf with clearcoat",
    color: 0x164a32,
    roughness: 0.22,
    metalness: 0.02,
    side: THREE.DoubleSide,
    clearcoat: 0.92,
    clearcoatRoughness: 0.09,
    sheen: 0.35,
    sheenColor: 0x3d7a58,
    sheenRoughness: 0.4,
    ior: 1.45,
    rtxReflectionMask: 0.38,
  });

  const pinnaGeometry = createPinnaGeometry();
  const leafGeometry = createBroadLeafGeometry();
  const mossGeometry = createMossBlobGeometry(geoRandom);

  const pondAvoid = [0, 0];
  const moss = fillMossMounds({
    geometry: mossGeometry,
    material: mossMaterial,
    random,
    originAvoid: pondAvoid,
    fernAvoid: [HERO_FERN_ORIGIN[0], HERO_FERN_ORIGIN[2]],
  });
  opaqueRoot.add(shadow(moss, true, true));

  const wetLeaves = fillWetLeaves({
    geometry: leafGeometry,
    material: wetLeafMaterial,
    random,
  });
  opaqueRoot.add(wetLeaves);

  const perchYaw = Math.atan2(-HERO_FERN_ORIGIN[0], -HERO_FERN_ORIGIN[2]);
  const hero = createFern({
    name: "Hero perch fern",
    origin: HERO_FERN_ORIGIN,
    yaw0: perchYaw,
    frondCount: HERO_FROND_COUNT,
    pinnaPairs: HERO_PINNA_PAIRS,
    length: 0.78,
    height: 0.92,
    scale: 1,
    random,
    pinnaGeometry,
    pinnaMaterial,
    rachisMaterial,
    crownMaterial,
    wetLeafMaterial,
    perchFrondIndex: PERCH_FROND_INDEX,
  });
  opaqueRoot.add(hero.group);

  const skirt = shadow(new THREE.Mesh(mossGeometry, mossMaterial));
  skirt.name = "Hero fern basal moss skirt";
  skirt.position.set(0, 0.045, 0);
  skirt.scale.set(0.16, 0.07, 0.15);
  hero.group.add(skirt);

  for (let curl = 0; curl < 3; ++curl) {
    const fiddlehead = shadow(new THREE.Mesh(
      new THREE.TorusGeometry(0.028, 0.0065, 7, 12, Math.PI * 1.55),
      rachisMaterial,
    ));
    fiddlehead.name = `Hero fern fiddlehead ${curl + 1}`;
    const angle = perchYaw + 1.15 + curl * 0.85;
    fiddlehead.position.set(Math.sin(angle) * 0.05, 0.07 + curl * 0.012, Math.cos(angle) * 0.05);
    fiddlehead.rotation.set(-0.55, angle, 0.4);
    hero.group.add(fiddlehead);
  }

  for (const spec of COMPANION_FERNS) {
    const companion = createFern({
      name: `Companion fern ${spec.x.toFixed(2)}`,
      origin: [spec.x, 0, spec.z],
      yaw0: spec.yaw,
      frondCount: spec.fronds,
      pinnaPairs: spec.pairs,
      length: 0.62,
      height: 0.7,
      scale: spec.scale,
      random,
      pinnaGeometry,
      pinnaMaterial,
      rachisMaterial,
      crownMaterial,
      wetLeafMaterial,
      perchFrondIndex: -1,
    });
    opaqueRoot.add(companion.group);
  }

  const perch = hero.perch ?? Object.freeze({
    position: Object.freeze([
      HERO_FERN_ORIGIN[0] + 0.16,
      0.68,
      HERO_FERN_ORIGIN[2] - 0.04,
    ]),
    rotation: Object.freeze([-0.42, perchYaw, 0]),
  });

  return Object.freeze({
    group,
    opaqueRoot,
    heroFern: hero.group,
    perch,
  });
}
