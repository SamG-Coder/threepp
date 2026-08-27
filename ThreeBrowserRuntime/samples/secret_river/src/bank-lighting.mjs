/**
 * lighting-v1 compute profile for the 2.5D riverbank.
 *
 * evaluateRayLighting reconstructs receivers from depth. Camera-facing
 * cutout cards reconstruct as walls and self-shadow to black. Water is a
 * horizontal planar reflector and must keep its raster colour. This shader
 * leaves those pixels unchanged and only darkens the dirt bank.
 */
export const BANK_LIGHTING_GLSL = `#version 460
#extension GL_EXT_ray_query : require

layout(local_size_x = 8, local_size_y = 8, local_size_z = 1) in;

layout(set = 0, binding = 0) uniform accelerationStructureEXT topLevelScene;
layout(rgba16f, set = 0, binding = 1) uniform image2D hdrColor;
layout(set = 0, binding = 2) uniform sampler2D sceneDepth;

layout(push_constant) uniform FrameConstants {
    mat4 inverseViewProjection;
    vec4 cameraPositionMaximumDistance;
    vec4 directionalLightDirectionAngularRadius;
    vec4 lightingParameters;
    uvec4 extentFlags;
} frame;

const uint kDepthInverted = 1u;
const uint kDirectionalSampleShift = 8u;
const uint kAoSampleShift = 16u;
const uint kSampleMask = 0xffu;

float readDepth(ivec2 pixel) {
    pixel = clamp(pixel, ivec2(0), ivec2(frame.extentFlags.xy) - ivec2(1));
    return texelFetch(sceneDepth, pixel, 0).r;
}

bool isBackground(float depth) {
    return (frame.extentFlags.z & kDepthInverted) != 0u
        ? depth <= 1e-6
        : depth >= 0.999999;
}

vec3 reconstructWorld(ivec2 pixel, float depth) {
    pixel = clamp(pixel, ivec2(0), ivec2(frame.extentFlags.xy) - ivec2(1));
    vec2 uv = (vec2(pixel) + vec2(0.5)) / vec2(frame.extentFlags.xy);
    vec4 clip = vec4(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
    vec4 world = frame.inverseViewProjection * clip;
    return world.xyz / max(abs(world.w), 1e-8);
}

bool occluded(vec3 origin, vec3 direction, float maximumDistance) {
    rayQueryEXT query;
    rayQueryInitializeEXT(query, topLevelScene,
        gl_RayFlagsOpaqueEXT | gl_RayFlagsTerminateOnFirstHitEXT,
        0xffu, origin, 0.0, direction, maximumDistance);
    while (rayQueryProceedEXT(query)) {}
    return rayQueryGetIntersectionTypeEXT(query, true) !=
        gl_RayQueryCommittedIntersectionNoneEXT;
}

uint hash(uint value) {
    value ^= value >> 16u;
    value *= 0x7feb352du;
    value ^= value >> 15u;
    value *= 0x846ca68bu;
    return value ^ (value >> 16u);
}

float random01(inout uint state) {
    state = hash(state);
    return float(state & 0x00ffffffu) / float(0x01000000u);
}

vec3 cosineHemisphere(vec3 normal, inout uint state) {
    float u1 = random01(state);
    float u2 = random01(state);
    float radius = sqrt(u1);
    float angle = 6.28318530718 * u2;
    vec3 tangent = normalize(abs(normal.z) < 0.999
        ? cross(normal, vec3(0.0, 0.0, 1.0))
        : cross(normal, vec3(0.0, 1.0, 0.0)));
    vec3 bitangent = cross(normal, tangent);
    return normalize(tangent * (radius * cos(angle)) +
        bitangent * (radius * sin(angle)) +
        normal * sqrt(max(0.0, 1.0 - u1)));
}

void main() {
    ivec2 pixel = ivec2(gl_GlobalInvocationID.xy);
    if (any(greaterThanEqual(pixel, ivec2(frame.extentFlags.xy)))) return;

    float depth = readDepth(pixel);
    if (isBackground(depth)) return;

    vec3 world = reconstructWorld(pixel, depth);
    // The planar river sits at y ~= 0.06. Keep its authored reflector colour,
    // while allowing the rising wet bank immediately behind it to receive AO.
    if (world.y < 0.12) return;

    float depthX = readDepth(pixel + ivec2(1, 0));
    float depthY = readDepth(pixel + ivec2(0, 1));
    vec3 worldX = reconstructWorld(pixel + ivec2(1, 0), depthX);
    vec3 worldY = reconstructWorld(pixel + ivec2(0, 1), depthY);
    // Alpha-card and silhouette boundaries jump to a different depth. Never
    // let a derivative across that discontinuity turn a transparent edge (or
    // the sky behind it) into an opaque black receiver.
    if (length(worldX - world) > 0.85 || length(worldY - world) > 0.85) return;
    vec3 normal = normalize(cross(worldY - world, worldX - world));
    vec3 toCamera = normalize(frame.cameraPositionMaximumDistance.xyz - world);
    if (any(isnan(normal)) || any(isinf(normal))) normal = vec3(0.0, 1.0, 0.0);
    if (dot(normal, toCamera) < 0.0) normal = -normal;

    // Face-on 2.5D cards reconstruct as camera-facing walls and must not
    // receive ray-tested self-shadow.
    if (abs(dot(normal, toCamera)) > 0.58) return;

    float rayBias = frame.lightingParameters.w;
    vec3 origin = world + normal * rayBias;
    vec3 directionalLightDirection =
        normalize(frame.directionalLightDirectionAngularRadius.xyz);
    // A stable per-pixel pattern avoids unaccumulated ray noise shimmering on
    // the painted ground as the character walks.
    uint state = uint(pixel.x) * 1973u ^ uint(pixel.y) * 9277u ^ 0x68bc21ebu;

    uint directionalSampleCount =
        (frame.extentFlags.z >> kDirectionalSampleShift) & kSampleMask;
    vec3 lightTangent = normalize(cross(
        abs(directionalLightDirection.y) < 0.98
            ? vec3(0.0, 1.0, 0.0)
            : vec3(1.0, 0.0, 0.0),
        directionalLightDirection));
    vec3 lightBitangent = cross(directionalLightDirection, lightTangent);
    float diskRotation = random01(state) * 6.28318530718;
    float angularScale = tan(frame.directionalLightDirectionAngularRadius.w);
    float directionalVisibility = 0.0;
    for (uint rayIndex = 0u; rayIndex < directionalSampleCount; ++rayIndex) {
        float u = (float(rayIndex) + 0.5) / float(directionalSampleCount);
        float angle = diskRotation + float(rayIndex) * 2.39996322973;
        vec2 disk = sqrt(u) * vec2(cos(angle), sin(angle));
        vec3 direction = normalize(directionalLightDirection +
            (lightTangent * disk.x + lightBitangent * disk.y) * angularScale);
        directionalVisibility += occluded(
            origin, direction, frame.cameraPositionMaximumDistance.w) ? 0.0 : 1.0;
    }
    directionalVisibility /= float(directionalSampleCount);

    uint aoSampleCount = (frame.extentFlags.z >> kAoSampleShift) & kSampleMask;
    float aoVisibility = 0.0;
    for (uint rayIndex = 0u; rayIndex < aoSampleCount; ++rayIndex) {
        vec3 direction = cosineHemisphere(normal, state);
        aoVisibility += occluded(origin, direction, frame.lightingParameters.z)
            ? 0.0
            : 1.0;
    }
    aoVisibility /= float(aoSampleCount);

    float directionalFactor = mix(
        1.0, directionalVisibility, clamp(frame.lightingParameters.x, 0.0, 1.0));
    float aoFactor = mix(
        1.0, aoVisibility, clamp(frame.lightingParameters.y, 0.0, 1.0));
    vec4 color = imageLoad(hdrColor, pixel);
    color.rgb *= directionalFactor * aoFactor;
    imageStore(hdrColor, pixel, color);
}
`;
