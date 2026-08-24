import * as THREE from "three/webgpu";

// A GPU-resident bitmap alphabet keeps the complete RPG interface visible in
// ThreeBrowserRuntime, whose compatibility DOM intentionally does not paint.
const GLYPHS = Object.freeze({
  " ": ["00000","00000","00000","00000","00000","00000","00000"],
  A:["01110","10001","10001","11111","10001","10001","10001"],
  B:["11110","10001","10001","11110","10001","10001","11110"],
  C:["01111","10000","10000","10000","10000","10000","01111"],
  D:["11110","10001","10001","10001","10001","10001","11110"],
  E:["11111","10000","10000","11110","10000","10000","11111"],
  F:["11111","10000","10000","11110","10000","10000","10000"],
  G:["01111","10000","10000","10111","10001","10001","01110"],
  H:["10001","10001","10001","11111","10001","10001","10001"],
  I:["11111","00100","00100","00100","00100","00100","11111"],
  J:["00111","00010","00010","00010","10010","10010","01100"],
  K:["10001","10010","10100","11000","10100","10010","10001"],
  L:["10000","10000","10000","10000","10000","10000","11111"],
  M:["10001","11011","10101","10101","10001","10001","10001"],
  N:["10001","11001","10101","10011","10001","10001","10001"],
  O:["01110","10001","10001","10001","10001","10001","01110"],
  P:["11110","10001","10001","11110","10000","10000","10000"],
  Q:["01110","10001","10001","10001","10101","10010","01101"],
  R:["11110","10001","10001","11110","10100","10010","10001"],
  S:["01111","10000","10000","01110","00001","00001","11110"],
  T:["11111","00100","00100","00100","00100","00100","00100"],
  U:["10001","10001","10001","10001","10001","10001","01110"],
  V:["10001","10001","10001","10001","10001","01010","00100"],
  W:["10001","10001","10001","10101","10101","10101","01010"],
  X:["10001","10001","01010","00100","01010","10001","10001"],
  Y:["10001","10001","01010","00100","00100","00100","00100"],
  Z:["11111","00001","00010","00100","01000","10000","11111"],
  0:["01110","10001","10011","10101","11001","10001","01110"],
  1:["00100","01100","00100","00100","00100","00100","01110"],
  2:["01110","10001","00001","00010","00100","01000","11111"],
  3:["11110","00001","00001","01110","00001","00001","11110"],
  4:["00010","00110","01010","10010","11111","00010","00010"],
  5:["11111","10000","10000","11110","00001","00001","11110"],
  6:["01110","10000","10000","11110","10001","10001","01110"],
  7:["11111","00001","00010","00100","01000","01000","01000"],
  8:["01110","10001","10001","01110","10001","10001","01110"],
  9:["01110","10001","10001","01111","00001","00001","01110"],
  ".":["00000","00000","00000","00000","00000","00110","00110"],
  ",":["00000","00000","00000","00000","00110","00110","00100"],
  ":":["00000","00110","00110","00000","00110","00110","00000"],
  ";":["00000","00110","00110","00000","00110","00110","00100"],
  "!":["00100","00100","00100","00100","00100","00000","00100"],
  "?":["01110","10001","00001","00010","00100","00000","00100"],
  "-":["00000","00000","00000","11111","00000","00000","00000"],
  "+":["00000","00100","00100","11111","00100","00100","00000"],
  "/":["00001","00010","00100","01000","10000","00000","00000"],
  "(":["00010","00100","01000","01000","01000","00100","00010"],
  ")":["01000","00100","00010","00010","00010","00100","01000"],
  "'":["00100","00100","00000","00000","00000","00000","00000"],
  "=":["00000","11111","00000","11111","00000","00000","00000"],
});

const CELL_WIDTH = 7;
const ATLAS_WIDTH = 512;
const ATLAS_HEIGHT = 10;

