import * as THREE from "three/webgpu";
import {
  abs,
  bumpMap,
  cameraPosition,
  color,
  cos,
  cross,
  dot,
  float,
  fwidth,
  length,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  saturate,
  sin,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  lunarDiscMaskNode,
  lunarSurfaceRadianceNode,
} from "./lunar-surface.mjs";
import {
  CLOUD_HIGH_BASE_KM,
  CLOUD_HIGH_EXTINCTION_PER_KM,
  CLOUD_HIGH_QUADRATURE,
  CLOUD_HIGH_TOP_KM,
  CLOUD_LIGHT_QUADRATURE,
  CLOUD_LIGHT_QUADRATURE_TWO_POINT,
  CLOUD_LOW_BASE_KM,
  CLOUD_LOW_EXTINCTION_PER_KM,
  CLOUD_LOW_QUADRATURE,
  CLOUD_LOW_SLABS,
  CLOUD_LOW_TOP_KM,
  CLOUD_PLANET_RADIUS_KM,
} from "./cloud-model.mjs";

export const waterTime = uniform(0);
export const skyTransition = uniform(0.72);
export const debugView = uniform(0);
export const waveEnergy = uniform(1);
export const MOON_DIRECTION = new THREE.Vector3(-0.28, 0.29, -0.915).normalize();
// One scene-authored lunar emitter feeds the visible disc and portable TSL
// water. The RGB values are the lunar
// surface's mean full-Moon radiance (albedo * 7.2) after the exact marine
// atmospheric transmission evaluated along the fixed Moon direction.
const MOON_AIR_MASS = 1 / Math.max(MOON_DIRECTION.y, 0.035);
export const MOON_DIRECT_RADIANCE_RGB = Object.freeze([
  0.126 * 7.2 * Math.exp(-0.0185 * MOON_AIR_MASS),
  0.119 * 7.2 * Math.exp(-0.0240 * MOON_AIR_MASS),
  0.105 * 7.2 * Math.exp(-0.0330 * MOON_AIR_MASS),
]);
// Preserve the established photometric level while deriving chromaticity
// from the same spectrum as the visible Moon rather than an unrelated cyan.
export const MOON_WATER_EMITTER_INTENSITY = 0.0245;
export const celestialDirection = uniform(MOON_DIRECTION.clone());
export const sunSkyDirection = uniform(new THREE.Vector3(-0.27, 0.11, -0.96).normalize());
export const moonSkyDirection = uniform(MOON_DIRECTION.clone());
export const moonEmitterVisibility = uniform(1);
const moonDirectRadiance = uniform(new THREE.Vector3(
  ...MOON_DIRECT_RADIANCE_RGB,
));

export const palette = Object.freeze({
  midnight: 0x020712,
  blueHour: 0x0d263b,
  moon: 0xdff4ff,
  moonBlue: 0x87cfff,
  sunset: 0xff8a4b,
  afterglow: 0x9d4164,
  water: 0x0b4c61,
  deepWater: 0x031c2a,
  foam: 0xc9f5ee,
  sand: 0xa99b7a,
  wetRock: 0x27343a,
  bronze: 0x8f6741,
  plankton: 0x55ffe0,
});

const GRAVITY = 9.81;
const deepWaterFrequency = (waveNumber, direction = 1) =>
  Math.sqrt(GRAVITY * waveNumber) * direction;

const BASE_GEOMETRY_WAVES = Object.freeze([
  // Seven resolvable deep-water spectral bins. Each is expanded below into a
  // directional quadrature; these are energy bins, not literal
  // infinite crest trains.
  { x: 0.32, z: 0.947, frequency: 0.085, speed: deepWaterFrequency(0.085), amplitude: 0.38, choppiness: 0.46, offset: 0.37 },
  { x: 0.55, z: 0.835, frequency: 0.145, speed: deepWaterFrequency(0.145), amplitude: 0.26, choppiness: 0.40, offset: 2.11 },
  { x: 0.06, z: 0.998, frequency: 0.255, speed: deepWaterFrequency(0.255), amplitude: 0.125, choppiness: 0.32, offset: -1.43 },
  { x: -0.42, z: 0.907, frequency: 0.46, speed: deepWaterFrequency(0.46), amplitude: 0.056, choppiness: 0.22, offset: 0.88 },
  // Lower-energy crossing seas break the long trains into natural groups
  // without adding frequencies the surface grid cannot resolve.
  { x: 0.842, z: 0.540, frequency: 0.32, speed: deepWaterFrequency(0.32), amplitude: 0.046, choppiness: 0.25, offset: -2.27 },
  { x: -0.550, z: 0.835, frequency: 0.58, speed: deepWaterFrequency(0.58), amplitude: 0.018, choppiness: 0.16, offset: 1.47 },
  { x: 0.2020762982, z: 0.9793697819, frequency: 0.105, speed: deepWaterFrequency(0.105), amplitude: 0.293257566, choppiness: 0.40, offset: -0.91 },
]);

// A developed wind sea retains a dominant direction without collapsing into
// parallel ruled bands. Broaden the resolved spectrum with frequency while
// preserving every bin's height/slope variance and the existing lobe count.
const GEOMETRY_DIRECTIONAL_SPREAD_DEGREES = Object.freeze([18, 22, 28, 34, 30, 38, 20]);
const GOLDEN_ANGLE = 2.3999632297;
const DOMINANT_DIRECTION_NODES = Object.freeze([
  -1.3228756555,
  -0.5,
  0.5,
  1.3228756555,
]);
const DOMINANT_FREQUENCY_MULTIPLIERS = Object.freeze([
  0.982423360963,
  1.044395917064,
  0.954447943346,
  1.016420499447,
]);

function expandDirectionalSpectrum(wave, index) {
  const heading = Math.atan2(wave.x, wave.z);
  const spread = THREE.MathUtils.degToRad(GEOMETRY_DIRECTIONAL_SPREAD_DEGREES[index]);
  // The first, second and seventh bins carry more than 93% of the resolved
  // height variance. Give only those dominant swells four independent lobes
  // so their specular bands form finite groups instead of paired infinite
  // trains. The symmetric angular nodes have zero mean and unit RMS; the
  // matched frequency detunes preserve both height and slope variance.
  if (index === 0 || index === 1 || index === 6) {
    return DOMINANT_DIRECTION_NODES.map((directionNode, lobeIndex) => {
      const frequency = wave.frequency * DOMINANT_FREQUENCY_MULTIPLIERS[lobeIndex];
      const direction = heading + directionNode * spread;
      return Object.freeze({
        x: Math.sin(direction),
        z: Math.cos(direction),
        frequency,
        speed: deepWaterFrequency(frequency),
        amplitude: wave.amplitude * 0.5,
        choppiness: wave.choppiness,
        offset: wave.offset + lobeIndex * GOLDEN_ANGLE,
      });
    });
  }

  return [-1, 1].map((sign, lobeIndex) => {
    const frequency = wave.frequency * (1 + sign * 0.03);
    const direction = heading + sign * spread;
    return Object.freeze({
      x: Math.sin(direction),
      z: Math.cos(direction),
      frequency,
      speed: deepWaterFrequency(frequency),
      // Preserve each bin's total slope variance under the two-point
      // quadrature: sum((a_i k_i)^2) = (a k)^2.
      amplitude: wave.amplitude * wave.frequency / (Math.SQRT2 * frequency),
      choppiness: wave.choppiness,
      offset: wave.offset + lobeIndex * GOLDEN_ANGLE,
    });
  });
}

// The 0.46/0.58 rad/m bins are physically useful slope energy, but the ocean
// mesh resolves them with too few vertices per wavelength. Keep them in the
// fragment normal spectrum and out of Gerstner vertex displacement so distant
// crests do not facet or flicker. Original indices are retained because each
// bin owns a calibrated directional spread.
const GEOMETRY_BASE_WAVE_INDICES = Object.freeze([0, 1, 2, 4, 6]);
const NORMAL_ONLY_RESOLVED_BASE_WAVE_INDICES = Object.freeze([3, 5]);
const expandBaseWaveIndices = indices => indices.flatMap(index =>
  expandDirectionalSpectrum(BASE_GEOMETRY_WAVES[index], index));

const GEOMETRY_WAVES = Object.freeze(
  expandBaseWaveIndices(GEOMETRY_BASE_WAVE_INDICES),
);
const NORMAL_ONLY_RESOLVED_WAVES = Object.freeze(
  expandBaseWaveIndices(NORMAL_ONLY_RESOLVED_BASE_WAVE_INDICES),
);

