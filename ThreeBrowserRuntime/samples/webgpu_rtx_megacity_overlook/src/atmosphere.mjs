function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(edge0, edge1, value) {
  const span = edge1 - edge0;
  const t = clamp01((value - edge0) / (Math.abs(span) < 1e-6 ? 1e-6 : span));
  return t * t * (3 - 2 * t);
}

function hash2(x, y, seed) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ seed;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

function fractalNoise(x, y, seed, octaves = 5) {
  let amplitude = 0.56;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; ++octave) {
    total += valueNoise(x * frequency, y * frequency, seed + octave * 0x9e37) * amplitude;
    normalization += amplitude;
    amplitude *= 0.51;
    frequency *= 2.03;
  }
  return total / Math.max(1e-6, normalization);
}

function createFieldTexture(THREE, name, width, height, sampler) {
  const bytes = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; ++row) {
    const v = row / Math.max(1, height - 1);
    for (let column = 0; column < width; ++column) {
      const u = column / Math.max(1, width - 1);
      const value = Math.round(clamp01(sampler(u, v)) * 255);
      const offset = (row * width + column) * 4;
      // Mesh alpha maps read the green channel. Neutral RGB also makes these
      // fields robust on runtimes that lower node alpha maps differently.
      bytes[offset] = value;
      bytes[offset + 1] = value;
      bytes[offset + 2] = value;
      bytes[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(
    bytes,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createParticulateTexture(THREE, seed = 0x4d454741) {
  const width = 256;
  const height = 128;
  const field = new Float32Array(width * height);
  let state = seed >>> 0;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  for (let particle = 0; particle < 210; ++particle) {
    const centerX = 5 + Math.floor(random() * (width - 10));
    const centerY = 5 + Math.floor(random() * (height - 10));
    const length = random() < 0.24 ? 2 + Math.floor(random() * 4) : 1;
    const intensity = 0.22 + random() * 0.52;
    for (let step = 0; step < length; ++step) {
      const y = Math.min(height - 1, centerY + step);
      for (let dx = -1; dx <= 1; ++dx) {
        const x = centerX + dx;
        if (x < 0 || x >= width) continue;
        const falloff = dx === 0 ? 1 : 0.24;
        field[y * width + x] = Math.max(field[y * width + x], intensity * falloff);
      }
    }
  }
  return createFieldTexture(
    THREE,
    "Deterministic high-altitude particulate veil",
    width,
    height,
    (u, v) => {
      const column = Math.min(width - 1, Math.floor(u * width));
      const row = Math.min(height - 1, Math.floor(v * height));
      const edge = Math.pow(Math.max(0, Math.sin(Math.PI * u) * Math.sin(Math.PI * v)), 0.65);
      return field[row * width + column] * edge;
    },
  );
}

/**
 * Builds the deliberately small transparent atmosphere stack for the locked
 * megacity establishing shot. Every volume is a soft alpha-shaped card rather
 * than an intersecting sphere, and every object/material is excluded from RTX
 * geometry collection and primary reflection guides.
 */
export function createMegacityAtmosphere({ THREE, scene, camera }) {
  if (!THREE?.DataTexture || !THREE?.MeshBasicNodeMaterial) {
    throw new TypeError("createMegacityAtmosphere requires the Three.js WebGPU namespace.");
  }
  if (!scene?.add || !camera?.getWorldPosition) {
    throw new TypeError("createMegacityAtmosphere requires a scene and camera.");
  }

  const group = new THREE.Group();
  group.name = "Megacity shaped atmosphere (JS authored)";
  group.userData.rtxIgnore = true;
  scene.add(group);

  const warmTexture = createFieldTexture(
    THREE,
    "Warm backlit crown-smog field",
    256,
    128,
    (u, v) => {
      const x = (u - 0.5) * 2;
      const y = (v - 0.48) * 2;
      // A compact broken ellipse leaves the outer skyline neutral instead of
      // laying one uniform brown wash over the entire background.
      const radius = Math.hypot(x * 1.18, y * 0.94);
      const edge = smoothstep(0.99, 0.39, radius);
      const noise = fractalNoise(u * 4.6, v * 3.6, 0x7138, 5);
      const knots = fractalNoise(u * 8.1, v * 6.3, 0x39a7, 3);
      const billow = smoothstep(0.47, 0.76, noise * 0.74 + knots * 0.26 + edge * 0.13);
      const crownCore = Math.exp(-Math.pow(x / 0.52, 2) - Math.pow((y + 0.02) / 0.68, 2));
      return edge * (0.10 + billow * 0.72 + crownCore * 0.18);
    },
  );
  const cyanTexture = createFieldTexture(
    THREE,
    "Cyan basin height-fog field",
    256,
    96,
    (u, v) => {
      const edge = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.58);
      const noise = fractalNoise(u * 5.2, v * 3.1, 0x92cd, 5);
      const ridge = 0.43 + (noise - 0.5) * 0.34;
      const band = Math.exp(-Math.pow((v - ridge) / 0.36, 2));
      const lowerFade = smoothstep(0.02, 0.18, v);
      const upperFade = 1 - smoothstep(0.76, 1.0, v);
      const wisps = smoothstep(0.28, 0.72, noise + band * 0.16);
      return edge * lowerFade * upperFade * band * (0.56 + wisps * 0.44);
    },
  );
  const shaftTexture = createFieldTexture(
    THREE,
    "Tapered vertical megacity light shaft",
    64,
    256,
    (u, v) => {
      const x = Math.abs(u - 0.5) * 2;
      const halfWidth = 0.15 + (1 - v) * 0.27;
      const lateral = smoothstep(halfWidth + 0.18, halfWidth * 0.36, x);
      const vertical = Math.pow(Math.max(0, Math.sin(Math.PI * v)), 0.72);
      const noise = 0.58 + fractalNoise(u * 2.1, v * 8.3, 0x43fa, 4) * 0.42;
      return lateral * vertical * noise;
    },
  );
  const ceilingTexture = createFieldTexture(
    THREE,
    "Dark storm ceiling field",
    256,
    128,
    (u, v) => {
      const x = (u - 0.5) * 2;
      const y = (v - 0.5) * 2;
      const edge = smoothstep(1.18, 0.62, Math.hypot(x * 0.73, y * 1.15));
      const broad = fractalNoise(u * 3.2, v * 2.2, 0x120d, 5);
      const knots = fractalNoise(u * 7.3, v * 5.4, 0x5b81, 3);
      return edge * smoothstep(0.29, 0.83, broad * 0.72 + knots * 0.28);
    },
  );
  const mistTexture = createFieldTexture(
    THREE,
    "Dark near-rooftop mist field",
    256,
    96,
    (u, v) => {
      const horizontal = Math.pow(Math.max(0, Math.sin(Math.PI * u)), 0.62);
      const vertical = Math.pow(Math.max(0, Math.sin(Math.PI * v)), 1.36);
      const noise = fractalNoise(u * 6.2, v * 3.4, 0xa39e, 5);
      const tornEdge = smoothstep(0.30, 0.72, noise + vertical * 0.18);
      return horizontal * vertical * (0.36 + tornEdge * 0.64);
    },
  );
  const particulateTexture = createParticulateTexture(THREE);
  const textures = [
    warmTexture,
    cyanTexture,
    shaftTexture,
    ceilingTexture,
    mistTexture,
    particulateTexture,
  ];

  const planeGeometry = new THREE.PlaneGeometry(1, 1, 1, 1);
  const geometries = [planeGeometry];
  const materials = [];
  const cards = [];

  function addCard({
    name,
    kind,
    texture,
    color,
    opacity,
    position,
    size,
    blending = THREE.NormalBlending,
    renderOrder,
    phase,
    drift = [0, 0],
    modulation = 0.025,
  }) {
    const material = new THREE.MeshBasicNodeMaterial({
      color,
      transparent: true,
      opacity,
      alphaMap: texture,
      depthWrite: false,
      depthTest: true,
      blending,
      side: THREE.DoubleSide,
      fog: false,
    });
    material.name = `${name} atmosphere material`;
    material.toneMapped = true;
    material.rtxReflectionMask = 0;
    material.userData.rtxIgnore = true;
    materials.push(material);

    const mesh = new THREE.Mesh(planeGeometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.scale.set(size[0], size[1], 1);
    mesh.renderOrder = renderOrder;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.rtxIgnore = true;
    mesh.userData.atmosphereKind = kind;
    group.add(mesh);
    cards.push({
      mesh,
      material,
      baseOpacity: opacity,
      basePosition: new THREE.Vector3(...position),
      phase,
      driftX: drift[0],
      driftY: drift[1],
      modulation,
    });
    return mesh;
  }

  // Back-to-front render orders mirror the world-space depth layers. Soft
  // texture edges keep these enormous cards from exposing rectangular bounds.
  addCard({
    name: "Broad warm orange crown-smog bank",
    kind: "warm-smog",
    texture: warmTexture,
    color: 0xa84f2b,
    opacity: 0.165,
    position: [285, 425, -2760],
    size: [1450, 720],
    renderOrder: -94,
    phase: 0.4,
    drift: [10, 3],
    modulation: 0.035,
  });
  addCard({
    name: "High amber backlight diffusion veil",
    kind: "warm-smog",
    texture: warmTexture,
    color: 0xe69758,
    opacity: 0.072,
    position: [300, 515, -2860],
    size: [780, 520],
    blending: THREE.AdditiveBlending,
    renderOrder: -96,
    phase: 2.1,
    drift: [16, 4],
    modulation: 0.028,
  });

  addCard({
    name: "Rear cyan industrial basin haze",
    kind: "cyan-height-fog",
    texture: cyanTexture,
    color: 0x4b9ca4,
    opacity: 0.195,
    position: [230, 158, -2110],
    size: [2420, 430],
    renderOrder: -82,
    phase: 1.2,
    drift: [13, 2],
  });
  addCard({
    name: "Mid-layer cyan roofline haze",
    kind: "cyan-height-fog",
    texture: cyanTexture,
    color: 0x438b93,
    opacity: 0.135,
    position: [70, 118, -1490],
    size: [2200, 330],
    renderOrder: -68,
    phase: 3.7,
    drift: [9, 1.5],
  });
  addCard({
    name: "Foreground cyan infrastructure mist",
    kind: "cyan-height-fog",
    texture: cyanTexture,
    color: 0x315f66,
    opacity: 0.082,
    position: [-45, 84, -920],
    size: [1920, 245],
    renderOrder: -54,
    phase: 5.4,
    drift: [7, 1],
  });

  addCard({
    name: "Left cyan advertisement-spire shaft",
    kind: "light-shaft",
    texture: shaftTexture,
    color: 0x5fb4bd,
    opacity: 0.062,
    position: [-330, 490, -2500],
    size: [150, 910],
    blending: THREE.AdditiveBlending,
    renderOrder: -78,
    phase: 0.9,
    drift: [1.4, 0],
    modulation: 0.10,
  });
  addCard({
    name: "Central warm crown light shaft",
    kind: "light-shaft",
    texture: shaftTexture,
    color: 0xd89a62,
    opacity: 0.050,
    position: [175, 520, -2590],
    size: [125, 1010],
    blending: THREE.AdditiveBlending,
    renderOrder: -79,
    phase: 2.8,
    drift: [1.1, 0],
    modulation: 0.085,
  });
  addCard({
    name: "Right cyan advertisement-spire shaft",
    kind: "light-shaft",
    texture: shaftTexture,
    color: 0x56aeb8,
    opacity: 0.058,
    position: [670, 545, -2660],
    size: [145, 1080],
    blending: THREE.AdditiveBlending,
    renderOrder: -80,
    phase: 4.6,
    drift: [1.6, 0],
    modulation: 0.095,
  });

  addCard({
    name: "Dark near-rooftop blending mist",
    kind: "near-mist",
    texture: mistTexture,
    color: 0x111a1d,
    opacity: 0.165,
    position: [0, 70, -650],
    size: [2040, 215],
    renderOrder: -38,
    phase: 4.1,
    drift: [8, 0.8],
    modulation: 0.018,
  });
  addCard({
    name: "Heavy dark cloud ceiling",
    kind: "cloud-ceiling",
    texture: ceilingTexture,
    color: 0x11171a,
    opacity: 0.235,
    position: [120, 775, -3440],
    size: [5050, 1420],
    renderOrder: -100,
    phase: 1.8,
    drift: [22, 5],
    modulation: 0.015,
  });
  addCard({
    name: "Subtle high-altitude particulate rain veil",
    kind: "particulate-veil",
    texture: particulateTexture,
    color: 0x8db7b9,
    opacity: 0.020,
    position: [0, 365, -1110],
    size: [2280, 790],
    blending: THREE.AdditiveBlending,
    renderOrder: -45,
    phase: 5.9,
    drift: [3, -1.5],
    modulation: 0.075,
  });

  if (cards.length > 12) {
    throw new Error("Megacity atmosphere exceeded its twelve-draw transparency budget.");
  }

  const cameraPosition = new THREE.Vector3();
  let enabledTarget = 1;
  let enabledBlend = 1;
  let disposed = false;

  function update(elapsed, delta) {
    if (disposed) return;
    const time = Number.isFinite(Number(elapsed)) ? Number(elapsed) : 0;
    const dt = Math.max(0, Math.min(0.05, Number(delta) || 0));
    const smoothing = 1 - Math.exp(-dt * 5.6);
    enabledBlend += (enabledTarget - enabledBlend) * smoothing;
    if (enabledTarget > 0) group.visible = true;
    camera.getWorldPosition(cameraPosition);

    for (const card of cards) {
      const slowPhase = time * 0.018 + card.phase;
      card.mesh.position.x = card.basePosition.x + Math.sin(slowPhase) * card.driftX;
      card.mesh.position.y = card.basePosition.y + Math.sin(slowPhase * 0.73 + 1.4) * card.driftY;
      card.mesh.position.z = card.basePosition.z;
      // Yaw-only billboarding preserves vertical shafts and height-fog strata
      // while accommodating the restrained telephoto orbit presets.
      card.mesh.lookAt(cameraPosition.x, card.mesh.position.y, cameraPosition.z);
      const breathing = 1 + Math.sin(time * 0.11 + card.phase) * card.modulation;
      card.material.opacity = card.baseOpacity * enabledBlend * breathing;
    }
    if (enabledTarget === 0 && enabledBlend < 0.001) group.visible = false;
  }

  function setEnabled(enabled) {
    if (disposed) return;
    enabledTarget = enabled ? 1 : 0;
    if (enabledTarget > 0) group.visible = true;
  }

  const stats = Object.freeze({
    drawCount: cards.length,
    maximumDrawCount: 12,
    textureCount: textures.length,
    geometryCount: geometries.length,
    materialCount: materials.length,
    warmSmogCards: 2,
    cyanHeightFogCards: 3,
    lightShaftCards: 3,
    darkAtmosphereCards: 2,
    particulateCards: 1,
    rtxIgnored: cards.every(card => card.mesh.userData.rtxIgnore),
  });

  update(0, 0);

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.removeFromParent();
    group.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    cards.length = 0;
    materials.length = 0;
    textures.length = 0;
    geometries.length = 0;
  }

  return {
    group,
    update,
    setEnabled,
    dispose,
    stats,
  };
}
