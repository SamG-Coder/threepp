struct FrameUniforms {
  viewProjection: mat4x4<f32>,
  cameraPosition: vec4<f32>,
  lightDirectionIntensity: vec4<f32>,
  lightColor: vec4<f32>,
  environment: vec4<f32>,
};

@group(0) @binding(0) var positionAtlas: texture_2d<f32>;
@group(0) @binding(1) var<storage, read> appearance: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> frame: FrameUniforms;

const ATLAS_WIDTH: u32 = 1024u;
const VERTICES_PER_FIBRE: u32 = 48u;
const RINGS: u32 = 12u;
const SIDES: u32 = 4u;

fn loadPosition(vertexIndex: u32) -> vec3<f32> {
  let pixel = vec2<i32>(
    i32(vertexIndex % ATLAS_WIDTH),
    i32(vertexIndex / ATLAS_WIDTH),
  );
  return textureLoad(positionAtlas, pixel, 0).xyz;
}

fn loadRingCentre(fibreIndex: u32, ring: u32) -> vec3<f32> {
  let base = fibreIndex * VERTICES_PER_FIBRE + ring * SIDES;
  return (loadPosition(base) + loadPosition(base + 1u) +
    loadPosition(base + 2u) + loadPosition(base + 3u)) * 0.25;
}

struct VertexOutput {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) fibreTangent: vec3<f32>,
  @location(2) baseColorRoughness: vec4<f32>,
  @location(3) fibreNormal: vec3<f32>,
  @location(4) fibreU: f32,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let fibreIndex = vertexIndex / VERTICES_PER_FIBRE;
  let localIndex = vertexIndex % VERTICES_PER_FIBRE;
  let ring = localIndex / SIDES;
  let worldPosition = loadPosition(vertexIndex);
  let centre = loadRingCentre(fibreIndex, ring);
  let before = loadRingCentre(fibreIndex, max(1u, ring) - 1u);
  let after = loadRingCentre(fibreIndex, min(RINGS - 1u, ring + 1u));
  let tangent = normalize(after - before);
  var output: VertexOutput;
  output.clipPosition = frame.viewProjection * vec4<f32>(worldPosition, 1.0);
  output.worldPosition = worldPosition;
  output.fibreTangent = tangent;
  output.baseColorRoughness = appearance[fibreIndex];
  output.fibreNormal = normalize(worldPosition - centre);
  output.fibreU = f32(ring) / f32(RINGS - 1u);
  return output;
}

@fragment
fn fragmentMain(
  input: VertexOutput,
  @builtin(front_facing) frontFacing: bool,
) -> @location(0) vec4<f32> {
  let toCamera = normalize(frame.cameraPosition.xyz - input.worldPosition);
  var normal = normalize(input.fibreNormal);
  if (!frontFacing) {
    normal = -normal;
  }
  if (dot(normal, toCamera) < 0.0) {
    normal = -normal;
  }

  let lightDirection = normalize(frame.lightDirectionIntensity.xyz);
  let halfway = normalize(lightDirection + toCamera);
  let tangent = normalize(input.fibreTangent);
  let nDotL = max(dot(normal, lightDirection), 0.0);
  let nDotV = max(dot(normal, toCamera), 0.0);
  let wrappedDiffuse = clamp((dot(normal, lightDirection) + 0.42) / 1.42, 0.0, 1.0);
  let tangentHalfway = clamp(dot(tangent, halfway), -1.0, 1.0);
  let sineHalfway = sqrt(max(0.0, 1.0 - tangentHalfway * tangentHalfway));
  let roughness = clamp(input.baseColorRoughness.a, 0.45, 1.0);
  let anisotropicPower = mix(78.0, 28.0, roughness);
  let anisotropicSpecular = pow(sineHalfway, anisotropicPower) *
    (0.11 + 0.15 * (1.0 - roughness)) * (0.25 + 0.75 * nDotL);
  let rim = pow(1.0 - nDotV, 2.15);
  let backScatter = pow(max(dot(-lightDirection, toCamera), 0.0), 4.0);
  let rootToTip = mix(0.82, 1.16, smoothstep(0.0, 0.86, input.fibreU));
  let baseColor = max(input.baseColorRoughness.rgb * rootToTip, vec3<f32>(0.0));
  let diffuse = baseColor * (
    vec3<f32>(0.30, 0.33, 0.18) + frame.environment.rgb * frame.environment.a +
    frame.lightColor.rgb * frame.lightDirectionIntensity.w *
      (0.17 * nDotL + 0.49 * wrappedDiffuse)
  );
  let sheen = mix(baseColor, vec3<f32>(0.92, 0.90, 0.72), 0.36) *
    (rim * 0.19 + backScatter * (0.11 + 0.16 * rim));
  let specular = frame.lightColor.rgb * anisotropicSpecular;
  // Continuous optical coverage, not a distance LOD: every tube is still
  // rasterized and ray traced, but a sub-pixel filament cannot contribute an
  // entire bright pixel when the camera pulls back.
  let distanceToCamera = length(frame.cameraPosition.xyz - input.worldPosition);
  let subpixelCoverage = clamp(0.34 / max(0.12, distanceToCamera), 0.07, 1.0);
  let filamentAlpha = mix(0.56, 0.78, smoothstep(0.0, 0.72, input.fibreU)) *
    subpixelCoverage;
  return vec4<f32>(diffuse + sheen + specular, filamentAlpha);
}
