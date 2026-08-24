import * as THREE from "three/webgpu";
import {
  createConcreteMaterial,
  createEmissiveMaterial,
  createGlassMaterial,
  createHaloMaterial,
  createLaneMarkingMaterial,
  createMetalMaterial,
  createPuddleMaterial,
  createSkyMaterial,
  createWetAsphaltMaterial,
  createWetPavementMaterial,
  palette,
  rasterReflectionStrength,
} from "./materials.mjs";

function seededRandom(seed = 0x4e454f4e) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

function shadowed(mesh, cast = true, receive = true) {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function addBox(parent, name, size, position, material, rotation = null, cast = true, receive = true) {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(...size), material), cast, receive);
  mesh.name = name;
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, name, radii, height, position, material, rotation = null, segments = 16) {
  const mesh = shadowed(new THREE.Mesh(
    new THREE.CylinderGeometry(radii[0], radii[1], height, segments),
    material,
  ));
  mesh.name = name;
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  parent.add(mesh);
  return mesh;
}

function pushBoxTransform(target, position, size, rotation = null) {
  target.push({ position, size, rotation });
}

function addBoxInstances(parent, name, transforms, material, {
  castShadow = false,
  receiveShadow = true,
  renderOrder = 0,
  rtxIgnore = false,
} = {}) {
  if (transforms.length === 0) return null;
  const instances = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    material,
    transforms.length,
  );
  instances.name = name;
  instances.castShadow = castShadow;
  instances.receiveShadow = receiveShadow;
  instances.renderOrder = renderOrder;
  instances.userData.rtxIgnore = rtxIgnore || Boolean(material.userData?.rtxIgnore);
  const dummy = new THREE.Object3D();
  for (let index = 0; index < transforms.length; ++index) {
    const transform = transforms[index];
    dummy.position.set(...transform.position);
    dummy.rotation.set(0, 0, 0);
    if (transform.rotation) dummy.rotation.set(...transform.rotation);
    dummy.scale.set(...transform.size);
    dummy.updateMatrix();
    instances.setMatrixAt(index, dummy.matrix);
  }
  instances.instanceMatrix.needsUpdate = true;
  parent.add(instances);
  return instances;
}

const PIXEL_FONT = Object.freeze({
  "0": ["111", "101", "101", "101", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "4": ["101", "101", "111", "001", "001"],
  A: ["01110", "10001", "11111", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "11111"],
  H: ["10001", "10001", "11111", "10001", "10001"],
  I: ["111", "010", "010", "010", "111"],
  K: ["10001", "10010", "11100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001"],
  O: ["01110", "10001", "10001", "10001", "01110"],
  R: ["11110", "10001", "11110", "10010", "10001"],
  S: ["01111", "10000", "01110", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "01010", "00100"],
  X: ["10001", "01010", "00100", "01010", "10001"],
});

function createPixelSign(parent, {
  text,
  position,
  colorValue,
  scale = 0.12,
  vertical = false,
  seed = 0,
}) {
  const glyphs = [...text].map(character => PIXEL_FONT[character] ?? PIXEL_FONT.X);
  const columns = vertical
    ? Math.max(...glyphs.map(glyph => glyph[0].length))
    : glyphs.reduce((sum, glyph) => sum + glyph[0].length + 1, -1);
  const rows = vertical ? glyphs.length * 6 - 1 : 5;
  const width = (columns + 2.6) * scale;
  const height = (rows + 2.6) * scale;
  const group = new THREE.Group();
  group.name = `Procedural ${text} neon sign`;
  group.position.set(...position);
  parent.add(group);

  const board = shadowed(new THREE.Mesh(
    new THREE.BoxGeometry(width, height, 0.13),
    createMetalMaterial(0x090d12, 0.32, 0.78),
  ));
  group.add(board);

  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.32, height * 1.25),
    createHaloMaterial(colorValue, 0.13),
  );
  halo.name = `${text} atmospheric neon halo`;
  halo.position.z = 0.075;
  halo.renderOrder = 3;
  group.add(halo);

  let pixelCount = 0;
  for (const glyph of glyphs) {
    for (const row of glyph) {
      for (const bit of row) if (bit === "1") pixelCount += 1;
    }
  }
  const neonMaterial = createEmissiveMaterial(colorValue, 7.8, `${text} neon pixels`);
  const pixels = new THREE.InstancedMesh(
    // Four vertices per cell instead of a tessellated rounded solid. The sign
    // remains readable in native reflections because every lit cell is still
    // real emissive geometry rather than a texture alpha mask.
    new THREE.PlaneGeometry(scale * 0.68, scale * 0.68),
    neonMaterial,
    pixelCount,
  );
  pixels.name = `${text} readable procedural glyphs`;
  pixels.castShadow = false;
  const dummy = new THREE.Object3D();
  let instance = 0;
  let horizontalCursor = 0;
  glyphs.forEach((glyph, glyphIndex) => {
    const glyphWidth = glyph[0].length;
    for (let row = 0; row < glyph.length; ++row) {
      for (let column = 0; column < glyphWidth; ++column) {
        if (glyph[row][column] !== "1") continue;
        const px = vertical
          ? (column - (glyphWidth - 1) * 0.5) * scale
          : (horizontalCursor + column - columns * 0.5 + 0.5) * scale;
        const py = vertical
          ? (rows * 0.5 - glyphIndex * 6 - row - 0.5) * scale
          : (2 - row) * scale;
        dummy.position.set(px, py, 0.092);
        dummy.updateMatrix();
        pixels.setMatrixAt(instance++, dummy.matrix);
      }
    }
    horizontalCursor += glyphWidth + 1;
  });
  pixels.instanceMatrix.needsUpdate = true;
  group.add(pixels);

  return {
    group,
    material: neonMaterial,
    haloMaterial: halo.material,
    phase: seed * 1.731,
    flicker: seed % 3 === 0,
  };
}

