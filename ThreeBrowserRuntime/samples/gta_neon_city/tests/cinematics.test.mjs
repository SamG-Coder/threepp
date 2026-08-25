import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";
import { createCinematicDirector } from "../src/game/cinematics.mjs";
import { createPlayer } from "../src/actors/player.mjs";
import { buildCity } from "../src/world/city.mjs";

function story(shot, lineIndex = 0) {
  return {
    cinematic: true,
    sequenceSerial: 4,
    lineIndex,
    line: { shot },
  };
}

function assertVectorClose(actual, expected, message) {
  assert.equal(actual.length, expected.length, message);
  for (let index = 0; index < actual.length; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) < 1e-9,
      `${message}: component ${index} expected ${expected[index]}, received ${actual[index]}`);
  }
}

function assertCameraLooksAt(camera, expectedTarget, message) {
  const actualDirection = new THREE.Vector3();
  const expectedDirection = new THREE.Vector3(...expectedTarget).sub(camera.position).normalize();
  camera.getWorldDirection(actualDirection);
  assert.ok(actualDirection.dot(expectedDirection) > 1 - 1e-12, message);
}

test("cinematic shots keep exclusive authored anchors and named character targets", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const director = createCinematicDirector(camera);
  const anchors = {
    player: new THREE.Vector3(0, 0, 0),
    juno: new THREE.Vector3(10, 0, 0),
    rin: new THREE.Vector3(-8, 0, 1),
    garage: new THREE.Vector3(100, 0, 100),
    comet: new THREE.Vector3(30, 0, 30),
    city: new THREE.Vector3(0, 5, -28),
  };

  director.update(1 / 60, story("garage_two_shot"), anchors);
  assert.deepEqual(camera.position.toArray(), [93.8, 2.55, 94.6],
    "computing the group look target must not overwrite the garage camera anchor");
  assert.equal(camera.fov, 46);

  director.update(1 / 60, story("rin_close", 1), anchors);
  assert.deepEqual(camera.position.toArray(), [-4.9, 1.65, -2.55]);
  assert.equal(camera.fov, 42);
  assert.deepEqual(director.snapshot(), {
    active: true,
    shot: "rin_close",
    cutSerial: "4:1:rin_close",
  });

  director.update(1 / 60, story("kai_garage_close", 2), anchors);
  assert.deepEqual(camera.position.toArray(), [2.65, 1.68, -3.35]);
  assert.equal(camera.fov, 41);
});

