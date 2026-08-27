import * as THREE from "three/webgpu";
import {
  cloneAtlasTexture,
  loadCutout,
  loadMask,
} from "./assets.mjs";

const WALKER_PATHS = Object.freeze([
  "people/walk-student-raincoat.png",
  "people/walk-courier.png",
  "people/walk-elder-umbrella.png",
  "people/walk-night-worker.png",
  "people/walk-office-worker-umbrella.png",
]);

const SOLO_PEDESTRIAN_MODE = true;

const VEHICLE_DEFS = Object.freeze([
  // Assets that imply perspective depth stay loaded for provenance, but are not
  // placed in the world until Grok replaces them with strict broadside cards.
  { asset: "vehicles/city-bus-left.png", direction: -1, lane: "near", height: 2.55, maxWidth: 8.8, speed: 5.2, stop: "bus", hiddenUntilFlat: true },
  { asset: "vehicles/taxi-sedan-left.png", direction: -1, lane: "near", height: 1.48, maxWidth: 4.9, speed: 6.8, stop: "taxi", hiddenUntilFlat: true },
  { asset: "vehicles/delivery-van-left.png", direction: -1, lane: "near", height: 1.94, maxWidth: 5.6, speed: 5.9, hiddenUntilFlat: true },
  { asset: "vehicles/black-sedan.png", direction: -1, lane: "near", height: 1.46, maxWidth: 5.0, speed: 7.3, mirror: true, hiddenUntilFlat: true },
  { asset: "vehicles/service-truck.png", direction: -1, lane: "near", height: 2.14, maxWidth: 6.3, speed: 5.4, mirror: true, hiddenUntilFlat: true },
  { asset: "vehicles/city-bus-right.png", direction: 1, lane: "far", height: 2.55, maxWidth: 8.8, speed: 5.0, stop: "bus", hiddenUntilFlat: true },
  { asset: "vehicles/taxi-sedan-right.png", direction: 1, lane: "far", height: 1.48, maxWidth: 4.9, speed: 7.0, stop: "taxi", hiddenUntilFlat: true },
  { asset: "vehicles/delivery-van-right.png", direction: 1, lane: "far", height: 1.94, maxWidth: 5.6, speed: 5.7, hiddenUntilFlat: true },
  { asset: "vehicles/compact-hatch.png", direction: 1, lane: "far", height: 1.43, maxWidth: 4.5, speed: 7.5, hiddenUntilFlat: true },
  { asset: "vehicles/motor-scooter.png", direction: 1, lane: "far", height: 1.24, maxWidth: 2.2, speed: 6.2, hiddenUntilFlat: true },
  { asset: "vehicles/parked-wagon.png", direction: 1, lane: "far", height: 1.5, maxWidth: 4.85, speed: 0 },
]);

function actorMaterial(texture, name, emissiveIntensity = 0.035) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name,
    map: texture,
    emissiveMap: texture,
    color: 0xd9e4ea,
    emissive: 0xc9d9e2,
    emissiveIntensity,
    roughness: 0.78,
    metalness: 0,
    clearcoat: 0.34,
    clearcoatRoughness: 0.19,
    transparent: false,
    alphaTest: 0.13,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.alphaToCoverage = true;
  material.rtxReflectionMask = 0.07;
  material.userData.rtxIgnore = true;
  return material;
}

function setAtlasFrame(texture, frame) {
  const normalized = ((Math.trunc(frame) % 8) + 8) % 8;
  const column = normalized % 4;
  const row = Math.floor(normalized / 4);
  const insetX = Number(texture.userData.atlasInsetX) || 0;
  const insetY = Number(texture.userData.atlasInsetY) || 0;
  texture.offset.x = column * 0.25 + insetX;
  texture.offset.y = (row === 0 ? 0.5 : 0) + insetY;
}

function makeVerticalCard(geometry, material, width, height, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.rotation.y = Math.PI;
  mesh.position.y = height * 0.5;
  mesh.scale.set(width, height, 1);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 18;
  mesh.userData.flatImageCard = true;
  return mesh;
}

function makeContactShadow(geometry, material, width, depth, name) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.position.y = 0.012;
  mesh.scale.set(width, depth, 1);
  mesh.renderOrder = 12;
  mesh.frustumCulled = false;
  mesh.userData.flatImageSurface = true;
  return mesh;
}

function approach(current, target, response, delta) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-Math.max(0, delta) * response));
}

