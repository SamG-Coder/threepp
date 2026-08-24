const TAU = Math.PI * 2;
const RTX_VISIBLE_MASK = 0xff;

const CRAFT_SPECS = Object.freeze([
  Object.freeze({
    name: "Near-left Atlas heavy hauler",
    role: "near-left-cropped",
    family: "heavy",
    proxy: "heavy",
    length: 16.8,
    width: 7.4,
    height: 3.4,
    wingSpan: 1.34,
    engines: 4,
    cargoPods: 2,
    tailFins: 2,
    paint: 0x293640,
    accent: 0xa95c2d,
    minX: -78,
    maxX: 76,
    initialX: -31.5,
    altitude: 11.8,
    depth: -22,
    direction: 1,
    speed: 3.6,
    bob: 0.14,
    phase: 0.37,
  }),
  Object.freeze({
    name: "Upper-right Vesper interceptor",
    role: "upper-right",
    family: "courier",
    proxy: "light",
    length: 7.2,
    width: 3.25,
    height: 1.42,
    wingSpan: 1.72,
    engines: 2,
    cargoPods: 0,
    tailFins: 2,
    paint: 0x3d4b55,
    accent: 0x4b8995,
    minX: -69,
    maxX: 72,
    initialX: 28.5,
    altitude: 35.5,
    depth: -57,
    direction: -1,
    speed: 7.1,
    bob: 0.22,
    phase: 1.71,
  }),
  Object.freeze({
    name: "Aster executive shuttle",
    role: "mid-near",
    family: "shuttle",
    proxy: "light",
    length: 9.1,
    width: 3.65,
    height: 1.82,
    wingSpan: 1.26,
    engines: 3,
    cargoPods: 0,
    tailFins: 1,
    paint: 0x54494a,
    accent: 0xb78545,
    minX: -73,
    maxX: 75,
    initialX: -8,
    altitude: 18.2,
    depth: -48,
    direction: 1,
    speed: 5.2,
    bob: 0.18,
    phase: 2.48,
  }),
  Object.freeze({
    name: "Morrow municipal transport",
    role: "mid-field",
    family: "shuttle",
    proxy: "heavy",
    length: 11.6,
    width: 4.45,
    height: 2.35,
    wingSpan: 1.08,
    engines: 2,
    cargoPods: 2,
    tailFins: 1,
    paint: 0x403f43,
    accent: 0x716044,
    minX: -80,
    maxX: 82,
    initialX: 16,
    altitude: 25.5,
    depth: -86,
    direction: -1,
    speed: 4.45,
    bob: 0.16,
    phase: 3.22,
  }),
  Object.freeze({
    name: "Kite canal courier",
    role: "lower-mid",
    family: "courier",
    proxy: "light",
    length: 6.2,
    width: 2.72,
    height: 1.22,
    wingSpan: 1.84,
    engines: 2,
    cargoPods: 0,
    tailFins: 2,
    paint: 0x29424a,
    accent: 0x397b82,
    minX: -72,
    maxX: 78,
    initialX: 32,
    altitude: 14.4,
    depth: -72,
    direction: 1,
    speed: 8.25,
    bob: 0.20,
    phase: 4.13,
  }),
  Object.freeze({
    name: "Far Crown diplomatic skiff",
    role: "high-far",
    family: "skiff",
    proxy: "light",
    length: 6.8,
    width: 3.1,
    height: 1.34,
    wingSpan: 1.38,
    engines: 2,
    cargoPods: 0,
    tailFins: 0,
    paint: 0x51454f,
    accent: 0x806b8b,
    minX: -88,
    maxX: 88,
    initialX: -12,
    altitude: 40.5,
    depth: -122,
    direction: 1,
    speed: 6.4,
    bob: 0.24,
    phase: 5.08,
  }),
  Object.freeze({
    name: "Oxide industrial tug",
    role: "deep-mid",
    family: "heavy",
    proxy: "heavy",
    length: 10.2,
    width: 4.25,
    height: 2.55,
    wingSpan: 0.98,
    engines: 3,
    cargoPods: 2,
    tailFins: 0,
    paint: 0x493b35,
    accent: 0x9a5f32,
    minX: -84,
    maxX: 84,
    initialX: -34,
    altitude: 21.5,
    depth: -113,
    direction: -1,
    speed: 3.85,
    bob: 0.13,
    phase: 5.76,
  }),
  Object.freeze({
    name: "Needle express packet",
    role: "vanishing-point",
    family: "courier",
    proxy: "light",
    length: 5.5,
    width: 2.35,
    height: 1.02,
    wingSpan: 1.92,
    engines: 2,
    cargoPods: 0,
    tailFins: 2,
    paint: 0x33404d,
    accent: 0x567b9c,
    minX: -92,
    maxX: 92,
    initialX: 45,
    altitude: 30.5,
    depth: -151,
    direction: -1,
    speed: 9.1,
    bob: 0.18,
    phase: 0.92,
  }),
]);