test("Borrowed Time shots resolve Leah, depot, and evidence anchors instead of the player fallback", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const director = createCinematicDirector(camera);
  const anchors = {
    player: new THREE.Vector3(-500, 0, -500),
    juno: new THREE.Vector3(12, 0, 14),
    rin: new THREE.Vector3(8, 0, 13),
    garage: new THREE.Vector3(20, 0, 20),
    evidence_table: new THREE.Vector3(100, 0.8, 100),
    evidenceHose: new THREE.Vector3(110, 0.8, 100),
    evidenceHoseStage: new THREE.Vector3(110, 0, 100),
    "evidence-invoice": new THREE.Vector3(120, 0.8, 100),
    evidenceInvoiceStage: new THREE.Vector3(120, 0, 100),
    evidence_log: new THREE.Vector3(130, 0.8, 100),
    evidenceLogStage: new THREE.Vector3(130, 0, 100),
    cafe: new THREE.Vector3(200, 0, 200),
    leah: new THREE.Vector3(204, 0, 201),
    manifest: new THREE.Vector3(300, 0.6, 300),
    manifestProp: new THREE.Vector3(300, 0.6, 300),
    depot: new THREE.Vector3(292, 0, 294),
    dara: new THREE.Vector3(296, 0, 297),
    mara: new THREE.Vector3(22, 0, 24),
    recallBoard: new THREE.Vector3(24, 0.9, 23),
    recallStage: new THREE.Vector3(24, 0.9, 23),
  };
  const cases = [
    ["garage_close", [9.15, 1.64, 10.65], [12, 1.44, 14]],
    ["two_shot", [14.15, 2.48, 14.85], [-244, 1.3, -243]],
    ["evidence_table", [102.4, 2.52, 102.55], [100, 1.12, 100]],
    ["evidence_hose", [111.65, 1.85, 97.8], [110, 0.8, 100]],
    ["evidence_invoice", [118.35, 2, 97.8], [120, 0.8, 100]],
    ["evidence_log", [131.72, 1.95, 97.8], [130, 0.8, 100]],
    ["cafe_two_shot", [195.15, 2.28, 195.3], [-148, 1.25, -149.5]],
    ["leah_close", [206.58, 1.58, 198.1], [204, 1.43, 201]],
    ["manifest_close", [301.45, 1.75, 302.15], [300, 0.6, 300]],
    ["depot_wide", [305.1, 3.25, 305.2], [299.43333333333334, 1.26, 299.3666666666667]],
    ["sealed_garage", [27.15, 3.18, 11.75], [20, 1.15, 20]],
    ["recall_board", [27.5, 1.9, 16.9], [16, 1.1, 18.075]],
    ["recall_customer_close", [25.25, 1.7, 19.75], [22, 1.42, 24]],
    ["kai_recall_close", [24.85, 2.58, 18.65], [20, 2.35, 22.3]],
    ["leah_recall_close", [206.58, 1.58, 198.1], [204, 1.43, 201]],
    ["dara_records_close", [299.15, 1.62, 300.15], [296, 1.43, 297]],
    ["kai_depot_close", [304.65, 2.32, 304.25], [302.3, 2.05, 301.1]],
  ];

  cases.forEach(([shot, expectedPosition, expectedLook], index) => {
    director.update(1 / 60, story(shot, index), anchors);
    assertVectorClose(camera.position.toArray(), expectedPosition, `${shot} must use its authored anchor`);
    assertCameraLooksAt(camera, expectedLook, `${shot} must use its authored look target`);
    assert.ok(camera.position.distanceTo(anchors.player) > 100,
      `${shot} silently used the distant player fallback`);
  });

  director.update(1 / 60, {
    cinematic: true,
    sequenceSerial: 5,
    lineIndex: null,
    line: null,
    choice: { id: "brake_hose_response", cameraShot: "depot_choice" },
  }, anchors);
  assertVectorClose(camera.position.toArray(), [305.1, 3.25, 305.2],
    "the line-free moral choice must retain the authored depot camera");
  assert.equal(director.snapshot().shot, "depot_choice");
});

