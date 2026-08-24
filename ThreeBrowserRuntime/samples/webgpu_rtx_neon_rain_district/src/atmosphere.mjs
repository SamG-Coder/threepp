import * as THREE from "three/webgpu";
import {
  createHaloMaterial,
  createMistMaterial,
  createRainMaterial,
  palette,
} from "./materials.mjs";

const TAU = Math.PI * 2;
const RAIN_LAYER_SPECS = Object.freeze([
  {
    name: "Near camera rain",
    count: 620,
    width: 17,
    depth: 27,
    ceiling: 16,
    lengthMin: 0.28,
    lengthMax: 0.95,
    speedMin: 16,
    speedMax: 24,
    opacity: 0.18,
    impactChance: 0.16,
    impactStrength: 1,
    renderOrder: 74,
  },
  {
    name: "Mid avenue rain",
    count: 1_100,
    width: 30,
    depth: 53,
    ceiling: 18,
    lengthMin: 0.24,
    lengthMax: 0.80,
    speedMin: 14,
    speedMax: 22,
    opacity: 0.14,
    impactChance: 0.08,
    impactStrength: 0.78,
    renderOrder: 73,
  },
  {
    name: "Far neon rain veil",
    count: 1_800,
    width: 48,
    depth: 94,
    ceiling: 21,
    lengthMin: 0.14,
    lengthMax: 0.55,
    speedMin: 11,
    speedMax: 19,
    opacity: 0.085,
    impactChance: 0.035,
    impactStrength: 0.56,
    renderOrder: 72,
  },
]);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function fract(value) {
  return value - Math.floor(value);
}

function ignoreForRtx(object) {
  object.userData.rtxIgnore = true;
  return object;
}

