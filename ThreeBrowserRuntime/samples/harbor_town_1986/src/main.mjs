import * as THREE from "three/webgpu";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { reconstructOrbitAsset, assetReport } from "../../texture_2ds_to_3ds/src/tree-asset.mjs";
import { realWorldScale } from "../../texture_2ds_to_3ds/src/real-scale.mjs";
import { worldToPixel } from "../../texture_2ds_to_3ds/src/silhouette.mjs";
import { INSTANCES, ORBIT_SUBJECTS, WORLD_ASSEMBLIES } from "./catalog.mjs";
import { GROUND, SPAWN, clampWalk, groundHeight, pavedSurfaceHeight, walkSurfaceHeight } from "./map.mjs";
import { footprintSeatY } from "./placement.mjs";
import { buildAssetObstacles, resolveWalk } from "./collision.mjs";
import { addRoads } from "./roads.mjs";
import { advanceFly, normalizedControlKey } from "./fly-controls.mjs";
import { assessReconstruction } from "./asset-quality.mjs";
import { reconstructionOptionsFor } from "./asset-pipeline.mjs";
import { cleanupReconstructionMesh } from "./reconstruction-cleanup.mjs";
import { createAmbientLife } from "./ambient-life.mjs";
import { createAmbientMotion } from "./ambient-motion.mjs";

document.title = "Minamihama 1986 — ThreeBrowser Runtime";

let installedStaticObstacles = Object.freeze([]);
const EYE = 1.62;
const ORBIT_ATLAS_TILE_SIZE = 256;
// Sixteen base-level texels remain a two-texel guard at mip level 3. The
// manual chain stops there and caps anisotropy at four, so even the widest
// filter footprint stays inside its camera tile while retaining 224 px detail.
const ORBIT_ATLAS_GUTTER = 16;
const ORBIT_ATLAS_MIP_LEVELS = 4;
const ORBIT_ATLAS_MAX_ANISOTROPY = 4;
const PHOTO_PROJECTION_MIN_FACING = 0.18;
const PHOTO_ALPHA_THRESHOLD = 12;

const GROUND_TILE_FILES = Object.freeze({
  asphalt: "asphalt.png",
  sidewalk: "sidewalk-concrete.png",
  grass: "grass-earth.png",
  dock: "dock-concrete.png",
  water: "harbor-water.png",
  yokobori: "yokobori-paving.png",
  whitePaint: "road-white-paint.png",
  yellowPaint: "road-yellow-paint.png",
});

const PATCH_TILE = Object.freeze({
  asphalt: { texture: "asphalt", metres: 3.2 },
  sidewalkN: { texture: "sidewalk", metres: 2 },
  sidewalkS: { texture: "sidewalk", metres: 2 },
  alley: { texture: "yokobori", metres: 2.4 },
  park: { texture: "grass", metres: 3 },
  dock: { texture: "dock", metres: 3 },
  water: { texture: "water", metres: 8 },
  route16Road: { texture: "asphalt", metres: 3.2 },
  route16Quay: { texture: "asphalt", metres: 3.2 },
  route16Lot: { texture: "dock", metres: 3 },
  route16Walk: { texture: "sidewalk", metres: 2 },
});

function resolveWalkPosition(fromX, fromZ, targetX, targetZ) {
  return resolveWalk(
    { x: fromX, z: fromZ },
    { x: targetX, z: targetZ },
    installedStaticObstacles,
    clampWalk,
  );
}

function atlasGrid(viewCount) {
  const count = Math.max(1, viewCount);
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : 4;
  return { columns, rows: Math.ceil(count / columns) };
}

function sampleSourceRgb(view, x, y, target, offset) {
  if (!view?.data || x < -0.5 || y < -0.5 || x > view.width - 0.5 || y > view.height - 0.5) {
    return false;
  }
  const x0 = Math.min(view.width - 1, Math.max(0, Math.floor(x)));
  const y0 = Math.min(view.height - 1, Math.max(0, Math.floor(y)));
  const x1 = Math.min(view.width - 1, x0 + 1);
  const y1 = Math.min(view.height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, x - x0));
  const ty = Math.min(1, Math.max(0, y - y0));
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;
  let sampleWeight = (1 - tx) * (1 - ty);
  let source = (y0 * view.width + x0) * 4;
  let alpha = view.data[source + 3] / 255;
  if (sampleWeight > 0 && alpha * 255 > PHOTO_ALPHA_THRESHOLD) {
    let resolvedWeight = sampleWeight * alpha;
    red += view.data[source] * resolvedWeight;
    green += view.data[source + 1] * resolvedWeight;
    blue += view.data[source + 2] * resolvedWeight;
    weight += resolvedWeight;
  }
  sampleWeight = tx * (1 - ty);
  source = (y0 * view.width + x1) * 4;
  alpha = view.data[source + 3] / 255;
  if (sampleWeight > 0 && alpha * 255 > PHOTO_ALPHA_THRESHOLD) {
    let resolvedWeight = sampleWeight * alpha;
    red += view.data[source] * resolvedWeight;
    green += view.data[source + 1] * resolvedWeight;
    blue += view.data[source + 2] * resolvedWeight;
    weight += resolvedWeight;
  }
  sampleWeight = (1 - tx) * ty;
  source = (y1 * view.width + x0) * 4;
  alpha = view.data[source + 3] / 255;
  if (sampleWeight > 0 && alpha * 255 > PHOTO_ALPHA_THRESHOLD) {
    let resolvedWeight = sampleWeight * alpha;
    red += view.data[source] * resolvedWeight;
    green += view.data[source + 1] * resolvedWeight;
    blue += view.data[source + 2] * resolvedWeight;
    weight += resolvedWeight;
  }
  sampleWeight = tx * ty;
  source = (y1 * view.width + x1) * 4;
  alpha = view.data[source + 3] / 255;
  if (sampleWeight > 0 && alpha * 255 > PHOTO_ALPHA_THRESHOLD) {
    let resolvedWeight = sampleWeight * alpha;
    red += view.data[source] * resolvedWeight;
    green += view.data[source + 1] * resolvedWeight;
    blue += view.data[source + 2] * resolvedWeight;
    weight += resolvedWeight;
  }
  if (weight <= 1e-6) return false;
  target[offset] = Math.round(red / weight);
  target[offset + 1] = Math.round(green / weight);
  target[offset + 2] = Math.round(blue / weight);
  return true;
}

