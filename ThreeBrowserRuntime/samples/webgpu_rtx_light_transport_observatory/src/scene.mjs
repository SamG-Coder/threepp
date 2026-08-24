import * as THREE from "three/webgpu";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  createCarpetMaterial,
  createEmissiveMaterial,
  createGlassMaterial,
  createMetalMaterial,
  createMirrorMaterial,
  createPlasterMaterial,
  createPolishedFloorMaterial,
  createSatinMetalMaterial,
  createVelvetMaterial,
  palette,
} from "./materials.mjs";

function addBox(parent, name, size, position, material, rotation = [0, 0, 0], options = {}) {
  const geometry = options.rounded
    ? new RoundedBoxGeometry(size[0], size[1], size[2], options.segments ?? 3, options.radius ?? 0.08)
    : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, name, radius, height, position, material, rotation = [0, 0, 0], radial = 32) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, radial, 1, false),
    material,
  );
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addLightStrip(parent, name, size, position, material, rotation = [0, 0, 0]) {
  return addBox(parent, name, size, position, material, rotation, {
    rounded: true,
    radius: Math.min(size[0], size[1], size[2]) * 0.28,
    segments: 2,
    castShadow: false,
    receiveShadow: false,
  });
}

function frameMirror(parent, {
  name,
  width,
  height,
  position,
  yaw = 0,
  mirrorMaterial,
  frameMaterial,
}) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  group.rotation.y = yaw;
  parent.add(group);

  const panel = addBox(
    group,
    `${name} optical surface`,
    [width, height, 0.075],
    [0, 0, 0],
    mirrorMaterial,
    [0, 0, 0],
    { castShadow: false, rounded: true, radius: 0.055, segments: 2 },
  );
  panel.userData.isObservatoryMirror = true;

  const frame = 0.16;
  const depth = 0.22;
  addBox(group, `${name} top frame`, [width + frame * 2, frame, depth], [0, height * 0.5 + frame * 0.5, 0.035], frameMaterial, [0, 0, 0], { rounded: true, radius: 0.06 });
  addBox(group, `${name} bottom frame`, [width + frame * 2, frame, depth], [0, -height * 0.5 - frame * 0.5, 0.035], frameMaterial, [0, 0, 0], { rounded: true, radius: 0.06 });
  addBox(group, `${name} left frame`, [frame, height, depth], [-width * 0.5 - frame * 0.5, 0, 0.035], frameMaterial, [0, 0, 0], { rounded: true, radius: 0.06 });
  addBox(group, `${name} right frame`, [frame, height, depth], [width * 0.5 + frame * 0.5, 0, 0.035], frameMaterial, [0, 0, 0], { rounded: true, radius: 0.06 });
  return { group, panel };
}

function createArch(parent, name, x, z, width, height, depth, material, yaw = 0) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, 0, z);
  group.rotation.y = yaw;
  parent.add(group);
  const column = Math.max(0.25, width * 0.11);
  addBox(group, `${name} left pier`, [column, height, depth], [-width * 0.5, height * 0.5, 0], material, [0, 0, 0], { rounded: true, radius: 0.08 });
  addBox(group, `${name} right pier`, [column, height, depth], [width * 0.5, height * 0.5, 0], material, [0, 0, 0], { rounded: true, radius: 0.08 });
  addBox(group, `${name} lintel`, [width + column, column, depth], [0, height - column * 0.5, 0], material, [0, 0, 0], { rounded: true, radius: 0.08 });
  return group;
}

function createRingSculpture(parent, environment, materials) {
  const group = new THREE.Group();
  group.name = "Celestial index sculpture";
  group.position.set(0, 3.25, -1.15);
  parent.add(group);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.18, 4),
    materials.sculpture,
  );
  core.name = "Faceted nickel light atlas core";
  core.scale.set(1, 1.18, 1);
  core.castShadow = true;
  core.receiveShadow = true;
  group.add(core);

  const haloMaterial = createMetalMaterial(0xb17a3f, 0.14, environment);
  const rings = [
    { radius: 2.05, tube: 0.14, rotation: [1.02, 0.1, 0.18] },
    { radius: 1.68, tube: 0.12, rotation: [0.25, 0.72, 1.08] },
    { radius: 1.36, tube: 0.10, rotation: [1.45, -0.42, 0.55] },
  ];
  rings.forEach((ring, index) => {
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(ring.radius, ring.tube, 20, 112),
      haloMaterial,
    );
    mesh.name = `Orbital index ring ${index + 1}`;
    mesh.rotation.set(...ring.rotation);
    mesh.castShadow = true;
    group.add(mesh);
  });

  const emitter = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 36, 24),
    materials.warmEmitter,
  );
  emitter.name = "Atlas heart emitter";
  group.add(emitter);
  return group;
}

