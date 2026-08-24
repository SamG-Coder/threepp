import * as THREE_DEFAULT from "three/webgpu";

const sharedByNamespace = new WeakMap();

function material(THREE, cache, key, color, roughness = 0.72, metalness = 0) {
  if (!cache.has(key)) {
    const value = new THREE.MeshStandardNodeMaterial({ color, roughness, metalness });
    value.name = `Medieval shared ${key}`;
    cache.set(key, value);
  }
  return cache.get(key);
}

function sharedAssets(THREE) {
  if (sharedByNamespace.has(THREE)) return sharedByNamespace.get(THREE);
  const geometries = Object.freeze({
    head: new THREE.SphereGeometry(0.22, 12, 8),
    neck: new THREE.CylinderGeometry(0.09, 0.1, 0.15, 8),
    torso: new THREE.BoxGeometry(0.62, 0.72, 0.32),
    pelvis: new THREE.BoxGeometry(0.48, 0.3, 0.3),
    upperLimb: new THREE.CylinderGeometry(0.09, 0.105, 0.48, 8),
    lowerLimb: new THREE.CylinderGeometry(0.075, 0.09, 0.45, 8),
    hand: new THREE.SphereGeometry(0.095, 8, 6),
    boot: new THREE.BoxGeometry(0.18, 0.18, 0.34),
    shoulder: new THREE.SphereGeometry(0.15, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55),
    helmet: new THREE.SphereGeometry(0.245, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.64),
    swordBlade: new THREE.BoxGeometry(0.055, 0.86, 0.025),
    greatBlade: new THREE.BoxGeometry(0.085, 1.25, 0.04),
    grip: new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8),
    pommel: new THREE.SphereGeometry(0.055, 8, 6),
    guard: new THREE.BoxGeometry(0.38, 0.045, 0.06),
    shield: new THREE.CylinderGeometry(0.4, 0.4, 0.085, 16),
    shieldBoss: new THREE.SphereGeometry(0.115, 10, 6),
    crossbowStock: new THREE.BoxGeometry(0.1, 0.12, 0.86),
    crossbowLimb: new THREE.BoxGeometry(0.82, 0.055, 0.07),
    crossbowString: new THREE.CylinderGeometry(0.008, 0.008, 0.9, 5),
    quiver: new THREE.CylinderGeometry(0.1, 0.12, 0.62, 8),
    arrow: new THREE.CylinderGeometry(0.012, 0.012, 0.72, 5),
  });
  const result = { geometries, materials: new Map() };
  sharedByNamespace.set(THREE, result);
  return result;
}

function mesh(THREE, geometry, materialValue, name) {
  const result = new THREE.Mesh(geometry, materialValue);
  result.name = name;
  result.castShadow = true;
  result.receiveShadow = true;
  result.userData.rtxIgnore = true;
  return result;
}

function socket(THREE, parent, name, position) {
  const value = new THREE.Group();
  value.name = name;
  value.position.fromArray(position);
  value.userData.rtxIgnore = true;
  parent.add(value);
  return value;
}

function attach(object, parent, position, rotation, scale = [1, 1, 1]) {
  parent.add(object);
  object.position.fromArray(position);
  object.rotation.set(...rotation);
  object.scale.fromArray(scale);
  object.visible = true;
}

function createSword(THREE, assets, great = false) {
  const root = new THREE.Group();
  root.name = great ? "Visible two-handed greatsword" : "Visible arming sword";
  const steel = material(THREE, assets.materials, "weapon-steel", 0x9ca7aa, 0.2, 0.9);
  const darkSteel = material(THREE, assets.materials, "weapon-dark-steel", 0x3b4144, 0.28, 0.88);
  const leather = material(THREE, assets.materials, "weapon-leather", 0x3b2116, 0.88, 0);
  const blade = mesh(THREE, great ? assets.geometries.greatBlade : assets.geometries.swordBlade, steel, "Forged blade");
  blade.position.y = great ? 0.78 : 0.56;
  const guard = mesh(THREE, assets.geometries.guard, darkSteel, "Crossguard");
  guard.position.y = great ? 0.12 : 0.09;
  guard.scale.x = great ? 1.24 : 0.9;
  const grip = mesh(THREE, assets.geometries.grip, leather, "Leather grip");
  grip.position.y = great ? -0.14 : -0.12;
  grip.scale.y = great ? 1.45 : 1;
  const pommel = mesh(THREE, assets.geometries.pommel, darkSteel, "Pommel");
  pommel.position.y = great ? -0.4 : -0.32;
  root.add(blade, guard, grip, pommel);
  return root;
}

