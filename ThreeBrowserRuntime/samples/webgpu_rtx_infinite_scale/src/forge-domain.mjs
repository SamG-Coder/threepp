import * as THREE from "three/webgpu";
import {
  createDarkMetalMaterial,
  createEmberMaterial,
  createSmokeMaterial,
  createSteelMaterial,
  createStoneMaterial,
  createTimberMaterial,
  palette,
} from "./materials.mjs";

function seededRandom(seed = 0x464f5247) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shadow(object, cast = true, receive = true) {
  object.castShadow = cast;
  object.receiveShadow = receive;
  return object;
}

function box(parent, size, position, material, rotation = null, name = "") {
  const mesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(...size), material));
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, radiusTop, radiusBottom, height, segments, position, material, rotation = null, name = "") {
  const mesh = shadow(new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
  ));
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  mesh.name = name;
  parent.add(mesh);
  return mesh;
}

function makeStoneWalls(root, material, random) {
  const geometry = new THREE.BoxGeometry(0.92, 0.44, 0.46);
  const transforms = [];
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  for (let row = 0; row < 13; ++row) {
    for (let column = 0; column < 15; ++column) {
      const x = (column - 7) * 0.91 + (row % 2) * 0.45;
      const y = 0.22 + row * 0.43;
      const doorway = x > 2.45 && x < 5.25 && y < 4.4;
      const furnaceMouth = x > -5.35 && x < -2.25 && y > 0.45 && y < 3.55;
      if (doorway || furnaceMouth || Math.abs(x) > 6.55) continue;
      position.set(x + (random() - 0.5) * 0.035, y, -5.48 + (random() - 0.5) * 0.06);
      quaternion.setFromEuler(new THREE.Euler(0, 0, (random() - 0.5) * 0.035));
      scale.set(0.94 + random() * 0.12, 0.88 + random() * 0.18, 0.92 + random() * 0.16);
      transforms.push(matrix.compose(position, quaternion, scale).clone());
    }
  }

  for (const side of [-1, 1]) {
    for (let row = 0; row < 13; ++row) {
      for (let column = 0; column < 13; ++column) {
        const z = (column - 5.5) * 0.91 + (row % 2) * 0.45;
        if (z > 5.3) continue;
        position.set(side * 6.66, 0.22 + row * 0.43, z);
        quaternion.setFromEuler(new THREE.Euler(0, Math.PI * 0.5, (random() - 0.5) * 0.025));
        scale.set(0.94 + random() * 0.11, 0.88 + random() * 0.18, 0.95 + random() * 0.12);
        transforms.push(matrix.compose(position, quaternion, scale).clone());
      }
    }
  }

  const stones = new THREE.InstancedMesh(geometry, material, transforms.length);
  transforms.forEach((transform, index) => stones.setMatrixAt(index, transform));
  stones.instanceMatrix.needsUpdate = true;
  stones.name = "Individually settled forge stones";
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.computeBoundingSphere?.();
  root.add(stones);
  return stones;
}

