const CONTROL_TAGS = ["input", "textarea", "select", "button"];
const NON_TEXT_INPUT_TYPES = new Set([
  "button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit",
]);
const SCREEN_WORDS = new Set([
  "loading", "start", "title", "home", "menu", "pause", "paused", "class", "loadout", "login",
  "signin", "signup", "welcome", "intro", "setup", "consent", "error", "dialog", "modal",
]);
const ACTIVE_SCREEN_ALIASES = {
  title: new Set(["title", "start", "home", "menu", "welcome", "intro"]),
  start: new Set(["start", "title", "home", "menu", "welcome", "intro"]),
  pause: new Set(["pause", "paused", "menu"]),
  paused: new Set(["pause", "paused", "menu"]),
  class: new Set(["class", "loadout"]),
  loadout: new Set(["class", "loadout"]),
};

function normalizedText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function attribute(element, name) {
  return element?.getAttribute?.(name) ?? element?.[name] ?? null;
}

function hasAttribute(element, name) {
  if (typeof element?.hasAttribute === "function") return element.hasAttribute(name);
  return Boolean(element?.[name]);
}

function classTokens(element) {
  return normalizedText(element?.className).toLowerCase().split(/\s+/).filter(Boolean);
}

function tokenWords(token) {
  return String(token).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function listenerCount(element, type) {
  return element?._eventListeners?.get?.(type)?.length ?? (typeof element?.[`on${type}`] === "function" ? 1 : 0);
}

function connectedToDocument(element, document) {
  for (let node = element; node; node = node.parentNode) {
    if (node === document?.body || node === document?.documentElement || node === document) return true;
  }
  return false;
}

export function elementIsVisible(element, document = element?.ownerDocument) {
  if (!element || !connectedToDocument(element, document)) return false;
  for (let node = element; node && node !== document; node = node.parentNode) {
    const style = node.style || {};
    if (hasAttribute(node, "hidden") || node.hidden === true || node.disabled === true) return false;
    if (String(style.display).toLowerCase() === "none") return false;
    if (String(style.visibility).toLowerCase() === "hidden") return false;
    if (Number.parseFloat(style.opacity) === 0) return false;
    if (String(attribute(node, "aria-hidden")).toLowerCase() === "true") return false;
  }
  return true;
}

function gateRootFor(element, document) {
  let form = null;
  for (let node = element; node && node !== document; node = node.parentNode) {
    if (node.tagName === "FORM") form = node;
    const id = normalizedText(node.id).toLowerCase();
    const role = normalizedText(attribute(node, "role")).toLowerCase();
    const classes = classTokens(node);
    const looksLikeGate = node.dataset?.screen != null || role === "dialog" || role === "alertdialog" ||
      String(attribute(node, "aria-modal")).toLowerCase() === "true" ||
      /(?:blocker|overlay|modal|dialog|gate|splash|screen|menu)/.test(id) ||
      classes.some(token => /(?:blocker|overlay|modal|dialog|gate|splash|screen|menu)/.test(token));
    if (looksLikeGate) return node;
  }
  return form;
}

function screenWordFor(element) {
  for (const token of classTokens(element)) {
    for (const word of tokenWords(token)) if (SCREEN_WORDS.has(word)) return word;
  }
  const id = normalizedText(element?.id).toLowerCase();
  for (const word of tokenWords(id)) if (SCREEN_WORDS.has(word)) return word;
  return null;
}

function belongsToActiveScreen(element, root) {
  const active = normalizedText(root?.dataset?.screen).toLowerCase();
  if (!active) return true;
  const aliases = ACTIVE_SCREEN_ALIASES[active] ?? new Set([active]);
  for (let node = element.parentNode; node && node !== root; node = node.parentNode) {
    const word = screenWordFor(node);
    if (word && !aliases.has(word)) return false;
    if (word && aliases.has(word)) return true;
  }
  return true;
}

function canReceiveText(element) {
  if (element?.tagName === "TEXTAREA") return true;
  if (element?.tagName !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has(normalizedText(element.type || attribute(element, "type") || "text").toLowerCase());
}

function semanticControl(element) {
  const tag = element?.tagName;
  if (tag === "INPUT") return normalizedText(element.type || attribute(element, "type") || "text").toLowerCase() !== "hidden";
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "BUTTON") return listenerCount(element, "click") > 0 || Boolean(element.form || element.closest?.("form"));
  return false;
}

function controlLabel(element, kind) {
  const labelledBy = normalizedText(attribute(element, "aria-labelledby"));
  if (labelledBy) {
    const value = labelledBy.split(/\s+/).map(id => normalizedText(element.ownerDocument?.getElementById?.(id)?.textContent)).filter(Boolean).join(" ");
    if (value) return value.slice(0, 80);
  }
  const direct = normalizedText(attribute(element, "aria-label") || attribute(element, "title") ||
    (kind === "text" ? attribute(element, "placeholder") : ""));
  if (direct) return direct.slice(0, 80);
  const id = normalizedText(element.id);
  const explicitLabel = id ? [...(element.ownerDocument?.querySelectorAll?.("label") || [])]
    .find(label => normalizedText(attribute(label, "for")) === id) : null;
  let containingLabel = null;
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.tagName === "LABEL") {
      containingLabel = node;
      break;
    }
  }
  const labelText = normalizedText((explicitLabel ?? containingLabel)?.textContent);
  if (labelText) return labelText.slice(0, 80);
  const text = normalizedText(element.textContent);
  if (text) return text.slice(0, 80);
  const dataName = normalizedText(element.dataset?.action || element.dataset?.weaponId || element.name || element.id);
  if (dataName) return dataName.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()).slice(0, 80);
  return kind === "text" ? "Text" : kind === "select" ? "Choose an option" : "Continue";
}