function createShield(THREE, assets) {
  const root = new THREE.Group();
  root.name = "Visible shield";
  const wood = material(THREE, assets.materials, "shield-wood", 0x4f2917, 0.82, 0);
  const iron = material(THREE, assets.materials, "shield-iron", 0x50595b, 0.3, 0.78);
  const board = mesh(THREE, assets.geometries.shield, wood, "Round shield board");
  board.rotation.x = Math.PI / 2;
  board.scale.y = 1.15;
  const boss = mesh(THREE, assets.geometries.shieldBoss, iron, "Shield boss");
  boss.position.z = 0.07;
  root.add(board, boss);
  return root;
}

function createCrossbow(THREE, assets) {
  const root = new THREE.Group();
  root.name = "Visible hunting crossbow";
  const wood = material(THREE, assets.materials, "crossbow-wood", 0x4b2c1d, 0.78, 0);
  const iron = material(THREE, assets.materials, "crossbow-iron", 0x4d5658, 0.28, 0.82);
  const stringMaterial = material(THREE, assets.materials, "crossbow-string", 0x201b18, 0.95, 0);
  const stock = mesh(THREE, assets.geometries.crossbowStock, wood, "Crossbow stock");
  stock.position.z = -0.22;
  const limb = mesh(THREE, assets.geometries.crossbowLimb, iron, "Crossbow prod");
  limb.position.z = 0.15;
  const stringLeft = mesh(THREE, assets.geometries.crossbowString, stringMaterial, "Crossbow string left");
  const stringRight = mesh(THREE, assets.geometries.crossbowString, stringMaterial, "Crossbow string right");
  stringLeft.scale.y = stringRight.scale.y = 0.58;
  stringLeft.position.set(-0.21, 0, -0.04);
  stringRight.position.set(0.21, 0, -0.04);
  stringLeft.rotation.z = -0.76;
  stringRight.rotation.z = 0.76;
  const bolt = mesh(THREE, assets.geometries.arrow, iron, "Loaded bolt");
  bolt.rotation.x = Math.PI / 2;
  bolt.position.z = -0.08;
  root.add(stock, limb, stringLeft, stringRight, bolt);
  return root;
}

function createQuiver(THREE, assets) {
  const root = new THREE.Group();
  root.name = "Visible bolt quiver";
  const leather = material(THREE, assets.materials, "quiver-leather", 0x3a2118, 0.9, 0);
  root.add(mesh(THREE, assets.geometries.quiver, leather, "Bolt quiver"));
  return root;
}

function makeLimb(THREE, assets, skin, cloth, side, upperGeometry, lowerGeometry) {
  const upper = new THREE.Group();
  upper.name = `${side} upper limb pivot`;
  const upperMesh = mesh(THREE, upperGeometry, cloth, `${side} upper limb`);
  upperMesh.position.y = -0.23;
  upper.add(upperMesh);
  const lower = new THREE.Group();
  lower.name = `${side} lower limb pivot`;
  lower.position.y = -0.46;
  const lowerMesh = mesh(THREE, lowerGeometry, cloth, `${side} lower limb`);
  lowerMesh.position.y = -0.21;
  const hand = mesh(THREE, assets.geometries.hand, skin, `${side} hand`);
  hand.position.y = -0.45;
  lower.add(lowerMesh, hand);
  upper.add(lower);
  return { upper, lower, upperMesh, lowerMesh, hand };
}