function makeFurnaceFireLayers(group, random) {
  // The coals provide physically registered emissive geometry for RTX, while
  // these bounded transparent layers provide the visible flame body. Keeping
  // them separate prevents hundreds of animated translucent triangles from
  // entering the static-scene collector.
  const flameGeometry = new THREE.ConeGeometry(1, 1, 9, 1, true);
  flameGeometry.translate(0, 0.5, 0);

  function flameMaterial(name, color, opacity) {
    const material = new THREE.MeshBasicNodeMaterial({
      name,
      color: new THREE.Color(color).multiplyScalar(2.2),
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    material.toneMapped = true;
    material.userData.rtxIgnore = true;
    return material;
  }

  const outerMaterial = flameMaterial("Soot-red transparent flame envelope", 0xff3b08, 0.3);
  const middleMaterial = flameMaterial("Orange forge flame body", 0xff8a1b, 0.44);
  const coreMaterial = flameMaterial("White-hot charcoal flame core", 0xffedb0, 0.62);
  const layers = [
    { count: 30, material: outerMaterial, spread: 1.18, minHeight: 0.68, maxHeight: 1.75, width: 0.23, speed: 4.2 },
    { count: 22, material: middleMaterial, spread: 0.98, minHeight: 0.58, maxHeight: 1.42, width: 0.18, speed: 5.4 },
    { count: 13, material: coreMaterial, spread: 0.72, minHeight: 0.46, maxHeight: 1.08, width: 0.13, speed: 6.8 },
  ].map((definition, layerIndex) => {
    const seeds = [];
    const mesh = new THREE.InstancedMesh(flameGeometry, definition.material, definition.count);
    mesh.name = ["Outer flame envelope", "Layered orange flame tongues", "White-hot flame cores"][layerIndex];
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6 + layerIndex;
    mesh.userData.rtxIgnore = true;
    group.add(mesh);
    for (let index = 0; index < definition.count; ++index) {
      seeds.push({
        x: (random() - 0.5) * definition.spread * 2,
        z: 0.48 + random() * 0.38,
        height: THREE.MathUtils.lerp(definition.minHeight, definition.maxHeight, Math.pow(random(), 0.72)),
        width: definition.width * (0.62 + random() * 0.74),
        phase: random() * Math.PI * 2,
        sway: 0.55 + random() * 0.95,
      });
    }
    return { ...definition, mesh, seeds };
  });

  const glowMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Volumetric-looking furnace heat bloom",
    color: new THREE.Color(0xff5d0b).multiplyScalar(2.5),
    transparent: true,
    opacity: 0.19,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
  });
  glowMaterial.toneMapped = true;
  glowMaterial.userData.rtxIgnore = true;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 22, 14), glowMaterial);
  glow.name = "Layered furnace heat glow";
  glow.position.set(0, 1.32, 0.58);
  glow.scale.set(1.52, 1.38, 0.34);
  glow.renderOrder = 5;
  glow.userData.rtxIgnore = true;
  group.add(glow);

  const dummy = new THREE.Object3D();
  function update(time) {
    layers.forEach((layer, layerIndex) => {
      layer.seeds.forEach((seed, index) => {
        const pulse = 0.76 + Math.sin(time * layer.speed + seed.phase) * 0.15 +
          Math.sin(time * (layer.speed * 1.73) + index * 1.19) * 0.09;
        const height = seed.height * Math.max(0.48, pulse);
        const sway = Math.sin(time * seed.sway + seed.phase) * (0.055 + height * 0.035);
        dummy.position.set(seed.x + sway, 0.66, seed.z + Math.sin(time * 0.9 + seed.phase) * 0.025);
        dummy.rotation.set(
          Math.sin(time * 1.7 + seed.phase) * 0.055,
          seed.phase + time * 0.12,
          -sway * 0.32,
        );
        dummy.scale.set(seed.width * (1.08 - pulse * 0.18), height, seed.width * (0.78 + layerIndex * 0.08));
        dummy.updateMatrix();
        layer.mesh.setMatrixAt(index, dummy.matrix);
      });
      layer.mesh.instanceMatrix.needsUpdate = true;
    });
    const flicker = 0.5 + 0.5 * Math.sin(time * 5.1) * Math.sin(time * 7.7 + 0.8);
    glow.scale.set(1.48 + flicker * 0.12, 1.3 + flicker * 0.16, 0.32 + flicker * 0.035);
    glowMaterial.opacity = 0.14 + flicker * 0.105;
    outerMaterial.opacity = 0.24 + flicker * 0.1;
    middleMaterial.opacity = 0.38 + flicker * 0.12;
    coreMaterial.opacity = 0.54 + flicker * 0.14;
  }
  update(0);
  return { layers, glow, update };
}

