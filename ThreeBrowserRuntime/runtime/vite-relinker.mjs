import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { ancestor } from "acorn-walk";

const nativeThreeImport = [
  'import * as __TB_THREE from "three";',
  'function __TB_relink(type,Original){',
  'const Native=__TB_THREE[type];if(!Native||!Original)return Native||Original;',
  'const Relinked=class extends Native{};',
  'for(const key of Reflect.ownKeys(Original.prototype||{})){if(key!=="constructor"&&!(key in Relinked.prototype))Object.defineProperty(Relinked.prototype,key,Object.getOwnPropertyDescriptor(Original.prototype,key));}',
  'for(const key of Reflect.ownKeys(Original)){if(!["length","name","prototype"].includes(key)&&!(key in Relinked))Object.defineProperty(Relinked,key,Object.getOwnPropertyDescriptor(Original,key));}',
  'return Relinked;}',
  '',
].join('\n');

// These are structural Three.js types whose identity crosses the native
// renderer boundary.  Rollup may rename every binding, but Three preserves the
// public `is<Type>` marker in production builds.  Relinking the whole model
// spine means scenes are born with native handles; replacing WebGLRenderer
// alone leaves an otherwise valid embedded scene opaque to threepp.
const nativeTypes = new Map([
  ["isObject3D", "Object3D"],
  ["isGroup", "Group"],
  ["isScene", "Scene"],
  ["isCamera", "Camera"],
  ["isPerspectiveCamera", "PerspectiveCamera"],
  ["isOrthographicCamera", "OrthographicCamera"],
  ["isBufferAttribute", "BufferAttribute"],
  ["isBufferGeometry", "BufferGeometry"],
  ["isMaterial", "Material"],
  ["isMeshBasicMaterial", "MeshBasicMaterial"],
  ["isMeshLambertMaterial", "MeshLambertMaterial"],
  ["isMeshPhongMaterial", "MeshPhongMaterial"],
  ["isMeshToonMaterial", "MeshToonMaterial"],
  ["isMeshStandardMaterial", "MeshStandardMaterial"],
  ["isMeshPhysicalMaterial", "MeshPhysicalMaterial"],
  ["isMeshNormalMaterial", "MeshNormalMaterial"],
  ["isPointsMaterial", "PointsMaterial"],
  ["isLineBasicMaterial", "LineBasicMaterial"],
  ["isLineDashedMaterial", "LineDashedMaterial"],
  ["isSpriteMaterial", "SpriteMaterial"],
  ["isShaderMaterial", "ShaderMaterial"],
  ["isRawShaderMaterial", "RawShaderMaterial"],
  ["isMeshDepthMaterial", "MeshDepthMaterial"],
  ["isMeshDistanceMaterial", "MeshDistanceMaterial"],
  ["isTexture", "Texture"],
  ["isCanvasTexture", "CanvasTexture"],
  ["isDataTexture", "DataTexture"],
  ["isData3DTexture", "Data3DTexture"],
  ["isDataArrayTexture", "DataArrayTexture"],
  ["isDepthTexture", "DepthTexture"],
  ["isCubeTexture", "CubeTexture"],
  ["isMesh", "Mesh"],
  ["isInstancedMesh", "InstancedMesh"],
  ["isLine", "Line"],
  ["isLineSegments", "LineSegments"],
  ["isPoints", "Points"],
  ["isSprite", "Sprite"],
  ["isBone", "Bone"],
  ["isSkinnedMesh", "SkinnedMesh"],
  ["isLight", "Light"],
  ["isAmbientLight", "AmbientLight"],
  ["isDirectionalLight", "DirectionalLight"],
  ["isHemisphereLight", "HemisphereLight"],
  ["isPointLight", "PointLight"],
  ["isSpotLight", "SpotLight"],
  ["isRectAreaLight", "RectAreaLight"],
  ["isWebGLRenderTarget", "WebGLRenderTarget"],
  ["isWebGLCubeRenderTarget", "WebGLCubeRenderTarget"],
  ["isWebGLRenderer", "WebGLRenderer"],
]);
const nativeTypeNames = new Set(nativeTypes.values());
const expectedNativeBase = new Map([
  ["Group", "Object3D"], ["Scene", "Object3D"], ["Camera", "Object3D"],
  ["PerspectiveCamera", "Camera"], ["OrthographicCamera", "Camera"],
  ["Mesh", "Object3D"], ["InstancedMesh", "Mesh"],
  ["Line", "Object3D"], ["LineSegments", "Line"],
  ["Points", "Object3D"], ["Sprite", "Object3D"], ["Bone", "Object3D"],
  ["SkinnedMesh", "Mesh"], ["Light", "Object3D"], ["AmbientLight", "Light"],
  ["DirectionalLight", "Light"], ["HemisphereLight", "Light"],
  ["PointLight", "Light"], ["SpotLight", "Light"], ["RectAreaLight", "Light"],
  ["MeshBasicMaterial", "Material"], ["MeshLambertMaterial", "Material"],
  ["MeshPhongMaterial", "Material"], ["MeshToonMaterial", "Material"],
  ["MeshStandardMaterial", "Material"], ["MeshPhysicalMaterial", "MeshStandardMaterial"],
  ["MeshNormalMaterial", "Material"], ["PointsMaterial", "Material"],
  ["LineBasicMaterial", "Material"], ["LineDashedMaterial", "LineBasicMaterial"],
  ["SpriteMaterial", "Material"], ["ShaderMaterial", "Material"],
  ["RawShaderMaterial", "ShaderMaterial"], ["MeshDepthMaterial", "Material"],
  ["MeshDistanceMaterial", "Material"], ["CanvasTexture", "Texture"],
  ["DataTexture", "Texture"], ["Data3DTexture", "Texture"],
  ["DataArrayTexture", "Texture"], ["DepthTexture", "Texture"],
  ["CubeTexture", "Texture"], ["WebGLCubeRenderTarget", "WebGLRenderTarget"],
]);
const recognizableThreeBases = new Set([
  ...nativeTypeNames, "InstancedMesh", "EventDispatcher", "Loader",
]);