export function createEquipmentRig({
  THREE: THREE_NS = THREE_DEFAULT,
  name = "Procedural humanoid",
  palette = {},
  loadout = {},
  scale = 1,
} = {}) {
  const THREE = THREE_NS;
  const assets = sharedAssets(THREE);
  const skin = material(THREE, assets.materials, `skin-${palette.skin ?? 0xb8896b}`, palette.skin ?? 0xb8896b, 0.86, 0);
  const cloth = material(THREE, assets.materials, `cloth-${palette.cloth ?? 0x29343a}`, palette.cloth ?? 0x29343a, 0.9, 0);
  const leather = material(THREE, assets.materials, `leather-${palette.leather ?? 0x4a2e20}`, palette.leather ?? 0x4a2e20, 0.84, 0);
  const plate = material(THREE, assets.materials, `plate-${palette.plate ?? 0x596164}`, palette.plate ?? 0x596164, 0.3, 0.78);
  const hair = material(THREE, assets.materials, `hair-${palette.hair ?? 0x271a14}`, palette.hair ?? 0x271a14, 0.94, 0);

  const root = new THREE.Group();
  root.name = name;
  root.scale.setScalar(scale);
  root.userData.rtxIgnore = true;
  root.userData.dynamicActor = true;

  const hips = new THREE.Group();
  hips.name = "Humanoid hips";
  hips.position.y = 1.02;
  const pelvis = mesh(THREE, assets.geometries.pelvis, leather, "Visible belt and pelvis");
  hips.add(pelvis);

  const torso = new THREE.Group();
  torso.name = "Humanoid torso";
  torso.position.y = 0.52;
  const torsoMesh = mesh(THREE, assets.geometries.torso, cloth, "Visible tunic or cuirass");
  torso.add(torsoMesh);
  hips.add(torso);

  const neck = mesh(THREE, assets.geometries.neck, skin, "Neck");
  neck.position.y = 0.46;
  const head = mesh(THREE, assets.geometries.head, skin, "Visible head");
  head.position.y = 0.69;
  const hairCap = mesh(THREE, assets.geometries.helmet, hair, "Hair");
  hairCap.position.y = 0.75;
  hairCap.scale.set(0.91, 0.72, 0.91);
  const helmet = mesh(THREE, assets.geometries.helmet, plate, "Visible helmet");
  helmet.position.y = 0.76;
  helmet.visible = false;
  torso.add(neck, head, hairCap, helmet);

  const leftArm = makeLimb(THREE, assets, skin, cloth, "left", assets.geometries.upperLimb, assets.geometries.lowerLimb);
  const rightArm = makeLimb(THREE, assets, skin, cloth, "right", assets.geometries.upperLimb, assets.geometries.lowerLimb);
  leftArm.upper.position.set(-0.4, 0.31, 0);
  rightArm.upper.position.set(0.4, 0.31, 0);
  torso.add(leftArm.upper, rightArm.upper);

  const leftLeg = makeLimb(THREE, assets, skin, leather, "left leg", assets.geometries.upperLimb, assets.geometries.lowerLimb);
  const rightLeg = makeLimb(THREE, assets, skin, leather, "right leg", assets.geometries.upperLimb, assets.geometries.lowerLimb);
  leftLeg.upper.position.set(-0.17, -0.15, 0);
  rightLeg.upper.position.set(0.17, -0.15, 0);
  const leftBoot = mesh(THREE, assets.geometries.boot, leather, "Left boot");
  const rightBoot = mesh(THREE, assets.geometries.boot, leather, "Right boot");
  leftBoot.position.set(0, -0.48, 0.08);
  rightBoot.position.set(0, -0.48, 0.08);
  leftLeg.lower.add(leftBoot);
  rightLeg.lower.add(rightBoot);
  hips.add(leftLeg.upper, rightLeg.upper);
  root.add(hips);

  const leftShoulder = mesh(THREE, assets.geometries.shoulder, plate, "Left pauldron");
  const rightShoulder = mesh(THREE, assets.geometries.shoulder, plate, "Right pauldron");
  leftShoulder.position.set(-0.42, 0.33, 0);
  rightShoulder.position.set(0.42, 0.33, 0);
  leftShoulder.visible = rightShoulder.visible = false;
  torso.add(leftShoulder, rightShoulder);

  const sockets = Object.freeze({
    rightHand: socket(THREE, rightArm.lower, "Right hand equipment socket", [0, -0.48, 0]),
    leftHand: socket(THREE, leftArm.lower, "Left hand equipment socket", [0, -0.48, 0]),
    belt: socket(THREE, hips, "Belt equipment socket", [0.34, 0, -0.02]),
    backLeft: socket(THREE, torso, "Back-left equipment socket", [-0.19, 0.05, -0.22]),
    backRight: socket(THREE, torso, "Back-right equipment socket", [0.2, 0.05, -0.24]),
    shieldBack: socket(THREE, torso, "Back shield socket", [0, 0.06, -0.25]),
  });

  const gear = Object.freeze({
    sword: createSword(THREE, assets, false),
    twoHanded: createSword(THREE, assets, true),
    crossbow: createCrossbow(THREE, assets),
    shield: createShield(THREE, assets),
    quiver: createQuiver(THREE, assets),
  });

  let currentLoadout = {
    mainHand: "sword",
    offHand: "shield",
    armor: "leather",
    owned: ["sword", "shield", "twoHanded", "crossbow"],
    ...loadout,
  };

  function setArmor(armor) {
    const value = armor ?? "leather";
    currentLoadout.armor = value;
    torsoMesh.material = value === "plate" ? plate : value === "cloth" ? cloth : leather;
    helmet.visible = value === "plate";
    hairCap.visible = value !== "plate";
    leftShoulder.visible = rightShoulder.visible = value === "plate";
  }

  function setLoadout(next = {}) {
    currentLoadout = { ...currentLoadout, ...next };
    const owned = new Set(currentLoadout.owned ?? []);
    owned.add(currentLoadout.mainHand);
    if (currentLoadout.offHand) owned.add(currentLoadout.offHand);
    for (const [id, object] of Object.entries(gear)) object.visible = id === "quiver" || owned.has(id);

    attach(gear.sword, currentLoadout.mainHand === "sword" ? sockets.rightHand : sockets.belt,
      currentLoadout.mainHand === "sword" ? [0, -0.08, 0] : [0, 0, 0],
      currentLoadout.mainHand === "sword" ? [0, 0, 0] : [0, 0, 0.18]);
    attach(gear.twoHanded, currentLoadout.mainHand === "twoHanded" ? sockets.rightHand : sockets.backLeft,
      currentLoadout.mainHand === "twoHanded" ? [0, -0.22, 0] : [0, 0, 0],
      currentLoadout.mainHand === "twoHanded" ? [0, 0, 0] : [0.12, 0, 0.66]);
    attach(gear.crossbow, currentLoadout.mainHand === "crossbow" ? sockets.rightHand : sockets.backRight,
      currentLoadout.mainHand === "crossbow" ? [0, -0.03, -0.18] : [0, 0.04, 0],
      currentLoadout.mainHand === "crossbow" ? [Math.PI / 2, 0, 0] : [0.25, 0, -0.5]);
    const shieldInHand = currentLoadout.offHand === "shield" && currentLoadout.mainHand === "sword";
    attach(gear.shield, shieldInHand ? sockets.leftHand : sockets.shieldBack,
      shieldInHand ? [0, -0.02, 0.1] : [0, 0, 0],
      shieldInHand ? [0, 0, 0] : [0, 0, 0]);
    attach(gear.quiver, sockets.backRight, [0.24, -0.14, 0.02], [0.18, 0, -0.18], [0.85, 0.85, 0.85]);
    gear.quiver.visible = owned.has("crossbow");
    setArmor(currentLoadout.armor);
    return getLoadout();
  }

  function getLoadout() {
    return { ...currentLoadout, owned: [...(currentLoadout.owned ?? [])] };
  }

  const pose = {
    time: 0,
    locomotion: 0,
  };

  function updatePose(delta, state = {}) {
    pose.time += Math.max(0, Number(delta) || 0);
    const speed = Math.max(0, Number(state.speed) || 0);
    pose.locomotion += Math.max(0.8, speed) * Math.max(0, Number(delta) || 0) * 4.5;
    const moving = Math.min(1, speed / 3.2);
    const stride = Math.sin(pose.locomotion) * 0.68 * moving;
    leftLeg.upper.rotation.x = stride;
    rightLeg.upper.rotation.x = -stride;
    leftLeg.lower.rotation.x = Math.max(0, -stride) * 0.58;
    rightLeg.lower.rotation.x = Math.max(0, stride) * 0.58;
    leftArm.upper.rotation.x = -stride * 0.5;
    rightArm.upper.rotation.x = stride * 0.5;
    leftArm.upper.rotation.z = 0;
    rightArm.upper.rotation.z = 0;
    torso.rotation.set(0, 0, Math.sin(pose.locomotion * 0.5) * 0.025 * moving);
    hips.position.y = 1.02 + Math.abs(Math.sin(pose.locomotion)) * 0.035 * moving;

    const combat = state.combat ?? {};
    const progress = Math.max(0, Math.min(1, Number(combat.progress) || 0));
    if (combat.state === "windup") {
      rightArm.upper.rotation.x = -1.05 - progress * 0.8;
      rightArm.upper.rotation.z = -0.3;
      torso.rotation.y = -0.25 * progress;
    } else if (combat.state === "active") {
      rightArm.upper.rotation.x = 0.5 + progress * 1.35;
      rightArm.upper.rotation.z = 0.22;
      torso.rotation.y = 0.4 - progress * 0.28;
    } else if (combat.state === "recovery") {
      rightArm.upper.rotation.x = 1.2 * (1 - progress);
      torso.rotation.y = 0.2 * (1 - progress);
    } else if (combat.state === "blocking") {
      leftArm.upper.rotation.x = -1.25;
      leftArm.upper.rotation.z = -0.42;
      leftArm.lower.rotation.x = -0.55;
      torso.rotation.y = -0.12;
    } else if (combat.state === "dodging") {
      torso.rotation.x = 0.35;
      hips.rotation.z = Math.sin(progress * Math.PI) * 0.38;
    } else if (combat.state === "staggered") {
      torso.rotation.x = -0.22 * Math.sin(progress * Math.PI);
      rightArm.upper.rotation.x = 0.75;
    } else if (combat.state === "dead") {
      hips.rotation.z = -Math.min(Math.PI / 2, progress * Math.PI / 2);
      torso.rotation.x = 0.12;
    }

    if ((currentLoadout.mainHand === "twoHanded" || currentLoadout.mainHand === "crossbow") &&
        combat.state !== "dead") {
      leftArm.upper.rotation.x = Math.min(leftArm.upper.rotation.x, -0.82);
      leftArm.upper.rotation.z = -0.34;
      leftArm.lower.rotation.x = -0.5;
    }
  }

  setLoadout(currentLoadout);
  root.traverse(object => {
    object.userData ??= {};
    object.userData.rtxIgnore = true;
    object.userData.dynamicActor = true;
  });

  return {
    root,
    hips,
    torso,
    head,
    limbs: { leftArm, rightArm, leftLeg, rightLeg },
    sockets,
    gear,
    setLoadout,
    getLoadout,
    setArmor,
    updatePose,
    get primaryWeapon() { return currentLoadout.mainHand; },
    get offHand() { return currentLoadout.offHand; },
    dispose() { root.removeFromParent(); },
  };
}

export function getSharedEquipmentAssets(THREE = THREE_DEFAULT) {
  return sharedAssets(THREE);
}