function makeFurnace(root, materials, lights, random) {
  const group = new THREE.Group();
  group.name = "Working charcoal furnace";
  group.position.set(-3.85, 0, -5.0);
  root.add(group);

  const archGeometry = new THREE.BoxGeometry(0.58, 0.38, 0.82);
  const arch = new THREE.InstancedMesh(archGeometry, materials.stone, 18);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < 18; ++index) {
    const angle = Math.PI * (index / 17);
    dummy.position.set(Math.cos(angle) * 1.62, 1.68 + Math.sin(angle) * 1.62, 0.02);
    dummy.rotation.z = angle - Math.PI * 0.5;
    dummy.scale.set(0.94 + random() * 0.12, 1, 1);
    dummy.updateMatrix();
    arch.setMatrixAt(index, dummy.matrix);
  }
  arch.castShadow = true;
  arch.receiveShadow = true;
  arch.instanceMatrix.needsUpdate = true;
  group.add(arch);

  box(group, [3.4, 0.5, 1.35], [0, 0.25, 0.05], materials.stone, null, "Furnace sill");
  const cavityMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x1b0301 });
  cavityMaterial.userData.rtxTriangleRadiance = [0.32, 0.025, 0.004, 1];
  box(group, [2.75, 2.55, 0.18], [0, 1.52, 0.29], cavityMaterial, null, "Furnace darkness");

  const coalGeometry = new THREE.DodecahedronGeometry(0.21, 0);
  const coals = new THREE.InstancedMesh(coalGeometry, materials.ember, 58);
  for (let index = 0; index < 58; ++index) {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * 1.16;
    dummy.position.set(Math.cos(angle) * radius, 0.63 + random() * 0.48, 0.48 + random() * 0.35);
    dummy.rotation.set(random() * 2, random() * 2, random() * 2);
    dummy.scale.setScalar(0.55 + random() * 0.8);
    dummy.updateMatrix();
    coals.setMatrixAt(index, dummy.matrix);
  }
  coals.instanceMatrix.needsUpdate = true;
  coals.name = "Emissive charcoal bed";
  coals.castShadow = false;
  group.add(coals);

  const flames = makeFurnaceFireLayers(group, random);

  const fire = new THREE.PointLight(palette.fire, 22, 18, 2);
  fire.name = "Furnace firelight";
  fire.position.set(-3.85, 1.85, -3.75);
  fire.castShadow = true;
  fire.shadow.mapSize.set(1536, 1536);
  fire.shadow.bias = -0.0012;
  fire.shadow.normalBias = 0.026;
  root.add(fire);
  lights.push(fire);

  const fill = new THREE.PointLight(0xffb061, 3.8, 9, 2);
  fill.position.set(-1.6, 2.55, -2.0);
  root.add(fill);
  lights.push(fill);
  return { group, fire, fill, flames };
}

function makeAnvil(root, materials) {
  const group = new THREE.Group();
  group.name = "Hero anvil";
  group.position.set(-0.15, 0, -0.15);
  root.add(group);

  box(group, [1.6, 0.24, 1.2], [0, 0.18, 0], materials.stone, null, "Anvil stone base");
  box(group, [0.76, 1.05, 0.64], [0, 0.82, 0], materials.darkMetal, null, "Anvil waist");
  box(group, [2.75, 0.34, 0.88], [-0.15, 1.48, 0], materials.darkMetal, null, "Anvil face");

  const horn = shadow(new THREE.Mesh(
    new THREE.ConeGeometry(0.43, 1.72, 16),
    materials.darkMetal,
  ));
  horn.rotation.z = -Math.PI * 0.5;
  horn.position.set(1.85, 1.47, 0);
  horn.scale.z = 0.78;
  group.add(horn);

  const hardy = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.02, 0.18),
    new THREE.MeshBasicNodeMaterial({ color: 0x020304 }),
  );
  hardy.position.set(-0.72, 1.66, 0.18);
  group.add(hardy);
  return group;
}

function makeSword(root, materials) {
  const sword = new THREE.Group();
  sword.name = "Ancient forged sword";
  sword.position.set(-0.12, 1.82, -0.14);
  sword.rotation.y = -0.055;
  sword.rotation.z = 0.012;
  root.add(sword);

  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(-3.55, 0);
  bladeShape.lineTo(-2.88, -0.23);
  bladeShape.lineTo(1.82, -0.20);
  bladeShape.lineTo(2.18, -0.13);
  bladeShape.lineTo(2.18, 0.13);
  bladeShape.lineTo(1.82, 0.20);
  bladeShape.lineTo(-2.88, 0.23);
  bladeShape.closePath();
  const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.075,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.028,
    bevelThickness: 0.022,
    curveSegments: 2,
  });
  bladeGeometry.center();
  const blade = shadow(new THREE.Mesh(bladeGeometry, materials.blade));
  blade.rotation.x = Math.PI * 0.5;
  blade.position.y = 0.1;
  blade.name = "Scratched steel blade";
  sword.add(blade);

  const fuller = box(
    sword,
    [4.35, 0.018, 0.095],
    [-0.22, 0.149, 0],
    materials.fuller,
    null,
    "Hammered fuller",
  );
  fuller.castShadow = false;

  const edge = box(
    sword,
    [4.9, 0.022, 0.045],
    [-0.48, 0.146, -0.195],
    materials.edge,
    [0, 0, -0.005],
    "Bright worn edge",
  );
  edge.castShadow = false;

  const runeMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x412516 });
  for (let index = 0; index < 11; ++index) {
    const x = -0.9 + index * 0.19;
    const stroke = box(
      sword,
      [0.018, 0.009, index % 3 === 0 ? 0.12 : 0.08],
      [x, 0.159, 0.04 + ((index % 2) - 0.5) * 0.06],
      runeMaterial,
      [0, (index % 2 ? 0.55 : -0.55), 0],
      "Acid-etched maker rune",
    );
    stroke.castShadow = false;
  }

  box(sword, [0.24, 0.25, 1.48], [2.26, 0.11, 0], materials.guard, [0.04, 0, 0], "Crossguard");
  cylinder(sword, 0.16, 0.18, 1.15, 12, [2.92, 0.11, 0], materials.grip, [0, 0, Math.PI * 0.5], "Leather grip");
  const wrapMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x27150e, roughness: 0.88 });
  for (let index = 0; index < 9; ++index) {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.018, 6, 20), wrapMaterial);
    wrap.rotation.y = Math.PI * 0.5;
    wrap.position.set(2.46 + index * 0.11, 0.11, 0);
    sword.add(wrap);
  }
  const pommel = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.27, 1), materials.guard));
  pommel.position.set(3.6, 0.11, 0);
  sword.add(pommel);
  return { sword, blade };
}

