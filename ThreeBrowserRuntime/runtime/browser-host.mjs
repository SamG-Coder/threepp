import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { configureModuleDocument, configureModuleFile } from "./module-loader.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addonPath = process.env.THREEBROWSER_RUNTIME_ADDON || path.join(here, "..", "three_browser_runtime.node");
export const native = require(addonPath);

class BrowserEventTarget extends EventTarget {}

class Element extends BrowserEventTarget {
  constructor(tagName) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.style = {
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] ?? ""; },
      removeProperty(name) { const value = this[name] ?? ""; delete this[name]; return value; },
    };
    this.dataset = {};
    this.children = [];
    this.parentNode = null;
    Object.defineProperties(this, {
      childNodes: { get: () => this.children },
      parentElement: { get: () => this.parentNode },
      firstChild: { get: () => this.children[0] ?? null },
      lastChild: { get: () => this.children.at(-1) ?? null },
    });
    this.ownerDocument = globalThis.document ?? null;
    this.textContent = "";
    this.id = "";
    this.clientWidth = 0;
    this.clientHeight = 0;
    Object.defineProperties(this, {
      offsetWidth: { get: () => this.clientWidth || Number.parseFloat(this.style.width) || 0 },
      offsetHeight: { get: () => this.clientHeight || Number.parseFloat(this.style.height) || 0 },
    });
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? (classes.delete(name), false) : (classes.add(name), true)) : (force ? (classes.add(name), true) : (classes.delete(name), false)),
    };
    Object.defineProperty(this, "className", {
      get: () => [...classes].join(" "),
      set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); },
    });
    this._innerHTML = "";
  }
  appendChild(child) {
    if (typeof child !== "object" || child === null) {
      const text = new Element("#text");
      text.textContent = String(child);
      child = text;
    }
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument ??= this.ownerDocument || globalThis.document || null;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  prepend(...children) {
    for (const child of children.reverse()) {
      const node = typeof child === "object" && child !== null ? child : Object.assign(new Element("#text"), { textContent: String(child) });
      if (node.parentNode) node.parentNode.removeChild(node);
      node.parentNode = this;
      node.ownerDocument ??= this.ownerDocument || globalThis.document || null;
      this.children.unshift(node);
    }
  }
  insertBefore(child, reference) {
    if (reference == null) return this.appendChild(child);
    const index = this.children.indexOf(reference);
    if (index < 0) throw new Error("Reference node is not a child");
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    child.ownerDocument ??= this.ownerDocument || globalThis.document || null;
    this.children.splice(index, 0, child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) {
    const normalized = String(name).toLowerCase();
    if (normalized === "class") this.className = value;
    else if (normalized === "style") {
      for (const declaration of String(value).split(";")) {
        const separator = declaration.indexOf(":");
        if (separator > 0) this.style.setProperty(declaration.slice(0, separator).trim(), declaration.slice(separator + 1).trim());
      }
    } else if (normalized.startsWith("data-")) {
      const key = normalized.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      this.dataset[key] = String(value);
    } else this[name] = String(value);
  }
  getAttribute(name) { return this[name] ?? null; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children.length = 0;
    const stack = [this];
    for (const match of this._innerHTML.matchAll(/<\s*(\/)?\s*([a-zA-Z][\w:-]*)([^>]*)>/g)) {
      const closing = Boolean(match[1]);
      const tag = match[2].toLowerCase();
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const element = this.ownerDocument?.createElementNS?.("http://www.w3.org/2000/svg", tag) ?? new Element(tag);
      for (const attribute of match[3].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        element.setAttribute(attribute[1], attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
      }
      stack.at(-1).appendChild(element);
      if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr|path|line|polyline|rect|circle)$/i.test(tag) && !/\/\s*$/.test(match[3])) stack.push(element);
    }
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    let token = String(selector).trim().split(/\s+|\s*>\s*/).filter(Boolean).at(-1) || "*";
    token = token.replace(/^:scope$/, "*");
    const notClasses = [...token.matchAll(/:not\(\.([\w-]+)\)/g)].map(match => match[1]);
    const firstChild = token.includes(":first-child");
    token = token.replace(/:[\w-]+(?:\([^)]*\))?/g, "");
    const attribute = /\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/.exec(token);
    token = token.replace(/\[[^\]]+\]/g, "");
    const id = /#([\w-]+)/.exec(token)?.[1];
    const classNames = [...token.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
    const tag = /^([a-zA-Z][\w-]*|\*)/.exec(token)?.[1]?.toUpperCase();
    const matches = element => (!tag || tag === "*" || element.tagName === tag) &&
      (!id || element.id === id) && classNames.every(name => element.classList.contains(name)) &&
      notClasses.every(name => !element.classList.contains(name)) &&
      (!attribute || (element.getAttribute(attribute[1]) !== null && (attribute[2] === undefined || element.getAttribute(attribute[1]) === attribute[2]))) &&
      (!firstChild || element.parentNode?.children[0] === element);
    const result = [];
    const walk = node => {
      for (const child of node.children) {
        if (matches(child)) result.push(child);
        walk(child);
      }
    };
    walk(this);
    return result;
  }
  getRootNode() { return this.ownerDocument || document; }
  contains(node) { return node === this || this.children.some(child => child.contains?.(node)); }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      const holder = new Element("holder");
      holder.children = [node];
      if (holder.querySelector(selector) === node) return node;
    }
    return null;
  }
  cloneNode(deep = false) {
    const clone = new Element(this.tagName);
    clone.id = this.id;
    clone.className = this.className;
    clone.textContent = this.textContent;
    Object.assign(clone.style, this.style);
    if (deep) for (const child of this.children) clone.appendChild(child.cloneNode?.(true) ?? child);
    return clone;
  }
  replaceWith(replacement) {
    if (!this.parentNode) return;
    const index = this.parentNode.children.indexOf(this);
    if (index >= 0) {
      replacement.parentNode = this.parentNode;
      this.parentNode.children[index] = replacement;
      this.parentNode = null;
    }
  }
  click() { this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true })); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  requestPointerLock() { return requestNativePointerLock(this); }
}

