/** Same gain the TSL foliage path multiplies by after extra-green. */
export const FOLIAGE_GAIN = 4.2;

/**
 * Displacement weight for one sRGB sample in 0..1.
 * Pale gum bark (R≈G, little extra green) is ~0. Olive leaves (G above R and B)
 * are clearly nonzero. Magenta studio pixels are 0.
 */
export function foliageDisplacementWeight(r, g, b) {
  const red = Number(r) || 0;
  const green = Number(g) || 0;
  const blue = Number(b) || 0;
  const extraGreen = Math.max(0, green - Math.max(red, blue));
  return Math.min(1, extraGreen * FOLIAGE_GAIN);
}

/** Reed/grass tip weight. Rooted at uv.y = 0, full sway at uv.y = 1. */
export function tipSwayWeight(uvY) {
  const y = Math.max(0, Math.min(1, Number(uvY) || 0));
  return y * y;
}