function makeTools(root, materials, random) {
  const tools = new THREE.Group();
  tools.name = "Blacksmith tools and clutter";
  root.add(tools);
  for (let index = 0; index < 7; ++index) {
    const x = -5.45 + index * 0.52;
    cylinder(tools, 0.045, 0.06, 1.05 + random() * 0.4, 8, [x, 2.75, -5.05], materials.darkMetal, [0.08, 0, 0.03 * (index - 3)], "Hanging tong");
    box(tools, [0.32, 0.18, 0.2], [x, 3.42 + random() * 0.22, -4.98], materials.darkMetal, [0, 0, random() - 0.5], "Hammer head");
  }

  const barrelMaterial = createTimberMaterial();
  cylinder(tools, 0.62, 0.68, 1.05, 16, [5.15, 0.54, -3.72], barrelMaterial, null, "Quench barrel");
  for (const y of [0.17, 0.62, 1.02]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.034, 6, 30), materials.darkMetal);
    band.rotation.x = Math.PI * 0.5;
    band.position.set(5.15, y, -3.72);
    tools.add(band);
  }

  const chainMaterial = materials.darkMetal;
  for (let index = 0; index < 19; ++index) {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 6, 16), chainMaterial);
    link.position.set(-5.7, 4.7 - index * 0.2, -1.9 + Math.sin(index * 0.55) * 0.08);
    link.rotation.y = index % 2 ? Math.PI * 0.5 : 0;
    tools.add(link);
  }
  return tools;
}