function optionList(element) {
  return [...(element?.children || [])].filter(child => child.tagName === "OPTION").map((option, index) => ({
    element: option,
    label: normalizedText(option.textContent || option.label || option.value) || `Option ${index + 1}`,
    value: String(option.value ?? attribute(option, "value") ?? option.textContent ?? ""),
    disabled: Boolean(option.disabled || hasAttribute(option, "disabled")),
  }));
}

function descriptorFor(element, root) {
  const type = normalizedText(element.type || attribute(element, "type") || "text").toLowerCase();
  const kind = element.tagName === "SELECT" ? "select" :
    element.tagName === "TEXTAREA" || canReceiveText(element) ? "text" :
    type === "checkbox" ? "checkbox" : type === "radio" ? "radio" : "button";
  return {
    element,
    root,
    kind,
    type,
    label: controlLabel(element, kind),
    value: String(element.value ?? attribute(element, "value") ?? ""),
    checked: Boolean(element.checked),
    disabled: Boolean(element.disabled || hasAttribute(element, "disabled")),
    required: Boolean(element.required || hasAttribute(element, "required")),
    options: kind === "select" ? optionList(element) : [],
  };
}

function descendantControls(document) {
  const result = [];
  for (const tag of CONTROL_TAGS) result.push(...(document?.querySelectorAll?.(tag) || []));
  return result;
}

function rootAction(root) {
  const active = normalizedText(root?.dataset?.screen).toLowerCase();
  if (!root || listenerCount(root, "click") < 1 || ["loading", "error"].includes(active)) return null;
  const label = active === "pause" || active === "paused" ? "Resume" :
    ["title", "start", "home", "welcome", "intro"].includes(active) ? "Play" : "Continue";
  return { element: root, root, kind: "button", type: "button", label, value: "", checked: false,
    disabled: false, required: false, options: [], syntheticRootAction: true };
}

export function collectHtmlInteractionGate(document) {
  const groups = new Map();
  for (const element of descendantControls(document)) {
    if (!semanticControl(element) || !elementIsVisible(element, document)) continue;
    const root = gateRootFor(element, document);
    if (!root || !elementIsVisible(root, document) || !belongsToActiveScreen(element, root)) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(descriptorFor(element, root));
  }
  for (const root of document?.querySelectorAll?.("div") || []) {
    if (!elementIsVisible(root, document) || listenerCount(root, "click") < 1) continue;
    const action = rootAction(root);
    if (!action) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).unshift(action);
  }
  if (!groups.size) return null;
  const ranked = [...groups.entries()].sort((a, b) => {
    const aScreen = a[0].dataset?.screen != null ? 1 : 0;
    const bScreen = b[0].dataset?.screen != null ? 1 : 0;
    return bScreen - aScreen || b[1].length - a[1].length;
  });
  const [root, controls] = ranked[0];
  const unique = [];
  const seen = new Set();
  for (const control of controls) {
    if (seen.has(control.element) || control.disabled) continue;
    seen.add(control.element);
    unique.push(control);
  }
  return unique.length ? { root, screen: normalizedText(root.dataset?.screen), controls: unique } : null;
}