const NORMAL_DETAIL_WAVES = Object.freeze([
  // Six normal-only wind ripples. Amplitude falls faster than wavelength,
  // preserving a plausible slope spectrum while fragment detail breaks the
  // moon path into thousands of small highlights.
  // The capillary fan stays within roughly +/-32 degrees of the prevailing
  // wind vector. Real wind seas retain directional coherence at short
  // wavelengths; a full-circle fan reads as isotropic glitter instead.
  { x: -0.230, z: 0.973, frequency: 0.90, speed: deepWaterFrequency(0.90), amplitude: 0.022, choppiness: 0.12, offset: -2.65 },
  { x: -0.023, z: 1.000, frequency: 1.70, speed: deepWaterFrequency(1.70), amplitude: 0.010, choppiness: 0.075, offset: 1.62 },
  { x: 0.151, z: 0.989, frequency: 3.10, speed: deepWaterFrequency(3.10), amplitude: 0.0055, choppiness: 0.045, offset: -0.64 },
  { x: 0.418, z: 0.908, frequency: 5.80, speed: deepWaterFrequency(5.80), amplitude: 0.0028, choppiness: 0.026, offset: 2.87 },
  { x: 0.598, z: 0.802, frequency: 10.5, speed: deepWaterFrequency(10.5), amplitude: 0.00145, choppiness: 0.014, offset: -2.04 },
  { x: 0.751, z: 0.660, frequency: 19.0, speed: deepWaterFrequency(19.0), amplitude: 0.00075, choppiness: 0.008, offset: 1.19 },
]);

export const GEOMETRY_WAVE_COUNT = GEOMETRY_WAVES.length;
export const OCEAN_WAVES = Object.freeze([
  ...GEOMETRY_WAVES,
  ...NORMAL_ONLY_RESOLVED_WAVES,
  ...NORMAL_DETAIL_WAVES,
]);
const WAVES = OCEAN_WAVES;
const NORMAL_DETAIL_WAVE_START = GEOMETRY_WAVES.length
  + NORMAL_ONLY_RESOLVED_WAVES.length;
// Preserve the former Cox-Munk roughness/anisotropy exactly as the covariance
// floor for unresolved wind structure. These values are the eigensystem of
// perceptual roughness variance 0.01738 and Three.js anisotropy 0.10, projected
// into the prevailing world-XZ wind basis.
const BASE_SLOPE_COVARIANCE = Object.freeze({
  xx: 0.01762231,
  xz: 0.00071709,
  zz: 0.01950213,
});
// Measured over the exact Three r184 MaterialX fBm implementation and the two
// authored octave stacks below. Normalizing the fields lets the explicit slope
// realization carry a known covariance instead of relying on an artistic gain.
const WIND_WARP_A_INV_STDDEV = 3.6719060634;
const WIND_WARP_B_INV_STDDEV = 3.8513043981;
const RESOLVED_BASE_SLOPE_FRACTION = 0.25;
const WIND_DIRECTION_X = 0.32012664;
const WIND_DIRECTION_Z = 0.94737476;
const CROSSWIND_DIRECTION_X = -WIND_DIRECTION_Z;
const CROSSWIND_DIRECTION_Z = WIND_DIRECTION_X;
// The covariance above diagonalizes exactly in the authored wind frame. Keep
// the eigenvalues explicit so each filtered noise field can resolve—and remove
// from GGX—the same directional slope energy independently.
const BASE_ALONGWIND_SLOPE_VARIANCE = 0.0197444420080;
const BASE_CROSSWIND_SLOPE_VARIANCE = 0.0173799979920;
const BASE_ALONGWIND_SLOPE_STDDEV = 0.1405149174;
const BASE_CROSSWIND_SLOPE_STDDEV = 0.1318332204;

function phase(point, wave) {
  return point.x.mul(wave.x)
    .add(point.z.mul(wave.z))
    .mul(wave.frequency)
    .add(waterTime.mul(wave.speed))
    .add(wave.offset ?? 0);
}

export function waveHeightNode(point = positionLocal) {
  let height = float(0);
  for (const wave of GEOMETRY_WAVES) {
    height = height.add(sin(phase(point, wave)).mul(wave.amplitude));
  }
  return height.mul(waveEnergy);
}

