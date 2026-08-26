import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three/webgpu";

import { createGtaHud, isAuthoredNarrativePresentation, phoneRasterSignature, planGridRoute } from "../src/ui/hud.mjs";

test("phone clock hover press and scroll never invalidate the resident app canvas", () => {
  const base = {
    open: true,
    app: "work",
    title: "CITY WORK",
    subtitle: "JOBS AND ACTIVITIES",
    time: "07:12",
    scroll: 0,
    hover: -1,
    pressed: false,
    items: [{ title: "ROADSIDE HELP", detail: "AVAILABLE" }],
  };
  const signature = phoneRasterSignature(base);
  assert.equal(phoneRasterSignature({ ...base, time: "07:13" }), signature);
  assert.equal(phoneRasterSignature({ ...base, hover: 0, pressed: true }), signature);
  assert.equal(phoneRasterSignature({ ...base, scroll: 3 }), signature);
});

test("minimap navigation plans a deterministic axis-aligned road route", () => {
  const start = { x: 7, z: 11 };
  const target = [137, 0, -101];
  const first = planGridRoute(start, target, 48, {
    minX: -192,
    maxX: 192,
    minZ: -192,
    maxZ: 192,
  });
  const second = planGridRoute(start, target, 48, {
    minX: -192,
    maxX: 192,
    minZ: -192,
    maxZ: 192,
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first[0], { x: 7, y: 0, z: 11 });
  assert.deepEqual(first.at(-1), { x: 137, y: 0, z: -101 });
  assert.ok(Object.isFrozen(first));
  for (const point of first) {
    assert.ok(Object.isFrozen(point));
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
  }
  for (let index = 1; index < first.length; ++index) {
    const previous = first[index - 1];
    const current = first[index];
    assert.ok(previous.x === current.x || previous.z === current.z, "route segments must follow grid axes");
  }
  assert.ok(first.slice(1, -1).some(point => point.x % 48 === 0 || point.z % 48 === 0));
});

test("minimap navigation clamps endpoints to the authored city bounds", () => {
  const route = planGridRoute([500, 0, -500], [-500, 0, 500], 48, {
    minX: -192,
    maxX: 192,
    minZ: -192,
    maxZ: 192,
  });
  assert.deepEqual(route[0], { x: 192, y: 0, z: -192 });
  assert.deepEqual(route.at(-1), { x: -192, y: 0, z: 192 });
  assert.deepEqual(planGridRoute(null, [0, 0, 0]), []);
});

test("minimap raster contains visible roads, route, people and a centered player marker", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    hud.update({
      elapsed: 2,
      capture: { locked: true },
      player: { position: [0, 0, 0], yaw: 0, health: 100, stamina: 100, armor: 0, alive: true },
      world: {
        bounds: { minX: -192, maxX: 155, minZ: -192, maxZ: 192 },
        roadSpacing: 48,
        minimapRadius: 104,
        district: { name: "Pulse Core" },
      },
      vehicles: [{ id: "commuter", position: [14, 0, 10] }],
      population: [{ id: "neighbour", position: [-9, 0, 8] }],
      lifeActivities: [
        { kind: "volunteer", hubPosition: [32, 0, 28] },
        { kind: "basketball", hubPosition: [-32, 0, 28] },
      ],
      neighbourhood: {
        appetiteStatus: "STEADY",
        businesses: [
          { position: [-20, 0, 12], open: true },
          { position: [20, 0, 12], open: false },
        ],
      },
      mission: { stage: "available", startPosition: [42, 0, 44] },
    });
    const bytes = hud.minimapTexture.image.data;
    const center = Math.floor(hud.minimapTexture.image.width * 0.5);
    const centerOffset = (center * hud.minimapTexture.image.width + center) * 4;
    assert.deepEqual([...bytes.slice(centerOffset, centerOffset + 4)], [104, 238, 255, 255]);
    let routePixels = 0;
    let civilianPixels = 0;
    let basketballPixels = 0;
    let businessPixels = 0;
    for (let offset = 0; offset < bytes.length; offset += 4) {
      if (bytes[offset] === 38 && bytes[offset + 1] === 224 && bytes[offset + 2] === 242) routePixels += 1;
      if (bytes[offset] === 236 && bytes[offset + 1] === 189 && bytes[offset + 2] === 74) civilianPixels += 1;
      if (bytes[offset] === 255 && bytes[offset + 1] === 164 && bytes[offset + 2] === 76) basketballPixels += 1;
      if (bytes[offset] === 255 && bytes[offset + 1] === 190 && bytes[offset + 2] === 92) businessPixels += 1;
    }
    assert.ok(routePixels > 20, `expected a visible cyan route, found ${routePixels} pixels`);
    assert.ok(civilianPixels > 0, "expected a visible civilian blip");
    assert.ok(basketballPixels > 0, "expected a distinct orange Harbour Court blip");
    assert.ok(businessPixels > 0, "expected an amber open-business marker");
    assert.ok(hud.minimapTexture.version > 0);
  } finally {
    hud.dispose();
  }
});

