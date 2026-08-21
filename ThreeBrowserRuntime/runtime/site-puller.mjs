import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

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

function resolveReference(value, baseURL, allowAssetLiteral = false) {
  if (!value || !isFetchable(value)) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//") || value.startsWith("/") ||
      value.startsWith("./") || value.startsWith("../")) {
    try { return new URL(value, baseURL); } catch { return null; }
  }
  if (importMapEntries.has(value)) return new URL(importMapEntries.get(value));
  const prefix = [...importMapEntries.keys()]
    .filter(key => key.endsWith("/") && value.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return new URL(`${importMapEntries.get(prefix)}${value.slice(prefix.length)}`);
  if (allowAssetLiteral && /[\\/].+\.(?:m?js|css|wasm|json|glsl|vert|frag|wgsl|png|jpe?g|webp|gif|svg|hdr|exr|gltf|glb|bin)(?:[?#].*)?$/i.test(value)) {
    try { return new URL(value, rootURL); } catch { return null; }
  }
  return null;
}

function hintFor(value, fallback = "asset") {
  if (/\.map(?:[?#].*)?$/i.test(value)) return "map";
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

function collectReference(record, value, hint = "asset", allowAssetLiteral = false) {
  const resolved = resolveReference(value, record.url, allowAssetLiteral);
  if (!resolved || !new Set(["http:", "https:"]).has(resolved.protocol)) return;
  const dependency = enqueue(resolved, hintFor(value, hint), record.url.href);
  record.references.push({
    value,
    target: dependency.url.href,
    preserveSpecifier: value === "three",
    documentRelative: allowAssetLiteral,
  });
}

function inspectJavaScript(record, source) {
  if (/\b__vite__|vitePreload|__vitePreload/.test(source)) findings.add("Vite runtime detected");
  if (/\bWebGLRenderer\b|\bWebGPURenderer\b|THREE\.REVISION|REVISION\s*=\s*["']\d+/i.test(source)) {
    findings.add(`Three.js code detected in ${record.localPath}`);
  }

  const modulePatterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of modulePatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      if (value === "three" || value.startsWith("three/")) findings.add(`Three.js import: ${value}`);
      collectReference(record, value, "module");
    }
  }
  for (const match of source.matchAll(/\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)) {
    collectReference(record, match[1], "asset");
  }

  const assetSource = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const assetStrings = /["']([^"'\\\r\n]+\.(?:m?js|css|wasm|json|glsl|vert|frag|wgsl|png|jpe?g|webp|gif|svg|hdr|exr|gltf|glb|bin)(?:[?#][^"']*)?)["']/gi;
  for (const match of assetSource.matchAll(assetStrings)) collectReference(record, match[1], "asset", true);
  const sourceMap = /\/\/[#@]\s*sourceMappingURL\s*=\s*([^\s]+)/g;
  for (const match of source.matchAll(sourceMap)) collectReference(record, match[1], "map");
}

function inspectCss(record, source) {
  for (const match of source.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)|url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    collectReference(record, match[1] || match[2], "asset");
  }
}

function inspectHtml(record, source) {
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
    if (src) collectReference(record, src, type === "module" ? "module" : "asset");
    else if (type === "module" && match[2].trim()) {
      const inlineURL = new URL(`./__inline__/entry-${++inlineIndex}.mjs`, record.url);
      const inline = enqueue(inlineURL, "module", record.url.href);
      inline.virtualSource = match[2];
      inline.localPath = path.join("__inline__", `entry-${inlineIndex}.mjs`);
      record.inlineModules ??= [];
      record.inlineModules.push(inline.url.href);
    }
  }
  for (const match of source.matchAll(/<(?:link|img|source|video|audio)\b[^>]*?\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const tag = match[0];
    const hint = /rel\s*=\s*["']modulepreload["']/i.test(tag) ? "module" :
      /rel\s*=\s*["']stylesheet["']/i.test(tag) ? "style" : "asset";
    collectReference(record, match[1], hint);
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
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > maximumFileBytes) throw new Error(`File exceeds 64 MB: ${record.url.href}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumFileBytes) throw new Error(`File exceeds 64 MB: ${record.url.href}`);
    totalBytes += bytes.length;
    if (totalBytes > maximumTotalBytes) throw new Error("Site exceeded the 768 MB safety limit.");
    record.content = bytes;
    record.contentType = response.headers.get("content-type") || "";
    record.status = "ok";
    if (response.url !== record.url.href && record === rootRecord) rootURL = new URL(response.url);
  }

  if (!record.localPath) record.localPath = localPathFor(record.url, record.contentType, record.hint);
  const text = record.content.toString("utf8");
  if (moduleLike(record.url, record.contentType, record.hint)) inspectJavaScript(record, text);
  else if (styleLike(record.url, record.contentType, record.hint)) inspectCss(record, text);
  else if (/text\/html/i.test(record.contentType) || /\.html?$/i.test(record.url.pathname)) inspectHtml(record, text);
}

function relativeSpecifier(fromRecord, toRecord, documentRelative = false) {
  if (documentRelative) return `./${toRecord.localPath.replaceAll("\\", "/")}`;
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
    result = result.replace(new RegExp(`(["'])${escaped}\\1`, "g"), (_match, quote) => `${quote}${replacement}${quote}`);
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
  fs.writeFileSync(target, isText ? rewriteText(record, record.content.toString("utf8")).replaceAll("\r\n", "\n") : record.content);
}

const unpackedSources = successful.flatMap(unpackSourceMap);
const rootModules = (rootRecord.references || [])
  .filter(reference => records.get(reference.target)?.hint === "module")
  .map(reference => records.get(reference.target))
  .filter(record => record?.status === "ok");
for (const url of rootRecord.inlineModules || []) {
  const record = records.get(url);
  if (record?.status === "ok" && !rootModules.includes(record)) rootModules.push(record);
}

const entryLines = [
  `// Generated by ThreeBrowserRuntime pull from ${rootURL.href}`,
  `globalThis.__threeBrowserSourceURL = ${JSON.stringify(rootURL.href)};`,
  ...(rootRecord.htmlElements || []).map(element =>
    `{ const element = document.createElement(${JSON.stringify(element.tag)}); element.id = ${JSON.stringify(element.id)}; document.body.appendChild(element); }`),
  ...rootModules.map(record => `await import(${JSON.stringify(`./${record.localPath.replaceAll("\\", "/")}`)});`),
  "",
];
fs.writeFileSync(path.join(destination, "site-entry.mjs"), entryLines.join("\n"));

const manifest = {
  format: 1,
  source: rootURL.href,
  pulledAt: new Date().toISOString(),
  entry: "site-entry.mjs",
  requiresWebGPU: importMapEntries.has("three/webgpu") || importMapEntries.has("three/tsl"),
  html: rootRecord.localPath.replaceAll("\\", "/"),
  files: successful.map(record => ({
    url: record.url.href,
    path: record.localPath.replaceAll("\\", "/"),
    type: record.hint,
    bytes: record.content.length,
  })),
  findings: [...findings],
  unpackedSources,
};
fs.writeFileSync(path.join(destination, "threebrowser.pull.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nPulled ${successful.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) into ${destination}`);
console.log(`Entry: ${path.join(destination, "site-entry.mjs")}`);
for (const finding of findings) console.log(`Detected: ${finding}`);
if (!findings.size) console.log("Detected: no explicit Vite or Three.js signature (the preserved module graph can still be launched). ");