function waveSurfaceFrameNode(point = positionLocal) {
  let dx = float(0);
  let dz = float(0);
  let horizontalXX = float(0);
  let horizontalXZ = float(0);
  let horizontalZZ = float(0);
  const surfaceRange = length(positionWorld.sub(cameraPosition));
  const microDetail = float(1).sub(smoothstep(32, 190, surfaceRange));
  const windU = point.x.mul(0.32).add(point.z.mul(0.947));
  const windV = point.x.mul(-0.947).add(point.z.mul(0.32));
  const windWarpA = mx_fractal_noise_float(
    point.mul(vec3(0.21, 0.025, 0.17))
      .add(vec3(waterTime.mul(0.016), 0, waterTime.mul(-0.011))),
    3,
    2.03,
    0.51,
  );
  const windWarpB = mx_fractal_noise_float(
    vec3(windU.mul(5.20), point.y.mul(0.04), windV.mul(1.35))
      .add(vec3(13.7, 0, -8.9))
      .add(vec3(waterTime.mul(0.55), 0, waterTime.mul(-0.21))),
    2,
    2.17,
    0.45,
  );
  const energySquared = waveEnergy.mul(waveEnergy);
  const normalizedWarpA = windWarpA.mul(WIND_WARP_A_INV_STDDEV);
  const normalizedWarpB = windWarpB.mul(WIND_WARP_B_INV_STDDEV);
  // Filter by the projected coordinate footprint, not by fwidth(noiseValue).
  // Noise derivatives vanish at extrema even when its octave is unresolved;
  // coordinate footprints remain conservative and prevent distant sparkle.
  const warpAFootprint = length(fwidth(vec2(
    point.x.mul(0.21),
    point.z.mul(0.17),
  ))).mul(2.03 * 2.03);
  const warpBFootprint = length(fwidth(vec2(
    windU.mul(5.20),
    windV.mul(1.35),
  ))).mul(2.17);
  const warpAFilter = warpAFootprint.mul(warpAFootprint)
    .mul(-0.32).exp().saturate();
  const warpBFilter = warpBFootprint.mul(warpBFootprint)
    .mul(-0.32).exp().saturate();
  const resolvedCrosswindWeight = microDetail.mul(warpAFilter);
  const resolvedAlongwindWeight = microDetail.mul(warpBFilter);
  const resolvedCrosswindVariance = resolvedCrosswindWeight
    .mul(resolvedCrosswindWeight)
    .mul(RESOLVED_BASE_SLOPE_FRACTION * BASE_CROSSWIND_SLOPE_VARIANCE)
    .mul(energySquared);
  const resolvedAlongwindVariance = resolvedAlongwindWeight
    .mul(resolvedAlongwindWeight)
    .mul(RESOLVED_BASE_SLOPE_FRACTION * BASE_ALONGWIND_SLOPE_VARIANCE)
    .mul(energySquared);
  const resolvedCovarianceXX = resolvedAlongwindVariance
    .mul(WIND_DIRECTION_X * WIND_DIRECTION_X)
    .add(resolvedCrosswindVariance.mul(
      CROSSWIND_DIRECTION_X * CROSSWIND_DIRECTION_X,
    ));
  const resolvedCovarianceXZ = resolvedAlongwindVariance
    .mul(WIND_DIRECTION_X * WIND_DIRECTION_Z)
    .add(resolvedCrosswindVariance.mul(
      CROSSWIND_DIRECTION_X * CROSSWIND_DIRECTION_Z,
    ));
  const resolvedCovarianceZZ = resolvedAlongwindVariance
    .mul(WIND_DIRECTION_Z * WIND_DIRECTION_Z)
    .add(resolvedCrosswindVariance.mul(
      CROSSWIND_DIRECTION_Z * CROSSWIND_DIRECTION_Z,
    ));
  let covarianceXX = float(BASE_SLOPE_COVARIANCE.xx)
    .sub(resolvedCovarianceXX);
  let covarianceXZ = float(BASE_SLOPE_COVARIANCE.xz)
    .sub(resolvedCovarianceXZ);
  let covarianceZZ = float(BASE_SLOPE_COVARIANCE.zz)
    .sub(resolvedCovarianceZZ);
  for (let index = 0; index < WAVES.length; ++index) {
    const wave = WAVES[index];
    let angle = phase(point, wave);
    if (index >= NORMAL_DETAIL_WAVE_START) {
      // Wind ripples are phase-warped rather than perfectly periodic. This
      // preserves the directional spectrum but removes synthetic screen-space
      // lattices from the moon glitter without moving any shader into native
      // code.
      angle = angle
        .add(windWarpA.mul(0.52 + index * 0.075))
        .add(windWarpB.mul(0.31 + index * 0.045));
    }
    // Analytically band-limit every resolved sinusoid by its actual phase
    // footprint in this pixel. The previous distance-only fade ignored FOV,
    // resolution and grazing foreshortening, leaving coherent horizontal
    // ribbons in the lunar path. A monotone Gaussian footprint is stable past
    // Nyquist and never reintroduces the negative lobes of a raw sinc.
    const phaseWidth = fwidth(angle).max(0);
    const spectralWeight = phaseWidth.mul(phaseWidth)
      .mul(-0.32).exp().saturate();
    const slopeAmplitude = wave.amplitude * wave.frequency;
    const slope = cos(angle).mul(slopeAmplitude).mul(spectralWeight);
    dx = dx.add(slope.mul(wave.x));
    dz = dz.add(slope.mul(wave.z));

    if (index < GEOMETRY_WAVE_COUNT) {
      // The visible mesh uses horizontally choppy Gerstner displacement, so a
      // height-field normal is not its true differential. Accumulate the
      // horizontal Jacobian from the same filtered phase used by the explicit
      // vertical slope. This keeps Moon and sky reflections attached to the
      // displaced crest faces instead of sliding over an imaginary surface.
      const compression = sin(angle)
        .mul(wave.amplitude * wave.frequency * wave.choppiness)
        .mul(spectralWeight);
      horizontalXX = horizontalXX.add(compression.mul(wave.x * wave.x));
      horizontalXZ = horizontalXZ.add(compression.mul(wave.x * wave.z));
      horizontalZZ = horizontalZZ.add(compression.mul(wave.z * wave.z));
    }

    // A filtered sinusoid has F^2 of its original slope variance left in the
    // explicit normal. Bank exactly the missing 1-F^2 energy as a directional
    // covariance so Three's GGX lobe widens smoothly instead of losing energy.
    const lostVariance = float(0.5 * slopeAmplitude * slopeAmplitude)
      .mul(float(1).sub(spectralWeight.mul(spectralWeight)))
      .mul(energySquared);
    covarianceXX = covarianceXX.add(lostVariance.mul(wave.x * wave.x));
    covarianceXZ = covarianceXZ.add(lostVariance.mul(wave.x * wave.z));
    covarianceZZ = covarianceZZ.add(lostVariance.mul(wave.z * wave.z));
  }

  // Resolve one quarter of the measured covariance into spatial near-field
  // slopes: the elongated B field follows the wind and A supplies crosswind
  // breakup. Their exact axis-wise covariance was removed from GGX above.
  const resolvedSlopeFractionSqrt = Math.sqrt(RESOLVED_BASE_SLOPE_FRACTION);
  const resolvedAlongwindSlope = normalizedWarpB
    .mul(BASE_ALONGWIND_SLOPE_STDDEV * resolvedSlopeFractionSqrt)
    .mul(resolvedAlongwindWeight);
  const resolvedCrosswindSlope = normalizedWarpA
    .mul(BASE_CROSSWIND_SLOPE_STDDEV * resolvedSlopeFractionSqrt)
    .mul(resolvedCrosswindWeight);
  const resolvedWorldSlopeX = resolvedAlongwindSlope.mul(WIND_DIRECTION_X)
    .add(resolvedCrosswindSlope.mul(CROSSWIND_DIRECTION_X));
  const resolvedWorldSlopeZ = resolvedAlongwindSlope.mul(WIND_DIRECTION_Z)
    .add(resolvedCrosswindSlope.mul(CROSSWIND_DIRECTION_Z));

  const jacobianXX = float(1).sub(horizontalXX.mul(waveEnergy));
  const jacobianXZ = horizontalXZ.mul(waveEnergy).negate();
  const jacobianZZ = float(1).sub(horizontalZZ.mul(waveEnergy));

  // dx/dz are derivatives in the undisplaced plane, while the desired slope
  // above is in world XZ. Premultiply by the choppy Gerstner Jacobian so the
  // inverse-transpose implicit in the final cross product yields that exact
  // world-space slope instead of stretching it at compressed crests.
  dx = dx.add(
    jacobianXX.mul(resolvedWorldSlopeX)
      .add(jacobianXZ.mul(resolvedWorldSlopeZ)),
  );
  dz = dz.add(
    jacobianXZ.mul(resolvedWorldSlopeX)
      .add(jacobianZZ.mul(resolvedWorldSlopeZ)),
  );

  // Differentiate the exact authored displacement P(x,z). Normal-only
  // capillary slopes remain vertical derivatives in this parameterization,
  // while only geometry waves contribute horizontal convergence. For a flat
  // surface cross(dP/dz, dP/dx) points toward +Y.
  const tangentX = vec3(
    jacobianXX,
    dx.mul(waveEnergy),
    jacobianXZ,
  );
  const tangentZ = vec3(
    jacobianXZ,
    dz.mul(waveEnergy),
    jacobianZZ,
  );
  const normal = normalize(cross(tangentZ, tangentX));

  // Diagonalize the XZ slope covariance. The larger eigenvalue is Three's
  // anisotropy tangent (the rougher axis); the smaller eigenvalue becomes its
  // bitangent alpha through the standard perceptual-roughness mapping.
  const covarianceDelta = covarianceXX.sub(covarianceZZ);
  const eigenGap = covarianceDelta.mul(covarianceDelta)
    .add(covarianceXZ.mul(covarianceXZ).mul(4)).sqrt();
  const covarianceTrace = covarianceXX.add(covarianceZZ);
  const lambdaMax = covarianceTrace.add(eigenGap).mul(0.5)
    .max(0.000001).min(0.998001);
  const lambdaMin = covarianceTrace.sub(eigenGap).mul(0.5)
    .max(0.000001).min(lambdaMax);

  // Use whichever algebraic eigenvector has the larger norm, then fall back
  // to the authored wind axis in the near-isotropic limit where orientation
  // is mathematically undefined and visually immaterial.
  const candidateX = vec2(lambdaMax.sub(covarianceZZ), covarianceXZ);
  const candidateZ = vec2(covarianceXZ, lambdaMax.sub(covarianceXX));
  const candidate = mix(
    candidateX,
    candidateZ,
    step(length(candidateX), length(candidateZ)),
  );
  const principalWorld = normalize(mix(
    vec2(WIND_DIRECTION_X, WIND_DIRECTION_Z),
    candidate,
    step(0.000001, length(candidate)),
  ));

  const alphaB = lambdaMin.sqrt().max(0.02).min(0.999);
  const alphaT = lambdaMax.sqrt().max(alphaB).min(0.999);
  const anisotropyStrength = alphaT.sub(alphaB)
    .div(float(1).sub(alphaB).max(0.001))
    .saturate().sqrt();

  return {
    normal,
    alphaT,
    alphaB,
    principalWorld,
    perceptualRoughness: alphaB.sqrt(),
    // PlaneGeometry rotated -PI/2 around X maps its bitangent to world -Z.
    anisotropyVector: vec2(principalWorld.x, principalWorld.y.negate())
      .mul(anisotropyStrength),
    reflectionSigma: lambdaMax.add(lambdaMin).mul(0.5).sqrt(),
  };
}

export function waveNormalNode(point = positionLocal) {
  return waveSurfaceFrameNode(point).normal;
}

function waveDisplacementNode(point = positionLocal) {
  let x = float(0);
  let y = float(0);
  let z = float(0);
  for (const wave of GEOMETRY_WAVES) {
    const angle = phase(point, wave);
    y = y.add(sin(angle).mul(wave.amplitude));
    const horizontal = cos(angle).mul(wave.amplitude * wave.choppiness);
    x = x.add(horizontal.mul(wave.x));
    z = z.add(horizontal.mul(wave.z));
  }
  return vec3(x, y, z).mul(waveEnergy);
}

export function causticFieldNode(point = positionWorld, receiverNormal = normalWorld) {
  const warped = point.add(vec3(
    mx_fractal_noise_float(point.mul(vec3(0.23, 0.07, 0.23)), 3, 2.07, 0.51).mul(1.7),
    0,
    mx_fractal_noise_float(
      point.add(vec3(9.1, 2.4, -6.8)).mul(vec3(0.26, 0.06, 0.26)),
      3,
      2.11,
      0.49,
    ).mul(1.7),
  ));
  const a = sin(phase(warped, WAVES[1]).mul(19.0)
    .add(sin(phase(warped, WAVES[3]).mul(3.4)).mul(1.2)));
  const b = sin(phase(warped, WAVES[2]).mul(15.0)
    .sub(sin(phase(warped, WAVES[0]).mul(5.1)).mul(1.05)));
  const c = sin(phase(warped, WAVES[3]).mul(8.5)
    .add(phase(warped, WAVES[4]).mul(1.7)));
  const ridgeA = pow(saturate(float(1).sub(abs(a))), 8.5);
  const ridgeB = pow(saturate(float(1).sub(abs(b))), 8.0);
  const ridgeC = pow(saturate(float(1).sub(abs(c))), 7.0);
  const convergence = ridgeA.mul(ridgeB).mul(1.7)
    .add(ridgeB.mul(ridgeC).mul(1.25))
    .add(ridgeC.mul(ridgeA).mul(0.95))
    .add(ridgeA.add(ridgeB).add(ridgeC).mul(0.055))
    .saturate();
  const depth = float(0.3).sub(point.y).max(0);
  const focus = depth.mul(-0.09).exp().mul(0.62).add(0.38);
  const facing = abs(receiverNormal.y).mul(0.7).add(0.3).saturate();
  return convergence.mul(focus).mul(facing).mul(waveEnergy);
}

function debugWeights() {
  return {
    fresnel: step(0.5, debugView).mul(float(1).sub(step(1.5, debugView))),
    caustics: step(1.5, debugView).mul(float(1).sub(step(2.5, debugView))),
    normals: step(2.5, debugView).mul(float(1).sub(step(3.5, debugView))),
    transport: step(3.5, debugView),
  };
}

