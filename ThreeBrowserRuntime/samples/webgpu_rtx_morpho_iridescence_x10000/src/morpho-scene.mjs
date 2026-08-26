import * as THREE from "three/webgpu";

import {
  HERO_SCALE_INDEX,
  MORPHO_SEED,
  PHOTONIC_SCALES,
  SCALE_COUNT,
} from "./morpho-model.mjs";
import {
  CHITIN_IOR,
  LATTICE_LAYER_COUNT,
  iridescentRgb,
  structuralColorForScale,
} from "./interference.mjs";
import { OMMATIDIA, OMMATIDIA_COUNT } from "./ommatidia-model.mjs";
import { createWingMembranes } from "./wing-geometry.mjs";
import { createWingVeins } from "./wing-veins.mjs";
import { createCompoundEyes } from "./compound-eye.mjs";
import { createInsectAnatomy } from "./insect-anatomy.mjs";
import { createInsectAppendages } from "./insect-appendages.mjs";
import { createWingDynamics, IDLE_WING_HZ } from "./wing-dynamics.mjs";
import { createIridescenceMaterial } from "./iridescence-material.mjs";
import { createChitinMaterials } from "./chitin-materials.mjs";
import { createGardenArchitecture } from "./garden-architecture.mjs";
import { createFoliage } from "./foliage.mjs";
import { createPond } from "./pond.mjs";
import { createDewField } from "./dew-field.mjs";
import { createLanterns } from "./lanterns.mjs";
import { createPollen } from "./pollen.mjs";
import { LIGHTING_RIG_NAMES, createLightingRigs } from "./lighting-rigs.mjs";

const LATTICE_FADE_MAGNIFICATION = 800;
const NM_TO_X10000_METERS = 1e-5;
const WING_ATTACH = Object.freeze({
  left: Object.freeze([-0.05, 0.02, 0.03]),
  right: Object.freeze([0.05, 0.02, 0.03]),
});
const WING_DIHEDRAL = 0.22;
const MORPHO_DISPLAY_SCALE = 1.18;
const HERO_PERCH = Object.freeze({
  position: Object.freeze([0, 1.08, 0]),
  rotation: Object.freeze([-0.04, 0.18, 0]),
});
const FALLBACK_PERCH = HERO_PERCH;
const SCALE_DISPLAY = 2.4;

const scratchColor = new THREE.Color();
const scratchEuler = new THREE.Euler();
const scratchMatrix = new THREE.Matrix4();
const scratchNormal = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();
const scratchC = new THREE.Vector3();
const scratchD = new THREE.Vector3();
const unitY = new THREE.Vector3(0, 1, 0);
const boxSize = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp01(value) {
  return THREE.MathUtils.clamp(finite(value), 0, 1);
}

function ignoreDynamicRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function configureAlbedoTexture(texture, { repeat = [1, 1], wrap = THREE.ClampToEdgeWrapping } = {}) {
  if (!texture?.isTexture) return texture;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = Math.max(finite(texture.anisotropy, 1), 16);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function isTransparentMaterial(material) {
  if (!material) return false;
  return material.transparent === true ||
    finite(material.transmission, 0) > 0.005 ||
    finite(material.opacity, 1) < 0.995;
}

function isOpaqueRoot(root) {
  if (!root?.isObject3D) return false;
  if (root.userData?.rtxIgnore) return false;
  if (root.isMesh || root.isInstancedMesh) {
    const materials = Array.isArray(root.material) ? root.material : [root.material];
    if (materials.length > 0 && materials.every(isTransparentMaterial)) return false;
  }
  return true;
}

function firstMesh(object) {
  if (!object) return null;
  if (object.isMesh || object.isInstancedMesh) return object;
  let found = null;
  object.traverse?.(child => {
    if (!found && (child.isMesh || child.isInstancedMesh) && child !== object) found = child;
  });
  return found;
}

function asGroup(object, name) {
  if (object?.isGroup) {
    if (name && !object.name) object.name = name;
    return object;
  }
  const group = new THREE.Group();
  group.name = name;
  if (object?.isObject3D) group.add(object);
  return group;
}

function readPerch(foliage) {
  const perch = foliage?.perch ?? foliage?.perchPoint ?? null;
  if (perch?.isObject3D) return { object: perch, position: null, rotation: null };
  if (perch?.isVector3) {
    return { object: null, position: perch.toArray(), rotation: FALLBACK_PERCH.rotation };
  }
  if (Array.isArray(perch) && perch.length >= 3) {
    return { object: null, position: perch, rotation: FALLBACK_PERCH.rotation };
  }
  if (perch?.position) {
    const position = perch.position.isVector3 ? perch.position.toArray() : perch.position;
    const rotation = perch.rotation?.isEuler
      ? [perch.rotation.x, perch.rotation.y, perch.rotation.z]
      : (perch.rotation ?? FALLBACK_PERCH.rotation);
    return { object: null, position, rotation };
  }
  return { object: null, position: FALLBACK_PERCH.position, rotation: FALLBACK_PERCH.rotation };
}

function fitWidth(object, targetWidth) {
  if (!object?.isObject3D || !(targetWidth > 0)) return object;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  box.getSize(boxSize);
  const current = Math.max(boxSize.x, boxSize.z, 1e-8);
  if (current > targetWidth * 1.8 || current < targetWidth * 0.35) {
    object.scale.multiplyScalar(targetWidth / current);
  }
  return object;
}

function gridVertex(geometry, i, j, rows, target) {
  const vertex = i * rows + j;
  const position = geometry.getAttribute("position");
  return target.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
}

function sampleWingSurface(geometry, u, v, target, normalTarget) {
  const position = geometry?.getAttribute?.("position");
  const spanSegments = finite(geometry?.userData?.spanSegments, 0);
  const chordSegments = finite(geometry?.userData?.chordSegments, 0);
  if (!position || !(spanSegments >= 1) || !(chordSegments >= 1)) {
    const sign = geometry?.userData?.side === "right" ? 1 : -1;
    const span = finite(geometry?.userData?.span, 0.78);
    target.set(sign * span * clamp01(u), 0.004, (clamp01(v) - 0.5) * 0.48);
    normalTarget.set(0, 1, 0);
    return target;
  }
  const rows = chordSegments + 1;
  const su = clamp01(u) * spanSegments;
  const sv = clamp01(v) * chordSegments;
  const i0 = Math.min(spanSegments, Math.max(0, Math.floor(su)));
  const j0 = Math.min(chordSegments, Math.max(0, Math.floor(sv)));
  const i1 = Math.min(spanSegments, i0 + 1);
  const j1 = Math.min(chordSegments, j0 + 1);
  const fu = su - i0;
  const fv = sv - j0;
  gridVertex(geometry, i0, j0, rows, scratchA);
  gridVertex(geometry, i1, j0, rows, scratchB);
  gridVertex(geometry, i0, j1, rows, scratchC);
  gridVertex(geometry, i1, j1, rows, scratchD);
  scratchA.lerp(scratchB, fu);
  scratchC.lerp(scratchD, fu);
  target.copy(scratchA).lerp(scratchC, fv);

  gridVertex(geometry, Math.min(spanSegments, i0 + 1), j0, rows, scratchB);
  gridVertex(geometry, i0, Math.min(chordSegments, j0 + 1), rows, scratchC);
  gridVertex(geometry, i0, j0, rows, scratchA);
  scratchB.sub(scratchA);
  scratchC.sub(scratchA);
  normalTarget.crossVectors(scratchB, scratchC);
  if (normalTarget.lengthSq() < 1e-12) normalTarget.set(0, 1, 0);
  else normalTarget.normalize();
  if (normalTarget.y < 0) normalTarget.negate();
  return target;
}

function structuralTint(scale, viewAngle = 0, lightAngle = 0) {
  const rgb = typeof structuralColorForScale === "function"
    ? structuralColorForScale(scale, viewAngle, lightAngle)
    : iridescentRgb({
      layerGapNm: scale.layerGapNm,
      layerCount: scale.layerCount,
      chitinIndex: scale.chitinIndex,
      airIndex: scale.airIndex,
      viewAngle,
      lightAngle,
    });
  return {
    r: Math.max(0, finite(rgb?.r)),
    g: Math.max(0, finite(rgb?.g)),
    b: Math.max(0, finite(rgb?.b)),
  };
}

function magnificationDomain(magnification) {
  const mag = finite(magnification, 1);
  if (mag >= 800) return "lattice";
  if (mag >= 80) return "wing";
  if (mag >= 8) return "morpho";
  return "greenhouse";
}

function latticeFade(magnification) {
  const mag = Math.max(1, finite(magnification, 1));
  if (mag < LATTICE_FADE_MAGNIFICATION) return 0;
  const start = Math.log10(LATTICE_FADE_MAGNIFICATION);
  const end = Math.log10(10_000);
  return clamp01((Math.log10(mag) - start) / Math.max(1e-6, end - start));
}

function composeScalePose(scale, geometry, targetMatrix) {
  sampleWingSurface(geometry, scale.u, scale.v, scratchPosition, scratchNormal);
  scratchPosition.addScaledVector(scratchNormal, Math.max(1e-5, finite(scale.thickness, 0.0003)) * 0.7);
  scratchQuaternion.setFromUnitVectors(unitY, scratchNormal);
  scratchEuler.set(finite(scale.tilt), finite(scale.roll), finite(scale.yaw), "XYZ");
  scratchMatrix.makeRotationFromEuler(scratchEuler);
  scratchQuaternion.multiply(new THREE.Quaternion().setFromRotationMatrix(scratchMatrix));
  scratchScale.set(
    Math.max(1e-5, finite(scale.width, 0.003) * SCALE_DISPLAY),
    Math.max(1e-5, finite(scale.thickness, 0.0003) * SCALE_DISPLAY),
    Math.max(1e-5, finite(scale.length, 0.008) * SCALE_DISPLAY),
  );
  return targetMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
}

function fallbackWingMembranes() {
  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Fallback Morpho wing membranes";
  const geometry = new THREE.PlaneGeometry(1.05, 0.48, 32, 16);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.userData = { spanSegments: 32, chordSegments: 16, span: 1.05, side: "left" };
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Fallback transmissive wing membrane",
    color: 0x1a3048,
    roughness: 0.22,
    transmission: 0.24,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    ior: CHITIN_IOR,
  });
  material.rtxPreserveTransparency = 1;
  const left = ignoreDynamicRtx(new THREE.Mesh(geometry, material));
  left.name = "Morpho left wing membrane";
  left.userData.side = "left";
  const rightGeometry = geometry.clone();
  rightGeometry.userData = { ...geometry.userData, side: "right" };
  const right = ignoreDynamicRtx(new THREE.Mesh(rightGeometry, material));
  right.name = "Morpho right wing membrane";
  right.userData.side = "right";
  group.add(left, right);
  return { left, right, group, geometries: { left: geometry, right: rightGeometry }, materials: { membrane: material } };
}

