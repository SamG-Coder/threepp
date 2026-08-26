import * as THREE from "three/webgpu";
import { float, vec3 } from "three/tsl";

import {
  STROMAL_FIBRES,
  STROMAL_FIBRE_CHECKSUM,
  STROMAL_FIBRE_COUNT,
  UNIVERSE_EYE_SEED,
} from "./universe-eye-model.mjs";
import { createEyeDynamics } from "./eye-dynamics.mjs";

const EYE_RADIUS_MM = 12;
const IRIS_RADIUS_MM = 5.9;
const CORNEA_APERTURE_MM = 6.42;
const CORNEA_HEIGHT_MM = 2.72;
const IRIS_TEXTURE_INNER = 0.335;
const IRIS_TEXTURE_RADIUS = 0.472;
const LID_HALF_WIDTH_MM = 10.4;
const UPPER_LID_OPEN_MM = 6.15;
const LOWER_LID_OPEN_MM = 5.15;
const LID_X_SEGMENTS = 96;
const LID_Y_SEGMENTS = 14;
const LASH_COUNT = 128;

const scratchColor = new THREE.Color();
const scratchMatrix = new THREE.Matrix4();
const scratchQuaternion = new THREE.Quaternion();
const scratchPosition = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const unitY = new THREE.Vector3(0, 1, 0);
const lashDirection = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value), 0, 1);
}

