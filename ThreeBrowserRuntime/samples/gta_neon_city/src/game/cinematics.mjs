import * as THREE from "three/webgpu";

const SHOTS = Object.freeze({
  city_dawn: Object.freeze({ anchor: "player", look: "city", offset: [13, 8.5, 15], lookOffset: [0, 4.2, -12], fov: 49 }),
  kai_phone: Object.freeze({ anchor: "player", look: "player", offset: [2.4, 1.85, 3.15], lookOffset: [0, 1.55, 0], fov: 43 }),
  kai_close: Object.freeze({ anchor: "player", look: "player", offset: [-2.25, 1.72, 2.75], lookOffset: [0, 1.48, 0], fov: 41 }),
  // Pulse Garage opens north onto the forecourt. This street-side angle keeps
  // the lens outside the bay wall and frontage posts while preserving an
  // intimate eyeline for Kai's consequential dialogue.
  kai_garage_close: Object.freeze({ anchor: "player", look: "player", offset: [2.65, 1.68, -3.35], lookOffset: [0, 1.46, 0], fov: 41 }),
  walk_to_garage: Object.freeze({ anchor: "player", look: "garage", offset: [5.8, 4.1, 7.8], lookOffset: [0, 1.8, 0], fov: 52 }),
  juno_wide: Object.freeze({ anchor: "garage", look: "group", offset: [-6.8, 2.85, -6.4], lookOffset: [0, 1.30, 0], fov: 49 }),
  garage_two_shot: Object.freeze({ anchor: "garage", look: "group", offset: [-6.2, 2.55, -5.4], lookOffset: [0, 1.28, 0], fov: 46 }),
  juno_close: Object.freeze({ anchor: "juno", look: "juno", offset: [-3.1, 1.62, -3.7], lookOffset: [0, 1.46, 0], fov: 40 }),
  comet_reveal: Object.freeze({ anchor: "comet", look: "comet", offset: [6.8, 2.65, 7.2], lookOffset: [0, 0.88, 0], fov: 47 }),
  garage_return: Object.freeze({ anchor: "garage", look: "comet", offset: [7.8, 3.8, -9.4], lookOffset: [0, 1.05, 0], fov: 50 }),
  rin_close: Object.freeze({ anchor: "rin", look: "rin", offset: [3.1, 1.65, -3.55], lookOffset: [0, 1.42, 0], fov: 42 }),
  siblings_wide: Object.freeze({ anchor: "garage", look: "midpoint", offset: [-7.2, 3.2, -8.8], lookOffset: [0, 1.35, 0], fov: 50 }),
  // Chapter Two / Borrowed Time. Evidence inserts stay close enough to read as
  // inspection rather than surveillance, while the consequence shots widen
  // to keep the affected places and people in the frame.
  // The garage and Southline conversations both happen against north-facing
  // work areas. The south-side approach leaves Kai readable with the location
  // behind him; the old positive-Z offset crossed Pulse Garage's front AABB.
  phone: Object.freeze({ anchor: "player", look: "player", offset: [3.65, 2.18, -5.10], lookOffset: [0, 1.44, 0], fov: 45 }),
  garage_close: Object.freeze({ anchor: "juno", look: "juno", offset: [-2.85, 1.64, -3.35], lookOffset: [0, 1.44, 0], fov: 40 }),
  two_shot: Object.freeze({ anchor: "garage", look: "midpoint", offset: [-5.85, 2.48, -5.15], lookOffset: [0, 1.30, 0], fov: 46 }),
  evidence_table: Object.freeze({ anchor: "evidence_table", look: "evidence_table", offset: [2.40, 1.72, 2.55], lookOffset: [0, 0.32, 0], fov: 39 }),
  evidence_hose: Object.freeze({
    anchor: "evidence_hose", look: "evidence_hose",
    offset: [1.65, 1.05, -2.20], lookOffset: [0, 0, 0],
    stagePlayerAnchor: "evidence_hose_stage", stagePlayerOffset: [-2.20, 0, -0.20],
    fov: 35,
  }),
  evidence_invoice: Object.freeze({
    anchor: "evidence_invoice", look: "evidence_invoice",
    offset: [-1.65, 1.20, -2.20], lookOffset: [0, 0, 0],
    stagePlayerAnchor: "evidence_invoice_stage", stagePlayerOffset: [2.20, 0, -0.20],
    fov: 35,
  }),
  evidence_log: Object.freeze({
    anchor: "evidence_log", look: "evidence_log",
    offset: [1.72, 1.15, -2.20], lookOffset: [0, 0, 0],
    stagePlayerAnchor: "evidence_log_stage", stagePlayerOffset: [-2.20, 0, -0.20],
    fov: 36,
  }),
  // Common Ground occupies the south frontage of its tower. Keep both lenses
  // on the open street side (negative Z); a positive-Z approach puts the
  // two-shot inside the tower shell and hides both actors behind the facade.
  cafe_two_shot: Object.freeze({ anchor: "cafe", look: "leah_midpoint", offset: [-4.85, 2.28, -4.70], lookOffset: [0, 1.25, 0], fov: 46 }),
  leah_close: Object.freeze({ anchor: "leah", look: "leah", offset: [2.58, 1.58, -2.90], lookOffset: [0, 1.43, 0], fov: 40 }),
  manifest_close: Object.freeze({
    anchor: "manifest_prop", look: "manifest_prop",
    offset: [1.45, 1.15, 2.15], lookOffset: [0, 0, 0],
    stagePlayerAnchor: "manifest", stagePlayerOffset: [2.30, 0, 1.10],
    fov: 38,
  }),
  // The last evidence line and the following decision both use the open east
  // side of Southline's yard. Kai is staged off the manifest axis so Dara,
  // Kai and the physical paper read as a triangle instead of one silhouette.
  depot_wide: Object.freeze({
    anchor: "manifest",
    look: "depot_tableau",
    offset: [5.10, 2.65, 5.20],
    lookOffset: [0, 0.86, 0],
    stagePlayerAnchor: "manifest",
    stagePlayerOffset: [2.30, 0, 1.10],
    fov: 48,
  }),
  depot_choice: Object.freeze({
    anchor: "manifest",
    look: "depot_tableau",
    offset: [5.10, 2.65, 5.20],
    lookOffset: [0, 0.86, 0],
    stagePlayerAnchor: "manifest",
    stagePlayerOffset: [2.30, 0, 1.10],
    fov: 48,
  }),
  sealed_garage: Object.freeze({ anchor: "garage", look: "garage", offset: [7.15, 3.18, -8.25], lookOffset: [0, 1.15, 0], fov: 49 }),
  // The decision is made at Southline, then cuts to the work done back at
  // Pulse. Stage only Kai's render matrix beside the physical recall board;
  // his logical transform (and therefore save/collision state) never moves.
  recall_board: Object.freeze({
    anchor: "recall_board",
    look: "recall_tableau",
    // Low and close on the open forecourt side. The old high, long lens put
    // Pulse's rain canopy across most of the upper frame.
    offset: [3.50, 1.00, -6.10],
    lookOffset: [0, 0.65, 0],
    stagePlayerAnchor: "recall_stage",
    stagePlayerOffset: [-4.00, 0, -0.70],
    fov: 50,
  }),
  // People Behind the Ledger. These lenses reuse the already-visible recall
  // board, copied dispatch rows and named actors. Kai is render-staged only;
  // completing an activity never teleports or rewrites the saved player.
  recall_customer_close: Object.freeze({
    anchor: "mara", look: "mara",
    offset: [3.25, 1.70, -4.25], lookOffset: [0, 1.42, 0], fov: 42,
  }),
  kai_recall_close: Object.freeze({
    anchor: "recall_board", look: "staged_player",
    offset: [0.85, 1.68, -4.35], lookOffset: [0, 1.45, 0],
    stagePlayerAnchor: "recall_stage", stagePlayerOffset: [-4.00, 0, -0.70],
    fov: 41,
  }),
  leah_recall_close: Object.freeze({
    anchor: "leah", look: "leah",
    offset: [2.58, 1.58, -2.90], lookOffset: [0, 1.43, 0], fov: 40,
  }),
  dara_records_close: Object.freeze({
    anchor: "dara", look: "dara",
    offset: [3.15, 1.62, 3.15], lookOffset: [0, 1.43, 0], fov: 40,
  }),
  kai_depot_close: Object.freeze({
    anchor: "manifest", look: "staged_player",
    offset: [4.65, 1.72, 4.25], lookOffset: [0, 1.45, 0],
    stagePlayerAnchor: "manifest", stagePlayerOffset: [2.30, 0, 1.10],
    fov: 41,
  }),
  // The Night Count. Southline's diner frontage and every participant already
  // exist in the live world. These profiles only take camera ownership and
  // render-stage Kai beside the group; they introduce no scene or GPU assets.
  night_diner_group: Object.freeze({
    anchor: "night_diner", look: "night_tableau",
    offset: [5.60, 2.50, -7.20], lookOffset: [0, 1.02, 0],
    stagePlayerAnchor: "night_kai_stage", stagePlayerOffset: [0, 0, 0],
    fov: 49,
  }),
  night_diner_speaker: Object.freeze({
    anchor: "night_diner", look: "night_speaker_tableau",
    // The south-west reverse keeps Kai and the current speaker on separate
    // screen axes; the south-east group lens compressed them into one shape.
    offset: [-5.15, 1.82, -5.05], lookOffset: [0, 1.40, 0],
    stagePlayerAnchor: "night_kai_stage", stagePlayerOffset: [0, 0, 0],
    fov: 41,
  }),
  night_diner_kai: Object.freeze({
    anchor: "night_diner", look: "staged_player",
    offset: [3.85, 1.72, -4.85], lookOffset: [0, 1.44, 0],
    stagePlayerAnchor: "night_kai_stage", stagePlayerOffset: [0, 0, 0],
    fov: 40,
  }),
  night_diner_choice: Object.freeze({
    anchor: "night_diner", look: "night_tableau",
    offset: [5.35, 2.32, -6.75], lookOffset: [0, 1.02, 0],
    stagePlayerAnchor: "night_kai_stage", stagePlayerOffset: [0, 0, 0],
    fov: 47,
  }),
});
const NIGHT_TABLEAU_KEYS = Object.freeze([
  "night_rosa",
  "night_malik",
  "night_evelyn",
  "night_desmond",
  "night_nadiya",
]);