test("authored Chapter Two location shots stay outside blockers and frame their story subjects", () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const director = createCinematicDirector(camera);
  const leah = new THREE.Vector3(...city.chapterTwo.leahAnchor);
  // This is a representative valid interaction position beside Leah. Main
  // passes the same chapter anchor as the cafe anchor for this sequence.
  const kai = leah.clone().add(new THREE.Vector3(1.6, 0, -0.2));
  const anchors = { player: kai, leah, cafe: leah };
  const head = new THREE.Vector3();
  const projected = new THREE.Vector3();

  function assertOutsideBlockers(shot) {
    for (const blocker of city.blockers) {
      if (!blocker.active || blocker.shape !== "aabb") continue;
      const [x, y, z] = blocker.center;
      const [halfX, halfY, halfZ] = blocker.halfExtents;
      const inside = Math.abs(camera.position.x - x) <= halfX &&
        Math.abs(camera.position.y - y) <= halfY &&
        Math.abs(camera.position.z - z) <= halfZ;
      assert.equal(inside, false, `${shot} lens entered ${blocker.id}`);
    }
  }

  try {
    const garage = new THREE.Vector3(...city.missionPoints.pulseGarage.position);
    const recallStage = new THREE.Vector3(...city.chapterTwo.garageClues.supplier_invoice);
    const recallBoard = new THREE.Vector3(...city.chapterTwo.cinematicAnchors.recall_board);
    const kaiRoot = new THREE.Group();
    scene.add(kaiRoot);
    kaiRoot.position.copy(garage);
    kaiRoot.updateMatrixWorld(true);

    director.update(1 / 60, story("phone", -1), {
      player: kaiRoot,
      garage,
      recallBoard,
      recallStage,
    });
    assertOutsideBlockers("phone");
    kaiRoot.getWorldPosition(head).add(new THREE.Vector3(0, 1.42, 0)).project(camera);
    assert.ok(Math.abs(head.x) < 0.82 && Math.abs(head.y) < 0.82 && head.z > -1 && head.z < 1,
      `Kai must remain visible in the garage phone shot; NDC=${head.toArray()}`);
    assert.ok(camera.position.z < garage.z - 4.5,
      "the phone lens must stay street-side with Pulse Garage behind Kai");

    director.update(1 / 60, story("cafe_two_shot"), anchors);
    assertOutsideBlockers("cafe_two_shot");
    for (const [name, actor] of [["Kai", kai], ["Leah", leah]]) {
      head.copy(actor).add(new THREE.Vector3(0, 1.42, 0)).project(camera);
      assert.ok(Math.abs(head.x) < 0.82 && Math.abs(head.y) < 0.82 && head.z > -1 && head.z < 1,
        `${name} must remain inside the Common Ground two-shot frame; NDC=${head.toArray()}`);
    }

    director.update(1 / 60, story("leah_close", 1), anchors);
    assertOutsideBlockers("leah_close");
    assertCameraLooksAt(camera, [leah.x, leah.y + 1.43, leah.z],
      "Leah close-up must retain her eyeline from the street side");

    const manifest = new THREE.Vector3(...city.chapterTwo.manifestDesk);
    const manifestProp = new THREE.Vector3(...city.chapterTwo.cinematicAnchors.depot_manifest);
    const depot = new THREE.Vector3(...city.chapterTwo.focus);
    const dara = new THREE.Vector3(...city.chapterTwo.keeperWitnessAnchor);
    kaiRoot.position.copy(manifest);
    kaiRoot.rotation.y = 0.73;
    kaiRoot.updateMatrixWorld(true);
    const logicalPosition = kaiRoot.position.clone();

    director.update(1 / 60, story("manifest_close", 2), {
      player: kaiRoot,
      depot,
      manifest,
      manifestProp,
      dara,
    });
    assertOutsideBlockers("manifest_close");
    projected.copy(manifestProp).project(camera);
    assert.ok(Math.abs(projected.x) < 0.12 && Math.abs(projected.y) < 0.86 && projected.z > -1 && projected.z < 1,
      `the physical Southline manifest must own the evidence insert; NDC=${projected.toArray()}`);

    director.update(1 / 60, story("depot_wide", 3), {
      player: kaiRoot,
      depot,
      manifest,
      manifestProp,
      dara,
    });
    assertOutsideBlockers("depot_wide");
    assertVectorClose(kaiRoot.position.toArray(), logicalPosition.toArray(),
      "the depot tableau must not alter Kai's logical/save position");
    assert.equal(kaiRoot.matrixAutoUpdate, false,
      "the depot tableau should stage only Kai's render matrix");
    const depotSubjects = [
      ["Kai", new THREE.Vector3().setFromMatrixPosition(kaiRoot.matrixWorld).add(new THREE.Vector3(0, 1.42, 0))],
      ["Dara", dara.clone().add(new THREE.Vector3(0, 1.42, 0))],
      ["manifest", manifestProp.clone()],
    ];
    const depotScreenPoints = [];
    for (const [name, subject] of depotSubjects) {
      subject.project(camera);
      depotScreenPoints.push(subject);
      assert.ok(Math.abs(subject.x) < 0.82 && Math.abs(subject.y) < 0.82 && subject.z > -1 && subject.z < 1,
        `${name} must remain inside the Southline evidence tableau; NDC=${subject.toArray()}`);
    }
    for (let first = 0; first < depotScreenPoints.length; first += 1) {
      for (let second = first + 1; second < depotScreenPoints.length; second += 1) {
        assert.ok(depotScreenPoints[first].distanceTo(depotScreenPoints[second]) > 0.16,
          "Kai, Dara and the manifest must not collapse onto the same screen axis");
      }
    }

    director.update(1 / 60, {
      cinematic: true,
      sequenceSerial: 5,
      lineIndex: null,
      line: null,
      choice: { id: "brake_hose_response", cameraShot: "depot_choice" },
    }, { player: kaiRoot, depot, manifest, manifestProp, dara });
    assert.equal(director.snapshot().shot, "depot_choice",
      "the line-free decision must retain the authored Southline tableau");
    assert.equal(kaiRoot.matrixAutoUpdate, false,
      "choice presentation must preserve render-only staging until a branch is chosen");

    const juno = garage.clone().add(new THREE.Vector3(2.3, 0, 0.04));
    const rin = garage.clone().add(new THREE.Vector3(-2.5, 0, -0.04));
    director.update(1 / 60, story("recall_board", 2), {
      player: kaiRoot,
      garage,
      recallBoard,
      recallStage,
      juno,
      rin,
    });
    assertOutsideBlockers("recall_board");
    assertVectorClose(kaiRoot.position.toArray(), logicalPosition.toArray(),
      "recall tableau must not alter Kai's logical/save position at Southline");
    assert.equal(kaiRoot.matrixAutoUpdate, false,
      "recall tableau should stage only Kai's render matrix while the shot is active");
    kaiRoot.getWorldPosition(head);
    assert.ok(head.distanceTo(recallBoard) < 6,
      `Kai's visual tableau position must be beside the recall board; received ${head.toArray()}`);
    head.y += 1.42;
    head.project(camera);
    projected.copy(recallBoard).project(camera);
    const recallSubjects = [
      ["Kai", head],
      ["recall board", projected],
      ["Juno", juno.clone().add(new THREE.Vector3(0, 1.42, 0)).project(camera)],
      ["Rin", rin.clone().add(new THREE.Vector3(0, 1.42, 0)).project(camera)],
    ];
    for (const [name, value] of recallSubjects) {
      assert.ok(Math.abs(value.x) < 0.82 && Math.abs(value.y) < 0.82 && value.z > -1 && value.z < 1,
        `${name} must remain inside the garage recall tableau; NDC=${value.toArray()}`);
    }

    const canopy = scene.getObjectByName("Pulse Garage rain canopy");
    assert.ok(canopy, "the recall composition test requires Pulse's physical rain canopy");
    scene.updateMatrixWorld(true);
    const canopyBounds = new THREE.Box3().setFromObject(canopy);
    assert.ok(camera.position.z < canopyBounds.min.z - 3,
      "the recall lens must stay on the open forecourt side of the canopy");
    assert.ok(camera.position.y < canopyBounds.min.y - 1.5,
      "the recall lens must stay at human height rather than climbing into the canopy");
    assert.ok(camera.position.distanceTo(recallBoard) < 7.6,
      "the recall lens must stay close enough for the board and people to read together");

    const canopyScreenCorners = [];
    for (const x of [canopyBounds.min.x, canopyBounds.max.x]) {
      for (const y of [canopyBounds.min.y, canopyBounds.max.y]) {
        for (const z of [canopyBounds.min.z, canopyBounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).project(camera);
          if (corner.z >= -1 && corner.z <= 1 && Math.abs(corner.x) <= 1 && Math.abs(corner.y) <= 1) {
            canopyScreenCorners.push(corner);
          }
        }
      }
    }
    assert.ok(canopyScreenCorners.length >= 2,
      "the real canopy should remain a visible location cue, not be ignored by the composition test");
    const lowestCanopyEdge = Math.min(...canopyScreenCorners.map(value => value.y));
    const highestSubject = Math.max(...recallSubjects.map(([, value]) => value.y));
    assert.ok(lowestCanopyEdge > highestSubject + 0.18,
      `the visible canopy must clear every staged head and the recall board (${lowestCanopyEdge} vs ${highestSubject})`);

    const ray = new THREE.Ray();
    const rayDirection = new THREE.Vector3();
    const hit = new THREE.Vector3();
    for (const [name, projectedSubject] of recallSubjects) {
      // Reconstruct each tested world target for a direct canopy visibility
      // check instead of treating the non-collider canopy as empty space.
      const worldSubject = name === "Kai"
        ? new THREE.Vector3().setFromMatrixPosition(kaiRoot.matrixWorld).add(new THREE.Vector3(0, 1.42, 0))
        : name === "recall board"
          ? recallBoard.clone()
          : name === "Juno"
            ? juno.clone().add(new THREE.Vector3(0, 1.42, 0))
            : rin.clone().add(new THREE.Vector3(0, 1.42, 0));
      const subjectDistance = worldSubject.distanceTo(camera.position);
      rayDirection.copy(worldSubject).sub(camera.position).normalize();
      ray.set(camera.position, rayDirection);
      const intersection = ray.intersectBox(canopyBounds, hit);
      assert.ok(!intersection || intersection.distanceTo(camera.position) >= subjectDistance,
        `${name} is physically occluded by Pulse's rain canopy`);
      assert.ok(Number.isFinite(projectedSubject.x));
    }

    director.update(1 / 60, { cinematic: false }, { player: kaiRoot });
    assert.equal(kaiRoot.matrixAutoUpdate, true);
    kaiRoot.getWorldPosition(head);
    assertVectorClose(head.toArray(), logicalPosition.toArray(),
      "Kai's visual staging must restore immediately when the recall shot ends");
  } finally {
    city.dispose();
  }
});