function addRoad(root, environment, random) {
  const roadGroup = new THREE.Group();
  roadGroup.name = "Rain-polished avenue and sidewalks";
  root.add(roadGroup);

  const roadSurface = createWetAsphaltMaterial();
  const road = shadowed(new THREE.Mesh(
    new THREE.PlaneGeometry(12.4, 154, 1, 1),
    roadSurface.material,
  ), false, true);
  road.name = "Hero wet asphalt reflection surface";
  road.rotation.x = -Math.PI * 0.5;
  road.position.set(0, 0, -55);
  roadGroup.add(road);

  const pavementMaterial = createWetPavementMaterial();
  const curbMaterial = createConcreteMaterial(0x4b5052, 0.62);
  for (const side of [-1, 1]) {
    addBox(
      roadGroup,
      "Raised rain-darkened sidewalk",
      [5.9, 0.16, 154],
      [side * 9.35, 0.06, -55],
      pavementMaterial,
      null,
      false,
      true,
    );
    addBox(
      roadGroup,
      "Chipped granite curb",
      [0.28, 0.22, 154],
      [side * 6.34, 0.03, -55],
      curbMaterial,
      null,
      false,
      true,
    );
  }

  const whiteLine = createLaneMarkingMaterial(0xc8c8bd);
  const amberLine = createLaneMarkingMaterial(0xc68d42);
  // Road paint is a millimetre-scale opaque deposit, not a second glossy
  // road surface.  Keep its primary RTX guide at zero so a stripe cannot
  // launch a competing reflection ray, and bias its top face away from the
  // asphalt depth value for stable raster coverage at long range.
  const markingHeight = 0.003;
  const markingY = 0.001 + markingHeight * 0.5;
  for (const material of [whiteLine, amberLine]) {
    material.rtxReflectionMask = 0;
    material.roughness = 0.55;
    material.clearcoat = 0.12;
    material.clearcoatRoughness = 0.38;
    material.polygonOffset = true;
    material.polygonOffsetFactor = -1;
    material.polygonOffsetUnits = -2;
  }
  addBox(roadGroup, "Double amber center line", [0.075, markingHeight, 154], [-0.14, markingY, -55], amberLine, null, false, true);
  addBox(roadGroup, "Double amber center line", [0.075, markingHeight, 154], [0.14, markingY, -55], amberLine, null, false, true);

  // A strong foreground crosswalk and stop bar lock the camera at human scale.
  for (let stripe = -5; stripe <= 5; ++stripe) {
    addBox(
      roadGroup,
      "Worn crosswalk stripe",
      [0.64, markingHeight, 2.75],
      [stripe * 1.05, markingY, -12.8],
      whiteLine,
      null,
      false,
      true,
    );
  }
  addBox(roadGroup, "Intersection stop bar", [5.5, markingHeight, 0.24], [-3.08, markingY, -9.05], whiteLine, null, false, true);

  // Drains and utility patches prevent the wet plane from reading as a CG slab.
  const grateMaterial = createMetalMaterial(0x14191c, 0.49, 0.86);
  const drainSlotMaterial = createMetalMaterial(0x020304, 0.7, 0.5);
  grateMaterial.rtxReflectionMask = 0.08;
  drainSlotMaterial.rtxReflectionMask = 0;
  for (let z = 8; z >= -118; z -= 15.5) {
    for (const side of [-1, 1]) {
      const grate = addBox(
        roadGroup,
        "Inset storm drain grate",
        [0.46, 0.006, 0.85],
        [side * 5.91, 0.002, z + random() * 1.4],
        grateMaterial,
        null,
        false,
        true,
      );
      for (let slot = -2; slot <= 2; ++slot) {
        addBox(
          grate,
          "Drain slot",
          [0.025, 0.003, 0.68],
          [slot * 0.075, 0.004, 0],
          drainSlotMaterial,
          null,
          false,
          false,
        );
      }
    }
  }

  const puddleMaterial = createPuddleMaterial(environment);
  puddleMaterial.polygonOffset = true;
  puddleMaterial.polygonOffsetFactor = -2;
  puddleMaterial.polygonOffsetUnits = -3;
  const puddles = new THREE.Group();
  puddles.name = "Irregular standing-water patches";
  puddles.userData.rasterOnlyRoadOverlay = true;
  roadGroup.add(puddles);
  for (let index = 0; index < 24; ++index) {
    const radius = 0.45 + random() * 1.65;
    const shape = new THREE.Shape();
    const points = 10;
    for (let point = 0; point < points; ++point) {
      const angle = point / points * Math.PI * 2;
      const wobble = radius * (0.68 + random() * 0.42);
      const x = Math.cos(angle) * wobble;
      const y = Math.sin(angle) * wobble * (0.32 + random() * 0.20);
      if (point === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const puddle = new THREE.Mesh(new THREE.ShapeGeometry(shape), puddleMaterial);
    puddle.name = "Shallow asymmetric puddle";
    // Transparent puddle sheets are a raster embellishment.  Excluding each
    // child from the packed scene also avoids unused transparent vertices in
    // the immutable TLAS streams.
    puddle.userData.rtxIgnore = true;
    puddle.rotation.x = -Math.PI * 0.5;
    puddle.rotation.z = random() * Math.PI;
    puddle.position.set(
      THREE.MathUtils.lerp(-5.55, 5.55, random()),
      0.006 + index * 0.000003,
      THREE.MathUtils.lerp(10, -124, random()),
    );
    puddle.renderOrder = 1;
    puddles.add(puddle);
  }

  return {
    group: roadGroup,
    road,
    rasterMaterial: roadSurface.material,
    nativeMaterial: roadSurface.nativeMaterial,
    reflection: roadSurface.reflection,
    puddles,
  };
}

function addFacadeDetails(
  building,
  side,
  frontage,
  height,
  depth,
  materials,
  random,
  { openFacade = false } = {},
) {
  const streetX = side * 12.73;
  const ribMaterial = materials.rib;
  const floorCount = Math.floor((height - 3.4) / 2.45);
  // Hero blocks rebuild this entire plane from spandrels and piers. Reusing the
  // old full-height ribs there would bridge the actual apertures and turn the
  // recessed rooms back into hidden cards.
  if (!openFacade) {
    for (let floor = 1; floor <= floorCount; ++floor) {
      addBox(
        building,
        "Facade shadow course",
        [0.16, 0.13, frontage * 0.94],
        [streetX - building.position.x, 2.55 + floor * 2.45, 0],
        ribMaterial,
        null,
        true,
        true,
      );
    }
    const ribCount = Math.max(2, Math.floor(frontage / 2.4));
    for (let rib = 0; rib <= ribCount; ++rib) {
      addBox(
        building,
        "Facade vertical rain channel",
        [0.17, height - 2.9, 0.12],
        [streetX - building.position.x, height * 0.5 + 1.1, (rib / ribCount - 0.5) * frontage * 0.9],
        ribMaterial,
        null,
        true,
        true,
      );
    }

    if (random() < 0.62) {
      const balconyFloors = Math.min(4, floorCount);
      for (let floor = 0; floor < balconyFloors; ++floor) {
        const y = 4.6 + floor * 2.55;
        const z = (random() * 2 - 1) * frontage * 0.22;
        addBox(building, "Cantilevered service balcony", [1.05, 0.12, frontage * 0.38], [side * (13.18 - Math.abs(building.position.x)), y, z], materials.metal, null, true, true);
        addBox(building, "Balcony wet rail", [0.08, 0.67, frontage * 0.38], [side * (13.67 - Math.abs(building.position.x)), y + 0.38, z], materials.metal, null, true, false);
      }
    }
  }

  // Roof clutter is silhouetted against the cyan storm sky.
  const roofY = height + 0.35;
  addBox(building, "Rooftop mechanical housing", [depth * 0.42, 0.72, frontage * 0.28], [side * 0.4, roofY, frontage * 0.18], materials.roof, null, true, true);
  addCylinder(building, "Rooftop exhaust stack", [0.17, 0.2], 1.25, [side * 0.3, roofY + 0.7, -frontage * 0.24], materials.metal, null, 12);
  if (random() < 0.45) {
    addBox(building, "Rooftop aerial mast", [0.045, 3.3, 0.045], [0, roofY + 1.9, 0], materials.metal, null, false, false);
  }
}

const STREET_FACADE_X = 12.6;
const HERO_FACADE_RECESS = 1.72;

function addHeroApartmentFacade(pools, {
  side,
  centerZ,
  frontage,
  height,
  floors,
  facadeBand,
  random,
}) {
  const roomRows = Math.min(5, floors);
  const roomColumns = THREE.MathUtils.clamp(
    Math.floor((frontage - 1.15) / 1.92),
    3,
    6,
  );
  const usableWidth = frontage - 0.84;
  const cellWidth = usableWidth / roomColumns;
  const apertureWidth = Math.min(1.02, cellWidth * 0.64);
  const apertureHeight = 1.34;
  const rowStep = 2.28;
  const rowCenters = Array.from(
    { length: roomRows },
    (_, row) => 4.05 + row * rowStep,
  );
  const columnCenters = Array.from(
    { length: roomColumns },
    (_, column) => centerZ - usableWidth * 0.5 + cellWidth * (column + 0.5),
  );
  const panels = pools.facadePanels[facadeBand];
  // A thick street wall supplies the first 34 cm of every reveal before the
  // stage-set room begins.  Its real side faces remain visible from the curb
  // camera even when an interior is dark.
  const panelDepth = 0.34;
  const panelX = side * (STREET_FACADE_X - panelDepth * 0.5);
  const windowBandBottom = rowCenters[0] - apertureHeight * 0.5;
  const windowBandTop = rowCenters.at(-1) + apertureHeight * 0.5;

  // Horizontal spandrels and vertical piers are the street wall; there is no
  // opaque plane behind them. The core starts 1.72 m back, so every gap below
  // is a real aperture into a closed shallow room.
  let verticalCursor = 3.05;
  for (const roomY of rowCenters) {
    const openingBottom = roomY - apertureHeight * 0.5;
    if (openingBottom - verticalCursor > 0.035) {
      pushBoxTransform(
        panels,
        [panelX, (verticalCursor + openingBottom) * 0.5, centerZ],
        [panelDepth, openingBottom - verticalCursor, frontage],
      );
    }
    verticalCursor = roomY + apertureHeight * 0.5;
  }
  if (height - verticalCursor > 0.035) {
    pushBoxTransform(
      panels,
      [panelX, (verticalCursor + height) * 0.5, centerZ],
      [panelDepth, height - verticalCursor, frontage],
    );
  }

  let horizontalCursor = centerZ - frontage * 0.5;
  for (const roomZ of columnCenters) {
    const openingLeft = roomZ - apertureWidth * 0.5;
    if (openingLeft - horizontalCursor > 0.035) {
      pushBoxTransform(
        panels,
        [panelX, (windowBandBottom + windowBandTop) * 0.5, (horizontalCursor + openingLeft) * 0.5],
        [panelDepth, windowBandTop - windowBandBottom, openingLeft - horizontalCursor],
      );
    }
    horizontalCursor = roomZ + apertureWidth * 0.5;
  }
  const facadeEnd = centerZ + frontage * 0.5;
  if (facadeEnd - horizontalCursor > 0.035) {
    pushBoxTransform(
      panels,
      [panelX, (windowBandBottom + windowBandTop) * 0.5, (horizontalCursor + facadeEnd) * 0.5],
      [panelDepth, windowBandTop - windowBandBottom, facadeEnd - horizontalCursor],
    );
  }

  // Close both party-wall ends and the roof of the recessed strip. These
  // occluders prevent the luminous backs from leaking through a building edge.
  const recessMidX = side * (STREET_FACADE_X + HERO_FACADE_RECESS * 0.5);
  for (const edgeZ of [centerZ - frontage * 0.5, centerZ + frontage * 0.5]) {
    pushBoxTransform(
      panels,
      [recessMidX, height * 0.5, edgeZ],
      [HERO_FACADE_RECESS, height, 0.16],
    );
  }
  pushBoxTransform(
    panels,
    [recessMidX, height - 0.08, centerZ],
    [HERO_FACADE_RECESS, 0.16, frontage],
  );

  const roomBackDepth = 1.50;
  const roomStartDepth = 0;
  const roomSpan = roomBackDepth - roomStartDepth;
  const roomMidX = side * (STREET_FACADE_X + (roomStartDepth + roomBackDepth) * 0.5);
  const backX = side * (STREET_FACADE_X + roomBackDepth);
  const frameX = side * (STREET_FACADE_X - panelDepth + 0.02);
  const glassDepth = 0.32;
  const glassX = side * (STREET_FACADE_X + glassDepth);
  const innerFrameX = side * (STREET_FACADE_X + glassDepth - 0.04);

  for (let row = 0; row < rowCenters.length; ++row) {
    for (let column = 0; column < columnCenters.length; ++column) {
      const roomY = rowCenters[row];
      const roomZ = columnCenters[column];
      const occupied = random() < 0.50 || (row === 1 && column === 1);
      const roll = random();
      const band = roll < 0.58 ? 0 : roll < 0.86 ? 1 : 2;
      const backPool = occupied ? pools.roomBacks[band] : pools.darkRoomBacks;

      pushBoxTransform(
        backPool,
        [backX, roomY, roomZ],
        [0.07, apertureHeight - 0.20, apertureWidth - 0.18],
      );
      for (const edgeZ of [roomZ - apertureWidth * 0.5, roomZ + apertureWidth * 0.5]) {
        pushBoxTransform(
          pools.roomShells,
          [roomMidX, roomY, edgeZ],
          [roomSpan, apertureHeight, 0.11],
        );
      }
      for (const edgeY of [roomY - apertureHeight * 0.5, roomY + apertureHeight * 0.5]) {
        pushBoxTransform(
          pools.roomShells,
          [roomMidX, edgeY, roomZ],
          [roomSpan, 0.10, apertureWidth],
        );
      }

      // A separate front frame and glass plane make the recess lip readable in
      // motion while the side/floor/ceiling reveal supplies true parallax.
      for (const edgeZ of [roomZ - apertureWidth * 0.5, roomZ + apertureWidth * 0.5]) {
        pushBoxTransform(
          pools.roomFrames,
          [frameX, roomY, edgeZ],
          [0.14, apertureHeight + 0.16, 0.10],
        );
      }
      for (const edgeY of [roomY - apertureHeight * 0.5, roomY + apertureHeight * 0.5]) {
        pushBoxTransform(
          pools.roomFrames,
          [frameX, edgeY, roomZ],
          [0.14, 0.10, apertureWidth + 0.02],
        );
      }
      pushBoxTransform(
        pools.roomFrames,
        [innerFrameX, roomY, roomZ],
        [0.07, apertureHeight - 0.12, 0.045],
      );
      if ((row + column) % 3 === 0) {
        pushBoxTransform(
          pools.roomFrames,
          [innerFrameX, roomY + 0.08, roomZ],
          [0.07, 0.042, apertureWidth - 0.16],
        );
      }
      pushBoxTransform(
        pools.roomGlass,
        [glassX, roomY, roomZ],
        [0.018, apertureHeight - 0.18, apertureWidth - 0.16],
      );

      // Comic-book-style layers: flat silhouettes at deliberately separated
      // depths read as 2D shapes, but slide against one another as the camera
      // moves. They are contained by the room shell instead of floating on it.
      if (occupied) {
        const furnitureDepth = 0.72 + random() * 0.34;
        const furnitureZ = roomZ + (random() - 0.5) * apertureWidth * 0.32;
        pushBoxTransform(
          pools.roomFurniture,
          [side * (STREET_FACADE_X + furnitureDepth), roomY - apertureHeight * 0.31, furnitureZ],
          [0.12, apertureHeight * (0.22 + random() * 0.14), apertureWidth * (0.34 + random() * 0.22)],
        );
        if (random() < 0.24) {
          for (let slat = 0; slat < 4; ++slat) {
            pushBoxTransform(
              pools.roomBlinds,
              [side * (STREET_FACADE_X + glassDepth + 0.12), roomY + 0.45 - slat * 0.12, roomZ],
              [0.032, 0.034, apertureWidth * 0.88],
            );
          }
        }
        if (random() < 0.18) {
          const personZ = roomZ + (random() - 0.5) * apertureWidth * 0.34;
          const personX = side * (STREET_FACADE_X + 0.40 + random() * 0.25);
          pushBoxTransform(
            pools.roomPeople,
            [personX, roomY - 0.14, personZ],
            [0.04, 0.52, 0.18],
          );
          pushBoxTransform(
            pools.roomPeople,
            [personX, roomY + 0.22, personZ],
            [0.045, 0.16, 0.16],
          );
        }
        if (random() < 0.64) {
          pushBoxTransform(
            pools.roomAccents[band],
            [side * (STREET_FACADE_X + 0.84 + random() * 0.24), roomY + apertureHeight * 0.5 - 0.09, roomZ + (random() - 0.5) * apertureWidth * 0.22],
            [0.28, 0.025, apertureWidth * 0.24],
          );
        }
      }
    }
  }
}

function addHeroShopRooms(pools, {
  side,
  centerZ,
  frontage,
  buildingIndex,
  shopColors,
  random,
}) {
  const shopCount = Math.max(1, Math.floor(frontage / 4.4));
  const usableWidth = frontage * 0.82;
  const cellWidth = usableWidth / shopCount;
  const apertureWidth = Math.min(3.45, cellWidth - 0.24);
  const apertureHeight = 2.20;
  const shopY = 1.27;
  const panelDepth = 0.34;
  const panelX = side * (STREET_FACADE_X - panelDepth * 0.5);
  const centers = Array.from(
    { length: shopCount },
    (_, shop) => centerZ - usableWidth * 0.5 + cellWidth * (shop + 0.5),
  );
  const openingBottom = shopY - apertureHeight * 0.5;
  const openingTop = shopY + apertureHeight * 0.5;

  pushBoxTransform(
    pools.podiumPanels,
    [panelX, openingBottom * 0.5, centerZ],
    [panelDepth, openingBottom, frontage],
  );
  pushBoxTransform(
    pools.podiumPanels,
    [panelX, (openingTop + 3.05) * 0.5, centerZ],
    [panelDepth, 3.05 - openingTop, frontage],
  );
  let cursor = centerZ - frontage * 0.5;
  for (const shopZ of centers) {
    const left = shopZ - apertureWidth * 0.5;
    if (left - cursor > 0.035) {
      pushBoxTransform(
        pools.podiumPanels,
        [panelX, (openingBottom + openingTop) * 0.5, (cursor + left) * 0.5],
        [panelDepth, openingTop - openingBottom, left - cursor],
      );
    }
    cursor = shopZ + apertureWidth * 0.5;
  }
  const end = centerZ + frontage * 0.5;
  if (end - cursor > 0.035) {
    pushBoxTransform(
      pools.podiumPanels,
      [panelX, (openingBottom + openingTop) * 0.5, (cursor + end) * 0.5],
      [panelDepth, openingTop - openingBottom, end - cursor],
    );
  }

  const shopBackDepth = 1.54;
  const roomStartDepth = 0;
  const shopSpan = shopBackDepth - roomStartDepth;
  const shopMidX = side * (STREET_FACADE_X + (roomStartDepth + shopBackDepth) * 0.5);
  const backX = side * (STREET_FACADE_X + shopBackDepth);
  const frameX = side * (STREET_FACADE_X - panelDepth + 0.02);
  const glassDepth = 0.34;
  const glassX = side * (STREET_FACADE_X + glassDepth);
  const innerFrameX = side * (STREET_FACADE_X + glassDepth - 0.045);

  centers.forEach((shopZ, shop) => {
    const band = (shop + buildingIndex) % shopColors.length;
    pushBoxTransform(
      pools.shopBacks[band],
      [backX, shopY, shopZ],
      [0.07, apertureHeight - 0.20, apertureWidth - 0.20],
    );
    for (const edgeZ of [shopZ - apertureWidth * 0.5, shopZ + apertureWidth * 0.5]) {
      pushBoxTransform(
        pools.shopShells,
        [shopMidX, shopY, edgeZ],
        [shopSpan, apertureHeight, 0.12],
      );
      pushBoxTransform(
        pools.shopFrames,
        [frameX, shopY, edgeZ],
        [0.16, apertureHeight + 0.16, 0.12],
      );
    }
    for (const edgeY of [openingBottom, openingTop]) {
      pushBoxTransform(
        pools.shopShells,
        [shopMidX, edgeY, shopZ],
        [shopSpan, 0.10, apertureWidth],
      );
      pushBoxTransform(
        pools.shopFrames,
        [frameX, edgeY, shopZ],
        [0.16, 0.11, apertureWidth + 0.02],
      );
    }
    pushBoxTransform(
      pools.shopFrames,
      [innerFrameX, shopY, shopZ + apertureWidth * 0.20],
      [0.08, apertureHeight - 0.14, 0.065],
    );
    pushBoxTransform(
      pools.shopFrames,
      [innerFrameX, shopY + apertureHeight * 0.20, shopZ],
      [0.08, 0.055, apertureWidth - 0.18],
    );
    pushBoxTransform(
      pools.shopGlass,
      [glassX, shopY, shopZ],
      [0.018, apertureHeight - 0.18, apertureWidth - 0.18],
    );

    // Counter, back-wall shelves and occasional customers occupy three
    // different depths, producing a compact stage-set room rather than a glow
    // plane. The shell above keeps the light visually inside the shop.
    pushBoxTransform(
      pools.shopFurniture,
      [side * (STREET_FACADE_X + 0.72), 0.65, shopZ + (random() - 0.5) * apertureWidth * 0.12],
      [0.24, 0.66, apertureWidth * 0.66],
    );
    for (let shelf = 0; shelf < 3; ++shelf) {
      pushBoxTransform(
        pools.shopShelves,
        [side * (STREET_FACADE_X + shopBackDepth - 0.055), 0.72 + shelf * 0.43, shopZ],
        [0.045, 0.075, apertureWidth * 0.72],
      );
    }
    for (const shelfZ of [shopZ - apertureWidth * 0.29, shopZ + apertureWidth * 0.29]) {
      pushBoxTransform(
        pools.shopShelves,
        [side * (STREET_FACADE_X + shopBackDepth - 0.052), 1.15, shelfZ],
        [0.045, 1.14, 0.055],
      );
    }
    if (random() < 0.76) {
      const personZ = shopZ + (random() - 0.5) * apertureWidth * 0.48;
      const personX = side * (STREET_FACADE_X + 0.39 + random() * 0.30);
      pushBoxTransform(pools.shopPeople, [personX, 1.08, personZ], [0.045, 0.72, 0.24]);
      pushBoxTransform(pools.shopPeople, [personX, 1.55, personZ], [0.05, 0.19, 0.19]);
    }

    // A compact ceiling practical lights the contents without turning the
    // entire back wall into a billboard. Its separation from the glass is an
    // especially strong parallax cue from the low sidewalk camera.
    pushBoxTransform(
      pools.canopyLights[band],
      [side * (STREET_FACADE_X + 0.92), openingTop - 0.10, shopZ],
      [0.34, 0.035, apertureWidth * 0.44],
    );

    pushBoxTransform(
      pools.canopies,
      [side * 11.74, 2.62, shopZ],
      [1.48, 0.13, apertureWidth + 0.40],
    );
    pushBoxTransform(
      pools.canopyLights[(band + 1) % shopColors.length],
      [side * 11.02, 2.51, shopZ],
      [0.07, 0.045, apertureWidth * 0.82],
    );
    pushBoxTransform(
      pools.shopSpills[band],
      [side * 11.18, 0.168, shopZ],
      [2.45, 0.008, apertureWidth * 0.74],
    );
  });
}

function addBuildingCanyon(root, signs, random, nativeHiddenOverlays) {
  const buildingRoot = new THREE.Group();
  buildingRoot.name = "Layered occupied street canyon";
  root.add(buildingRoot);

  const facadeMaterials = [
    createConcreteMaterial(0x111923, 0.73),
    createConcreteMaterial(0x18242c, 0.69),
    createConcreteMaterial(0x211b27, 0.72),
    createConcreteMaterial(0x25282c, 0.76),
  ];
  const metal = createMetalMaterial(0x303941, 0.37, 0.88);
  const rib = createMetalMaterial(0x20292f, 0.42, 0.76);
  const roof = createConcreteMaterial(0x11161a, 0.84);
  const shopGlass = createGlassMaterial(0x153543, 0.32);
  const frame = createMetalMaterial(0x465159, 0.36, 0.76);
  const canopyMaterial = createMetalMaterial(0x2b3339, 0.23, 0.88);

  const windowTransforms = [[], [], []];
  const windowMaterials = [
    createEmissiveMaterial(0xffc58b, 1.15, "Occupied warm apartment"),
    createEmissiveMaterial(0x55a9d8, 0.76, "Occupied cool apartment"),
    createEmissiveMaterial(0xd774b4, 0.62, "Occupied rose apartment"),
  ];
  const signPalette = [palette.cyan, palette.magenta, palette.amber, palette.jade, palette.red, palette.blue];
  const signWords = ["NOVA", "RAMEN", "24H", "KITE", "MISO", "VOID", "LUX", "BYTE"];
  const shopColors = [0xffb45f, 0x4ad8ff, 0xff3aac, 0x52e4ae];

  const roomBackMaterials = [
    createEmissiveMaterial(0x79513a, 0.38, "Warm shallow-room back wall"),
    createEmissiveMaterial(0x31576d, 0.29, "Cool shallow-room back wall"),
    createEmissiveMaterial(0x623b52, 0.24, "Rose shallow-room back wall"),
  ];
  const roomAccentMaterials = [
    createEmissiveMaterial(0xffc078, 1.55, "Warm room ceiling practical"),
    createEmissiveMaterial(0x67c9f0, 1.35, "Cool room ceiling practical"),
    createEmissiveMaterial(0xf184c3, 1.20, "Rose room ceiling practical"),
  ];
  const shopBackMaterials = shopColors.map((colorValue, index) => (
    createEmissiveMaterial(colorValue, 0.92, `Shop ${index + 1} recessed back wall`)
  ));
  const canopyLightMaterials = shopColors.map((colorValue, index) => (
    createEmissiveMaterial(colorValue, 2.65, `Shop ${index + 1} canopy practical`)
  ));
  const spillMaterials = shopColors.map(colorValue => createHaloMaterial(colorValue, 0.075));
  const heroGlass = createGlassMaterial(0x173744, 0.085);
  heroGlass.rtxReflectionMask = 0.08;
  heroGlass.envMapIntensity = 0.85;
  heroGlass.clearcoat = 0.58;
  const roomLining = createConcreteMaterial(0x38332f, 0.82);
  const shopLining = createConcreteMaterial(0x40362f, 0.74);
  const blindMaterial = createConcreteMaterial(0xa29a88, 0.68);
  const furnitureMaterial = createConcreteMaterial(0x17191c, 0.84);
  const silhouetteMaterial = createConcreteMaterial(0x020304, 0.96);
  const darkRoomMaterial = createConcreteMaterial(0x040609, 0.94);

  // All new room detail is pooled into a small, fixed set of instanced draws.
  // The individual boxes remain real triangles for the static RTX scene while
  // avoiding hundreds of raster submissions per facade.
  const heroPools = {
    facadePanels: facadeMaterials.map(() => []),
    podiumPanels: [],
    roomShells: [],
    roomBacks: roomBackMaterials.map(() => []),
    darkRoomBacks: [],
    roomFrames: [],
    roomGlass: [],
    roomBlinds: [],
    roomFurniture: [],
    roomPeople: [],
    roomAccents: roomAccentMaterials.map(() => []),
    shopShells: [],
    shopBacks: shopBackMaterials.map(() => []),
    shopFrames: [],
    shopGlass: [],
    shopFurniture: [],
    shopShelves: [],
    shopPeople: [],
    canopies: [],
    canopyLights: canopyLightMaterials.map(() => []),
    shopSpills: spillMaterials.map(() => []),
  };

  for (const side of [-1, 1]) {
    let z = 15;
    let buildingIndex = 0;
    while (z > -124) {
      const frontage = 8.4 + random() * 7.8;
      const gap = 0.45 + random() * 1.05;
      const depth = 5.2 + random() * 5.3;
      const height = 13 + random() * 28 + (z < -72 ? random() * 14 : 0);
      const centerZ = z - frontage * 0.5;
      const building = new THREE.Group();
      building.name = `Procedural ${side < 0 ? "west" : "east"} block ${buildingIndex}`;
      building.position.set(side * (12.6 + depth * 0.5), 0, centerZ);
      buildingRoot.add(building);

      const floors = Math.max(3, Math.floor((height - 4.4) / 2.3));
      const facadeBand = (buildingIndex + (side > 0 ? 1 : 0)) % facadeMaterials.length;
      const facadeMaterial = facadeMaterials[facadeBand];
      const heroFacade = buildingIndex < 6 && centerZ > -86;

      if (heroFacade) {
        // The core begins behind the complete apartment/shop impostor volume.
        // Its street face therefore cannot occlude the room backs.
        addBox(
          building,
          "Set-back hero masonry core",
          [depth - HERO_FACADE_RECESS, height, frontage],
          [side * HERO_FACADE_RECESS * 0.5, height * 0.5, 0],
          facadeMaterial,
          null,
          true,
          true,
        );
        addFacadeDetails(
          building,
          side,
          frontage,
          height,
          depth,
          { metal, rib, roof },
          random,
          { openFacade: true },
        );
        addHeroApartmentFacade(heroPools, {
          side,
          centerZ,
          frontage,
          height,
          floors,
          facadeBand,
          random,
        });
        addHeroShopRooms(heroPools, {
          side,
          centerZ,
          frontage,
          buildingIndex,
          shopColors,
          random,
        });
      } else {
        addBox(
          building,
          "Deep masonry building shell",
          [depth, height, frontage],
          [0, height * 0.5, 0],
          facadeMaterial,
          null,
          true,
          true,
        );
        addBox(
          building,
          "Dark street podium",
          [depth + 0.3, 3.05, frontage * 0.98],
          [side * (-0.12), 1.52, 0],
          roof,
          null,
          true,
          true,
        );
        addFacadeDetails(building, side, frontage, height, depth, { metal, rib, roof }, random);

        // Far blocks retain a cheap luminous rhythm. Hero blocks deliberately
        // never enter this pool, so no glow card sits in front of a real room.
        if (centerZ < -82) {
          const columns = Math.max(2, Math.floor((frontage - 1.0) / 1.58));
          for (let floor = 0; floor < floors; ++floor) {
            for (let column = 0; column < columns; ++column) {
              if (random() > 0.34) continue;
              const bandRoll = random();
              const band = bandRoll < 0.57 ? 0 : bandRoll < 0.87 ? 1 : 2;
              windowTransforms[band].push({
                x: side * 12.49,
                y: 4.05 + floor * 2.28,
                z: centerZ + (column / Math.max(1, columns - 1) - 0.5) * frontage * 0.82,
                side,
              });
            }
          }
        }

        const shopCount = Math.max(1, Math.floor(frontage / 4.4));
        for (let shop = 0; shop < shopCount; ++shop) {
          const shopZ = (shop / Math.max(1, shopCount - 1) - 0.5) * frontage * 0.68;
          const frontX = side * 12.43;
          addBox(buildingRoot, "Distant shop light card", [0.045, 1.88, 2.72], [frontX + side * 0.02, 1.34, centerZ + shopZ], createEmissiveMaterial(shopColors[(shop + buildingIndex) % shopColors.length], 0.45, "Distant occupied shop"), null, false, false);
          addBox(buildingRoot, "Distant shop glazing", [0.035, 1.94, 2.78], [frontX - side * 0.015, 1.36, centerZ + shopZ], shopGlass, null, false, false);
          addBox(buildingRoot, "Distant projecting canopy", [1.48, 0.13, 3.18], [side * 11.74, 2.62, centerZ + shopZ], canopyMaterial, null, false, true);
        }
      }

      const hasCommercialSign = heroFacade && buildingIndex < 4
        || (buildingIndex + (side > 0 ? 1 : 0)) % 2 === 0;
      if (hasCommercialSign && z > -108) {
        const text = signWords[(buildingIndex * 2 + (side > 0 ? 1 : 0)) % signWords.length];
        const colorValue = signPalette[(buildingIndex + (side > 0 ? 2 : 0)) % signPalette.length];
        const vertical = text.length <= 4 && buildingIndex % 3 === 0;
        signs.push(createPixelSign(buildingRoot, {
          text,
          position: [side * 10.62, vertical ? 5.35 : 3.14, centerZ + frontage * 0.28],
          colorValue,
          scale: vertical ? 0.155 : 0.10,
          vertical,
          seed: buildingIndex * 5 + (side > 0 ? 3 : 0),
        }));
      }

      z -= frontage + gap;
      buildingIndex += 1;
    }
  }

  heroPools.facadePanels.forEach((transforms, band) => {
    addBoxInstances(
      buildingRoot,
      `Hero facade masonry panels ${band + 1}`,
      transforms,
      facadeMaterials[band],
      { castShadow: true, receiveShadow: true },
    );
  });
  addBoxInstances(buildingRoot, "Hero shopfront podium surrounds", heroPools.podiumPanels, roof, {
    castShadow: true,
    receiveShadow: true,
  });
  addBoxInstances(buildingRoot, "Apartment room side floor and ceiling reveals", heroPools.roomShells, roomLining, {
    castShadow: true,
    receiveShadow: true,
  });
  heroPools.roomBacks.forEach((transforms, band) => {
    addBoxInstances(buildingRoot, `Layered occupied room backs ${band + 1}`, transforms, roomBackMaterials[band]);
  });
  addBoxInstances(buildingRoot, "Unoccupied recessed room backs", heroPools.darkRoomBacks, darkRoomMaterial);
  addBoxInstances(buildingRoot, "Recessed apartment aperture frames", heroPools.roomFrames, frame, {
    castShadow: true,
    receiveShadow: true,
  });
  addBoxInstances(buildingRoot, "Rain glass over recessed apartments", heroPools.roomGlass, heroGlass, {
    renderOrder: 2,
    rtxIgnore: true,
  });
  addBoxInstances(buildingRoot, "Layered apartment blind slats", heroPools.roomBlinds, blindMaterial);
  addBoxInstances(buildingRoot, "Layered apartment furniture cards", heroPools.roomFurniture, furnitureMaterial);
  addBoxInstances(buildingRoot, "Layered apartment person silhouettes", heroPools.roomPeople, silhouetteMaterial);
  heroPools.roomAccents.forEach((transforms, band) => {
    addBoxInstances(buildingRoot, `Apartment ceiling practicals ${band + 1}`, transforms, roomAccentMaterials[band]);
  });

  addBoxInstances(buildingRoot, "Shop room side floor and ceiling reveals", heroPools.shopShells, shopLining, {
    castShadow: true,
    receiveShadow: true,
  });
  heroPools.shopBacks.forEach((transforms, band) => {
    addBoxInstances(buildingRoot, `Recessed shop room backs ${band + 1}`, transforms, shopBackMaterials[band]);
  });
  addBoxInstances(buildingRoot, "Recessed shop aperture frames", heroPools.shopFrames, frame, {
    castShadow: true,
    receiveShadow: true,
  });
  addBoxInstances(buildingRoot, "Rain glass over recessed shops", heroPools.shopGlass, heroGlass, {
    renderOrder: 2,
    rtxIgnore: true,
  });
  addBoxInstances(buildingRoot, "Layered shop counters", heroPools.shopFurniture, furnitureMaterial);
  addBoxInstances(buildingRoot, "Layered shop back shelves", heroPools.shopShelves, blindMaterial);
  addBoxInstances(buildingRoot, "Layered shop customer silhouettes", heroPools.shopPeople, silhouetteMaterial);
  addBoxInstances(buildingRoot, "Wet projecting hero shop canopies", heroPools.canopies, canopyMaterial, {
    castShadow: true,
    receiveShadow: true,
  });
  heroPools.canopyLights.forEach((transforms, band) => {
    addBoxInstances(buildingRoot, `Hero shop ceiling and canopy practicals ${band + 1}`, transforms, canopyLightMaterials[band]);
  });
  heroPools.shopSpills.forEach((transforms, band) => {
    const spill = addBoxInstances(buildingRoot, `Shop light spill across wet pavement ${band + 1}`, transforms, spillMaterials[band], {
      renderOrder: 2,
      rtxIgnore: true,
    });
    if (spill) nativeHiddenOverlays.push(spill);
  });

  // Distant windows remain a single draw per colour, but use four-vertex
  // facade planes instead of thousands of rounded-box vertices per instance.
  const windowGeometry = new THREE.PlaneGeometry(0.76, 1.02);
  const dummy = new THREE.Object3D();
  for (let band = 0; band < windowTransforms.length; ++band) {
    const transforms = windowTransforms[band];
    const windows = new THREE.InstancedMesh(windowGeometry, windowMaterials[band], transforms.length);
    windows.name = ["Warm occupied facade rhythm", "Cool occupied facade rhythm", "Rose occupied facade rhythm"][band];
    windows.castShadow = false;
    windows.frustumCulled = false;
    for (let index = 0; index < transforms.length; ++index) {
      const transform = transforms[index];
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.rotation.set(0, -transform.side * Math.PI * 0.5, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      windows.setMatrixAt(index, dummy.matrix);
    }
    windows.instanceMatrix.needsUpdate = true;
    buildingRoot.add(windows);
  }

  // A glazed bridge makes a strong mid-distance compositional stop and gives
  // road rays useful off-screen geometry above the vanishing point.
  addBox(buildingRoot, "Elevated district skybridge", [24.8, 2.1, 3.1], [0, 8.8, -47], createConcreteMaterial(0x1a2229, 0.42), null, true, true);
  addBox(buildingRoot, "Skybridge rain glass", [24.9, 1.18, 0.08], [0, 8.88, -45.42], createGlassMaterial(0x27647a, 0.26), null, false, false);
  addBox(buildingRoot, "Skybridge cyan sill", [23.6, 0.07, 0.12], [0, 8.18, -45.34], createEmissiveMaterial(palette.cyan, 4.6, "Skybridge cyan sill"), null, false, false);
  for (let x = -10.5; x <= 10.5; x += 2.1) {
    addBox(buildingRoot, "Skybridge mullion", [0.07, 1.28, 0.11], [x, 8.82, -45.32], frame, null, true, true);
  }

  return buildingRoot;
}

function addDistantCity(root, random) {
  const distant = new THREE.Group();
  distant.name = "Fog-softened distant megacity";
  root.add(distant);
  const silhouettes = [
    createConcreteMaterial(0x030811, 0.88),
    createConcreteMaterial(0x06101a, 0.84),
    createConcreteMaterial(0x0a1320, 0.82),
  ];
  for (let index = 0; index < 24; ++index) {
    const width = 4 + random() * 8;
    const height = 20 + random() * 48;
    const depth = 4 + random() * 10;
    const x = -70 + index * 6.1 + random() * 2;
    const z = -137 - random() * 26;
    addBox(distant, "Distant tower silhouette", [width, height, depth], [x, height * 0.5, z], silhouettes[index % silhouettes.length], null, true, true);
    if (index % 5 === 0) {
      addBox(distant, "Distant crown light", [width * 0.75, 0.16, 0.12], [x, height - 1.1, z + depth * 0.5 + 0.07], createEmissiveMaterial(index % 2 ? palette.magenta : palette.cyan, 1.8, "Distant crown light"), null, false, false);
    }
  }
  return distant;
}

function addStreetFurniture(root, random) {
  const props = new THREE.Group();
  props.name = "Street-scale props and overhead utility detail";
  root.add(props);
  const darkMetal = createMetalMaterial(0x20292f, 0.38, 0.91);
  const paintedMetal = createMetalMaterial(0x344048, 0.33, 0.78);
  const warm = createEmissiveMaterial(0xffbd72, 3.8, "Street lamp practical");

  for (const side of [-1, 1]) {
    for (let z = 8; z >= -112; z -= 16) {
      addCylinder(props, "Tapered street lamp pole", [0.075, 0.105], 5.2, [side * 9.65, 2.66, z], darkMetal, null, 12);
      addBox(props, "Street lamp outreach arm", [1.0, 0.07, 0.07], [side * 9.18, 5.02, z], darkMetal, [0, 0, side * 0.11], true, true);
      const lampX = side * 8.72;
      addBox(props, "Street lamp rain hood", [0.58, 0.14, 0.30], [lampX, 4.95, z], paintedMetal, null, true, true);
      addBox(props, "Street lamp luminous aperture", [0.42, 0.035, 0.19], [lampX, 4.87, z], warm, null, false, false);
    }
  }

  // Foreground bollards and cabinets frame the low camera instead of leaving
  // a perfectly empty sidewalk around it.
  for (const side of [-1, 1]) {
    for (let z = 14; z >= -38; z -= 5.2) {
      addCylinder(props, "Wet curb bollard", [0.12, 0.15], 0.78, [side * 9.12, 0.53, z], paintedMetal, null, 12);
      addBox(props, "Bollard reflector band", [0.27, 0.065, 0.05], [side * 9.12, 0.73, z + 0.12], createEmissiveMaterial(0xd9e8e3, 0.8, "Bollard reflector"), null, false, false);
    }
  }
  for (const [x, z, h] of [[-10.2, 5.4, 1.35], [10.7, -16, 1.65], [-10.6, -36, 1.2], [10.4, -72, 1.5]]) {
    addBox(props, "Weathered utility cabinet", [0.72, h, 0.46], [x, 0.16 + h * 0.5, z], paintedMetal, null, true, true);
    addBox(props, "Utility cabinet warning lamp", [0.09, 0.09, 0.025], [x, 0.16 + h * 0.72, z + 0.245], createEmissiveMaterial(palette.amber, 1.6, "Utility warning lamp"), null, false, false);
  }

  // Sagging lines at several depths create fine parallax and sell the vertical
  // scale. TubeGeometry keeps them visible in reflections and silhouettes.
  const cableMaterial = createMetalMaterial(0x080a0c, 0.72, 0.38);
  for (let index = 0; index < 8; ++index) {
    const z = 7 - index * 14.8 + random() * 2;
    const y = 8.5 + random() * 5.5;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-13.0, y, z - 0.8),
      new THREE.Vector3(-5.4, y - 1.1 - random(), z),
      new THREE.Vector3(3.8, y - 1.35 - random(), z + 0.2),
      new THREE.Vector3(13.0, y + 0.2, z - 0.6),
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.025, 5, false), cableMaterial);
    cable.name = "Sagging overhead district cable";
    cable.castShadow = true;
    props.add(cable);
  }

  return props;
}