// Prepared once in RAM. Cinematic updates can accept snake_case, camelCase or
// kebab-case anchor bags without building alias strings on a gameplay frame.
const NAMED_KEY_ALIASES = new Map();
function registerNamedKey(key) {
  if (typeof key !== "string" || NAMED_KEY_ALIASES.has(key)) return;
  const aliases = [];
  for (const alias of [
    key,
    key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase()),
    key.replaceAll("_", "-"),
  ]) {
    if (!aliases.includes(alias)) aliases.push(alias);
  }
  NAMED_KEY_ALIASES.set(key, Object.freeze(aliases));
}
for (const profile of Object.values(SHOTS)) {
  for (const key of [profile.anchor, profile.look, profile.stagePlayerAnchor]) {
    registerNamedKey(key);
  }
}
for (const key of [...NIGHT_TABLEAU_KEYS, "night_speaker"]) registerNamedKey(key);

function point(value, output) {
  const source = value?.root?.position ?? value?.position ?? value;
  if (source?.isVector3) return output.copy(source);
  if (Array.isArray(source)) return output.set(Number(source[0]) || 0, Number(source[1]) || 0, Number(source[2]) || 0);
  return output.set(Number(source?.x) || 0, Number(source?.y) || 0, Number(source?.z) || 0);
}

