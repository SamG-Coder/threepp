/**
 * Punch a hot-magenta studio backdrop. Generated magenta is never a perfect
 * #FF00FF, so the test is a red+blue versus green chroma gate.
 */

export function magentaKeyAlpha(r, g, b) {
  const red = Number(r) || 0;
  const green = Number(g) || 0;
  const blue = Number(b) || 0;
  const magenta = (red - green) + (blue - green);
  if (red > 135 && blue > 55 && green < 175 && magenta > 95) return 0;
  if (
    red > 70
    && blue > 45
    && green < Math.min(red, blue) * 0.72
    && magenta > 60
  ) {
    return 0;
  }
  if (
    red > 90
    && blue > 70
    && green < 145
    && magenta > 40
    && Math.abs(red - blue) < 80
  ) {
    return 0;
  }
  return 255;
}

export function keyImageData(imageData, options = {}) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const watermarkWidth = Math.max(1, Math.floor(width * (options.watermarkWidth ?? 0.24)));
  const watermarkHeight = Math.max(1, Math.floor(height * (options.watermarkHeight ?? 0.075)));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      let alpha = magentaKeyAlpha(data[index], data[index + 1], data[index + 2]);
      if (x >= width - watermarkWidth && y >= height - watermarkHeight) alpha = 0;
      data[index + 3] = alpha;
    }
  }
  return imageData;
}

export function despillImageData(imageData) {
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const mag = Math.max(0, (red + blue) * 0.5 - green);
    if (mag < 10) continue;
    const pull = Math.min(mag * 0.85, 70);
    data[index] = Math.max(0, red - pull);
    data[index + 2] = Math.max(0, blue - pull * 0.7);
  }
  return imageData;
}

export function alphaBounds(imageData, threshold = 12) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, width, height };
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function occupancyFromRgba(data, width, height, threshold = 12) {
  const occupancy = new Uint8Array(width * height);
  for (let i = 0, p = 3; i < occupancy.length; i++, p += 4) {
    occupancy[i] = data[p] > threshold ? 1 : 0;
  }
  return occupancy;
}

export function downsampleOccupancy(occupancy, width, height, targetWidth, targetHeight) {
  const output = new Uint8Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y++) {
    const sourceY0 = Math.floor(y * height / targetHeight);
    const sourceY1 = Math.max(sourceY0 + 1, Math.floor((y + 1) * height / targetHeight));
    for (let x = 0; x < targetWidth; x++) {
      const sourceX0 = Math.floor(x * width / targetWidth);
      const sourceX1 = Math.max(sourceX0 + 1, Math.floor((x + 1) * width / targetWidth));
      let filled = 0;
      let count = 0;
      for (let sy = sourceY0; sy < sourceY1; sy++) {
        const row = sy * width;
        for (let sx = sourceX0; sx < sourceX1; sx++) {
          filled += occupancy[row + sx];
          count += 1;
        }
      }
      output[y * targetWidth + x] = filled * 2 >= count ? 1 : 0;
    }
  }
  return output;
}

export function trunkBaseX(occupancy, width, height, bounds) {
  const y0 = bounds.maxY - Math.max(2, Math.floor(bounds.height * 0.12));
  let sum = 0;
  let count = 0;
  for (let y = Math.max(bounds.minY, y0); y <= bounds.maxY; y++) {
    const row = y * width;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (!occupancy[row + x]) continue;
      sum += x;
      count += 1;
    }
  }
  if (count === 0) return (bounds.minX + bounds.maxX) * 0.5;
  return sum / count;
}
