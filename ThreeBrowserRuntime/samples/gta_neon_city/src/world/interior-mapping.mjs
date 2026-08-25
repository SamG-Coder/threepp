import * as THREE from "three/webgpu";
import {
  abs,
  bitangentWorld,
  cameraPosition,
  color,
  dot,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  sign,
  smoothstep,
  step,
  tangentWorld,
  texture,
  uniform,
  uv,
  vec2,
} from "three/tsl";

const STYLE_GLASS = Object.freeze([
  Object.freeze({ glass: 0x20313a, side: 0x292b2a, ceiling: 0x34332e }),
  Object.freeze({ glass: 0x2b292b, side: 0x312722, ceiling: 0x3c3027 }),
  Object.freeze({ glass: 0x213331, side: 0x27312f, ceiling: 0x333b37 }),
]);

/**
 * Builds the same class of fake-interior illusion used by modern open-world
 * games: the window is one plane, but its shader intersects the view ray with
 * a virtual room box.  A second furniture layer is projected at a shallower
 * depth, so desks, partitions and occupants move against the back wall as the
 * camera travels along the street.
 */
export function createInteriorMappedMaterial(textureSet, { style = 0 } = {}) {
  if (!textureSet?.albedo || !textureSet?.foreground || !textureSet?.emissive) {
    throw new TypeError("createInteriorMappedMaterial requires a virtual interior texture set");
  }
  const styleIndex = Math.max(0, Math.min(STYLE_GLASS.length - 1, Math.trunc(Number(style)) || 0));
  const palette = STYLE_GLASS[styleIndex];
  const night = uniform(1);
  const roomGrid = vec2(textureSet.roomCount, 1);
  const roomCoordinates = uv().mul(roomGrid);
  const roomIndex = floor(roomCoordinates);
  const roomUv = fract(roomCoordinates);

  // Convert the camera ray into the facade's tangent frame. tangentWorld and
  // bitangentWorld include each InstancedMesh transform, so all four building
  // faces get the same physically coherent room projection.
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const rayX = float(0).sub(dot(toEye, tangentWorld));
  const rayY = float(0).sub(dot(toEye, bitangentWorld));
  const rayZ = max(abs(dot(toEye, normalWorld)), 0.06);
  const pointX = roomUv.x.sub(0.5);
  const pointY = roomUv.y.sub(0.5);

  // Positive distances to the virtual box's side, ceiling/floor and rear
  // planes. The nearest distance is a true ray-box surface intersection.
  const xDistance = float(0.5).sub(sign(rayX).mul(pointX)).div(max(abs(rayX), 0.001));
  const yDistance = float(0.5).sub(sign(rayY).mul(pointY)).div(max(abs(rayY), 0.001));
  const sideDistance = min(xDistance, yDistance);
  const rearDistance = float(0.82).div(rayZ);
  const boxDistance = min(sideDistance, rearDistance);
  const boxHit = vec2(
    pointX.add(rayX.mul(boxDistance)),
    pointY.add(rayY.mul(boxDistance)),
  ).add(0.5).clamp(0.012, 0.988);
  const backAtlasUv = roomIndex.add(boxHit).div(roomGrid);

  // Furniture is not baked onto the back wall: it occupies a shallower slice
  // of the virtual room and therefore produces a visibly different parallax.
  const furnitureDistance = min(sideDistance, float(0.36).div(rayZ));
  const furnitureHit = vec2(
    pointX.add(rayX.mul(furnitureDistance)),
    pointY.add(rayY.mul(furnitureDistance)),
  ).add(0.5).clamp(0.012, 0.988);
  const furnitureAtlasUv = roomIndex.add(furnitureHit).div(roomGrid);

  const back = texture(textureSet.albedo, backAtlasUv);
  const backEmission = texture(textureSet.emissive, backAtlasUv);
  const furniture = texture(textureSet.foreground, furnitureAtlasUv);
  const furnitureEmission = texture(textureSet.foregroundEmissive, furnitureAtlasUv);
  const rearSurface = step(rearDistance, sideDistance);
  const hitVerticalWall = step(xDistance, yDistance);
  const sideWall = mix(color(palette.ceiling), color(palette.side), hitVerticalWall);
  const roomSurface = mix(sideWall, back.rgb, rearSurface);
  const furnishedRoom = mix(roomSurface, furniture.rgb, furniture.a.mul(0.94));

  const facing = abs(dot(normalWorld, toEye));
  const fresnel = pow(float(1).sub(facing), 4);
  const glassReflection = color(palette.glass).mul(fresnel.mul(0.32).add(0.055));
  const edgeDistance = min(
    min(roomUv.x, float(1).sub(roomUv.x)),
    min(roomUv.y, float(1).sub(roomUv.y)),
  );
  const frame = float(1).sub(smoothstep(0.018, 0.052, edgeDistance));
  const framedColor = mix(furnishedRoom.add(glassReflection), color(0x0d1418), frame.mul(0.92));

  const interiorGlow = backEmission.rgb
    .add(furnitureEmission.rgb)
    .mul(night.mul(0.82).add(0.05))
    .mul(rearSurface.mul(0.34).add(0.66))
    .mul(float(1).sub(frame));
  // The virtual room already owns its illumination. Keeping this material
  // unlit avoids evaluating every street PointLight for every window pixel.
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  material.name = `${textureSet.style} parallax room-box glass`;
  material.colorNode = framedColor.add(interiorGlow);
  material.userData.interiorMapping = Object.freeze({
    technique: "view-ray room-box projection",
    layers: 2,
    roomDepth: 0.82,
    furnitureDepth: 0.36,
    style: textureSet.style,
    rooms: textureSet.roomCount,
    litRooms: textureSet.litRooms,
    unlitRooms: textureSet.unlitRooms,
  });

  return Object.freeze({
    material,
    setNight(value) {
      night.value = Math.max(0, Math.min(1, Number(value) || 0));
    },
    snapshot() {
      return Object.freeze({ ...material.userData.interiorMapping, night: night.value });
    },
  });
}