function setStaticRtxSurface(material, color, roughness = material.roughness ?? 0.6) {
  material.userData.rtxTriangleSurface = [color.r, color.g, color.b, roughness];
  material.userData.rtxTriangleRadiance = [
    color.r * 0.004,
    color.g * 0.004,
    color.b * 0.004,
    1,
  ];
  return material;
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function configureAlbedoTexture(texture, { repeat = [1, 1], mirrored = false } = {}) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = mirrored ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapT = mirrored ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = 16;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createMicroNormalTexture(size = 256, seed = UNIVERSE_EYE_SEED) {
  const side = Math.max(32, Math.trunc(size));
  const heights = new Float32Array(side * side);
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
  for (let y = 0; y < side; ++y) {
    for (let x = 0; x < side; ++x) {
      const wave = Math.sin(x * 0.37 + Math.sin(y * 0.11)) * 0.17 +
        Math.sin(y * 0.29 + Math.cos(x * 0.07)) * 0.13;
      heights[y * side + x] = wave + (random() - 0.5) * 0.34;
    }
  }
  const bytes = new Uint8Array(side * side * 4);
  const at = (x, y) => heights[((y + side) % side) * side + ((x + side) % side)];
  for (let y = 0; y < side; ++y) {
    for (let x = 0; x < side; ++x) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * 0.62;
      const dy = (at(x, y - 1) - at(x, y + 1)) * 0.62;
      const invLength = 1 / Math.hypot(dx, dy, 1);
      const offset = (y * side + x) * 4;
      bytes[offset] = Math.round((dx * invLength * 0.5 + 0.5) * 255);
      bytes[offset + 1] = Math.round((dy * invLength * 0.5 + 0.5) * 255);
      bytes[offset + 2] = Math.round((invLength * 0.5 + 0.5) * 255);
      bytes[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(bytes, side, side, THREE.RGBAFormat);
  texture.name = "Procedural collagen and skin micro-normal";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 5);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSssMaterial(parameters, sss) {
  const material = new THREE.MeshSSSNodeMaterial(parameters);
  material.thicknessColorNode = vec3(...sss.color);
  material.thicknessDistortionNode = float(sss.distortion);
  material.thicknessAmbientNode = float(sss.ambient);
  material.thicknessAttenuationNode = float(sss.attenuation);
  material.thicknessPowerNode = float(sss.power);
  material.thicknessScaleNode = float(sss.scale);
  return material;
}

export function createIrisAnnulusGeometry({
  innerRadius = 2.18,
  outerRadius = IRIS_RADIUS_MM,
  angularSegments = 256,
  radialSegments = 30,
} = {}) {
  const angular = Math.max(32, Math.trunc(angularSegments));
  const radial = Math.max(4, Math.trunc(radialSegments));
  const positions = new Float32Array((angular + 1) * (radial + 1) * 3);
  const normals = new Float32Array((angular + 1) * (radial + 1) * 3);
  const uvs = new Float32Array((angular + 1) * (radial + 1) * 2);
  const indices = [];

  for (let ring = 0; ring <= radial; ++ring) {
    const unit = ring / radial;
    const radius = innerRadius + (outerRadius - innerRadius) * unit;
    const textureRadius = IRIS_TEXTURE_RADIUS * (
      IRIS_TEXTURE_INNER + (1 - IRIS_TEXTURE_INNER) * unit
    );
    const recess = -0.085 * Math.pow(1 - unit, 1.4);
    for (let segment = 0; segment <= angular; ++segment) {
      const angle = segment / angular * Math.PI * 2;
      const vertex = ring * (angular + 1) + segment;
      const p = vertex * 3;
      const uv = vertex * 2;
      positions[p] = Math.cos(angle) * radius;
      positions[p + 1] = Math.sin(angle) * radius;
      positions[p + 2] = recess;
      normals[p + 2] = 1;
      uvs[uv] = 0.5 + Math.cos(angle) * textureRadius;
      uvs[uv + 1] = 0.5 + Math.sin(angle) * textureRadius;
    }
  }
  for (let ring = 0; ring < radial; ++ring) {
    for (let segment = 0; segment < angular; ++segment) {
      const a = ring * (angular + 1) + segment;
      const b = a + angular + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.name = "Deforming polar iris annulus";
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData = { angularSegments: angular, radialSegments: radial, outerRadius };
  return geometry;
}

function updateIrisGeometry(geometry, innerRadius) {
  const position = geometry.getAttribute("position");
  const { angularSegments: angular, radialSegments: radial, outerRadius } = geometry.userData;
  for (let ring = 0; ring <= radial; ++ring) {
    const unit = ring / radial;
    const radius = innerRadius + (outerRadius - innerRadius) * unit;
    for (let segment = 0; segment <= angular; ++segment) {
      const angle = segment / angular * Math.PI * 2;
      const vertex = ring * (angular + 1) + segment;
      position.setXY(vertex, Math.cos(angle) * radius, Math.sin(angle) * radius);
    }
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function almondMargin(x, upper, blink) {
  const absolute = Math.abs(x);
  if (absolute >= LID_HALF_WIDTH_MM) return -0.22 * blink;
  const side = Math.pow(absolute / LID_HALF_WIDTH_MM, 1.72);
  const aperture = Math.sqrt(Math.max(0, 1 - side));
  const open = (upper ? UPPER_LID_OPEN_MM : -LOWER_LID_OPEN_MM) * aperture;
  const closed = -0.24 + (upper ? 0.10 : -0.10) * side;
  const eased = blink * blink * (3 - 2 * blink);
  return THREE.MathUtils.lerp(open, closed, eased);
}

function ocularSurfaceZ(x, y) {
  const radialSquared = x * x + y * y;
  const sclera = Math.sqrt(Math.max(0, EYE_RADIUS_MM * EYE_RADIUS_MM - radialSquared)) * 0.975;
  if (radialSquared > CORNEA_APERTURE_MM * CORNEA_APERTURE_MM) return Math.max(3.4, sclera);
  const cornealUnit = Math.sqrt(Math.max(0, 1 - radialSquared /
    (CORNEA_APERTURE_MM * CORNEA_APERTURE_MM)));
  return Math.max(sclera, 11.48 + CORNEA_HEIGHT_MM * cornealUnit);
}

function createLidPatchGeometry(upper) {
  const xSegments = LID_X_SEGMENTS;
  const ySegments = LID_Y_SEGMENTS;
  const positions = new Float32Array((xSegments + 1) * (ySegments + 1) * 3);
  const uvs = new Float32Array((xSegments + 1) * (ySegments + 1) * 2);
  const indices = [];
  for (let row = 0; row <= ySegments; ++row) {
    for (let column = 0; column <= xSegments; ++column) {
      const vertex = row * (xSegments + 1) + column;
      uvs[vertex * 2] = column / xSegments;
      uvs[vertex * 2 + 1] = row / ySegments;
    }
  }
  for (let row = 0; row < ySegments; ++row) {
    for (let column = 0; column < xSegments; ++column) {
      const a = row * (xSegments + 1) + column;
      const b = a + xSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = upper ? "Upper anatomical lid patch" : "Lower anatomical lid patch";
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData = { upper, xSegments, ySegments };
  return geometry;
}

function updateLidPatchGeometry(geometry, blink) {
  const { upper, xSegments, ySegments } = geometry.userData;
  const position = geometry.getAttribute("position");
  const outerY = upper ? 16 : -16;
  for (let row = 0; row <= ySegments; ++row) {
    const v = row / ySegments;
    for (let column = 0; column <= xSegments; ++column) {
      const u = column / xSegments;
      const x = THREE.MathUtils.lerp(-18, 18, u);
      const margin = almondMargin(x, upper, blink);
      const y = THREE.MathUtils.lerp(margin, outerY, v);
      const z = ocularSurfaceZ(x, y) + (1 - v) * 0.38 - v * 0.24;
      position.setXYZ(row * (xSegments + 1) + column, x, y, z);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function createMarginRibbonGeometry(upper) {
  const segments = 128;
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices = [];
  for (let segment = 0; segment <= segments; ++segment) {
    for (let row = 0; row < 2; ++row) {
      const vertex = segment * 2 + row;
      uvs[vertex * 2] = segment / segments;
      uvs[vertex * 2 + 1] = row;
    }
  }
  for (let segment = 0; segment < segments; ++segment) {
    const a = segment * 2;
    indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.name = upper ? "Upper wet waterline" : "Lower wet tear meniscus";
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData = { upper, segments };
  return geometry;
}

function updateMarginRibbonGeometry(geometry, blink) {
  const { upper, segments } = geometry.userData;
  const position = geometry.getAttribute("position");
  const thickness = upper ? 0.43 : 0.32;
  for (let segment = 0; segment <= segments; ++segment) {
    const x = THREE.MathUtils.lerp(-LID_HALF_WIDTH_MM, LID_HALF_WIDTH_MM, segment / segments);
    const y = almondMargin(x, upper, blink);
    const outward = upper ? 1 : -1;
    for (let row = 0; row < 2; ++row) {
      const offset = row * thickness * outward;
      const vertex = segment * 2 + row;
      position.setXYZ(vertex, x, y + offset, ocularSurfaceZ(x, y) + 0.43 + row * 0.015);
    }
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
}

function createStudioLights(root) {
  const key = new THREE.SpotLight(0xd8ecff, 860, 80, Math.PI * 0.24, 0.62, 2);
  key.name = "Moving ophthalmic softbox key";
  key.position.set(-14, 15, 26);
  key.target.position.set(-1.2, 1, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.018;

  const fill = new THREE.PointLight(0x72a8ff, 210, 65, 2);
  fill.name = "Cool orbital fill";
  fill.position.set(15, -6, 18);

  const rim = new THREE.SpotLight(0xffa78c, 480, 80, Math.PI * 0.28, 0.78, 2);
  rim.name = "Warm limbal rim";
  rim.position.set(12, 12, -4);
  rim.target.position.set(0, 0, 0);

  const ambient = new THREE.HemisphereLight(0x9fbfff, 0x18090d, 0.46);
  ambient.name = "Subsurface ambient dome";
  root.add(key, key.target, fill, rim, rim.target, ambient);
  return { key, fill, rim, ambient, staticLights: [key, fill, rim] };
}

const STUDIO_RIGS = Object.freeze([
  Object.freeze({ name: "ARCTIC SOFTBOX", key: [-14, 15, 26], keyColor: 0xd8ecff, keyEnergy: 860, fill: [15, -6, 18], fillColor: 0x72a8ff, fillEnergy: 210, rimColor: 0xffa78c, rimEnergy: 480, luminance: 0.62 }),
  Object.freeze({ name: "CLINICAL RING", key: [-2, 4, 28], keyColor: 0xf4fbff, keyEnergy: 1180, fill: [11, 4, 22], fillColor: 0xbfdcff, fillEnergy: 145, rimColor: 0x7aa6ff, rimEnergy: 290, luminance: 0.82 }),
  Object.freeze({ name: "NEBULA SPLIT", key: [-18, 5, 20], keyColor: 0x5dc8ff, keyEnergy: 720, fill: [17, -2, 20], fillColor: 0xa05cff, fillEnergy: 260, rimColor: 0xff547c, rimEnergy: 610, luminance: 0.42 }),
]);

/** Build the full macro eye and expose only deterministic, bounded controls. */
export function createUniverseEyeScene(scene, {
  irisTexture,
  scleraTexture,
  seed = UNIVERSE_EYE_SEED,
} = {}) {
  if (!scene?.isScene) throw new TypeError("createUniverseEyeScene requires a THREE.Scene.");
  if (!irisTexture?.isTexture || !scleraTexture?.isTexture) {
    throw new TypeError("Decoded iris and sclera textures are required before scene construction.");
  }

  configureAlbedoTexture(irisTexture);
  configureAlbedoTexture(scleraTexture, { repeat: [2.15, 1.12], mirrored: true });
  const microNormal = createMicroNormalTexture(256, seed);
  const resources = new Set([microNormal]);
  const root = new THREE.Group();
  root.name = "RTX Universe Eye ×1000 anatomical root";
  scene.add(root);

  const scleraMaterial = createSssMaterial({
    name: "Ivory microvascular sclera SSS",
    color: 0xfff6ec,
    map: scleraTexture,
    normalMap: microNormal,
    normalScale: new THREE.Vector2(0.12, 0.12),
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.16,
    clearcoatRoughness: 0.28,
    sheen: 0.34,
    sheenColor: new THREE.Color(0xffd7d2),
    sheenRoughness: 0.62,
  }, { color: [1, 0.16, 0.12], distortion: 0.17, ambient: 0.015, attenuation: 0.12, power: 2.6, scale: 0.78 });
  setStaticRtxSurface(scleraMaterial, new THREE.Color(0xeedfd5), 0.46);
  resources.add(scleraMaterial);
  const scleraGeometry = new THREE.SphereGeometry(EYE_RADIUS_MM, 192, 128);
  resources.add(scleraGeometry);
  const sclera = new THREE.Mesh(scleraGeometry, scleraMaterial);
  sclera.name = "Ivory generated-texture scleral globe";
  sclera.scale.z = 0.975;
  sclera.castShadow = true;
  sclera.receiveShadow = true;
  root.add(sclera);

  const irisRig = ignoreDynamicRtx(new THREE.Group());
  irisRig.name = "Gaze-driven iris and pupil assembly";
  root.add(irisRig);

  const irisGeometry = createIrisAnnulusGeometry();
  resources.add(irisGeometry);
  const irisMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Universe spiral blue stromal iris",
    map: irisTexture,
    color: 0xffffff,
    roughness: 0.36,
    metalness: 0,
    clearcoat: 0.025,
    clearcoatRoughness: 0.55,
  });
  resources.add(irisMaterial);
  const iris = new THREE.Mesh(irisGeometry, irisMaterial);
  iris.name = "Deforming annular universe-spiral iris";
  iris.position.z = 11.94;
  iris.receiveShadow = true;
  irisRig.add(iris);

  const pupilMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Light-absorbing pupil aperture",
    color: 0x000001,
    roughness: 0.035,
    metalness: 0,
  });
  resources.add(pupilMaterial);
  const pupilGeometry = new THREE.CircleGeometry(1, 192);
  resources.add(pupilGeometry);
  const pupil = new THREE.Mesh(pupilGeometry, pupilMaterial);
  pupil.name = "True black pupil aperture";
  pupil.position.z = 11.835;
  pupil.scale.setScalar(2.18);
  irisRig.add(pupil);

  const lensMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Deep anterior lens glint",
    color: 0x071121,
    roughness: 0.08,
    transmission: 0.42,
    thickness: 1.2,
    ior: 1.41,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  resources.add(lensMaterial);
  const lensGeometry = new THREE.SphereGeometry(2.35, 96, 64);
  resources.add(lensGeometry);
  const lens = new THREE.Mesh(lensGeometry, lensMaterial);
  lens.name = "Recessed crystalline lens";
  lens.position.z = 10.74;
  lens.scale.z = 0.36;
  lens.renderOrder = 1;
  irisRig.add(lens);

  const fibreGeometry = new THREE.PlaneGeometry(1, 1);
  resources.add(fibreGeometry);
  const fibreMaterial = new THREE.MeshBasicNodeMaterial({
    name: "X1000 batched stromal micro-fibres",
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  resources.add(fibreMaterial);
  const fibres = new THREE.InstancedMesh(fibreGeometry, fibreMaterial, STROMAL_FIBRE_COUNT);
  fibres.name = "Exactly 1000 instanced universe stromal fibres";
  fibres.frustumCulled = false;
  fibres.renderOrder = 3;
  for (const fibre of STROMAL_FIBRES) {
    const radius = 2.18 + fibre.radial * (IRIS_RADIUS_MM - 2.18);
    const angle = fibre.angle;
    scratchPosition.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 11.978 + fibre.depth);
    scratchQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle - Math.PI * 0.5 + fibre.curl * 0.22);
    scratchScale.set(
      fibre.width * IRIS_RADIUS_MM * 1.5,
      fibre.length * IRIS_RADIUS_MM,
      1,
    );
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    fibres.setMatrixAt(fibre.index, scratchMatrix);
    scratchColor.setRGB(
      0.16 + fibre.cyan * 0.28,
      0.42 + fibre.cyan * 0.42,
      0.72 + fibre.luminance * 0.42,
      THREE.LinearSRGBColorSpace,
    ).multiplyScalar(0.44 + fibre.luminance * 0.58);
    fibres.setColorAt(fibre.index, scratchColor);
  }
  fibres.instanceMatrix.needsUpdate = true;
  if (fibres.instanceColor) fibres.instanceColor.needsUpdate = true;
  irisRig.add(fibres);

  const limbalMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Deep blue limbal ring",
    color: 0x03142f,
    roughness: 0.38,
    clearcoat: 0.06,
    clearcoatRoughness: 0.5,
  });
  resources.add(limbalMaterial);
  const limbalGeometry = new THREE.TorusGeometry(5.76, 0.13, 20, 256);
  resources.add(limbalGeometry);
  const limbalRing = new THREE.Mesh(limbalGeometry, limbalMaterial);
  limbalRing.name = "Anatomical limbal ring";
  limbalRing.position.z = 11.965;
  irisRig.add(limbalRing);

  const collaretteMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Raised cyan collarette",
    color: 0x74ceff,
    roughness: 0.54,
    emissive: 0x071a31,
    emissiveIntensity: 0.28,
  });
  resources.add(collaretteMaterial);
  const collaretteGeometry = new THREE.TorusGeometry(3.18, 0.055, 12, 192);
  resources.add(collaretteGeometry);
  const collarette = new THREE.Mesh(collaretteGeometry, collaretteMaterial);
  collarette.name = "Irregular stromal collarette";
  collarette.position.z = 11.982;
  irisRig.add(collarette);

  const corneaMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Physically transmissive cornea with tear-film clearcoat",
    color: 0xf8ffff,
    roughness: 0.012,
    metalness: 0,
    transmission: 0.985,
    thickness: 0.55,
    ior: 1.376,
    attenuationColor: new THREE.Color(0xe8fbff),
    attenuationDistance: 60,
    clearcoat: 1,
    clearcoatRoughness: 0.008,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.FrontSide,
  });
  corneaMaterial.rtxPreserveTransparency = 1;
  corneaMaterial.rtxReflectionMask = 0.14;
  resources.add(corneaMaterial);
  const corneaGeometry = new THREE.SphereGeometry(
    CORNEA_APERTURE_MM,
    192,
    96,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5,
  );
  resources.add(corneaGeometry);
  const cornea = ignoreDynamicRtx(new THREE.Mesh(corneaGeometry, corneaMaterial));
  cornea.name = "Aspheric 1.376 IOR corneal dome and tear film";
  cornea.rotation.x = Math.PI * 0.5;
  cornea.scale.y = CORNEA_HEIGHT_MM / CORNEA_APERTURE_MM;
  cornea.position.z = 11.48;
  cornea.renderOrder = 4;
  root.add(cornea);

  const lidNormal = createMicroNormalTexture(256, seed ^ 0x51d51d);
  lidNormal.repeat.set(8, 5);
  resources.add(lidNormal);
  const skinMaterial = createSssMaterial({
    name: "Subsurface eyelid skin",
    color: 0x9c625b,
    normalMap: lidNormal,
    normalScale: new THREE.Vector2(0.22, 0.22),
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.075,
    clearcoatRoughness: 0.46,
    sheen: 0.58,
    sheenColor: new THREE.Color(0xff9a8e),
    sheenRoughness: 0.72,
    side: THREE.FrontSide,
  }, { color: [1, 0.16, 0.10], distortion: 0.22, ambient: 0.02, attenuation: 0.2, power: 2.4, scale: 1.45 });
  resources.add(skinMaterial);

  const upperGeometry = createLidPatchGeometry(true);
  const lowerGeometry = createLidPatchGeometry(false);
  resources.add(upperGeometry);
  resources.add(lowerGeometry);
  updateLidPatchGeometry(upperGeometry, 0);
  updateLidPatchGeometry(lowerGeometry, 0);
  const upperLid = ignoreDynamicRtx(new THREE.Mesh(upperGeometry, skinMaterial));
  upperLid.name = "Blink-deforming upper eyelid skin";
  upperLid.castShadow = true;
  upperLid.renderOrder = 6;
  const lowerLid = ignoreDynamicRtx(new THREE.Mesh(lowerGeometry, skinMaterial));
  lowerLid.name = "Blink-deforming lower eyelid skin";
  lowerLid.castShadow = true;
  lowerLid.renderOrder = 6;
  root.add(upperLid, lowerLid);

  const waterlineMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Moist pink eyelid waterline",
    color: 0xd77c7c,
    roughness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.035,
    side: THREE.DoubleSide,
  });
  resources.add(waterlineMaterial);
  const upperMarginGeometry = createMarginRibbonGeometry(true);
  const lowerMarginGeometry = createMarginRibbonGeometry(false);
  resources.add(upperMarginGeometry);
  resources.add(lowerMarginGeometry);
  updateMarginRibbonGeometry(upperMarginGeometry, 0);
  updateMarginRibbonGeometry(lowerMarginGeometry, 0);
  const upperWaterline = ignoreDynamicRtx(new THREE.Mesh(upperMarginGeometry, waterlineMaterial));
  upperWaterline.name = "Upper moist lid margin";
  upperWaterline.renderOrder = 7;
  const lowerWaterline = ignoreDynamicRtx(new THREE.Mesh(lowerMarginGeometry, waterlineMaterial));
  lowerWaterline.name = "Lower tear meniscus";
  lowerWaterline.renderOrder = 7;
  root.add(upperWaterline, lowerWaterline);

  const lashGeometry = new THREE.CylinderGeometry(0.012, 0.055, 1, 5, 2, false);
  lashGeometry.translate(0, 0.5, 0);
  resources.add(lashGeometry);
  const lashMaterial = new THREE.MeshPhysicalNodeMaterial({
    name: "Tapered individual eyelashes",
    color: 0x160b0b,
    roughness: 0.48,
    clearcoat: 0.16,
    clearcoatRoughness: 0.35,
  });
  resources.add(lashMaterial);
  const lashes = ignoreDynamicRtx(new THREE.InstancedMesh(lashGeometry, lashMaterial, LASH_COUNT));
  lashes.name = "128 tapered blink-following eyelashes";
  lashes.castShadow = true;
  lashes.frustumCulled = false;
  root.add(lashes);

  const caruncleMaterial = createSssMaterial({
    name: "Moist lacrimal caruncle",
    color: 0xc96b71,
    roughness: 0.32,
    clearcoat: 0.62,
    clearcoatRoughness: 0.16,
  }, { color: [1, 0.08, 0.06], distortion: 0.3, ambient: 0.03, attenuation: 0.28, power: 2.2, scale: 1.6 });
  resources.add(caruncleMaterial);
  const caruncleGeometry = new THREE.SphereGeometry(0.72, 48, 32);
  resources.add(caruncleGeometry);
  const caruncle = new THREE.Mesh(caruncleGeometry, caruncleMaterial);
  caruncle.name = "Inner lacrimal caruncle";
  caruncle.position.set(-10.25, -0.34, ocularSurfaceZ(-10.25, -0.34) + 0.38);
  caruncle.scale.set(1.45, 0.58, 0.42);
  caruncle.rotation.z = -0.18;
  root.add(caruncle);

  const lights = createStudioLights(root);
  const dynamics = createEyeDynamics({ seed });
  let studioRigIndex = 0;
  let previousBlink = -1;
  let previousPupil = -1;

  function updateLashes(blink) {
    for (let index = 0; index < LASH_COUNT; ++index) {
      const unit = (index + 0.5) / LASH_COUNT;
      const x = THREE.MathUtils.lerp(-9.65, 9.65, unit);
      const y = almondMargin(x, true, blink) + 0.12;
      const asymmetry = Math.sin(index * 12.9898 + seed * 0.00001) * 0.5 + 0.5;
      const length = 1.05 + Math.sin(Math.PI * unit) * 1.25 + asymmetry * 0.34;
      scratchPosition.set(x, y, ocularSurfaceZ(x, y) + 0.57);
      lashDirection.set(x * 0.055, 0.82 + (1 - blink) * 0.31, 0.52 + asymmetry * 0.28).normalize();
      scratchQuaternion.setFromUnitVectors(unitY, lashDirection);
      scratchScale.set(0.72 + asymmetry * 0.28, length, 0.72 + asymmetry * 0.28);
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      lashes.setMatrixAt(index, scratchMatrix);
    }
    lashes.instanceMatrix.needsUpdate = true;
  }

  function setStudioRig(value = 0) {
    studioRigIndex = ((Math.trunc(finite(value)) % STUDIO_RIGS.length) + STUDIO_RIGS.length) % STUDIO_RIGS.length;
    const rig = STUDIO_RIGS[studioRigIndex];
    lights.key.position.set(...rig.key);
    lights.key.color.setHex(rig.keyColor);
    lights.key.intensity = rig.keyEnergy;
    lights.fill.position.set(...rig.fill);
    lights.fill.color.setHex(rig.fillColor);
    lights.fill.intensity = rig.fillEnergy;
    lights.rim.color.setHex(rig.rimColor);
    lights.rim.intensity = rig.rimEnergy;
    dynamics.setLuminance(rig.luminance);
    return Object.freeze({ index: studioRigIndex, name: rig.name });
  }

  function reset() {
    dynamics.reset();
    irisRig.position.set(0, 0, 0);
    irisRig.rotation.set(0, 0, 0);
    previousBlink = -1;
    previousPupil = -1;
    return setStudioRig(0);
  }

  function update(delta, input = {}) {
    const biology = dynamics.update(delta, input);
    const response = 1 - Math.exp(-Math.max(0, Math.min(0.1, finite(delta))) * 12);
    irisRig.position.x = THREE.MathUtils.lerp(irisRig.position.x, biology.gazeX * 0.54, response);
    irisRig.position.y = THREE.MathUtils.lerp(irisRig.position.y, biology.gazeY * 0.42, response);
    irisRig.rotation.y = THREE.MathUtils.lerp(irisRig.rotation.y, biology.gazeX * 0.018, response);
    irisRig.rotation.x = THREE.MathUtils.lerp(irisRig.rotation.x, -biology.gazeY * 0.015, response);

    if (Math.abs(biology.pupilRadius - previousPupil) > 0.001) {
      previousPupil = biology.pupilRadius;
      updateIrisGeometry(irisGeometry, biology.pupilRadius);
      pupil.scale.setScalar(biology.pupilRadius * 1.015);
      collarette.scale.setScalar(THREE.MathUtils.lerp(0.94, 1.07,
        (biology.pupilRadius - 1.55) / (3.75 - 1.55)));
    }
    if (Math.abs(biology.blink - previousBlink) > 0.001) {
      previousBlink = biology.blink;
      updateLidPatchGeometry(upperGeometry, biology.blink);
      updateLidPatchGeometry(lowerGeometry, biology.blink);
      updateMarginRibbonGeometry(upperMarginGeometry, biology.blink);
      updateMarginRibbonGeometry(lowerMarginGeometry, biology.blink);
      updateLashes(biology.blink);
    }
    const tearPulse = 0.78 + Math.sin(biology.biologyTime * 0.72) * 0.06;
    waterlineMaterial.clearcoat = tearPulse;
    return biology;
  }

  setStudioRig(0);
  updateLashes(0);
  update(0, {});

  const transparentRoots = Object.freeze([cornea, lens, upperWaterline, lowerWaterline, fibres]);
  const opaqueRoots = Object.freeze([sclera, caruncle]);

  return Object.freeze({
    root,
    opaqueRoots,
    transparentRoots,
    lights: Object.freeze([...lights.staticLights]),
    update,
    triggerBlink: duration => dynamics.triggerBlink(duration),
    setPaused: value => dynamics.setPaused(value),
    setStudioRig,
    reset,
    stats() {
      const biology = dynamics.snapshot();
      return Object.freeze({
        seed,
        seedHex: `0x${(seed >>> 0).toString(16).padStart(8, "0").toUpperCase()}`,
        stromalFibres: STROMAL_FIBRE_COUNT,
        stromalChecksum: STROMAL_FIBRE_CHECKSUM,
        eyelashes: LASH_COUNT,
        studioRig: studioRigIndex,
        studioRigName: STUDIO_RIGS[studioRigIndex].name,
        pupilRadiusMm: biology.pupilRadius,
        blink: biology.blink,
        biologyTime: biology.biologyTime,
        cornealIor: 1.376,
        generatedTextures: 2,
      });
    },
    dispose() {
      root.removeFromParent();
      for (const resource of resources) resource.dispose?.();
      irisTexture.dispose?.();
      scleraTexture.dispose?.();
    },
  });
}