function personCardWidth(asset, height, maximumAspect = 0.5) {
  const frameAspect = THREE.MathUtils.clamp(asset.aspect * 0.5, 0.34, maximumAspect);
  return frameAspect * height;
}

export async function createDowntownActors(scene, config, input) {
  const group = new THREE.Group();
  group.name = "Animated Grok 2D city life";
  const unitCard = new THREE.PlaneGeometry(1, 1, 1, 2);
  const unitGround = new THREE.PlaneGeometry(1, 1);
  const materials = [];
  const atlasTextures = [];
  let rainEnabled = true;

  const [playerAsset, walkerAssets, vehicleAssets, shadowAsset, sprayAsset] = await Promise.all([
    loadCutout("people/walk-streetwise-player.png", { crop: false, safeAtlas: true }),
    Promise.all(WALKER_PATHS.map(path => loadCutout(path, { crop: false, safeAtlas: true }))),
    Promise.all(VEHICLE_DEFS.map(def => loadCutout(def.asset))),
    loadMask("weather/contact-shadow-soft.png"),
    loadCutout("weather/tire-spray.png"),
  ]);

  const shadowMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Grok soft contact-shadow mask",
    color: 0x000000,
    alphaMap: shadowAsset.texture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  shadowMaterial.userData.rtxIgnore = true;
  materials.push(shadowMaterial);

  const sprayMaterial = new THREE.MeshBasicNodeMaterial({
    name: "Grok tire-spray card",
    map: sprayAsset.texture,
    color: 0xb8d7e8,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: true,
    toneMapped: true,
  });
  sprayMaterial.userData.rtxIgnore = true;
  materials.push(sprayMaterial);

  const playerRoot = new THREE.Group();
  playerRoot.name = "Controllable streetwise lead";
  playerRoot.position.set(...config.world.playerStart);
  const playerTexture = cloneAtlasTexture(playerAsset);
  atlasTextures.push(playerTexture);
  const playerMaterial = actorMaterial(playerTexture, "Streetwise lead atlas", 0.18);
  materials.push(playerMaterial);
  const playerHeight = 1.88;
  const playerWidth = personCardWidth(playerAsset, playerHeight, 0.5);
  const playerMesh = makeVerticalCard(
    unitCard,
    playerMaterial,
    playerWidth,
    playerHeight,
    "Original streetwise protagonist",
  );
  playerRoot.add(playerMesh);
  playerRoot.add(makeContactShadow(unitGround, shadowMaterial, 1.12, 0.54, "Player Grok contact shadow"));
  group.add(playerRoot);

  const playerVelocity = new THREE.Vector3();
  let playerGait = 0;
  let playerFacing = 1;
  const player = {
    root: playerRoot,
    mesh: playerMesh,
    position: playerRoot.position,
    velocity: playerVelocity,
    update(delta) {
      const axis = input.flyMode ? { x: 0, z: 0, boost: false } : input.walkAxis();
      const speed = axis.boost ? 3.55 : 1.72;
      const desiredX = -axis.x * speed;
      const desiredZ = axis.z * speed * 0.72;
      playerVelocity.x = approach(playerVelocity.x, desiredX, 9.5, delta);
      playerVelocity.z = approach(playerVelocity.z, desiredZ, 9.5, delta);
      const beforeX = playerRoot.position.x;
      const beforeZ = playerRoot.position.z;
      playerRoot.position.x = THREE.MathUtils.clamp(
        playerRoot.position.x + playerVelocity.x * delta,
        config.world.minX + 4,
        config.world.maxX - 4,
      );
      playerRoot.position.z = THREE.MathUtils.clamp(
        playerRoot.position.z + playerVelocity.z * delta,
        config.world.farSidewalkZ[0] + 1.15,
        config.world.farSidewalkZ[1] - 1.0,
      );
      const dx = playerRoot.position.x - beforeX;
      const dz = playerRoot.position.z - beforeZ;
      const distance = Math.hypot(dx, dz);
      if (Math.abs(playerVelocity.x) > 0.08) {
        playerFacing = playerVelocity.x < 0 ? 1 : -1;
      }
      playerMesh.scale.x = playerWidth * playerFacing;
      if (distance > 0.0001) {
        playerGait += distance * (8 / 1.38);
        setAtlasFrame(playerTexture, Math.floor(playerGait) % 8);
        playerMesh.position.y = playerHeight * 0.5 + Math.sin(playerGait * Math.PI * 0.5) * 0.014;
        playerMesh.rotation.z = THREE.MathUtils.clamp(-playerVelocity.x * 0.012, -0.025, 0.025);
      } else {
        setAtlasFrame(playerTexture, 0);
        playerMesh.position.y = playerHeight * 0.5;
        playerMesh.rotation.z = approach(playerMesh.rotation.z, 0, 12, delta);
      }
      playerRoot.renderOrder = 20 + Math.round((14.6 - playerRoot.position.z) * 2);
    },
  };

  const walkers = [];
  const walkerCount = SOLO_PEDESTRIAN_MODE ? 0 : 10;
  for (let index = 0; index < walkerCount; ++index) {
    const asset = walkerAssets[index % walkerAssets.length];
    const texture = cloneAtlasTexture(asset);
    atlasTextures.push(texture);
    const material = actorMaterial(texture, "Rain walker " + (index + 1), 0.12);
    materials.push(material);
    const height = 1.66 + (index % 4) * 0.055;
    const width = personCardWidth(asset, height, 0.48);
    const root = new THREE.Group();
    root.name = "Sidewalk walker " + (index + 1);
    const screenDirection = index < 5 ? 1 : -1;
    const worldDirection = -screenDirection;
    const laneIndex = index < 5 ? index : index - 5;
    root.position.set(
      config.world.minX + 12 + laneIndex * 41 + (index >= 5 ? 17 : 0),
      0.14,
      index < 5 ? 9.0 : 11.8,
    );
    const mesh = makeVerticalCard(unitCard, material, width, height, root.name + " image");
    mesh.scale.x = width * screenDirection;
    root.add(mesh);
    root.add(makeContactShadow(unitGround, shadowMaterial, width * 0.72, 0.42, root.name + " shadow"));
    group.add(root);
    walkers.push({
      root,
      mesh,
      texture,
      width,
      screenDirection,
      worldDirection,
      speed: 0.86 + (index % 4) * 0.055,
      currentSpeed: 0,
      gait: index * 1.7,
      phase: index * 2.37,
    });
  }

  const vehicles = [];
  VEHICLE_DEFS.forEach((def, index) => {
    const asset = vehicleAssets[index];
    const material = actorMaterial(asset.texture, "Traffic profile — " + def.asset, 0.1);
    material.roughness = 0.63;
    materials.push(material);
    const width = Math.min(asset.aspect * def.height, def.maxWidth);
    const root = new THREE.Group();
    root.name = "Traffic — " + def.asset;
    const laneIndex = def.lane === "near"
      ? VEHICLE_DEFS.slice(0, index).filter(item => item.lane === "near").length
      : VEHICLE_DEFS.slice(0, index).filter(item => item.lane === "far").length;
    const laneCount = VEHICLE_DEFS.filter(item => item.lane === def.lane).length;
    const span = config.world.maxX - config.world.minX + 38;
    const x = config.world.minX - 19 + ((laneIndex + 0.35) / laneCount) * span;
    const z = def.lane === "near" ? -1.8 : 3.0;
    root.position.set(x, 0.055, z);
    root.visible = !def.hiddenUntilFlat;
    const mesh = makeVerticalCard(unitCard, material, width, def.height, root.name + " image");
    const authoredDirection = def.asset.includes("-left") ? -1 : 1;
    const flip = authoredDirection === def.direction ? 1 : -1;
    mesh.scale.x = width * flip;
    mesh.visible = !def.hiddenUntilFlat;
    root.add(mesh);
    root.add(makeContactShadow(unitGround, shadowMaterial, width * 0.78, 0.72, root.name + " shadow"));
    const sprayHeight = Math.max(0.62, def.height * 0.43);
    const sprayWidth = sprayAsset.aspect * sprayHeight;
    const spray = makeVerticalCard(
      unitCard,
      sprayMaterial,
      sprayWidth,
      sprayHeight,
      root.name + " tire spray",
    );
    spray.castShadow = false;
    spray.material = sprayMaterial;
    spray.renderOrder = 28;
    spray.visible = rainEnabled && !def.hiddenUntilFlat && def.speed > 0;
    group.add(root, spray);
    vehicles.push({
      def,
      root,
      mesh,
      spray,
      width,
      sprayWidth,
      currentSpeed: def.speed,
      phase: index * 1.91,
    });
  });

  scene.add(group);

  function stopMultiplier(vehicle, time) {
    const stopX = vehicle.def.stop === "bus" ? 63 : vehicle.def.stop === "taxi" ? -19 : null;
    if (stopX === null) return 1;
    const distance = Math.abs(vehicle.root.position.x - stopX);
    const cycle = (time + vehicle.phase * 2.7) % (vehicle.def.stop === "bus" ? 29 : 23);
    const dwell = vehicle.def.stop === "bus" ? 6.3 : 3.4;
    if (distance < 2.2 && cycle < dwell) return 0;
    if (distance < 7 && cycle < dwell + 1.3) return 0.28;
    return 1;
  }

  function updateWalkers(time, delta) {
    const minX = config.world.minX - 10;
    const maxX = config.world.maxX + 10;
    for (let index = 0; index < walkers.length; ++index) {
      const walker = walkers[index];
      const pauseWave = Math.sin(time * 0.41 + walker.phase);
      const pause = pauseWave > 0.965 ? 0 : 1;
      const targetSpeed = walker.speed * pause;
      walker.currentSpeed = approach(walker.currentSpeed, targetSpeed, pause ? 4.2 : 10, delta);
      const distance = walker.currentSpeed * delta;
      walker.root.position.x += walker.worldDirection * distance;
      if (walker.root.position.x < minX) walker.root.position.x = maxX;
      if (walker.root.position.x > maxX) walker.root.position.x = minX;
      if (distance > 0.0001) {
        walker.gait += distance * (4 / 1.32);
        setAtlasFrame(walker.texture, Math.floor(walker.gait) % 4);
        walker.mesh.position.y = (walker.mesh.scale.y * 0.5)
          + Math.sin(walker.gait * Math.PI * 0.5) * 0.011;
        walker.mesh.rotation.z = THREE.MathUtils.clamp(
          -walker.currentSpeed * walker.worldDirection * 0.009,
          -0.014,
          0.014,
        );
      } else {
        setAtlasFrame(walker.texture, 0);
        walker.mesh.position.y = walker.mesh.scale.y * 0.5;
        walker.mesh.rotation.z = approach(walker.mesh.rotation.z, 0, 10, delta);
      }
      walker.root.position.z += Math.sin(time * 0.19 + walker.phase) * delta * 0.018;
    }
  }

  function updateVehicles(time, delta) {
    const minX = config.world.minX - 24;
    const maxX = config.world.maxX + 24;
    for (const vehicle of vehicles) {
      const targetSpeed = vehicle.def.speed * stopMultiplier(vehicle, time);
      vehicle.currentSpeed = approach(vehicle.currentSpeed, targetSpeed, 3.4, delta);
      const worldDirection = -vehicle.def.direction;
      vehicle.root.position.x += worldDirection * vehicle.currentSpeed * delta;
      if (vehicle.root.position.x < minX) vehicle.root.position.x = maxX;
      if (vehicle.root.position.x > maxX) vehicle.root.position.x = minX;
      const shimmer = 0.92 + Math.sin(time * 7.1 + vehicle.phase) * 0.08;
      const behindX = vehicle.root.position.x + vehicle.def.direction * (vehicle.width * 0.54);
      vehicle.spray.position.set(
        behindX,
        0.055 + Math.max(0.62, vehicle.def.height * 0.43) * 0.5,
        vehicle.root.position.z + 0.025,
      );
      vehicle.spray.scale.x = vehicle.sprayWidth * vehicle.def.direction;
      vehicle.spray.scale.y = Math.max(0.62, vehicle.def.height * 0.43) * shimmer;
      vehicle.spray.visible = rainEnabled && !vehicle.def.hiddenUntilFlat && vehicle.currentSpeed > 0.5;
    }
  }

  return {
    group,
    player,
    walkers,
    vehicles,
    update(time, delta) {
      player.update(delta);
      updateWalkers(time, delta);
      updateVehicles(time, delta);
    },
    setRainEnabled(enabled) {
      rainEnabled = Boolean(enabled);
      for (const vehicle of vehicles) {
        vehicle.spray.visible = rainEnabled && !vehicle.def.hiddenUntilFlat && vehicle.currentSpeed > 0.5;
      }
    },
    dispose() {
      scene.remove(group);
      unitCard.dispose();
      unitGround.dispose();
      for (const texture of atlasTextures) texture.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
