import * as THREE from "three/webgpu";

// Insect root is Y-up with the body along Z (head +Z, abdomen −Z), matching
// insect-anatomy.mjs (body ~1.05, mesothorax rx 0.098, head at z 0.388).
const HEAD_ANTENNA_Z = 0.436;
const HEAD_ANTENNA_Y = 0.066;
const HEAD_ANTENNA_X = 0.032;

const TARSOMERE_COUNT = 4;
const TARSOMERE_FRACTIONS = Object.freeze([0.32, 0.27, 0.22, 0.19]);

// Pose Euler is [pitch, twist, splay] on ZXY for the coxa and XYZ otherwise.
// Splay is the outward magnitude; each side multiplies twist/splay by ±1.
// Attach x/y/z is the right-side coxa socket in insect-root space.
const PAIR_DEFS = Object.freeze([
  Object.freeze({
    pair: "fore",
    attach: Object.freeze([0.058, -0.038, 0.130]),
    lengths: Object.freeze({ coxa: 0.042, femur: 0.125, tibia: 0.142, tarsus: 0.095 }),
    radii: Object.freeze({ coxa: 0.016, femur: 0.013, tibia: 0.010, tarsus: 0.0066 }),
    pose: Object.freeze({
      coxa: Object.freeze([-0.52, 0.16, 0.98]),
      femur: Object.freeze([-0.38, 0.04, 0.22]),
      tibia: Object.freeze([1.18, 0.05, -0.58]),
      tarsus: Object.freeze([0.82, 0, -0.16]),
    }),
  }),
  Object.freeze({
    pair: "mid",
    attach: Object.freeze([0.068, -0.048, 0.055]),
    lengths: Object.freeze({ coxa: 0.046, femur: 0.138, tibia: 0.155, tarsus: 0.100 }),
    radii: Object.freeze({ coxa: 0.017, femur: 0.014, tibia: 0.0105, tarsus: 0.0068 }),
    pose: Object.freeze({
      coxa: Object.freeze([0.06, 0.04, 1.08]),
      femur: Object.freeze([0.14, 0.02, 0.16]),
      tibia: Object.freeze([1.24, 0.04, -0.72]),
      tarsus: Object.freeze([0.7, 0, -0.1]),
    }),
  }),
  Object.freeze({
    pair: "hind",
    attach: Object.freeze([0.064, -0.050, -0.075]),
    lengths: Object.freeze({ coxa: 0.050, femur: 0.155, tibia: 0.178, tarsus: 0.108 }),
    radii: Object.freeze({ coxa: 0.018, femur: 0.0145, tibia: 0.011, tarsus: 0.007 }),
    pose: Object.freeze({
      coxa: Object.freeze([0.7, 0.2, 0.9]),
      femur: Object.freeze([0.4, 0.05, 0.14]),
      tibia: Object.freeze([1.08, 0.06, -0.5]),
      tarsus: Object.freeze([0.56, 0, -0.12]),
    }),
  }),
]);

function mirrorEuler(euler, side) {
  return Object.freeze([euler[0], side * euler[1], side * euler[2]]);
}

function buildLegDefs() {
  const defs = [];
  for (const pair of PAIR_DEFS) {
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? "left" : "right";
      defs.push(Object.freeze({
        id: `${sideName}-${pair.pair}`,
        side,
        pair: pair.pair,
        attach: Object.freeze([
          side * pair.attach[0],
          pair.attach[1],
          pair.attach[2],
        ]),
        lengths: pair.lengths,
        radii: pair.radii,
        pose: Object.freeze({
          coxa: mirrorEuler(pair.pose.coxa, side),
          femur: mirrorEuler(pair.pose.femur, side),
          tibia: mirrorEuler(pair.pose.tibia, side),
          tarsus: mirrorEuler(pair.pose.tarsus, side),
        }),
      }));
    }
  }
  return Object.freeze(defs);
}

const LEG_DEFS = buildLegDefs();

function createFallbackMaterial(name, color, extras = {}) {
  return new THREE.MeshPhysicalNodeMaterial({
    name,
    color,
    roughness: extras.roughness ?? 0.4,
    metalness: extras.metalness ?? 0.12,
    clearcoat: extras.clearcoat ?? 0.26,
    clearcoatRoughness: extras.clearcoatRoughness ?? 0.44,
    sheen: extras.sheen ?? 0.38,
    sheenColor: new THREE.Color(extras.sheenColor ?? 0x163c48),
    sheenRoughness: extras.sheenRoughness ?? 0.64,
    iridescence: extras.iridescence ?? 0.07,
    iridescenceIOR: 1.56,
    iridescenceThicknessRange: [80, 260],
  });
}

