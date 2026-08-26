import * as THREE from "three/webgpu";

// Opaque iron, stone, and brick are static BLAS candidates. Transmissive panes
// are tagged rtxIgnore so the hybrid frame never bakes them into collectStaticRtxScene.

const GARDEN_SEED = 0x10f01000;
const BAY_COUNT = 8;
const PLINTH_WIDTH = 8;
const PLINTH_DEPTH = 6;
const PLINTH_HEIGHT = 0.4;
const COURTYARD_WIDTH = 4.8;
const COURTYARD_DEPTH = 3.2;
const BRICK_HEIGHT = 0.7;
const BRICK_THICKNESS = 0.28;
const FRAME_LENGTH = 7.6;
const FRAME_WIDTH = 5.36;
const EAVES_Y = 3.08;
const RIDGE_Y = 4.62;
const DOOR_HALF = 0.58;
const UNIT_Z = new THREE.Vector3(0, 0, 1);
const ALONG = new THREE.Vector3();
const SLOPE = new THREE.Vector3();

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hashedUnit(kind, bay, row) {
  let hash = (
    GARDEN_SEED ^
    Math.imul(kind + 1, 0x9e3779b1) ^
    Math.imul(bay + 3, 0x85ebca6b) ^
    Math.imul(row + 7, 0xc2b2ae35)
  ) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function panePresent(kind, bay, row) {
  const unit = hashedUnit(kind, bay, row);
  if (kind === 1 && bay >= 6 && row >= 1) return unit > 0.42;
  if (kind === 2 && bay >= 5) return unit > 0.4;
  if (kind === 3 && bay >= 6) return unit > 0.34;
  if (kind === 5) return unit > 0.28;
  return unit > 0.12;
}

function shadow(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function tagGlass(mesh) {
  mesh.userData.rtxIgnore = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 4;
  return mesh;
}

function addBox(parent, name, size, position, material, rotation = null, cast = true, receive = true) {
  const mesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(...size), material), cast, receive);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, name, radiusTop, radiusBottom, height, position, material, rotation = null, segments = 8) {
  const mesh = shadow(new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  ), true, true);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(mesh);
  return mesh;
}

function placeBar(mesh, ax, ay, az, bx, by, bz) {
  mesh.position.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
  ALONG.set(bx - ax, by - ay, bz - az);
  const length = ALONG.length();
  if (length > 1e-6) {
    ALONG.multiplyScalar(1 / length);
    mesh.quaternion.setFromUnitVectors(UNIT_Z, ALONG);
  }
  mesh.scale.set(1, 1, length);
  return length;
}

function tagReflection(material, mask) {
  material.rtxReflectionMask = mask;
  if (!Number.isFinite(material.roughness)) material.roughness = 0.5;
  if (!Number.isFinite(material.metalness)) material.metalness = 0;
  return material;
}

function createIronMaterial() {
  return tagReflection(new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered greenhouse iron",
    color: 0x2a3036,
    metalness: 0.85,
    roughness: 0.32,
    envMapIntensity: 1.15,
  }), 0.56);
}

function createStoneMaterial() {
  return tagReflection(new THREE.MeshPhysicalNodeMaterial({
    name: "Dawn limestone plinth",
    color: 0x6a645c,
    metalness: 0.05,
    roughness: 0.78,
    clearcoat: 0.08,
    clearcoatRoughness: 0.55,
  }), 0.12);
}

function createBrickMaterial() {
  return tagReflection(new THREE.MeshPhysicalNodeMaterial({
    name: "Weathered dwarf-wall brick",
    color: 0x6d3e30,
    metalness: 0.03,
    roughness: 0.84,
  }), 0.08);
}

function createMossMaterial(map) {
  return tagReflection(new THREE.MeshPhysicalNodeMaterial({
    name: "Damp greenhouse moss",
    color: 0x3d5a34,
    map: map ?? null,
    metalness: 0.02,
    roughness: 0.9,
    clearcoat: 0.18,
    clearcoatRoughness: 0.46,
  }), 0.07);
}

function createGlassMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Dawn greenhouse glass",
    color: 0xb7d0d4,
    metalness: 0,
    roughness: 0.055,
    transmission: 0.92,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    side: THREE.DoubleSide,
    ior: 1.5,
    thickness: 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });
  material.rtxPreserveTransparency = 1;
  material.rtxReflectionMask = 0.16;
  material.userData.rtxIgnore = true;
  return material;
}

function configureMossTexture(texture) {
  if (!texture) return null;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.max(finite(texture.anisotropy, 1), 8);
  texture.needsUpdate = true;
  return texture;
}

function resolveMaterials(materials, mossTexture) {
  const map = configureMossTexture(mossTexture);
  let moss = materials?.moss ?? createMossMaterial(map);
  if (map && moss.map !== map) {
    moss = typeof moss.clone === "function" ? moss.clone() : createMossMaterial(map);
    moss.map = map;
  }
  return {
    iron: materials?.iron ?? createIronMaterial(),
    stone: materials?.stone ?? createStoneMaterial(),
    brick: materials?.brick ?? createBrickMaterial(),
    moss,
    glass: materials?.glass ?? createGlassMaterial(),
  };
}

function addPlinth(opaqueRoot, stone) {
  const bandX = (PLINTH_WIDTH - COURTYARD_WIDTH) * 0.5;
  const bandZ = (PLINTH_DEPTH - COURTYARD_DEPTH) * 0.5;
  const y = PLINTH_HEIGHT * 0.5;
  addBox(
    opaqueRoot,
    "South stone plinth",
    [PLINTH_WIDTH, PLINTH_HEIGHT, bandZ],
    [0, y, -(PLINTH_DEPTH - bandZ) * 0.5],
    stone,
  );
  addBox(
    opaqueRoot,
    "North stone plinth",
    [PLINTH_WIDTH, PLINTH_HEIGHT, bandZ],
    [0, y, (PLINTH_DEPTH - bandZ) * 0.5],
    stone,
  );
  addBox(
    opaqueRoot,
    "West stone plinth",
    [bandX, PLINTH_HEIGHT, COURTYARD_DEPTH],
    [-(PLINTH_WIDTH - bandX) * 0.5, y, 0],
    stone,
  );
  addBox(
    opaqueRoot,
    "East stone plinth",
    [bandX, PLINTH_HEIGHT, COURTYARD_DEPTH],
    [(PLINTH_WIDTH - bandX) * 0.5, y, 0],
    stone,
  );
  addBox(
    opaqueRoot,
    "South plinth nosing",
    [COURTYARD_WIDTH + 0.16, 0.05, 0.12],
    [0, PLINTH_HEIGHT + 0.01, -COURTYARD_DEPTH * 0.5],
    stone,
  );
  addBox(
    opaqueRoot,
    "North plinth nosing",
    [COURTYARD_WIDTH + 0.16, 0.05, 0.12],
    [0, PLINTH_HEIGHT + 0.01, COURTYARD_DEPTH * 0.5],
    stone,
  );
}

