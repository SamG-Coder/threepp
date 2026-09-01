import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { detectBundledRendererUsage, detectMinifiedJavaScript, relinkLegacyThreeBundle, relinkViteChunk } from "./vite-relinker.mjs";

const [address, destinationArgument, ...flags] = process.argv.slice(2);
if (!address) {
  console.error("Usage: pull <https://site.example/page> [destination] [--force]");
  process.exit(2);
}

const startURL = new URL(address);
if (!new Set(["http:", "https:"]).has(startURL.protocol)) {
  throw new Error("Only HTTP and HTTPS websites can be pulled.");
}

const destination = path.resolve(destinationArgument || process.cwd());
const force = flags.includes("--force");
fs.mkdirSync(destination, { recursive: true });
const existing = fs.readdirSync(destination).filter(name => name !== ".git");
if (existing.length && !force) {
  throw new Error(`Destination is not empty: ${destination}\nUse a new folder or pass --force.`);
}

const maximumFiles = 2500;
const maximumFileBytes = 64 * 1024 * 1024;
const maximumTotalBytes = 768 * 1024 * 1024;
let totalBytes = 0;
const records = new Map();
const queue = [];
const findings = new Set();
const importMapEntries = new Map();
const relinkedFiles = [];
const uiSignals = new Set();
const visibleHtmlTags = new Set();
const threeSourceRevisions = new Set();
let hasThreeRuntimeCode = false;
let hasInterceptableThreeImport = false;
let hasViteRuntime = false;
let hasWebGlRenderer = false;
let hasWebGpuRenderer = false;
let usesWebGlRenderer = false;
let usesWebGpuRenderer = false;
let hasMinifiedCode = false;
const minifySignals = new Set();
let rootURL = startURL;
let inlineIndex = 0;

