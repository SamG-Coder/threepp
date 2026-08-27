/**
 * Punch a hot-pink studio backdrop out of generated cutout photographs.
 * The generator's magenta is never a perfect #FF00FF, so the test is a
 * red+blue versus green chroma gate rather than an exact colour match.
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

export function erodeAlpha(imageData, radius = 1) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  const next = new Uint8ClampedArray(data);
  const extent = Math.max(1, Math.trunc(radius));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index + 3] === 0) continue;
      let hole = false;
      for (let dy = -extent; dy <= extent && !hole; dy++) {
        for (let dx = -extent; dx <= extent; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            hole = true;
            break;
          }
          if (data[(ny * width + nx) * 4 + 3] === 0) {
            hole = true;
            break;
          }
        }
      }
      if (hole) next[index + 3] = 0;
    }
  }
  data.set(next);
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

export function cropImageData(imageData, bounds, padding = 2) {
  const pad = Math.max(0, Math.trunc(padding));
  const sourceWidth = imageData.width;
  const sourceHeight = imageData.height;
  const minX = Math.max(0, bounds.minX - pad);
  const minY = Math.max(0, bounds.minY - pad);
  const maxX = Math.min(sourceWidth - 1, bounds.maxX + pad);
  const maxY = Math.min(sourceHeight - 1, bounds.maxY + pad);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const cropped = new Uint8ClampedArray(width * height * 4);
  const source = imageData.data;
  for (let y = 0; y < height; y++) {
    const sourceRow = ((minY + y) * sourceWidth + minX) * 4;
    cropped.set(source.subarray(sourceRow, sourceRow + width * 4), y * width * 4);
  }
  return { data: cropped, width, height };
}

function makeCanvas(width, height) {
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  throw new Error("Secret River cutouts need a 2D canvas to key the studio backdrop.");
}

export function keyedCanvasFromImage(image, options = {}) {
  const sourceWidth = Math.max(1, image.width || image.displayWidth || 1);
  const sourceHeight = Math.max(1, image.height || image.displayHeight || 1);
  const sourceCanvas = makeCanvas(sourceWidth, sourceHeight);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  sourceContext.drawImage(image, 0, 0);
  const imageData = sourceContext.getImageData(0, 0, sourceWidth, sourceHeight);
  keyImageData(imageData, options);
  despillImageData(imageData);
  if (options.erode !== false) erodeAlpha(imageData, options.erode === true ? 1 : options.erode ?? 1);
  const bounds = alphaBounds(imageData);
  const cropped = cropImageData(imageData, bounds, options.padding ?? 2);
  const canvas = makeCanvas(cropped.width, cropped.height);
  const context = canvas.getContext("2d");
  const output = new ImageData(cropped.data, cropped.width, cropped.height);
  context.putImageData(output, 0, 0);
  return {
    canvas,
    width: cropped.width,
    height: cropped.height,
    aspect: cropped.width / Math.max(1, cropped.height),
    bounds,
  };
}
