struct SimulationParameters {
  counts: vec4<u32>,
  timeDeltaGustRadius: vec4<f32>,
  wind: vec4<f32>,
  brushNormalStrength: vec4<f32>,
  brushDirectionRadius: vec4<f32>,
  ballScale: vec4<f32>,
  ballOffset: vec4<f32>,
  ballRotation: vec4<f32>,
};

struct FibreFrame {
  tangent: vec3<f32>,
  bitangent: vec3<f32>,
};

@group(0) @binding(0) var<storage, read_write> fibreState: array<vec4<f32>>;
@group(0) @binding(1) var positionAtlas: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> simulation: SimulationParameters;

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const GOLDEN_ANGLE: f32 = 2.399963229728653;
const RINGS: u32 = 12u;
const SIDES: u32 = 4u;

fn rotateByQuaternion(value: vec3<f32>, rotation: vec4<f32>) -> vec3<f32> {
  let q = normalize(rotation);
  let twiceCross = 2.0 * cross(q.xyz, value);
  return value + q.w * twiceCross + cross(q.xyz, twiceCross);
}

fn hashU32(value: u32) -> u32 {
  var result = value;
  result = result ^ (result >> 16u);
  result = result * 0x7feb352du;
  result = result ^ (result >> 15u);
  result = result * 0x846ca68bu;
  return result ^ (result >> 16u);
}

fn random01(index: u32, salt: u32) -> f32 {
  return f32(hashU32(index ^ salt) & 0x00ffffffu) / f32(0x01000000u);
}

fn anchorFor(index: u32, count: u32) -> vec3<f32> {
  let y = 1.0 - 2.0 * ((f32(index) + 0.5) / f32(count));
  let radial = sqrt(max(0.0, 1.0 - y * y));
  let longitude = f32(index) * GOLDEN_ANGLE +
    (random01(index, 0x39e2d175u) - 0.5) * 0.006;
  return normalize(vec3<f32>(cos(longitude) * radial, y, sin(longitude) * radial));
}

fn seamDistanceForAnchor(anchor: vec3<f32>) -> f32 {
  let latitude = asin(clamp(anchor.y, -1.0, 1.0));
  let longitude = atan2(anchor.z, anchor.x);
  let seamLatitude = 0.43 * sin(longitude * 2.0);
  let slope = 0.86 * cos(longitude * 2.0);
  return abs(latitude - seamLatitude) / sqrt(1.0 + slope * slope);
}

fn curveCentre(
  anchor: vec3<f32>,
  frame: FibreFrame,
  lean: vec2<f32>,
  fibreLength: f32,
  rootRadius: f32,
  u: f32,
  fibreKind: u32,
  archetype: u32,
) -> vec3<f32> {
  let arc = sin(PI * u);
  let wave = sin(TAU * u);
  let wave2 = sin(TAU * 2.0 * u + f32(archetype) * 1.37);
  var height: f32;
  var curl: vec2<f32>;
  if (fibreKind == 0u) {
    // The majority of tennis felt lies across neighbouring fibres instead of
    // standing like turf. Tips return close to the backing after a low arch.
    height = 0.075 * u + 0.30 * arc;
    curl = vec2<f32>(0.060 * arc + 0.028 * wave, 0.038 * wave + 0.018 * wave2);
  } else if (fibreKind == 1u) {
    // Loose looped filaments are sparse but crucial in a macro silhouette.
    height = 0.035 * u + 0.53 * arc * arc;
    curl = vec2<f32>(0.31 * arc + 0.13 * wave, 0.21 * wave + 0.08 * wave2);
  } else {
    // A small upright population catches the softbox and reacts most visibly.
    height = 0.68 * u + 0.10 * arc;
    curl = vec2<f32>(0.075 * arc + 0.035 * wave, 0.045 * wave2);
  }
  return anchor * (rootRadius + fibreLength * height) +
    frame.tangent * fibreLength * (lean.x * u + curl.x) +
    frame.bitangent * fibreLength * (lean.y * u + curl.y);
}

