import * as THREE from "three/webgpu";

// ThreeBrowserRuntime does not paint DOM controls over its native WebGPU
// surface. This HUD is therefore a small GPU scene: panels are shared unit
// quads, text comes from a generated nearest-filtered DataTexture, and the
// minimap reuses fixed pools of meshes instead of allocating every frame.
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
  "—":["00000","00000","00000","11111","11111","00000","00000"],
  "–":["00000","00000","00000","11111","00000","00000","00000"],
  "→":["00000","00100","00010","11111","00010","00100","00000"],
  "…":["00000","00000","00000","00000","00000","10101","10101"],
  "’":["00100","00100","00010","00000","00000","00000","00000"],
  "+":["00000","00100","00100","11111","00100","00100","00000"],
  "/":["00001","00010","00100","01000","10000","00000","00000"],
  "(":["00010","00100","01000","01000","01000","00100","00010"],
  ")":["01000","00100","00010","00010","00010","00100","01000"],
  "'":["00100","00100","00000","00000","00000","00000","00000"],
  "=":["00000","11111","00000","11111","00000","00000","00000"],
  "$": ["00100","01111","10100","01110","00101","11110","00100"],
  "%": ["11001","11010","00100","01000","10110","00110","00000"],
  "#": ["01010","11111","01010","01010","11111","01010","00000"],
  "_": ["00000","00000","00000","00000","00000","00000","11111"],
});

const CELL_WIDTH = 7;
const ATLAS_WIDTH = 512;
const ATLAS_HEIGHT = 10;
const STATS_WIDTH = 356;
const STATS_HEIGHT = 178;
const MISSION_WIDTH = 510;
const MISSION_HEIGHT = 132;
const VEHICLE_WIDTH = 360;
const VEHICLE_HEIGHT = 94;
const SHOP_WIDTH = 820;
const SHOP_HEIGHT = 390;
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 650;
const DIALOGUE_WIDTH = 900;
const DIALOGUE_TEXT_INSET = 24;
const DIALOGUE_TEXT_SCALE = 1.55;
const DIALOGUE_TEXT_TRACKING = 1;
const DIALOGUE_CHOICE_LINES = 4;
const DIALOGUE_CHOICE_COLUMNS = Math.floor(
  (DIALOGUE_WIDTH - DIALOGUE_TEXT_INSET * 2 + DIALOGUE_TEXT_TRACKING * DIALOGUE_TEXT_SCALE)
  / ((5 + DIALOGUE_TEXT_TRACKING) * DIALOGUE_TEXT_SCALE),
);

// A few authored beats deliberately keep the gameplay camera (phone calls and
// close evidence reads), so `cinematic` is not a reliable presentation-modal
// signal.  The dialogue card itself is authoritative: while it is on screen,
// gameplay navigation and prompts must stand down regardless of camera mode.
export function isAuthoredNarrativePresentation(narrative) {
  return Boolean(narrative?.active && (narrative.line || narrative.choice));
}
const MAP_SIZE = 224;
const MAP_INSET = 14;
const MAP_INNER = MAP_SIZE - MAP_INSET * 2;
const MAP_CENTER = MAP_SIZE * 0.5;
const ROAD_POOL_SIZE = 22;
const ROUTE_SEGMENT_COUNT = 8;
const CAR_BLIP_COUNT = 40;
const POLICE_BLIP_COUNT = 20;
const CIVILIAN_BLIP_COUNT = 36;
const VEHICLE_PRESENTATION = Object.freeze({
  sedan: Object.freeze({ name: "NEON SEDAN", maxHealth: 115 }),
  sports: Object.freeze({ name: "COMET XR", maxHealth: 100 }),
  taxi: Object.freeze({ name: "CITY CAB", maxHealth: 120 }),
  police: Object.freeze({ name: "POLICE CRUISER", maxHealth: 150 }),
  van: Object.freeze({ name: "PANEL VAN", maxHealth: 175 }),
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function finite(value, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function vectorComponents(value) {
  const source = value?.position ?? value;
  if (Array.isArray(source) || ArrayBuffer.isView(source)) {
    return { x: finite(source[0]), y: finite(source[1]), z: finite(source[2]) };
  }
  if (source && typeof source === "object" && ("x" in source || "y" in source || "z" in source)) {
    return { x: finite(source.x), y: finite(source.y), z: finite(source.z) };
  }
  return null;
}

function entityList(value, depth = 0) {
  if (!value || depth > 2) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "object") return [];
  if (vectorComponents(value)) return [value];
  const result = [];
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) result.push(...child.filter(Boolean));
    else if (child && typeof child === "object" && depth < 2) result.push(...entityList(child, depth + 1));
  }
  return [...new Set(result)];
}

function entityTag(value) {
  return [value?.kind, value?.type, value?.role, value?.faction, value?.archetype, value?.model, value?.id]
    .filter(Boolean).join(" ").toLowerCase();
}

function isPolice(value) {
  return Boolean(value?.police || value?.isPolice || value?.lawEnforcement || /police|cop|patrol|interceptor|swat/.test(entityTag(value)));
}

function numericSpeed(value) {
  if (Number.isFinite(Number(value?.speedKph))) return Math.max(0, Number(value.speedKph));
  if (Number.isFinite(Number(value?.kph))) return Math.max(0, Number(value.kph));
  if (Number.isFinite(Number(value?.speed))) return Math.max(0, Number(value.speed) * 3.6);
  const velocity = vectorComponents(value?.velocity);
  return velocity ? Math.hypot(velocity.x, velocity.z) * 3.6 : 0;
}

function formatInteger(value) {
  const digits = String(Math.max(0, Math.floor(finite(value))));
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatDistance(value) {
  const distance = Math.max(0, finite(value));
  return distance >= 1000 ? `${(distance / 1000).toFixed(distance >= 10_000 ? 0 : 1)}KM` : `${Math.round(distance)}M`;
}

function textValue(value, fallback = "") {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return String(value?.text ?? value?.label ?? value?.message ?? fallback);
}

function wrapText(value, columns = 48, lines = 2) {
  const words = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const output = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= columns || !current) current = next.slice(0, columns);
    else {
      output.push(current);
      current = word.slice(0, columns);
      if (output.length >= lines - 1) break;
    }
  }
  if (current && output.length < lines) output.push(current);
  return output.join("\n");
}

function ellipsizeLine(value, columns) {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (normalized.length <= columns) return normalized;
  const available = Math.max(1, columns - 1);
  const candidate = normalized.slice(0, available).trimEnd();
  const boundary = candidate.lastIndexOf(" ");
  const readable = boundary >= Math.floor(columns * 0.6) ? candidate.slice(0, boundary) : candidate;
  return `${readable.trimEnd()}…`.slice(0, columns);
}

function wrapChoiceEntry(value, columns) {
  const continuation = "       ";
  const output = [];
  let remaining = String(value ?? "").trim().replace(/\s+/g, " ");
  while (remaining) {
    const prefix = output.length ? continuation : "";
    const available = Math.max(1, columns - prefix.length);
    if (remaining.length <= available) {
      output.push(`${prefix}${remaining}`);
      break;
    }
    let boundary = remaining.lastIndexOf(" ", available);
    if (boundary < 1) boundary = available;
    output.push(`${prefix}${remaining.slice(0, boundary).trimEnd()}`);
    remaining = remaining.slice(boundary).trimStart();
  }
  return output.length ? output : [""];
}

function limitChoiceEntry(lines, maxLines, columns) {
  if (lines.length <= maxLines) return lines;
  if (maxLines <= 1) {
    return [ellipsizeLine(lines.map(line => line.trim()).join(" "), columns)];
  }
  const continuation = "       ";
  const output = lines.slice(0, maxLines - 1);
  const tail = lines.slice(maxLines - 1).map(line => line.trim()).join(" ");
  output.push(`${continuation}${ellipsizeLine(tail, columns - continuation.length)}`);
  return output;
}

function formatChoiceText(choice) {
  const options = Array.isArray(choice?.options) ? choice.options : [];
  const prompt = ellipsizeLine(textValue(choice?.prompt, "WHAT WILL KAI DO?"), DIALOGUE_CHOICE_COLUMNS);
  const entries = [
    `A / 1  ${textValue(options[0]?.label, "PUBLISH NOW")} — ${textValue(options[0]?.summary)}`,
    `D / 2  ${textValue(options[1]?.label, "PROTECT SOURCES")} — ${textValue(options[1]?.summary)}`,
  ].map(entry => wrapChoiceEntry(entry, DIALOGUE_CHOICE_COLUMNS));
  const allocations = [1, 1];
  let spareLines = DIALOGUE_CHOICE_LINES - 3;
  while (spareLines > 0) {
    let candidate = -1;
    for (let index = 0; index < entries.length; ++index) {
      if (entries[index].length <= allocations[index]) continue;
      if (candidate < 0
        || entries[index].length - allocations[index] > entries[candidate].length - allocations[candidate]
        || (entries[index].length - allocations[index] === entries[candidate].length - allocations[candidate]
          && entries[index].join(" ").length > entries[candidate].join(" ").length)) candidate = index;
    }
    if (candidate < 0) break;
    allocations[candidate] += 1;
    spareLines -= 1;
  }
  return [
    prompt,
    ...limitChoiceEntry(entries[0], allocations[0], DIALOGUE_CHOICE_COLUMNS),
    ...limitChoiceEntry(entries[1], allocations[1], DIALOGUE_CHOICE_COLUMNS),
  ].join("\n");
}

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
  texture.name = "Neon City GPU bitmap font";
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, cells };
}

function createTextGeometry(maxCharacters = 160) {
  const capacity = Math.max(1, Math.trunc(Number(maxCharacters) || 160));
  const positions = new Float32Array(capacity * 4 * 3);
  const uvs = new Float32Array(capacity * 4 * 2);
  const indices = new Uint16Array(capacity * 6);
  for (let glyph = 0; glyph < capacity; ++glyph) {
    const vertex = glyph * 4;
    const index = glyph * 6;
    indices[index] = vertex;
    indices[index + 1] = vertex + 1;
    indices[index + 2] = vertex + 2;
    indices[index + 3] = vertex;
    indices[index + 4] = vertex + 2;
    indices[index + 5] = vertex + 3;
  }
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const uvAttribute = new THREE.BufferAttribute(uvs, 2);
  // These arrays have fixed capacity and identity, but their contents change
  // only when setText receives a different string.  DynamicDrawUsage makes the
  // common renderer treat them as per-frame streams; static usage plus the
  // explicit needsUpdate below uploads only the authored text changes.
  positionAttribute.setUsage(THREE.StaticDrawUsage);
  uvAttribute.setUsage(THREE.StaticDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("uv", uvAttribute);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  geometry.userData.textCapacity = capacity;
  return geometry;
}

function writeTextGeometry(geometry, text, atlas, scale = 2, tracking = 1, maxCharacters = 160) {
  const positionAttribute = geometry.getAttribute("position");
  const uvAttribute = geometry.getAttribute("uv");
  const positions = positionAttribute.array;
  const uvs = uvAttribute.array;
  const capacity = Math.min(
    Math.max(1, Math.trunc(Number(maxCharacters) || 160)),
    Math.max(1, Math.trunc(Number(geometry.userData.textCapacity) || positions.length / 12)),
  );
  const advance = (5 + tracking) * scale;
  let cursorX = 0;
  let cursorY = 0;
  let maximumWidth = 0;
  let lineCount = 1;
  let glyphCount = 0;
  for (const raw of String(text).toUpperCase().slice(0, capacity)) {
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
      const positionOffset = glyphCount * 12;
      positions[positionOffset] = cursorX;
      positions[positionOffset + 1] = cursorY;
      positions[positionOffset + 2] = 0;
      positions[positionOffset + 3] = cursorX + 5 * scale;
      positions[positionOffset + 4] = cursorY;
      positions[positionOffset + 5] = 0;
      positions[positionOffset + 6] = cursorX + 5 * scale;
      positions[positionOffset + 7] = cursorY + 7 * scale;
      positions[positionOffset + 8] = 0;
      positions[positionOffset + 9] = cursorX;
      positions[positionOffset + 10] = cursorY + 7 * scale;
      positions[positionOffset + 11] = 0;
      const u0 = (originX + 1) / ATLAS_WIDTH;
      const u1 = (originX + 6) / ATLAS_WIDTH;
      const v0 = 1 / ATLAS_HEIGHT;
      const v1 = 8 / ATLAS_HEIGHT;
      const uvOffset = glyphCount * 8;
      uvs[uvOffset] = u0;
      uvs[uvOffset + 1] = v0;
      uvs[uvOffset + 2] = u1;
      uvs[uvOffset + 3] = v0;
      uvs[uvOffset + 4] = u1;
      uvs[uvOffset + 5] = v1;
      uvs[uvOffset + 6] = u0;
      uvs[uvOffset + 7] = v1;
      glyphCount += 1;
    }
    cursorX += advance;
  }
  geometry.setDrawRange(0, glyphCount * 6);
  positionAttribute.needsUpdate = true;
  uvAttribute.needsUpdate = true;
  maximumWidth = Math.max(maximumWidth, Math.max(0, cursorX - tracking * scale));
  return {
    width: maximumWidth,
    height: (lineCount - 1) * 10 * scale + 7 * scale,
    glyphCount,
  };
}