/**
 * Downsample one keyed Grok still, then deterministically extend its edge
 * colours through keyed background. The reconstructed mesh owns opacity and
 * silhouette, so this padding avoids magenta/transparent seams without adding
 * any non-Grok surface colour.
 */
function paddedViewTile(view, size) {
  const rgb = new Uint8Array(size * size * 3);
  const filled = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let tail = 0;
  for (let y = 0; y < size; y++) {
    const sourceY = size > 1 ? y * (view.height - 1) / (size - 1) : 0;
    for (let x = 0; x < size; x++) {
      const sourceX = size > 1 ? x * (view.width - 1) / (size - 1) : 0;
      const index = y * size + x;
      if (!sampleSourceRgb(view, sourceX, sourceY, rgb, index * 3)) continue;
      filled[index] = 1;
      queue[tail++] = index;
    }
  }
  if (tail === 0) return null;

  let head = 0;
  const visit = (index, neighbour) => {
    if (neighbour < 0 || neighbour >= filled.length || filled[neighbour]) return;
    const x = index % size;
    const neighbourX = neighbour % size;
    if (Math.abs(x - neighbourX) > 1) return;
    filled[neighbour] = 1;
    const source = index * 3;
    const destination = neighbour * 3;
    rgb[destination] = rgb[source];
    rgb[destination + 1] = rgb[source + 1];
    rgb[destination + 2] = rgb[source + 2];
    queue[tail++] = neighbour;
  };
  while (head < tail) {
    const index = queue[head++];
    visit(index, index - 1);
    visit(index, index + 1);
    visit(index, index - size);
    visit(index, index + size);
  }
  return rgb;
}

function downsampleRgbTile(source, sourceSize) {
  const size = Math.max(1, Math.floor(sourceSize / 2));
  const target = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    const y0 = Math.min(sourceSize - 1, y * 2);
    const y1 = Math.min(sourceSize - 1, y0 + 1);
    for (let x = 0; x < size; x++) {
      const x0 = Math.min(sourceSize - 1, x * 2);
      const x1 = Math.min(sourceSize - 1, x0 + 1);
      const destination = (y * size + x) * 3;
      const topLeft = (y0 * sourceSize + x0) * 3;
      const topRight = (y0 * sourceSize + x1) * 3;
      const bottomLeft = (y1 * sourceSize + x0) * 3;
      const bottomRight = (y1 * sourceSize + x1) * 3;
      for (let channel = 0; channel < 3; channel++) {
        target[destination + channel] = Math.round(
          (source[topLeft + channel]
            + source[topRight + channel]
            + source[bottomLeft + channel]
            + source[bottomRight + channel]) * 0.25,
        );
      }
    }
  }
  return target;
}

function createAtlasMipLevel(tiles, columns, rows, tileSize, gutter) {
  const innerSize = tileSize - gutter * 2;
  const width = columns * tileSize;
  const height = rows * tileSize;
  const data = new Uint8Array(width * height * 4);
  data.fill(255);
  for (let viewIndex = 0; viewIndex < tiles.length; viewIndex++) {
    const tile = tiles[viewIndex];
    if (!tile) continue;
    const column = viewIndex % columns;
    const row = Math.floor(viewIndex / columns);
    for (let y = 0; y < tileSize; y++) {
      const sourceY = Math.min(innerSize - 1, Math.max(0, y - gutter));
      for (let x = 0; x < tileSize; x++) {
        const sourceX = Math.min(innerSize - 1, Math.max(0, x - gutter));
        const source = (sourceY * innerSize + sourceX) * 3;
        const destination = ((row * tileSize + y) * width + column * tileSize + x) * 4;
        data[destination] = tile[source];
        data[destination + 1] = tile[source + 1];
        data[destination + 2] = tile[source + 2];
        data[destination + 3] = 255;
      }
    }
  }
  return { data, width, height };
}

