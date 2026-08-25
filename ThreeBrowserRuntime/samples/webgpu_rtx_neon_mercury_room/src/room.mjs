import * as THREE from "three/webgpu";

export const NEON_MERCURY_ROOM_DIMENSIONS = Object.freeze({
  width: 5.6,
  height: 3.6,
  depth: 6.8,
  poolWidth: 4.4,
  poolDepth: 5.2,
  basinBottomY: -0.03,
  mercurySurfaceY: 0.13,
  rimTopY: 0.27,
});

const HALF_WIDTH = NEON_MERCURY_ROOM_DIMENSIONS.width * 0.5;
const HALF_DEPTH = NEON_MERCURY_ROOM_DIMENSIONS.depth * 0.5;
const POOL_HALF_WIDTH = NEON_MERCURY_ROOM_DIMENSIONS.poolWidth * 0.5;
const POOL_HALF_DEPTH = NEON_MERCURY_ROOM_DIMENSIONS.poolDepth * 0.5;
const WALL_THICKNESS = 0.14;
const FRAME_DEPTH = 0.045;
const UP = new THREE.Vector3(0, 1, 0);

const NEON_PALETTE = Object.freeze({
  cyan: 0x45e9ff,
  magenta: 0xff34c8,
  violet: 0x9270ff,
  amber: 0xffad45,
});

function setRtxSurface(material, reflectionMask, surface = null) {
  material.rtxReflectionMask = reflectionMask;
  material.userData.rtxUsesResolvedPbr = 1;
  if (surface) material.userData.rtxTriangleSurface = surface;
  return material;
}

function createMirrorMaterial() {
  return setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Optically smooth silvered chamber mirror",
    color: 0xe9f2f8,
    roughness: 0.018,
    metalness: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.008,
    envMapIntensity: 3.2,
  }), 1, [0.95, 0.975, 1, 0.02]);
}

function createNeonMaterial(hex, name, radiance = 14) {
  const linear = new THREE.Color(hex);
  const material = new THREE.MeshStandardNodeMaterial({
    name,
    color: hex,
    emissive: hex,
    emissiveIntensity: 7.5,
    roughness: 0.24,
    metalness: 0.06,
  });
  material.rtxReflectionMask = 0;
  material.userData.rtxTriangleSurface = [
    linear.r * 0.18,
    linear.g * 0.18,
    linear.b * 0.18,
    0.20,
  ];
  // The static RTX collector consumes linear, scene-referred HDR radiance.
  material.userData.rtxTriangleRadiance = [
    linear.r * radiance,
    linear.g * radiance,
    linear.b * radiance,
    1,
  ];
  return material;
}