function createHiddenGallery({
  parent,
  name,
  center,
  accent,
  wallColor,
  materials,
  environment,
  orientation = 0,
  motif = "fins",
}) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...center);
  group.rotation.y = orientation;
  parent.add(group);

  const wall = createPlasterMaterial(wallColor, 0.72);
  const accentMaterial = createEmissiveMaterial(accent, 4.8, `${name} emissive color field`);
  const metal = createMetalMaterial(accent === palette.cyan ? 0x8cb4bc : 0xb57436, 0.19, environment);

  addBox(group, `${name} floor`, [9.2, 0.22, 9.4], [0, 0.02, 0], materials.hiddenFloor, [0, 0, 0], { receiveShadow: true });
  addBox(group, `${name} rear wall`, [9.2, 7.2, 0.28], [0, 3.6, -4.55], wall);
  addBox(group, `${name} outer wall`, [0.28, 7.2, 9.4], [4.45, 3.6, 0], wall);
  addBox(group, `${name} ceiling`, [9.2, 0.2, 9.4], [0, 7.18, 0], materials.ceiling);
  addLightStrip(group, `${name} vertical light field`, [0.30, 5.6, 0.1], [-3.5, 3.8, -4.35], accentMaterial);
  addLightStrip(group, `${name} horizon light field`, [6.8, 0.30, 0.1], [0.1, 5.9, -4.34], accentMaterial);

  if (motif === "fins") {
    for (let i = -3; i <= 3; ++i) {
      const height = 2.2 + (3 - Math.abs(i)) * 0.38;
      addBox(
        group,
        `${name} bronze fin ${i + 4}`,
        [0.28, height, 1.7],
        [i * 0.78, height * 0.5 + 0.24, -2.75 + Math.abs(i) * 0.12],
        metal,
        [0, i * 0.045, i * 0.025],
        { rounded: true, radius: 0.07 },
      );
    }
  } else {
    for (let x = -2; x <= 2; ++x) {
      for (let y = 0; y < 3; ++y) {
        const orb = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.31 + y * 0.035, 2),
          x === 0 && y === 1 ? accentMaterial : metal,
        );
        orb.name = `${name} suspended prism ${x + 3}-${y + 1}`;
        orb.position.set(x * 0.9, 1.35 + y * 1.0 + Math.abs(x) * 0.12, -2.7);
        orb.rotation.set(0.2 * y, 0.45 * x, 0.18 * (x + y));
        orb.castShadow = true;
        group.add(orb);
      }
    }
  }

  addBox(group, `${name} velvet plinth`, [3.8, 0.55, 1.75], [0, 0.36, -2.7], materials.velvet, [0, 0, 0], { rounded: true, radius: 0.14 });
  return { group, accentMaterial };
}

function addSpot(parent, name, colorValue, intensity, position, targetPosition, angle, distance = 34) {
  const light = new THREE.SpotLight(colorValue, intensity, distance, angle, 0.44, 2);
  light.name = name;
  light.position.set(...position);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -0.00045;
  light.shadow.normalBias = 0.018;
  light.target.position.set(...targetPosition);
  parent.add(light, light.target);
  return light;
}

function addPoint(parent, name, colorValue, intensity, distance, position) {
  const light = new THREE.PointLight(colorValue, intensity, distance, 2);
  light.name = name;
  light.position.set(...position);
  light.castShadow = true;
  light.shadow.mapSize.set(768, 768);
  light.shadow.bias = -0.00035;
  parent.add(light);
  return light;
}

