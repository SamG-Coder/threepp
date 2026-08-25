import * as THREE from "three/webgpu";

function setCylinderBetween(mesh, start, end) {
  const delta = end.clone().sub(start);
  const length = Math.max(0.001, delta.length());
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.multiplyScalar(1 / length));
}

export function createGameEffects({ scene, world } = {}) {
  const root = new THREE.Group();
  root.name = "Neon City gameplay markers and effects";
  root.userData.rtxIgnore = true;
  scene.add(root);

  const markerMaterials = {
    contact: new THREE.MeshBasicMaterial({ color: 0x23e6ff, transparent: true, opacity: 0.5, depthWrite: false }),
    vehicle: new THREE.MeshBasicMaterial({ color: 0xffd12b, transparent: true, opacity: 0.65, depthWrite: false }),
    dropoff: new THREE.MeshBasicMaterial({ color: 0xff4fa7, transparent: true, opacity: 0.55, depthWrite: false }),
  };
  for (const material of Object.values(markerMaterials)) material.toneMapped = false;
  const markerGeometry = new THREE.CylinderGeometry(2.25, 3.0, 0.18, 32, 1, true);
  const beamGeometry = new THREE.CylinderGeometry(0.24, 1.15, 3.6, 20, 1, true);
  const marker = new THREE.Group();
  const ring = new THREE.Mesh(markerGeometry, markerMaterials.contact);
  ring.position.y = 0.22;
  const beam = new THREE.Mesh(beamGeometry, markerMaterials.contact.clone());
  beam.material.opacity = 0.045;
  beam.position.y = 1.8;
  marker.add(ring, beam);
  marker.visible = false;
  root.add(marker);

  const targetArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.62, 1.15, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd12b, depthTest: false, depthWrite: false }),
  );
  targetArrow.material.toneMapped = false;
  targetArrow.rotation.x = Math.PI;
  targetArrow.renderOrder = 1200;
  targetArrow.visible = false;
  root.add(targetArrow);

  const tracerGeometry = new THREE.CylinderGeometry(0.018, 0.035, 1, 5);
  const tracerMaterial = new THREE.MeshBasicMaterial({ color: 0xffef9a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
  tracerMaterial.toneMapped = false;
  const tracers = Array.from({ length: 16 }, (_, index) => {
    const object = new THREE.Mesh(tracerGeometry, tracerMaterial.clone());
    object.name = `pooled bullet tracer ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    root.add(object);
    return object;
  });
  let tracerCursor = 0;

  const impactGeometry = new THREE.IcosahedronGeometry(0.11, 0);
  const impactFlashes = Array.from({ length: 12 }, (_, index) => {
    const material = new THREE.MeshBasicNodeMaterial({ color: 0xffc36a, transparent: true, opacity: 0, depthWrite: false });
    material.toneMapped = false;
    const object = new THREE.Mesh(impactGeometry, material);
    object.name = `pooled impact flash ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    root.add(object);
    return object;
  });
  let impactCursor = 0;

  const sparkGeometry = new THREE.BoxGeometry(0.025, 0.025, 0.18);
  const sparkMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffc45a });
  sparkMaterial.toneMapped = false;
  const sparks = Array.from({ length: 40 }, (_, index) => {
    const object = new THREE.Mesh(sparkGeometry, sparkMaterial);
    object.name = `pooled impact spark ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let sparkCursor = 0;

  // Human-impact effects are fully pooled at startup so the first collision or
  // gunshot cannot create geometry, materials, or a new WebGPU pipeline while
  // play is live.
  const bloodDropGeometry = new THREE.SphereGeometry(0.055, 6, 4);
  const bloodDropMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0x6d0714,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
  });
  bloodDropMaterial.toneMapped = false;
  const bloodDrops = Array.from({ length: 56 }, (_, index) => {
    const object = new THREE.Mesh(bloodDropGeometry, bloodDropMaterial);
    object.name = `pooled blood droplet ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let bloodDropCursor = 0;

  const bloodPoolGeometry = new THREE.CircleGeometry(1, 18);
  bloodPoolGeometry.rotateX(-Math.PI * 0.5);
  const bloodPools = Array.from({ length: 20 }, (_, index) => {
    const material = new THREE.MeshBasicNodeMaterial({
      color: index % 3 === 0 ? 0x41060c : 0x59070f,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const object = new THREE.Mesh(bloodPoolGeometry, material);
    object.name = `pooled blood ground stain ${index + 1}`;
    object.visible = false;
    object.renderOrder = 5;
    object.userData.life = 0;
    object.userData.maximumLife = 18;
    object.userData.targetScale = 1;
    root.add(object);
    return object;
  });
  let bloodPoolCursor = 0;

  const casingGeometry = new THREE.CylinderGeometry(0.022, 0.022, 0.105, 7);
  const casingMaterial = new THREE.MeshStandardMaterial({ color: 0xd8a64f, roughness: 0.32, metalness: 0.78 });
  const casings = Array.from({ length: 18 }, (_, index) => {
    const object = new THREE.Mesh(casingGeometry, casingMaterial);
    object.name = `pooled brass casing ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let casingCursor = 0;

  const exhaustGeometry = new THREE.SphereGeometry(0.11, 7, 5);
  const exhaustPuffs = Array.from({ length: 22 }, (_, index) => {
    const material = new THREE.MeshBasicNodeMaterial({ color: 0xa9b6bf, transparent: true, opacity: 0, depthWrite: false });
    const object = new THREE.Mesh(exhaustGeometry, material);
    object.name = `pooled exhaust vapour ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let exhaustCursor = 0;
  let lastExhaustAt = -Infinity;

  const damageSmokeGeometry = new THREE.SphereGeometry(0.18, 7, 5);
  const damageSmoke = Array.from({ length: 40 }, (_, index) => {
    const material = new THREE.MeshBasicNodeMaterial({
      color: index % 3 === 0 ? 0x16191d : 0x292d31,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const object = new THREE.Mesh(damageSmokeGeometry, material);
    object.name = `pooled engine damage smoke ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.maximumLife = 1.4;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let damageSmokeCursor = 0;
  const flameGeometry = new THREE.ConeGeometry(0.12, 0.48, 7);
  const engineFlames = Array.from({ length: 18 }, (_, index) => {
    const material = new THREE.MeshBasicNodeMaterial({
      color: index % 3 === 0 ? 0xffe26f : index % 2 ? 0xff4c19 : 0xff8b24,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    material.toneMapped = false;
    const object = new THREE.Mesh(flameGeometry, material);
    object.name = `pooled engine flame ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.maximumLife = 0.32;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let flameCursor = 0;
  const lastDamageAt = new Map();

  const skidGeometry = new THREE.PlaneGeometry(0.18, 1.25);
  skidGeometry.rotateX(-Math.PI * 0.5);
  const skidMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x05070a, transparent: true, opacity: 0.24, depthWrite: false });
  const skidMarks = Array.from({ length: 56 }, (_, index) => {
    const object = new THREE.Mesh(skidGeometry, skidMaterial);
    object.name = `pooled tyre mark ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.renderOrder = 4;
    root.add(object);
    return object;
  });
  let skidCursor = 0;
  let lastSkidAt = -Infinity;

  const sprayGeometry = new THREE.SphereGeometry(0.1, 6, 4);
  const waterSpray = Array.from({ length: 36 }, (_, index) => {
    const material = new THREE.MeshBasicNodeMaterial({
      color: index % 3 === 0 ? 0xd9f3ff : 0x91b9c8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    material.toneMapped = false;
    const object = new THREE.Mesh(sprayGeometry, material);
    object.name = `pooled wet-road spray ${index + 1}`;
    object.visible = false;
    object.userData.life = 0;
    object.userData.maximumLife = 0.4;
    object.userData.velocity = new THREE.Vector3();
    root.add(object);
    return object;
  });
  let sprayCursor = 0;
  let lastSprayAt = -Infinity;
  let effectTime = 0;

  const pickupGeometry = new THREE.OctahedronGeometry(0.42, 0);
  const pickupDefs = [
    { id: "health-park", type: "health", label: "COMMUNITY FIRST AID", color: 0x2fbd78, position: [-54, 0.8, 59], amount: 40 },
    { id: "armor-docks", type: "armor", label: "DOCK SAFETY VEST", color: 0x3d8fc5, position: [108, 0.8, -58], amount: 35 },
    { id: "lost-wallet-alley", type: "lost_property", label: "LOST WALLET", color: 0xc89c45, position: [-20, 0.8, -69], amount: 150 },
  ];
  const pickups = pickupDefs.map((definition, index) => {
    const material = new THREE.MeshStandardMaterial({
      color: definition.color,
      emissive: definition.color,
      emissiveIntensity: 0.24,
      roughness: 0.62,
      metalness: 0.12,
    });
    const object = new THREE.Mesh(pickupGeometry, material);
    object.name = `${definition.type} pickup`;
    object.position.set(...definition.position);
    object.castShadow = true;
    object.userData.baseY = object.position.y;
    root.add(object);
    return { ...definition, object, active: true, respawn: 0, phase: index * 2.1 };
  });

  function setMissionTarget(kind, position, targetObject = null) {
    const visible = Boolean(kind && (position || targetObject));
    marker.visible = visible && kind !== "vehicle";
    targetArrow.visible = visible && kind === "vehicle";
    if (!visible) return;
    const colorMaterial = markerMaterials[kind] ?? markerMaterials.contact;
    if (marker.visible) {
      const value = position?.isVector3 ? position : new THREE.Vector3(...position);
      marker.position.copy(value);
      marker.position.y = Number(world?.terrainHeight?.(value.x, value.z) ?? value.y ?? 0);
      ring.material.color.copy(colorMaterial.color);
      beam.material.color.copy(colorMaterial.color);
    }
    if (targetArrow.visible) {
      const objectPosition = targetObject?.root?.position ?? targetObject?.position;
      const value = objectPosition?.isVector3 ? objectPosition : position?.isVector3 ? position : new THREE.Vector3(...position);
      targetArrow.position.copy(value).add(new THREE.Vector3(0, 3.45, 0));
    }
  }

  function blood(position, { heavy = false, headshot = false, severity = 1, direction = null } = {}) {
    if (!position?.isVector3) return [];
    const amount = Math.max(0.35, Math.min(2.2, Number(severity) || 1));
    const count = Math.min(22, Math.max(7, Math.trunc((heavy ? 14 : 8) * amount + (headshot ? 4 : 0))));
    const spawned = [];
    const directional = direction?.isVector3 && direction.lengthSq() > 0.001 ? direction.clone().normalize() : null;
    for (let index = 0; index < count; ++index) {
      const drop = bloodDrops[bloodDropCursor++ % bloodDrops.length];
      const phase = bloodDropCursor * 2.399963 + index * 1.173;
      const impulse = (1.15 + (index % 5) * 0.44) * (0.72 + amount * 0.42);
      drop.position.copy(position);
      drop.position.x += Math.sin(phase) * 0.035;
      drop.position.z += Math.cos(phase) * 0.035;
      drop.userData.velocity.set(
        Math.sin(phase) * impulse + (directional?.x ?? 0) * impulse * 0.65,
        0.85 + (index % 6) * 0.38 + (headshot ? 0.65 : 0),
        Math.cos(phase) * impulse + (directional?.z ?? 0) * impulse * 0.65,
      );
      drop.userData.life = 0.52 + (index % 5) * 0.055;
      drop.scale.setScalar(0.72 + (index % 4) * 0.16);
      drop.visible = true;
      spawned.push(drop);
    }
    const pool = bloodPools[bloodPoolCursor++ % bloodPools.length];
    pool.position.copy(position);
    pool.position.y = Number(world?.terrainHeight?.(position.x, position.z) ?? 0) + 0.018;
    pool.rotation.y = bloodPoolCursor * 2.399963;
    pool.userData.maximumLife = 15 + (bloodPoolCursor % 5) * 2;
    pool.userData.life = pool.userData.maximumLife;
    pool.userData.targetScale = (heavy ? 0.82 : 0.46) * (0.78 + amount * 0.38);
    pool.scale.setScalar(0.08);
    pool.material.opacity = 0.62;
    pool.visible = true;
    spawned.push(pool);
    return spawned;
  }

  function impact(position, {
    hitPolice = false,
    hitCivilian = false,
    hitVehicle = false,
    heavy = false,
    headshot = false,
    severity = 1,
    direction = null,
  } = {}) {
    if (!position?.isVector3) return [];
    const flash = impactFlashes[impactCursor++ % impactFlashes.length];
    flash.visible = true;
    flash.position.copy(position);
    flash.scale.setScalar(heavy ? 1.35 : 1);
    flash.material.color.setHex(hitPolice ? 0x55b8ff : hitCivilian ? 0xff4e62 : hitVehicle ? 0xffd05a : 0xffa94d);
    flash.material.opacity = 0.92;
    flash.userData.life = heavy ? 0.18 : 0.13;
    const spawned = [flash];
    const hitPerson = hitPolice || hitCivilian;
    if (hitPerson) spawned.push(...blood(position, { heavy, headshot, severity, direction }));
    const sparkCount = hitPerson ? (heavy ? 3 : 1) : heavy ? 8 : 5;
    for (let index = 0; index < sparkCount; ++index) {
      const spark = sparks[sparkCursor++ % sparks.length];
      const phase = sparkCursor * 2.197 + index * 1.11;
      spark.visible = true;
      spark.position.copy(position);
      spark.userData.velocity.set(Math.sin(phase) * (1.6 + index * 0.32), 1.25 + index * 0.36, Math.cos(phase) * (1.6 + index * 0.32));
      spark.rotation.set(phase, phase * 0.7, phase * 1.2);
      spark.userData.life = 0.24 + index * 0.035;
      spawned.push(spark);
    }
    return spawned;
  }

  function shot(start, end, {
    hit = false,
    hitPolice = false,
    hitCivilian = false,
    hitVehicle = false,
    headshot = false,
    damage = 0,
  } = {}) {
    const tracer = tracers[tracerCursor++ % tracers.length];
    setCylinderBetween(tracer, start, end);
    tracer.visible = true;
    tracer.userData.life = hit ? 0.085 : 0.055;
    tracer.material.opacity = 0.95;
    const casing = casings[casingCursor++ % casings.length];
    casing.visible = true;
    casing.position.copy(start).add(new THREE.Vector3(0.12, 0.02, 0));
    const casingPhase = casingCursor * 2.47;
    casing.userData.velocity.set(Math.sin(casingPhase) * 1.4, 2.1 + (casingCursor % 3) * 0.16, Math.cos(casingPhase) * 1.4);
    casing.userData.life = 1.9;
    if (hit) impact(end, {
      hitPolice,
      hitCivilian,
      hitVehicle,
      heavy: headshot || damage >= 55,
      headshot,
      severity: Math.max(0.7, Number(damage) / 42 || 0.7),
      direction: end.clone().sub(start),
    });
    return tracer;
  }

  function collect(playerPosition) {
    const collected = [];
    if (!playerPosition) return collected;
    for (const pickup of pickups) {
      if (!pickup.active || pickup.object.position.distanceToSquared(playerPosition) > 1.8 * 1.8) continue;
      pickup.active = false;
      pickup.respawn = 24;
      pickup.object.visible = false;
      collected.push({ id: pickup.id, type: pickup.type, label: pickup.label, amount: pickup.amount });
    }
    return collected;
  }

  function exhaust(positionValue, yaw = 0, intensity = 0.3) {
    if (!positionValue || effectTime - lastExhaustAt < 0.085) return null;
    lastExhaustAt = effectTime;
    const amount = Math.max(0, Math.min(1, Number(intensity) || 0));
    const object = exhaustPuffs[exhaustCursor++ % exhaustPuffs.length];
    const side = exhaustCursor % 2 ? -0.42 : 0.42;
    const rearX = Math.sin(yaw) * 1.72 + Math.cos(yaw) * side;
    const rearZ = Math.cos(yaw) * 1.72 - Math.sin(yaw) * side;
    object.position.copy(positionValue).add(new THREE.Vector3(rearX, 0.37, rearZ));
    object.userData.velocity.set(Math.sin(yaw) * (0.45 + amount * 0.7), 0.3 + amount * 0.18, Math.cos(yaw) * (0.45 + amount * 0.7));
    object.userData.life = 0.82;
    object.scale.setScalar(0.75 + amount * 0.45);
    object.material.opacity = 0.12 + amount * 0.12;
    object.visible = true;
    return object;
  }

  function vehicleDamage(positionValue, yaw = 0, severity = 0, { id = "vehicle", burning = false } = {}) {
    const amount = Math.max(0, Math.min(1, Number(severity) || 0));
    if (!positionValue || amount < 0.42) return [];
    const key = String(id ?? "vehicle");
    const previous = lastDamageAt.get(key) ?? -Infinity;
    const gap = burning ? 0.045 : 0.085 + (1 - amount) * 0.055;
    if (effectTime - previous < gap) return [];
    lastDamageAt.set(key, effectTime);
    const forwardX = -Math.sin(yaw);
    const forwardZ = -Math.cos(yaw);
    const phase = damageSmokeCursor * 2.399963 + amount * 4.7;
    const smoke = damageSmoke[damageSmokeCursor++ % damageSmoke.length];
    smoke.position.copy(positionValue);
    smoke.position.x += forwardX * 1.18 + Math.cos(yaw) * Math.sin(phase) * 0.16;
    smoke.position.z += forwardZ * 1.18 - Math.sin(yaw) * Math.sin(phase) * 0.16;
    smoke.position.y += 0.62 + amount * 0.26;
    smoke.userData.maximumLife = 1.05 + amount * 0.78;
    smoke.userData.life = smoke.userData.maximumLife;
    smoke.userData.velocity.set(
      forwardX * -0.18 + Math.sin(phase) * 0.22,
      0.62 + amount * 0.68,
      forwardZ * -0.18 + Math.cos(phase) * 0.22,
    );
    smoke.scale.setScalar(0.65 + amount * 0.62);
    smoke.material.opacity = 0.16 + amount * 0.2;
    smoke.visible = true;
    const spawned = [smoke];
    if (burning || amount > 0.86) {
      const flame = engineFlames[flameCursor++ % engineFlames.length];
      flame.position.copy(smoke.position).add(new THREE.Vector3(Math.sin(phase) * 0.14, -0.17, Math.cos(phase) * 0.14));
      flame.userData.maximumLife = 0.2 + (flameCursor % 4) * 0.035;
      flame.userData.life = flame.userData.maximumLife;
      flame.userData.velocity.set(Math.sin(phase) * 0.2, 0.72 + amount * 0.4, Math.cos(phase) * 0.2);
      flame.scale.set(0.75 + amount * 0.34, 0.78 + (flameCursor % 3) * 0.18, 0.75 + amount * 0.34);
      flame.material.opacity = 0.88;
      flame.rotation.y = phase;
      flame.visible = true;
      spawned.push(flame);
    }
    return spawned;
  }

  function skid(positionValue, yaw = 0, width = 1.22, intensity = 1) {
    if (!positionValue || effectTime - lastSkidAt < 0.11 || intensity < 0.18) return [];
    lastSkidAt = effectTime;
    const marks = [];
    for (const side of [-1, 1]) {
      const object = skidMarks[skidCursor++ % skidMarks.length];
      const sideOffset = side * Math.max(0.45, Number(width) || 1.22) * 0.5;
      object.position.copy(positionValue);
      object.position.x += Math.cos(yaw) * sideOffset + Math.sin(yaw) * 1.18;
      object.position.z += -Math.sin(yaw) * sideOffset + Math.cos(yaw) * 1.18;
      object.position.y = Number(world?.terrainHeight?.(object.position.x, object.position.z) ?? object.position.y) + 0.012;
      object.rotation.y = yaw;
      object.scale.set(0.78 + intensity * 0.28, 1, 1);
      object.userData.life = 7.5;
      object.visible = true;
      marks.push(object);
    }
    return marks;
  }

  function tireSpray(positionValue, yaw = 0, width = 1.22, intensity = 1) {
    const amount = Math.max(0, Math.min(1, Number(intensity) || 0));
    if (!positionValue || amount < 0.08 || effectTime - lastSprayAt < 0.045) return [];
    lastSprayAt = effectTime;
    const puffs = [];
    for (const side of [-1, 1]) {
      for (let layer = 0; layer < 2; ++layer) {
        const object = waterSpray[sprayCursor++ % waterSpray.length];
        const sideOffset = side * Math.max(0.55, Number(width) || 1.22) * 0.48;
        const phase = sprayCursor * 2.399 + layer * 0.71;
        object.position.copy(positionValue);
        object.position.x += Math.sin(yaw) * (1.05 + layer * 0.18) + Math.cos(yaw) * sideOffset;
        object.position.z += Math.cos(yaw) * (1.05 + layer * 0.18) - Math.sin(yaw) * sideOffset;
        object.position.y = Number(world?.terrainHeight?.(object.position.x, object.position.z) ?? object.position.y) + 0.16;
        object.userData.velocity.set(
          Math.sin(yaw) * (1.4 + amount * 2.8) + Math.cos(yaw) * side * (0.45 + layer * 0.3) + Math.sin(phase) * 0.18,
          0.75 + amount * 1.25 + layer * 0.2,
          Math.cos(yaw) * (1.4 + amount * 2.8) - Math.sin(yaw) * side * (0.45 + layer * 0.3) + Math.cos(phase) * 0.18,
        );
        object.userData.maximumLife = 0.28 + amount * 0.26 + layer * 0.035;
        object.userData.life = object.userData.maximumLife;
        object.scale.set(0.55, 0.35 + amount * 0.35, 0.95 + amount * 0.9);
        object.material.opacity = 0.08 + amount * 0.17;
        object.visible = true;
        puffs.push(object);
      }
    }
    return puffs;
  }

  function update(delta, elapsed, { targetObject = null, guidanceVisible = true } = {}) {
    const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
    const time = Number(elapsed) || 0;
    effectTime = time;
    marker.visible &&= Boolean(guidanceVisible);
    targetArrow.visible &&= Boolean(guidanceVisible);
    if (marker.visible) {
      marker.rotation.y = time * 0.72;
      ring.scale.setScalar(1 + Math.sin(time * 2.4) * 0.08);
      beam.material.opacity = 0.035 + Math.sin(time * 1.8) * 0.012;
    }
    if (targetArrow.visible && targetObject?.root?.position) {
      targetArrow.position.copy(targetObject.root.position);
      targetArrow.position.y += 3.4 + Math.sin(time * 3) * 0.18;
      targetArrow.rotation.y = time * 1.7;
      targetArrow.rotation.x = Math.PI;
    }
    for (const tracer of tracers) {
      if (!tracer.visible) continue;
      tracer.userData.life -= dt;
      tracer.material.opacity = Math.max(0, tracer.userData.life * 13);
      if (tracer.userData.life <= 0) tracer.visible = false;
    }
    for (const flash of impactFlashes) {
      if (!flash.visible) continue;
      flash.userData.life -= dt;
      flash.material.opacity = Math.max(0, flash.userData.life * 7.5);
      flash.scale.setScalar(1 + (0.13 - flash.userData.life) * 5);
      if (flash.userData.life <= 0) flash.visible = false;
    }
    for (const spark of sparks) {
      if (!spark.visible) continue;
      spark.userData.life -= dt;
      spark.userData.velocity.y -= 12 * dt;
      spark.position.addScaledVector(spark.userData.velocity, dt);
      spark.rotation.x += dt * 18;
      spark.rotation.z += dt * 12;
      const ground = Number(world?.terrainHeight?.(spark.position.x, spark.position.z) ?? 0) + 0.025;
      if (spark.position.y < ground) {
        spark.position.y = ground;
        spark.userData.velocity.y *= -0.24;
        spark.userData.velocity.multiplyScalar(0.62);
      }
      if (spark.userData.life <= 0) spark.visible = false;
    }
    for (const drop of bloodDrops) {
      if (!drop.visible) continue;
      drop.userData.life -= dt;
      drop.userData.velocity.y -= 12.8 * dt;
      drop.position.addScaledVector(drop.userData.velocity, dt);
      drop.rotation.x += dt * 11;
      drop.rotation.z += dt * 8;
      const ground = Number(world?.terrainHeight?.(drop.position.x, drop.position.z) ?? 0) + 0.025;
      if (drop.position.y <= ground || drop.userData.life <= 0) drop.visible = false;
    }
    for (const pool of bloodPools) {
      if (!pool.visible) continue;
      pool.userData.life -= dt;
      const targetScale = Math.max(0.1, Number(pool.userData.targetScale) || 0.5);
      const nextScale = pool.scale.x + (targetScale - pool.scale.x) * (1 - Math.exp(-dt * 3.4));
      pool.scale.set(nextScale, 1, nextScale * (0.64 + (bloodPools.indexOf(pool) % 4) * 0.07));
      pool.material.opacity = Math.min(0.62, Math.max(0, pool.userData.life / 2.4) * 0.62);
      if (pool.userData.life <= 0) pool.visible = false;
    }
    for (const casing of casings) {
      if (!casing.visible) continue;
      casing.userData.life -= dt;
      casing.userData.velocity.y -= 9.8 * dt;
      casing.position.addScaledVector(casing.userData.velocity, dt);
      casing.rotation.x += dt * 13;
      casing.rotation.z += dt * 9;
      const ground = Number(world?.terrainHeight?.(casing.position.x, casing.position.z) ?? 0) + 0.04;
      if (casing.position.y < ground) {
        casing.position.y = ground;
        casing.userData.velocity.y *= -0.31;
        casing.userData.velocity.x *= 0.7;
        casing.userData.velocity.z *= 0.7;
      }
      if (casing.userData.life <= 0) casing.visible = false;
    }
    for (const puff of exhaustPuffs) {
      if (!puff.visible) continue;
      puff.userData.life -= dt;
      puff.position.addScaledVector(puff.userData.velocity, dt);
      puff.userData.velocity.multiplyScalar(Math.exp(-dt * 1.8));
      const age = Math.max(0, 0.82 - puff.userData.life);
      puff.scale.addScalar(dt * (0.55 + age * 0.7));
      puff.material.opacity = Math.max(0, puff.userData.life / 0.82 * 0.2);
      if (puff.userData.life <= 0) puff.visible = false;
    }
    for (const puff of damageSmoke) {
      if (!puff.visible) continue;
      puff.userData.life -= dt;
      puff.position.addScaledVector(puff.userData.velocity, dt);
      puff.userData.velocity.multiplyScalar(Math.exp(-dt * 1.35));
      puff.scale.addScalar(dt * 0.92);
      const ratio = Math.max(0, puff.userData.life / puff.userData.maximumLife);
      puff.material.opacity = Math.sin(Math.min(1, ratio) * Math.PI) * 0.31;
      if (puff.userData.life <= 0) puff.visible = false;
    }
    for (const flame of engineFlames) {
      if (!flame.visible) continue;
      flame.userData.life -= dt;
      flame.position.addScaledVector(flame.userData.velocity, dt);
      flame.scale.x *= Math.exp(-dt * 2.1);
      flame.scale.z *= Math.exp(-dt * 2.1);
      flame.material.opacity = Math.max(0, flame.userData.life / flame.userData.maximumLife);
      if (flame.userData.life <= 0) flame.visible = false;
    }
    for (const mark of skidMarks) {
      if (!mark.visible) continue;
      mark.userData.life -= dt;
      if (mark.userData.life <= 0) mark.visible = false;
    }
    for (const spray of waterSpray) {
      if (!spray.visible) continue;
      spray.userData.life -= dt;
      spray.position.addScaledVector(spray.userData.velocity, dt);
      spray.userData.velocity.y -= 3.2 * dt;
      spray.userData.velocity.multiplyScalar(Math.exp(-dt * 3.6));
      spray.scale.x += dt * 1.7;
      spray.scale.y += dt * 0.8;
      spray.scale.z += dt * 2.3;
      spray.material.opacity = Math.max(0, spray.userData.life / spray.userData.maximumLife * 0.22);
      if (spray.userData.life <= 0) spray.visible = false;
    }
    for (const pickup of pickups) {
      if (!pickup.active) {
        pickup.respawn -= dt;
        if (pickup.respawn <= 0) {
          pickup.active = true;
          pickup.object.visible = true;
        }
        continue;
      }
      pickup.object.rotation.y = time * 1.5 + pickup.phase;
      pickup.object.rotation.x = time * 0.45;
      pickup.object.position.y = pickup.object.userData.baseY + Math.sin(time * 2.2 + pickup.phase) * 0.18;
    }
  }

  function snapshot() {
    const activeEffects = tracers.filter(item => item.visible).length + impactFlashes.filter(item => item.visible).length +
      sparks.filter(item => item.visible).length + casings.filter(item => item.visible).length +
      waterSpray.filter(item => item.visible).length + damageSmoke.filter(item => item.visible).length +
      engineFlames.filter(item => item.visible).length + bloodDrops.filter(item => item.visible).length +
      bloodPools.filter(item => item.visible).length;
    return Object.assign(
      pickups.map(pickup => ({ id: pickup.id, type: pickup.type, active: pickup.active, respawn: pickup.respawn, position: pickup.object.position.toArray() })),
      { activeEffects },
    );
  }

  function dispose() {
    root.removeFromParent();
    markerGeometry.dispose();
    beamGeometry.dispose();
    ring.material.dispose();
    beam.material.dispose();
    targetArrow.geometry.dispose();
    targetArrow.material.dispose();
    tracerGeometry.dispose();
    for (const tracer of tracers) tracer.material.dispose();
    impactGeometry.dispose();
    for (const flash of impactFlashes) flash.material.dispose();
    sparkGeometry.dispose();
    sparkMaterial.dispose();
    bloodDropGeometry.dispose();
    bloodDropMaterial.dispose();
    bloodPoolGeometry.dispose();
    for (const pool of bloodPools) pool.material.dispose();
    casingGeometry.dispose();
    casingMaterial.dispose();
    exhaustGeometry.dispose();
    for (const puff of exhaustPuffs) puff.material.dispose();
    damageSmokeGeometry.dispose();
    for (const puff of damageSmoke) puff.material.dispose();
    flameGeometry.dispose();
    for (const flame of engineFlames) flame.material.dispose();
    skidGeometry.dispose();
    skidMaterial.dispose();
    sprayGeometry.dispose();
    for (const spray of waterSpray) spray.material.dispose();
    pickupGeometry.dispose();
    for (const pickup of pickups) pickup.object.material.dispose();
    for (const material of Object.values(markerMaterials)) material.dispose();
    root.clear();
  }

  return {
    root,
    marker,
    targetArrow,
    pickups,
    setMissionTarget,
    impact,
    blood,
    shot,
    exhaust,
    vehicleDamage,
    skid,
    tireSpray,
    collect,
    update,
    snapshot,
    dispose,
  };
}
