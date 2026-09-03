import * as THREE from "three/webgpu";
import { createMappedMaterial } from "./materials.mjs";

const ROCK_ORDER = Object.freeze([
  "Wave Worn Slab",
  "Fractured Boulder",
  "Embedded Shore Wedge",
]);

export const ROCK_PROFILES = Object.freeze({
  "Wave Worn Slab": Object.freeze({ tile: "coastal-rock-slab", burial: 0.32 }),
  "Fractured Boulder": Object.freeze({ tile: "coastal-rock-boulder", burial: 0.38 }),
  "Embedded Shore Wedge": Object.freeze({ tile: "coastal-rock-wedge", burial: 0.48 }),
});

const normalizedName = value => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function applyBoxProjectedUvs(geometry, metersPerTile = 1) {
  const tile = Math.max(1e-4, metersPerTile);
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position || !normal || position.count < 1) return geometry;
  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    uv[i * 2] = (nx >= ny && nx >= nz ? z : x) / tile;
    uv[i * 2 + 1] = (ny >= nx && ny >= nz ? z : y) / tile;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.deleteAttribute("tangent");
  geometry.userData.boxProjectedUvs = true;
  return geometry;
}

function normalizeStudioGeometry(mesh) {
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  geometry.translate(
    -(bounds.min.x + bounds.max.x) * 0.5,
    -bounds.min.y,
    -(bounds.min.z + bounds.max.z) * 0.5,
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.studioRockSource = mesh.name;
  return applyBoxProjectedUvs(geometry);
}

function createRockMaterial(maps, name) {
  const profile = ROCK_PROFILES[name];
  const tile = maps[profile.tile] ?? maps["coastal-rock"];
  const material = createMappedMaterial(tile, {
    name: profile.tile,
    objectUv: true,
    uvScale: [1.15, 1.15],
    roughness: 0.8,
    normalScale: 1.22,
    roughnessFromHeight: true,
    roughnessHigh: 0.92,
    reflectionMask: 0.1,
  });
  material.side = THREE.FrontSide;
  material.transparent = false;
  material.opacity = 1;
  material.depthWrite = true;
  return material;
}

export function prepareStudioRockSet(source, maps) {
  source.updateMatrixWorld(true);
  const byName = new Map();
  const exportedMeshes = [];

  source.traverse(object => {
    if (!object.isMesh) return;
    const semanticName = ROCK_ORDER.find(name => normalizedName(name) === normalizedName(object.name));
    const profileName = semanticName ?? ROCK_ORDER[exportedMeshes.length];
    const rock = new THREE.Mesh(
      normalizeStudioGeometry(object),
      createRockMaterial(maps, profileName),
    );
    rock.name = object.name;
    rock.castShadow = true;
    rock.receiveShadow = true;
    rock.userData.studioAuthoredRock = true;
    rock.userData.burialFraction = ROCK_PROFILES[profileName]?.burial ?? 0.38;
    exportedMeshes.push(rock);
    byName.set(normalizedName(object.name), rock);
  });

  const namedRocks = ROCK_ORDER.map(name => byName.get(normalizedName(name))).filter(Boolean);
  const rocks = namedRocks.length === ROCK_ORDER.length ? namedRocks : exportedMeshes;
  if (rocks.length !== ROCK_ORDER.length) {
    throw new Error(`Studio coastal rock set is incomplete (${rocks.length}/${ROCK_ORDER.length})`);
  }
  return rocks;
}