function splitWaterDebug(baseReflectance, outgoingRadiance, normal, fresnel) {
  const weights = debugWeights();
  const fresnelColor = mix(color(0x07121f), color(0xffffff), fresnel);
  const caustics = causticFieldNode(positionWorld, normal);
  const causticColor = mix(color(0x00141e), color(0x8ffff1), caustics);
  const normalColor = normal.mul(0.5).add(0.5);
  const distance = length(positionWorld.sub(cameraPosition)).div(52).saturate();
  const transportColor = vec3(distance, fresnel, float(1).sub(distance).mul(0.7));
  const debugAmount = weights.fresnel.add(weights.caustics)
    .add(weights.normals).add(weights.transport).saturate();
  const debugColor = fresnelColor.mul(weights.fresnel)
    .add(causticColor.mul(weights.caustics))
    .add(normalColor.mul(weights.normals))
    .add(transportColor.mul(weights.transport));

  // `colorNode` is a surface reflectance input to MeshPhysicalNodeMaterial,
  // while the sky and finite-emitter terms below are already evaluated
  // outgoing radiance. Keep those domains separate so Three.js does not light
  // the Moon trail, buoy trail, or reflected sky a second time. Debug views
  // live in emissiveNode so they remain exact diagnostic values rather than
  // acquiring the ocean material's PBR lighting.
  const beautyAmount = float(1).sub(debugAmount);
  return {
    color: baseReflectance.mul(beautyAmount),
    emissive: outgoingRadiance.mul(beautyAmount).add(debugColor),
  };
}

function waterPositionNode() {
  return positionLocal.add(waveDisplacementNode(positionLocal));
}

export function breakingInjectionNode(point = positionLocal) {
  let horizontalXX = float(0);
  let horizontalXZ = float(0);
  let horizontalZZ = float(0);
  for (const wave of GEOMETRY_WAVES) {
    const compression = sin(phase(point, wave)).mul(
      wave.amplitude * wave.frequency * wave.choppiness,
    ).mul(waveEnergy);
    horizontalXX = horizontalXX.add(compression.mul(wave.x * wave.x));
    horizontalXZ = horizontalXZ.add(compression.mul(wave.x * wave.z));
    horizontalZZ = horizontalZZ.add(compression.mul(wave.z * wave.z));
  }

  // Tessendorf/Reinhard/Gao's minimum eigenvalue detects actual directional
  // folding. Unlike height or determinant thresholds it is dimensionless and
  // cannot be cancelled by simultaneous stretching across the crest.
  const jacobianXX = float(1).sub(horizontalXX);
  const jacobianXZ = horizontalXZ.negate();
  const jacobianZZ = float(1).sub(horizontalZZ);
  const eigenGap = jacobianXX.sub(jacobianZZ).mul(jacobianXX.sub(jacobianZZ))
    .add(jacobianXZ.mul(jacobianXZ).mul(4)).sqrt();
  const minimumStretch = jacobianXX.add(jacobianZZ).sub(eigenGap).mul(0.5);
  const foldingStrain = float(1).sub(minimumStretch).max(0);
  // Calibrated over 200k samples of this exact directional spectrum. Restrict
  // injection to the upper few percent of compressive events; the persistent
  // field keeps those real breakers visible after their carrier crest moves
  // on, so a broad instantaneous candidate mask is no longer necessary.
  const foldSignal = smoothstep(0.034, 0.062, foldingStrain);

  const windU = point.x.mul(0.32).add(point.z.mul(0.947));
  const windV = point.x.mul(-0.947).add(point.z.mul(0.32));
  const breakerWarp = mx_fractal_noise_float(
    // The persistent field is one metre per texel. Keep every injected
    // feature above its Nyquist limit; sub-metre bubble breakup is restored
    // later in oceanFoamNode at fragment resolution.
    vec3(windU.mul(0.035), point.y.mul(0.025), windV.mul(0.075))
      .add(vec3(waterTime.mul(0.014), 0, waterTime.mul(-0.006))),
    3,
    2.03,
    0.51,
  );
  const breakerField = mx_fractal_noise_float(
    vec3(
      // A whitecap is narrow along propagation and extended across the crest.
      // Keep the breakup anisotropy in that physical frame so aerial views do
      // not turn foam into wind-aligned scratches.
      windU.mul(0.20).add(breakerWarp.mul(0.42)),
      point.y.mul(0.025),
      windV.mul(0.052).add(breakerWarp.mul(-0.68)),
    ).add(vec3(waterTime.mul(0.030), 0, waterTime.mul(-0.011))),
    2,
    2.07,
    0.52,
  ).mul(0.5).add(0.5);

  // A high along-wind frequency draws thin transverse crest filaments. The
  // lower cross-wind frequency leaves finite connected arcs instead of
  // isotropic television noise or long downwind scratches.
  const filamentField = mx_noise_float(vec3(
    windU.mul(0.24)
      .add(waterTime.mul(0.038))
      .add(breakerWarp.mul(0.38)),
    point.y.mul(0.025),
    windV.mul(0.055)
      .add(waterTime.mul(-0.012))
      .add(breakerWarp.mul(1.28)),
  ));
  const filamentRidge = float(1).sub(abs(filamentField)).saturate();

  // The body occupies a small, dimmer patch behind each breaking tip. Only a
  // subset of that body reaches the sharp filament threshold, yielding roughly
  // 0.2-0.8% visibly white coverage at the authored waveEnergy=1 while still
  // reading clearly in moonlight.
  const body = smoothstep(0.70, 0.86, breakerField).mul(0.16);
  const filament = smoothstep(0.84, 0.975, filamentRidge)
    .mul(smoothstep(0.60, 0.78, breakerField));
  const energyOnset = smoothstep(0.68, 0.98, waveEnergy);
  const breakup = body.add(filament.mul(0.92)).saturate();
  // Treat the breakup field as local air-entrainment probability, not merely
  // a brightness variation over an otherwise continuous infinite crest. The
  // previous 0.22 floor resolved to roughly 66% optical foam on a strong crest
  // even where breakup was absent, creating long cross-wind white ribbons.
  const entrainment = smoothstep(0.12, 0.60, breakup);
  const fragmentedBody = foldSignal.mul(entrainment);
  // Preserve a very small seed at exceptionally young breaker tips. It stays
  // below the optical coverage onset on its own, but prevents a hard temporal
  // pop when the first entrained patch forms.
  const freshTipSeed = foldSignal.mul(foldSignal).mul(0.012);
  const breakingSignal = fragmentedBody.max(freshTipSeed).saturate();
  // `breakingSignal` is a likelihood assembled from several continuous
  // statistics, not a literal albedo.  Resolve it into sub-pixel foam
  // coverage so qualified crest ribbons remain visible after premultiplied
  // HDR composition. Noise may break up a ribbon, but can never create one.
  return breakingSignal
    .mul(energyOnset)
    .saturate();
}

function oceanFoamNode(persistentFoamSample = null) {
  // The persistent JS/TSL field keeps detached bubble rafts alive after their
  // carrier crest has travelled onward. Retain an instantaneous source as a
  // robust WebGPU fallback when the compute field is deliberately omitted.
  if (typeof persistentFoamSample !== "function") {
    return breakingInjectionNode(positionLocal);
  }

  // The history texture is deliberately a low-frequency mass/lifetime field.
  // Resolve that envelope into sub-metre, crest-crossing bubble filaments in
  // the material so its simulation texels can never appear as square decals.
  // The coordinate follows the same slow windage used by foam-field.mjs, so
  // the breakup remains attached to the advected raft instead of swimming
  // across it at the phase speed of the Gerstner waves.
  const persistent = persistentFoamSample(positionLocal).saturate();
  const windU = positionLocal.x.mul(0.32).add(positionLocal.z.mul(0.947));
  const windV = positionLocal.x.mul(-0.947).add(positionLocal.z.mul(0.32));
  const advectedU = windU.add(waterTime.mul(0.281));
  const raftNoise = mx_noise_float(vec3(
    advectedU.mul(2.65),
    float(0.17),
    windV.mul(0.44).add(waterTime.mul(0.006)),
  ));
  const bubbleRidge = float(1).sub(abs(raftNoise)).saturate();
  const filamentCoverage = smoothstep(0.54, 0.92, bubbleRidge);
  // MaterialX noise is sampled at fragment rate and has no automatic signal
  // bandwidth. Fade it to its measured areal mean once several filament
  // cycles fall inside one pixel; retaining raw LOD-0 noise at the horizon
  // was the remaining source of crawling square highlights.
  const filamentFootprint = fwidth(advectedU.mul(2.65)).max(
    fwidth(windV.mul(0.44)),
  );
  const resolvedWeight = float(1).sub(
    smoothstep(0.18, 0.72, filamentFootprint),
  );
  const filteredFilament = mix(float(0.24), filamentCoverage, resolvedWeight);
  const subcellDetail = filteredFilament.mul(1.18);
  return persistent.mul(subcellDetail).saturate();
}