function addBrickWall(opaqueRoot, brick, stone) {
  const brickTop = PLINTH_HEIGHT + BRICK_HEIGHT * 0.5;
  const outerX = PLINTH_WIDTH * 0.5 - BRICK_THICKNESS * 0.5 - 0.04;
  const outerZ = PLINTH_DEPTH * 0.5 - BRICK_THICKNESS * 0.5 - 0.04;
  const longSpan = PLINTH_WIDTH - 0.08;
  const shortSpan = PLINTH_DEPTH - BRICK_THICKNESS * 2 - 0.08;

  addBox(opaqueRoot, "South dwarf brick wall", [longSpan, BRICK_HEIGHT, BRICK_THICKNESS], [0, brickTop, -outerZ], brick);
  addBox(opaqueRoot, "North dwarf brick wall", [longSpan, BRICK_HEIGHT, BRICK_THICKNESS], [0, brickTop, outerZ], brick);
  addBox(opaqueRoot, "West dwarf brick wall", [BRICK_THICKNESS, BRICK_HEIGHT, shortSpan], [-outerX, brickTop, 0], brick);

  const eastClear = DOOR_HALF + 0.08;
  const eastLeaf = shortSpan * 0.5 - eastClear;
  addBox(
    opaqueRoot,
    "East dwarf brick wall south leaf",
    [BRICK_THICKNESS, BRICK_HEIGHT, eastLeaf],
    [outerX, brickTop, -(eastClear + eastLeaf * 0.5)],
    brick,
  );
  addBox(
    opaqueRoot,
    "East dwarf brick wall north leaf",
    [BRICK_THICKNESS, BRICK_HEIGHT, eastLeaf],
    [outerX, brickTop, eastClear + eastLeaf * 0.5],
    brick,
  );

  const capY = PLINTH_HEIGHT + BRICK_HEIGHT + 0.03;
  addBox(opaqueRoot, "South brick copestone", [longSpan + 0.06, 0.06, BRICK_THICKNESS + 0.05], [0, capY, -outerZ], stone);
  addBox(opaqueRoot, "North brick copestone", [longSpan + 0.06, 0.06, BRICK_THICKNESS + 0.05], [0, capY, outerZ], stone);
  addBox(opaqueRoot, "West brick copestone", [BRICK_THICKNESS + 0.05, 0.06, shortSpan + 0.06], [-outerX, capY, 0], stone);
  addBox(
    opaqueRoot,
    "East brick copestone south leaf",
    [BRICK_THICKNESS + 0.05, 0.06, eastLeaf + 0.04],
    [outerX, capY, -(eastClear + eastLeaf * 0.5)],
    stone,
  );
  addBox(
    opaqueRoot,
    "East brick copestone north leaf",
    [BRICK_THICKNESS + 0.05, 0.06, eastLeaf + 0.04],
    [outerX, capY, eastClear + eastLeaf * 0.5],
    stone,
  );

  addBox(
    opaqueRoot,
    "Collapsed south-east brick heap",
    [0.42, 0.18, 0.28],
    [3.35, PLINTH_HEIGHT + 0.12, -2.42],
    brick,
    [0.18, 0.4, 0.12],
  );
  addBox(
    opaqueRoot,
    "Loose dwarf-wall brick",
    [0.22, 0.07, 0.11],
    [3.52, PLINTH_HEIGHT + 0.055, -2.18],
    brick,
    [0.2, 0.7, -0.15],
  );
}

function addCornerPlanters(opaqueRoot, stone, moss) {
  const troughs = [
    [-3.22, 2.22],
    [-3.24, -2.2],
  ];
  for (const [x, z] of troughs) {
    addBox(opaqueRoot, "Corner moss planter trough", [0.72, 0.22, 0.42], [x, PLINTH_HEIGHT + 0.13, z], stone);
    addBox(
      opaqueRoot,
      "Planter moss cap",
      [0.64, 0.07, 0.34],
      [x, PLINTH_HEIGHT + 0.26, z],
      moss,
      null,
      false,
      true,
    );
  }
}

function addMoss(opaqueRoot, moss) {
  const mounds = [
    [-3.05, 2.32, 1.2, 0.4, 1.05],
    [3.08, 2.28, 1.1, 0.36, 0.95],
    [-3.12, -2.26, 1.15, 0.38, 1.0],
    [3.2, -2.12, 0.82, 0.3, 0.7],
    [-3.58, 0.85, 0.68, 0.26, 0.52],
  ];
  const geometry = new THREE.SphereGeometry(0.22, 10, 8);
  for (let index = 0; index < mounds.length; index += 1) {
    const [x, z, sx, sy, sz] = mounds[index];
    const mesh = shadow(new THREE.Mesh(geometry, moss), false, true);
    mesh.name = `Perimeter moss mound ${index + 1}`;
    mesh.position.set(x, PLINTH_HEIGHT + sy * 0.22, z);
    mesh.scale.set(sx, sy, sz);
    opaqueRoot.add(mesh);
  }
}