class Canvas2DContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#000";
    this.strokeStyle = "#000";
    this.font = "10px sans-serif";
    this.textAlign = "start";
    this.textBaseline = "alphabetic";
    this.globalAlpha = 1;
    this.lineWidth = 1;
  }
  measureText(text) { return { width: String(text).length * 7 }; }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  createPattern() { return null; }
  createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; }
  getImageData(x, y, width, height) {
    const result = this.createImageData(width, height);
    if (!this.pixels) return result;
    const sourceWidth = this.canvas.width;
    const sourceHeight = this.canvas.height;
    if (x === 0 && y === 0 && width === sourceWidth && height === sourceHeight) {
      result.data.set(this.pixels);
      return result;
    }
    for (let row = 0; row < height; ++row) {
      if (y + row < 0 || y + row >= sourceHeight) continue;
      const sourceOffset = ((y + row) * sourceWidth + Math.max(0, x)) * 4;
      const destinationOffset = (row * width + Math.max(0, -x)) * 4;
      const copyWidth = Math.max(0, Math.min(width - Math.max(0, -x), sourceWidth - Math.max(0, x)));
      result.data.set(this.pixels.subarray(sourceOffset, sourceOffset + copyWidth * 4), destinationOffset);
    }
    return result;
  }
  putImageData() {}
  save() {}
  restore() {}
  scale() {}
  rotate() {}
  translate() {}
  transform() {}
  setTransform() {}
  resetTransform() {}
  clearRect() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  arcTo() {}
  rect() {}
  fill() {}
  stroke() {}
  clip() {}
  fillText() {}
  strokeText() {}
  drawImage(image, ...args) {
    const source = image?.data || image?.pixels;
    const sourceWidth = image?.width || image?.naturalWidth || 0;
    const sourceHeight = image?.height || image?.naturalHeight || 0;
    if (!source || !sourceWidth || !sourceHeight) return;
    let sourceX = 0, sourceY = 0, sourceDrawWidth = sourceWidth, sourceDrawHeight = sourceHeight;
    let destinationX = 0, destinationY = 0, destinationWidth = sourceWidth, destinationHeight = sourceHeight;
    if (args.length >= 2) [destinationX, destinationY] = args;
    if (args.length >= 4) [destinationX, destinationY, destinationWidth, destinationHeight] = args;
    if (args.length >= 8) {
      [sourceX, sourceY, sourceDrawWidth, sourceDrawHeight, destinationX, destinationY, destinationWidth, destinationHeight] = args;
    }
    const canvasWidth = this.canvas.width;
    const canvasHeight = this.canvas.height;
    if (!this.pixels || this.pixels.length !== canvasWidth * canvasHeight * 4) {
      this.pixels = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);
    }
    if (sourceX === 0 && sourceY === 0 && destinationX === 0 && destinationY === 0 &&
        sourceDrawWidth === sourceWidth && sourceDrawHeight === sourceHeight &&
        destinationWidth === sourceWidth && destinationHeight === sourceHeight &&
        canvasWidth === sourceWidth && canvasHeight === sourceHeight) {
      this.pixels.set(source);
      return;
    }
    for (let y = 0; y < destinationHeight; ++y) {
      const targetY = destinationY + y;
      if (targetY < 0 || targetY >= canvasHeight) continue;
      const sampleY = Math.min(sourceHeight - 1, Math.max(0, sourceY + Math.floor(y * sourceDrawHeight / destinationHeight)));
      for (let x = 0; x < destinationWidth; ++x) {
        const targetX = destinationX + x;
        if (targetX < 0 || targetX >= canvasWidth) continue;
        const sampleX = Math.min(sourceWidth - 1, Math.max(0, sourceX + Math.floor(x * sourceDrawWidth / destinationWidth)));
        const sourceOffset = (sampleY * sourceWidth + sampleX) * 4;
        const targetOffset = (targetY * canvasWidth + targetX) * 4;
        this.pixels.set(source.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }
  setLineDash() {}
}

class CanvasElement extends Element {
  constructor() {
    super("canvas");
    this.width = 1280;
    this.height = 720;
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.tabIndex = 0;
    this.context2d = null;
  }
  focus() { document.activeElement = this; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
      width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext(type) {
    if (String(type).toLowerCase() === "2d") return this.context2d ??= new Canvas2DContext(this);
    return null;
  }
}

function encodedImageSize(bytes) {
  if (bytes.length >= 10 && bytes.subarray(0, 3).toString() === "GIF") {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.subarray(1, 4).toString() === "PNG") {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]).has(marker)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      if (length < 2) break;
      offset += length + 2;
    }
  }
  return { width: 1, height: 1 };
}

