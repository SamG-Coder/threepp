import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourcePath = join(sampleRoot, "src", "particle-field.mjs");

async function particleSource() {
  return readFile(sourcePath, "utf8");
}

test("particle field keeps roughly 65k persistent particles in GPU storage", async () => {
  const source = await particleSource();

  assert.match(source, /PARTICLE_FIELD_DEFAULT_COUNT\s*=\s*65_536/);
  assert.match(source, /export function createParticleField\s*\(renderer,/);
  assert.ok((source.match(/instancedArray\s*\(/g) ?? []).length >= 2);
  assert.match(source, /particlePositions\s*=\s*instancedArray\(particleCount,\s*["']vec4["']\)/);
  assert.match(source, /particleVelocities\s*=\s*instancedArray\(particleCount,\s*["']vec4["']\)/);
  assert.match(source, /Fn\(\(\)\s*=>[\s\S]*?instanceIndex[\s\S]*?\.compute\(particleCount,\s*\[64,\s*1,\s*1\]\)/);
  assert.match(source, /renderer\.compute\(initialiseParticles\)/);
  assert.match(source, /particlePositions\.element\(id\)\.assign/);
  assert.match(source, /particleVelocities\.element\(id\)\.assign/);
  assert.doesNotMatch(source, /setInterval|requestAnimationFrame|new\s+Worker/);
});

test("updates use a capped fixed-step simulation and expose the sample contract", async () => {
  const source = await particleSource();

  assert.match(source, /FIXED_STEP_SECONDS\s*=\s*1\s*\/\s*60/);
  assert.match(source, /MAX_STEPS_PER_UPDATE\s*=\s*4/);
  assert.match(
    source,
    /function update\(\{\s*delta\s*=\s*0,\s*time\s*=\s*undefined,\s*aspect\s*=\s*1,\s*attractors\s*=\s*\[\]\s*\}\s*=\s*\{\}\)/,
  );
  assert.match(source, /accumulator\s*=\s*Math\.min\(accumulator\s*\+\s*frameDelta/);
  assert.match(source, /while\s*\([\s\S]*?accumulator[\s\S]*?MAX_STEPS_PER_UPDATE[\s\S]*?renderer\.compute\(advanceParticles\)/);
  assert.match(source, /aspectUniform\.value\s*=\s*latestAspect/);
  assert.match(source, /return\s*\{[\s\S]*?object:\s*mesh,[\s\S]*?mesh,[\s\S]*?update,[\s\S]*?reset,[\s\S]*?dispose,[\s\S]*?status,/);
});

test("two uniform hand vortices combine pose, velocity and pulse forces", async () => {
  const source = await particleSource();

  assert.match(source, /const attractorCenterA\s*=\s*uniform\(new THREE\.Vector3\(\)\)/);
  assert.match(source, /const attractorCenterB\s*=\s*uniform\(new THREE\.Vector3\(\)\)/);
  assert.match(source, /const attractorVelocityA\s*=\s*uniform\(new THREE\.Vector3\(\)\)/);
  assert.match(source, /const attractorVelocityB\s*=\s*uniform\(new THREE\.Vector3\(\)\)/);
  assert.match(source, /writeAttractor\(0,\s*attractors\?\.\[0\]\)/);
  assert.match(source, /writeAttractor\(1,\s*attractors\?\.\[1\]\)/);
  assert.match(source, /source\?\.strength/);
  assert.match(source, /source\?\.openness/);
  assert.match(source, /source\?\.pulse/);
  assert.match(source, /source\?\.velocity/);

  // Closed/pinch is attraction and a strong tight vortex; open is expansion.
  assert.match(source, /const attraction\s*=\s*openness\.oneMinus\(\)\.mul\(ATTRACTION_FORCE\)/);
  assert.match(source, /const repulsion\s*=\s*openness\.mul\(REPULSION_FORCE\)/);
  assert.match(source, /const tangent\s*=\s*vec3\(/);
  assert.match(source, /applyAttractor\([\s\S]*?attractorCenterA,[\s\S]*?attractorGestureA,[\s\S]*?1,?\s*\)/);
  assert.match(source, /applyAttractor\([\s\S]*?attractorCenterB,[\s\S]*?attractorGestureB,[\s\S]*?-1,?\s*\)/);
  assert.match(source, /HAND_VELOCITY_INJECTION/);
  assert.match(source, /PULSE_REPULSION/);
});

test("explicit gesture modes gather, bloom, and leave a directional swipe wake", async () => {
  const source = await particleSource();

  assert.match(source, /function writeGestureMode\(target,\s*source\)/);
  assert.match(source, /source\?\.mode\s*\?\?\s*source\?\.gesture\s*\?\?\s*source\?\.gestureMode/);
  assert.match(source, /\["closed",\s*"grip",\s*"pinch",\s*"gather"\]/);
  assert.match(source, /\["open",\s*"bloom",\s*"expand",\s*"push"\]/);
  assert.match(source, /\["swipe",\s*"sweep",\s*"flick",\s*"throw"\]/);
  assert.match(source, /target\.set\(0,\s*0,\s*0,\s*0\)/);
  assert.match(source, /const attractorGestureA\s*=\s*uniform\(new THREE\.Vector4\(\)\)/);
  assert.match(source, /const attractorGestureB\s*=\s*uniform\(new THREE\.Vector4\(\)\)/);
  assert.match(source, /writeGestureMode\(gestureUniform\.value,\s*source\)/);

  // Closed/grip has a compact gather and a materially stronger spiral.
  assert.match(source, /CLOSED_GATHER_RADIUS\s*=\s*0\.22/);
  assert.match(source, /closedMode\.mul\(CLOSED_GATHER_FORCE\)/);
  assert.match(source, /closedMode\.mul\(CLOSED_SPIRAL_FORCE\)/);
  assert.match(source, /outwardSpeed[\s\S]*?CLOSED_TIGHTENING/);

  // Open mode is a broad radial bloom, not the closed mode with a sign flip.
  assert.match(source, /OPEN_BLOOM_RADIUS\s*=\s*0\.84/);
  assert.match(source, /openMode\.mul\(OPEN_BLOOM_FORCE\)/);
  assert.match(source, /openMode\.mul\(0\.20\)/);

  // Swipe decomposes the field into along/behind and lateral coordinates.
  assert.match(source, /SWIPE_VELOCITY_INJECTION\s*=\s*13\.2/);
  assert.match(source, /const swipeDirection\s*=\s*handVelocity\.div/);
  assert.match(source, /const behindDistance\s*=\s*distanceAlongSwipe\.negate\(\)\.max\(0\)/);
  assert.match(source, /const lateralDistanceSquared\s*=\s*lateralOffset\.dot\(lateralOffset\)/);
  assert.match(source, /const wakeFalloff\s*=\s*exp\(/);
  assert.match(source, /swipeHeadFalloff\.add\(wakeFalloff\.mul\(0\.82\)\)/);
  assert.match(source, /SWIPE_WAKE_TURBULENCE/);
});

test("point follows orbitally with a luminous trail and charged open release", async () => {
  const source = await particleSource();

  assert.match(source, /\["point",\s*"follow",\s*"fingertip",\s*"hover"\]/);
  assert.match(source, /target\.set\(0,\s*0,\s*0,\s*1\)/);
  assert.match(source, /const pointMode\s*=\s*gesture\.w/);
  assert.match(source, /const explicitMode\s*=\s*min\(/);
  assert.match(source, /const legacyMode\s*=\s*explicitMode\.oneMinus\(\)/);

  // Tight attraction follows a predicted fingertip while a separate tangent orbits it.
  assert.match(source, /POINT_FOLLOW_RADIUS\s*=\s*0\.74/);
  assert.match(source, /POINT_CAPTURE_FLOOR\s*=\s*0\.12/);
  assert.match(source, /const predictedFingertip\s*=\s*center\.add\(/);
  assert.match(source, /handVelocity\.mul\(POINT_LOOKAHEAD_SECONDS\)/);
  assert.match(source, /const pointCaptureShape\s*=\s*max\(float\(POINT_CAPTURE_FLOOR\),\s*exp\(/);
  assert.match(source, /const pointFollowFalloff\s*=\s*pointCaptureShape\.mul\(pointMode\)\.mul\(active\)/);
  assert.match(source, /predictionDirection\.mul\(POINT_PREDICTIVE_FORCE\)/);
  assert.match(source, /handVelocity\.mul\(POINT_VELOCITY_MATCH\)/);
  assert.match(source, /pointMode\.mul\(POINT_ORBIT_FORCE\)/);

  // Visual energy persists entirely on the GPU and leaves the moving fingertip lit.
  assert.match(source, /particleVisualEnergy\s*=\s*instancedArray\(particleCount,\s*["']vec4["']\)/);
  assert.match(source, /followTrailEnergy[\s\S]*?POINT_TRAIL_DECAY/);
  assert.match(source, /const pointTrailStamp\s*=\s*pointFollowFalloff/);
  assert.match(source, /followTrailEnergy\.assign\(max\(followTrailEnergy,\s*pointTrailStamp\)\)/);
  assert.match(source, /particleVisualEnergy\.element\(id\)\.assign/);
  assert.match(source, /const visualEnergyAttribute\s*=\s*particleVisualEnergy\.toAttribute\(\)/);

  // Closed mode accumulates charge; only an open pulse turns it into a shell.
  assert.match(source, /const chargeAdded\s*=\s*stepDeltaUniform\.mul\(CLOSED_CHARGE_RATE\)/);
  assert.match(source, /closedCharge\.assign\(min\(float\(1\),\s*closedCharge\.add\(chargeAdded\)\)\)/);
  assert.match(source, /const releaseRadius\s*=\s*mix\(float\(0\.10\),\s*float\(0\.72\),\s*controls\.z\.oneMinus\(\)\)/);
  assert.match(source, /const releaseShell\s*=\s*exp\(/);
  assert.match(source, /OPEN_RELEASE_SHELL_WIDTH/);
  assert.match(source, /releaseShell[\s\S]*?openMode[\s\S]*?controls\.z/);
  assert.match(source, /releasePower[\s\S]*?OPEN_RELEASE_IMPULSE/);
  assert.match(source, /OPEN_RELEASE_CHARGE_DRAIN/);
  assert.match(source, /color\(0x30bfff\)/);
  assert.match(source, /color\(0xedffff\)/);
});

test("flow uses analytic curl, exponential damping and unclamped soft containment", async () => {
  const source = await particleSource();

  assert.match(source, /const analyticCurlNoise\s*=\s*vec3\(/);
  assert.ok((source.match(/\bsin\s*\(/g) ?? []).length >= 4);
  assert.ok((source.match(/\bcos\s*\(/g) ?? []).length >= 4);
  assert.match(source, /acceleration\.addAssign\(analyticCurlNoise\.mul\(CURL_FORCE\)\)/);
  assert.match(source, /SOFT_BOUNDARY_START/);
  assert.match(source, /boundaryPenetration[\s\S]*?CONTAINMENT_FORCE/);
  assert.match(source, /velocity\.mulAssign\(exp\(stepDeltaUniform\.mul\(-LINEAR_DAMPING\)\)\)/);
  assert.match(source, /MAX_SPEED\s*=\s*2\.8/);
  assert.match(source, /const speedScale\s*=\s*min\(/);
  assert.doesNotMatch(source, /position\.clamp|position\.assign\(clamp/);
});

test("rendering uses additive soft sprites with energy colour ramp", async () => {
  const source = await particleSource();

  assert.match(source, /new THREE\.SpriteNodeMaterial\(\)/);
  assert.match(source, /new THREE\.InstancedMesh\(geometry,\s*material,\s*particleCount\)/);
  assert.match(source, /material\.positionNode\s*=\s*positionAttribute\.xyz/);
  assert.match(source, /material\.blending\s*=\s*THREE\.AdditiveBlending/);
  assert.match(source, /material\.depthWrite\s*=\s*false/);
  assert.match(source, /material\.opacityNode\s*=\s*softParticleAlpha/);
  assert.match(source, /color\(0x120024\)/);
  assert.match(source, /color\(0xd020ff\)/);
  assert.match(source, /color\(0xffefff\)/);
  assert.match(source, /speedEnergy/);
  assert.match(source, /proximityEnergy/);
});

test("reset, status and disposal own the complete GPU field lifecycle", async () => {
  const source = await particleSource();

  assert.match(source, /function reset\(\)/);
  assert.match(source, /function status\(\)/);
  assert.match(source, /state:\s*disposed\s*\?\s*["']disposed["']/);
  assert.match(source, /backend:\s*["']tsl-gpu-compute["']/);
  assert.match(source, /function dispose\(\)/);
  assert.match(source, /mesh\.removeFromParent\(\)/);
  assert.match(source, /geometry\.dispose\(\)/);
  assert.match(source, /material\.dispose\(\)/);
  assert.match(source, /particlePositions\.value\.dispose\(\)/);
  assert.match(source, /particleVelocities\.value\.dispose\(\)/);
  assert.match(source, /particleVisualEnergy\.value\.dispose\(\)/);
});
