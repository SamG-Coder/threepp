import * as THREE from "three/webgpu";
import {
  createChromeMaterial,
  createEmissiveMaterial,
  createLeafMaterial,
  createMetalMaterial,
  createPoolBasinMaterial,
  createPoolWaterMaterial,
  createReflectiveGlassMaterial,
  createSideGlassMaterial,
  createSkyMaterial,
  createStoneMaterial,
  createWetFloorMaterial,
  palette,
  rasterReflectionStrength,
} from "./materials.mjs";

function seededRandom(seed = 0x6d69646e) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function setShadow(object, cast = true, receive = true) {
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
}

function createFloorShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-14, -10);
  shape.lineTo(-14, 10);
  shape.lineTo(14, 10);
  shape.lineTo(14, -10);
  shape.closePath();

  const pool = new THREE.Path();
  pool.moveTo(-6.8, -3.15);
  pool.lineTo(5.2, -3.15);
  pool.lineTo(5.2, 3.15);
  pool.lineTo(-6.8, 3.15);
  pool.closePath();
  shape.holes.push(pool);
  return shape;
}

function addPool(scene, reflectors, reflectionSurfaces) {
  const poolGroup = new THREE.Group();
  poolGroup.name = "Shallow indoor pool";

  const floorMaterial = createPoolBasinMaterial();
  const poolFloor = setShadow(new THREE.Mesh(
    new THREE.PlaneGeometry(11.82, 6.12, 28, 14),
    floorMaterial,
  ), false, true);
  poolFloor.rotation.x = -Math.PI * 0.5;
  poolFloor.position.set(-0.8, -0.49, 0);
  poolGroup.add(poolFloor);

  const wallMaterial = createStoneMaterial(0x121b20, 0.58);
  const walls = [
    [-6.86, -0.24, 0, 0.16, 0.5, 6.4],
    [5.26, -0.24, 0, 0.16, 0.5, 6.4],
    [-0.8, -0.24, -3.22, 12.2, 0.5, 0.16],
    [-0.8, -0.24, 3.22, 12.2, 0.5, 0.16],
  ];
  for (const [x, y, z, sx, sy, sz] of walls) {
    const wall = setShadow(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMaterial));
    wall.position.set(x, y, z);
    poolGroup.add(wall);
  }

  const stripMaterial = createEmissiveMaterial(palette.amber, 3.8);
  for (const z of [-2.91, 2.91]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.018, 0.035), stripMaterial);
    strip.position.set(-0.8, -0.43, z);
    poolGroup.add(strip);
  }
  for (const x of [-6.54, 4.94]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.018, 5.78), stripMaterial);
    strip.position.set(x, -0.43, 0);
    poolGroup.add(strip);
  }

  // Submerged steps and a slim stainless handrail give the water a readable
  // scale and supply clean silhouettes for both planar and native reflections.
  const stepMaterial = createStoneMaterial(0x23383d, 0.38);
  for (let index = 0; index < 3; ++index) {
    const step = setShadow(new THREE.Mesh(
      new THREE.BoxGeometry(1.7 + index * 0.46, 0.12, 0.42),
      stepMaterial,
    ));
    step.position.set(-5.88 + index * 0.12, -0.34 + index * 0.11, 1.62 - index * 0.38);
    poolGroup.add(step);
  }
  const railMaterial = createMetalMaterial(0xa7b5ba, 0.16, 0.92);
  for (const z of [1.45, 2.42]) {
    const upright = setShadow(new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 1.15, 12),
      railMaterial,
    ));
    upright.position.set(-5.85, 0.24, z);
    poolGroup.add(upright);
  }
  const railTop = setShadow(new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 0.98, 12),
    railMaterial,
  ));
  railTop.rotation.x = Math.PI * 0.5;
  railTop.position.set(-5.85, 0.78, 1.94);
  poolGroup.add(railTop);

  const { material, nativeMaterial, reflection } = createPoolWaterMaterial();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(11.7, 6.0, 72, 36), material);
  water.name = "Planar pool reflection";
  water.rotation.x = -Math.PI * 0.5;
  water.position.set(-0.8, 0.035, 0);
  water.renderOrder = 8;
  water.add(reflection.target);
  poolGroup.add(water);
  reflectors.push(reflection);
  reflectionSurfaces.push({ mesh: water, rasterMaterial: material, nativeMaterial });

  scene.add(poolGroup);
  return { poolGroup, water };
}

