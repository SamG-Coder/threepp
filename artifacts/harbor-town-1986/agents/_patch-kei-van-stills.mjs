/**
 * Flatten studio to #E040A0, punch Grok BR, seal glass leaks,
 * fill interior holes, eat dark contact-shadow between wheels.
 */
import { readFileSync, writeFileSync } from "node:fs";

const MAG = [0xe0, 0x40, 0xa0];
const GLASS = [78, 86, 94];
const W = 1024;
const H = 1024;

const src = process.argv[2];
const dst = process.argv[3];
const buf = Buffer.from(readFileSync(src));
if (buf.length !== W * H * 3) {
  throw new Error(`expected ${W * H * 3} bytes, got ${buf.length}`);
}

const idx = (x, y) => y * W + x;
const rgb = (i) => [buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2]];
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

function isNearMagenta(r, g, b) {
  const magenta = r - g + (b - g);
  if (r > 135 && b > 55 && g < 175 && magenta > 95) return true;
  if (r > 70 && b > 45 && g < Math.min(r, b) * 0.72 && magenta > 60) return true;
  if (r > 90 && b > 70 && g < 145 && magenta > 40 && Math.abs(r - b) < 80) return true;
  if (
    r > 48 &&
    b > 38 &&
    r + 8 >= g &&
    b * 2 > r &&
    g < 210 &&
    magenta > 18 &&
    r + b > g * 1.08
  ) {
    return true;
  }
  return false;
}

const count = W * H;
const mask = new Uint8Array(count);
for (let i = 0; i < count; i++) {
  const [r, g, b] = rgb(i);
  mask[i] = isNearMagenta(r, g, b) ? 0 : 1;
}

function dilate(srcMask, radius) {
  const out = new Uint8Array(srcMask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!srcMask[idx(x, y)]) continue;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= H) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= W) continue;
          out[idx(xx, yy)] = 1;
        }
      }
    }
  }
  return out;
}

function erode(srcMask, radius) {
  const out = new Uint8Array(srcMask);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!srcMask[idx(x, y)]) continue;
      let keep = 1;
      for (let oy = -radius; oy <= radius && keep; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= H) {
          keep = 0;
          break;
        }
        for (let ox = -radius; ox <= radius; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= W || !srcMask[idx(xx, yy)]) {
            keep = 0;
            break;
          }
        }
      }
      out[idx(x, y)] = keep;
    }
  }
  return out;
}

let work = erode(dilate(mask, 1), 1);
const preBox = bboxOf(work);
const holeYMax = preBox.maxY - Math.floor(preBox.h * 0.28);

const reached = new Uint8Array(count);
const stack = [];
const push0 = (x, y) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = idx(x, y);
  if (work[i] || reached[i]) return;
  reached[i] = 1;
  stack.push(i);
};
for (let x = 0; x < W; x++) {
  push0(x, 0);
  push0(x, H - 1);
}
for (let y = 1; y < H - 1; y++) {
  push0(0, y);
  push0(W - 1, y);
}
while (stack.length) {
  const i = stack.pop();
  const x = i % W;
  const y = (i / W) | 0;
  push0(x - 1, y);
  push0(x + 1, y);
  push0(x, y - 1);
  push0(x, y + 1);
}
let holes = 0;
for (let i = 0; i < count; i++) {
  const y = (i / W) | 0;
  if (!work[i] && !reached[i] && y < holeYMax) {
    work[i] = 1;
    holes++;
  }
}

function bboxOf(m) {
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!m[idx(x, y)]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function rowSpans(m, y, minX, maxX) {
  const spans = [];
  let s = -1;
  for (let x = minX; x <= maxX; x++) {
    const on = m[idx(x, y)];
    if (on && s < 0) s = x;
    if (!on && s >= 0) {
      spans.push([s, x - 1]);
      s = -1;
    }
  }
  if (s >= 0) spans.push([s, maxX]);
  return spans.filter(([a, b]) => b - a + 1 >= 12);
}

const box = bboxOf(work);
const keepW = Math.max(28, Math.floor(box.w * 0.16));
const zoneTop = box.maxY - Math.floor(box.h * 0.1);
let cleared = 0;
for (let y = zoneTop; y <= box.maxY; y++) {
  const spans = rowSpans(work, y, box.minX, box.maxX);
  if (spans.length === 1) {
    const [a, b] = spans[0];
    if (b - a + 1 < box.w * 0.4) continue;
    for (let x = a + keepW; x <= b - keepW; x++) {
      const i = idx(x, y);
      if (!work[i]) continue;
      if (luma(...rgb(i)) > 92) continue;
      work[i] = 0;
      cleared++;
    }
  } else if (spans.length >= 3) {
    for (let s = 1; s < spans.length - 1; s++) {
      const [a, b] = spans[s];
      for (let x = a; x <= b; x++) {
        const i = idx(x, y);
        if (!work[i]) continue;
        if (luma(...rgb(i)) > 92) continue;
        work[i] = 0;
        cleared++;
      }
    }
  }
}

const wmW = Math.floor(W * 0.28);
const wmH = Math.floor(H * 0.1);
for (let y = H - wmH; y < H; y++) {
  for (let x = W - wmW; x < W; x++) work[idx(x, y)] = 0;
}

let keyed = 0;
let painted = 0;
for (let i = 0; i < count; i++) {
  if (!work[i]) {
    buf[i * 3] = MAG[0];
    buf[i * 3 + 1] = MAG[1];
    buf[i * 3 + 2] = MAG[2];
    keyed++;
  } else {
    const [r, g, b] = rgb(i);
    if (isNearMagenta(r, g, b)) {
      buf[i * 3] = GLASS[0];
      buf[i * 3 + 1] = GLASS[1];
      buf[i * 3 + 2] = GLASS[2];
      painted++;
    }
  }
}

writeFileSync(dst, buf);
const outBox = bboxOf(work);
console.log(
  `${src} holes=${holes} shadowCleared=${cleared} glassFill=${painted} keyed=${keyed} bbox=${outBox.w}x${outBox.h} @${outBox.minX},${outBox.minY} zoneY ${zoneTop}+`,
);