function createOrbitPhotoAtlas(views, name, anisotropy = 1) {
  const { columns, rows } = atlasGrid(views.length);
  const tileSize = ORBIT_ATLAS_TILE_SIZE;
  const gutter = ORBIT_ATLAS_GUTTER;
  const innerSize = tileSize - gutter * 2;
  const available = new Uint8Array(views.length);
  let tiles = new Array(views.length);
  for (let viewIndex = 0; viewIndex < views.length; viewIndex++) {
    tiles[viewIndex] = paddedViewTile(views[viewIndex], innerSize);
    if (!tiles[viewIndex]) continue;
    available[viewIndex] = 1;
  }

  const mipmaps = [];
  let mipTileSize = tileSize;
  let mipGutter = gutter;
  for (let level = 0; level < ORBIT_ATLAS_MIP_LEVELS; level++) {
    mipmaps.push(createAtlasMipLevel(tiles, columns, rows, mipTileSize, mipGutter));
    if (level + 1 >= ORBIT_ATLAS_MIP_LEVELS) break;
    const sourceSize = mipTileSize - mipGutter * 2;
    tiles = tiles.map(tile => tile ? downsampleRgbTile(tile, sourceSize) : null);
    mipTileSize = Math.max(1, Math.floor(mipTileSize / 2));
    mipGutter = Math.max(1, Math.floor(mipGutter / 2));
  }

  const base = mipmaps[0];
  const texture = new THREE.DataTexture(base.data, base.width, base.height, THREE.RGBAFormat);
  texture.mipmaps = mipmaps;
  texture.name = `${name} Grok orbit atlas`;
  texture.colorSpace = THREE.SRGBColorSpace;
  // The atlas buffer is conventional top-row-first image data. DataTexture
  // defaults to false, which would invert it under the native WebGPU path.
  texture.flipY = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = Math.max(1, Math.min(
    ORBIT_ATLAS_MAX_ANISOTROPY,
    Math.floor(Number(anisotropy) || 1),
  ));
  // Auto-generation would filter across tile boundaries; the array above is
  // the complete, independently downsampled, tile-isolated chain.
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return {
    texture,
    width: base.width,
    height: base.height,
    columns,
    tileSize,
    gutter,
    innerSize,
    available,
  };
}

function sourcePixelCovered(view, pixel) {
  if (!view?.data || pixel.x < -0.5 || pixel.y < -0.5
    || pixel.x > view.width - 0.5 || pixel.y > view.height - 0.5) {
    return false;
  }
  const x0 = Math.min(view.width - 1, Math.max(0, Math.floor(pixel.x)));
  const y0 = Math.min(view.height - 1, Math.max(0, Math.floor(pixel.y)));
  const x1 = Math.min(view.width - 1, x0 + 1);
  const y1 = Math.min(view.height - 1, y0 + 1);
  return [
    (y0 * view.width + x0) * 4 + 3,
    (y0 * view.width + x1) * 4 + 3,
    (y1 * view.width + x0) * 4 + 3,
    (y1 * view.width + x1) * 4 + 3,
  ].some(index => view.data[index] > PHOTO_ALPHA_THRESHOLD);
}

function volumeOccludesPoint(volume, point, view) {
  if (!volume?.occupancy?.length || !volume?.size || !volume?.min) return false;
  const { occupancy, min, size } = volume;
  const resolution = Math.trunc(Number(volume.resolution));
  if (!(resolution > 0)
    || occupancy.length < resolution ** 3
    || Array.from(size).some(axis => !(Number(axis) > 0))
    || Array.from(min).some(axis => !Number.isFinite(Number(axis)))) return false;

  const origin = [Number(point.x), Number(point.y), Number(point.z)];
  const direction = [
    Number(view?.basis?.position?.[0]),
    Number(view?.basis?.position?.[1]),
    Number(view?.basis?.position?.[2]),
  ];
  if (![...origin, ...direction].every(Number.isFinite)) return false;
  const directionLength = Math.hypot(...direction);
  if (directionLength <= 1e-8) return false;
  for (let axis = 0; axis < 3; axis++) direction[axis] /= directionLength;

  let enter = -Infinity;
  let exit = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    const lower = min[axis];
    const upper = min[axis] + size[axis];
    if (Math.abs(direction[axis]) <= 1e-10) {
      if (origin[axis] < lower || origin[axis] > upper) return false;
      continue;
    }
    let near = (lower - origin[axis]) / direction[axis];
    let far = (upper - origin[axis]) / direction[axis];
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return false;
  }

  const cell = size.map(axis => axis / resolution);
  const nudge = Math.max(1e-8, Math.min(...cell) * 1e-5);
  let distance = Math.max(0, enter) + nudge;
  const lastDistance = exit - nudge;
  if (!(lastDistance > distance)) return false;

  const voxel = origin.map((value, axis) => Math.min(
    resolution - 1,
    Math.max(0, Math.floor((value + direction[axis] * distance - min[axis]) / cell[axis])),
  ));
  const step = direction.map(value => value > 1e-10 ? 1 : value < -1e-10 ? -1 : 0);
  const nextCrossing = step.map((axisStep, axis) => {
    if (axisStep === 0) return Infinity;
    const boundary = min[axis] + (voxel[axis] + (axisStep > 0 ? 1 : 0)) * cell[axis];
    return (boundary - origin[axis]) / direction[axis];
  });
  const crossingDelta = direction.map((value, axis) => (
    Math.abs(value) > 1e-10 ? cell[axis] / Math.abs(value) : Infinity
  ));

  // Amanatides-Woo traversal visits every crossed voxel exactly once, up to
  // the AABB exit. Initial connected matter is the source surface itself; a
  // later occupied cell after air is a genuine occluder between it and camera.
  let reachedAir = false;
  while (distance <= lastDistance
    && voxel.every(index => index >= 0 && index < resolution)) {
    const occupied = occupancy[
      voxel[0] + voxel[1] * resolution + voxel[2] * resolution * resolution
    ] !== 0;
    if (!occupied) {
      reachedAir = true;
    } else if (reachedAir) {
      return true;
    }

    const nextDistance = Math.min(...nextCrossing);
    if (!Number.isFinite(nextDistance) || nextDistance > lastDistance) break;
    const tolerance = Math.max(1e-9, Math.abs(nextDistance) * 1e-10);
    for (let axis = 0; axis < 3; axis++) {
      if (nextCrossing[axis] <= nextDistance + tolerance) {
        voxel[axis] += step[axis];
        nextCrossing[axis] += crossingDelta[axis];
      }
    }
    distance = nextDistance;
  }
  return false;
}

