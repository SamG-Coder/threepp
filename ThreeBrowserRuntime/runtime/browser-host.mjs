import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";
import { configureModuleDocument, configureModuleFile } from "./module-loader.mjs";
import { HtmlInteractionBridge } from "./html-interaction-bridge.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const addonPath = process.env.THREEBROWSER_RUNTIME_ADDON || path.join(here, "..", "three_browser_runtime.node");
export const native = require(addonPath);
let lastUnhandledEventError = null;
let bootstrapReadySignalled = false;

function signalBootstrapReady() {
  const readyFile = process.env.THREEBROWSER_READY_FILE;
  if (bootstrapReadySignalled || !readyFile || Number(native.stats()?.presents || 0) < 1) return true;
  const pendingFile = `${readyFile}.${process.pid}.pending`;
  try {
    fs.writeFileSync(pendingFile, JSON.stringify({
      pid: process.pid,
      backend: native.backendName?.() || "unknown",
      presentedAt: new Date().toISOString(),
      presents: Number(native.stats()?.presents || 0),
    }), { encoding: "utf8", flag: "wx" });
    if (native.reveal?.() === false) throw new Error("the native runtime window could not be revealed");
    fs.renameSync(pendingFile, readyFile);
    bootstrapReadySignalled = true;
    return true;
  } catch (error) {
    try { fs.unlinkSync(pendingFile); } catch {}
    if (error?.code === "EEXIST" && fs.existsSync(readyFile)) {
      native.reveal?.();
      bootstrapReadySignalled = true;
      return true;
    }
    bootstrapReadySignalled = true;
    console.error(`ThreeBrowser bootstrap readiness signal failed: ${error?.message || error}`);
    return false;
  }
}

class BrowserEventTarget {
  constructor() { this._eventListeners = new Map(); }
  addEventListener(type, listener, options = {}) {
    if (!listener) return;
    const key = String(type);
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const listeners = this._eventListeners.get(key) || [];
    if (!listeners.some(entry => entry.listener === listener && entry.capture === capture)) {
      listeners.push({ listener, capture, once: Boolean(typeof options === "object" && options.once) });
      this._eventListeners.set(key, listeners);
    }
  }
  removeEventListener(type, listener, options = {}) {
    const key = String(type);
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const listeners = this._eventListeners.get(key);
    if (!listeners) return;
    this._eventListeners.set(key, listeners.filter(entry => entry.listener !== listener || entry.capture !== capture));
  }
  dispatchEvent(event) {
    if (!event?.type) throw new TypeError("Event object requires a type");
    const path = [this];
    const visited = new Set(path);
    for (let parent = this.parentNode; parent && !visited.has(parent); parent = parent.parentNode) {
      path.push(parent);
      visited.add(parent);
    }
    try { Object.defineProperty(event, "target", { configurable: true, value: this }); } catch {}
    const invoke = (currentTarget, capture) => {
      try { Object.defineProperty(event, "currentTarget", { configurable: true, value: currentTarget }); } catch {}
      for (const entry of [...(currentTarget._eventListeners?.get(String(event.type)) || [])]) {
        if (entry.capture !== capture) continue;
        try {
          if (typeof entry.listener === "function") entry.listener.call(currentTarget, event);
          else entry.listener.handleEvent?.(event);
        } catch (error) {
          lastUnhandledEventError = error;
          console.error(`Unhandled ${event.type} event listener error:`, error);
        }
        if (entry.once) currentTarget.removeEventListener(event.type, entry.listener, { capture });
      }
      if (!capture && !event.cancelBubble) {
        const handler = currentTarget?.[`on${event.type}`];
        if (typeof handler === "function") {
          try {
            if (handler.call(currentTarget, event) === false) event.preventDefault?.();
          } catch (error) {
            lastUnhandledEventError = error;
            console.error(`Unhandled on${event.type} event listener error:`, error);
          }
        }
      }
    };
    for (let index = path.length - 1; index > 0 && !event.cancelBubble; --index) invoke(path[index], true);
    if (!event.cancelBubble) {
      invoke(this, true);
      invoke(this, false);
    }
    if (event.bubbles) {
      for (let index = 1; index < path.length && !event.cancelBubble; ++index) invoke(path[index], false);
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
  get value() { return this._value ?? ""; }
  set value(value) { this._value = String(value ?? ""); }
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
      set: (target, property, value) => {
        target[property] = value;
        this._styleChanged?.();
        return true;
      },
      deleteProperty: (target, property) => {
        delete target[property];
        this._styleChanged?.();
        return true;
      },
    });
    this.dataset = {};
    this._attributes = new Map();
    // React's document hydration retains this live collection while removing
    // attributes from the html/head/body singleton elements.
    this.attributes = new Proxy([], {
      get: (_target, property) => {
        const values = [...this._attributes].map(([name, value]) => ({ name, value, nodeName: name, nodeValue: value, ownerElement: this }));
        if (property === "item") return index => values[index] ?? null;
        if (property === "getNamedItem") return name => values.find(attribute => attribute.name === name) ?? null;
        const result = Reflect.get(values, property);
        return typeof result === "function" ? result.bind(values) : result;
      },
    });
    this.children = [];
    this.parentNode = null;
    this._textContent = "";
    this._innerHTML = "";
    Object.defineProperties(this, {
      childNodes: { get: () => this.children },
      parentElement: { get: () => this.parentNode },
      firstChild: { get: () => this.children[0] ?? null },
      lastChild: { get: () => this.children.at(-1) ?? null },
      firstElementChild: { get: () => this.children.find(child => child.nodeType === 1) ?? null },
      lastElementChild: { get: () => this.children.findLast(child => child.nodeType === 1) ?? null },
      childElementCount: { get: () => this.children.filter(child => child.nodeType === 1).length },
      textContent: {
        configurable: true,
        get: () => this.nodeType === 3 ? this._textContent :
          `${this._textContent}${this.children.map(child => child.textContent ?? "").join("")}`,
        set: value => {
          for (const child of this.children) demotePresentedCanvasTree(child);
          for (const child of this.children) child.parentNode = null;
          this.children.length = 0;
          this._innerHTML = "";
          this._textContent = String(value ?? "");
        },
      },
    });
    this.ownerDocument = globalThis.document ?? null;
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
    if (this.tagName === "INPUT") {
      this.type = "text";
      this.value = "";
      this.checked = false;
    } else if (this.tagName === "TEXTAREA" || this.tagName === "SELECT" || this.tagName === "OPTION") {
      this.value = "";
    } else if (this.tagName === "BUTTON") {
      this.type = "submit";
    }
    if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION"].includes(this.tagName)) {
      this.disabled = false;
      this.required = false;
    }
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
      promotePresentedCanvasTree(node);
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
    demotePresentedCanvasTree(child);
    child.parentNode = null;
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) {
      demotePresentedCanvasTree(child);
      child.parentNode = null;
    }
    this.children.length = 0;
    this._innerHTML = "";
    this.append(...children);
  }
  replaceChild(replacement, child) {
    const index = this.children.indexOf(child);
    if (index < 0) throw new Error("Node to replace is not a child");
    if (replacement.parentNode) replacement.parentNode.removeChild(replacement);
    demotePresentedCanvasTree(child);
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
    } else if (["disabled", "required", "checked", "selected", "multiple", "hidden", "autofocus"].includes(normalized)) {
      this[normalized] = true;
    } else this[normalized] = String(value);
  }
  setAttributeNS(_namespace, name, value) { this.setAttribute(name, value); }
  getAttribute(name) { return this._attributes.get(String(name).toLowerCase()) ?? null; }
  getAttributeNS(_namespace, name) { return this.getAttribute(name); }
  getAttributeNames() { return [...this._attributes.keys()]; }
  removeAttributeNode(attribute) {
    if (attribute?.ownerElement !== this || !this.hasAttribute(attribute.name)) {
      throw new DOMException("Attribute does not belong to this element", "NotFoundError");
    }
    this.removeAttribute(attribute.name);
    return attribute;
  }
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
    } else if (["disabled", "required", "checked", "selected", "multiple", "hidden", "autofocus"].includes(normalized)) {
      this[normalized] = false;
    } else delete this[normalized];
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
    parseHtmlFragment(this, this._innerHTML);
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
      for (const child of node?.children || []) {
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
  focus() {
    if (this.disabled) return;
    const previous = this.ownerDocument?.activeElement;
    if (previous === this) return;
    previous?.dispatchEvent?.(new Event("blur", { bubbles: false }));
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
    this.dispatchEvent(new Event("focus", { bubbles: false }));
  }
  blur() {
    if (this.ownerDocument?.activeElement !== this) return;
    this.ownerDocument.activeElement = null;
    this.dispatchEvent(new Event("blur", { bubbles: false }));
  }
  get form() { return this.closest?.("form") ?? null; }
  requestSubmit(submitter = null) {
    if (this.tagName !== "FORM") return this.form?.requestSubmit?.(submitter ?? this);
    const event = new Event("submit", { bubbles: true, cancelable: true });
    try { Object.defineProperty(event, "submitter", { configurable: true, value: submitter }); } catch {}
    return this.dispatchEvent(event);
  }
  submit() { return this.tagName === "FORM" ? true : this.form?.submit?.(); }
  click() {
    if (this.disabled) return false;
    if (this.tagName === "INPUT" && this.type === "checkbox") this.checked = !this.checked;
    if (this.tagName === "INPUT" && this.type === "radio") {
      const name = String(this.name || this.getAttribute("name") || "");
      if (name) {
        for (const radio of this.ownerDocument?.querySelectorAll?.("input") || []) {
          if (radio !== this && radio.type === "radio" && String(radio.name || radio.getAttribute("name") || "") === name) radio.checked = false;
        }
      }
      this.checked = true;
    }
    const accepted = this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    const type = String(this.type || this.getAttribute("type") || "").toLowerCase();
    if (accepted && (this.tagName === "BUTTON" || this.tagName === "INPUT") && type === "submit") this.form?.requestSubmit?.(this);
    return accepted;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  requestPointerLock(options = undefined) { return requestNativePointerLock(this, options); }
}

const htmlVoidElements = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);