test("The Night Count owns a safe diner tableau while Kai remains logically at the route", () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const director = createCinematicDirector(camera);
  const dinerBusiness = city.businesses.find(value => value.id === "southline_diner");
  assert.ok(dinerBusiness, "Southline Diner must remain a physical world anchor");
  const diner = new THREE.Vector3(...(dinerBusiness.interactionPosition ?? dinerBusiness.position));
  const kaiStage = diner.clone().add(new THREE.Vector3(-0.25, 0, 1.15));
  const logicalKaiPosition = new THREE.Vector3(48, 0.2, -17.25);
  const kai = new THREE.Group();
  kai.position.copy(logicalKaiPosition);
  scene.add(kai);
  const participantOffsets = {
    nightMalik: [-2.40, 0, 0.90],
    nightEvelyn: [-2.60, 0, -1.10],
    nightDesmond: [-0.80, 0, -2.00],
    nightNadiya: [1.00, 0, -1.10],
  };
  const anchors = {
    player: kai,
    nightDiner: diner,
    nightKaiStage: kaiStage,
  };
  for (const [key, offset] of Object.entries(participantOffsets)) {
    const actor = new THREE.Group();
    actor.position.copy(diner).add(new THREE.Vector3(...offset));
    scene.add(actor);
    anchors[key] = actor;
    assert.equal(city.isBlockedCircle?.(actor.position.x, actor.position.z, 0.38), false,
      `${key} diner mark must remain outside a world blocker`);
    assert.equal(city.isRoad?.(actor.position.x, actor.position.z), false,
      `${key} diner mark must remain on the frontage, not in traffic`);
  }
  const rosa = new THREE.Group();
  rosa.position.fromArray(dinerBusiness.keeperPosition);
  scene.add(rosa);
  anchors.nightRosa = rosa;
  anchors.nightSpeaker = anchors.nightNadiya;
  scene.updateMatrixWorld(true);

  function assertOutsideBlockers(shot) {
    for (const blocker of city.blockers) {
      if (!blocker.active || blocker.shape !== "aabb") continue;
      const [x, y, z] = blocker.center;
      const [halfX, halfY, halfZ] = blocker.halfExtents;
      const inside = Math.abs(camera.position.x - x) <= halfX &&
        Math.abs(camera.position.y - y) <= halfY &&
        Math.abs(camera.position.z - z) <= halfZ;
      assert.equal(inside, false, `${shot} lens entered ${blocker.id}`);
    }
  }

  function projectedHead(actor, staged = false) {
    const value = staged
      ? new THREE.Vector3().setFromMatrixPosition(kai.matrixWorld)
      : actor.getWorldPosition(new THREE.Vector3());
    return value.add(new THREE.Vector3(0, 1.42, 0)).project(camera);
  }

  try {
    director.update(1 / 60, story("night_diner_group", 0), anchors);
    assertVectorClose(camera.position.toArray(), [-122.4, 2.7, -118.2],
      "the briefing must hard-cut to Southline's authored group lens");
    assertOutsideBlockers("night_diner_group");
    assertVectorClose(kai.position.toArray(), logicalKaiPosition.toArray(),
      "the diner tableau must not alter Kai's logical/save position");
    assert.equal(kai.matrixAutoUpdate, false,
      "Kai should move to the diner only through the existing render-matrix staging path");
    const groupSubjects = [
      ["Kai", null, true],
      ["Rosa", rosa, false],
      ["Malik", anchors.nightMalik, false],
      ["Evelyn", anchors.nightEvelyn, false],
      ["Desmond", anchors.nightDesmond, false],
      ["Nadiya", anchors.nightNadiya, false],
    ];
    for (const [name, actor, staged] of groupSubjects) {
      const head = projectedHead(actor, staged);
      assert.ok(Math.abs(head.x) < 0.92 && Math.abs(head.y) < 0.92 && head.z > -1 && head.z < 1,
        `${name} must remain readable in the Night Count group frame; NDC=${head.toArray()}`);
    }

    director.update(1 / 60, story("night_diner_speaker", 1), anchors);
    assertVectorClose(camera.position.toArray(), [-133.15, 2.02, -116.05],
      "a participant line must cut to the diner speaker lens");
    assertOutsideBlockers("night_diner_speaker");
    const speakerHead = projectedHead(anchors.nightNadiya);
    const kaiHead = projectedHead(null, true);
    for (const [name, head] of [["Nadiya", speakerHead], ["Kai", kaiHead]]) {
      assert.ok(Math.abs(head.x) < 0.86 && Math.abs(head.y) < 0.86 && head.z > -1 && head.z < 1,
        `${name} must remain visible in the speaker/Kai composition; NDC=${head.toArray()}`);
    }
    assert.ok(speakerHead.distanceTo(kaiHead) > 0.14,
      `the current speaker and Kai must not collapse onto one screen silhouette (${speakerHead.toArray()} vs ${kaiHead.toArray()})`);

    director.update(1 / 60, story("night_diner_kai", 2), anchors);
    assertVectorClose(camera.position.toArray(), [-124.15, 1.92, -115.85],
      "Kai's answer must use the authored diner eyeline");
    assertCameraLooksAt(camera, [kaiStage.x, kaiStage.y + 1.44, kaiStage.z],
      "Kai's diner shot must target his render-only stage mark");
    assertOutsideBlockers("night_diner_kai");

    director.update(1 / 60, {
      cinematic: true,
      sequenceSerial: 9,
      lineIndex: null,
      line: null,
      choice: { id: "night_route_evidence", cameraShot: "night_diner_choice" },
    }, anchors);
    assertVectorClose(camera.position.toArray(), [-122.65, 2.52, -117.75],
      "the modal evidence decision must retain the diner group tableau");
    assert.equal(director.snapshot().shot, "night_diner_choice");
    assert.equal(kai.matrixAutoUpdate, false,
      "choice presentation must retain render-only staging without teleporting Kai");

    director.update(1 / 60, { cinematic: false }, { player: kai });
    assert.equal(kai.matrixAutoUpdate, true,
      "ordinary route play must regain Kai's normal transform immediately after the cutscene");
    assertVectorClose(kai.position.toArray(), logicalKaiPosition.toArray(),
      "ending the diner cutscene must restore Kai's exact logical position");
    assertVectorClose(kai.getWorldPosition(new THREE.Vector3()).toArray(), logicalKaiPosition.toArray(),
      "ending the diner cutscene must restore Kai's exact rendered position");
  } finally {
    city.dispose();
  }
});

