const pulseFunction = /* glsl */ `
float loopDistance(float a, float b) {
  float distanceValue = abs(a - b);
  return min(distanceValue, 1.0 - distanceValue);
}

float travellingPulse(float along, float age) {
  float active = 1.0 - step(6.0, age);
  float head = clamp(age / 6.0, 0.0, 1.0);
  float distanceValue = loopDistance(fract(along), head);
  return exp(-distanceValue * distanceValue * 1450.0) * active;
}
`;

export const sculptureVertex = /* glsl */ `
attribute float aAlong;
attribute float aAcross;
attribute float aHalf;
attribute vec3 aCross;
uniform float uTime;
uniform float uOpen;
uniform float uWave;
uniform vec2 uPointer;
varying vec3 vNormal;
varying vec3 vViewDirection;
varying vec3 vObjectPosition;
varying float vAlong;
varying float vAcross;
varying float vHalf;
varying float vPulse;
${pulseFunction}

void main() {
  float pulse = travellingPulse(aAlong, uWave);
  float breath = sin(aAlong * 12.5663706 - uTime * 0.23) * 0.035;
  breath += sin(aAlong * 31.4159265 + uTime * 0.11) * 0.012;
  vec3 transformed = position + normal * (breath + pulse * 0.055);
  transformed += aCross * aHalf * (uOpen * 0.24 + pulse * 0.035);
  transformed.z += aCross.z * uPointer.x * 0.035;

  vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDirection = normalize(-viewPosition.xyz);
  vObjectPosition = transformed;
  vAlong = aAlong;
  vAcross = aAcross;
  vHalf = aHalf;
  vPulse = pulse;
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const sculptureFragment = /* glsl */ `
uniform vec3 uPorcelain;
uniform vec3 uGraphite;
uniform vec3 uSignal;
varying vec3 vNormal;
varying vec3 vViewDirection;
varying vec3 vObjectPosition;
varying float vAlong;
varying float vAcross;
varying float vHalf;
varying float vPulse;

void main() {
  vec3 normalDirection = normalize(vNormal);
  vec3 viewDirection = normalize(vViewDirection);
  float facing = abs(dot(normalDirection, viewDirection));
  float rim = pow(1.0 - facing, 3.2);
  float key = max(0.0, dot(normalDirection, normalize(vec3(-0.42, 0.67, 0.61))));
  float fill = max(0.0, dot(normalDirection, normalize(vec3(0.58, 0.18, -0.79))));
  float broadShade = 0.20 + key * 0.72 + fill * 0.14;

  float crazeA = abs(sin(vAlong * 452.0 + sin(vAcross * 19.0) * 2.1));
  float crazeB = abs(sin(vAcross * 83.0 - sin(vAlong * 71.0) * 1.7));
  float craze = smoothstep(0.985, 0.999, max(crazeA, crazeB));
  float edge = smoothstep(0.76, 0.99, abs(vAcross));
  vec3 frontColor = uPorcelain * broadShade;
  frontColor *= 1.0 - craze * 0.075;
  frontColor += uPorcelain * rim * 0.22;
  frontColor += vec3(0.36, 0.25, 0.13) * edge * 0.13;
  vec3 backColor = uGraphite * (0.62 + rim * 1.8 + key * 0.25);
  vec3 color = gl_FrontFacing ? frontColor : backColor;
  color = mix(color, uSignal, vPulse * (0.16 + (1.0 - abs(vAcross)) * 0.38));

  gl_FragColor = vec4(color, 1.0);
}
`;

export const sutureVertex = /* glsl */ `
uniform float uTime;
uniform float uWave;
uniform float uOpen;
varying vec3 vNormal;
varying vec3 vViewDirection;
varying float vPulse;
varying float vAlong;
${pulseFunction}