function makeParticles(root, random) {
  const sparksCount = 460;
  const sparkPositions = new Float32Array(sparksCount * 3);
  const sparkVelocity = new Float32Array(sparksCount * 3);
  const sparkAge = new Float32Array(sparksCount);
  const resetSpark = (index, initial = false) => {
    const offset = index * 3;
    sparkPositions[offset] = -3.85 + (random() - 0.5) * 1.9;
    sparkPositions[offset + 1] = 0.8 + random() * 0.8;
    sparkPositions[offset + 2] = -4.25 + random() * 0.72;
    sparkVelocity[offset] = (random() - 0.5) * 0.65;
    sparkVelocity[offset + 1] = 0.75 + random() * 2.5;
    sparkVelocity[offset + 2] = 0.22 + random() * 0.65;
    sparkAge[index] = initial ? random() * 2.3 : 0;
  };
  for (let index = 0; index < sparksCount; ++index) resetSpark(index, true);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3));
  const sparkMaterial = new THREE.PointsNodeMaterial({
    color: 0xffa13d,
    size: 0.038,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  sparkMaterial.toneMapped = false;
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.name = "Ballistic forge sparks";
  sparks.frustumCulled = false;
  sparks.userData.rtxIgnore = true;
  root.add(sparks);

  // A bounded subset of those authored sparks also exercises the generic RTX
  // dynamic-instance path. One tiny tetrahedron BLAS is shared by 64 slots;
  // JavaScript sends only row-major affine transforms and masks for a TLAS
  // refit, so hot off-camera sparks can streak across the blade reflection.
  const rtxCapacity = 64;
  const rtxGeometry = new THREE.TetrahedronGeometry(1, 0);
  const rtxPositions = new Float32Array(rtxGeometry.getAttribute("position").array);
  const rtxIndices = Uint32Array.from(rtxGeometry.index?.array ??
    Array.from({ length: rtxGeometry.getAttribute("position").count }, (_, index) => index));
  rtxGeometry.dispose();
  const rtxTriangleCount = rtxIndices.length / 3;
  const rtxTriangleRadiance = new Float32Array(rtxTriangleCount * 4);
  const rtxTriangleSurface = new Float32Array(rtxTriangleCount * 4);
  for (let triangle = 0; triangle < rtxTriangleCount; ++triangle) {
    const offset = triangle * 4;
    rtxTriangleRadiance.set([9.5, 2.8, 0.35, 1], offset);
    rtxTriangleSurface.set([0.45, 0.12, 0.02, 0.24], offset);
  }
  const rtxInstanceGroup = Object.freeze({
    id: "infinite-descent-forge-sparks",
    capacity: rtxCapacity,
    positions: rtxPositions,
    indices: rtxIndices,
    triangleRadiance: rtxTriangleRadiance,
    triangleSurface: rtxTriangleSurface,
  });
  const rtxMatrices = new Float32Array(rtxCapacity * 12);
  const rtxMasks = new Uint32Array(rtxCapacity);
  const rtxInstanceUpdate = {
    id: rtxInstanceGroup.id,
    matrices: rtxMatrices,
    masks: rtxMasks,
  };

  function rayTracingInstanceUpdate(active = true) {
    for (let slot = 0; slot < rtxCapacity; ++slot) {
      const source = slot * 3;
      const offset = slot * 12;
      rtxMatrices.fill(0, offset, offset + 12);
      const scale = 0.014 + (slot % 7) * 0.0015;
      rtxMatrices[offset] = scale;
      rtxMatrices[offset + 3] = sparkPositions[source];
      rtxMatrices[offset + 5] = scale * 1.8;
      rtxMatrices[offset + 7] = sparkPositions[source + 1];
      rtxMatrices[offset + 10] = scale;
      rtxMatrices[offset + 11] = sparkPositions[source + 2];
      rtxMasks[slot] = active ? 0xff : 0;
    }
    return rtxInstanceUpdate;
  }

  const smokeCount = 280;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeSeed = new Float32Array(smokeCount * 3);
  for (let index = 0; index < smokeCount; ++index) {
    const offset = index * 3;
    smokeSeed[offset] = (random() - 0.5) * 2.4;
    smokeSeed[offset + 1] = random();
    smokeSeed[offset + 2] = (random() - 0.5) * 1.1;
  }
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute("position", new THREE.BufferAttribute(smokePositions, 3));
  const smoke = new THREE.Points(smokeGeometry, createSmokeMaterial());
  smoke.name = "Layered furnace smoke";
  smoke.frustumCulled = false;
  smoke.userData.rtxIgnore = true;
  root.add(smoke);

  const dustCount = 520;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount; ++index) {
    dustPositions[index * 3] = (random() - 0.5) * 12;
    dustPositions[index * 3 + 1] = random() * 5.2;
    dustPositions[index * 3 + 2] = (random() - 0.5) * 10;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dustMaterial = new THREE.PointsNodeMaterial({
    color: 0xd9bd91,
    size: 0.018,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  dustMaterial.toneMapped = false;
  const dust = new THREE.Points(dustGeometry, dustMaterial);
  dust.name = "Moonlit dust motes";
  dust.userData.rtxIgnore = true;
  root.add(dust);

  function update(time, delta) {
    const dt = Math.min(0.04, delta);
    for (let index = 0; index < sparksCount; ++index) {
      const offset = index * 3;
      sparkAge[index] += dt;
      sparkVelocity[offset + 1] -= 1.65 * dt;
      sparkPositions[offset] += sparkVelocity[offset] * dt;
      sparkPositions[offset + 1] += sparkVelocity[offset + 1] * dt;
      sparkPositions[offset + 2] += sparkVelocity[offset + 2] * dt;
      if (sparkAge[index] > 1.25 + (index % 17) * 0.05 || sparkPositions[offset + 1] < 0.2) {
        resetSpark(index);
      }
    }
    sparkGeometry.attributes.position.needsUpdate = true;

    for (let index = 0; index < smokeCount; ++index) {
      const offset = index * 3;
      const phase = (smokeSeed[offset + 1] + time * 0.035) % 1;
      smokePositions[offset] = -3.85 + smokeSeed[offset] + Math.sin(time * 0.23 + index) * phase * 0.42;
      smokePositions[offset + 1] = 1.0 + phase * 5.0;
      smokePositions[offset + 2] = -4.25 + smokeSeed[offset + 2] + phase * 0.78;
    }
    smokeGeometry.attributes.position.needsUpdate = true;
    dust.rotation.y = time * 0.006;
    dust.position.y = Math.sin(time * 0.08) * 0.08;
  }
  return { sparks, smoke, dust, update, rtxInstanceGroup, rayTracingInstanceUpdate };
}

function makeMoonDoor(root, materials, lights) {
  const openingMaterial = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(palette.moon).multiplyScalar(2.8) });
  openingMaterial.userData.rtxTriangleRadiance = [1.4, 2.6, 4.7, 1];
  const opening = box(root, [2.52, 4.15, 0.12], [3.86, 2.05, -5.21], openingMaterial, null, "Moonlit forge doorway");
  opening.castShadow = false;

  const beamMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0x8bbce0,
    transparent: true,
    opacity: 0.045,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  beamMaterial.toneMapped = false;
  beamMaterial.userData.rtxIgnore = true;
  const beam = new THREE.Mesh(new THREE.ConeGeometry(2.5, 10, 4, 1, true), beamMaterial);
  beam.position.set(2.4, 2.0, -1.1);
  beam.rotation.x = Math.PI * 0.5;
  beam.rotation.z = -0.2;
  beam.scale.set(0.75, 1, 1.45);
  root.add(beam);

  const moon = new THREE.SpotLight(palette.moon, 18, 24, Math.PI * 0.19, 0.58, 1.5);
  moon.name = "Cold doorway moonlight";
  moon.position.set(4.4, 7.8, -8.4);
  moon.target.position.set(0.3, 0.2, 2.2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1536, 1536);
  moon.shadow.bias = -0.0007;
  root.add(moon, moon.target);
  lights.push(moon);
  return { opening, beam, moon };
}

function makeOffscreenReflectionProof(root, materials) {
  const group = new THREE.Group();
  group.name = "Off-camera reflection proof geometry";
  group.position.set(0, 0, 9.7);
  root.add(group);
  const hot = createEmberMaterial(3.2);
  box(group, [4.8, 0.18, 0.22], [-2.1, 3.8, 0], hot, [0, 0, 0.06], "Offscreen hot steel rack");
  for (let index = 0; index < 8; ++index) {
    cylinder(group, 0.035, 0.06, 2.8, 8, [-4.0 + index * 0.58, 2.2, -0.05], materials.darkMetal, [0, 0, 0.03 * (index - 4)], "Offscreen hanging blade");
  }
  const blue = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0x5aa8dd).multiplyScalar(2.4) });
  blue.userData.rtxTriangleRadiance = [0.18, 0.72, 1.8, 1];
  box(group, [2.0, 3.7, 0.15], [4.2, 2.1, 0], blue, null, "Offscreen cold aperture");
  return group;
}