test("the native first-capture frame exposes the real evidence meshes without Kai or the arrival ramp in front", () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  // Begin from a deliberately unrelated gameplay view. One director update is
  // the exact hard-cut moment captured by the native control harness.
  camera.position.set(410, 120, -330);
  camera.lookAt(0, 0, 0);
  const director = createCinematicDirector(camera);
  const player = createPlayer({
    scene,
    world: city,
    input: {
      movement: () => ({ x: 0, z: 0 }),
      actionDown: () => false,
      actionPressed: () => false,
    },
  });
  const paperMesh = city.root.getObjectByName("Downtown pedestrian crossings");
  const ramp = city.root.getObjectByName("Garage arrival ramp");
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const instancePosition = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const rayDirection = new THREE.Vector3();

  function paperScreenBounds(target, radius) {
    scene.updateMatrixWorld(true);
    paperMesh.geometry.computeBoundingBox();
    const bounds = paperMesh.geometry.boundingBox;
    const screen = [];
    let count = 0;
    for (let index = 0; index < paperMesh.count; index += 1) {
      paperMesh.getMatrixAt(index, instanceMatrix);
      worldMatrix.multiplyMatrices(paperMesh.matrixWorld, instanceMatrix);
      instancePosition.setFromMatrixPosition(worldMatrix);
      if (instancePosition.distanceTo(target) > radius) continue;
      count += 1;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            screen.push(new THREE.Vector3(x, y, z).applyMatrix4(worldMatrix).project(camera));
          }
        }
      }
    }
    return {
      count,
      minX: Math.min(...screen.map(value => value.x)),
      maxX: Math.max(...screen.map(value => value.x)),
      minY: Math.min(...screen.map(value => value.y)),
      maxY: Math.max(...screen.map(value => value.y)),
    };
  }

  function assertNoPlayerBetween(target, label) {
    scene.updateMatrixWorld(true);
    const targetDistance = camera.position.distanceTo(target);
    rayDirection.copy(target).sub(camera.position).normalize();
    raycaster.set(camera.position, rayDirection);
    raycaster.far = targetDistance - 0.04;
    const playerHits = raycaster.intersectObject(player.root, true);
    assert.equal(playerHits.length, 0, `${label} is occluded by Kai's rendered body`);
  }

  function assertRampDoesNotOcclude(target, label) {
    scene.updateMatrixWorld(true);
    const targetDistance = camera.position.distanceTo(target);
    rayDirection.copy(target).sub(camera.position).normalize();
    raycaster.set(camera.position, rayDirection);
    raycaster.far = targetDistance - 0.08;
    assert.equal(raycaster.intersectObject(ramp, false).length, 0,
      `${label} is occluded by the rendered Garage arrival ramp`);
  }

  try {
    const logStage = new THREE.Vector3(...city.chapterTwo.garageClues.service_log);
    const logProp = new THREE.Vector3(...city.chapterTwo.cinematicAnchors.service_log);
    player.teleport(logStage.x, logStage.z);
    const logLogical = player.root.position.clone();
    director.update(1 / 60, story("evidence_log", 0), {
      player: player.root,
      evidenceLog: logProp,
      evidenceLogStage: logStage,
    });
    assertVectorClose(camera.position.toArray(), [-134.78, 1.94, 78.06],
      "the first service-log frame must hard-cut, never blend from gameplay");
    assert.equal(director.snapshot().cutSerial, "4:0:evidence_log");
    assertVectorClose(player.root.position.toArray(), logLogical.toArray(),
      "evidence staging must leave Kai's logical position untouched");
    assert.equal(player.root.matrixAutoUpdate, false);
    const logBounds = paperScreenBounds(logProp, 0.75);
    assert.equal(logBounds.count, 2, "both physical pages of the open service log must be captured");
    assert.ok(logBounds.maxX - logBounds.minX > 0.48 && logBounds.maxY - logBounds.minY > 0.30,
      `the service log is too small to read in its first frame: ${JSON.stringify(logBounds)}`);
    assert.ok(logBounds.minY > -0.35 && logBounds.maxY < 0.35,
      `the service log slipped to the top edge: ${JSON.stringify(logBounds)}`);
    assertNoPlayerBetween(logProp, "service log");
    assertRampDoesNotOcclude(logProp, "service log");

    director.update(1 / 60, { cinematic: false }, { player: player.root });
    assert.equal(player.root.matrixAutoUpdate, true);
    assertVectorClose(player.root.position.toArray(), logLogical.toArray(),
      "service-log staging must restore on the first non-cinematic frame");

    const manifestStage = new THREE.Vector3(...city.chapterTwo.manifestDesk);
    const manifestProp = new THREE.Vector3(...city.chapterTwo.cinematicAnchors.depot_manifest);
    player.teleport(manifestStage.x, manifestStage.z);
    const manifestLogical = player.root.position.clone();
    director.update(1 / 60, story("manifest_close", 0), {
      player: player.root,
      manifest: manifestStage,
      manifestProp,
    });
    assertVectorClose(camera.position.toArray(), [-180.05, 2.425, -133.85],
      "the first manifest frame must hard-cut to the paper mesh");
    const manifestBounds = paperScreenBounds(manifestProp, 0.55);
    assert.equal(manifestBounds.count, 4,
      "the original manifest and three nearby copied/missing rows should share the physical insert");
    assert.ok(manifestBounds.maxX - manifestBounds.minX > 0.40 && manifestBounds.maxY - manifestBounds.minY > 0.30,
      `the depot document is absent or too small: ${JSON.stringify(manifestBounds)}`);
    assert.ok(manifestBounds.minY > -0.35 && manifestBounds.maxY < 0.35,
      `the depot document is not centred: ${JSON.stringify(manifestBounds)}`);
    assertNoPlayerBetween(manifestProp, "depot manifest");
    assertVectorClose(player.root.position.toArray(), manifestLogical.toArray(),
      "manifest staging must be render-only");

    director.update(1 / 60, { cinematic: false }, { player: player.root });
    const recallStage = new THREE.Vector3(...city.chapterTwo.garageClues.supplier_invoice);
    const recallBoard = new THREE.Vector3(...city.chapterTwo.cinematicAnchors.recall_board);
    const garage = new THREE.Vector3(...city.missionPoints.pulseGarage.position);
    const juno = garage.clone().add(new THREE.Vector3(2.3, 0, 0.04));
    const rin = garage.clone().add(new THREE.Vector3(-2.5, 0, -0.04));
    director.update(1 / 60, story("recall_board", 0), {
      player: player.root,
      garage,
      juno,
      rin,
      recallBoard,
      recallStage,
    });
    const boardBounds = paperScreenBounds(recallBoard, 0.40);
    assert.equal(boardBounds.count, 3,
      "the recall notice and both preallocated support-call cards should share the consequence frame");
    assert.ok(boardBounds.maxX - boardBounds.minX > 0.09 && boardBounds.maxY - boardBounds.minY > 0.13,
      `the physical recall board is absent from the first consequence frame: ${JSON.stringify(boardBounds)}`);
    assertNoPlayerBetween(recallBoard, "recall board");
    for (const [name, target] of [
      ["recall board", recallBoard],
      ["Kai's waist", new THREE.Vector3().setFromMatrixPosition(player.root.matrixWorld).add(new THREE.Vector3(0, 0.80, 0))],
      ["Juno's waist", juno.clone().add(new THREE.Vector3(0, 0.80, 0))],
      ["Rin's waist", rin.clone().add(new THREE.Vector3(0, 0.80, 0))],
    ]) assertRampDoesNotOcclude(target, name);
  } finally {
    player.dispose();
    city.dispose();
  }
});