function createSoftAlphaTexture(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const u = (x + 0.5) / size * 2 - 1;
      const v = (y + 0.5) / size * 2 - 1;
      const radius = Math.sqrt(u * u + v * v);
      const edge = THREE.MathUtils.smoothstep(1 - radius, 0, 0.78);
      const centerNoise = 0.92 + 0.08 * Math.sin(x * 0.73 + y * 1.17);
      const alpha = Math.round(255 * edge * edge * centerNoise);
      const offset = (y * size + x) * 4;
      data[offset] = alpha;
      data[offset + 1] = alpha;
      data[offset + 2] = alpha;
      data[offset + 3] = alpha;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = "Procedural soft atmosphere alpha";
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createRainLayer(spec, random) {
  const count = spec.count;
  const positions = new Float32Array(count * 6);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const z = new Float32Array(count);
  const length = new Float32Array(count);
  const speed = new Float32Array(count);
  const lateral = new Float32Array(count);
  const depthDrift = new Float32Array(count);

  function reset(index, initial = false) {
    x[index] = (random() - 0.5) * spec.width;
    y[index] = initial
      ? 0.08 + random() * spec.ceiling
      : spec.ceiling + random() * 4.5;
    z[index] = (random() - 0.5) * spec.depth;
    length[index] = spec.lengthMin + random() * (spec.lengthMax - spec.lengthMin);
    speed[index] = spec.speedMin + random() * (spec.speedMax - spec.speedMin);
    lateral[index] = 0.19 + random() * 0.23;
    depthDrift[index] = (random() - 0.5) * 0.055;
  }

  function write(index) {
    const offset = index * 6;
    const streakLength = length[index];
    positions[offset] = x[index];
    positions[offset + 1] = y[index];
    positions[offset + 2] = z[index];
    // The second endpoint trails upward and against the street-level gust.
    // Keeping this in geometry instead of rotating thousands of meshes makes
    // the field cheap enough to retain real near/mid/far depth density.
    positions[offset + 3] = x[index] - streakLength * lateral[index];
    positions[offset + 4] = y[index] + streakLength;
    positions[offset + 5] = z[index] + streakLength * depthDrift[index];
  }

  for (let index = 0; index < count; ++index) {
    reset(index, true);
    write(index);
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);

  const material = createRainMaterial(spec.opacity);
  material.name = `${spec.name} material`;
  material.depthTest = true;
  material.fog = true;

  const lines = ignoreForRtx(new THREE.LineSegments(geometry, material));
  lines.name = `${spec.name} — ${count.toLocaleString()} deterministic streaks`;
  lines.frustumCulled = false;
  lines.renderOrder = spec.renderOrder;

  return {
    object: lines,
    update(delta, gust, emitGroundImpact) {
      for (let index = 0; index < count; ++index) {
        y[index] -= speed[index] * delta;
        x[index] += (lateral[index] * 2.35 + gust * 0.48) * delta;
        z[index] += depthDrift[index] * speed[index] * delta;
        const hitGround = y[index] < -0.25;
        if (hitGround && random() < spec.impactChance) {
          // Report the actual local landing coordinate before this exact drop
          // is recycled. The atmosphere owner transforms it through the
          // camera-relative rain anchor and feeds the bounded ripple pool.
          emitGroundImpact?.(x[index], z[index], spec.impactStrength);
        }
        if (hitGround || x[index] > spec.width * 0.58 || Math.abs(z[index]) > spec.depth * 0.56) {
          reset(index);
          x[index] -= gust * random() * 2.5;
        }
        write(index);
      }
      positionAttribute.needsUpdate = true;
    },
  };
}

function createSplashCrownGeometry(segments = 18) {
  const positions = [];
  for (let index = 0; index < segments; ++index) {
    const a = index / segments * TAU;
    const b = (index + 1) / segments * TAU;
    const midpoint = (a + b) * 0.5;
    const radius = 0.72 + (index % 3) * 0.045;
    const tipRadius = 0.67 + (index % 2) * 0.08;
    const tipHeight = 0.63 + ((index * 7) % 5) * 0.075;
    positions.push(
      Math.cos(a) * radius, 0, Math.sin(a) * radius,
      Math.cos(b) * radius, 0, Math.sin(b) * radius,
      Math.cos(midpoint) * tipRadius, tipHeight, Math.sin(midpoint) * tipRadius,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createRoadSplashes(random) {
  const group = ignoreForRtx(new THREE.Group());
  group.name = "Causally matched rain impact crowns and tiny ripples";

  // This is a bounded event pool rather than a field of looping decoration.
  // Slots are written only by actual rain-layer ground crossings, so every
  // visible ring is attached to the world X/Z where a rendered drop landed.
  const capacity = 240;
  const impactX = new Float32Array(capacity);
  const impactZ = new Float32Array(capacity);
  const birthTime = new Float32Array(capacity);
  const lifetime = new Float32Array(capacity);
  const size = new Float32Array(capacity);
  const twist = new Float32Array(capacity);
  birthTime.fill(-1_000_000);
  let cursor = 0;

  const ringGeometry = new THREE.RingGeometry(0.82, 1, 20, 1);
  ringGeometry.rotateX(-Math.PI * 0.5);
  const ringMaterial = createHaloMaterial(palette.rain, 0.105);
  ringMaterial.name = "Subtle rain impact ripple";
  ringMaterial.depthTest = true;
  const rings = ignoreForRtx(new THREE.InstancedMesh(ringGeometry, ringMaterial, capacity));
  rings.name = "Dynamic tiny puddle ripple pool";
  rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rings.frustumCulled = false;
  rings.renderOrder = 66;
  group.add(rings);

  const crownGeometry = createSplashCrownGeometry();
  const crownMaterial = createMistMaterial(0xc2eaff, 0.078);
  crownMaterial.name = "Tiny rain splash crown";
  crownMaterial.depthTest = true;
  const crowns = ignoreForRtx(new THREE.InstancedMesh(crownGeometry, crownMaterial, capacity));
  crowns.name = "Dynamic tiny splash crown pool";
  crowns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crowns.frustumCulled = false;
  crowns.renderOrder = 67;
  group.add(crowns);

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const hiddenScale = new THREE.Vector3(0.0001, 0.0001, 0.0001);

  function spawn(x, z, time, strength = 1) {
    const index = cursor;
    cursor = (cursor + 1) % capacity;
    impactX[index] = x;
    impactZ[index] = z;
    birthTime[index] = time;
    lifetime[index] = 0.28 + random() * 0.18;
    size[index] = THREE.MathUtils.clamp(strength, 0.35, 1) * (0.78 + random() * 0.38);
    twist[index] = random() * TAU;
  }

  function update(time) {
    for (let index = 0; index < capacity; ++index) {
      const age = time - birthTime[index];
      const progress = age / lifetime[index];
      position.set(impactX[index], 0.024, impactZ[index]);
      quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, twist[index]);

      if (progress >= 0 && progress < 1) {
        const eased = 1 - Math.pow(1 - progress, 2);
        const radius = size[index] * (0.022 + eased * 0.145);
        const fadeScale = Math.max(0.001, Math.sin(progress * Math.PI));
        scale.set(radius, 0.08 + fadeScale * 0.035, radius);
      } else {
        scale.copy(hiddenScale);
      }
      matrix.compose(position, quaternion, scale);
      rings.setMatrixAt(index, matrix);

      const crownProgress = progress / 0.46;
      if (crownProgress >= 0 && crownProgress < 1) {
        const width = size[index] * (0.024 + crownProgress * 0.058);
        const height = size[index] * Math.sin(crownProgress * Math.PI) * 0.13;
        scale.set(width, Math.max(0.003, height), width);
      } else {
        scale.copy(hiddenScale);
      }
      matrix.compose(position, quaternion, scale);
      crowns.setMatrixAt(index, matrix);
    }
    rings.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
  }

  update(0);
  return { group, spawn, update };
}

function createFogAndSteam(random, softTexture) {
  const group = ignoreForRtx(new THREE.Group());
  group.name = "Layered localized avenue fog and curb steam";
  const cardGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const cards = [];
  const groundSheets = [];

  const coldFogColors = [0x477f99, 0x496f86, 0x355c73, 0x6a477c];
  for (let index = 0; index < 18; ++index) {
    const side = index % 3 === 0 ? (random() < 0.5 ? -1 : 1) : 0;
    const material = createMistMaterial(
      coldFogColors[index % coldFogColors.length],
      0.017 + random() * 0.027,
    );
    material.name = "Soft localized rain fog card";
    material.alphaMap = softTexture;
    material.needsUpdate = true;
    const mesh = ignoreForRtx(new THREE.Mesh(cardGeometry, material));
    mesh.name = "Billboarded avenue fog layer";
    const width = 5.5 + random() * 11;
    const height = 1.4 + random() * 3.5;
    const baseX = side === 0 ? (random() - 0.5) * 13 : side * (7 + random() * 4.5);
    const baseY = 0.55 + random() * 2.3;
    const baseZ = -94 + random() * 163;
    mesh.position.set(baseX, baseY, baseZ);
    mesh.scale.set(width, height, 1);
    mesh.renderOrder = 28 + index % 4;
    group.add(mesh);
    cards.push({
      mesh,
      material,
      kind: "fog",
      baseX,
      baseY,
      baseZ,
      width,
      height,
      opacity: material.opacity,
      phase: random() * TAU,
      drift: 0.08 + random() * 0.14,
    });
  }

  // Each vent uses several independent rising cards. Their offset life cycles
  // read as rolling steam instead of one flat rectangle following the camera.
  const vents = [
    [-7.8, -70, palette.cyan],
    [7.6, -39, palette.magenta],
    [-8.5, -8, 0xa7cad7],
    [7.9, 26, palette.amber],
    [-7.4, 51, 0x89aab8],
  ];
  for (let ventIndex = 0; ventIndex < vents.length; ++ventIndex) {
    const [ventX, ventZ, ventColor] = vents[ventIndex];
    for (let layer = 0; layer < 3; ++layer) {
      const material = createMistMaterial(ventColor, 0.032 + layer * 0.008);
      material.name = "Curb vent steam card";
      material.alphaMap = softTexture;
      material.needsUpdate = true;
      const mesh = ignoreForRtx(new THREE.Mesh(cardGeometry, material));
      mesh.name = "Rising curb steam wisp";
      mesh.renderOrder = 34 + layer;
      group.add(mesh);
      cards.push({
        mesh,
        material,
        kind: "steam",
        baseX: ventX + (random() - 0.5) * 0.65,
        baseY: 0.24,
        baseZ: ventZ + (random() - 0.5) * 0.65,
        width: 1.15 + random() * 1.5,
        height: 1.8 + random() * 2.8,
        opacity: material.opacity,
        phase: fract(layer / 3 + random() * 0.16),
        drift: 0.075 + random() * 0.055,
      });
    }
  }

  const groundGeometry = new THREE.PlaneGeometry(1, 1);
  groundGeometry.rotateX(-Math.PI * 0.5);
  for (let index = 0; index < 9; ++index) {
    const material = createMistMaterial(index % 3 === 1 ? 0x603759 : 0x315d70, 0.013 + random() * 0.012);
    material.name = "Ground-hugging rain haze";
    material.alphaMap = softTexture;
    material.needsUpdate = true;
    const mesh = ignoreForRtx(new THREE.Mesh(groundGeometry, material));
    mesh.name = "Road-height haze pool";
    const baseX = (random() - 0.5) * 12;
    const baseZ = -90 + index * 19.5 + (random() - 0.5) * 7;
    const width = 9 + random() * 13;
    const depth = 7 + random() * 10;
    mesh.position.set(baseX, 0.065 + index % 2 * 0.018, baseZ);
    mesh.scale.set(width, depth, 1);
    mesh.renderOrder = 22;
    group.add(mesh);
    groundSheets.push({
      mesh,
      material,
      baseX,
      baseZ,
      width,
      depth,
      opacity: material.opacity,
      phase: random() * TAU,
    });
  }

  const lookTarget = new THREE.Vector3();
  function update(time, cameraPosition) {
    for (const card of cards) {
      if (card.kind === "steam") {
        const age = fract(time * card.drift + card.phase);
        const ease = Math.sin(Math.min(1, age * 1.25) * Math.PI * 0.5);
        card.mesh.position.set(
          card.baseX + Math.sin(time * 0.46 + card.phase * TAU) * (0.2 + age * 0.75),
          card.baseY + age * 4.8,
          card.baseZ + Math.cos(time * 0.33 + card.phase * TAU) * age * 0.48,
        );
        card.mesh.scale.set(
          card.width * (0.42 + age * 0.9),
          card.height * (0.34 + age * 0.88),
          1,
        );
        card.material.opacity = card.opacity * ease * Math.pow(1 - age, 1.22);
      } else {
        const pulse = 0.88 + Math.sin(time * card.drift + card.phase) * 0.12;
        card.mesh.position.set(
          card.baseX + Math.sin(time * 0.045 + card.phase) * 1.35,
          card.baseY + Math.sin(time * 0.09 + card.phase * 1.7) * 0.22,
          card.baseZ + Math.cos(time * 0.037 + card.phase) * 0.8,
        );
        card.mesh.scale.set(card.width * pulse, card.height * (0.94 + (pulse - 0.88) * 0.7), 1);
        card.material.opacity = card.opacity * (0.78 + pulse * 0.22);
      }
      if (cameraPosition) {
        lookTarget.set(cameraPosition.x, card.mesh.position.y, cameraPosition.z);
        if (lookTarget.distanceToSquared(card.mesh.position) > 0.0001) card.mesh.lookAt(lookTarget);
      }
    }

    for (const sheet of groundSheets) {
      const pulse = 0.94 + Math.sin(time * 0.075 + sheet.phase) * 0.06;
      sheet.mesh.position.x = sheet.baseX + Math.sin(time * 0.035 + sheet.phase) * 0.8;
      sheet.mesh.position.z = sheet.baseZ + Math.cos(time * 0.028 + sheet.phase) * 0.55;
      sheet.mesh.scale.set(sheet.width * pulse, sheet.depth / pulse, 1);
      sheet.material.opacity = sheet.opacity * (0.82 + pulse * 0.18);
    }
  }

  return { group, update };
}

function createLightShafts(softTexture) {
  const group = ignoreForRtx(new THREE.Group());
  group.name = "Soft crossed neon shafts suspended in rain fog";
  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const shafts = [];
  const specs = [
    [-9.1, 5.3, -72, palette.cyan, 3.6, 10.2, -0.075],
    [9.3, 4.8, -50, palette.magenta, 3.2, 9.1, 0.09],
    [-9.5, 5.8, -25, palette.amber, 3.8, 11.1, -0.11],
    [9.0, 5.1, -2, palette.blue, 3.4, 9.7, 0.085],
    [-9.2, 4.6, 21, palette.red, 3.1, 8.6, -0.08],
    [9.5, 5.6, 44, palette.jade, 3.9, 10.8, 0.105],
  ];

  for (let index = 0; index < specs.length; ++index) {
    const [x, y, z, color, radius, height, lean] = specs[index];
    const planes = [];
    const yawAngles = [0, Math.PI * 0.27, -Math.PI * 0.27];
    for (let layer = 0; layer < yawAngles.length; ++layer) {
      const opacity = (layer === 0 ? 0.027 : 0.013) + (index % 2) * 0.003;
      const material = layer === 0
        ? createHaloMaterial(color, opacity)
        : createMistMaterial(color, opacity);
      material.name = layer === 0
        ? "Billboarded soft neon shaft"
        : "Crossed soft neon shaft layer";
      material.alphaMap = softTexture;
      material.depthTest = true;
      material.depthWrite = false;
      material.needsUpdate = true;

      const plane = ignoreForRtx(new THREE.Mesh(planeGeometry, material));
      plane.name = layer === 0
        ? "Camera-facing alpha-mapped light shaft"
        : "Crossed alpha-mapped light shaft";
      plane.position.set(
        x * 0.72 + (layer - 1) * 0.08,
        y * 0.82,
        z + (index % 2 ? -0.3 : 0.3),
      );
      plane.rotation.set(0, yawAngles[layer], lean * (1.75 + layer * 0.18));
      const width = radius * (layer === 0 ? 1.24 : 0.94);
      const planeHeight = height * (layer === 0 ? 0.84 : 0.76);
      plane.scale.set(width, planeHeight, 1);
      plane.renderOrder = 39 + layer;
      group.add(plane);
      planes.push({ plane, material, opacity, width, height: planeHeight, yaw: yawAngles[layer] });
    }

    shafts.push({ planes, phase: index * 1.37 });
  }

  function update(time, cameraPosition) {
    for (const shaft of shafts) {
      const pulse = 0.94 + Math.sin(time * 0.72 + shaft.phase) * 0.06;
      for (let layer = 0; layer < shaft.planes.length; ++layer) {
        const card = shaft.planes[layer];
        card.plane.scale.x = card.width * (0.96 + (pulse - 0.94) * 0.7);
        card.plane.scale.y = card.height * (0.985 + (pulse - 0.94) * 0.22);
        card.material.opacity = card.opacity * (0.78 + pulse * 0.22);
        if (layer === 0 && cameraPosition) {
          const dx = cameraPosition.x - card.plane.position.x;
          const dz = cameraPosition.z - card.plane.position.z;
          card.plane.rotation.y = Math.atan2(dx, dz);
        } else {
          card.plane.rotation.y = card.yaw;
        }
      }
    }
  }

  return { group, update };
}

function createWindLitter(random) {
  const group = ignoreForRtx(new THREE.Group());
  group.name = "Wind-driven paper and foil litter";
  const count = 12;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0x8b9294,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.name = "Wet windblown litter";
  material.userData.rtxIgnore = true;
  const litter = ignoreForRtx(new THREE.InstancedMesh(geometry, material, count));
  litter.name = "Windblown litter instances";
  litter.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  litter.frustumCulled = false;
  litter.renderOrder = 61;
  group.add(litter);

  const pieces = [];
  for (let index = 0; index < count; ++index) {
    pieces.push({
      x: (random() - 0.5) * 11.4,
      phase: random(),
      speed: 0.018 + random() * 0.024,
      sizeX: 0.08 + random() * 0.17,
      sizeY: 0.04 + random() * 0.09,
      lift: 0.10 + random() * 0.45,
      yaw: random() * TAU,
    });
  }

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();

  function update(time) {
    const gust = Math.sin(time * 0.31) * 0.5 + Math.sin(time * 0.73 + 1.2) * 0.28;
    for (let index = 0; index < count; ++index) {
      const piece = pieces[index];
      const travel = fract(time * piece.speed + piece.phase);
      const flutter = Math.sin(travel * TAU * 7 + piece.yaw);
      position.set(
        piece.x + Math.sin(time * 0.41 + piece.yaw) * (0.55 + piece.lift) + gust,
        0.07 + Math.abs(flutter) * piece.lift * (0.3 + Math.sin(travel * Math.PI) * 0.7),
        -96 + travel * 172,
      );
      euler.set(
        time * (2.2 + piece.speed * 18) + piece.yaw,
        piece.yaw + travel * TAU * 2.6,
        flutter * 1.25,
      );
      quaternion.setFromEuler(euler);
      scale.set(piece.sizeX, piece.sizeY, 1);
      matrix.compose(position, quaternion, scale);
      litter.setMatrixAt(index, matrix);
    }
    litter.instanceMatrix.needsUpdate = true;
  }

  update(0);
  return { group, update };
}

/**
 * Creates the district's transparent, entirely JavaScript-authored weather.
 * Every child is explicitly excluded from static RTX serialization: the ray
 * bridge sees the wet road and architecture, never thousands of alpha effects.
 */
export function createDistrictAtmosphere(scene) {
  if (!scene?.add) throw new TypeError("createDistrictAtmosphere requires a Three.js scene.");

  const random = seededRandom(0x6e656f6e);
  const group = ignoreForRtx(new THREE.Group());
  group.name = "Neon rain district atmosphere (JS authored)";
  scene.add(group);

  const softTexture = createSoftAlphaTexture();

  const rainAnchor = ignoreForRtx(new THREE.Group());
  rainAnchor.name = "Camera-depth rain field anchor";
  const rainLayers = RAIN_LAYER_SPECS.map(spec => createRainLayer(spec, random));
  for (const layer of rainLayers) rainAnchor.add(layer.object);
  group.add(rainAnchor);

  const fog = createFogAndSteam(random, softTexture);
  const shafts = createLightShafts(softTexture);
  const splashes = createRoadSplashes(random);
  const litter = createWindLitter(random);
  group.add(fog.group, shafts.group, splashes.group, litter.group);

  const cameraPosition = new THREE.Vector3();
  const cameraForward = new THREE.Vector3(0, 0, -1);
  const impactWorldPosition = new THREE.Vector3();
  let impactTime = 0;
  let rainEnabled = true;
  let disposed = false;

  function emitGroundImpact(localX, localZ, strength) {
    impactWorldPosition.set(localX, 0, localZ).applyMatrix4(rainAnchor.matrixWorld);
    // The rain volume extends past the architecture so facades stay visibly
    // rain-wrapped. Ripple geometry, however, belongs only on the authored
    // 12.4 x 154 metre wet-asphalt plane, inset slightly from curb/end edges.
    if (
      Math.abs(impactWorldPosition.x) > 6.02 ||
      impactWorldPosition.z < -131.5 ||
      impactWorldPosition.z > 21.5
    ) return;
    splashes.spawn(impactWorldPosition.x, impactWorldPosition.z, impactTime, strength);
  }

  function setRainEnabled(enabled) {
    rainEnabled = Boolean(enabled);
    rainAnchor.visible = rainEnabled;
  }

  function update(time, delta, camera) {
    if (disposed) return;
    const now = Number.isFinite(Number(time)) ? Number(time) : 0;
    const dt = THREE.MathUtils.clamp(Number(delta) || 0, 0, 0.05);
    let activeCameraPosition = null;

    if (camera?.getWorldPosition) {
      camera.getWorldPosition(cameraPosition);
      camera.getWorldDirection(cameraForward);
      cameraForward.y = 0;
      if (cameraForward.lengthSq() < 1e-6) cameraForward.set(0, 0, -1);
      else cameraForward.normalize();
      activeCameraPosition = cameraPosition;

      // Local -Z is aligned to the active composition. The nested rain layers
      // therefore retain foreground/midground/background density even as the
      // cinematic camera cuts between the four street-level views.
      rainAnchor.position.set(
        cameraPosition.x + cameraForward.x * 22,
        0,
        cameraPosition.z + cameraForward.z * 22,
      );
      rainAnchor.rotation.y = Math.atan2(-cameraForward.x, -cameraForward.z);
    }
    rainAnchor.updateWorldMatrix(true, false);

    if (rainEnabled) {
      const gust = Math.sin(now * 0.37) * 0.55 + Math.sin(now * 0.91 + 1.7) * 0.23;
      impactTime = now;
      for (const layer of rainLayers) layer.update(dt, gust, emitGroundImpact);
    }
    // Impacts already in flight get their short natural fade when rain is
    // disabled; no independent event is generated while the layers are off.
    splashes.update(now);
    fog.update(now, activeCameraPosition);
    shafts.update(now, activeCameraPosition);
    litter.update(now);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();

    const geometries = new Set();
    const materials = new Set();
    group.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of objectMaterials) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    softTexture.dispose();
  }

  setRainEnabled(true);
  return { group, update, setRainEnabled, dispose };
}
