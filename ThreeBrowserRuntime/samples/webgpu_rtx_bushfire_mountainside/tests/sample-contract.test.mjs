import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as THREE from "three/webgpu";
import { createBushfireEffects } from "../src/fire-effects.mjs";
import { createProceduralForest } from "../src/forest.mjs";
import { collectStaticTriangleScene } from "../src/native-rtx-lighting.mjs";
import { createMountainside, terrainFuel, terrainHeight } from "../src/terrain.mjs";

const sampleRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

function semanticText(object) {
  return [object?.name, object?.geometry?.name, object?.material?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function instancedMeshes(root) {
  const meshes = [];
  root.traverse(object => {
    if (object.isInstancedMesh) meshes.push(object);
  });
  return meshes;
}

function instanceTransform(mesh, index) {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  mesh.getMatrixAt(index, matrix);
  matrix.decompose(position, quaternion, scale);
  return { matrix, position, quaternion, scale };
}

function maximumScale(transform) {
  return Math.max(
    Math.abs(transform.scale.x),
    Math.abs(transform.scale.y),
    Math.abs(transform.scale.z),
  );
}

function distanceBetweenEmitters(a, b) {
  return Math.hypot(
    a.position[0] - b.position[0],
    a.position[1] - b.position[1],
    a.position[2] - b.position[2],
  );
}

function matchEmittersByPosition(previous, current) {
  const remaining = current.map((emitter, index) => ({ emitter, index }));
  return previous.map(before => {
    let nearest = 0;
    for (let index = 1; index < remaining.length; ++index) {
      if (
        distanceBetweenEmitters(before, remaining[index].emitter) <
        distanceBetweenEmitters(before, remaining[nearest].emitter)
      ) nearest = index;
    }
    const [{ emitter: after }] = remaining.splice(nearest, 1);
    return { before, after, displacement: distanceBetweenEmitters(before, after) };
  });
}

function extractNamedFunction(source, name) {
  const declaration = new RegExp(`\\bfunction\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `expected function ${name}`);
  const openingBrace = source.indexOf("{", declaration.index);
  assert.ok(openingBrace >= 0, `expected body for ${name}`);
  let depth = 0;
  for (let index = openingBrace; index < source.length; ++index) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(declaration.index, index + 1);
    }
  }
  assert.fail(`unterminated function ${name}`);
}

test("sample is self-contained and contains no native implementation source", async () => {
  const files = await walk(sampleRoot);
  assert.ok(files.some(path => path.endsWith("site-entry.mjs")));
  assert.ok(files.some(path => path.endsWith("src\\main.mjs") || path.endsWith("src/main.mjs")));
  assert.equal(files.some(path => /\.(?:c|cc|cpp|cxx|h|hh|hpp)$/i.test(path)), false);

  const moduleSources = await Promise.all(
    files.filter(path => path.endsWith(".mjs")).map(path => readFile(path, "utf8")),
  );
  assert.doesNotMatch(
    moduleSources.join("\n"),
    /\.(?:c|cc|cpp|cxx|h|hh|hpp)\b/i,
    "sample modules must not reference a native implementation file",
  );

  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const native = await readFile(join(sampleRoot, "src", "native-rtx-lighting.mjs"), "utf8");
  assert.match(main, /createProceduralForest/);
  assert.match(main, /createBushfireEffects/);
  assert.match(native, /registerStaticScene/);
  assert.match(native, /evaluateRayLighting/);
  assert.match(native, /HalfFloatType/);
});

test("main has no HUD or UI render and selects exactly one surface presentation path", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const native = await readFile(join(sampleRoot, "src", "native-rtx-lighting.mjs"), "utf8");
  const imports = [...main.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map(match => match[1]);

  assert.equal(
    imports.some(specifier => /(?:^|[-_/])(?:hud|ui)(?:[-_.]|$)/i.test(specifier)),
    false,
    "the canvas-only sample must not import a HUD/UI module",
  );
  assert.doesNotMatch(main, /\bcreate\w*(?:Hud|HUD|Ui|UI)\s*\(/);
  assert.doesNotMatch(main, /renderer\.render\([^\n)]*(?:hud|ui)/i);

  assert.equal(
    (main.match(/\brenderer\.render\(scene,\s*camera\)/g) ?? []).length,
    1,
    "main should contain one direct raster surface fallback",
  );
  assert.equal(
    (main.match(/\bnativeRenderer\.render\(scene,\s*camera,/g) ?? []).length,
    1,
    "main should contain one native surface path",
  );
  assert.match(
    main,
    /let nativeRendered = false;[\s\S]*?nativeRendered = nativeRenderer\.render\(scene,\s*camera,[\s\S]*?if \(!nativeRendered\) \{[\s\S]*?renderer\.setRenderTarget\(null\);[\s\S]*?renderer\.render\(scene,\s*camera\);[\s\S]*?\}/,
    "the raster surface render must be gated by failure/non-use of native presentation",
  );
  assert.match(
    main,
    /const\s+fireLightVisibility\s*=\s*fire\.lights\.map\([^;]+\.visible\);[\s\S]*?for\s*\([^)]*fire\.lights\)\s*[^;{]*\.visible\s*=\s*false;[\s\S]*?try\s*\{[\s\S]*?nativeRendered\s*=\s*nativeRenderer\.render\(scene,\s*camera,[\s\S]*?\}\s*finally\s*\{[\s\S]*?fire\.lights\.forEach\([\s\S]*?\.visible\s*=\s*fireLightVisibility\s*\[\s*index\s*\][\s\S]*?\}[\s\S]*?if\s*\(!nativeRendered\)[\s\S]*?renderer\.render\(scene,\s*camera\)/,
    "native rendering must suppress duplicate raster fire lights in try/finally and restore them before fallback",
  );
  assert.match(
    native,
    /_renderLinearScene\(scene, camera\)[\s\S]*?setRenderTarget\(this\.target\)[\s\S]*?renderer\.render\(scene, camera\)/,
    "native scene rendering must target its offscreen HDR texture",
  );
  assert.match(
    native,
    /_present\(\) \{[\s\S]*?setRenderTarget\(null\)[\s\S]*?renderer\.render\(this\._displayScene, this\._displayCamera\)/,
    "the native path must have one explicit surface presentation",
  );
  assert.match(
    native,
    /this\._present\(\);\s*this\.frameIndex \+= 1;\s*return true;/,
    "a successful native presentation must prevent the caller's raster fallback",
  );
});

test("wide-area light samples have no explicit periodic oscillator", async () => {
  const effects = await readFile(join(sampleRoot, "src", "fire-effects.mjs"), "utf8");
  for (const name of ["activeLightSample", "residualLightSample"]) {
    const sample = extractNamedFunction(effects, name);
    const signature = sample.slice(0, sample.indexOf("{"));
    assert.doesNotMatch(signature, /\btime\b/, `${name} must be simulation-state driven`);
    assert.doesNotMatch(
      sample,
      /\b(?:Math\.)?sin\s*\(/,
      `${name} must not put a periodic oscillator into wide-area illumination`,
    );
  }
});

test("forest records and live fire emitters cross both integration boundaries", async () => {
  const main = await readFile(join(sampleRoot, "src", "main.mjs"), "utf8");
  const effects = await readFile(join(sampleRoot, "src", "fire-effects.mjs"), "utf8");
  const native = await readFile(join(sampleRoot, "src", "native-rtx-lighting.mjs"), "utf8");

  assert.match(
    main,
    /createBushfireEffects\(\s*\{[\s\S]*?treeRecords:\s*forest\.treeRecords[\s\S]*?\}\s*\)/,
    "fire effects must receive the procedural forest records",
  );
  assert.match(
    effects,
    /export function createBushfireEffects\s*\(\s*\{[^}]*\btreeRecords\b[^}]*\}\s*\)/s,
    "the effects module must accept the passed tree records",
  );
  assert.ok(
    (effects.match(/\btreeRecords\b/g) ?? []).length >= 2,
    "tree records must be consumed rather than accepted and ignored",
  );
  assert.match(
    effects,
    /\bgetRtxEmitters\s*\([^)]*\)\s*\{/,
    "fire effects must expose their current bounded emitter set",
  );

  assert.match(
    main,
    /nativeRenderer\.render\(scene,\s*camera,\s*\{[\s\S]*?fireEmitters:\s*fire\.getRtxEmitters\?\.\(3\)\s*\?\?\s*\[\][\s\S]*?\}\s*\)/,
    "each native render must receive the current fire emitters",
  );
  assert.match(
    native,
    /render\(scene,\s*camera\s*=\s*this\.camera,\s*\{[^}]*\bfireEmitters\b[^}]*\}\s*=\s*\{\}\)/s,
    "the native renderer must accept fireEmitters in its frame contract",
  );
  assert.ok(
    (native.match(/\bfireEmitters\b/g) ?? []).length >= 2,
    "the native renderer must consume fireEmitters rather than silently ignore them",
  );
});

test("burned cells leave persistent instanced residue and bounded residual light", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  const cells = Array.from({ length: 16 }, (_, index) => ({
    index,
    x: (index % 4) * 5 - 7.5,
    z: Math.floor(index / 4) * 5 - 7.5,
    fuel: 1,
    moisture: 0.18,
    heat: 0,
    burn: 0,
    state: "unburned",
  }));
  const treeRecords = cells.map(cell => ({
    id: cell.index,
    x: cell.x,
    y: 0,
    z: cell.z,
    scale: 0.85 + (cell.index % 3) * 0.1,
    yaw: cell.index * 0.37,
    lod: cell.index < 4 ? "hero" : "mid",
    fireCellIndex: cell.index,
    cellIndex: cell.index,
  }));
  const model = {
    cells,
    cellAtWorld(x, z) {
      return cells.reduce((nearest, cell) => (
        Math.hypot(cell.x - x, cell.z - z) < Math.hypot(nearest.x - x, nearest.z - z)
          ? cell
          : nearest
      ));
    },
  };
  const fire = createBushfireEffects({
    scene,
    heightAt: () => 0,
    treeRecords,
    wind: new THREE.Vector2(0.82, -0.36),
  });

  try {
    assert.equal(
      typeof fire.getResidueStats,
      "function",
      "fire effects must expose residue state without requiring renderer or native-runtime access",
    );
    fire.update(0, 0, model, camera);
    const clean = fire.getResidueStats();
    for (const key of [
      "fallenLogs",
      "logEmberCracks",
      "branchSections",
      "ashBeds",
      "glowingFissures",
      "glowingCoals",
      "residualEmitters",
    ]) {
      assert.equal(typeof clean[key], "number", `residue snapshot must include numeric ${key}`);
      assert.ok(Number.isFinite(clean[key]) && clean[key] >= 0, `${key} must be finite and bounded below`);
    }

    for (const cell of cells.slice(0, 8)) {
      cell.state = "burned";
      cell.fuel = 0;
      cell.heat = 0.08;
      cell.burn = 0;
    }
    fire.update(2, 0.05, model, camera);
    const firstResidue = fire.getResidueStats();
    for (const key of ["fallenLogs", "logEmberCracks", "ashBeds", "glowingFissures", "glowingCoals"]) {
      assert.ok(firstResidue[key] > 0, `burned fuel must create ${key}`);
    }
    assert.ok(
      firstResidue.fallenLogs <= treeRecords.length,
      "fallen logs must be derived from the supplied finite tree record set",
    );
    assert.ok(firstResidue.residualEmitters > 0, "burned residue must contribute a light source candidate");

    const residueMeshes = instancedMeshes(fire.group);
    const fallenLogs = residueMeshes.filter(mesh => {
      const text = semanticText(mesh);
      return /(?:fallen|downed)/.test(text) && /(?:char|burn)/.test(text) && /(?:log|trunk|timber)/.test(text);
    });
    const ashBeds = residueMeshes.filter(mesh => /\bash(?:es|y)?\b/.test(semanticText(mesh)));
    const logCracks = residueMeshes.filter(mesh => {
      const text = semanticText(mesh);
      return /(?:log|trunk)/.test(text) && /(?:ember|glow)/.test(text) && /(?:crack|fissure)/.test(text);
    });
    const fissures = residueMeshes.filter(mesh => /(?:ember[^ ]*\s+)?fissure/.test(semanticText(mesh)));
    const glowingFragments = residueMeshes.filter(mesh => /(?:glowing?|ember|coal)/.test(semanticText(mesh)));
    assert.ok(fallenLogs.some(mesh => mesh.count > 0), "fallen charred timber must use instancing");
    assert.ok(ashBeds.some(mesh => mesh.count > 0), "ash residue must use instancing");
    assert.ok(logCracks.some(mesh => mesh.count > 0), "fallen timber must retain attached emissive cracks");
    assert.ok(firstResidue.logEmberCracks >= firstResidue.fallenLogs);
    assert.ok(firstResidue.logEmberCracks <= firstResidue.fallenLogs * 2);
    assert.ok(fissures.some(mesh => mesh.count > 0), "ground ember fissures must use instancing");
    assert.ok(glowingFragments.some(mesh => mesh.count > 0), "long-lived ember/coal fragments must use instancing");
    assert.ok(
      [...fissures, ...glowingFragments].some(mesh => (
        mesh.count > 0 && (
          mesh.material?.isMeshBasicNodeMaterial ||
          Number(mesh.material?.emissiveIntensity) > 0 ||
          mesh.material?.blending === THREE.AdditiveBlending
        )
      )),
      "fissures or coals must remain emissive in the raster scene",
    );

    for (const cell of cells.slice(8)) {
      cell.state = "burned";
      cell.fuel = 0;
      cell.heat = 0.06;
      cell.burn = 0;
    }
    fire.update(3, 0.05, model, camera);
    const expandedResidue = fire.getResidueStats();
    for (const key of ["fallenLogs", "logEmberCracks", "ashBeds", "glowingFissures", "glowingCoals"]) {
      assert.ok(expandedResidue[key] >= firstResidue[key], `${key} must update as the burned area grows`);
    }
    fire.update(3.05, 0.05, model, camera);
    const persistentResidue = fire.getResidueStats();
    for (const key of ["fallenLogs", "logEmberCracks", "ashBeds", "glowingFissures", "glowingCoals"]) {
      assert.ok(persistentResidue[key] >= expandedResidue[key], `${key} must persist after active flame is gone`);
    }

    assert.ok(
      fire.lights.some(light => light.visible && light.intensity > 0),
      "residual-only sources must be eligible for raster point lighting",
    );
    const emitters = fire.getRtxEmitters(99);
    assert.ok(emitters.length > 0 && emitters.length <= 3, "residual RTX emitters must use the public hard cap");
    assert.ok(fire.getRtxEmitters(1).length <= 1, "the caller may request a stricter emitter bound");
    for (const emitter of emitters) {
      assert.equal(emitter.position.length, 3);
      assert.ok(emitter.position.every(Number.isFinite));
      assert.ok(Number.isFinite(emitter.intensity) && emitter.intensity > 0);
      assert.ok(Number.isFinite(emitter.range) && emitter.range > 0);
    }

    const treelessScene = new THREE.Scene();
    const treelessFire = createBushfireEffects({ scene: treelessScene, heightAt: () => 0, treeRecords: [] });
    try {
      treelessFire.update(4, 0.05, model, camera);
      assert.equal(
        treelessFire.getResidueStats().fallenLogs,
        0,
        "burned terrain without tree records must not invent fallen trunks",
      );
      assert.ok(treelessFire.getResidueStats().ashBeds > 0, "cell ash is independent of tree residue");
    } finally {
      treelessFire.dispose();
    }
  } finally {
    fire.dispose();
  }
});

test("rank changes do not make RTX fire lighting flash or teleport", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  camera.position.set(24, 18, 75);
  camera.lookAt(24, 3, -8);

  const burnedCell = {
    index: 0,
    x: -42,
    z: -34,
    fuel: 0,
    moisture: 0,
    heat: 0.05,
    burn: 0,
    state: "burned",
  };
  const activeCells = Array.from({ length: 6 }, (_, index) => ({
    index: index + 1,
    x: -6 + index * 19,
    z: index % 2 ? -3 : 3,
    fuel: 0.64,
    moisture: 0.08,
    heat: 1,
    burn: 0.68,
    state: "burning",
  }));
  const cells = [burnedCell, ...activeCells];
  const treeRecords = cells.map(cell => ({
    id: cell.index,
    x: cell.x,
    y: 0,
    z: cell.z,
    scale: 1,
    yaw: cell.index * 0.41,
    lod: "mid",
    fireCellIndex: cell.index,
    cellIndex: cell.index,
  }));
  const model = { cells, cellAtWorld: (x, z) => (
    cells.reduce((nearest, cell) => (
      Math.hypot(cell.x - x, cell.z - z) < Math.hypot(nearest.x - x, nearest.z - z)
        ? cell
        : nearest
    ))
  ) };
  const fire = createBushfireEffects({ scene, heightAt: () => 0, treeRecords });

  try {
    const delta = 1 / 60;
    const warmupFrames = 90;
    let previousEmitters = null;
    let previousRaster = new Map();
    let previousLeader = null;
    let leaderChanges = 0;
    let comparedFrames = 0;
    for (let frame = 0; frame < 330; ++frame) {
      for (let index = 0; index < activeCells.length; ++index) {
        activeCells[index].burn = 0.68
          + Math.sin(frame * 0.075 + index * 1.047) * 0.105
          + Math.sin(frame * 0.019 + index * 0.61) * 0.018;
      }
      const leader = [...activeCells]
        .sort((a, b) => b.burn - a.burn)[0]
        .index;
      if (previousLeader !== null && leader !== previousLeader) leaderChanges += 1;
      previousLeader = leader;

      fire.update(frame * delta, delta, model, camera);
      if (frame < warmupFrames) continue;
      const emitters = fire.getRtxEmitters(99);
      assert.ok(emitters.length > 0 && emitters.length <= 3, "the RTX payload must remain hard-capped");
      assert.ok(emitters.every(emitter => (
        emitter.position.length === 3 &&
        emitter.position.every(Number.isFinite) &&
        Number.isFinite(emitter.intensity) && emitter.intensity >= 0
      )));

      const residualLight = fire.lights.find(light => light.visible && light.userData.residual);
      assert.ok(residualLight, "a glowing fallen-tree source must retain its reserved raster-light slot");
      const residualProbe = { position: residualLight.position.toArray() };
      assert.ok(
        emitters.some(emitter => distanceBetweenEmitters(emitter, residualProbe) <= 0.25),
        "the reserved residual source must also survive the three-emitter RTX selection",
      );

      const currentRaster = new Map(
        fire.lights
          .filter(light => light.visible && light.userData.sourceKey)
          .map(light => [light.userData.sourceKey, light.intensity]),
      );
      for (const [key, intensity] of currentRaster) {
        if (!previousRaster.has(key)) continue;
        const previousIntensity = previousRaster.get(key);
        const scale = Math.max(previousIntensity, intensity, 1);
        assert.ok(
          Math.abs(intensity - previousIntensity) / scale <= 0.055,
          `raster light ${key} changed intensity too abruptly between adjacent frames`,
        );
      }
      previousRaster = currentRaster;

      if (previousEmitters) {
        assert.equal(
          emitters.length,
          previousEmitters.length,
          "a stable burning front must not flash by dropping and recreating emitter slots",
        );
        for (const pair of matchEmittersByPosition(previousEmitters, emitters)) {
          assert.ok(
            pair.displacement <= 0.25,
            `an emitter teleported ${pair.displacement.toFixed(3)}m between adjacent 60 Hz frames`,
          );
          const intensityScale = Math.max(pair.before.intensity, pair.after.intensity, 1);
          const intensityChange = Math.abs(pair.after.intensity - pair.before.intensity) / intensityScale;
          assert.ok(
            intensityChange <= 0.055,
            `adjacent-frame emitter intensity changed ${(intensityChange * 100).toFixed(2)}%`,
          );
        }
        comparedFrames += 1;
      }
      previousEmitters = emitters;
    }
    assert.ok(comparedFrames >= 200, "the temporal contract must cover many consecutive frames");
    assert.ok(leaderChanges >= 8, "the test input must genuinely exercise repeated source-rank changes");
    assert.ok(fire.getResidueStats().residualEmitters > 0);
  } finally {
    fire.dispose();
  }
});

test("stable burn has no time-only modulation in wide-area illumination", () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  const cells = Array.from({ length: 5 }, (_, index) => ({
    index,
    x: index * 18,
    z: index % 2 ? -3 : 3,
    fuel: 0.62,
    moisture: 0.08,
    heat: 1,
    burn: 0.74,
    state: "burning",
  }));
  const treeRecords = cells.map(cell => ({
    id: cell.index,
    x: cell.x,
    y: 0,
    z: cell.z,
    scale: 1,
    yaw: 0,
    lod: "mid",
    fireCellIndex: cell.index,
    cellIndex: cell.index,
  }));
  const model = { cells, cellAtWorld: () => cells[0] };
  const fire = createBushfireEffects({ scene, heightAt: () => 0, treeRecords });

  try {
    const ranges = new Map();
    const delta = 1 / 60;
    for (let frame = 0; frame < 720; ++frame) {
      fire.update(frame * delta, delta, model, camera);
      if (frame < 360) continue;
      for (const light of fire.lights) {
        if (!light.visible || !light.userData.sourceKey || light.userData.residual) continue;
        const range = ranges.get(light.userData.sourceKey) ?? {
          minimum: light.intensity,
          maximum: light.intensity,
        };
        range.minimum = Math.min(range.minimum, light.intensity);
        range.maximum = Math.max(range.maximum, light.intensity);
        ranges.set(light.userData.sourceKey, range);
      }
    }
    assert.ok(ranges.size >= 3, "the test must observe several persistent wide-area fire pools");
    for (const [key, range] of ranges) {
      const variation = (range.maximum - range.minimum) / Math.max(range.maximum, 1);
      assert.ok(
        variation <= 0.0025,
        `stable source ${key} varied ${(variation * 100).toFixed(2)}% from time alone`,
      );
    }
  } finally {
    fire.dispose();
  }
});

test("terrain and fuel fields remain finite across the complete mountainside", () => {
  for (let z = -500; z <= 170; z += 23.7) {
    for (let x = -250; x <= 250; x += 19.3) {
      assert.ok(Number.isFinite(terrainHeight(x, z)));
      assert.ok(terrainFuel(x, z) >= 0 && terrainFuel(x, z) <= 1);
    }
  }
});

test("spent trees become persistent black snags with consumed crowns and foliage", () => {
  const forest = createProceduralForest({ heightAt: () => 0, seed: 0xdecafbad });
  try {
    const record = forest.treeRecords.find(tree => tree.leafInstances.length > 0);
    assert.ok(record, "the detailed forest must expose a representative foliage-bearing tree record");
    assert.equal(typeof record.snagAmount, "number");
    assert.equal(record.snagAmount, 0);

    const healthyBranch = instanceTransform(record.branchMesh, record.branchInstance);
    const healthyCrown = instanceTransform(record.crownMesh, record.crownInstance);
    const healthyLeaves = record.leafInstances.map(leaf => {
      assert.ok(leaf.mesh?.isInstancedMesh, "detail foliage records must retain their shared mesh mapping");
      return instanceTransform(leaf.mesh, leaf.index);
    });
    const spentCell = {
      index: 0,
      x: record.x,
      z: record.z,
      fuel: 0,
      moisture: 0,
      heat: 0,
      burn: 0,
      state: "burned",
    };
    const spentModel = { cells: [spentCell], cellAtWorld: () => spentCell };
    for (let step = 1; step <= 36 && record.snagAmount < 0.999; ++step) {
      forest.update(step * 0.12, spentModel);
    }

    assert.ok(record.snagAmount >= 0.999 && record.snagAmount <= 1);
    const snagBranch = instanceTransform(record.branchMesh, record.branchInstance);
    const consumedCrown = instanceTransform(record.crownMesh, record.crownInstance);
    assert.ok(
      maximumScale(snagBranch) > maximumScale(healthyBranch) * 0.25,
      "a burned tree must retain a substantial standing woody snag",
    );
    assert.ok(Math.abs(snagBranch.scale.x) < Math.abs(healthyBranch.scale.x) * 0.8);
    assert.ok(Math.abs(snagBranch.scale.y) < Math.abs(healthyBranch.scale.y) * 0.8);
    assert.ok(Math.abs(snagBranch.scale.z) < Math.abs(healthyBranch.scale.z) * 0.8);
    assert.ok(
      maximumScale(consumedCrown) <= maximumScale(healthyCrown) * 0.001,
      "the bulky crown proxy must be consumed rather than remain as a black canopy",
    );
    record.leafInstances.forEach((leaf, index) => {
      const consumedLeaf = instanceTransform(leaf.mesh, leaf.index);
      assert.ok(
        maximumScale(consumedLeaf) <= maximumScale(healthyLeaves[index]) * 0.001,
        "every associated detail-foliage instance must collapse with the spent crown",
      );
    });
    const branchColor = new THREE.Color();
    record.branchMesh.getColorAt(record.branchInstance, branchColor);
    assert.ok(
      Math.max(branchColor.r, branchColor.g, branchColor.b) < 0.12,
      "the remaining snag must be visibly near-black char",
    );

    const recoveredCell = { ...spentCell, state: "unburned", fuel: 1, moisture: 0.4 };
    forest.update(8, { cells: [recoveredCell], cellAtWorld: () => recoveredCell });
    assert.ok(record.snagAmount >= 0.999, "aftermath must not regrow when a sampled cell later goes quiet");
    assert.ok(
      maximumScale(instanceTransform(record.crownMesh, record.crownInstance)) <=
        maximumScale(healthyCrown) * 0.001,
      "consumed crowns must remain absent",
    );
  } finally {
    forest.dispose();
  }
});

test("forest meets the detailed instanced draw and RTX budgets", async () => {
  const terrain = createMountainside();
  const forest = createProceduralForest({ heightAt: terrainHeight, seed: 0xdecafbad });
  try {
    const stats = forest.group.userData.forestStats;
    assert.ok(stats.trees >= 900, `expected valley-scale forest, received ${stats.trees} trees`);
    assert.ok(stats.heroTrees >= 8);
    assert.ok(stats.effectiveRasterTriangles >= 500_000);
    assert.ok(stats.drawCalls <= 16);
    assert.equal(forest.rtxRoots.length, 14);
    assert.ok(forest.rtxRoots.every(mesh => mesh.material.transparent !== true));

    const staticScene = await collectStaticTriangleScene(
      [...terrain.rtxRoots, ...forest.rtxRoots],
      { maxTriangles: 1_550_000, timeBudgetMs: 12 },
    );
    assert.equal(staticScene.truncated, false);
    assert.ok(staticScene.triangleCount >= 500_000);
    assert.ok(staticScene.triangleCount < 1_550_000);
    assert.ok(terrain.bounds.maxX - terrain.bounds.minX >= 500);
    assert.ok(terrain.bounds.maxZ - terrain.bounds.minZ >= 650);
  } finally {
    forest.dispose();
    terrain.dispose();
  }
});
