import { deflateSync, inflateSync } from "node:zlib";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let value = n;
  for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[n] = value >>> 0;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 255;
  bytes[offset + 1] = (value >>> 16) & 255;
  bytes[offset + 2] = (value >>> 8) & 255;
  bytes[offset + 3] = value & 255;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(bytes, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const output = new Uint8Array(stride * height);
  let source = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = bytes[source++];
    const row = y * stride;
    const previous = y === 0 ? null : (y - 1) * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = bytes[source++];
      const left = x >= bytesPerPixel ? output[row + x - bytesPerPixel] : 0;
      const up = previous === null ? 0 : output[previous + x];
      const upLeft = previous === null || x < bytesPerPixel ? 0 : output[previous + x - bytesPerPixel];
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      output[row + x] = value & 255;
    }
  }
  return output;
}

function toRgba(raw, width, height, colorType, bitDepth, palette, transparency) {
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  const count = width * height;
  const data = new Uint8ClampedArray(count * 4);
  if (colorType === 6) {
    data.set(raw.subarray(0, count * 4));
    return data;
  }
  if (colorType === 2) {
    for (let i = 0, p = 0; i < count; i += 1, p += 3) {
      const o = i * 4;
      data[o] = raw[p];
      data[o + 1] = raw[p + 1];
      data[o + 2] = raw[p + 2];
      data[o + 3] = 255;
    }
    return data;
  }
  if (colorType === 0) {
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      const gray = raw[i];
      data[o] = gray;
      data[o + 1] = gray;
      data[o + 2] = gray;
      data[o + 3] = 255;
    }
    return data;
  }
  if (colorType === 4) {
    for (let i = 0, p = 0; i < count; i += 1, p += 2) {
      const o = i * 4;
      const gray = raw[p];
      data[o] = gray;
      data[o + 1] = gray;
      data[o + 2] = gray;
      data[o + 3] = raw[p + 1];
    }
    return data;
  }
  if (colorType === 3) {
    if (!palette) throw new Error("indexed PNG missing PLTE");
    for (let i = 0; i < count; i += 1) {
      const index = raw[i];
      const o = i * 4;
      const p = index * 3;
      data[o] = palette[p];
      data[o + 1] = palette[p + 1];
      data[o + 2] = palette[p + 2];
      data[o + 3] = transparency?.[index] ?? 255;
    }
    return data;
  }
  throw new Error(`unsupported PNG color type ${colorType}`);
}

export function decodePng(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG");
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const idat = [];
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error("truncated PNG chunk");
    const chunk = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = readUint32(chunk, 0);
      height = readUint32(chunk, 4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      if (chunk[10] !== 0) throw new Error("unsupported PNG compression");
      if (chunk[11] !== 0) throw new Error("unsupported PNG filter method");
      if (chunk[12] !== 0) throw new Error("interlaced PNG is not supported");
    } else if (type === "PLTE") {
      palette = Uint8Array.from(chunk);
    } else if (type === "tRNS") {
      transparency = Uint8Array.from(chunk);
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height) throw new Error("PNG missing IHDR");
  const compressedLength = idat.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let cursor = 0;
  for (const part of idat) {
    compressed.set(part, cursor);
    cursor += part.length;
  }
  const bytesPerPixel = colorType === 6 ? 4
    : colorType === 2 ? 3
      : colorType === 4 ? 2
        : 1;
  const inflated = inflateSync(compressed);
  const raw = unfilter(inflated, width, height, bytesPerPixel);
  return {
    width,
    height,
    data: toRgba(raw, width, height, colorType, bitDepth, palette, transparency),
  };
}

function appendChunk(chunks, type, data) {
  const typeBytes = Uint8Array.from(type, ch => ch.charCodeAt(0));
  const crcSource = new Uint8Array(typeBytes.length + data.length);
  crcSource.set(typeBytes, 0);
  crcSource.set(data, typeBytes.length);
  const header = new Uint8Array(8);
  writeUint32(header, 0, data.length);
  header.set(typeBytes, 4);
  const crc = new Uint8Array(4);
  writeUint32(crc, 0, crc32(crcSource));
  chunks.push(header, data, crc);
}

export function encodePng(width, height, rgba, { grayscale = false } = {}) {
  const w = Math.trunc(width);
  const h = Math.trunc(height);
  if (w < 1 || h < 1) throw new Error("PNG dimensions must be positive");
  const channels = grayscale ? 1 : 3;
  const stride = w * channels;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x += 1) {
      const s = (y * w + x) * 4;
      const d = row + 1 + x * channels;
      if (grayscale) {
        raw[d] = rgba[s];
      } else {
        raw[d] = rgba[s];
        raw[d + 1] = rgba[s + 1];
        raw[d + 2] = rgba[s + 2];
      }
    }
  }
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, w);
  writeUint32(ihdr, 4, h);
  ihdr[8] = 8;
  ihdr[9] = grayscale ? 0 : 2;
  const chunks = [Uint8Array.from(PNG_SIGNATURE)];
  appendChunk(chunks, "IHDR", ihdr);
  appendChunk(chunks, "IDAT", deflateSync(raw, { level: 6 }));
  appendChunk(chunks, "IEND", new Uint8Array(0));
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function rgbaToRgb(rgba) {
  const count = rgba.length / 4;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const s = i * 4;
    const d = i * 3;
    rgb[d] = rgba[s];
    rgb[d + 1] = rgba[s + 1];
    rgb[d + 2] = rgba[s + 2];
  }
  return rgb;
}

export function rgbToRgba(rgb, alpha = 255) {
  const count = rgb.length / 3;
  const rgba = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    const s = i * 3;
    const d = i * 4;
    rgba[d] = Math.max(0, Math.min(255, Math.round(rgb[s])));
    rgba[d + 1] = Math.max(0, Math.min(255, Math.round(rgb[s + 1])));
    rgba[d + 2] = Math.max(0, Math.min(255, Math.round(rgb[s + 2])));
    rgba[d + 3] = alpha;
  }
  return rgba;
}

export function grayToRgba(gray) {
  const count = gray.length;
  const rgba = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i += 1) {
    const value = gray[i];
    const d = i * 4;
    rgba[d] = value;
    rgba[d + 1] = value;
    rgba[d + 2] = value;
    rgba[d + 3] = 255;
  }
  return rgba;
}