test("Open Doors uses one fixed GPU menu pool with readable affordability and appetite state", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    const menuItems = [
      { id: "meal", name: "MARKET JOLLOF BOX", cost: 24, heal: 8, stamina: 14, appetite: 34 },
      { id: "wrap", name: "PLANTAIN AND BEAN WRAP", cost: 17, heal: 4, stamina: 15, appetite: 25 },
      { id: "tea", name: "CHILLED HIBISCUS TEA", cost: 80, heal: 1, stamina: 19, appetite: 7 },
      { id: "pay_a_meal_forward", name: "PAY A MEAL FORWARD", cost: 18, payForward: true },
    ];
    const base = {
      elapsed: 12,
      capture: { locked: true },
      player: { position: [-144, 0.2, 127], health: 82, stamina: 55, armor: 0, cash: 40, alive: true },
      neighbourhood: {
        menuOpen: true,
        businessName: "MINA'S MARKET KITCHEN",
        keeperName: "MINA OKAFOR",
        openingHours: { label: "07:00-21:00" },
        keeperLine: "MINA OKAFOR: A market remembers who shows up when the shutters are heavy.",
        familiarity: 2,
        appetite: 31,
        appetiteStatus: "PECKISH",
        selectionIndex: 0,
        menuItems,
        businesses: [{ position: [-144, 0.2, 127], open: true }],
      },
    };
    const meshCount = () => {
      let count = 0;
      hud.scene.traverse(object => { if (object.isMesh) count += 1; });
      return count;
    };
    const before = meshCount();
    hud.update(base);
    const group = hud.scene.getObjectByName("Open Doors fixed neighbourhood shop panel");
    assert.ok(group?.visible);
    const backdrop = hud.scene.getObjectByName("Open Doors modal backdrop");
    const modalText = ["title", "hours", "keeper", "vitals", "dialogue", "hint"]
      .map(name => hud.scene.getObjectByName(`Open Doors modal ${name}`));
    assert.ok(modalText.every(mesh => mesh?.renderOrder > backdrop.renderOrder),
      "transparent shop text must render after the opaque-black modal backdrop");
    const rows = Array.from({ length: 4 }, (_, index) => hud.scene.getObjectByName(`Open Doors fixed menu row ${index + 1}`));
    assert.ok(rows.every(row => row?.visible));
    const rowGeometries = rows.map(row => row.geometry);
    const rowPositionBuffers = rows.map(row => row.geometry.getAttribute("position").array);
    const rowUvBuffers = rows.map(row => row.geometry.getAttribute("uv").array);
    const rowPositionVersions = rows.map(row => row.geometry.getAttribute("position").version);
    const rowUvVersions = rows.map(row => row.geometry.getAttribute("uv").version);
    for (const row of rows) {
      assert.equal(row.geometry.getAttribute("position").usage, THREE.StaticDrawUsage);
      assert.equal(row.geometry.getAttribute("uv").usage, THREE.StaticDrawUsage);
      assert.notEqual(row.geometry.getAttribute("position").usage, THREE.DynamicDrawUsage,
        "fixed text buffers must not be uploaded as per-frame dynamic streams");
    }
    assert.match(rows[0].userData.text, /MARKET JOLLOF BOX.*HEALTH \+8.*FED \+34/);
    assert.equal(rows[2].material.color.getHex(), 0x7c8795, "unaffordable food should be visibly muted");
    assert.match(rows[3].userData.text, /NO BUFF.*SOMEONE EATS LATER/);
    hud.update({ ...base, neighbourhood: { ...base.neighbourhood, selectionIndex: 3, consuming: true, consumeProgress: 0.5 } });
    assert.equal(meshCount(), before, "menu navigation must reuse its fixed mesh pool");
    for (let index = 0; index < rows.length; ++index) {
      assert.strictEqual(rows[index].geometry, rowGeometries[index],
        "changing shop strings must update fixed glyph geometries in place");
      assert.strictEqual(rows[index].geometry.getAttribute("position").array, rowPositionBuffers[index],
        "changing shop strings must retain fixed position buffers");
      assert.strictEqual(rows[index].geometry.getAttribute("uv").array, rowUvBuffers[index],
        "changing shop strings must retain fixed UV buffers");
    }
    assert.ok(rows[0].geometry.getAttribute("position").version > rowPositionVersions[0]);
    assert.ok(rows[0].geometry.getAttribute("uv").version > rowUvVersions[0]);
    assert.ok(rows[3].geometry.getAttribute("position").version > rowPositionVersions[3]);
    const stablePositionVersions = rows.map(row => row.geometry.getAttribute("position").version);
    const stableUvVersions = rows.map(row => row.geometry.getAttribute("uv").version);
    hud.update({ ...base, neighbourhood: { ...base.neighbourhood, selectionIndex: 3, consuming: true, consumeProgress: 0.5 } });
    assert.deepEqual(rows.map(row => row.geometry.getAttribute("position").version), stablePositionVersions,
      "unchanged menu text must not schedule redundant position uploads");
    assert.deepEqual(rows.map(row => row.geometry.getAttribute("uv").version), stableUvVersions,
      "unchanged menu text must not schedule redundant UV uploads");
    assert.equal(rows[3].material.color.getHex(), 0xffd17a);
  } finally {
    hud.dispose();
  }
});

