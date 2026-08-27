import * as THREE from "three/webgpu";
import { loadCutout } from "./assets.mjs";

// Grok replacements can land asynchronously. Anything in this set remains
// loaded and audited, but is not composed into the scene while its current
// bitmap implies 3D perspective instead of a face-on 2D card.
const HIDDEN_UNTIL_FRONT_FLAT = new Set([
  "awnings/canvas-awning-dark.png",
  "awnings/canvas-awning-striped.png",
  "awnings/metal-canopy-shallow.png",
  "awnings/translucent-canopy-cyan.png",
  "background-structures/rear-fire-stair-tower.png",
  "props/traffic-light.png",
  "props/phone-booth.png",
  "props/bus-shelter.png",
  "props/news-kiosk.png",
  "props/fire-escape.png",
  "props/planter-box.png",
  "props/sidewalk-bench.png",
  "props/parking-meter.png",
]);

const FRONT_FLAT_SUBSTITUTIONS = new Map([
  ["storefronts/coffee-counter-storefront.png", "storefronts/department-display-storefront.png"],
  ["storefronts/electronics-storefront.png", "storefronts/department-display-storefront.png"],
  ["storefronts/pharmacy-storefront.png", "storefronts/department-display-storefront.png"],
  ["window-units/industrial-window-wired.png", "window-units/metal-window-violet.png"],
  ["window-units/metal-window-cyan.png", "window-units/metal-window-violet.png"],
  ["window-units/sash-window-dark.png", "window-units/metal-window-violet.png"],
]);

const FRONT_FLAT_PROP_ALLOW = new Set([
  "props/streetlamp-double.png",
  "props/vending-machine-cyan.png",
  "props/vending-machine-red.png",
  "props/utility-pole.png",
  "props/overhead-cable-span.png",
  "props/alley-steam-vent.png",
]);

function makeLitCutoutMaterial(asset, options = {}) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    name: options.name || "Grok lit image card",
    map: asset.texture,
    emissiveMap: asset.texture,
    emissive: new THREE.Color(options.emissive || 0xffffff),
    emissiveIntensity: Number(options.emissiveIntensity ?? 0.08),
    roughness: Number(options.roughness ?? 0.58),
    metalness: Number(options.metalness ?? 0),
    clearcoat: Number(options.clearcoat ?? 0.46),
    clearcoatRoughness: Number(options.clearcoatRoughness ?? 0.16),
    transparent: false,
    alphaTest: Number(options.alphaTest ?? 0.14),
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: options.fog !== false,
  });
  material.alphaToCoverage = true;
  material.toneMapped = true;
  material.rtxReflectionMask = Number(options.rtxReflectionMask ?? 0.1);
  material.userData.rtxIgnore = true;
  return material;
}

function makeSteamMaterial(asset) {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Translucent alley steam image card",
    map: asset.texture,
    color: 0xffffff,
    transparent: true,
    opacity: 0.74,
    alphaTest: 0.035,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  material.alphaToCoverage = true;
  material.userData.rtxIgnore = true;
  material.rtxReflectionMask = 0;
  return material;
}