function isCustomDerivedType(definition, nativeType) {
  if (definition.type !== "ClassDeclaration" && definition.type !== "ClassExpression") return false;
  const baseName = definition.superClass?.type === "Identifier" ? definition.superClass.name : null;
  const expected = expectedNativeBase.get(nativeType);
  return Boolean(baseName && expected && recognizableThreeBases.has(baseName) && baseName !== expected);
}

function semanticMarker(node) {
  const truthy = node.right?.type === "Literal" && node.right.value === true ||
    node.right?.type === "UnaryExpression" && node.right.operator === "!" &&
      node.right.argument?.type === "Literal" && node.right.argument.value === 0;
  if (node.type !== "AssignmentExpression" || !truthy ||
      node.left?.type !== "MemberExpression" ||
      node.left.object?.type !== "ThisExpression") return null;
  const marker = node.left.computed ? node.left.property?.value : node.left.property?.name;
  return nativeTypes.has(marker) ? marker : null;
}

function rendererDefinition(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; --index) {
    const node = ancestors[index];
    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") return node;
  }
  for (let index = ancestors.length - 1; index >= 0; --index) {
    const node = ancestors[index];
    if (node.type === "FunctionDeclaration") return node;
    if (node.type === "VariableDeclarator" &&
        new Set(["FunctionExpression", "ArrowFunctionExpression"]).has(node.init?.type)) return node.init;
  }
  return null;
}

function definitionBinding(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; --index) {
    const node = ancestors[index];
    if ((node.type === "ClassDeclaration" || node.type === "FunctionDeclaration") && node.id?.name) {
      return node.id.name;
    }
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      return node.id.name;
    }
  }
  return null;
}