test("Harbour Court renders its live release track through the proven text atlas", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  try {
    hud.update({
      elapsed: 3,
      capture: { locked: true },
      player: { position: [140.6, 0.34, -96], health: 100, stamina: 100, armor: 0, alive: true },
      activity: {
        kind: "basketball",
        title: "HARBOUR COURT",
        stage: "charging",
        status: "active",
        objective: "PRESS E IN THE GREEN WINDOW TO RELEASE",
        charge: 0.7,
        targetRelease: 0.72,
        goodWindow: 0.135,
        stopIndex: 0,
        stopCount: 5,
        made: 0,
        points: 0,
        trustReward: 2,
      },
    });
    const meter = hud.scene.getObjectByName("Harbour Court atlas timing meter");
    assert.ok(meter?.visible, "expected the atlas timing track to be visible while charging");
    assert.match(meter.userData.text, /^POWER [-=I#]{26}$/);
    assert.ok(meter.userData.text.includes("="), "expected a readable sweet-release band");
    assert.ok(meter.userData.text.includes("#"), "expected a readable live release marker");
  } finally {
    hud.dispose();
  }
});

test("activities reuse one black-backed non-blocking conversation card without HUD overlap", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  const base = {
    elapsed: 12,
    capture: { locked: true },
    player: { position: [0, 0, 0], health: 100, stamina: 100, armor: 0, cash: 240, alive: true },
    vehicle: { id: "taxi", kind: "taxi", position: [0, 0, 0], speed: 0, health: 120, maxHealth: 120 },
    prompt: "F EXIT  DRIVE TO THE DESTINATION",
    toast: "THIS TOAST MUST YIELD TO THE PASSENGER",
    toastUntil: 99,
    activity: {
      kind: "taxi",
      title: "NEON TAXI",
      status: "active",
      stage: "boarding",
      objective: "WAIT WHILE SAMIRA BOARDS",
      passenger: "Samira Cole",
      passengerRole: "Home-care assistant",
      boardingRatio: 0.63,
      qualityGrade: "S",
      estimatedReward: 420,
      dialogue: {
        serial: 1,
        active: true,
        kind: "board",
        speaker: "Samira Cole",
        role: "Home-care assistant",
        text: "Harbour gate three, please. Mrs Vale locks the chain if I’m more than ten minutes late.",
        remaining: 4.2,
      },
    },
  };
  try {
    const meshCount = () => {
      let count = 0;
      hud.scene.traverse(object => { count += Number(object.isMesh); });
      return count;
    };
    const countBefore = meshCount();
    hud.update(base);
    const group = hud.scene.getObjectByName("Night Shift Stories fixed fare conversation card");
    const backdrop = hud.scene.getObjectByName("Night Shift Stories opaque black conversation backdrop");
    const heading = hud.scene.getObjectByName("Night Shift Stories passenger and role");
    const body = hud.scene.getObjectByName("Night Shift Stories two-line passenger dialogue");
    assert.ok(group?.visible);
    assert.ok(backdrop?.userData.hudBackdrop, "the passenger line needs the proven transparent-black backing texture");
    assert.ok(heading.renderOrder > backdrop.renderOrder && body.renderOrder > backdrop.renderOrder);
    assert.match(heading.userData.text, /SAMIRA COLE.*HOME-CARE ASSISTANT/);
    assert.match(body.userData.text, /HARBOUR GATE THREE/i);
    assert.ok(body.userData.text.includes("\n"), "long fare dialogue should use the fixed two-line budget");
    assert.ok([...hud.scene.children].length > 0);
    const boarding = [];
    hud.scene.traverse(object => {
      if (object.userData?.text === "BOARDING 63%") boarding.push(object);
    });
    assert.equal(boarding.length, 1);
    assert.equal(hud.scene.getObjectByName("Neon City gameplay toast")?.visible, false,
      "a generic toast should not paint over a passenger line");
    assert.equal(hud.scene.getObjectByName("Neon City gameplay vehicle telemetry")?.visible, false,
      "the fare card should own the lower-right safe area instead of overlapping vehicle telemetry");
    assert.equal(hud.scene.getObjectByName("Neon City gameplay interaction prompt")?.visible, false,
      "a generic interaction prompt should yield while the named passenger is speaking");
    for (const retained of [
      "Neon City gameplay mission card",
      "Neon City gameplay player stats",
      "Neon City pooled square minimap",
    ]) assert.equal(hud.scene.getObjectByName(retained)?.visible, true, `${retained} should remain available during a fare line`);

    const headingGeometry = heading.geometry;
    const bodyGeometry = body.geometry;
    const headingPositions = heading.geometry.getAttribute("position").array;
    const bodyPositions = body.geometry.getAttribute("position").array;
    const bodyUvs = body.geometry.getAttribute("uv").array;
    for (const [passenger, role, text, serial] of [
      ["Tomas Okafor", "Market kitchen runner", "Pulse Street side entrance. Keep the trays level.", 2],
      ["Inez Park", "Session guitarist", "Moon Gate. The club kept us late and the night bus kept its schedule.", 3],
    ]) {
      hud.update({
        ...base,
        activity: {
          ...base.activity,
          passenger,
          passengerRole: role,
          dialogue: { ...base.activity.dialogue, serial, speaker: passenger, role, text },
        },
      });
    }
    hud.update({
      ...base,
      activity: {
        kind: "ordinary_story",
        id: "the_night_count",
        title: "THE NIGHT COUNT",
        subtitle: "WHO GETS COUNTED WHEN THE MACHINE FAILS",
        status: "active",
        phase: "survey",
        objective: "COUNT THE PULSE STATION CASH RIDERS",
        surveyIndex: 1,
        surveyCount: 4,
        targetPosition: [48, 0.04, -21.35],
        dialogue: {
          active: true,
          serial: 4,
          speaker: "Malik Reed",
          role: "Night Route driver",
          text: "Write eighteen at Pulse, including the three the validator missed.",
          remaining: 4.1,
        },
      },
    });
    assert.equal(group.visible, true, "ordinary-life dialogue should reuse the resident conversation card");
    assert.match(heading.userData.text, /MALIK REED.*NIGHT ROUTE DRIVER/);
    assert.match(body.userData.text, /WRITE EIGHTEEN AT PULSE/i);
    const storyProgress = [];
    hud.scene.traverse(object => {
      if (object.userData?.text?.startsWith("NIGHT RIDERS 1/4")) storyProgress.push(object);
    });
    assert.equal(storyProgress.length, 1, "ordinary story progress should replace an invented cash payout");
    assert.equal(meshCount(), countBefore);
    assert.strictEqual(heading.geometry, headingGeometry);
    assert.strictEqual(body.geometry, bodyGeometry);
    assert.strictEqual(heading.geometry.getAttribute("position").array, headingPositions);
    assert.strictEqual(body.geometry.getAttribute("position").array, bodyPositions);
    assert.strictEqual(body.geometry.getAttribute("uv").array, bodyUvs);

    hud.update({
      ...base,
      narrative: { active: true, cinematic: false, line: { speaker: "JUNO", text: "Authored story owns this frame." } },
    });
    assert.equal(group.visible, false, "authored story presentation must take precedence");
    hud.update({ ...base, activity: { ...base.activity, dialogue: { ...base.activity.dialogue, remaining: 0, active: false } } });
    assert.equal(group.visible, false, "an expired line should release the driving view");
    assert.equal(hud.scene.getObjectByName("Neon City gameplay vehicle telemetry")?.visible, true);
    assert.equal(hud.scene.getObjectByName("Neon City gameplay interaction prompt")?.visible, true);
    hud.update({ ...base, neighbourhood: { menuOpen: true }, activity: base.activity });
    assert.equal(group.visible, false, "the Open Doors menu remains modal");
  } finally {
    hud.dispose();
  }
});