function oceanFoamCoverageNode(breakingSignal) {
  // The statistical product above expresses confidence that a crest is
  // breaking; it is not itself an optical coverage. Resolve that confidence
  // into the fractional white water inside a pixel. At this wind energy the
  // result averages roughly one percent bright coverage, consistent with a
  // moderately windy open ocean, while remaining exactly zero away from
  // physically qualified crests.
  return smoothstep(0.11, 0.43, breakingSignal)
    // White water occupies only part of a breaking crest at this distance.
    // Keep the temporal shape, but avoid treating the entire qualified patch
    // as optically opaque foam.
    .mul(0.62)
    .saturate();
}

function oceanFoamReflectanceNode() {
  // Portable Three.js PBR treats colorNode as diffuse reflectance. Keep a
  // restrained marine tint and let the material's normal/roughness model
  // perform its usual lighting. Moon/sky irradiance does not belong in the
  // albedo itself; baking it here would light the foam twice.
  return color(0x89a5aa);
}

function oceanAerialPerspectiveNode() {
  const range = length(positionWorld.sub(cameraPosition));
  // Match the scene's FogExp2 density so geometry and water meet under one
  // extinction law. A ray-elevation tint avoids a flat teal horizon band.
  const opticalDepth = range.mul(0.0022);
  const transmittance = opticalDepth.mul(opticalDepth).negate().exp();
  const viewRay = normalize(positionWorld.sub(cameraPosition));
  const grazing = smoothstep(-0.22, -0.01, viewRay.y);
  const radiance = mix(color(0x06121c), color(0x102836), grazing);
  return { transmittance, radiance };
}

function waterFresnelNode(normal, view) {
  // Schlick Fresnel for air-to-water at IOR 1.333. Keeping the 2.037% normal
  // incidence term prevents both an artificial reflection floor and a black
  // discontinuity between face-on and grazing water.
  const normalDotView = abs(dot(normal, view)).saturate();
  return float(0.02037).add(
    float(0.97963).mul(pow(float(1).sub(normalDotView), 5)),
  );
}

export function createOceanWaterMaterial(persistentFoamSample = null) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Moonwater JS/TSL reflection and refraction",
    side: THREE.DoubleSide,
    color: palette.water,
    metalness: 0,
    roughness: 0.075,
    // The live finite-emitter/sky reflection is evaluated in TSL below. Do
    // not layer Three.js' frozen PMREM and a second clearcoat lobe over it.
    clearcoat: 0,
    clearcoatRoughness: 0.055,
    envMapIntensity: 0,
    ior: 1.333,
    anisotropy: 0,
    fog: false,
  });
  material.positionNode = waterPositionNode();

  const surfaceFrame = waveSurfaceFrameNode(positionLocal);
  const normal = surfaceFrame.normal;
  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = waterFresnelNode(normal, view);
  // Ocean transport remains page-authored TSL. The generic RTX bridge may add
  // visibility and one-bounce reflection results, but it never owns water
  // optics or any artistic shader used by this sample.
  const depthVariation = mx_fractal_noise_float(
    positionLocal.mul(vec3(0.11, 0.03, 0.11))
      .add(vec3(waterTime.mul(0.008), 0, waterTime.mul(-0.006))),
    3,
    2.07,
    0.51,
  ).mul(0.5).add(0.5);
  const refracted = mix(color(0x051a27), color(0x0d4052), depthVariation);

  const airRay = normalize(reflect(view.negate(), normal));
  // Evaluate the exact same directional atmosphere, cloud transport and lunar
  // emitter that the visible sky dome uses. A reflected sky direction is not
  // representable by a constant native miss colour, and omitting the cloud
  // volume made almost every non-lunar reflection collapse toward black.
  // This remains project-authored TSL; the generic RTX pass handles geometry
  // hits without replacing this dynamic environment on ray misses.
  const reflectedSky = moonlitSkyRadianceNode(airRay);
  const refractedReflectance = refracted.mul(color(0x62858c))
    .add(color(0x071d2a).mul(0.58));
  const foam = oceanFoamCoverageNode(oceanFoamNode(persistentFoamSample));
  const foamReflectance = oceanFoamReflectanceNode();
  const atmosphere = oceanAerialPerspectiveNode();
  const clearWater = float(1).sub(foam);

  // Refraction/foam are reflectance inputs and therefore belong in colorNode.
  // The Fresnel complement keeps the refracted lobe energy-conserving before
  // the standard material evaluates scene lighting.
  const baseReflectance = mix(
    refractedReflectance.mul(float(1).sub(fresnel)),
    foamReflectance,
    foam,
  ).mul(atmosphere.transmittance);

  // These terms are complete outgoing radiance, authored live in JS/TSL. Foam
  // replaces the clear-water reflection just as it replaces refraction. Apply
  // aerial extinction here and add in-scattered horizon radiance once.
  // Direct Moon and buoy highlights come from their actual Three.js
  // DirectionalLight and PointLight. The physical lighting model already
  // evaluates anisotropic GGX with this material's live normal/roughness
  // nodes, so adding hand-evaluated emitters here would double their radiance
  // and create clipped reflection strips.
  const outgoingRadiance = reflectedSky.mul(fresnel)
    .mul(clearWater)
    .mul(atmosphere.transmittance)
    .add(atmosphere.radiance.mul(
      float(1).sub(atmosphere.transmittance),
    ));
  const debugLayers = splitWaterDebug(
    baseReflectance,
    outgoingRadiance,
    normal,
    fresnel,
  );
  material.colorNode = debugLayers.color;
  material.emissiveNode = debugLayers.emissive;
  material.normalNode = normal;
  material.anisotropyNode = surfaceFrame.anisotropyVector;
  material.roughnessNode = mix(
    // GGX consumes perceptual roughness (alpha = roughness^2). The frame node
    // maps the smaller covariance eigenvalue through that exact convention;
    // filtered directional energy independently widens the anisotropy tangent.
    surfaceFrame.perceptualRoughness,
    float(0.46),
    foam,
  );
  // The procedural sky and animated water are deliberately outside the static
  // TLAS. Preserve this complete JS/TSL environment response instead of asking
  // the generic one-bounce pass to replace it with its constant miss radiance.
  // RTX reflections remain active for ordinary scene materials whose guides
  // opt in through their own reflection masks.
  material.rtxReflectionMask = 0;
  return material;
}

function receiverDebug(beauty, receiverNormal = normalWorld) {
  const weights = debugWeights();
  const caustic = causticFieldNode(positionWorld, receiverNormal);
  const causticColor = mix(color(0x001018), color(0x9dfff1), caustic);
  const normalColor = receiverNormal.mul(0.5).add(0.5);
  const distance = length(positionWorld.sub(cameraPosition)).div(52).saturate();
  const transportColor = vec3(distance, caustic, float(1).sub(distance).mul(0.65));
  return mix(
    mix(mix(beauty, causticColor, weights.caustics), normalColor, weights.normals),
    transportColor,
    weights.transport,
  );
}

function submergedVolume(base) {
  const distanceToCamera = length(positionWorld.sub(cameraPosition)).sub(3).max(0);
  const absorption = vec3(0.045, 0.020, 0.010).mul(distanceToCamera).negate().exp();
  const loss = float(1).sub(absorption.x.mul(0.28)
    .add(absorption.y.mul(0.50)).add(absorption.z.mul(0.22))).saturate();
  const cameraUnderwater = float(1).sub(smoothstep(-0.15, 0.25, cameraPosition.y));
  const analytic = mix(base, base.mul(absorption).add(color(0x1b7f79).mul(loss.mul(0.20))), cameraUnderwater);
  return analytic;
}

export function createSandMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Moonlit tidal sand",
    color: palette.sand,
    metalness: 0,
    roughness: 0.94,
    clearcoat: 0.02,
  });
  const broad = mx_fractal_noise_float(positionWorld.mul(vec3(0.38, 0.12, 0.38)), 4, 2.03, 0.52)
    .mul(0.5).add(0.5);
  const grain = mx_noise_float(positionWorld.mul(vec3(11, 2.4, 11))).mul(0.5).add(0.5);
  const ripples = sin(positionWorld.x.mul(2.8)
    .add(sin(positionWorld.z.mul(0.36)).mul(1.8)))
    .mul(0.5).add(0.5);
  const wetBand = float(1).sub(smoothstep(-0.15, 1.25, positionWorld.y));
  const base = mix(color(0x746a58), color(0xb8a680), broad.mul(0.72).add(grain.mul(0.28)))
    .mul(mix(float(0.70), float(1.05), ripples))
    .mul(mix(float(1), float(0.68), wetBand));
  const caustic = causticFieldNode();
  const lit = base.add(mix(color(0x74dbcc), color(0xbbeee5), skyTransition)
    .mul(caustic.mul(0.38)));
  material.colorNode = receiverDebug(submergedVolume(lit));
  material.normalNode = bumpMap(broad.mul(0.12).add(grain.mul(0.025)).add(ripples.mul(0.035)), 0.38);
  material.roughnessNode = mix(float(0.72), float(0.98), grain).sub(wetBand.mul(0.13));
  return material;
}

