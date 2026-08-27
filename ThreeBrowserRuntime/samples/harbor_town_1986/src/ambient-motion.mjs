import * as THREE from "three/webgpu";

/** Subtle 15:20 motion. Every visible actor is reconstructed from Grok-made 2D views. */

import { WATER_SURFACE_Y } from "./map.mjs";

const VAN_SPEED = 2.8;
const BOAT_BOB = 0.04;
const FISHING_BOAT_DRAFT = 0.55;
const FISHING_BOAT_KEEL_Y = WATER_SURFACE_Y - FISHING_BOAT_DRAFT;
const SIDEWALK_Z = 5.6;
const ROUTE16_X_MIN = -46.4;
const ROUTE16_X_MAX = -36.8;

// A compact Sakae-dori circuit uses the centre of each painted lane. End turns
// stay inside the open intersections and clear the curbside parked vehicles.
export const VAN_ROUTE = Object.freeze([
  { x: -38.0, z: 0.8 },
  { x: 42.0, z: 0.8 },
  { x: 44.0, z: 2.0 },
  { x: 42.0, z: 3.2 },
  { x: -38.0, z: 3.2 },
  { x: -40.0, z: 2.0 },
]);

const BOAT_POSES = Object.freeze([
  { x: -28, y: FISHING_BOAT_KEEL_Y, z: 98, yaw: 0.48, phase: 0.2 },
  { x: -10, y: FISHING_BOAT_KEEL_Y, z: 104, yaw: -0.38, phase: 1.5 },
  { x: 8, y: FISHING_BOAT_KEEL_Y, z: 98, yaw: 0.72, phase: 2.7 },
  { x: 27, y: FISHING_BOAT_KEEL_Y, z: 104, yaw: -0.58, phase: 4.1 },
]);

const GULL_POSES = Object.freeze([
  { cx: 8, cz: 118, r: 14, y: 18.2, speed: 0.22, phase: 0.4 },
  { cx: -12, cz: 124, r: 11, y: 16.4, speed: 0.18, phase: 2.1 },
  { cx: 28, cz: 121, r: 16, y: 20.1, speed: 0.15, phase: 4.0 },
]);

const SIGN_POSES = Object.freeze([
  { x: 22.55, y: 3.48, z: 15.15, yaw: Math.PI / 2, phase: 0.2, amp: 0.08, freq: 1.05 },
  { x: 22.15, y: 3.28, z: 17.90, yaw: Math.PI / 2, phase: 1.7, amp: 0.07, freq: 1.18 },
]);

function surfaceY(heightAt, x, z) {
  const y = typeof heightAt === "function" ? Number(heightAt(x, z)) : 0;
  return Number.isFinite(y) ? y : 0;
}

export function buildLoop(points) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len <= 1e-6) continue;
    segs.push({ a, b, len, start: total });
    total += len;
  }
  return { segs, total };
}

export function sampleLoop(loop, distance) {
  if (!loop?.segs?.length || !(loop.total > 0)) return { x: 0, z: 0, yaw: 0 };
  const d = ((distance % loop.total) + loop.total) % loop.total;
  for (const seg of loop.segs) {
    if (d <= seg.start + seg.len) {
      const t = (d - seg.start) / seg.len;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        z: seg.a.z + (seg.b.z - seg.a.z) * t,
        yaw: Math.atan2(seg.b.x - seg.a.x, seg.b.z - seg.a.z),
      };
    }
  }
  const last = loop.segs[loop.segs.length - 1];
  return { x: last.b.x, z: last.b.z, yaw: Math.atan2(last.b.x - last.a.x, last.b.z - last.a.z) };
}

export function isOnCarriageway(x, z) {
  const sakae = z >= -SIDEWALK_Z && z <= SIDEWALK_Z && x >= -47 && x <= 46;
  const route16 = x >= ROUTE16_X_MIN && x <= ROUTE16_X_MAX && z >= 5.5 && z <= 84;
  return sakae || route16;
}

function instantiate(factory, assetId, pose, label) {
  if (typeof factory !== "function") return null;
  const object = factory(assetId, pose, label);
  return object && typeof object === "object" ? object : null;
}

export function createAmbientMotion({ scene, groundHeight, createAssetInstance, assetSubjects }) {
  const loop = buildLoop(VAN_ROUTE);
  const start = sampleLoop(loop, 0);
  const van = instantiate(
    createAssetInstance,
    "kei-van",
    { x: start.x, z: start.z, yaw: 0 },
    "ambient kei-van (2D orbit)",
  );
  if (van) scene.add(van);

  const boats = [];
  for (const [index, pose] of BOAT_POSES.entries()) {
    const object = instantiate(
      createAssetInstance,
      "fishing-boat",
      pose,
      `ambient fishing boat ${index} (2D orbit)`,
    );
    if (!object) continue;
    scene.add(object);
    boats.push({ object, baseY: pose.y, phase: pose.phase });
  }

  const gulls = [];
  for (const [index, spec] of GULL_POSES.entries()) {
    const object = instantiate(
      createAssetInstance,
      "harbor-gull",
      { x: spec.cx + spec.r, y: spec.y, z: spec.cz, yaw: 0 },
      `ambient harbor gull ${index} (2D orbit)`,
    );
    if (!object) continue;
    scene.add(object);
    gulls.push({ object, spec });
  }

  const signs = [];
  const signHeight = Number(assetSubjects?.get("shop-hanging-sign")?.realHeight);
  for (const [index, spec] of SIGN_POSES.entries()) {
    const object = instantiate(
      createAssetInstance,
      "shop-hanging-sign",
      spec,
      `yokobori hanging sign ${index} (2D orbit)`,
    );
    if (!object) continue;
    if (!(signHeight > 0)) {
      console.warn("[Minamihama] hanging-sign height unavailable; sign motion omitted");
      continue;
    }
    const hinge = new THREE.Group();
    hinge.name = `${object.name} top hinge`;
    hinge.position.set(object.position.x, object.position.y + signHeight, object.position.z);
    object.position.set(0, -signHeight, 0);
    hinge.add(object);
    scene.add(hinge);
    signs.push({ object: hinge, ...spec });
  }

  let t = 0;
  let vanDistance = 0;

  function update(dt) {
    const step = Number(dt);
    if (!Number.isFinite(step) || step <= 0) return;
    t += step;

    if (van) {
      vanDistance += VAN_SPEED * step;
      const pose = sampleLoop(loop, vanDistance);
      van.position.set(pose.x, surfaceY(groundHeight, pose.x, pose.z) + 0.02, pose.z);
      van.rotation.y = pose.yaw;
      van.visible = isOnCarriageway(pose.x, pose.z);
    }

    for (const boat of boats) {
      boat.object.position.y = boat.baseY + BOAT_BOB * Math.sin(t * 0.85 + boat.phase);
    }

    for (const sign of signs) {
      sign.object.rotation.z = sign.amp * Math.sin(t * sign.freq + sign.phase);
    }

    for (const { object, spec } of gulls) {
      const angle = t * spec.speed + spec.phase;
      object.position.set(
        spec.cx + spec.r * Math.cos(angle),
        spec.y + 0.32 * Math.sin(angle * 2),
        spec.cz + spec.r * Math.sin(angle),
      );
      // The derivative of (cos(angle), sin(angle)) points at yaw -angle in
      // this +Z-forward coordinate system, so gulls follow the orbit tangent.
      object.rotation.y = -angle;
      object.rotation.z = 0.18 * Math.sin(angle * 2);
    }
  }

  update(0.001);
  return { update, counts: { van: van ? 1 : 0, boats: boats.length, gulls: gulls.length, signs: signs.length } };
}
