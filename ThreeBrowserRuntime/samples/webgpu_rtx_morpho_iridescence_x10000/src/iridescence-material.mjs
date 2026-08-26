import * as THREE from "three/webgpu";
import {
  abs,
  cameraPosition,
  color,
  dot,
  float,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  saturate,
} from "three/tsl";

const ELECTRIC_BLUE = 0x1a4dff;
const TEAL = 0x12d4b8;
const IRIDESCENCE_THICKNESS_RANGE = [80, 420];
const RTX_REFLECTION_MASK = 0.55;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function physicalSupports(field) {
  const nodeProto = THREE.MeshPhysicalNodeMaterial?.prototype;
  if (nodeProto && field in nodeProto) return true;
  const classicProto = THREE.MeshPhysicalMaterial?.prototype;
  return Boolean(classicProto && field in classicProto);
}

function viewDependentStructuralColor() {
  // Face-on: electric Morpho blue. Grazing: teal. This is a raster stand-in
  // for multilayer interference, not a spectral path trace.
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const facing = saturate(abs(dot(normalWorld, viewDirection)));
  const tilt = saturate(abs(normalWorld.y));
  const lobe = pow(facing.mul(0.78).add(tilt.mul(0.22)), 1.35);
  return mix(color(TEAL), color(ELECTRIC_BLUE), lobe);
}

/**
 * Photonic-crystal scale plates: opaque Bragg reflectors with a clearcoat
 * and a physically inspired iridescence layer (chitin n≈1.56).
 */
export function createIridescenceMaterial({ albedoTexture, ior = 1.56 } = {}) {
  const chitinIor = finite(ior, 1.56);
  const parameters = {
    name: "Morpho photonic-crystal scale iridescence",
    color: ELECTRIC_BLUE,
    roughness: 0.18,
    metalness: 0.08,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    ior: chitinIor,
    sheen: 0.55,
    sheenColor: TEAL,
    sheenRoughness: 0.28,
    transparent: false,
    opacity: 1,
    transmission: 0,
  };

  if (albedoTexture) parameters.map = albedoTexture;

  if (physicalSupports("iridescence") || physicalSupports("iridescenceIOR")) {
    parameters.iridescence = 1;
    parameters.iridescenceIOR = chitinIor;
    parameters.iridescenceThicknessRange = IRIDESCENCE_THICKNESS_RANGE.slice();
  }

  const material = new THREE.MeshPhysicalNodeMaterial(parameters);

  // Own properties so native RTX packing can read them even if this three.js
  // build ignored unknown constructor keys.
  material.iridescence = 1;
  material.iridescenceIOR = chitinIor;
  material.iridescenceThicknessRange = IRIDESCENCE_THICKNESS_RANGE.slice();

  material.transparent = false;
  material.transmission = 0;
  material.rtxReflectionMask = RTX_REFLECTION_MASK;

  const structural = viewDependentStructuralColor();
  const viewDirection = normalize(cameraPosition.sub(positionWorld));
  const facing = saturate(abs(dot(normalWorld, viewDirection)));
  const grazing = float(1).sub(facing);
  material.sheenNode = structural.mul(grazing.mul(0.85).add(0.4));
  material.emissiveNode = structural.mul(facing.mul(0.55).add(0.18));

  return material;
}

export function applyScaleTint(material, { r, g, b } = {}) {
  if (!material) return material;
  const red = finite(r, material.color?.r ?? 0);
  const green = finite(g, material.color?.g ?? 0);
  const blue = finite(b, material.color?.b ?? 0);
  if (material.color?.isColor) material.color.setRGB(red, green, blue);
  if (material.sheenColor?.isColor) material.sheenColor.setRGB(red, green, blue);
  return material;
}