function addTrafficSignals(root) {
  const signals = [];
  const signalRoot = new THREE.Group();
  signalRoot.name = "Animated intersection signal heads";
  root.add(signalRoot);
  const poleMaterial = createMetalMaterial(0x1d272e, 0.31, 0.91);
  for (const side of [-1, 1]) {
    const x = side * 9.8;
    addCylinder(signalRoot, "Intersection mast", [0.09, 0.12], 5.6, [x, 2.88, -11.2], poleMaterial, null, 14);
    addBox(signalRoot, "Intersection mast arm", [8.3, 0.10, 0.10], [side * 5.8, 5.38, -11.2], poleMaterial, null, true, true);
    const housing = addBox(signalRoot, "Traffic signal housing", [0.54, 1.42, 0.42], [side * 2.35, 4.68, -10.98], createMetalMaterial(0x050708, 0.39, 0.65), null, true, true);
    const colors = [palette.red, palette.amber, 0x36ef79];
    const lenses = [];
    for (let lens = 0; lens < 3; ++lens) {
      const material = createEmissiveMaterial(colors[lens], lens === 0 ? 5.2 : 0.08, "Traffic signal lens");
      const light = new THREE.Mesh(new THREE.CircleGeometry(0.14, 18), material);
      light.name = "Rain-glossed signal lens";
      light.position.set(0, 0.42 - lens * 0.42, 0.218);
      housing.add(light);
      lenses.push(material);
    }
    signals.push({ lenses, phase: side > 0 ? 0 : 4.8 });
  }
  return signals;
}

