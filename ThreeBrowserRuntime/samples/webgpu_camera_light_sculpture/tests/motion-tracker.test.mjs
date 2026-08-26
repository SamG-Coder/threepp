import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  GESTURE_CLOSED,
  GESTURE_NONE,
  GESTURE_OPEN,
  GESTURE_POINT,
  GESTURE_SWIPE,
  MOTION_TRACKER_LABEL,
  adaptBackgroundModel,
  buildSkinMotionLayer,
  computeCoverCrop,
  computeDownsampleSize,
  createMotionTracker,
  detectMotionComponents,
  diffuseSkinLikelihood,
  downsampleRgba,
  extractConnectedComponents,
  mapFramePointToDisplay,
  mirrorNormalizedPoint,
  skinLikelihood,
} from "../src/motion-tracker.mjs";

function frame(width, height, colour = [24, 28, 35, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; ++index) {
    data.set(colour, index * 4);
  }
  return data;
}

function paintRect(data, width, x, y, rectWidth, rectHeight, colour = [210, 150, 115, 255]) {
  const height = data.length / 4 / width;
  for (let row = Math.max(0, y); row < Math.min(height, y + rectHeight); ++row) {
    for (let column = Math.max(0, x); column < Math.min(width, x + rectWidth); ++column) {
      data.set(colour, (row * width + column) * 4);
    }
  }
  return data;
}

function paintCross(data, width, centerX, centerY, arm, thickness, colour = [210, 150, 115, 255]) {
  paintRect(data, width, centerX - Math.floor(thickness / 2), centerY - arm, thickness, arm * 2 + 1, colour);
  paintRect(data, width, centerX - arm, centerY - Math.floor(thickness / 2), arm * 2 + 1, thickness, colour);
  return data;
}

function paintPointingHand(
  data,
  width,
  palmX,
  palmY,
  fingerLength = 16,
  colour = [210, 150, 115, 255],
) {
  paintRect(data, width, palmX, palmY, 10, 9, colour);
  paintRect(data, width, palmX + 4, palmY - fingerLength, 2, fingerLength + 1, colour);
  return data;
}