function addArchitecture(scene, reflectors, reflectionSurfaces) {
  const architecture = new THREE.Group();
  architecture.name = "Glasshouse architecture";

  const {
    material: wetMaterial,
    nativeMaterial: nativeWetMaterial,
    reflection: floorReflection,
  } = createWetFloorMaterial();
  const floor = setShadow(new THREE.Mesh(new THREE.ShapeGeometry(createFloorShape(), 24), wetMaterial), false, true);
  floor.name = "Wet charcoal floor reflection";
  floor.rotation.x = -Math.PI * 0.5;
  floor.position.y = 0;
  floor.add(floorReflection.target);
  architecture.add(floor);
  reflectors.push(floorReflection);
  reflectionSurfaces.push({
    mesh: floor,
    rasterMaterial: wetMaterial,
    nativeMaterial: nativeWetMaterial,
  });

  const structuralMetal = createMetalMaterial(0x20282c, 0.23, 0.88);
  const bronze = createMetalMaterial(0x8c673f, 0.24, 0.84);
  const columnGeometry = new THREE.BoxGeometry(0.22, 7.5, 0.22);
  const columnPositions = [
    [-13.65, 3.75, -9.55], [13.65, 3.75, -9.55],
    [-13.65, 3.75, 9.55], [13.65, 3.75, 9.55],
  ];
  for (const [x, y, z] of columnPositions) {
    const column = setShadow(new THREE.Mesh(columnGeometry, structuralMetal));
    column.position.set(x, y, z);
    architecture.add(column);
  }

  for (const x of [-10.3, -6.85, -3.42, 0, 3.42, 6.85, 10.3]) {
    const mullion = setShadow(new THREE.Mesh(new THREE.BoxGeometry(0.105, 7.25, 0.12), structuralMetal));
    mullion.position.set(x, 3.7, -9.52);
    architecture.add(mullion);
  }
  for (const y of [0.12, 3.72, 7.3]) {
    const transom = setShadow(new THREE.Mesh(new THREE.BoxGeometry(27.5, 0.105, 0.12), structuralMetal));
    transom.position.set(0, y, -9.52);
    architecture.add(transom);
  }

  const {
    material: rearGlassMaterial,
    nativeMaterial: nativeRearGlassMaterial,
    reflection: rearReflection,
  } = createReflectiveGlassMaterial();
  const rearGlass = new THREE.Mesh(new THREE.PlaneGeometry(27.25, 7.15), rearGlassMaterial);
  rearGlass.name = "Rear structural-glass reflection";
  rearGlass.userData.rtxIgnore = true;
  rearGlass.position.set(0, 3.72, -9.59);
  rearGlass.renderOrder = 6;
  rearGlass.add(rearReflection.target);
  architecture.add(rearGlass);
  reflectors.push(rearReflection);
  reflectionSurfaces.push({
    mesh: rearGlass,
    rasterMaterial: rearGlassMaterial,
    nativeMaterial: nativeRearGlassMaterial,
  });

  const sideGlassMaterial = createSideGlassMaterial();
  for (const side of [-1, 1]) {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(19.0, 7.15), sideGlassMaterial);
    glass.name = side < 0 ? "West glass wall" : "East glass wall";
    glass.userData.rtxIgnore = true;
    glass.position.set(side * 13.72, 3.72, 0);
    glass.rotation.y = side * Math.PI * 0.5;
    glass.renderOrder = 5;
    architecture.add(glass);

    for (const z of [-7.2, -3.6, 0, 3.6, 7.2]) {
      const mullion = setShadow(new THREE.Mesh(new THREE.BoxGeometry(0.12, 7.25, 0.105), structuralMetal));
      mullion.position.set(side * 13.67, 3.7, z);
      architecture.add(mullion);
    }
  }

  const roofBeamGeometry = new THREE.BoxGeometry(0.18, 0.24, 19.3);
  for (let index = 0; index < 12; ++index) {
    const beam = setShadow(new THREE.Mesh(roofBeamGeometry, index % 4 === 0 ? bronze : structuralMetal));
    beam.position.set(-12.65 + index * 2.3, 7.42, 0);
    architecture.add(beam);
  }
  for (const z of [-9.55, 0, 9.55]) {
    const beam = setShadow(new THREE.Mesh(new THREE.BoxGeometry(27.5, 0.24, 0.18), structuralMetal));
    beam.position.set(0, 7.42, z);
    architecture.add(beam);
  }

  const frontLintel = setShadow(new THREE.Mesh(new THREE.BoxGeometry(27.5, 0.28, 0.3), bronze));
  frontLintel.position.set(0, 7.15, 9.55);
  architecture.add(frontLintel);

  scene.add(architecture);
  return { architecture, floor, rearGlass };
}