function dispatch(element, type) {
  return element?.dispatchEvent?.(new Event(type, { bubbles: true, cancelable: true })) ?? true;
}

export function setHtmlControlValue(control, value, { commit = false } = {}) {
  const element = control?.element ?? control;
  if (!element || element.disabled) return false;
  const descriptor = control?.element ? control : descriptorFor(element, gateRootFor(element, element.ownerDocument));
  if (descriptor.kind === "checkbox" || descriptor.kind === "radio") {
    element.checked = Boolean(value);
    dispatch(element, "input");
    dispatch(element, "change");
    return true;
  }
  if (descriptor.kind === "select") {
    const requested = String(value);
    const options = optionList(element);
    const selected = options.find(option => option.value === requested && !option.disabled);
    if (!selected) return false;
    element.value = selected.value;
    for (const option of options) option.element.selected = option === selected;
    dispatch(element, "input");
    dispatch(element, "change");
    return true;
  }
  element.value = String(value ?? "");
  dispatch(element, "input");
  if (commit) dispatch(element, "change");
  return true;
}

export function activateHtmlControl(control) {
  if (!control || control.disabled) return false;
  const element = control.element;
  if (control.kind === "checkbox") return setHtmlControlValue(control, !element.checked, { commit: true });
  if (control.kind === "radio") return setHtmlControlValue(control, true, { commit: true });
  if (control.kind === "select") {
    const options = control.options.filter(option => !option.disabled);
    if (!options.length) return false;
    const current = Math.max(0, options.findIndex(option => option.value === String(element.value ?? "")));
    return setHtmlControlValue(control, options[(current + 1) % options.length].value, { commit: true });
  }
  if (control.kind === "text") return true;
  element.focus?.();
  element.click?.();
  return true;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
}

function fitText(value, length = 52) {
  const text = normalizedText(value);
  return text.length <= length ? text : `${text.slice(0, Math.max(1, length - 1))}…`;
}

function typedCharacter(input) {
  const code = Number(input.code);
  if (code >= 65 && code <= 90) {
    const value = String.fromCharCode(code);
    return input.shiftKey ? value : value.toLowerCase();
  }
  if (code >= 48 && code <= 57) {
    const plain = String.fromCharCode(code);
    return input.shiftKey ? ")!@#$%^&*("[code - 48] : plain;
  }
  if (code === 32) return " ";
  const punctuation = {
    186: input.shiftKey ? ":" : ";", 187: input.shiftKey ? "+" : "=", 188: input.shiftKey ? "<" : ",",
    189: input.shiftKey ? "_" : "-", 190: input.shiftKey ? ">" : ".", 191: input.shiftKey ? "?" : "/",
    192: input.shiftKey ? "~" : "`", 219: input.shiftKey ? "{" : "[", 220: input.shiftKey ? "|" : "\\",
    221: input.shiftKey ? "}" : "]", 222: input.shiftKey ? "\"" : "'",
  };
  return punctuation[code] ?? "";
}

export class HtmlInteractionBridge {
  constructor({ document, viewport, createCanvas, trace = false } = {}) {
    this.document = document;
    this.viewport = viewport ?? (() => ({ width: 1280, height: 720 }));
    this.createCanvas = createCanvas ?? (() => document.createElement("canvas"));
    this.trace = trace;
    this.canvas = null;
    this.context = null;
    this.gate = null;
    this.signature = "";
    this.focusIndex = 0;
    this.scrollIndex = 0;
    this.hitRegions = [];
    this.lastScan = -Infinity;
    this.dirty = false;
  }

  controlSignature(gate) {
    if (!gate) return "";
    return `${gate.screen}|${gate.controls.map(control => [control.kind, control.label, control.element.value,
      control.element.checked, control.element.disabled, control.options.map(option => option.value).join(",")].join(":" )).join("|")}`;
  }

  update(now = performance.now(), force = false) {
    if (!force && now - this.lastScan < 100) return Boolean(this.gate);
    this.lastScan = now;
    const gate = collectHtmlInteractionGate(this.document);
    const signature = this.controlSignature(gate);
    if (!gate) {
      this.hide();
      return false;
    }
    this.gate = gate;
    if (!this.canvas) this.mount();
    if (signature !== this.signature || this.dirty) {
      this.signature = signature;
      this.focusIndex = Math.max(0, Math.min(this.focusIndex, gate.controls.length - 1));
      this.render();
    }
    return true;
  }

