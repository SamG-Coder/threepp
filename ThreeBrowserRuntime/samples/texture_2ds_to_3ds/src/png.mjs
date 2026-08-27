import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readUint32(bytes, offset) {
  return (
    (bytes[offset] << 24)
    | (bytes[offset + 1] << 16)
    | (bytes[offset + 2] << 8)
    | bytes[offset + 3]
  ) >>> 0;
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
  for (let y = 0; y < height; y++) {
    const filter = bytes[source++];
    const row = y * stride;
    const previous = y === 0 ? null : (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const raw = bytes[source++];
      const left = x >= bytesPerPixel ? output[row + x - bytesPerPixel] : 0;
      const up = previous === null ? 0 : output[previous + x];
      const upLeft = previous === null || x < bytesPerPixel
        ? 0
        : output[previous + x - bytesPerPixel];
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
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
    for (let i = 0, p = 0; i < count; i++, p += 3) {
      const o = i * 4;
      data[o] = raw[p];
      data[o + 1] = raw[p + 1];
      data[o + 2] = raw[p + 2];
      data[o + 3] = 255;
    }
    return data;
  }
  if (colorType === 0) {
    for (let i = 0; i < count; i++) {
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
    for (let i = 0, p = 0; i < count; i++, p += 2) {
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
    for (let i = 0; i < count; i++) {
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
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
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
