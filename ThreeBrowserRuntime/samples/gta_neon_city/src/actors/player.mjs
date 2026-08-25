import * as THREE from "three/webgpu";

const MINIGUN_DRUM_SIZE = 200;
const STARTING_MINIGUN_RESERVE = 1_000_000;
const MINIGUN_RELOAD_SECONDS = 2.4;
const PISTOL_MAGAZINE_SIZE = 12;
const STARTING_PISTOL_RESERVE = 180;

function mesh(geometry, material, name, position, parent, { castShadow = true } = {}) {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  object.position.set(...position);
  object.castShadow = castShadow;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

function createPlayerVisual() {
  const root = new THREE.Group();
  root.name = "Kai Mercer articulated street rig";
  const materials = {
    jacket: new THREE.MeshStandardMaterial({ color: 0x70583f, roughness: 0.91, metalness: 0.005 }),
    jacketPanel: new THREE.MeshStandardMaterial({ color: 0x5e4937, roughness: 0.93, metalness: 0.005 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x8d7458, roughness: 0.9, metalness: 0.005 }),
    shirt: new THREE.MeshStandardMaterial({ color: 0xd8cfbd, roughness: 0.9 }),
    denim: new THREE.MeshStandardMaterial({ color: 0x1b3157, roughness: 0.8 }),
    denimDark: new THREE.MeshStandardMaterial({ color: 0x10203d, roughness: 0.83 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb97150, roughness: 0.82 }),
    skinShadow: new THREE.MeshStandardMaterial({ color: 0x8e4f38, roughness: 0.88 }),
    hair: new THREE.MeshStandardMaterial({ color: 0x15100f, roughness: 0.96 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x090c13, roughness: 0.48 }),
    sole: new THREE.MeshStandardMaterial({ color: 0xb9bec5, roughness: 0.74 }),
    belt: new THREE.MeshStandardMaterial({ color: 0x171416, roughness: 0.68 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x343a46, roughness: 0.25, metalness: 0.84 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.36 }),
    eyeWhite: new THREE.MeshStandardMaterial({ color: 0xe2d9ca, roughness: 0.48 }),
    iris: new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.34 }),
    lip: new THREE.MeshStandardMaterial({ color: 0x874a43, roughness: 0.72 }),
    flash: new THREE.MeshBasicNodeMaterial({ color: 0xffd36a, transparent: true, opacity: 0.96, depthWrite: false }),
  };
  const geometries = {
    torso: new THREE.CylinderGeometry(0.315, 0.275, 0.82, 12, 2),
    jacketPanel: new THREE.BoxGeometry(0.255, 0.66, 0.03),
    lapel: new THREE.BoxGeometry(0.11, 0.48, 0.035),
    pelvis: new THREE.CylinderGeometry(0.3, 0.33, 0.3, 8),
    belt: new THREE.CylinderGeometry(0.315, 0.315, 0.085, 8),
    buckle: new THREE.BoxGeometry(0.13, 0.09, 0.04),
    neck: new THREE.CylinderGeometry(0.105, 0.13, 0.2, 10),
    head: new THREE.SphereGeometry(0.235, 16, 12),
    jaw: new THREE.SphereGeometry(0.19, 12, 9),
    ear: new THREE.SphereGeometry(0.052, 8, 6),
    hair: new THREE.SphereGeometry(0.247, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.57),
    eye: new THREE.SphereGeometry(0.032, 8, 5),
    eyeWhite: new THREE.SphereGeometry(0.041, 12, 8),
    iris: new THREE.CylinderGeometry(0.014, 0.014, 0.006, 12),
    lip: new THREE.CapsuleGeometry(0.012, 0.085, 4, 10),
    brow: new THREE.BoxGeometry(0.09, 0.018, 0.02),
    nose: new THREE.ConeGeometry(0.043, 0.105, 7),
    shoulder: new THREE.SphereGeometry(0.098, 10, 8),
    upperArm: new THREE.CapsuleGeometry(0.078, 0.29, 5, 8),
    forearm: new THREE.CapsuleGeometry(0.078, 0.27, 5, 8),
    elbow: new THREE.SphereGeometry(0.09, 9, 7),
    hand: new THREE.SphereGeometry(0.105, 10, 7),
    watch: new THREE.CylinderGeometry(0.098, 0.098, 0.055, 9),
    thigh: new THREE.CapsuleGeometry(0.125, 0.31, 5, 8),
    shin: new THREE.CapsuleGeometry(0.105, 0.29, 5, 8),
    knee: new THREE.SphereGeometry(0.112, 9, 7),
    shoe: new THREE.BoxGeometry(0.235, 0.15, 0.43),
    sole: new THREE.BoxGeometry(0.245, 0.035, 0.445),
    piping: new THREE.BoxGeometry(0.035, 0.63, 0.025),
    armPiping: new THREE.BoxGeometry(0.025, 0.28, 0.025),
    gunSlide: new THREE.BoxGeometry(0.115, 0.115, 0.38),
    gunGrip: new THREE.BoxGeometry(0.105, 0.24, 0.13),
    gunBarrel: new THREE.CylinderGeometry(0.032, 0.032, 0.3, 8),
    gunSight: new THREE.BoxGeometry(0.035, 0.035, 0.065),
    minigunReceiver: new THREE.BoxGeometry(0.46, 0.34, 0.62),
    minigunBarrel: new THREE.CylinderGeometry(0.024, 0.024, 1.05, 10),
    minigunDrum: new THREE.CylinderGeometry(0.26, 0.26, 0.34, 16),
    minigunBrace: new THREE.TorusGeometry(0.13, 0.022, 7, 18),
    flash: new THREE.ConeGeometry(0.085, 0.34, 7),
    phoneBody: new THREE.BoxGeometry(0.105, 0.205, 0.022),
    phoneScreen: new THREE.BoxGeometry(0.084, 0.164, 0.006),
    phoneSpeaker: new THREE.BoxGeometry(0.036, 0.008, 0.005),
    phoneLens: new THREE.CylinderGeometry(0.009, 0.009, 0.006, 8),
  };

  const hips = new THREE.Group();
  hips.name = "hips rig";
  hips.position.set(0, 0.96, 0);
  root.add(hips);
  const pelvis = mesh(geometries.pelvis, materials.denimDark, "tapered denim pelvis", [0, 0, 0], hips);
  pelvis.scale.z = 0.58;
  const belt = mesh(geometries.belt, materials.belt, "leather belt", [0, 0.12, 0], hips);
  belt.scale.z = 0.57;
  mesh(geometries.buckle, materials.metal, "belt buckle", [0, 0.12, -0.19], hips, { castShadow: false });

  const spine = new THREE.Group();
  spine.name = "spine rig";
  spine.position.set(0, 1.08, 0);
  root.add(spine);
  const torso = mesh(geometries.torso, materials.jacket, "tapered fitted jacket", [0, 0.35, 0], spine);
  torso.scale.z = 0.64;
  mesh(geometries.jacketPanel, materials.jacketPanel, "left jacket panel", [-0.155, 0.34, -0.205], spine);
  mesh(geometries.jacketPanel, materials.jacketPanel, "right jacket panel", [0.155, 0.34, -0.205], spine);
  const shirt = mesh(geometries.jacketPanel, materials.shirt, "shirt opening", [0, 0.38, -0.226], spine, { castShadow: false });
  shirt.scale.set(0.62, 0.92, 1);
  const leftLapel = mesh(geometries.lapel, materials.jacket, "left jacket lapel", [-0.09, 0.53, -0.247], spine);
  leftLapel.rotation.z = -0.23;
  const rightLapel = mesh(geometries.lapel, materials.jacket, "right jacket lapel", [0.09, 0.53, -0.247], spine);
  rightLapel.rotation.z = 0.23;
  mesh(geometries.piping, materials.jacketPanel, "left canvas jacket seam", [-0.238, 0.36, -0.205], spine, { castShadow: false });
  mesh(geometries.piping, materials.jacketPanel, "right canvas jacket seam", [0.238, 0.36, -0.205], spine, { castShadow: false });
  const backPiping = mesh(geometries.piping, materials.jacketPanel, "subtle jacket back yoke", [0, 0.48, 0.226], spine, { castShadow: false });
  backPiping.scale.set(0.42, 0.52, 0.58);
  backPiping.rotation.z = Math.PI * 0.5;

  const head = new THREE.Group();
  head.name = "head and neck rig";
  head.position.set(0, 0.72, 0);
  spine.add(head);
  mesh(geometries.neck, materials.skinShadow, "neck", [0, -0.02, 0], head);
  const face = mesh(geometries.head, materials.skin, "head", [0, 0.2, -0.012], head);
  face.scale.set(0.93, 1.08, 0.92);
  const jaw = mesh(geometries.jaw, materials.skin, "defined jaw", [0, 0.115, -0.055], head);
  jaw.scale.set(0.92, 0.72, 0.9);
  mesh(geometries.ear, materials.skinShadow, "left ear", [-0.224, 0.21, -0.005], head);
  mesh(geometries.ear, materials.skinShadow, "right ear", [0.224, 0.21, -0.005], head);
  const hair = mesh(geometries.hair, materials.hair, "textured short hair", [0, 0.245, -0.002], head);
  hair.rotation.x = -0.06;
  hair.scale.set(0.94, 0.88, 0.92);
  for (const side of [-1, 1]) {
    mesh(geometries.eyeWhite, materials.eyeWhite, `${side < 0 ? "left" : "right"} eye sclera`, [side * 0.083, 0.235, -0.224], head, { castShadow: false });
    const iris = mesh(geometries.iris, materials.iris, `${side < 0 ? "left" : "right"} brown iris`, [side * 0.083, 0.235, -0.262], head, { castShadow: false });
    iris.rotation.x = Math.PI * 0.5;
    const pupil = mesh(geometries.eye, materials.eye, `${side < 0 ? "left" : "right"} pupil`, [side * 0.083, 0.235, -0.266], head, { castShadow: false });
    pupil.scale.setScalar(0.39);
  }
  const leftBrow = mesh(geometries.brow, materials.hair, "left eyebrow", [-0.083, 0.292, -0.231], head, { castShadow: false });
  leftBrow.rotation.z = -0.08;
  const rightBrow = mesh(geometries.brow, materials.hair, "right eyebrow", [0.083, 0.292, -0.231], head, { castShadow: false });
  rightBrow.rotation.z = 0.08;
  const nose = mesh(geometries.nose, materials.skinShadow, "nose", [0, 0.175, -0.248], head, { castShadow: false });
  const upperLip = mesh(geometries.lip, materials.lip, "defined upper lip", [0, 0.085, -0.237], head, { castShadow: false });
  upperLip.rotation.z = Math.PI * 0.5;
  upperLip.scale.set(0.72, 1, 0.52);
  const lowerLip = mesh(geometries.lip, materials.lip, "defined lower lip", [0, 0.067, -0.236], head, { castShadow: false });
  lowerLip.rotation.z = Math.PI * 0.5;
  lowerLip.scale.set(0.82, 1, 0.62);
  nose.rotation.x = -Math.PI * 0.5;

  function createArm(side, label) {
    const shoulder = new THREE.Group();
    shoulder.name = label + " shoulder pivot";
    shoulder.position.set(side * 0.318, 0.64, 0);
    spine.add(shoulder);
    const shoulderCap = mesh(geometries.shoulder, materials.jacket, label + " jacket shoulder", [0, 0, 0], shoulder);
    shoulderCap.scale.set(0.78, 0.76, 0.80);
    mesh(geometries.upperArm, materials.jacket, label + " upper arm", [0, -0.22, 0], shoulder);
    const piping = mesh(geometries.armPiping, materials.accent, label + " sleeve piping", [side * 0.082, -0.22, -0.015], shoulder, { castShadow: false });
    piping.rotation.z = side * 0.04;
    const elbow = new THREE.Group();
    elbow.name = label + " elbow pivot";
    elbow.position.set(0, -0.43, 0);
    shoulder.add(elbow);
    mesh(geometries.elbow, materials.jacketPanel, label + " elbow", [0, 0, 0], elbow);
    mesh(geometries.forearm, materials.jacketPanel, label + " forearm", [0, -0.2, 0], elbow);
    const hand = new THREE.Group();
    hand.name = label + " hand pivot";
    hand.position.set(0, -0.4, 0);
    elbow.add(hand);
    mesh(geometries.hand, materials.skin, label + " hand", [0, 0, 0], hand);
    return { shoulder, elbow, hand };
  }

  function createLeg(side, label) {
    const hip = new THREE.Group();
    hip.name = label + " hip pivot";
    hip.position.set(side * 0.18, -0.02, 0);
    hips.add(hip);
    mesh(geometries.thigh, materials.denim, label + " thigh", [0, -0.23, 0], hip);
    const knee = new THREE.Group();
    knee.name = label + " knee pivot";
    knee.position.set(0, -0.44, 0);
    hip.add(knee);
    mesh(geometries.knee, materials.denimDark, label + " articulated knee", [0, 0, 0], knee);
    mesh(geometries.shin, materials.denim, label + " shin", [0, -0.21, 0], knee);
    const foot = new THREE.Group();
    foot.name = label + " ankle pivot";
    foot.position.set(0, -0.4, 0);
    knee.add(foot);
    mesh(geometries.shoe, materials.shoe, label + " sneaker", [0, 0, -0.08], foot);
    mesh(geometries.sole, materials.sole, label + " sneaker sole", [0, -0.09, -0.08], foot, { castShadow: false });
    return { hip, knee, foot };
  }

  const leftArm = createArm(-1, "left");
  const rightArm = createArm(1, "right");
  const leftLeg = createLeg(-1, "left");
  const rightLeg = createLeg(1, "right");
  const watch = mesh(geometries.watch, materials.accent, "ordinary canvas-strap watch", [-0.09, -0.23, -0.015], leftArm.elbow, { castShadow: false });
  watch.rotation.z = Math.PI * 0.5;

  const gun = new THREE.Group();
  gun.name = "six-barrel handheld minigun";
  gun.position.set(0.025, -0.04, -0.18);
  rightArm.hand.add(gun);
  mesh(geometries.minigunReceiver, materials.shoe, "massive black minigun receiver", [0, -0.01, -0.30], gun);
  const grip = mesh(geometries.gunGrip, materials.shoe, "minigun rear control grip", [0, -0.15, 0.015], gun);
  grip.rotation.x = -0.16;
  const drum = mesh(geometries.minigunDrum, materials.shoe, "huge black minigun ammunition drum", [0.20, -0.27, -0.22], gun);
  drum.rotation.z = Math.PI * 0.5;
  const motor = mesh(geometries.minigunDrum, materials.shoe, "black minigun drive motor", [0, -0.02, -0.53], gun);
  motor.rotation.x = Math.PI * 0.5;
  motor.scale.setScalar(0.62);
  for (let index = 0; index < 6; ++index) {
    const phase = index * Math.PI / 3;
    const barrel = mesh(geometries.minigunBarrel, materials.shoe, `minigun barrel ${index + 1}`,
      [Math.cos(phase) * 0.105, -0.02 + Math.sin(phase) * 0.105, -0.94], gun);
    barrel.rotation.x = Math.PI * 0.5;
  }
  mesh(geometries.minigunBrace, materials.metal, "minigun rear barrel brace", [0, -0.02, -0.52], gun, { castShadow: false });
  mesh(geometries.minigunBrace, materials.metal, "minigun front barrel brace", [0, -0.02, -1.31], gun, { castShadow: false });
  const pistolModel = new THREE.Group();
  pistolModel.name = "compact pistol model";
  gun.add(pistolModel);
  mesh(geometries.gunSlide, materials.metal, "pistol slide", [0, 0.02, -0.12], pistolModel);
  const pistolGrip = mesh(geometries.gunGrip, materials.shoe, "pistol grip and magazine", [0, -0.13, 0.015], pistolModel);
  pistolGrip.rotation.x = -0.16;
  const pistolBarrel = mesh(geometries.gunBarrel, materials.metal, "pistol barrel", [0, 0.02, -0.27], pistolModel);
  pistolBarrel.rotation.x = Math.PI * 0.5;
  mesh(geometries.gunSight, materials.accent, "pistol front sight", [0, 0.095, -0.28], pistolModel, { castShadow: false });
  const muzzleAnchor = new THREE.Group();
  muzzleAnchor.name = "muzzle anchor";
  muzzleAnchor.position.set(0, -0.02, -1.48);
  gun.add(muzzleAnchor);
  const flash = mesh(geometries.flash, materials.flash, "muzzle flash", [0, 0, 0], muzzleAnchor, { castShadow: false });
  flash.rotation.x = -Math.PI * 0.5;
  flash.visible = false;
  flash.material.toneMapped = false;

  const holster = mesh(geometries.gunGrip, materials.belt, "right hip holster", [0.34, -0.02, 0.02], hips);
  holster.rotation.z = -0.15;

  // The story phone is built with the rest of Kai's rig so a radio line only
  // changes visibility and pose weights. No geometry, material, or scene node
  // is created the first time a call begins.
  const phone = new THREE.Group();
  phone.name = "precreated story phone";
  phone.position.set(0.035, 0.005, -0.115);
  phone.rotation.set(0.03, -0.08, 0.04);
  rightArm.hand.add(phone);
  mesh(geometries.phoneBody, materials.shoe, "phone dark ceramic body", [0, 0, 0], phone);
  mesh(geometries.phoneScreen, materials.eye, "phone unlit glass screen", [0, 0, -0.014], phone, { castShadow: false });
  mesh(geometries.phoneSpeaker, materials.metal, "phone earpiece speaker", [0, 0.073, -0.019], phone, { castShadow: false });
  const phoneLens = mesh(geometries.phoneLens, materials.metal, "phone camera lens", [0.031, 0.072, 0.015], phone, { castShadow: false });
  phoneLens.rotation.x = Math.PI * 0.5;
  phone.visible = false;

  const minigunParts = gun.children.filter(child => child !== pistolModel && child !== muzzleAnchor);
  const rig = { hips, spine, head, leftArm, rightArm, leftLeg, rightLeg, gun, grip, phone, pistolModel, minigunParts };
  root.userData.rig = rig;
  root.userData.pivots = {
    leftArm: leftArm.shoulder,
    rightArm: rightArm.shoulder,
    leftLeg: leftLeg.hip,
    rightLeg: rightLeg.hip,
  };
  root.userData.muzzleAnchor = muzzleAnchor;
  root.userData.muzzleFlash = flash;
  root.userData.poseState = {
    locomotion: 0,
    sprint: 0,
    aim: 0,
    reload: 0,
    airborne: 0,
    landing: 0,
    recoil: 0,
    melee: 0,
    meleePhase: 0,
    arrested: 0,
    phoneCall: 0,
  };
  root.userData.materials = Object.values(materials);
  root.userData.geometries = Object.values(geometries);
  return root;
}
function angleDelta(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function clampStamina(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

export function createPlayer({ scene, world, input, position = null, onShoot = null, onMelee = null, onCrime = null, onSound = null } = {}) {
  if (!scene || !world || !input) throw new TypeError("createPlayer requires scene, world, and input");
  const root = new THREE.Group();
  root.name = "Player Kai Mercer";
  root.userData.dynamicActor = true;
  root.userData.rtxIgnore = true;
  const visual = createPlayerVisual();
  root.add(visual);
  const spawnValue = position ?? world.spawnPoints?.player?.position ?? world.spawnPoints?.player ?? [0, 0, 18];
  const spawn = spawnValue?.isVector3 ? spawnValue.clone() : new THREE.Vector3(...spawnValue);
  root.position.copy(spawn);
  root.position.y = Number(world.terrainHeight?.(root.position.x, root.position.z) ?? root.position.y) || 0;
  scene.add(root);

  const velocity = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const displacement = new THREE.Vector3();
  let health = 100;
  let armor = 0;
  let cash = 1250;
  const loadout = {
    pistol: { clip: PISTOL_MAGAZINE_SIZE, reserve: STARTING_PISTOL_RESERVE },
    minigun: { clip: MINIGUN_DRUM_SIZE, reserve: STARTING_MINIGUN_RESERVE },
  };
  let selectedWeapon = "pistol";
  let clip = loadout.pistol.clip;
  let reserve = loadout.pistol.reserve;
  let reload = 0;
  let shotCooldown = 0;
  let invulnerable = 0;
  let inVehicle = null;
  let alive = true;
  let distanceWalked = 0;
  let shotsFired = 0;
  let muzzleFlash = 0;
  let damageFlash = 0;
  let recoil = 0;
  let stamina = 100;
  let verticalOffset = 0;
  let verticalVelocity = 0;
  let grounded = true;
  let stepTravel = 0;
  let aiming = false;
  let locomotionPhase = 0;
  let locomotionBlend = 0;
  let sprintBlend = 0;
  let aimBlend = 0;
  let reloadBlend = 0;
  let airborneBlend = 0;
  let landingBlend = 0;
  let deathBlend = 0;
  let reloadPoseProgress = 0;
  let meleeTimer = 0;
  let meleeCooldown = 0;
  let meleeHitPending = false;
  let meleeCount = 0;
  let meleeBlend = 0;
  let arrestedBlend = 0;
  let phoneCallRequested = false;
  let phoneCallActive = false;
  let phoneCallBlend = 0;
  let firstPerson = false;
  let activeGroundHeight = null;
  let activeMotionConstraint = null;
  let disposed = false;
  const meleeDuration = 0.52;
  const meleeHitTime = 0.29;

  function weaponDefinition() {
    return selectedWeapon === "minigun"
      ? { capacity: MINIGUN_DRUM_SIZE, reloadSeconds: MINIGUN_RELOAD_SECONDS, cadence: 0.06, damage: 24 }
      : { capacity: PISTOL_MAGAZINE_SIZE, reloadSeconds: 1.05, cadence: 0.145, damage: 42 };
  }

  function selectWeapon(name) {
    const next = name === "minigun" ? "minigun" : "pistol";
    if (next === selectedWeapon) return false;
    loadout[selectedWeapon] = { clip, reserve };
    selectedWeapon = next;
    ({ clip, reserve } = loadout[selectedWeapon]);
    reload = 0;
    reloadPoseProgress = 0;
    shotCooldown = 0;
    emitSound("reload", 0.28);
    return true;
  }

  function emitSound(name, volume = 0.5) {
    try { onSound?.(name, volume); } catch { /* Sound feedback is optional. */ }
  }

  function resolveMotion(deltaPosition) {
    const resolved = world.resolveCircleMotion?.(root.position, deltaPosition, 0.43);
    if (resolved?.position?.isVector3) root.position.copy(resolved.position);
    else if (resolved?.isVector3) root.position.copy(resolved);
    else root.position.add(deltaPosition);
    activeMotionConstraint?.(root.position, 0.43);
    const ground = Number(activeGroundHeight?.(root.position.x, root.position.z, root.position.y, verticalVelocity) ??
      world.terrainHeight?.(root.position.x, root.position.z) ?? 0);
    root.position.y = (Number.isFinite(ground) ? ground : 0) + verticalOffset;
  }

  function damp(current, target, response, delta) {
    return target + (current - target) * Math.exp(-Math.max(0, response) * delta);
  }

  function mix(first, second, amount) {
    return first + (second - first) * Math.max(0, Math.min(1, amount));
  }

  function poseRotation(object, x, y, z, response, delta) {
    const blend = 1 - Math.exp(-Math.max(0, response) * delta);
    object.rotation.x += angleDelta(x, object.rotation.x) * blend;
    object.rotation.y += angleDelta(y, object.rotation.y) * blend;
    object.rotation.z += angleDelta(z, object.rotation.z) * blend;
  }

  function resetPose() {
    locomotionPhase = 0;
    locomotionBlend = 0;
    sprintBlend = 0;
    aimBlend = 0;
    reloadBlend = 0;
    airborneBlend = 0;
    landingBlend = 0;
    deathBlend = 0;
    reloadPoseProgress = 0;
    meleeBlend = 0;
    arrestedBlend = 0;
    phoneCallRequested = false;
    phoneCallActive = false;
    phoneCallBlend = 0;
    visual.position.set(0, 0, 0);
    visual.rotation.set(0, 0, 0);
    const rig = visual.userData.rig;
    rig.hips.position.set(0, 0.96, 0);
    rig.hips.rotation.set(0, 0, 0);
    rig.spine.position.set(0, 1.08, 0);
    rig.spine.rotation.set(0, 0, 0);
    rig.head.rotation.set(0, 0, 0);
    for (const arm of [rig.leftArm, rig.rightArm]) {
      arm.shoulder.rotation.set(0, 0, 0);
      arm.elbow.rotation.set(0, 0, 0);
      arm.hand.rotation.set(0, 0, 0);
    }
    for (const leg of [rig.leftLeg, rig.rightLeg]) {
      leg.hip.rotation.set(0, 0, 0);
      leg.knee.rotation.set(0, 0, 0);
      leg.foot.rotation.set(0, 0, 0);
    }
    rig.gun.rotation.set(0, 0, 0);
    rig.gun.visible = true;
    rig.phone.visible = false;
    rig.grip.position.set(0, -0.13, 0.015);
    visual.userData.muzzleFlash.visible = false;
    Object.assign(visual.userData.poseState, {
      locomotion: 0,
      sprint: 0,
      aim: 0,
      reload: 0,
      airborne: 0,
      landing: 0,
      recoil: 0,
      melee: 0,
      meleePhase: 0,
      arrested: 0,
      phoneCall: 0,
    });
  }

  function updatePose(delta, elapsed, speed, { sprinting = false, dead = false, arrested = false, phoneCall = false } = {}) {
    const rig = visual.userData.rig;
    if (!rig) return;
    rig.pistolModel.visible = selectedWeapon === "pistol";
    for (const part of rig.minigunParts) part.visible = selectedWeapon === "minigun";

    // A phone call yields immediately to combat, custody, and death. The prop
    // is hidden on that exact frame, while the articulated pose still damps
    // back to its next target rather than snapping the arm.
    phoneCallActive = Boolean(phoneCall && !dead && !arrested && !aiming);
    phoneCallBlend = damp(phoneCallBlend, phoneCallActive ? 1 : 0, phoneCallActive ? 9 : 11, delta);
    if (!Number.isFinite(phoneCallBlend)) phoneCallBlend = 0;
    const phonePoseWeight = !dead && !arrested && !aiming ? phoneCallBlend : 0;
    rig.phone.visible = !dead && !arrested && !aiming && (phoneCallActive || phoneCallBlend > 0.025);

    const moveTarget = grounded && !dead && !arrested ? Math.max(0, Math.min(1, speed / 5.15)) : 0;
    locomotionBlend = damp(locomotionBlend, moveTarget, moveTarget > locomotionBlend ? 10 : 7, delta);
    sprintBlend = damp(sprintBlend, sprinting && !dead ? 1 : 0, 8, delta);
    aimBlend = damp(aimBlend, aiming && !dead ? 1 : 0, aiming ? 13 : 8, delta);
    reloadBlend = damp(reloadBlend, reload > 0 && !dead ? 1 : 0, reload > 0 ? 14 : 8, delta);
    meleeBlend = damp(meleeBlend, meleeTimer > 0 && !dead ? 1 : 0, meleeTimer > 0 ? 20 : 11, delta);
    arrestedBlend = damp(arrestedBlend, arrested && !dead ? 1 : 0, arrested ? 7.5 : 11, delta);
    airborneBlend = damp(airborneBlend, !grounded && !dead ? 1 : 0, grounded ? 13 : 10, delta);
    deathBlend = damp(deathBlend, dead ? 1 : 0, 6, delta);
    landingBlend = Math.max(0, landingBlend - delta * 3.9);
    locomotionPhase += delta * (3.1 + speed * (0.94 + sprintBlend * 0.42)) * locomotionBlend;

    const stride = Math.sin(locomotionPhase);
    const stepLift = (1 - Math.cos(locomotionPhase * 2)) * 0.5;
    const forwardX = -Math.sin(root.rotation.y);
    const forwardZ = -Math.cos(root.rotation.y);
    const rightX = Math.cos(root.rotation.y);
    const rightZ = -Math.sin(root.rotation.y);
    const forwardAmount = Math.max(-1, Math.min(1, (velocity.x * forwardX + velocity.z * forwardZ) / 5.15));
    const sideAmount = Math.max(-1, Math.min(1, (velocity.x * rightX + velocity.z * rightZ) / 3.6));
    const groundedWeight = 1 - airborneBlend;
    const strideScale = (0.58 + sprintBlend * 0.27) * locomotionBlend * groundedWeight * (1 - aimBlend * 0.48);
    const strideValue = stride * strideScale;
    const rise = Math.max(-1, Math.min(1, verticalVelocity / 5.35));
    const damageWeight = Math.max(0, Math.min(1, damageFlash / 0.72));
    const flinchSide = ((shotsFired + Math.floor(damageFlash * 20)) & 1 ? -1 : 1) * damageWeight;

    let leftHipX = strideValue;
    let rightHipX = -strideValue;
    let leftKneeX = Math.max(0, -stride) * 0.62 * locomotionBlend * groundedWeight;
    let rightKneeX = Math.max(0, stride) * 0.62 * locomotionBlend * groundedWeight;
    leftHipX += airborneBlend * (0.32 - rise * 0.1) - landingBlend * 0.16;
    rightHipX += airborneBlend * (0.12 + rise * 0.08) - landingBlend * 0.16;
    leftKneeX += airborneBlend * (0.62 + Math.max(0, -rise) * 0.15) + landingBlend * 0.72;
    rightKneeX += airborneBlend * (0.48 + Math.max(0, -rise) * 0.22) + landingBlend * 0.72;
    const sideLegLean = sideAmount * aimBlend * 0.08;
    const arrestedWeight = arrestedBlend * (1 - deathBlend);
    leftHipX = mix(leftHipX, -0.62, arrestedWeight);
    rightHipX = mix(rightHipX, -0.62, arrestedWeight);
    leftKneeX = mix(leftKneeX, 1.24, arrestedWeight);
    rightKneeX = mix(rightKneeX, 1.24, arrestedWeight);

    const deadWeight = deathBlend;
    leftHipX = mix(leftHipX, 0.34, deadWeight);
    rightHipX = mix(rightHipX, -0.2, deadWeight);
    leftKneeX = mix(leftKneeX, 0.58, deadWeight);
    rightKneeX = mix(rightKneeX, 0.22, deadWeight);
    poseRotation(rig.leftLeg.hip, leftHipX, 0, sideLegLean, 13, delta);
    poseRotation(rig.rightLeg.hip, rightHipX, 0, sideLegLean, 13, delta);
    poseRotation(rig.leftLeg.knee, leftKneeX, 0, 0, 14, delta);
    poseRotation(rig.rightLeg.knee, rightKneeX, 0, 0, 14, delta);
    poseRotation(rig.leftLeg.foot, -leftKneeX * 0.28 + Math.max(0, stride) * stepLift * 0.11, 0, 0, 12, delta);
    poseRotation(rig.rightLeg.foot, -rightKneeX * 0.28 + Math.max(0, -stride) * stepLift * 0.11, 0, 0, 12, delta);

    const bob = groundedWeight * locomotionBlend * (Math.abs(Math.sin(locomotionPhase)) * 0.025 - 0.012);
    visual.position.y = damp(visual.position.y, bob - landingBlend * 0.035, 12, delta);
    visual.rotation.x = damp(visual.rotation.x, mix(0, 0.12, deadWeight), 10, delta);
    visual.rotation.z = damp(visual.rotation.z, mix(0, -0.2, deadWeight), 10, delta);
    rig.hips.position.y = damp(rig.hips.position.y, 0.96 - landingBlend * 0.105 - airborneBlend * 0.018 -
      deadWeight * 0.04 - arrestedWeight * 0.28, 14, delta);
    rig.spine.position.y = damp(rig.spine.position.y, 1.08 - landingBlend * 0.055 - deadWeight * 0.05 -
      arrestedWeight * 0.17, 14, delta);

    const hipYaw = -stride * locomotionBlend * groundedWeight * 0.085;
    const hipRoll = -sideAmount * aimBlend * 0.055;
    poseRotation(rig.hips, mix(0, 0.16, deadWeight), mix(hipYaw, -0.12, deadWeight), mix(hipRoll, 0.2, deadWeight), 11, delta);
    const meleePhase = meleeTimer > 0 ? Math.max(0, Math.min(1, 1 - meleeTimer / meleeDuration)) : 1;
    const meleeWindup = meleePhase < 0.34 ? Math.sin(meleePhase / 0.34 * Math.PI * 0.5) : 1;
    const meleeStrike = meleePhase < 0.34 ? meleeWindup * 0.35 :
      meleePhase < 0.62 ? 0.35 + Math.sin((meleePhase - 0.34) / 0.28 * Math.PI * 0.5) * 0.65 :
        Math.max(0, 1 - (meleePhase - 0.62) / 0.38);
    const meleeTwist = meleeBlend * (meleePhase < 0.34
      ? -0.5 * meleeWindup
      : meleePhase < 0.62
        ? -0.5 + ((meleePhase - 0.34) / 0.28) * 1.22
        : 0.72 * Math.max(0, 1 - (meleePhase - 0.62) / 0.38));
    const spinePitch = -locomotionBlend * 0.022 - sprintBlend * 0.095 - aimBlend * 0.025 -
      landingBlend * 0.1 + recoil * 0.035 + arrestedWeight * 0.16 + phonePoseWeight * 0.012;
    const spineYaw = -hipYaw * 0.72 + sideAmount * aimBlend * 0.045 + meleeTwist * 0.36 + phonePoseWeight * 0.022;
    const spineRoll = -sideAmount * aimBlend * 0.07 + flinchSide * 0.13 + phonePoseWeight * 0.018;
    poseRotation(rig.spine, mix(spinePitch, 0.24, deadWeight), mix(spineYaw, 0.18, deadWeight), mix(spineRoll, -0.28, deadWeight), 12, delta);
    poseRotation(
      rig.head,
      mix(airborneBlend * -0.08 + phonePoseWeight * 0.018, -0.14, deadWeight),
      mix(-spineYaw * 0.72 + phonePoseWeight * 0.035, -0.25, deadWeight),
      mix(sideAmount * aimBlend * 0.035 - flinchSide * 0.07 + phonePoseWeight * 0.055, 0.18, deadWeight),
      10,
      delta,
    );

    const armStride = stride * locomotionBlend * groundedWeight * (0.48 + sprintBlend * 0.3) * (1 - aimBlend * 0.88);
    let leftShoulderX = -armStride + airborneBlend * (0.32 + rise * 0.08);
    let rightShoulderX = armStride + airborneBlend * (0.12 - rise * 0.05);
    let leftShoulderY = 0;
    let rightShoulderY = 0;
    let leftShoulderZ = -sprintBlend * 0.06;
    let rightShoulderZ = sprintBlend * 0.06;
    let leftElbowX = -sprintBlend * 0.48;
    let rightElbowX = -sprintBlend * 0.48;
    let leftElbowY = 0;
    let rightElbowY = 0;
    let leftElbowZ = 0;
    let rightElbowZ = 0;
    let leftHandX = 0;
    let rightHandX = 0;

    const weaponAim = aimBlend * (1 - reloadBlend);
    leftShoulderX = mix(leftShoulderX, 1.02, weaponAim);
    rightShoulderX = mix(rightShoulderX, 1.16 + recoil * 0.17, weaponAim);
    leftShoulderY = mix(leftShoulderY, -0.25, weaponAim);
    rightShoulderY = mix(rightShoulderY, 0.08, weaponAim);
    leftShoulderZ = mix(leftShoulderZ, -0.15, weaponAim);
    rightShoulderZ = mix(rightShoulderZ, 0.08, weaponAim);
    leftElbowX = mix(leftElbowX, 0.5, weaponAim);
    rightElbowX = mix(rightElbowX, 0.16, weaponAim);
    leftElbowY = mix(leftElbowY, -0.22, weaponAim);
    rightElbowY = mix(rightElbowY, 0.08, weaponAim);
    leftHandX = mix(leftHandX, -0.08, weaponAim);
    rightHandX = mix(rightHandX, 0.06 + recoil * 0.08, weaponAim);

    const reloadReach = Math.sin(Math.PI * Math.max(0, Math.min(1, reloadPoseProgress)));
    const magazineDrop = Math.max(0, 1 - Math.abs(reloadPoseProgress - 0.5) * 5);
    leftShoulderX = mix(leftShoulderX, 0.62 + reloadReach * 0.42, reloadBlend);
    rightShoulderX = mix(rightShoulderX, 0.67 + (1 - reloadPoseProgress) * 0.16, reloadBlend);
    leftShoulderY = mix(leftShoulderY, -0.48 + reloadReach * 0.18, reloadBlend);
    rightShoulderY = mix(rightShoulderY, 0.22, reloadBlend);
    leftShoulderZ = mix(leftShoulderZ, -0.3, reloadBlend);
    rightShoulderZ = mix(rightShoulderZ, 0.13, reloadBlend);
    leftElbowX = mix(leftElbowX, 0.88 + reloadReach * 0.28, reloadBlend);
    rightElbowX = mix(rightElbowX, 0.48, reloadBlend);
    leftElbowY = mix(leftElbowY, -0.48, reloadBlend);
    rightElbowY = mix(rightElbowY, 0.16, reloadBlend);
    leftHandX = mix(leftHandX, -0.22, reloadBlend);
    rightHandX = mix(rightHandX, 0.18, reloadBlend);

    // A compact, readable pistol-whip: wind the weapon shoulder back, rotate the
    // torso through the strike, and keep the off hand up as a guard.
    const meleeWeight = meleeBlend * (1 - deadWeight);
    leftShoulderX = mix(leftShoulderX, 0.78 + meleeStrike * 0.22, meleeWeight);
    leftShoulderY = mix(leftShoulderY, -0.34, meleeWeight);
    leftShoulderZ = mix(leftShoulderZ, -0.24, meleeWeight);
    leftElbowX = mix(leftElbowX, 0.72, meleeWeight);
    leftElbowY = mix(leftElbowY, -0.28, meleeWeight);
    rightShoulderX = mix(rightShoulderX, -0.28 + meleeStrike * 1.62, meleeWeight);
    rightShoulderY = mix(rightShoulderY, 0.58 - meleeStrike * 0.74, meleeWeight);
    rightShoulderZ = mix(rightShoulderZ, 0.38 - meleeStrike * 0.3, meleeWeight);
    rightElbowX = mix(rightElbowX, -0.5 + meleeStrike * 0.82, meleeWeight);
    rightElbowY = mix(rightElbowY, 0.48 - meleeStrike * 0.44, meleeWeight);
    rightHandX = mix(rightHandX, -0.28 + meleeStrike * 0.45, meleeWeight);

    // One hand remains free and keeps a restrained locomotion swing. The
    // phone arm lifts from the shoulder, folds across the elbow, and settles
    // beside the ear; the small head cant makes this read as listening rather
    // than holding an object overhead.
    rightShoulderX = mix(rightShoulderX, 0.06, phonePoseWeight);
    rightShoulderY = mix(rightShoulderY, 0.08, phonePoseWeight);
    rightShoulderZ = mix(rightShoulderZ, 2.22, phonePoseWeight);
    rightElbowX = mix(rightElbowX, -0.08, phonePoseWeight);
    rightElbowY = mix(rightElbowY, -0.08, phonePoseWeight);
    rightElbowZ = mix(rightElbowZ, 2.13, phonePoseWeight);
    rightHandX = mix(rightHandX, 0.04, phonePoseWeight);

    // Once taken into custody Kai kneels and raises both hands; the held
    // sidearm is hidden so the silhouette reads as surrender, not combat.
    leftShoulderX = mix(leftShoulderX, 0.18, arrestedWeight);
    rightShoulderX = mix(rightShoulderX, 0.18, arrestedWeight);
    leftShoulderY = mix(leftShoulderY, -0.18, arrestedWeight);
    rightShoulderY = mix(rightShoulderY, 0.18, arrestedWeight);
    leftShoulderZ = mix(leftShoulderZ, -2.08, arrestedWeight);
    rightShoulderZ = mix(rightShoulderZ, 2.08, arrestedWeight);
    leftElbowX = mix(leftElbowX, 0.58, arrestedWeight);
    rightElbowX = mix(rightElbowX, 0.58, arrestedWeight);
    leftElbowZ = mix(leftElbowZ, 0, arrestedWeight);
    rightElbowZ = mix(rightElbowZ, 0, arrestedWeight);
    leftHandX = mix(leftHandX, 0.22, arrestedWeight);
    rightHandX = mix(rightHandX, 0.22, arrestedWeight);

    leftShoulderZ += flinchSide * 0.1;
    rightShoulderZ -= flinchSide * 0.08;
    leftShoulderX = mix(leftShoulderX, -0.5, deadWeight);
    rightShoulderX = mix(rightShoulderX, 0.32, deadWeight);
    leftElbowX = mix(leftElbowX, -0.38, deadWeight);
    rightElbowX = mix(rightElbowX, 0.55, deadWeight);
    poseRotation(rig.leftArm.shoulder, leftShoulderX, leftShoulderY, leftShoulderZ, 14, delta);
    poseRotation(rig.rightArm.shoulder, rightShoulderX, rightShoulderY, rightShoulderZ, 14, delta);
    poseRotation(rig.leftArm.elbow, leftElbowX, leftElbowY, leftElbowZ, 15, delta);
    poseRotation(rig.rightArm.elbow, rightElbowX, rightElbowY, rightElbowZ, 15, delta);
    poseRotation(rig.leftArm.hand, leftHandX, 0, -weaponAim * 0.12, 16, delta);
    poseRotation(rig.rightArm.hand, rightHandX, 0, weaponAim * 0.05, 16, delta);
    // Counter-rotate the weapon through the articulated shoulder/elbow chain
    // so its barrel stays level instead of pitching upward with the hands.
    const gunPitch = -1.38 * weaponAim + reloadBlend * 0.28 + meleeWeight * (-0.24 + meleeStrike * 0.38);
    poseRotation(rig.gun, gunPitch, meleeWeight * -0.15, reloadBlend * (0.18 + reloadReach * 0.18) + meleeWeight * 0.42, 16, delta);
    const phoneBlocksWeapon = !aiming && (phoneCallActive || phoneCallBlend > 0.04);
    rig.gun.visible = arrestedBlend < 0.42 && !phoneBlocksWeapon &&
      (aimBlend > 0.04 || reloadBlend > 0.04 || meleeWeight > 0.04);
    rig.grip.position.y = damp(rig.grip.position.y, -0.13 - magazineDrop * reloadBlend * 0.085, 18, delta);

    const flash = visual.userData.muzzleFlash;
    flash.visible = !dead && muzzleFlash > 0;
    flash.rotation.y = elapsed * 37;
    flash.scale.setScalar(0.76 + muzzleFlash * 7.5);
    Object.assign(visual.userData.poseState, {
      locomotion: locomotionBlend,
      sprint: sprintBlend,
      aim: aimBlend,
      reload: reloadBlend,
      airborne: airborneBlend,
      landing: landingBlend,
      recoil,
      melee: meleeBlend,
      meleePhase,
      arrested: arrestedBlend,
      phoneCall: phoneCallBlend,
      forward: forwardAmount,
      strafe: sideAmount,
      phase: locomotionPhase,
    });
  }
  function finishReload() {
    const missing = Math.max(0, weaponDefinition().capacity - clip);
    const moved = Math.min(missing, reserve);
    clip += moved;
    reserve -= moved;
    reload = 0;
  }

  function startReload() {
    const definition = weaponDefinition();
    if (!alive || inVehicle || meleeTimer > 0 || reload > 0 || clip >= definition.capacity || reserve <= 0) return false;
    reload = definition.reloadSeconds;
    reloadPoseProgress = 0;
    emitSound("reload", 0.48);
    return true;
  }

  function update(delta, context = {}) {
    const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
    const updateResult = () => context.captureSnapshot === false ? null : snapshot();
    activeGroundHeight = typeof context.groundHeight === "function" ? context.groundHeight : null;
    activeMotionConstraint = typeof context.constrainMotion === "function" ? context.constrainMotion : null;
    phoneCallRequested = Boolean(context.phoneCall);
    invulnerable = Math.max(0, invulnerable - dt);
    shotCooldown = Math.max(0, shotCooldown - dt);
    meleeCooldown = Math.max(0, meleeCooldown - dt);
    muzzleFlash = Math.max(0, muzzleFlash - dt);
    damageFlash = Math.max(0, damageFlash - dt);
    recoil += (0 - recoil) * (1 - Math.exp(-dt * 18));
    const controlsDisabled = Boolean(context.disabled);
    if (controlsDisabled) {
      meleeTimer = 0;
      meleeHitPending = false;
      reload = 0;
      reloadPoseProgress = 0;
    }
    if (meleeTimer > 0) {
      const previous = meleeTimer;
      meleeTimer = Math.max(0, meleeTimer - dt);
      if (meleeHitPending && previous > meleeHitTime && meleeTimer <= meleeHitTime) {
        meleeHitPending = false;
        const direction = new THREE.Vector3(-Math.sin(root.rotation.y), 0, -Math.cos(root.rotation.y));
        const origin = root.position.clone().add(new THREE.Vector3(0, 1.12, 0)).addScaledVector(direction, 0.28);
        let result = null;
        try {
          result = onMelee?.({
            player: api,
            origin,
            direction,
            reach: 2.15,
            damage: meleeCount % 3 === 0 ? 42 : 32,
            comboIndex: ((meleeCount - 1) % 3) + 1,
          });
        } catch { /* Melee world feedback is optional. */ }
        if (!result?.crimeHandled && (result?.hitPolice || result?.hitCivilian)) {
          onCrime?.({ type: "assault", heat: result.hitPolice ? 34 : 22 });
        }
      }
    }
    if (reload > 0) {
      reload -= dt;
      reloadPoseProgress = Math.max(0, Math.min(1, 1 - reload / weaponDefinition().reloadSeconds));
      if (reload <= 0) {
        reloadPoseProgress = 1;
        finishReload();
      }
    }
    if (!alive) {
      meleeTimer = 0;
      meleeHitPending = false;
      velocity.multiplyScalar(Math.exp(-dt * 10));
      root.rotation.z += (-1.38 - root.rotation.z) * (1 - Math.exp(-dt * 5));
      updatePose(dt, Number(context.elapsed) || 0, 0, { dead: true });
      return updateResult();
    }
    if (inVehicle) {
      meleeTimer = 0;
      meleeHitPending = false;
      phoneCallActive = false;
      phoneCallBlend = damp(phoneCallBlend, 0, 11, dt);
      visual.userData.rig.phone.visible = false;
      visual.userData.poseState.phoneCall = phoneCallBlend;
      const vehicle = context.vehicle ?? inVehicle;
      if (vehicle?.root?.position) root.position.copy(vehicle.root.position);
      root.visible = false;
      velocity.set(0, 0, 0);
      verticalOffset = 0;
      verticalVelocity = 0;
      grounded = true;
      return updateResult();
    }

    root.visible = true;
    visual.visible = !firstPerson;
    root.rotation.z += (0 - root.rotation.z) * (1 - Math.exp(-dt * 8));
    const move = controlsDisabled ? { x: 0, z: 0 } : input.movement();
    const cameraForward = context.cameraForward?.isVector3 ? context.cameraForward : new THREE.Vector3(0, 0, -1);
    const cameraRight = context.cameraRight?.isVector3 ? context.cameraRight : new THREE.Vector3(1, 0, 0);
    desired.copy(cameraForward).setY(0).normalize().multiplyScalar(move.z)
      .addScaledVector(cameraRight, move.x);
    if (desired.lengthSq() > 1) desired.normalize();
    const meleeActive = meleeTimer > 0;
    aiming = !controlsDisabled && !meleeActive && input.actionDown("aim");
    const sprinting = !meleeActive && !phoneCallRequested && input.actionDown("sprint") && move.z > 0 && !aiming && stamina > 2;
    const staminaRecoveryMultiplier = Math.max(0.6, Math.min(1.2, Number(context.staminaRecoveryMultiplier) || 1));
    stamina = clampStamina(stamina + (sprinting ? -18 : 13 * staminaRecoveryMultiplier) * dt);
    const targetSpeed = meleeActive ? 1.55 : aiming ? 3.6 : sprinting ? 7.9 : 5.15;
    desired.multiplyScalar(targetSpeed);
    const blend = 1 - Math.exp(-dt * (desired.lengthSq() > 0 ? 13 : 9));
    velocity.x += (desired.x - velocity.x) * blend;
    velocity.z += (desired.z - velocity.z) * blend;
    displacement.copy(velocity).multiplyScalar(dt);
    const beforeX = root.position.x;
    const beforeZ = root.position.z;
    resolveMotion(displacement);
    const travelled = Math.hypot(root.position.x - beforeX, root.position.z - beforeZ);
    distanceWalked += travelled;
    stepTravel += travelled;
    const speed = Math.hypot(velocity.x, velocity.z);
    const aimVector = context.aimDirection?.isVector3 ? context.aimDirection : null;
    if (aiming && aimVector && Math.hypot(aimVector.x, aimVector.z) > 0.01) {
      const targetYaw = Math.atan2(-aimVector.x, -aimVector.z);
      root.rotation.y += angleDelta(targetYaw, root.rotation.y) * (1 - Math.exp(-dt * 18));
    } else if (speed > 0.22) {
      const targetYaw = Math.atan2(-velocity.x, -velocity.z);
      root.rotation.y += angleDelta(targetYaw, root.rotation.y) * (1 - Math.exp(-dt * 15));
    }

    if (!controlsDisabled && input.actionPressed("melee") && grounded && meleeCooldown <= 0 && reload <= 0) {
      const face = context.aimDirection?.isVector3 ? context.aimDirection : null;
      if (face && Math.hypot(face.x, face.z) > 0.01) root.rotation.y = Math.atan2(-face.x, -face.z);
      meleeTimer = meleeDuration;
      meleeCooldown = 0.68;
      meleeHitPending = true;
      meleeCount += 1;
      aiming = false;
      emitSound("melee", 0.52);
    }
    if (!controlsDisabled && input.actionPressed("jump") && grounded && !aiming && meleeTimer <= 0) {
      grounded = false;
      verticalVelocity = 5.35;
      landingBlend = 0;
      emitSound("footstep", 0.34);
    }
    if (!grounded) {
      verticalVelocity -= 15.8 * dt;
      verticalOffset += verticalVelocity * dt;
      if (verticalOffset <= 0) {
        const landingSpeed = Math.max(0, -verticalVelocity);
        if (verticalVelocity < -3) emitSound("footstep", Math.min(0.66, -verticalVelocity * 0.09));
        landingBlend = Math.max(landingBlend, Math.max(0.24, Math.min(1, (landingSpeed - 2.2) / 4.6)));
        verticalOffset = 0;
        verticalVelocity = 0;
        grounded = true;
      }
      const ground = Number(activeGroundHeight?.(root.position.x, root.position.z, root.position.y, verticalVelocity) ??
        world.terrainHeight?.(root.position.x, root.position.z) ?? 0);
      root.position.y = (Number.isFinite(ground) ? ground : 0) + verticalOffset;
    }
    const footstepSpacing = sprinting ? 1.15 : 0.78;
    if (grounded && speed > 1.1 && stepTravel >= footstepSpacing) {
      stepTravel %= footstepSpacing;
      const surface = world.sampleGround?.(root.position.x, root.position.z)?.surfaceId;
      emitSound("footstep", surface === "park" ? 0.23 : sprinting ? 0.44 : 0.31);
    }
    if (!controlsDisabled && !aiming && !inVehicle) {
      if (input.actionPressed("weaponPistol")) selectWeapon("pistol");
      if (input.actionPressed("weaponMinigun")) selectWeapon("minigun");
    }
    if (!controlsDisabled && input.actionPressed("reload") && meleeTimer <= 0) startReload();
    const sightsReady = context.canShoot !== false;
    if (!controlsDisabled && aiming && sightsReady && meleeTimer <= 0 &&
        (input.actionDown("fire") || input.actionPressed("fire")) && shotCooldown <= 0 && reload <= 0) {
      if (clip <= 0) {
        if (!startReload()) emitSound("empty", 0.42);
      }
      else {
        clip -= 1;
        shotsFired += 1;
        const definition = weaponDefinition();
        shotCooldown = definition.cadence;
        muzzleFlash = selectedWeapon === "minigun" ? 0.045 : 0.055;
        recoil = selectedWeapon === "minigun" ? 0.58 : 1;
        const result = onShoot?.({ player: api, weapon: selectedWeapon, damage: definition.damage, origin: getMuzzle(new THREE.Vector3()), direction: context.aimDirection?.clone?.(), aiming });
        if (!result?.crimeHandled) {
          onCrime?.({ type: "gunfire", heat: result?.hitPolice ? 38 : result?.hitCivilian ? 28 : 6 });
        }
      }
    }
    updatePose(dt, Number(context.elapsed) || 0, speed, {
      sprinting,
      arrested: Boolean(context.arrested),
      phoneCall: phoneCallRequested,
    });
    return updateResult();
  }

  function getMuzzle(output = new THREE.Vector3()) {
    output.set(0.38, 1.55, -0.62).applyAxisAngle(new THREE.Vector3(0, 1, 0), root.rotation.y).add(root.position);
    return output;
  }

  function getCameraAnchor(output = new THREE.Vector3()) {
    return output.copy(root.position).setY(root.position.y + (inVehicle ? 1.2 : 1.45));
  }

  function setFirstPerson(enabled) {
    firstPerson = Boolean(enabled && alive && !inVehicle);
    visual.visible = !firstPerson;
    return firstPerson;
  }

  function enterVehicle(vehicle) {
    if (!alive || !vehicle) return false;
    inVehicle = vehicle;
    phoneCallActive = false;
    phoneCallRequested = false;
    phoneCallBlend = 0;
    visual.userData.rig.phone.visible = false;
    visual.userData.poseState.phoneCall = 0;
    firstPerson = false;
    visual.visible = true;
    root.visible = false;
    velocity.set(0, 0, 0);
    meleeTimer = 0;
    meleeHitPending = false;
    return true;
  }

  function exitVehicle(exitPosition) {
    if (!inVehicle) return false;
    inVehicle = null;
    firstPerson = false;
    visual.visible = true;
    root.visible = true;
    if (exitPosition?.isVector3) root.position.copy(exitPosition);
    velocity.set(0, 0, 0);
    meleeTimer = 0;
    meleeHitPending = false;
    return true;
  }

  function damage(amount, { ignoreArmor = false } = {}) {
    if (!alive || invulnerable > 0) return { accepted: false, health, armor };
    let remaining = Math.max(0, Number(amount) || 0);
    if (!ignoreArmor && armor > 0) {
      const absorbed = Math.min(armor, remaining * 0.72);
      armor -= absorbed;
      remaining -= absorbed;
    }
    health = Math.max(0, health - remaining);
    invulnerable = 0.22;
    damageFlash = 0.72;
    emitSound("hurt", Math.min(0.68, 0.28 + remaining * 0.012));
    if (health <= 0) {
      alive = false;
      phoneCallActive = false;
      visual.userData.rig.phone.visible = false;
    }
    return { accepted: true, damage: remaining, health, armor, alive };
  }

  function heal(amount) {
    const previous = health;
    health = Math.min(100, health + Math.max(0, Number(amount) || 0));
    return health - previous;
  }

  function restoreStamina(amount) {
    const previous = stamina;
    stamina = clampStamina(stamina + Math.max(0, Number(amount) || 0));
    return stamina - previous;
  }

  function addArmor(amount) {
    const previous = armor;
    armor = Math.min(100, armor + Math.max(0, Number(amount) || 0));
    return armor - previous;
  }

  function addCash(amount) { cash = Math.max(0, cash + Number(amount || 0)); return cash; }
  function setCash(value) { cash = Math.max(0, Number(value) || 0); return cash; }
  function setAmmo(nextClip, nextReserve = reserve) {
    clip = Math.max(0, Math.min(weaponDefinition().capacity, Math.trunc(Number(nextClip) || 0)));
    reserve = Math.max(0, Math.trunc(Number(nextReserve) || 0));
  }
  function teleport(x, z) {
    root.position.set(Number(x) || 0, 0, Number(z) || 0);
    root.position.y = Number(world.terrainHeight?.(root.position.x, root.position.z) ?? 0) || 0;
    velocity.set(0, 0, 0);
    verticalOffset = 0;
    verticalVelocity = 0;
    grounded = true;
    airborneBlend = 0;
    landingBlend = 0;
    return root.position.clone();
  }
  function respawn(next = spawn) {
    inVehicle = null;
    alive = true;
    health = 100;
    armor = 0;
    clip = weaponDefinition().capacity;
    reload = 0;
    stamina = 100;
    verticalOffset = 0;
    verticalVelocity = 0;
    grounded = true;
    damageFlash = 0;
    meleeTimer = 0;
    meleeCooldown = 0;
    meleeHitPending = false;
    root.rotation.z = 0;
    root.visible = true;
    root.position.copy(next);
    velocity.set(0, 0, 0);
    resetPose();
    return snapshot();
  }

  function snapshot() {
    return Object.freeze({
      id: "player",
      name: "Kai Mercer",
      position: root.position.toArray(),
      yaw: root.rotation.y,
      velocity: velocity.toArray(),
      speed: Math.hypot(velocity.x, velocity.z),
      health,
      maxHealth: 100,
      armor,
      cash,
      weapon: selectedWeapon,
      weapons: Object.freeze({
        pistol: Object.freeze(selectedWeapon === "pistol" ? { clip, reserve } : { ...loadout.pistol }),
        minigun: Object.freeze(selectedWeapon === "minigun" ? { clip, reserve } : { ...loadout.minigun }),
      }),
      ammo: { clip, reserve, reloading: reload > 0, reload },
      alive,
      inVehicle: inVehicle?.id ?? null,
      distanceWalked,
      shotsFired,
      muzzleFlash: muzzleFlash > 0,
      damageFlash,
      stamina,
      maxStamina: 100,
      aiming,
      grounded,
      verticalVelocity,
      phoneCall: Object.freeze({
        requested: phoneCallRequested,
        active: phoneCallActive,
        blend: Number.isFinite(phoneCallBlend) ? phoneCallBlend : 0,
        visible: Boolean(visual.userData.rig.phone.visible && visual.visible && root.visible),
        precreated: true,
        storage: "memory-only",
        geometryCount: 4,
        runtimeAllocations: 0,
      }),
      melee: Object.freeze({
        active: meleeTimer > 0,
        timer: meleeTimer,
        cooldown: meleeCooldown,
        count: meleeCount,
      }),
    });
  }

  function restore(value = {}) {
    const positionValue = Array.isArray(value.position) ? value.position : spawn.toArray();
    root.position.fromArray(positionValue);
    root.rotation.y = Number(value.yaw) || 0;
    health = Math.max(0, Math.min(100, Number(value.health) || 0));
    armor = Math.max(0, Math.min(100, Number(value.armor) || 0));
    cash = Math.max(0, Number(value.cash) || 0);
    selectedWeapon = value.weapon === "minigun" ? "minigun" : "pistol";
    loadout.pistol = {
      clip: Math.max(0, Math.min(PISTOL_MAGAZINE_SIZE, Math.trunc(Number(value.weapons?.pistol?.clip ?? PISTOL_MAGAZINE_SIZE) || 0))),
      reserve: Math.max(0, Math.trunc(Number(value.weapons?.pistol?.reserve ?? STARTING_PISTOL_RESERVE) || 0)),
    };
    loadout.minigun = {
      clip: Math.max(0, Math.min(MINIGUN_DRUM_SIZE, Math.trunc(Number(value.weapons?.minigun?.clip ?? MINIGUN_DRUM_SIZE) || 0))),
      reserve: Math.max(0, Math.trunc(Number(value.weapons?.minigun?.reserve ?? STARTING_MINIGUN_RESERVE) || 0)),
    };
    ({ clip, reserve } = loadout[selectedWeapon]);
    if (!value.weapons && value.ammo) setAmmo(value.ammo.clip, value.ammo.reserve);
    stamina = clampStamina(value.stamina ?? 100);
    verticalOffset = 0;
    verticalVelocity = 0;
    grounded = true;
    alive = value.alive !== false && health > 0;
    meleeTimer = 0;
    meleeCooldown = 0;
    meleeHitPending = false;
    root.rotation.z = alive ? 0 : -1.38;
    resetPose();
    root.visible = alive && !inVehicle;
    return snapshot();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const geometry of visual.userData.geometries) geometry.dispose();
    for (const material of visual.userData.materials) material.dispose();
    root.removeFromParent();
  }

  const api = {
    id: "player",
    root,
    velocity,
    get alive() { return alive; },
    get health() { return health; },
    get armor() { return armor; },
    get cash() { return cash; },
    get stamina() { return stamina; },
    get weapon() { return selectedWeapon; },
    get muzzleFlash() { return muzzleFlash > 0; },
    get speed() { return Math.hypot(velocity.x, velocity.z); },
    get vehicle() { return inVehicle; },
    getCameraAnchor,
    getMuzzle,
    setFirstPerson,
    update,
    enterVehicle,
    exitVehicle,
    damage,
    heal,
    restoreStamina,
    addArmor,
    addCash,
    setCash,
    setAmmo,
    selectWeapon,
    startReload,
    teleport,
    respawn,
    snapshot,
    restore,
    dispose,
  };
  root.userData.actor = api;
  return api;
}