fn frameFor(normal: vec3<f32>, index: u32) -> FibreFrame {
  var tangent: vec3<f32>;
  if (abs(normal.y) < 0.985) {
    tangent = normalize(vec3<f32>(-normal.z, 0.0, normal.x));
  } else {
    tangent = normalize(vec3<f32>(normal.y, -normal.x, 0.0));
  }
  let bitangent = normalize(cross(normal, tangent));
  let roll = random01(index, 0x95f24dabu) * TAU;
  let cosine = cos(roll);
  let sine = sin(roll);
  return FibreFrame(
    tangent * cosine + bitangent * sine,
    bitangent * cosine - tangent * sine,
  );
}

fn storePosition(vertexIndex: u32, point: vec3<f32>) {
  let atlasWidth = simulation.counts.z;
  let pixel = vec2<i32>(
    i32(vertexIndex % atlasWidth),
    i32(vertexIndex / atlasWidth),
  );
  textureStore(positionAtlas, pixel, vec4<f32>(point, 1.0));
}

@compute @workgroup_size(64, 1, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let fibreIndex = gid.x;
  let fibreCount = simulation.counts.x;
  if (fibreIndex >= fibreCount) {
    return;
  }

  let anchor = anchorFor(fibreIndex, fibreCount);
  let frame = frameFor(anchor, fibreIndex);
  let kindSelector = random01(fibreIndex, 0x843bc91du);
  var fibreKind = 0u;
  if (kindSelector > 0.85) {
    fibreKind = 1u;
  }
  if (kindSelector > 0.97) {
    fibreKind = 2u;
  }
  var cantMagnitude = 0.32 + random01(fibreIndex, 0x11a7c31du) * 0.42;
  if (fibreKind == 1u) {
    cantMagnitude = 0.38 + random01(fibreIndex, 0x11a7c31du) * 0.50;
  } else if (fibreKind == 2u) {
    cantMagnitude = 0.13 + random01(fibreIndex, 0x11a7c31du) * 0.31;
  }
  let cantAngle = random01(fibreIndex, 0x2c9277b5u) * TAU;
  let restLean = vec2<f32>(cos(cantAngle), sin(cantAngle)) * cantMagnitude;
  let stiffness = 19.0 + random01(fibreIndex, 0x7f4a7c15u) * 31.0;
  let compliance = 0.78 + (50.0 - stiffness) * 0.015;
  let time = simulation.timeDeltaGustRadius.x;
  let delta = clamp(simulation.timeDeltaGustRadius.y, 0.0, 0.05);
  let gust = clamp(simulation.timeDeltaGustRadius.z, 0.0, 1.5);
  let windScale = (0.085 + gust * 0.24) * compliance;
  let phase = random01(fibreIndex, 0x51ed270bu) * TAU;
  let tone = random01(fibreIndex, 0xc761c23cu);
  let pulse = sin(time * (1.65 + tone * 0.9) + phase);
  var targetLean = restLean + vec2<f32>(
    dot(simulation.wind.xyz, frame.tangent),
    dot(simulation.wind.xyz, frame.bitangent),
  ) * windScale;
  targetLean += vec2<f32>(
    pulse * (0.0045 + gust * 0.013),
    cos(time * 1.31 + phase * 1.17) * 0.0035,
  );
  targetLean -= vec2<f32>(frame.tangent.y, frame.bitangent.y) * 0.012;

  let brushStrength = simulation.brushNormalStrength.w;
  if (brushStrength > 0.0) {
    let brushRadius = max(0.01, simulation.brushDirectionRadius.w);
    let threshold = cos(brushRadius);
    let alignment = dot(anchor, simulation.brushNormalStrength.xyz);
    if (alignment > threshold) {
      let normalized = (alignment - threshold) / max(0.000001, 1.0 - threshold);
      let falloff = normalized * normalized * (3.0 - 2.0 * normalized);
      targetLean += vec2<f32>(
        dot(simulation.brushDirectionRadius.xyz, frame.tangent),
        dot(simulation.brushDirectionRadius.xyz, frame.bitangent),
      ) * min(1.5, brushStrength) * 0.46 * falloff;
    }
  }

  var state = fibreState[fibreIndex];
  if (simulation.counts.w == 0u) {
    state = vec4<f32>(restLean, vec2<f32>(0.0));
  }
  var lean = state.xy;
  var velocity = state.zw;
  let damping = sqrt(stiffness) * 1.58;
  let stepDelta = delta * 0.5;
  for (var substep = 0u; substep < 2u; substep = substep + 1u) {
    velocity += ((targetLean - lean) * stiffness - velocity * damping) * stepDelta;
    lean += velocity * stepDelta;
  }
  lean = clamp(lean, vec2<f32>(-1.55), vec2<f32>(1.55));
  fibreState[fibreIndex] = vec4<f32>(lean, velocity);

  let lengthMix = 0.5 * (
    random01(fibreIndex, 0x6f2b9587u) + random01(fibreIndex, 0x8b8b8b8bu)
  );
  // Regulation felt is overwhelmingly short compressed nap. Long filaments
  // are deliberately rare so the surface reads as felt rather than grass.
  var fibreLength = 0.0105 + lengthMix * 0.0135;
  if (fibreKind == 1u) {
    fibreLength = 0.020 + lengthMix * 0.018;
  } else if (fibreKind == 2u) {
    fibreLength = 0.035 + lengthMix * 0.030;
  }
  let seamDistance = seamDistanceForAnchor(anchor);
  let isSeam = seamDistance < 0.061;
  if (isSeam) {
    fibreLength *= 0.015;
  }
  let geometryScale = 1.0;
  var baseWidth = (0.00032 + random01(fibreIndex, 0xc3a5c85cu) * 0.00026) *
    geometryScale;
  if (isSeam) {
    baseWidth *= 0.025;
  }
  let archetype = fibreIndex % 3u;
  let verticesPerFibre = simulation.counts.y;
  let channel = 1.0 - smoothstep(0.0, 0.075, seamDistance);
  var rootRadius = simulation.timeDeltaGustRadius.w - 0.0135 * channel;
  if (isSeam) {
    rootRadius -= 0.018;
  }

  for (var ring = 0u; ring < RINGS; ring = ring + 1u) {
    let u = f32(ring) / f32(RINGS - 1u);
    let centre = curveCentre(
      anchor, frame, lean, fibreLength, rootRadius, u, fibreKind, archetype,
    );
    let ringStep = 1.0 / f32(RINGS - 1u);
    let before = curveCentre(
      anchor, frame, lean, fibreLength, rootRadius,
      max(0.0, u - ringStep * 0.42), fibreKind, archetype,
    );
    let after = curveCentre(
      anchor, frame, lean, fibreLength, rootRadius,
      min(1.0, u + ringStep * 0.42), fibreKind, archetype,
    );
    let curveTangent = normalize(after - before);
    var crossA = frame.tangent - curveTangent * dot(frame.tangent, curveTangent);
    if (dot(crossA, crossA) < 0.0001) {
      crossA = frame.bitangent - curveTangent * dot(frame.bitangent, curveTangent);
    }
    crossA = normalize(crossA);
    let crossB = normalize(cross(curveTangent, crossA));
    let taper = mix(0.92, 0.028, pow(u, 1.58));
    let width = baseWidth * taper;

    for (var side = 0u; side < SIDES; side = side + 1u) {
      let angle = f32(side) * (TAU / f32(SIDES));
      let radial = crossA * cos(angle) + crossB * sin(angle);
      let vertexIndex = fibreIndex * verticesPerFibre + ring * SIDES + side;
      var finalPosition = centre + radial * width;
      // Compress the underside against the polished table.  Geometry remains
      // resident (and in the BLAS) rather than being culled near contact.
      // Apply rolling first so the contact cap remains aligned to world down.
      finalPosition = rotateByQuaternion(finalPosition, simulation.ballRotation);
      finalPosition.y = max(finalPosition.y, -1.0016);
      finalPosition = finalPosition * simulation.ballScale.xyz + simulation.ballOffset.xyz;
      storePosition(vertexIndex, finalPosition);
    }
  }
}