function makeBackgroundMaterial(asset, tint) {
  const material = new THREE.MeshBasicNodeMaterial({
    name: "Grok atmospheric structure card",
    map: asset.texture,
    color: tint,
    transparent: false,
    alphaTest: 0.11,
    depthWrite: true,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  material.alphaToCoverage = true;
  material.userData.rtxIgnore = true;
  material.rtxReflectionMask = 0;
  return material;
}

function addCard(group, geometry, material, options) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name;
  mesh.position.set(options.x, options.baseY + options.height * 0.5, options.z);
  mesh.rotation.y = Math.PI;
  mesh.scale.set(options.width, options.height, 1);
  mesh.renderOrder = options.renderOrder || 0;
  mesh.castShadow = Boolean(options.castShadow);
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.flatImageCard = true;
  mesh.userData.assetPath = options.assetPath;
  mesh.userData.componentRole = options.componentRole || null;
  group.add(mesh);
  return mesh;
}

function radianceFromColor(value, energy) {
  const color = new THREE.Color(value);
  const gain = Math.max(0.05, Number(energy) || 1) * 0.42;
  return [color.r * gain, color.g * gain, color.b * gain, 1];
}

function makeUniformProxyMaterial(asset, specification) {
  const material = new THREE.MeshStandardNodeMaterial({
    name: "Flat native component proxy fallback — " + asset.relativePath,
    color: new THREE.Color(specification.light).multiplyScalar(0.08),
    roughness: 0.68,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  material.userData.rtxTriangleRadiance = radianceFromColor(
    specification.light,
    specification.energy,
  );
  material.rtxReflectionMask = 0;
  return material;
}

function sampleProxyCells(canvas, columns, rows) {
  if (!canvas?.width || !canvas?.height || typeof canvas.getContext !== "function") return [];

  let pixels;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    return [];
  }

  const samplesPerAxis = 4;
  const samplesPerCell = samplesPerAxis * samplesPerAxis;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sampleY = 0; sampleY < samplesPerAxis; sampleY += 1) {
        const y = Math.min(
          canvas.height - 1,
          Math.floor(((row + (sampleY + 0.5) / samplesPerAxis) / rows) * canvas.height),
        );
        for (let sampleX = 0; sampleX < samplesPerAxis; sampleX += 1) {
          const x = Math.min(
            canvas.width - 1,
            Math.floor(((column + (sampleX + 0.5) / samplesPerAxis) / columns) * canvas.width),
          );
          const offset = (y * canvas.width + x) * 4;
          const sampleAlpha = pixels[offset + 3] / 255;
          red += (pixels[offset] / 255) * sampleAlpha;
          green += (pixels[offset + 1] / 255) * sampleAlpha;
          blue += (pixels[offset + 2] / 255) * sampleAlpha;
          alpha += sampleAlpha;
        }
      }

      const averageAlpha = alpha / samplesPerCell;
      if (averageAlpha < 0.08 || alpha <= 0) continue;
      cells.push({
        row,
        column,
        alpha: averageAlpha,
        red: red / alpha,
        green: green / alpha,
        blue: blue / alpha,
      });
    }
  }
  return cells;
}

function proxyGridFor(role) {
  switch (role) {
    case "building-shell": return { columns: 12, rows: 8 };
    case "background-structure": return { columns: 10, rows: 6 };
    case "storefront": return { columns: 10, rows: 6 };
    case "window": return { columns: 4, rows: 4 };
    case "sign": return { columns: 6, rows: 4 };
    case "awning": return { columns: 6, rows: 3 };
    case "person": return { columns: 4, rows: 6 };
    default: return { columns: 6, rows: 6 };
  }
}

function proxyShapeFor(asset, grid, context) {
  const key = `${asset.relativePath}|${grid.columns}x${grid.rows}`;
  if (context.shapes.has(key)) return context.shapes.get(key);

  const cells = sampleProxyCells(asset.canvas, grid.columns, grid.rows);
  if (cells.length === 0) {
    const fallback = { cells, geometry: context.unitPlane };
    context.shapes.set(key, fallback);
    return fallback;
  }

  const positions = [];
  const indices = [];
  const geometry = new THREE.BufferGeometry();
  geometry.name = "Flat sampled component proxy geometry — " + asset.relativePath;
  cells.forEach((cell, materialIndex) => {
    const vertex = positions.length / 3;
    const x0 = cell.column / grid.columns - 0.5;
    const x1 = (cell.column + 1) / grid.columns - 0.5;
    const y0 = 0.5 - (cell.row + 1) / grid.rows;
    const y1 = 0.5 - cell.row / grid.rows;
    positions.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0);
    geometry.addGroup(indices.length, 6, materialIndex);
    indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
  });
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  context.proxyGeometries.push(geometry);
  const shape = { cells, geometry };
  context.shapes.set(key, shape);
  return shape;
}

