import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { ancestor } from "acorn-walk";

const nativeRendererImport = 'import { WebGLRenderer as __TB_WebGLRenderer } from "three";\n';

function isRendererMarker(node) {
  const truthy = node.right?.type === "Literal" && node.right.value === true ||
    node.right?.type === "UnaryExpression" && node.right.operator === "!" &&
      node.right.argument?.type === "Literal" && node.right.argument.value === 0;
  return node.type === "AssignmentExpression" &&
    node.left?.type === "MemberExpression" &&
    node.left.object?.type === "ThisExpression" &&
    ((node.left.computed && node.left.property?.value === "isWebGLRenderer") ||
      (!node.left.computed && node.left.property?.name === "isWebGLRenderer")) &&
    truthy;
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

function replacementFor(node, source) {
  if (node.type === "ClassDeclaration" || node.type === "FunctionDeclaration") {
    if (!node.id?.name) return null;
    return { start: node.start, end: node.end, text: `const ${node.id.name}=__TB_WebGLRenderer;`, binding: node.id.name };
  }
  if (node.type === "ClassExpression" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    return { start: node.start, end: node.end, text: "__TB_WebGLRenderer", binding: source.slice(node.start, Math.min(node.end, node.start + 40)) };
  }
  return null;
}

export function relinkViteChunk(source, filename = "chunk.mjs") {
  if (!source.includes("isWebGLRenderer") || source.includes("__TB_WebGLRenderer")) {
    return { source, changed: false, renderers: [] };
  }

  const ast = parse(source, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
  });
  const definitions = new Map();
  ancestor(ast, {
    AssignmentExpression(node, ancestors) {
      if (!isRendererMarker(node)) return;
      const definition = rendererDefinition(ancestors);
      if (definition) definitions.set(`${definition.start}:${definition.end}`, definition);
    },
  });

  const replacements = [...definitions.values()]
    .map(node => replacementFor(node, source))
    .filter(Boolean)
    .sort((left, right) => right.start - left.start);
  if (!replacements.length) return { source, changed: false, renderers: [] };

  let output = source;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.text}${output.slice(replacement.end)}`;
  }
  const insertion = output.startsWith("#!") ? output.indexOf("\n") + 1 : 0;
  output = `${output.slice(0, insertion)}${nativeRendererImport}${output.slice(insertion)}`;
  return {
    source: output,
    changed: true,
    renderers: replacements.map(replacement => replacement.binding),
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
  console.log(`Relinked ${result.renderers.length} embedded WebGLRenderer binding(s): ${result.renderers.join(", ")}`);
}
