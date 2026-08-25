import * as THREE from "three/webgpu";

const SIZE = 96;
const CHANNELS = 4;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function mod(value, maximum) {
  return ((value % maximum) + maximum) % maximum;
}

function hash(x, y, seed) {
  let value = (seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function noise(u, v, cells, seed) {
  const count = Math.max(1, Math.trunc(cells));
  const x = u * count;
  const y = v * count;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx0 = x - x0;
  const sy0 = y - y0;
  const sx = sx0 * sx0 * (3 - sx0 * 2);
  const sy = sy0 * sy0 * (3 - sy0 * 2);
  const sample = (px, py) => hash(mod(px, count), mod(py, count), seed);
  const a = THREE.MathUtils.lerp(sample(x0, y0), sample(x0 + 1, y0), sx);
  const b = THREE.MathUtils.lerp(sample(x0, y0 + 1), sample(x0 + 1, y0 + 1), sx);
  return THREE.MathUtils.lerp(a, b, sy);
}

function fbm(u, v, seed) {
  return noise(u, v, 3, seed) * 0.54 + noise(u, v, 9, seed ^ 0x52dce729) * 0.29 +
    noise(u, v, 27, seed ^ 0x7f4a7c15) * 0.17;
}

function profile(kind, u, v) {
  if (kind === "asphalt") {
    const broad = fbm(u, v, 0x41535048);
    const aggregate = noise(u, v, 43, 0x524f4144);
    const seam = Math.pow(Math.max(0, Math.cos((u * 5 + v * 2 + broad * 0.18) * Math.PI * 2)), 35);
    return {
      value: clamp01(0.78 + (broad - 0.5) * 0.22 + (aggregate - 0.5) * 0.1 - seam * 0.16),
      roughness: clamp01(0.63 + (aggregate - 0.5) * 0.25 - seam * 0.15),
      height: clamp01(0.5 + (broad - 0.5) * 0.16 + (aggregate - 0.5) * 0.11 - seam * 0.08),
    };
  }
  if (kind === "court") {
    const broad = fbm(u, v, 0x434f5552);
    const aggregate = noise(u, v, 47, 0x5041494e);
    const hairline = Math.pow(Math.max(0, Math.cos((u * 7.0 - v * 3.0 + broad * 0.11) * Math.PI * 2)), 78);
    const scuff = Math.pow(Math.max(0, noise(u, v, 13, 0x53435546) - 0.72), 2) * 3.6;
    return {
      value: clamp01(0.89 + (broad - 0.5) * 0.10 + (aggregate - 0.5) * 0.045 - scuff * 0.08),
      roughness: clamp01(0.66 + (aggregate - 0.5) * 0.16 + scuff * 0.18 - hairline * 0.08),
      height: clamp01(0.5 + (broad - 0.5) * 0.055 + (aggregate - 0.5) * 0.055 - hairline * 0.07),
    };
  }
  if (kind === "facade") {
    const broad = fbm(u, v, 0x46414345);
    const verticalJoint = Math.pow(Math.max(0, Math.cos(u * 8 * Math.PI)), 48);
    const horizontalJoint = Math.pow(Math.max(0, Math.cos(v * 14 * Math.PI)), 56);
    const streak = Math.pow(Math.max(0, noise(u, v, 7, 0x4752494d) - 0.68), 2) * 4;
    const joint = Math.max(verticalJoint, horizontalJoint);
    return {
      value: clamp01(0.88 + (broad - 0.5) * 0.13 - joint * 0.12 - streak * 0.12),
      roughness: clamp01(0.54 + (broad - 0.5) * 0.15 + joint * 0.16 + streak * 0.13),
      height: clamp01(0.54 + (broad - 0.5) * 0.08 - joint * 0.13 - streak * 0.04),
    };
  }
  if (kind === "brick") {
    const columns = 9;
    const rows = 18;
    const row = Math.floor(v * rows);
    const offsetU = u + (row % 2) * (0.5 / columns);
    const brickU = mod(offsetU * columns, 1);
    const brickV = mod(v * rows, 1);
    const horizontalMortar = Math.min(brickV, 1 - brickV);
    const verticalMortar = Math.min(brickU, 1 - brickU);
    const mortar = 1 - smoothThreshold(Math.min(horizontalMortar * 1.25, verticalMortar), 0.034, 0.078);
    const broad = fbm(offsetU, v, 0x42524943);
    const pitting = noise(offsetU, v, 41, 0x4d4f5254);
    return {
      value: clamp01(0.86 + (broad - 0.5) * 0.13 - mortar * 0.24 + (pitting - 0.5) * 0.045),
      roughness: clamp01(0.70 + (broad - 0.5) * 0.13 + mortar * 0.18),
      height: clamp01(0.61 + (broad - 0.5) * 0.07 - mortar * 0.34 + (pitting - 0.5) * 0.035),
    };
  }
  if (kind === "metal") {
    const broad = fbm(u, v, 0x4d455441);
    const scratch = Math.pow(Math.max(0, Math.cos((u * 31 - v * 5 + broad * 0.2) * Math.PI * 2)), 70);
    return {
      value: clamp01(0.9 + (broad - 0.5) * 0.1 - scratch * 0.2),
      roughness: clamp01(0.39 + (broad - 0.5) * 0.16 + scratch * 0.36),
      height: clamp01(0.51 + (broad - 0.5) * 0.05 - scratch * 0.16),
    };
  }
  const broad = fbm(u, v, 0x434f4e43);
  const pores = Math.max(0, 0.2 - noise(u, v, 39, 0x504f5245)) * 2.7;
  const stain = Math.pow(Math.max(0, noise(u, v, 6, 0x53544149) - 0.62), 2) * 2.1;
  return {
    value: clamp01(0.9 + (broad - 0.5) * 0.14 - pores * 0.19 - stain * 0.11),
    roughness: clamp01(0.72 + (broad - 0.5) * 0.15 + pores * 0.18 + stain * 0.12),
    height: clamp01(0.5 + (broad - 0.5) * 0.12 - pores * 0.18 - stain * 0.04),
  };
}

function smoothThreshold(value, edge0, edge1) {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function byte(value) {
  return Math.round(clamp01(value) * 255);
}

function makeTexture(data, kind, role, repeat) {
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `Neon City ${kind} ${role}`;
  texture.colorSpace = role === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function checksum(bytes) {
  return bytes.reduce((sum, value, index) => (sum + Math.imul(value, index + 1)) >>> 0, 0);
}

function makeInteriorTexture(data, width, height, styleName, role) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.name = `Neon City ${styleName} virtual interior ${role}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const INTERIOR_STYLES = Object.freeze([
  Object.freeze({
    name: "corporate",
    litWall: [116, 112, 96],
    darkWall: [8, 15, 21],
    floor: [24, 27, 28],
    furniture: [31, 34, 35],
    lamp: [242, 203, 139],
  }),
  Object.freeze({
    name: "residential",
    litWall: [128, 96, 70],
    darkWall: [13, 14, 20],
    floor: [43, 31, 27],
    furniture: [53, 36, 29],
    lamp: [246, 184, 112],
  }),
  Object.freeze({
    name: "studio",
    litWall: [101, 111, 108],
    darkWall: [8, 17, 19],
    floor: [25, 30, 31],
    furniture: [33, 40, 40],
    lamp: [209, 218, 196],
  }),
]);

function putPixel(target, width, height, x, y, rgba) {
  const px = Math.trunc(x);
  const py = Math.trunc(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return;
  const offset = (py * width + px) * CHANNELS;
  target[offset] = rgba[0];
  target[offset + 1] = rgba[1];
  target[offset + 2] = rgba[2];
  target[offset + 3] = rgba[3] ?? 255;
}

function fillRect(target, width, height, x, y, rectWidth, rectHeight, rgba) {
  const x0 = Math.max(0, Math.trunc(x));
  const y0 = Math.max(0, Math.trunc(y));
  const x1 = Math.min(width, Math.ceil(x + rectWidth));
  const y1 = Math.min(height, Math.ceil(y + rectHeight));
  for (let py = y0; py < y1; ++py) {
    for (let px = x0; px < x1; ++px) putPixel(target, width, height, px, py, rgba);
  }
}

/**
 * Creates the authored room atlas used by the facade interior-mapping shader.
 * It deliberately contains both occupied and dark rooms.  Furniture lives on
 * a second RGBA layer so the shader can project it at a shallower box depth
 * than the back wall, producing real view-dependent parallax without meshes.
 */
export function createInteriorTextureSet(style = 0, { roomCount = 8, roomWidth = 32, height = 64 } = {}) {
  const styleIndex = Math.trunc(Number(style));
  if (styleIndex < 0 || styleIndex >= INTERIOR_STYLES.length) {
    throw new RangeError(`Unknown virtual interior style: ${style}`);
  }
  const rooms = Math.max(4, Math.min(12, Math.trunc(Number(roomCount)) || 8));
  const cellWidth = Math.max(24, Math.min(48, Math.trunc(Number(roomWidth)) || 32));
  const atlasHeight = Math.max(48, Math.min(96, Math.trunc(Number(height)) || 64));
  const width = rooms * cellWidth;
  const profile = INTERIOR_STYLES[styleIndex];
  const albedoBytes = new Uint8Array(width * atlasHeight * CHANNELS);
  const emissiveBytes = new Uint8Array(width * atlasHeight * CHANNELS);
  const foregroundBytes = new Uint8Array(width * atlasHeight * CHANNELS);
  const foregroundEmissiveBytes = new Uint8Array(width * atlasHeight * CHANNELS);
  let litRooms = 0;
  let blindRooms = 0;
  let deskRooms = 0;
  let silhouettes = 0;

  for (let room = 0; room < rooms; ++room) {
    const roomX = room * cellWidth;
    const lit = ((room * 5 + styleIndex * 3 + 1) % 9) < (styleIndex === 1 ? 5 : 4);
    const blinds = (room + styleIndex * 2) % 4 === 1;
    const hasDesk = (room + styleIndex) % 5 !== 4;
    const hasSilhouette = lit && (room * 3 + styleIndex) % 7 === 0;
    if (lit) litRooms += 1;
    if (blinds) blindRooms += 1;
    if (hasDesk) deskRooms += 1;
    if (hasSilhouette) silhouettes += 1;

    for (let y = 0; y < atlasHeight; ++y) {
      const v = y / Math.max(1, atlasHeight - 1);
      for (let x = 0; x < cellWidth; ++x) {
        const u = x / Math.max(1, cellWidth - 1);
        const edgeShade = Math.min(u, 1 - u, v, 1 - v);
        const base = lit ? profile.litWall : profile.darkWall;
        const lightFalloff = lit ? 0.68 + v * 0.22 + Math.min(0.1, edgeShade * 0.65) : 0.72 + v * 0.12;
        let rgb = base.map(channel => Math.round(channel * lightFalloff));
        if (v > 0.82) rgb = profile.floor.map(channel => Math.round(channel * (lit ? 1 : 0.58)));
        // A back-wall division and ceiling/floor reveals make each atlas cell
        // read as a box rather than a luminous poster.
        const division = (room % 2 ? 0.34 : 0.66);
        if (Math.abs(u - division) < 0.025 || v < 0.035 || Math.abs(v - 0.82) < 0.018) {
          rgb = rgb.map(channel => Math.round(channel * 0.42));
        }
        if (blinds && v > 0.12 && v < 0.78 && y % 6 < 2) rgb = rgb.map(channel => Math.round(channel * 0.40));
        putPixel(albedoBytes, width, atlasHeight, roomX + x, y, [...rgb, 255]);
        const glow = lit && !(blinds && y % 6 < 2) ? profile.lamp.map(channel => Math.round(channel * (0.20 + v * 0.13))) : [0, 0, 0];
        putPixel(emissiveBytes, width, atlasHeight, roomX + x, y, [...glow, 255]);
      }
    }

    if (hasDesk) {
      fillRect(foregroundBytes, width, atlasHeight, roomX + cellWidth * 0.12, atlasHeight * 0.69,
        cellWidth * 0.75, atlasHeight * 0.075, [...profile.furniture, 235]);
      fillRect(foregroundBytes, width, atlasHeight, roomX + cellWidth * 0.18, atlasHeight * 0.75,
        cellWidth * 0.07, atlasHeight * 0.18, [...profile.furniture.map(value => Math.round(value * 0.72)), 235]);
      fillRect(foregroundBytes, width, atlasHeight, roomX + cellWidth * 0.72, atlasHeight * 0.75,
        cellWidth * 0.07, atlasHeight * 0.18, [...profile.furniture.map(value => Math.round(value * 0.72)), 235]);
      const monitorX = roomX + cellWidth * (room % 2 ? 0.25 : 0.57);
      fillRect(foregroundBytes, width, atlasHeight, monitorX, atlasHeight * 0.55,
        cellWidth * 0.18, atlasHeight * 0.13, [13, 19, 23, 250]);
      fillRect(foregroundEmissiveBytes, width, atlasHeight, monitorX + 1, atlasHeight * 0.57,
        cellWidth * 0.18 - 2, atlasHeight * 0.09, lit ? [76, 113, 125, 255] : [3, 7, 9, 255]);
    }
    if (hasSilhouette) {
      const centerX = roomX + cellWidth * (room % 2 ? 0.61 : 0.39);
      const headY = atlasHeight * 0.47;
      const radius = Math.max(2, Math.round(cellWidth * 0.07));
      for (let y = -radius; y <= radius; ++y) {
        for (let x = -radius; x <= radius; ++x) {
          if (x * x + y * y <= radius * radius) {
            putPixel(foregroundBytes, width, atlasHeight, centerX + x, headY + y, [8, 10, 12, 238]);
          }
        }
      }
      fillRect(foregroundBytes, width, atlasHeight, centerX - cellWidth * 0.08, headY + radius,
        cellWidth * 0.16, atlasHeight * 0.20, [8, 10, 12, 238]);
    }
    // Front-layer partition posts move less than the back wall, reinforcing
    // the room-box projection when the player passes a tower.
    const postX = roomX + cellWidth * (room % 3 === 0 ? 0.22 : 0.82);
    fillRect(foregroundBytes, width, atlasHeight, postX, 0, Math.max(1, cellWidth * 0.035), atlasHeight,
      [18, 23, 26, 245]);
  }

  const albedo = makeInteriorTexture(albedoBytes, width, atlasHeight, profile.name, "back-wall albedo");
  const emissive = makeInteriorTexture(emissiveBytes, width, atlasHeight, profile.name, "back-wall emission");
  const foreground = makeInteriorTexture(foregroundBytes, width, atlasHeight, profile.name, "furniture and silhouettes");
  const foregroundEmissive = makeInteriorTexture(foregroundEmissiveBytes, width, atlasHeight, profile.name, "screen emission");
  return Object.freeze({
    kind: "virtual-interior",
    style: profile.name,
    size: Object.freeze([width, atlasHeight]),
    roomCount: rooms,
    litRooms,
    unlitRooms: rooms - litRooms,
    blindRooms,
    deskRooms,
    silhouettes,
    albedo,
    emissive,
    foreground,
    foregroundEmissive,
    textures: Object.freeze([albedo, emissive, foreground, foregroundEmissive]),
    checksum: checksum(albedoBytes),
    layerChecksum: checksum(foregroundBytes),
  });
}

export function createSurfaceTextureSet(kind, { repeat = [6, 6], normalStrength = 2 } = {}) {
  if (!["asphalt", "concrete", "facade", "brick", "metal", "court"].includes(kind)) throw new RangeError(`Unknown surface texture kind: ${kind}`);
  const texels = SIZE * SIZE;
  const albedoBytes = new Uint8Array(texels * CHANNELS);
  const roughnessBytes = new Uint8Array(texels * CHANNELS);
  const normalBytes = new Uint8Array(texels * CHANNELS);
  const heights = new Float32Array(texels);
  for (let y = 0; y < SIZE; ++y) {
    for (let x = 0; x < SIZE; ++x) {
      const sample = profile(kind, (x + 0.5) / SIZE, (y + 0.5) / SIZE);
      const pixel = y * SIZE + x;
      const offset = pixel * CHANNELS;
      const value = byte(sample.value);
      albedoBytes[offset] = value;
      albedoBytes[offset + 1] = value;
      albedoBytes[offset + 2] = value;
      albedoBytes[offset + 3] = 255;
      const roughness = byte(sample.roughness);
      roughnessBytes[offset] = roughness;
      roughnessBytes[offset + 1] = roughness;
      roughnessBytes[offset + 2] = roughness;
      roughnessBytes[offset + 3] = 255;
      heights[pixel] = sample.height;
    }
  }
  const heightAt = (x, y) => heights[mod(y, SIZE) * SIZE + mod(x, SIZE)];
  for (let y = 0; y < SIZE; ++y) {
    for (let x = 0; x < SIZE; ++x) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * normalStrength;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * normalStrength;
      const inverse = 1 / Math.hypot(dx, dy, 1);
      const offset = (y * SIZE + x) * CHANNELS;
      normalBytes[offset] = byte(-dx * inverse * 0.5 + 0.5);
      normalBytes[offset + 1] = byte(-dy * inverse * 0.5 + 0.5);
      normalBytes[offset + 2] = byte(inverse * 0.5 + 0.5);
      normalBytes[offset + 3] = 255;
    }
  }
  const albedo = makeTexture(albedoBytes, kind, "albedo", repeat);
  const roughness = makeTexture(roughnessBytes, kind, "roughness", repeat);
  const normal = makeTexture(normalBytes, kind, "normal", repeat);
  return Object.freeze({
    kind,
    size: SIZE,
    albedo,
    roughness,
    normal,
    textures: Object.freeze([albedo, roughness, normal]),
    checksum: checksum(albedoBytes),
  });
}

export function applySurfaceTexture(material, textureSet, normalScale = 1) {
  if (!material || !textureSet) return material;
  material.map = textureSet.albedo;
  material.roughnessMap = textureSet.roughness;
  material.normalMap = textureSet.normal;
  material.normalScale = new THREE.Vector2(normalScale, normalScale);
  material.needsUpdate = true;
  return material;
}

export function disposeSurfaceTextureSets(textureSets) {
  const disposed = new Set();
  for (const textureSet of textureSets ?? []) {
    for (const texture of textureSet?.textures ?? []) {
      if (disposed.has(texture)) continue;
      disposed.add(texture);
      texture.dispose();
    }
  }
}