const namedRendererConstruction = /\bnew\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)?(?:WebGLRenderer|WebGPURenderer(?:Async)?)\s*\(/;
const contentHashedFilename = /(?:^|[/\\])[^/\\]*[.-][A-Za-z0-9_-]{8}\.m?js$/i;

// Production Vite/Rollup output is one or two dense lines with mangled
// identifiers. Pretty Three.js sources can still contain a long GLSL string,
// so line length alone is not enough unless the file is also dense.
export function detectMinifiedJavaScript(source, filename = "") {
  const text = String(source ?? "");
  const lines = text.split(/\r?\n/);
  const longestLine = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const averageLineLength = text.length / Math.max(lines.length, 1);
  const signals = [];
  if (longestLine >= 500) signals.push("long-lines");
  if (averageLineLength >= 200) signals.push("dense-lines");
  if (/\bis(?:WebGL|WebGPU)Renderer\b/.test(text) && !namedRendererConstruction.test(text)) {
    signals.push("mangled-three-constructors");
  }
  if (contentHashedFilename.test(String(filename).replaceAll("\\", "/"))) {
    signals.push("content-hashed-filename");
  }
  return {
    minified: signals.includes("dense-lines")
      || signals.includes("mangled-three-constructors")
      || (signals.includes("long-lines") && averageLineLength >= 120),
    signals,
    longestLine,
    averageLineLength: Math.round(averageLineLength),
  };
}

// Rollup/Vite renames renderer classes, so `new WebGPURenderer()` is not a
// reliable usage signal in a deployed bundle. Match the stable Three.js
// semantic marker to its containing constructor, then check whether that
// mangled constructor is instantiated anywhere in the chunk.
export function detectBundledRendererUsage(source) {
  if (!source.includes("isWebGLRenderer") && !source.includes("isWebGPURenderer")) {
    return { hasWebGL: false, hasWebGPU: false, usesWebGL: false, usesWebGPU: false };
  }

  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true });
  } catch {
    try {
      ast = parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
    } catch {
      return { hasWebGL: false, hasWebGPU: false, usesWebGL: false, usesWebGPU: false };
    }
  }

  const webGLBindings = new Set();
  const webGPUBindings = new Set();
  const constructedBindings = new Set();
  ancestor(ast, {
    AssignmentExpression(node, ancestors) {
      const truthy = node.right?.type === "Literal" && node.right.value === true ||
        node.right?.type === "UnaryExpression" && node.right.operator === "!" &&
          node.right.argument?.type === "Literal" && node.right.argument.value === 0;
      if (!truthy || node.left?.type !== "MemberExpression" ||
          node.left.object?.type !== "ThisExpression") return;
      const marker = node.left.computed ? node.left.property?.value : node.left.property?.name;
      if (marker !== "isWebGLRenderer" && marker !== "isWebGPURenderer") return;
      const binding = definitionBinding(ancestors);
      if (!binding) return;
      (marker === "isWebGPURenderer" ? webGPUBindings : webGLBindings).add(binding);
    },
    NewExpression(node) {
      if (node.callee?.type === "Identifier") constructedBindings.add(node.callee.name);
    },
  });

  const isConstructed = bindings => [...bindings].some(binding => constructedBindings.has(binding));
  return {
    hasWebGL: webGLBindings.size > 0,
    hasWebGPU: webGPUBindings.size > 0,
    usesWebGL: isConstructed(webGLBindings),
    usesWebGPU: isConstructed(webGPUBindings),
  };
}

function replacementFor(node, source, nativeType) {
  if (node.type === "ClassDeclaration" || node.type === "FunctionDeclaration") {
    if (!node.id?.name) return null;
    const original = source.slice(node.start, node.end);
    const expression = node.type === "ClassDeclaration"
      ? original.replace(/^class\s+[A-Za-z_$][\w$]*/, "class")
      : original.replace(/^function\s+[A-Za-z_$][\w$]*/, "function");
    return { start: node.start, end: node.end, text: `const ${node.id.name}=__TB_relink(${JSON.stringify(nativeType)},${expression});`, binding: node.id.name, nativeType };
  }
  if (node.type === "ClassExpression" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    return { start: node.start, end: node.end, text: `__TB_relink(${JSON.stringify(nativeType)},${source.slice(node.start, node.end)})`, binding: source.slice(node.start, Math.min(node.end, node.start + 40)), nativeType };
  }
  return null;
}

export function relinkViteChunk(source, filename = "chunk.mjs") {
  if (!source.includes("isWebGLRenderer") || source.includes("__TB_THREE")) {
    return { source, changed: false, renderers: [], types: [] };
  }

  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
  });
  const definitions = new Map();
  ancestor(ast, {
    AssignmentExpression(node, ancestors) {
      const marker = semanticMarker(node);
      if (!marker) return;
      const definition = rendererDefinition(ancestors);
      if (!definition) return;
      const key = `${definition.start}:${definition.end}`;
      const nativeType = nativeTypes.get(marker);
      const current = definitions.get(key);
      // Prefer the most-derived marker when a constructor contains more than
      // one marker (for example a specialized material).
      if (!current || marker !== "isMaterial" && marker !== "isObject3D" && marker !== "isLight") {
        definitions.set(key, { definition, nativeType });
      }
    },
  });

  const replacements = [...definitions.values()]
    .filter(({ definition, nativeType }) => !isCustomDerivedType(definition, nativeType))
    .map(({ definition, nativeType }) => replacementFor(definition, source, nativeType))
    .filter(Boolean)
    .sort((left, right) => right.start - left.start);
  if (!replacements.some(replacement => replacement.nativeType === "WebGLRenderer")) {
    return { source, changed: false, renderers: [], types: [] };
  }

  let output = source;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  const insertion = output.startsWith("#!") ? output.indexOf("\n") + 1 : 0;
  output = `${output.slice(0, insertion)}${nativeThreeImport}${output.slice(insertion)}`;
  return {
    source: output,
    changed: true,
    renderers: replacements.filter(replacement => replacement.nativeType === "WebGLRenderer").map(replacement => replacement.binding),
    types: [...new Set(replacements.map(replacement => replacement.nativeType))],
    filename,
  };
}