function addSculpture(scene, environment) {
  const group = new THREE.Group();
  group.name = "Chrome kinetic rain mobile";
  group.position.set(0.9, 3.42, -0.15);

  const chromeSharp = createChromeMaterial(environment, 0.045);
  const chromeSoft = createChromeMaterial(environment, 0.14);
  const chromeBrushed = createChromeMaterial(environment, 0.25);
  const rings = [];

  const ringSpecs = [
    [1.92, 0.085, chromeSharp, [1.15, 0.12, 0.30], 0.19],
    [1.48, 0.095, chromeSoft, [0.22, 0.74, 0.92], -0.27],
    [1.08, 0.075, chromeBrushed, [0.83, -0.24, 0.44], 0.38],
  ];
  for (const [radius, tube, material, rotation, speed] of ringSpecs) {
    const ring = setShadow(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 24, 144), material));
    ring.rotation.set(...rotation);
    group.add(ring);
    rings.push({ mesh: ring, base: rotation, speed });
  }

  const core = setShadow(new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.62, 0.105, 180, 24, 2, 3),
    chromeSharp,
  ));
  core.rotation.set(0.4, -0.2, 0.1);
  group.add(core);

  const amberRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.79, 0.024, 12, 120),
    createEmissiveMaterial(palette.amber, 6.2),
  );
  amberRing.rotation.set(Math.PI * 0.5, 0.25, 0.1);
  group.add(amberRing);

  const cableMaterial = createMetalMaterial(0x67757b, 0.2, 1);
  const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.18, 10), cableMaterial);
  cable.position.y = 2.98;
  group.add(cable);

  const ceilingCap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.12, 28), chromeSoft);
  ceilingCap.position.y = 4.0;
  group.add(ceilingCap);

  scene.add(group);
  return {
    group,
    rings,
    core,
    amberRing,
    update(time) {
      for (let index = 0; index < rings.length; ++index) {
        const entry = rings[index];
        entry.mesh.rotation.x = entry.base[0] + Math.sin(time * 0.21 + index) * 0.17;
        entry.mesh.rotation.y = entry.base[1] + time * entry.speed;
        entry.mesh.rotation.z = entry.base[2] + Math.cos(time * 0.17 + index * 0.7) * 0.12;
      }
      core.rotation.y = -time * 0.22;
      core.rotation.z = Math.sin(time * 0.28) * 0.22;
      amberRing.rotation.z = time * 0.16;
    },
  };
}

function createLeafGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    -0.16, 0.38, 0.025,
    -0.10, 0.76, 0.07,
    0, 1.04, 0.11,
    0.10, 0.76, 0.07,
    0.16, 0.38, 0.025,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0.5, 0, 0, 0.38, 0.18, 0.73, 0.5, 1, 0.82, 0.73, 1, 0.38,
  ], 2));
  geometry.setIndex([0, 1, 5, 1, 2, 5, 2, 4, 5, 2, 3, 4]);
  geometry.computeVertexNormals();
  return geometry;
}