export function createWetRockMaterial(baseHex = palette.wetRock) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Wet basalt",
    color: baseHex,
    metalness: 0.02,
    roughness: 0.62,
    clearcoat: 0.42,
    clearcoatRoughness: 0.18,
  });
  const macro = mx_fractal_noise_float(positionWorld.mul(0.48), 5, 2.07, 0.51).mul(0.5).add(0.5);
  const pores = mx_noise_float(positionWorld.mul(8.4)).mul(0.5).add(0.5);
  const tideWetness = float(1).sub(smoothstep(0.2, 2.4, positionWorld.y));
  const upward = smoothstep(-0.25, 0.86, normalWorld.y);
  const moss = smoothstep(0.54, 0.78, macro).mul(upward).mul(tideWetness);
  const rock = mix(color(baseHex).mul(0.67), color(baseHex).mul(1.18), macro)
    .mul(mix(float(0.82), float(1.08), pores));
  const colored = mix(rock, color(0x315948), moss.mul(0.55));
  const caustic = causticFieldNode();
  const beauty = submergedVolume(colored.add(color(0x72d9ce)
    .mul(caustic.mul(0.21))));
  material.colorNode = receiverDebug(beauty);
  material.normalNode = bumpMap(macro.mul(0.19).add(pores.mul(0.045)), 0.52);
  material.roughnessNode = mix(float(0.77), float(0.48), tideWetness.mul(upward))
    .add(pores.mul(0.12));
  material.clearcoatNode = mix(float(0.08), float(0.64), tideWetness.mul(upward));
  return material;
}

export function createRuinMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Drowned limestone",
    color: 0x70766c,
    metalness: 0,
    roughness: 0.84,
    clearcoat: 0.06,
  });
  const strata = sin(positionWorld.y.mul(4.5)
    .add(mx_noise_float(positionWorld.mul(0.6)).mul(2.2))).mul(0.5).add(0.5);
  const chips = mx_fractal_noise_float(positionWorld.mul(1.8), 4, 2.05, 0.5).mul(0.5).add(0.5);
  const algae = smoothstep(0.55, 0.78, chips)
    .mul(float(1).sub(smoothstep(-0.5, 0.5, positionWorld.y)));
  const stone = mix(color(0x4c534e), color(0xa4a28d), strata.mul(0.55).add(chips.mul(0.45)));
  const beauty = submergedVolume(mix(stone, color(0x315f4e), algae.mul(0.58))
    .add(color(0x87e9da).mul(causticFieldNode().mul(0.28))));
  material.colorNode = receiverDebug(beauty);
  material.normalNode = bumpMap(strata.mul(0.12).add(chips.mul(0.12)), 0.44);
  return material;
}

export function createBronzeMaterial() {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: "Moon-gate bronze",
    color: palette.bronze,
    metalness: 0.86,
    roughness: 0.29,
    clearcoat: 0.25,
    clearcoatRoughness: 0.16,
  });
  const patina = mx_fractal_noise_float(positionWorld.mul(1.45), 4, 2.09, 0.49).mul(0.5).add(0.5);
  const etched = abs(sin(positionWorld.y.mul(11).add(positionWorld.x.mul(3.7))));
  const bronze = mix(color(0x34281e), color(0xb37a3f), patina);
  const beauty = submergedVolume(mix(bronze, color(0x2e7568), smoothstep(0.58, 0.82, patina).mul(0.68))
    .add(color(0x80e5d5).mul(causticFieldNode().mul(0.19)))
    .add(color(0xf5c481).mul(pow(etched, 18).mul(0.08))));
  material.colorNode = receiverDebug(beauty);
  material.rtxReflectionMask = 0.92;
  return material;
}

// Integrate each physical deck separately. Samples are concentrated inside
// cloud-bearing altitude ranges instead of empty air; the denser low-deck rule
// prevents individual grazing-angle samples from appearing as horizontal
// streaks while retaining exact spherical path length.
function cloudSphereExitDistanceNode(origin, direction, radius) {
  const b = dot(origin, direction);
  const c = dot(origin, origin).sub(radius * radius);
  const root = b.mul(b).sub(c).max(0).sqrt();

  // Stable form of -b + sqrt(b*b-c), avoiding cancellation on near-zenith
  // rays while keeping the Earth-scale calculation numerically safe in f32.
  return c.negate().div(b.add(root).max(0.0001)).max(0);
}

function cloudLayerSegmentNode(origin, direction, baseKm, topKm) {
  const start = cloudSphereExitDistanceNode(
    origin,
    direction,
    CLOUD_PLANET_RADIUS_KM + baseKm,
  );
  const end = cloudSphereExitDistanceNode(
    origin,
    direction,
    CLOUD_PLANET_RADIUS_KM + topKm,
  );
  return { start, length: end.sub(start).max(0) };
}

function cloudDensityNode(shellPoint, altitudeKm, highLayer = false) {
  // Twelve metres per second along the authored ocean wind direction. Shell
  // coordinates are kilometres. Anisotropic frequencies form marine cloud
  // streets, while erosion and a noise-driven low-cloud top break the slab.
  const advectedX = shellPoint.x.sub(waterTime.mul(0.00384));
  const advectedZ = shellPoint.z.sub(waterTime.mul(0.01136));
  const windU = advectedX.mul(0.32).add(advectedZ.mul(0.947));
  const windV = advectedX.mul(-0.947).add(advectedZ.mul(0.32));
  let weatherA = float(0);
  let weatherB = float(0);
  let densityU = windU;
  let densityV = windV;
  if (!highLayer) {
    weatherA = sin(
      windU.mul(0.014).add(windV.mul(0.006)).add(1.7),
    );
    weatherB = cos(
      windU.mul(-0.005).add(windV.mul(0.017)).sub(0.8),
    );
    // Mesoscale wind curvature bends otherwise ruler-straight marine cloud
    // streets. Reusing the weather field keeps the warp coherent and avoids
    // another expensive noise octave.
    densityU = windU.add(weatherB.mul(4.0));
    densityV = windV.add(weatherA.mul(2.0));
  }
  const lowShear = altitudeKm.sub(1.35);
  const coarseCoord = highLayer
    ? vec3(windU.mul(0.028), altitudeKm.mul(0.24), windV.mul(0.070))
      .add(vec3(31.7, -5.8, 2.4))
    : vec3(
      densityU.mul(0.060).add(lowShear.mul(0.31)),
      altitudeKm.mul(0.68),
      densityV.mul(0.155).sub(lowShear.mul(0.18)),
    )
      .add(vec3(7.1, -2.4, 11.6));
  const detailCoord = highLayer
    ? coarseCoord.mul(2.41).add(vec3(13.1, -7.3, 19.7))
    : coarseCoord.mul(2.27).add(vec3(17.1, -8.3, 5.7));
  const coarse = mx_noise_float(coarseCoord).mul(0.5).add(0.5);
  const detail = mx_noise_float(detailCoord).mul(0.5).add(0.5);
  const structure = coarse
    .sub(detail.mul(highLayer ? 0.13 : 0.18))
    .add(highLayer ? 0.065 : 0.09);

  if (highLayer) {
    const profile = smoothstep(4.20, 4.55, altitudeKm)
      .mul(float(1).sub(smoothstep(6.35, 7.10, altitudeKm)));
    return smoothstep(0.63, 0.78, structure).mul(profile);
  }

  // Broad, incommensurate weather cells vary coverage without paying for a
  // third noise field. Because they use the same advected wind coordinates,
  // gaps and denser banks move coherently with the resolved cloud volume.
  const weather = weatherA.mul(0.62)
    .add(weatherB.mul(0.38))
    .mul(0.5).add(0.5).saturate();
  const coverage = smoothstep(0.32, 0.68, weather);

  // Marine banks do not share a ruler-flat condensation level. Dense cells
  // hang lower while broken cells lift and erode, giving the horizon shelf
  // holes, scud and a variable underside that the Moon-ray probe can shadow.
  const cloudBase = float(0.76)
    .add(float(0.5).sub(coarse).mul(0.28))
    .add(float(1).sub(coverage).mul(0.10));
  const lumpyTop = float(1.62).add(coarse.mul(0.65));
  const profile = smoothstep(cloudBase, cloudBase.add(0.20), altitudeKm)
    .mul(float(1).sub(smoothstep(
      lumpyTop.sub(0.22),
      lumpyTop.add(0.12),
      altitudeKm,
    )));
  const densityOnset = mix(float(0.68), float(0.59), coverage);
  return smoothstep(
    densityOnset,
    densityOnset.add(0.14),
    structure,
  ).mul(profile).mul(coverage);
}