export function buildLightTransportObservatory(scene, environment) {
  const world = new THREE.Group();
  world.name = "Light Transport Observatory";
  scene.add(world);

  const architecture = new THREE.Group();
  architecture.name = "Static observatory architecture";
  world.add(architecture);
  const hiddenWorld = new THREE.Group();
  hiddenWorld.name = "Off-camera transport galleries";
  world.add(hiddenWorld);
  const fixtures = new THREE.Group();
  fixtures.name = "Static emissive fixtures";
  world.add(fixtures);

  const materials = {
    floor: createPolishedFloorMaterial(environment),
    plaster: createPlasterMaterial(palette.plaster, 0.82),
    limestone: createPlasterMaterial(palette.limestone, 0.76),
    graphite: createPlasterMaterial(palette.graphite, 0.7),
    ceiling: createPlasterMaterial(0x10161a, 0.72),
    bronze: createMetalMaterial(palette.bronze, 0.16, environment),
    blackSteel: createMetalMaterial(0x20272b, 0.26, environment),
    mirror: createMirrorMaterial(environment),
    sculpture: createSatinMetalMaterial(environment),
    warmEmitter: createEmissiveMaterial(palette.amber, 6.7, "Central amber emitter"),
    neutralEmitter: createEmissiveMaterial(0xd8f1ff, 3.6, "Neutral ceiling emitter"),
    carpet: createCarpetMaterial(0x17151a),
    velvet: createVelvetMaterial(0x25131c),
    glass: createGlassMaterial(),
    hiddenFloor: createPolishedFloorMaterial(environment),
  };

  addBox(architecture, "Basalt reflection floor", [25.6, 0.22, 32.2], [0, -0.11, 0], materials.floor, [0, 0, 0], { receiveShadow: true });
  addBox(architecture, "Recessed gallery runner", [3.1, 0.045, 20.5], [0, 0.04, 3.0], materials.carpet, [0, 0, 0], { rounded: true, radius: 0.09, receiveShadow: true });
  addBox(architecture, "Back mineral wall", [25.6, 8.6, 0.35], [0, 4.3, -14.1], materials.plaster);
  addBox(architecture, "Left front wall", [0.34, 8.6, 8.2], [-12.65, 4.3, 9.9], materials.graphite);
  addBox(architecture, "Left rear wall", [0.34, 8.6, 8.2], [-12.65, 4.3, -9.9], materials.graphite);
  addBox(architecture, "Right front wall", [0.34, 8.6, 8.2], [12.65, 4.3, 9.9], materials.graphite);
  addBox(architecture, "Right rear wall", [0.34, 8.6, 8.2], [12.65, 4.3, -9.9], materials.graphite);
  addBox(architecture, "Observatory ceiling", [25.6, 0.25, 32.2], [0, 8.5, 0], materials.ceiling, [0, 0, 0], { castShadow: false });

  // Portal openings in the side walls keep the hidden rooms physically
  // reachable to ray queries while remaining outside the camera frustum.
  createArch(architecture, "Left transport portal", -12.6, 0, 5.4, 7.2, 0.34, materials.bronze, Math.PI * 0.5);
  createArch(architecture, "Right transport portal", 12.6, 0, 5.4, 7.2, 0.34, materials.bronze, Math.PI * 0.5);

  for (let z = -11.8; z <= 11.8; z += 4.72) {
    addBox(architecture, `Ceiling rib ${z.toFixed(2)}`, [25.2, 0.26, 0.22], [0, 8.12, z], materials.blackSteel, [0, 0, 0], { rounded: true, radius: 0.06 });
  }
  for (let x = -9.6; x <= 9.6; x += 4.8) {
    addLightStrip(fixtures, `Ceiling light ${x.toFixed(1)}`, [0.42, 0.10, 15.8], [x, 8.0, 0.2], materials.neutralEmitter);
  }

  const heroMirror = frameMirror(architecture, {
    name: "Hero recursion mirror",
    width: 8.15,
    height: 6.4,
    position: [0, 4.25, -13.66],
    yaw: 0,
    mirrorMaterial: materials.mirror,
    frameMaterial: materials.bronze,
  });
  const leftFold = frameMirror(architecture, {
    name: "Left folded mirror",
    width: 4.1,
    height: 5.55,
    position: [-9.15, 3.45, -5.2],
    yaw: THREE.MathUtils.degToRad(35),
    mirrorMaterial: materials.mirror,
    frameMaterial: materials.blackSteel,
  });
  const rightFold = frameMirror(architecture, {
    name: "Right folded mirror",
    width: 4.1,
    height: 5.55,
    position: [9.15, 3.45, -5.2],
    yaw: THREE.MathUtils.degToRad(-35),
    mirrorMaterial: materials.mirror,
    frameMaterial: materials.blackSteel,
  });
  const rearLeft = frameMirror(architecture, {
    name: "Rear left relay mirror",
    width: 3.6,
    height: 5.2,
    position: [-2.55, 3.3, 13.55],
    yaw: Math.PI + THREE.MathUtils.degToRad(27),
    mirrorMaterial: materials.mirror,
    frameMaterial: materials.bronze,
  });
  const rearRight = frameMirror(architecture, {
    name: "Rear right relay mirror",
    width: 3.6,
    height: 5.2,
    position: [2.55, 3.3, 13.55],
    yaw: Math.PI - THREE.MathUtils.degToRad(27),
    mirrorMaterial: materials.mirror,
    frameMaterial: materials.bronze,
  });

  const plinth = addBox(architecture, "Travertine sculpture plinth", [5.4, 0.52, 5.4], [0, 0.26, -1.15], materials.limestone, [0, 0, 0], { rounded: true, radius: 0.2 });
  const innerPlinth = addCylinder(architecture, "Bronze plinth collar", 1.9, 0.32, [0, 0.66, -1.15], materials.bronze, [0, 0, 0], 64);
  const sculpture = createRingSculpture(architecture, environment, materials);

  const amberGallery = createHiddenGallery({
    parent: hiddenWorld,
    name: "Off-camera amber archive",
    center: [17.6, 0, 5.0],
    accent: palette.amber,
    wallColor: 0x5b3022,
    materials,
    environment,
    orientation: -Math.PI * 0.5,
    motif: "fins",
  });
  const cyanGallery = createHiddenGallery({
    parent: hiddenWorld,
    name: "Off-camera cyan archive",
    center: [-17.6, 0, 4.3],
    accent: palette.cyan,
    wallColor: 0x17334b,
    materials,
    environment,
    orientation: Math.PI * 0.5,
    motif: "prisms",
  });

  const shrine = new THREE.Group();
  shrine.name = "Vermilion tertiary shrine";
  shrine.position.set(15.8, 0, -8.3);
  shrine.rotation.y = -Math.PI * 0.5;
  hiddenWorld.add(shrine);
  const shrineWall = createPlasterMaterial(0x3e1720, 0.74);
  const shrineEmitter = createEmissiveMaterial(palette.crimson, 6.5, "Vermilion shrine emitter");
  addBox(shrine, "Shrine wall", [6.2, 6.4, 0.25], [0, 3.2, -2.8], shrineWall);
  addLightStrip(shrine, "Shrine vertical cut", [0.34, 4.8, 0.1], [0, 3.3, -2.64], shrineEmitter);
  addBox(shrine, "Shrine black altar", [3.4, 0.72, 1.7], [0, 0.4, -1.9], materials.blackSteel, [0, 0, 0], { rounded: true, radius: 0.13 });

  // Decorative glazing defines the physical portals in raster space but is
  // intentionally omitted from the static TLAS, allowing native visibility
  // and reflection rays to cross it while the bronze mullions still occlude.
  addBox(architecture, "Left portal glazing", [0.035, 5.7, 4.5], [-12.43, 3.2, 0], materials.glass, [0, 0, 0], { castShadow: false });
  addBox(architecture, "Right portal glazing", [0.035, 5.7, 4.5], [12.43, 3.2, 0], materials.glass, [0, 0, 0], { castShadow: false });

  const lightSculpture = addPoint(world, "Atlas heart light", palette.amber, 98, 14, [0, 3.3, -1.15]);
  const sculptureSpot = addSpot(world, "Sculpture crown spot", 0xffd6a0, 165, [0, 7.7, 1.2], [0, 2.8, -1.15], 0.46, 24);
  const heroSpot = addSpot(world, "Hero mirror wash", 0xdaf3ff, 118, [0, 7.5, -9.1], [0, 3.1, -13.4], 0.56, 20);
  const amberPoint = addPoint(world, "Amber archive light", palette.amber, 130, 18, [17.0, 3.6, 4.1]);
  const amberSpot = addSpot(world, "Amber archive grazer", 0xffc276, 190, [17.5, 6.2, 7.1], [17.4, 1.8, 2.0], 0.45, 20);
  const cyanPoint = addPoint(world, "Cyan archive light", palette.cyan, 118, 18, [-17.0, 3.6, 3.8]);
  const cyanSpot = addSpot(world, "Cyan archive grazer", 0x84e6ff, 178, [-17.5, 6.1, 6.8], [-17.2, 1.8, 1.6], 0.45, 20);
  const shrineSpot = addSpot(world, "Vermilion shrine light", palette.crimson, 155, [15.2, 5.4, -8.1], [15.5, 1.6, -10.3], 0.42, 17);

  const fill = new THREE.HemisphereLight(0x9fb9c8, 0x090b0d, 0.42);
  fill.name = "Low museum ambient fill";
  world.add(fill);

  const sun = new THREE.DirectionalLight(0xbfd9e8, 1.35);
  sun.name = "Observatory daylight slot";
  sun.position.set(-16, 19, 11);
  sun.target.position.set(0, 1, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 55;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.018;
  world.add(sun, sun.target);

  return {
    world,
    architecture,
    hiddenWorld,
    fixtures,
    materials,
    mirrors: [heroMirror, leftFold, rightFold, rearLeft, rearRight],
    sculpture,
    staticRoots: [architecture, hiddenWorld, fixtures],
    staticLights: [
      lightSculpture,
      sculptureSpot,
      heroSpot,
      amberPoint,
      amberSpot,
      cyanPoint,
      cyanSpot,
      shrineSpot,
    ],
    sun,
    // The registered scene is intentionally immutable. Reflections therefore
    // remain spatially stable without an animated particle layer masquerading
    // as ray noise.
    update() {},
  };
}
