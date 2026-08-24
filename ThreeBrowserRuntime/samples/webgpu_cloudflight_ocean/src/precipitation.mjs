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

export function createPrecipitation(camera, count = 760) {
  const random = seededRandom(0x5a17c10d);
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 2 * 3);
  const droplets = [];
  const worldUp = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const origin = new THREE.Vector3();

  for (let index = 0; index < count; ++index) {
    droplets.push({
      lateral: (random() - 0.5) * 92,
      height: -28 + random() * 74,
      distance: 4 + random() * 86,
      length: 0.24 + random() * 0.96,
      speed: 28 + random() * 46,
      drift: (random() - 0.5) * 4.2,
    });
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const material = new THREE.LineBasicNodeMaterial({
    color: 0xb8d8e5,
    transparent: true,
    opacity: 0,
    depthTest: true,
    // Transparent rain must not own scene depth: doing so punches narrow holes
    // through the later volumetric cloud march and produces sparkling cutouts.
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  const streaks = new THREE.LineSegments(geometry, material);
  streaks.name = "Cloud-sourced world-vertical marine rain field";
  streaks.frustumCulled = false;
  streaks.renderOrder = 85;
  streaks.userData.rtxIgnore = true;
  const scene = camera.parent;
  if (!scene) throw new Error("Precipitation requires the flight camera to be attached to a scene.");
  scene.add(streaks);

  function respawn(drop, rainCeiling, initial = false) {
    drop.lateral = (random() - 0.5) * 92;
    drop.height = initial
      ? -28 + random() * (rainCeiling + 28)
      : rainCeiling - random() * 15;
    drop.distance = 5 + random() * 85;
  }

  function update(delta, intensity = 0, crosswind = 0, weather = {}) {
    const dt = Math.min(Math.max(delta, 0), 0.05);
    const amount = THREE.MathUtils.clamp(Number(intensity) || 0, 0, 1);
    material.opacity = 0.045 + Math.sqrt(amount) * 0.26;
    streaks.visible = amount > 0.015;
    if (!streaks.visible) return;

    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    else forward.normalize();
    right.crossVectors(forward, worldUp).normalize();

    const cloudBase = Number(weather.cloudBase);
    const cloudTop = Number(weather.cloudTop);
    const airspeed = Math.max(0, Number(weather.airspeedMps) || 0);
    const cameraAltitude = camera.getWorldPosition(origin).y;
    const insideCloud = Number.isFinite(cloudBase) && Number.isFinite(cloudTop)
      && cameraAltitude >= cloudBase && cameraAltitude <= cloudTop;
    // Below cloud, drops enter at the visible underside. Inside cloud, the
    // source moves to the overhead portion of the same volume. Clamping keeps
    // the finite field dense enough to read without turning into a snow globe.
    const sourceAboveCamera = Number.isFinite(cloudBase)
      ? (insideCloud ? cloudTop - cameraAltitude : cloudBase - cameraAltitude)
      : 42;
    const rainCeiling = THREE.MathUtils.clamp(sourceAboveCamera, 28, 82);

    for (let index = 0; index < droplets.length; ++index) {
      const drop = droplets[index];
      drop.height -= drop.speed * dt * (0.68 + amount * 0.72);
      drop.lateral += (drop.drift + crosswind * 0.045) * dt;
      // The aircraft crosses the rain volume much faster than the drops fall.
      // Feeding its page-owned airspeed into the field gives the windscreen a
      // convincing closing velocity without moving simulation policy native.
      drop.distance -= (drop.speed * 0.08 + airspeed * 0.34) * dt;
      if (drop.height < -32 || drop.distance < 3 || Math.abs(drop.lateral) > 50) {
        respawn(drop, rainCeiling);
      }

      origin.copy(camera.position)
        .addScaledVector(right, drop.lateral)
        .addScaledVector(forward, drop.distance);
      origin.y = cameraAltitude + drop.height;

      const offset = index * 6;
      positions[offset] = origin.x;
      positions[offset + 1] = origin.y;
      positions[offset + 2] = origin.z;
      const tailForward = drop.length * (0.14 + Math.min(airspeed, 180) * 0.0032);
      positions[offset + 3] = origin.x
        + forward.x * tailForward
        - right.x * crosswind * 0.010;
      positions[offset + 4] = origin.y + drop.length;
      positions[offset + 5] = origin.z
        + forward.z * tailForward
        - right.z * crosswind * 0.010;
    }
    geometry.attributes.position.needsUpdate = true;
  }

  function dispose() {
    scene.remove(streaks);
    geometry.dispose();
    material.dispose();
  }

  return { object: streaks, update, dispose };
}