// Pre-module Three.js distributions use a UMD factory that fills an exports
// object near the end of the bundle (for example `l.Scene=jb`).  Rebinding
// those local constructor variables immediately before the export block lets
// the rest of the legacy bundle keep its controls/loaders/passes while all
// scene objects crossing the renderer boundary are created by the native
// facade.  No website-specific identifiers are assumed here.
export function relinkLegacyThreeBundle(source, filename = "bundle.js") {
  if (!source.includes("WebGLRenderer") || source.includes("__TB_relinkLegacy")) {
    return { source, changed: false, renderers: [], types: [] };
  }

  let ast;
  try {
    ast = parse(source, { ecmaVersion: "latest", sourceType: "script", allowHashBang: true });
  } catch {
    return { source, changed: false, renderers: [], types: [] };
  }

  const groups = new Map();
  ancestor(ast, {
    AssignmentExpression(node) {
      if (node.operator !== "=" || node.left?.type !== "MemberExpression" ||
          node.left.object?.type !== "Identifier" || node.right?.type !== "Identifier") return;
      const type = node.left.computed ? node.left.property?.value : node.left.property?.name;
      if (!nativeTypeNames.has(type)) return;
      const name = node.left.object.name;
      const group = groups.get(name) || new Map();
      group.set(type, { binding: node.right.name, start: node.start });
      groups.set(name, group);
    },
  });

  const candidates = [...groups.entries()]
    .filter(([, assignments]) => assignments.has("WebGLRenderer"))
    .sort((left, right) => right[1].size - left[1].size);
  if (!candidates.length) return { source, changed: false, renderers: [], types: [] };

  const [, assignments] = candidates[0];
  const selected = new Map();
  for (const [type, assignment] of assignments) {
    if (!selected.has(assignment.binding)) selected.set(assignment.binding, { type, ...assignment });
  }
  const values = [...selected.values()];
  const insertion = Math.min(...values.map(value => value.start));
  const bridge = [
    "function __TB_relinkLegacy(type,Original){",
    "const Native=globalThis.__threeBrowserNativeThree?.[type];if(!Native||!Original)return Native||Original;",
    "function Relinked(...args){const instance=Reflect.construct(Native,args);Object.defineProperties(this,Object.getOwnPropertyDescriptors(instance));}",
    "Object.setPrototypeOf(Relinked,Native);Relinked.prototype=Object.create(Native.prototype);Object.defineProperty(Relinked.prototype,\"constructor\",{value:Relinked,writable:true,configurable:true});",
    "for(const key of Reflect.ownKeys(Original.prototype||{})){if(key!==\"constructor\"&&!(key in Relinked.prototype))Object.defineProperty(Relinked.prototype,key,Object.getOwnPropertyDescriptor(Original.prototype,key));}",
    "for(const key of Reflect.ownKeys(Original)){if(![\"length\",\"name\",\"prototype\"].includes(key)&&!(key in Relinked))Object.defineProperty(Relinked,key,Object.getOwnPropertyDescriptor(Original,key));}",
    "return Relinked;}",
    ...values.map(({ binding, type }) => `${binding}=__TB_relinkLegacy(${JSON.stringify(type)},${binding});`),
    "",
  ].join("\n");
  return {
    source: `${source.slice(0, insertion)}${bridge}${source.slice(insertion)}`,
    changed: true,
    renderers: [assignments.get("WebGLRenderer").binding],
    types: [...new Set(values.map(value => value.type))],
    filename,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [input, output = input] = process.argv.slice(2);
  if (!input) {
    console.error("Usage: node vite-relinker.mjs <input.mjs> [output.mjs]");
    process.exit(2);
  }
  const result = relinkViteChunk(fs.readFileSync(input, "utf8"), input);
  if (!result.changed) {
    console.error(`No embedded WebGLRenderer definition found in ${input}`);
    process.exit(1);
  }
  fs.writeFileSync(output, result.source);
  console.log(`Relinked ${result.types.length} embedded Three.js type(s): ${result.types.join(", ")}`);
}