/** A small authored camera rig that only owns the camera while a story sequence is cinematic. */
export function createCinematicDirector(camera) {
  if (!camera?.isCamera) throw new TypeError("createCinematicDirector requires a camera");
  const desiredPosition = new THREE.Vector3();
  const desiredLook = new THREE.Vector3();
  const anchor = new THREE.Vector3();
  const look = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const scratchA = new THREE.Vector3();
  const scratchB = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const lookOffset = new THREE.Vector3();
  const lookMatrix = new THREE.Matrix4();
  const desiredQuaternion = new THREE.Quaternion();
  const stagedPlayerPosition = new THREE.Vector3();
  const stagedPlayerOffset = new THREE.Vector3();
  const stagedPlayerLocalPosition = new THREE.Vector3();
  const stagedPlayerScale = new THREE.Vector3();
  const stagedPlayerWorldQuaternion = new THREE.Quaternion();
  const stagedPlayerLocalQuaternion = new THREE.Quaternion();
  const stagedPlayerParentQuaternion = new THREE.Quaternion();
  const stagedPlayerMatrix = new THREE.Matrix4();
  const savedPlayerMatrix = new THREE.Matrix4();
  const stagedPlayerParentInverse = new THREE.Matrix4();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let active = false;
  let shotKey = null;
  let cutSerial = null;
  let hasStagedPlayerPosition = false;
  let stagedPlayerTarget = null;
  let stagedPlayerOriginalAutoUpdate = true;

  function restoreStagedPlayer() {
    if (!stagedPlayerTarget) return;
    stagedPlayerTarget.matrixAutoUpdate = stagedPlayerOriginalAutoUpdate;
    if (stagedPlayerOriginalAutoUpdate) stagedPlayerTarget.updateMatrix();
    else stagedPlayerTarget.matrix.copy(savedPlayerMatrix);
    stagedPlayerTarget.matrixWorldNeedsUpdate = true;
    stagedPlayerTarget.updateMatrixWorld?.(true);
    stagedPlayerTarget = null;
  }

  function stagePlayerForTableau(profile, anchors, cameraPosition) {
    const target = anchors.player?.root ?? anchors.player;
    if (!profile.stagePlayerOffset || !target?.isObject3D) {
      restoreStagedPlayer();
      return;
    }
    if (stagedPlayerTarget !== target) {
      restoreStagedPlayer();
      stagedPlayerTarget = target;
      stagedPlayerOriginalAutoUpdate = target.matrixAutoUpdate;
      if (target.matrixAutoUpdate) target.updateMatrix();
      savedPlayerMatrix.copy(target.matrix);
    }

    stagedPlayerLocalPosition.copy(stagedPlayerPosition);
    if (target.parent) {
      target.parent.updateWorldMatrix?.(true, false);
      stagedPlayerParentInverse.copy(target.parent.matrixWorld).invert();
      stagedPlayerLocalPosition.applyMatrix4(stagedPlayerParentInverse);
    }
    // Player characters face down local -Z, matching the gameplay yaw helper.
    const yaw = Math.atan2(
      stagedPlayerPosition.x - cameraPosition.x,
      stagedPlayerPosition.z - cameraPosition.z,
    );
    stagedPlayerWorldQuaternion.setFromAxisAngle(worldUp, yaw);
    stagedPlayerLocalQuaternion.copy(stagedPlayerWorldQuaternion);
    if (target.parent) {
      target.parent.getWorldQuaternion(stagedPlayerParentQuaternion).invert();
      stagedPlayerLocalQuaternion.premultiply(stagedPlayerParentQuaternion);
    }
    stagedPlayerScale.copy(target.scale);
    stagedPlayerMatrix.compose(stagedPlayerLocalPosition, stagedPlayerLocalQuaternion, stagedPlayerScale);
    target.matrix.copy(stagedPlayerMatrix);
    target.matrixAutoUpdate = false;
    target.matrixWorldNeedsUpdate = true;
    target.updateMatrixWorld?.(true);
  }

  function resolveNamed(key, anchors, output) {
    const aliases = NAMED_KEY_ALIASES.get(key);
    if (!aliases) return false;
    for (const candidate of aliases) {
      if (anchors?.[candidate] === undefined || anchors[candidate] === null) continue;
      point(anchors[candidate], output);
      return true;
    }
    return false;
  }

  function resolveAnchor(key, anchors) {
    // Authored story modules can introduce a named location without growing a
    // switch here. Derived targets such as midpoint/group remain look-only.
    if (resolveNamed(key, anchors, anchor)) return anchor;
    if (key === "garage") return point(anchors.garage ?? anchors.juno ?? anchors.player, anchor);
    if (key === "juno") return point(anchors.juno ?? anchors.garage ?? anchors.player, anchor);
    if (key === "rin") return point(anchors.rin ?? anchors.juno ?? anchors.garage ?? anchors.player, anchor);
    if (key === "comet") return point(anchors.comet ?? anchors.garage ?? anchors.player, anchor);
    return point(anchors.player, anchor);
  }

  function resolveLook(key, anchors) {
    if (resolveNamed(key, anchors, look)) return look;
    if (key === "staged_player" && hasStagedPlayerPosition) return look.copy(stagedPlayerPosition);
    if (key === "city") return point(anchors.city ?? anchors.garage ?? anchors.player, look);
    if (key === "garage") return point(anchors.garage ?? anchors.juno ?? anchors.player, look);
    if (key === "juno") return point(anchors.juno ?? anchors.garage ?? anchors.player, look);
    if (key === "rin") return point(anchors.rin ?? anchors.juno ?? anchors.garage ?? anchors.player, look);
    if (key === "comet") return point(anchors.comet ?? anchors.garage ?? anchors.player, look);
    if (key === "midpoint") {
      midpoint.copy(point(anchors.player, scratchA));
      midpoint.lerp(point(anchors.juno ?? anchors.garage ?? anchors.player, scratchB), 0.5);
      return look.copy(midpoint);
    }
    if (key === "leah_midpoint") {
      midpoint.copy(point(anchors.player, scratchA));
      midpoint.lerp(point(anchors.leah ?? anchors.cafe ?? anchors.player, scratchB), 0.5);
      return look.copy(midpoint);
    }
    if (key === "depot_tableau") {
      if (!resolveNamed("manifest_prop", anchors, scratchA) && !resolveNamed("manifest", anchors, scratchA)) {
        point(anchors.depot ?? anchors.player, scratchA);
      }
      midpoint.copy(scratchA);
      midpoint.add(point(anchors.dara ?? anchors.depot ?? anchors.player, scratchB));
      midpoint.add(hasStagedPlayerPosition ? stagedPlayerPosition : point(anchors.player, scratchA));
      return look.copy(midpoint.multiplyScalar(1 / 3));
    }
    if (key === "recall_tableau") {
      if (!resolveNamed("recall_board", anchors, scratchA)) point(anchors.garage ?? anchors.player, scratchA);
      midpoint.copy(scratchA);
      midpoint.add(hasStagedPlayerPosition ? stagedPlayerPosition : point(anchors.player, scratchB));
      midpoint.add(point(anchors.juno ?? anchors.garage ?? anchors.player, scratchB));
      midpoint.add(point(anchors.rin ?? anchors.juno ?? anchors.garage ?? anchors.player, scratchA));
      return look.copy(midpoint.multiplyScalar(0.25));
    }
    if (key === "night_speaker_tableau") {
      if (!resolveNamed("night_speaker", anchors, scratchA)) point(anchors.player, scratchA);
      midpoint.copy(scratchA);
      midpoint.add(hasStagedPlayerPosition ? stagedPlayerPosition : point(anchors.player, scratchB));
      return look.copy(midpoint.multiplyScalar(0.5));
    }
    if (key === "night_tableau") {
      midpoint.set(0, 0, 0);
      let count = 0;
      for (const keyValue of NIGHT_TABLEAU_KEYS) {
        if (!resolveNamed(keyValue, anchors, scratchA)) continue;
        midpoint.add(scratchA);
        count += 1;
      }
      if (hasStagedPlayerPosition) {
        midpoint.add(stagedPlayerPosition);
        count += 1;
      }
      return count > 0 ? look.copy(midpoint.multiplyScalar(1 / count)) : point(anchors.player, look);
    }
    if (key === "group") {
      midpoint.copy(point(anchors.player, scratchA));
      midpoint.add(point(anchors.juno ?? anchors.player, scratchB));
      midpoint.add(point(anchors.rin ?? anchors.juno ?? anchors.player, scratchA));
      return look.copy(midpoint.multiplyScalar(1 / 3));
    }
    return point(anchors.player, look);
  }

  function update(deltaValue, story = {}, anchors = {}) {
    // Choices do not invent dialogue lines or alter the story ledger. A story
    // can provide one render-only cameraShot so an authored tableau persists
    // while its modal options are visible.
    const presentationShot = story.line?.shot ?? story.choice?.cameraShot ?? null;
    if (!story.cinematic || !presentationShot) {
      const wasActive = active;
      restoreStagedPlayer();
      hasStagedPlayerPosition = false;
      active = false;
      shotKey = null;
      cutSerial = null;
      return { active: false, ended: wasActive };
    }
    const dt = Math.max(0, Math.min(0.1, Number(deltaValue) || 0));
    const profile = SHOTS[presentationShot] ?? SHOTS.kai_close;
    const presentationIndex = story.line ? story.lineIndex : `choice:${story.choice?.id ?? "unknown"}`;
    const nextCut = `${story.sequenceSerial}:${presentationIndex}:${presentationShot}`;
    const hardCut = cutSerial !== nextCut;
    cutSerial = nextCut;
    shotKey = presentationShot;
    if (profile.stagePlayerOffset) {
      if (!resolveNamed(profile.stagePlayerAnchor, anchors, stagedPlayerPosition)) {
        point(anchors.player, stagedPlayerPosition);
      }
      stagedPlayerOffset.fromArray(profile.stagePlayerOffset);
      stagedPlayerPosition.add(stagedPlayerOffset);
      hasStagedPlayerPosition = true;
    } else {
      restoreStagedPlayer();
      hasStagedPlayerPosition = false;
    }
    resolveAnchor(profile.anchor, anchors);
    resolveLook(profile.look, anchors);
    offset.fromArray(profile.offset);
    lookOffset.fromArray(profile.lookOffset);
    desiredPosition.copy(anchor).add(offset);
    desiredLook.copy(look).add(lookOffset);
    stagePlayerForTableau(profile, anchors, desiredPosition);
    camera.up.set(0, 1, 0);
    lookMatrix.lookAt(desiredPosition, desiredLook, camera.up);
    desiredQuaternion.setFromRotationMatrix(lookMatrix);
    if (hardCut || !active) {
      camera.position.copy(desiredPosition);
      camera.quaternion.copy(desiredQuaternion);
      camera.fov = profile.fov;
    } else {
      const positionResponse = 1 - Math.exp(-dt * 2.1);
      const rotationResponse = 1 - Math.exp(-dt * 4.5);
      camera.position.lerp(desiredPosition, positionResponse);
      camera.quaternion.slerp(desiredQuaternion, rotationResponse);
      camera.fov += (profile.fov - camera.fov) * (1 - Math.exp(-dt * 3.2));
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    active = true;
    return { active: true, ended: false, shot: shotKey };
  }

  function snapshot() {
    return Object.freeze({ active, shot: shotKey, cutSerial });
  }

  return { update, snapshot };
}