function cloudMoonTransmittanceNode(
  shellPoint,
  topKm,
  extinctionPerKm,
  highLayer,
  quadrature = CLOUD_LIGHT_QUADRATURE,
) {
  // Trace from the representative scattering point toward the Moon through
  // the same authored density field. This is deliberately scene-side TSL:
  // the renderer only supplies the general GPU pipeline used to evaluate it.
  const lightPathKm = cloudSphereExitDistanceNode(
    shellPoint,
    moonSkyDirection,
    CLOUD_PLANET_RADIUS_KM + topKm,
  ).min(12);
  let lightTau = float(0);

  for (const sample of quadrature) {
    const sampleDistance = lightPathKm.mul(sample.position);
    const lightPoint = shellPoint.add(moonSkyDirection.mul(sampleDistance));
    const altitudeKm = length(lightPoint).sub(CLOUD_PLANET_RADIUS_KM);
    const density = cloudDensityNode(lightPoint, altitudeKm, highLayer);
    lightTau = lightTau.add(
      density
        .mul(lightPathKm.mul(sample.weight))
        .mul(extinctionPerKm),
    );
  }

  return lightTau.negate().exp();
}

function marineClearSkyNode(ray) {
  const elevation = saturate(ray.y.mul(1.08).add(0.015));
  const night = mix(color(0x132d40), color(0x01040a), pow(elevation, 0.56));
  // Treat marine haze as extinction, not as a cyan strip painted over the
  // horizon. The longer optical path close to sea level desaturates and dims
  // every atmospheric contribution in the same way.
  // Approximate the finite curvature-limited horizon path continuously. The
  // exponential term tends to 0.025 at the horizon (air mass ~= 40) and fades
  // away smoothly as the ray rises, avoiding the old hard secant clamp kink.
  const horizonMu = ray.y.max(0);
  const airMass = float(1).div(
    horizonMu.add(horizonMu.mul(-11).exp().mul(0.025)),
  );
  const hazeT = airMass.mul(-0.024).exp();
  // Resolve the direct optical transmission spectrally. A neutral marine
  // aerosol dominates, while the small Rayleigh remainder removes blue more
  // strongly along the Moon's long, low-elevation path. Keep green anchored to
  // the established scalar extinction so this changes chromaticity without
  // silently raising the scene exposure.
  const hazeTRgb = vec3(
    airMass.mul(-0.0185).exp(),
    hazeT,
    airMass.mul(-0.0330).exp(),
  );
  // Diffuse sky radiance is already an integral over many paths, so blend the
  // spectral result toward the scalar model rather than applying the full
  // point-source reddening used by the lunar disc.
  const skyHazeTRgb = vec3(
    hazeT.mul(0.40).add(hazeTRgb.x.mul(0.60)),
    hazeT,
    hazeT.mul(0.40).add(hazeTRgb.z.mul(0.60)),
  );
  const hazeAmount = float(1).sub(hazeT);
  const moonMu = dot(ray, moonSkyDirection).clamp(-1, 1);
  const moonAlignment = moonMu.max(0);

  // Moonlight is not confined to the lunar disc. Molecules create a broad
  // Rayleigh field while marine aerosol adds a weak forward lobe. Both are
  // scaled by the same optical path used for extinction, so the extra sky
  // energy is directional and grows naturally toward the horizon rather than
  // acting like a global exposure lift.
  const rayleighDepth = float(1).sub(airMass.mul(-0.006).exp());
  const rayleighPhase = float(0.5).mul(
    float(1).add(moonMu.mul(moonMu)),
  );
  const aerosolG = 0.72;
  const aerosolDenominator = float(1 + aerosolG * aerosolG)
    .sub(moonMu.mul(2 * aerosolG))
    .max(0.0001);
  const aerosolPhase = float((1 - aerosolG) ** 3)
    .div(pow(aerosolDenominator, 1.5));
  const lunarSkyScatter = color(0x7897ad).mul(
    rayleighDepth.mul(rayleighPhase).mul(0.050)
      .add(hazeAmount.mul(aerosolPhase).mul(0.018)),
  );
  const clearSky = night.mul(skyHazeTRgb)
    .add(color(0x1b3947).mul(hazeAmount.mul(0.46)))
    .add(lunarSkyScatter);

  return {
    clearSky,
    hazeT,
    hazeTRgb,
    hazeAmount,
    moonMu,
    moonAlignment,
  };
}

function moonlitAtmosphereFields(ray) {
  const {
    clearSky,
    hazeT,
    hazeTRgb,
    hazeAmount,
    moonAlignment,
  } = marineClearSkyNode(ray);

  // Integrate two spherical cloud decks. Horizon rays travel farther through
  // each deck than zenith rays, producing genuine optical thickness.
  const cloudRay = normalize(vec3(ray.x, ray.y.max(0.004), ray.z));
  const originKm = vec3(
    cameraPosition.x.mul(0.001),
    cameraPosition.y.mul(0.001).add(CLOUD_PLANET_RADIUS_KM),
    cameraPosition.z.mul(0.001),
  );
  const lowSegment = cloudLayerSegmentNode(
    originKm,
    cloudRay,
    CLOUD_LOW_BASE_KM,
    CLOUD_LOW_TOP_KM,
  );
  const highSegment = cloudLayerSegmentNode(
    originKm,
    cloudRay,
    CLOUD_HIGH_BASE_KM,
    CLOUD_HIGH_TOP_KM,
  );
  let highTau = float(0);
  const lowSlabIntegrals = CLOUD_LOW_SLABS.map(() => ({
    tau: float(0),
    mass: float(0),
    distanceMoment: float(0),
  }));

  for (let sampleIndex = 0; sampleIndex < CLOUD_LOW_QUADRATURE.length; sampleIndex += 1) {
    const sample = CLOUD_LOW_QUADRATURE[sampleIndex];
    let slabIndex = CLOUD_LOW_SLABS.length - 1;
    for (let candidate = 1; candidate < CLOUD_LOW_SLABS.length; candidate += 1) {
      if (sampleIndex < CLOUD_LOW_SLABS[candidate].firstSample) {
        slabIndex = candidate - 1;
        break;
      }
    }
    const slab = lowSlabIntegrals[slabIndex];
    const sampleDistance = lowSegment.start.add(
      lowSegment.length.mul(sample.position),
    );
    const shellPoint = originKm.add(cloudRay.mul(sampleDistance));
    const altitudeKm = length(shellPoint).sub(CLOUD_PLANET_RADIUS_KM);
    const density = cloudDensityNode(shellPoint, altitudeKm, false);
    const weightedPathKm = lowSegment.length.mul(sample.weight);
    const mass = density.mul(weightedPathKm);
    slab.mass = slab.mass.add(mass);
    slab.distanceMoment = slab.distanceMoment.add(mass.mul(sampleDistance));
    slab.tau = slab.tau.add(mass.mul(CLOUD_LOW_EXTINCTION_PER_KM));
  }

  for (const sample of CLOUD_HIGH_QUADRATURE) {
    const sampleDistance = highSegment.start.add(
      highSegment.length.mul(sample.position),
    );
    const shellPoint = originKm.add(cloudRay.mul(sampleDistance));
    const altitudeKm = length(shellPoint).sub(CLOUD_PLANET_RADIUS_KM);
    const density = cloudDensityNode(shellPoint, altitudeKm, true);
    const weightedPathKm = highSegment.length.mul(sample.weight);
    highTau = highTau.add(
      density.mul(weightedPathKm).mul(CLOUD_HIGH_EXTINCTION_PER_KM),
    );
  }

  const horizonGate = smoothstep(0.004, 0.020, ray.y);
  const lowSlabs = lowSlabIntegrals.map((integral, slabIndex) => {
    const descriptor = CLOUD_LOW_SLABS[slabIndex];
    const tau = integral.tau.mul(horizonGate);
    const fallbackDistance = lowSegment.start.add(
      lowSegment.length.mul(descriptor.fallbackPosition),
    );
    const centroidDistance = mix(
      fallbackDistance,
      integral.distanceMoment.div(integral.mass.max(0.0001)),
      step(0.0001, integral.mass),
    );
    const lightPoint = originKm.add(cloudRay.mul(centroidDistance));
    const opacity = float(1).sub(tau.negate().exp());

    return {
      tau,
      opacity,
      lightT: cloudMoonTransmittanceNode(
        lightPoint,
        CLOUD_LOW_TOP_KM,
        CLOUD_LOW_EXTINCTION_PER_KM,
        false,
        CLOUD_LIGHT_QUADRATURE_TWO_POINT,
      ),
      viewT: centroidDistance.min(140).mul(-0.008).exp(),
      noise: tau.div(
        lowSegment.length
          .mul(descriptor.quadratureWeight)
          .mul(CLOUD_LOW_EXTINCTION_PER_KM)
          .add(0.001),
      ).saturate(),
    };
  });
  let lowTau = float(0);
  for (const slab of lowSlabs) {
    lowTau = lowTau.add(slab.tau);
  }
  highTau = highTau.mul(horizonGate);

  const cloudTau = lowTau.add(highTau);
  const cloudT = cloudTau.negate().exp();
  const cloudOpacity = float(1).sub(cloudT);
  const lowCloud = float(1).sub(lowTau.negate().exp());
  const highCloud = float(1).sub(highTau.negate().exp());
  // The high deck is optically thin and much less visually dominant. Keep a
  // stable analytic mean there rather than doubling cloud-noise evaluation.
  const highVerticalTau = highTau.mul(cloudRay.y.max(0.035));
  const highMoonPathTau = highVerticalTau.mul(0.52)
    .div(moonSkyDirection.y.max(0.08));
  const highCloudLightT = float(1).sub(highMoonPathTau.negate().exp())
    .div(highMoonPathTau.max(0.001));
  const highCloudViewT = highSegment.start.min(140).mul(-0.008).exp();
  const highNoise = highTau.div(
    highSegment.length.mul(CLOUD_HIGH_EXTINCTION_PER_KM).add(0.001),
  ).saturate();
  const highSlab = {
    opacity: highCloud,
    lightT: highCloudLightT,
    viewT: highCloudViewT,
    noise: highNoise,
  };

  // Keep aggregate fields for point-source visibility and diagnostics, while
  // exposing the resolved slabs to the sky shader for front-to-back transport.
  let lowSlabWeight = float(0);
  let lowCloudLightNumerator = float(0);
  let lowCloudViewNumerator = float(0);
  let lowNoiseNumerator = float(0);
  for (const slab of lowSlabs) {
    lowSlabWeight = lowSlabWeight.add(slab.opacity);
    lowCloudLightNumerator = lowCloudLightNumerator.add(slab.lightT.mul(slab.opacity));
    lowCloudViewNumerator = lowCloudViewNumerator.add(slab.viewT.mul(slab.opacity));
    lowNoiseNumerator = lowNoiseNumerator.add(slab.noise.mul(slab.opacity));
  }
  lowSlabWeight = lowSlabWeight.max(0.001);
  const lowCloudLightT = lowCloudLightNumerator.div(lowSlabWeight);
  const lowCloudViewT = lowCloudViewNumerator.div(lowSlabWeight);
  const lowNoise = lowNoiseNumerator.div(lowSlabWeight);
  const cloudLightT = lowCloudLightT.mul(lowCloud)
    .add(highCloudLightT.mul(highCloud))
    .div(lowCloud.add(highCloud).max(0.001));
  const cloudViewT = lowCloudViewT.mul(lowCloud)
    .add(highCloudViewT.mul(highCloud))
    .div(lowCloud.add(highCloud).max(0.001));
  // Preserve the 0.28 degree authored angular diameter of the Moon. The same
  // disc test is shared with point-source visibility so no stars can leak
  // through the luminous lunar surface.
  const moonDisc = lunarDiscMaskNode(ray, moonSkyDirection);

  return {
    clearSky,
    hazeT,
    hazeTRgb,
    hazeAmount,
    lowCloud,
    highCloud,
    lowNoise,
    highNoise,
    lowSlabs,
    highSlab,
    moonAlignment,
    moonDisc,
    cloudT,
    cloudOpacity,
    cloudLightT,
    cloudViewT,
  };
}