function approx(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test("box downsampling is deterministic and preserves aspect inside its budget", () => {
  const source = new Uint8ClampedArray([
    10, 20, 30, 255, 30, 40, 50, 255, 100, 110, 120, 255, 120, 130, 140, 255,
    50, 60, 70, 255, 70, 80, 90, 255, 140, 150, 160, 255, 160, 170, 180, 255,
    20, 30, 40, 255, 40, 50, 60, 255, 110, 120, 130, 255, 130, 140, 150, 255,
    60, 70, 80, 255, 80, 90, 100, 255, 150, 160, 170, 255, 170, 180, 190, 255,
  ]);
  const result = downsampleRgba(source, 4, 4, { targetWidth: 2, targetHeight: 2 });
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.deepEqual([...result.data], [
    40, 50, 60, 255, 130, 140, 150, 255,
    50, 60, 70, 255, 140, 150, 160, 255,
  ]);
  assert.deepEqual(computeDownsampleSize(1920, 1080, 96, 72), { width: 96, height: 54 });
  assert.deepEqual(computeDownsampleSize(480, 640, 96, 72), { width: 54, height: 72 });
});

test("skin diffusion strengthens plausible weak pixels but preserves non-skin barriers", () => {
  const width = 7;
  const height = 3;
  const pixels = width * height;
  const skin = new Float32Array(pixels);
  const motion = new Float32Array(pixels);
  const background = new Float32Array(pixels);
  const at = x => width + x;
  skin[at(1)] = 0.82;
  skin[at(2)] = 0.12;
  skin[at(3)] = 0.31;
  skin[at(4)] = 0; // hard non-skin barrier
  skin[at(5)] = 0.78; // plausible, but disconnected and seedless
  motion[at(1)] = 0.9;
  motion[at(2)] = 0.04;
  background[at(3)] = 0.03;
  motion[at(4)] = 1;
  motion[at(5)] = 0.04;

  const rawCopy = new Float32Array(skin);
  const diffused = diffuseSkinLikelihood(skin, width, height);
  assert.ok(diffused[at(2)] > skin[at(2)], "neighbouring skin evidence lifts the weak interior");
  assert.equal(diffused[at(4)], 0, "diffusion never writes through raw non-skin");
  assert.deepEqual(skin, rawCopy, "the pure diffusion helper does not mutate its input");

  const layer = buildSkinMotionLayer(skin, motion, width, height, {
    backgroundScores: background,
    skinGrowthSteps: 2,
  });
  assert.equal(layer.seedPixels, 1);
  assert.equal(layer.seedMask[at(1)], 1);
  assert.equal(layer.grownMask[at(2)], 1, "lower motion evidence grows from the strong seed");
  assert.equal(layer.grownMask[at(3)], 1, "lower background-change evidence can complete the hand");
  assert.equal(layer.grownMask[at(4)], 0, "the non-skin barrier remains excluded");
  assert.equal(layer.skinMask[at(5)], 1, "the disconnected region is still plausible skin");
  assert.equal(layer.grownMask[at(5)], 0, "plausible skin without a connected seed is not a hand");
  assert.equal(layer.grownPixels, 3);
  assert.ok(layer.skinCoverage > layer.grownCoverage);
  assert.ok(layer.grownCoverage > layer.seedCoverage);
});

test("skin growth is local by default and cannot flood a long skin-coloured path", () => {
  const width = 8;
  const skin = new Float32Array(width).fill(0.8);
  const motion = new Float32Array(width).fill(0.04);
  motion[0] = 0.9;

  const layer = buildSkinMotionLayer(skin, motion, width, 1);
  assert.equal(layer.seedMask[0], 1);
  assert.equal(layer.grownMask[1], 1, "the immediate weak skin neighbour completes the silhouette");
  assert.equal(layer.grownMask[2], 0, "default growth stops after one pixel");
  assert.equal(layer.grownPixels, 2);
});

test("background adaptation protects seeds but clears diffusion-grown support normally", () => {
  const background = new Float32Array(6);
  const sampled = new Uint8ClampedArray([
    100, 120, 140, 255,
    100, 120, 140, 255,
  ]);
  const seedMask = new Uint8Array([1, 0]);

  adaptBackgroundModel(background, sampled, seedMask, 0.5, 0.1);
  assert.deepEqual([...background], [
    10, 12, 14,
    50, 60, 70,
  ]);
});

test("skin first-layer remains bounded and deterministic at 128x96", () => {
  const width = 128;
  const height = 96;
  const pixels = width * height;
  const skin = new Float32Array(pixels);
  const motion = new Float32Array(pixels);
  for (let y = 28; y < 68; ++y) {
    for (let x = 45; x < 82; ++x) {
      const index = y * width + x;
      skin[index] = (x + y) % 5 === 0 ? 0.16 : 0.74;
      motion[index] = (x + y) % 7 === 0 ? 0.09 : 0.035;
    }
  }
  const first = buildSkinMotionLayer(skin, motion, width, height);
  const second = buildSkinMotionLayer(skin, motion, width, height);
  assert.equal(first.grownMask.length, pixels);
  assert.equal(first.seedMask.length, pixels);
  assert.equal(first.diffusedSkinScores.length, pixels);
  assert.deepEqual(first.grownMask, second.grownMask);
  assert.deepEqual(first.diffusedSkinScores, second.diffusedSkinScores);
  assert.ok(first.seedPixels > 0);
  assert.ok(first.grownPixels > first.seedPixels);
});

test("cover-crop mapping matches a mirrored 16:9 camera surface", () => {
  const crop = computeCoverCrop(640, 480, 16 / 9);
  approx(crop.x, 0);
  approx(crop.y, 60);
  approx(crop.width, 640);
  approx(crop.height, 360);

  const center = mapFramePointToDisplay(
    { x: 320, y: 240 },
    { width: 640, height: 480 },
    { targetAspect: 16 / 9 },
  );
  approx(center.x, 0.5);
  approx(center.y, 0.5);
  assert.equal(center.visible, true);

  const croppedTop = mapFramePointToDisplay(
    { x: 64, y: 24 },
    { width: 640, height: 480 },
    { targetAspect: 16 / 9 },
  );
  approx(croppedTop.u, 0.9);
  assert.ok(croppedTop.v < 0);
  assert.equal(croppedTop.visible, false);

  const pixels = mapFramePointToDisplay(
    { x: 160, y: 150 },
    { width: 640, height: 480 },
    { crop: { x: 0, y: 60, width: 640, height: 360 }, displayWidth: 1280, displayHeight: 720 },
  );
  approx(pixels.x, 960);
  approx(pixels.y, 180);
  assert.deepEqual(mirrorNormalizedPoint({ x: 0.2, y: 0.7 }), { x: 0.8, y: 0.7 });
  assert.deepEqual(mirrorNormalizedPoint([0.2, 0.7], false), { x: 0.2, y: 0.7 });
});

test("moving skin-coloured pixels form components while moving blue pixels do not", () => {
  const width = 40;
  const height = 24;
  const background = frame(width, height);
  const currentData = frame(width, height);
  paintRect(currentData, width, 5, 7, 7, 6, [205, 142, 105, 255]);
  paintRect(currentData, width, 28, 7, 7, 6, [60, 105, 230, 255]);

  assert.ok(skinLikelihood(205, 142, 105) > 0.55);
  assert.ok(skinLikelihood(60, 105, 230) < 0.1);
  const detected = detectMotionComponents(
    { data: currentData, width, height },
    { data: background, width, height },
    { data: background, width, height },
  );
  assert.equal(detected.components.length, 1);
  assert.equal(detected.components[0].area, 42);
  assert.ok(detected.components[0].x < width / 2);
  assert.ok(detected.components[0].confidence > 0.5);
  assert.equal(detected.mask[9 * width + 7], 1);
  assert.equal(detected.mask[9 * width + 30], 0);
  assert.equal(detected.mask, detected.grownMask);
  assert.equal(detected.skinLayer.seedMask, detected.seedMask);
  assert.equal(detected.diffusedSkinScores.length, width * height);
  assert.equal(detected.coverage, detected.activePixels / (width * height));
  assert.ok(detected.skinCoverage >= detected.coverage);
});

test("detector grows fragmented plausible skin into one complete silhouette", () => {
  const width = 30;
  const height = 20;
  const background = frame(width, height);
  const current = frame(width, height);
  const weakSkin = [120, 30, 60, 255];
  assert.ok(skinLikelihood(...weakSkin) > 0.1 && skinLikelihood(...weakSkin) < 0.15);
  for (let y = 7; y < 13; ++y) {
    for (let x = 5; x < 17; ++x) {
      current.set(x % 2 ? [205, 142, 105, 255] : weakSkin, (y * width + x) * 4);
    }
  }
  const detected = detectMotionComponents(
    { data: current, width, height },
    { data: background, width, height },
    { data: background, width, height },
  );
  assert.equal(detected.seedPixels, 36, "only strong alternating columns seed the region");
  assert.equal(detected.activePixels, 72, "skin-constrained growth restores the weak columns");
  assert.equal(detected.components.length, 1);
  assert.equal(detected.components[0].area, 72);
  assert.ok(detected.diffusedSkinScores[9 * width + 6] > skinLikelihood(...weakSkin));
  assert.ok(detected.coverage > detected.seedCoverage);
});

test("component shape proxy reports an articulated open shape above a compact fist", () => {
  const width = 36;
  const height = 20;
  const mask = new Uint8Array(width * height);
  for (let y = 5; y < 12; ++y) {
    for (let x = 3; x < 10; ++x) mask[y * width + x] = 1;
  }
  for (let y = 3; y <= 13; ++y) mask[y * width + 25] = 1;
  for (let x = 20; x <= 30; ++x) mask[8 * width + x] = 1;

  const components = extractConnectedComponents(mask, width, height, { minComponentPixels: 2 });
  assert.equal(components.length, 2);
  const compact = components.find(component => component.x < width / 2);
  const articulated = components.find(component => component.x > width / 2);
  assert.ok(compact.openness < 0.12, `compact openness was ${compact.openness}`);
  assert.ok(articulated.openness > 0.45, `articulated openness was ${articulated.openness}`);
});

test("component boundary extremities select the narrow prominent finger end", () => {
  const width = 64;
  const height = 48;
  const mask = new Uint8Array(width * height);
  for (let y = 28; y < 37; ++y) {
    for (let x = 25; x < 35; ++x) mask[y * width + x] = 1;
  }
  for (let y = 12; y <= 28; ++y) {
    for (let x = 29; x < 31; ++x) mask[y * width + x] = 1;
  }

  const component = extractConnectedComponents(mask, width, height, { minComponentPixels: 2 })[0];
  assert.equal(component.extremities.length, 2);
  assert.ok(component.elongation > 2.4);
  assert.ok(component.pointing > 0.7);
  assert.ok(component.tip.y < 13, `tip y was ${component.tip.y}`);
  const selected = component.extremities[component.tipIndex];
  const opposite = component.extremities[1 - component.tipIndex];
  assert.ok(selected.width < opposite.width * 0.35);
  assert.ok(selected.prominence > opposite.prominence);
  assert.ok(component.tipConfidence > 0.75);
});

test("tracker keeps two stable slots, mirrored positions, confidence, and velocity", () => {
  const width = 64;
  const height = 40;
  const tracker = createMotionTracker({
    sampleWidth: width,
    sampleHeight: height,
    targetAspect: 16 / 9,
    maxMissingFrames: 3,
  });
  const initial = tracker.update(frame(width, height), width, height, 0);
  assert.equal(initial.label, MOTION_TRACKER_LABEL);
  assert.equal(initial.kind, "local-heuristic-motion");
  assert.equal(initial.hands.length, 0, "the first frame establishes a local background");

  const firstHands = frame(width, height);
  paintRect(firstHands, width, 8, 10, 6, 7);
  paintRect(firstHands, width, 47, 18, 7, 7, [175, 112, 82, 255]);
  const first = tracker.update(firstHands, width, height, 100);
  assert.equal(first.hands.length, 2);
  assert.equal(first.slots[0].active, true);
  assert.equal(first.slots[1].active, true);
  assert.ok(first.slots[0].normalized.x < first.slots[1].normalized.x, "initial slot order is source left-to-right");
  assert.ok(first.slots[0].x > first.slots[1].x, "display positions are mirrored");
  assert.ok(first.slots.every(slot => slot.confidence > 0.45));
  assert.ok(first.slots.every(slot => slot.visible));
  assert.ok(first.slots.every(slot => slot.tip.visible && slot.finger.visible), "both stable slots expose tips");

  const moved = frame(width, height);
  paintRect(moved, width, 14, 10, 6, 7);
  paintRect(moved, width, 51, 18, 7, 7, [175, 112, 82, 255]);
  const second = tracker.update(moved, width, height, 200);
  assert.equal(second.slots[0].id, 0);
  assert.equal(second.slots[1].id, 1);
  assert.ok(second.slots[0].sourceVelocity.x > 0);
  assert.ok(second.slots[1].sourceVelocity.x > 0);
  assert.ok(second.slots[0].velocity.x < 0, "mirroring reverses display-space horizontal velocity");
  assert.ok(second.slots[0].age > first.slots[0].age);

  const oneHand = frame(width, height);
  paintRect(oneHand, width, 53, 18, 7, 7, [175, 112, 82, 255]);
  const occluded = tracker.update(oneHand, width, height, 300);
  assert.equal(occluded.slots[0].active, true, "a missing proxy coasts in its stable slot");
  assert.equal(occluded.slots[0].visible, false);
  assert.equal(occluded.slots[0].missingFrames, 1);
  assert.ok(occluded.slots[0].confidence < second.slots[0].confidence);
  assert.equal(occluded.slots[1].id, 1);
  assert.equal(occluded.slots[1].visible, true);
});

test("velocity prediction preserves identity when two proxies cross", () => {
  const width = 64;
  const height = 32;
  const tracker = createMotionTracker({ sampleWidth: width, sampleHeight: height, positionSharpness: 80 });
  tracker.update(frame(width, height), width, height, 0);

  const at = (leftX, rightX) => {
    const image = frame(width, height);
    paintRect(image, width, leftX, 12, 4, 5, [215, 155, 118, 255]);
    paintRect(image, width, rightX, 12, 4, 5, [170, 108, 78, 255]);
    return image;
  };
  tracker.update(at(8, 50), width, height, 100);
  tracker.update(at(20, 38), width, height, 200);
  const crossed = tracker.update(at(34, 22), width, height, 300);

  assert.equal(crossed.slots[0].id, 0);
  assert.equal(crossed.slots[1].id, 1);
  assert.ok(
    crossed.slots[0].normalized.x > crossed.slots[1].normalized.x,
    "slot zero follows the proxy moving right instead of being re-sorted by x",
  );
  assert.ok(crossed.slots[0].sourceVelocity.x > 0);
  assert.ok(crossed.slots[1].sourceVelocity.x < 0);
});

test("openness is temporally smoothed on a tracked slot", () => {
  const width = 48;
  const height = 36;
  const tracker = createMotionTracker({ sampleWidth: width, sampleHeight: height, opennessBlend: 0.5 });
  tracker.update(frame(width, height), width, height, 0);
  const fist = frame(width, height);
  paintRect(fist, width, 19, 14, 8, 8);
  const compact = tracker.update(fist, width, height, 100).slots[0];

  const open = frame(width, height);
  paintCross(open, width, 23, 18, 8, 2);
  const articulated = tracker.update(open, width, height, 200).slots[0];
  assert.ok(articulated.openness > compact.openness);
  assert.ok(articulated.openness < 0.9, "one frame does not snap the smoothed proxy fully open");
});

test("closed and open gestures use confirmation and openness hysteresis", () => {
  const width = 48;
  const height = 36;
  const tracker = createMotionTracker({
    sampleWidth: width,
    sampleHeight: height,
    opennessBlend: 1,
    gestureConfirmFrames: 2,
    swipeEnterSpeed: 10,
    swipeExitSpeed: 5,
  });
  tracker.update(frame(width, height), width, height, 0);

  const fist = frame(width, height);
  paintRect(fist, width, 19, 14, 8, 8);
  const fistCandidate = tracker.update(fist, width, height, 100).slots[0];
  assert.equal(fistCandidate.gesture, GESTURE_NONE, "one compact observation is not enough to commit");
  const closed = tracker.update(fist, width, height, 200).slots[0];
  assert.equal(closed.gesture, GESTURE_CLOSED);
  assert.equal(closed.poseGesture, GESTURE_CLOSED);
  assert.equal(closed.gestureAge, 1);
  assert.equal(closed.gestureChanged, true);
  assert.ok(closed.gestureStrength > 0.45);

  const closedAgain = tracker.update(fist, width, height, 300).slots[0];
  assert.equal(closedAgain.gesture, GESTURE_CLOSED);
  assert.equal(closedAgain.gestureAge, 2);
  assert.equal(closedAgain.gestureChanged, false);

  const openHand = frame(width, height);
  paintCross(openHand, width, 23, 18, 8, 2);
  const openCandidate = tracker.update(openHand, width, height, 400).slots[0];
  assert.equal(openCandidate.gesture, GESTURE_CLOSED, "open also requires two confirming observations");
  const open = tracker.update(openHand, width, height, 500).slots[0];
  assert.equal(open.gesture, GESTURE_OPEN);
  assert.equal(open.poseGesture, GESTURE_OPEN);
  assert.equal(open.gestureAge, 1);
  assert.ok(open.gestureStrength > 0.2);

  // This thicker cross has openness between openExitOpenness and
  // openEnterOpenness: it cannot enter open from neutral, but it must keep an
  // already-open state without chatter.
  const ambiguousOpen = frame(width, height);
  paintCross(ambiguousOpen, width, 23, 18, 5, 4);
  const held = tracker.update(ambiguousOpen, width, height, 600).slots[0];
  assert.ok(held.openness > 0.42 && held.openness < 0.58, `ambiguous openness was ${held.openness}`);
  assert.equal(held.gesture, GESTURE_OPEN);
  assert.equal(held.gestureChanged, false);
});

test("point gesture follows a stabilized mirrored fingertip and open palm releases it", () => {
  const width = 64;
  const height = 48;
  const tracker = createMotionTracker({
    sampleWidth: width,
    sampleHeight: height,
    targetAspect: 16 / 9,
    opennessBlend: 1,
    pointingBlend: 1,
    tipPositionSharpness: 80,
    tipVelocityBlend: 1,
    gestureConfirmFrames: 2,
    swipeEnterSpeed: 10,
    swipeExitSpeed: 5,
  });
  tracker.update(frame(width, height), width, height, 0);

  const pointingAt = (palmX, fingerLength = 16) => {
    const image = frame(width, height);
    paintPointingHand(image, width, palmX, 28, fingerLength);
    return image;
  };
  const candidate = tracker.update(pointingAt(24), width, height, 100).slots[0];
  assert.equal(candidate.gesture, GESTURE_NONE, "point requires a confirming silhouette");
  assert.ok(candidate.pointing > 0.7);
  assert.equal(candidate.tip.visible, true);
  assert.ok(candidate.tip.normalized.y < candidate.normalized.y);
  assert.ok(candidate.tip.confidence > 0.55);

  const point = tracker.update(pointingAt(24), width, height, 200).slots[0];
  assert.equal(point.gesture, GESTURE_POINT);
  assert.equal(point.poseGesture, GESTURE_POINT);
  assert.ok(point.gestureStrength > 0.45);
  assert.equal(point.gestureAge, 1);
  assert.equal(point.gestureChanged, true);
  assert.deepEqual(point.finger, point.tip, "finger is a stable public alias for the tip proxy");

  const moved = tracker.update(pointingAt(28), width, height, 300).slots[0];
  assert.equal(moved.gesture, GESTURE_POINT);
  assert.ok(moved.tip.normalized.x > point.tip.normalized.x, "source fingertip follows the hand right");
  assert.ok(moved.tip.x < point.tip.x, "mirrored display fingertip follows left");
  assert.ok(moved.tip.sourceVelocity.x > 0);
  assert.ok(moved.tip.velocity.x < 0);
  assert.equal(moved.tipVelocity.x, moved.tip.velocity.x);
  assert.equal(moved.fingerVelocity.y, moved.tip.velocity.y);

  const shorter = tracker.update(pointingAt(28, 12), width, height, 400).slots[0];
  assert.ok(shorter.pointing > 0.44 && shorter.pointing < 0.62, `point evidence was ${shorter.pointing}`);
  assert.equal(shorter.gesture, GESTURE_POINT, "point exit threshold retains a less elongated finger");
  assert.equal(shorter.gestureChanged, false);

  const openPalm = () => {
    const image = frame(width, height);
    paintCross(image, width, 33, 27, 9, 2);
    return image;
  };
  const releaseCandidate = tracker.update(openPalm(), width, height, 500).slots[0];
  assert.equal(releaseCandidate.gesture, GESTURE_POINT, "open release also requires confirmation");
  const released = tracker.update(openPalm(), width, height, 600).slots[0];
  assert.equal(released.gesture, GESTURE_OPEN);
  assert.equal(released.poseGesture, GESTURE_OPEN);
  assert.ok(released.pointing < 0.2);
});

test("tip continuity rejects a one-frame silhouette endpoint flip", () => {
  const width = 64;
  const height = 48;
  const tracker = createMotionTracker({
    sampleWidth: width,
    sampleHeight: height,
    tipPositionSharpness: 80,
    swipeEnterSpeed: 10,
    swipeExitSpeed: 5,
  });
  tracker.update(frame(width, height), width, height, 0);

  const stem = frame(width, height);
  paintRect(stem, width, 30, 12, 4, 24);
  const first = tracker.update(stem, width, height, 100).slots[0];
  assert.ok(first.tip.normalized.y < 0.3, "deterministic tie starts at the upper extremity");

  const noisy = frame(width, height);
  paintRect(noisy, width, 30, 12, 4, 24);
  paintRect(noisy, width, 27, 12, 10, 3);
  const noisyMask = new Uint8Array(width * height);
  for (let y = 12; y < 36; ++y) {
    for (let x = 30; x < 34; ++x) noisyMask[y * width + x] = 1;
  }
  for (let y = 12; y < 15; ++y) {
    for (let x = 27; x < 37; ++x) noisyMask[y * width + x] = 1;
  }
  const rawComponent = extractConnectedComponents(noisyMask, width, height, { minComponentPixels: 2 })[0];
  assert.ok(rawComponent.tip.y > 30, "the noisy single-frame taper preference flips to the lower end");

  const stabilized = tracker.update(noisy, width, height, 200).slots[0];
  assert.ok(stabilized.tip.normalized.y < 0.3, "slot history keeps following the same physical tip");
  assert.ok(Math.abs(stabilized.tip.normalized.y - first.tip.normalized.y) < 0.02);
});

test("swipe requires sustained speed, locks mirror-correct direction, and releases hysteretically", () => {
  const width = 64;
  const height = 32;
  const tracker = createMotionTracker({
    sampleWidth: width,
    sampleHeight: height,
    opennessBlend: 1,
    velocityBlend: 1,
    gestureConfirmFrames: 1,
    swipeConfirmFrames: 2,
    swipeReleaseFrames: 2,
    swipeEnterSpeed: 0.5,
    swipeExitSpeed: 0.2,
    mirrorX: true,
  });
  tracker.update(frame(width, height), width, height, 0);
  const handAt = x => paintRect(frame(width, height), width, x, 12, 6, 7);

  const resting = tracker.update(handAt(7), width, height, 100).slots[0];
  assert.equal(resting.gesture, GESTURE_CLOSED);
  const fastOnce = tracker.update(handAt(13), width, height, 200).slots[0];
  assert.equal(fastOnce.gesture, GESTURE_CLOSED, "a one-frame velocity spike is rejected");

  const swipe = tracker.update(handAt(19), width, height, 300).slots[0];
  assert.equal(swipe.gesture, GESTURE_SWIPE);
  assert.equal(swipe.poseGesture, GESTURE_CLOSED, "pose remains available under the transient swipe");
  assert.equal(swipe.gestureAge, 1);
  assert.equal(swipe.gestureChanged, true);
  assert.equal(swipe.gestureDirection, "left", "source-right motion is display-left after mirroring");
  assert.ok(swipe.gestureVector.x < -0.99);
  assert.ok(swipe.gestureSourceVector.x > 0.99);
  assert.ok(swipe.gestureStrength > 0.45);

  const releaseCandidate = tracker.update(handAt(19), width, height, 400).slots[0];
  assert.equal(releaseCandidate.gesture, GESTURE_SWIPE, "one slow frame retains swipe");
  assert.equal(releaseCandidate.gestureAge, 2);
  const released = tracker.update(handAt(19), width, height, 500).slots[0];
  assert.equal(released.gesture, GESTURE_CLOSED);
  assert.equal(released.gestureDirection, GESTURE_NONE);
  assert.equal(released.gestureAge, 1);
  assert.equal(released.gestureChanged, true);
});

test("gesture options reject inverted hysteresis thresholds", () => {
  assert.throws(
    () => createMotionTracker({ closedEnterOpenness: 0.5, closedExitOpenness: 0.4 }),
    /closedEnterOpenness/,
  );
  assert.throws(
    () => createMotionTracker({ swipeEnterSpeed: 0.2, swipeExitSpeed: 0.3 }),
    /swipeExitSpeed/,
  );
  assert.throws(
    () => createMotionTracker({ gestureConfidenceEnter: 0.3, gestureConfidenceExit: 0.4 }),
    /gestureConfidenceExit/,
  );
  assert.throws(
    () => createMotionTracker({ pointEnterEvidence: 0.5, pointExitEvidence: 0.6 }),
    /pointExitEvidence/,
  );
});

test("tracker accepts ImageData-shaped input, validates buffers, and resets deterministically", () => {
  const tracker = createMotionTracker({ sampleWidth: 16, sampleHeight: 12 });
  const input = { data: frame(16, 12), width: 16, height: 12, timestampMs: 17 };
  const result = tracker.update(input);
  assert.equal(result.timestamp, 17);
  assert.equal(result.sampleWidth, 16);
  tracker.reset();
  assert.equal(tracker.frameIndex, 0);
  assert.throws(() => tracker.update(new Uint8Array(4), 16, 12, 0), /required/);
  assert.throws(() => downsampleRgba([], 2, 2), /typed array/);
});

test("production tracker is dependency-free and performs no network or learned inference", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("../src/motion-tracker.mjs", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(source, /mediapipe|tensorflow|onnx|model[-_ ]?url/i);
  assert.match(source, /NON-NEURAL/);
  assert.match(source, /detectMotionComponents/);
});