function triangleProjection(mesh, sourceIndices, views, atlas, volume) {
  const a = sourceIndices[0] * 3;
  const b = sourceIndices[1] * 3;
  const c = sourceIndices[2] * 3;
  const abx = mesh.positions[b] - mesh.positions[a];
  const aby = mesh.positions[b + 1] - mesh.positions[a + 1];
  const abz = mesh.positions[b + 2] - mesh.positions[a + 2];
  const acx = mesh.positions[c] - mesh.positions[a];
  const acy = mesh.positions[c + 1] - mesh.positions[a + 1];
  const acz = mesh.positions[c + 2] - mesh.positions[a + 2];
  let nx = aby * acz - abz * acy;
  let ny = abz * acx - abx * acz;
  let nz = abx * acy - aby * acx;
  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength <= 1e-8) return null;
  nx /= normalLength;
  ny /= normalLength;
  nz /= normalLength;
  const center = {
    x: (mesh.positions[a] + mesh.positions[b] + mesh.positions[c]) / 3,
    y: (mesh.positions[a + 1] + mesh.positions[b + 1] + mesh.positions[c + 1]) / 3,
    z: (mesh.positions[a + 2] + mesh.positions[b + 2] + mesh.positions[c + 2]) / 3,
  };

  let attemptedViews = 0;
  for (let attempt = 0; attempt < views.length; attempt++) {
    let candidate = null;
    for (let viewIndex = 0; viewIndex < views.length; viewIndex++) {
      if ((attemptedViews & (1 << viewIndex)) !== 0 || !atlas.available[viewIndex]) continue;
      const view = views[viewIndex];
      const facing = nx * view.basis.position[0] + ny * view.basis.position[1] + nz * view.basis.position[2];
      if (!candidate || facing > candidate.facing) candidate = { view, viewIndex, facing };
    }
    if (!candidate || candidate.facing < PHOTO_PROJECTION_MIN_FACING) break;
    attemptedViews |= 1 << candidate.viewIndex;
    const pixels = sourceIndices.map(index => worldToPixel(
      candidate.view,
      mesh.positions[index * 3],
      mesh.positions[index * 3 + 1],
      mesh.positions[index * 3 + 2],
    ));
    const centerPixel = worldToPixel(candidate.view, center.x, center.y, center.z);
    if (!sourcePixelCovered(candidate.view, centerPixel)
      || pixels.some(pixel => !sourcePixelCovered(candidate.view, pixel))) {
      continue;
    }
    if (volumeOccludesPoint(volume, center, candidate.view)) continue;
    return { ...candidate, pixels };
  }
  return null;
}

function atlasUv(atlas, view, viewIndex, pixel) {
  const column = viewIndex % atlas.columns;
  const row = Math.floor(viewIndex / atlas.columns);
  const sourceU = Math.min(1, Math.max(0, pixel.x / Math.max(1, view.width - 1)));
  const sourceV = Math.min(1, Math.max(0, pixel.y / Math.max(1, view.height - 1)));
  const atlasX = column * atlas.tileSize + atlas.gutter + sourceU * (atlas.innerSize - 1);
  const atlasY = row * atlas.tileSize + atlas.gutter + sourceV * (atlas.innerSize - 1);
  return [
    (atlasX + 0.5) / atlas.width,
    1 - (atlasY + 0.5) / atlas.height,
  ];
}

/**
 * Split vertices only where adjacent triangles select different source views.
 * Photo-backed triangles are ordered first and fallback triangles second so a
 * two-material mesh can retain deterministic vertex colours wherever a camera
 * view did not actually cover the reconstructed surface.
 */