function createAtlas() {
  const bytes = new Uint8Array(ATLAS_WIDTH * ATLAS_HEIGHT * 4);
  const cells = new Map();
  let cell = 0;
  for (const [character, rows] of Object.entries(GLYPHS)) {
    const originX = cell * CELL_WIDTH;
    cells.set(character, originX);
    for (let row = 0; row < 7; ++row) {
      for (let column = 0; column < 5; ++column) {
        if (rows[row][column] !== "1") continue;
        const offset = ((row + 1) * ATLAS_WIDTH + originX + column + 1) * 4;
        bytes.fill(255, offset, offset + 4);
      }
    }
    cell += 1;
  }
  const texture = new THREE.DataTexture(bytes, ATLAS_WIDTH, ATLAS_HEIGHT, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Medieval RPG GPU bitmap font";
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, cells };
}

function buildTextGeometry(text, atlas, scale = 2, tracking = 1, maxCharacters = 120) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const advance = (5 + tracking) * scale;
  let cursorX = 0;
  let cursorY = 0;
  let maximumWidth = 0;
  let lineCount = 1;
  for (const raw of String(text).toUpperCase().slice(0, maxCharacters)) {
    if (raw === "\n") {
      maximumWidth = Math.max(maximumWidth, Math.max(0, cursorX - tracking * scale));
      cursorX = 0;
      cursorY += 10 * scale;
      lineCount += 1;
      continue;
    }
    const character = GLYPHS[raw] ? raw : "?";
    const originX = atlas.cells.get(character);
    if (character !== " ") {
      const base = positions.length / 3;
      positions.push(cursorX,cursorY,0, cursorX+5*scale,cursorY,0,
        cursorX+5*scale,cursorY+7*scale,0, cursorX,cursorY+7*scale,0);
      const u0 = (originX + 1) / ATLAS_WIDTH;
      const u1 = (originX + 6) / ATLAS_WIDTH;
      const v0 = 1 / ATLAS_HEIGHT;
      const v1 = 8 / ATLAS_HEIGHT;
      uvs.push(u0,v0, u1,v0, u1,v1, u0,v1);
      indices.push(base,base+1,base+2, base,base+2,base+3);
    }
    cursorX += advance;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  maximumWidth = Math.max(maximumWidth, Math.max(0, cursorX - tracking * scale));
  return { geometry, width: maximumWidth, height: (lineCount - 1) * 10 * scale + 7 * scale };
}