function resolveMaterials(materials = {}) {
  return {
    leg: materials?.leg ?? createFallbackMaterial("Articulated Morpho leg chitin", 0x22180f, {
      roughness: 0.48,
      metalness: 0.1,
      clearcoat: 0.22,
      sheen: 0.28,
    }),
    antenna: materials?.antenna ?? createFallbackMaterial("Clubbed Morpho antenna chitin", 0x2c1e14, {
      roughness: 0.58,
      metalness: 0.04,
      clearcoat: 0.08,
      sheen: 0.18,
      sheenColor: 0x1a2830,
    }),
    claw: materials?.claw ?? createFallbackMaterial("Hard Morpho tarsal claw", 0x0a0806, {
      roughness: 0.22,
      metalness: 0.2,
      clearcoat: 0.55,
      sheen: 0.08,
      iridescence: 0,
    }),
  };
}

function capsuleCylinderHeight(totalLength, radius) {
  return Math.max(totalLength * 0.12, totalLength - radius * 2);
}

function createCapsule(radius, totalLength, capSegments = 5, radialSegments = 8) {
  const cylinder = capsuleCylinderHeight(totalLength, radius);
  const geometry = new THREE.CapsuleGeometry(radius, cylinder, capSegments, radialSegments);
  geometry.userData.totalLength = cylinder + radius * 2;
  return geometry;
}

function tagMesh(mesh, name) {
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.rtxIgnore = true;
  return mesh;
}

function createJoint(name) {
  const joint = new THREE.Group();
  joint.name = name;
  joint.userData.rtxIgnore = true;
  return joint;
}

function addCapsuleSegment(parent, { name, geometry, material, length, along = -1 }) {
  const mesh = tagMesh(new THREE.Mesh(geometry, material), name);
  mesh.position.y = along * length * 0.5;
  parent.add(mesh);
  const distal = createJoint(`${name} distal`);
  distal.position.y = along * length;
  parent.add(distal);
  return { mesh, distal };
}

function createTarsus(label, def, materials) {
  const joint = createJoint(`${label} tarsus`);
  const { side, lengths, radii } = def;
  const total = lengths.tarsus;
  let parent = joint;

  for (let index = 0; index < TARSOMERE_COUNT; index += 1) {
    const length = total * TARSOMERE_FRACTIONS[index];
    const width = radii.tarsus * (1.85 - index * 0.22);
    const depth = radii.tarsus * (1.45 - index * 0.18);
    const mesh = tagMesh(
      new THREE.Mesh(new THREE.BoxGeometry(width, length, depth), materials.leg),
      `${label} tarsomere ${index + 1}`,
    );
    mesh.position.y = -length * 0.5;
    parent.add(mesh);

    const distal = createJoint(`${label} tarsomere ${index + 1} distal`);
    distal.position.y = -length;
    // Curl plantward so the tarsi grip a fern pinna under the thorax.
    distal.rotation.x = 0.16 + index * 0.09;
    distal.rotation.z = side * -0.07;
    parent.add(distal);
    parent = distal;
  }

  const clawLength = total * 0.22;
  const clawGeometry = new THREE.BoxGeometry(
    radii.tarsus * 0.55,
    clawLength,
    radii.tarsus * 0.42,
  );
  for (const clawSide of [-1, 1]) {
    const claw = tagMesh(
      new THREE.Mesh(clawGeometry, materials.claw),
      `${label} ${clawSide < 0 ? "inner" : "outer"} claw`,
    );
    claw.position.set(
      side * clawSide * radii.tarsus * 0.55,
      -clawLength * 0.42,
      radii.tarsus * 0.15,
    );
    claw.rotation.x = 0.92;
    claw.rotation.z = side * clawSide * 0.55;
    parent.add(claw);
  }

  return joint;
}