function addDoorAndSteps(opaqueRoot, iron, stone) {
  const brickTop = PLINTH_HEIGHT + BRICK_HEIGHT;
  const jambX = PLINTH_WIDTH * 0.5 - BRICK_THICKNESS * 0.5 - 0.04;
  addBox(opaqueRoot, "East door south jamb", [0.07, 2.05, 0.07], [jambX, brickTop + 1.02, -DOOR_HALF], iron);
  addBox(opaqueRoot, "East door north jamb", [0.07, 2.05, 0.07], [jambX, brickTop + 1.02, DOOR_HALF], iron);
  addBox(opaqueRoot, "East door lintel", [0.08, 0.07, DOOR_HALF * 2 + 0.14], [jambX, brickTop + 2.08, 0], iron);
  addBox(opaqueRoot, "East door threshold", [0.42, 0.08, DOOR_HALF * 2 + 0.2], [jambX + 0.08, PLINTH_HEIGHT + 0.02, 0], stone);

  const leaf = new THREE.Group();
  leaf.name = "Open iron door leaf";
  leaf.position.set(jambX, brickTop + 1.02, DOOR_HALF);
  leaf.rotation.y = -1.08;
  opaqueRoot.add(leaf);
  addBox(leaf, "Door leaf north stile", [0.045, 2.02, 0.045], [0, 0, 0], iron);
  addBox(leaf, "Door leaf south stile", [0.045, 2.02, 0.045], [0, 0, -1.08], iron);
  addBox(leaf, "Door leaf top rail", [0.045, 0.05, 1.08], [0, 0.98, -0.54], iron);
  addBox(leaf, "Door leaf mid rail", [0.045, 0.05, 1.08], [0, 0.08, -0.54], iron);
  addBox(leaf, "Door leaf bottom rail", [0.045, 0.05, 1.08], [0, -0.96, -0.54], iron);
  addBox(leaf, "Door leaf mid muntin", [0.035, 1.88, 0.035], [0, 0, -0.54], iron);

  addBox(opaqueRoot, "Entrance lower step", [0.7, 0.1, 1.45], [PLINTH_WIDTH * 0.5 + 0.42, 0.05, 0], stone);
  addBox(opaqueRoot, "Entrance upper step", [0.48, 0.1, 1.28], [PLINTH_WIDTH * 0.5 + 0.18, 0.15, 0], stone);
}