function fallbackAnatomy({ materials } = {}) {
  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Fallback Morpho anatomy";
  const body = materials?.body ?? new THREE.MeshPhysicalNodeMaterial({ color: 0x1a140f, roughness: 0.7 });
  const thorax = ignoreDynamicRtx(new THREE.Group());
  thorax.name = "thorax";
  const thoraxMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 16), body);
  thoraxMesh.scale.set(1.1, 0.95, 1.2);
  thorax.add(thoraxMesh);
  const head = ignoreDynamicRtx(new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 16), materials?.head ?? body));
  head.name = "head";
  head.position.set(0, 0.016, 0.388);
  const abdomen = ignoreDynamicRtx(new THREE.Group());
  abdomen.name = "abdomen";
  abdomen.position.set(0, -0.006, -0.148);
  group.add(thorax, head, abdomen);
  group.traverse(object => { object.userData.rtxIgnore = true; });
  return { group, head, thorax, abdomen };
}

function fallbackVeins() {
  const group = ignoreDynamicRtx(new THREE.Group());
  group.name = "Fallback Morpho wing veins";
  return { group, left: null, right: null };
}

/** Assemble the greenhouse, perched Morpho, 10,000 scales and the hero lattice. */
export function createMorphoScene(scene, {
  wingTexture,
  eyeTexture,
  mossTexture,
  seed = MORPHO_SEED,
} = {}) {
  if (!scene?.isScene) throw new TypeError("createMorphoScene requires a THREE.Scene.");

  configureAlbedoTexture(wingTexture);
  configureAlbedoTexture(eyeTexture);
  configureAlbedoTexture(mossTexture, { repeat: [2.4, 1.8], wrap: THREE.RepeatWrapping });

  const resources = new Set();
  const worldRoot = new THREE.Group();
  worldRoot.name = "RTX Morpho Iridescence ×10000 greenhouse root";
  scene.add(worldRoot);

  const materials = createChitinMaterials({ mossTexture, eyeTexture });
  for (const material of Object.values(materials ?? {})) resources.add(material);

  const architecture = createGardenArchitecture({ materials, mossTexture }) ?? {};
  const foliage = createFoliage({ materials, mossTexture, seed }) ?? {};
  const pond = createPond({ materials }) ?? {};
  const lanterns = createLanterns({ materials }) ?? {};
  const dew = createDewField({ materials, seed }) ?? {};
  const pollen = createPollen({ seed }) ?? {};
  const lighting = createLightingRigs(scene);

  if (architecture.group) worldRoot.add(architecture.group);
  if (foliage.group) worldRoot.add(foliage.group);
  if (pond.group) worldRoot.add(pond.group);
  if (lanterns.group) worldRoot.add(lanterns.group);

  const dynamicRoot = ignoreDynamicRtx(new THREE.Group());
  dynamicRoot.name = "Morpho dynamic RTX-excluded root";
  worldRoot.add(dynamicRoot);

  if (architecture.glassRoot) {
    ignoreDynamicRtx(architecture.glassRoot);
    dynamicRoot.add(architecture.glassRoot);
  }
  if (pond.water) dynamicRoot.add(pond.water);
  if (pond.koi) dynamicRoot.add(pond.koi);
  if (dew.group) dynamicRoot.add(dew.group);
  if (pollen.group) dynamicRoot.add(pollen.group);

  const anatomy = (typeof createInsectAnatomy === "function"
    ? createInsectAnatomy({ materials, textures: { wing: wingTexture } })
    : fallbackAnatomy({ materials })) ?? fallbackAnatomy({ materials });
  const appendages = typeof createInsectAppendages === "function"
    ? createInsectAppendages({ materials })
    : { group: ignoreDynamicRtx(new THREE.Group()), legs: [], antennae: [] };
  const eyes = typeof createCompoundEyes === "function"
    ? createCompoundEyes({ texture: eyeTexture, ommatidia: OMMATIDIA, materials })
    : { group: ignoreDynamicRtx(new THREE.Group()) };
  const membranes = (typeof createWingMembranes === "function"
    ? createWingMembranes({ materials, textures: { wingTexture, wing: wingTexture } })
    : fallbackWingMembranes()) ?? fallbackWingMembranes();
  const veins = (typeof createWingVeins === "function"
    ? createWingVeins({ materials })
    : fallbackVeins()) ?? fallbackVeins();

  const morphoRoot = ignoreDynamicRtx(new THREE.Group());
  morphoRoot.name = "Perched Morpho menelaus";
  if (anatomy.group) {
    ignoreDynamicRtx(anatomy.group);
    morphoRoot.add(anatomy.group);
  }

  const thorax = anatomy.thorax ?? anatomy.group ?? morphoRoot;
  const head = anatomy.head ?? morphoRoot;
  const abdomen = anatomy.abdomen ?? null;

  if (appendages.group) {
    ignoreDynamicRtx(appendages.group);
    thorax.add(appendages.group);
  }
  if (eyes.group) {
    ignoreDynamicRtx(eyes.group);
    if (head?.isObject3D) head.add(eyes.group);
    else morphoRoot.add(eyes.group);
  }

  if (anatomy.group) anatomy.group.scale.setScalar(0.34);
  if (appendages.group) appendages.group.scale.setScalar(1);

  const leftWingRoot = ignoreDynamicRtx(new THREE.Group());
  leftWingRoot.name = "Left Morpho wing root";
  leftWingRoot.position.set(...WING_ATTACH.left);
  const rightWingRoot = ignoreDynamicRtx(new THREE.Group());
  rightWingRoot.name = "Right Morpho wing root";
  rightWingRoot.position.set(...WING_ATTACH.right);
  morphoRoot.add(leftWingRoot, rightWingRoot);

  const leftMembrane = membranes.left ?? firstMesh(membranes.group);
  const rightMembrane = membranes.right ?? leftMembrane;
  if (leftMembrane) leftWingRoot.add(leftMembrane);
  if (rightMembrane && rightMembrane !== leftMembrane) rightWingRoot.add(rightMembrane);
  else if (membranes.group && !leftMembrane) leftWingRoot.add(membranes.group);

  if (veins.left) {
    veins.left.position.set(0, 0, 0);
    leftWingRoot.add(veins.left);
  }
  if (veins.right) {
    veins.right.position.set(0, 0, 0);
    rightWingRoot.add(veins.right);
  } else if (veins.group && !veins.left) {
    ignoreDynamicRtx(veins.group);
    morphoRoot.add(veins.group);
  }

  const leftGeometry = membranes.geometries?.left ?? leftMembrane?.geometry;
  const rightGeometry = membranes.geometries?.right ?? rightMembrane?.geometry ?? leftGeometry;

  const scaleMaterial = createIridescenceMaterial({
    albedoTexture: wingTexture,
    ior: CHITIN_IOR,
  });
  scaleMaterial.vertexColors = true;
  resources.add(scaleMaterial);

  const scaleGeometry = new THREE.BoxGeometry(1, 1, 1);
  scaleGeometry.name = "Photonic scale plate";
  resources.add(scaleGeometry);

  const localMatrix = new THREE.Matrix4();
  const leftScales = PHOTONIC_SCALES.filter(scale => scale.wing !== "right");
  const rightScales = PHOTONIC_SCALES.filter(scale => scale.wing === "right");

  function paintScaleMesh(name, scales, surfaceGeometry) {
    const mesh = ignoreDynamicRtx(new THREE.InstancedMesh(
      scaleGeometry,
      scaleMaterial,
      Math.max(1, scales.length),
    ));
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = scales.length;
    mesh.userData.rtxIgnore = true;
    for (let index = 0; index < scales.length; index += 1) {
      const scale = scales[index];
      composeScalePose(scale, surfaceGeometry, localMatrix);
      mesh.setMatrixAt(index, localMatrix);
      const tint = structuralTint(scale, 0, 0);
      const peak = Math.max(tint.r, tint.g, tint.b, 1e-4);
      const tone = peak > 2.4 ? 2.4 / peak : 1;
      scratchColor.setRGB(
        tint.r * tone * (0.55 + finite(scale.luminance, 0.5) * 0.65),
        tint.g * tone * (0.55 + finite(scale.luminance, 0.5) * 0.65),
        tint.b * tone * (0.55 + finite(scale.luminance, 0.5) * 0.65),
        THREE.LinearSRGBColorSpace,
      );
      mesh.setColorAt(index, scratchColor);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  const leftScaleMesh = paintScaleMesh(
    "Exactly 10000 instanced photonic scales — left wing",
    leftScales,
    leftGeometry,
  );
  const rightScaleMesh = paintScaleMesh(
    "Exactly 10000 instanced photonic scales — right wing",
    rightScales,
    rightGeometry,
  );
  leftWingRoot.add(leftScaleMesh);
  rightWingRoot.add(rightScaleMesh);
  const scaleMesh = leftScaleMesh;

  const hero = PHOTONIC_SCALES[HERO_SCALE_INDEX] ?? PHOTONIC_SCALES[0];
  const heroGeometry = hero?.wing === "right" ? rightGeometry : leftGeometry;
  const latticeGroup = ignoreDynamicRtx(new THREE.Group());
  latticeGroup.name = `Hero scale ${HERO_SCALE_INDEX} twelve-layer photonic lattice`;
  latticeGroup.visible = false;
  latticeGroup.userData.rtxIgnore = true;

  if (hero) sampleWingSurface(heroGeometry, hero.u, hero.v, scratchPosition, scratchNormal);
  else scratchPosition.set(0.55, 0, 0.22);
  scratchQuaternion.setFromUnitVectors(unitY, scratchNormal);
  const heroWingRoot = hero?.wing === "right" ? rightWingRoot : leftWingRoot;
  latticeGroup.position.copy(scratchPosition);
  latticeGroup.quaternion.copy(scratchQuaternion);
  heroWingRoot.add(latticeGroup);

  const latticeGap = Math.max(1e-5, finite(hero?.layerGapNm, 90) * NM_TO_X10000_METERS);
  const plateThickness = latticeGap * 0.28;
  const plateWidth = Math.max(0.001, finite(hero?.width, 0.004) * 1.6);
  const plateLength = Math.max(0.002, finite(hero?.length, 0.01) * 1.6);
  const plateGeometry = new THREE.BoxGeometry(plateWidth, plateThickness, plateLength);
  plateGeometry.name = "Hero chitin lamella";
  resources.add(plateGeometry);

  const latticeMaterials = [];
  for (let layer = 0; layer < LATTICE_LAYER_COUNT; layer += 1) {
    const tint = iridescentRgb({
      layerGapNm: finite(hero?.layerGapNm, 90),
      layerCount: LATTICE_LAYER_COUNT,
      chitinIndex: finite(hero?.chitinIndex, CHITIN_IOR),
      airIndex: finite(hero?.airIndex, 1),
      viewAngle: layer * 0.045,
      lightAngle: 0,
    });
    const plateMaterial = createIridescenceMaterial({
      albedoTexture: wingTexture,
      ior: finite(hero?.chitinIndex, CHITIN_IOR),
    });
    plateMaterial.name = `Hero chitin lattice plate ${layer + 1}`;
    plateMaterial.transparent = true;
    plateMaterial.opacity = 0;
    plateMaterial.depthWrite = false;
    plateMaterial.userData.rtxIgnore = true;
    if (plateMaterial.color?.isColor) {
      plateMaterial.color.setRGB(finite(tint.r), finite(tint.g), finite(tint.b), THREE.LinearSRGBColorSpace);
    }
    resources.add(plateMaterial);
    latticeMaterials.push(plateMaterial);

    const plate = ignoreDynamicRtx(new THREE.Mesh(plateGeometry, plateMaterial));
    plate.name = `Chitin lattice layer ${layer + 1}`;
    plate.userData.rtxIgnore = true;
    plate.position.y = (layer - (LATTICE_LAYER_COUNT - 1) * 0.5) * latticeGap;
    plate.castShadow = false;
    plate.receiveShadow = false;
    latticeGroup.add(plate);
  }

  dynamicRoot.add(morphoRoot);
  morphoRoot.position.set(...HERO_PERCH.position);
  morphoRoot.rotation.set(...HERO_PERCH.rotation);
  morphoRoot.scale.setScalar(MORPHO_DISPLAY_SCALE);
  ignoreDynamicRtx(morphoRoot);

  const dynamics = createWingDynamics({ seed });
  const thoraxRestScale = (thorax.scale ?? new THREE.Vector3(1, 1, 1)).clone();
  const abdomenRest = abdomen?.rotation.clone() ?? new THREE.Euler();
  const headRest = head?.rotation.clone() ?? new THREE.Euler();
  const antennae = appendages.antennae ?? [];
  const antennaRests = antennae.map(antenna => antenna.rotation.clone());

  const keyLight = lighting.keyLight ?? lighting.lights?.key ?? null;
  let studioRigIndex = 0;
  let rigKeyIntensity = finite(keyLight?.intensity, 2.2);
  let lastMagnification = 1;

  function applyLatticeFade(magnification) {
    const fade = latticeFade(magnification);
    latticeGroup.visible = fade > 0.002;
    latticeGroup.userData.rtxIgnore = true;
    for (const material of latticeMaterials) {
      material.opacity = fade;
      material.transparent = fade < 0.999;
      material.depthWrite = fade > 0.92;
    }
  }

  function applyPose(pose) {
    leftWingRoot.rotation.z = -WING_DIHEDRAL - finite(pose.leftAngle);
    rightWingRoot.rotation.z = WING_DIHEDRAL + finite(pose.rightAngle);
    leftWingRoot.rotation.x = finite(pose.leftTwist);
    rightWingRoot.rotation.x = finite(pose.rightTwist);

    if (thorax?.scale) {
      const breath = 1 + finite(pose.thoraxBreath);
      thorax.scale.set(
        thoraxRestScale.x * breath,
        thoraxRestScale.y * (1 + finite(pose.thoraxBreath) * 0.6),
        thoraxRestScale.z * breath,
      );
    }
    if (abdomen?.rotation) {
      abdomen.rotation.x = abdomenRest.x + finite(pose.abdomenCurl);
    }
    if (head?.rotation) {
      head.rotation.y = headRest.y + finite(pose.gazeX) * 0.32;
      head.rotation.x = headRest.x - finite(pose.gazeY) * 0.24;
    }
    for (let index = 0; index < antennae.length; index += 1) {
      const rest = antennaRests[index];
      if (!rest || !antennae[index]) continue;
      const wobble = Math.sin(finite(pose.antennaPhase) + index * 0.7) * 0.12;
      antennae[index].rotation.z = rest.z + wobble;
      antennae[index].rotation.x = rest.x + Math.sin(finite(pose.antennaPhase) * 0.65 + index) * 0.05;
    }
  }

  function setStudioRig(index = 0) {
    const result = lighting.setRig?.(index) ?? {};
    studioRigIndex = finite(result.index, ((Math.trunc(finite(index)) % LIGHTING_RIG_NAMES.length) + LIGHTING_RIG_NAMES.length) % LIGHTING_RIG_NAMES.length);
    rigKeyIntensity = finite(keyLight?.intensity, rigKeyIntensity);
    return Object.freeze({
      index: studioRigIndex,
      name: result.name ?? LIGHTING_RIG_NAMES[studioRigIndex],
    });
  }

  function reset() {
    dynamics.reset();
    lastMagnification = 1;
    applyLatticeFade(1);
    applyPose(dynamics.pose());
    pollen.update?.(0, 0);
    return setStudioRig(0);
  }

  function update(dt, input = {}) {
    if (input.gazeX !== undefined || input.gazeY !== undefined) {
      dynamics.setGaze?.(input.gazeX, input.gazeY);
    }
    const pose = dynamics.update(dt, { paused: input.paused });
    applyPose(pose);
    lastMagnification = finite(input.magnification, lastMagnification);
    applyLatticeFade(lastMagnification);
    if (!pose.paused) pollen.update?.(dt, pose.elapsed * 0.37);
    if (keyLight && Number.isFinite(input.luminance)) {
      keyLight.intensity = rigKeyIntensity * (0.78 + clamp01(input.luminance) * 0.45);
    }
    return pose;
  }

  setStudioRig(0);
  applyPose(dynamics.pose());
  applyLatticeFade(1);

  const opaqueRoots = Object.freeze([
    architecture.opaqueRoot,
    lanterns.group,
    pond.basin,
    foliage.opaqueRoot,
  ].filter(isOpaqueRoot));

  const transparentRoots = Object.freeze([
    architecture.glassRoot,
    pond.water,
    dew.group,
    pollen.group,
    membranes.group ?? leftMembrane,
    latticeGroup,
    scaleMesh,
  ].filter(Boolean));

  const lights = Object.freeze([
    keyLight,
    ...(Array.isArray(lanterns.lights) ? lanterns.lights : []),
  ].filter(Boolean));

  return Object.freeze({
    root: worldRoot,
    morphoRoot,
    opaqueRoots,
    dynamicRoot,
    transparentRoots,
    lights,
    update,
    reset,
    setPaused: value => dynamics.setPaused(value),
    triggerFlap: strength => dynamics.triggerFlap(strength),
    setStudioRig,
    stats() {
      const pose = dynamics.pose();
      const rig = lighting.stats?.() ?? {
        name: LIGHTING_RIG_NAMES[studioRigIndex],
        index: studioRigIndex,
      };
      return Object.freeze({
        seed,
        seedHex: `0x${(seed >>> 0).toString(16).padStart(8, "0").toUpperCase()}`,
        photonicScales: SCALE_COUNT,
        ommatidia: OMMATIDIA_COUNT,
        latticeLayers: LATTICE_LAYER_COUNT,
        peakWavelengthNm: finite(hero?.peakWavelengthNm, 480),
        wingHz: IDLE_WING_HZ,
        leftAngle: pose.leftAngle,
        rightAngle: pose.rightAngle,
        studioRigName: rig.name ?? LIGHTING_RIG_NAMES[studioRigIndex],
        magnificationDomain: magnificationDomain(lastMagnification),
        heroScaleIndex: HERO_SCALE_INDEX,
        chitinIor: CHITIN_IOR,
      });
    },
    dispose() {
      worldRoot.removeFromParent();
      for (const resource of resources) resource.dispose?.();
    },
  });
}