function addFoliage(scene) {
  const random = seededRandom(0x70616c6d);
  const leafGeometry = createLeafGeometry();
  const planterMaterial = createStoneMaterial(0x161c1e, 0.72);
  const leafMaterials = [
    createLeafMaterial(0x153d32),
    createLeafMaterial(0x224c3b),
    createLeafMaterial(0x18372f),
  ];
  const placements = [
    [-10.8, -6.6, 1.15],
    [10.7, -6.4, 0.92],
    [-10.9, 6.15, 0.82],
    [10.65, 5.65, 1.05],
  ];
  const clusters = [];

  for (let clusterIndex = 0; clusterIndex < placements.length; ++clusterIndex) {
    const [x, z, scale] = placements[clusterIndex];
    const cluster = new THREE.Group();
    cluster.position.set(x, 0, z);

    const planter = setShadow(new THREE.Mesh(
      new THREE.BoxGeometry(2.05, 0.62, 1.15),
      planterMaterial,
    ));
    planter.position.y = 0.31;
    cluster.add(planter);

    const count = 38;
    const leaves = new THREE.InstancedMesh(
      leafGeometry,
      leafMaterials[clusterIndex % leafMaterials.length],
      count,
    );
    const dummy = new THREE.Object3D();
    for (let index = 0; index < count; ++index) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 0.64;
      dummy.position.set(Math.cos(angle) * radius, 0.59, Math.sin(angle) * radius * 0.62);
      dummy.rotation.set(
        (random() - 0.5) * 0.38,
        angle + (random() - 0.5) * 0.6,
        (random() - 0.5) * 0.56,
      );
      const leafScale = scale * (0.62 + random() * 0.82);
      dummy.scale.set(leafScale * (0.72 + random() * 0.35), leafScale, leafScale);
      dummy.updateMatrix();
      leaves.setMatrixAt(index, dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    leaves.castShadow = true;
    leaves.receiveShadow = true;
    cluster.add(leaves);
    scene.add(cluster);
    clusters.push({ group: cluster, phase: random() * Math.PI * 2 });
  }

  return {
    clusters,
    update(time) {
      for (const cluster of clusters) {
        cluster.group.rotation.z = Math.sin(time * 0.42 + cluster.phase) * 0.006;
        cluster.group.rotation.x = Math.cos(time * 0.37 + cluster.phase) * 0.004;
      }
    },
  };
}

function addExterior(scene) {
  const random = seededRandom(0x63697479);
  const exterior = new THREE.Group();
  exterior.name = "Rainy exterior city";

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(55, 15),
    new THREE.MeshPhysicalNodeMaterial({
      color: 0x070b0e,
      roughness: 0.19,
      metalness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    }),
  );
  road.rotation.x = -Math.PI * 0.5;
  road.position.set(0, -0.055, -16.6);
  road.receiveShadow = true;
  exterior.add(road);

  const buildingMaterials = [
    createStoneMaterial(0x071019, 0.66),
    createStoneMaterial(0x0b151c, 0.62),
    createStoneMaterial(0x111a20, 0.58),
  ];
  const buildings = [];
  for (let index = 0; index < 22; ++index) {
    const width = 2.4 + random() * 4.2;
    const height = 5 + random() * 14;
    const depth = 2.8 + random() * 5;
    const building = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      buildingMaterials[index % buildingMaterials.length],
    );
    building.position.set(
      -30 + index * 2.9 + random() * 1.2,
      height * 0.5 - 0.1,
      -27 - random() * 10,
    );
    exterior.add(building);
    buildings.push({ index, width, height, depth, position: building.position.clone() });
  }

  // A distant, lower-contrast skyline establishes three distinct depth bands
  // through the glass: wet boulevard, occupied facades, and moonlit towers.
  // The deterministic rhythm is architectural rather than a scatter cloud.
  const skylineMaterial = createStoneMaterial(0x04090d, 0.82);
  for (let index = 0; index < 16; ++index) {
    const width = 2.8 + random() * 3.8;
    const height = 8 + random() * 19;
    const tower = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 3.2 + random() * 2.6),
      skylineMaterial,
    );
    tower.name = "Distant skyline silhouette";
    tower.position.set(-35 + index * 4.6, height * 0.5 - 0.2, -45 - random() * 7);
    exterior.add(tower);
  }

  const pavementMaterial = createStoneMaterial(0x11181b, 0.34);
  const curbMaterial = createStoneMaterial(0x4c5658, 0.68);
  for (const z of [-9.72, -23.52]) {
    const pavement = setShadow(new THREE.Mesh(
      new THREE.BoxGeometry(55, 0.10, 1.05),
      pavementMaterial,
    ), false, true);
    pavement.position.set(0, 0.005, z);
    exterior.add(pavement);

    const curb = setShadow(new THREE.Mesh(
      new THREE.BoxGeometry(55, 0.18, 0.16),
      curbMaterial,
    ), false, true);
    curb.position.set(0, 0.055, z + (z < -16 ? 0.53 : -0.53));
    exterior.add(curb);
  }

  const laneMaterial = createEmissiveMaterial(0xa2a9a3, 0.16);
  for (let x = -24; x <= 24; x += 4.8) {
    const marker = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.018, 0.085), laneMaterial);
    marker.name = "Rain-softened lane marking";
    marker.position.set(x, 0.012, -16.58);
    exterior.add(marker);
  }

  // Repeating street lamps make the wet road and its depth legible. They are
  // emissive reflection sources, not extra realtime lights, so the native
  // eight-light budget remains reserved for physically important fixtures.
  const streetMetal = createMetalMaterial(0x273238, 0.31, 0.9);
  const streetGlow = createEmissiveMaterial(0xffc078, 5.2);
  const poleGeometry = new THREE.CylinderGeometry(0.055, 0.075, 4.4, 12);
  const armGeometry = new THREE.CylinderGeometry(0.035, 0.035, 1.15, 10);
  const shadeGeometry = new THREE.CylinderGeometry(0.23, 0.12, 0.18, 18);
  const glowGeometry = new THREE.SphereGeometry(0.105, 14, 9);
  for (const z of [-11.4, -22.15]) {
    for (const x of [-11.5, -4.0, 3.5, 11.0]) {
      const pole = setShadow(new THREE.Mesh(poleGeometry, streetMetal));
      pole.position.set(x, 2.2, z);
      exterior.add(pole);

      const arm = setShadow(new THREE.Mesh(armGeometry, streetMetal));
      arm.rotation.z = Math.PI * 0.5;
      arm.position.set(x + (z < -16 ? -0.48 : 0.48), 4.25, z);
      exterior.add(arm);

      const direction = z < -16 ? -1 : 1;
      const shade = setShadow(new THREE.Mesh(shadeGeometry, streetMetal));
      shade.position.set(x + direction * 0.96, 4.17, z);
      exterior.add(shade);
      const bulb = new THREE.Mesh(glowGeometry, streetGlow);
      bulb.name = "Warm boulevard luminaire";
      bulb.position.set(x + direction * 0.96, 4.09, z);
      exterior.add(bulb);
    }
  }

  // Four restrained shopfronts form a continuous lower facade beyond the
  // road. Their warm/cool alternation is intentional, giving chrome and wet
  // stone a controlled complementary reflection palette.
  const shopShell = createStoneMaterial(0x10171a, 0.48);
  const shopGlass = createMetalMaterial(0x142b35, 0.16, 0.18);
  const shopWarm = createEmissiveMaterial(0xffbd73, 1.25);
  const shopCool = createEmissiveMaterial(0x74aac1, 0.68);
  for (let index = 0; index < 4; ++index) {
    const x = -10.8 + index * 7.2;
    const shell = setShadow(new THREE.Mesh(new THREE.BoxGeometry(5.6, 2.7, 2.2), shopShell));
    shell.position.set(x, 1.35, -25.5);
    exterior.add(shell);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 1.72), shopGlass);
    front.position.set(x, 1.28, -24.385);
    exterior.add(front);
    const canopy = setShadow(new THREE.Mesh(new THREE.BoxGeometry(5.05, 0.13, 0.72), streetMetal));
    canopy.position.set(x, 2.45, -23.98);
    exterior.add(canopy);
    const reveal = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 0.13),
      index % 2 === 0 ? shopWarm : shopCool,
    );
    reveal.name = "Shopfront reflected-light reveal";
    reveal.position.set(x, 2.2, -24.37);
    exterior.add(reveal);
  }

  // Keep every illuminated pane on a real facade. The former random cloud of
  // horizontal planes read as floating strips and produced the same artifact
  // in the wet-floor and glass reflections.
  const windowGeometry = new THREE.PlaneGeometry(0.38, 0.46);
  const windowMaterials = [
    createEmissiveMaterial(0xffbd73, 1.65),
    createEmissiveMaterial(0x76a9c2, 0.95),
  ];
  const windowTransforms = [[], []];
  const beamCandidates = [];
  const dummy = new THREE.Object3D();

  for (const building of buildings) {
    const columns = THREE.MathUtils.clamp(
      Math.floor((building.width - 0.42) / 0.78),
      2,
      7,
    );
    const rows = THREE.MathUtils.clamp(
      Math.floor((building.height - 1.2) / 0.88),
      4,
      18,
    );
    const facadeZ = building.position.z + building.depth * 0.5 + 0.026;
    const usableWidth = Math.max(0.72, building.width - 0.72);
    const usableHeight = Math.max(2.4, building.height - 1.45);

    for (let row = 0; row < rows; ++row) {
      for (let column = 0; column < columns; ++column) {
        // A sparse occupancy pattern retains the midnight skyline while the
        // regular grid makes the emitting aperture unambiguous.
        if (random() > 0.085) continue;
        const x = building.position.x + (
          columns === 1 ? 0 : (column / (columns - 1) - 0.5) * usableWidth
        );
        const y = 0.78 + (row / Math.max(1, rows - 1)) * usableHeight;
        const band = random() < 0.68 ? 0 : 1;
        windowTransforms[band].push({ x, y, z: facadeZ });

        if (band === 0 && Math.abs(x) < 12 && y > 2 && y < 6.8) {
          beamCandidates.push({
            buildingIndex: building.index,
            color: 0xffbd73,
            position: new THREE.Vector3(x, y, facadeZ + 0.035),
          });
        }
      }
    }
  }

  for (let band = 0; band < 2; ++band) {
    const transforms = windowTransforms[band];
    const windows = new THREE.InstancedMesh(
      windowGeometry,
      windowMaterials[band],
      transforms.length,
    );
    windows.name = band === 0
      ? "Warm facade window apertures"
      : "Cool facade window apertures";
    for (let index = 0; index < transforms.length; ++index) {
      const transform = transforms[index];
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      windows.setMatrixAt(index, dummy.matrix);
    }
    windows.instanceMatrix.needsUpdate = true;
    exterior.add(windows);
  }

  // Pick three visible warm panes on separate buildings. Their spotlights are
  // added by addLights so that actual light crosses the rear glazing; the pane
  // geometry remains the visible emitter and reflection source.
  const lightPortals = [];
  const usedBuildings = new Set();
  for (const targetX of [-7, 0, 7]) {
    let best = null;
    let bestScore = Infinity;
    for (const candidate of beamCandidates) {
      if (usedBuildings.has(candidate.buildingIndex)) continue;
      const score = Math.abs(candidate.position.x - targetX)
        + Math.abs(candidate.position.y - 4.2) * 0.18
        + Math.max(0, -candidate.position.z - 23) * 0.045;
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best) {
      usedBuildings.add(best.buildingIndex);
      lightPortals.push(best);
    }
  }

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 30, 20),
    new THREE.MeshBasicNodeMaterial({ color: 0x8eb6c6, fog: false }),
  );
  moon.position.set(-12, 15.5, -43);
  exterior.add(moon);

  scene.add(exterior);
  return { group: exterior, lightPortals };
}

