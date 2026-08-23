import {
  abs,
  cos,
  cross,
  dot,
  Fn,
  float,
  If,
  length,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  step,
  vec2,
  vec3,
} from "three/tsl";

// Match the same mean geocentric apparent radius used by the finite-emitter
// water model (0.2498 degree radius / 0.4996 degree diameter). The inner
// threshold supplies a restrained analytic edge filter without inflating the
// visible disc beyond the emitter reflected by the ocean.
const LUNAR_ANGULAR_RADIUS = 0.00436;
export const LUNAR_DISC_OUTER_DOT = Math.cos(LUNAR_ANGULAR_RADIUS);
export const LUNAR_DISC_INNER_DOT = Math.cos(LUNAR_ANGULAR_RADIUS * 0.82);
const LUNAR_TANGENT_RADIUS = Math.sqrt(1 - LUNAR_DISC_OUTER_DOT ** 2);

const MARIA = Object.freeze([
  { x: -0.28, y: 0.18, rx: 0.34, ry: 0.24, depth: 0.13 },
  { x: 0.20, y: 0.27, rx: 0.27, ry: 0.19, depth: 0.10 },
  { x: 0.08, y: -0.12, rx: 0.38, ry: 0.27, depth: 0.08 },
]);

const CRATERS = Object.freeze([
  { x: -0.42, y: -0.15, radius: 0.082, squash: 0.78 },
  { x: 0.33, y: -0.31, radius: 0.105, squash: 0.84 },
  { x: 0.36, y: 0.10, radius: 0.064, squash: 0.72 },
  { x: -0.05, y: 0.38, radius: 0.052, squash: 0.80 },
  { x: -0.14, y: -0.38, radius: 0.044, squash: 0.68 },
]);

function lunarSurfaceFields(ray, direction, alignment) {
  const discMask = smoothstep(
    LUNAR_DISC_OUTER_DOT,
    LUNAR_DISC_INNER_DOT,
    alignment,
  );

  // Use a pole-safe tangent frame so the helper remains reusable if a caller
  // animates the Moon close to zenith. Surface texture stays fixed to the
  // lunar disc rather than swimming in screen space.
  const poleBlend = step(0.94, abs(direction.y));
  const basisHint = mix(vec3(0, 1, 0), vec3(1, 0, 0), poleBlend);
  const tangentX = normalize(cross(basisHint, direction));
  const tangentY = normalize(cross(direction, tangentX));
  const uv = vec2(
    dot(ray, tangentX),
    dot(ray, tangentY),
  ).div(LUNAR_TANGENT_RADIUS);
  const radiusSquared = dot(uv, uv);
  const facing = pow(float(1).sub(radiusSquared).max(0), 0.5);

  // A few non-harmonic analytic bands provide restrained low-frequency
  // regolith variation. Unlike fractal noise, these do not impose a large
  // full-screen cost when the Moon only occupies a handful of pixels.
  const macro = sin(uv.x.mul(2.15).add(uv.y.mul(0.74)).add(1.7))
    .add(sin(uv.x.mul(-1.36).add(uv.y.mul(2.63)).sub(0.8)).mul(0.54))
    .add(cos(uv.x.add(uv.y).mul(4.08).add(2.1)).mul(0.21))
    .mul(0.285).add(0.5);
  const mottling = sin(uv.x.mul(9.7).add(uv.y.mul(6.4)).add(0.3))
    .mul(sin(uv.x.mul(-5.8).add(uv.y.mul(11.3)).sub(1.1)))
    .mul(0.5).add(0.5);

  let mariaDepth = smoothstep(0.56, 0.78, macro).mul(0.075);
  for (const maria of MARIA) {
    const basinDistance = length(
      uv.sub(vec2(maria.x, maria.y)).mul(vec2(1 / maria.rx, 1 / maria.ry)),
    );
    const basin = float(1).sub(smoothstep(0.62, 1.05, basinDistance));
    mariaDepth = mariaDepth.max(basin.mul(maria.depth));
  }

  let craterVariation = float(0);
  for (const crater of CRATERS) {
    const craterDistance = length(
      uv.sub(vec2(crater.x, crater.y))
        .mul(vec2(1, 1 / crater.squash)),
    ).div(crater.radius);
    const floor = float(1).sub(smoothstep(0.08, 0.68, craterDistance));
    const rim = smoothstep(0.67, 0.86, craterDistance)
      .mul(float(1).sub(smoothstep(0.86, 1.08, craterDistance)));
    craterVariation = craterVariation
      .sub(floor.mul(0.030))
      .add(rim.mul(0.038));
  }

  const fineVariation = mottling.sub(0.5).mul(0.045);
  const albedoScale = float(1)
    .sub(mariaDepth)
    .add(craterVariation)
    .add(fineVariation)
    .clamp(0.72, 1.08);
  // A full Moon has only modest limb darkening. Keep the edge readable but
  // avoid the hard emissive-card look or a fake atmospheric corona.
  const limb = mix(float(0.66), float(1), pow(facing, 0.24));

  return { discMask, albedoScale, limb };
}

export function lunarDiscMaskNode(viewRay, moonDirection) {
  return smoothstep(
    LUNAR_DISC_OUTER_DOT,
    LUNAR_DISC_INNER_DOT,
    dot(normalize(viewRay), normalize(moonDirection)),
  );
}

const lunarAlbedo = Fn(([viewRay, moonDirection]) => {
  const ray = normalize(viewRay);
  const direction = normalize(moonDirection);
  const alignment = dot(ray, direction);
  const result = vec3(0).toVar();

  // The lunar disc covers only a few screen pixels at its physical angular
  // size. Do not run its analytic surface model over the entire sky dome.
  If(alignment.greaterThan(LUNAR_DISC_OUTER_DOT), () => {
    const { discMask, albedoScale } = lunarSurfaceFields(ray, direction, alignment);
    result.assign(vec3(0.126, 0.119, 0.105).mul(albedoScale).mul(discMask));
  });

  return result;
});

export function lunarSurfaceAlbedoNode(viewRay, moonDirection) {
  return lunarAlbedo(viewRay, moonDirection);
}

const lunarRadiance = Fn(([viewRay, moonDirection, incidentRadiance]) => {
  const ray = normalize(viewRay);
  const direction = normalize(moonDirection);
  const alignment = dot(ray, direction);
  const result = vec3(0).toVar();

  If(alignment.greaterThan(LUNAR_DISC_OUTER_DOT), () => {
    const { discMask, albedoScale, limb } = lunarSurfaceFields(ray, direction, alignment);
    const albedo = vec3(0.126, 0.119, 0.105).mul(albedoScale);
    result.assign(albedo.mul(incidentRadiance).mul(limb).mul(discMask));
  });

  return result;
});

export function lunarSurfaceRadianceNode(viewRay, moonDirection, incidentRadiance = 7.2) {
  return lunarRadiance(viewRay, moonDirection, float(incidentRadiance));
}