function cleanSegment(value) {
  const cleaned = decodeURIComponent(value).replace(/[<>:"|?*\x00-\x1f]/g, "_").trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : "_";
}

function querySuffix(url) {
  return url.search ? `-${crypto.createHash("sha1").update(url.search).digest("hex").slice(0, 8)}` : "";
}

function moduleLike(url, contentType = "", hint = "") {
  if (/(?:application\/wasm|octet-stream|model\/gltf-binary|image\/|audio\/|video\/)/i.test(contentType)) return false;
  return hint === "module" || /(?:javascript|ecmascript)/i.test(contentType) || /\.(?:m?js|jsx|ts|tsx)$/i.test(url.pathname);
}

function styleLike(url, contentType = "", hint = "") {
  return hint === "style" || /text\/css/i.test(contentType) || /\.css$/i.test(url.pathname);
}

function sourceMapLike(url, contentType = "", hint = "") {
  return hint === "map" || /source-?map|application\/json/i.test(contentType) && /\.map$/i.test(url.pathname) || /\.map$/i.test(url.pathname);
}

function localPathFor(url, contentType = "", hint = "") {
  const external = url.origin !== rootURL.origin;
  const prefix = external ? ["_external", cleanSegment(url.hostname + (url.port ? `_${url.port}` : ""))] : [];
  const pieces = url.pathname.split("/").filter(Boolean).map(cleanSegment);
  if (!pieces.length || url.pathname.endsWith("/")) pieces.push("index.html");
  let filename = pieces.pop();
  const suffix = querySuffix(url);
  if (moduleLike(url, contentType, hint)) {
    filename = filename.replace(/\.(?:m?js|jsx|ts|tsx)$/i, "") || "module";
    filename = `${filename}${suffix}.mjs`;
  } else if (suffix) {
    const extension = path.extname(filename);
    filename = `${filename.slice(0, filename.length - extension.length)}${suffix}${extension}`;
  }
  return path.join(...prefix, ...pieces, filename || "index.html");
}

function isFetchable(value) {
  return !/^(?:data:|blob:|javascript:|mailto:|tel:|#)/i.test(value);
}

function resolveReference(value, baseURL, allowAssetLiteral = false, documentRelative = false) {
  if (!value || !isFetchable(value)) return null;
  // Broad string scanning is deliberately conservative. Human-readable
  // warnings in bundled libraries often mention paths such as
  // "moved to /examples/...js" and are not network requests.
  if (allowAssetLiteral && /\s/.test(value)) return null;
  // Literal loader/fetch assets in an extracted inline HTML module retain the
  // document's base URL in a browser. The synthetic __inline__ file is only a
  // storage detail and must not alter those URLs.
  if (documentRelative && (value.startsWith("./") || value.startsWith("../"))) {
    try { return new URL(value, rootURL); } catch { return null; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/") ||
      value.startsWith("./") || value.startsWith("../")) {
    try { return new URL(value, baseURL); } catch { return null; }
  }
  if (importMapEntries.has(value)) return new URL(importMapEntries.get(value));
  const prefix = [...importMapEntries.keys()]
    .filter(key => key.endsWith("/") && value.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return new URL(`${importMapEntries.get(prefix)}${value.slice(prefix.length)}`);
  if (allowAssetLiteral && /[\\/].+\.(?:m?js|css|wasm|json|glsl|vert|frag|comp|wgsl|spv|png|jpe?g|webp|gif|svg|hdr|exr|gltf|glb|bin|dat)(?:[?#].*)?$/i.test(value)) {
    try { return new URL(value, rootURL); } catch { return null; }
  }
  return null;
}

function hintFor(value, fallback = "asset") {
  if (/\.map(?:[?#].*)?$/i.test(value)) return "map";
  // JSON modules keep their real extension so Node can validate and load
  // `with { type: "json" }` imports. Treating every static import as a
  // JavaScript module produces a raw `file.json.mjs` file whose extension is
  // incompatible with the preserved JSON import attribute.
  if (/\.json(?:[?#].*)?$/i.test(value)) return "json";
  if (/\.(?:m?js|jsx|ts|tsx)(?:[?#].*)?$/i.test(value)) return "module";
  if (/\.css(?:[?#].*)?$/i.test(value)) return "style";
  return fallback;
}

function enqueue(url, hint = "asset", parent = null) {
  url.hash = "";
  const key = url.href;
  let record = records.get(key);
  if (!record) {
    if (records.size >= maximumFiles) throw new Error(`Site exceeded the ${maximumFiles}-file safety limit.`);
    record = { url, hint, parent, status: "queued", references: [], content: null, contentType: "", localPath: "" };
    records.set(key, record);
    queue.push(record);
  } else if (record.hint === "asset" && hint !== "asset") {
    record.hint = hint;
  }
  return record;
}

function collectReference(record, value, hint = "asset", allowAssetLiteral = false, documentRelative = allowAssetLiteral) {
  // Module specifiers and new URL(..., import.meta.url) references are scanned
  // before the broad asset-literal pass. Keep their module-relative meaning
  // instead of enqueueing a second, document-relative copy of the same text.
  const existingReference = record.references.find(reference => reference.value === value);
  if (existingReference) return records.get(existingReference.target);
  const resolved = resolveReference(value, record.referenceBaseURL ?? record.url, allowAssetLiteral, documentRelative);
  if (!resolved || !new Set(["http:", "https:"]).has(resolved.protocol)) return;
  const dependency = enqueue(resolved, hintFor(value, hint), record.url.href);
  record.references.push({
    value,
    target: dependency.url.href,
    // WebGPU's package entry and its addons must share the exact same
    // three.core module instance. Leaving addon imports as bare `three`
    // routes them through the native WebGL facade and creates a second set of
    // classes, breaking instanceof checks and cached geometry state.
    preserveSpecifier: value === "three" && !importMapEntries.has("three/webgpu"),
    documentRelative,
  });
  return dependency;
}

function simpleStringLiteral(source) {
  const match = /^\s*(['"])([\s\S]*)\1\s*$/.exec(source);
  if (!match) return null;
  return match[2]
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

function inspectComposedAssetArrays(record, source) {
  const constants = new Map();
  for (const match of source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])([^\r\n]*?)\2\s*;/g)) {
    constants.set(match[1], simpleStringLiteral(`${match[2]}${match[3]}${match[2]}`));
  }
  const assetPattern = /\.(?:m?js|css|wasm|json|glsl|vert|frag|comp|wgsl|spv|png|jpe?g|webp|gif|svg|hdr|exr|gltf|glb|bin|dat)(?:[?#].*)?$/i;
  for (const array of source.matchAll(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*\[([\s\S]*?)\]\s*;/g)) {
    for (const expression of array[1].split(",")) {
      let value = "";
      let valid = true;
      for (const termSource of expression.split("+")) {
        const term = termSource.trim();
        const literal = simpleStringLiteral(term);
        if (literal !== null) value += literal;
        else if (constants.has(term)) value += constants.get(term);
        else { valid = false; break; }
      }
      if (valid && assetPattern.test(value)) {
        collectReference(record, value, "asset", true, record.virtualSource !== undefined);
      }
    }
  }
}

function inspectJavaScript(record, source) {
  if (/\b__vite__|vitePreload|__vitePreload|["']modulepreload["'].*MutationObserver/.test(source)) {
    hasViteRuntime = true;
    findings.add("Vite runtime detected");
  }
  const minified = detectMinifiedJavaScript(source, record.localPath);
  if (minified.minified) {
    hasMinifiedCode = true;
    for (const signal of minified.signals) minifySignals.add(signal);
    findings.add(`Minified JavaScript detected in ${record.localPath}`);
  }
  const bundledRenderer = detectBundledRendererUsage(source);
  const sourceHasWebGlRenderer = /\bWebGLRenderer\b/.test(source) || bundledRenderer.hasWebGL;
  const sourceHasWebGpuRenderer = /\bWebGPURenderer\b/.test(source) || bundledRenderer.hasWebGPU;
  // Keep runtime-definition detection separate from application usage. The
  // stock Three.js module contains both class names (and migration comments)
  // regardless of which renderer the page constructs. Treating any mention as
  // usage starts an idle WebGPU window before ordinary WebGL pages run.
  const sourceUsesWebGlRenderer = /\bnew\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)?WebGLRenderer\s*\(/.test(source) || bundledRenderer.usesWebGL;
  const sourceUsesWebGpuRenderer = /\bnew\s+(?:[A-Za-z_$][\w$]*\s*\.\s*)?WebGPURenderer(?:Async)?\s*\(/.test(source) || bundledRenderer.usesWebGPU;
  for (const pattern of [
    /\bREVISION\s*=\s*["'](\d+)["']/g,
    /\bTHREE\.REVISION\s*=\s*["'](\d+)["']/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      const revision = Number.parseInt(match[1], 10);
      if (Number.isFinite(revision)) threeSourceRevisions.add(revision);
    }
  }
  if (sourceHasWebGlRenderer) hasWebGlRenderer = true;
  if (sourceHasWebGpuRenderer) hasWebGpuRenderer = true;
  if (sourceUsesWebGlRenderer) usesWebGlRenderer = true;
  if (sourceUsesWebGpuRenderer) usesWebGpuRenderer = true;
  if (sourceHasWebGlRenderer || sourceHasWebGpuRenderer || /THREE\.REVISION|REVISION\s*=\s*["']\d+/i.test(source)) {
    hasThreeRuntimeCode = true;
    findings.add(`Three.js code detected in ${record.localPath}`);
  }
  const browserUiApis = [
    ["dynamic DOM", /document\.(?:createElement|querySelector|getElementById)|\.innerHTML\b|\.classList\b/],
    ["layout measurements", /getBoundingClientRect|(?:offset|client)(?:Width|Height|Top|Left)\b/],
    ["scroll-driven UI", /IntersectionObserver|scrollIntoView|\bscrollY\b|addEventListener\(\s*["']scroll/],
    ["form controls", /HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|\.valueAsNumber\b/],
    ["React UI", /react-dom|createRoot\(|hydrateRoot\(|__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED/],
  ];
  for (const [label, pattern] of browserUiApis) if (pattern.test(source)) uiSignals.add(label);

  const modulePatterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*(["'`])([^"'`\r\n]+)\1\s*\)/g,
  ];
  for (const pattern of modulePatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[2] ?? match[1];
      if (value === "three" || value.startsWith("three/")) {
        hasInterceptableThreeImport = true;
        findings.add(`Three.js import: ${value}`);
      }
      collectReference(record, value, "module");
    }
  }
  // Vite/Rolldown may emit worker URLs with backtick literals and may wrap
  // import.meta.url in a harmless concatenation (for example `` +
  // import.meta.url). Accept those optimized forms as well as the canonical
  // new URL("asset", import.meta.url) spelling so worker chunks are pulled.
  for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*(["'`])([^"'`\r\n]+)\1\s*,\s*[^)]*\bimport\.meta\.url\s*\)/g)) {
    collectReference(record, match[2], "asset");
  }
  for (const match of source.matchAll(/\.setPath\(\s*["']([^"']*)["']\s*\)\s*\.load\(\s*["']([^"']+)["']/g)) {
    collectReference(record, `${match[1]}${match[2]}`, "asset", true, record.virtualSource !== undefined);
  }

  // Browser URL consumers resolve ordinary relative strings against the
  // document URL, even when the call itself lives in an external ES module.
  // Keep new URL(..., import.meta.url) module-relative (handled above), but
  // preserve browser semantics for fetch/Request and common asset loaders.
  const documentUrlPatterns = [
    /\b(?:fetch|Request)\s*\(\s*["']([^"']+)["']/g,
    /\.\s*(?:load|loadAsync)\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const pattern of documentUrlPatterns) {
    for (const match of source.matchAll(pattern)) {
      collectReference(record, match[1], "asset", true, true);
    }
  }

  const assetSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const assetStrings = /["']([^"'\\\r\n]+\.(?:m?js|css|wasm|json|glsl|vert|frag|comp|wgsl|spv|png|jpe?g|webp|gif|svg|hdr|exr|gltf|glb|bin|dat)(?:[?#][^"']*)?)["']/gi;
  for (const match of assetSource.matchAll(assetStrings)) {
    collectReference(record, match[1], "asset", true, record.virtualSource !== undefined);
  }
  // A common optimized-loader shape is `${base}assets/file.ext`. The base is
  // normally the document path; collecting the static suffix preserves the
  // same result without trying to execute arbitrary bundle expressions.
  const templateAssetStrings = /`(?:\$\{[^}]+\})?([^`$]+\.(?:wasm|json|glsl|vert|frag|comp|wgsl|spv|png|jpe?g|webp|gif|svg|hdr|exr|gltf|glb|bin|dat)(?:[?#][^`]*)?)`/gi;
  for (const match of assetSource.matchAll(templateAssetStrings)) {
    collectReference(record, match[1], "asset", true, true);
  }
  inspectComposedAssetArrays(record, assetSource);
  const sourceMap = /\/\/[#@]\s*sourceMappingURL\s*=\s*([^\s]+)/g;
  for (const match of source.matchAll(sourceMap)) collectReference(record, match[1], "map");
}

function inspectCss(record, source) {
  for (const match of source.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    collectReference(record, match[1] || match[2], "asset");
  }
}

function inspectHtml(record, source) {
  for (const match of source.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    if (!new Set(["html", "head", "body", "title", "script", "style", "link", "meta", "canvas"]).has(tag)) {
      visibleHtmlTags.add(tag);
    }
  }
  record.htmlElements = [...source.matchAll(/<([a-z][\w-]*)\b[^>]*?\bid\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map(match => ({ tag: match[1].toLowerCase(), id: match[2] }))
    .filter(element => !new Set(["html", "head", "body", "script", "style", "link", "meta"]).has(element.tag));
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1];
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]?.toLowerCase();
    if (type === "importmap") {
      try {
        const map = JSON.parse(match[2]);
        for (const [specifier, target] of Object.entries(map?.imports || {})) {
          importMapEntries.set(specifier, new URL(String(target), record.url).href);
        }
      } catch (error) {
        console.warn(`  invalid import map in ${record.url.href}: ${error.message}`);
      }
      continue;
    }
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
    if (src) {
      const dependency = collectReference(record, src, type === "module" ? "module" : "asset", true, true);
      if (type === "module" && dependency) {
        record.moduleEntries ??= [];
        record.moduleEntries.push(dependency.url.href);
      } else if ((!type || /^(?:text|application)\/(?:java|ecma)script$/.test(type)) && dependency) {
        record.classicEntries ??= [];
        record.classicEntries.push(dependency.url.href);
      }
    }
    else if (type === "module" && match[2].trim()) {
      const inlineURL = new URL(`./__inline__/entry-${++inlineIndex}.mjs`, record.url);
      const inline = enqueue(inlineURL, "module", record.url.href);
      inline.virtualSource = match[2];
      // Relative references in an inline module use the document URL in a
      // browser, while the extracted module still needs file-relative paths
      // from its synthetic __inline__ location after localization.
      inline.referenceBaseURL = rootURL;
      inline.localPath = path.join("__inline__", `entry-${inlineIndex}.mjs`);
      record.inlineModules ??= [];
      record.inlineModules.push(inline.url.href);
    }
    else if ((!type || /^(?:text|application)\/(?:java|ecma)script$/.test(type)) && match[2].trim()) {
      // Classic inline scripts execute during HTML parsing, before deferred
      // module scripts. Preserve them as global scripts so route/bootstrap
      // values established by the document are available to the app.
      record.inlineScripts ??= [];
      record.inlineScripts.push(match[2]);
    }
  }
  for (const match of source.matchAll(/<(?:link|img|source|video|audio)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const tag = match[0];
    const hint = /rel\s*=\s*["']modulepreload["']/i.test(tag) ? "module" :
      /rel\s*=\s*["']stylesheet["']/i.test(tag) ? "style" : "asset";
    collectReference(record, match[1], hint, true, true);
  }
}

async function fetchRecord(record) {
  if (record.virtualSource !== undefined) {
    record.content = Buffer.from(record.virtualSource);
    record.contentType = "text/javascript";
    record.status = "ok";
  } else {
    process.stdout.write(`GET ${record.url.href}\n`);
    let response;
    try {
      response = await fetch(record.url, {
        redirect: "follow",
        headers: { "user-agent": "ThreeBrowserRuntime Site Puller/0.1" },
      });
    } catch (error) {
      record.status = `network error: ${error.cause?.code || error.message}`;
      console.warn(`  skipped (${record.status})`);
      return;
    }
    if (!response.ok) {
      record.status = `HTTP ${response.status}`;
      console.warn(`  skipped (${record.status})`);
      return;
    }
    const responseContentType = response.headers.get("content-type") || "";
    if (record !== rootRecord && record.hint !== "html" && /text\/html/i.test(responseContentType)) {
      record.status = "unexpected HTML response for asset";
      console.warn(`  skipped (${record.status})`);
      return;
    }
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maximumFileBytes) throw new Error(`File exceeds 64 MB: ${record.url.href}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumFileBytes) throw new Error(`File exceeds 64 MB: ${record.url.href}`);
    totalBytes += bytes.length;
    if (totalBytes > maximumTotalBytes) throw new Error("Site exceeded the 768 MB safety limit.");
    record.content = bytes;
    record.contentType = responseContentType;
    record.status = "ok";
    if (response.url !== record.url.href && record === rootRecord) {
      // Keep the requested query string even when the host redirects to a
      // bare document path. Apps such as `?tile=nyc` read location.search.
      rootURL = new URL(response.url);
    }
  }

  if (!record.localPath) record.localPath = localPathFor(record.url, record.contentType, record.hint);
  const text = record.content.toString("utf8");
  if (moduleLike(record.url, record.contentType, record.hint)) inspectJavaScript(record, text);
  else if (styleLike(record.url, record.contentType, record.hint)) inspectCss(record, text);
  else if (record === rootRecord) inspectHtml(record, text);
}

function relativeSpecifier(fromRecord, toRecord, documentRelative = false) {
  if (documentRelative) {
    let relative = path.relative(path.dirname(rootRecord.localPath), toRecord.localPath).replaceAll("\\", "/");
    if (!relative.startsWith(".")) relative = `./${relative}`;
    return relative;
  }
  let relative = path.relative(path.dirname(fromRecord.localPath), toRecord.localPath).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative;
}

function rewriteText(record, source) {
  const uniqueReferences = new Map();
  for (const reference of record.references) {
    const existing = uniqueReferences.get(reference.value);
    if (!existing || (existing.documentRelative && !reference.documentRelative)) {
      uniqueReferences.set(reference.value, reference);
    }
  }
  const replacements = [...uniqueReferences.values()]
    .map(reference => ({ ...reference, targetRecord: records.get(reference.target) }))
    .filter(reference => reference.targetRecord?.status === "ok" && !reference.preserveSpecifier)
    .sort((a, b) => b.value.length - a.value.length);
  let result = source;
  for (const reference of replacements) {
    const replacement = relativeSpecifier(record, reference.targetRecord, reference.documentRelative);
    const escaped = reference.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`(["'\x60])${escaped}\\1`, "g"), (_match, quote) => `${quote}${replacement}${quote}`);
    result = result.replace(new RegExp(`(sourceMappingURL\\s*=\\s*)${escaped}(?=\\s|$)`, "g"), `$1${replacement}`);
  }
  return result;
}

function safeSourcePath(source, index) {
  const normalized = source.replace(/^webpack:\/\//, "").replace(/^vite:\/\//, "").replaceAll("\\", "/");
  const pieces = normalized.split("/").filter(piece => piece && piece !== "." && piece !== "..").map(cleanSegment);
  return pieces.length ? path.join(...pieces) : `source-${index}.js`;
}

function unpackSourceMap(record) {
  if (!sourceMapLike(record.url, record.contentType, record.hint) || !record.content) return [];
  try {
    const map = JSON.parse(record.content.toString("utf8"));
    if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)) return [];
    const unpacked = [];
    for (let index = 0; index < map.sources.length; ++index) {
      const content = map.sourcesContent[index];
      if (typeof content !== "string") continue;
      const source = String(map.sources[index]);
      const threeIndex = source.replaceAll("\\", "/").toLowerCase().indexOf("node_modules/three/");
      const relative = threeIndex >= 0
        ? path.join("unpacked", "three", safeSourcePath(source.slice(threeIndex + "node_modules/three/".length), index))
        : path.join("unpacked", "sources", safeSourcePath(source, index));
      const target = path.join(destination, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content.replaceAll("\r\n", "\n"));
      unpacked.push(relative.replaceAll("\\", "/"));
      if (threeIndex >= 0) findings.add(`Three.js source map unpacked from ${record.localPath}`);
    }
    return unpacked;
  } catch {
    return [];
  }
}

const rootRecord = enqueue(startURL, "html");
for (let cursor = 0; cursor < queue.length; ++cursor) {
  await fetchRecord(queue[cursor]);
}

const successful = [...records.values()].filter(record => record.status === "ok");
for (const record of successful) {
  const target = path.join(destination, record.localPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const binaryContent = /(?:application\/wasm|octet-stream|model\/gltf-binary|image\/|audio\/|video\/)/i.test(record.contentType);
  const isText = !binaryContent && (moduleLike(record.url, record.contentType, record.hint) || styleLike(record.url, record.contentType, record.hint) ||
    sourceMapLike(record.url, record.contentType, record.hint) || /(?:text|json|xml|svg)/i.test(record.contentType) ||
    /\.html?$/i.test(record.url.pathname));
  if (isText) {
    let output = rewriteText(record, record.content.toString("utf8")).replaceAll("\r\n", "\n");
    // A production WebGPU bundle is already a complete, internally versioned
    // Three.js runtime. Relinking its structural types to the native WebGL
    // facade mixes two Three.js revisions (notably Texture/Source) and breaks
    // WebGPU post-processing. Keep that bundle intact; navigator.gpu is the
    // native boundary for WebGPU projects.
    if (moduleLike(record.url, record.contentType, record.hint) &&
        hasThreeRuntimeCode && hasWebGlRenderer && !hasWebGpuRenderer) {
      let relinked = relinkViteChunk(output, record.localPath);
      if (!relinked.changed) relinked = relinkLegacyThreeBundle(output, record.localPath);
      if (relinked.changed) {
        output = relinked.source;
        relinkedFiles.push({
          path: record.localPath.replaceAll("\\", "/"),
          renderers: relinked.renderers,
          types: relinked.types,
        });
        findings.add(`Native WebGLRenderer relinked in ${record.localPath}`);
      }
    }
    fs.writeFileSync(target, output);
  } else {
    fs.writeFileSync(target, record.content);
  }
}

const unpackedSources = successful.flatMap(unpackSourceMap);
const rootModules = (rootRecord.moduleEntries || [])
  .map(url => records.get(url))
  .filter(record => record?.status === "ok");
for (const url of rootRecord.inlineModules || []) {
  const record = records.get(url);
  if (record?.status === "ok" && !rootModules.includes(record)) rootModules.push(record);
}
const rootClassicScripts = (rootRecord.classicEntries || [])
  .map(url => records.get(url))
  .filter(record => record?.status === "ok");

const requestedSearch = startURL.search;
const requestedSearchParams = Object.fromEntries(startURL.searchParams.entries());
const resolvedSource = rootURL.href;
const sourceURL = startURL.href;

const entryLines = [
  `// Generated by ThreeBrowserRuntime pull from ${sourceURL}`,
  `globalThis.__threeBrowserSourceURL = ${JSON.stringify(sourceURL)};`,
  `globalThis.__threeBrowserSearch = ${JSON.stringify(requestedSearch)};`,
  `globalThis.__threeBrowserSearchParams = ${JSON.stringify(requestedSearchParams)};`,
  ...(threeSourceRevisions.size
    ? [
        `globalThis.__threeBrowserSourceRevisions = ${JSON.stringify([...threeSourceRevisions].sort((a, b) => a - b))};`,
        `globalThis.__threeBrowserSourceRevision = ${Math.max(...threeSourceRevisions)};`,
      ]
    : []),
  ...(rootRecord.htmlElements || []).map(element =>
    `{ const element = document.createElement(${JSON.stringify(element.tag)}); element.id = ${JSON.stringify(element.id)}; document.body.appendChild(element); }`),
  ...(rootRecord.inlineScripts || []).map(script => `(0, eval)(${JSON.stringify(script)});`),
  ...(rootClassicScripts.length ? [`const { readFileSync: __threeBrowserReadFile } = await import("node:fs");`] : []),
  ...rootClassicScripts.map(record =>
    `{ const __threeBrowserScript = document.createElement("script"); __threeBrowserScript.src = ${JSON.stringify(record.url.href)}; document.head.appendChild(__threeBrowserScript); (0, eval)(__threeBrowserReadFile(new URL(${JSON.stringify(`./${record.localPath.replaceAll("\\", "/")}`)}, import.meta.url), "utf8")); }`),
  ...rootModules.map(record => `await import(${JSON.stringify(`./${record.localPath.replaceAll("\\", "/")}`)});`),
  "",
];
fs.writeFileSync(path.join(destination, "site-entry.mjs"), entryLines.join("\n"));

const threeMode = !hasThreeRuntimeCode ? "not-detected" :
  relinkedFiles.length ? "relinked" : hasInterceptableThreeImport ? "importable" : "bundled";
const uiMode = uiSignals.has("React UI") || uiSignals.has("scroll-driven UI") || uiSignals.has("form controls")
  ? "dom-required"
  : visibleHtmlTags.size || uiSignals.size ? "html-overlay" : "canvas-only";
const compatibilityNotes = [];
if (threeMode === "bundled") compatibilityNotes.push("Three.js is embedded in a production bundle and no safe native renderer binding was found.");
if (threeMode === "relinked") compatibilityNotes.push("Semantic Three.js scene, camera, geometry, material, texture, light, mesh, and WebGLRenderer bindings were redirected to the native facade.");
if (usesWebGpuRenderer || importMapEntries.has("three/webgpu") || importMapEntries.has("three/tsl")) {
  compatibilityNotes.push("The bundled Three.js runtime was preserved as one version; WebGPU commands are redirected through the native navigator.gpu adapter.");
}
if (uiMode !== "canvas-only") compatibilityNotes.push("The native runtime does not paint arbitrary HTML/CSS, so visible browser UI will be missing.");
if (hasMinifiedCode) {
  compatibilityNotes.push("A minified production JavaScript bundle was detected. Native launch can relink recognizable Three.js types, but stock WebGL internals stay opaque.");
}

const projectId = crypto.createHash("sha256").update(sourceURL).digest("hex").slice(0, 16);
const virtualURL = `https://${projectId}.runtime.threebrowser.local/`;

const manifest = {
  format: 2,
  projectId,
  virtualURL,
  source: sourceURL,
  resolved: resolvedSource,
  search: requestedSearch,
  searchParams: requestedSearchParams,
  pulledAt: new Date().toISOString(),
  entry: "site-entry.mjs",
  requiresWebGPU: usesWebGpuRenderer || importMapEntries.has("three/webgpu") || importMapEntries.has("three/tsl"),
  html: rootRecord.localPath.replaceAll("\\", "/"),
  files: successful.map(record => ({
    url: record.url.href,
    path: record.localPath.replaceAll("\\", "/"),
    type: record.hint,
    bytes: record.content.length,
  })),
  findings: [...findings],
  compatibility: {
    vite: hasViteRuntime,
    minified: hasMinifiedCode,
    minifySignals: [...minifySignals].sort(),
    threeMode,
    rendererCandidates: [
      usesWebGlRenderer ? "webgl" : null,
      usesWebGpuRenderer || importMapEntries.has("three/webgpu") || importMapEntries.has("three/tsl") ? "webgpu" : null,
    ].filter(Boolean),
    uiMode,
    visibleHtmlTags: [...visibleHtmlTags].sort(),
    uiSignals: [...uiSignals].sort(),
    relinkedFiles,
    threeSourceRevisions: [...threeSourceRevisions].sort((a, b) => a - b),
    notes: compatibilityNotes,
  },
  unpackedSources,
};
fs.writeFileSync(path.join(destination, "threebrowser.pull.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nPulled ${successful.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) into ${destination}`);
console.log(`Entry: ${path.join(destination, "site-entry.mjs")}`);
console.log(`Virtual URL: ${virtualURL}`);
for (const finding of findings) console.log(`Detected: ${finding}`);
if (!findings.size) console.log("Detected: no explicit Vite or Three.js signature (the preserved module graph can still be launched). ");
console.log(`Compatibility: Three.js ${threeMode}; UI ${uiMode}${hasMinifiedCode ? "; minified" : ""}`);
for (const note of compatibilityNotes) console.log(`  warning: ${note}`);
