/** Fresnel mix used by the TSL river: reflectionWeight = fresnel * SCALE + BIAS. */
export const CREEK_FRESNEL_SCALE = 0.52;
export const CREEK_FRESNEL_BIAS = 0.26;
export const CREEK_BREAK_SCALE = 0.35;
export const CREEK_BREAK_BIAS = 0.65;

export function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/** How much reflector colour mixes into the tannin body. Never 0 and never 1. */
export function creekReflectionWeight(fresnel, broken = 1) {
  const f = clamp01(fresnel);
  const b = clamp01(broken);
  return clamp01((f * CREEK_FRESNEL_SCALE + CREEK_FRESNEL_BIAS) * (b * CREEK_BREAK_SCALE + CREEK_BREAK_BIAS));
}

/** Linear mix of body RGB and reflection RGB. */
export function mixCreekColour(body, reflected, weight) {
  const w = clamp01(weight);
  return [
    body[0] * (1 - w) + reflected[0] * w,
    body[1] * (1 - w) + reflected[1] * w,
    body[2] * (1 - w) + reflected[2] * w,
  ];
}
