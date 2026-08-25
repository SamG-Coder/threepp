import * as THREE from "three/webgpu";

function clamp(value, low = 0, high = 1) {
  return Math.max(low, Math.min(high, Number(value) || 0));
}

/**
 * A dedicated camera-space pistol rig. Reusing the third-person armature here
 * would put the player's head and shoulders inside the near plane, so the FPS
 * view owns a compact pair of hands, slide, barrel and aligned iron sights.
 */
export function createFirstPersonWeapon(camera) {
  if (!camera?.add) throw new TypeError("createFirstPersonWeapon requires a camera");
  const root = new THREE.Group();
  root.name = "First-person aimed pistol viewmodel";
  root.visible = false;
  root.renderOrder = 10_000;
  // Camera-space geometry reads much larger than a world prop. Keeping the
  // whole rig below three-quarter scale leaves an open sight picture while
  // retaining both hands and the complete slide in the lower frame.
  root.scale.setScalar(0.66);
  const geometries = new Set();
  const materials = new Set();
  let blend = 0;
  let recoil = 0;
  let flashTime = 0;
  let previousFlash = false;
  let disposed = false;

  function geometry(value) { geometries.add(value); return value; }
  function material(color, roughness, metalness = 0) {
    // Camera-space art must never compile a city-light PBR permutation when
    // the player first aims. A single unlit pipeline gives deterministic
    // latency and stable readability regardless of how many street lights are
    // visible in the current district.
    const value = new THREE.MeshBasicNodeMaterial({
      color,
      // The viewmodel is always closer than world geometry, so ordinary
      // depth is safe and lets its own muzzle, slide, hands and sights occlude
      // one another correctly.  Disabling it made every later-added finger
      // and the front muzzle ring paint over the rear of the pistol.
      depthTest: true,
      depthWrite: true,
      fog: false,
    });
    value.toneMapped = false;
    materials.add(value);
    return value;
  }
  function mesh(name, shape, surface, position, rotation = [0, 0, 0], parent = root) {
    const value = new THREE.Mesh(shape, surface);
    value.name = name;
    value.position.set(...position);
    value.rotation.set(...rotation);
    value.frustumCulled = false;
    value.renderOrder = 10_000;
    parent.add(value);
    return value;
  }

  function chamferedPrism(width, height, depth, chamfer = 0.008) {
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const corner = Math.min(chamfer, halfWidth * 0.42, halfHeight * 0.42);
    const outline = new THREE.Shape();
    outline.moveTo(-halfWidth + corner, -halfHeight);
    outline.lineTo(halfWidth - corner, -halfHeight);
    outline.lineTo(halfWidth, -halfHeight + corner);
    outline.lineTo(halfWidth, halfHeight - corner);
    outline.lineTo(halfWidth - corner, halfHeight);
    outline.lineTo(-halfWidth + corner, halfHeight);
    outline.lineTo(-halfWidth, halfHeight - corner);
    outline.lineTo(-halfWidth, -halfHeight + corner);
    outline.closePath();
    const result = new THREE.ExtrudeGeometry(outline, {
      depth: Math.max(0.008, depth - corner * 0.5),
      steps: 1,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: corner * 0.24,
      bevelThickness: corner * 0.24,
      curveSegments: 1,
    });
    result.center();
    return geometry(result);
  }

  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const slideBodyGeometry = chamferedPrism(0.104, 0.072, 0.52, 0.012);
  const rearPlateGeometry = chamferedPrism(0.064, 0.042, 0.014, 0.008);
  const frameBodyGeometry = chamferedPrism(0.102, 0.067, 0.31, 0.011);
  const dustCoverGeometry = chamferedPrism(0.088, 0.052, 0.20, 0.009);
  const gripBodyGeometry = geometry(new THREE.CapsuleGeometry(0.035, 0.11, 5, 10));
  const arm = geometry(new THREE.CylinderGeometry(0.050, 0.073, 0.58, 12));
  const hand = geometry(new THREE.CapsuleGeometry(0.038, 0.092, 5, 10));
  const finger = geometry(new THREE.CapsuleGeometry(0.016, 0.066, 3, 7));
  const barrelGeometry = geometry(new THREE.CylinderGeometry(0.022, 0.022, 0.40, 14));
  const muzzleRingGeometry = geometry(new THREE.TorusGeometry(0.027, 0.006, 6, 16));
  const flashGeometry = geometry(new THREE.ConeGeometry(0.052, 0.13, 8, 1, true));
  const sleeve = material(0x5f4a38, 0.86, 0.015);
  const skin = material(0xaa765e, 0.79, 0.01);
  const gunMetal = material(0x63727a, 0.29, 0.76);
  const gunPolymer = material(0x161c21, 0.56, 0.22);
  const rearPlateMaterial = material(0x283137, 0.46, 0.48);
  const sightPaint = material(0xa7b8b2, 0.40, 0.42);
  const sightDotMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0x91d7b3,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
  sightDotMaterial.toneMapped = false;
  materials.add(sightDotMaterial);
  const flashMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xffd08a,
    transparent: true,
    opacity: 0.94,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  flashMaterial.toneMapped = false;
  materials.add(flashMaterial);

  const leftForearm = mesh("FPS left jacket forearm", arm, sleeve, [-0.155, -0.405, -0.30], [-0.94, 0, -0.18]);
  const rightForearm = mesh("FPS right jacket forearm", arm, sleeve, [0.158, -0.405, -0.30], [-0.98, 0, 0.19]);
  leftForearm.scale.set(0.74, 0.94, 0.72);
  rightForearm.scale.set(0.74, 0.94, 0.72);
  const supportHand = mesh("FPS support hand", hand, skin, [-0.057, -0.272, -0.51], [0.62, 0, -0.22]);
  supportHand.scale.set(0.72, 0.76, 0.62);
  const triggerHand = mesh("FPS trigger hand", hand, skin, [0.058, -0.255, -0.485], [0.54, 0, 0.17]);
  triggerHand.scale.set(0.72, 0.76, 0.62);

  const pistol = new THREE.Group();
  pistol.name = "FPS pistol aligned to iron sights";
  root.add(pistol);
  const slide = mesh("FPS pistol machined slide", slideBodyGeometry, gunMetal, [0, -0.095, -0.57], [0, 0, 0], pistol);
  const slideTop = mesh("FPS pistol anti-glare top rib", box, gunPolymer, [0, -0.044, -0.575], [0, 0, 0], pistol);
  slideTop.scale.set(0.058, 0.018, 0.48);
  mesh("FPS pistol recessed rear plate", rearPlateGeometry, rearPlateMaterial, [0, -0.095, -0.292], [0, 0, 0], pistol);
  for (const side of [-1, 1]) {
    const rearBevel = mesh(`FPS pistol rear ${side < 0 ? "left" : "right"} bevel`, box, gunMetal,
      [side * 0.056, -0.095, -0.294], [0, 0, side * 0.10], pistol);
    rearBevel.scale.set(0.016, 0.078, 0.014);
  }
  mesh("FPS pistol polymer frame", frameBodyGeometry, gunPolymer, [0, -0.18, -0.48], [0, 0, 0], pistol);
  mesh("FPS pistol under-barrel dust cover", dustCoverGeometry, gunPolymer, [0, -0.205, -0.635], [0.03, 0, 0], pistol);
  const grip = mesh("FPS pistol grip", gripBodyGeometry, gunPolymer, [0, -0.31, -0.38], [-0.19, 0, 0], pistol);
  grip.scale.set(1.08, 1, 1.34);
  const gripPanel = mesh("FPS pistol stippled grip panel", box, gunMetal, [0.055, -0.31, -0.38], [-0.19, 0, 0], pistol);
  gripPanel.position.x = 0.046;
  gripPanel.scale.set(0.007, 0.118, 0.082);
  const magazineBase = mesh("FPS pistol magazine base plate", box, gunMetal, [0, -0.404, -0.36], [-0.19, 0, 0], pistol);
  magazineBase.scale.set(0.098, 0.022, 0.13);
  const ejectionPort = mesh("FPS pistol ejection port", box, gunPolymer, [0.043, -0.038, -0.57], [0, 0, 0], pistol);
  ejectionPort.scale.set(0.040, 0.012, 0.125);
  const triggerGuardGeometry = geometry(new THREE.TorusGeometry(0.055, 0.011, 6, 12, Math.PI * 1.55));
  mesh("FPS pistol trigger guard", triggerGuardGeometry, gunMetal, [0, -0.225, -0.51], [Math.PI * 0.5, 0, 0.7], pistol);
  const trigger = mesh("FPS pistol trigger", finger, gunMetal, [0.018, -0.219, -0.515], [0.18, 0, 0.16], pistol);
  trigger.scale.set(0.58, 0.64, 0.58);
  mesh("FPS visible barrel", barrelGeometry, gunMetal, [0, -0.09, -0.65], [Math.PI * 0.5, 0, 0], pistol);
  mesh("FPS recessed muzzle crown", muzzleRingGeometry, gunPolymer, [0, -0.09, -0.852], [0, 0, 0], pistol);
  for (const side of [-1, 1]) {
    for (let index = 0; index < 4; ++index) {
      const serration = mesh(`FPS slide ${side < 0 ? "left" : "right"} rear serration ${index + 1}`, box, gunPolymer,
        [side * 0.059, -0.092, -0.39 - index * 0.025], [0, 0, -0.13 * side], pistol);
      serration.scale.set(0.008, 0.058, 0.011);
    }
  }
  for (let index = 0; index < 4; ++index) {
    const supportFinger = mesh(`FPS support grip finger ${index + 1}`, finger, skin,
      [-0.008, -0.286 - index * 0.031, -0.463], [0.05, 0, Math.PI * 0.5], pistol);
    supportFinger.scale.set(0.62, 0.80 - index * 0.035, 0.58);
  }
  const supportThumb = mesh("FPS support thumb across grip", finger, skin,
    [-0.025, -0.245, -0.475], [0.18, 0.10, Math.PI * 0.34], pistol);
  supportThumb.scale.set(0.70, 0.88, 0.62);
  const rearSightLeft = mesh("FPS rear sight left post", box, sightPaint, [-0.045, -0.028, -0.35], [0, 0, 0], pistol);
  rearSightLeft.position.y = -0.048;
  rearSightLeft.scale.set(0.014, 0.032, 0.030);
  const rearSightRight = mesh("FPS rear sight right post", box, sightPaint, [0.045, -0.028, -0.35], [0, 0, 0], pistol);
  rearSightRight.position.y = rearSightLeft.position.y;
  rearSightRight.scale.copy(rearSightLeft.scale);
  const frontSight = mesh("FPS front sight centered post", box, sightPaint, [0, -0.025, -0.84], [0, 0, 0], pistol);
  frontSight.position.y = -0.045;
  frontSight.scale.set(0.014, 0.035, 0.022);
  const rearDotLeft = mesh("FPS rear sight left luminous dot", box, sightDotMaterial, [-0.045, -0.032, -0.329], [0, 0, 0], pistol);
  rearDotLeft.scale.set(0.006, 0.006, 0.004);
  const rearDotRight = mesh("FPS rear sight right luminous dot", box, sightDotMaterial, [0.045, -0.032, -0.329], [0, 0, 0], pistol);
  rearDotRight.scale.copy(rearDotLeft.scale);
  const frontDot = mesh("FPS front sight luminous dot", box, sightDotMaterial, [0, -0.027, -0.827], [0, 0, 0], pistol);
  frontDot.scale.set(0.006, 0.007, 0.004);
  const muzzle = new THREE.Object3D();
  muzzle.name = "FPS muzzle world anchor";
  muzzle.position.set(0, -0.09, -0.91);
  pistol.add(muzzle);
  const flash = mesh("FPS muzzle flash", flashGeometry, flashMaterial, [0, 0, -0.11], [-Math.PI * 0.5, 0, 0], muzzle);
  flash.visible = false;

  camera.add(root);

  function update(delta, state = {}) {
    const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
    const aiming = Boolean(state.aiming);
    blend += ((aiming ? 1 : 0) - blend) * (1 - Math.exp(-dt * (aiming ? 21 : 16)));
    if (aiming && blend > 0.997) blend = 1;
    if (!aiming && blend < 0.003) blend = 0;
    const muzzleFlash = Boolean(state.muzzleFlash);
    if (muzzleFlash && !previousFlash) {
      recoil = 1;
      flashTime = 0.052;
    }
    previousFlash = muzzleFlash;
    recoil *= Math.exp(-dt * 20);
    flashTime = Math.max(0, flashTime - dt);
    root.visible = blend > 0.015;
    const speed = clamp((Number(state.speed) || 0) / 7, 0, 1);
    const elapsed = Number(state.elapsed) || 0;
    const bob = Math.sin(elapsed * 10.5) * 0.006 * speed;
    root.position.set(0, 0.029 - 0.34 * (1 - blend) + bob + recoil * 0.012, -0.38 + recoil * 0.028);
    root.rotation.set(recoil * -0.045, Math.sin(elapsed * 5.2) * 0.005 * speed, 0);
    slide.position.z = -0.57 + recoil * 0.055;
    flash.visible = flashTime > 0 && blend > 0.55;
    flashMaterial.opacity = clamp(flashTime / 0.052, 0, 1) * 0.94;
    return snapshot();
  }

  function getMuzzleWorld(output = new THREE.Vector3()) {
    camera.updateMatrixWorld(true);
    return muzzle.getWorldPosition(output);
  }

  function setWarmupVisibility(enabled) {
    root.visible = Boolean(enabled);
    flash.visible = Boolean(enabled);
  }

  function snapshot() {
    return Object.freeze({
      visible: root.visible,
      blend,
      recoil,
      muzzleFlash: flash.visible,
      mode: blend > 0.9 ? "iron-sights" : blend > 0 ? "raising" : "holstered",
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    root.clear();
    for (const value of geometries) value.dispose();
    for (const value of materials) value.dispose();
  }

  return Object.freeze({ root, update, getMuzzleWorld, setWarmupVisibility, snapshot, dispose });
}