function createPhotoProjectedGeometry(mesh, views, atlas, volume) {
  const positions = [];
  const normals = [];
  const colors = [];
  const uvs = [];
  const photoIndices = [];
  const fallbackIndices = [];
  const vertices = new Map();

  const vertexFor = (sourceIndex, projection, projectedPixel) => {
    const key = projection ? `p${projection.viewIndex}:${sourceIndex}` : `f:${sourceIndex}`;
    if (vertices.has(key)) return vertices.get(key);
    const index = positions.length / 3;
    vertices.set(key, index);
    const position = sourceIndex * 3;
    positions.push(
      mesh.positions[position],
      mesh.positions[position + 1],
      mesh.positions[position + 2],
    );
    normals.push(
      mesh.normals[position],
      mesh.normals[position + 1],
      mesh.normals[position + 2],
    );
    colors.push(
      mesh.colors[position],
      mesh.colors[position + 1],
      mesh.colors[position + 2],
    );
    if (projection) {
      const uv = atlasUv(atlas, projection.view, projection.viewIndex, projectedPixel);
      uvs.push(uv[0], uv[1]);
    } else {
      uvs.push(mesh.uvs[sourceIndex * 2], mesh.uvs[sourceIndex * 2 + 1]);
    }
    return index;
  };

  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const sourceIndices = [mesh.indices[offset], mesh.indices[offset + 1], mesh.indices[offset + 2]];
    const projection = triangleProjection(
      mesh,
      sourceIndices,
      views,
      atlas,
      volume,
    );
    const target = projection ? photoIndices : fallbackIndices;
    for (let corner = 0; corner < 3; corner++) {
      target.push(vertexFor(
        sourceIndices[corner],
        projection,
        projection?.pixels[corner],
      ));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.Uint32BufferAttribute([...photoIndices, ...fallbackIndices], 1));
  if (photoIndices.length) geometry.addGroup(0, photoIndices.length, 0);
  if (fallbackIndices.length) {
    geometry.addGroup(photoIndices.length, fallbackIndices.length, photoIndices.length ? 1 : 0);
  }
  geometry.computeBoundingSphere();
  return {
    geometry,
    photoTriangles: photoIndices.length / 3,
    fallbackTriangles: fallbackIndices.length / 3,
  };
}

function configureTiledTexture(source, width, depth, metresPerTile) {
  const texture = source.clone();
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(width / metresPerTile, depth / metresPerTile);
  texture.needsUpdate = true;
  return texture;
}

async function loadGroundTileTextures() {
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(Object.entries(GROUND_TILE_FILES).map(async ([key, filename]) => {
    const url = new URL(`../assets/ground-tiles/${filename}`, import.meta.url);
    try {
      const texture = await loader.loadAsync(url.href);
      texture.name = `Grok ground tile: ${filename}`;
      texture.colorSpace = THREE.SRGBColorSpace;
      return [key, texture];
    } catch (cause) {
      throw new Error(
        `Required Grok-authored ground image is missing or unreadable: ${url.href}`,
        { cause },
      );
    }
  }));
  return Object.fromEntries(entries);
}

function addGroundPatch(scene, name, spec, textures) {
  const width = spec.maxX - spec.minX;
  const depth = spec.maxZ - spec.minZ;
  const tile = PATCH_TILE[name];
  if (!tile || !textures[tile.texture]) {
    throw new Error(`No required Grok ground texture is configured for GROUND.${name}`);
  }
  const map = configureTiledTexture(textures[tile.texture], width, depth, tile.metres);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({
      name: `${name} Grok tile material`,
      map,
      color: 0xffffff,
      roughness: name === "water" ? 0.5 : 0.95,
      metalness: 0,
    }),
  );
  mesh.name = `${name} tiled ground`;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((spec.minX + spec.maxX) / 2, spec.y, (spec.minZ + spec.maxZ) / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return map;
}