function proxyLayerFor(asset, role, light, energy, context) {
  const grid = proxyGridFor(role);
  const lightColor = new THREE.Color(light);
  const safeEnergy = Math.max(0.01, Number(energy) || 0.01);
  const key = [
    asset.relativePath,
    grid.columns + "x" + grid.rows,
    lightColor.getHexString(),
    safeEnergy.toFixed(4),
  ].join("|");
  if (context.layers.has(key)) return context.layers.get(key);

  const shape = proxyShapeFor(asset, grid, context);
  if (shape.cells.length === 0) {
    const material = makeUniformProxyMaterial(asset, { light: lightColor, energy: safeEnergy });
    context.proxyMaterials.push(material);
    const fallback = { geometry: shape.geometry, material };
    context.layers.set(key, fallback);
    return fallback;
  }

  const cellMaterials = [];
  for (const cell of shape.cells) {
    const sampledColor = new THREE.Color().setRGB(
      cell.red,
      cell.green,
      cell.blue,
      THREE.SRGBColorSpace,
    );
    const material = new THREE.MeshStandardNodeMaterial({
      name: `Flat sampled component proxy — ${asset.relativePath} [${cell.column},${cell.row}]`,
      color: sampledColor,
      roughness: 0.68,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    const luminance = sampledColor.r * 0.2126 + sampledColor.g * 0.7152 + sampledColor.b * 0.0722;
    const radianceColor = sampledColor.clone().lerp(lightColor, 0.24);
    const radianceGain = cell.alpha
      * (0.018 + Math.pow(luminance, 1.25) * (0.18 + safeEnergy * 0.16));
    material.userData.rtxTriangleRadiance = [
      radianceColor.r * radianceGain,
      radianceColor.g * radianceGain,
      radianceColor.b * radianceGain,
      1,
    ];
    material.rtxReflectionMask = 0;
    cellMaterials.push(material);
    context.proxyMaterials.push(material);
  }
  const layer = { geometry: shape.geometry, material: cellMaterials };
  context.layers.set(key, layer);
  return layer;
}

function addStaticProxy(proxyGroup, asset, options, context) {
  const layer = proxyLayerFor(asset, options.componentRole, options.light, options.energy, context);
  return addCard(proxyGroup, layer.geometry, layer.material, {
    name: "Flat ray component — " + options.name,
    assetPath: options.assetPath,
    componentRole: options.componentRole,
    x: options.x,
    z: options.z + 0.075,
    baseY: options.baseY,
    width: options.width,
    height: options.height,
    renderOrder: -100,
    castShadow: false,
  });
}

function collectAssetPaths(config) {
  if (!Array.isArray(config.backgroundStructures) || !Array.isArray(config.buildings)) {
    throw new TypeError("scene-config.json must define backgroundStructures[] and buildings[].");
  }
  const paths = new Set();
  const add = path => {
    if (typeof path === "string" && path.length > 0) paths.add(path);
  };
  for (const item of config.backgroundStructures) add(item.asset);
  for (const building of config.buildings) {
    add(building.shell);
    add(building.storefront?.asset);
    add(building.windows?.asset);
    add(building.sign?.asset);
    add(building.awning?.asset);
  }
  for (const item of config.props || []) add(item.asset);
  for (const item of config.staticPeople || []) add(item.asset);
  return [...paths];
}

function componentMaterial(asset, building, role) {
  const settings = {
    "building-shell": { intensity: 0.035, roughness: 0.66, clearcoat: 0.34, mask: 0.07 },
    storefront: { intensity: 0.13, roughness: 0.48, clearcoat: 0.58, mask: 0.16 },
    window: { intensity: 0.18, roughness: 0.32, clearcoat: 0.72, mask: 0.28 },
    sign: { intensity: 0.34, roughness: 0.42, clearcoat: 0.52, mask: 0.12 },
    awning: { intensity: 0.065, roughness: 0.58, clearcoat: 0.42, mask: 0.08 },
  }[role];
  return makeLitCutoutMaterial(asset, {
    name: `${role} image card — ${asset.relativePath}`,
    emissive: building.light,
    emissiveIntensity: settings.intensity,
    roughness: settings.roughness,
    clearcoat: settings.clearcoat,
    clearcoatRoughness: role === "window" ? 0.08 : 0.15,
    rtxReflectionMask: settings.mask,
  });
}

function componentEnergy(building, role) {
  const scale = {
    "building-shell": 0.12,
    storefront: 0.8,
    window: 0.7,
    sign: 1.15,
    awning: 0.3,
  }[role];
  return Math.max(0.01, Number(building.energy) || 1) * scale;
}

function componentEmissiveBase(building, role) {
  const base = {
    "building-shell": 0.028,
    storefront: 0.105,
    window: 0.145,
    sign: 0.28,
    awning: 0.052,
  }[role];
  return base + Math.max(0, Number(building.energy) || 1) * (role === "sign" ? 0.026 : 0.01);
}

export async function createDowntownCards(scene, config) {
  const group = new THREE.Group();
  group.name = "Grok-only modular metropolitan image-card layers";
  const proxyGroup = new THREE.Group();
  proxyGroup.name = "Flat RTX registration components";
  const unitPlane = new THREE.PlaneGeometry(1, 1, 2, 2);
  unitPlane.name = "Shared flat image-card plane";
  const materials = [];
  const proxyMaterials = [];
  const proxyGeometries = [];
  const records = [];
  const buildings = [];
  const proxyContext = {
    unitPlane,
    proxyMaterials,
    proxyGeometries,
    shapes: new Map(),
    layers: new Map(),
  };

  const assetPaths = collectAssetPaths(config);
  const loaded = await Promise.all(assetPaths.map(path => loadCutout(path)));
  const assets = new Map(assetPaths.map((path, index) => [path, loaded[index]]));
  const assetFor = path => {
    const asset = assets.get(path);
    if (!asset) throw new Error("Missing modular image asset declaration: " + path);
    return asset;
  };
  const frontFlatAssetFor = path => assetFor(FRONT_FLAT_SUBSTITUTIONS.get(path) || path);

  for (const item of config.backgroundStructures) {
    const asset = assetFor(item.asset);
    if (
      HIDDEN_UNTIL_FRONT_FLAT.has(item.asset)
      || item.asset === "background-structures/elevated-rail-pier.png"
    ) continue;
    const width = asset.aspect * item.height;
    const depthTint = item.z > 90 ? 0x53657a : item.z > 45 ? 0x6c7890 : 0x8291a5;
    const material = makeBackgroundMaterial(asset, depthTint);
    materials.push(material);
    const options = {
      name: "Background structure — " + item.asset,
      assetPath: item.asset,
      componentRole: "background-structure",
      x: item.x,
      z: item.z,
      baseY: Number(item.baseY ?? 0.08),
      width,
      height: item.height,
      renderOrder: item.order,
      castShadow: false,
    };
    const mesh = addCard(group, unitPlane, material, options);
    const proxy = addStaticProxy(proxyGroup, asset, {
      ...options,
      light: depthTint,
      energy: 0.08,
    }, proxyContext);
    records.push({ kind: "background-structure", item, asset, mesh, proxy, material });
  }

  const facadeZ = Number(config.world.facadeZ);
  const zOffset = {
    "building-shell": 0,
    storefront: -0.018,
    window: -0.028,
    awning: -0.038,
    sign: -0.048,
  };
  const renderOrder = {
    "building-shell": -12,
    storefront: -10,
    window: -9,
    awning: -8,
    sign: -7,
  };

  config.buildings.forEach((building, buildingIndex) => {
    const buildingRecord = {
      id: building.id,
      item: building,
      phase: buildingIndex * 1.731,
      components: {
        shell: null,
        storefront: null,
        windows: [],
        sign: null,
        awning: null,
      },
      animatedMaterials: [],
    };

    function addBuildingComponent(role, specification, asset, extra = {}) {
      const material = extra.material || componentMaterial(asset, building, role);
      if (!extra.material) {
        materials.push(material);
        buildingRecord.animatedMaterials.push({
          material,
          role,
          baseEmissive: componentEmissiveBase(building, role),
        });
      }
      const options = {
        name: `${building.id} ${role} — ${asset.relativePath}`,
        assetPath: asset.relativePath,
        componentRole: role,
        x: specification.x,
        z: facadeZ + zOffset[role],
        baseY: specification.baseY,
        width: specification.width,
        height: specification.height,
        renderOrder: renderOrder[role],
        castShadow: role === "building-shell",
      };
      const mesh = addCard(group, unitPlane, material, options);
      const proxy = addStaticProxy(proxyGroup, asset, {
        ...options,
        light: building.light,
        energy: componentEnergy(building, role),
      }, proxyContext);
      const record = {
        kind: "building-component",
        role,
        buildingId: building.id,
        item: specification,
        asset,
        mesh,
        proxy,
        material,
        ...extra.record,
      };
      records.push(record);
      return record;
    }

    const shellAsset = assetFor(building.shell);
    buildingRecord.components.shell = addBuildingComponent(
      "building-shell",
      {
        asset: building.shell,
        x: building.x,
        baseY: 0.14,
        width: building.width,
        height: building.height,
      },
      shellAsset,
    );

    const storefront = building.storefront;
    const storefrontAsset = frontFlatAssetFor(storefront.asset);
    buildingRecord.components.storefront = addBuildingComponent(
      "storefront",
      {
        ...storefront,
        x: building.x + Number(storefront.xOffset || 0),
      },
      storefrontAsset,
    );

    const windows = building.windows;
    const windowAsset = frontFlatAssetFor(windows.asset);
    const windowMaterial = componentMaterial(windowAsset, building, "window");
    materials.push(windowMaterial);
    buildingRecord.animatedMaterials.push({
      material: windowMaterial,
      role: "window",
      baseEmissive: componentEmissiveBase(building, "window"),
    });
    const windowHeight = Number(windows.height);
    const windowWidth = windowAsset.aspect * windowHeight;
    const columns = Math.max(1, Math.trunc(Number(windows.columns) || 1));
    const rows = Math.max(1, Math.trunc(Number(windows.rows) || 1));
    const horizontalStep = Number(windows.xGap || windowWidth);
    const verticalStep = Number(windows.yGap || windowHeight);
    const windowCenterX = building.x + Number(windows.centerX || 0);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = windowCenterX + (column - (columns - 1) * 0.5) * horizontalStep;
        const baseY = Number(windows.baseY) + row * verticalStep;
        buildingRecord.components.windows.push(addBuildingComponent(
          "window",
          {
            ...windows,
            x,
            baseY,
            width: windowWidth,
            height: windowHeight,
          },
          windowAsset,
          {
            material: windowMaterial,
            record: { column, row },
          },
        ));
      }
    }

    const sign = building.sign;
    const signAsset = assetFor(sign.asset);
    buildingRecord.components.sign = addBuildingComponent(
      "sign",
      {
        ...sign,
        x: building.x + Number(sign.xOffset || 0),
      },
      signAsset,
    );

    // Current awning generation has visible top/side faces. Keep every source
    // in the manifest, but withhold them until Grok returns orthographic fronts.
    if (building.awning && !HIDDEN_UNTIL_FRONT_FLAT.has(building.awning.asset)) {
      const awning = building.awning;
      const awningAsset = assetFor(awning.asset);
      buildingRecord.components.awning = addBuildingComponent(
        "awning",
        {
          ...awning,
          x: building.x + Number(awning.xOffset || 0),
        },
        awningAsset,
      );
    }
    buildings.push(buildingRecord);
  });

  (config.props || []).forEach((item, index) => {
    const asset = assetFor(item.asset);
    if (HIDDEN_UNTIL_FRONT_FLAT.has(item.asset) || !FRONT_FLAT_PROP_ALLOW.has(item.asset)) return;
    const sign = item.asset.includes("neon-sign");
    const steam = item.asset === "props/alley-steam-vent.png";
    const material = steam
      ? makeSteamMaterial(asset)
      : makeLitCutoutMaterial(asset, {
          name: "Single street object — " + item.asset,
          emissiveIntensity: sign ? 0.34 : 0.07,
          roughness: sign ? 0.48 : 0.78,
        });
    materials.push(material);
    const width = asset.aspect * item.height;
    const options = {
      name: "Street object — " + item.asset,
      assetPath: item.asset,
      componentRole: sign ? "sign" : "prop",
      x: item.x,
      z: item.z,
      baseY: Number(item.baseY ?? 0.14),
      width,
      height: item.height,
      renderOrder: 4 + Math.round((15 - item.z) * 3),
      castShadow: !steam,
    };
    const mesh = addCard(group, unitPlane, material, options);
    const proxy = steam
      ? null
      : addStaticProxy(proxyGroup, asset, {
          ...options,
          light: sign ? 0xff4fd8 : 0x8291a5,
          energy: sign ? 1.25 : 0.12,
        }, proxyContext);
    records.push({
      kind: steam ? "steam" : sign ? "neon-sign" : "prop",
      item,
      asset,
      mesh,
      proxy,
      material,
      phase: index * 0.931,
      baseY: mesh.position.y,
    });
  });

  (config.staticPeople || []).forEach((item, index) => {
    const asset = assetFor(item.asset);
    // The focused street study intentionally has one human presence: player.
    // Assets remain loaded and audited, but no background pedestrian is placed.
    void index;
    void asset;
    return;
    const material = makeLitCutoutMaterial(asset, {
      name: "Single static city person — " + item.asset,
      emissive: 0xc9d9e2,
      emissiveIntensity: 0.14,
      roughness: 0.82,
    });
    materials.push(material);
    const height = THREE.MathUtils.clamp(Number(item.height), 1.68, 1.92);
    const width = Math.min(asset.aspect * height, height * 0.72);
    const options = {
      name: "Occupied sidewalk — " + item.asset,
      assetPath: item.asset,
      componentRole: "person",
      x: item.x,
      z: item.z,
      baseY: 0.14,
      width,
      height,
      renderOrder: 10 + index,
      castShadow: true,
    };
    const mesh = addCard(group, unitPlane, material, options);
    const proxy = addStaticProxy(proxyGroup, asset, {
      ...options,
      light: 0x75839a,
      energy: 0.06,
    }, proxyContext);
    records.push({
      kind: "static-person",
      item,
      asset,
      mesh,
      proxy,
      material,
      phase: index * 2.13,
    });
  });

  scene.add(group);
  scene.add(proxyGroup);

  return {
    group,
    proxyGroup,
    buildings,
    records,
    update(time) {
      for (const building of buildings) {
        const slow = 0.93
          + Math.sin(time * (0.53 + building.phase * 0.013) + building.phase) * 0.045;
        const faulty = Math.sin(time * 3.7 + building.phase * 5.2) > 0.985 ? 0.68 : 1;
        for (const entry of building.animatedMaterials) {
          const faultScale = entry.role === "sign" || entry.role === "window" ? faulty : 1;
          entry.material.emissiveIntensity = entry.baseEmissive * slow * faultScale;
        }
      }
      for (const record of records) {
        if (record.kind === "neon-sign") {
          const recover = Math.sin(time * 6.7 + record.phase);
          record.material.emissiveIntensity = 0.26 + Math.max(0, recover) * 0.17;
        } else if (record.kind === "steam") {
          record.mesh.position.y = record.baseY + Math.sin(time * 0.72 + record.phase) * 0.12;
          record.material.opacity = 0.74 + Math.sin(time * 0.43 + record.phase) * 0.13;
        }
      }
    },
    hideProxies() {
      proxyGroup.visible = false;
    },
    dispose() {
      scene.remove(group, proxyGroup);
      unitPlane.dispose();
      for (const geometry of proxyGeometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const material of proxyMaterials) material.dispose();
    },
  };
}