export function starVisibilityNode(ray = normalize(positionWorld.sub(cameraPosition))) {
  const {
    hazeT,
    moonAlignment,
    moonDisc,
    cloudT,
  } = moonlitAtmosphereFields(ray);

  // Stars are effectively point sources. Their contrast is lost much sooner
  // than the diffuse sky as the optical path through sea haze grows, so use
  // the same Beer-Lambert transmission with a stronger point-source depth.
  const horizonT = pow(hazeT, 2.8)
    .mul(smoothstep(0.075, 0.22, ray.y));
  // Broad lunar glare masks faint stars before the much tighter inner halo.
  // This is extinction of the star field, not another additive glow.
  const glareExtinction = pow(moonAlignment, 36).mul(0.78)
    .add(pow(moonAlignment, 720).mul(0.22))
    .saturate();
  const lunarT = float(1).sub(glareExtinction)
    .mul(float(1).sub(moonDisc));

  return cloudT.mul(horizonT).mul(lunarT).saturate();
}

function cloudSlabRadianceNode(
  slab,
  clearSky,
  lunarPhase,
  forwardPhase,
  globalCloudEdge,
  cloudOpacity,
) {
  const bodyShade = mix(float(1.04), float(0.76), slab.noise);
  const edgeShare = slab.opacity.div(cloudOpacity.max(0.001));
  const ambientInscatter = clearSky.mul(slab.opacity.mul(0.20))
    .add(color(0x20313b).mul(slab.opacity.mul(0.24)))
    .mul(bodyShade);
  // Cloud droplets are nearly spectrally neutral at visible wavelengths.
  // Their silver lining therefore inherits the same atmosphere-filtered Moon
  // spectrum as the disc and water glint; cyan comes from the surrounding sky,
  // not from painting a second, unrelated light color onto the cloud.
  const lunarInscatter = moonDirectRadiance.mul(
    slab.opacity
      .mul(slab.lightT)
      .mul(lunarPhase)
      .mul(0.118),
  );
  const silverEdge = moonDirectRadiance
    .mul(globalCloudEdge)
    .mul(edgeShare)
    .mul(forwardPhase)
    .mul(slab.lightT)
    .mul(0.012);

  return ambientInscatter.add(lunarInscatter).add(silverEdge);
}

function moonlitSkyRadianceNode(ray) {
  const {
    clearSky,
    hazeT,
    hazeTRgb,
    hazeAmount,
    moonAlignment,
    cloudT,
    cloudOpacity,
    lowSlabs,
    highSlab,
  } = moonlitAtmosphereFields(ray);

  // Forward-normalized Henyey-Greenstein phase approximation. At exact
  // alignment it is one, making the source scale below easy to calibrate.
  const cloudAsymmetry = 0.78;
  const phaseDenominator = float(1 + cloudAsymmetry * cloudAsymmetry)
    .sub(moonAlignment.mul(2 * cloudAsymmetry))
    .max(0.0001);
  const forwardPhase = float((1 - cloudAsymmetry) ** 3)
    .div(pow(phaseDenominator, 1.5));
  // A small multiple-scattering floor represents broad lunar and sky light;
  // the forward lobe still supplies the directional silver lining.
  const lunarPhase = forwardPhase.mul(0.92).add(0.018);
  const globalCloudEdge = pow(
    cloudOpacity.mul(float(1).sub(cloudOpacity)).mul(4).saturate(),
    0.7,
  );

  // Resolve the low cloud volume as near, middle and far transport slabs, then
  // place the optically thin high deck behind them. Each slab owns its Moon
  // self-shadow and camera-path extinction, so banks overlap with actual depth
  // instead of collapsing into one uniformly shaded horizon card.
  const cloudSlabs = [...lowSlabs, highSlab];
  let cloudRadiance = vec3(0);
  let foregroundCloudT = float(1);
  for (const slab of cloudSlabs) {
    const slabRadiance = cloudSlabRadianceNode(
      slab,
      clearSky,
      lunarPhase,
      forwardPhase,
      globalCloudEdge,
      cloudOpacity,
    );
    const slabAerialPerspective = clearSky.mul(
      slab.opacity.mul(float(1).sub(slab.viewT)),
    ).add(slabRadiance.mul(slab.viewT));
    cloudRadiance = cloudRadiance.add(
      slabAerialPerspective.mul(foregroundCloudT),
    );
    foregroundCloudT = foregroundCloudT.mul(
      float(1).sub(slab.opacity),
    );
  }

  // A low Moon seen through a marine boundary layer has a visible Mie
  // aureole several lunar diameters wide. Keep it tied to measured optical
  // loss (`hazeAmount`) so it vanishes naturally in clear zenith air and is
  // extinguished by the exact same cloud column as the lunar disc.
  const outerAureole = pow(moonAlignment, 180).mul(0.055);
  const innerAureole = pow(moonAlignment, 1050).mul(0.155);
  return clearSky.mul(cloudT)
    .add(cloudRadiance)
    .add(moonDirectRadiance.mul(
      innerAureole.add(outerAureole)
        .mul(hazeAmount)
        .mul(cloudT)
        .mul(0.81),
    ))
    .add(lunarSurfaceRadianceNode(ray, moonSkyDirection)
      .mul(cloudT).mul(hazeTRgb));
}

export function createSkyMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Procedural moonlit marine sky",
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const ray = normalize(positionWorld.sub(cameraPosition));
  material.colorNode = moonlitSkyRadianceNode(ray);
  return material;
}

export function createFoamMaterial(opacity = 0.8) {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Moonlit wave foam",
    color: 0x91d9d2,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  material.blending = THREE.NormalBlending;
  material.toneMapped = true;
  material.rtxReflectionMask = 0;
  return material;
}

export function updateMaterialTime(seconds, transition, energy = 1, debug = 0) {
  waterTime.value = Number.isFinite(seconds) ? seconds : 0;
  skyTransition.value = THREE.MathUtils.clamp(Number(transition) || 0, 0, 1);
  waveEnergy.value = THREE.MathUtils.clamp(Number(energy) || 0, 0, 1.35);
  debugView.value = THREE.MathUtils.clamp(Math.trunc(Number(debug) || 0), 0, 4);
}

export function setMoonEmitterVisibility(transmission) {
  moonEmitterVisibility.value = THREE.MathUtils.clamp(
    Number.isFinite(transmission) ? transmission : 1,
    0,
    1,
  );
}
