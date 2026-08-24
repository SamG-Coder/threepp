import * as THREE from "three/webgpu";

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

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(Number(value) || 0, minimum), maximum);
}

/**
 * Page-authored wet-windscreen surface.
 *
 * Droplet impact/hold/slide state is simulated on the CPU, drawn into a small
 * offscreen Three.js target, then sampled by the weather compositor. Nothing
 * in this module renders to the swapchain or depends on a native content path.
 */
export function createWindscreenRain({ renderer, size = 512, maxDrops = 112 } = {}) {
  if (!renderer?.render) throw new TypeError("createWindscreenRain requires a Three.js renderer.");

  const random = seededRandom(0x71ad5ce3);
  const targetSize = Math.max(256, Math.min(768, Math.round(size)));
  const target = new THREE.RenderTarget(targetSize, targetSize, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 4,
    generateMipmaps: false,
  });
  target.texture.name = "Cloudflight accumulated windscreen droplets";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;

  const scene = new THREE.Scene();
  scene.name = "Cloudflight JS-only wet windscreen surface";
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2, 2);
  camera.position.z = 1;

  const bodyMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0x9cc8d4,
    transparent: true,
    opacity: 0.33,
    depthTest: false,
    depthWrite: false,
    fog: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  bodyMaterial.name = "Windscreen droplet refractive body mask";
  bodyMaterial.toneMapped = false;
  const glintMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xe9fbff,
    transparent: true,
    opacity: 0.52,
    depthTest: false,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  glintMaterial.name = "Windscreen droplet rim glint";
  glintMaterial.toneMapped = false;

  const bodyGeometry = new THREE.CircleGeometry(1, 28);
  const glintGeometry = new THREE.RingGeometry(0.72, 1, 28);
  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, maxDrops);
  const glints = new THREE.InstancedMesh(glintGeometry, glintMaterial, maxDrops);
  bodies.name = "Accumulated water beads and sliding trails";
  glints.name = "Droplet impact rings and specular rims";
  bodies.frustumCulled = false;
  glints.frustumCulled = false;
  bodies.renderOrder = 1;
  glints.renderOrder = 2;
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bodies, glints);

  const drops = Array.from({ length: maxDrops }, () => ({
    active: false,
    stage: 0,
    age: 0,
    hold: 0,
    u: 0,
    v: 0,
    radius: 0,
    speed: 0,
    drift: 0,
    phase: 0,
  }));
  const dummy = new THREE.Object3D();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  let spawnCarry = 0;
  let previousRain = 0;
  let wetness = 0;
  let disposed = false;

  function activate(drop, rain, prewarm = false) {
    drop.active = true;
    drop.stage = prewarm && random() > 0.28 ? 1 : 0;
    drop.age = prewarm ? random() * 1.8 : 0;
    drop.hold = 0.24 + random() * (1.75 - rain * 0.70);
    drop.u = 0.045 + random() * 0.91;
    drop.v = 0.055 + random() * 0.91;
    drop.radius = 0.0065 + Math.pow(random(), 2.1) * 0.023;
    drop.speed = 0.025 + random() * 0.075;
    drop.drift = (random() - 0.5) * 0.020;
    drop.phase = random() * Math.PI * 2;
  }

  function spawn(rain, prewarm = false) {
    const drop = drops.find(candidate => !candidate.active);
    if (!drop) return false;
    activate(drop, rain, prewarm);
    return true;
  }

  function updateMatrices() {
    let activeCount = 0;
    for (let index = 0; index < drops.length; ++index) {
      const drop = drops[index];
      if (!drop.active) {
        bodies.setMatrixAt(index, hiddenMatrix);
        glints.setMatrixAt(index, hiddenMatrix);
        continue;
      }
      activeCount += 1;
      const impact = drop.stage === 0
        ? clamp(1 - drop.age / 0.13, 0, 1)
        : 0;
      const sliding = drop.stage === 2
        ? clamp((drop.age - drop.hold) * 1.4, 0, 1)
        : 0;
      const pulse = 1 + Math.sin(drop.age * 19 + drop.phase) * 0.055;
      const width = drop.radius * pulse * (1 - sliding * 0.16);
      const height = drop.radius * pulse * (1 + sliding * (1.7 + drop.speed * 8));

      dummy.position.set(drop.u, drop.v, 0);
      dummy.rotation.set(0, 0, -drop.drift * 6);
      dummy.scale.set(width, height, 1);
      dummy.updateMatrix();
      bodies.setMatrixAt(index, dummy.matrix);

      if (impact > 0.01) {
        const ringScale = drop.radius * (1.2 + (1 - impact) * 2.7);
        dummy.position.set(drop.u, drop.v, 0.01);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(ringScale, ringScale, 1);
        dummy.updateMatrix();
        glints.setMatrixAt(index, dummy.matrix);
      } else {
        glints.setMatrixAt(index, hiddenMatrix);
      }
    }
    bodies.instanceMatrix.needsUpdate = true;
    glints.instanceMatrix.needsUpdate = true;
    wetness = clamp(activeCount / Math.max(18, maxDrops * 0.62), 0, 1);
  }

  function update({ delta = 0, rain = 0, rollRadians = 0, airspeedMps = 0, crosswind = 0 } = {}) {
    if (disposed) return;
    const dt = clamp(delta, 0, 0.05);
    const amount = clamp(rain, 0, 1);
    const roll = clamp(rollRadians, -Math.PI * 0.48, Math.PI * 0.48);
    const airflow = clamp(airspeedMps / 105, 0, 1.5);
    const sideWind = clamp(crosswind / 35, -1, 1);

    if (amount > 0.015 && previousRain <= 0.015) {
      const prewarmCount = Math.round(16 + Math.sqrt(amount) * 38);
      for (let index = 0; index < prewarmCount; ++index) spawn(amount, true);
    }
    previousRain = amount;
    spawnCarry += dt * (amount > 0.015 ? 5 + Math.sqrt(amount) * 42 : 0);
    while (spawnCarry >= 1) {
      if (!spawn(amount)) break;
      spawnCarry -= 1;
    }

    const gravityU = -Math.sin(roll);
    const gravityV = Math.max(0.22, Math.cos(roll));
    for (const drop of drops) {
      if (!drop.active) continue;
      drop.age += dt;
      if (drop.stage === 0 && drop.age >= 0.13) drop.stage = 1;
      if (drop.stage === 1 && drop.age >= drop.hold) drop.stage = 2;
      if (drop.stage === 2) {
        drop.speed = Math.min(0.34, drop.speed + dt * (0.038 + drop.radius * 1.8));
        const gravity = drop.speed * dt;
        drop.u += gravityU * gravity * 0.42
          + sideWind * dt * 0.004
          + Math.sin(drop.age * 5.1 + drop.phase) * dt * 0.0014;
        // Gravity draws beads down the pane; aircraft airflow stretches them
        // into short trails without unrealistically blowing them upward.
        drop.v -= gravityV * gravity * (0.78 + airflow * 0.16);
        drop.u += drop.drift * dt * (0.35 + airflow * 0.15);
      }
      const evaporateAge = amount > 0.015 ? 9.5 : 4.2;
      if (drop.v < -0.07 || drop.u < -0.08 || drop.u > 1.08 || drop.age > evaporateAge) {
        drop.active = false;
      }
    }

    // Nearby sliding beads coalesce into a larger, faster trail. Limit the
    // merge scan to the small fixed pool; no allocation occurs per frame.
    for (let first = 0; first < drops.length; ++first) {
      const a = drops[first];
      if (!a.active || a.stage !== 2) continue;
      for (let second = first + 1; second < drops.length; ++second) {
        const b = drops[second];
        if (!b.active || b.stage !== 2) continue;
        const du = a.u - b.u;
        const dv = a.v - b.v;
        const mergeRadius = (a.radius + b.radius) * 0.52;
        if (du * du + dv * dv > mergeRadius * mergeRadius) continue;
        const combinedArea = a.radius * a.radius + b.radius * b.radius;
        a.u = (a.u + b.u) * 0.5;
        a.v = Math.min(a.v, b.v);
        a.radius = Math.min(0.038, Math.sqrt(combinedArea));
        a.speed = Math.max(a.speed, b.speed) * 1.08;
        b.active = false;
      }
    }
    updateMatrices();
  }

  function renderToTexture() {
    if (disposed) return target.texture;
    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.setMRT(null);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.clear(true, false, false);
      renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMrt);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
    }
    return target.texture;
  }

  updateMatrices();

  return {
    target,
    texture: target.texture,
    update,
    renderToTexture,
    get wetness() {
      return wetness;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      bodies.removeFromParent();
      glints.removeFromParent();
      bodyGeometry.dispose();
      glintGeometry.dispose();
      bodyMaterial.dispose();
      glintMaterial.dispose();
      target.dispose();
    },
  };
}

export default createWindscreenRain;
