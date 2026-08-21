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

function facadeURL() {
  if (threeFacadeURL) return threeFacadeURL;
  const names = Object.keys(globalThis.THREE || {}).filter(validExportName).sort();
  const source = [
    "const THREE = globalThis.THREE;",
    "export default THREE;",
    ...names.map(name => `export const ${name} = THREE[${JSON.stringify(name)}];`),
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
    if (url.startsWith("file:") && /\.(?:js|jsx)$/i.test(new URL(url).pathname)) {
      return { format: "module", source: fs.readFileSync(fileURLToPath(url), "utf8"), shortCircuit: true };
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