  mount() {
    const canvas = this.createCanvas();
    canvas.id = "threebrowser-html-interaction-overlay";
    canvas.dataset.threeBrowserOwned = "interaction-bridge";
    canvas.style.position = "fixed";
    canvas.style.left = "0";
    canvas.style.top = "0";
    canvas.style.zIndex = "2147483647";
    canvas.style.pointerEvents = "auto";
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.document.body.appendChild(canvas);
    canvas.focus?.();
    if (this.trace) console.error("ThreeBrowser HTML interaction gate mounted");
  }

  hide() {
    if (!this.canvas) {
      this.gate = null;
      this.signature = "";
      return;
    }
    this.commitFocused();
    this.canvas.remove?.();
    this.canvas = null;
    this.context = null;
    this.gate = null;
    this.signature = "";
    this.hitRegions = [];
    if (this.trace) console.error("ThreeBrowser HTML interaction gate dismissed");
  }

  layout() {
    const viewport = this.viewport();
    const width = Math.max(320, Math.trunc(viewport.width || 1280));
    const height = Math.max(240, Math.trunc(viewport.height || 720));
    const panelWidth = Math.min(620, Math.max(300, width - 48));
    const visibleRows = Math.max(2, Math.min(7, Math.floor((height - 190) / 64)));
    const rowCount = Math.min(visibleRows, this.gate?.controls.length || 0);
    const panelHeight = 126 + rowCount * 64 + 28;
    return { width, height, panelWidth, panelHeight, visibleRows,
      panelX: Math.round((width - panelWidth) / 2), panelY: Math.max(24, Math.round((height - panelHeight) / 2)) };
  }

  render() {
    if (!this.context || !this.canvas || !this.gate) return;
    const layout = this.layout();
    this.canvas.width = layout.width;
    this.canvas.height = layout.height;
    this.canvas.style.width = `${layout.width}px`;
    this.canvas.style.height = `${layout.height}px`;
    const context = this.context;
    context.clearRect(0, 0, layout.width, layout.height);
    context.fillStyle = "rgba(5, 10, 20, 0.78)";
    context.fillRect(0, 0, layout.width, layout.height);
    context.fillStyle = "#101827";
    roundedRect(context, layout.panelX, layout.panelY, layout.panelWidth, layout.panelHeight, 18);
    context.fillStyle = "#e8f1ff";
    context.font = "700 24px sans-serif";
    context.fillText("Page input required", layout.panelX + 28, layout.panelY + 38);
    context.fillStyle = "#91a4c2";
    context.font = "14px sans-serif";
    context.fillText("Complete the website controls to continue", layout.panelX + 28, layout.panelY + 66);

    const controls = this.gate.controls;
    if (this.focusIndex < this.scrollIndex) this.scrollIndex = this.focusIndex;
    if (this.focusIndex >= this.scrollIndex + layout.visibleRows) this.scrollIndex = this.focusIndex - layout.visibleRows + 1;
    this.scrollIndex = Math.max(0, Math.min(this.scrollIndex, Math.max(0, controls.length - layout.visibleRows)));
    this.hitRegions = [];
    const visible = controls.slice(this.scrollIndex, this.scrollIndex + layout.visibleRows);
    visible.forEach((control, row) => {
      const index = this.scrollIndex + row;
      const x = layout.panelX + 24;
      const y = layout.panelY + 88 + row * 64;
      const width = layout.panelWidth - 48;
      const focused = index === this.focusIndex;
      context.fillStyle = focused ? "#1d4ed8" : "#1b2638";
      roundedRect(context, x, y, width, 52, 10);
      context.fillStyle = "#f8fbff";
      context.font = control.kind === "button" ? "600 16px sans-serif" : "13px sans-serif";
      if (control.kind === "button") {
        context.fillText(fitText(control.label), x + 18, y + 31);
      } else {
        context.fillStyle = "#a9bad2";
        context.fillText(fitText(control.label, 44), x + 16, y + 18);
        context.fillStyle = "#ffffff";
        context.font = "16px sans-serif";
        const raw = String(control.element.value ?? control.value ?? "");
        const value = control.type === "password" ? "•".repeat(raw.length) : raw;
        const display = control.kind === "checkbox" || control.kind === "radio" ? (control.element.checked ? "On" : "Off") :
          control.kind === "select" ? (control.options.find(option => option.value === raw)?.label || "Choose…") : (value || "Type here…");
        context.fillText(fitText(display, 48), x + 16, y + 41);
      }
      this.hitRegions.push({ index, left: x, top: y, right: x + width, bottom: y + 52 });
    });
    if (controls.length > layout.visibleRows) {
      context.fillStyle = "#7185a4";
      context.font = "12px sans-serif";
      context.fillText(`${this.focusIndex + 1} / ${controls.length} · Tab or arrows to navigate`,
        layout.panelX + 28, layout.panelY + layout.panelHeight - 14);
    } else {
      context.fillStyle = "#7185a4";
      context.font = "12px sans-serif";
      context.fillText("Tab to navigate · Enter to activate", layout.panelX + 28, layout.panelY + layout.panelHeight - 14);
    }
    this.dirty = false;
  }