function createLeg(def, materials) {
  const sideName = def.side < 0 ? "left" : "right";
  const label = `Morpho ${sideName} ${def.pair}leg`;
  const coxa = createJoint(label);
  coxa.position.set(def.attach[0], def.attach[1], def.attach[2]);
  coxa.rotation.order = "ZXY";
  coxa.rotation.set(def.pose.coxa[0], def.pose.coxa[1], def.pose.coxa[2]);

  coxa.add(tagMesh(
    new THREE.Mesh(new THREE.SphereGeometry(def.radii.coxa * 1.12, 10, 8), materials.leg),
    `${label} coxa socket`,
  ));

  const coxaSeg = addCapsuleSegment(coxa, {
    name: `${label} coxa`,
    geometry: createCapsule(def.radii.coxa, def.lengths.coxa, 5, 8),
    material: materials.leg,
    length: def.lengths.coxa,
  });

  const femur = createJoint(`${label} femur`);
  femur.rotation.set(def.pose.femur[0], def.pose.femur[1], def.pose.femur[2]);
  coxaSeg.distal.add(femur);
  const femurSeg = addCapsuleSegment(femur, {
    name: `${label} femur`,
    geometry: createCapsule(def.radii.femur, def.lengths.femur, 5, 9),
    material: materials.leg,
    length: def.lengths.femur,
  });

  const tibia = createJoint(`${label} tibia`);
  tibia.rotation.set(def.pose.tibia[0], def.pose.tibia[1], def.pose.tibia[2]);
  femurSeg.distal.add(tibia);
  const tibiaSeg = addCapsuleSegment(tibia, {
    name: `${label} tibia`,
    geometry: createCapsule(def.radii.tibia, def.lengths.tibia, 5, 8),
    material: materials.leg,
    length: def.lengths.tibia,
  });

  const tarsus = createTarsus(label, def, materials);
  tarsus.rotation.set(def.pose.tarsus[0], def.pose.tarsus[1], def.pose.tarsus[2]);
  tibiaSeg.distal.add(tarsus);

  coxa.userData.side = sideName;
  coxa.userData.pair = def.pair;
  coxa.userData.joints = Object.freeze({ coxa, femur, tibia, tarsus });
  return coxa;
}

function createAntenna(side, materials) {
  const sideName = side < 0 ? "left" : "right";
  const label = `Morpho ${sideName} antenna`;
  const scapeLen = 0.032;
  const pedicelLen = 0.024;
  const flagellumLen = 0.255;
  const clubLen = 0.068;
  const shaftRadius = 0.0056;
  const clubRadius = 0.0148;

  const root = createJoint(label);
  root.position.set(side * HEAD_ANTENNA_X, HEAD_ANTENNA_Y, HEAD_ANTENNA_Z);
  root.rotation.order = "ZXY";
  // Segments grow along +Y; +pitch leans toward the head (+Z), −splay opens outward.
  root.rotation.set(1.02, side * 0.18, side * -0.36);

  const scape = createJoint(`${label} scape`);
  root.add(scape);
  const scapeSeg = addCapsuleSegment(scape, {
    name: `${label} scape`,
    geometry: createCapsule(shaftRadius * 1.35, scapeLen, 4, 8),
    material: materials.antenna,
    length: scapeLen,
    along: 1,
  });

  const pedicel = createJoint(`${label} pedicel`);
  pedicel.rotation.x = 0.14;
  pedicel.rotation.z = side * -0.05;
  scapeSeg.distal.add(pedicel);
  const pedicelSeg = addCapsuleSegment(pedicel, {
    name: `${label} pedicel`,
    geometry: createCapsule(shaftRadius * 1.12, pedicelLen, 4, 8),
    material: materials.antenna,
    length: pedicelLen,
    along: 1,
  });

  const flagellum = createJoint(`${label} flagellum`);
  flagellum.rotation.x = 0.28;
  flagellum.rotation.z = side * -0.04;
  pedicelSeg.distal.add(flagellum);
  const flagellumSeg = addCapsuleSegment(flagellum, {
    name: `${label} flagellum`,
    geometry: createCapsule(shaftRadius, flagellumLen, 5, 8),
    material: materials.antenna,
    length: flagellumLen,
    along: 1,
  });

  const club = createJoint(`${label} club`);
  club.rotation.x = 0.16;
  flagellumSeg.distal.add(club);
  addCapsuleSegment(club, {
    name: `${label} club`,
    geometry: createCapsule(clubRadius, clubLen, 6, 10),
    material: materials.antenna,
    length: clubLen,
    along: 1,
  });
  const clubTip = tagMesh(
    new THREE.Mesh(new THREE.SphereGeometry(clubRadius * 1.05, 12, 10), materials.antenna),
    `${label} club tip`,
  );
  clubTip.position.y = clubLen;
  club.add(clubTip);

  root.userData.side = sideName;
  root.userData.joints = Object.freeze({ scape, pedicel, flagellum, club });
  return root;
}

export function createInsectAppendages({ materials } = {}) {
  const mats = resolveMaterials(materials);
  const group = new THREE.Group();
  group.name = "Morpho articulated appendages";

  const legs = LEG_DEFS.map((def) => {
    const leg = createLeg(def, mats);
    group.add(leg);
    return leg;
  });

  const leftAntenna = createAntenna(-1, mats);
  const rightAntenna = createAntenna(1, mats);
  group.add(leftAntenna, rightAntenna);

  group.traverse((object) => {
    object.userData.rtxIgnore = true;
  });

  return Object.freeze({
    group,
    legs: Object.freeze(legs),
    antennae: Object.freeze([leftAntenna, rightAntenna]),
  });
}