test("every Borrowed Time profile preserves world-up and a level horizon", () => {
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.08, 680);
  const director = createCinematicDirector(camera);
  const anchors = {
    player: new THREE.Vector3(0, 0, 0),
    juno: new THREE.Vector3(7, 0, 2),
    garage: new THREE.Vector3(10, 0, 8),
    evidence_table: new THREE.Vector3(9, 0.8, 9),
    evidence_hose: new THREE.Vector3(8.5, 0.8, 8.8),
    evidence_hose_stage: new THREE.Vector3(8.5, 0, 8.8),
    evidence_invoice: new THREE.Vector3(9.2, 0.8, 8.5),
    evidence_invoice_stage: new THREE.Vector3(9.2, 0, 8.5),
    evidence_log: new THREE.Vector3(9.5, 0.8, 9.1),
    evidence_log_stage: new THREE.Vector3(9.5, 0, 9.1),
    cafe: new THREE.Vector3(-30, 0, 25),
    leah: new THREE.Vector3(-27, 0, 24),
    manifest: new THREE.Vector3(-180, 0.8, -136),
    manifest_prop: new THREE.Vector3(-181.5, 1.275, -136),
    depot: new THREE.Vector3(-176, 0, -144),
    dara: new THREE.Vector3(-183, 0, -138),
    recall_board: new THREE.Vector3(11, 0.8, 8),
    recall_stage: new THREE.Vector3(11, 0, 8),
  };
  const chapterTwoShots = [
    "phone",
    "garage_close",
    "two_shot",
    "evidence_table",
    "evidence_hose",
    "evidence_invoice",
    "evidence_log",
    "cafe_two_shot",
    "leah_close",
    "manifest_close",
    "depot_wide",
    "depot_choice",
    "sealed_garage",
    "recall_board",
  ];
  const localRight = new THREE.Vector3();
  const forward = new THREE.Vector3();

  chapterTwoShots.forEach((shot, index) => {
    director.update(1 / 60, story(shot, index), anchors);
    localRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    camera.getWorldDirection(forward);
    assertVectorClose(camera.up.toArray(), [0, 1, 0], `${shot} camera.up must remain world-up`);
    assert.ok(Math.abs(localRight.y) < 1e-9, `${shot} introduced camera roll into the horizon`);
    assert.ok(Number.isFinite(forward.x) && Number.isFinite(forward.y) && Number.isFinite(forward.z),
      `${shot} produced an invalid look direction`);
    assert.ok(Math.abs(camera.quaternion.length() - 1) < 1e-9, `${shot} camera quaternion must stay normalized`);
  });
});