function createText(text, atlas, color = 0xffffff, scale = 2, opacity = 1, maxCharacters = 120) {
  const built = buildTextGeometry(text, atlas, scale, 1, maxCharacters);
  const material = new THREE.MeshBasicNodeMaterial({
    map: atlas.texture,
    color,
    transparent: true,
    opacity,
    alphaTest: 0.35,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(built.geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2010;
  mesh.userData.text = String(text);
  mesh.userData.width = built.width;
  mesh.setText = value => {
    const resolved = String(value);
    if (resolved === mesh.userData.text) return false;
    const next = buildTextGeometry(resolved, atlas, scale, 1, maxCharacters);
    mesh.geometry.dispose();
    mesh.geometry = next.geometry;
    mesh.userData.text = resolved;
    mesh.userData.width = next.width;
    mesh.userData.height = next.height;
    return true;
  };
  return mesh;
}

function createPanel(width, height, color, opacity = 1, order = 2000) {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  mesh.userData.width = width;
  mesh.userData.height = height;
  return mesh;
}

function placeTopLeft(object, x, y) {
  object.position.set(x + object.userData.width * 0.5, y + object.userData.height * 0.5, 0);
}

export function createRpgHud({ renderer }) {
  const atlas = createAtlas();
  const scene = new THREE.Scene();
  scene.name = "Light Against the Dark GPU interface";
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  camera.position.z = 5;
  // Native RTX owns the final swapchain submission. Render the interface into
  // a transparent GPU texture so that presenter can composite the authored
  // HUD in the same frame instead of losing a second canvas submission.
  const target = new THREE.RenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  target.texture.name = "Light Against the Dark transparent GPU HUD";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;
  const root = new THREE.Group();
  scene.add(root);

  const vitalsPanel = createPanel(306, 104, 0x080b0e, 0.76);
  const healthBack = createPanel(226, 12, 0x251419, 0.96, 2002);
  const healthFill = createPanel(220, 8, 0x9b2635, 1, 2004);
  const staminaBack = createPanel(226, 10, 0x14251d, 0.96, 2002);
  const staminaFill = createPanel(220, 6, 0x4b9b68, 1, 2004);
  const nameText = createText("THE WAYFARER", atlas, 0xe3d5b9, 2);
  const healthText = createText("HEALTH 100 / 100", atlas, 0xe3c4c1, 1.5);
  const staminaText = createText("STAMINA 100 / 100", atlas, 0xb9d9c2, 1.5);
  root.add(vitalsPanel, healthBack, healthFill, staminaBack, staminaFill, nameText, healthText, staminaText);

  const questPanel = createPanel(390, 84, 0x080b0e, 0.72);
  const questHeading = createText("LIGHT AGAINST THE DARK", atlas, 0xd7b66f, 1.5);
  const objectiveText = createText("FIND THE VILLAGE ELDER", atlas, 0xe7e1d5, 1.5, 1, 58);
  const compassText = createText("W   NW   N   NE   E", atlas, 0xa9b2b4, 1.5);
  root.add(questPanel, questHeading, objectiveText, compassText);

  const equipmentPanel = createPanel(330, 76, 0x080b0e, 0.72);
  const weaponText = createText("WEAPON WORN IRON SWORD", atlas, 0xe3d5b9, 1.5);
  const quickText = createText("R  QUICK ITEM  FIELD TONIC X2", atlas, 0xa9c6b0, 1.5);
  root.add(equipmentPanel, weaponText, quickText);

  const promptPanel = createPanel(460, 40, 0x080b0e, 0.80);
  const promptText = createText("", atlas, 0xf0e4ca, 1.5, 1, 64);
  root.add(promptPanel, promptText);

  const toastPanel = createPanel(560, 44, 0x16110b, 0.88);
  const toastText = createText("", atlas, 0xffd88a, 1.5, 1, 74);
  root.add(toastPanel, toastText);

  const reticleVertical = createPanel(2, 14, 0xd8d0c1, 0.72, 2015);
  const reticleHorizontal = createPanel(14, 2, 0xd8d0c1, 0.72, 2015);
  root.add(reticleVertical, reticleHorizontal);

  const bossPanel = createPanel(540, 58, 0x080608, 0.82);
  const bossBack = createPanel(480, 10, 0x28151b, 0.96, 2002);
  const bossFill = createPanel(476, 6, 0xa43b47, 1, 2004);
  const bossText = createText("FORTRESS WARDEN", atlas, 0xe6c8b4, 1.5);
  root.add(bossPanel, bossBack, bossFill, bossText);

  const dialoguePanel = createPanel(820, 150, 0x06080a, 0.91);
  const speakerText = createText("", atlas, 0xd8b56d, 2, 1, 40);
  const dialogueText = createText("", atlas, 0xe8e1d4, 1.5, 1, 96);
  const dialogueHint = createText("ENTER  CONTINUE     ESC  LEAVE", atlas, 0x8c969b, 1.5);
  root.add(dialoguePanel, speakerText, dialogueText, dialogueHint);

  const menuPanel = createPanel(780, 520, 0x07090b, 0.95);
  const menuHeading = createText("INVENTORY", atlas, 0xd7b66f, 3);
  const menuBody = createText("", atlas, 0xdad5cb, 1.25, 1, 900);
  const menuFooter = createText("I / C / J  SWITCH PANEL     ESC  CLOSE", atlas, 0x8c969b, 1.5);
  root.add(menuPanel, menuHeading, menuBody, menuFooter);

  const runtimeText = createText("WEBGPU FALLBACK", atlas, 0x78868b, 1, 0.9, 72);
  root.add(runtimeText);

  let width = 1;
  let height = 1;
  let visible = true;

  function resize(nextWidth, nextHeight) {
    width = Math.max(1, nextWidth);
    height = Math.max(1, nextHeight);
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    target.setSize(Math.max(1, drawingSize.x), Math.max(1, drawingSize.y));

    placeTopLeft(vitalsPanel, 22, 22);
    placeTopLeft(healthBack, 62, 55);
    placeTopLeft(staminaBack, 62, 77);
    nameText.position.set(38, 36, 0.4);
    healthText.position.set(64, 56, 0.4);
    staminaText.position.set(64, 78, 0.4);

    placeTopLeft(questPanel, Math.max(22, width - 412), 22);
    questHeading.position.set(Math.max(38, width - 394), 37, 0.4);
    objectiveText.position.set(Math.max(38, width - 394), 59, 0.4);
    compassText.position.set(Math.max(38, width - 394), 81, 0.4);

    placeTopLeft(equipmentPanel, 22, Math.max(120, height - 98));
    weaponText.position.set(38, Math.max(134, height - 82), 0.4);
    quickText.position.set(38, Math.max(156, height - 60), 0.4);

    const promptX = Math.max(10, width * 0.5 - 230);
    placeTopLeft(promptPanel, promptX, Math.max(120, height - 128));
    promptText.position.set(promptX + 18, Math.max(134, height - 115), 0.4);

    const toastX = Math.max(10, width * 0.5 - 280);
    placeTopLeft(toastPanel, toastX, 176);
    toastText.position.set(toastX + 18, 190, 0.4);

    reticleVertical.position.set(width * 0.5, height * 0.5, 0.6);
    reticleHorizontal.position.set(width * 0.5, height * 0.5, 0.6);

    bossPanel.position.set(width * 0.5, 132, 0);
    bossBack.position.set(width * 0.5, 148, 0.2);
    bossText.position.set(width * 0.5 - 240, 113, 0.4);

    const dialogueWidth = Math.min(820, width - 32);
    dialoguePanel.scale.x = dialogueWidth / 820;
    dialoguePanel.position.set(width * 0.5, height - 98, 0);
    speakerText.position.set(width * 0.5 - dialogueWidth * 0.5 + 22, height - 158, 0.4);
    dialogueText.position.set(width * 0.5 - dialogueWidth * 0.5 + 22, height - 125, 0.4);
    dialogueHint.position.set(width * 0.5 - dialogueWidth * 0.5 + 22, height - 72, 0.4);

    menuPanel.position.set(width * 0.5, height * 0.5, 0);
    menuHeading.position.set(width * 0.5 - 355, height * 0.5 - 228, 0.4);
    menuBody.position.set(width * 0.5 - 355, height * 0.5 - 176, 0.4);
    menuFooter.position.set(width * 0.5 - 355, height * 0.5 + 224, 0.4);
    runtimeText.position.set(Math.max(18, width - 250), Math.max(18, height - 26), 0.4);
  }

  function update(snapshot = {}) {
    const player = snapshot.player ?? {};
    const health = Math.max(0, Number(player.health ?? 100));
    const maxHealth = Math.max(1, Number(player.maxHealth ?? 100));
    const stamina = Math.max(0, Number(player.stamina ?? 100));
    const maxStamina = Math.max(1, Number(player.maxStamina ?? 100));
    const healthRatio = THREE.MathUtils.clamp(health / maxHealth, 0.001, 1);
    const staminaRatio = THREE.MathUtils.clamp(stamina / maxStamina, 0.001, 1);
    healthFill.scale.x = healthRatio;
    healthFill.position.set(65 + 220 * healthRatio * 0.5, 61, 0.5);
    staminaFill.scale.x = staminaRatio;
    staminaFill.position.set(65 + 220 * staminaRatio * 0.5, 82, 0.5);
    healthText.setText(`HEALTH ${Math.ceil(health)} / ${Math.ceil(maxHealth)}`);
    staminaText.setText(`STAMINA ${Math.ceil(stamina)} / ${Math.ceil(maxStamina)}`);
    objectiveText.setText(snapshot.objective ?? snapshot.ui?.objective ?? "FIND THE VILLAGE ELDER");
    compassText.setText(snapshot.compass ?? "W   NW   N   NE   E");
    weaponText.setText(`WEAPON ${player.weaponName ?? "WORN IRON SWORD"}`);
    quickText.setText(`R  QUICK ITEM  ${player.quickItemName ?? "FIELD TONIC"} X${player.quickItemCount ?? 2}`);

    const prompt = snapshot.prompt ?? snapshot.ui?.prompt ?? "";
    promptText.setText(prompt ? `E  ${prompt}` : "");
    promptPanel.visible = promptText.visible = Boolean(prompt);
    const toast = snapshot.toast ?? snapshot.ui?.toast ?? "";
    const toastVisible = Boolean(toast) && Number(snapshot.elapsed ?? 0) <= Number(snapshot.toastUntil ?? snapshot.ui?.toastUntil ?? Infinity);
    toastText.setText(toast);
    toastPanel.visible = toastText.visible = toastVisible;

    const boss = snapshot.boss;
    bossPanel.visible = bossBack.visible = bossFill.visible = bossText.visible = Boolean(boss);
    if (boss) {
      const bossRatio = THREE.MathUtils.clamp(Number(boss.health) / Math.max(1, Number(boss.maxHealth)), 0.001, 1);
      bossFill.scale.x = bossRatio;
      bossFill.position.set(width * 0.5 - 238 + 476 * bossRatio * 0.5, 148, 0.5);
      bossText.setText(`${boss.name ?? "FORTRESS WARDEN"}  PHASE ${boss.phase ?? 1}`);
    }

    const dialogue = snapshot.dialogue ?? snapshot.ui?.dialogue;
    dialoguePanel.visible = speakerText.visible = dialogueText.visible = dialogueHint.visible = Boolean(dialogue);
    if (dialogue) {
      speakerText.setText(dialogue.speaker ?? "VILLAGER");
      dialogueText.setText(dialogue.text ?? "");
    }

    const panel = snapshot.panel ?? snapshot.ui?.panel;
    menuPanel.visible = menuHeading.visible = menuBody.visible = menuFooter.visible = Boolean(panel);
    if (panel) {
      menuHeading.setText(String(panel.title ?? panel.kind ?? "INVENTORY"));
      menuBody.setText(String(panel.summary ?? "NO ITEMS"));
    }
    runtimeText.setText(snapshot.diagnostics?.rtx?.label ?? "WEBGPU FALLBACK");
  }

  function render() {
    if (!visible) return;
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(scene, camera);
    } finally {
      renderer.autoClear = previousAutoClear;
    }
  }

  function renderToTexture() {
    const previousTarget = renderer.getRenderTarget();
    const previousMrt = renderer.getMRT();
    const previousClearColor = renderer.getClearColor(new THREE.Color());
    const previousClearAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.setMRT(null);
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = false;
      renderer.clear(true, false, false);
      if (visible) renderer.render(scene, camera);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setMRT(previousMrt);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.autoClear = previousAutoClear;
    }
    return target.texture;
  }

  const initial = renderer.getSize(new THREE.Vector2());
  resize(initial.x, initial.y);
  update();

  return {
    scene,
    camera,
    target,
    get texture() { return target.texture; },
    resize,
    update,
    render,
    renderToTexture,
    setVisible(value) {
      visible = Boolean(value);
      root.visible = visible;
    },
    dispose() {
      atlas.texture.dispose();
      target.dispose();
      scene.traverse(object => {
        object.geometry?.dispose?.();
        object.material?.dispose?.();
      });
      root.clear();
    },
  };
}
