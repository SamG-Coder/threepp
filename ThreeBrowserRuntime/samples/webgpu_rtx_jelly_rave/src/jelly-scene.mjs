import * as THREE from "three/webgpu";

export const JELLY_RAVE_DIMENSIONS = Object.freeze({
  width: 30,
  height: 16,
  depth: 38,
  floorY: 0,
  stageY: 0.82,
  stageZ: -13.4,
});

const PALETTE = Object.freeze({
  ink: 0x030208,
  steel: 0x161824,
  cyan: 0x19e8ff,
  magenta: 0xff2bd6,
  violet: 0x845cff,
  acid: 0xb9ff28,
  amber: 0xff9b22,
  white: 0xf5fbff,
});

const UP = new THREE.Vector3(0, 1, 0);

function clamp01(value) {
  return THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1);
}

function setRtxSurface(material, reflectionMask, surface) {
  material.rtxReflectionMask = reflectionMask;
  material.userData.rtxUsesResolvedPbr = 1;
  material.userData.rtxTriangleSurface = surface;
  return material;
}

function makeEmissiveMaterial(hex, name, intensity, radiance, roughness = 0.24) {
  const color = new THREE.Color(hex);
  const material = new THREE.MeshStandardNodeMaterial({
    name,
    color: hex,
    emissive: hex,
    emissiveIntensity: intensity,
    roughness,
    metalness: 0.08,
  });
  material.rtxReflectionMask = 0;
  material.userData.baseEmissiveIntensity = intensity;
  material.userData.baseRtxRadiance = radiance;
  material.userData.rtxTriangleSurface = [
    color.r * 0.08,
    color.g * 0.08,
    color.b * 0.08,
    roughness,
  ];
  material.userData.rtxTriangleRadiance = [
    color.r * radiance,
    color.g * radiance,
    color.b * radiance,
    1,
  ];
  return material;
}

function makeGlowMaterial(hex, name, opacity = 0.11, alphaMap = null) {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color: hex,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    alphaMap,
  });
  material.toneMapped = false;
  material.userData.baseOpacity = opacity;
  material.userData.rtxIgnore = true;
  return material;
}

function makeJellyMaterial(hex, name) {
  const color = new THREE.Color(hex);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name,
    color: color.clone().lerp(new THREE.Color(0xffffff), 0.08),
    emissive: color.clone().multiplyScalar(0.035),
    emissiveIntensity: 0.22,
    roughness: 0.19,
    metalness: 0,
    transmission: 0.34,
    thickness: 2.1,
    ior: 1.32,
    attenuationColor: color.clone().multiplyScalar(0.72),
    attenuationDistance: 1.3,
    clearcoat: 0.72,
    clearcoatRoughness: 0.14,
    sheen: 0.78,
    sheenColor: color.clone().lerp(new THREE.Color(PALETTE.white), 0.32),
    sheenRoughness: 0.62,
    iridescence: 0.055,
    iridescenceIOR: 1.3,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    envMapIntensity: 1.65,
    specularIntensity: 0.58,
    specularColor: color.clone().lerp(new THREE.Color(PALETTE.white), 0.5),
  });
  material.rtxReflectionMask = 0.64;
  // The native renderer records primary radiance and reflection guides in one
  // MRT draw. Replacing this transmissive membrane with its opaque guide clone
  // would make the scene look correct during raster startup, then suddenly
  // drop the jelly layering as soon as RTX becomes ready. Preserve the exact
  // transparent material in that pass; the refitted BLAS supplies secondary
  // visibility independently.
  material.rtxPreserveTransparency = 1;
  material.depthWrite = true;
  material.userData.rtxDynamicJelly = true;
  material.userData.rtxTriangleSurface = [color.r * 0.31, color.g * 0.31, color.b * 0.31, 0.19];
  return material;
}

function makeJellyCoreMaterial(hex, name) {
  const color = new THREE.Color(hex);
  const material = new THREE.MeshPhysicalNodeMaterial({
    name,
    color: color.clone().multiplyScalar(0.42),
    emissive: color.clone().multiplyScalar(0.055),
    emissiveIntensity: 0.48,
    roughness: 0.68,
    metalness: 0,
    transmission: 0.12,
    thickness: 0.7,
    ior: 1.22,
    attenuationColor: color.clone().multiplyScalar(0.55),
    attenuationDistance: 0.52,
    clearcoat: 0.08,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.35,
  });
  material.rtxReflectionMask = 0.06;
  material.userData.baseEmissiveIntensity = 0.48;
  material.userData.rtxDynamicJelly = true;
  material.userData.rtxTriangleSurface = [color.r * 0.08, color.g * 0.08, color.b * 0.08, 0.68];
  material.userData.rtxTriangleRadiance = [color.r * 0.12, color.g * 0.12, color.b * 0.12, 1];
  return material;
}

function createEpoxyMicroTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  const random = seededRandom(0x45504f58);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = Math.sin(x * 0.19 + Math.sin(y * 0.071) * 2.1) * 7;
      const fine = (random() - 0.5) * 23;
      const value = THREE.MathUtils.clamp(Math.round(144 + broad + fine), 104, 182);
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "Procedural epoxy orange-peel microtexture";
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(18, 24);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createRadialAlphaTexture(kind = "caustic", size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const radius = Math.sqrt(nx * nx + ny * ny);
      let alpha;
      if (kind === "shadow") {
        alpha = Math.exp(-Math.pow(radius / 0.55, 2.25)) * (1 - THREE.MathUtils.smoothstep(radius, 0.72, 1));
      } else {
        const ring = Math.exp(-Math.pow((radius - 0.64) / 0.16, 2));
        const innerScatter = Math.exp(-Math.pow(radius / 0.76, 2)) * 0.18;
        alpha = (ring * 0.72 + innerScatter) * (1 - THREE.MathUtils.smoothstep(radius, 0.82, 1));
      }
      const value = THREE.MathUtils.clamp(Math.round(alpha * 255), 0, 255);
      const offset = (y * size + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = kind === "shadow" ? "Soft radial contact shadow alpha" : "Soft annular jelly caustic alpha";
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function seededRandom(seed = 0x4a454c4c) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function perturbJellyGeometry(seed) {
  const geometry = new THREE.SphereGeometry(1, 48, 32);
  geometry.name = `Organic jelly membrane ${seed}`;
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const theta = Math.atan2(z, x);
    const phi = Math.acos(THREE.MathUtils.clamp(y, -1, 1));
    const underside = THREE.MathUtils.smoothstep(-y, 0.48, 1);
    const ripple =
      1 +
      Math.sin(theta * (3 + (seed % 3)) + seed * 0.37) * Math.sin(phi * 2.1) * 0.018 +
      Math.cos(theta * 2 - phi * 4 + seed * 0.19) * 0.009 +
      underside * 0.065;
    const flattenedBase = -1 + (y + 1) * 0.18;
    const weightedY = THREE.MathUtils.lerp(y * 0.92 - 0.08, flattenedBase, underside * underside);
    const asymmetricX = x * ripple + Math.sin(phi * 1.7 + seed) * 0.018 * (1 - Math.abs(y));
    const asymmetricZ = z * ripple + Math.cos(theta * 2.3 - seed) * 0.014 * (1 - Math.abs(y));
    position.setXYZ(index, asymmetricX, weightedY, asymmetricZ);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeObjectGraph(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) {
      for (const material of object.material) materials.add(material);
    } else if (object.material) {
      materials.add(object.material);
    }
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

function orientCylinder(mesh, start, end) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  mesh.position.copy(midpoint);
  mesh.scale.y = direction.length();
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  return mesh;
}

/**
 * Procedurally builds a complete, enclosed warehouse rave. Dynamic jelly
 * meshes and laser haze are explicitly tagged so a static RTX collector can
 * keep a stable room BLAS while the caller deforms the creatures every frame.
 */
export function createJellyRaveScene(scene) {
  if (!scene?.isScene) {
    throw new TypeError("createJellyRaveScene requires a THREE.Scene.");
  }

  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const root = new THREE.Group();
  root.name = "RTX jelly warehouse rave";

  const architecture = new THREE.Group();
  architecture.name = "Enclosed high-end warehouse architecture";
  const stage = new THREE.Group();
  stage.name = "DJ stage and sound system";
  const dj = new THREE.Group();
  dj.name = "Monumental original gummy humanoid DJ performance rig";
  const lighting = new THREE.Group();
  lighting.name = "Reactive rave practicals and light fixtures";
  const laserRoot = new THREE.Group();
  laserRoot.name = "Volumetric laser choreography";
  laserRoot.userData.rtxIgnore = true;
  const jellyRoot = new THREE.Group();
  jellyRoot.name = "Dancing translucent jelly crowd";
  jellyRoot.userData.rtxDynamic = true;
  root.add(architecture, stage, dj, lighting, laserRoot, jellyRoot);
  scene.add(root);

  const raveBackground = new THREE.Color(PALETTE.ink);
  const raveFog = new THREE.FogExp2(0x06030f, 0.018);
  scene.background = raveBackground;
  scene.fog = raveFog;

  const staticMeshes = [];
  const lights = [];
  const reactiveMaterials = [];
  const laserMaterials = [];
  const laserPivots = [];
  const equalizerBars = [];
  const jellyDescriptors = [];
  const ownedTextures = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.name = "Shared warehouse box primitive";
  const epoxyMicroTexture = createEpoxyMicroTexture();
  const causticAlphaTexture = createRadialAlphaTexture("caustic");
  const contactShadowAlphaTexture = createRadialAlphaTexture("shadow");
  ownedTextures.push(epoxyMicroTexture, causticAlphaTexture, contactShadowAlphaTexture);

  const blackSteel = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Blackened structural steel",
    color: 0x10121b,
    roughness: 0.34,
    metalness: 0.9,
    clearcoat: 0.22,
    clearcoatRoughness: 0.28,
    envMapIntensity: 1.7,
  }), 0.28, [0.012, 0.014, 0.022, 0.34]);
  const wallMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Charcoal acoustic warehouse concrete",
    color: 0x11111a,
    roughness: 0.73,
    metalness: 0.05,
    clearcoat: 0.04,
    envMapIntensity: 0.7,
  }), 0.05, [0.014, 0.013, 0.024, 0.73]);
  const floorMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Micro-textured polished black epoxy dance floor",
    color: 0x0b0b12,
    roughness: 0.26,
    roughnessMap: epoxyMicroTexture,
    bumpMap: epoxyMicroTexture,
    bumpScale: 0.018,
    metalness: 0.43,
    clearcoat: 0.88,
    clearcoatRoughness: 0.085,
    envMapIntensity: 2.65,
  }), 0.78, [0.021, 0.021, 0.034, 0.18]);
  const brushedMetal = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Brushed titanium stage hardware",
    color: 0x667384,
    roughness: 0.22,
    metalness: 1,
    clearcoat: 0.28,
    clearcoatRoughness: 0.18,
    envMapIntensity: 2.3,
  }), 0.5, [0.16, 0.19, 0.24, 0.22]);
  const speakerMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Soft-touch carbon speaker cabinets",
    color: 0x07080c,
    roughness: 0.53,
    metalness: 0.34,
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
  }), 0.1, [0.005, 0.006, 0.009, 0.53]);
  const chrome = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Liquid chrome DJ booth trim",
    color: 0xd8e9f4,
    roughness: 0.055,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 3.8,
  }), 0.92, [0.73, 0.82, 0.92, 0.055]);
  const paintedHardware = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Scuffed satin-black touring hardware",
    color: 0x20222a,
    roughness: 0.48,
    metalness: 0.72,
    clearcoat: 0.08,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.1,
  }), 0.17, [0.027, 0.029, 0.038, 0.48]);
  const rubberMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Dense black stage rubber",
    color: 0x090a0c,
    roughness: 0.86,
    metalness: 0,
    sheen: 0.08,
  }), 0.015, [0.006, 0.0065, 0.008, 0.86]);

  function addStatic(parent, geometry, material, name, position, scale = null, rotation = null, shadow = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    staticMeshes.push(mesh);
    return mesh;
  }

  function addBox(parent, name, size, position, material, shadow = true) {
    return addStatic(parent, unitBox, material, name, position, size, null, shadow);
  }

  // One continuous floor eliminates coplanar seams while preserving a long,
  // readable reflection runway between camera, jelly crowd, and DJ stage.
  addBox(architecture, "Continuous polished epoxy dance floor", [30, 0.3, 38], [0, -0.15, 0], floorMaterial, false);
  addBox(architecture, "Left warehouse wall", [0.38, 16.4, 38.5], [-15.18, 8, 0], wallMaterial);
  addBox(architecture, "Right warehouse wall", [0.38, 16.4, 38.5], [15.18, 8, 0], wallMaterial);
  addBox(architecture, "Rear warehouse wall", [30.4, 16.4, 0.38], [0, 8, -19.18], wallMaterial);
  addBox(architecture, "Ribbed warehouse ceiling", [30.4, 0.3, 38.5], [0, 16.15, 0], blackSteel);

  for (const x of [-14.35, 14.35]) {
    for (const z of [-15, -7.5, 0, 7.5, 15]) {
      addBox(architecture, "Warehouse I-beam column", [0.42, 15.7, 0.46], [x, 7.85, z], blackSteel);
      addBox(architecture, "Column base shoe", [0.9, 0.18, 0.9], [x, 0.09, z], brushedMetal);
    }
  }
  for (const z of [-15, -7.5, 0, 7.5, 15]) {
    addBox(architecture, "Overhead structural crossbeam", [29.2, 0.42, 0.48], [0, 14.35, z], blackSteel);
  }

  // Acoustic wall coffers break up the room and make colored RTX bounce light
  // legible instead of leaving large, featureless dark surfaces.
  for (const side of [-1, 1]) {
    for (let bay = 0; bay < 5; bay += 1) {
      const z = -14 + bay * 7;
      addBox(
        architecture,
        "Angled acoustic wall coffer",
        [0.24, 4.6, 5.4],
        [side * 14.86, 7.4, z],
        blackSteel,
      ).rotation.z = side * 0.04;
    }
  }

  // Low-cost production detail anchors the scale: electrical conduit,
  // service boxes, cable trays, floor drains, and fasteners catch narrow neon
  // highlights without turning the room into a high-triangle asset pack.
  const conduitGeometry = new THREE.CylinderGeometry(0.045, 0.045, 1, 8);
  for (const side of [-1, 1]) {
    for (const z of [-11.2, 1.8, 12.1]) {
      addStatic(
        architecture,
        conduitGeometry,
        paintedHardware,
        "Surface-mounted electrical conduit",
        [side * 14.66, 7.2, z],
        [1, 10.2, 1],
      );
      addBox(
        architecture,
        "Industrial electrical junction enclosure",
        [0.2, 0.66, 0.82],
        [side * 14.63, 4.4, z],
        paintedHardware,
      );
    }
  }
  for (const x of [-9.4, 0, 9.4]) {
    addBox(architecture, "Perforated overhead cable tray", [4.8, 0.12, 0.56], [x, 13.82, 10.4], paintedHardware);
    for (const localX of [-1.8, 0, 1.8]) {
      addStatic(
        architecture,
        new THREE.CylinderGeometry(0.06, 0.06, 0.07, 8),
        brushedMetal,
        "Cable tray suspension fastener",
        [x + localX, 13.7, 10.4],
      );
    }
  }
  for (const z of [-1.5, 9.5]) {
    for (const x of [-12.8, 12.8]) {
      addBox(architecture, "Recessed linear floor drain", [0.72, 0.025, 3.2], [x, 0.008, z], rubberMaterial, false);
      for (let slot = -1.25; slot <= 1.25; slot += 0.5) {
        addBox(architecture, "Floor drain stainless slot", [0.5, 0.012, 0.035], [x, 0.023, z + slot], brushedMetal, false);
      }
    }
  }

  const cyanEmitter = makeEmissiveMaterial(PALETTE.cyan, "Cyan architectural emitter", 2.8, 5.2);
  const magentaEmitter = makeEmissiveMaterial(PALETTE.magenta, "Magenta architectural emitter", 2.7, 5.0);
  const violetEmitter = makeEmissiveMaterial(PALETTE.violet, "Violet architectural emitter", 2.65, 4.9);
  const acidEmitter = makeEmissiveMaterial(PALETTE.acid, "Acid green architectural emitter", 2.45, 4.6);
  const whiteEmitter = makeEmissiveMaterial(0xbfd8ff, "Cool blue-white stage emitter", 1.55, 3.1);
  reactiveMaterials.push(cyanEmitter, magentaEmitter, violetEmitter, acidEmitter, whiteEmitter);

  const stripGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let index = 0; index < 9; index += 1) {
    const z = 15.5 - index * 3.8;
    const material = index % 2 ? magentaEmitter : cyanEmitter;
    addStatic(
      architecture,
      stripGeometry,
      material,
      "Flush floor runway emitter",
      [0, 0.026, z],
      [0.055, 0.018, 2.7],
      null,
      false,
    );
    for (const x of [-11.6, 11.6]) {
      addStatic(
        architecture,
        stripGeometry,
        index % 2 ? violetEmitter : acidEmitter,
        "Recessed wall rhythm strip",
        [x, 6.8, z],
        [0.035, 3.8, 0.055],
        null,
        false,
      );
    }
  }

  // Raised stage and a deep LED wall provide a bright focal destination.
  addBox(stage, "Floating DJ stage plinth", [23.2, 0.82, 8.4], [0, 0.41, -14.2], blackSteel);
  addBox(stage, "Polished stage deck", [22.7, 0.12, 7.9], [0, 0.88, -14.2], floorMaterial, false);
  addBox(stage, "LED wall black backing", [21.6, 10.8, 0.45], [0, 7.55, -18.55], speakerMaterial);

  const ledMaterials = [
    makeEmissiveMaterial(0x08a9c8, "Controlled cyan LED pixel", 1.45, 3.4),
    makeEmissiveMaterial(0xc30a9d, "Controlled magenta LED pixel", 1.38, 3.25),
    makeEmissiveMaterial(0x5d38c9, "Controlled violet LED pixel", 1.4, 3.3),
    makeEmissiveMaterial(0x78bd19, "Controlled acid LED pixel", 1.32, 3.15),
  ];
  reactiveMaterials.push(...ledMaterials);
  const ledPanelGeometry = new THREE.BoxGeometry(1.03, 1.03, 0.075);
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 16; column += 1) {
      const pattern = (column + row * 3 + Math.floor(column / 4)) % ledMaterials.length;
      const panel = addStatic(
        stage,
        ledPanelGeometry,
        ledMaterials[pattern],
        "Reactive high-density LED wall pixel",
        [-9.75 + column * 1.3, 3.55 + row * 1.17, -18.28],
        null,
        null,
        false,
      );
      panel.userData.ledPhase = column * 0.38 + row * 0.71;
      panel.userData.ledBand = row;
    }
  }

  // Truss lattice is actual geometry, so lasers and spots read as mounted
  // production equipment instead of unsupported floating light sources.
  const trussGeometry = new THREE.CylinderGeometry(0.07, 0.07, 1, 10);
  for (const z of [-9.8, -2.5, 6.5]) {
    for (const y of [12.2, 13.0]) {
      const beam = new THREE.Mesh(trussGeometry, brushedMetal);
      beam.name = "Overhead aluminium lighting truss chord";
      orientCylinder(beam, new THREE.Vector3(-12.8, y, z), new THREE.Vector3(12.8, y, z));
      beam.castShadow = true;
      beam.receiveShadow = true;
      lighting.add(beam);
      staticMeshes.push(beam);
    }
    for (let x = -12; x <= 12; x += 1.5) {
      const brace = new THREE.Mesh(trussGeometry, brushedMetal);
      brace.name = "Triangulated lighting truss brace";
      orientCylinder(
        brace,
        new THREE.Vector3(x, 12.2, z),
        new THREE.Vector3(x + 0.75, 13.0, z),
      );
      lighting.add(brace);
      staticMeshes.push(brace);
    }
  }

  // DJ booth, professional decks, and a towering original gummy performer.
  addBox(stage, "DJ booth sculpted black body", [9.6, 3.0, 2.15], [0, 2.42, -11.1], speakerMaterial);
  addBox(stage, "DJ booth chrome cap", [10.05, 0.18, 2.35], [0, 3.96, -11.1], chrome);
  addBox(stage, "DJ booth luminous fascia", [8.85, 1.45, 0.08], [0, 2.55, -9.99], violetEmitter, false);

  const platterGeometry = new THREE.CylinderGeometry(0.72, 0.72, 0.08, 48);
  for (const x of [-2.55, 2.55]) {
    addStatic(stage, platterGeometry, chrome, "Mirror chrome DJ platter", [x, 4.11, -10.78], null, null, true);
    addStatic(stage, new THREE.CylinderGeometry(0.31, 0.31, 0.035, 32), cyanEmitter, "Glowing deck jog wheel", [x, 4.17, -10.78], null, null, false);
  }
  addBox(stage, "Central DJ mixer", [2.65, 0.14, 1.42], [0, 4.12, -10.8], blackSteel);
  for (let x = -0.95; x <= 0.95; x += 0.38) {
    addStatic(stage, new THREE.CylinderGeometry(0.055, 0.055, 0.12, 12), whiteEmitter, "Mixer control encoder", [x, 4.24, -10.8], null, null, false);
  }

  for (let index = 0; index < 24; index += 1) {
    const bar = new THREE.Mesh(unitBox, index % 2 ? cyanEmitter : magentaEmitter);
    bar.name = "Audio-reactive booth equalizer bar";
    bar.position.set(-4.05 + index * 0.352, 2.05, -9.925);
    bar.scale.set(0.17, 0.55, 0.025);
    bar.userData.baseY = bar.position.y;
    bar.userData.phase = index * 0.57;
    bar.userData.rtxIgnore = true;
    bar.castShadow = false;
    stage.add(bar);
    equalizerBars.push(bar);
  }

  addBox(stage, "Rubberized stage front nosing", [22.7, 0.16, 0.22], [0, 0.88, -10.27], rubberMaterial);
  for (const x of [-4.72, 4.72]) {
    addBox(stage, "DJ booth vertical chrome edge protector", [0.11, 2.82, 0.12], [x, 2.42, -9.96], chrome);
  }
  for (const x of [-7.2, 7.2]) {
    addBox(stage, "Touring equipment flight case", [2.2, 1.42, 1.6], [x, 1.66, -13.4], paintedHardware);
    for (const side of [-1, 1]) {
      addBox(stage, "Flight case aluminium corner rail", [0.07, 1.44, 1.64], [x + side * 1.08, 1.66, -13.4], brushedMetal);
    }
    addBox(stage, "Recessed flight case handle", [0.62, 0.24, 0.05], [x, 1.7, -12.57], rubberMaterial);
  }
  for (let bolt = -10.5; bolt <= 10.5; bolt += 1.5) {
    addStatic(
      stage,
      new THREE.CylinderGeometry(0.035, 0.035, 0.025, 8),
      brushedMetal,
      "Stage deck countersunk fastener",
      [bolt, 0.956, -10.42],
      null,
      null,
      false,
    );
  }

  const gummyDjMaterial = makeJellyMaterial(0xd63cff, "Towering amethyst gummy DJ skin");
  // The static triangle collector intentionally rejects transparency. This
  // shell therefore uses a saturated opaque dielectric gummy treatment so the
  // entire performer remains present in native ray reflections.
  gummyDjMaterial.color.set(0x8e16c7);
  gummyDjMaterial.emissive.set(0x13021e);
  gummyDjMaterial.emissiveIntensity = 0.42;
  gummyDjMaterial.roughness = 0.13;
  gummyDjMaterial.transmission = 0;
  gummyDjMaterial.thickness = 0;
  gummyDjMaterial.clearcoat = 1;
  gummyDjMaterial.clearcoatRoughness = 0.075;
  gummyDjMaterial.sheen = 0.82;
  gummyDjMaterial.iridescence = 0.1;
  gummyDjMaterial.opacity = 1;
  gummyDjMaterial.transparent = false;
  gummyDjMaterial.depthWrite = true;
  gummyDjMaterial.rtxPreserveTransparency = 0;
  gummyDjMaterial.rtxReflectionMask = 0.72;
  gummyDjMaterial.userData.rtxTriangleSurface = [0.27, 0.015, 0.48, 0.13];
  gummyDjMaterial.userData.rtxDynamicJelly = false;
  const gummyCoreMaterial = makeEmissiveMaterial(
    0x19e8ff,
    "Gummy DJ diffused internal cyan core",
    0.68,
    1.35,
    0.62,
  );
  const gummyVeinMaterial = makeEmissiveMaterial(
    0xff2bd6,
    "Gummy DJ internal magenta vein",
    0.92,
    1.7,
    0.48,
  );
  const gummyVisorEmitter = makeEmissiveMaterial(
    0x6822a6,
    "Gummy DJ controlled visor underglow",
    1.3,
    2.5,
    0.2,
  );
  reactiveMaterials.push(gummyCoreMaterial, gummyVeinMaterial, gummyVisorEmitter);

  const performer = new THREE.Group();
  performer.name = "Massive original gelatinous humanoid DJ";
  performer.userData.originalCharacter = true;
  dj.add(performer);

  function addPerformerMesh(geometry, material, name, position, scale = null, rotation = null, shadow = true) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    performer.add(mesh);
    staticMeshes.push(mesh);
    return mesh;
  }

  const gummyTorso = addPerformerMesh(
    perturbJellyGeometry(93),
    gummyDjMaterial,
    "Monumental broad gelatinous DJ belly and torso",
    [0, 7.35, -13.05],
    [2.75, 3.15, 1.72],
  );
  const gummyHead = addPerformerMesh(
    perturbJellyGeometry(117),
    gummyDjMaterial,
    "Distinct glossy gummy DJ head",
    [0, 11.0, -12.75],
    [1.62, 1.48, 1.34],
  );
  for (const side of [-1, 1]) {
    addPerformerMesh(
      new THREE.SphereGeometry(1, 24, 16),
      gummyDjMaterial,
      "Heavy soft gummy shoulder",
      [side * 2.38, 8.78, -12.75],
      [1.05, 1.12, 1.02],
    );
    const shoulder = new THREE.Vector3(side * 2.32, 8.65, -12.42);
    const elbow = new THREE.Vector3(side * 3.18, 6.65, -11.45);
    const hand = new THREE.Vector3(side * 2.62, 4.42, -10.72);
    for (const [start, end, label, thickness] of [
      [shoulder, elbow, "Thick upper gummy performance arm", 0.62],
      [elbow, hand, "Soft articulated gummy forearm reaching the deck", 0.54],
    ]) {
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(thickness, thickness * 1.04, 1, 18), gummyDjMaterial);
      limb.name = label;
      orientCylinder(limb, start, end);
      limb.castShadow = true;
      limb.receiveShadow = true;
      performer.add(limb);
      staticMeshes.push(limb);
    }
    addPerformerMesh(
      new THREE.SphereGeometry(1, 20, 14),
      gummyDjMaterial,
      "Squashy gummy elbow joint",
      elbow.toArray(),
      [0.68, 0.62, 0.68],
    );
    addPerformerMesh(
      new THREE.SphereGeometry(1, 24, 16),
      gummyDjMaterial,
      "Broad gummy hand poised on DJ deck",
      hand.toArray(),
      [0.74, 0.34, 0.66],
      [0, 0, side * 0.12],
    );
  }

  const performerCore = addPerformerMesh(
    new THREE.SphereGeometry(1, 24, 18),
    gummyCoreMaterial,
    "Diffused bioluminescent heart visible through gummy torso",
    [0, 7.55, -11.27],
    [1.15, 1.62, 0.095],
    null,
    false,
  );
  const veinGeometry = new THREE.TorusKnotGeometry(1.05, 0.055, 72, 7, 2, 3);
  const veins = addPerformerMesh(
    veinGeometry,
    gummyVeinMaterial,
    "Subsurface neon vein network inside gummy DJ",
    [0, 7.35, -11.18],
    [1.4, 1.8, 0.12],
    [0.18, 0.15, 0],
    false,
  );

  const visor = addPerformerMesh(
    new THREE.SphereGeometry(1, 32, 18),
    chrome,
    "Wide liquid-chrome gummy DJ visor",
    [0, 11.08, -11.55],
    [1.28, 0.3, 0.19],
    null,
    true,
  );
  const visorGlow = addPerformerMesh(
    new THREE.SphereGeometry(1, 24, 12),
    gummyVisorEmitter,
    "Recessed violet visor illumination",
    [0, 11.08, -11.72],
    [1.12, 0.22, 0.11],
    null,
    false,
  );
  addPerformerMesh(
    new THREE.TorusGeometry(1.58, 0.15, 12, 44, Math.PI * 1.64),
    chrome,
    "Oversized reflective gummy DJ headphone band",
    [0, 11.14, -12.75],
    null,
    [0, 0, -Math.PI * 0.82],
  );
  for (const side of [-1, 1]) {
    addPerformerMesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.28, 24),
      chrome,
      "Reflective over-ear headphone cup",
      [side * 1.5, 10.92, -12.65],
      null,
      [0, 0, Math.PI * 0.5],
    );
  }

  // Preserve the historical aliases used by the main module while replacing
  // their former tiny robot targets with the much larger gummy performer.
  dj.userData.robotTorso = gummyTorso;
  dj.userData.robotHead = gummyHead;
  dj.userData.robotVisor = visor;
  dj.userData.performer = performer;
  dj.userData.performerCore = performerCore;
  dj.userData.performerVeins = veins;

  // Four large-format speaker towers with readable cones and waveguides.
  const wooferCone = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Graphite speaker cone",
    color: 0x11131b,
    roughness: 0.42,
    metalness: 0.54,
    clearcoat: 0.18,
    clearcoatRoughness: 0.32,
  }), 0.18, [0.015, 0.017, 0.025, 0.42]);
  for (const side of [-1, 1]) {
    for (const level of [0, 1]) {
      const x = side * 10.4;
      const y = 2.25 + level * 3.45;
      addBox(stage, "Touring line-array speaker cabinet", [3.05, 3.15, 1.62], [x, y, -12.65], speakerMaterial);
      for (const coneY of [y - 0.68, y + 0.68]) {
        addStatic(
          stage,
          new THREE.CylinderGeometry(0.62, 0.38, 0.16, 36),
          wooferCone,
          "Deep graphite woofer cone",
          [x, coneY, -11.78],
          null,
          [Math.PI * 0.5, 0, 0],
        );
        addStatic(
          stage,
          new THREE.TorusGeometry(0.63, 0.075, 12, 36),
          brushedMetal,
          "Machined woofer surround",
          [x, coneY, -11.67],
        );
      }
    }
  }

  // Moving heads pair physically shadowing SpotLights with raster-only haze
  // cones. The narrow cores stay crisp in reflections; haze never enters RTX.
  const fixtureBodyGeometry = new THREE.CylinderGeometry(0.34, 0.42, 0.65, 16);
  const spotColors = [PALETTE.cyan, PALETTE.magenta, PALETTE.violet, PALETTE.acid, PALETTE.amber, PALETTE.cyan];
  const spotPositions = [
    [-10.5, 11.8, -9.8], [-6.4, 11.8, -9.8], [-2.2, 11.8, -9.8],
    [2.2, 11.8, -9.8], [6.4, 11.8, -9.8], [10.5, 11.8, -9.8],
  ];

  for (let index = 0; index < spotPositions.length; index += 1) {
    const [x, y, z] = spotPositions[index];
    addStatic(lighting, fixtureBodyGeometry, blackSteel, "Motorized concert moving-head fixture", [x, y, z]);
    addStatic(
      lighting,
      new THREE.CylinderGeometry(0.48, 0.48, 0.16, 16),
      paintedHardware,
      "Moving-head rotating pan base",
      [x, y + 0.43, z],
    );
    for (const side of [-1, 1]) {
      addBox(
        lighting,
        "Moving-head cast aluminium yoke arm",
        [0.11, 0.72, 0.14],
        [x + side * 0.42, y + 0.06, z],
        paintedHardware,
      );
    }
    addStatic(lighting, new THREE.CylinderGeometry(0.19, 0.19, 0.05, 20), whiteEmitter, "Moving-head optical lens", [x, y - 0.35, z], null, null, false);
    const spot = new THREE.SpotLight(spotColors[index], 245, 42, 0.34, 0.72, 1.25);
    spot.name = "Audio-reactive narrow-beam stage spotlight";
    spot.position.set(x, y - 0.38, z);
    spot.castShadow = index % 2 === 0;
    spot.shadow.mapSize.set(1024, 1024);
    spot.shadow.bias = -0.00025;
    spot.shadow.normalBias = 0.025;
    spot.userData.baseIntensity = 245;
    spot.userData.phase = index * 0.91;
    spot.userData.baseHue = new THREE.Color(spotColors[index]).getHSL({ h: 0, s: 0, l: 0 }).h;
    spot.target.position.set((index - 2.5) * 2.1, 0, 4 + (index % 2) * 5);
    lighting.add(spot, spot.target);
    lights.push(spot);
  }

  for (const [index, entry] of [
    [-1, [-11.4, 6.1, -5.5, PALETTE.magenta]],
    [0, [11.4, 5.0, -2.0, PALETTE.cyan]],
    [1, [-11.4, 4.4, 7.0, PALETTE.violet]],
    [2, [11.4, 6.8, 10.0, PALETTE.acid]],
  ]) {
    const [x, y, z, hex] = entry;
    const point = new THREE.PointLight(hex, 105, 18, 1.65);
    point.name = "Low-level jelly rim practical";
    point.position.set(x, y, z);
    point.userData.baseIntensity = 105;
    point.userData.phase = index * 1.7;
    lighting.add(point);
    lights.push(point);
  }

  const ambient = new THREE.HemisphereLight(0x263a67, 0x09020d, 0.68);
  ambient.name = "Deep blue warehouse ambience";
  lighting.add(ambient);
  lights.push(ambient);

  const beamGeometry = new THREE.CylinderGeometry(0.018, 0.065, 1, 8, 1, true);
  const hazeGeometry = new THREE.CylinderGeometry(0.035, 0.48, 1, 10, 1, true);
  for (let index = 0; index < 10; index += 1) {
    const color = [PALETTE.cyan, PALETTE.magenta, PALETTE.violet, PALETTE.acid][index % 4];
    const beamMaterial = makeGlowMaterial(color, "Laser beam hot core", 0.82);
    const hazeMaterial = makeGlowMaterial(color, "Laser atmospheric scattering sleeve", 0.045);
    laserMaterials.push(beamMaterial, hazeMaterial);
    const pivot = new THREE.Group();
    pivot.name = "Kinetic multi-axis laser scanner";
    pivot.position.set(-11.5 + (index % 5) * 5.75, 10.9, index < 5 ? -5.4 : 3.5);
    pivot.userData.phase = index * 0.73;
    pivot.userData.baseYaw = -0.75 + (index % 5) * 0.375;
    pivot.userData.basePitch = 0.3 + (index % 3) * 0.07;
    const beamLength = 21;
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.name = "Coherent laser core";
    beam.scale.y = beamLength;
    beam.position.y = -beamLength * 0.5;
    const haze = new THREE.Mesh(hazeGeometry, hazeMaterial);
    haze.name = "Fine haze illuminated by laser";
    haze.scale.y = beamLength;
    haze.position.y = -beamLength * 0.5;
    pivot.add(haze, beam);
    laserRoot.add(pivot);
    laserPivots.push(pivot);
  }

  const jellyColors = [
    PALETTE.cyan, PALETTE.magenta, PALETTE.acid, PALETTE.violet,
    PALETTE.amber, 0x47ffa6, 0xff4d7a, 0x52a8ff,
  ];
  const jellyLayout = [
    [0, 1.62, 3.5, 1.58], [-4.4, 1.18, 5.7, 1.15], [4.5, 1.3, 6.2, 1.27],
    [-8.2, 0.98, 1.5, 0.96], [8.2, 1.08, 1.0, 1.05], [-5.8, 1.15, -3.0, 1.12],
    [5.8, 1.0, -2.8, 0.98], [-9.8, 0.82, 8.8, 0.8], [9.4, 0.88, 9.8, 0.86],
    [-2.6, 0.83, 10.8, 0.82], [2.7, 0.95, 11.5, 0.93], [-7.5, 0.72, 14.1, 0.7],
    [7.4, 0.77, 14.8, 0.75], [0.2, 0.72, -5.0, 0.7],
  ];
  const random = seededRandom();
  const innerCoreGeometry = new THREE.SphereGeometry(0.46, 24, 16);
  const innerVesicleGeometry = new THREE.SphereGeometry(0.11, 14, 9);
  const contactDiscGeometry = new THREE.CircleGeometry(1.34, 48);
  const contactShadowGeometry = new THREE.CircleGeometry(1.12, 40);
  const contactRingGeometry = new THREE.TorusGeometry(0.78, 0.038, 8, 40);
  for (let index = 0; index < jellyLayout.length; index += 1) {
    const [x, y, z, radius] = jellyLayout[index];
    const color = jellyColors[index % jellyColors.length];
    const jellyGroup = new THREE.Group();
    jellyGroup.name = index === 0 ? "Hero photoreal translucent jelly" : "Dancing translucent jelly";
    jellyGroup.position.set(x, y, z);
    // The physics solver exposes a radius-sized body.scale, so the entire
    // creature uses that same root transform. Membrane scales stay normalized
    // and only carry a little individual asymmetry.
    jellyGroup.scale.setScalar(radius);
    jellyGroup.userData.rtxDynamic = true;

    const membraneMaterial = makeJellyMaterial(color, `Clearcoat jelly membrane ${index + 1}`);
    const membrane = new THREE.Mesh(perturbJellyGeometry(index + 3), membraneMaterial);
    membrane.name = "Thick refractive organic jelly membrane";
    membrane.scale.set(0.91 + random() * 0.16, 1, 0.91 + random() * 0.16);
    membrane.castShadow = true;
    membrane.receiveShadow = true;
    membrane.userData.rtxDynamicJelly = true;

    const coreMaterial = makeJellyCoreMaterial(color, `Diffused internal jelly scattering ${index + 1}`);
    const core = new THREE.Mesh(innerCoreGeometry, coreMaterial);
    core.name = "Soft diffused internal scattering lobe";
    core.position.y = -0.16;
    core.scale.set(1.02, 0.62, 0.86);
    core.castShadow = false;
    const innerScattering = new THREE.Group();
    innerScattering.name = "Subtle suspended jelly vesicles";
    for (let vesicleIndex = 0; vesicleIndex < 4; vesicleIndex += 1) {
      const vesicle = new THREE.Mesh(innerVesicleGeometry, coreMaterial);
      const angle = vesicleIndex * Math.PI * 0.5 + random() * 0.35;
      const distance = 0.19 + random() * 0.2;
      vesicle.position.set(
        Math.cos(angle) * distance,
        -0.1 + random() * 0.38,
        Math.sin(angle) * distance * 0.72,
      );
      vesicle.scale.setScalar(0.68 + random() * 0.5);
      innerScattering.add(vesicle);
    }
    jellyGroup.add(core, innerScattering, membrane);

    const causticMaterial = makeGlowMaterial(
      color,
      `Soft annular jelly contact caustic ${index + 1}`,
      0.082,
      causticAlphaTexture,
    );
    const caustic = new THREE.Mesh(contactDiscGeometry, causticMaterial);
    caustic.name = "Soft gradient jelly contact caustic";
    caustic.rotation.x = -Math.PI * 0.5;
    caustic.position.set(x, 0.013, z);
    caustic.scale.set(radius, radius, 1);

    const contactShadowMaterial = new THREE.MeshBasicNodeMaterial({
      name: `Soft grounded jelly contact shadow ${index + 1}`,
      color: 0x000000,
      transparent: true,
      opacity: 0.3,
      alphaMap: contactShadowAlphaTexture,
      depthWrite: false,
      depthTest: true,
      fog: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    contactShadowMaterial.toneMapped = false;
    contactShadowMaterial.userData.baseOpacity = 0.3;
    contactShadowMaterial.userData.rtxIgnore = true;
    const contactShadow = new THREE.Mesh(contactShadowGeometry, contactShadowMaterial);
    contactShadow.name = "Soft floor-bound jelly contact shadow";
    contactShadow.rotation.x = -Math.PI * 0.5;
    contactShadow.position.set(x, 0.006, z);
    contactShadow.scale.set(radius, radius, 1);

    const causticRingMaterial = makeGlowMaterial(color, `Fine jelly contact rim ${index + 1}`, 0.052);
    const causticRing = new THREE.Mesh(contactRingGeometry, causticRingMaterial);
    causticRing.name = "Fine broken-light contact ring";
    causticRing.rotation.x = -Math.PI * 0.5;
    causticRing.position.set(x, 0.019, z);
    causticRing.scale.set(radius, radius * 0.86, 1);
    jellyRoot.add(contactShadow, caustic, causticRing, jellyGroup);
    const baseScale = jellyGroup.scale.clone();
    const descriptor = {
      index,
      id: `jelly-${index + 1}`,
      root: jellyGroup,
      mesh: membrane,
      membrane,
      core,
      innerScattering,
      caustic,
      causticRing,
      contactShadow,
      material: membraneMaterial,
      coreMaterial,
      baseScale,
      membraneBaseScale: membrane.scale.clone(),
      baseRootScale: baseScale.clone(),
      basePosition: jellyGroup.position.clone(),
      radius,
      phase: random() * Math.PI * 2,
      frequency: 0.82 + random() * 0.55,
      wobble: 0.09 + random() * 0.08,
      squash: 0.16 + random() * 0.11,
      spin: (random() - 0.5) * 0.5,
      color: new THREE.Color(color),
      contactProximity: 1,
      /**
       * Apply the physics body's absolute pose. `body.scale` already contains
       * its authored radius; relativeScale is accepted only as a fallback and
       * is multiplied by radius exactly once.
       */
      applyBody(body) {
        if (!body) return descriptor;
        if (body.position?.isVector3) jellyGroup.position.copy(body.position);
        if (body.quaternion?.isQuaternion) jellyGroup.quaternion.copy(body.quaternion);
        if (body.scale?.isVector3) {
          jellyGroup.scale.copy(body.scale);
        } else if (body.relativeScale?.isVector3) {
          jellyGroup.scale.copy(body.relativeScale).multiplyScalar(radius);
        } else {
          jellyGroup.scale.copy(baseScale);
        }

        // Contact light stays attached in X/Z but remains on the physical
        // floor rather than following a jumping body's vertical transform.
        caustic.position.x = jellyGroup.position.x;
        caustic.position.z = jellyGroup.position.z;
        caustic.scale.set(jellyGroup.scale.x, jellyGroup.scale.z, 1);
        causticRing.position.x = jellyGroup.position.x;
        causticRing.position.z = jellyGroup.position.z;
        causticRing.scale.set(jellyGroup.scale.x, jellyGroup.scale.z * 0.86, 1);
        contactShadow.position.x = jellyGroup.position.x;
        contactShadow.position.z = jellyGroup.position.z;
        contactShadow.scale.set(jellyGroup.scale.x * 0.9, jellyGroup.scale.z * 0.82, 1);
        const clearance = Math.max(0, jellyGroup.position.y - radius);
        const proximity = 1 - THREE.MathUtils.clamp(clearance / Math.max(0.25, radius * 2.2), 0, 1);
        descriptor.contactProximity = proximity;
        caustic.material.opacity = caustic.material.userData.baseOpacity * proximity;
        causticRing.material.opacity = causticRing.material.userData.baseOpacity * proximity;
        contactShadow.material.opacity = contactShadow.material.userData.baseOpacity * proximity;
        return descriptor;
      },
    };
    jellyGroup.userData.jellyId = descriptor.id;
    jellyDescriptors.push(descriptor);
  }

  function updateReactiveLighting(time = 0, beat = 0, bass = 0) {
    const safeTime = Number.isFinite(time) ? time : 0;
    const beatAmount = clamp01(beat);
    const bassAmount = clamp01(bass);
    const energy = THREE.MathUtils.clamp(0.18 + beatAmount * 0.48 + bassAmount * 0.72, 0.18, 1.35);

    for (let index = 0; index < reactiveMaterials.length; index += 1) {
      const material = reactiveMaterials[index];
      const pulse = 0.82 + Math.sin(safeTime * (3.7 + index * 0.31) + index * 1.2) * 0.11;
      const gain = pulse + beatAmount * (0.75 + index * 0.08) + bassAmount * 0.52;
      material.emissiveIntensity = material.userData.baseEmissiveIntensity * gain;
      const color = material.emissive;
      const radiance = material.userData.baseRtxRadiance * gain;
      material.userData.rtxTriangleRadiance[0] = color.r * radiance;
      material.userData.rtxTriangleRadiance[1] = color.g * radiance;
      material.userData.rtxTriangleRadiance[2] = color.b * radiance;
    }

    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (!Number.isFinite(light.userData.baseIntensity)) continue;
      const sweep = 0.72 + Math.sin(safeTime * 2.3 + (light.userData.phase ?? index)) * 0.18;
      light.intensity = light.userData.baseIntensity * (sweep + energy * 0.78);
      if (light.isSpotLight) {
        const hue = (light.userData.baseHue + safeTime * 0.025 + bassAmount * 0.045) % 1;
        light.color.setHSL(hue, 0.95, 0.58);
        light.target.position.x = Math.sin(safeTime * 0.63 + index * 1.12) * 10.5;
        light.target.position.z = 2.5 + Math.cos(safeTime * 0.47 + index * 0.86) * 9.5;
      }
    }

    for (let index = 0; index < laserPivots.length; index += 1) {
      const pivot = laserPivots[index];
      const phase = pivot.userData.phase;
      pivot.rotation.z = pivot.userData.baseYaw + Math.sin(safeTime * 0.72 + phase) * (0.28 + bassAmount * 0.18);
      pivot.rotation.x = pivot.userData.basePitch + Math.cos(safeTime * 0.91 + phase) * 0.18;
    }
    for (let index = 0; index < laserMaterials.length; index += 1) {
      const material = laserMaterials[index];
      const flicker = 0.82 + Math.sin(safeTime * 14 + index * 2.4) * 0.08;
      material.opacity = material.userData.baseOpacity * flicker * (0.72 + energy * 0.65);
    }

    for (let index = 0; index < equalizerBars.length; index += 1) {
      const bar = equalizerBars[index];
      const level = 0.28 + bassAmount * 0.9 + Math.max(0, Math.sin(safeTime * 7.2 + bar.userData.phase)) * (0.62 + beatAmount);
      bar.scale.y = level;
      bar.position.y = bar.userData.baseY - 0.55 + level * 0.5;
    }
    // LED pixels and robot geometry remain transform-stable for the static
    // room BLAS. Their shared emissive materials deliver the animation.
    visorGlow.material.emissiveIntensity = 1.15 + beatAmount * 1.1 + bassAmount * 0.8;

    for (const jelly of jellyDescriptors) {
      const proximity = jelly.contactProximity ?? 1;
      jelly.coreMaterial.emissiveIntensity = 0.38 + energy * 0.62 + Math.sin(safeTime * 2.4 + jelly.phase) * 0.08;
      jelly.caustic.material.opacity = jelly.caustic.material.userData.baseOpacity * proximity * (0.6 + energy * 0.34);
      jelly.causticRing.material.opacity = jelly.causticRing.material.userData.baseOpacity * proximity * (0.65 + energy * 0.42);
      jelly.contactShadow.material.opacity = jelly.contactShadow.material.userData.baseOpacity * proximity * (0.92 - energy * 0.08);
    }
  }

  function dispose() {
    scene.remove(root);
    if (scene.background === raveBackground) scene.background = previousBackground;
    if (scene.fog === raveFog) scene.fog = previousFog;
    disposeObjectGraph(root);
    for (const texture of ownedTextures) texture.dispose?.();
  }

  const sceneGroups = Object.freeze({ root, architecture, stage, dj, lighting, lasers: laserRoot, jellies: jellyRoot });
  return {
    root,
    groups: sceneGroups,
    sceneGroups,
    architecture,
    stage,
    dj,
    lighting,
    laserRoot,
    jellyRoot,
    jellies: jellyDescriptors,
    jellyDescriptors,
    staticMeshes,
    lights,
    updateReactiveLighting,
    dispose,
  };
}
