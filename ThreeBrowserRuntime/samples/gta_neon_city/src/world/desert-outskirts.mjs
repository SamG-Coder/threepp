import * as THREE from "three/webgpu";
import { createCharacterNameplate } from "../actors/character-nameplate.mjs";

const RUIN_CENTER = Object.freeze([0, 0, 505]);

export function createDesertOutskirts({ scene, world, onPlayerDamage = null } = {}) {
  if (!scene || !world) throw new TypeError("createDesertOutskirts requires scene and world");
  const root = new THREE.Group();
  root.name = "Ashwind Desert and buried ruins";
  root.userData.staticWorld = true;
  scene.add(root);

  const geometries = [
    new THREE.PlaneGeometry(384, 440, 24, 28),
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.CylinderGeometry(1, 1.25, 1, 8),
    new THREE.CapsuleGeometry(0.3, 0.75, 4, 8),
    new THREE.SphereGeometry(0.31, 10, 8),
    new THREE.SphereGeometry(0.035, 6, 4),
  ];
  const [sandGeometry, boxGeometry, columnGeometry, bodyGeometry, headGeometry, eyeGeometry] = geometries;
  const materials = [
    new THREE.MeshStandardMaterial({ color: 0xb88a4c, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x725437, roughness: 0.94 }),
    new THREE.MeshStandardMaterial({ color: 0x2b251d, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ color: 0x8b7449, roughness: 0.96 }),
    new THREE.MeshStandardMaterial({ color: 0x342e24, roughness: 0.9 }),
    new THREE.MeshBasicNodeMaterial({ color: 0xffa33b }),
  ];
  const [sand, stone, shadow, huskSkin, huskCloth, eyes] = materials;

  const terrain = new THREE.Mesh(sandGeometry, sand);
  terrain.name = "traversable wind-rippled desert floor";
  terrain.rotation.x = -Math.PI * 0.5;
  terrain.position.set(0, 0.02, 406);
  terrain.receiveShadow = true;
  root.add(terrain);

  const platforms = [];
  const addedBlockers = [];
  const addBox = (name, position, scale, material = stone) => {
    const part = new THREE.Mesh(boxGeometry, material);
    part.name = name;
    part.position.set(...position);
    part.scale.set(...scale);
    part.castShadow = true;
    part.receiveShadow = true;
    root.add(part);
    platforms.push({ x: position[0], z: position[2], halfX: scale[0] * 0.5, halfZ: scale[2] * 0.5, top: position[1] + scale[1] * 0.5 });
    return part;
  };
  const addBlocker = (id, x, y, z, halfX, halfY, halfZ, kind = "desert-ruin") => {
    const blocker = { id, kind, shape: "aabb", center: [x, y, z], halfExtents: [halfX, halfY, halfZ], active: true };
    world.blockers?.push?.(blocker);
    addedBlockers.push(blocker);
    return blocker;
  };

  // The old maintenance wall remains intact except for one believable breach
  // wide enough for a car. It preserves the city's authored map silhouette;
  // crossing it reveals the separate desert play space.
  for (const [side, x] of [["west", -99], ["east", 99]]) {
    addBox(`north boundary wall ${side} of breach`, [x, 1.45, 196], [186, 2.8, 1.2], shadow);
    addBlocker(`desert-breach-wall-${side}`, x, 1.45, 196, 93, 1.4, 0.6, "boundary-wall");
  }
  addBox("broken breach marker west", [-6.5, 0.65, 196], [2.4, 1.2, 2.0], stone).rotation.z = -0.22;
  addBox("broken breach marker east", [6.5, 0.55, 196], [2.2, 1.0, 1.8], stone).rotation.z = 0.28;

  // A broken temple silhouette, readable from the city edge but only
  // populated when the player crosses deep into the desert.
  addBox("ruin buried foundation", [0, 0.7, 505], [31, 1.3, 25]);
  for (const [index, x, z, height] of [
    [1, -25, 487, 8], [2, 25, 487, 11], [3, -25, 523, 12], [4, 25, 523, 7],
    [5, -10, 505, 15], [6, 11, 505, 10],
  ]) {
    const column = new THREE.Mesh(columnGeometry, stone);
    column.name = `weathered ruin column ${index}`;
    column.position.set(x, height * 0.5, z);
    column.scale.set(1.8, height, 1.8);
    column.rotation.y = index * 0.37;
    column.castShadow = true;
    root.add(column);
    platforms.push({ x, z, halfX: 1.8, halfZ: 1.8, top: height });
    addBlocker(`desert-ruin-column-${index}`, x, height * 0.5, z, 1.8, height * 0.5, 1.8);
  }
  addBox("collapsed ruin lintel west", [-17, 8.2, 493], [14, 1.2, 2.2]);
  addBlocker("desert-ruin-lintel-west", -17, 8.2, 493, 7, 0.6, 1.1);
  addBox("collapsed ruin lintel east", [17, 6.4, 518], [12, 1.1, 2.2]);
  addBlocker("desert-ruin-lintel-east", 17, 6.4, 518, 6, 0.55, 1.1);
  for (let index = 0; index < 18; ++index) {
    const phase = index * 2.399963;
    const radius = 42 + (index % 5) * 7;
    addBox(`desert ruin rubble ${index + 1}`,
      [Math.cos(phase) * radius, 0.35, 505 + Math.sin(phase) * radius],
      [1.2 + index % 3, 0.5 + index % 2, 0.9 + (index + 1) % 3], index % 2 ? stone : shadow).rotation.y = phase;
  }

  const friend = new THREE.Group();
  friend.name = "Mara desert rescue friend";
  friend.position.set(0, 0.15, 505);
  const friendBody = new THREE.Mesh(bodyGeometry, new THREE.MeshStandardMaterial({ color: 0x365f86, roughness: 0.82 }));
  materials.push(friendBody.material);
  friendBody.position.y = 1.05;
  const friendHead = new THREE.Mesh(headGeometry, huskSkin);
  friendHead.position.y = 2.0;
  friend.add(friendBody, friendHead);
  root.add(friend);
  let boundFriend = null;
  let friendReturnPosition = new THREE.Vector3(-20, 0.2, 120);
  let friendReturned = false;

  const makeMaraNameplate = parent => createCharacterNameplate(parent, "MARA", {
    geometries, materials, objectName: "Mara Velez floating name tag",
  });
  let friendNameplate = makeMaraNameplate(friend);

  function friendRoot() { return boundFriend?.root ?? friend; }

  function bindFriend(actor, options = {}) {
    if (!actor?.root) return false;
    boundFriend = actor;
    friend.visible = false;
    friendNameplate.removeFromParent();
    friendNameplate = makeMaraNameplate(actor.root);
    const returnValue = options.returnPosition;
    if (returnValue?.isVector3) friendReturnPosition.copy(returnValue);
    else if (Array.isArray(returnValue)) friendReturnPosition.fromArray(returnValue);
    actor.root.position.set(0, 1.35, 505);
    actor.homePosition?.copy?.(actor.root.position);
    actor.storyProtected = true;
    actor.storyLocked = true;
    actor.active = true;
    actor.root.visible = true;
    return true;
  }

  const husks = [];
  for (let index = 0; index < 10; ++index) {
    const actor = new THREE.Group();
    actor.name = `Ashwind husk ${index + 1}`;
    const phase = index * 2.399963;
    actor.position.set(Math.cos(phase) * (12 + index * 1.7), 0.15, 505 + Math.sin(phase) * (12 + index * 1.7));
    const body = new THREE.Mesh(bodyGeometry, index % 2 ? huskCloth : huskSkin);
    body.position.y = 1.05;
    body.scale.set(0.92, 1.05, 0.68);
    const head = new THREE.Mesh(headGeometry, huskSkin);
    head.position.y = 2.0;
    head.scale.set(0.82, 1.05, 0.9);
    actor.add(body, head);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeometry, eyes);
      eye.position.set(side * 0.09, 2.04, -0.285);
      actor.add(eye);
    }
    actor.visible = false;
    root.add(actor);
    husks.push({ id: `ashwind-husk-${index + 1}`, root: actor, health: 100, alive: true, active: false, attackCooldown: 0, phase });
  }

  let cutsceneStarted = false;
  let cutsceneTimer = 0;
  let rescueComplete = false;
  let thankTimer = 0;
  const friendReturnDisplacement = new THREE.Vector3();
  const huskDisplacement = new THREE.Vector3();

  function update(delta, playerPosition) {
    const dt = Math.max(0, Math.min(0.1, Number(delta) || 0));
    const px = Number(playerPosition?.x) || 0;
    const pz = Number(playerPosition?.z) || 0;
    if (!cutsceneStarted && pz > 208) {
      cutsceneStarted = true;
      cutsceneTimer = 7.2;
    }
    cutsceneTimer = Math.max(0, cutsceneTimer - dt);
    if (boundFriend && !rescueComplete) {
      const base = Number(world.terrainHeight?.(boundFriend.root.position.x, boundFriend.root.position.z) ?? 0) || 0;
      boundFriend.root.position.y = supportHeightAt(
        boundFriend.root.position.x,
        boundFriend.root.position.z,
        Math.max(boundFriend.root.position.y, 1.35),
        base,
      );
    }
    for (const husk of husks) {
      if (!husk.alive) continue;
      const dx = px - husk.root.position.x;
      const dz = pz - husk.root.position.z;
      const distance = Math.hypot(dx, dz);
      husk.active ||= distance < 82;
      husk.root.visible = husk.active;
      if (!husk.active) continue;
      husk.attackCooldown = Math.max(0, husk.attackCooldown - dt);
      if (distance > 1.45) {
        const speed = distance > 16 ? 2.35 : 1.65;
        huskDisplacement.set(
          dx / Math.max(0.001, distance) * speed * dt,
          0,
          dz / Math.max(0.001, distance) * speed * dt,
        );
        const resolved = world.resolveCircleMotion?.(husk.root.position, huskDisplacement, 0.36);
        if (resolved?.isVector3) husk.root.position.copy(resolved);
        else husk.root.position.add(huskDisplacement);
        husk.root.position.y = Number(world.terrainHeight?.(husk.root.position.x, husk.root.position.z) ?? husk.root.position.y) || 0;
        husk.root.rotation.y = Math.atan2(-dx, -dz);
      } else if (husk.attackCooldown <= 0) {
        husk.attackCooldown = 1.15;
        onPlayerDamage?.(8, husk);
      }
      husk.phase += dt * (distance > 1.45 ? 7 : 2);
      husk.root.rotation.z = Math.sin(husk.phase) * 0.035;
    }
    if (!rescueComplete && cutsceneStarted && husks.every(husk => !husk.alive)) {
      rescueComplete = true;
      thankTimer = 5.2;
    }
    thankTimer = Math.max(0, thankTimer - dt);
    if (rescueComplete && thankTimer <= 0 && boundFriend && !friendReturned) {
      const rootValue = boundFriend.root;
      const navigatingBreach = rootValue.position.z > 188;
      const targetX = navigatingBreach ? 0 : friendReturnPosition.x;
      const targetZ = navigatingBreach ? 184 : friendReturnPosition.z;
      const dx = targetX - rootValue.position.x;
      const dz = targetZ - rootValue.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 2.2 || navigatingBreach) {
        const step = Math.min(distance, 3.4 * dt);
        friendReturnDisplacement.set(dx / distance * step, 0, dz / distance * step);
        const resolved = world.resolveCircleMotion?.(rootValue.position, friendReturnDisplacement, 0.38) ?? rootValue.position.add(friendReturnDisplacement);
        rootValue.position.copy(resolved);
        rootValue.position.y = Number(world.terrainHeight?.(rootValue.position.x, rootValue.position.z) ?? rootValue.position.y) || 0;
        rootValue.rotation.y = Math.atan2(-dx, -dz);
      } else {
        rootValue.position.copy(friendReturnPosition);
        boundFriend.homePosition?.copy?.(friendReturnPosition);
        boundFriend.storyProtected = false;
        boundFriend.storyLocked = false;
        boundFriend.presentationStaged = false;
        friendReturned = true;
      }
    }
  }

  function raycast(origin, direction, maximum = 125) {
    let best = null;
    if (cutsceneStarted && !rescueComplete) {
      const protectedFriend = friendRoot();
      const ox = protectedFriend.position.x - origin.x;
      const oy = protectedFriend.position.y + 1.2 - origin.y;
      const oz = protectedFriend.position.z - origin.z;
      const along = ox * direction.x + oy * direction.y + oz * direction.z;
      const missSq = ox * ox + oy * oy + oz * oz - along * along;
      if (along >= 0 && along <= maximum && missSq <= 0.68 * 0.68) {
        best = { actor: { id: "mara-desert-friend", friend: true, root: protectedFriend }, distance: along, point: origin.clone().addScaledVector(direction, along) };
      }
    }
    for (const husk of husks) {
      if (!husk.alive || !husk.active) continue;
      const cx = husk.root.position.x;
      const cy = husk.root.position.y + 1.2;
      const cz = husk.root.position.z;
      const ox = cx - origin.x;
      const oy = cy - origin.y;
      const oz = cz - origin.z;
      const along = ox * direction.x + oy * direction.y + oz * direction.z;
      if (along < 0 || along > maximum || (best && along >= best.distance)) continue;
      const missSq = ox * ox + oy * oy + oz * oz - along * along;
      if (missSq > 0.62 * 0.62) continue;
      best = { actor: husk, distance: along, point: origin.clone().addScaledVector(direction, along) };
    }
    return best;
  }

  function damage(husk, amount) {
    if (husk?.friend) return { accepted: false, protected: true, id: husk.id, damage: 0, defeated: false };
    if (!husk?.alive) return { accepted: false, damage: 0 };
    const dealt = Math.min(husk.health, Math.max(0, Number(amount) || 0));
    husk.health -= dealt;
    if (husk.health <= 0) {
      husk.alive = false;
      husk.root.rotation.z = -Math.PI * 0.5;
    }
    return { accepted: dealt > 0, id: husk.id, damage: dealt, defeated: !husk.alive };
  }

  function snapshot() {
    const px = husks.filter(husk => husk.active && husk.alive).length;
    return Object.freeze({
      id: "ashwind-desert",
      ruinCenter: RUIN_CENTER,
      breach: Object.freeze({ center: [0, 0, 196], width: 10, drivable: true }),
      discovered: cutsceneStarted,
      cutsceneActive: cutsceneTimer > 0,
      friend: Object.freeze({ id: "mara-velez", name: "Mara Velez", protected: !friendReturned, rescued: rescueComplete, returning: rescueComplete && !friendReturned, returnedToCity: friendReturned, home: friendReturnPosition.toArray() }),
      activeHusks: px,
      remainingHusks: husks.filter(husk => husk.alive).length,
    });
  }

  function presentation() {
    if (thankTimer > 0) return Object.freeze({
      cinematic: true,
      controlsLocked: true,
      sequenceSerial: 741,
      lineIndex: 0,
      line: Object.freeze({ speaker: "Mara", text: "Thank you, Kai. I can make it back through the breach now.", shot: "desert_friend_close" }),
    });
    if (cutsceneTimer <= 0) return null;
    const late = cutsceneTimer < 3.4;
    return Object.freeze({
      cinematic: true,
      controlsLocked: true,
      sequenceSerial: 740,
      lineIndex: late ? 1 : 0,
      line: Object.freeze({
        speaker: late ? "Mara" : "Kai",
        text: late ? "The ruins woke them. Clear a path and get me home." : "Mara! Stay behind the stone. I’m coming through.",
        shot: late ? "desert_friend_close" : "desert_arrival_wide",
      }),
    });
  }

  function supportHeightAt(xValue, zValue, currentY = 0, fallback = 0) {
    const x = Number(xValue) || 0;
    const z = Number(zValue) || 0;
    let height = Number(fallback) || 0;
    for (const platform of platforms) {
      if (Math.abs(x - platform.x) > platform.halfX || Math.abs(z - platform.z) > platform.halfZ) continue;
      if (currentY < platform.top - 0.72) continue;
      height = Math.max(height, platform.top);
    }
    return height;
  }

  function dispose() {
    if (Array.isArray(world.blockers)) {
      for (const blocker of addedBlockers) {
        const index = world.blockers.indexOf(blocker);
        if (index >= 0) world.blockers.splice(index, 1);
      }
    }
    root.removeFromParent();
    root.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }

  return Object.freeze({
    root,
    get friend() { return friendRoot(); },
    husks,
    bindFriend,
    update,
    raycast,
    damage,
    presentation,
    supportHeightAt,
    snapshot,
    dispose,
  });
}
