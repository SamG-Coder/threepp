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
  ["isMeshStandardMaterial", "MeshStandardMaterial"],
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
  ["isLight", "Light"],
  ["isAmbientLight", "AmbientLight"],
  ["isDirectionalLight", "DirectionalLight"],
  ["isWebGLRenderTarget", "WebGLRenderTarget"],
  ["isWebGLCubeRenderTarget", "WebGLCubeRenderTarget"],
  ["isWebGLRenderer", "WebGLRenderer"],
]);

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