async function createStudio(scene) {
  const textures = await loadGroundTileTextures();
  scene.background = new THREE.Color(0x8894a0);
  scene.fog = new THREE.Fog(0x8894a0, 28, 185);
  scene.add(new THREE.HemisphereLight(0xc5cdd4, 0x5c5a56, 1.42));
  const sun = new THREE.DirectionalLight(0xe4ddd2, 0.72);
  sun.position.set(-71, 18, 53);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 220;
  scene.add(sun);
  let waterMap = null;
  for (const [name, spec] of Object.entries(GROUND)) {
    const map = addGroundPatch(scene, name, spec, textures);
    if (name === "water") waterMap = map;
  }
  addRoads(scene, { THREE, pavedSurfaceHeight, textures });
  const terrainWidth = 800;
  const terrainDepth = 800;
  const terrainCenterZ = 80;
  // Two-metre square cells keep every three-metre terrace feather sampled even
  // when the authored house pad is rotated diagonally across the height field.
  const hill = new THREE.PlaneGeometry(terrainWidth, terrainDepth, 400, 400);
  hill.rotateX(-Math.PI / 2);
  const pos = hill.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i) + terrainCenterZ));
  }
  hill.computeVertexNormals();
  const terrainMap = configureTiledTexture(textures.grass, terrainWidth, terrainDepth, 3);
  const terrain = new THREE.Mesh(
    hill,
    new THREE.MeshStandardMaterial({
      name: "height field Grok grass-earth material",
      map: terrainMap,
      color: 0xffffff,
      roughness: 0.96,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  terrain.receiveShadow = true;
  terrain.name = "height field";
  terrain.position.z = terrainCenterZ;
  scene.add(terrain);
  if (!waterMap) throw new Error("GROUND.water is required for harbor-water UV animation");
  return {
    update(dt) {
      waterMap.offset.x = (waterMap.offset.x + dt * 0.0025) % 1;
      waterMap.offset.y = (waterMap.offset.y + dt * 0.004) % 1;
    },
  };
}

function plantMesh(proto, pose, label, subject) {
  const group = new THREE.Group();
  group.name = label;
  group.position.set(pose.x, footprintSeatY(pose, subject, walkSurfaceHeight), pose.z ?? 0);
  const object = new THREE.Mesh(proto.geometry, proto.material);
  object.name = label;
  object.scale.copy(proto.scale);
  object.position.y = proto.baseY;
  object.rotation.y = pose.yaw ?? 0;
  object.castShadow = true;
  object.receiveShadow = true;
  group.add(object);
  return group;
}

function missingAssemblyModules(assembly, prototypes) {
  return [...new Set(assembly.parts.map(part => part.module))]
    .filter(moduleId => {
      const proto = prototypes.get(moduleId);
      return !proto || proto.failed;
    });
}

function finitePartScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

/**
 * Create one logical object from reconstructed component meshes. Repeated parts
 * sharing a prototype are batched, while the root owns the authored world pose;
 * moving an assembly therefore moves and turns every component as one object.
 */
function plantAssembly(assembly, pose, label, prototypes) {
  const missing = missingAssemblyModules(assembly, prototypes);
  if (missing.length) return null;

  const placement = pose ?? assembly;
  const x = Number.isFinite(Number(placement.x)) ? Number(placement.x) : Number(assembly.x) || 0;
  const z = Number.isFinite(Number(placement.z)) ? Number(placement.z) : Number(assembly.z) || 0;
  const yaw = Number.isFinite(Number(placement.yaw)) ? Number(placement.yaw) : Number(assembly.yaw) || 0;
  const group = new THREE.Group();
  const resolvedLabel = label || assembly.label || assembly.id;
  group.name = resolvedLabel;
  group.position.set(x, footprintSeatY(placement, assembly, walkSurfaceHeight), z);
  group.rotation.y = yaw;

  const byModule = new Map();
  for (const part of assembly.parts) {
    const bucket = byModule.get(part.module) ?? [];
    bucket.push(part);
    byModule.set(part.module, bucket);
  }

  for (const [moduleId, parts] of byModule) {
    const proto = prototypes.get(moduleId);
    if (parts.length === 1) {
      const part = parts[0];
      const px = Number.isFinite(Number(part.x)) ? Number(part.x) : 0;
      const py = Number.isFinite(Number(part.y)) ? Number(part.y) : 0;
      const pz = Number.isFinite(Number(part.z)) ? Number(part.z) : 0;
      const partYaw = Number.isFinite(Number(part.yaw)) ? Number(part.yaw) : 0;
      const scaleX = finitePartScale(part.scaleX);
      const scaleY = finitePartScale(part.scaleY);
      const scaleZ = finitePartScale(part.scaleZ);
      const baseY = (Number.isFinite(Number(proto.baseY)) ? Number(proto.baseY) : 0) * scaleY;
      const object = new THREE.Mesh(proto.geometry, proto.material);
      object.name = part.label || `${resolvedLabel}: ${moduleId}`;
      object.scale.set(
        proto.scale.x * scaleX,
        proto.scale.y * scaleY,
        proto.scale.z * scaleZ,
      );
      object.position.set(px, py + baseY, pz);
      object.rotation.y = partYaw;
      object.castShadow = true;
      object.receiveShadow = true;
      group.add(object);
      continue;
    }

    const batch = new THREE.InstancedMesh(proto.geometry, proto.material, parts.length);
    batch.name = `${resolvedLabel}: ${moduleId} × ${parts.length}`;
    batch.castShadow = true;
    batch.receiveShadow = true;
    const transform = new THREE.Object3D();
    for (const [index, part] of parts.entries()) {
      const px = Number.isFinite(Number(part.x)) ? Number(part.x) : 0;
      const py = Number.isFinite(Number(part.y)) ? Number(part.y) : 0;
      const pz = Number.isFinite(Number(part.z)) ? Number(part.z) : 0;
      const partYaw = Number.isFinite(Number(part.yaw)) ? Number(part.yaw) : 0;
      const scaleX = finitePartScale(part.scaleX);
      const scaleY = finitePartScale(part.scaleY);
      const scaleZ = finitePartScale(part.scaleZ);
      const baseY = (Number.isFinite(Number(proto.baseY)) ? Number(proto.baseY) : 0) * scaleY;
      transform.position.set(px, py + baseY, pz);
      transform.rotation.set(0, partYaw, 0);
      transform.scale.set(
        proto.scale.x * scaleX,
        proto.scale.y * scaleY,
        proto.scale.z * scaleZ,
      );
      transform.updateMatrix();
      batch.setMatrixAt(index, transform.matrix);
    }
    batch.instanceMatrix.needsUpdate = true;
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    group.add(batch);
  }
  return group;
}

async function reconstructSubject(subject, atlasAnisotropy) {
  const options = reconstructionOptionsFor(subject, import.meta.url);
  const { catalog } = options;
  console.log(`[Minamihama] reconstructing ${subject.label}…`);
  const asset = await reconstructOrbitAsset(options);
  const cleanup = cleanupReconstructionMesh(asset.mesh);
  const report = assetReport({ ...asset, mesh: cleanup.mesh });
  const quality = assessReconstruction(report);
  console.log(
    `[Minamihama] ${subject.id}  shape=${report.kind}  views=${report.recommendedCount}  ${subject.realHeight}m  tris=${report.triangles}`,
  );
  if (!quality.ok) {
    console.warn(
      `[Minamihama] ${subject.id} orbit rejected (${quality.reasons.join(", ")}) — 3D asset omitted`,
    );
    return { failed: true, quality };
  }
  if (cleanup.stats.removedComponents > 0) {
    console.info(
      `[Minamihama] ${subject.id} pruned ${cleanup.stats.removedComponents} detached mesh island(s) / ${cleanup.stats.removedTriangles} tris`,
    );
  }
  const scale = realWorldScale(cleanup.mesh, subject);
  const atlas = createOrbitPhotoAtlas(asset.views, subject.label, atlasAnisotropy);
  const projection = createPhotoProjectedGeometry(cleanup.mesh, asset.views, atlas, asset.volume);
  const vertexColorMaterial = new THREE.MeshStandardMaterial({
    name: `${subject.label} photo isosurface`,
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    toneMapped: false,
    side: THREE.FrontSide,
  });
  let material = vertexColorMaterial;
  if (projection.photoTriangles > 0) {
    const photoMaterial = new THREE.MeshStandardMaterial({
      name: `${subject.label} direct Grok photo projection`,
      map: atlas.texture,
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    material = projection.fallbackTriangles > 0
      ? [photoMaterial, vertexColorMaterial]
      : photoMaterial;
  } else {
    atlas.texture.dispose();
  }
  console.info(
    `[Minamihama] ${subject.id} direct-photo atlas ${projection.photoTriangles} tris; vertex-colour fallback ${projection.fallbackTriangles} tris`,
  );
  return {
    geometry: projection.geometry,
    material,
    failed: false,
    quality,
    cleanup: cleanup.stats,
    scale: new THREE.Vector3(scale.x, scale.y, scale.z),
    baseY: -cleanup.groundBaseY * scale.y,
  };
}

function yieldToAnimationFrame() {
  return new Promise(resolve => globalThis.requestAnimationFrame(() => resolve()));
}

async function main() {
  if (!WebGPU.isAvailable()) {
    throw new Error("Minamihama 1986 requires native WebGPU.");
  }
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.background = "#8894a0";

  const renderer = new THREE.WebGPURenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(1.5, Math.max(1, Number(globalThis.devicePixelRatio || 1))));
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  renderer.setClearColor(0x8894a0, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const atlasAnisotropy = typeof renderer.getMaxAnisotropy === "function"
    ? renderer.getMaxAnisotropy()
    : 1;

  const scene = new THREE.Scene();
  scene.name = "Minamihama 1986";
  const groundSurfaces = await createStudio(scene);

  const camera = new THREE.PerspectiveCamera(55, innerWidth / Math.max(1, innerHeight), 0.12, 220);
  const walk = {
    x: SPAWN.x,
    y: walkSurfaceHeight(SPAWN.x, SPAWN.z) + EYE,
    z: SPAWN.z,
    yaw: SPAWN.yaw,
    pitch: SPAWN.pitch ?? 0,
    keys: new Set(),
    dragging: false,
    lastX: 0,
    lastY: 0,
  };

  function placeCamera() {
    const cp = Math.cos(walk.pitch);
    camera.position.set(walk.x, walk.y, walk.z);
    camera.lookAt(
      walk.x + Math.sin(walk.yaw) * cp,
      walk.y + Math.sin(walk.pitch),
      walk.z + Math.cos(walk.yaw) * cp,
    );
  }
  placeCamera();

  const prototypes = new Map();
  const subjectsById = new Map(ORBIT_SUBJECTS.map(subject => [subject.id, subject]));
  const assembliesById = new Map(WORLD_ASSEMBLIES.map(assembly => [assembly.id, assembly]));
  const assetDefinitionsById = new Map([...subjectsById, ...assembliesById]);

  function isAssetReady(assetId) {
    const subject = subjectsById.get(assetId);
    if (subject) {
      const proto = prototypes.get(assetId);
      return !subject.moduleOnly && Boolean(proto && !proto.failed);
    }
    const assembly = assembliesById.get(assetId);
    return Boolean(assembly && missingAssemblyModules(assembly, prototypes).length === 0);
  }

  function createAssetInstance(assetId, pose, label) {
    const subject = subjectsById.get(assetId);
    if (subject && !subject.moduleOnly) {
      const proto = prototypes.get(assetId);
      if (!proto || proto.failed) return null;
      return plantMesh(proto, pose, label || assetId, subject);
    }
    const assembly = assembliesById.get(assetId);
    if (!assembly) return null;
    return plantAssembly(assembly, pose, label || assembly.label, prototypes);
  }

  renderer.domElement.addEventListener("pointerdown", event => {
    event.preventDefault();
    walk.dragging = true;
    walk.lastX = event.clientX;
    walk.lastY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });
  renderer.domElement.addEventListener("pointerup", event => {
    walk.dragging = false;
    if (renderer.domElement.hasPointerCapture(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  });
  renderer.domElement.addEventListener("contextmenu", event => event.preventDefault());
  const stopDragging = () => { walk.dragging = false; };
  renderer.domElement.addEventListener("pointercancel", stopDragging);
  renderer.domElement.addEventListener("lostpointercapture", stopDragging);
  renderer.domElement.addEventListener("pointermove", event => {
    if (!walk.dragging) return;
    walk.yaw -= (event.clientX - walk.lastX) * 0.005;
    walk.pitch -= (event.clientY - walk.lastY) * 0.004;
    const pitchLimit = Math.PI * 0.5 - 0.035;
    walk.pitch = Math.min(pitchLimit, Math.max(-pitchLimit, walk.pitch));
    walk.lastX = event.clientX;
    walk.lastY = event.clientY;
    placeCamera();
  });
  const movementKeys = new Set(["w", "a", "s", "d", "space", "control", "shift"]);
  globalThis.addEventListener("keydown", event => {
    const key = normalizedControlKey(event);
    if (movementKeys.has(key)) event.preventDefault();
    walk.keys.add(key);
  });
  globalThis.addEventListener("keyup", event => {
    const key = normalizedControlKey(event);
    if (movementKeys.has(key)) event.preventDefault();
    walk.keys.delete(key);
  });
  globalThis.addEventListener("blur", () => {
    walk.keys.clear();
    walk.dragging = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) return;
    walk.keys.clear();
    walk.dragging = false;
  });
  globalThis.addEventListener("resize", () => {
    camera.aspect = innerWidth / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  let life = null;
  let motion = null;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(0.05, clock.getDelta());
    groundSurfaces.update(dt);
    life?.update(dt, camera);
    motion?.update(dt);
    const nextFly = advanceFly(walk, walk.keys, dt);
    if (nextFly.x !== walk.x || nextFly.y !== walk.y || nextFly.z !== walk.z) {
      walk.x = nextFly.x;
      walk.y = nextFly.y;
      walk.z = nextFly.z;
      placeCamera();
    }
    renderer.render(scene, camera);
  });

  for (const subject of ORBIT_SUBJECTS) {
    await yieldToAnimationFrame();
    let proto;
    try {
      proto = await reconstructSubject(subject, atlasAnisotropy);
    } catch (error) {
      console.error(`[Minamihama] ${subject.id} reconstruction failed; continuing asset stream`, error);
      proto = { failed: true, error };
    }
    prototypes.set(subject.id, proto);
    if (!proto.failed && !subject.ambientOnly && !subject.moduleOnly) {
      scene.add(plantMesh(proto, subject, subject.label, subject));
    }
  }

  await yieldToAnimationFrame();
  const installedAssemblies = [];
  for (const assembly of WORLD_ASSEMBLIES) {
    const missing = missingAssemblyModules(assembly, prototypes);
    if (missing.length) {
      console.warn(
        `[Minamihama] ${assembly.id} assembly omitted; required reconstructed module(s) unavailable: ${missing.join(", ")}`,
      );
      continue;
    }
    const object = plantAssembly(assembly, assembly, assembly.label, prototypes);
    if (!object) continue;
    scene.add(object);
    installedAssemblies.push(assembly);
    console.info(
      `[Minamihama] ${assembly.id} assembled from ${assembly.parts.length} reconstructed component(s)`,
    );
  }

  await yieldToAnimationFrame();
  for (const instance of INSTANCES) {
    const object = createAssetInstance(instance.asset, instance, `${instance.asset} instance`);
    if (object) scene.add(object);
  }

  const installedSubjects = ORBIT_SUBJECTS.filter(subject => {
    const proto = prototypes.get(subject.id);
    return !subject.moduleOnly && proto && !proto.failed;
  });
  const installedInstances = INSTANCES.filter(instance => isAssetReady(instance.asset));
  installedStaticObstacles = buildAssetObstacles(
    installedSubjects,
    installedInstances,
    installedAssemblies,
  );

  life = createAmbientLife({
    scene,
    surfaceHeight: walkSurfaceHeight,
    createAssetInstance,
    resolvePosition: resolveWalkPosition,
  });
  motion = createAmbientMotion({
    scene,
    groundHeight: walkSurfaceHeight,
    createAssetInstance,
    assetSubjects: assetDefinitionsById,
  });
  const counts = {
    standalone: installedSubjects.length,
    assemblies: installedAssemblies.length,
    walkers: life.counts.walkers,
    standing: life.counts.standing,
    van: motion.counts.van,
    boats: motion.counts.boats,
    gulls: motion.counts.gulls,
    signs: motion.counts.signs,
  };
  const expected = {
    standalone: 23,
    assemblies: 19,
    walkers: 6,
    standing: 4,
    van: 1,
    boats: 4,
    gulls: 3,
    signs: 2,
  };
  const populationSummary = `${counts.standalone} standalone reconstructed assets, `
    + `${counts.assemblies} modular assemblies, ${counts.walkers} walkers, `
    + `${counts.standing} standing civilians, ${counts.van} moving van, `
    + `${counts.boats} boats, ${counts.gulls} gulls, ${counts.signs} moving signs`;
  const complete = Object.entries(expected).every(([name, value]) => counts[name] === value);
  if (complete) {
    console.info(`[Minamihama] world ready: ${populationSummary}`);
  } else {
    const failedSubjects = ORBIT_SUBJECTS
      .filter(subject => prototypes.get(subject.id)?.failed)
      .map(subject => subject.id);
    console.error(
      `[Minamihama] world incomplete: ${populationSummary}; `
        + `failed reconstructed sources: ${failedSubjects.join(", ") || "none"}`,
    );
  }
}

main().catch(error => {
  console.error("[Minamihama]", error);
  throw error;
});