function createHaloMaterial(hex, name) {
  const material = new THREE.MeshBasicNodeMaterial({
    name,
    color: hex,
    transparent: true,
    opacity: 0.075,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  material.toneMapped = false;
  material.rtxReflectionMask = 0;
  material.userData.rtxIgnore = true;
  return material;
}

function makeBounds() {
  return {
    room: {
      min: new THREE.Vector3(-HALF_WIDTH, -0.08, -HALF_DEPTH),
      max: new THREE.Vector3(HALF_WIDTH, NEON_MERCURY_ROOM_DIMENSIONS.height, HALF_DEPTH),
    },
    pool: {
      center: new THREE.Vector3(0, NEON_MERCURY_ROOM_DIMENSIONS.mercurySurfaceY, 0),
      min: new THREE.Vector3(
        -POOL_HALF_WIDTH,
        NEON_MERCURY_ROOM_DIMENSIONS.basinBottomY,
        -POOL_HALF_DEPTH,
      ),
      max: new THREE.Vector3(
        POOL_HALF_WIDTH,
        NEON_MERCURY_ROOM_DIMENSIONS.rimTopY,
        POOL_HALF_DEPTH,
      ),
      width: NEON_MERCURY_ROOM_DIMENSIONS.poolWidth,
      depth: NEON_MERCURY_ROOM_DIMENSIONS.poolDepth,
      basinBottomY: NEON_MERCURY_ROOM_DIMENSIONS.basinBottomY,
      surfaceY: NEON_MERCURY_ROOM_DIMENSIONS.mercurySurfaceY,
      rimTopY: NEON_MERCURY_ROOM_DIMENSIONS.rimTopY,
    },
    cameraSafe: {
      min: new THREE.Vector3(-2.32, 0.62, -2.95),
      max: new THREE.Vector3(2.32, 3.08, 3.08),
    },
    cameraHome: {
      position: new THREE.Vector3(0, 1.70, 2.92),
      target: new THREE.Vector3(0, 0.78, -1.48),
      fov: 66,
    },
  };
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

function addEnvironmentPanel(scene, size, position, rotation, hex, intensity) {
  const color = new THREE.Color(hex).multiplyScalar(intensity);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Neon room PMREM emitter",
    color,
    side: THREE.DoubleSide,
    fog: false,
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  panel.position.set(...position);
  panel.rotation.set(...rotation);
  scene.add(panel);
}

function createRoomEnvironment(renderer) {
  if (!renderer) return null;

  const environmentScene = new THREE.Scene();
  environmentScene.background = new THREE.Color(0x010107);
  const enclosure = new THREE.Mesh(
    new THREE.BoxGeometry(7.4, 5.2, 8.6),
    new THREE.MeshBasicNodeMaterial({
      name: "Neon room PMREM dark enclosure",
      color: 0x080a12,
      side: THREE.BackSide,
      fog: false,
    }),
  );
  enclosure.position.y = 1.45;
  environmentScene.add(enclosure);

  addEnvironmentPanel(
    environmentScene,
    [3.0, 0.28],
    [-1.25, 2.85, -3.15],
    [0, 0, 0],
    NEON_PALETTE.cyan,
    9.5,
  );
  addEnvironmentPanel(
    environmentScene,
    [2.7, 0.26],
    [1.42, 2.85, -3.14],
    [0, 0, 0],
    NEON_PALETTE.magenta,
    9.2,
  );
  addEnvironmentPanel(
    environmentScene,
    [2.9, 0.24],
    [-3.05, 1.7, -0.6],
    [0, Math.PI * 0.5, 0],
    NEON_PALETTE.violet,
    7.5,
  );
  addEnvironmentPanel(
    environmentScene,
    [2.9, 0.24],
    [3.05, 1.5, 0.45],
    [0, -Math.PI * 0.5, 0],
    NEON_PALETTE.amber,
    7.2,
  );
  addEnvironmentPanel(
    environmentScene,
    [2.8, 0.22],
    [-1.25, 3.15, 0.65],
    [Math.PI * 0.5, 0, 0.6],
    NEON_PALETTE.amber,
    6.8,
  );
  addEnvironmentPanel(
    environmentScene,
    [2.8, 0.22],
    [1.25, 3.15, -0.35],
    [Math.PI * 0.5, 0, -0.6],
    NEON_PALETTE.violet,
    7.0,
  );

  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromScene(
    environmentScene,
    0.025,
    0.1,
    20,
    { size: 128, position: new THREE.Vector3(0, 1.5, 0) },
  );
  generator.dispose();
  disposeObjectGraph(environmentScene);
  return target;
}

/**
 * Build a sealed, real-scale mirror chamber around a recessed moving-metal
 * pool. Everything in this module is static: light intensities never flicker,
 * mirror transforms never change, and the animated mercury can stay outside
 * the static RTX acceleration structure.
 */
export function createNeonMirrorRoom(scene, renderer = null) {
  if (!scene?.isScene) {
    throw new TypeError("createNeonMirrorRoom requires a THREE.Scene.");
  }

  const root = new THREE.Group();
  root.name = "Sealed neon mirror mercury chamber";
  const architecture = new THREE.Group();
  architecture.name = "Human-scale sealed chamber architecture";
  const mirrors = new THREE.Group();
  mirrors.name = "Framed optically smooth mirror arrays";
  const neonCores = new THREE.Group();
  neonCores.name = "Static HDR neon emitter geometry";
  const neonHalos = new THREE.Group();
  neonHalos.name = "Subtle raster-only neon bloom sleeves";
  neonHalos.userData.rtxIgnore = true;
  const practicalDetails = new THREE.Group();
  practicalDetails.name = "Walkway grates rivets trims and scale details";
  const lightRoot = new THREE.Group();
  lightRoot.name = "Eight invariant neon practical lights";
  root.add(architecture, mirrors, neonCores, neonHalos, practicalDetails, lightRoot);
  scene.add(root);

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  unitBox.name = "Shared room box primitive";
  const tubeGeometry = new THREE.CylinderGeometry(0.018, 0.018, 1, 12, 1, false);
  tubeGeometry.name = "Shared neon core tube";
  const haloGeometry = new THREE.CylinderGeometry(0.065, 0.065, 1, 12, 1, true);
  haloGeometry.name = "Shared neon halo sleeve";

  const shellMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Near-black satin architectural shell",
    color: 0x090b11,
    roughness: 0.49,
    metalness: 0.64,
    clearcoat: 0.12,
    clearcoatRoughness: 0.36,
    envMapIntensity: 1.05,
  }), 0.12, [0.008, 0.010, 0.017, 0.49]);
  const frameMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Anodized black mirror frames",
    color: 0x171c26,
    roughness: 0.25,
    metalness: 0.92,
    clearcoat: 0.24,
    clearcoatRoughness: 0.2,
    envMapIntensity: 1.5,
  }), 0.32, [0.018, 0.025, 0.04, 0.25]);
  const walkwayMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Dark non-slip stainless service walkway",
    color: 0x20242a,
    roughness: 0.39,
    metalness: 0.78,
    clearcoat: 0.16,
    clearcoatRoughness: 0.31,
    envMapIntensity: 1.35,
  }), 0.28, [0.025, 0.028, 0.034, 0.39]);
  const grateMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Machined drainage grate and rim steel",
    color: 0x48515c,
    roughness: 0.23,
    metalness: 0.94,
    envMapIntensity: 1.85,
  }), 0.42, [0.065, 0.075, 0.09, 0.23]);
  const basinMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Black refractory mercury basin",
    color: 0x06070a,
    roughness: 0.58,
    metalness: 0.35,
    clearcoat: 0.08,
    clearcoatRoughness: 0.42,
  }), 0.08, [0.004, 0.0045, 0.006, 0.58]);
  const rivetMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Polished titanium fasteners",
    color: 0xa9b4bf,
    roughness: 0.16,
    metalness: 1,
    envMapIntensity: 2.2,
  }), 0.55, [0.40, 0.45, 0.52, 0.16]);
  const doorMaterial = setRtxSurface(new THREE.MeshPhysicalNodeMaterial({
    name: "Brushed gunmetal maintenance door",
    color: 0x282d35,
    roughness: 0.31,
    metalness: 0.9,
    clearcoat: 0.16,
    clearcoatRoughness: 0.27,
  }), 0.30, [0.035, 0.04, 0.052, 0.31]);
  const mirrorMaterial = createMirrorMaterial();

  function addBox(parent, name, size, position, material, castShadow = true, receiveShadow = true) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    parent.add(mesh);
    return mesh;
  }

  // The shell extends just beyond the exact interior bounds, preventing any
  // camera angle inside the room from revealing an unmodelled exterior seam.
  addBox(
    architecture,
    "Continuous structural floor slab",
    [5.88, 0.20, 7.08],
    [0, -0.13, 0],
    shellMaterial,
  );
  addBox(
    architecture,
    "Sealed left chamber wall",
    [WALL_THICKNESS, 3.8, 7.08],
    [-HALF_WIDTH - WALL_THICKNESS * 0.5, 1.72, 0],
    shellMaterial,
  );
  addBox(
    architecture,
    "Sealed right chamber wall",
    [WALL_THICKNESS, 3.8, 7.08],
    [HALF_WIDTH + WALL_THICKNESS * 0.5, 1.72, 0],
    shellMaterial,
  );
  addBox(
    architecture,
    "Sealed rear chamber wall",
    [5.88, 3.8, WALL_THICKNESS],
    [0, 1.72, -HALF_DEPTH - WALL_THICKNESS * 0.5],
    shellMaterial,
  );
  addBox(
    architecture,
    "Sealed front chamber wall",
    [5.88, 3.8, WALL_THICKNESS],
    [0, 1.72, HALF_DEPTH + WALL_THICKNESS * 0.5],
    shellMaterial,
  );
  addBox(
    architecture,
    "Sealed chamber ceiling",
    [5.88, WALL_THICKNESS, 7.08],
    [0, NEON_MERCURY_ROOM_DIMENSIONS.height + WALL_THICKNESS * 0.5, 0],
    shellMaterial,
  );

  // Recessed basin plus 600/800 mm service walkways establish believable
  // human scale while preserving the full 4.4 x 5.2 metre liquid silhouette.
  addBox(
    architecture,
    "Refractory mercury basin floor",
    [4.44, 0.07, 5.24],
    [0, -0.065, 0],
    basinMaterial,
  );
  for (const x of [-2.5, 2.5]) {
    addBox(
      architecture,
      `${x < 0 ? "Left" : "Right"} raised service walkway`,
      [0.60, 0.30, 5.20],
      [x, 0.07, 0],
      walkwayMaterial,
    );
  }
  for (const z of [-3.0, 3.0]) {
    addBox(
      architecture,
      `${z < 0 ? "Rear" : "Front"} raised service walkway`,
      [5.60, 0.30, 0.80],
      [0, 0.07, z],
      walkwayMaterial,
    );
  }

  const rimHeight = 0.10;
  for (const x of [-POOL_HALF_WIDTH - 0.04, POOL_HALF_WIDTH + 0.04]) {
    addBox(
      practicalDetails,
      "Raised mercury containment rim",
      [0.08, rimHeight, 5.36],
      [x, 0.22, 0],
      grateMaterial,
    );
  }
  for (const z of [-POOL_HALF_DEPTH - 0.04, POOL_HALF_DEPTH + 0.04]) {
    addBox(
      practicalDetails,
      "Raised mercury containment rim",
      [4.56, rimHeight, 0.08],
      [0, 0.22, z],
      grateMaterial,
    );
  }

  // Narrow drainage trenches and crossbars keep the walkways readable even
  // when the surrounding mirrors multiply their silhouettes.
  for (const x of [-2.54, 2.54]) {
    addBox(
      practicalDetails,
      "Long recessed walkway drainage trench",
      [0.23, 0.018, 4.88],
      [x, 0.229, 0],
      basinMaterial,
      false,
      true,
    );
    for (let index = 0; index < 25; ++index) {
      const z = -2.38 + index * (4.76 / 24);
      addBox(
        practicalDetails,
        "Walkway drainage crossbar",
        [0.27, 0.025, 0.028],
        [x, 0.246, z],
        grateMaterial,
        false,
        true,
      );
    }
  }
  for (const z of [-3.02, 3.02]) {
    addBox(
      practicalDetails,
      "Front-rear recessed drainage trench",
      [4.82, 0.018, 0.20],
      [0, 0.229, z],
      basinMaterial,
      false,
      true,
    );
    for (let index = 0; index < 25; ++index) {
      const x = -2.36 + index * (4.72 / 24);
      addBox(
        practicalDetails,
        "Front-rear drainage crossbar",
        [0.028, 0.025, 0.24],
        [x, 0.246, z],
        grateMaterial,
        false,
        true,
      );
    }
  }

  let mirrorPanelCount = 0;
  function addMirrorPanel(axis, position, width, height, label) {
    mirrorPanelCount += 1;
    const panelName = `${label} mirror ${mirrorPanelCount}`;
    const frameWidth = 0.055;
    if (axis === "z") {
      addBox(mirrors, panelName, [width, height, 0.026], position, mirrorMaterial, false, true);
      for (const x of [-width * 0.5 - frameWidth * 0.5, width * 0.5 + frameWidth * 0.5]) {
        addBox(
          mirrors,
          `${panelName} vertical frame`,
          [frameWidth, height + 0.11, FRAME_DEPTH],
          [position[0] + x, position[1], position[2] + 0.003],
          frameMaterial,
        );
      }
      for (const y of [-height * 0.5 - frameWidth * 0.5, height * 0.5 + frameWidth * 0.5]) {
        addBox(
          mirrors,
          `${panelName} horizontal frame`,
          [width + 0.11, frameWidth, FRAME_DEPTH],
          [position[0], position[1] + y, position[2] + 0.003],
          frameMaterial,
        );
      }
    } else if (axis === "x") {
      addBox(mirrors, panelName, [0.026, height, width], position, mirrorMaterial, false, true);
      for (const z of [-width * 0.5 - frameWidth * 0.5, width * 0.5 + frameWidth * 0.5]) {
        addBox(
          mirrors,
          `${panelName} vertical frame`,
          [FRAME_DEPTH, height + 0.11, frameWidth],
          [position[0], position[1], position[2] + z],
          frameMaterial,
        );
      }
      for (const y of [-height * 0.5 - frameWidth * 0.5, height * 0.5 + frameWidth * 0.5]) {
        addBox(
          mirrors,
          `${panelName} horizontal frame`,
          [FRAME_DEPTH, frameWidth, width + 0.11],
          [position[0], position[1] + y, position[2]],
          frameMaterial,
        );
      }
    } else {
      addBox(mirrors, panelName, [width, 0.026, height], position, mirrorMaterial, false, true);
      for (const x of [-width * 0.5 - frameWidth * 0.5, width * 0.5 + frameWidth * 0.5]) {
        addBox(
          mirrors,
          `${panelName} longitudinal ceiling frame`,
          [frameWidth, FRAME_DEPTH, height + 0.11],
          [position[0] + x, position[1] - 0.003, position[2]],
          frameMaterial,
        );
      }
      for (const z of [-height * 0.5 - frameWidth * 0.5, height * 0.5 + frameWidth * 0.5]) {
        addBox(
          mirrors,
          `${panelName} transverse ceiling frame`,
          [width + 0.11, FRAME_DEPTH, frameWidth],
          [position[0], position[1] - 0.003, position[2] + z],
          frameMaterial,
        );
      }
    }
  }

  // Six rear, eight side and four ceiling mirrors give the ray tracer many
  // different neon/mercury sightlines without turning the walls into one flat
  // unframed sheet.
  for (const y of [1.16, 2.55]) {
    for (const x of [-1.70, 0, 1.70]) {
      addMirrorPanel("z", [x, y, -3.315], 1.48, 1.13, "Rear wall");
    }
  }
  for (const x of [-2.735, 2.735]) {
    for (const z of [-2.40, -0.80, 0.80, 2.40]) {
      addMirrorPanel("x", [x, 1.87, z], 1.38, 2.46, x < 0 ? "Left wall" : "Right wall");
    }
  }
  for (const x of [-1.30, 1.30]) {
    for (const z of [-1.67, 1.42]) {
      addMirrorPanel("y", [x, 3.535, z], 2.14, 2.64, "Ceiling");
    }
  }

  // Corner columns and ceiling rails give the reflection maze fixed vertical
  // and horizontal references, preventing the compact room from reading as an
  // abstract infinite environment map.
  for (const x of [-2.69, 2.69]) {
    for (const z of [-3.29, 3.29]) {
      addBox(
        practicalDetails,
        "Full-height structural corner column",
        [0.13, 3.30, 0.13],
        [x, 1.82, z],
        frameMaterial,
      );
    }
  }
  for (const x of [-2.28, 0, 2.28]) {
    addBox(
      practicalDetails,
      "Ceiling equipment rail",
      [0.08, 0.09, 6.55],
      [x, 3.48, 0],
      frameMaterial,
    );
  }

  // A reflected maintenance door, handle and threshold are unambiguous human
  // scale cues even though the camera remains locked on the front walkway.
  addBox(
    practicalDetails,
    "Front maintenance door",
    [1.04, 2.18, 0.035],
    [0, 1.34, 3.315],
    doorMaterial,
  );
  for (const x of [-0.56, 0.56]) {
    addBox(
      practicalDetails,
      "Maintenance door vertical jamb",
      [0.07, 2.34, 0.075],
      [x, 1.36, 3.285],
      frameMaterial,
    );
  }
  addBox(
    practicalDetails,
    "Maintenance door header",
    [1.19, 0.07, 0.075],
    [0, 2.55, 3.285],
    frameMaterial,
  );
  addBox(
    practicalDetails,
    "Maintenance door push bar",
    [0.52, 0.055, 0.09],
    [0.18, 1.27, 3.24],
    grateMaterial,
  );
  addBox(
    practicalDetails,
    "Amber metal door threshold",
    [1.08, 0.035, 0.12],
    [0, 0.265, 3.24],
    grateMaterial,
  );

  // Rivets are instanced: they add sub-decimetre scale without adding dozens
  // of separate draw calls. Their geometry is still visible to static RTX.
  const rivetGeometry = new THREE.SphereGeometry(0.018, 8, 5);
  rivetGeometry.name = "Shared polished rim rivet";
  const rivetPositions = [];
  for (let index = 0; index < 15; ++index) {
    const z = -2.46 + index * (4.92 / 14);
    rivetPositions.push([-2.255, 0.286, z], [2.255, 0.286, z]);
  }
  for (let index = 1; index < 13; ++index) {
    const x = -2.10 + index * (4.20 / 13);
    rivetPositions.push([x, 0.286, -2.655], [x, 0.286, 2.655]);
  }
  const rivets = new THREE.InstancedMesh(rivetGeometry, rivetMaterial, rivetPositions.length);
  rivets.name = "Polished containment-rim fasteners";
  const rivetMatrix = new THREE.Matrix4();
  for (let index = 0; index < rivetPositions.length; ++index) {
    rivetMatrix.makeTranslation(...rivetPositions[index]);
    rivets.setMatrixAt(index, rivetMatrix);
  }
  rivets.instanceMatrix.needsUpdate = true;
  rivets.castShadow = false;
  rivets.receiveShadow = true;
  practicalDetails.add(rivets);

  const neonMaterials = new Map();
  const haloMaterials = new Map();
  function materialForNeon(key) {
    if (!neonMaterials.has(key)) {
      neonMaterials.set(
        key,
        createNeonMaterial(NEON_PALETTE[key], `Stable ${key} neon phosphor`, key === "amber" ? 12 : 15),
      );
      haloMaterials.set(
        key,
        createHaloMaterial(NEON_PALETTE[key], `Subtle ${key} neon bloom sleeve`),
      );
    }
    return {
      core: neonMaterials.get(key),
      halo: haloMaterials.get(key),
    };
  }

  const midpoint = new THREE.Vector3();
  const direction = new THREE.Vector3();
  let neonTubeCount = 0;
  function addNeonTube(startValues, endValues, key, label) {
    neonTubeCount += 1;
    const start = new THREE.Vector3(...startValues);
    const end = new THREE.Vector3(...endValues);
    direction.copy(end).sub(start);
    const length = direction.length();
    midpoint.copy(start).add(end).multiplyScalar(0.5);
    const materials = materialForNeon(key);

    const core = new THREE.Mesh(tubeGeometry, materials.core);
    core.name = `${label} ${key} neon core ${neonTubeCount}`;
    core.position.copy(midpoint);
    core.quaternion.setFromUnitVectors(UP, direction.normalize());
    core.scale.set(1, length, 1);
    core.castShadow = false;
    core.receiveShadow = false;
    neonCores.add(core);

    const halo = new THREE.Mesh(haloGeometry, materials.halo);
    halo.name = `${label} ${key} neon bloom sleeve ${neonTubeCount}`;
    halo.position.copy(midpoint);
    halo.quaternion.copy(core.quaternion);
    halo.scale.set(1, length * 1.015, 1);
    halo.renderOrder = 5;
    halo.frustumCulled = true;
    halo.userData.rtxIgnore = true;
    neonHalos.add(halo);
  }

  const neonSpecs = [
    { a: [-2.34, 3.15, -3.20], b: [-0.16, 3.15, -3.20], c: "cyan", n: "Rear crown" },
    { a: [0.16, 3.15, -3.20], b: [2.34, 3.15, -3.20], c: "magenta", n: "Rear crown" },
    { a: [-2.34, 0.43, -3.20], b: [-0.18, 0.43, -3.20], c: "amber", n: "Rear sill" },
    { a: [0.18, 0.43, -3.20], b: [2.34, 0.43, -3.20], c: "violet", n: "Rear sill" },
    { a: [-2.65, 0.55, -2.45], b: [-2.65, 3.05, -2.45], c: "cyan", n: "Left wall" },
    { a: [-2.65, 0.55, -0.10], b: [-2.65, 3.05, -0.10], c: "magenta", n: "Left wall" },
    { a: [-2.65, 0.44, 0.25], b: [-2.65, 0.44, 2.48], c: "amber", n: "Left wall sill" },
    { a: [2.65, 0.55, -2.45], b: [2.65, 3.05, -2.45], c: "magenta", n: "Right wall" },
    { a: [2.65, 0.55, -0.10], b: [2.65, 3.05, -0.10], c: "cyan", n: "Right wall" },
    { a: [2.65, 0.44, 0.25], b: [2.65, 0.44, 2.48], c: "violet", n: "Right wall sill" },
    { a: [-2.14, 3.44, -2.50], b: [-0.26, 3.44, -0.55], c: "cyan", n: "Ceiling diagonal" },
    { a: [0.26, 3.44, -0.55], b: [2.14, 3.44, -2.50], c: "magenta", n: "Ceiling diagonal" },
    { a: [-2.14, 3.44, 2.18], b: [-0.26, 3.44, 0.22], c: "amber", n: "Ceiling diagonal" },
    { a: [0.26, 3.44, 0.22], b: [2.14, 3.44, 2.18], c: "violet", n: "Ceiling diagonal" },
    { a: [-2.34, 0.58, 3.20], b: [-2.34, 2.92, 3.20], c: "violet", n: "Front return" },
    { a: [2.34, 0.58, 3.20], b: [2.34, 2.92, 3.20], c: "cyan", n: "Front return" },
  ];
  for (const spec of neonSpecs) addNeonTube(spec.a, spec.b, spec.c, spec.n);

  const lightSpecs = [
    { p: [-1.35, 2.94, -2.88], c: "cyan", intensity: 34, distance: 5.4 },
    { p: [1.35, 2.94, -2.88], c: "magenta", intensity: 32, distance: 5.4 },
    { p: [-2.38, 1.72, -1.55], c: "cyan", intensity: 25, distance: 4.7 },
    { p: [2.38, 1.72, -1.55], c: "magenta", intensity: 25, distance: 4.7 },
    { p: [-2.18, 0.66, 1.72], c: "amber", intensity: 22, distance: 4.2 },
    { p: [2.18, 0.66, 1.72], c: "violet", intensity: 24, distance: 4.2 },
    { p: [-1.08, 3.12, 0.88], c: "amber", intensity: 20, distance: 4.8 },
    { p: [1.08, 3.12, 0.88], c: "violet", intensity: 22, distance: 4.8 },
  ];
  const lights = [];
  for (let index = 0; index < lightSpecs.length; ++index) {
    const spec = lightSpecs[index];
    const light = new THREE.PointLight(
      NEON_PALETTE[spec.c],
      spec.intensity,
      spec.distance,
      2,
    );
    light.name = `Stable ${spec.c} neon spill light ${index + 1}`;
    light.position.set(...spec.p);
    light.castShadow = false;
    light.userData.invariantIntensity = spec.intensity;
    lightRoot.add(light);
    lights.push(light);
  }

  root.updateMatrixWorld(true);
  const environmentTarget = createRoomEnvironment(renderer);
  const bounds = makeBounds();
  const stats = Object.freeze({
    mirrorPanels: mirrorPanelCount,
    neonTubes: neonTubeCount,
    rtxLights: lights.length,
    rivets: rivetPositions.length,
    drainageCrossbars: 100,
    roomWidthMetres: NEON_MERCURY_ROOM_DIMENSIONS.width,
    roomHeightMetres: NEON_MERCURY_ROOM_DIMENSIONS.height,
    roomDepthMetres: NEON_MERCURY_ROOM_DIMENSIONS.depth,
    poolWidthMetres: NEON_MERCURY_ROOM_DIMENSIONS.poolWidth,
    poolDepthMetres: NEON_MERCURY_ROOM_DIMENSIONS.poolDepth,
  });

  let disposed = false;
  return {
    root,
    architecture,
    mirrors,
    neonCores,
    neonHalos,
    practicalDetails,
    staticRtxRoots: [root],
    lights,
    environment: environmentTarget?.texture ?? null,
    environmentTarget,
    bounds,
    stats,
    getStats() {
      return stats;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      disposeObjectGraph(root);
      environmentTarget?.dispose?.();
    },
  };
}