void main() {
  vec3 transformed = position;
#ifdef USE_INSTANCING
  transformed.x *= 1.0 + uOpen * 0.72;
  transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
#endif
  float along = fract(atan(transformed.y, transformed.x) / 6.2831853 + 1.0);
  float pulse = travellingPulse(along, uWave);
  transformed *= 1.0 + pulse * 0.018;
  vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
#else
  vNormal = normalize(normalMatrix * normal);
#endif
  vViewDirection = normalize(-viewPosition.xyz);
  vPulse = pulse;
  vAlong = along;
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const sutureFragment = /* glsl */ `
uniform vec3 uSignal;
uniform vec3 uHot;
varying vec3 vNormal;
varying vec3 vViewDirection;
varying float vPulse;
varying float vAlong;

void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vViewDirection)));
  float rim = pow(1.0 - facing, 2.6);
  float ceramic = 0.32 + max(0.0, dot(normalize(vNormal), normalize(vec3(-0.3, 0.7, 0.6)))) * 0.48;
  vec3 base = uSignal * (0.24 + rim * 0.54 + ceramic * 0.24);
  float core = pow(vPulse, 2.2);
  vec3 color = mix(base, uHot, core);
  color += uSignal * vPulse * 0.72;
  gl_FragColor = vec4(color, 1.0);
}
`;

export const finVertex = /* glsl */ `
uniform float uTime;
uniform float uWave;
uniform float uOpen;
uniform vec2 uCenter;
varying vec3 vNormal;
varying vec3 vWorldLocal;
varying float vPulse;
${pulseFunction}

void main() {
  vec3 origin = vec3(0.0);
#ifdef USE_INSTANCING
  origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
  float radialDistance = length(origin.xz - uCenter);
  float waveRadius = clamp(uWave, 0.0, 6.0) * 4.2;
  float radialPulse = exp(-pow(radialDistance - waveRadius, 2.0) * 0.72) * (1.0 - step(6.0, uWave));
  float orderedBreath = sin(origin.x * 0.27 + origin.z * 0.19 - uTime * 0.24) * 0.012;
  vec3 localPosition = position;
  localPosition.x += (radialPulse * 0.58 + orderedBreath) * (position.y + 0.52);
  vec3 transformed = localPosition;
#ifdef USE_INSTANCING
  transformed = (instanceMatrix * vec4(localPosition, 1.0)).xyz;
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
#else
  vNormal = normalize(normalMatrix * normal);
#endif
  vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
  vWorldLocal = transformed;
  vPulse = radialPulse;
  gl_Position = projectionMatrix * viewPosition;
}
`;

export const finFragment = /* glsl */ `
uniform vec3 uGraphite;
uniform vec3 uPorcelain;
uniform vec3 uSignal;
varying vec3 vNormal;
varying vec3 vWorldLocal;
varying float vPulse;

void main() {
  vec3 normalDirection = normalize(vNormal);
  float key = max(0.0, dot(normalDirection, normalize(vec3(-0.42, 0.67, 0.61))));
  float edge = pow(1.0 - abs(normalDirection.z), 3.0);
  float band = smoothstep(0.94, 1.0, sin(length(vWorldLocal.xz) * 2.7) * 0.5 + 0.5);
  vec3 color = uGraphite * (0.62 + key * 0.5);
  color = mix(color, uPorcelain * 0.21, edge * 0.34 + band * 0.045);
  color = mix(color, uSignal, vPulse * 0.82);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const basinVertex = /* glsl */ `
uniform float uTime;
uniform float uWave;
varying vec2 vSurface;
varying float vRipple;

void main() {
  vec3 transformed = position;
  float radius = length(position.xy);
  float waveRadius = clamp(uWave, 0.0, 6.0) * 4.2;
  float envelope = exp(-pow(radius - waveRadius, 2.0) * 0.52) * (1.0 - step(6.0, uWave));
  float ripple = sin(radius * 6.4 - uWave * 12.0) * envelope;
  transformed.z += ripple * 0.075;
  transformed.z += sin(position.x * 0.23 + position.y * 0.17 - uTime * 0.13) * 0.006;
  vSurface = position.xy;
  vRipple = ripple;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
`;

export const basinFragment = /* glsl */ `
uniform vec3 uGraphite;
uniform vec3 uPorcelain;
uniform vec3 uSignal;
varying vec2 vSurface;
varying float vRipple;

void main() {
  vec2 cell = abs(fract(vSurface * 0.145 - 0.5) - 0.5) / 0.5;
  float grid = smoothstep(0.975, 0.998, max(cell.x, cell.y));
  float contour = smoothstep(0.965, 1.0, sin(length(vSurface) * 2.45) * 0.5 + 0.5);
  vec3 color = uGraphite * (0.34 + grid * 0.18);
  color += uPorcelain * contour * 0.014;
  color = mix(color, uSignal * 0.8, abs(vRipple) * 0.72);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const atmosphereVertex = /* glsl */ `
varying vec3 vDirection;

void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const atmosphereFragment = /* glsl */ `
uniform float uTime;
uniform vec2 uPointer;
varying vec3 vDirection;

void main() {
  vec3 ray = normalize(vDirection);
  vec3 ink = vec3(0.0045, 0.0055, 0.0065);
  vec3 warm = vec3(0.73, 0.67, 0.55);
  vec3 haze = vec3(0.16, 0.17, 0.16);
  vec3 color = ink;
  float horizon = exp(-abs(ray.y + 0.08) * 9.0);
  color += haze * horizon * 0.055;

  vec3 accumulated = vec3(0.0);
  float travel = 0.4;
  vec3 beamDirection = normalize(vec3(-0.52 + uPointer.x * 0.035, 0.29, -0.80));
  for (int sampleIndex = 0; sampleIndex < 40; ++sampleIndex) {
    vec3 point = ray * travel;
    float lineDistance = length(cross(point - vec3(-3.0, 2.2, -3.4), beamDirection));
    float density = exp(-lineDistance * lineDistance * 0.095);
    density *= 0.72 + 0.28 * sin(point.y * 0.38 + point.z * 0.21 - uTime * 0.055);
    accumulated += warm * max(density, 0.0) * 0.00042;
    travel += 0.26;
  }
  float source = pow(max(0.0, dot(ray, beamDirection)), 180.0);
  color += accumulated + warm * source * 0.34;
  gl_FragColor = vec4(color, 1.0);
}
`;