function addRain(scene, count = 2400) {
  const random = seededRandom(0x7261696e);
  const positions = new Float32Array(count * 6);
  const drops = [];
  for (let index = 0; index < count; ++index) {
    drops.push({
      x: (random() * 2 - 1) * 19,
      y: random() * 14,
      z: -9.9 - random() * 23,
      length: 0.18 + random() * 0.82,
      speed: 7.5 + random() * 10.5,
      drift: 0.26 + random() * 0.28,
    });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicNodeMaterial({
    color: palette.rain,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const rain = new THREE.LineSegments(geometry, material);
  rain.name = "Cool exterior rain";
  rain.frustumCulled = false;
  rain.renderOrder = 4;
  scene.add(rain);

  function writePositions() {
    for (let index = 0; index < drops.length; ++index) {
      const drop = drops[index];
      const offset = index * 6;
      positions[offset] = drop.x;
      positions[offset + 1] = drop.y;
      positions[offset + 2] = drop.z;
      positions[offset + 3] = drop.x + drop.length * drop.drift;
      positions[offset + 4] = drop.y - drop.length;
      positions[offset + 5] = drop.z + drop.length * 0.18;
    }
    geometry.attributes.position.needsUpdate = true;
  }
  writePositions();

  return {
    object: rain,
    update(delta) {
      for (const drop of drops) {
        drop.y -= drop.speed * delta;
        drop.x += delta * drop.drift;
        if (drop.y < -0.4) {
          drop.y += 14.8;
          drop.x = (random() * 2 - 1) * 19;
          drop.z = -9.9 - random() * 23;
        }
      }
      writePositions();
    },
  };
}

function addVehicle(scene) {
  const car = new THREE.Group();
  car.name = "Passing electric coupe";
  car.position.set(-20, 0.02, -13.4);

  const paint = new THREE.MeshPhysicalNodeMaterial({
    color: 0x18272e,
    metalness: 0.72,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
    envMapIntensity: 2.1,
  });
  const glass = createSideGlassMaterial();
  const rubber = createStoneMaterial(0x030405, 0.88);
  const body = setShadow(new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.58, 1.24), paint));
  body.position.y = 0.62;
  car.add(body);
  const cabin = setShadow(new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.56, 1.06), glass));
  cabin.position.set(-0.18, 1.13, 0);
  car.add(cabin);

  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.18, 24);
  for (const x of [-0.98, 0.98]) {
    for (const z of [-0.63, 0.63]) {
      const wheel = new THREE.Mesh(wheelGeometry, rubber);
      wheel.rotation.x = Math.PI * 0.5;
      wheel.position.set(x, 0.35, z);
      car.add(wheel);
    }
  }

  const headlightMaterial = createEmissiveMaterial(0xdff5ff, 7.2);
  const tailMaterial = createEmissiveMaterial(0xff4938, 5.6);
  for (const z of [-0.38, 0.38]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.14, 0.22), headlightMaterial);
    headlight.position.set(1.56, 0.7, z);
    car.add(headlight);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.12, 0.24), tailMaterial);
    tail.position.set(-1.56, 0.68, z);
    car.add(tail);
  }

  scene.add(car);
  return {
    group: car,
    update(time) {
      const travel = ((time * 2.9) % 48) - 24;
      car.position.x = travel;
      car.position.z = -13.35 + Math.sin(time * 0.31) * 0.08;
    },
  };
}

