// A deliberately bounded DOM painter. Application scripts and event handlers
// remain on the existing DOM; this module only resolves styles, lays out boxes,
// paints Canvas2D pixels, and routes input to those same nodes.
import { activateHtmlControl, setHtmlControlValue } from './html-interaction-bridge.mjs';

const omitted = new Set(['HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE']);
const inline = new Set(['SPAN', 'A', 'B', 'STRONG', 'EM', 'I', 'LABEL', 'SMALL', 'CODE']);
const controls = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
const camel = name => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
export function declarations(text) {
  const result = {};
  for (const part of String(text).split(/;(?![^()]*\))/)) {
    const colon = part.indexOf(':');
    if (colon > 0) {
      const name = part.slice(0, colon).trim();
      result[name.startsWith('--') ? name : camel(name)] = part.slice(colon + 1).trim();
      if (name === 'background') {
        const value = part.slice(colon + 1).trim();
        result.backgroundColor = /^(#[0-9a-f]+|rgba?\([^)]*\)|[a-z]+)(?:\s*!important)?$/i.test(value) ? value : 'transparent';
      }
    }
  }
  return result;
}

function simpleMatch(node, selector) {
  if (!node?.tagName || node.nodeType !== 1) return false;
  const escaped = [];
  const restore = value => value.replace(/__cssEscape(\d+)__/g, (_, index) => escaped[+index]);
  let token = selector.replace(/\\(.)/g, (_, character) => { escaped.push(character); return `__cssEscape${escaped.length - 1}__`; });
  let failed = false;
  token = token.replace(/:not\(([^()]+)\)/g, (_, value) => { failed ||= simpleMatch(node, value); return ''; });
  token = token.replace(/:(root|first-child|last-child|checked|disabled|focus)\b/g, (_, name) => {
    const siblings = (node.parentNode?.children || []).filter(n => n.nodeType === 1);
    failed ||= !({ root: node === node.ownerDocument?.documentElement,
      'first-child': siblings[0] === node, 'last-child': siblings.at(-1) === node,
      checked: node.checked, disabled: node.disabled, focus: node.ownerDocument?.activeElement === node })[name];
    return '';
  });
  // Unsupported pseudo selectors must not accidentally apply their styles.
  if (failed || token.includes(':')) return false;
  token = token.replace(/\[([\w-]+)(?:\s*=\s*["']?([^\]"']+)["']?)?\]/g, (_, name, value) => {
    failed ||= node.getAttribute?.(name) == null || (value !== undefined && node.getAttribute(name) !== value);
    return '';
  });
  const tag = /^[\w-]+/.exec(token)?.[0];
  const remainder = token.replace(/^[\w-]+|^\*/, '').replace(/[#.][\w-]+/g, '');
  if (remainder) return false;
  return !failed && (!tag || node.tagName === tag.toUpperCase()) &&
    [...token.matchAll(/#([\w-]+)/g)].every(m => node.id === restore(m[1])) &&
    [...token.matchAll(/\.([\w-]+)/g)].every(m => String(node.className || '').split(/\s+/).includes(restore(m[1])));
}

export function matchesSelector(node, selector) {
  if (/[+~]/.test(selector)) return false;
  const parts = selector.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
  let index = parts.length - 1;
  if (!simpleMatch(node, parts[index--])) return false;
  while (index >= 0) {
    if (parts[index] === '>') {
      node = node.parentNode;
      if (!simpleMatch(node, parts[--index])) return false;
    } else {
      do { node = node.parentNode; } while (node && !simpleMatch(node, parts[index]));
      if (!node) return false;
    }
    index--;
  }
  return true;
}

function sizeQuery(query, viewport) {
  const conditions = [...query.matchAll(/\(\s*(?:(min|max)-(width|height)\s*:\s*([\d.]+)(px|rem)|(width|height)\s*(<=|>=|<|>|=)\s*([\d.]+)(px|rem))\s*\)/g)];
  return conditions.length > 0 && conditions.every(m => {
    const actual = viewport[m[2] || m[5]], limit = +(m[3] || m[7]) * ((m[4] || m[8]) === 'rem' ? 16 : 1);
    const op = m[1] ? (m[1] === 'min' ? '>=' : '<=') : m[6];
    return op === '<=' ? actual <= limit : op === '>=' ? actual >= limit : op === '<' ? actual < limit : op === '>' ? actual > limit : actual === limit;
  });
}
function parseRules(text, viewport) {
  const rules = [];
  // Balanced blocks keep nested media/layer rules separate from declarations.
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '');
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('{', cursor);
    if (start < 0) break;
    let end = start + 1, depth = 1, quote = '';
    for (; end < source.length && depth; end++) {
      const c = source[end];
      if (quote) { if (c === quote && source[end - 1] !== '\\') quote = ''; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    const selector = source.slice(cursor, start).trim();
    const body = source.slice(start + 1, end - 1);
    cursor = end;
    if (selector.startsWith('@')) {
      if (selector.startsWith('@container')) {
        const name = /^@container\s+([\w-]+)\s*\(/.exec(selector)?.[1];
        rules.push(...parseRules(body, viewport).map(rule => ({ ...rule, containers: [...(rule.containers || []), { query: selector, name }] })));
      } else if (selector.startsWith('@layer') || (selector.startsWith('@media') && sizeQuery(selector, viewport))) rules.push(...parseRules(body, viewport));
      continue;
    }
    for (const part of selector.split(',')) rules.push({ selector: part.trim(), values: declarations(body),
      weight: (part.match(/#/g)?.length || 0) * 100 + (part.match(/[.[:]/g)?.length || 0) * 10 +
        (part.match(/(?:^|[ >])[a-zA-Z]/g)?.length || 0) });
  }
  return rules;
}

export function length(value, parent, fallback = 0, font = 16, viewport = { width: globalThis.innerWidth || 1280, height: globalThis.innerHeight || 720 }) {
  if (value == null || value === '' || value === 'auto') return fallback;
  const clamp = /^clamp\(([^,]+),([^,]+),([^,]+)\)$/.exec(String(value));
  if (clamp) return Math.max(length(clamp[1].trim(), parent, fallback, font, viewport), Math.min(length(clamp[3].trim(), parent, fallback, font, viewport), length(clamp[2].trim(), parent, fallback, font, viewport)));
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  if (/^[+-]?[\d.]+(?:d|s|l)?vw$/.test(String(value))) return viewport.width * n / 100;
  if (/^[+-]?[\d.]+(?:d|s|l)?vh$/.test(String(value))) return viewport.height * n / 100;
  if (String(value).endsWith('cqw')) return parent * n / 100;
  return String(value).endsWith('%') ? parent * n / 100 : String(value).endsWith('rem') ? n * 16 :
    String(value).endsWith('em') ? n * font : n;
}
function edges(value, parent, font) {
  const list = String(value || '0').split(/\s+/).map(v => length(v, parent, 0, font));
  return [list[0], list[1] ?? list[0], list[2] ?? list[0], list[3] ?? list[1] ?? list[0]];
}

export class HtmlRenderer {
  constructor({ document, viewport, createCanvas, presentedCanvas = () => null }) {
    Object.assign(this, { document, viewport, createCanvas, presentedCanvas });
    this.boxes = []; this.rules = []; this.styles = new Map(); this.lastScan = -Infinity; this.signature = '';
  }
  refreshStyles() {
    const source = [...this.document.querySelectorAll('*')].filter(node => ['STYLE', 'LINK'].includes(node.tagName))
      .map(node => `${node.textContent || ''}\n${node._cssText || ''}\n${(node.sheet?.cssRules || []).map(r => r.cssText).join('\n')}`).join('\n');
    const key = `${this.viewport().width}:${source}`;
    if (key !== this.styleKey) { this.styleKey = key; this.rules = parseRules(source, this.viewport()); }
    this.styles = new Map();
  }
  style(node) {
    if (this.styles?.has(node)) return this.styles.get(node);
    const parent = node.parentNode?.tagName ? this.style(node.parentNode) : {};
    const style = { color: parent.color || '#ffffff', fontSize: parent.fontSize || '16px',
      fontFamily: parent.fontFamily || 'sans-serif', fontWeight: parent.fontWeight || 'normal',
      pointerEvents: parent.pointerEvents || 'auto', display: inline.has(node.tagName) ? 'inline' : 'block' };
    for (const [key, value] of Object.entries(parent)) if (key.startsWith('--')) style[key] = value;
    const priorities = {};
    for (const rule of this.rules) if (matchesSelector(node, rule.selector) && (rule.containers || []).every(condition => {
      for (let ancestor = node.parentNode; ancestor?.tagName; ancestor = ancestor.parentNode) {
        const container = this.style(ancestor);
        if (!container.containerType && !container.container) continue;
        if (condition.name && container.containerName !== condition.name && !container.container?.startsWith(`${condition.name}/`)) continue;
        const viewport = this.viewport();
        return sizeQuery(condition.query, { width: length(container.width, viewport.width, viewport.width, 16, viewport), height: length(container.height, viewport.height, viewport.height, 16, viewport) });
      }
      return false;
    })) for (const [key, raw] of Object.entries(rule.values)) {
      const important = /\s*!important$/.test(raw);
      const priority = rule.weight + (important ? 100000 : 0);
      if ((priorities[key] ?? -1) <= priority) { style[key] = raw.replace(/\s*!important$/, ''); priorities[key] = priority; }
    }
    const direct = { ...declarations(node.style?.cssText || ''), ...node.style };
    for (const [rawKey, value] of Object.entries(direct)) if (typeof value !== 'function' && rawKey !== 'cssText') {
      const key = rawKey.startsWith('--') ? rawKey : camel(rawKey);
      if ((priorities[key] || 0) < 100000 || /!important$/.test(String(value))) style[key] = String(value).replace(/\s*!important$/, '');
    }
    for (const key of Object.keys(style)) if (!key.startsWith('--')) {
      if (style[key] === 'inherit') style[key] = parent[key] ?? '';
      for (let depth = 0; depth < 8 && style[key].includes('var('); depth++) {
        style[key] = style[key].replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, name, fallback) => style[name] ?? fallback ?? '');
      }
    }
    this.styles?.set(node, style);
    return style;
  }
  layout() {
    this.boxes = [];
    const viewport = { x: 0, y: 0, ...this.viewport() };
    const cssLength = (value, parent, fallback = 0, font = 16) => length(value, parent, fallback, font, viewport);
    const visit = (node, parent, x, y, inheritedOpacity = 1) => {
      if (node.nodeType === 3 || omitted.has(node.tagName) || node.dataset?.threeBrowserOwned) return null;
      const s = this.style(node);
      if (node.hidden || s.display === 'none' || s.visibility === 'hidden' || node.type === 'hidden') return null;
      const opacity = inheritedOpacity * (s.opacity == null ? 1 : Number(s.opacity));
      if (opacity <= 0) return null;
      const font = cssLength(s.fontSize, parent.width, 16), line = /^[\d.]+$/.test(s.lineHeight || '') ? +s.lineHeight * font : length(s.lineHeight, font, font * 1.35, font);
      const pad = edges(s.padding, parent.width, font), margin = edges(s.margin, parent.width, font);
      ['Top', 'Right', 'Bottom', 'Left'].forEach((side, i) => {
        pad[i] = length(s[`padding${side}`], parent.width, pad[i], font);
        margin[i] = length(s[`margin${side}`], parent.width, margin[i], font);
      });
      const fixed = s.position === 'fixed', absolute = fixed || s.position === 'absolute';
      const containing = fixed ? viewport : parent;
      const text = (node.children || []).filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
      const control = controls.has(node.tagName);
      const displayText = control ? (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' ?
        (node.type === 'password' ? '•'.repeat(node.value.length) : node.value || node.getAttribute('placeholder') || '') : node.textContent) : text;
      this.context.font = `${s.fontWeight} ${font}px ${s.fontFamily}`;
      const natural = this.context.measureText(displayText || '').width + pad[1] + pad[3] + (control ? 24 : 0);
      let width = cssLength(s.width, containing.width, parent.flexWidths?.get(node) ?? ((s.display === 'inline' || s.display === 'inline-block' || control) ? Math.max(24, natural) : parent.width - margin[1] - margin[3]), font);
      width = Math.max(width, cssLength(s.minWidth, containing.width));
      width = Math.max(0, Math.min(width, length(s.maxWidth, containing.width, Infinity, font)));
      let height = cssLength(s.height, containing.height, 0, font);
      height = Math.max(height, cssLength(s.minHeight, containing.height));
      x += margin[3]; y += margin[0];
      if (absolute) {
        if (s.width == null && s.left != null && s.right != null) width = containing.width - length(s.left, containing.width) - length(s.right, containing.width);
        x = containing.x + length(s.left, containing.width, s.right != null ? containing.width - width - length(s.right, containing.width) : x - containing.x);
        y = containing.y + length(s.top, containing.height, 0);
        if (s.inset != null) { const inset = edges(s.inset, containing.width, font); x = containing.x + inset[3]; y = containing.y + inset[0]; width = containing.width - inset[1] - inset[3]; height ||= containing.height - inset[0] - inset[2]; }
      }
      const box = { node, s, x, y, width, height, opacity, font, line, text: displayText, pad, control, absolute, clip: parent.clip, parent: parent.box };
      this.boxes.push(box);
      if (node.tagName === 'CANVAS' || node.tagName === 'IMG') {
        box.width = cssLength(s.width, containing.width, node.width || width);
        box.height = cssLength(s.height, containing.height, node.height || height);
      } else {
        const content = { x: x + pad[3], y: y + pad[0], width: Math.max(0, width - pad[1] - pad[3]), height: height || parent.height,
          clip: ['hidden', 'clip', 'scroll', 'auto'].includes(s.overflow) && height ? { x, y, width, height } : parent.clip, box };
        let cx = content.x, cy = content.y, rowHeight = 0;
        const horizontal = s.display === 'flex' && s.flexDirection !== 'column';
        if (displayText) {
          this.context.font = `${s.fontWeight} ${font}px ${s.fontFamily}`;
          box.lines = this.wrap(displayText, content.width || width);
          if (horizontal && !control) { cx += this.context.measureText(displayText).width + length(s.gap, width); rowHeight = line; }
          else cy += box.lines.length * line;
        }
        if (horizontal && !control) {
          const children = (node.children || []).filter(child => child.nodeType === 1 && !['absolute', 'fixed'].includes(this.style(child).position) && this.style(child).display !== 'none');
          const bases = children.map(child => this.intrinsicWidth(child, content.width));
          const remaining = Math.max(0, content.width - (cx - content.x) - Math.max(0, children.length - 1) * length(s.gap, width));
          const total = bases.reduce((sum, value) => sum + value, 0);
          content.flexWidths = new Map(children.map((child, index) => [child, bases[index] * Math.min(1, remaining / (total || 1))]));
        }
        const flow = [];
        if (!control) for (const child of node.children || []) {
          if (child.nodeType === 3) continue;
          const childStyle = this.style(child), inRow = horizontal || childStyle.display.startsWith('inline');
          if (!inRow && rowHeight) { cy += rowHeight; cx = content.x; rowHeight = 0; }
          const childBox = visit(child, content, cx, cy, opacity);
          if (!childBox || childBox.absolute) continue;
          flow.push(childBox);
          if (inRow) { cx += childBox.width + length(s.gap, width); rowHeight = Math.max(rowHeight, childBox.height); }
          else cy = childBox.y + childBox.height + length(childStyle.marginBottom, width) + length(s.gap, width);
        }
        box.height ||= Math.max(control ? line + 12 : 0, cy + rowHeight - y + pad[2]);
        if (s.display === 'flex' && flow.length) {
          const available = horizontal ? content.width : box.height - pad[0] - pad[2];
          const used = horizontal ? cx - content.x - length(s.gap, width) : cy - content.y - length(s.gap, width);
          const spare = Math.max(0, available - used);
          const initial = s.justifyContent === 'center' ? spare / 2 : ['flex-end', 'end'].includes(s.justifyContent) ? spare : 0;
          const between = s.justifyContent === 'space-between' && flow.length > 1 ? spare / (flow.length - 1) : 0;
          flow.forEach((childBox, index) => {
            const crossSpare = horizontal ? box.height - pad[0] - pad[2] - childBox.height : content.width - childBox.width;
            const cross = s.alignItems === 'center' ? crossSpare / 2 : ['flex-end', 'end'].includes(s.alignItems) ? crossSpare : 0;
            this.moveBox(childBox, horizontal ? initial + index * between : cross, horizontal ? cross : initial + index * between);
          });
        }
      }
      if (absolute && s.bottom != null && s.top == null) {
        const dy = containing.y + containing.height - box.height - length(s.bottom, containing.height) - box.y;
        const start = this.boxes.indexOf(box);
        for (const entry of this.boxes.slice(start)) entry.y += dy;
      }
      box.height = Math.max(box.height, length(s.minHeight, containing.height));
      return box;
    };
    visit(this.document.body, viewport, 0, 0);
    // The native surface presents one GPU canvas full-window. Map its DOM
    // coordinate space (including sibling HUD controls) onto that surface.
    const canvas = this.presentedCanvas();
    const surface = this.boxes.find(box => box.node === canvas);
    if (surface && surface.width > 0 && surface.height > 0) {
      const sx = viewport.width / surface.width, sy = viewport.height / surface.height;
      const originX = surface.x, originY = surface.y;
      for (const box of this.boxes) {
        box.x = (box.x - originX) * sx; box.y = (box.y - originY) * sy;
        box.width *= sx; box.height *= sy; box.font *= Math.min(sx, sy); box.line *= sy;
        box.pad = box.pad.map((value, i) => value * (i % 2 ? sx : sy));
        if (box.clip) box.clip = { x: (box.clip.x - originX) * sx, y: (box.clip.y - originY) * sy, width: box.clip.width * sx, height: box.clip.height * sy };
      }
    }
  }
  moveBox(root, dx, dy) {
    for (const box of this.boxes) {
      let ancestor = box;
      while (ancestor && ancestor !== root) ancestor = ancestor.parent;
      if (!ancestor) continue;
      box.x += dx; box.y += dy;
      if (box.clip && box.clip !== root.clip) box.clip = { ...box.clip, x: box.clip.x + dx, y: box.clip.y + dy };
    }
  }
  intrinsicWidth(node, available) {
    const s = this.style(node), font = length(s.fontSize, available, 16, 16, this.viewport());
    this.context.font = `${s.fontWeight} ${font}px ${s.fontFamily}`;
    const text = (node.children || []).filter(child => child.nodeType === 3).map(child => child.textContent).join(' ').trim();
    const own = this.context.measureText(text).width;
    const children = (node.children || []).filter(child => child.nodeType === 1 && !omitted.has(child.tagName) && this.style(child).display !== 'none' && !['absolute', 'fixed'].includes(this.style(child).position));
    const widths = children.map(child => this.intrinsicWidth(child, available));
    const horizontal = s.display === 'flex' && s.flexDirection !== 'column';
    const pad = edges(s.padding, available, font);
    const natural = (horizontal ? own + widths.reduce((a, b) => a + b, 0) + Math.max(0, children.length - 1) * length(s.gap, available) : Math.max(own, ...widths, 0)) + pad[1] + pad[3];
    return Math.max(length(s.minWidth, available), Math.min(length(s.maxWidth, available, available), length(s.width, available, natural, font, this.viewport())));
  }
  wrap(text, width) {
    const lines = []; let line = '';
    for (const word of String(text).split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && this.context.measureText(next).width > width) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }
  update(now = performance.now(), force = false) {
    if (!force && now - this.lastScan < 100) return;
    this.lastScan = now;
    if (!this.canvas) {
      this.canvas = this.createCanvas(); this.canvas.dataset.threeBrowserOwned = 'html-renderer';
      Object.assign(this.canvas.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483646', pointerEvents: 'none' });
      this.context = this.canvas.getContext('2d');
    }
    this.refreshStyles(); this.layout();
    const visible = this.boxes.some(b => b.text || b.control || b.node.tagName === 'IMG' || b.s.background || b.s.backgroundColor);
    if (!visible) { this.hide(); return; }
    const { width, height } = this.viewport();
    const signature = JSON.stringify([width, height, this.boxes.map(b => [b.x, b.y, b.width, b.height, b.text, b.s, b.node.checked, b.node.disabled])]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.canvas.width = width; this.canvas.height = height;
    Object.assign(this.canvas.style, { width: `${width}px`, height: `${height}px` });
    this.paint();
    if (!this.canvas.parentNode) this.document.body.appendChild(this.canvas);
  }
  paint() {
    const ctx = this.context;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    // Stable paint order for sibling HUD layers. Full CSS stacking contexts
    // and transformed compositing are outside this first renderer's scope.
    const ordered = [];
    const collect = parent => {
      const children = this.boxes.filter(box => box.parent === parent).sort((a, b) => (parseFloat(a.s.zIndex) || 0) - (parseFloat(b.s.zIndex) || 0));
      for (const child of children) { ordered.push(child); collect(child); }
    };
    collect(undefined);
    this.boxes = ordered;
    for (const b of this.boxes) {
      const { x, y, width, height, s, node } = b;
      if (node.tagName === 'CANVAS') { ctx.clearRect(x, y, width, height); continue; }
      ctx.save(); ctx.globalAlpha = b.opacity;
      if (b.clip) { ctx.beginPath(); ctx.rect(b.clip.x, b.clip.y, b.clip.width, b.clip.height); ctx.clip(); }
      const background = s.backgroundColor || s.background || (b.control ? '#233247' : null);
      // Unsupported background images/gradients are transparent, not black
      // rectangles produced by passing invalid color strings to Canvas2D.
      if (background && !/gradient\(|url\(|^(?:none|initial|0\s)/.test(background)) { ctx.fillStyle = background; ctx.fillRect(x, y, width, height); }
      if (s.border && parseFloat(s.border) > 0) { ctx.strokeStyle = s.border.split(/\s+/).at(-1); ctx.lineWidth = parseFloat(s.border); ctx.strokeRect(x, y, width, height); }
      if (node.tagName === 'IMG' && node.complete && node.naturalWidth) ctx.drawImage(node, x, y, width, height);
      ctx.fillStyle = s.color; ctx.font = `${s.fontWeight} ${b.font}px ${s.fontFamily}`;
      ctx.textBaseline = 'top';
      let label = b.lines || [];
      if (node.tagName === 'INPUT' && ['checkbox', 'radio'].includes(node.type)) label = [node.checked ? '[x]' : '[ ]'];
      for (let i = 0; i < label.length; i++) ctx.fillText(label[i], x + b.pad[3] + (b.control ? 8 : 0), y + b.pad[0] + i * b.line + (b.control ? 6 : 0));
      ctx.restore();
    }
  }
  hide() { this.canvas?.remove(); this.signature = ''; this.boxes = []; }
  consumeNativeInput(input) {
    if (this.document.pointerLockElement) return false;
    const controlFor = node => ({ element: node, kind: node.tagName === 'SELECT' ? 'select' :
      ['checkbox', 'radio'].includes(node.type) ? node.type : ['INPUT', 'TEXTAREA'].includes(node.tagName) ? 'text' : 'button',
      options: (node.children || []).filter(n => n.tagName === 'OPTION').map(n => ({ value: n.value, disabled: n.disabled })) });
    if (input.type.startsWith('pointer')) {
      const hit = [...this.boxes].reverse().find(b => b.s.pointerEvents !== 'none' && !b.node.disabled &&
        input.x >= b.x && input.x < b.x + b.width && input.y >= b.y && input.y < b.y + b.height &&
        (b.control || b.node.tagName === 'A' || b.node._eventListeners?.get('click')?.length));
      if (!hit) { if (input.type === 'pointerdown') this.focused = null; return false; }
      if (input.type === 'pointerup' && (input.code === 0 || input.code === 1)) {
        hit.node.focus?.(); this.focused = hit.node;
        if (hit.node.type === 'range') {
          const min = Number(hit.node.getAttribute('min') || 0), max = Number(hit.node.getAttribute('max') || 100);
          const step = Number(hit.node.getAttribute('step') || 1);
          let value = min + Math.max(0, Math.min(1, (input.x - hit.x) / hit.width)) * (max - min);
          if (step > 0) value = min + Math.round((value - min) / step) * step;
          setHtmlControlValue(controlFor(hit.node), Math.max(min, Math.min(max, value)), { commit: true });
        } else if (controlFor(hit.node).kind !== 'text') activateHtmlControl(controlFor(hit.node));
        this.update(performance.now(), true);
      }
      return true;
    }
    if (input.type !== 'keydown') return Boolean(this.focused && this.document.activeElement === this.focused);
    if (input.code === 9) {
      const nodes = this.boxes.filter(b => b.control && !b.node.disabled).map(b => b.node);
      if (!nodes.length) return false;
      const index = nodes.indexOf(this.document.activeElement);
      this.focused = nodes[(index + (input.shiftKey ? -1 : 1) + nodes.length) % nodes.length];
      this.focused.focus(); return true;
    }
    if (!this.focused || this.document.activeElement !== this.focused) return false;
    const descriptor = controlFor(this.focused);
    if (input.code === 13 || (input.code === 32 && descriptor.kind !== 'text')) activateHtmlControl(descriptor);
    else if (descriptor.kind === 'text' && !input.ctrlKey && !input.altKey) {
      let value = this.focused.value;
      if (input.code === 8) value = value.slice(0, -1);
      else if (input.code >= 32 && input.code <= 126) value += input.code >= 65 && input.code <= 90 && !input.shiftKey ? String.fromCharCode(input.code).toLowerCase() : String.fromCharCode(input.code);
      setHtmlControlValue(descriptor, value, { commit: true });
    }
    this.update(performance.now(), true); return true;
  }
}
