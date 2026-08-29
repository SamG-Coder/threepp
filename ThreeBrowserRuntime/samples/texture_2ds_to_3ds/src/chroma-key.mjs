/**
 * Punch a hot-magenta studio backdrop. Strict studio-magenta is keyed
 * globally; broader dusty-magenta cleanup remains border-connected.
 */

export function magentaKeyAlpha(r, g, b) {
  const red = Number(r) || 0;
  const green = Number(g) || 0;
  const blue = Number(b) || 0;
  const redDistance = (red - 224) / 64;
  const greenDistance = (green - 64) / 48;
  const blueDistance = (blue - 160) / 64;
  const nearStudioColor = redDistance * redDistance
    + greenDistance * greenDistance
    + blueDistance * blueDistance <= 1;
  return nearStudioColor
    && red >= 150
    && blue >= 105
    && red - green >= 40
    && blue - green >= 30
    && blue >= red * 0.52
    ? 0
    : 255;
}

function isMagentaCandidate(r, g, b) {
  return magentaKeyAlpha(r, g, b) === 0;
}

/** Dusty / anti-aliased cyclorama. Warm reds (low blue vs red) stay subject. */
function isNearMagenta(r, g, b) {
  const red = Number(r) || 0;
  const green = Number(g) || 0;
  const blue = Number(b) || 0;
  if (isMagentaCandidate(red, green, blue)) return true;
  const redLead = red - green;
  const blueLead = blue - green;
  return red > 48
    && blue > 38
    && green < 210
    && redLead > 8
    && blueLead > 8
    && redLead + blueLead > 18
    && blue >= red * 0.55;
}

function floodKeyedFromBorder(walkable, width, height) {
  const keyed = new Uint8Array(walkable.length);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (!walkable[i] || keyed[i]) return;
    keyed[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i / width) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  return keyed;
}

function closeKeyedHoles(keyed, width, height) {
  const fill = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (keyed[i]) continue;
      let hole = true;
      for (let oy = -1; oy <= 1 && hole; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (!keyed[ny * width + nx]) {
            hole = false;
            break;
          }
        }
      }
      if (hole) fill.push(i);
    }
  }
  for (const i of fill) keyed[i] = 1;
}

function watermarkCornerIsBackground(keyed, width, height, x0, y0) {
  if (keyed[(height - 1) * width + (width - 1)]) return true;
  let hits = 0;
  let cells = 0;
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      cells += 1;
      if (keyed[y * width + x]) hits += 1;
    }
  }
  return cells > 0 && hits * 2 >= cells;
}

function punchDisconnectedWatermark(keyed, width, height, x0, y0) {
  const protectedPixels = new Uint8Array(keyed.length);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (keyed[i] || protectedPixels[i]) return;
    protectedPixels[i] = 1;
    stack.push(i);
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= x0 && y >= y0) continue;
      if (!keyed[y * width + x]) push(x, y);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i / width) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  for (let y = y0; y < height; y++) {
    for (let x = x0; x < width; x++) {
      const i = y * width + x;
      if (!protectedPixels[i]) keyed[i] = 1;
    }
  }
}

export function keyImageData(imageData, options = {}) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const count = width * height;
  const strict = new Uint8Array(count);
  const walkable = new Uint8Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    strict[i] = isMagentaCandidate(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
    walkable[i] = data[p + 3] === 0 || strict[i] || isNearMagenta(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
  }

  const borderKeyed = floodKeyedFromBorder(walkable, width, height);
  const keyed = borderKeyed.slice();
  for (let i = 0; i < count; i++) {
    if (strict[i]) keyed[i] = 1;
  }
  if (options.close !== false) closeKeyedHoles(keyed, width, height);

  if (options.watermark !== false) {
    const watermarkWidth = Math.max(1, Math.floor(width * (options.watermarkWidth ?? 0.24)));
    const watermarkHeight = Math.max(1, Math.floor(height * (options.watermarkHeight ?? 0.075)));
    const x0 = width - watermarkWidth;
    const y0 = height - watermarkHeight;
    if (watermarkCornerIsBackground(borderKeyed, width, height, x0, y0)) {
      punchDisconnectedWatermark(keyed, width, height, x0, y0);
    }
  }

  for (let i = 0, p = 3; i < count; i++, p += 4) {
    data[p] = keyed[i] ? 0 : 255;
  }
  return imageData;
}

export function despillImageData(imageData) {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index + 3] === 0) continue;
      let border = false;
      for (let oy = -1; oy <= 1 && !border; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (data[(ny * width + nx) * 4 + 3] === 0) {
            border = true;
            break;
          }
        }
      }
      if (!border) continue;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const mag = Math.max(0, (red + blue) * 0.5 - green);
      if (mag < 10) continue;
      const pull = Math.min(mag * 0.85, 70);
      data[index] = Math.max(0, red - pull);
      data[index + 2] = Math.max(0, blue - pull * 0.7);
    }
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
