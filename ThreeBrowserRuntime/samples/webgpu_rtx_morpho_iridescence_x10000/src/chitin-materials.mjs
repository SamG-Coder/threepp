import * as THREE from "three/webgpu";

function applyVelvetSheen(material, sheenColor, sheen = 0.6, sheenRoughness = 0.7) {
  if (!("sheen" in material)) return material;
  material.sheen = sheen;
  material.sheenColor = new THREE.Color(sheenColor);
  material.sheenRoughness = sheenRoughness;
  return material;
}

function preserveRasterTransparency(material, reflectionMask = 0.12) {
  // Keep the transmissive raster layer in the native MRT. An opaque guide
  // clone would drop greenhouse glass and pond water the moment RTX is ready.
  material.rtxPreserveTransparency = 1;
  material.rtxReflectionMask = reflectionMask;
  return material;
}

export function createChitinMaterials({ mossTexture, eyeTexture } = {}) {
  const body = applyVelvetSheen(new THREE.MeshPhysicalNodeMaterial({
    name: "Dark velvet Morpho body chitin",
    color: 0x1a120c,
    roughness: 0.76,
    metalness: 0.05,
    clearcoat: 0.12,
    clearcoatRoughness: 0.58,
    ior: 1.56,
  }), 0x1f6a66, 0.62, 0.7);

  const head = applyVelvetSheen(new THREE.MeshPhysicalNodeMaterial({
    name: "Dark velvet Morpho head chitin",
    color: 0x16100b,
    roughness: 0.7,
    metalness: 0.06,
    clearcoat: 0.16,
    clearcoatRoughness: 0.5,
    ior: 1.56,
  }), 0x24807a, 0.7, 0.64);

  const eye = new THREE.MeshPhysicalNodeMaterial({
    name: "Morpho compound-eye corneal mosaic",
    color: eyeTexture ? 0xffffff : 0x12181c,
    map: eyeTexture || null,
    roughness: 0.22,
    metalness: 0.04,
    clearcoat: 0.85,
    clearcoatRoughness: 0.12,
    ior: 1.56,
  });

  const vein = new THREE.MeshPhysicalNodeMaterial({
    name: "Dark wing-vein chitin",
    color: 0x0e0b08,
    roughness: 0.38,
    metalness: 0.14,
    clearcoat: 0.28,
    clearcoatRoughness: 0.4,
    ior: 1.56,
  });

  const leg = new THREE.MeshPhysicalNodeMaterial({
    name: "Articulated Morpho leg chitin",
    color: 0x22180f,
    roughness: 0.48,
    metalness: 0.1,
    clearcoat: 0.22,
    clearcoatRoughness: 0.45,
    ior: 1.56,
  });

  const antenna = new THREE.MeshPhysicalNodeMaterial({
    name: "Clubbed Morpho antenna chitin",
    color: 0x2c1e14,
    roughness: 0.58,
    metalness: 0.04,
    clearcoat: 0.08,
    clearcoatRoughness: 0.55,
    ior: 1.56,
  });

  const claw = new THREE.MeshPhysicalNodeMaterial({
    name: "Hard Morpho tarsal claw",
    color: 0x0a0806,
    roughness: 0.22,
    metalness: 0.2,
    clearcoat: 0.55,
    clearcoatRoughness: 0.18,
    ior: 1.56,
  });

  const glass = preserveRasterTransparency(new THREE.MeshPhysicalNodeMaterial({
    name: "Victorian greenhouse pane glass",
    color: 0xe8f4f0,
    roughness: 0.028,
    metalness: 0,
    transmission: 0.96,
    thickness: 0.42,
    ior: 1.5,
    attenuationColor: new THREE.Color(0xd4ebe4),
    attenuationDistance: 12,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));

  const water = preserveRasterTransparency(new THREE.MeshPhysicalNodeMaterial({
    name: "Shallow greenhouse pond water",
    color: 0x1a4a52,
    roughness: 0.06,
    metalness: 0,
    transmission: 0.94,
    thickness: 1.6,
    ior: 1.333,
    attenuationColor: new THREE.Color(0x163f46),
    attenuationDistance: 3.8,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    side: THREE.FrontSide,
  }));

  const iron = new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered Victorian greenhouse iron",
    color: 0x12100e,
    metalness: 0.78,
    roughness: 0.42,
    clearcoat: 0.08,
    clearcoatRoughness: 0.4,
  });

  const stone = new THREE.MeshPhysicalNodeMaterial({
    name: "Moss-stained greenhouse plinth stone",
    color: mossTexture ? 0x3a3830 : 0x2a2824,
    map: mossTexture || null,
    roughness: 0.78,
    metalness: 0.03,
  });

  const moss = new THREE.MeshPhysicalNodeMaterial({
    name: "Wet greenhouse floor moss",
    color: mossTexture ? 0x1c2418 : 0x141810,
    map: mossTexture || null,
    roughness: 0.78,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.55,
  });

  const paper = new THREE.MeshPhysicalNodeMaterial({
    name: "Warm paper lantern housing",
    color: 0xffd4a0,
    emissive: 0xffaa55,
    emissiveIntensity: 0.55,
    roughness: 0.62,
    metalness: 0,
  });

  return Object.freeze({
    body,
    head,
    eye,
    vein,
    leg,
    antenna,
    claw,
    glass,
    water,
    iron,
    stone,
    moss,
    paper,
  });
}