function decodeHtmlText(value) {
  return String(value).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity) => {
    const normalized = entity.toLowerCase();
    if (normalized === "amp") return "&";
    if (normalized === "lt") return "<";
    if (normalized === "gt") return ">";
    if (normalized === "quot") return '"';
    if (normalized === "apos") return "'";
    if (normalized === "nbsp") return "\u00a0";
    const radix = normalized.startsWith("#x") ? 16 : 10;
    const codePoint = Number.parseInt(normalized.slice(radix === 16 ? 2 : 1), radix);
    try { return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match; } catch { return _match; }
  });
}

function parseHtmlFragment(parent, html) {
  for (const child of parent.children || []) demotePresentedCanvasTree(child);
  for (const child of parent.children || []) child.parentNode = null;
  parent.children.length = 0;
  parent._textContent = "";
  const stack = [parent];
  const tokens = String(html).match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^>]*>|[^<]+/g) || [];
  for (const token of tokens) {
    if (token.startsWith("<!--") || /^<!/i.test(token)) continue;
    if (!token.startsWith("<")) {
      if (!token) continue;
      const text = stack.at(-1).ownerDocument?.createTextNode?.(decodeHtmlText(token)) ?? new Element("#text");
      if (text.nodeType === 3 && !text._textContent) text._textContent = decodeHtmlText(token);
      stack.at(-1).appendChild(text);
      continue;
    }
    const closing = /^<\s*\//.test(token);
    const name = /^<\s*\/?\s*([a-zA-Z][\w:-]*)/.exec(token)?.[1]?.toLowerCase();
    if (!name) continue;
    if (closing) {
      const index = stack.findLastIndex(node => node.tagName?.toLowerCase() === name);
      if (index > 0) stack.length = index;
      continue;
    }
    const attributes = token.slice(token.indexOf(name) + name.length, token.lastIndexOf(">"));
    const element = parent.ownerDocument?.createElement?.(name) ?? new Element(name);
    for (const match of attributes.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      element.setAttribute(match[1], decodeHtmlText(match[2] ?? match[3] ?? match[4] ?? ""));
    }
    stack.at(-1).appendChild(element);
    if (!htmlVoidElements.has(name) && !/\/\s*>$/.test(token)) stack.push(element);
  }
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

function canvasBitmapDimension(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(0xffffffff, Math.trunc(number)));
}