function buildTextGeometry(text, atlas, scale = 2, tracking = 1, maxCharacters = 160) {
  const geometry = createTextGeometry(maxCharacters);
  const measured = writeTextGeometry(geometry, text, atlas, scale, tracking, maxCharacters);
  return { geometry, ...measured };
}

function createHudMaterial({ color = 0xffffff, opacity = 1, map = null, alphaTest = 0, layered = false } = {}) {
  const material = new THREE.MeshBasicNodeMaterial({
    color,
    map,
    // The HUD target is later composited over the world. Opaque-colour map
    // markers still need to participate in transparent sorting so the baked
    // alpha backdrop cannot paint over them after the opaque pass.
    transparent: layered || opacity < 1 || Boolean(map),
    opacity,
    alphaTest,
    depthTest: false,
    depthWrite: false,
    fog: false,
    side: map ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.toneMapped = false;
  material.userData.hudBaseOpacity = opacity;
  return material;
}

function createBackdropTexture() {
  const size = 8;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const offset = (y * size + x) * 4;
      bytes[offset] = 1;
      bytes[offset + 1] = 3;
      bytes[offset + 2] = 7;
      bytes[offset + 3] = edge === 0 ? 198 : edge === 1 ? 220 : 232;
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Neon City baked-alpha black HUD backdrop";
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createTintablePanelTexture() {
  const size = 8;
  const bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; ++y) {
    for (let x = 0; x < size; ++x) {
      const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
      const offset = (y * size + x) * 4;
      bytes[offset] = bytes[offset + 1] = bytes[offset + 2] = 255;
      bytes[offset + 3] = edge === 0 ? 205 : edge === 1 ? 235 : 255;
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = "Neon Life tintable rounded panel texture";
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createText(text, atlas, color = 0xffffff, scale = 2, opacity = 1, maxCharacters = 160) {
  const built = buildTextGeometry(text, atlas, scale, 1, maxCharacters);
  const material = createHudMaterial({ color, opacity, map: atlas.texture, alphaTest: 0.35 });
  const mesh = new THREE.Mesh(built.geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2040;
  mesh.userData.text = String(text);
  mesh.userData.width = built.width;
  mesh.userData.height = built.height;
  mesh.setText = value => {
    const resolved = String(value ?? "");
    if (resolved === mesh.userData.text) return false;
    const next = writeTextGeometry(mesh.geometry, resolved, atlas, scale, 1, maxCharacters);
    mesh.userData.text = resolved;
    mesh.userData.width = next.width;
    mesh.userData.height = next.height;
    return true;
  };
  return mesh;
}

function createStarGeometry() {
  const positions = [0, 0, 0];
  const indices = [];
  const points = 10;
  for (let index = 0; index < points; ++index) {
    const angle = -Math.PI * 0.5 + index * Math.PI / 5;
    const radius = index % 2 === 0 ? 9 : 4.2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  }
  for (let index = 0; index < points; ++index) indices.push(0, index + 1, (index + 1) % points + 1);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

function createArrowGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, -10, 0, 7, 8, 0, 0, 5, 0,
    0, -10, 0, 0, 5, 0, -7, 8, 0,
  ], 3));
  return geometry;
}

function boundsValues(bounds = {}) {
  const minimum = bounds.min ?? bounds.minimum ?? {};
  const maximum = bounds.max ?? bounds.maximum ?? {};
  return {
    minX: finite(bounds.minX ?? minimum.x, -Infinity),
    maxX: finite(bounds.maxX ?? maximum.x, Infinity),
    minZ: finite(bounds.minZ ?? minimum.z, -Infinity),
    maxZ: finite(bounds.maxZ ?? maximum.z, Infinity),
  };
}

/**
 * Builds a compact Manhattan-style route through the city road grid. It is
 * intentionally renderer-independent so navigation stays deterministic in
 * native tests and save/replay tooling.
 */
export function planGridRoute(startValue, targetValue, spacingValue = 48, bounds = {}) {
  const rawStart = vectorComponents(startValue);
  const rawTarget = vectorComponents(targetValue);
  if (!rawStart || !rawTarget) return Object.freeze([]);
  const limits = boundsValues(bounds);
  const spacing = clamp(spacingValue, 18, 64);
  const clampPoint = value => ({
    x: Math.min(limits.maxX, Math.max(limits.minX, finite(value.x))),
    y: 0,
    z: Math.min(limits.maxZ, Math.max(limits.minZ, finite(value.z))),
  });
  const start = clampPoint(rawStart);
  const target = clampPoint(rawTarget);
  const snapX = value => Math.min(limits.maxX, Math.max(limits.minX, Math.round(value / spacing) * spacing));
  const snapZ = value => Math.min(limits.maxZ, Math.max(limits.minZ, Math.round(value / spacing) * spacing));
  const horizontalRoad = snapZ(start.z);
  const verticalRoad = snapX(start.x);
  const targetVerticalRoad = snapX(target.x);
  const targetHorizontalRoad = snapZ(target.z);
  const candidates = [
    [
      start,
      { x: start.x, y: 0, z: horizontalRoad },
      { x: targetVerticalRoad, y: 0, z: horizontalRoad },
      { x: targetVerticalRoad, y: 0, z: target.z },
      target,
    ],
    [
      start,
      { x: verticalRoad, y: 0, z: start.z },
      { x: verticalRoad, y: 0, z: targetHorizontalRoad },
      { x: target.x, y: 0, z: targetHorizontalRoad },
      target,
    ],
  ];
  const compact = points => points.reduce((result, point) => {
    const previous = result.at(-1);
    if (!previous || Math.hypot(point.x - previous.x, point.z - previous.z) > 0.01) result.push(point);
    return result;
  }, []);
  const routes = candidates.map(compact);
  const routeLength = route => route.slice(1).reduce((total, point, index) =>
    total + Math.hypot(point.x - route[index].x, point.z - route[index].z), 0);
  const selected = routeLength(routes[0]) <= routeLength(routes[1]) ? routes[0] : routes[1];
  return Object.freeze(selected.map(point => Object.freeze({ x: point.x, y: 0, z: point.z })));
}

export function createGtaHud({ renderer } = {}) {
  if (!renderer) throw new TypeError("createGtaHud requires a WebGPU renderer");

  const atlas = createAtlas();
  const scene = new THREE.Scene();
  scene.name = "Neon City GPU HUD and minimap";
  const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10);
  camera.position.z = 5;
  const target = new THREE.RenderTarget(1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    generateMipmaps: false,
  });
  target.texture.name = "Neon City transparent GPU HUD";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.generateMipmaps = false;

  const root = new THREE.Group();
  scene.add(root);
  const unitPlane = new THREE.PlaneGeometry(1, 1);
  const backdropTexture = createBackdropTexture();
  const tintablePanelTexture = createTintablePanelTexture();
  const minimapPixels = new Uint8Array(MAP_INNER * MAP_INNER * 4);
  const minimapBasePixels = new Uint8Array(minimapPixels.length);
  const minimapTexture = new THREE.DataTexture(
    minimapPixels,
    MAP_INNER,
    MAP_INNER,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  minimapTexture.name = "Neon City pooled raster navigation map";
  minimapTexture.colorSpace = THREE.NoColorSpace;
  minimapTexture.magFilter = THREE.NearestFilter;
  minimapTexture.minFilter = THREE.LinearFilter;
  minimapTexture.generateMipmaps = false;
  minimapTexture.flipY = false;
  minimapTexture.needsUpdate = true;

  function writeMapPixel(target, xValue, yValue, color) {
    const x = Math.trunc(xValue);
    const y = Math.trunc(yValue);
    if (x < 0 || y < 0 || x >= MAP_INNER || y >= MAP_INNER) return;
    const offset = (y * MAP_INNER + x) * 4;
    target[offset] = color[0];
    target[offset + 1] = color[1];
    target[offset + 2] = color[2];
    target[offset + 3] = color[3] ?? 255;
  }

  for (let y = 0; y < MAP_INNER; ++y) {
    for (let x = 0; x < MAP_INNER; ++x) {
      const vignette = Math.min(x, y, MAP_INNER - 1 - x, MAP_INNER - 1 - y) < 3;
      const grain = ((x * 17 + y * 29) % 19) === 0 ? 3 : 0;
      writeMapPixel(minimapBasePixels, x, y, vignette
        ? [21, 51, 68, 255]
        : [8 + grain, 18 + grain, 32 + grain, 255]);
    }
  }
  minimapPixels.set(minimapBasePixels);

  function panel(width, height, color, opacity = 1, order = 2000, sharedMaterial = null) {
    const bakedBackdrop = !sharedMaterial && color === 0x000000 && opacity >= 0.75 && opacity < 1 && order <= 2102;
    const material = sharedMaterial ?? createHudMaterial({
      color: bakedBackdrop ? 0xffffff : color,
      opacity: bakedBackdrop ? 1 : opacity,
      map: bakedBackdrop ? backdropTexture : null,
    });
    const mesh = new THREE.Mesh(unitPlane, material);
    mesh.scale.set(width, height, 1);
    mesh.frustumCulled = false;
    mesh.renderOrder = order;
    mesh.userData.width = width;
    mesh.userData.height = height;
    mesh.userData.hudBackdrop = bakedBackdrop;
    return mesh;
  }

  function placeTopLeft(object, x, y, z = 0) {
    object.position.set(x + object.userData.width * 0.5, y + object.userData.height * 0.5, z);
  }

  function fillBar(mesh, left, centerY, fullWidth, ratio, z = 0.5) {
    const resolved = clamp(ratio, 0, 1);
    mesh.visible = resolved > 0.0001;
    mesh.scale.x = Math.max(0.001, fullWidth * resolved);
    mesh.position.set(left + fullWidth * resolved * 0.5, centerY, z);
  }

  // Player status and wanted meter — GTA-style upper-right stack.
  const statsGroup = new THREE.Group();
  statsGroup.name = "Neon City gameplay player stats";
  const statsPanel = panel(STATS_WIDTH, STATS_HEIGHT, 0x000000, 0.90);
  const statsAccent = panel(5, STATS_HEIGHT, 0x12d9ff, 0.92, 2004);
  const healthBack = panel(212, 12, 0x2c111b, 0.98, 2006);
  const healthFill = panel(208, 8, 0xff315d, 1, 2008);
  const armorBack = panel(212, 10, 0x10263b, 0.98, 2006);
  const armorFill = panel(208, 6, 0x18bfff, 1, 2008);
  const staminaBack = panel(212, 10, 0x172317, 0.98, 2006);
  const staminaFill = panel(208, 6, 0x72ff9b, 1, 2008);
  const cashText = createText("$1,250", atlas, 0x72ff9b, 2.5);
  const ammoText = createText("PISTOL 12 / 180", atlas, 0xf1f4ff, 1.5);
  const environmentText = createText("21:39 RAIN", atlas, 0x8ee9ff, 1.25);
  const healthText = createText("HEALTH 100", atlas, 0xffa6b9, 1.25);
  const armorText = createText("ARMOR 35", atlas, 0x90ddff, 1.25);
  const staminaText = createText("STAMINA 100", atlas, 0x9dffb9, 1.25);
  const wantedLabel = createText("WANTED", atlas, 0x9ba7bd, 1.25);
  const starActiveMaterial = createHudMaterial({ color: 0xfff2b2, opacity: 1 });
  const starInactiveMaterial = createHudMaterial({ color: 0x3d465c, opacity: 0.76 });
  const starGeometry = createStarGeometry();
  const wantedStars = Array.from({ length: 5 }, (_, index) => {
    const star = new THREE.Mesh(starGeometry, starInactiveMaterial);
    star.position.set(201 + index * 27, 154, 0.6);
    star.frustumCulled = false;
    star.renderOrder = 2050;
    return star;
  });
  statsGroup.add(
    statsPanel, statsAccent, healthBack, healthFill, armorBack, armorFill, staminaBack, staminaFill,
    cashText, ammoText, environmentText, healthText, armorText, staminaText, wantedLabel, ...wantedStars,
  );
  root.add(statsGroup);
  placeTopLeft(statsPanel, 0, 0);
  placeTopLeft(statsAccent, 0, 0, 0.2);
  placeTopLeft(healthBack, 18, 68, 0.2);
  placeTopLeft(armorBack, 18, 98, 0.2);
  placeTopLeft(staminaBack, 18, 128, 0.2);
  environmentText.position.set(20, 17, 0.6);
  healthText.position.set(20, 52, 0.6);
  armorText.position.set(20, 84, 0.6);
  staminaText.position.set(20, 114, 0.6);
  wantedLabel.position.set(20, 149, 0.6);

  // Mission briefing — upper-left, independent of gameplay panels.
  const missionGroup = new THREE.Group();
  missionGroup.name = "Neon City gameplay mission card";
  const missionPanel = panel(MISSION_WIDTH, MISSION_HEIGHT, 0x000000, 0.90);
  const missionAccent = panel(5, MISSION_HEIGHT, 0xff2ec4, 0.95, 2004);
  const missionTitle = createText("HOME AGAIN", atlas, 0xff55d4, 2);
  const missionObjective = createText("MEET JUNO AT PULSE GARAGE", atlas, 0xf2f4ff, 1.5, 1, 120);
  const missionReward = createText("REWARD $5,000", atlas, 0x72ff9b, 1.25);
  const missionDistance = createText("TARGET 0M", atlas, 0xffd45e, 1.25);
  const basketballMeterBack = panel(272, 10, 0, 1, 2060,
    createHudMaterial({ color: 0x121d25, opacity: 1, layered: true }));
  basketballMeterBack.name = "Harbour Court timing meter backdrop";
  const basketballMeterFill = panel(1, 6, 0, 1, 2064,
    createHudMaterial({ color: 0xffb14f, opacity: 1, layered: true }));
  basketballMeterFill.name = "Harbour Court live release meter";
  const basketballSweetSpot = panel(1, 10, 0, 1, 2062,
    createHudMaterial({ color: 0x72ff9b, opacity: 0.42, layered: true }));
  basketballSweetSpot.name = "Harbour Court green release window";
  const basketballTargetTick = panel(2, 14, 0, 1, 2066,
    createHudMaterial({ color: 0xf4fff6, opacity: 1, layered: true }));
  basketballTargetTick.name = "Harbour Court perfect release tick";
  // Solid-colour quads are kept as a subtle backing treatment, but the native
  // offscreen HUD compositor can discard those quads on some WebGPU drivers.
  // The atlas track is the authoritative meter: text already survives that
  // compositor on every supported path and creates no material at shot time.
  const basketballMeterText = createText("POWER --------------------------", atlas, 0xff8d46, 1.25);
  basketballMeterText.name = "Harbour Court atlas timing meter";
  basketballMeterText.renderOrder = 2070;
  missionGroup.add(
    missionPanel, missionAccent, missionTitle, missionObjective, missionReward, missionDistance,
    basketballMeterBack, basketballSweetSpot, basketballMeterFill, basketballTargetTick, basketballMeterText,
  );
  root.add(missionGroup);
  placeTopLeft(missionPanel, 0, 0);
  placeTopLeft(missionAccent, 0, 0, 0.2);
  missionTitle.position.set(20, 16, 0.6);
  missionObjective.position.set(20, 43, 0.6);
  missionReward.position.set(20, 88, 0.6);
  missionDistance.position.set(318, 88, 0.6);
  placeTopLeft(basketballMeterBack, 20, 113, 1.2);
  basketballMeterFill.position.set(20, 118, 1.5);
  basketballSweetSpot.position.set(20, 118, 1.4);
  basketballTargetTick.position.set(20, 118, 1.6);
  basketballMeterText.position.set(20, 110, 1.8);
  basketballMeterBack.visible = basketballMeterFill.visible = basketballSweetSpot.visible = basketballTargetTick.visible = false;
  basketballMeterText.visible = false;

  // Bottom-left local minimap. Roads and blips are fixed pools updated in place.
  const minimapGroup = new THREE.Group();
  minimapGroup.name = "Neon City pooled square minimap";
  const mapPanel = panel(MAP_SIZE, MAP_SIZE, 0x000000, 0.93);
  const mapRasterMaterial = createHudMaterial({ color: 0xffffff, opacity: 1, map: minimapTexture });
  const mapInterior = panel(MAP_INNER, MAP_INNER, 0xffffff, 1, 2002, mapRasterMaterial);
  mapInterior.name = "Rasterized roads routes and city-life minimap";
  const mapEdgeMaterial = createHudMaterial({ color: 0x3edff5, opacity: 1, layered: true });
  const mapEdges = [
    panel(MAP_SIZE, 3, 0, 1, 2026, mapEdgeMaterial),
    panel(MAP_SIZE, 3, 0, 1, 2026, mapEdgeMaterial),
    panel(3, MAP_SIZE, 0, 1, 2026, mapEdgeMaterial),
    panel(3, MAP_SIZE, 0, 1, 2026, mapEdgeMaterial),
  ];
  mapEdges[0].position.set(MAP_CENTER, 1.5, 0.8);
  mapEdges[1].position.set(MAP_CENTER, MAP_SIZE - 1.5, 0.8);
  mapEdges[2].position.set(1.5, MAP_CENTER, 0.8);
  mapEdges[3].position.set(MAP_SIZE - 1.5, MAP_CENTER, 0.8);
  const mapTitle = createText("NEON CITY", atlas, 0x6cecff, 1.25);
  const northText = createText("N", atlas, 0xffffff, 1.25);
  placeTopLeft(mapPanel, 0, 0);
  placeTopLeft(mapInterior, MAP_INSET, MAP_INSET, 0.2);
  mapTitle.position.set(13, 6, 1.1);
  northText.position.set(MAP_CENTER - 4, 6, 1.1);
  minimapGroup.add(mapPanel, mapInterior, ...mapEdges, mapTitle, northText);

  const primaryRoadMaterial = createHudMaterial({ color: 0x6b8eac, opacity: 1, layered: true });
  const secondaryRoadMaterial = createHudMaterial({ color: 0x38536f, opacity: 1, layered: true });
  const verticalRoads = [];
  const horizontalRoads = [];
  for (let index = 0; index < ROAD_POOL_SIZE; ++index) {
    const vertical = panel(2, MAP_INNER, 0, 1, 2010, secondaryRoadMaterial);
    const horizontal = panel(MAP_INNER, 2, 0, 1, 2010, secondaryRoadMaterial);
    vertical.visible = horizontal.visible = false;
    verticalRoads.push(vertical);
    horizontalRoads.push(horizontal);
    minimapGroup.add(vertical, horizontal);
  }

  const routeMaterial = createHudMaterial({ color: 0x30e6ff, opacity: 1, layered: true });
  const routeSegments = Array.from({ length: ROUTE_SEGMENT_COUNT }, () => {
    const segment = panel(1, 4, 0, 1, 2022, routeMaterial);
    segment.visible = false;
    minimapGroup.add(segment);
    return segment;
  });

  const carMaterial = createHudMaterial({ color: 0xcad7e7, opacity: 1, layered: true });
  const policeMaterial = createHudMaterial({ color: 0x22aaff, opacity: 1, layered: true });
  const civilianMaterial = createHudMaterial({ color: 0xffd25d, opacity: 1, layered: true });
  const missionBlipMaterial = createHudMaterial({ color: 0xff2ec4, opacity: 1, layered: true });
  const lifeActivityMaterial = createHudMaterial({ color: 0x72ff9b, opacity: 1, layered: true });
  const playerBlipMaterial = createHudMaterial({ color: 0xf5ffff, opacity: 1, layered: true });
  const circleGeometry = new THREE.CircleGeometry(1, 8);
  const diamondGeometry = new THREE.PlaneGeometry(1, 1);
  const arrowGeometry = createArrowGeometry();

  function makeBlipPool(count, geometry, material, width, height = width) {
    return Array.from({ length: count }, () => {
      const blip = new THREE.Mesh(geometry, material);
      blip.scale.set(width, height, 1);
      blip.visible = false;
      blip.frustumCulled = false;
      blip.renderOrder = 2030;
      minimapGroup.add(blip);
      return blip;
    });
  }

  const carBlips = makeBlipPool(CAR_BLIP_COUNT, unitPlane, carMaterial, 7, 3.5);
  const policeBlips = makeBlipPool(POLICE_BLIP_COUNT, diamondGeometry, policeMaterial, 6, 6);
  for (const blip of policeBlips) blip.rotation.z = Math.PI * 0.25;
  const civilianBlips = makeBlipPool(CIVILIAN_BLIP_COUNT, circleGeometry, civilianMaterial, 2.6, 2.6);
  const lifeActivityBlips = makeBlipPool(6, diamondGeometry, lifeActivityMaterial, 4.5, 4.5);
  for (const blip of lifeActivityBlips) blip.rotation.z = Math.PI * 0.25;
  const missionBlip = new THREE.Mesh(diamondGeometry, missionBlipMaterial);
  missionBlip.scale.set(9, 9, 1);
  missionBlip.rotation.z = Math.PI * 0.25;
  missionBlip.frustumCulled = false;
  missionBlip.renderOrder = 2035;
  const playerBlip = new THREE.Mesh(arrowGeometry, playerBlipMaterial);
  playerBlip.position.set(MAP_CENTER, MAP_CENTER, 1.4);
  playerBlip.frustumCulled = false;
  playerBlip.renderOrder = 2040;
  missionBlip.visible = false;
  playerBlip.visible = false;
  minimapGroup.add(missionBlip, playerBlip);
  root.add(minimapGroup);

  // Vehicle telemetry appears only while the player is driving.
  const vehicleGroup = new THREE.Group();
  vehicleGroup.name = "Neon City gameplay vehicle telemetry";
  const vehiclePanel = panel(VEHICLE_WIDTH, VEHICLE_HEIGHT, 0x000000, 0.90);
  const vehicleAccent = panel(5, VEHICLE_HEIGHT, 0xffd447, 0.95, 2004);
  const vehicleName = createText("NEON COMET", atlas, 0xffe195, 1.75);
  const vehicleSpeed = createText("000 KPH", atlas, 0xffffff, 2.5);
  const vehicleHealthText = createText("VEHICLE 100%", atlas, 0xa8b6cb, 1.25);
  const vehicleHealthBack = panel(170, 10, 0x2a1720, 0.98, 2006);
  const vehicleHealthFill = panel(166, 6, 0xff704d, 1, 2008);
  vehicleGroup.add(
    vehiclePanel, vehicleAccent, vehicleName, vehicleSpeed,
    vehicleHealthText, vehicleHealthBack, vehicleHealthFill,
  );
  root.add(vehicleGroup);
  placeTopLeft(vehiclePanel, 0, 0);
  placeTopLeft(vehicleAccent, 0, 0, 0.2);
  vehicleName.position.set(18, 15, 0.6);
  vehicleSpeed.position.set(213, 14, 0.6);
  vehicleHealthText.position.set(18, 50, 0.6);
  placeTopLeft(vehicleHealthBack, 18, 70, 0.3);

  // Context feedback sits above the lower gameplay widgets.
  const promptGroup = new THREE.Group();
  promptGroup.name = "Neon City gameplay interaction prompt";
  const promptPanel = panel(520, 40, 0x000000, 0.90);
  const promptAccent = panel(5, 40, 0x33dfff, 0.95, 2004);
  const promptText = createText("", atlas, 0xf4f7ff, 1.5, 1, 82);
  promptGroup.add(promptPanel, promptAccent, promptText);
  root.add(promptGroup);
  placeTopLeft(promptPanel, 0, 0);
  placeTopLeft(promptAccent, 0, 0, 0.2);
  promptText.position.set(18, 13, 0.6);

  const toastGroup = new THREE.Group();
  toastGroup.name = "Neon City gameplay toast";
  const toastPanel = panel(660, 44, 0x000000, 0.92);
  const toastAccent = panel(5, 44, 0xff2ec4, 0.96, 2004);
  const toastText = createText("", atlas, 0xffb6ed, 1.5, 1, 100);
  toastGroup.add(toastPanel, toastAccent, toastText);
  root.add(toastGroup);
  placeTopLeft(toastPanel, 0, 0);
  placeTopLeft(toastAccent, 0, 0, 0.2);
  toastText.position.set(18, 14, 0.6);

  // Taxi work stays fully playable while a passenger speaks. This fixed,
  // black-backed card gives those short human exchanges the same legibility
  // as authored dialogue without taking camera or input ownership.
  const fareConversationGroup = new THREE.Group();
  fareConversationGroup.name = "Night Shift Stories fixed fare conversation card";
  const fareConversationPanel = panel(720, 98, 0x000000, 0.94, 2074);
  fareConversationPanel.name = "Night Shift Stories opaque black conversation backdrop";
  const fareConversationAccent = panel(6, 98, 0x36dff5, 0.98, 2076);
  const fareConversationSpeaker = createText("PASSENGER / NEON CITY", atlas, 0x72ecff, 1.45, 1, 82);
  const fareConversationText = createText("", atlas, 0xf5f7fb, 1.35, 1, 190);
  fareConversationSpeaker.name = "Night Shift Stories passenger and role";
  fareConversationText.name = "Night Shift Stories two-line passenger dialogue";
  fareConversationSpeaker.renderOrder = 2080;
  fareConversationText.renderOrder = 2080;
  fareConversationGroup.add(
    fareConversationPanel,
    fareConversationAccent,
    fareConversationSpeaker,
    fareConversationText,
  );
  root.add(fareConversationGroup);
  placeTopLeft(fareConversationPanel, 0, 0);
  placeTopLeft(fareConversationAccent, 0, 0, 0.3);
  fareConversationSpeaker.position.set(22, 14, 1);
  fareConversationText.position.set(22, 43, 1);
  fareConversationGroup.visible = false;

  // Open Doors is a modal in-world counter, not an HTML overlay. Every row
  // and glyph exists before the startup reveal-all pass, so opening a shop
  // cannot introduce a new WebGPU material or pipeline during play.
  const shopGroup = new THREE.Group();
  shopGroup.name = "Open Doors fixed neighbourhood shop panel";
  const shopPanel = panel(SHOP_WIDTH, SHOP_HEIGHT, 0x000000, 0.96, 2074);
  shopPanel.name = "Open Doors modal backdrop";
  const shopAccent = panel(7, SHOP_HEIGHT, 0xffb24f, 0.98, 2076);
  const shopTitle = createText("COMMON GROUND CAFE", atlas, 0xffc36a, 2.6, 1, 72);
  const shopHours = createText("OPEN 06:00-18:00", atlas, 0x8ee9ff, 1.25, 1, 64);
  const shopKeeper = createText("ASHA PATEL / NEW FACE", atlas, 0x72ff9b, 1.4, 1, 72);
  const shopVitals = createText("CASH $0  /  STEADY 72", atlas, 0xf5f7fb, 1.25, 1, 72);
  const shopLine = createText("TAKE A MINUTE. THE CITY WILL STILL BE HERE.", atlas, 0xd9e1ec, 1.45, 1, 180);
  const shopRows = Array.from({ length: 4 }, (_, index) => {
    const row = createText(`${index ? "  " : "→ "}MENU ITEM  $0`, atlas, index ? 0xe8edf4 : 0xffd17a, 1.4, 1, 132);
    row.name = `Open Doors fixed menu row ${index + 1}`;
    row.position.set(34, 166 + index * 43, 1);
    row.renderOrder = 2080;
    return row;
  });
  const shopHint = createText("W / S SELECT    E BUY    Q / F LEAVE    K SAVE", atlas, 0x98a8bb, 1.25, 1, 100);
  for (const [mesh, name] of [
    [shopTitle, "title"],
    [shopHours, "hours"],
    [shopKeeper, "keeper"],
    [shopVitals, "vitals"],
    [shopLine, "dialogue"],
    [shopHint, "hint"],
  ]) {
    mesh.name = `Open Doors modal ${name}`;
    // The modal backdrop is a baked-alpha transparent texture. All shop text
    // must sort after it because HUD materials deliberately disable depth.
    mesh.renderOrder = 2080;
  }
  shopGroup.add(
    shopPanel, shopAccent, shopTitle, shopHours, shopKeeper, shopVitals,
    shopLine, ...shopRows, shopHint,
  );
  root.add(shopGroup);
  placeTopLeft(shopPanel, 0, 0);
  placeTopLeft(shopAccent, 0, 0, 0.3);
  shopTitle.position.set(32, 24, 1);
  shopHours.position.set(32, 67, 1);
  shopKeeper.position.set(32, 94, 1);
  shopVitals.position.set(548, 67, 1);
  shopLine.position.set(32, 124, 1);
  shopHint.position.set(32, 357, 1);
  shopGroup.visible = false;

  // Neon Life is a fixed, RAM-resident phone. Its shell, app rows and text
  // are created before pipeline warmup so opening it never discovers GPU work.
  const phoneGroup = new THREE.Group();
  phoneGroup.name = "Neon Life preloaded interactive phone";
  const phonePanel = (panelWidth, panelHeight, color, opacity, order) => panel(
    panelWidth, panelHeight, 0, 1, order,
    createHudMaterial({ color, opacity, map: tintablePanelTexture, layered: true }),
  );
  const phoneShadow = phonePanel(PHONE_WIDTH, PHONE_HEIGHT, 0x020407, 0.97, 2082);
  const phoneShell = phonePanel(PHONE_WIDTH - 14, PHONE_HEIGHT - 14, 0x111722, 1, 2084);
  const phoneScreen = phonePanel(PHONE_WIDTH - 42, PHONE_HEIGHT - 74, 0x07131d, 1, 2086);
  const phoneTopGlow = phonePanel(PHONE_WIDTH - 42, 7, 0x28dff5, 1, 2088);
  const phoneSpeaker = phonePanel(72, 5, 0x34495d, 1, 2090);
  const phoneHomeBar = phonePanel(94, 5, 0xb8d7df, 0.85, 2090);
  const phoneClock = createText("21:39", atlas, 0x8ee9ff, 1.05);
  const phoneSignal = createText("PULSE  5G", atlas, 0x8ee9ff, 1.05);
  const phoneTitle = createText("NEON LIFE", atlas, 0xffffff, 2.25, 1, 46);
  const phoneSubtitle = createText("YOUR CITY IN YOUR POCKET", atlas, 0x79ddec, 1.1, 1, 54);
  const phoneRows = Array.from({ length: 7 }, (_, index) => {
    const backing = phonePanel(PHONE_WIDTH - 74, 58, index % 2 ? 0x101e2a : 0x122535, 1, 2088);
    const accent = phonePanel(5, 58, 0x405669, 1, 2090);
    const title = createText("APP", atlas, 0xf1f7fa, 1.25, 1, 42);
    const detail = createText("DETAIL", atlas, 0x93aabb, 0.92, 1, 58);
    backing.position.set(37 + (PHONE_WIDTH - 74) * 0.5, 150 + index * 64, 1);
    accent.position.set(39.5, 150 + index * 64, 2);
    title.position.set(52, 135 + index * 64, 3);
    detail.position.set(52, 161 + index * 64, 3);
    phoneGroup.add(backing, accent, title, detail);
    return { backing, accent, title, detail };
  });
  const phoneHint = createText("W / S SELECT   E OPEN   Q / F / TAB BACK", atlas, 0x7f99aa, 0.92, 1, 72);
  for (const textMesh of [
    phoneClock, phoneSignal, phoneTitle, phoneSubtitle, phoneHint,
    ...phoneRows.flatMap(row => [row.title, row.detail]),
  ]) textMesh.renderOrder = 2100;
  phoneGroup.add(
    phoneShadow, phoneShell, phoneScreen, phoneTopGlow, phoneSpeaker, phoneHomeBar,
    phoneClock, phoneSignal, phoneTitle, phoneSubtitle, phoneHint,
  );
  root.add(phoneGroup);
  placeTopLeft(phoneShadow, 0, 0);
  placeTopLeft(phoneShell, 7, 7, 0.2);
  placeTopLeft(phoneScreen, 21, 37, 0.4);
  placeTopLeft(phoneTopGlow, 21, 37, 0.6);
  phoneSpeaker.position.set(PHONE_WIDTH * 0.5, 20, 1);
  phoneHomeBar.position.set(PHONE_WIDTH * 0.5, PHONE_HEIGHT - 20, 1);
  phoneClock.position.set(31, 50, 2);
  phoneSignal.position.set(282, 50, 2);
  phoneTitle.position.set(36, 75, 2);
  phoneSubtitle.position.set(36, 105, 2);
  phoneHint.position.set(35, PHONE_HEIGHT - 51, 2);
  phoneGroup.visible = false;

  // Four-part crosshair leaves an uncluttered center pixel.
  const reticleGroup = new THREE.Group();
  reticleGroup.name = "Neon City gameplay aiming reticle";
  const reticleMaterial = createHudMaterial({ color: 0xffffff, opacity: 0.82 });
  const reticleParts = [
    panel(2, 9, 0, 1, 2060, reticleMaterial),
    panel(2, 9, 0, 1, 2060, reticleMaterial),
    panel(9, 2, 0, 1, 2060, reticleMaterial),
    panel(9, 2, 0, 1, 2060, reticleMaterial),
  ];
  reticleParts[0].position.set(0, -11, 0.9);
  reticleParts[1].position.set(0, 11, 0.9);
  reticleParts[2].position.set(-11, 0, 0.9);
  reticleParts[3].position.set(11, 0, 0.9);
  reticleGroup.add(...reticleParts);
  root.add(reticleGroup);

  // Screen-space physical feedback remains subtle until the player is hurt or
  // a vehicle reaches genuinely high speed.
  const damageGroup = new THREE.Group();
  const damageMaterial = createHudMaterial({ color: 0xb8002f, opacity: 0 });
  const damageEdges = [
    panel(1, 1, 0, 1, 1980, damageMaterial),
    panel(1, 1, 0, 1, 1980, damageMaterial),
    panel(1, 1, 0, 1, 1980, damageMaterial),
    panel(1, 1, 0, 1, 1980, damageMaterial),
  ];
  damageGroup.add(...damageEdges);
  root.add(damageGroup);

  const speedGroup = new THREE.Group();
  const speedMaterial = createHudMaterial({ color: 0xbdeaff, opacity: 0 });
  const speedLines = Array.from({ length: 16 }, (_, index) => {
    const line = panel(2 + index % 3, 34 + index % 5 * 8, 0, 1, 1982, speedMaterial);
    line.userData.angle = (index / 16) * Math.PI * 2 + 0.08;
    speedGroup.add(line);
    return line;
  });
  root.add(speedGroup);

  // Authored story presentation. Radio lines use the dialogue card alone;
  // cinematic lines also raise letterbox bars and temporarily clear gameplay
  // clutter so a cutscene feels intentional rather than like a toast popup.
  const cinematicBars = new THREE.Group();
  cinematicBars.name = "Narrative cinematic letterbox";
  const cinematicTop = panel(1, 1, 0x010204, 0.98, 2066);
  const cinematicBottom = panel(1, 1, 0x010204, 0.98, 2066);
  cinematicBars.add(cinematicTop, cinematicBottom);
  root.add(cinematicBars);

  const dialogueGroup = new THREE.Group();
  const dialoguePanel = panel(DIALOGUE_WIDTH, 112, 0x000000, 0.94, 2080);
  const dialogueAccent = panel(6, 112, 0x64dcff, 0.98, 2082);
  const dialogueSpeaker = createText("JUNO", atlas, 0x6cecff, 1.75, 1, 36);
  const dialogueText = createText("", atlas, 0xf5f7fb, DIALOGUE_TEXT_SCALE, 1, 256);
  const dialogueProgressBack = panel(856, 3, 0x203044, 0.9, 2082);
  const dialogueProgress = panel(856, 3, 0x75e3ff, 1, 2084);
  dialogueGroup.name = "Narrative dialogue card";
  dialoguePanel.name = "Narrative dialogue panel";
  dialogueText.name = "Narrative dialogue body";
  dialogueGroup.add(
    dialoguePanel, dialogueAccent, dialogueSpeaker, dialogueText,
    dialogueProgressBack, dialogueProgress,
  );
  root.add(dialogueGroup);
  placeTopLeft(dialoguePanel, 0, 0);
  placeTopLeft(dialogueAccent, 0, 0, 0.3);
  dialogueSpeaker.position.set(24, 16, 0.7);
  dialogueText.position.set(DIALOGUE_TEXT_INSET, 47, 0.7);
  placeTopLeft(dialogueProgressBack, 24, 100, 0.5);
  const titleCard = createText("CHAPTER ONE / HOME AGAIN", atlas, 0xffffff, 2, 1, 96);
  titleCard.renderOrder = 2088;
  root.add(titleCard);

  // Pointer lock cannot legally be taken until a user gesture. This overlay is
  // therefore part of the play flow, not an error state: the first click enters
  // the world and Escape returns here without letting the simulation drift.
  const captureGroup = new THREE.Group();
  const captureDim = panel(1, 1, 0x02050b, 0.78, 2100);
  const capturePanel = panel(720, 214, 0x000000, 0.96, 2102);
  const captureRule = panel(720, 5, 0x35d9ff, 1, 2104);
  const captureTitle = createText("CLICK TO PLAY", atlas, 0x7de8ff, 3.4, 1, 64);
  const captureStory = createText("KAI MERCER IS HOME. PULSE GARAGE NEEDS HIM.", atlas, 0xf4f7ff, 1.45, 1, 96);
  const captureHint = createText("MOUSE LOOK  /  ESC RELEASES CURSOR  /  P PAUSES", atlas, 0xaebbcf, 1.25, 1, 96);
  captureGroup.add(captureDim, capturePanel, captureRule, captureTitle, captureStory, captureHint);
  root.add(captureGroup);
  placeTopLeft(capturePanel, 0, 0, 0.2);
  placeTopLeft(captureRule, 0, 0, 0.5);
  captureTitle.position.set(145, 40, 0.8);
  captureStory.position.set(82, 119, 0.8);
  captureHint.position.set(80, 164, 0.8);

  // Death and pause overlays are GPU panels too.
  const deathGroup = new THREE.Group();
  const deathPanel = panel(650, 190, 0x090006, 0.94, 2070);
  const deathRule = panel(610, 4, 0xff174f, 0.9, 2072);
  const deathText = createText("WASTED", atlas, 0xff315d, 5);
  const restartText = createText("T  RESTART FROM THE SAFEHOUSE", atlas, 0xf5dbe2, 1.75);
  deathGroup.add(deathPanel, deathRule, deathText, restartText);
  root.add(deathGroup);
  placeTopLeft(deathPanel, 0, 0);
  placeTopLeft(deathRule, 20, 124, 0.3);
  deathText.position.set(189, 34, 0.8);
  restartText.position.set(123, 148, 0.8);

  const pauseGroup = new THREE.Group();
  const pausePanel = panel(390, 102, 0x000000, 0.93, 2070);
  const pauseTitle = createText("PAUSED", atlas, 0x5de8ff, 3);
  const pauseHint = createText("P  RETURN TO NEON CITY", atlas, 0xd6f7ff, 1.5);
  pauseGroup.add(pausePanel, pauseTitle, pauseHint);
  root.add(pauseGroup);
  placeTopLeft(pausePanel, 0, 0);
  pauseTitle.position.set(102, 20, 0.7);
  pauseHint.position.set(69, 67, 0.7);

  // Opening help is compact and temporary: it teaches the unusual aim gate
  // without sitting across the city view for the whole first block.
  const controlsGroup = new THREE.Group();
  controlsGroup.name = "Neon City gameplay controls banner";
  const controlsPanel = panel(700, 72, 0x000000, 0.90, 2070);
  const controlsRule = panel(700, 3, 0xff2ec4, 0.88, 2072);
  const controlsTitle = createText("QUICK CONTROLS", atlas, 0x5de8ff, 1.45);
  const controlsLine1 = createText("WASD MOVE / DRIVE   MOUSE LOOK   F VEHICLE   E INTERACT   TAB PHONE", atlas, 0xf2f5ff, 1.1, 1, 112);
  const controlsLine2 = createText("HOLD RMB AIM   LMB FIRE SIGHTED   SPACE JUMP / HANDBRAKE   ESC RELEASE", atlas, 0xbac5d8, 1.1, 1, 112);
  controlsGroup.add(controlsPanel, controlsRule, controlsTitle, controlsLine1, controlsLine2);
  root.add(controlsGroup);
  placeTopLeft(controlsPanel, 0, 0);
  placeTopLeft(controlsRule, 0, 0, 0.3);
  controlsTitle.position.set(20, 14, 0.8);
  controlsLine1.position.set(20, 40, 0.8);
  controlsLine2.position.set(20, 58, 0.8);

  const diagnosticsText = createText("WEBGPU NATIVE", atlas, 0x617087, 1, 0.78, 80);
  diagnosticsText.name = "Neon City gameplay diagnostics";
  root.add(diagnosticsText);

  let width = 1;
  let height = 1;
  let visible = true;
  let lastSnapshot = {};

  function alignRight(mesh, right, y, z = 0.6) {
    mesh.position.set(right - mesh.userData.width, y, z);
  }

  function setGroupOpacity(group, amount) {
    group.traverse(object => {
      const material = object.material;
      if (!material) return;
      material.opacity = finite(material.userData?.hudBaseOpacity, 1) * amount;
      material.transparent = true;
    });
  }

  function resize(nextWidth, nextHeight) {
    width = Math.max(1, Math.round(finite(nextWidth, 1)));
    height = Math.max(1, Math.round(finite(nextHeight, 1)));
    camera.left = 0;
    camera.right = width;
    camera.top = 0;
    camera.bottom = height;
    camera.updateProjectionMatrix();
    const drawingSize = renderer.getDrawingBufferSize(new THREE.Vector2());
    target.setSize(Math.max(1, drawingSize.x), Math.max(1, drawingSize.y));

    const topScale = Math.min(1, Math.max(0.58, (width - 66) / (MISSION_WIDTH + STATS_WIDTH)));
    missionGroup.scale.setScalar(topScale);
    statsGroup.scale.setScalar(topScale);
    missionGroup.position.set(22, 22, 0);
    statsGroup.position.set(width - 22 - STATS_WIDTH * topScale, 22, 0);

    const controlsScale = Math.min(1, Math.max(0.58, (width - 36) / 700));
    controlsGroup.scale.setScalar(controlsScale);
    controlsGroup.position.set(width * 0.5 - 350 * controlsScale, 28 + STATS_HEIGHT * topScale, 0);

    const mapScale = Math.min(1, Math.max(0.72, Math.min(width / 980, height / 650)));
    minimapGroup.scale.setScalar(mapScale);
    minimapGroup.position.set(22, height - 22 - MAP_SIZE * mapScale, 0);

    const vehicleScale = Math.min(1, Math.max(0.72, width / 1000));
    vehicleGroup.scale.setScalar(vehicleScale);
    vehicleGroup.position.set(width - 22 - VEHICLE_WIDTH * vehicleScale, height - 22 - VEHICLE_HEIGHT * vehicleScale, 0);

    const promptScale = Math.min(1, Math.max(0.58, (width - 28) / 520));
    promptGroup.scale.setScalar(promptScale);
    promptGroup.position.set(width * 0.5 - 260 * promptScale, height - 58, 0);
    const toastScale = Math.min(1, Math.max(0.52, (width - 28) / 660));
    toastGroup.scale.setScalar(toastScale);
    toastGroup.position.set(width * 0.5 - 330 * toastScale, height - 114, 0);
    const fareConversationScale = Math.min(1, Math.max(0.52, (width - 28) / 720));
    fareConversationGroup.scale.setScalar(fareConversationScale);
    fareConversationGroup.position.set(
      width * 0.5 - 360 * fareConversationScale,
      height - 184 * fareConversationScale,
      0,
    );

    reticleGroup.position.set(width * 0.5, height * 0.5, 0);
    damageEdges[0].scale.set(width, 64, 1);
    damageEdges[0].position.set(width * 0.5, 32, 0);
    damageEdges[1].scale.set(width, 64, 1);
    damageEdges[1].position.set(width * 0.5, height - 32, 0);
    damageEdges[2].scale.set(60, height, 1);
    damageEdges[2].position.set(30, height * 0.5, 0);
    damageEdges[3].scale.set(60, height, 1);
    damageEdges[3].position.set(width - 30, height * 0.5, 0);
    for (const line of speedLines) {
      const angle = line.userData.angle;
      line.position.set(
        width * 0.5 + Math.cos(angle) * width * 0.43,
        height * 0.5 + Math.sin(angle) * height * 0.42,
        0,
      );
      line.rotation.z = angle - Math.PI * 0.5;
    }
    const deathScale = Math.min(1, Math.max(0.56, (width - 30) / 650));
    deathGroup.scale.setScalar(deathScale);
    deathGroup.position.set(width * 0.5 - 325 * deathScale, height * 0.5 - 95 * deathScale, 0);
    const pauseScale = Math.min(1, Math.max(0.65, (width - 30) / 390));
    pauseGroup.scale.setScalar(pauseScale);
    pauseGroup.position.set(width * 0.5 - 195 * pauseScale, height * 0.5 - 51 * pauseScale, 0);
    const shopScale = Math.min(1, Math.max(0.52, Math.min((width - 30) / SHOP_WIDTH, (height - 30) / SHOP_HEIGHT)));
    shopGroup.scale.setScalar(shopScale);
    shopGroup.position.set(
      width * 0.5 - SHOP_WIDTH * 0.5 * shopScale,
      height * 0.5 - SHOP_HEIGHT * 0.5 * shopScale,
      0,
    );
    const phoneScale = Math.min(1, Math.max(0.58, Math.min((width - 30) / PHONE_WIDTH, (height - 30) / PHONE_HEIGHT)));
    phoneGroup.scale.setScalar(phoneScale);
    phoneGroup.position.set(width - 34 - PHONE_WIDTH * phoneScale, height * 0.5 - PHONE_HEIGHT * 0.5 * phoneScale, 0);

    cinematicTop.scale.set(width, 76, 1);
    cinematicTop.position.set(width * 0.5, 38, 0);
    cinematicBottom.scale.set(width, 96, 1);
    cinematicBottom.position.set(width * 0.5, height - 48, 0);
    const dialogueScale = Math.min(1, Math.max(0.54, (width - 30) / DIALOGUE_WIDTH));
    dialogueGroup.scale.setScalar(dialogueScale);
    dialogueGroup.position.set(width * 0.5 - DIALOGUE_WIDTH * 0.5 * dialogueScale, height - 124 * dialogueScale, 0);
    titleCard.position.set(30, 36, 0.9);
    const captureScale = Math.min(1, Math.max(0.54, (width - 30) / 720));
    captureGroup.scale.setScalar(captureScale);
    captureDim.scale.set(width / captureScale, height / captureScale, 1);
    captureDim.position.set(width * 0.5 / captureScale, height * 0.5 / captureScale, 0);
    capturePanel.position.set(width * 0.5 / captureScale, height * 0.5 / captureScale, 0.2);
    captureRule.position.set(width * 0.5 / captureScale, height * 0.5 / captureScale - 104.5, 0.5);
    const captureLeft = width * 0.5 / captureScale - 360;
    const captureTop = height * 0.5 / captureScale - 107;
    captureTitle.position.set(captureLeft + 145, captureTop + 40, 0.8);
    captureStory.position.set(captureLeft + 82, captureTop + 119, 0.8);
    captureHint.position.set(captureLeft + 80, captureTop + 164, 0.8);
    alignRight(diagnosticsText, width - 16, Math.max(8, height - 18));
  }

  function targetForMission(snapshot, mission, vehicles) {
    const explicit = vectorComponents(snapshot.targetPosition ?? mission?.targetPosition);
    if (explicit) return explicit;
    const stage = String(mission?.stage ?? "");
    if (stage === "available") return vectorComponents(mission?.startPosition);
    if (stage === "deliver_target") return vectorComponents(mission?.dropoffPosition);
    if (stage === "steal_target") {
      const targetId = String(mission?.targetVehicleId ?? "");
      return vectorComponents(vehicles.find(vehicle => String(vehicle?.id) === targetId));
    }
    return null;
  }

  function updateRoadGrid(playerPosition, radius, snapshot) {
    const world = snapshot.world ?? {};
    const bounds = boundsValues(world.bounds ?? snapshot.worldBounds);
    const spacing = clamp(world.roadSpacing ?? world.blockSize ?? snapshot.roadSpacing ?? 28, 18, 64);
    const pixelsPerMeter = (MAP_INNER * 0.5) / radius;
    const firstX = Math.ceil((playerPosition.x - radius) / spacing) * spacing;
    const firstZ = Math.ceil((playerPosition.z - radius) / spacing) * spacing;

    for (let index = 0; index < ROAD_POOL_SIZE; ++index) {
      const worldX = firstX + index * spacing;
      const line = verticalRoads[index];
      const screenX = MAP_CENTER + (worldX - playerPosition.x) * pixelsPerMeter;
      const onMap = screenX >= MAP_INSET && screenX <= MAP_SIZE - MAP_INSET && worldX >= bounds.minX && worldX <= bounds.maxX;
      line.visible = onMap;
      if (onMap) {
        const major = Math.abs(Math.round(worldX / spacing)) % 4 === 0;
        line.material = major ? primaryRoadMaterial : secondaryRoadMaterial;
        line.scale.x = major ? 5 : 2.5;
        line.position.set(screenX, MAP_CENTER, 0.5);
      }

      const worldZ = firstZ + index * spacing;
      const horizontal = horizontalRoads[index];
      const screenY = MAP_CENTER + (worldZ - playerPosition.z) * pixelsPerMeter;
      const rowOnMap = screenY >= MAP_INSET && screenY <= MAP_SIZE - MAP_INSET && worldZ >= bounds.minZ && worldZ <= bounds.maxZ;
      horizontal.visible = rowOnMap;
      if (rowOnMap) {
        const major = Math.abs(Math.round(worldZ / spacing)) % 4 === 0;
        horizontal.material = major ? primaryRoadMaterial : secondaryRoadMaterial;
        horizontal.scale.y = major ? 5 : 2.5;
        horizontal.position.set(MAP_CENTER, screenY, 0.5);
      }
    }
  }

  function updateBlipPool(pool, entities, playerPosition, radius, { clampToEdge = false } = {}) {
    const half = MAP_INNER * 0.5 - 5;
    for (let index = 0; index < pool.length; ++index) {
      const mesh = pool[index];
      const entity = entities[index];
      const position = vectorComponents(entity);
      if (!position) {
        mesh.visible = false;
        continue;
      }
      const normalizedX = (position.x - playerPosition.x) / radius;
      const normalizedZ = (position.z - playerPosition.z) / radius;
      const inside = Math.abs(normalizedX) <= 1 && Math.abs(normalizedZ) <= 1;
      mesh.visible = inside || clampToEdge;
      if (!mesh.visible) continue;
      mesh.position.set(
        MAP_CENTER + clamp(normalizedX, -1, 1) * half,
        MAP_CENTER + clamp(normalizedZ, -1, 1) * half,
        1.1,
      );
      if (mesh.geometry === unitPlane) mesh.rotation.z = -finite(entity?.yaw ?? entity?.heading);
    }
  }

  function updateRoute(playerPosition, targetPosition, radius, world, elapsed) {
    const route = targetPosition
      ? planGridRoute(playerPosition, targetPosition, world?.roadSpacing ?? 48, world?.bounds)
      : [];
    const half = MAP_INNER * 0.5 - 6;
    const toMap = point => ({
      x: MAP_CENTER + clamp((point.x - playerPosition.x) / radius, -1, 1) * half,
      y: MAP_CENTER + clamp((point.z - playerPosition.z) / radius, -1, 1) * half,
    });
    routeMaterial.color.setHex(Math.sin(elapsed * 4.2) > 0 ? 0x72f2ff : 0x30d5ee);
    for (let index = 0; index < routeSegments.length; ++index) {
      const segment = routeSegments[index];
      const start = route[index];
      const end = route[index + 1];
      if (!start || !end) {
        segment.visible = false;
        continue;
      }
      const screenStart = toMap(start);
      const screenEnd = toMap(end);
      const dx = screenEnd.x - screenStart.x;
      const dy = screenEnd.y - screenStart.y;
      const length = Math.hypot(dx, dy);
      segment.visible = length > 0.5;
      if (!segment.visible) continue;
      segment.scale.set(length, 3.5, 1);
      segment.position.set((screenStart.x + screenEnd.x) * 0.5, (screenStart.y + screenEnd.y) * 0.5, 0.72);
      segment.rotation.z = Math.atan2(dy, dx);
    }
  }

  const MAP_MINOR_ROAD = Object.freeze([48, 73, 98, 255]);
  const MAP_MAJOR_ROAD = Object.freeze([91, 127, 157, 255]);
  const MAP_ROUTE = Object.freeze([38, 224, 242, 255]);
  const MAP_POLICE_BLUE = Object.freeze([32, 164, 255, 255]);
  const MAP_POLICE_RED = Object.freeze([255, 55, 92, 255]);
  const MAP_POLICE_PERSON = Object.freeze([48, 154, 255, 255]);
  const MAP_CAR = Object.freeze([190, 207, 224, 255]);
  const MAP_CIVILIAN = Object.freeze([236, 189, 74, 255]);
  const MAP_ACTIVITY = Object.freeze([98, 242, 142, 255]);
  const MAP_BASKETBALL = Object.freeze([255, 164, 76, 255]);
  const MAP_BUSINESS_OPEN = Object.freeze([255, 190, 92, 255]);
  const MAP_BUSINESS_CLOSED = Object.freeze([105, 92, 78, 255]);
  const MAP_MISSION = Object.freeze([255, 54, 195, 255]);
  const MAP_PLAYER = Object.freeze([246, 255, 255, 255]);
  const MAP_PLAYER_CENTER = Object.freeze([104, 238, 255, 255]);
  let nextMinimapRasterAt = -Infinity;

  function paintMapRect(xValue, yValue, halfWidth, halfHeight, color) {
    const centerX = Math.round(xValue);
    const centerY = Math.round(yValue);
    const width = Math.max(0, Math.trunc(halfWidth));
    const height = Math.max(0, Math.trunc(halfHeight));
    for (let y = centerY - height; y <= centerY + height; ++y) {
      for (let x = centerX - width; x <= centerX + width; ++x) writeMapPixel(minimapPixels, x, y, color);
    }
  }

  function paintMapDiamond(xValue, yValue, radiusValue, color) {
    const centerX = Math.round(xValue);
    const centerY = Math.round(yValue);
    const radius = Math.max(1, Math.trunc(radiusValue));
    for (let y = -radius; y <= radius; ++y) {
      for (let x = -radius; x <= radius; ++x) {
        if (Math.abs(x) + Math.abs(y) <= radius) writeMapPixel(minimapPixels, centerX + x, centerY + y, color);
      }
    }
  }

  function paintMapLine(startX, startY, endX, endY, thickness, color) {
    const dx = endX - startX;
    const dy = endY - startY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const radius = Math.max(0, Math.floor((Number(thickness) || 1) * 0.5));
    for (let step = 0; step <= steps; ++step) {
      const amount = step / steps;
      paintMapRect(startX + dx * amount, startY + dy * amount, radius, radius, color);
    }
  }

  function rasterPoint(positionValue, playerPosition, radius, { clampToEdge = false } = {}) {
    const position = vectorComponents(positionValue);
    if (!position) return null;
    let nx = (position.x - playerPosition.x) / radius;
    let ny = (position.z - playerPosition.z) / radius;
    const inside = Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
    if (!inside && !clampToEdge) return null;
    nx = clamp(nx, -1, 1);
    ny = clamp(ny, -1, 1);
    const half = MAP_INNER * 0.5 - 7;
    return { x: MAP_INNER * 0.5 + nx * half, y: MAP_INNER * 0.5 + ny * half };
  }

  function paintMinimap(snapshot, player, activeVehicle, mission, elapsed) {
    minimapPixels.set(minimapBasePixels);
    const playerPosition = vectorComponents(activeVehicle ?? player) ?? { x: 0, y: 0, z: 0 };
    const vehicles = entityList(snapshot.vehicles);
    const people = entityList(snapshot.population);
    const bounds = boundsValues(snapshot.world?.bounds ?? snapshot.worldBounds);
    const worldSpan = Math.min(
      Number.isFinite(bounds.maxX - bounds.minX) ? bounds.maxX - bounds.minX : 600,
      Number.isFinite(bounds.maxZ - bounds.minZ) ? bounds.maxZ - bounds.minZ : 600,
    );
    const radius = clamp(snapshot.world?.minimapRadius ?? worldSpan * 0.18, 64, 130);
    const spacing = clamp(snapshot.world?.roadSpacing ?? snapshot.world?.blockSize ?? snapshot.roadSpacing ?? 48, 18, 64);
    const center = MAP_INNER * 0.5;
    const pixelsPerMeter = (MAP_INNER * 0.5 - 7) / radius;
    const firstX = Math.ceil((playerPosition.x - radius) / spacing) * spacing;
    const firstZ = Math.ceil((playerPosition.z - radius) / spacing) * spacing;
    for (let index = 0; index < ROAD_POOL_SIZE; ++index) {
      const worldX = firstX + index * spacing;
      if (worldX >= bounds.minX && worldX <= bounds.maxX) {
        const x = center + (worldX - playerPosition.x) * pixelsPerMeter;
        if (x >= 0 && x < MAP_INNER) {
          const major = Math.abs(Math.round(worldX / spacing)) % 4 === 0;
          paintMapLine(x, 2, x, MAP_INNER - 3, major ? 4 : 2, major ? MAP_MAJOR_ROAD : MAP_MINOR_ROAD);
        }
      }
      const worldZ = firstZ + index * spacing;
      if (worldZ >= bounds.minZ && worldZ <= bounds.maxZ) {
        const y = center + (worldZ - playerPosition.z) * pixelsPerMeter;
        if (y >= 0 && y < MAP_INNER) {
          const major = Math.abs(Math.round(worldZ / spacing)) % 4 === 0;
          paintMapLine(2, y, MAP_INNER - 3, y, major ? 4 : 2, major ? MAP_MAJOR_ROAD : MAP_MINOR_ROAD);
        }
      }
    }

    const targetPosition = targetForMission(snapshot, mission, vehicles);
    const route = targetPosition
      ? planGridRoute(playerPosition, targetPosition, spacing, snapshot.world?.bounds)
      : [];
    for (let index = 0; index + 1 < route.length; ++index) {
      const start = rasterPoint(route[index], playerPosition, radius, { clampToEdge: true });
      const end = rasterPoint(route[index + 1], playerPosition, radius, { clampToEdge: true });
      if (start && end) paintMapLine(start.x, start.y, end.x, end.y, 3, MAP_ROUTE);
    }

    const playerVehicleId = String(player?.inVehicle ?? activeVehicle?.id ?? "");
    for (const vehicle of vehicles) {
      if (String(vehicle?.id ?? "") === playerVehicleId) continue;
      const point = rasterPoint(vehicle, playerPosition, radius);
      if (!point) continue;
      if (isPolice(vehicle)) paintMapDiamond(point.x, point.y, 3, Math.sin(elapsed * 10) > 0
        ? MAP_POLICE_BLUE
        : MAP_POLICE_RED);
      else paintMapRect(point.x, point.y, 2, 1, MAP_CAR);
    }
    for (const person of people) {
      const point = rasterPoint(person, playerPosition, radius);
      if (!point) continue;
      if (isPolice(person)) paintMapDiamond(point.x, point.y, 2, MAP_POLICE_PERSON);
      else paintMapRect(point.x, point.y, 1, 1, MAP_CIVILIAN);
    }
    for (const activity of Array.isArray(snapshot.lifeActivities) ? snapshot.lifeActivities : []) {
      const point = rasterPoint(activity?.hubPosition, playerPosition, radius, { clampToEdge: true });
      if (point) paintMapDiamond(point.x, point.y, 2, activity?.kind === "basketball" ? MAP_BASKETBALL : MAP_ACTIVITY);
    }
    for (const business of Array.isArray(snapshot.neighbourhood?.businesses) ? snapshot.neighbourhood.businesses : []) {
      const point = rasterPoint(business?.position, playerPosition, radius);
      if (point) paintMapRect(point.x, point.y, 1, 1, business.open ? MAP_BUSINESS_OPEN : MAP_BUSINESS_CLOSED);
    }
    if (targetPosition) {
      const point = rasterPoint(targetPosition, playerPosition, radius, { clampToEdge: true });
      if (point) paintMapDiamond(point.x, point.y, 4, MAP_MISSION);
    }

    const yaw = finite(activeVehicle?.yaw ?? player?.yaw);
    const forward = { x: center + Math.sin(yaw) * 8, y: center + Math.cos(yaw) * 8 };
    const tail = { x: center - Math.sin(yaw) * 5, y: center - Math.cos(yaw) * 5 };
    paintMapLine(tail.x, tail.y, forward.x, forward.y, 2, MAP_PLAYER);
    paintMapDiamond(forward.x, forward.y, 2, MAP_PLAYER);
    paintMapRect(center, center, 2, 2, MAP_PLAYER_CENTER);
    minimapTexture.needsUpdate = true;
    return { playerPosition, vehicles, people, radius, targetPosition };
  }

  function updateMinimap(snapshot, player, activeVehicle, mission, elapsed) {
    if (elapsed + 1e-6 < nextMinimapRasterAt) return;
    nextMinimapRasterAt = elapsed + 0.05;
    paintMinimap(snapshot, player, activeVehicle, mission, elapsed);
  }

  function update(snapshot = {}) {
    lastSnapshot = snapshot;
    const elapsed = Math.max(0, finite(snapshot.elapsed));
    const player = snapshot.player ?? {};
    const vehicles = entityList(snapshot.vehicles);
    const vehicleId = String(player.inVehicle ?? "");
    let activeVehicle = snapshot.vehicle && typeof snapshot.vehicle === "object" ? snapshot.vehicle : null;
    if (!activeVehicle && vehicleId) activeVehicle = vehicles.find(value => String(value?.id) === vehicleId) ?? null;
    const driving = Boolean(vehicleId || activeVehicle);
    const health = Math.max(0, finite(player.health, 100));
    const maxHealth = Math.max(1, finite(player.maxHealth, 100));
    const armor = Math.max(0, finite(player.armor));
    const maxArmor = Math.max(1, finite(player.maxArmor, 100));
    const stamina = Math.max(0, finite(player.stamina, 100));
    const maxStamina = Math.max(1, finite(player.maxStamina, 100));
    const alive = player.alive !== false && health > 0;
    const paused = Boolean(snapshot.paused);
    const capture = snapshot.capture ?? null;
    const captured = capture ? Boolean(capture.locked) : true;
    const story = snapshot.narrative ?? snapshot.story ?? {};
    const choice = story.choice ?? null;
    const authoredPresentation = isAuthoredNarrativePresentation(story);
    const cinematic = Boolean(story.cinematic && authoredPresentation);
    const neighbourhood = snapshot.neighbourhood ?? {};
    const shopMenuVisible = Boolean(neighbourhood.menuOpen) && alive && captured && !authoredPresentation;
    const phone = snapshot.phone ?? {};
    const phoneVisible = Boolean(phone.open) && alive && captured && !authoredPresentation && !shopMenuVisible;

    statsGroup.visible = alive && captured && !authoredPresentation;

    fillBar(healthFill, 20, 74, 208, health / maxHealth);
    fillBar(armorFill, 20, 103, 208, armor / maxArmor);
    fillBar(staminaFill, 20, 133, 208, stamina / maxStamina);
    healthText.setText(`HEALTH ${Math.ceil(health)} / ${Math.ceil(maxHealth)}`);
    armorText.setText(`ARMOR ${Math.ceil(armor)}`);
    staminaText.setText(`STAMINA ${Math.ceil(stamina)}  ${textValue(neighbourhood.appetiteStatus, "STEADY")}`);
    staminaFill.material.color.setHex(stamina < 18 ? 0xffa43a : 0x72ff9b);
    const environment = snapshot.environment ?? {};
    environmentText.setText(`${textValue(environment.timeLabel, "21:39")} ${textValue(environment.weather, "CLEAR")}`);
    cashText.setText(`$${formatInteger(player.cash)}`);
    alignRight(cashText, STATS_WIDTH - 18, 14);
    const ammo = player.ammo ?? {};
    const weaponLabel = player.weapon === "minigun" ? "MINIGUN" : "PISTOL";
    const reserveAmount = Math.max(0, Math.trunc(finite(ammo.reserve)));
    const reserveLabel = reserveAmount >= 1_000_000 ? `${Math.floor(reserveAmount / 1_000_000)}M` : String(reserveAmount);
    ammoText.setText(ammo.reloading
      ? `${weaponLabel} RELOADING  ${Math.max(0, Math.ceil(finite(ammo.reload) * 10) / 10).toFixed(1)}S`
      : `${weaponLabel} ${Math.max(0, Math.trunc(finite(ammo.clip)))} / ${reserveLabel}`);
    alignRight(ammoText, STATS_WIDTH - 18, 43);
    ammoText.visible = Boolean(player.aiming || ammo.reloading);

    const wanted = snapshot.wanted ?? {};
    const starCount = Math.round(clamp(wanted.stars ?? snapshot.wantedStars, 0, 5));
    const wantedPulse = wanted.searching && Math.sin(elapsed * 7) > 0;
    starActiveMaterial.color.setHex(wantedPulse ? 0xff315d : 0xfff2b2);
    for (let index = 0; index < wantedStars.length; ++index) {
      wantedStars[index].material = index < starCount ? starActiveMaterial : starInactiveMaterial;
      wantedStars[index].scale.setScalar(index < starCount && wantedPulse ? 1.12 : 1);
    }
    const trust = Math.max(0, Math.trunc(finite(snapshot.communityTrust)));
    wantedLabel.setText(starCount ? `WANTED ${starCount}` : trust ? `COMMUNITY TRUST ${trust}` : "WANTED CLEAR");

    const activity = snapshot.activity && snapshot.activity.stage !== "idle" ? snapshot.activity : null;
    const mission = activity ?? snapshot.chapterTwoMission ?? snapshot.mission ?? null;
    missionGroup.visible = Boolean(mission) && captured && !authoredPresentation;
    if (mission) {
      missionTitle.setText(mission.title ?? "HOME AGAIN");
      const passengerName = activity?.kind === "taxi" ? textValue(activity.passengerName ?? activity.passenger) : "";
      const objectiveLabel = passengerName && activity.stage === "dropoff"
        ? `${passengerName} — ${mission.objective ?? "DRIVE TO THE DESTINATION"}`
        : mission.objective ?? "FREE ROAM";
      missionObjective.setText(wrapText(objectiveLabel, 52, 2));
      let missionRewardLabel = "";
      if (activity?.kind === "taxi") {
        missionRewardLabel = activity.status === "completed"
          ? `PAYOUT $${formatInteger(activity.payout)}`
          : `GRADE ${textValue(activity.qualityGrade, "S")}  FARE $${formatInteger(activity.estimatedReward)}`;
      } else if (activity?.kind === "street_race") {
        missionRewardLabel = activity.status === "completed"
          ? `PAYOUT $${formatInteger(activity.payout)}`
          : `TIME ${Math.max(0, finite(activity.timeRemaining)).toFixed(1)}S  CP ${Math.min(activity.checkpointCount, activity.checkpointsPassed + 1)}/${activity.checkpointCount}`;
      } else if (activity?.kind === "basketball") {
        missionRewardLabel = activity.status === "completed"
          ? `PAYOUT $${formatInteger(activity.payout)}  MADE ${formatInteger(activity.made)}/${formatInteger(activity.stopCount)}`
          : activity.stage === "charging"
            ? `RELEASE ${Math.round(clamp(activity.charge, 0, 1) * 100)}%  SWEET SPOT ${Math.round(clamp(activity.targetRelease, 0, 1) * 100)}%`
            : `MADE ${formatInteger(activity.made)}/${formatInteger(activity.stopCount)}  POINTS ${formatInteger(activity.points)}  TRUST +${formatInteger(activity.trustReward)}`;
      } else if (activity?.kind === "ordinary_story") {
        missionRewardLabel = activity.status === "completed"
          ? `FILED  ${textValue(activity.choiceResult, "CONSEQUENCE RECORDED").replaceAll("_", " ").toUpperCase()}`
          : activity.phase === "survey"
            ? `NIGHT RIDERS ${formatInteger(activity.surveyIndex)}/${formatInteger(activity.surveyCount)}  NO NAMES RECORDED`
            : activity.phase === "aftermath"
              ? `CONSEQUENCE ${formatInteger(activity.aftermathIndex)}/${formatInteger(activity.aftermathCount)}`
              : "NO PAYOUT  BUILD THE PUBLIC RECORD";
      } else if (mission.kind === "story_chapter") {
        missionRewardLabel = textValue(mission.hudDetail, "NO VIOLENCE REQUIRED");
      } else if (activity) {
        missionRewardLabel = activity.status === "completed"
          ? `PAYOUT $${formatInteger(activity.payout)}  TRUST +${formatInteger(activity.trustReward)}`
          : `PAY $${formatInteger(activity.estimatedReward)}  TRUST +${formatInteger(activity.trustReward)}  TASK ${Math.min(activity.stopCount, activity.stopIndex + 1)}/${activity.stopCount}`;
      } else missionRewardLabel = `RECOVERY FEE $${formatInteger(mission.reward)}`;
      missionReward.setText(ellipsizeLine(missionRewardLabel, 36));
      const targetPosition = targetForMission(snapshot, mission, vehicles);
      const playerPosition = vectorComponents(activeVehicle ?? player);
      const computedDistance = targetPosition && playerPosition
        ? Math.hypot(targetPosition.x - playerPosition.x, targetPosition.z - playerPosition.z)
        : 0;
      const targetDistance = Number.isFinite(Number(snapshot.targetDistance)) ? Number(snapshot.targetDistance) : computedDistance;
      missionDistance.setText(mission.status === "completed" ? "JOB COMPLETE" : mission.status === "failed" ? "ACTIVITY FAILED" :
        activity?.kind === "taxi" && activity.stage === "boarding"
          ? `BOARDING ${Math.round(clamp(activity.boardingRatio, 0, 1) * 100)}%`
          : activity?.kind === "basketball" ? `SHOT ${Math.min(activity.stopCount, activity.stopIndex + 1)}/${activity.stopCount}` : `TARGET ${formatDistance(targetDistance)}`);
      alignRight(missionDistance, MISSION_WIDTH - 20, 88);
      missionObjective.material.color.setHex(mission.status === "completed" ? 0x72ff9b : 0xf2f4ff);
      missionTitle.material.color.setHex(activity?.kind === "taxi" ? 0x5de8ff :
        activity?.kind === "street_race" ? 0xffd45e : activity?.kind === "basketball" ? 0xffa653 :
          activity?.kind === "ordinary_story" ? 0xffbd62 : mission.kind === "story_chapter" ? 0xffbd62 :
            activity ? 0x72ff9b : 0xff55d4);
    }

    const showBasketballMeter = Boolean(activity?.kind === "basketball" && activity.stage === "charging" && missionGroup.visible);
    basketballMeterBack.visible = showBasketballMeter;
    basketballMeterFill.visible = showBasketballMeter;
    basketballSweetSpot.visible = showBasketballMeter;
    basketballTargetTick.visible = showBasketballMeter;
    basketballMeterText.visible = showBasketballMeter;
    if (showBasketballMeter) {
      const left = 20;
      const width = 272;
      const release = clamp(activity.targetRelease, 0, 1);
      const window = clamp(activity.goodWindow, 0.01, 0.32);
      const charge = clamp(activity.charge, 0, 1);
      const bandLeft = clamp(release - window, 0, 1);
      const bandRight = clamp(release + window, 0, 1);
      basketballSweetSpot.scale.x = Math.max(1, (bandRight - bandLeft) * width);
      basketballSweetSpot.position.set(left + ((bandLeft + bandRight) * 0.5) * width, 118, 1.4);
      basketballTargetTick.position.set(left + release * width, 118, 1.6);
      fillBar(basketballMeterFill, left, 118, width, charge, 1.5);
      const releaseError = Math.abs(charge - release);
      const meterColor = releaseError <= window * 0.34 ? 0x72ff9b : releaseError <= window ? 0xffd45e : 0xff8d46;
      basketballMeterFill.material.color.setHex(meterColor);
      const cells = 26;
      const currentCell = Math.min(cells - 1, Math.floor(charge * cells));
      const targetCell = Math.min(cells - 1, Math.floor(release * cells));
      let track = "";
      for (let index = 0; index < cells; ++index) {
        const sample = (index + 0.5) / cells;
        track += index === currentCell ? "#" : index === targetCell ? "I" : sample >= bandLeft && sample <= bandRight ? "=" : "-";
      }
      basketballMeterText.setText(`POWER ${track}`);
      basketballMeterText.material.color.setHex(meterColor);
    }

    vehicleGroup.visible = driving && Boolean(activeVehicle) && captured && !authoredPresentation;
    let activeKph = 0;
    if (activeVehicle) {
      const presentation = VEHICLE_PRESENTATION[String(activeVehicle.kind ?? "").toLowerCase()];
      vehicleName.setText(activeVehicle.displayName ?? activeVehicle.name ?? activeVehicle.model ?? presentation?.name ?? "STREET CAR");
      const kph = numericSpeed(activeVehicle);
      activeKph = kph;
      vehicleSpeed.setText(`${String(Math.round(kph)).padStart(3, "0")} KPH`);
      alignRight(vehicleSpeed, VEHICLE_WIDTH - 18, 14);
      const vehicleHealth = Math.max(0, finite(activeVehicle.health ?? activeVehicle.durability, 100));
      const vehicleMaxHealth = Math.max(1, finite(activeVehicle.maxHealth ?? activeVehicle.maxDurability, presentation?.maxHealth ?? 100));
      const ratio = vehicleHealth / vehicleMaxHealth;
      vehicleHealthText.setText(`VEHICLE ${Math.ceil(clamp(ratio, 0, 1) * 100)}%`);
      fillBar(vehicleHealthFill, 20, 75, 166, ratio);
      vehicleHealthFill.material.color.setHex(ratio < 0.28 ? 0xff315d : ratio < 0.58 ? 0xffa43a : 0x72ff9b);
    }

    const prompt = textValue(snapshot.prompt);
    promptText.setText(prompt);
    promptGroup.visible = Boolean(prompt) && alive && !paused && captured && !authoredPresentation;
    const toast = textValue(snapshot.toast);
    const toastUntil = Number(snapshot.toastUntil ?? Infinity);
    const toastVisible = Boolean(toast) && elapsed <= toastUntil;
    toastText.setText(wrapText(toast, 76, 1));
    // One fixed card serves every non-blocking activity conversation. Taxi
    // fares introduced it, but ordinary-life stories use the same allocation-
    // stable presentation rather than constructing another panel mid-game.
    const activityDialogue = activity?.dialogue ?? null;
    const activityConversationVisible = Boolean(
      activityDialogue?.active && activityDialogue.text && finite(activityDialogue.remaining, 1) > 0 &&
      captured && !authoredPresentation && !shopMenuVisible,
    );
    fareConversationGroup.visible = activityConversationVisible;
    if (activityConversationVisible) {
      const speaker = textValue(
        activityDialogue.speaker,
        activity.passengerName ?? activity.passenger ?? activity.title ?? "NEON CITY",
      ).toUpperCase();
      const role = textValue(activityDialogue.role, activity.passengerRole ?? activity.subtitle).toUpperCase();
      fareConversationSpeaker.setText(ellipsizeLine(role ? `${speaker} / ${role}` : speaker, 76));
      fareConversationText.setText(wrapText(activityDialogue.text, 82, 2));
      // The fixed card occupies the same lower-right safe area as telemetry.
      // Let the named passenger own it briefly; mission, stats and minimap stay
      // live, and every hidden HUD mesh remains resident and prewarmed.
      vehicleGroup.visible = false;
      promptGroup.visible = false;
    }
    toastGroup.visible = toastVisible && captured && !authoredPresentation && !activityConversationVisible;

    shopGroup.visible = shopMenuVisible;
    if (shopMenuVisible) {
      const familiarity = Math.max(0, Math.trunc(finite(neighbourhood.familiarity)));
      const familiarityLabel = familiarity >= 3 ? "TRUSTED REGULAR" : familiarity >= 2 ? "REGULAR" : "NEW FACE";
      const openingLabel = textValue(neighbourhood.openingHours?.label, "HOURS POSTED");
      shopTitle.setText(textValue(neighbourhood.businessName, "OPEN DOORS"));
      shopHours.setText(`OPEN  ${openingLabel}`);
      shopKeeper.setText(`${textValue(neighbourhood.keeperName, "SHOPKEEPER")}  /  ${familiarityLabel}`);
      shopVitals.setText(`CASH $${formatInteger(player.cash)}  /  ${textValue(neighbourhood.appetiteStatus, "STEADY")} ${Math.round(clamp(neighbourhood.appetite, 0, 100))}`);
      shopLine.setText(wrapText(textValue(neighbourhood.keeperLine, "COME IN. THERE IS TIME TO EAT."), 88, 2));
      const items = Array.isArray(neighbourhood.menuItems) ? neighbourhood.menuItems : [];
      const selection = Math.max(0, Math.trunc(finite(neighbourhood.selectionIndex)));
      for (let index = 0; index < shopRows.length; ++index) {
        const row = shopRows[index];
        const item = items[index];
        row.visible = Boolean(item);
        if (!item) continue;
        const selected = index === selection;
        const benefit = item.payForward
          ? "NO BUFF / SOMEONE EATS LATER"
          : [item.heal ? `HEALTH +${formatInteger(item.heal)}` : "", item.stamina ? `STAMINA +${formatInteger(item.stamina)}` : "", item.appetite ? `FED +${formatInteger(item.appetite)}` : ""].filter(Boolean).join("  ");
        row.setText(`${selected ? "→" : " "} ${textValue(item.name, "MEAL")}  $${formatInteger(item.cost)}  ${benefit}`);
        const affordable = finite(player.cash) + 1e-9 >= finite(item.cost);
        row.material.color.setHex(!affordable ? 0x7c8795 : selected ? 0xffd17a : item.payForward ? 0x9dffb9 : 0xe8edf4);
      }
      shopHint.setText(neighbourhood.consuming
        ? `EATING ${Math.round(clamp(neighbourhood.consumeProgress, 0, 1) * 100)}%    Q / F LEAVE    K SAVE`
        : "W / S SELECT    E BUY    Q / F LEAVE    K SAVE");
    }

    phoneGroup.visible = phoneVisible;
    if (phoneVisible) {
      phoneClock.setText(textValue(phone.time, "21:39"));
      phoneTitle.setText(textValue(phone.title, "NEON LIFE"));
      phoneSubtitle.setText(ellipsizeLine(textValue(phone.subtitle, "YOUR CITY IN YOUR POCKET"), 52));
      const items = Array.isArray(phone.items) ? phone.items : [];
      const selection = Math.max(0, Math.trunc(finite(phone.selection)));
      for (let index = 0; index < phoneRows.length; ++index) {
        const row = phoneRows[index];
        const item = items[index];
        row.backing.visible = row.accent.visible = row.title.visible = row.detail.visible = Boolean(item);
        if (!item) continue;
        const selected = index === selection;
        row.title.setText(`${selected ? "→" : " "} ${textValue(item.title, "APP")}`);
        row.detail.setText(ellipsizeLine(textValue(item.detail, "NEON CITY"), 55));
        row.title.material.color.setHex(selected ? 0xffd46c : 0xf1f7fa);
        row.detail.material.color.setHex(selected ? 0xbceefa : 0x93aabb);
        row.accent.material.color.setHex(selected ? 0xff2ec4 : 0x405669);
        row.backing.material.color.setHex(selected ? 0x17354a : index % 2 ? 0x101e2a : 0x122535);
      }
      phoneHint.setText(phone.app
        ? "W / S BROWSE       Q / F / TAB BACK"
        : "W / S SELECT      E OPEN      TAB CLOSE");
    }

    reticleGroup.visible = alive && !driving && !paused && captured && !authoredPresentation && player.aiming;
    reticleGroup.scale.setScalar(0.72);
    reticleMaterial.color.setHex(0x8feaff);
    const lowHealth = clamp((38 - health) / 38, 0, 1) * (0.12 + (Math.sin(elapsed * 4.5) + 1) * 0.045);
    const damagePulse = clamp(finite(player.damageFlash) / 0.72, 0, 1) * 0.34;
    damageMaterial.opacity = Math.max(lowHealth, damagePulse);
    damageGroup.visible = damageMaterial.opacity > 0.008 && alive && !paused && !authoredPresentation;
    const speedFactor = driving ? clamp((activeKph - 72) / 85, 0, 1) : 0;
    speedMaterial.opacity = speedFactor * speedFactor * 0.22;
    speedGroup.visible = speedFactor > 0.02 && alive && !paused && !authoredPresentation;
    deathGroup.visible = !alive && captured;
    pauseGroup.visible = paused && alive && captured;
    if (!alive) {
      const pulse = 0.78 + (Math.sin(elapsed * 3.5) + 1) * 0.1;
      deathText.material.opacity = pulse;
    }

    const bannerAlpha = elapsed < 4 ? 1 : clamp((7 - elapsed) / 3, 0, 1);
    // Teach capture/movement only while the player is actually on foot and
    // uncommitted. Once a vehicle or activity has begun, its own prompt and
    // objective carry the interaction; keeping this panel around only masks
    // the road and conversation card during the crucial opening seconds.
    controlsGroup.visible = bannerAlpha > 0.01 && alive && !paused && captured && !authoredPresentation &&
      !story.active && !driving && !activity;
    if (controlsGroup.visible) setGroupOpacity(controlsGroup, bannerAlpha);

    if (shopMenuVisible) {
      statsGroup.visible = false;
      missionGroup.visible = false;
      vehicleGroup.visible = false;
      minimapGroup.visible = false;
      promptGroup.visible = false;
      toastGroup.visible = false;
      fareConversationGroup.visible = false;
      reticleGroup.visible = false;
      controlsGroup.visible = false;
    }

    if (phoneVisible) {
      statsGroup.visible = false;
      missionGroup.visible = false;
      vehicleGroup.visible = false;
      minimapGroup.visible = false;
      promptGroup.visible = false;
      toastGroup.visible = false;
      fareConversationGroup.visible = false;
      reticleGroup.visible = false;
      controlsGroup.visible = false;
    }

    updateMinimap(snapshot, player, activeVehicle, mission, elapsed);
    minimapGroup.visible = alive && captured && !authoredPresentation && !shopMenuVisible && !phoneVisible;
    mapTitle.setText(textValue(snapshot.world?.district?.name, "NEON CITY").toUpperCase());

    cinematicBars.visible = cinematic && captured;
    dialogueGroup.visible = authoredPresentation && captured;
    titleCard.visible = cinematic && Boolean(story.titleCard) && story.lineIndex === 0 && captured;
    if (dialogueGroup.visible) {
      if (choice) {
        dialogueSpeaker.setText("DECIDE — BOTH ANSWERS HAVE A COST");
        dialogueSpeaker.material.color.setHex(0xffd17a);
        dialogueText.setText(formatChoiceText(choice));
        dialogueProgressBack.visible = false;
        dialogueProgress.visible = false;
        dialogueAccent.material.color.setHex(0xffb84d);
      } else {
        dialogueSpeaker.setText(textValue(story.line.speaker, "NEON CITY").toUpperCase());
        dialogueSpeaker.material.color.setHex(story.line.tone === "title" ? 0xffd17a : 0x6cecff);
        dialogueText.setText(wrapText(story.line.text, 88, 2));
        dialogueProgressBack.visible = true;
        fillBar(dialogueProgress, 24, 101.5, 856, clamp(story.line.progress, 0, 1));
        dialogueAccent.material.color.setHex(0x64dcff);
      }
    }
    if (titleCard.visible) titleCard.setText(textValue(story.titleCard).toUpperCase());

    captureGroup.visible = alive && !captured;
    if (captureGroup.visible) {
      captureTitle.setText(capture?.everLocked ? "CLICK TO RESUME" : "CLICK TO PLAY");
      captureStory.setText(capture?.error
        ? "CURSOR CAPTURE WAS DENIED. CLICK THE GAME WINDOW AGAIN."
        : "KAI MERCER IS HOME. PULSE GARAGE NEEDS HIM.");
    }

    const diagnostics = snapshot.diagnostics ?? {};
    const renderLabel = diagnostics.render?.label ?? diagnostics.rtx?.label ?? diagnostics.label ?? "WEBGPU NATIVE";
    const fps = Math.round(finite(diagnostics.fps));
    diagnosticsText.setText(fps > 0 ? `${renderLabel}  ${fps} FPS` : renderLabel);
    diagnosticsText.visible = captured && !authoredPresentation && !shopMenuVisible;
    alignRight(diagnosticsText, width - 16, Math.max(8, height - 18));
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

  const initialSize = renderer.getSize(new THREE.Vector2());
  resize(initialSize.x, initialSize.y);
  update();

  return {
    scene,
    camera,
    target,
    get texture() { return target.texture; },
    get minimapTexture() { return minimapTexture; },
    get snapshot() { return lastSnapshot; },
    resize,
    update,
    render,
    renderToTexture,
    setVisible(value) {
      visible = Boolean(value);
      root.visible = visible;
    },
    dispose() {
      target.dispose();
      atlas.texture.dispose();
      backdropTexture.dispose();
      tintablePanelTexture.dispose();
      minimapTexture.dispose();
      const geometries = new Set([unitPlane, starGeometry, circleGeometry, diamondGeometry, arrowGeometry]);
      const materials = new Set([
        starActiveMaterial, starInactiveMaterial,
        primaryRoadMaterial, secondaryRoadMaterial,
        routeMaterial,
        carMaterial, policeMaterial, civilianMaterial,
        missionBlipMaterial, lifeActivityMaterial, playerBlipMaterial,
      ]);
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (Array.isArray(object.material)) object.material.forEach(material => materials.add(material));
        else if (object.material) materials.add(object.material);
      });
      for (const geometry of geometries) geometry.dispose?.();
      for (const material of materials) material.dispose?.();
      root.clear();
    },
  };
}