function disposeHierarchy(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose?.();
  for (const material of materials) material.dispose?.();
}

export function buildForgeDomain() {
  const random = seededRandom();
  const root = new THREE.Group();
  root.name = "FORGE domain · metre coordinates";

  const materials = {
    stone: createStoneMaterial(),
    wetStone: createStoneMaterial({ wet: true, colorHex: 0x191b1e }),
    timber: createTimberMaterial(),
    blade: createSteelMaterial({ ancient: true, roughness: 0.2 }),
    edge: createSteelMaterial({ ancient: false, roughness: 0.075 }),
    fuller: createDarkMetalMaterial(0.34),
    darkMetal: createDarkMetalMaterial(0.48),
    guard: createDarkMetalMaterial(0.25),
    grip: new THREE.MeshStandardNodeMaterial({ color: 0x28130d, roughness: 0.9 }),
    ember: createEmberMaterial(5.6),
  };

  const floor = shadow(new THREE.Mesh(new THREE.PlaneGeometry(16, 15, 28, 28), materials.wetStone), false, true);
  floor.rotation.x = -Math.PI * 0.5;
  floor.position.set(0, -0.02, 0.8);
  floor.name = "Rain-darkened flagstone floor";
  root.add(floor);
  makeStoneWalls(root, materials.stone, random);

  for (const x of [-5.7, -2.85, 0, 2.85, 5.7]) {
    box(root, [0.34, 0.38, 13.8], [x, 5.35, 0.35], materials.timber, [0, 0, 0.01 * x], "Sooted roof beam");
  }
  for (const x of [-5.9, 5.9]) {
    box(root, [0.48, 5.8, 0.48], [x, 2.9, -4.9], materials.timber, null, "Load-bearing oak post");
  }

  const lights = [];
  const furnace = makeFurnace(root, materials, lights, random);
  const moon = makeMoonDoor(root, materials, lights);
  const anvil = makeAnvil(root, materials);
  const sword = makeSword(root, materials);
  const tools = makeTools(root, materials, random);
  const particles = makeParticles(root, random);
  const offscreen = makeOffscreenReflectionProof(root, materials);

  const overhead = new THREE.HemisphereLight(0x365169, 0x170a05, 0.72);
  root.add(overhead);
  const rim = new THREE.DirectionalLight(0x6ca4d0, 1.15);
  rim.position.set(4, 9, 5);
  rim.target.position.set(-0.5, 1.2, -0.3);
  root.add(rim, rim.target);

  const cameraCurve = new THREE.CatmullRomCurve3([
    // The recursive energy field resolves into this near-frontal composition.
    // It then drifts off axis before committing to the sword approach.
    new THREE.Vector3(0.1, 2.9, 11.4),
    new THREE.Vector3(5.25, 3.55, 7.6),
    new THREE.Vector3(2.95, 2.82, 4.55),
    new THREE.Vector3(0.75, 2.46, 2.25),
    new THREE.Vector3(-0.42, 2.36, 1.08),
    // Finish at a 35-degree incidence to the blade face. Paired with the
    // centered gateway below, the focused view contains steel edge-to-edge.
    new THREE.Vector3(-0.73794, 2.50279, 0.58428),
  ], false, "catmullrom", 0.38);
  const targetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.05, 1.76, -0.35),
    new THREE.Vector3(-0.4, 1.65, -0.2),
    new THREE.Vector3(-0.65, 1.78, -0.12),
    new THREE.Vector3(-0.72, 1.89, -0.08),
    new THREE.Vector3(-0.735, 1.95, -0.14),
    new THREE.Vector3(-0.73157, 1.97216, -0.17367),
  ], false, "catmullrom", 0.4);
  // Land in the middle of the blade face, not near its front edge. Centering
  // this physical patch lets the surface domain overfill the viewport before
  // it resolves, so no strip of the macro forge bisects the handoff.
  const gatewayPosition = new THREE.Vector3(-0.73157, 1.97216, -0.17367);

  function sampleCamera(t, camera, target) {
    cameraCurve.getPointAt(Math.min(1, Math.max(0, t)), camera.position);
    targetCurve.getPointAt(Math.min(1, Math.max(0, t)), target);
    camera.fov = THREE.MathUtils.lerp(51, 38, Math.pow(t, 1.7));
    camera.near = THREE.MathUtils.lerp(0.035, 0.004, t);
    camera.far = 90;
  }

  function update(time, delta, t) {
    particles.update(time, delta);
    furnace.flames.update(time);
    furnace.fire.intensity = 20 + Math.sin(time * 6.7) * 1.8 + Math.sin(time * 11.3) * 0.9;
    furnace.fill.intensity = 3.5 + Math.sin(time * 4.1 + 1.3) * 0.45;
    moon.beam.material.opacity = 0.038 + Math.sin(time * 0.31) * 0.008;
    sword.sword.rotation.y = -0.055 + Math.sin(time * 0.12) * 0.0015;
    // Ease the hidden proof geometry farther behind the viewer during the final
    // macro approach; it remains in the TLAS and therefore in the blade.
    offscreen.rotation.y = Math.sin(time * 0.07) * 0.018;
  }

  return {
    id: "forge",
    root,
    gatewayPosition,
    staticRoots: [root],
    staticLights: lights,
    rtxInstanceGroup: particles.rtxInstanceGroup,
    rayTracingInstanceUpdate: particles.rayTracingInstanceUpdate,
    sampleCamera,
    update,
    dispose() { disposeHierarchy(root); },
  };
}
