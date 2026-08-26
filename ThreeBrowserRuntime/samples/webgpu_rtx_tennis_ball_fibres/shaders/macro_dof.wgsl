struct DofParameters {
  inverseViewProjection: mat4x4<f32>,
  cameraPosition: vec4<f32>,
  focus: vec4<f32>,
  extent: vec4<u32>,
};

@group(0) @binding(0) var hdrInput: texture_2d<f32>;
@group(0) @binding(1) var depthInput: texture_depth_2d;
@group(0) @binding(2) var hdrOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> parameters: DofParameters;

const GOLDEN_ANGLE: f32 = 2.399963229728653;
const SAMPLE_COUNT: u32 = 16u;

fn clampedPixel(pixel: vec2<i32>) -> vec2<i32> {
  return clamp(pixel, vec2<i32>(0), vec2<i32>(parameters.extent.xy) - vec2<i32>(1));
}

fn worldPosition(pixel: vec2<i32>, depth: f32) -> vec3<f32> {
  let safePixel = clampedPixel(pixel);
  let uv = (vec2<f32>(safePixel) + vec2<f32>(0.5)) / vec2<f32>(parameters.extent.xy);
  let clip = vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let world = parameters.inverseViewProjection * clip;
  return world.xyz / max(abs(world.w), 0.0000001);
}

fn cameraDistance(pixel: vec2<i32>, depth: f32) -> f32 {
  return length(worldPosition(pixel, depth) - parameters.cameraPosition.xyz);
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (any(gid.xy >= parameters.extent.xy)) {
    return;
  }
  let pixel = vec2<i32>(gid.xy);
  let centerDepth = textureLoad(depthInput, pixel, 0);
  let centerColor = textureLoad(hdrInput, pixel, 0);
  if (centerDepth >= 0.999999 || parameters.focus.z <= 0.001) {
    textureStore(hdrOutput, pixel, centerColor);
    return;
  }

  let centreDistance = cameraDistance(pixel, centerDepth);
  let focusDistance = max(0.001, parameters.focus.x);
  let maximumCoc = max(0.0, parameters.focus.y);
  let relativeDefocus = abs(centreDistance - focusDistance) / focusDistance;
  let coc = min(maximumCoc, relativeDefocus * parameters.focus.w);
  if (coc < 0.55) {
    textureStore(hdrOutput, pixel, centerColor);
    return;
  }

  var accumulated = centerColor.rgb * 1.35;
  var totalWeight = 1.35;
  for (var sampleIndex = 0u; sampleIndex < SAMPLE_COUNT; sampleIndex = sampleIndex + 1u) {
    let fraction = (f32(sampleIndex) + 0.5) / f32(SAMPLE_COUNT);
    let angle = f32(sampleIndex) * GOLDEN_ANGLE;
    let disk = vec2<f32>(cos(angle), sin(angle)) * sqrt(fraction);
    let samplePixel = clampedPixel(pixel + vec2<i32>(round(disk * coc)));
    let sampleDepth = textureLoad(depthInput, samplePixel, 0);
    if (sampleDepth >= 0.999999) {
      continue;
    }
    let sampleDistance = cameraDistance(samplePixel, sampleDepth);
    // Reject strong foreground/background discontinuities. This keeps a pale
    // seam or the black studio from bleeding through single-pixel filaments.
    let depthDelta = abs(sampleDistance - centreDistance);
    let bilateralWidth = max(0.0015, centreDistance * 0.055);
    let depthWeight = exp(-depthDelta / bilateralWidth);
    let radialWeight = mix(1.0, 0.58, fraction);
    let weight = depthWeight * radialWeight;
    accumulated += textureLoad(hdrInput, samplePixel, 0).rgb * weight;
    totalWeight += weight;
  }
  let blurred = accumulated / max(totalWeight, 0.0001);
  let blendAmount = smoothstep(0.7, 2.8, coc) * parameters.focus.z;
  textureStore(hdrOutput, pixel, vec4<f32>(mix(centerColor.rgb, blurred, blendAmount), centerColor.a));
}