test("Borrowed Time owns the mission card and generic moral-choice presentation", () => {
  const renderer = {
    getSize: vector => vector.set(1280, 720),
    getDrawingBufferSize: vector => vector.set(1280, 720),
  };
  const hud = createGtaHud({ renderer });
  const textMeshes = () => {
    const result = [];
    hud.scene.traverse(object => { if (typeof object?.userData?.text === "string") result.push(object); });
    return result;
  };
  try {
    const base = {
      elapsed: 18,
      capture: { locked: true },
      player: { position: [-144, 0.2, 79.6], health: 100, stamina: 100, armor: 0, cash: 1250, alive: true },
      story: { active: false, cinematic: false },
      narrative: { active: false, cinematic: false, controlsLocked: false },
      mission: { title: "HOME AGAIN", objective: "OLD CHAPTER", status: "completed", reward: 5000 },
      chapterTwoMission: {
        kind: "story_chapter",
        title: "BORROWED TIME",
        objective: "INSPECT THE HOSE, INVOICE, AND SERVICE LOG",
        status: "active",
        targetPosition: [-151.5, 0.2, 79.6],
        hudDetail: "EVIDENCE 2/3  /  NO VIOLENCE REQUIRED",
      },
    };
    const gameplayClutterNames = [
      "Neon City gameplay player stats",
      "Neon City gameplay mission card",
      "Neon City pooled square minimap",
      "Neon City gameplay interaction prompt",
      "Neon City gameplay toast",
      "Neon City gameplay aiming reticle",
      "Neon City gameplay diagnostics",
    ];
    hud.update({
      ...base,
      player: { ...base.player, aiming: true },
      prompt: "E  PHOTOGRAPH SOUTHLINE'S MANIFEST",
      toast: "LIVE GAMEPLAY TOAST",
      toastUntil: 99,
    });
    for (const name of gameplayClutterNames) {
      assert.equal(hud.scene.getObjectByName(name)?.visible, true,
        `${name} should be present during ordinary gameplay before the authored line`);
    }
    const chapterTitle = textMeshes().find(mesh => mesh.userData.text === "BORROWED TIME");
    assert.ok(chapterTitle, "Chapter Two should replace the completed recovery card");
    assert.equal(chapterTitle.material.color.getHex(), 0xffbd62);
    assert.ok(textMeshes().some(mesh => /EVIDENCE 2\/3.*NO VIOLENCE REQUIRED/.test(mesh.userData.text)));
    const fixedDialogue = hud.scene.getObjectByName("Narrative dialogue body");
    const fixedDialogueGeometry = fixedDialogue.geometry;
    const fixedDialoguePositions = fixedDialogue.geometry.getAttribute("position").array;
    const fixedDialogueUvs = fixedDialogue.geometry.getAttribute("uv").array;
    assert.equal(fixedDialogue.geometry.getAttribute("position").usage, THREE.StaticDrawUsage);
    assert.equal(fixedDialogue.geometry.getAttribute("uv").usage, THREE.StaticDrawUsage);
    assert.notEqual(fixedDialogue.geometry.getAttribute("position").usage, THREE.DynamicDrawUsage);

    hud.update({
      ...base,
      player: { ...base.player, aiming: true },
      prompt: "E  PHOTOGRAPH SOUTHLINE'S MANIFEST",
      toast: "LIVE GAMEPLAY TOAST",
      toastUntil: 99,
      narrative: {
        active: true,
        cinematic: false,
        controlsLocked: false,
        line: {
          speaker: "KAI",
          text: "I HAVE A CLEAR PHOTO. THE SAME PALLET WENT TO THREE DISTRICTS.",
          progress: 0.42,
        },
        choice: null,
      },
    });
    assert.equal(isAuthoredNarrativePresentation({ active: true, cinematic: false, line: { text: "EVIDENCE" } }), true,
      "a gameplay-camera evidence line is still authored presentation");
    assert.ok(hud.scene.getObjectByName("Narrative dialogue card")?.visible);
    assert.equal(hud.scene.getObjectByName("Narrative cinematic letterbox")?.visible, false,
      "non-cinematic evidence dialogue should not invent letterbox bars");
    for (const name of gameplayClutterNames) {
      assert.equal(hud.scene.getObjectByName(name)?.visible, false,
        `${name} must not collide with authored evidence dialogue`);
    }
    assert.strictEqual(fixedDialogue.geometry, fixedDialogueGeometry);
    assert.strictEqual(fixedDialogue.geometry.getAttribute("position").array, fixedDialoguePositions);
    assert.strictEqual(fixedDialogue.geometry.getAttribute("uv").array, fixedDialogueUvs);

    hud.update({
      ...base,
      narrative: {
        active: true,
        cinematic: true,
        controlsLocked: true,
        line: null,
        choice: {
          prompt: "WHEN DOES KAI REPORT THE DEFECT?",
          options: [
            { label: "REPORT NOW", summary: "PUBLIC RECALL; FREEZE THE EVIDENCE; EXPOSE THE GARAGE'S PEOPLE" },
            { label: "RECALL SEVEN, THEN REPORT", summary: "PARK KNOWN CARS; RISK FOUR UNKNOWN DRIVERS AND A SIX-HOUR EVIDENCE WINDOW" },
          ],
        },
      },
    });
    assert.ok(textMeshes().some(mesh => mesh.userData.text === "DECIDE — BOTH ANSWERS HAVE A COST"));
    assert.ok(textMeshes().some(mesh => /WHEN DOES KAI REPORT THE DEFECT/.test(mesh.userData.text)));
    const dialoguePanel = hud.scene.getObjectByName("Narrative dialogue panel");
    const dialogueBody = hud.scene.getObjectByName("Narrative dialogue body");
    const dialogueCard = hud.scene.getObjectByName("Narrative dialogue card");
    assert.ok(dialoguePanel?.visible && dialogueBody?.visible);
    assert.ok(hud.scene.getObjectByName("Narrative cinematic letterbox")?.visible);
    for (const name of gameplayClutterNames) {
      assert.equal(hud.scene.getObjectByName(name)?.visible, false,
        `${name} must not collide with the moral-choice card`);
    }
    assert.strictEqual(dialogueBody.geometry, fixedDialogueGeometry);
    assert.strictEqual(dialogueBody.geometry.getAttribute("position").array, fixedDialoguePositions);
    assert.strictEqual(dialogueBody.geometry.getAttribute("uv").array, fixedDialogueUvs);
    const lines = dialogueBody.userData.text.split("\n");
    assert.equal(lines.length, 4, "the prompt and two costly options must fit the four-line dialogue budget");
    assert.match(lines[1], /^A \/ 1 REPORT NOW/);
    assert.match(lines[2], /^D \/ 2 RECALL SEVEN, THEN REPORT/);
    assert.match(lines[3], /^       /, "the long second option needs an indented continuation line");
    const position = dialogueBody.geometry.getAttribute("position").array;
    const drawnGlyphs = dialogueBody.geometry.drawRange.count / 6;
    let renderedRight = 0;
    for (let glyph = 0; glyph < drawnGlyphs; ++glyph) {
      const offset = glyph * 12;
      renderedRight = Math.max(renderedRight, position[offset], position[offset + 3], position[offset + 6], position[offset + 9]);
    }
    const safeRight = dialoguePanel.userData.width - 24;
    assert.ok(dialogueBody.position.x + renderedRight <= safeRight,
      `choice glyphs overflow the dialogue panel: ${dialogueBody.position.x + renderedRight}px > ${safeRight}px`);
    assert.equal(dialoguePanel.userData.width, 900, "the authored dialogue card has one exact prewarmed width");
    const cardLeft = dialogueCard.position.x;
    const cardRight = cardLeft + dialoguePanel.userData.width * dialogueCard.scale.x;
    const cardTop = dialogueCard.position.y;
    const cardBottom = cardTop + dialoguePanel.userData.height * dialogueCard.scale.y;
    assert.ok(cardLeft >= 15 && cardRight <= 1280 - 15,
      `choice card must stay inside the horizontal safe area: ${cardLeft}..${cardRight}`);
    assert.ok(cardTop >= 0 && cardBottom <= 720,
      `choice card must stay inside the viewport: ${cardTop}..${cardBottom}`);
  } finally {
    hud.dispose();
  }
});
