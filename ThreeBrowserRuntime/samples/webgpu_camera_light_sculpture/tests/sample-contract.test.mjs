import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const entry = fs.readFileSync(new URL("site-entry.mjs", root), "utf8");
const hud = fs.readFileSync(new URL("src/hud.mjs", root), "utf8");
const readme = fs.readFileSync(new URL("README.md", root), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("threebrowser.pull.json", root), "utf8"));

test("sample is a local WebGPU client that requests its gesture camera on startup", () => {
  assert.match(entry, /new THREE\.WebGPURenderer/);
  assert.match(entry, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(entry, /__threeBrowserExternalFrame/);
  assert.match(entry, /if \(key === "c"\)/);
  assert.match(entry, /get\("camera"\) !== "0"/);
  assert.match(entry, /camera permission granted; waiting for the first video frame/);
  assert.doesNotMatch(entry, /camera opened but produced no RGBA frame/);
  assert.match(entry, /NotAllowedError/);
  assert.match(entry, /ENABLE WINDOWS CAMERA PRIVACY/);
  assert.doesNotMatch(entry, /threeBrowserRTX|createDynamicTriangleMesh|evaluateRayLighting/);
});

test("camera, motion, particle and bloom layers remain separate sample modules", () => {
  assert.match(entry, /from "\.\/src\/camera-background\.mjs"/);
  assert.match(entry, /from "\.\/src\/motion-tracker\.mjs"/);
  assert.match(entry, /from "\.\/src\/person-matte\.mjs"/);
  assert.match(entry, /from "\.\/src\/particle-field\.mjs"/);
  assert.match(entry, /from "three\/addons\/tsl\/display\/BloomNode\.js"/);
  assert.match(entry, /new THREE\.RenderPipeline/);
  assert.match(entry, /renderPipeline\.render\(\)/);
  assert.match(entry, /renderer\.render\(scene, camera\)/);
});

test("camera colours are converted before a person-only matte is displayed", () => {
  const camera = fs.readFileSync(new URL("src/camera-background.mjs", root), "utf8");
  const matte = fs.readFileSync(new URL("src/person-matte.mjs", root), "utf8");
  assert.match(matte, /LOCAL YCBCR \+ SEEDED PERSON MATTE \/ NON-NEURAL/);
  assert.match(matte, /export function rgbToLumaChroma/);
  assert.match(matte, /export function buildPersonMatteLayer/);
  assert.match(entry, /createPersonMatte\(/);
  assert.match(entry, /downsampleRgba\(frame\.data/);
  assert.match(entry, /compositePersonMatteRgba\(/);
  assert.match(camera, /BT\.601-style luminance\/chroma conversion/);
  assert.match(entry, /PERSON MATTE \/ MOVE TO REVEAL/);
  assert.doesNotMatch(entry, /resampleCoverRgba\(\s*frame\.data/);
  assert.match(readme, /raw camera is never displayed/i);
});

test("tracking begins with a local skin-colour diffusion layer", () => {
  const tracker = fs.readFileSync(new URL("src/motion-tracker.mjs", root), "utf8");
  assert.match(tracker, /LOCAL SKIN-DIFFUSION \+ MOTION HAND PROXIES \/ NON-NEURAL/);
  assert.match(tracker, /export function diffuseSkinLikelihood/);
  assert.match(tracker, /export function growSkinMotionSeeds/);
  assert.match(tracker, /export function buildSkinMotionLayer/);
  assert.match(tracker, /skinLayer\.grownMask/);
  assert.match(readme, /first hand layer softly[\s\S]*?diffuses skin-colour likelihood[\s\S]*?real motion seeds grow/i);
  assert.match(manifest.compatibility.notes.join("\n"), /skin-colour diffusion plus motion-seeding/i);
});

test("mirroring, gesture-only control, reset and deterministic cleanup are wired", () => {
  assert.match(entry, /compositePersonMatteRgba\([\s\S]*?true,/);
  assert.match(entry, /createMotionTracker\(\{[\s\S]*?targetAspect:[\s\S]*?mirrorX: true/);
  assert.match(entry, /sampleWidth: 128/);
  assert.match(entry, /tipPositionSharpness: 36/);
  assert.match(entry, /texturePointToWorld\(coordinate, state\.planeSize\)/);
  assert.doesNotMatch(entry, /pointermove|pointerdown|pointerup|touchmove/);
  assert.match(entry, /trackedAttractors\(\)/);
  assert.match(entry, /mode === GESTURE_NONE\) continue/);
  assert.match(entry, /mode,/);
  assert.match(entry, /openness:/);
  assert.match(entry, /particleField\.reset\(\)/);
  assert.match(entry, /getTracks\?\.\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(entry, /particleField\.dispose\(\)/);
  assert.match(entry, /renderer\.dispose\(\)/);
});

test("camera races and bloom fallback release their client-owned resources", () => {
  assert.match(entry, /cameraGeneration/);
  assert.match(entry, /pendingStream/);
  assert.match(entry, /track\.readyState === "ended"/);
  assert.match(entry, /"uncapturederror"/);
  assert.match(entry, /get\("bloom"\) === "0"/);
  assert.match(entry, /bloomNode\?\.dispose\?\.\(\)/);
  assert.match(entry, /scenePassNode\?\.dispose\?\.\(\)/);
  assert.match(entry, /renderer\.setRenderTarget\(null\)/);
  assert.match(entry, /renderer\.setMRT\?\.\(null\)/);
});

test("camera-only follow, charge, release and throw modes remain legible", () => {
  assert.match(hud, /POINT = FOLLOW/);
  assert.match(hud, /CLOSED = CHARGE/);
  assert.match(hud, /OPEN = RELEASE/);
  assert.match(hud, /SWIPE = THROW/);
  assert.match(hud, /activeGestures\.has\(key\)/);
  assert.match(readme, /Point — FOLLOW:/i);
  assert.match(readme, /Closed — CHARGE:/i);
  assert.match(readme, /Open — RELEASE:/i);
  assert.match(readme, /Swipe — THROW:/i);
  assert.match(readme, /Mouse, touch, click and pointer movement do not control the sculpture/);
  assert.match(
    manifest.compatibility.notes.join("\n"),
    /priority POINT follows the fingertip and arms the sequence, CLOSED charges and compresses, OPEN releases a bright shockwave, and SWIPE throws ribbons/i,
  );
});

test("fingertip follow and charged open release are wired into the live field", () => {
  assert.match(entry, /GESTURE_POINT/);
  assert.match(entry, /slotCoordinate\(slot, useFingertip\)/);
  assert.match(entry, /slotVelocity\(slot, useFingertip\)/);
  assert.match(entry, /slot\?\.poseGesture === GESTURE_POINT/);
  assert.match(entry, /useFingertip && slot\?\.tip\?\.visible !== true/);
  assert.match(entry, /fingertipFollowers\.length \? fingertipFollowers : result/);
  assert.match(entry, /pointGestureSlots\.length \? pointGestureSlots : gestureCandidates/);
  assert.match(entry, /slot\?\.tip\?\.confidence/);
  assert.match(entry, /function updateGestureEffects\(delta\)/);
  assert.match(entry, /effect\.armed/);
  assert.match(entry, /rawMode === GESTURE_POINT/);
  assert.match(entry, /rawMode === GESTURE_CLOSED && effect\.armed > 0\.04/);
  assert.doesNotMatch(entry, /motionSpeed > 0\.14/);
  assert.match(entry, /effect\.charge = Math\.min\(1,/);
  assert.match(entry, /reportedPose === GESTURE_OPEN/);
  assert.match(entry, /effect\.release = Math\.max/);
  assert.match(entry, /pulse: mode === GESTURE_OPEN[\s\S]*?effect\.release/);
  assert.match(entry, /SHOCKWAVE/);
  assert.match(entry, /FINGERTIP ORBIT/);
});

test("manifest packages only the self-contained client sample", () => {
  assert.equal(manifest.requiresWebGPU, true);
  assert.equal(manifest.compatibility.canvasOnly, true);
  const paths = manifest.files.map(file => file.path);
  assert.deepEqual(paths, [
    "index.html",
    "site-entry.mjs",
    "src/camera-background.mjs",
    "src/hud.mjs",
    "src/motion-tracker.mjs",
    "src/person-matte.mjs",
    "src/particle-field.mjs",
  ]);
  assert.ok(paths.every(file => !/\.(?:cc|cpp|cxx|h|hpp)$/i.test(file)));
});
