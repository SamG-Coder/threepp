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
let lastUnhandledEventError = null;

class BrowserEventTarget {
  constructor() { this._eventListeners = new Map(); }
  addEventListener(type, listener, options = {}) {
    if (!listener) return;
    const key = String(type);
    const listeners = this._eventListeners.get(key) || [];
    if (!listeners.some(entry => entry.listener === listener)) {
      listeners.push({ listener, once: Boolean(typeof options === "object" && options.once) });
      this._eventListeners.set(key, listeners);
    }
  }
  removeEventListener(type, listener) {
    const key = String(type);
    const listeners = this._eventListeners.get(key);
    if (!listeners) return;
    this._eventListeners.set(key, listeners.filter(entry => entry.listener !== listener));
  }
  dispatchEvent(event) {
    if (!event?.type) throw new TypeError("Event object requires a type");
    const path = [this];
    if (event.bubbles) {
      const visited = new Set(path);
      for (let parent = this.parentNode; parent && !visited.has(parent); parent = parent.parentNode) {
        path.push(parent);
        visited.add(parent);
      }
    }
    try { Object.defineProperty(event, "target", { configurable: true, value: this }); } catch {}
    for (const currentTarget of path) {
      try { Object.defineProperty(event, "currentTarget", { configurable: true, value: currentTarget }); } catch {}
      for (const entry of [...(currentTarget._eventListeners?.get(String(event.type)) || [])]) {
        try {
          if (typeof entry.listener === "function") entry.listener.call(currentTarget, event);
          else entry.listener.handleEvent?.(event);
        } catch (error) {
          lastUnhandledEventError = error;
          console.error(`Unhandled ${event.type} event listener error:`, error);
        }
        if (entry.once) currentTarget.removeEventListener(event.type, entry.listener);
      }
      if (event.cancelBubble) break;
    }
    return !event.defaultPrevented;
  }
}
globalThis.EventTarget = BrowserEventTarget;
if (typeof globalThis.ProgressEvent === "undefined") {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.lengthComputable = Boolean(init.lengthComputable);
      this.loaded = Number(init.loaded || 0);
      this.total = Number(init.total || 0);
    }
  };
}

const pointerCaptureTargets = new Map();