  focusedControl() {
    return this.gate?.controls[this.focusIndex] ?? null;
  }

  commitFocused() {
    const control = this.focusedControl();
    if (control?.kind === "text") setHtmlControlValue(control, control.element.value, { commit: true });
  }

  moveFocus(delta) {
    const length = this.gate?.controls.length || 0;
    if (!length) return;
    this.commitFocused();
    this.focusIndex = (this.focusIndex + delta + length) % length;
    this.focusedControl()?.element?.focus?.();
    this.dirty = true;
    this.render();
  }

  handlePointer(input) {
    if (!this.canvas || !this.gate) return false;
    if (input.type === "wheel" || input.type === "wheelhorizontal") {
      this.moveFocus(input.code > 0 ? -1 : 1);
      return true;
    }
    if (!input.type.startsWith("pointer")) return false;
    if (input.type === "pointermove") {
      const hit = this.hitRegions.find(region => input.x >= region.left && input.x <= region.right && input.y >= region.top && input.y <= region.bottom);
      if (hit && hit.index !== this.focusIndex) {
        this.focusIndex = hit.index;
        this.render();
      }
      return true;
    }
    if (input.type === "pointerup" && (input.code === 1 || input.code === 0)) {
      const hit = this.hitRegions.find(region => input.x >= region.left && input.x <= region.right && input.y >= region.top && input.y <= region.bottom);
      if (hit) {
        this.focusIndex = hit.index;
        const control = this.focusedControl();
        control?.element?.focus?.();
        if (control?.kind !== "text") activateHtmlControl(control);
        this.dirty = true;
        this.update(performance.now(), true);
      }
      return true;
    }
    return true;
  }

  handleKey(input) {
    if (!this.canvas || !this.gate || input.type !== "keydown") return Boolean(this.canvas);
    if (input.code === 9) {
      this.moveFocus(input.shiftKey ? -1 : 1);
      return true;
    }
    if (input.code === 38 || input.code === 37) {
      this.moveFocus(-1);
      return true;
    }
    if (input.code === 40 || input.code === 39) {
      this.moveFocus(1);
      return true;
    }
    const control = this.focusedControl();
    if (!control) return true;
    if (input.code === 13) {
      if (control.kind === "text") setHtmlControlValue(control, control.element.value, { commit: true });
      else activateHtmlControl(control);
      this.dirty = true;
      this.update(performance.now(), true);
      return true;
    }
    if (input.code === 32 && control.kind !== "text") {
      activateHtmlControl(control);
      this.dirty = true;
      this.update(performance.now(), true);
      return true;
    }
    if (control.kind !== "text" || input.ctrlKey || input.altKey) return true;
    let value = String(control.element.value ?? "");
    if (input.code === 8) value = value.slice(0, -1);
    else if (input.code === 46) value = "";
    else {
      const character = typedCharacter(input);
      if (!character) return true;
      const rawMaxLength = control.element.maxLength ?? attribute(control.element, "maxlength");
      const maxLength = rawMaxLength == null ? null : Number(rawMaxLength);
      if (maxLength !== null && Number.isFinite(maxLength) && maxLength >= 0 && value.length >= maxLength) return true;
      value += character;
    }
    setHtmlControlValue(control, value);
    this.dirty = true;
    this.render();
    return true;
  }

  consumeNativeInput(input) {
    if (!this.canvas) return false;
    if (input.type.startsWith("pointer") || input.type === "wheel" || input.type === "wheelhorizontal") {
      return this.handlePointer(input);
    }
    return this.handleKey(input);
  }
}