function rgbaByteView(value) {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function clampedPixelCopy(value, expectedLength = -1) {
  const bytes = rgbaByteView(value);
  const length = expectedLength < 0 ? (bytes?.byteLength || 0) : expectedLength;
  const result = new Uint8ClampedArray(length);
  if (bytes) result.set(bytes.subarray(0, length));
  return result;
}

class BrowserImageData {
  constructor(dataOrWidth, widthOrHeight, heightOrSettings) {
    if (typeof dataOrWidth === "number") {
      const width = Math.trunc(Number(dataOrWidth));
      const height = Math.trunc(Number(widthOrHeight));
      if (!(width > 0 && height > 0)) throw new RangeError("ImageData dimensions must be greater than zero");
      this.data = new Uint8ClampedArray(width * height * 4);
      this.width = width;
      this.height = height;
    } else {
      if (!(dataOrWidth instanceof Uint8ClampedArray)) {
        throw new TypeError("ImageData pixels must be a Uint8ClampedArray");
      }
      const width = Math.trunc(Number(widthOrHeight));
      let height = typeof heightOrSettings === "number"
        ? Math.trunc(Number(heightOrSettings))
        : dataOrWidth.length / (Math.max(1, width) * 4);
      height = Math.trunc(height);
      if (!(width > 0 && height > 0) || dataOrWidth.length !== width * height * 4) {
        throw new RangeError("ImageData dimensions do not match the pixel array");
      }
      this.data = dataOrWidth;
      this.width = width;
      this.height = height;
    }
    this.colorSpace = "srgb";
  }
}

class BrowserCanvasGradient {
  constructor(surface, x0, y0, x1, y1) {
    this._nativeGradient = native.canvas2dGradientCreate(surface, x0, y0, x1, y1);
  }
  addColorStop(offset, color) {
    const normalizedOffset = Number(offset);
    if (!Number.isFinite(normalizedOffset) || normalizedOffset < 0 || normalizedOffset > 1) {
      throw new RangeError("Canvas gradient offsets must be between zero and one");
    }
    if (native.canvas2dGradientAddColorStop(this._nativeGradient, normalizedOffset, String(color)) === false) {
      throw new TypeError("Invalid canvas gradient color: " + color);
    }
  }
}

const canvas2dImageSurfaceCache = new WeakMap();
const canvas2dNativeProperties = new Set([
  "fillStyle", "strokeStyle", "font", "textAlign", "textBaseline",
  "lineCap", "lineJoin", "filter", "globalAlpha", "lineWidth", "miterLimit",
]);
const canvas2dDefaultState = Object.freeze({
  fillStyle: "#000000",
  strokeStyle: "#000000",
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  lineCap: "butt",
  lineJoin: "miter",
  filter: "none",
  globalAlpha: 1,
  lineWidth: 1,
  miterLimit: 10,
  globalCompositeOperation: "source-over",
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "low",
  lineDashOffset: 0,
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  direction: "inherit",
});

class Canvas2DContext {
  constructor(canvas) {
    this.canvas = canvas;
    this._nativeSurface = null;
    this._stateStack = [];
    this._resetState();
  }
  _resetState() {
    this._state = { ...canvas2dDefaultState };
    this._lineDash = [];
    this._stateStack.length = 0;
  }
  _surface() {
    if (this._nativeSurface === null) {
      this._nativeSurface = native.canvas2dCreate(this.canvas.width, this.canvas.height);
    }
    return this._nativeSurface;
  }
  _resize(width, height) {
    if (this._nativeSurface !== null) native.canvas2dResize(this._nativeSurface, width, height);
    this._resetState();
    this.canvas._scheduleOverlayPresent?.();
  }
  _setProperty(property, value) {
    let normalized = value;
    if (property === "fillStyle" || property === "strokeStyle") {
      if (value instanceof BrowserCanvasGradient) {
        if (native.canvas2dSetGradient(this._surface(), property, value._nativeGradient) === false) return;
        this._state[property] = value;
        return;
      }
      normalized = String(value);
    } else if (["font", "textAlign", "textBaseline", "lineCap", "lineJoin", "filter"].includes(property)) {
      normalized = String(value);
    } else if (["globalAlpha", "lineWidth", "miterLimit", "lineDashOffset", "shadowBlur", "shadowOffsetX", "shadowOffsetY"].includes(property)) {
      normalized = Number(value);
      if (!Number.isFinite(normalized)) return;
    } else if (property === "imageSmoothingEnabled") {
      normalized = Boolean(value);
    } else {
      normalized = String(value);
    }
    if (canvas2dNativeProperties.has(property) &&
        native.canvas2dSet(this._surface(), property, normalized) === false) return;
    this._state[property] = normalized;
  }
  _call(operation, ...args) {
    while (args.length && args.at(-1) === undefined) args.pop();
    native.canvas2dCall(this._surface(), operation,
      ...args.map(value => typeof value === "boolean" ? (value ? 1 : 0) : value));
    this.canvas._scheduleOverlayPresent?.();
  }
  _imageSurface(image) {
    if (image instanceof CanvasElement) return image._surface();
    if (image instanceof Canvas2DContext) return image._surface();
    if (typeof image?._surface === "function") return image._surface();
    const pixels = image?.data ?? image?.pixels;
    const width = canvasBitmapDimension(image?.width ?? image?.naturalWidth);
    const height = canvasBitmapDimension(image?.height ?? image?.naturalHeight);
    if (!pixels || !width || !height) throw new TypeError("drawImage source has no decoded RGBA pixels");
    const expectedLength = width * height * 4;
    let bytes = rgbaByteView(pixels);
    if (!bytes) throw new TypeError("drawImage source pixels must be an ArrayBuffer view");
    if (bytes.byteLength < expectedLength) bytes = clampedPixelCopy(bytes, expectedLength);
    if (image instanceof ImageElement) {
      const cached = canvas2dImageSurfaceCache.get(image);
      if (cached?.pixels === pixels && cached.width === width && cached.height === height) return cached.surface;
      const surface = native.canvas2dCreate(width, height, bytes);
      canvas2dImageSurfaceCache.set(image, { pixels, width, height, surface });
      return surface;
    }
    // ImageData and plain RGBA objects are mutable; snapshot them for each draw.
    return native.canvas2dCreate(width, height, bytes);
  }
  _readPixels(x = 0, y = 0, width = this.canvas.width, height = this.canvas.height) {
    width = Math.max(0, Math.trunc(Number(width) || 0));
    height = Math.max(0, Math.trunc(Number(height) || 0));
    if (!width || !height) return new Uint8ClampedArray();
    return clampedPixelCopy(native.canvas2dReadPixels(
      this._surface(), Math.trunc(Number(x) || 0), Math.trunc(Number(y) || 0), width, height,
    ), width * height * 4);
  }
  get pixels() {
    return this._readPixels();
  }
  save() {
    this._call("save");
    this._stateStack.push({ state: { ...this._state }, lineDash: [...this._lineDash] });
  }
  restore() {
    this._call("restore");
    const saved = this._stateStack.pop();
    if (saved) {
      this._state = saved.state;
      this._lineDash = saved.lineDash;
    }
  }
  createLinearGradient(x0, y0, x1, y1) {
    return new BrowserCanvasGradient(this._surface(), Number(x0), Number(y0), Number(x1), Number(y1));
  }
  createRadialGradient(x0, y0, _r0, x1, y1) {
    return this.createLinearGradient(x0, y0, x1, y1);
  }
  createPattern() { return null; }
  createImageData(widthOrImageData, height) {
    if (typeof widthOrImageData === "object") {
      return new BrowserImageData(widthOrImageData.width, widthOrImageData.height);
    }
    return new BrowserImageData(Math.abs(Math.trunc(Number(widthOrImageData))), Math.abs(Math.trunc(Number(height))));
  }
  getImageData(x, y, width, height) {
    x = Math.trunc(Number(x) || 0);
    y = Math.trunc(Number(y) || 0);
    width = Math.trunc(Number(width) || 0);
    height = Math.trunc(Number(height) || 0);
    if (!width || !height) throw new RangeError("getImageData dimensions must be non-zero");
    if (width < 0) { x += width; width = -width; }
    if (height < 0) { y += height; height = -height; }
    return new BrowserImageData(this._readPixels(x, y, width, height), width, height);
  }
  putImageData(imageData, dx, dy, ...dirty) {
    if (!imageData?.data || !Number.isFinite(Number(imageData.width)) || !Number.isFinite(Number(imageData.height))) {
      throw new TypeError("putImageData expects an ImageData-like object");
    }
    const pixels = rgbaByteView(imageData.data);
    if (!pixels) throw new TypeError("putImageData pixels must be an ArrayBuffer view");
    native.canvas2dWritePixels(
      this._surface(), pixels, Math.trunc(imageData.width), Math.trunc(imageData.height),
      Math.trunc(Number(dx) || 0), Math.trunc(Number(dy) || 0), ...dirty.map(value => Math.trunc(Number(value) || 0)),
    );
    this.canvas._scheduleOverlayPresent?.();
  }
  drawImage(image, ...args) {
    native.canvas2dDrawImage(this._surface(), this._imageSurface(image), ...args.map(Number));
    this.canvas._scheduleOverlayPresent?.();
  }
  measureText(text) {
    const metrics = native.canvas2dMeasureText(this._surface(), String(text));
    return typeof metrics === "number" ? { width: metrics } : metrics;
  }
  setLineDash(segments) {
    const normalized = Array.from(segments || [], Number);
    if (normalized.some(value => !Number.isFinite(value) || value < 0)) throw new RangeError("Invalid line dash segment");
    this._call("setLineDash", ...normalized);
    this._lineDash = normalized.length % 2 ? [...normalized, ...normalized] : normalized;
  }
  getLineDash() { return [...this._lineDash]; }
  fill(fillRule = "nonzero") { this._call(fillRule === "evenodd" ? "fillEvenOdd" : "fill"); }
  clip(fillRule = "nonzero") { this._call(fillRule === "evenodd" ? "clipEvenOdd" : "clip"); }
  reset() { this._resize(this.canvas.width, this.canvas.height); }
}

for (const property of Object.keys(canvas2dDefaultState)) {
  Object.defineProperty(Canvas2DContext.prototype, property, {
    configurable: true,
    enumerable: true,
    get() { return this._state[property]; },
    set(value) { this._setProperty(property, value); },
  });
}

for (const operation of [
  "scale", "rotate", "translate", "transform", "setTransform", "resetTransform",
  "clearRect", "fillRect", "strokeRect", "beginPath", "closePath", "moveTo", "lineTo",
  "bezierCurveTo", "quadraticCurveTo", "arc", "arcTo", "ellipse", "rect", "roundRect",
  "stroke", "fillText", "strokeText",
]) {
  Object.defineProperty(Canvas2DContext.prototype, operation, {
    configurable: true,
    value(...args) { this._call(operation, ...args); },
  });
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
  constructor(width = 1280, height = 720) {
    super("canvas");
    this._canvasWidth = canvasBitmapDimension(width, 1280);
    this._canvasHeight = canvasBitmapDimension(height, 720);
    this.clientWidth = this._canvasWidth;
    this.clientHeight = this._canvasHeight;
    this.tabIndex = 0;
    this.context2d = null;
    this.contextWebgl = null;
    this.contextWebgl2 = null;
    this._overlayPresentScheduled = false;
  }
  get width() { return this._canvasWidth; }
  set width(value) {
    this._canvasWidth = canvasBitmapDimension(value);
    this.context2d?._resize(this._canvasWidth, this._canvasHeight);
  }
  get height() { return this._canvasHeight; }
  set height(value) {
    this._canvasHeight = canvasBitmapDimension(value);
    this.context2d?._resize(this._canvasWidth, this._canvasHeight);
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
  _surface() {
    return (this.context2d ??= new Canvas2DContext(this))._surface();
  }
  _styleChanged() {
    this._scheduleOverlayPresent();
  }
  _scheduleOverlayPresent() {
    if (!this._overlayMounted || this._overlayPresentScheduled) return;
    this._overlayPresentScheduled = true;
    queueMicrotask(() => {
      this._overlayPresentScheduled = false;
      presentMountedCanvasOverlay(this);
    });
  }
  _threeBrowserReadPixels() {
    const length = this.width * this.height * 4;
    const data = this.context2d?._readPixels(0, 0, this.width, this.height) || new Uint8ClampedArray(length);
    return { data, width: this.width, height: this.height };
  }
  toDataURL() {
    if (!this.width || !this.height) return "data:,";
    const png = this.toBuffer();
    return "data:image/png;base64," + png.toString("base64");
  }
  toBuffer() {
    if (this._threeBrowserNativeRenderer) {
      globalThis.__TN?.cmd?.submit();
      return Buffer.from(native.rendererCapturePng(this.width, this.height));
    }
    return Buffer.from(native.canvas2dEncodePng(this._surface()));
  }
  toBlob(callback, _type = "image/png", _quality) {
    if (typeof callback !== "function") throw new TypeError("toBlob requires a callback");
    let blob = null;
    if (this.width && this.height) {
      try { blob = new Blob([this.toBuffer()], {type:"image/png"}); } catch { /* encoding failure reports null */ }
    }
    setTimeout(() => callback(blob), 0);
  }
  async convertToBlob() {
    return new Blob([this.toBuffer()], { type: "image/png" });
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

let nextMediaStreamId = 1;
let nextMediaTrackId = 1;
const activeCameraTracks = new Set();

class MediaDeviceInfo {
  constructor({ deviceId = "", label = "", kind = "videoinput", groupId = "" } = {}) {
    this.deviceId = String(deviceId);
    this.label = String(label);
    this.kind = String(kind);
    this.groupId = String(groupId);
  }
  toJSON() {
    return { deviceId: this.deviceId, kind: this.kind, label: this.label, groupId: this.groupId };
  }
}

class MediaStreamTrack extends BrowserEventTarget {
  constructor(opened, constraints = {}) {
    super();
    this.kind = "video";
    this.id = `threebrowser-camera-track-${nextMediaTrackId++}`;
    this.label = String(opened.label || "Windows camera");
    this.enabled = true;
    this.muted = false;
    this.readyState = "live";
    this.contentHint = "motion";
    this._nativeHandle = Number(opened.handle || 0);
    this._constraints = { ...constraints };
    this._settings = {
      deviceId: String(opened.deviceId || ""),
      groupId: "",
      width: Number(opened.width || 0),
      height: Number(opened.height || 0),
      frameRate: Number(opened.frameRate || 0),
      resizeMode: "none",
    };
    const exact = numericConstraint(constraints.frameRate, "exact");
    const maximum = numericConstraint(constraints.frameRate, "max");
    const ideal = numericConstraint(constraints.frameRate, "ideal");
    const deliveryCap = maximum || ideal || 0;
    // Frame dropping can satisfy a maximum or approximate an ideal below the
    // camera cadence. It cannot truthfully manufacture an exact cadence when
    // Media Foundation selected another rate. Unknown rates remain unknown.
    this._deliveryFrameRate = this._settings.frameRate > 0
      ? (!exact && deliveryCap > 0
          ? Math.min(deliveryCap, this._settings.frameRate)
          : this._settings.frameRate)
      : 0;
    if (this._deliveryFrameRate > 0) this._settings.frameRate = this._deliveryFrameRate;
    activeCameraTracks.add(this);
  }
  clone() {
    throw new DOMException("ThreeBrowser camera tracks cannot be cloned", "NotSupportedError");
  }
  getCapabilities() {
    return {
      width: { min: this._settings.width, max: this._settings.width },
      height: { min: this._settings.height, max: this._settings.height },
      frameRate: { min: this._deliveryFrameRate || this._settings.frameRate, max: this._settings.frameRate },
      deviceId: this._settings.deviceId,
    };
  }
  getConstraints() { return { ...this._constraints }; }
  getSettings() { return { ...this._settings }; }
  applyConstraints() {
    return Promise.reject(new DOMException(
      "Camera constraints are fixed when ThreeBrowser opens the Media Foundation source",
      "NotSupportedError",
    ));
  }
  stop() { this._end(true, false); }
  _end(closeNative, emitEvent = true) {
    if (this.readyState === "ended") return;
    this.readyState = "ended";
    const handle = this._nativeHandle;
    this._nativeHandle = 0;
    activeCameraTracks.delete(this);
    if (closeNative && handle) native.cameraClose?.(handle);
    if (emitEvent) this.dispatchEvent(new Event("ended"));
  }
}

class MediaStream extends BrowserEventTarget {
  constructor(tracks = []) {
    super();
    this.id = `threebrowser-camera-stream-${nextMediaStreamId++}`;
    this._tracks = Array.from(tracks);
  }
  get active() { return this._tracks.some(track => track.readyState === "live"); }
  getTracks() { return [...this._tracks]; }
  getVideoTracks() { return this._tracks.filter(track => track.kind === "video"); }
  getAudioTracks() { return []; }
  addTrack(track) {
    if (!(track instanceof MediaStreamTrack)) throw new TypeError("addTrack expects a MediaStreamTrack");
    if (!this._tracks.includes(track)) this._tracks.push(track);
  }
  removeTrack(track) { this._tracks = this._tracks.filter(candidate => candidate !== track); }
  clone() { return new MediaStream(this._tracks.map(track => track.clone())); }
}

class OverconstrainedError extends DOMException {
  constructor(constraint, message) {
    super(message || `Camera constraint ${constraint} cannot be satisfied`, "OverconstrainedError");
    this.constraint = constraint;
  }
}

function constraintValue(value, key) {
  if (value == null) return undefined;
  if (typeof value !== "object") return key === "ideal" ? value : undefined;
  return value[key];
}

function numericConstraint(value, key) {
  const candidate = Number(constraintValue(value, key));
  return Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
}

function requestedNumber(value) {
  return numericConstraint(value, "exact") || numericConstraint(value, "ideal") ||
    numericConstraint(value, "max") || numericConstraint(value, "min") ||
    (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
}

function validateExactCameraConstraints(constraints, settings) {
  for (const name of ["width", "height"]) {
    const exact = numericConstraint(constraints[name], "exact");
    const minimum = numericConstraint(constraints[name], "min");
    const maximum = numericConstraint(constraints[name], "max");
    if ((exact && settings[name] !== exact) || (minimum && settings[name] < minimum) ||
        (maximum && settings[name] > maximum)) {
      throw new OverconstrainedError(name);
    }
  }
  const exactRate = numericConstraint(constraints.frameRate, "exact");
  const minimumRate = numericConstraint(constraints.frameRate, "min");
  const maximumRate = numericConstraint(constraints.frameRate, "max");
  if ((exactRate && settings.frameRate !== exactRate) ||
      (minimumRate && settings.frameRate < minimumRate) ||
      (maximumRate && settings.frameRate > maximumRate)) {
    throw new OverconstrainedError("frameRate");
  }
  const exactFacing = constraintValue(constraints.facingMode, "exact");
  if (exactFacing != null) {
    throw new OverconstrainedError("facingMode", "ThreeBrowser cannot verify Windows camera facing mode");
  }
}

class MediaDevices extends BrowserEventTarget {
  getSupportedConstraints() {
    return Object.freeze({
      deviceId: true,
      width: true,
      height: true,
      frameRate: true,
      facingMode: false,
      resizeMode: false,
    });
  }
  async enumerateDevices() {
    if (typeof native.cameraDevices !== "function") return [];
    return native.cameraDevices().map(device => new MediaDeviceInfo(device));
  }
  async getUserMedia(constraints = {}) {
    if (constraints?.audio) {
      throw new DOMException("ThreeBrowser getUserMedia currently supports video capture only", "NotSupportedError");
    }
    if (!constraints?.video) {
      throw new TypeError("getUserMedia requires a video constraint");
    }
    if (typeof native.cameraOpen !== "function") {
      throw new DOMException("This ThreeBrowser build has no Windows camera capture module", "NotSupportedError");
    }
    const video = constraints.video === true ? {} : constraints.video;
    if (!video || typeof video !== "object") throw new TypeError("video constraints must be true or an object");
    const exactDeviceId = constraintValue(video.deviceId, "exact");
    if (constraintValue(video.facingMode, "exact") != null) {
      throw new OverconstrainedError("facingMode", "ThreeBrowser cannot verify Windows camera facing mode");
    }
    if (constraintValue(video.resizeMode, "exact") != null) {
      throw new OverconstrainedError("resizeMode", "ThreeBrowser does not expose camera resize modes");
    }
    const idealDeviceId = constraintValue(video.deviceId, "ideal") ??
      (typeof video.deviceId === "string" ? video.deviceId : "");
    let requestedDeviceId = exactDeviceId ?? "";
    if (exactDeviceId != null || idealDeviceId) {
      const devices = await this.enumerateDevices();
      if (exactDeviceId != null && !devices.some(device => device.deviceId === String(exactDeviceId))) {
        throw new OverconstrainedError("deviceId");
      }
      if (!requestedDeviceId && idealDeviceId &&
          devices.some(device => device.deviceId === String(idealDeviceId))) {
        requestedDeviceId = String(idealDeviceId);
      }
    }
    let opened;
    try {
      opened = native.cameraOpen({
        deviceId: requestedDeviceId ? String(requestedDeviceId) : "",
        width: requestedNumber(video.width),
        height: requestedNumber(video.height),
        frameRate: requestedNumber(video.frameRate),
      });
    } catch (error) {
      throw new DOMException(error?.message || "Windows camera capture failed", "NotReadableError");
    }
    if (!opened?.handle) {
      const message = opened?.error || "No Windows video capture device is available";
      const name = /access.*denied|permission|privacy/i.test(message)
        ? "NotAllowedError"
        : /no .*device|unavailable|requested video/i.test(message)
          ? "NotFoundError"
          : "NotReadableError";
      throw new DOMException(message, name);
    }
    const track = new MediaStreamTrack(opened, video);
    try {
      validateExactCameraConstraints(video, track.getSettings());
      if (exactDeviceId != null && track.getSettings().deviceId !== String(exactDeviceId)) {
        throw new OverconstrainedError("deviceId");
      }
      return new MediaStream([track]);
    } catch (error) {
      track.stop();
      throw error;
    }
  }
}

class AudioElement extends Element {
  constructor(source = "") {
    super("audio");
    this._src = "";
    this._nativeAudioHandle = 0;
    this._audioLoadGeneration = 0;
    this._audioLoadPromise = null;
    this._currentTime = 0;
    this._duration = Number.NaN;
    this._loop = false;
    this._muted = false;
    this._volume = 1;
    this._playbackRate = 1;
    this._endedEventSent = false;
    this.autoplay = false;
    this.controls = false;
    this.crossOrigin = null;
    this.defaultMuted = false;
    this.ended = false;
    this.paused = true;
    this.preload = "auto";
    this.readyState = 0;
    if (source) this.src = source;
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value ?? "");
    this.load();
  }
  get currentSrc() { return this._src; }
  get duration() { return this._duration; }
  get currentTime() {
    this._syncNativeAudioState();
    return this._currentTime;
  }
  set currentTime(value) {
    const requested = Math.max(0, Number(value) || 0);
    this._currentTime = Number.isFinite(this._duration)
      ? Math.min(this._duration, requested)
      : requested;
    if (!this._nativeAudioHandle) return;
    const state = native.audioState?.(this._nativeAudioHandle);
    const sampleRate = Number(state?.sampleRate || 0);
    if (sampleRate > 0) {
      native.audioSeek?.(this._nativeAudioHandle, Math.round(this._currentTime * sampleRate));
      this.ended = false;
      this._endedEventSent = false;
    }
  }
  get loop() { return this._loop; }
  set loop(value) {
    this._loop = Boolean(value);
    if (this._nativeAudioHandle) native.audioSetLooping?.(this._nativeAudioHandle, this._loop);
  }
  get muted() { return this._muted; }
  set muted(value) {
    this._muted = Boolean(value);
    this._applyNativeAudioVolume();
  }
  get volume() { return this._volume; }
  set volume(value) {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested < 0 || requested > 1) {
      throw new DOMException("Audio volume must be between 0 and 1", "IndexSizeError");
    }
    this._volume = requested;
    this._applyNativeAudioVolume();
  }
  get playbackRate() { return this._playbackRate; }
  set playbackRate(value) {
    const requested = Number(value);
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new DOMException("Audio playbackRate must be greater than zero", "NotSupportedError");
    }
    this._playbackRate = requested;
    if (this._nativeAudioHandle) native.audioSetPlaybackRate?.(this._nativeAudioHandle, requested);
  }
  _applyNativeAudioVolume() {
    if (this._nativeAudioHandle) {
      native.audioSetVolume?.(this._nativeAudioHandle, this._muted ? 0 : this._volume);
    }
  }
  _closeNativeAudio() {
    if (this._nativeAudioHandle) native.audioClose?.(this._nativeAudioHandle);
    this._nativeAudioHandle = 0;
  }
  _syncNativeAudioState(state = null) {
    if (!this._nativeAudioHandle) return null;
    const snapshot = state ?? native.audioState?.(this._nativeAudioHandle);
    const sampleRate = Number(snapshot?.sampleRate || 0);
    const cursorFrame = Number(snapshot?.cursorFrame || 0);
    const lengthFrames = Number(snapshot?.lengthFrames || 0);
    if (sampleRate > 0) {
      this._currentTime = cursorFrame / sampleRate;
      this._duration = lengthFrames > 0 ? lengthFrames / sampleRate : Number.NaN;
    }
    this.ended = Boolean(snapshot?.ended) && !this._loop;
    if (this.ended && !this._endedEventSent) {
      this._endedEventSent = true;
      this.paused = true;
      queueMicrotask(() => this.dispatchEvent(new Event("ended")));
    }
    return snapshot;
  }
  load() {
    const generation = ++this._audioLoadGeneration;
    this._closeNativeAudio();
    this._currentTime = 0;
    this._duration = Number.NaN;
    this.readyState = 0;
    this.ended = false;
    this.paused = true;
    this._endedEventSent = false;
    if (!this._src) {
      this._audioLoadPromise = null;
      return;
    }
    this._audioLoadPromise = new Promise((resolve, reject) => {
      queueMicrotask(() => {
        // Camera-backed/video playback keeps its existing media shim. Native
        // audio is deliberately attached only to HTMLAudioElement instances.
        if (this.tagName === "VIDEO") {
          this.readyState = 4;
          for (const type of ["loadedmetadata", "loadeddata", "canplay", "canplaythrough"]) {
            this.dispatchEvent(new Event(type));
          }
          if (this.autoplay) void this.play();
          resolve();
          return;
        }
        try {
          const localPath = resolveNativeAudioPath(this._src);
          if (!localPath) {
            throw new DOMException(
              "ThreeBrowser native audio currently requires a local or pulled media file",
              "NotSupportedError",
            );
          }
          const opened = native.audioOpen?.(localPath);
          if (generation !== this._audioLoadGeneration) {
            if (opened?.handle) native.audioClose?.(opened.handle);
            resolve();
            return;
          }
          if (!opened?.handle) throw new Error(opened?.error || "Native audio could not open the media file");
          this._nativeAudioHandle = Number(opened.handle);
          this._syncNativeAudioState(opened.state);
          this._applyNativeAudioVolume();
          native.audioSetLooping?.(this._nativeAudioHandle, this._loop);
          native.audioSetPlaybackRate?.(this._nativeAudioHandle, this._playbackRate);
          if (this._currentTime > 0) this.currentTime = this._currentTime;
          this.readyState = 4;
          for (const type of ["loadedmetadata", "loadeddata", "canplay", "canplaythrough"]) {
            this.dispatchEvent(new Event(type));
          }
          if (this.autoplay) void this.play();
          resolve();
        } catch (error) {
          if (generation !== this._audioLoadGeneration) {
            resolve();
            return;
          }
          this.readyState = 0;
          queueMicrotask(() => this.dispatchEvent(new Event("error")));
          reject(error);
        }
      });
    });
    // load() itself is synchronous in the browser. Keep rejected background
    // preloads from becoming process-level unhandled rejections; play() still
    // awaits and reports the original failure to its caller.
    this._audioLoadPromise.catch(() => {});
  }
  async play() {
    if (!this._src) {
      throw new DOMException("The media element has no source", "NotSupportedError");
    }
    if (!this._audioLoadPromise && !this._nativeAudioHandle) this.load();
    await this._audioLoadPromise;
    if (this.tagName !== "VIDEO" &&
        (!this._nativeAudioHandle || native.audioPlay?.(this._nativeAudioHandle) === false)) {
      throw new DOMException("Native audio playback could not start", "NotSupportedError");
    }
    if (!this.paused) return;
    this.paused = false;
    this.ended = false;
    this._endedEventSent = false;
    this.dispatchEvent(new Event("play"));
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
  }
  pause() {
    if (this.paused) return;
    if (this._nativeAudioHandle) native.audioPause?.(this._nativeAudioHandle);
    this._syncNativeAudioState();
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  pollCues() {
    if (!this._nativeAudioHandle) return [];
    const packet = native.audioPollCues?.(this._nativeAudioHandle);
    this._syncNativeAudioState(packet?.state);
    return Array.isArray(packet?.cues) ? packet.cues : [];
  }
  close() {
    this._audioLoadGeneration++;
    this._closeNativeAudio();
    this._audioLoadPromise = null;
    this.paused = true;
    this.readyState = 0;
  }
  canPlayType(type) {
    return /^(?:audio\/(?:wav|x-wav|wave))/i.test(String(type)) ? "probably" :
      /^(?:audio\/(?:mpeg|mp4|ogg|webm)|application\/ogg)/i.test(String(type)) ? "maybe" : "";
  }
}

class VideoElement extends AudioElement {
  constructor(source = "") {
    super(source);
    this.tagName = this.nodeName = "VIDEO";
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.playsInline = true;
    this._srcObject = null;
    this._cameraTrack = null;
    this._cameraPixels = null;
    this._cameraSequence = 0;
    this._nativeCameraSequence = 0;
    this._presentedFrames = 0;
    this._lastDeliveredAt = -Infinity;
    this._videoFrameCallbacks = new Map();
    this._nextVideoFrameCallback = 1;
    this.HAVE_NOTHING = 0;
    this.HAVE_METADATA = 1;
    this.HAVE_CURRENT_DATA = 2;
    this.HAVE_FUTURE_DATA = 3;
    this.HAVE_ENOUGH_DATA = 4;
  }
  get srcObject() { return this._srcObject; }
  set srcObject(value) {
    if (value != null && !(value instanceof MediaStream)) {
      throw new TypeError("HTMLVideoElement.srcObject supports ThreeBrowser MediaStream values only");
    }
    for (const record of this._videoFrameCallbacks.values()) cancelAnimationFrame(record.animationFrame);
    this._videoFrameCallbacks.clear();
    this._srcObject = value;
    this._cameraTrack = value?.getVideoTracks()[0] ?? null;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.readyState = this.HAVE_NOTHING;
    this._cameraPixels = null;
    this.data = null;
    this.pixels = null;
    this._cameraSequence = 0;
    this._nativeCameraSequence = 0;
    this._presentedFrames = 0;
    this._lastDeliveredAt = -Infinity;
  }
  play() {
    if (!this._cameraTrack) return super.play();
    if (this._cameraTrack.readyState !== "live") {
      return Promise.reject(new DOMException("The camera track has ended", "InvalidStateError"));
    }
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event("play"));
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  }
  pause() {
    super.pause();
  }
  _acquireCameraFrame() {
    const track = this._cameraTrack;
    if (this.paused || !track || track.readyState !== "live" || !track._nativeHandle) return false;
    let metadata;
    try {
      metadata = native.cameraRead(track._nativeHandle, this._nativeCameraSequence, null);
    } catch (error) {
      track._end(true);
      this.ended = true;
      this.dispatchEvent(new Event("ended"));
      return false;
    }
    if (metadata?.ended && !metadata.hasNewFrame) {
      track._end(true);
      this.ended = true;
      this.dispatchEvent(new Event("ended"));
      return false;
    }
    if (!metadata?.hasNewFrame) return false;
    const now = performance.now();
    const minimumInterval = track._deliveryFrameRate > 0 ? 1000 / track._deliveryFrameRate : 0;
    const previousNativeSequence = this._nativeCameraSequence;
    this._nativeCameraSequence = Number(metadata.sequence || previousNativeSequence);
    if (minimumInterval > 0 && now - this._lastDeliveredAt + 0.25 < minimumInterval) return false;
    const required = Number(metadata.byteLength || 0);
    if (!(required > 0)) return false;
    if (!this._cameraPixels || this._cameraPixels.byteLength !== required) {
      this._cameraPixels = new Uint8ClampedArray(required);
    }
    const frame = native.cameraRead(track._nativeHandle, previousNativeSequence, this._cameraPixels);
    if (!frame?.copied) return false;
    this._nativeCameraSequence = Number(frame.sequence || this._nativeCameraSequence);
    const firstFrame = this.readyState === this.HAVE_NOTHING;
    this.videoWidth = Number(frame.width || 0);
    this.videoHeight = Number(frame.height || 0);
    this.currentTime = Number(frame.timestampUs || 0) / 1_000_000;
    this.data = this._cameraPixels;
    this.pixels = this._cameraPixels;
    this._cameraSequence = Number(frame.sequence || this._cameraSequence + 1);
    this._presentedFrames += 1;
    this._lastDeliveredAt = now;
    this.readyState = this.HAVE_ENOUGH_DATA;
    if (firstFrame) {
      this.dispatchEvent(new Event("loadedmetadata"));
      this.dispatchEvent(new Event("loadeddata"));
      this.dispatchEvent(new Event("canplay"));
      this.dispatchEvent(new Event("canplaythrough"));
    }
    this.dispatchEvent(new Event("timeupdate"));
    return true;
  }
  requestVideoFrameCallback(callback) {
    if (typeof callback !== "function") throw new TypeError("requestVideoFrameCallback expects a function");
    const id = this._nextVideoFrameCallback++;
    const poll = now => {
      const record = this._videoFrameCallbacks.get(id);
      if (!record) return;
      if (!this._cameraTrack || this._cameraTrack.readyState !== "live") {
        this._videoFrameCallbacks.delete(id);
        if (this._cameraTrack?.readyState === "ended") this.ended = true;
        return;
      }
      if (this.paused) {
        record.animationFrame = requestAnimationFrame(poll);
        return;
      }
      // Every callback registered before a presented frame observes that same
      // frame. Only the first poll needs to copy it from native; later polls in
      // this RAF batch see the incremented counter instead of consuming the
      // following camera sequence.
      if (this._presentedFrames <= record.afterPresentedFrames &&
          !this._acquireCameraFrame()) {
        record.animationFrame = requestAnimationFrame(poll);
        return;
      }
      if (this._presentedFrames <= record.afterPresentedFrames) {
        record.animationFrame = requestAnimationFrame(poll);
        return;
      }
      this._videoFrameCallbacks.delete(id);
      callback(now, {
        presentationTime: now,
        expectedDisplayTime: now,
        width: this.videoWidth,
        height: this.videoHeight,
        mediaTime: this.currentTime,
        presentedFrames: this._presentedFrames,
        processingDuration: 0,
      });
    };
    const record = {
      afterPresentedFrames: this._presentedFrames,
      animationFrame: requestAnimationFrame(poll),
    };
    this._videoFrameCallbacks.set(id, record);
    return id;
  }
  cancelVideoFrameCallback(id) {
    const record = this._videoFrameCallbacks.get(Number(id));
    if (!record) return;
    cancelAnimationFrame(record.animationFrame);
    this._videoFrameCallbacks.delete(Number(id));
  }
  __threeBrowserExternalFrame() {
    this._acquireCameraFrame();
    if (!this._cameraPixels || !this.videoWidth || !this.videoHeight) return null;
    return {
      width: this.videoWidth,
      height: this.videoHeight,
      data: this._cameraPixels,
      sequence: this._cameraSequence,
      timestampUs: Math.round(this.currentTime * 1_000_000),
    };
  }
  canPlayType(type) {
    return /^(?:video\/(?:mp4|ogg|webm)|application\/ogg)/i.test(String(type)) ? "probably" : "";
  }
}

const mediaReadyStateConstants = Object.freeze({
  HAVE_NOTHING: 0,
  HAVE_METADATA: 1,
  HAVE_CURRENT_DATA: 2,
  HAVE_FUTURE_DATA: 3,
  HAVE_ENOUGH_DATA: 4,
});
Object.assign(AudioElement, mediaReadyStateConstants);
Object.assign(AudioElement.prototype, mediaReadyStateConstants);
Object.assign(VideoElement, mediaReadyStateConstants);

class VideoFrame {
  constructor(source, init = {}) {
    const frame = typeof source?.__threeBrowserExternalFrame === "function"
      ? source.__threeBrowserExternalFrame()
      : source;
    const width = Number(frame?.displayWidth ?? frame?.codedWidth ?? frame?.videoWidth ?? frame?.width ?? 0);
    const height = Number(frame?.displayHeight ?? frame?.codedHeight ?? frame?.videoHeight ?? frame?.height ?? 0);
    const pixels = frame?.data ?? frame?.pixels;
    const byteLength = width * height * 4;
    if (!Number.isInteger(width) || !Number.isInteger(height) ||
        !(width > 0 && height > 0) || !Number.isSafeInteger(byteLength) ||
        !ArrayBuffer.isView(pixels) || pixels.BYTES_PER_ELEMENT !== 1 ||
        pixels.byteLength < byteLength) {
      throw new TypeError("ThreeBrowser VideoFrame requires an RGBA ImageBitmap or live video frame");
    }
    this.codedWidth = this.displayWidth = width;
    this.codedHeight = this.displayHeight = height;
    this.visibleRect = Object.freeze({ x: 0, y: 0, width, height });
    this.timestamp = Number(init.timestamp ?? frame?.timestampUs ?? 0);
    this.duration = init.duration == null ? null : Number(init.duration);
    this.format = "RGBA";
    // VideoElement reuses its camera destination array. A VideoFrame is a
    // stable snapshot and must not mutate when the next camera sample arrives.
    this.data = new Uint8ClampedArray(byteLength);
    this.data.set(new Uint8Array(pixels.buffer, pixels.byteOffset, byteLength));
    this.pixels = this.data;
    this._sourceKey = source?._sourceKey ?? source;
    this._sequence = Number(frame?.sequence ?? 1);
    this._closed = false;
  }
  allocationSize() { return this.codedWidth * this.codedHeight * 4; }
  clone() {
    if (this._closed) throw new DOMException("VideoFrame is closed", "InvalidStateError");
    return new VideoFrame(this, { timestamp: this.timestamp, duration: this.duration });
  }
  close() {
    this._closed = true;
    this.data = null;
    this.pixels = null;
  }
  __threeBrowserExternalFrame() {
    if (this._closed) throw new DOMException("VideoFrame is closed", "InvalidStateError");
    return {
      width: this.displayWidth,
      height: this.displayHeight,
      data: this.data,
      sequence: this._sequence,
      timestampUs: this.timestamp,
      cacheKey: this._sourceKey,
    };
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

function hydrateDocumentMarkup(html) {
  const source = String(html ?? "");
  const bodyMarkup = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(source)?.[1] ?? source;
  // Script execution stays under loadEntry's module/classic-script ordering.
  // Keeping script text in the virtual DOM would duplicate megabytes of code
  // as text nodes without making it executable.
  const inertMarkup = bodyMarkup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, "");
  body.innerHTML = inertMarkup;
  return body;
}
globalThis.__threeBrowserHydrateDocument = hydrateDocumentMarkup;

let pointerLockMotionWarmup = 0;
let pointerLockSuspendedByRuntimeOverlay = false;
let runtimeOverlayWasOpen = false;

function resumeRuntimeOverlayPointerLock() {
  if (!pointerLockSuspendedByRuntimeOverlay) return;
  pointerLockSuspendedByRuntimeOverlay = false;
  if (!document.pointerLockElement) return;
  if (native.setPointerLock(true)) pointerLockMotionWarmup = 1;
}

export function setRuntimeOverlayVisible(open) {
  const visible = Boolean(open);
  if (visible && document.pointerLockElement) {
    pointerLockSuspendedByRuntimeOverlay = true;
    // Keep the browser-visible pointer lock intact while the runtime menu is
    // open. A page must not interpret our own menu as an Escape/pause action.
    native.setPointerLock(false);
  }
  const accepted = native.setOverlay(visible);
  runtimeOverlayWasOpen = visible && accepted !== false;
  if (!visible) resumeRuntimeOverlayPointerLock();
  return accepted;
}

function syncRuntimeOverlayPointerLock() {
  const open = Boolean(native.overlayOpen?.());
  if (runtimeOverlayWasOpen && !open) resumeRuntimeOverlayPointerLock();
  runtimeOverlayWasOpen = open;
  return open;
}

function requestNativePointerLock(element, options = undefined) {
  if (native.overlayOpen?.()) setRuntimeOverlayVisible(false);
  const unadjustedMovement = options?.unadjustedMovement === true;
  if (!native.setPointerLock(true, unadjustedMovement)) {
    document.dispatchEvent(new Event("pointerlockerror"));
    return Promise.reject(new Error("Pointer lock could not be acquired"));
  }
  document.pointerLockElement = element;
  // Win32 may deliver the cursor-centering/activation delta immediately after
  // the lock request. Browsers do not expose that synthetic movement to page
  // controls, so discard exactly the first locked move.
  pointerLockMotionWarmup = 1;
  document.dispatchEvent(new Event("pointerlockchange"));
  return Promise.resolve();
}

function releaseNativePointerLock(fromHost = false) {
  if (!fromHost) native.setPointerLock(false);
  if (!document.pointerLockElement) return;
  document.pointerLockElement = null;
  pointerLockMotionWarmup = 0;
  document.dispatchEvent(new Event("pointerlockchange"));
}

let currentCanvas = null;
let currentOverlayCanvas = null;
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
  const candidates = [...mountedCanvases].filter(canvas => canvasIsConnected(canvas) && canvas.context2d === null);
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
function cssCanvasNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function canvasOverlayBounds(canvas) {
  return {
    left: Math.max(0, Math.round(cssCanvasNumber(canvas.style.left, 0))),
    top: Math.max(0, Math.round(cssCanvasNumber(canvas.style.top, 0))),
    width: Math.max(1, Math.round(cssCanvasNumber(canvas.style.width, canvas.width))),
    height: Math.max(1, Math.round(cssCanvasNumber(canvas.style.height, canvas.height))),
  };
}
function refreshOverlayCanvas() {
  const candidates = [...mountedCanvases].filter(canvas =>
    canvasIsConnected(canvas) && canvas.context2d !== null && canvas.style.display !== "none");
  currentOverlayCanvas = candidates.reduce((best, canvas) =>
    !best || canvasStackZ(canvas) >= canvasStackZ(best) ? canvas : best, null);
  return currentOverlayCanvas;
}
function sendCanvasOverlayHidden() {
  if (typeof native.canvasOverlaySet === "function") {
    native.canvasOverlaySet(false);
    return;
  }
  const command = globalThis.__TB_WGPU_CMD;
  if (typeof command?.canvasOverlay !== "function") return;
  command.canvasOverlay({ visible: false });
  command.submitNow?.();
}
function presentMountedCanvasOverlay(canvas) {
  if (refreshOverlayCanvas() !== canvas) return;
  const command = globalThis.__TB_WGPU_CMD;
  if (typeof native.canvasOverlaySet !== "function" && typeof command?.canvasOverlay !== "function") return;
  const bounds = canvasOverlayBounds(canvas);
  const pixels = canvas.context2d?._readPixels(0, 0, canvas.width, canvas.height);
  if (!pixels) return;
  try {
    if (typeof native.canvasOverlaySet === "function") {
      native.canvasOverlaySet(true, bounds.left, bounds.top, bounds.width, bounds.height,
        canvas.width, canvas.height, pixels, canvas.width * 4);
      return;
    }
    command.canvasOverlay({
      visible: true,
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      sourceWidth: canvas.width,
      sourceHeight: canvas.height,
      rowBytes: canvas.width * 4,
      pixels,
    });
    command.submitNow?.();
  } catch (error) {
    console.error(`ThreeBrowser Canvas2D overlay rejected: ${error?.message || error}`);
  }
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
  canvas._overlayMounted = canvas.context2d !== null;
  refreshPresentedCanvas();
  if (canvas._overlayMounted) canvas._scheduleOverlayPresent();
  if (process.env.THREEBROWSER_TRACE_RENDER) {
    console.error("ThreeBrowser canvas mounted", {
      width: canvas.width, height: canvas.height, parent: parent.tagName, parentId: parent.id,
      zIndex: canvasStackZ(canvas), selected: currentCanvas === canvas,
    });
  }
}
function demotePresentedCanvasTree(node) {
  if (node instanceof CanvasElement) {
    const wasOverlay = currentOverlayCanvas === node;
    mountedCanvases.delete(node);
    node._overlayMounted = false;
    refreshPresentedCanvas();
    refreshOverlayCanvas();
    if (wasOverlay) {
      if (currentOverlayCanvas) currentOverlayCanvas._scheduleOverlayPresent();
      else sendCanvasOverlayHidden();
    }
  }
  for (const child of node?.children || []) demotePresentedCanvasTree(child);
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

const htmlInteractionBridge = new HtmlInteractionBridge({
  document,
  viewport: () => ({ width: globalThis.innerWidth || 1280, height: globalThis.innerHeight || 720 }),
  createCanvas: () => document.createElement("canvas"),
  trace: Boolean(process.env.THREEBROWSER_TRACE_HTML_INTERACTION),
});

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
const mediaDevices = new MediaDevices();
const clipboard = Object.freeze({
  async writeText(value) {
    if (typeof native.clipboardWriteText !== "function") {
      throw new DOMException("Native clipboard writing is unavailable", "NotSupportedError");
    }
    if (native.clipboardWriteText(String(value)) !== true) {
      throw new DOMException("Native clipboard writing failed", "OperationError");
    }
  },
});
Object.defineProperty(globalThis, "navigator", {
  value: {
    // Sites commonly use Chromium User-Agent Client Hints as their desktop
    // WebGPU gate. Without this, they can stop before creating a renderer.
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 ThreeBrowserRuntime/0.1",
    userAgentData: {
      brands: [
        { brand: "Chromium", version: "128" },
        { brand: "ThreeBrowser", version: "1" },
      ],
      mobile: false,
      platform: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
      async getHighEntropyValues(hints = []) {
        const values = {
          architecture: process.arch === "x64" ? "x86" : process.arch,
          bitness: process.arch === "x64" || process.arch === "arm64" ? "64" : "32",
          model: "",
          platformVersion: "10.0.0",
          uaFullVersion: "128.0.0.0",
          fullVersionList: [
            { brand: "Chromium", version: "128.0.0.0" },
            { brand: "ThreeBrowser", version: "1.0.0.0" },
          ],
          wow64: false,
        };
        return Object.fromEntries(hints.filter(hint => hint in values).map(hint => [hint, values[hint]]));
      },
      toJSON() {
        return { brands: this.brands, mobile: this.mobile, platform: this.platform };
      },
    },
    platform: process.platform === "win32" ? "Win32" : process.platform,
    language: "en-AU",
    languages: ["en-AU", "en"],
    maxTouchPoints: 0,
    hardwareConcurrency: Math.max(1, Number(process.env.NUMBER_OF_PROCESSORS) || 1),
    onLine: false,
    cookieEnabled: false,
    getGamepads: () => [],
    clipboard,
    mediaDevices,
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
globalThis.CanvasGradient = BrowserCanvasGradient;
globalThis.ImageData = BrowserImageData;
globalThis.WebGLRenderingContext = WebGLRenderingContextProbe;
globalThis.WebGL2RenderingContext = WebGL2RenderingContextProbe;
globalThis.HTMLImageElement = ImageElement;
globalThis.Image = ImageElement;
globalThis.HTMLMediaElement = AudioElement;
globalThis.HTMLAudioElement = AudioElement;
globalThis.Audio = AudioElement;
globalThis.HTMLVideoElement = VideoElement;
globalThis.MediaDeviceInfo = MediaDeviceInfo;
globalThis.MediaDevices = MediaDevices;
globalThis.MediaStream = MediaStream;
globalThis.MediaStreamTrack = MediaStreamTrack;
globalThis.OverconstrainedError = OverconstrainedError;
globalThis.VideoFrame = VideoFrame;
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
  connect(destination) { return destination; },
  disconnect() {},
  addEventListener() {},
  removeEventListener() {},
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
  createDynamicsCompressor() {
    return audioNode({
      threshold: audioParam(-24),
      knee: audioParam(30),
      ratio: audioParam(12),
      attack: audioParam(0.003),
      release: audioParam(0.25),
      reduction: 0,
    });
  }
  createOscillator() {
    return audioNode({
      type: "sine",
      frequency: audioParam(440),
      detune: audioParam(),
      start() {},
      stop() {},
      onended: null,
    });
  }
  createStereoPanner() { return audioNode({ pan: audioParam() }); }
  createPanner() {
    return audioNode({
      positionX: audioParam(), positionY: audioParam(), positionZ: audioParam(),
      orientationX: audioParam(1), orientationY: audioParam(), orientationZ: audioParam(),
      refDistance: 1, rolloffFactor: 1, distanceModel: "inverse", panningModel: "HRTF",
      setPosition() {}, setOrientation() {},
    });
  }
  createBuffer(numberOfChannels, length, sampleRate = this.sampleRate) {
    const channels = Math.max(1, Number(numberOfChannels) | 0);
    const frames = Math.max(0, Number(length) | 0);
    const rate = Math.max(1, Number(sampleRate) || this.sampleRate);
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return {
      duration: frames / rate,
      length: frames,
      numberOfChannels: channels,
      sampleRate: rate,
      getChannelData(index) {
        const channel = data[Number(index) | 0];
        if (!channel) throw new RangeError("AudioBuffer channel index is out of range");
        return channel;
      },
      copyFromChannel(destination, channelNumber, startInChannel = 0) {
        destination.set(this.getChannelData(channelNumber).subarray(startInChannel, startInChannel + destination.length));
      },
      copyToChannel(source, channelNumber, startInChannel = 0) {
        this.getChannelData(channelNumber).set(source, startInChannel);
      },
    };
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
const activeResizeObservers = new Set();
function queueResizeObserverDelivery(observer) {
  if (observer.deliveryQueued) return;
  observer.deliveryQueued = true;
  queueMicrotask(() => {
    observer.deliveryQueued = false;
    const entries = [];
    for (const target of observer.targets) {
      const contentRect = target.getBoundingClientRect();
      const previous = observer.lastSizes.get(target);
      if (previous?.width === contentRect.width && previous?.height === contentRect.height) continue;
      observer.lastSizes.set(target, { width: contentRect.width, height: contentRect.height });
      entries.push({
        target,
        contentRect,
        contentBoxSize: [{ inlineSize: contentRect.width, blockSize: contentRect.height }],
      });
    }
    if (entries.length) observer.callback(entries, observer);
  });
}
function notifyResizeObservers() {
  for (const observer of activeResizeObservers) queueResizeObserverDelivery(observer);
}
globalThis.ResizeObserver = class {
  constructor(callback) {
    if (typeof callback !== "function") throw new TypeError("ResizeObserver callback must be a function");
    this.callback = callback;
    this.targets = new Set();
    this.lastSizes = new Map();
    this.deliveryQueued = false;
  }
  observe(target) {
    this.targets.add(target);
    activeResizeObservers.add(this);
    queueResizeObserverDelivery(this);
  }
  unobserve(target) {
    this.targets.delete(target);
    this.lastSizes.delete(target);
    if (!this.targets.size) activeResizeObservers.delete(this);
  }
  disconnect() {
    this.targets.clear();
    this.lastSizes.clear();
    activeResizeObservers.delete(this);
  }
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
function resolveNativeAudioPath(source) {
  const raw = String(source ?? "");
  if (!raw) return null;
  if (path.isAbsolute(raw)) return path.resolve(raw);
  let requestURL;
  try {
    const base = globalThis.location?.href || pulledVirtualURL?.href;
    requestURL = base ? new URL(raw, base) : new URL(raw);
    requestURL.hash = "";
  } catch {
    return null;
  }
  if (requestURL.protocol === "file:") {
    requestURL.search = "";
    return fileURLToPath(requestURL);
  }
  const isVirtual = pulledVirtualURL && requestURL.origin === pulledVirtualURL.origin;
  const sourceCandidate = isVirtual && pulledSourceURL
    ? new URL(`${requestURL.pathname}${requestURL.search}`, pulledSourceURL.origin)
    : pulledSourceURL ? new URL(raw, pulledSourceURL) : requestURL;
  sourceCandidate.hash = "";
  const pulledPath = pulledVirtualFiles.get(requestURL.href) || pulledFiles.get(sourceCandidate.href);
  return pulledPath && pulledDirectory ? path.resolve(pulledDirectory, pulledPath) : null;
}
const contentTypes = new Map([
  [".json", "application/json"], [".gltf", "model/gltf+json"], [".glb", "model/gltf-binary"],
  [".bin", "application/octet-stream"], [".dat", "application/octet-stream"], [".wasm", "application/wasm"], [".txt", "text/plain"],
  [".glsl", "text/plain"], [".vert", "text/plain"], [".frag", "text/plain"], [".comp", "text/plain"],
  [".wgsl", "text/plain"], [".spv", "application/vnd.khronos.spirv"],
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"],
  [".wav", "audio/wav"],
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
    if (isVirtual && response.ok && method === "GET" && pulledDirectory &&
        process.env.THREEBROWSER_PACKAGED_READ_ONLY !== "1") {
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
          if (process.env.THREEBROWSER_PACKAGED_READ_ONLY !== "1") {
            await fs.promises.mkdir(path.dirname(missingPath), { recursive: true });
            await fs.promises.writeFile(missingPath, bytes);
          }
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
function submitNativeCommands(data, frame = false) {
  if (native.isOpen()) return frame && process.env.THREEBROWSER_SYNC_FRAMES !== "1" ? native.submitFrame(data) : native.submit(data);
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
    ResizeCmdBuffer: required => {
      if (!Number.isSafeInteger(required) || required < 1 || required > 256 * 1024 * 1024) {
        throw new RangeError("Native command exceeds the 256 MiB command limit");
      }
      const capacity = Math.max(globalThis.__TN_SHARED.byteLength, 2 ** Math.ceil(Math.log2(required)));
      globalThis.__TN_SHARED = new ArrayBuffer(capacity);
      return globalThis.__TN_SHARED;
    },
    CmdSubmitBuffer: submitNativeCommands,
    CmdSubmitFrame: data => submitNativeCommands(data, true),
    RendererSetToneMapping: (mode, exposure) => native.setToneMapping(mode, exposure),
    ShaderMaterialCreate: (vertex, fragment, raw = 0) => native.shaderMaterialCreate(vertex, fragment, raw),
    ShaderMaterialSetSource: (material, vertex, fragment) => native.shaderMaterialSetSource(material, vertex, fragment),
    MaterialShaderTemplate: type => native.materialShaderTemplate(type),
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
    RenderTargetCreate: (id, width, height, samples, depthBuffer, stencilBuffer, count, type, format, minFilter, magFilter, depthTexture, generateMipmaps) =>
      native.renderTargetCreate(id, width, height, samples, depthBuffer, stencilBuffer, count, type, format, minFilter, magFilter, depthTexture, generateMipmaps),
    RenderTargetSet: (id, activeCubeFace, activeMipmapLevel) =>
      native.renderTargetSet(id, activeCubeFace, activeMipmapLevel),
    RenderTargetReadPixels: (id,x,y,width,height,buffer) => native.renderTargetReadPixels(id,x,y,width,height,buffer),
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
    WebGpuFeatureStatus: () => native.gpuFeatureStatus(),
    WebGpuRequestFeatures: (...args) => native.requestGpuFeatures(...args),
    WebGpuDLSSOptimalSettings: (...args) => native.dlssOptimalSettings(...args),
    WebGpuDLSSReleaseViewport: viewport => native.dlssReleaseViewport(viewport),
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
let nativeWindowSeen = false;
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

export function updateRuntimeOverlayChord(state, input) {
  if (!state?.pressedKeys || !input || (input.type !== "keydown" && input.type !== "keyup")) {
    return { consume: false, toggle: false };
  }
  // A native overlay may consume the previous key-up events. Modifier keys do
  // not auto-repeat, so a new Shift keydown is a reliable fresh chord boundary.
  if (input.type === "keydown" && input.code === 16 && state.active === true && state.pressedKeys.has(16)) {
    state.pressedKeys.clear();
    state.active = false;
  }
  if (input.type === "keydown") state.pressedKeys.add(input.code);
  const shiftDown = state.pressedKeys.has(16) || (input.code === 9 && input.shiftKey === true);
  const chordDown = state.pressedKeys.has(9) && shiftDown;
  const toggle = chordDown && state.active !== true;
  if (toggle) state.active = true;
  const consume = state.active === true && (input.code === 9 || input.code === 16);
  if (input.type === "keyup") {
    state.pressedKeys.delete(input.code);
    if (!state.pressedKeys.has(9) && !state.pressedKeys.has(16)) state.active = false;
  }
  return { consume, toggle };
}

const runtimeOverlayChordState = {
  pressedKeys,
  get active() { return overlayChordActive; },
  set active(value) { overlayChordActive = Boolean(value); },
};

export function consumeRuntimeOverlayInput(input) {
  if (!native.overlayOpen?.()) return false;
  if (input.type === "wheel") native.overlayWheel?.(input.code);
  else if (input.type === "pointermove") native.overlayPointerMove?.(input.x, input.y);
  else if (input.type === "pointerup") native.overlayClick?.(input.x, input.y);
  else if (input.type === "keydown" && input.code === 27) setRuntimeOverlayVisible(false);
  // The native menu is modal. Even input types it does not act on must not
  // leak through to a virtual-DOM gate, focused element, canvas, or window.
  return true;
}

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
    const overlayChord = updateRuntimeOverlayChord(runtimeOverlayChordState, input);
    if (overlayChord.toggle) {
      const open = !native.overlayOpen();
      const accepted = setRuntimeOverlayVisible(open);
      if (process.env.THREEBROWSER_TRACE_INPUT) console.error("overlay chord", { open, accepted, active: native.overlayOpen() });
    }
    if (overlayChord.consume) continue;
    if (consumeRuntimeOverlayInput(input)) continue;
    if (htmlInteractionBridge.consumeNativeInput(input)) continue;
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
      if (pointerType === "pointermove" && document.pointerLockElement && pointerLockMotionWarmup > 0) {
        pointerLockMotionWarmup--;
        continue;
      }
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
        setRuntimeOverlayVisible(false);
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
  }
  notifyResizeObservers();
  globalThis.dispatchEvent(new Event("resize"));
}

function pump() {
  if (!running) return;
  // Frameworks such as React create the renderer from a deferred effect.  A
  // browser keeps its event loop alive while that work is pending; exiting on
  // the first pump made production Vite applications disappear before their
  // first effect could construct WebGLRenderer.
  if (!native.isOpen()) {
    if (!nativeWindowSeen && performance.now() < startupDeadline) {
      setTimeout(pump, 1);
      return;
    }
    stop();
    // Closing the native window is the runtime's equivalent of closing a
    // browser tab. Page timers must not keep the headless JS process alive.
    setImmediate(() => process.exit(0));
    return;
  }
  nativeWindowSeen = true;
  if (!signalBootstrapReady()) {
    stop();
    setImmediate(() => process.exit(3));
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
  if (native.pressure() > 1) {
    setTimeout(pump, 1);
    return;
  }
  dispatchNativeInput();
  syncWindowSize();
  if (syncRuntimeOverlayPointerLock()) htmlInteractionBridge.hide();
  else htmlInteractionBridge.update(performance.now());
  const callbacks = Array.from(frameCallbacks.values());
  frameCallbacks.clear();
  globalThis.__threeBrowserDisplayFrame = (globalThis.__threeBrowserDisplayFrame || 0) + 1;
  const timestamp = performance.now();
  for (const callback of callbacks) callback(timestamp);
  setImmediate(pump);
}

export function start() {
  if (running) return;
  running = true;
  nativeWindowSeen = false;
  startupDeadline = performance.now() + nativeStartupTimeout;
  setImmediate(pump);
}

export function stop() {
  for (const track of [...activeCameraTracks]) track.stop();
  if (!running && !native.isOpen()) return;
  running = false;
  frameCallbacks.clear();
  for (const worker of activeWorkers) worker.terminate();
  activeWorkers.clear();
  htmlInteractionBridge.hide();
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

function applyManifestSearch(url, manifest) {
  if (!url) return url;
  if (typeof manifest.search === "string") {
    url.search = manifest.search === "" || manifest.search.startsWith("?")
      ? manifest.search
      : `?${manifest.search}`;
    return url;
  }
  if (manifest.searchParams && typeof manifest.searchParams === "object" && !Array.isArray(manifest.searchParams)) {
    url.search = "";
    for (const [key, value] of Object.entries(manifest.searchParams)) {
      if (value == null) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
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
      if (manifest.html) {
        const projectRoot = path.dirname(absolute);
        const htmlPath = path.resolve(projectRoot, String(manifest.html));
        const relativeHtmlPath = path.relative(projectRoot, htmlPath);
        if (relativeHtmlPath && !relativeHtmlPath.startsWith("..") && !path.isAbsolute(relativeHtmlPath) && fs.existsSync(htmlPath)) {
          hydrateDocumentMarkup(fs.readFileSync(htmlPath, "utf8"));
        }
      }
      pulledSourceURL = applyManifestSearch(manifest.source ? new URL(manifest.source) : null, manifest);
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
  hydrateDocumentMarkup(html);
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
process.once("exit", () => {
  for (const track of [...activeCameraTracks]) track.stop();
  if (native.isOpen()) native.shutdown();
});