function addPracticalLights(root) {
  const lights = [];
  const emitters = new THREE.Group();
  emitters.name = "Eight shadow-tested district practicals";
  root.add(emitters);

  const configs = [
    { color: palette.cyan, intensity: 28, distance: 22, position: [-9.4, 3.2, 3], type: "point" },
    { color: palette.magenta, intensity: 24, distance: 24, position: [9.6, 4.5, -8], type: "point" },
    { color: palette.amber, intensity: 34, distance: 25, position: [-8.5, 4.75, -23], target: [-2, 0, -29], type: "spot" },
    { color: palette.blue, intensity: 26, distance: 29, position: [8.7, 6.1, -35], target: [1, 0, -43], type: "spot" },
    { color: palette.jade, intensity: 24, distance: 25, position: [-9.2, 3.8, -53], type: "point" },
    { color: palette.red, intensity: 20, distance: 23, position: [9.1, 4.2, -69], type: "point" },
    { color: palette.warm, intensity: 30, distance: 30, position: [-8.8, 5.1, -88], target: [0, 0, -94], type: "spot" },
    { color: palette.cyan, intensity: 25, distance: 32, position: [8.7, 5.5, -107], target: [0, 1, -116], type: "spot" },
  ];

  configs.forEach((config, index) => {
    let light;
    if (config.type === "spot") {
      light = new THREE.SpotLight(config.color, config.intensity, config.distance, 0.62, 0.72, 1.65);
      light.target.position.set(...config.target);
      root.add(light.target);
    } else {
      light = new THREE.PointLight(config.color, config.intensity, config.distance, 1.75);
    }
    light.name = `District practical ray light ${index + 1}`;
    light.position.set(...config.position);
    // The native secondary-hit pass shadow-tests all eight packed practicals.
    // Raster shadow maps are reserved for one mid-street hero spot plus the
    // directional moon, avoiding three extra full-scene shadow submissions.
    light.castShadow = index === 2;
    if (light.castShadow) {
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.018;
    }
    root.add(light);
    lights.push(light);

    const fixture = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 9),
      createEmissiveMaterial(config.color, 6.4, "Visible practical bulb"),
    );
    fixture.name = "Visible practical ray-light aperture";
    fixture.position.copy(light.position);
    emitters.add(fixture);
  });

  return { lights, emitters };
}

