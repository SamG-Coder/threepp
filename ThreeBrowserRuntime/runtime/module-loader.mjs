import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

let documentBaseURL = null;
let imports = {};
let threeFacadeURL = null;
const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));

function findNodeModules() {
  if (process.env.THREEBROWSER_RUNTIME_NODE_MODULES) return process.env.THREEBROWSER_RUNTIME_NODE_MODULES;
  let directory = runtimeDirectory;
  while (true) {
    const candidate = path.join(directory, "node_modules");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

const nodeModules = findNodeModules();

function packageModule(specifier) {
  if (!nodeModules) return null;
  if (specifier === "three/webgpu") return path.join(nodeModules, "three", "build", "three.webgpu.js");
  if (specifier === "three/tsl") return path.join(nodeModules, "three", "build", "three.tsl.js");
  if (specifier.startsWith("three/addons/")) {
    return path.join(nodeModules, "three", "examples", "jsm", specifier.slice("three/addons/".length));
  }
  if (specifier === "lil-gui") return path.join(runtimeDirectory, "lil-gui-stub.mjs");
  return null;
}

function validExportName(name) {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !new Set([
    "await", "break", "case", "catch", "class", "const", "continue", "debugger",
    "default", "delete", "do", "else", "enum", "export", "extends", "false",
    "finally", "for", "function", "if", "implements", "import", "in", "instanceof",
    "interface", "let", "new", "null", "package", "private", "protected", "public",
    "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof",
    "var", "void", "while", "with", "yield",
  ]).has(name);
}

function moduleExportNames(filePath, visited = new Set()) {
  const absolute = path.resolve(filePath);
  if (visited.has(absolute) || !fs.existsSync(absolute)) return [];
  visited.add(absolute);
  const source = fs.readFileSync(absolute, "utf8");
  const names = new Set();
  for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}(?:\s*from\s*["'][^"']+["'])?\s*;/g)) {
    for (const item of match[1].split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      const name = parts.at(-1)?.trim();
      if (name && validExportName(name)) names.add(name);
    }
  }
  for (const match of source.matchAll(/\bexport\s+(?:const|let|var|class|function)\s+([A-Za-z_$][\w$]*)/g)) {
    if (validExportName(match[1])) names.add(match[1]);
  }
  for (const match of source.matchAll(/\bexport\s*\*\s*from\s*["']([^"']+)["']/g)) {
    const target = path.resolve(path.dirname(absolute), match[1]);
    for (const name of moduleExportNames(target, visited)) names.add(name);
  }
  return [...names];
}

function facadeURL() {
  if (threeFacadeURL) return threeFacadeURL;
  const stockPath = nodeModules ? path.join(nodeModules, "three", "build", "three.module.js") : null;
  const names = new Set(Object.keys(globalThis.THREE || {}).filter(validExportName));
  if (stockPath) for (const name of moduleExportNames(stockPath)) names.add(name);
  const sortedNames = [...names].sort();
  const source = [
    ...(stockPath ? [`import * as STOCK from ${JSON.stringify(pathToFileURL(stockPath).href)};`] : ["const STOCK = {};"]),
    "const THREE = globalThis.THREE;",
    "const merged = Object.assign({}, STOCK, THREE);",
    "export default merged;",
    ...sortedNames.map(name => `export const ${name} = Object.hasOwn(THREE, ${JSON.stringify(name)}) ? THREE[${JSON.stringify(name)}] : STOCK[${JSON.stringify(name)}];`),
  ].join("\n");
  threeFacadeURL = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return threeFacadeURL;
}

function mappedSpecifier(specifier) {
  if (Object.hasOwn(imports, specifier)) return imports[specifier];
  const prefix = Object.keys(imports)
    .filter(key => key.endsWith("/") && specifier.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (!prefix) return null;
  return `${imports[prefix]}${specifier.slice(prefix.length)}`;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Native ThreeBrowser deliberately substitutes its compatibility API for
    // both the core package and addon-style imports.
    if (specifier === "three") {
      return { url: facadeURL(), shortCircuit: true };
    }
    if (/lil-gui(?:\.module(?:\.min)?)?\.(?:m?js)$/i.test(specifier) || specifier === "lil-gui") {
      return { url: pathToFileURL(path.join(runtimeDirectory, "lil-gui-stub.mjs")).href, shortCircuit: true };
    }
    const packagePath = packageModule(specifier);
    if (packagePath) return { url: pathToFileURL(packagePath).href, shortCircuit: true };

    const mapped = mappedSpecifier(specifier);
    if (mapped !== null) {
      const url = new URL(mapped, documentBaseURL || context.parentURL).href;
      return { url, shortCircuit: true };
    }

    // Inline HTML modules have a data: parent, so browser-relative imports
    // must resolve against the containing document instead.
    if ((specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) &&
        context.parentURL?.startsWith("data:") && documentBaseURL) {
      return { url: new URL(specifier, documentBaseURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    // A browser always treats files reached by an ESM import as modules. Node
    // otherwise interprets .js according to a nearby package.json.
    const filePath = url.startsWith("file:") ? fileURLToPath(url) : "";
    // Pulls produced before JSON imports retained their real extension contain
    // raw JSON in a `.json.mjs` file. Honor the import attribute for those
    // cached projects so they remain launchable without modifying third-party
    // source or requiring an immediate re-pull.
    if (filePath && context.importAttributes?.type === "json" && /\.json\.mjs$/i.test(filePath)) {
      return { format: "json", source: fs.readFileSync(filePath, "utf8"), shortCircuit: true };
    }
    const dependencyPath = filePath.includes(`${path.sep}node_modules${path.sep}`);
    if (filePath && !dependencyPath && /\.(?:js|jsx)$/i.test(filePath)) {
      return { format: "module", source: fs.readFileSync(filePath, "utf8"), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export function configureModuleDocument(filePath, importMap = {}) {
  documentBaseURL = new URL("./", pathToFileURL(filePath)).href;
  imports = importMap?.imports && typeof importMap.imports === "object" ? importMap.imports : {};
}

export function configureModuleFile(filePath) {
  documentBaseURL = new URL("./", pathToFileURL(filePath)).href;
  imports = {};
}