function addIronBays(opaqueRoot, iron) {
  const ironBays = new THREE.Group();
  ironBays.name = "Eight iron bays";
  opaqueRoot.add(ironBays);

  const bayWidth = FRAME_LENGTH / BAY_COUNT;
  const startX = -FRAME_LENGTH * 0.5;
  const postZ = FRAME_WIDTH * 0.5;
  const brickTop = PLINTH_HEIGHT + BRICK_HEIGHT;
  const postHeight = EAVES_Y - brickTop;
  const postY = brickTop + postHeight * 0.5;
  const rise = RIDGE_Y - EAVES_Y;
  const run = FRAME_WIDTH * 0.5;
  const wallGlassHeight = EAVES_Y - brickTop;
  const transomYs = [
    brickTop + wallGlassHeight * 0.33,
    brickTop + wallGlassHeight * 0.66,
  ];

  const postGeometry = new THREE.BoxGeometry(0.08, postHeight, 0.08);
  const baseGeometry = new THREE.BoxGeometry(0.16, 0.07, 0.16);
  const capGeometry = new THREE.BoxGeometry(0.14, 0.055, 0.14);
  const ridgeGeometry = new THREE.BoxGeometry(0.055, 0.07, 1);
  const rafterGeometry = new THREE.BoxGeometry(0.045, 0.055, 1);
  const transomGeometry = new THREE.BoxGeometry(1, 0.04, 0.045);
  const bracketGeometry = new THREE.BoxGeometry(0.035, 0.035, 1);

  function postX(index) {
    return startX + index * bayWidth;
  }

  function addPost(parent, name, x, z) {
    const post = shadow(new THREE.Mesh(postGeometry, iron));
    post.name = name;
    post.position.set(x, postY, z);
    parent.add(post);
    const base = shadow(new THREE.Mesh(baseGeometry, iron));
    base.name = `${name} base shoe`;
    base.position.set(x, brickTop + 0.035, z);
    parent.add(base);
    const cap = shadow(new THREE.Mesh(capGeometry, iron));
    cap.name = `${name} capital`;
    cap.position.set(x, EAVES_Y + 0.02, z);
    parent.add(cap);
    return post;
  }

  function addRafter(parent, name, x, side) {
    const mesh = shadow(new THREE.Mesh(rafterGeometry, iron));
    mesh.name = name;
    placeBar(mesh, x, EAVES_Y, side * postZ, x, RIDGE_Y, 0);
    parent.add(mesh);
    return mesh;
  }

  function addBracket(parent, name, x, z, side) {
    const mesh = shadow(new THREE.Mesh(bracketGeometry, iron));
    mesh.name = name;
    placeBar(mesh, x, EAVES_Y - 0.02, z, x, EAVES_Y - 0.34, z - side * 0.38);
    parent.add(mesh);
  }

  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const group = new THREE.Group();
    group.name = `Iron bay ${bay + 1}`;
    ironBays.add(group);

    const west = postX(bay);
    const east = postX(bay + 1);
    const mid = (west + east) * 0.5;

    addPost(group, `Iron bay ${bay + 1} south post`, west, -postZ);
    addPost(group, `Iron bay ${bay + 1} north post`, west, postZ);
    addRafter(group, `Iron bay ${bay + 1} south rafter`, west, -1);
    addRafter(group, `Iron bay ${bay + 1} north rafter`, west, 1);
    addBracket(group, `Iron bay ${bay + 1} south bracket`, west, -postZ, -1);
    addBracket(group, `Iron bay ${bay + 1} north bracket`, west, postZ, 1);

    const ridge = shadow(new THREE.Mesh(ridgeGeometry, iron));
    ridge.name = `Iron bay ${bay + 1} ridge roof bar`;
    placeBar(ridge, mid, RIDGE_Y, -postZ - 0.08, mid, RIDGE_Y, postZ + 0.08);
    group.add(ridge);

    for (const y of transomYs) {
      for (const z of [-postZ, postZ]) {
        const transom = shadow(new THREE.Mesh(transomGeometry, iron));
        transom.name = `Iron bay ${bay + 1} wall transom`;
        transom.position.set(mid, y, z);
        transom.scale.set(bayWidth - 0.08, 1, 1);
        group.add(transom);
      }
    }

    const purlinSouth = shadow(new THREE.Mesh(transomGeometry, iron));
    purlinSouth.name = `Iron bay ${bay + 1} south purlin`;
    placeBar(
      purlinSouth,
      west + 0.04,
      EAVES_Y + rise * 0.5,
      -postZ * 0.5,
      east - 0.04,
      EAVES_Y + rise * 0.5,
      -postZ * 0.5,
    );
    group.add(purlinSouth);

    const purlinNorth = shadow(new THREE.Mesh(transomGeometry, iron));
    purlinNorth.name = `Iron bay ${bay + 1} north purlin`;
    placeBar(
      purlinNorth,
      west + 0.04,
      EAVES_Y + rise * 0.5,
      postZ * 0.5,
      east - 0.04,
      EAVES_Y + rise * 0.5,
      postZ * 0.5,
    );
    group.add(purlinNorth);

    if (bay === BAY_COUNT - 1) {
      addPost(group, `Iron bay ${bay + 1} south end post`, east, -postZ);
      addPost(group, `Iron bay ${bay + 1} north end post`, east, postZ);
      addRafter(group, `Iron bay ${bay + 1} south end rafter`, east, -1);
      addRafter(group, `Iron bay ${bay + 1} north end rafter`, east, 1);
      addBracket(group, `Iron bay ${bay + 1} south end bracket`, east, -postZ, -1);
      addBracket(group, `Iron bay ${bay + 1} north end bracket`, east, postZ, 1);
    }
  }

  addBox(opaqueRoot, "Ridge beam", [FRAME_LENGTH + 0.18, 0.07, 0.06], [0, RIDGE_Y + 0.02, 0], iron);
  addBox(opaqueRoot, "South eaves beam", [FRAME_LENGTH + 0.12, 0.06, 0.07], [0, EAVES_Y, -postZ], iron);
  addBox(opaqueRoot, "North eaves beam", [FRAME_LENGTH + 0.12, 0.06, 0.07], [0, EAVES_Y, postZ], iron);
  addBox(opaqueRoot, "South gutter", [FRAME_LENGTH + 0.16, 0.05, 0.09], [0, EAVES_Y - 0.04, -postZ - 0.08], iron);
  addBox(opaqueRoot, "North gutter", [FRAME_LENGTH + 0.16, 0.05, 0.09], [0, EAVES_Y - 0.04, postZ + 0.08], iron);

  for (const x of [startX, startX + FRAME_LENGTH]) {
    addBox(opaqueRoot, "Gable eaves tie", [0.055, 0.055, FRAME_WIDTH + 0.1], [x, EAVES_Y, 0], iron);
    addCylinder(opaqueRoot, "Gable king post", 0.03, 0.03, rise, [x, EAVES_Y + rise * 0.5, 0], iron, null, 8);
  }

  for (let bay = 0; bay < BAY_COUNT; bay += 2) {
    const x = postX(bay) + bayWidth * 0.5;
    addCylinder(
      opaqueRoot,
      "Overhead iron tie rod",
      0.016,
      0.016,
      FRAME_WIDTH,
      [x, EAVES_Y - 0.02, 0],
      iron,
      [Math.PI * 0.5, 0, 0],
      8,
    );
  }

  const downspoutHeight = EAVES_Y - 0.12;
  for (const x of [startX, startX + FRAME_LENGTH]) {
    for (const z of [-postZ, postZ]) {
      addCylinder(
        opaqueRoot,
        "Corner downspout",
        0.022,
        0.026,
        downspoutHeight,
        [x, downspoutHeight * 0.5, z],
        iron,
        null,
        8,
      );
    }
  }

  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    if (bay >= 6 && hashedUnit(9, bay, 0) < 0.55) continue;
    const x = postX(bay) + bayWidth * 0.5;
    addBox(opaqueRoot, "Ridge cresting spike", [0.03, 0.18, 0.03], [x, RIDGE_Y + 0.14, 0], iron);
  }
  addCylinder(opaqueRoot, "West ridge finial", 0.01, 0.045, 0.32, [startX, RIDGE_Y + 0.22, 0], iron, null, 8);
  addCylinder(opaqueRoot, "East ridge finial", 0.01, 0.045, 0.32, [startX + FRAME_LENGTH, RIDGE_Y + 0.22, 0], iron, null, 8);

  const fallen = shadow(new THREE.Mesh(rafterGeometry, iron));
  fallen.name = "Fallen south-east roof bar";
  placeBar(fallen, 3.15, EAVES_Y - 0.15, -postZ + 0.05, 2.35, PLINTH_HEIGHT + 0.18, -1.92);
  opaqueRoot.add(fallen);

  return { postX, postZ, bayWidth, startX, brickTop, rise, run };
}