function addLights(scene, lightPortals = []) {
  const moon = new THREE.DirectionalLight(0x9dc9df, 1.85);
  moon.position.set(-8, 15, 8);
  moon.target.position.set(0, 0, -2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -18;
  moon.shadow.camera.right = 18;
  moon.shadow.camera.top = 14;
  moon.shadow.camera.bottom = -14;
  moon.shadow.camera.near = 0.5;
  moon.shadow.camera.far = 55;
  moon.shadow.bias = -0.0002;
  moon.shadow.normalBias = 0.018;
  scene.add(moon, moon.target);

  scene.add(new THREE.HemisphereLight(0x668fa4, 0x111619, 0.78));
  scene.add(new THREE.AmbientLight(0x57717d, 0.17));

  const fixtures = [];
  const fixtureGeometry = [];
  const fixtureHousingMaterial = createMetalMaterial(0x11181c, 0.38, 0.82);
  const fixtureDiffuserMaterial = createEmissiveMaterial(palette.warm, 2.7);
  const fixtureHousingGeometry = new THREE.CylinderGeometry(0.31, 0.31, 0.12, 24);
  const fixtureDiffuserGeometry = new THREE.CircleGeometry(0.23, 24);
  const fixtureBaffleGeometry = new THREE.TorusGeometry(0.255, 0.024, 10, 32);
  for (const x of [-8.05, -3.45, 3.45, 8.05]) {
    // Spot fixtures make broad warm pools without depending on RectAreaLight
    // LTC lookup textures, which are absent in the lean native Runtime build.
    const light = new THREE.SpotLight(palette.amber, 18, 15, 0.72, 0.92, 1.4);
    light.position.set(x, 7.04, 1.8);
    light.target.position.set(x, 0, 0.5);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 15;
    light.shadow.bias = -0.00018;
    light.shadow.normalBias = 0.016;
    scene.add(light, light.target);
    fixtures.push(light);

    const housing = new THREE.Mesh(
      fixtureHousingGeometry,
      fixtureHousingMaterial,
    );
    housing.name = "Roof-mounted luminaire housing";
    housing.position.set(x, 7.225, 1.8);
    scene.add(housing);

    const visible = new THREE.Mesh(
      fixtureDiffuserGeometry,
      fixtureDiffuserMaterial,
    );
    visible.name = "Recessed warm luminaire diffuser";
    visible.position.set(x, 7.164, 1.8);
    visible.rotation.x = Math.PI * 0.5;
    scene.add(visible);
    fixtureGeometry.push(visible);

    const baffle = new THREE.Mesh(fixtureBaffleGeometry, fixtureHousingMaterial);
    baffle.name = "Anti-glare luminaire baffle";
    baffle.position.set(x, 7.154, 1.8);
    baffle.rotation.x = Math.PI * 0.5;
    scene.add(baffle);
    fixtureGeometry.push(baffle);
  }

  const windowBeams = [];
  const bounceLights = [];
  for (const [index, portal] of lightPortals.entries()) {
    const target = new THREE.Object3D();
    target.name = `Exterior window beam target ${index + 1}`;
    target.position.set(portal.position.x * 0.34, 0.28, -2.6);

    // A narrow shadowed beam approximates the forward hemisphere of a bright
    // exterior window. Glass does not cast a shadow, while the structural
    // mullions do, so the pool and floor receive a coherent aperture pattern.
    const beam = new THREE.SpotLight(portal.color, 185, 46, 0.18, 0.9, 2);
    beam.name = `Exterior window transmission ${index + 1}`;
    beam.position.copy(portal.position);
    beam.castShadow = true;
    beam.shadow.mapSize.set(1024, 1024);
    beam.shadow.camera.near = 0.5;
    beam.shadow.camera.far = 46;
    beam.shadow.bias = -0.00025;
    beam.shadow.normalBias = 0.022;
    scene.add(beam, target);
    beam.target = target;
    windowBeams.push(beam);

    // Three's realtime lights do not solve diffuse multi-bounce GI. This dim,
    // short-range source represents only the first warm floor bounce where the
    // transmitted beam lands, without flattening the moonlit room globally.
    const bounce = new THREE.PointLight(portal.color, 4.6, 7.5, 2);
    bounce.name = `Window-light floor bounce ${index + 1}`;
    bounce.position.set(target.position.x, 0.42, target.position.z - 0.65);
    scene.add(bounce);
    bounceLights.push(bounce);
  }

  const sculptureSpot = new THREE.SpotLight(0xd8efff, 34, 18, 0.39, 0.68, 1.6);
  sculptureSpot.position.set(5.8, 6.8, 5.5);
  sculptureSpot.target.position.set(0.9, 3.1, -0.15);
  sculptureSpot.castShadow = true;
  sculptureSpot.shadow.mapSize.set(1024, 1024);
  sculptureSpot.shadow.bias = -0.00015;
  scene.add(sculptureSpot, sculptureSpot.target);

  return {
    moon,
    fixtures,
    fixtureGeometry,
    windowBeams,
    bounceLights,
    sculptureSpot,
  };
}

export function buildMidnightGlasshouse(scene, environment) {
  const reflectors = [];
  const reflectionSurfaces = [];
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 28), createSkyMaterial());
  sky.name = "Procedural storm sky";
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const exterior = addExterior(scene);
  const architecture = addArchitecture(scene, reflectors, reflectionSurfaces);
  const pool = addPool(scene, reflectors, reflectionSurfaces);
  const sculpture = addSculpture(scene, environment);
  const foliage = addFoliage(scene);
  const rain = addRain(scene);
  const vehicle = addVehicle(scene);
  const lights = addLights(scene, exterior.lightPortals);

  return {
    reflectors,
    reflectionSurfaces,
    sky,
    exterior: exterior.group,
    architecture,
    pool,
    sculpture,
    foliage,
    rain,
    vehicle,
    lights,
    update(time, delta) {
      sculpture.update(time);
      foliage.update(time);
      if (rain.object.visible) rain.update(delta);
      vehicle.update(time);
    },
    setRainEnabled(enabled) {
      rain.object.visible = Boolean(enabled);
    },
    setReflectionQuality(highQuality) {
      // Registration order is wet floor, rear glass, then pool water.
      const scales = highQuality ? [0.58, 0.40, 0.68] : [0.34, 0.25, 0.42];
      reflectors.forEach((node, index) => {
        node.reflector.resolutionScale = scales[index] ?? scales.at(-1);
      });
    },
    setNativeReflectionMode(enabled) {
      rasterReflectionStrength.value = enabled ? 0 : 1;
      for (const surface of reflectionSurfaces) {
        // This is a real material boundary, not merely an update suppression:
        // native MRT shaders contain no ReflectorNode or viewport-copy nodes.
        // Restoring the original material makes all planar effects available
        // again if OP84 is absent or stops evaluating.
        surface.mesh.material = enabled
          ? surface.nativeMaterial
          : surface.rasterMaterial;
      }
      for (const node of reflectors) {
        // The node is absent from native material graphs; NONE additionally
        // documents that its update is fallback-only. Restoring FRAME and a
        // forced refresh revives each capture after a native failure.
        node.reflector.updateBeforeType = enabled
          ? THREE.NodeUpdateType.NONE
          : THREE.NodeUpdateType.FRAME;
        if (!enabled) node.reflector.forceUpdate = true;
      }
    },
  };
}