class ImageElement extends Element {
  constructor() {
    super("img");
    this.crossOrigin = null;
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.width = 0;
    this.height = 0;
    this.onload = null;
    this.onerror = null;
    this._src = "";
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    queueMicrotask(async () => {
      try {
        const response = await globalThis.fetch(this._src);
        if (!response.ok) throw new Error(`Image responded with ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const decoded = native.decodeImage(bytes);
        const size = decoded || encodedImageSize(bytes);
        this.naturalWidth = this.width = size.width;
        this.naturalHeight = this.height = size.height;
        this.data = decoded?.pixels;
        this.complete = true;
        const event = new Event("load");
        this.dispatchEvent(event);
        this.onload?.(event);
      } catch (error) {
        this.complete = true;
        const event = eventWith("error", { error, message: error.message });
        this.dispatchEvent(event);
        this.onerror?.(event);
      }
    });
  }
}

const body = new Element("body");
const head = new Element("head");
const documentTarget = new BrowserEventTarget();
export const document = Object.assign(documentTarget, {
  body,
  head,
  documentElement: new Element("html"),
  activeElement: null,
  visibilityState: "visible",
  hidden: false,
  pointerLockElement: null,
  createElement(tag) {
    const name = String(tag).toLowerCase();
    return name === "canvas" ? new CanvasElement() : name === "img" ? new ImageElement() : new Element(tag);
  },
  createElementNS(_namespace, tag) { return this.createElement(tag); },
  createTextNode(value) { const node = new Element("#text"); node.textContent = String(value); return node; },
  createDocumentFragment() { const fragment = new Element("#document-fragment"); fragment.ownerDocument = this; return fragment; },
  getElementById(id) {
    const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean);
    return walk(body) || walk(head) || null;
  },
  querySelector(selector) {
    if (selector === "canvas") return currentCanvas;
    return null;
  },
  exitPointerLock() { releaseNativePointerLock(); },
});
body.ownerDocument = document;
head.ownerDocument = document;
document.documentElement.ownerDocument = document;

function requestNativePointerLock(element) {
  if (native.overlayOpen?.()) native.setOverlay(false);
  if (!native.setPointerLock(true)) {
    document.dispatchEvent(new Event("pointerlockerror"));
    return Promise.reject(new Error("Pointer lock could not be acquired"));
  }
  document.pointerLockElement = element;
  document.dispatchEvent(new Event("pointerlockchange"));
  return Promise.resolve();
}

function releaseNativePointerLock(fromHost = false) {
  if (!fromHost) native.setPointerLock(false);
  if (!document.pointerLockElement) return;
  document.pointerLockElement = null;
  document.dispatchEvent(new Event("pointerlockchange"));
}

let currentCanvas = null;
const originalCreateElement = document.createElement.bind(document);
document.createElement = tag => {
  const result = originalCreateElement(tag);
  if (result instanceof CanvasElement) currentCanvas = result;
  return result;
};

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = document;
Object.defineProperty(globalThis, "navigator", {
  value: { userAgent: "ThreeBrowserRuntime/0.1 V8", platform: process.platform },
  configurable: true,
});
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
globalThis.__threeBrowserNativeRuntime = true;
globalThis.__TN_SHARED = new ArrayBuffer(8 * 1024 * 1024);
globalThis.Node = Element;
globalThis.Element = Element;
globalThis.HTMLElement = Element;
globalThis.HTMLCanvasElement = CanvasElement;
globalThis.CanvasRenderingContext2D = Canvas2DContext;
globalThis.HTMLImageElement = ImageElement;
globalThis.Image = ImageElement;
globalThis.createImageBitmap = async source => {
  const bytes = source instanceof Blob ? Buffer.from(await source.arrayBuffer()) : Buffer.from(source);
  const decoded = native.decodeImage(bytes);
  if (!decoded) throw new Error("Unsupported encoded image");
  return { width: decoded.width, height: decoded.height, data: decoded.pixels, close() {} };
};

globalThis.DOMParser = class {
  parseFromString(source) {
    const xml = String(source);
    return {
      getElementsByTagName(name) {
        const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const nodes = [];
        for (const match of xml.matchAll(new RegExp(`<${escaped}\\b([^>]*)>`, "gi"))) {
          const attributes = new Map();
          for (const attribute of match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attributes.set(attribute[1], attribute[2] ?? attribute[3] ?? "");
          }
          nodes.push({ getAttribute: attribute => attributes.get(String(attribute)) ?? null });
        }
        return nodes;
      },
    };
  }
};

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.getComputedStyle = element => element?.style ?? { getPropertyValue: () => "" };
globalThis.matchMedia = query => ({ matches: false, media: String(query), onchange: null, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; } observe() {} unobserve() {} disconnect() {} };
globalThis.MutationObserver = class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} takeRecords() { return []; } };

const activeWorkers = new Set();
class BrowserWorker extends BrowserEventTarget {
  constructor(url, options = {}) {
    super();
    this.url = new URL(String(url), globalThis.location?.href);
    this.options = options;
    this.onmessage = null;
    this.onerror = null;
    this.onmessageerror = null;
    this.worker = null;
    this.pending = [];
    this.closed = false;
    activeWorkers.add(this);
    this.initialize();
  }
  async initialize() {
    try {
      const response = await globalThis.fetch(this.url);
      if (!response.ok) throw new Error(`Worker responded with ${response.status}`);
      const source = await response.text();
      const wrapper = `
        const { parentPort, workerData } = require('node:worker_threads');
        globalThis.self = globalThis;
        const listeners = new Map();
        globalThis.addEventListener = (type, listener) => {
          const list = listeners.get(type) || [];
          list.push(listener);
          listeners.set(type, list);
        };
        globalThis.removeEventListener = (type, listener) => {
          const list = listeners.get(type) || [];
          listeners.set(type, list.filter(item => item !== listener));
        };
        globalThis.postMessage = (value, transfer) => parentPort.postMessage(value, transfer);
        globalThis.close = () => process.exit(0);
        globalThis.importScripts = () => { throw new Error('importScripts requires an unpacked worker dependency'); };
        parentPort.on('message', data => {
          const event = { data };
          if (typeof globalThis.onmessage === 'function') globalThis.onmessage(event);
          for (const listener of listeners.get('message') || []) listener(event);
        });
        eval(workerData.source);
      `;
      if (this.closed) return;
      this.worker = new NodeWorker(wrapper, { eval: true, workerData: { source, url: this.url.href } });
      this.worker.on("message", data => {
        const event = eventWith("message", { data });
        this.dispatchEvent(event);
        this.onmessage?.(event);
      });
      this.worker.on("messageerror", error => {
        const event = eventWith("messageerror", { error });
        this.dispatchEvent(event);
        this.onmessageerror?.(event);
      });
      this.worker.on("error", error => {
        const event = eventWith("error", { error, message: error.message });
        this.dispatchEvent(event);
        this.onerror?.(event);
      });
      this.worker.on("exit", () => activeWorkers.delete(this));
      for (const [message, transfer] of this.pending) this.worker.postMessage(message, transfer);
      this.pending.length = 0;
    } catch (error) {
      activeWorkers.delete(this);
      const event = eventWith("error", { error, message: error.message });
      this.dispatchEvent(event);
      this.onerror?.(event);
    }
  }
  postMessage(message, transfer = []) {
    if (this.closed) return;
    if (this.worker) this.worker.postMessage(message, transfer);
    else this.pending.push([message, transfer]);
  }
  terminate() {
    this.closed = true;
    this.pending.length = 0;
    activeWorkers.delete(this);
    return this.worker?.terminate();
  }
}
globalThis.Worker = BrowserWorker;
globalThis.OffscreenCanvas = CanvasElement;

const platformFetch = globalThis.fetch.bind(globalThis);
const contentTypes = new Map([
  [".json", "application/json"], [".gltf", "model/gltf+json"], [".glb", "model/gltf-binary"],
  [".bin", "application/octet-stream"], [".wasm", "application/wasm"], [".txt", "text/plain"],
  [".glsl", "text/plain"], [".vert", "text/plain"], [".frag", "text/plain"], [".wgsl", "text/plain"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
]);
globalThis.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  let resolved;
  try { resolved = new URL(raw, globalThis.location?.href); }
  catch { return platformFetch(input, init); }
  if (process.env.THREEBROWSER_TRACE_FETCH) console.error(`ThreeBrowser fetch: ${resolved.href}`);
  if (resolved.protocol !== "file:") return platformFetch(resolved, init);
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") return new Response(null, { status: 405, statusText: "Method Not Allowed" });
  try {
    const fileURL = new URL(resolved);
    fileURL.search = "";
    fileURL.hash = "";
    const filePath = fileURLToPath(fileURL);
    const data = method === "HEAD" ? null : await fs.promises.readFile(filePath);
    return new Response(data, {
      status: 200,
      headers: {
        "content-type": contentTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
        "content-length": String((await fs.promises.stat(filePath)).size),
      },
    });
  } catch (error) {
    if (error?.code === "ENOENT") return new Response(null, { status: 404, statusText: "Not Found" });
    throw error;
  }
};

const windowEvents = new BrowserEventTarget();
globalThis.addEventListener = windowEvents.addEventListener.bind(windowEvents);
globalThis.removeEventListener = windowEvents.removeEventListener.bind(windowEvents);
globalThis.dispatchEvent = windowEvents.dispatchEvent.bind(windowEvents);

const pendingNativeCommands = [];
function submitNativeCommands(data) {
  const copy = data instanceof ArrayBuffer
    ? new Uint8Array(data.slice(0))
    : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  if (!native.isOpen()) {
    pendingNativeCommands.push(copy);
    return true;
  }
  return native.submit(copy);
}

function startNativeRuntime(width, height, title) {
  const started = native.start(width, height, title);
  if (!started) return false;
  for (const commands of pendingNativeCommands.splice(0)) {
    if (!native.submit(commands)) return false;
  }
  return true;
}

function hostObject() {
  return {
    RuntimeStart: startNativeRuntime,
    RuntimeSetSize: (width, height) => native.resize(width, height),
    RuntimeRender: () => 1,
    BackendName: () => native.backendName(),
    LastError: () => native.lastError(),
    CmdSubmit: used => submitNativeCommands(new Uint8Array(globalThis.__TN_SHARED, 0, used)),
    CmdSubmitBuffer: submitNativeCommands,
    RendererSetToneMapping: (mode, exposure) => native.setToneMapping(mode, exposure),
    SceneSetBackgroundTexture: (scene, texture) => native.setSceneBackgroundTexture(scene, texture),
    SceneSetEnvironment: (scene, texture) => native.setSceneEnvironment(scene, texture),
    PmremFromEquirect: (id, texture) => native.pmremFromEquirect(id, texture),
    PmremFromCubemap: (id, texture) => native.pmremFromCubemap(id, texture),
    PmremFromObject: (id, object) => native.pmremFromObject(id, object),
    SlotDestroy: id => native.destroySlot(id),
    RuntimeStartWebGpu: () => 1,
    WebGpuIsNative: () => 1,
    WebGpuSession: () => 1,
    WebGpuCmdSubmit: used => native.webGpuSubmit(globalThis.__TN_SHARED, used),
    WebGpuCmdSubmitSession: used => native.webGpuSubmit(globalThis.__TN_SHARED, used),
    WebGpuMapRead: (handle, offset, size) => native.webGpuMapRead(handle, offset, size),
    WebGpuSetSize: (width, height) => native.resize(width, height),
    WebGpuBackendName: () => native.backendName(),
    WebGpuFrame: () => {},
    EnsureCmdBuffer: () => 1,
  };
}

const webviewEvents = new BrowserEventTarget();
globalThis.chrome = { webview: Object.assign(webviewEvents, { hostObjects: { sync: { native: hostObject() } } }) };

let webGpuEnabled = false;
async function enableWebGPU() {
  if (webGpuEnabled) return;
  if (!native.webGpuStart(globalThis.innerWidth, globalThis.innerHeight)) {
    throw new Error(`Native WebGPU failed to start: ${native.lastError()}`);
  }
  const adapter = await import("./three-webgpu-gpu.js");
  adapter.install();
  webGpuEnabled = true;
}

const frameCallbacks = new Map();
let nextFrameId = 1;
let running = false;
let nextWebGpuFrame = 0;
const webGpuFrameInterval = 1000 / 240;
globalThis.requestAnimationFrame = callback => {
  const id = nextFrameId++;
  frameCallbacks.set(id, callback);
  return id;
};
globalThis.cancelAnimationFrame = id => frameCallbacks.delete(id);

function eventWith(type, properties) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(event, key, { value, enumerable: true });
  }
  return event;
}

function keyName(code) {
  if (code >= 65 && code <= 90) return String.fromCharCode(code).toLowerCase();
  if (code >= 48 && code <= 57) return String.fromCharCode(code);
  return ({ 27: "Escape", 32: " ", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
    9: "Tab", 16: "Shift", 17: "Control", 18: "Alt", 13: "Enter", 114: "F3" })[code] || `Key${code}`;
}

function physicalKeyCode(code) {
  if (code >= 65 && code <= 90) return `Key${String.fromCharCode(code)}`;
  if (code >= 48 && code <= 57) return `Digit${String.fromCharCode(code)}`;
  return ({ 27: "Escape", 32: "Space", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
    9: "Tab", 16: "ShiftLeft", 17: "ControlLeft", 18: "AltLeft", 13: "Enter", 114: "F3" })[code] || `Key${code}`;
}

let mouseButtons = 0;
let lastMouseX = 0;
let lastMouseY = 0;
const pressedKeys = new Set();
let overlayChordActive = false;

function dispatchToCanvasAndWindow(eventFactory) {
  if (currentCanvas) currentCanvas.dispatchEvent(eventFactory());
  windowEvents.dispatchEvent(eventFactory());
}

function dispatchNativeInput() {
  for (const input of native.pollInput()) {
    const target = currentCanvas || windowEvents;
    if (input.type === "pointerlocklost") {
      releaseNativePointerLock(true);
      continue;
    }
    if (input.type === "wheel") {
      if (native.overlayOpen?.()) continue;
      dispatchToCanvasAndWindow(() => eventWith("wheel", {
        clientX: input.x, clientY: input.y, deltaX: 0, deltaY: -input.code, deltaZ: 0, deltaMode: 0,
      }));
      continue;
    }
    if (input.type.startsWith("pointer")) {
      const button = input.code === 1 ? 0 : input.code === 2 ? 2 : 1;
      const bit = button === 0 ? 1 : button === 2 ? 2 : 4;
      if (input.type === "pointerdown") mouseButtons |= bit;
      if (input.type === "pointerup") mouseButtons &= ~bit;
      const movementX = Number.isFinite(input.movementX) ? input.movementX : input.x - lastMouseX;
      const movementY = Number.isFinite(input.movementY) ? input.movementY : input.y - lastMouseY;
      lastMouseX = input.x;
      lastMouseY = input.y;
      if (native.overlayOpen?.()) {
        if (input.type === "pointerup") native.overlayClick(input.x, input.y);
        continue;
      }
      const properties = {
        clientX: input.x, clientY: input.y, offsetX: input.x, offsetY: input.y,
        movementX, movementY, button, buttons: mouseButtons, pointerId: 1,
        pointerType: "mouse", isPrimary: true,
      };
      target.dispatchEvent(eventWith(input.type, properties));
      const mouseType = input.type === "pointermove" ? "mousemove" : input.type === "pointerdown" ? "mousedown" : "mouseup";
      dispatchToCanvasAndWindow(() => eventWith(mouseType, properties));
      if (input.type === "pointerup" && currentCanvas) currentCanvas.dispatchEvent(eventWith("click", properties));
      continue;
    }
    if (input.type === "keydown") pressedKeys.add(input.code);
    const overlayChordDown = pressedKeys.has(9) && pressedKeys.has(16);
    if (overlayChordDown && !overlayChordActive) {
      overlayChordActive = true;
      releaseNativePointerLock();
      native.setOverlay(!native.overlayOpen());
    }
    const consumeOverlayChord = overlayChordActive && (input.code === 9 || input.code === 16);
    if (input.type === "keyup") {
      pressedKeys.delete(input.code);
      if (!pressedKeys.has(9) && !pressedKeys.has(16)) overlayChordActive = false;
    }
    if (consumeOverlayChord) {
      continue;
    }
    if (input.type === "keydown" && input.code === 114) {
      native.toggleFpsOverlay();
      continue;
    }
    if (input.type === "keydown" && input.code === 27) {
      if (document.pointerLockElement) {
        releaseNativePointerLock();
        continue;
      }
      if (native.overlayOpen?.()) {
        native.setOverlay(false);
        continue;
      }
    }
    if (native.overlayOpen?.()) continue;
    const properties = {
      key: keyName(input.code), code: physicalKeyCode(input.code), keyCode: input.code, which: input.code,
      shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, altKey: input.altKey, repeat: false,
    };
    if (document.activeElement) document.activeElement.dispatchEvent(eventWith(input.type, properties));
    windowEvents.dispatchEvent(eventWith(input.type, properties));
  }
}

function syncWindowSize() {
  const state = native.stats();
  if (!state.width || !state.height || (state.width === globalThis.innerWidth && state.height === globalThis.innerHeight)) return;
  globalThis.innerWidth = state.width;
  globalThis.innerHeight = state.height;
  if (currentCanvas) {
    currentCanvas.clientWidth = currentCanvas.width = state.width;
    currentCanvas.clientHeight = currentCanvas.height = state.height;
    currentCanvas.dispatchEvent(new Event("resize"));
  }
  globalThis.dispatchEvent(new Event("resize"));
}

function pump() {
  if (!running) return;
  if (!native.isOpen()) return stop();
  native.waitFrame();
  if (webGpuEnabled) {
    const now = performance.now();
    if (now + 0.15 < nextWebGpuFrame) {
      setTimeout(pump, Math.max(0, nextWebGpuFrame - now));
      return;
    }
    nextWebGpuFrame = Math.max(nextWebGpuFrame + webGpuFrameInterval, now);
  }
  if (webGpuEnabled && native.pressure() > 1) {
    setTimeout(pump, 1);
    return;
  }
  dispatchNativeInput();
  syncWindowSize();
  const callbacks = Array.from(frameCallbacks.values());
  frameCallbacks.clear();
  const timestamp = performance.now();
  for (const callback of callbacks) callback(timestamp);
  setImmediate(pump);
}

export function start() {
  if (running) return;
  running = true;
  setImmediate(pump);
}

export function stop() {
  if (!running && !native.isOpen()) return;
  running = false;
  frameCallbacks.clear();
  for (const worker of activeWorkers) worker.terminate();
  activeWorkers.clear();
  releaseNativePointerLock();
  native.shutdown();
}

export function loadThreeShim(directory = path.join(here, "three")) {
  const files = fs.readdirSync(directory).filter(name => /^\d\d-.*\.js$/.test(name)).sort();
  if (!files.length) throw new Error(`No ThreeBrowser shim slices found in ${directory}`);
  for (const file of files) vm.runInThisContext(fs.readFileSync(path.join(directory, file), "utf8"), { filename: file });
  return globalThis.THREE;
}

export async function loadEntry(entryPath) {
  const absolute = path.resolve(entryPath);
  globalThis.location = new URL(pathToFileURL(absolute));
  if (!absolute.toLowerCase().endsWith(".html")) {
    configureModuleFile(absolute);
    const manifestPath = path.join(path.dirname(absolute), "threebrowser.pull.json");
    if (fs.existsSync(manifestPath)) {
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
      catch (error) { throw new Error(`Invalid pull manifest in ${manifestPath}: ${error.message}`); }
      if (manifest.html) globalThis.location = new URL(pathToFileURL(path.join(path.dirname(absolute), manifest.html)));
      if (manifest.requiresWebGPU) await enableWebGPU();
    }
    return import(pathToFileURL(absolute));
  }
  const html = fs.readFileSync(absolute, "utf8");
  const importMapSource = /<script\s+[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  let importMap = {};
  if (importMapSource) {
    try { importMap = JSON.parse(importMapSource); }
    catch (error) { throw new Error(`Invalid import map in ${absolute}: ${error.message}`); }
  }
  configureModuleDocument(absolute, importMap);
  if (importMap?.imports?.["three/webgpu"] || importMap?.imports?.["three/tsl"]) await enableWebGPU();
  const modules = [...html.matchAll(/<script\s+[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (!modules.length) throw new Error("HTML entry has no <script type=\"module\">");
  for (const match of modules) {
    const tag = match[0].slice(0, match[0].indexOf(">") + 1);
    const src = /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1];
    if (src) await import(new URL(src, pathToFileURL(absolute)));
    else await import(`data:text/javascript;base64,${Buffer.from(match[1]).toString("base64")}`);
  }
}

process.once("SIGINT", () => { stop(); process.exit(0); });
process.once("exit", () => { if (native.isOpen()) native.shutdown(); });