function addGlassPanes(glassRoot, glass, layout) {
  const { postX, postZ, bayWidth, startX, brickTop, rise, run } = layout;
  const paneThickness = 0.012;
  const wallRows = 3;
  const roofRows = 3;
  const wallHeight = EAVES_Y - brickTop;
  const rowHeight = wallHeight / wallRows;
  const paneWidth = bayWidth - 0.08;
  const paneHeight = rowHeight - 0.05;
  const wallGeometry = new THREE.BoxGeometry(1, 1, paneThickness);
  const roofGeometry = new THREE.BoxGeometry(1, paneThickness, 1);

  function addPane(name, geometry, x, y, z, scaleX, scaleY, scaleZ, rotation) {
    const mesh = tagGlass(new THREE.Mesh(geometry, glass));
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(scaleX, scaleY, scaleZ);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    glassRoot.add(mesh);
    return mesh;
  }

  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const x = postX(bay) + bayWidth * 0.5;
    for (let row = 0; row < wallRows; row += 1) {
      const y = brickTop + rowHeight * (row + 0.5);
      if (panePresent(0, bay, row)) {
        addPane(`North wall pane bay ${bay + 1} row ${row + 1}`, wallGeometry, x, y, postZ, paneWidth, paneHeight, 1, null);
      }
      if (panePresent(1, bay, row)) {
        addPane(`South wall pane bay ${bay + 1} row ${row + 1}`, wallGeometry, x, y, -postZ, paneWidth, paneHeight, 1, null);
      }
    }

    const slopeLength = Math.hypot(rise, run);
    const paneAlong = slopeLength / roofRows - 0.05;
    for (let row = 0; row < roofRows; row += 1) {
      const t = (row + 0.5) / roofRows;
      const y = EAVES_Y + rise * t;
      if (panePresent(2, bay, row)) {
        const mesh = tagGlass(new THREE.Mesh(roofGeometry, glass));
        mesh.name = `South roof pane bay ${bay + 1} row ${row + 1}`;
        mesh.position.set(x, y, -postZ * (1 - t));
        mesh.scale.set(paneWidth, 1, paneAlong);
        mesh.quaternion.setFromUnitVectors(UNIT_Z, SLOPE.set(0, rise, run).normalize());
        glassRoot.add(mesh);
      }
      if (panePresent(3, bay, row)) {
        const mesh = tagGlass(new THREE.Mesh(roofGeometry, glass));
        mesh.name = `North roof pane bay ${bay + 1} row ${row + 1}`;
        mesh.position.set(x, y, postZ * (1 - t));
        mesh.scale.set(paneWidth, 1, paneAlong);
        mesh.quaternion.setFromUnitVectors(UNIT_Z, SLOPE.set(0, rise, -run).normalize());
        glassRoot.add(mesh);
      }
    }
  }

  const gableWidth = postZ * 0.42;
  const gableX = [startX, startX + FRAME_LENGTH];
  const gableKind = [4, 5];
  for (let gable = 0; gable < 2; gable += 1) {
    const x = gableX[gable];
    const kind = gableKind[gable];
    for (let column = -1; column <= 1; column += 1) {
      const z = column * (postZ * 0.42);
      for (let row = 0; row < 3; row += 1) {
        const doorVoid = gable === 1 && column === 0 && row < 2;
        if (doorVoid || !panePresent(kind, column + 1, row)) continue;
        const y = brickTop + rowHeight * (row + 0.5);
        const height = paneHeight * (row === 2 ? 0.7 : 1);
        addPane(
          `${gable === 0 ? "West" : "East"} gable pane ${column + 2}-${row + 1}`,
          wallGeometry,
          x,
          y,
          z,
          gableWidth,
          height,
          1,
          [0, Math.PI * 0.5, 0],
        );
      }
    }
  }

  const shardSpecs = [
    [3.05, -2.15, 0.22, 0.18, 0.35, 0.9],
    [2.72, -2.28, 0.16, 0.12, -0.4, 0.2],
    [3.38, -1.88, 0.2, 0.14, 0.55, -0.6],
    [-3.05, 2.32, 0.18, 0.11, 0.25, 0.4],
    [3.12, 2.18, 0.14, 0.1, -0.7, 0.15],
  ];
  for (let index = 0; index < shardSpecs.length; index += 1) {
    const [x, z, w, d, rx, rz] = shardSpecs[index];
    const mesh = tagGlass(new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), glass));
    mesh.name = `Fallen glass shard ${index + 1}`;
    mesh.position.set(x, PLINTH_HEIGHT + 0.03, z);
    mesh.rotation.set(rx, hashedUnit(8, index, 0) * Math.PI, rz);
    glassRoot.add(mesh);
  }
}

export function createGardenArchitecture({ materials, mossTexture } = {}) {
  const resolved = resolveMaterials(materials, mossTexture);

  const group = new THREE.Group();
  group.name = "Ruined Victorian greenhouse";

  const opaqueRoot = new THREE.Group();
  opaqueRoot.name = "Greenhouse opaque iron stone and brick";
  group.add(opaqueRoot);

  const glassRoot = new THREE.Group();
  glassRoot.name = "Greenhouse transmissive glazing";
  glassRoot.userData.rtxIgnore = true;
  group.add(glassRoot);

  addPlinth(opaqueRoot, resolved.stone);
  addBrickWall(opaqueRoot, resolved.brick, resolved.stone);
  addCornerPlanters(opaqueRoot, resolved.stone, resolved.moss);
  addMoss(opaqueRoot, resolved.moss);
  addDoorAndSteps(opaqueRoot, resolved.iron, resolved.stone);
  const layout = addIronBays(opaqueRoot, resolved.iron);
  addGlassPanes(glassRoot, resolved.glass, layout);

  return Object.freeze({ group, opaqueRoot, glassRoot });
}
