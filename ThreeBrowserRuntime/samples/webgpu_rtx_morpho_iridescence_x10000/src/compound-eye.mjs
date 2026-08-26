import * as THREE from "three/webgpu";

import { OMMATIDIA, OMMATIDIA_COUNT } from "./ommatidia-model.mjs";

const EYE_RADIUS = 0.048;
const EYE_SEPARATION = 0.092;
const EYE_FORWARD = 0.034;
const EYE_LIFT = 0.012;
const EYE_YAW = Math.PI * 0.5 - 0.4;
const DEFAULT_HEX_RADIUS = 0.007;
const DOME_HEIGHT_SCALE = 0.62;

const unitY = new THREE.Vector3(0, 1, 0);
const scratchColor = new THREE.Color();
const scratchMatrix = new THREE.Matrix4();
const scratchNormal = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchSpin = new THREE.Quaternion();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function createHexDomeGeometry() {
  const sides = 6;
  const rings = 4;
  const radius = 1;
  const height = 0.58;
  const positions = [0, height, 0];
  const uvs = [0.5, 0.5];
  const indices = [];

  for (let ring = 1; ring <= rings; ++ring) {
    const t = ring / rings;
    const polar = t * Math.PI * 0.5;
    const y = Math.cos(polar) * height;
    const ringRadius = Math.sin(polar) * radius;
    for (let side = 0; side < sides; ++side) {
      const angle = side * Math.PI * 2 / sides + Math.PI / 6;
      const x = Math.cos(angle) * ringRadius;
      const z = Math.sin(angle) * ringRadius;
      positions.push(x, y, z);
      uvs.push(0.5 + x * 0.5, 0.5 + z * 0.5);
    }
  }

  for (let side = 0; side < sides; ++side) {
    const current = 1 + side;
    const next = 1 + (side + 1) % sides;
    indices.push(0, next, current);
  }

  for (let ring = 0; ring < rings - 1; ++ring) {
    const ringStart = 1 + ring * sides;
    const nextStart = ringStart + sides;
    for (let side = 0; side < sides; ++side) {
      const a = ringStart + side;
      const b = ringStart + (side + 1) % sides;
      const c = nextStart + side;
      const d = nextStart + (side + 1) % sides;
      indices.push(b, a, d, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.name = "Ommatidium hexagonal corneal dome";
  return geometry;
}

function createEyeMaterial({ texture, materials } = {}) {
  const material = materials?.eye?.isMaterial
    ? materials.eye.clone()
    : new THREE.MeshPhysicalNodeMaterial({
      name: "Morpho compound-eye corneal mosaic",
      color: texture ? 0xffffff : 0x12181c,
      roughness: 0.22,
      metalness: 0.04,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
      ior: 1.56,
      transparent: false,
      transmission: 0,
    });

  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    material.map = texture;
    if (material.color?.isColor) material.color.set(0xffffff);
  }

  material.transparent = false;
  material.transmission = 0;
  material.vertexColors = true;
  return material;
}

function partitionEyes(ommatidia) {
  const left = [];
  const right = [];
  for (const omma of ommatidia) {
    if (omma?.eye === "right") right.push(omma);
    else left.push(omma);
  }
  return { left, right };
}

function composeOmmatidiumMatrix(omma) {
  const theta = finite(omma.theta);
  const phi = finite(omma.phi);
  const sinTheta = Math.sin(theta);
  const radius = EYE_RADIUS * finite(omma.radius, 1);
  const hexRadius = EYE_RADIUS * Math.max(1e-4, finite(omma.hexRadius, DEFAULT_HEX_RADIUS));

  scratchNormal.set(
    sinTheta * Math.cos(phi),
    sinTheta * Math.sin(phi),
    Math.cos(theta),
  );
  if (scratchNormal.lengthSq() < 1e-8) scratchNormal.set(0, 0, 1);
  else scratchNormal.normalize();

  scratchPosition.copy(scratchNormal).multiplyScalar(radius);
  scratchQuaternion.setFromUnitVectors(unitY, scratchNormal);
  scratchSpin.setFromAxisAngle(unitY, finite(omma.orientation));
  scratchQuaternion.multiply(scratchSpin);
  scratchScale.set(hexRadius, hexRadius * DOME_HEIGHT_SCALE, hexRadius);
  scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
}

function tintOmmatidium(omma, textured) {
  const hue = finite(omma.hue, 0.08);
  const luminance = THREE.MathUtils.clamp(finite(omma.luminance, 0.5), 0, 1);
  if (textured) {
    scratchColor.setHSL(hue, 0.16, 0.72 + luminance * 0.22);
  } else {
    scratchColor.setHSL(hue, 0.38, 0.07 + luminance * 0.16);
  }
}

function populateEye(mesh, records, textured) {
  mesh.count = records.length;
  for (let index = 0; index < records.length; ++index) {
    const omma = records[index];
    composeOmmatidiumMatrix(omma);
    mesh.setMatrixAt(index, scratchMatrix);
    tintOmmatidium(omma, textured);
    mesh.setColorAt(index, scratchColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere?.();
}

function createEyeMesh(name, geometry, material, records, textured) {
  const mesh = ignoreDynamicRtx(new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(1, records.length),
  ));
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  populateEye(mesh, records, textured);
  return mesh;
}

/**
 * Two hex-dome InstancedMeshes packed from the ommatidia hemisphere model.
 * Opaque corneal chitin, but rtxIgnore because the head is animated.
 */
export function createCompoundEyes({
  texture,
  ommatidia = OMMATIDIA,
  materials,
} = {}) {
  const list = Array.isArray(ommatidia) ? ommatidia : OMMATIDIA;
  const { left: leftRecords, right: rightRecords } = partitionEyes(list);
  const textured = Boolean(texture);
  const material = createEyeMaterial({ texture, materials });
  const geometry = createHexDomeGeometry();

  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = `Morpho compound eyes (${list.length || OMMATIDIA_COUNT} ommatidia)`;

  const left = ignoreDynamicRtx(new THREE.Group());
  left.name = "Left compound eye";
  left.position.set(-EYE_SEPARATION * 0.5, EYE_LIFT, EYE_FORWARD);
  left.rotation.set(0.12, -EYE_YAW, 0.1);

  const right = ignoreDynamicRtx(new THREE.Group());
  right.name = "Right compound eye";
  right.position.set(EYE_SEPARATION * 0.5, EYE_LIFT, EYE_FORWARD);
  right.rotation.set(0.12, EYE_YAW, -0.1);

  const leftMesh = createEyeMesh(
    "Left hex-dome ommatidia",
    geometry,
    material,
    leftRecords,
    textured,
  );
  const rightMesh = createEyeMesh(
    "Right hex-dome ommatidia",
    geometry,
    material,
    rightRecords,
    textured,
  );

  left.add(leftMesh);
  right.add(rightMesh);
  group.add(left, right);

  return Object.freeze({
    group,
    left,
    right,
    count: list.length,
  });
}
