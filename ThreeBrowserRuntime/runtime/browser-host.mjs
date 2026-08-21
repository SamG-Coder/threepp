import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
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
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this.textContent = "";
    this.id = "";
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, force) => force === undefined ? (classes.has(name) ? (classes.delete(name), false) : (classes.add(name), true)) : (force ? (classes.add(name), true) : (classes.delete(name), false)),
    };
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  append(...children) { for (const child of children) this.appendChild(child); }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(name, value) { this[name] = String(value); }
  getAttribute(name) { return this[name] ?? null; }
  querySelector() { return null; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  requestPointerLock() { document.pointerLockElement = this; document.dispatchEvent(new Event("pointerlockchange")); }
}

class CanvasElement extends Element {
  constructor() {
    super("canvas");
    this.width = 1280;
    this.height = 720;
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.tabIndex = 0;
  }
  focus() { document.activeElement = this; }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight,
      width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  getContext() { return null; }
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
  createElement(tag) { return String(tag).toLowerCase() === "canvas" ? new CanvasElement() : new Element(tag); },
  createElementNS(_namespace, tag) { return this.createElement(tag); },
  getElementById(id) {
    const walk = node => node.id === id ? node : node.children.map(walk).find(Boolean);
    return walk(body) || walk(head) || null;
  },
  querySelector(selector) {
    if (selector === "canvas") return currentCanvas;
    return null;
  },
  exitPointerLock() { this.pointerLockElement = null; this.dispatchEvent(new Event("pointerlockchange")); },
});

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
globalThis.HTMLCanvasElement = CanvasElement;
globalThis.OffscreenCanvas = CanvasElement;

const windowEvents = new BrowserEventTarget();
globalThis.addEventListener = windowEvents.addEventListener.bind(windowEvents);
globalThis.removeEventListener = windowEvents.removeEventListener.bind(windowEvents);
globalThis.dispatchEvent = windowEvents.dispatchEvent.bind(windowEvents);

function hostObject() {
  return {
    RuntimeStart: (width, height, title) => native.start(width, height, title),
    RuntimeSetSize: (width, height) => native.resize(width, height),
    RuntimeRender: () => 1,
    BackendName: () => native.backendName(),
    LastError: () => native.lastError(),
    CmdSubmitBuffer: data => native.submit(data),
    RendererSetToneMapping: (mode, exposure) => native.setToneMapping(mode, exposure),
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
    16: "Shift", 17: "Control", 18: "Alt", 13: "Enter" })[code] || `Key${code}`;
}

function physicalKeyCode(code) {
  if (code >= 65 && code <= 90) return `Key${String.fromCharCode(code)}`;
  if (code >= 48 && code <= 57) return `Digit${String.fromCharCode(code)}`;
  return ({ 27: "Escape", 32: "Space", 37: "ArrowLeft", 38: "ArrowUp", 39: "ArrowRight", 40: "ArrowDown",
    16: "ShiftLeft", 17: "ControlLeft", 18: "AltLeft", 13: "Enter" })[code] || `Key${code}`;
}

let mouseButtons = 0;
let lastMouseX = 0;
let lastMouseY = 0;

function dispatchToCanvasAndWindow(eventFactory) {
  if (currentCanvas) currentCanvas.dispatchEvent(eventFactory());
  windowEvents.dispatchEvent(eventFactory());
}

function dispatchNativeInput() {
  for (const input of native.pollInput()) {
    const target = currentCanvas || windowEvents;
    if (input.type === "wheel") {
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
      const movementX = input.x - lastMouseX;
      const movementY = input.y - lastMouseY;
      lastMouseX = input.x;
      lastMouseY = input.y;
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
    const properties = { key: keyName(input.code), code: physicalKeyCode(input.code), keyCode: input.code, repeat: false };
    if (document.activeElement) document.activeElement.dispatchEvent(eventWith(input.type, properties));
    windowEvents.dispatchEvent(eventWith(input.type, properties));
    if (input.type === "keydown" && input.code === 27) stop();
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