class Element extends BrowserEventTarget {
  constructor(tagName) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = this.tagName === "#TEXT" ? 3 : this.tagName === "#DOCUMENT-FRAGMENT" ? 11 : 1;
    this.style = new Proxy({
      setProperty(name, value) { this[name] = String(value); },
      getPropertyValue(name) { return this[name] ?? ""; },
      removeProperty(name) { const value = this[name] ?? ""; delete this[name]; return value; },
      removeAttribute(name) { const value = this[name] ?? ""; delete this[name]; return value; },
    }, {
      // CSSStyleDeclaration exposes supported properties even before values
      // are assigned. Animation libraries use the `in` operator for feature
      // detection (transform, perspective, opacity, and vendor prefixes).
      has: (_target, property) => typeof property === "string",
    });
    this.dataset = {};
    this._attributes = new Map();
    this.children = [];
    this.parentNode = null;
    Object.defineProperties(this, {
      childNodes: { get: () => this.children },
      parentElement: { get: () => this.parentNode },
      firstChild: { get: () => this.children[0] ?? null },
      lastChild: { get: () => this.children.at(-1) ?? null },
      firstElementChild: { get: () => this.children.find(child => child.nodeType === 1) ?? null },
      lastElementChild: { get: () => this.children.findLast(child => child.nodeType === 1) ?? null },
      childElementCount: { get: () => this.children.filter(child => child.nodeType === 1).length },
    });
    this.ownerDocument = globalThis.document ?? null;
    this.textContent = "";
    this.id = "";
    this._clientWidth = null;
    this._clientHeight = null;
    Object.defineProperties(this, {
      // There is no CSS layout engine in the headless host.  Canvas apps
      // conventionally size a mount element from its parent, so inherit the
      // nearest measured box and finally the viewport.  Explicit assignments
      // (images, canvases and resize handling) still take precedence.
      clientWidth: {
        configurable: true,
        get: () => this._clientWidth ?? this.parentNode?.clientWidth ?? globalThis.innerWidth ?? 1280,
        set: value => { this._clientWidth = Number.isFinite(Number(value)) ? Number(value) : null; },
      },
      clientHeight: {
        configurable: true,
        get: () => this._clientHeight ?? this.parentNode?.clientHeight ?? globalThis.innerHeight ?? 720,
        set: value => { this._clientHeight = Number.isFinite(Number(value)) ? Number(value) : null; },
      },
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
    if (this.tagName === "STYLE") {
      const rules = [];
      this.sheet = {
        ownerNode: this,
        cssRules: rules,
        insertRule(rule, index = rules.length) {
          const position = Math.max(0, Math.min(Number(index) || 0, rules.length));
          rules.splice(position, 0, { cssText: String(rule) });
          return position;
        },
        deleteRule(index) {
          const position = Number(index) || 0;
          if (position >= 0 && position < rules.length) rules.splice(position, 1);
        },
      };
      this.styleSheet = this.sheet;
    }
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
    promotePresentedCanvasTree(child);
    completeVirtualResourceTree(child);
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
      completeVirtualResourceTree(node);
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
    promotePresentedCanvasTree(child);
    completeVirtualResourceTree(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children.length = 0;
    this._innerHTML = "";
    this.append(...children);
  }
  replaceChild(replacement, child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error("Node to replace is not a child");
    if (replacement.parentNode) replacement.parentNode.removeChild(replacement);
    child.parentNode = null;
    replacement.parentNode = this;
    replacement.ownerDocument ??= this.ownerDocument || globalThis.document || null;
    this.children[index] = replacement;
    return child;
  }
  setAttribute(name, value) {
    const normalized = String(name).toLowerCase();
    this._attributes.set(normalized, String(value));
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
  setAttributeNS(_namespace, name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(String(name).toLowerCase()) ?? null; }
  getAttributeNS(_namespace, name) { return this.getAttribute(name); }
  hasAttribute(name) { return this._attributes.has(String(name).toLowerCase()); }
  removeAttribute(name) {
    const normalized = String(name).toLowerCase();
    this._attributes.delete(normalized);
    if (normalized === "class") this.className = "";
    else if (normalized === "style") {
      for (const key of Object.keys(this.style)) {
        if (typeof this.style[key] !== "function") delete this.style[key];
      }
    } else if (normalized.startsWith("data-")) {
      const key = normalized.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
      delete this.dataset[key];
    } else delete this[name];
  }
  removeAttributeNS(_namespace, name) { this.removeAttribute(name); }
  toggleAttribute(name, force) {
    const present = this.hasAttribute(name);
    const next = force === undefined ? !present : Boolean(force);
    if (next) this.setAttribute(name, ""); else this.removeAttribute(name);
    return next;
  }
  setPointerCapture(pointerId) {
    const id = Number(pointerId);
    if (!Number.isInteger(id) || id < 0) throw new TypeError("Invalid pointer id");
    if (pointerCaptureTargets.get(id) === this) return;
    const previous = pointerCaptureTargets.get(id);
    pointerCaptureTargets.set(id, this);
    previous?.dispatchEvent(eventWith("lostpointercapture", { pointerId: id, pointerType: "mouse", isPrimary: true }));
    this.dispatchEvent(eventWith("gotpointercapture", { pointerId: id, pointerType: "mouse", isPrimary: true }));
  }
  releasePointerCapture(pointerId) {
    const id = Number(pointerId);
    if (pointerCaptureTargets.get(id) !== this) return;
    pointerCaptureTargets.delete(id);
    this.dispatchEvent(eventWith("lostpointercapture", { pointerId: id, pointerType: "mouse", isPrimary: true }));
  }
  hasPointerCapture(pointerId) { return pointerCaptureTargets.get(Number(pointerId)) === this; }
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
  insertAdjacentHTML(position, value) {
    const where = String(position).toLowerCase();
    if (!["beforebegin", "afterbegin", "beforeend", "afterend"].includes(where)) {
      throw new SyntaxError(`Invalid insertAdjacentHTML position: ${position}`);
    }
    if ((where === "beforebegin" || where === "afterend") && !this.parentNode) return;

    const container = new Element("template");
    container.ownerDocument = this.ownerDocument || globalThis.document || null;
    container.innerHTML = String(value);
    const nodes = [...container.children];

    if (where === "afterbegin") {
      for (const node of nodes.reverse()) this.insertBefore(node, this.firstChild);
    } else if (where === "beforeend") {
      for (const node of nodes) this.appendChild(node);
    } else {
      const parent = this.parentNode;
      const reference = where === "beforebegin" ? this : parent.children[parent.children.indexOf(this) + 1] ?? null;
      for (const node of nodes) parent.insertBefore(node, reference);
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
  getBoundingClientRect() {
    const dimension = (client, css, viewport) => {
      if (client > 0) return client;
      const value = String(css || "").trim();
      if (value.endsWith("%")) return viewport * (Number.parseFloat(value) || 0) / 100;
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : viewport;
    };
    const width = dimension(this.clientWidth, this.style.width, globalThis.innerWidth || 1280);
    const height = dimension(this.clientHeight, this.style.height, globalThis.innerHeight || 720);
    return { left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 };
  }
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
  attachShadow(init = {}) {
    if (this.shadowRoot) throw new Error("Shadow root already attached");
    const root = new Element("#document-fragment");
    root.nodeName = "#shadow-root";
    root.host = this;
    root.mode = init.mode === "closed" ? "closed" : "open";
    // The native host has no separate composed-tree implementation. Keeping
    // this link lets canvases mounted in a shadow root participate in the
    // presented-canvas tree exactly as they do in a browser.
    root.parentNode = this;
    root.ownerDocument = this.ownerDocument || globalThis.document || null;
    Object.defineProperty(this, "shadowRoot", {
      configurable: true,
      value: root.mode === "open" ? root : null,
    });
    this._closedShadowRoot = root.mode === "closed" ? root : null;
    return root;
  }
  click() { this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true })); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  requestPointerLock() { return requestNativePointerLock(this); }
}

function completeVirtualResourceTree(node) {
  if (!node || typeof node !== "object") return;
  if (node.tagName === "LINK" && !node._virtualLoadQueued) {
    node._virtualLoadQueued = true;
    queueMicrotask(() => {
      if (!node.parentNode) return;
      node.sheet ??= { cssRules: [] };
      node.dispatchEvent(new Event("load"));
      if (typeof node.onload === "function") node.onload.call(node, new Event("load"));
    });
  }
  for (const child of node.children || []) completeVirtualResourceTree(child);
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

class WebGLRenderingContextProbe {
  constructor(canvas) { this.canvas = canvas; }
  getExtension(name) {
    const supported = new Set([
      "OES_texture_float", "OES_texture_float_linear", "OES_texture_half_float",
      "OES_texture_half_float_linear", "OES_element_index_uint",
      "EXT_color_buffer_float", "EXT_texture_filter_anisotropic",
    ]);
    return supported.has(String(name)) ? {} : null;
  }
  getSupportedExtensions() {
    return ["OES_texture_float", "OES_texture_float_linear", "EXT_color_buffer_float", "EXT_texture_filter_anisotropic"];
  }
}
class WebGL2RenderingContextProbe extends WebGLRenderingContextProbe {}

class CanvasElement extends Element {
  constructor() {
    super("canvas");
    this.width = 1280;
    this.height = 720;
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.tabIndex = 0;
    this.context2d = null;
    this.contextWebgl = null;
    this.contextWebgl2 = null;
  }
  focus() { document.activeElement = this; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
      width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  getContext(type) {
    const name = String(type).toLowerCase();
    if (name === "2d") return this.context2d ??= new Canvas2DContext(this);
    if (name === "webgl" || name === "experimental-webgl") return this.contextWebgl ??= new WebGLRenderingContextProbe(this);
    if (name === "webgl2" || name === "experimental-webgl2") return this.contextWebgl2 ??= new WebGL2RenderingContextProbe(this);
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
    this.complete = false;
    const source = this._src;
    // Begin resolving immediately. Sites commonly revoke a blob URL directly
    // after assigning it to an image; browsers retain that already-started load.
    const loadPromise = globalThis.fetch(source);
    this._loadPromise = loadPromise;
    queueMicrotask(async () => {
      try {
        const response = await loadPromise;
        if (!response.ok) throw new Error(`Image ${source} responded with ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const decoded = native.decodeImage(bytes);
        const size = decoded || encodedImageSize(bytes);
        this.naturalWidth = this.width = size.width;
        this.naturalHeight = this.height = size.height;
        this.data = decoded?.pixels;
        this.complete = true;
        if (process.env.THREEBROWSER_TRACE_RENDER) {
          console.error("ThreeBrowser image loaded", source, `${size.width}x${size.height}`, decoded ? "decoded" : "metadata-only");
        }
        const event = new Event("load");
        this.dispatchEvent(event);
        this.onload?.(event);
      } catch (error) {
        this.complete = true;
        if (process.env.THREEBROWSER_TRACE_RENDER) {
          console.error("ThreeBrowser image failed", source, error?.message || error);
        }
        const event = eventWith("error", { error, message: error.message });
        this.dispatchEvent(event);
        this.onerror?.(event);
      }
    });
  }
  decode() {
    if (this.complete) {
      return this.data || (this.naturalWidth > 0 && this.naturalHeight > 0)
        ? Promise.resolve()
        : Promise.reject(new Error(`Image could not be decoded: ${this._src}`));
    }
    return new Promise((resolve, reject) => {
      this.addEventListener("load", () => resolve(), { once: true });
      this.addEventListener("error", event => reject(event.error || new Error(`Image could not be decoded: ${this._src}`)), { once: true });
    });
  }
}

class AudioElement extends Element {
  constructor(source = "") {
    super("audio");
    this._src = "";
    this.autoplay = false;
    this.controls = false;
    this.crossOrigin = null;
    this.currentTime = 0;
    this.defaultMuted = false;
    this.duration = Number.NaN;
    this.ended = false;
    this.loop = false;
    this.muted = false;
    this.paused = true;
    this.playbackRate = 1;
    this.preload = "auto";
    this.readyState = 0;
    this.volume = 1;
    if (source) this.src = source;
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value ?? "");
    this.readyState = 0;
    if (this._src) this.load();
  }
  get currentSrc() { return this._src; }
  load() {
    queueMicrotask(() => {
      this.readyState = 4;
      for (const type of ["loadedmetadata", "loadeddata", "canplay", "canplaythrough"]) {
        this.dispatchEvent(new Event(type));
      }
      if (this.autoplay) void this.play();
    });
  }
  play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event("play"));
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  canPlayType(type) {
    return /^(?:audio\/(?:mpeg|mp4|ogg|wav|webm)|application\/ogg)/i.test(String(type)) ? "probably" : "";
  }
}

class VideoElement extends AudioElement {
  constructor(source = "") {
    super(source);
    this.tagName = this.nodeName = "VIDEO";
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.playsInline = true;
  }
  canPlayType(type) {
    return /^(?:video\/(?:mp4|ogg|webm)|application\/ogg)/i.test(String(type)) ? "probably" : "";
  }
}

const body = new Element("body");
const head = new Element("head");
const documentTarget = new BrowserEventTarget();
const fonts = Object.assign(new BrowserEventTarget(), {
  status: "loaded",
  ready: Promise.resolve(),
  check() { return true; },
  load() { return Promise.resolve([]); },
  add() { return this; },
  delete() { return false; },
  clear() {},
  has() { return false; },
  entries() { return [][Symbol.iterator](); },
  keys() { return [][Symbol.iterator](); },
  values() { return [][Symbol.iterator](); },
  [Symbol.iterator]() { return this.values(); },
});
export const document = Object.assign(documentTarget, {
  nodeType: 9,
  nodeName: "#document",
  body,
  head,
  documentElement: new Element("html"),
  activeElement: null,
  readyState: "loading",
  visibilityState: "visible",
  hidden: false,
  fonts,
  pointerLockElement: null,
  createElement(tag) {
    const name = String(tag).toLowerCase();
    return name === "canvas" ? new CanvasElement() :
      name === "img" ? new ImageElement() :
      name === "audio" ? new AudioElement() :
      name === "video" ? new VideoElement() :
      new Element(tag);
  },
  createElementNS(_namespace, tag) { return this.createElement(tag); },
  createTextNode(value) { const node = new Element("#text"); node.textContent = String(value); return node; },
  createDocumentFragment() { const fragment = new Element("#document-fragment"); fragment.ownerDocument = this; return fragment; },
  createEvent() {
    return {
      type: "",
      bubbles: false,
      cancelable: false,
      defaultPrevented: false,
      cancelBubble: false,
      detail: null,
      initEvent(type, bubbles = false, cancelable = false) {
        this.type = String(type);
        this.bubbles = Boolean(bubbles);
        this.cancelable = Boolean(cancelable);
      },
      initCustomEvent(type, bubbles = false, cancelable = false, detail = null) {
        this.initEvent(type, bubbles, cancelable);
        this.detail = detail;
      },
      preventDefault() { if (this.cancelable) this.defaultPrevented = true; },
      stopPropagation() { this.cancelBubble = true; },
      stopImmediatePropagation() { this.cancelBubble = true; },
    };
  },
  getElementById(id) {
    const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean);
    return walk(body) || walk(head) || null;
  },
  getElementsByTagName(name) {
    const tag = String(name).toLowerCase();
    if (tag === "html") return [this.documentElement];
    if (tag === "head") return [head];
    if (tag === "body") return [body];
    return [...head.querySelectorAll(tag), ...body.querySelectorAll(tag)];
  },
  querySelector(selector) {
    if (String(selector).trim().toLowerCase() === "html") return this.documentElement;
    if (String(selector).trim().toLowerCase() === "head") return head;
    if (String(selector).trim().toLowerCase() === "body") return body;
    if (selector === "canvas") return currentCanvas;
    return this.querySelectorAll(selector)[0] ?? null;
  },
  querySelectorAll(selector) {
    const normalized = String(selector).trim().toLowerCase();
    if (normalized === "html") return [this.documentElement];
    if (normalized === "head") return [head];
    if (normalized === "body") return [body];
    return [...head.querySelectorAll(selector), ...body.querySelectorAll(selector)];
  },
  hasFocus() { return true; },
  exitPointerLock() { releaseNativePointerLock(); },
});
body.ownerDocument = document;
head.ownerDocument = document;
document.documentElement.ownerDocument = document;
document.documentElement.append(head, body);
// Maintain the browser event ancestry. Controls such as OrbitControls listen
// for pointerdown on the canvas, then pointermove/pointerup on ownerDocument.
document.documentElement.parentNode = document;

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
const mountedCanvases = new Set();
function canvasIsConnected(canvas) {
  let node = canvas;
  while (node) {
    if (node === body || node === document.documentElement) return true;
    node = node.parentNode;
  }
  return false;
}
function canvasStackZ(canvas) {
  let z = 0;
  for (let node = canvas; node; node = node.parentNode) {
    const value = Number.parseFloat(node.style?.zIndex);
    if (Number.isFinite(value)) z += value;
  }
  return z;
}
function refreshPresentedCanvas() {
  const candidates = [...mountedCanvases].filter(canvasIsConnected);
  currentCanvas = candidates.reduce((best, canvas) => {
    if (!best) return canvas;
    const z = canvasStackZ(canvas);
    const bestZ = canvasStackZ(best);
    if (z !== bestZ) return z > bestZ ? canvas : best;
    const area = Math.max(0, Number(canvas.width) || 0) * Math.max(0, Number(canvas.height) || 0);
    const bestArea = Math.max(0, Number(best.width) || 0) * Math.max(0, Number(best.height) || 0);
    return area > bestArea ? canvas : best;
  }, null);
  return currentCanvas;
}
globalThis.__threeBrowserIsPresentedCanvas = canvas => refreshPresentedCanvas() === canvas;
function promotePresentedCanvasTree(node) {
  if (node instanceof CanvasElement) promotePresentedCanvas(node, node.parentNode);
  for (const child of node?.children || []) promotePresentedCanvasTree(child);
}
function promotePresentedCanvas(canvas, parent) {
  let node = parent;
  let connected = false;
  while (node) {
    if (node === body || node === document.documentElement) { connected = true; break; }
    node = node.parentNode;
  }
  if (!connected) return;
  mountedCanvases.add(canvas);
  refreshPresentedCanvas();
  if (process.env.THREEBROWSER_TRACE_RENDER) {
    console.error("ThreeBrowser canvas mounted", {
      width: canvas.width, height: canvas.height, parent: parent.tagName, parentId: parent.id,
      zIndex: canvasStackZ(canvas), selected: currentCanvas === canvas,
    });
  }
}
const originalCreateElement = document.createElement.bind(document);
document.createElement = tag => {
  const result = originalCreateElement(tag);
  if (result instanceof CanvasElement && !currentCanvas) currentCanvas = result;
  if (result instanceof CanvasElement && process.env.THREEBROWSER_TRACE_RENDER) {
    console.error("ThreeBrowser canvas created", { width: result.width, height: result.height });
  }
  return result;
};

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.document = document;
globalThis.history = {
  length: 1,
  state: null,
  scrollRestoration: "auto",
  pushState(state, _unused, url) {
    this.state = state;
    if (url != null) globalThis.location = new URL(String(url), globalThis.location);
  },
  replaceState(state, _unused, url) {
    this.state = state;
    if (url != null) globalThis.location = new URL(String(url), globalThis.location);
  },
  back() {}, forward() {}, go() {},
};
Object.defineProperty(globalThis, "navigator", {
  value: {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ThreeBrowserRuntime/0.1 V8",
    platform: process.platform,
    language: "en-AU",
    languages: ["en-AU", "en"],
    maxTouchPoints: 0,
    hardwareConcurrency: Math.max(1, Number(process.env.NUMBER_OF_PROCESSORS) || 1),
    onLine: false,
    cookieEnabled: false,
    getGamepads: () => [],
  },
  configurable: true,
});
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1280;
globalThis.innerHeight = 720;
const screenOrientation = Object.assign(new BrowserEventTarget(), {
  angle: 0,
  type: "landscape-primary",
  lock: async () => {},
  unlock: () => {},
});
globalThis.screen = {
  width: globalThis.innerWidth,
  height: globalThis.innerHeight,
  availWidth: globalThis.innerWidth,
  availHeight: globalThis.innerHeight,
  colorDepth: 24,
  pixelDepth: 24,
  orientation: screenOrientation,
};
globalThis.__threeBrowserNativeRuntime = true;
globalThis.__TN_SHARED = new ArrayBuffer(8 * 1024 * 1024);
globalThis.Node = Element;
globalThis.Element = Element;
globalThis.HTMLElement = Element;
globalThis.HTMLIFrameElement = Element;
globalThis.HTMLInputElement = Element;
globalThis.HTMLSelectElement = Element;
globalThis.HTMLTextAreaElement = Element;
globalThis.SVGElement = Element;
globalThis.HTMLCanvasElement = CanvasElement;
globalThis.CanvasRenderingContext2D = Canvas2DContext;
globalThis.WebGLRenderingContext = WebGLRenderingContextProbe;
globalThis.WebGL2RenderingContext = WebGL2RenderingContextProbe;
globalThis.HTMLImageElement = ImageElement;
globalThis.Image = ImageElement;
globalThis.HTMLMediaElement = AudioElement;
globalThis.HTMLAudioElement = AudioElement;
globalThis.Audio = AudioElement;
globalThis.HTMLVideoElement = VideoElement;
document.defaultView = globalThis;
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
const audioParam = (value = 0) => ({
  value,
  setValueAtTime(next) { this.value = Number(next); return this; },
  linearRampToValueAtTime(next) { this.value = Number(next); return this; },
  exponentialRampToValueAtTime(next) { this.value = Number(next); return this; },
  setTargetAtTime(next) { this.value = Number(next); return this; },
  cancelScheduledValues() { return this; },
});
const audioNode = extra => Object.assign({
  connect() { return this; },
  disconnect() {},
}, extra);
class SilentAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = "running";
    this.destination = audioNode({});
    this.listener = {
      positionX: audioParam(), positionY: audioParam(), positionZ: audioParam(),
      forwardX: audioParam(0), forwardY: audioParam(0), forwardZ: audioParam(-1),
      upX: audioParam(0), upY: audioParam(1), upZ: audioParam(0),
      setPosition() {}, setOrientation() {},
    };
  }
  resume() { this.state = "running"; return Promise.resolve(); }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  close() { this.state = "closed"; return Promise.resolve(); }
  createGain() { return audioNode({ gain: audioParam(1) }); }
  createPanner() {
    return audioNode({
      positionX: audioParam(), positionY: audioParam(), positionZ: audioParam(),
      orientationX: audioParam(1), orientationY: audioParam(), orientationZ: audioParam(),
      refDistance: 1, rolloffFactor: 1, distanceModel: "inverse", panningModel: "HRTF",
      setPosition() {}, setOrientation() {},
    });
  }
  createBufferSource() {
    return audioNode({
      buffer: null, loop: false, loopStart: 0, loopEnd: 0,
      playbackRate: audioParam(1), detune: audioParam(),
      start() {}, stop() {}, onended: null,
    });
  }
  createBiquadFilter() { return audioNode({ frequency: audioParam(350), Q: audioParam(1), gain: audioParam(), detune: audioParam(), type: "lowpass" }); }
  createMediaElementSource() { return audioNode({}); }
  decodeAudioData(data, success) {
    const buffer = { duration: 0, length: 0, numberOfChannels: 0, sampleRate: this.sampleRate, _data: data };
    queueMicrotask(() => success?.(buffer));
    return Promise.resolve(buffer);
  }
}
globalThis.AudioContext = SilentAudioContext;
globalThis.webkitAudioContext = SilentAudioContext;
globalThis.getComputedStyle = element => element?.style ?? { getPropertyValue: () => "" };
globalThis.matchMedia = query => ({ matches: false, media: String(query), onchange: null, addEventListener() {}, removeEventListener() {} });
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; this.targets = new Set(); }
  observe(target) {
    this.targets.add(target);
    queueMicrotask(() => {
      if (!this.targets.has(target)) return;
      const contentRect = target.getBoundingClientRect();
      if (process.env.THREEBROWSER_TRACE_RENDER) {
        console.error("ThreeBrowser ResizeObserver", {
          tag: target.tagName, id: target.id, className: target.className,
          width: contentRect.width, height: contentRect.height,
        });
      }
      this.callback([{ target, contentRect, contentBoxSize: [{ inlineSize: contentRect.width, blockSize: contentRect.height }] }], this);
    });
  }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
};
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
    this.sentCount = 0;
    this.receivedCount = 0;
    this.fetchRequestCount = 0;
    this.fetchResponseCount = 0;
    this.decodeRequestCount = 0;
    this.decodeResponseCount = 0;
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
        // Browser workers expose these as pre-existing writable globals.
        // Strict-mode bundles commonly assign the onmessage global; without the
        // binding Node treats that assignment as an undeclared identifier.
        globalThis.onmessage = null;
        globalThis.onmessageerror = null;
        globalThis.onerror = null;
        const listeners = new Map();
        const bitmapRequests = new Map();
        const fetchRequests = new Map();
        let nextBitmapRequest = 1;
        let nextFetchRequest = 1;
        globalThis.addEventListener = (type, listener) => {
          const list = listeners.get(type) || [];
          list.push(listener);
          listeners.set(type, list);
        };
        globalThis.removeEventListener = (type, listener) => {
          const list = listeners.get(type) || [];
          listeners.set(type, list.filter(item => item !== listener));
        };
        globalThis.postMessage = (value, transfer) => {
          // ImageBitmap is transferable in browsers. Our bitmap-compatible
          // object contains a transferable pixel ArrayBuffer, but is not
          // itself a Node transfer-list object, so let structured clone copy
          // the small wrapper and its pixels safely.
          const safeTransfer = Array.isArray(transfer)
            ? transfer.filter(item => item instanceof ArrayBuffer ||
                (typeof MessagePort !== 'undefined' && item instanceof MessagePort))
            : [];
          parentPort.postMessage(value, safeTransfer);
        };
        globalThis.close = () => process.exit(0);
        globalThis.importScripts = () => { throw new Error('importScripts requires an unpacked worker dependency'); };
        parentPort.on('message', data => {
          if (data?.__threeBrowserBitmapResult) {
            const pending = bitmapRequests.get(data.id);
            if (!pending) return;
            bitmapRequests.delete(data.id);
            if (data.error) pending.reject(new Error(data.error));
            else {
              const bitmap = {
              width: data.width,
              height: data.height,
              data: new Uint8Array(data.pixels),
              };
              // Keep browser API compatibility without placing a function in
              // structured-cloned postMessage payloads.
              Object.defineProperty(bitmap, 'close', { value() {}, enumerable: false });
              pending.resolve(bitmap);
            }
            return;
          }
          if (data?.__threeBrowserFetchResult) {
            const pending = fetchRequests.get(data.id);
            if (!pending) return;
            fetchRequests.delete(data.id);
            if (data.error) pending.reject(new Error(data.error));
            else pending.resolve(new Response(data.body, {
              status: data.status,
              statusText: data.statusText,
              headers: data.headers,
            }));
            return;
          }
          const event = { data };
          if (typeof globalThis.onmessage === 'function') globalThis.onmessage(event);
          for (const listener of listeners.get('message') || []) listener(event);
        });
        globalThis.createImageBitmap = async source => {
          let bytes;
          if (source instanceof Blob) bytes = await source.arrayBuffer();
          else if (source instanceof ArrayBuffer) bytes = source;
          else if (ArrayBuffer.isView(source)) {
            bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
          } else {
            throw new Error('Unsupported worker image source');
          }
          const id = nextBitmapRequest++;
          const result = new Promise((resolve, reject) => bitmapRequests.set(id, { resolve, reject }));
          parentPort.postMessage({ __threeBrowserDecodeImage: true, id, bytes }, [bytes]);
          try {
            return await result;
          } catch (error) {
            console.error('ThreeBrowser worker createImageBitmap failed:', error);
            throw error;
          }
        };
        globalThis.fetch = async (input, init = {}) => {
          const id = nextFetchRequest++;
          const result = new Promise((resolve, reject) => fetchRequests.set(id, { resolve, reject }));
          parentPort.postMessage({
            __threeBrowserWorkerFetch: true,
            id,
            input: input instanceof Request ? input.url : String(input),
            init: {
              method: init.method,
              headers: init.headers ? Object.fromEntries(new Headers(init.headers)) : undefined,
            },
          });
          try {
            return await result;
          } catch (error) {
            console.error('ThreeBrowser worker fetch bridge failed:', error);
            throw error;
          }
        };
        eval(workerData.source);
      `;
      if (this.closed) return;
      this.worker = new NodeWorker(wrapper, { eval: true, workerData: { source, url: this.url.href } });
      this.worker.on("message", data => {
        if (data?.__threeBrowserWorkerFetch) {
          this.fetchRequestCount++;
          (async () => {
            try {
              const response = await globalThis.fetch(data.input, data.init);
              if (!response.ok && (process.env.THREEBROWSER_TRACE_RENDER || process.env.THREEBROWSER_TRACE_FETCH)) {
                console.error(`ThreeBrowser worker fetch response (${data.input}): ${response.status} ${response.statusText}`);
              }
              const body = await response.arrayBuffer();
              this.worker?.postMessage({
                __threeBrowserFetchResult: true,
                id: data.id,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers),
                body,
              }, [body]);
              this.fetchResponseCount++;
            } catch (cause) {
              if (process.env.THREEBROWSER_TRACE_RENDER || process.env.THREEBROWSER_TRACE_FETCH) {
                console.error(`ThreeBrowser worker fetch failed (${data.input}): ${cause?.stack || cause}`);
              }
              this.worker?.postMessage({
                __threeBrowserFetchResult: true,
                id: data.id,
                error: cause?.message || String(cause),
              });
              this.fetchResponseCount++;
            }
          })();
          return;
        }
        if (data?.__threeBrowserDecodeImage) {
          this.decodeRequestCount++;
          let decoded = null;
          let error = null;
          try {
            decoded = native.decodeImage(Buffer.from(data.bytes));
            if (!decoded) error = "Unsupported encoded image";
          } catch (cause) {
            error = cause?.message || String(cause);
          }
          if (error) {
            if (process.env.THREEBROWSER_TRACE_RENDER || process.env.THREEBROWSER_TRACE_FETCH) {
              console.error(`ThreeBrowser worker image decode failed: ${error}`);
            }
            this.worker?.postMessage({ __threeBrowserBitmapResult: true, id: data.id, error });
            this.decodeResponseCount++;
          } else {
            const pixels = Uint8Array.from(decoded.pixels).buffer;
            this.worker?.postMessage({
              __threeBrowserBitmapResult: true,
              id: data.id,
              width: decoded.width,
              height: decoded.height,
              pixels,
            }, [pixels]);
            this.decodeResponseCount++;
          }
          return;
        }
        this.receivedCount++;
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
        if (process.env.THREEBROWSER_TRACE_RENDER) {
          console.error(`ThreeBrowser worker error (${this.url.href}): ${error?.stack || error}`);
        }
        const event = eventWith("error", { error, message: error.message });
        this.dispatchEvent(event);
        this.onerror?.(event);
      });
      this.worker.on("exit", code => {
        if (process.env.THREEBROWSER_TRACE_RENDER && !this.closed && code !== 0) {
          console.error(`ThreeBrowser worker exited (${this.url.href}) with code ${code}`);
        }
        activeWorkers.delete(this);
      });
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
    this.sentCount++;
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

const PlatformRequest = globalThis.Request;
globalThis.Request = class BrowserRequest extends PlatformRequest {
  constructor(input, init) {
    // Browser Request accepts document-relative URLs; Node's undici Request
    // rejects them before our fetch wrapper gets a chance to resolve them.
    const resolved = typeof input === "string" || input instanceof URL
      ? new URL(String(input), globalThis.location?.href || pulledVirtualURL)
      : input;
    super(resolved, init);
  }
};
const platformFetch = globalThis.fetch.bind(globalThis);
const retainedObjectURLs = new Map();
const platformCreateObjectURL = URL.createObjectURL?.bind(URL);
const platformRevokeObjectURL = URL.revokeObjectURL?.bind(URL);
if (platformCreateObjectURL) {
  URL.createObjectURL = value => {
    const url = platformCreateObjectURL(value);
    retainedObjectURLs.set(url, value);
    if (retainedObjectURLs.size > 512) retainedObjectURLs.delete(retainedObjectURLs.keys().next().value);
    return url;
  };
  URL.revokeObjectURL = url => {
    platformRevokeObjectURL?.(url);
    // Browsers keep an image/media load alive when its object URL is revoked
    // immediately after assignment. Retain the backing Blob briefly to match.
    setTimeout(() => retainedObjectURLs.delete(String(url)), 30_000).unref?.();
  };
}
let pulledSourceURL = null;
let pulledVirtualURL = null;
let pulledDirectory = null;
let pulledFiles = new Map();
let pulledVirtualFiles = new Map();
const contentTypes = new Map([
  [".json", "application/json"], [".gltf", "model/gltf+json"], [".glb", "model/gltf-binary"],
  [".bin", "application/octet-stream"], [".dat", "application/octet-stream"], [".wasm", "application/wasm"], [".txt", "text/plain"],
  [".glsl", "text/plain"], [".vert", "text/plain"], [".frag", "text/plain"], [".wgsl", "text/plain"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
]);
globalThis.fetch = async (input, init) => {
  const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
  const retainedBlob = retainedObjectURLs.get(raw);
  if (retainedBlob) {
    return new Response(String(init?.method || "GET").toUpperCase() === "HEAD" ? null : retainedBlob, {
      status: 200,
      headers: {
        "content-type": retainedBlob.type || "application/octet-stream",
        "content-length": String(retainedBlob.size),
      },
    });
  }
  let resolved, requestURL, isVirtual;
  try {
    requestURL = new URL(raw, globalThis.location?.href || pulledVirtualURL);
    requestURL.hash = "";
    isVirtual = pulledVirtualURL && requestURL.origin === pulledVirtualURL.origin;
    const sourceCandidate = isVirtual && pulledSourceURL
      ? new URL(`${requestURL.pathname}${requestURL.search}`, pulledSourceURL.origin)
      : pulledSourceURL ? new URL(raw, pulledSourceURL) : requestURL;
    sourceCandidate.hash = "";
    const pulledPath = pulledVirtualFiles.get(requestURL.href) || pulledFiles.get(sourceCandidate.href);
    resolved = pulledPath && pulledDirectory
      ? pathToFileURL(path.join(pulledDirectory, pulledPath))
      : isVirtual ? sourceCandidate : requestURL;
  }
  catch { return platformFetch(input, init); }
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (process.env.THREEBROWSER_TRACE_FETCH) console.error(`ThreeBrowser fetch: ${resolved.href}`);
  if (resolved.protocol !== "file:") {
    let response = await platformFetch(resolved, init);
    // Older demos are often moved beneath a new deployment subdirectory
    // without updating `../asset` references embedded in their minified JS.
    // A browser then gets a root-level 404 even though the asset sits beside
    // the imported page. Retry only that failed parent-relative shape against
    // the page directory; successful, intentional URLs keep normal semantics.
    if (!response.ok && pulledSourceURL && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(raw) &&
        resolved.origin === pulledSourceURL.origin) {
      const pageRelative = new URL(raw.replace(/^(?:(?:\.\.?\/)+)/, ""), pulledSourceURL);
      if (pageRelative.href !== resolved.href) {
        if (process.env.THREEBROWSER_TRACE_FETCH) console.error(`ThreeBrowser fetch fallback: ${pageRelative.href}`);
        const fallback = await platformFetch(pageRelative, init);
        if (fallback.ok) response = fallback;
      }
    }
    if (isVirtual && response.ok && method === "GET" && pulledDirectory) {
      const relative = decodeURIComponent(requestURL.pathname).replace(/^\/+/, "").replaceAll("/", path.sep);
      const cachePath = path.resolve(pulledDirectory, relative);
      const boundary = `${path.resolve(pulledDirectory)}${path.sep}`;
      if (cachePath.startsWith(boundary)) {
        response.clone().arrayBuffer().then(async bytes => {
          await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
          await fs.promises.writeFile(cachePath, Buffer.from(bytes));
        }).catch(() => {});
      }
    }
    return response;
  }
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
    if (error?.code === "ENOENT" && pulledDirectory && pulledSourceURL) {
      const missingPath = fileURLToPath(new URL(resolved));
      const relative = path.relative(pulledDirectory, missingPath);
      if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
        const remoteURL = new URL(relative.replaceAll("\\", "/"), pulledSourceURL.origin);
        const response = await platformFetch(remoteURL, init);
        if (response.ok && method === "GET") {
          const bytes = Buffer.from(await response.arrayBuffer());
          await fs.promises.mkdir(path.dirname(missingPath), { recursive: true });
          await fs.promises.writeFile(missingPath, bytes);
          return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        return response;
      }
    }
    if (error?.code === "ENOENT") return new Response(null, { status: 404, statusText: "Not Found" });
    throw error;
  }
};

class XMLHttpRequestHost extends BrowserEventTarget {
  static UNSENT = 0;
  static OPENED = 1;
  static HEADERS_RECEIVED = 2;
  static LOADING = 3;
  static DONE = 4;
  constructor() {
    super();
    this.readyState = 0;
    this.status = 0;
    this.statusText = "";
    this.responseType = "";
    this.response = null;
    this.responseText = "";
    this.responseURL = "";
    this.timeout = 0;
    this.withCredentials = false;
    this.upload = new BrowserEventTarget();
    this._headers = new Headers();
    this._responseHeaders = new Headers();
    this._method = "GET";
    this._url = "";
    this._async = true;
    this._aborted = false;
  }
  _emit(type, properties = {}) {
    const event = eventWith(type, properties);
    this.dispatchEvent(event);
    this[`on${type}`]?.call(this, event);
  }
  _setReadyState(value) {
    this.readyState = value;
    this._emit("readystatechange");
  }
  open(method, url, async = true) {
    if (async === false) throw new Error("Synchronous XMLHttpRequest is not supported by the native runtime.");
    this._method = String(method || "GET").toUpperCase();
    this._url = String(url);
    this._async = true;
    this._aborted = false;
    this._setReadyState(XMLHttpRequestHost.OPENED);
  }
  setRequestHeader(name, value) { this._headers.append(String(name), String(value)); }
  overrideMimeType(value) { this._mimeType = String(value); }
  getResponseHeader(name) { return this._responseHeaders.get(String(name)); }
  getAllResponseHeaders() {
    return [...this._responseHeaders].map(([name, value]) => `${name}: ${value}\r\n`).join("");
  }
  abort() {
    this._aborted = true;
    this._controller?.abort();
    this.status = 0;
    this._setReadyState(XMLHttpRequestHost.UNSENT);
    this._emit("abort");
    this._emit("loadend");
  }
  async send(body = null) {
    if (this.readyState !== XMLHttpRequestHost.OPENED) throw new Error("XMLHttpRequest.open() must be called before send().");
    this._controller = new AbortController();
    this._emit("loadstart");
    let timer = null;
    if (this.timeout > 0) timer = setTimeout(() => this._controller.abort("timeout"), this.timeout);
    try {
      const response = await globalThis.fetch(this._url, {
        method: this._method,
        headers: this._headers,
        body: new Set(["GET", "HEAD"]).has(this._method) ? undefined : body,
        signal: this._controller.signal,
      });
      if (this._aborted) return;
      this.status = response.status;
      this.statusText = response.statusText;
      this.responseURL = response.url || new URL(this._url, globalThis.location?.href).href;
      this._responseHeaders = new Headers(response.headers);
      this._setReadyState(XMLHttpRequestHost.HEADERS_RECEIVED);
      const bytes = await response.arrayBuffer();
      if (this._aborted) return;
      this._setReadyState(XMLHttpRequestHost.LOADING);
      this._emit("progress", { lengthComputable: true, loaded: bytes.byteLength, total: bytes.byteLength });
      const text = new TextDecoder().decode(bytes);
      this.responseText = text;
      switch (this.responseType) {
        case "arraybuffer": this.response = bytes; break;
        case "blob": this.response = new Blob([bytes], { type: this._mimeType || response.headers.get("content-type") || "" }); break;
        case "json": this.response = text ? JSON.parse(text) : null; break;
        default: this.response = text; break;
      }
      this._setReadyState(XMLHttpRequestHost.DONE);
      this._emit("load");
      this._emit("loadend");
    } catch (error) {
      if (this._aborted) return;
      this.status = 0;
      this._setReadyState(XMLHttpRequestHost.DONE);
      if (this._controller.signal.reason === "timeout") this._emit("timeout", { error });
      else this._emit("error", { error, message: error?.message || String(error) });
      this._emit("loadend");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
for (const [name, value] of Object.entries({ UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 })) {
  XMLHttpRequestHost.prototype[name] = value;
}
globalThis.XMLHttpRequest = XMLHttpRequestHost;

const windowEvents = new BrowserEventTarget();
document.parentNode = windowEvents;
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
    RuntimeRender: (scene, camera) => native.render(scene, camera),
    BackendName: () => native.backendName(),
    LastError: () => native.lastError(),
    CmdSubmit: used => submitNativeCommands(new Uint8Array(globalThis.__TN_SHARED, 0, used)),
    CmdSubmitBuffer: submitNativeCommands,
    RendererSetToneMapping: (mode, exposure) => native.setToneMapping(mode, exposure),
    ShaderMaterialCreate: (vertex, fragment) => native.shaderMaterialCreate(vertex, fragment),
    ShaderMaterialSetSource: (material, vertex, fragment) => native.shaderMaterialSetSource(material, vertex, fragment),
    ShaderUniformFloat: (material, name, value) => native.shaderUniformFloat(material, name, value),
    ShaderUniformInt: (material, name, value) => native.shaderUniformInt(material, name, value),
    ShaderUniformVec2: (material, name, x, y) => native.shaderUniformVec2(material, name, x, y),
    ShaderUniformVec3: (material, name, x, y, z) => native.shaderUniformVec3(material, name, x, y, z),
    ShaderUniformVec4: (material, name, x, y, z, w) => native.shaderUniformVec4(material, name, x, y, z, w),
    ShaderUniformMat3: (material, name, ...elements) => native.shaderUniformMat3(material, name, ...elements),
    ShaderUniformMat4: (material, name, ...elements) => native.shaderUniformMat4(material, name, ...elements),
    ShaderUniformTexture: (material, name, texture) => native.shaderUniformTexture(material, name, texture),
    ShaderSetFlags: (material, side, depthWrite, lights) => native.shaderSetFlags(material, side, depthWrite, lights),
    SceneSetBackgroundTexture: (scene, texture) => native.setSceneBackgroundTexture(scene, texture),
    SceneSetEnvironment: (scene, texture) => native.setSceneEnvironment(scene, texture),
    PmremFromEquirect: (id, texture) => native.pmremFromEquirect(id, texture),
    PmremFromSky: (id, sunX, sunY, sunZ, turbidity, rayleigh, _mieCoefficient, mieDirectionalG) =>
      native.pmremFromSky(id, sunX, sunY, sunZ, turbidity, rayleigh, mieDirectionalG),
    PmremFromCubemap: (id, texture) => native.pmremFromCubemap(id, texture),
    PmremFromObject: (id, object) => native.pmremFromObject(id, object),
    RenderTargetCreate: (id, width, height, samples, depthBuffer, stencilBuffer) =>
      native.renderTargetCreate(id, width, height, samples, depthBuffer, stencilBuffer),
    RenderTargetSet: (id, activeCubeFace, activeMipmapLevel) =>
      native.renderTargetSet(id, activeCubeFace, activeMipmapLevel),
    RenderTargetResize: (id, width, height) => native.renderTargetResize(id, width, height),
    BoneCreate: () => native.boneCreate(),
    SkeletonCreate: csv => native.skeletonCreate(Uint32Array.from(String(csv).split(",").filter(Boolean).map(Number))),
    SkeletonSetInverses: (skeleton, encoded) => {
      const bytes = Buffer.from(String(encoded), "base64");
      const copy = Uint8Array.from(bytes);
      return native.skeletonSetInverses(skeleton, new Float32Array(copy.buffer));
    },
    SlotDestroy: id => native.destroySlot(id),
    RuntimeStartWebGpu: () => 1,
    WebGpuIsNative: () => 1,
    WebGpuSession: () => 1,
    WebGpuCmdSubmit: used => native.webGpuSubmit(globalThis.__TN_SHARED, used),
    WebGpuCmdSubmitSession: used => native.webGpuSubmit(globalThis.__TN_SHARED, used),
    WebGpuMapRead: (handle, offset, size) => native.webGpuMapRead(handle, offset, size),
    WebGpuSetSize: (width, height) => native.resize(width, height),
    WebGpuBackendName: () => native.backendName(),
    WebGpuCapabilities: () => native.gpuCapabilities(),
    WebGpuSetReflexMode: mode => native.setReflexMode(mode),
    WebGpuReflexMode: () => native.reflexMode(),
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
let startupDeadline = 0;
let nextWebGpuFrame = 0;
let nextTraceFrame = 0;
const webGpuFrameInterval = 1000 / 240;
const nativeStartupTimeout = 30_000;
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
let pointerInside = false;
let doubleClickButton = -1;
const pressedKeys = new Set();
let overlayChordActive = false;

function dispatchToCanvasAndWindow(eventFactory) {
  (currentCanvas || windowEvents).dispatchEvent(eventFactory());
}

function dispatchNativeInput() {
  for (const input of native.pollInput()) {
    if (process.env.THREEBROWSER_TRACE_INPUT) console.error("input addon", input);
    const defaultTarget = currentCanvas || windowEvents;
    if (input.type === "pointerlocklost") {
      releaseNativePointerLock(true);
      continue;
    }
    if (input.type === "pointerleave") {
      pointerInside = false;
      if (!native.overlayOpen?.()) {
        const properties = {
          clientX: input.x, clientY: input.y, pageX: input.x, pageY: input.y, x: input.x, y: input.y,
          button: -1, buttons: mouseButtons, pointerId: 1, pointerType: "mouse", isPrimary: true,
          shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, altKey: input.altKey,
        };
        dispatchToCanvasAndWindow(() => eventWith("pointerout", properties));
        dispatchToCanvasAndWindow(() => eventWith("pointerleave", properties));
        dispatchToCanvasAndWindow(() => eventWith("mouseout", properties));
        dispatchToCanvasAndWindow(() => eventWith("mouseleave", properties));
      }
      continue;
    }
    if (input.type === "pointercancel") {
      const captureTarget = pointerCaptureTargets.get(1);
      const target = captureTarget || defaultTarget;
      const properties = {
        clientX: input.x, clientY: input.y, pageX: input.x, pageY: input.y, x: input.x, y: input.y,
        button: -1, buttons: 0, pointerId: 1, pointerType: "mouse", isPrimary: true,
        shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, altKey: input.altKey,
      };
      target.dispatchEvent(eventWith("pointercancel", properties));
      captureTarget?.releasePointerCapture(1);
      mouseButtons = 0;
      continue;
    }
    if (input.type === "wheel" || input.type === "wheelhorizontal") {
      if (native.overlayOpen?.()) {
        if (input.type === "wheel") native.overlayWheel?.(input.code);
        continue;
      }
      dispatchToCanvasAndWindow(() => eventWith("wheel", {
        clientX: input.x, clientY: input.y, pageX: input.x, pageY: input.y, x: input.x, y: input.y,
        deltaX: input.type === "wheelhorizontal" ? input.code : 0,
        deltaY: input.type === "wheel" ? -input.code : 0, deltaZ: 0, deltaMode: 0,
        buttons: mouseButtons, shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, altKey: input.altKey,
      }));
      continue;
    }
    if (input.type.startsWith("pointer")) {
      const pointerType = input.type === "pointerdoubleclick" ? "pointerdown" : input.type;
      const button = input.code === 1 ? 0 : input.code === 2 ? 2 : input.code === 4 ? 1 : input.code === 5 ? 3 : input.code === 6 ? 4 : -1;
      const bit = button === 0 ? 1 : button === 2 ? 2 : button === 1 ? 4 : button === 3 ? 8 : button === 4 ? 16 : 0;
      if (pointerType === "pointerdown") mouseButtons |= bit;
      if (pointerType === "pointerup") mouseButtons &= ~bit;
      if (input.type === "pointerdoubleclick") doubleClickButton = button;
      const movementX = Number.isFinite(input.movementX) ? input.movementX : input.x - lastMouseX;
      const movementY = Number.isFinite(input.movementY) ? input.movementY : input.y - lastMouseY;
      lastMouseX = input.x;
      lastMouseY = input.y;
      if (native.overlayOpen?.()) {
        if (pointerType === "pointermove") native.overlayPointerMove?.(input.x, input.y);
        if (pointerType === "pointerup") native.overlayClick(input.x, input.y);
        continue;
      }
      if (!pointerInside) {
        pointerInside = true;
        const enterProperties = {
          clientX: input.x, clientY: input.y, pageX: input.x, pageY: input.y, x: input.x, y: input.y,
          button: -1, buttons: mouseButtons, pointerId: 1, pointerType: "mouse", isPrimary: true,
          shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, altKey: input.altKey,
        };
        dispatchToCanvasAndWindow(() => eventWith("pointerover", enterProperties));
        dispatchToCanvasAndWindow(() => eventWith("pointerenter", enterProperties));
        dispatchToCanvasAndWindow(() => eventWith("mouseover", enterProperties));
        dispatchToCanvasAndWindow(() => eventWith("mouseenter", enterProperties));
      }
      const properties = {
        clientX: input.x, clientY: input.y, pageX: input.x, pageY: input.y, x: input.x, y: input.y,
        screenX: input.x, screenY: input.y, offsetX: input.x, offsetY: input.y,
        movementX, movementY, button, buttons: mouseButtons, pointerId: 1,
        pointerType: "mouse", isPrimary: true, width: 1, height: 1,
        pressure: mouseButtons ? 0.5 : 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0,
        detail: input.type === "pointerdoubleclick" || (pointerType === "pointerup" && doubleClickButton === button) ? 2 : 1,
        shiftKey: input.shiftKey, ctrlKey: input.ctrlKey, altKey: input.altKey,
      };
      const captureTarget = pointerCaptureTargets.get(1);
      const target = captureTarget || defaultTarget;
      target.dispatchEvent(eventWith(pointerType, properties));
      const mouseType = pointerType === "pointermove" ? "mousemove" : pointerType === "pointerdown" ? "mousedown" : "mouseup";
      target.dispatchEvent(eventWith(mouseType, properties));
      if (pointerType === "pointerup") {
        const clickType = button === 0 ? "click" : "auxclick";
        target.dispatchEvent(eventWith(clickType, properties));
        if (button === 2) target.dispatchEvent(eventWith("contextmenu", properties));
        if (doubleClickButton === button) {
          target.dispatchEvent(eventWith("dblclick", properties));
          doubleClickButton = -1;
        }
        captureTarget?.releasePointerCapture(1);
      }
      continue;
    }
    if (input.type === "keydown") pressedKeys.add(input.code);
    const overlayChordDown = pressedKeys.has(9) && pressedKeys.has(16);
    if (overlayChordDown && !overlayChordActive) {
      overlayChordActive = true;
      releaseNativePointerLock();
      const open = !native.overlayOpen();
      const accepted = native.setOverlay(open);
      if (process.env.THREEBROWSER_TRACE_INPUT) console.error("overlay chord", { open, accepted, active: native.overlayOpen() });
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
  globalThis.screen.width = globalThis.screen.availWidth = state.width;
  globalThis.screen.height = globalThis.screen.availHeight = state.height;
  if (currentCanvas) {
    currentCanvas.clientWidth = currentCanvas.width = state.width;
    currentCanvas.clientHeight = currentCanvas.height = state.height;
    currentCanvas.dispatchEvent(new Event("resize"));
  }
  globalThis.dispatchEvent(new Event("resize"));
}

function pump() {
  if (!running) return;
  // Frameworks such as React create the renderer from a deferred effect.  A
  // browser keeps its event loop alive while that work is pending; exiting on
  // the first pump made production Vite applications disappear before their
  // first effect could construct WebGLRenderer.
  if (!native.isOpen()) {
    if (performance.now() < startupDeadline) {
      setTimeout(pump, 1);
      return;
    }
    stop();
    // Closing the native window is the runtime's equivalent of closing a
    // browser tab. Page timers must not keep the headless JS process alive.
    setImmediate(() => process.exit(0));
    return;
  }
  if (process.env.THREEBROWSER_TRACE_RENDER && performance.now() >= nextTraceFrame) {
    nextTraceFrame = performance.now() + 1000;
    console.error("ThreeBrowser render stats", {
      ...native.stats(),
      animationCallbacks: frameCallbacks.size,
      workers: [...activeWorkers].map(worker => ({
        url: worker.url.href.slice(0, 80),
        sent: worker.sentCount,
        received: worker.receivedCount,
        fetch: `${worker.fetchResponseCount}/${worker.fetchRequestCount}`,
        decode: `${worker.decodeResponseCount}/${worker.decodeRequestCount}`,
      })),
      rendererCalls: globalThis.__threeBrowserRendererCalls || 0,
      renderTargets: globalThis.__threeBrowserRenderTargets || null,
      nativeScene: native.debugScene?.() || "",
      sceneCandidates: [...(globalThis.__threeBrowserSceneCandidates?.values?.() || [])].slice(-12),
    }, "lastError:", native.lastError());
  }
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
  startupDeadline = performance.now() + nativeStartupTimeout;
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
  const snapshot = Object.create(null);
  Object.defineProperties(snapshot, Object.getOwnPropertyDescriptors(globalThis.THREE));
  globalThis.__threeBrowserNativeThree = snapshot;
  return globalThis.THREE;
}

export async function loadEntry(entryPath) {
  lastUnhandledEventError = null;
  const absolute = path.resolve(entryPath);
  globalThis.location = new URL(pathToFileURL(absolute));
  if (!absolute.toLowerCase().endsWith(".html")) {
    configureModuleFile(absolute);
    const manifestPath = path.join(path.dirname(absolute), "threebrowser.pull.json");
    if (fs.existsSync(manifestPath)) {
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
      catch (error) { throw new Error(`Invalid pull manifest in ${manifestPath}: ${error.message}`); }
      pulledSourceURL = manifest.source ? new URL(manifest.source) : null;
      pulledDirectory = path.dirname(absolute);
      pulledFiles = new Map((manifest.files || []).map(file => [new URL(file.url).href, file.path]));
      const fallbackId = path.basename(pulledDirectory).replace(/[^a-z0-9-]/gi, "-").slice(-40).toLowerCase() || "project";
      pulledVirtualURL = new URL(manifest.virtualURL || `https://${fallbackId}.runtime.threebrowser.local/`);
      const manifestFiles = manifest.files || [];
      pulledVirtualFiles = new Map(manifestFiles.map(file => [
        new URL(String(file.path).replaceAll("\\", "/"), pulledVirtualURL).href,
        file.path,
      ]));
      // Production bundles sometimes retain a document-relative asset string
      // after Vite moved the actual file beneath /assets. Give unique
      // basenames a virtual-root alias without changing the downloaded code.
      const basenameCounts = new Map();
      for (const file of manifestFiles) {
        const basename = path.posix.basename(String(file.path).replaceAll("\\", "/"));
        basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
      }
      for (const file of manifestFiles) {
        const basename = path.posix.basename(String(file.path).replaceAll("\\", "/"));
        if (basenameCounts.get(basename) === 1) pulledVirtualFiles.set(new URL(basename, pulledVirtualURL).href, file.path);
      }
      // Preserve the address the browser originally exposed. A root document
      // served as index.html still has `/` as its location; using
      // `/index.html` here breaks applications that concatenate
      // `location.href + "assets/..."`.
      const sourcePage = pulledSourceURL
        ? `${pulledSourceURL.pathname}${pulledSourceURL.search}${pulledSourceURL.hash}`
        : (manifest.html || "index.html");
      globalThis.location = new URL(sourcePage, pulledVirtualURL);
      if (!manifest.requiresWebGPU && manifest.compatibility?.threeMode === "bundled") {
        throw new Error(
          "Native launch cannot bind this site's opaque bundled WebGL renderer. " +
          "Use its source project or source maps, or rebuild it with Three.js externalized."
        );
      }
      if (manifest.requiresWebGPU) await enableWebGPU();
    }
    const loaded = await import(pathToFileURL(absolute));
    document.readyState = "interactive";
    document.dispatchEvent(new Event("DOMContentLoaded"));
    document.readyState = "complete";
    globalThis.dispatchEvent(new Event("load"));
    if (!native.isOpen() && lastUnhandledEventError) throw lastUnhandledEventError;
    return loaded;
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
  document.readyState = "interactive";
  document.dispatchEvent(new Event("DOMContentLoaded"));
  document.readyState = "complete";
  globalThis.dispatchEvent(new Event("load"));
}

process.once("SIGINT", () => { stop(); process.exit(0); });
process.once("exit", () => { if (native.isOpen()) native.shutdown(); });