const LOFT_PROFILES = Object.freeze({
  heavy: Object.freeze([
    [-1.00, 0.66, 0.70, -0.06],
    [-0.82, 0.92, 0.92, 0.00],
    [-0.34, 1.00, 1.00, 0.00],
    [0.38, 0.96, 0.84, 0.01],
    [0.72, 0.78, 0.62, -0.03],
    [0.93, 0.42, 0.34, -0.08],
    [1.00, 0.08, 0.08, -0.10],
  ]),
  shuttle: Object.freeze([
    [-1.00, 0.55, 0.62, -0.08],
    [-0.79, 0.90, 0.86, -0.02],
    [-0.24, 1.00, 0.92, 0.02],
    [0.48, 0.82, 0.68, 0.08],
    [0.84, 0.54, 0.42, 0.02],
    [1.00, 0.06, 0.06, -0.03],
  ]),
  courier: Object.freeze([
    [-1.00, 0.46, 0.55, -0.09],
    [-0.72, 0.84, 0.77, -0.02],
    [-0.06, 1.00, 0.82, 0.02],
    [0.58, 0.66, 0.53, 0.06],
    [0.90, 0.29, 0.24, 0.00],
    [1.00, 0.035, 0.035, -0.02],
  ]),
  skiff: Object.freeze([
    [-1.00, 0.62, 0.44, -0.15],
    [-0.72, 0.94, 0.58, -0.08],
    [0.18, 1.00, 0.66, 0.02],
    [0.70, 0.72, 0.46, 0.08],
    [0.94, 0.31, 0.22, 0.02],
    [1.00, 0.05, 0.04, 0.00],
  ]),
});

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function markRtxIgnored(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function createLoftGeometry(THREE, profile, radialSegments = 16) {
  const positions = [];
  const indices = [];
  for (const [z, radiusX, radiusY, centerY] of profile) {
    for (let segment = 0; segment < radialSegments; ++segment) {
      const angle = segment / radialSegments * TAU;
      positions.push(
        Math.cos(angle) * radiusX,
        centerY + Math.sin(angle) * radiusY,
        z,
      );
    }
  }

  for (let ring = 0; ring < profile.length - 1; ++ring) {
    const nextRing = ring + 1;
    for (let segment = 0; segment < radialSegments; ++segment) {
      const next = (segment + 1) % radialSegments;
      const a = ring * radialSegments + segment;
      const b = ring * radialSegments + next;
      const c = nextRing * radialSegments + next;
      const d = nextRing * radialSegments + segment;
      indices.push(a, b, c, a, c, d);
    }
  }

  const rearCenter = positions.length / 3;
  positions.push(0, profile[0][3], profile[0][0]);
  const frontCenter = positions.length / 3;
  positions.push(0, profile.at(-1)[3], profile.at(-1)[0]);
  const frontRing = (profile.length - 1) * radialSegments;
  for (let segment = 0; segment < radialSegments; ++segment) {
    const next = (segment + 1) % radialSegments;
    indices.push(rearCenter, next, segment);
    indices.push(frontCenter, frontRing + segment, frontRing + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createSweptWingGeometry(THREE) {
  const positions = [
    0, 0.08, 0.54,
    1, 0.08, 0.10,
    1, 0.08, -0.22,
    0, 0.08, -0.55,
    0, -0.08, 0.54,
    1, -0.08, 0.10,
    1, -0.08, -0.22,
    0, -0.08, -0.55,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendProxyBox(target, size, position, radiance, surface) {
  const [sx, sy, sz] = size.map(value => value * 0.5);
  const [px, py, pz] = position;
  const vertexOffset = target.positions.length / 3;
  target.positions.push(
    px - sx, py - sy, pz - sz,
    px + sx, py - sy, pz - sz,
    px + sx, py + sy, pz - sz,
    px - sx, py + sy, pz - sz,
    px - sx, py - sy, pz + sz,
    px + sx, py - sy, pz + sz,
    px + sx, py + sy, pz + sz,
    px - sx, py + sy, pz + sz,
  );
  const faces = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 7, 3, 0, 4, 7,
    1, 2, 6, 1, 6, 5,
    0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2,
  ];
  for (let index = 0; index < faces.length; index += 3) {
    target.indices.push(
      vertexOffset + faces[index],
      vertexOffset + faces[index + 1],
      vertexOffset + faces[index + 2],
    );
    target.radiance.push(...radiance);
    target.surface.push(...surface);
  }
}

function createProxyStreams(kind) {
  const target = { positions: [], indices: [], radiance: [], surface: [] };
  const heavy = kind === "heavy";
  const width = heavy ? 6.0 : 3.0;
  const height = heavy ? 2.8 : 1.35;
  const length = heavy ? 12.0 : 6.4;
  const hullRadiance = [0.004, 0.005, 0.006, 1];
  const hullSurface = heavy
    ? [0.16, 0.19, 0.21, 0.24]
    : [0.20, 0.24, 0.27, 0.18];
  const glassRadiance = [0.006, 0.011, 0.014, 1];
  const glassSurface = [0.035, 0.09, 0.12, 0.09];
  const engineRadiance = [5.2, 1.65, 0.34, 1];
  const engineSurface = [0.94, 0.28, 0.055, 0.16];

  appendProxyBox(target, [width * 0.68, height * 0.72, length * 0.82], [0, 0, 0], hullRadiance, hullSurface);
  appendProxyBox(target, [width * 0.46, height * 0.42, length * 0.35], [0, height * 0.33, length * 0.19], glassRadiance, glassSurface);
  appendProxyBox(target, [width, height * 0.10, length * 0.34], [0, -height * 0.08, -length * 0.02], hullRadiance, hullSurface);
  appendProxyBox(target, [width * 0.52, height * 0.14, length * 0.17], [0, height * 0.18, -length * 0.38], hullRadiance, hullSurface);
  appendProxyBox(target, [width * 0.18, height * 0.21, length * 0.24], [-width * 0.25, -height * 0.16, -length * 0.35], hullRadiance, hullSurface);
  appendProxyBox(target, [width * 0.18, height * 0.21, length * 0.24], [width * 0.25, -height * 0.16, -length * 0.35], hullRadiance, hullSurface);
  appendProxyBox(target, [width * 0.16, height * 0.13, length * 0.025], [-width * 0.25, -height * 0.16, -length * 0.49], engineRadiance, engineSurface);
  appendProxyBox(target, [width * 0.16, height * 0.13, length * 0.025], [width * 0.25, -height * 0.16, -length * 0.49], engineRadiance, engineSurface);

  return Object.freeze({
    referenceWidth: width,
    referenceHeight: height,
    referenceLength: length,
    positions: new Float32Array(target.positions),
    indices: new Uint32Array(target.indices),
    triangleRadiance: new Float32Array(target.radiance),
    triangleSurface: new Float32Array(target.surface),
  });
}

function writeAffine3x4(target, offset, matrix) {
  const e = matrix.elements;
  target[offset] = e[0];
  target[offset + 1] = e[4];
  target[offset + 2] = e[8];
  target[offset + 3] = e[12];
  target[offset + 4] = e[1];
  target[offset + 5] = e[5];
  target[offset + 6] = e[9];
  target[offset + 7] = e[13];
  target[offset + 8] = e[2];
  target[offset + 9] = e[6];
  target[offset + 10] = e[10];
  target[offset + 11] = e[14];
}

/**
 * Builds the entirely JavaScript-authored aerial traffic layer. Registration
 * and per-frame update data intentionally share the same instance-group
 * descriptors: the typed matrix/mask arrays are stable for their whole life.
 */
export function createAerialTraffic({ THREE, scene }) {
  if (!THREE?.Group || !THREE?.Mesh || !THREE?.BufferGeometry) {
    throw new TypeError("createAerialTraffic requires the active Three.js WebGPU namespace.");
  }
  if (!scene?.add) throw new TypeError("createAerialTraffic requires a Three.js scene.");

  const group = markRtxIgnored(new THREE.Group());
  group.name = "Megacity deterministic aerial traffic";
  scene.add(group);

  const geometries = new Set();
  const materials = new Set();
  const PhysicalMaterial = THREE.MeshPhysicalNodeMaterial ?? THREE.MeshPhysicalMaterial;
  const StandardMaterial = THREE.MeshStandardNodeMaterial ?? THREE.MeshStandardMaterial;

  function ownGeometry(geometry, name) {
    geometry.name = name;
    geometries.add(geometry);
    return geometry;
  }

  function ownMaterial(material, name) {
    material.name = name;
    material.userData.rtxIgnore = true;
    materials.add(material);
    return material;
  }

  const unitBox = ownGeometry(new THREE.BoxGeometry(1, 1, 1), "Aerial craft shared bevel-detail box");
  const wingGeometry = ownGeometry(createSweptWingGeometry(THREE), "Aerial craft swept wing prism");
  const canopyGeometry = ownGeometry(new THREE.SphereGeometry(1, 24, 14), "Aerial craft smooth cockpit canopy");
  const engineGeometry = ownGeometry(new THREE.CylinderGeometry(1, 0.88, 2, 24, 2, false), "Aerial craft engine nacelle");
  engineGeometry.rotateX(Math.PI * 0.5);
  const engineRingGeometry = ownGeometry(new THREE.TorusGeometry(1, 0.13, 10, 28), "Aerial craft engine rim");
  const engineDiscGeometry = ownGeometry(new THREE.CircleGeometry(1, 28), "Aerial craft engine emitter aperture");
  const navGeometry = ownGeometry(new THREE.SphereGeometry(1, 18, 10), "Aerial craft navigation optic");
  const antennaGeometry = ownGeometry(new THREE.CylinderGeometry(0.5, 0.72, 1, 12, 1, false), "Aerial craft antenna mast");
  const loftGeometries = new Map();
  for (const [family, profile] of Object.entries(LOFT_PROFILES)) {
    loftGeometries.set(family, ownGeometry(
      createLoftGeometry(THREE, profile),
      `${family} sixteen-sided aerodynamic hull`,
    ));
  }

  const darkMetal = ownMaterial(new PhysicalMaterial({
    color: 0x111920,
    roughness: 0.31,
    metalness: 0.78,
    clearcoat: 0.24,
    clearcoatRoughness: 0.18,
  }), "Graphite aerial engine and underbody metal");
  const trimMetal = ownMaterial(new PhysicalMaterial({
    color: 0x71808a,
    roughness: 0.20,
    metalness: 0.91,
  }), "Rain-dulled aerial craft trim");
  const glassMaterial = ownMaterial(new PhysicalMaterial({
    color: 0x102b39,
    roughness: 0.10,
    metalness: 0,
    transparent: true,
    opacity: 0.48,
    depthWrite: true,
    clearcoat: 0.92,
    clearcoatRoughness: 0.07,
    side: THREE.FrontSide,
  }), "Closed cyan-black aerial cockpit glazing");
  const cyanNavMaterial = ownMaterial(new StandardMaterial({
    color: 0x78d9e5,
    emissive: 0x3cb9ca,
    emissiveIntensity: 3.0,
    roughness: 0.26,
    metalness: 0.04,
  }), "Restrained cyan starboard navigation optic");
  const redNavMaterial = ownMaterial(new StandardMaterial({
    color: 0xd44a52,
    emissive: 0xb52632,
    emissiveIntensity: 2.75,
    roughness: 0.28,
    metalness: 0.04,
  }), "Restrained red port navigation optic");
  const amberNavMaterial = ownMaterial(new StandardMaterial({
    color: 0xe2a052,
    emissive: 0xb66622,
    emissiveIntensity: 2.55,
    roughness: 0.29,
    metalness: 0.04,
  }), "Restrained amber aerial safety beacon");
  const engineEmitterMaterial = ownMaterial(new StandardMaterial({
    color: 0xe6b173,
    emissive: 0xd36c28,
    emissiveIntensity: 3.6,
    roughness: 0.34,
    metalness: 0.06,
    side: THREE.DoubleSide,
  }), "Warm aerial ion-engine aperture");

  function visualMesh(parent, geometry, material, name, {
    position = null,
    scale = null,
    rotation = null,
    castShadow = false,
    receiveShadow = false,
    renderOrder = 0,
  } = {}) {
    const mesh = markRtxIgnored(new THREE.Mesh(geometry, material));
    mesh.name = name;
    if (position) mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.renderOrder = renderOrder;
    parent.add(mesh);
    return mesh;
  }

  const crafts = [];
  const navOptics = [];
  const engineRotors = [];

  function addEngine(craftRoot, spec, engineIndex, engineX, paintMaterial) {
    const radius = spec.height * (spec.proxy === "heavy" ? 0.165 : 0.145);
    const nacelleLength = spec.length * (spec.proxy === "heavy" ? 0.24 : 0.205);
    const y = -spec.height * 0.22;
    const z = -spec.length * 0.38;
    visualMesh(craftRoot, engineGeometry, darkMetal, `${spec.name} engine nacelle ${engineIndex + 1}`, {
      position: [engineX, y, z],
      scale: [radius, radius, nacelleLength * 0.5],
      castShadow: spec.role === "near-left-cropped",
    });
    visualMesh(craftRoot, engineRingGeometry, trimMetal, `${spec.name} engine rim ${engineIndex + 1}`, {
      position: [engineX, y, z - nacelleLength * 0.53],
      scale: [radius * 0.96, radius * 0.96, radius * 0.96],
    });
    visualMesh(craftRoot, engineDiscGeometry, engineEmitterMaterial, `${spec.name} warm engine core ${engineIndex + 1}`, {
      position: [engineX, y, z - nacelleLength * 0.54 - 0.012],
      scale: [radius * 0.72, radius * 0.72, 1],
      rotation: [0, Math.PI, 0],
      renderOrder: 4,
    });

    const rotor = markRtxIgnored(new THREE.Group());
    rotor.name = `${spec.name} three-vane engine stator ${engineIndex + 1}`;
    rotor.position.set(engineX, y, z - nacelleLength * 0.55 - 0.018);
    for (let vane = 0; vane < 3; ++vane) {
      visualMesh(rotor, unitBox, paintMaterial, "Engine aperture stator vane", {
        scale: [radius * 1.18, radius * 0.075, radius * 0.04],
        rotation: [0, 0, vane * Math.PI / 3],
      });
    }
    craftRoot.add(rotor);
    engineRotors.push({ rotor, phase: spec.phase + engineIndex * 0.9, direction: spec.direction });
  }

  function buildCraft(spec, index) {
    const craftRoot = markRtxIgnored(new THREE.Group());
    craftRoot.name = spec.name;
    craftRoot.userData.trafficRole = spec.role;
    craftRoot.userData.laneAltitude = spec.altitude;
    craftRoot.userData.laneDepth = spec.depth;
    craftRoot.rotation.order = "YXZ";
    group.add(craftRoot);

    const paintMaterial = ownMaterial(new PhysicalMaterial({
      color: spec.paint,
      roughness: spec.role === "near-left-cropped" ? 0.20 : 0.24,
      metalness: 0.44,
      clearcoat: 0.62,
      clearcoatRoughness: 0.15,
    }), `${spec.name} rain-dulled paint`);
    const accentMaterial = ownMaterial(new PhysicalMaterial({
      color: spec.accent,
      roughness: 0.27,
      metalness: 0.58,
      clearcoat: 0.34,
      clearcoatRoughness: 0.18,
    }), `${spec.name} identification panels`);

    visualMesh(craftRoot, loftGeometries.get(spec.family), paintMaterial, `${spec.name} lofted closed hull`, {
      scale: [spec.width * 0.5, spec.height * 0.5, spec.length * 0.5],
      castShadow: spec.role === "near-left-cropped" || spec.role === "mid-near",
    });
    visualMesh(craftRoot, loftGeometries.get(spec.family), darkMetal, `${spec.name} armored underbody`, {
      position: [0, -spec.height * 0.19, -spec.length * 0.055],
      scale: [spec.width * 0.37, spec.height * 0.19, spec.length * 0.37],
    });

    const cockpitLength = spec.family === "heavy" ? 0.18 : spec.family === "courier" ? 0.24 : 0.22;
    visualMesh(craftRoot, canopyGeometry, glassMaterial, `${spec.name} closed panoramic cockpit`, {
      position: [0, spec.height * 0.30, spec.length * 0.27],
      scale: [spec.width * 0.27, spec.height * 0.27, spec.length * cockpitLength],
      renderOrder: 2,
    });
    visualMesh(craftRoot, unitBox, accentMaterial, `${spec.name} dorsal identification spine`, {
      position: [0, spec.height * 0.43, -spec.length * 0.12],
      scale: [spec.width * 0.20, spec.height * 0.10, spec.length * 0.42],
      castShadow: spec.role === "near-left-cropped",
    });
    visualMesh(craftRoot, unitBox, darkMetal, `${spec.name} ventral keel`, {
      position: [0, -spec.height * 0.47, -spec.length * 0.08],
      scale: [spec.width * 0.17, spec.height * 0.11, spec.length * 0.54],
    });

    const wingRoot = spec.width * 0.31;
    const wingReach = Math.max(spec.width * 0.18, spec.width * spec.wingSpan * 0.5 - wingRoot);
    for (const side of [-1, 1]) {
      visualMesh(craftRoot, wingGeometry, index % 2 ? accentMaterial : paintMaterial, `${spec.name} swept ${side < 0 ? "port" : "starboard"} wing`, {
        position: [side * wingRoot, -spec.height * 0.035, -spec.length * 0.04],
        scale: [side * wingReach, spec.height * 0.30, spec.length * 0.50],
        castShadow: spec.role === "near-left-cropped",
      });
      visualMesh(craftRoot, unitBox, trimMetal, `${spec.name} ${side < 0 ? "port" : "starboard"} leading-edge rail`, {
        position: [side * (wingRoot + wingReach * 0.46), spec.height * 0.018, spec.length * 0.10],
        scale: [wingReach * 0.76, spec.height * 0.035, spec.length * 0.030],
        rotation: [0, side * -0.17, 0],
      });
    }

    for (let fin = 0; fin < spec.tailFins; ++fin) {
      const side = spec.tailFins === 1 ? 0 : fin === 0 ? -1 : 1;
      visualMesh(craftRoot, wingGeometry, accentMaterial, `${spec.name} ${spec.tailFins === 1 ? "dorsal" : side < 0 ? "port" : "starboard"} tail fin`, {
        position: [side * spec.width * 0.22, spec.height * 0.32, -spec.length * 0.36],
        scale: [spec.height * 0.62, spec.width * 0.10, spec.length * 0.25],
        rotation: [0, 0, Math.PI * 0.5 + side * 0.12],
      });
    }

    const engineXs = [];
    for (let engine = 0; engine < spec.engines; ++engine) {
      const normalized = spec.engines === 1 ? 0 : engine / (spec.engines - 1) - 0.5;
      engineXs.push(normalized * spec.width * (spec.engines > 3 ? 0.70 : 0.55));
    }
    engineXs.forEach((x, engineIndex) => addEngine(craftRoot, spec, engineIndex, x, accentMaterial));

    for (let pod = 0; pod < spec.cargoPods; ++pod) {
      const side = pod === 0 ? -1 : 1;
      visualMesh(craftRoot, engineGeometry, darkMetal, `${spec.name} external cargo pod ${pod + 1}`, {
        position: [side * spec.width * 0.43, -spec.height * 0.22, spec.length * 0.02],
        scale: [spec.height * 0.23, spec.height * 0.23, spec.length * 0.26],
        castShadow: spec.role === "near-left-cropped",
      });
      for (const zSign of [-1, 1]) {
        visualMesh(craftRoot, engineRingGeometry, trimMetal, "Cargo pod armored collar", {
          position: [side * spec.width * 0.43, -spec.height * 0.22, spec.length * (0.02 + zSign * 0.27)],
          scale: [spec.height * 0.225, spec.height * 0.225, spec.height * 0.225],
        });
      }
    }

    // Small repeated panels and vents make the large foreground silhouette
    // hold up without turning the restrained navigation lights into signage.
    const greebleCount = spec.proxy === "heavy" ? 5 : 3;
    for (const side of [-1, 1]) {
      for (let greeble = 0; greeble < greebleCount; ++greeble) {
        const t = (greeble + 0.5) / greebleCount;
        visualMesh(craftRoot, unitBox, greeble % 2 ? trimMetal : darkMetal, `${spec.name} service vent`, {
          position: [side * spec.width * 0.49, spec.height * (0.03 + (greeble % 2) * 0.08), spec.length * (0.34 - t * 0.57)],
          scale: [spec.width * 0.025, spec.height * 0.10, spec.length * 0.055],
        });
      }
    }

    if (spec.family === "heavy" || spec.role === "upper-right") {
      const antennaCount = spec.role === "near-left-cropped" ? 3 : 1;
      for (let antenna = 0; antenna < antennaCount; ++antenna) {
        visualMesh(craftRoot, antennaGeometry, trimMetal, `${spec.name} dorsal sensor mast ${antenna + 1}`, {
          position: [(antenna - (antennaCount - 1) * 0.5) * spec.width * 0.13, spec.height * 0.61, -spec.length * (0.02 + antenna * 0.08)],
          scale: [spec.height * 0.055, spec.height * 0.32, spec.height * 0.055],
        });
      }
    }

    const navRadius = Math.max(0.055, Math.min(0.15, spec.height * 0.065));
    const wingTip = wingRoot + wingReach * 0.96;
    const port = visualMesh(craftRoot, navGeometry, redNavMaterial, `${spec.name} port red navigation optic`, {
      position: [-wingTip, spec.height * 0.02, -spec.length * 0.02],
      scale: [navRadius, navRadius, navRadius],
      renderOrder: 5,
    });
    const starboard = visualMesh(craftRoot, navGeometry, cyanNavMaterial, `${spec.name} starboard cyan navigation optic`, {
      position: [wingTip, spec.height * 0.02, -spec.length * 0.02],
      scale: [navRadius, navRadius, navRadius],
      renderOrder: 5,
    });
    const beacon = visualMesh(craftRoot, navGeometry, amberNavMaterial, `${spec.name} amber anti-collision beacon`, {
      position: [0, spec.height * 0.57, -spec.length * 0.20],
      scale: [navRadius * 0.82, navRadius * 0.62, navRadius * 0.82],
      renderOrder: 5,
    });
    navOptics.push(
      { mesh: port, base: navRadius, phase: spec.phase },
      { mesh: starboard, base: navRadius, phase: spec.phase + 0.65 },
      { mesh: beacon, base: navRadius * 0.82, phase: spec.phase + 1.4, flattened: true },
    );

    return {
      root: craftRoot,
      spec,
      proxyKind: spec.proxy,
      proxySlot: -1,
      proxyScale: new THREE.Matrix4(),
    };
  }

  CRAFT_SPECS.forEach((spec, index) => crafts.push(buildCraft(spec, index)));

  const proxyStreams = new Map([
    ["light", createProxyStreams("light")],
    ["heavy", createProxyStreams("heavy")],
  ]);
  const proxyCapacities = new Map([
    ["light", crafts.filter(craft => craft.proxyKind === "light").length],
    ["heavy", crafts.filter(craft => craft.proxyKind === "heavy").length],
  ]);
  const proxySlots = new Map([["light", 0], ["heavy", 0]]);
  const groupLookup = new Map();
  const mutableInstanceGroups = [];

  for (const kind of ["light", "heavy"]) {
    const streams = proxyStreams.get(kind);
    const capacity = proxyCapacities.get(kind);
    const descriptor = Object.freeze({
      id: `megacity-aerial-${kind}-craft`,
      capacity,
      positions: streams.positions,
      indices: streams.indices,
      triangleRadiance: streams.triangleRadiance,
      triangleSurface: streams.triangleSurface,
      // These stable arrays intentionally make this same descriptor usable as
      // the per-frame update payload after registration.
      matrices: new Float32Array(capacity * 12),
      masks: new Uint32Array(capacity),
    });
    groupLookup.set(kind, descriptor);
    mutableInstanceGroups.push(descriptor);
  }
  const instanceGroups = Object.freeze(mutableInstanceGroups);

  for (const craft of crafts) {
    const streams = proxyStreams.get(craft.proxyKind);
    craft.proxySlot = proxySlots.get(craft.proxyKind);
    proxySlots.set(craft.proxyKind, craft.proxySlot + 1);
    craft.proxyScale.makeScale(
      craft.spec.width / streams.referenceWidth,
      craft.spec.height / streams.referenceHeight,
      craft.spec.length / streams.referenceLength,
    );
  }

  const proxyWorldMatrix = new THREE.Matrix4();
  let enabled = true;
  let disposed = false;
  let lastElapsed = 0;

  function update(elapsed, delta) {
    if (disposed) return;
    const time = Number.isFinite(Number(elapsed)) ? Number(elapsed) : 0;
    // Motion is an absolute function of elapsed time. Delta is validated only
    // to keep the public signature symmetric with the other sample systems.
    const frameDelta = Math.max(0, Math.min(0.1, Number(delta) || 0));
    void frameDelta;
    lastElapsed = time;

    for (const craft of crafts) {
      const { spec, root } = craft;
      const span = spec.maxX - spec.minX;
      const laneDistance = positiveModulo(
        spec.initialX - spec.minX + time * spec.speed * spec.direction,
        span,
      );
      const x = spec.minX + laneDistance;
      const bob = Math.sin(time * (0.42 + spec.speed * 0.018) + spec.phase) * spec.bob;
      const depthDrift = Math.sin(time * 0.19 + spec.phase * 1.73) * Math.min(0.16, spec.bob * 0.65);
      const pitch = Math.sin(time * 0.31 + spec.phase * 0.7) * 0.008;
      const bank = Math.sin(time * 0.38 + spec.phase) * 0.018 * spec.direction;
      root.position.set(x, spec.altitude + bob, spec.depth + depthDrift);
      root.rotation.set(pitch, spec.direction > 0 ? Math.PI * 0.5 : -Math.PI * 0.5, bank);
    }

    for (const rotor of engineRotors) {
      rotor.rotor.rotation.z = time * (1.8 + Math.abs(rotor.direction) * 0.25) * rotor.direction + rotor.phase;
    }
    for (const optic of navOptics) {
      const pulse = 0.94 + Math.sin(time * 2.1 + optic.phase) * 0.06;
      if (optic.flattened) optic.mesh.scale.set(optic.base * pulse, optic.base * 0.76 * pulse, optic.base * pulse);
      else optic.mesh.scale.setScalar(optic.base * pulse);
    }

    group.updateWorldMatrix(true, true);
    for (const descriptor of instanceGroups) descriptor.masks.fill(0);
    for (const craft of crafts) {
      const descriptor = groupLookup.get(craft.proxyKind);
      proxyWorldMatrix.multiplyMatrices(craft.root.matrixWorld, craft.proxyScale);
      writeAffine3x4(descriptor.matrices, craft.proxySlot * 12, proxyWorldMatrix);
      descriptor.masks[craft.proxySlot] = enabled ? RTX_VISIBLE_MASK : 0;
    }
  }

  function setEnabled(nextEnabled) {
    if (disposed) return;
    enabled = Boolean(nextEnabled);
    group.visible = enabled;
    // Re-evaluate at the same absolute time so proxy visibility changes in the
    // exact frame as raster visibility, without advancing any motion state.
    update(lastElapsed, 0);
  }

  update(0, 0);

  let visualMeshCount = 0;
  let visualTriangleCount = 0;
  group.traverse(object => {
    if (!object.isMesh) return;
    visualMeshCount += 1;
    const geometry = object.geometry;
    visualTriangleCount += geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute("position").count / 3;
  });
  const proxyBaseTriangleCount = instanceGroups.reduce(
    (total, descriptor) => total + descriptor.indices.length / 3,
    0,
  );
  const proxyInstancedTriangleCount = instanceGroups.reduce(
    (total, descriptor) => total + descriptor.indices.length / 3 * descriptor.capacity,
    0,
  );
  const stats = Object.freeze({
    vehicleCount: crafts.length,
    laneCount: CRAFT_SPECS.length,
    instanceGroupCount: instanceGroups.length,
    proxyCapacity: instanceGroups.reduce((total, descriptor) => total + descriptor.capacity, 0),
    visualMeshCount,
    visualTriangleCount,
    proxyBaseTriangleCount,
    proxyInstancedTriangleCount,
  });

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    for (const descriptor of instanceGroups) descriptor.masks.fill(0);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    group.clear();
    crafts.length = 0;
    navOptics.length = 0;
    engineRotors.length = 0;
    geometries.clear();
    materials.clear();
  }

  return {
    group,
    instanceGroups,
    update,
    setEnabled,
    dispose,
    stats,
  };
}
