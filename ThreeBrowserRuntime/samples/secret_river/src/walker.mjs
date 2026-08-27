import * as THREE from "three/webgpu";
import {
  float,
  length,
  smoothstep,
  uv,
  vec2,
} from "three/tsl";
import { keyedCanvasFromImage } from "./chroma-key.mjs";
import { gaitFrameFromDistance, integrateDampedAxis } from "./motion.mjs";
import { clampToBank, spawnOnRoad, terrainHeight } from "./path.mjs";

const WALKER_HEIGHT = 1.78;
const WALK_SPEED = 2.3;
const SPRINT_SPEED = 3.8;
const WALK_FRAME_FIRST = 8;
const WALK_FRAME_LAST = 30;
const WALK_METRES_PER_CYCLE = 1.42;
const ACCELERATION_RESPONSE = 13.5;
const DECELERATION_RESPONSE = 16.5;
const ATLAS_COLUMNS = 6;
const ATLAS_GUTTER = 4;

function makeCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  throw new Error("Walker cutouts need a 2D canvas.");
}

async function loadImage(url) {
  const href = url.href || String(url);
  if (typeof fetch === "function" && typeof createImageBitmap === "function") {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Failed to load walker (${response.status})`);
    return createImageBitmap(await response.blob());
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load walker"));
    image.src = href;
  });
}

async function loadRegisteredKey(url) {
  const image = await loadImage(url);
  try {
    // The authored walk frames already share one camera and registration.
    // Preserve that frame instead of recropping every moving silhouette.
    return keyedCanvasFromImage(image, {
      crop: false,
      padding: 0,
      erode: 1,
      feather: 1,
    });
  } finally {
    if (typeof image.close === "function") image.close();
  }
}

async function tryLoadRegisteredKey(url) {
  try {
    return await loadRegisteredKey(url);
  } catch {
    return null;
  }
}

function createAtlas(idle, walkFrames) {
  const frameWidth = Math.max(1, ...walkFrames.map(frame => frame.width));
  const frameHeight = Math.max(1, ...walkFrames.map(frame => frame.height));
  const frames = [idle, ...walkFrames];
  const rows = Math.ceil(frames.length / ATLAS_COLUMNS);
  const cellWidth = frameWidth + ATLAS_GUTTER * 2;
  const cellHeight = frameHeight + ATLAS_GUTTER * 2;
  const atlas = makeCanvas(cellWidth * ATLAS_COLUMNS, cellHeight * rows);
  const context = atlas.getContext("2d");

  frames.forEach((frame, index) => {
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    const scale = Math.min(frameWidth / frame.width, frameHeight / frame.height);
    const width = frame.width * scale;
    const height = frame.height * scale;
    const x = column * cellWidth + ATLAS_GUTTER + (frameWidth - width) * 0.5;
    const y = row * cellHeight + ATLAS_GUTTER + frameHeight - height;
    context.drawImage(frame.canvas, x, y, width, height);
  });

  return {
    canvas: atlas,
    frameWidth,
    frameHeight,
    frameCount: frames.length,
    walkFrameCount: walkFrames.length,
    cellWidth,
    cellHeight,
  };
}

function selectAtlasFrame(texture, atlas, index) {
  const frame = Math.max(0, Math.min(atlas.frameCount - 1, Math.trunc(index)));
  const column = frame % ATLAS_COLUMNS;
  const row = Math.floor(frame / ATLAS_COLUMNS);
  texture.repeat.set(
    atlas.frameWidth / atlas.canvas.width,
    atlas.frameHeight / atlas.canvas.height,
  );
  texture.offset.set(
    (column * atlas.cellWidth + ATLAS_GUTTER) / atlas.canvas.width,
    1 - (row * atlas.cellHeight + ATLAS_GUTTER + atlas.frameHeight) / atlas.canvas.height,
  );
  texture.updateMatrix();
}

function createContactShadow() {
  const geometry = new THREE.PlaneGeometry(0.82, 0.32);
  geometry.rotateX(-Math.PI * 0.5);
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Walker painted contact shadow",
    color: 0x241b12,
    transparent: true,
    depthWrite: false,
    fog: true,
    toneMapped: true,
  });
  const centered = uv().sub(vec2(0.5, 0.5));
  const radius = length(vec2(centered.x, centered.y.mul(2.35)));
  material.opacityNode = float(1).sub(smoothstep(0.12, 0.5, radius)).mul(0.18);
  material.userData.rtxIgnore = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "Walker contact shadow";
  mesh.position.y = 0.025;
  mesh.renderOrder = 1;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.userData.rtxIgnore = true;
  return { mesh, geometry, material };
}

export async function createWalker() {
  const idleKeyed = await loadRegisteredKey(new URL("../assets/walker/profile.jpg", import.meta.url));
  const walkKeyed = (await Promise.all(
    Array.from({ length: WALK_FRAME_LAST - WALK_FRAME_FIRST + 1 }, (_, offset) => {
      const index = WALK_FRAME_FIRST + offset;
      const file = `walk_${String(index).padStart(2, "0")}.png`;
      return tryLoadRegisteredKey(new URL(`../assets/walker/walk/${file}`, import.meta.url));
    }),
  )).filter(Boolean);
  if (walkKeyed.length < 2) throw new Error("The registered walker cycle is incomplete.");

  const atlas = createAtlas(idleKeyed, walkKeyed);
  const texture = new THREE.CanvasTexture(atlas.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  texture.name = "Walker fixed-registration atlas";
  selectAtlasFrame(texture, atlas, 0);

  const width = WALKER_HEIGHT * (atlas.frameWidth / Math.max(1, atlas.frameHeight));
  const geometry = new THREE.PlaneGeometry(width, WALKER_HEIGHT);
  geometry.name = "Walker card";
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Walker atlas sprite",
    map: texture,
    transparent: true,
    alphaTest: 0.18,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  material.userData.rtxIgnore = true;

  const card = new THREE.Mesh(geometry, material);
  card.name = "Walker painted card";
  card.userData.rtxIgnore = true;
  card.castShadow = true;
  card.receiveShadow = false;
  card.rotation.y = Math.PI;
  card.position.y = WALKER_HEIGHT * 0.5;

  const contact = createContactShadow();
  const root = new THREE.Group();
  root.name = "Walker 2.5D rig";
  root.userData.rtxIgnore = true;
  root.add(contact.mesh, card);

  const spawn = spawnOnRoad(-4);
  const position = new THREE.Vector3(spawn.x, spawn.y, spawn.z);
  const velocity = new THREE.Vector3();
  let facing = 1;
  let moving = false;
  let gaitDistance = 0;
  let shownFrame = 0;

  function showFrame(frame) {
    if (shownFrame === frame) return;
    shownFrame = frame;
    selectAtlasFrame(texture, atlas, frame);
  }

  function place() {
    root.position.set(position.x, position.y, position.z);
    // rotation.y = PI maps local +X to world -X, so a +X run uses scale.x = -1.
    card.scale.set(facing, 1, 1);
  }
  place();

  return {
    mesh: root,
    card,
    position,
    velocity,
    get moving() { return moving; },
    update(delta, axis) {
      const speed = axis.sprint ? SPRINT_SPEED : WALK_SPEED;
      const targetX = -axis.x * speed;
      const targetZ = axis.z * speed;
      const hasInput = Math.hypot(axis.x, axis.z) > 0.01;
      const response = hasInput ? ACCELERATION_RESPONSE : DECELERATION_RESPONSE;
      const stepX = integrateDampedAxis(velocity.x, targetX, delta, response);
      const stepZ = integrateDampedAxis(velocity.z, targetZ, delta, response);
      velocity.set(stepX.velocity, 0, stepZ.velocity);

      const beforeX = position.x;
      const beforeZ = position.z;
      const clamped = clampToBank(position.x + stepX.distance, position.z + stepZ.distance);
      position.set(clamped.x, terrainHeight(clamped.x, clamped.z), clamped.z);
      if (Math.abs(clamped.x - (beforeX + stepX.distance)) > 1e-4) velocity.x = 0;
      if (Math.abs(clamped.z - (beforeZ + stepZ.distance)) > 1e-4) velocity.z = 0;

      const travelled = Math.hypot(position.x - beforeX, position.z - beforeZ);
      const motionSpeed = Math.hypot(velocity.x, velocity.z);
      moving = motionSpeed > 0.075 || hasInput;
      if (velocity.x < -0.08) facing = 1;
      else if (velocity.x > 0.08) facing = -1;

      if (moving && atlas.walkFrameCount > 0) {
        gaitDistance += travelled;
        showFrame(1 + gaitFrameFromDistance(
          gaitDistance,
          atlas.walkFrameCount,
          WALK_METRES_PER_CYCLE,
        ));
      } else {
        gaitDistance = 0;
        velocity.set(0, 0, 0);
        showFrame(0);
      }
      place();
      return { moving, facing, speed: motionSpeed, travelled };
    },
    setTint(color) {
      material.color.set(color);
    },
    dispose() {
      geometry.dispose();
      texture.dispose();
      material.dispose();
      contact.geometry.dispose();
      contact.material.dispose();
    },
  };
}