function addKeyLighting(root) {
  const moon = new THREE.DirectionalLight(0xa5c9e5, 1.55);
  moon.name = "Storm sky directional key";
  moon.position.set(-22, 38, 26);
  moon.target.position.set(0, 2, -56);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -28;
  moon.shadow.camera.right = 28;
  moon.shadow.camera.top = 46;
  moon.shadow.camera.bottom = -12;
  moon.shadow.camera.near = 0.5;
  moon.shadow.camera.far = 180;
  moon.shadow.bias = -0.00035;
  moon.shadow.normalBias = 0.025;
  root.add(moon, moon.target);

  const ambient = new THREE.HemisphereLight(0x4f7592, 0x05080c, 0.42);
  ambient.name = "Rainy sky ambient lift";
  root.add(ambient);
  return { moon, ambient };
}

export function buildDistrictCity(scene, environment) {
  const random = seededRandom();
  const root = new THREE.Group();
  root.name = "Neon Rain District static world";
  scene.add(root);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 48, 28), createSkyMaterial());
  sky.name = "Procedural moving storm canopy";
  sky.position.set(0, 28, -58);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  const signs = [];
  const nativeHiddenOverlays = [];
  const road = addRoad(root, environment, random);
  const buildings = addBuildingCanyon(root, signs, random, nativeHiddenOverlays);
  const distant = addDistantCity(root, random);
  const props = addStreetFurniture(root, random);
  const signals = addTrafficSignals(root);
  const practicals = addPracticalLights(root);
  const keyLights = addKeyLighting(root);

  return {
    root,
    sky,
    road,
    buildings,
    distant,
    props,
    signs,
    signals,
    staticRoots: [root],
    staticLights: practicals.lights,
    moon: keyLights.moon,
    update(time) {
      for (const sign of signs) {
        if (!sign.flicker) continue;
        const noise = Math.sin(time * 17.1 + sign.phase)
          + Math.sin(time * 41.7 + sign.phase * 2.3) * 0.42;
        const dropout = noise < -1.06;
        sign.material.emissiveIntensity = dropout ? 0.55 : 7.8 + Math.max(0, noise) * 0.72;
        sign.haloMaterial.opacity = dropout ? 0.025 : 0.13;
      }
      for (const signal of signals) {
        const phase = (time + signal.phase) % 11;
        const active = phase < 5.4 ? 0 : phase < 6.5 ? 1 : 2;
        signal.lenses.forEach((material, index) => {
          material.emissiveIntensity = index === active ? 5.3 : 0.045;
        });
      }
    },
    setReflectionQuality(highQuality) {
      road.reflection.reflector.resolutionScale = highQuality ? 0.62 : 0.38;
    },
    setNativeReflectionMode(enabled) {
      rasterReflectionStrength.value = enabled ? 0 : 1;
      road.road.material = enabled ? road.nativeMaterial : road.rasterMaterial;
      // Native reflections come from the procedural asphalt itself.  The
      // raster-only alpha/additive sheets otherwise write hard rectangles
      // into the colour/MRT attachments before ray compositing.
      road.puddles.visible = !enabled;
      for (const overlay of nativeHiddenOverlays) overlay.visible = !enabled;
      road.reflection.reflector.updateBeforeType = enabled
        ? THREE.NodeUpdateType.NONE
        : THREE.NodeUpdateType.FRAME;
      if (!enabled) road.reflection.reflector.forceUpdate = true;
    },
    dispose() {
      road.reflection.dispose?.();
    },
  };
}
