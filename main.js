'use strict';

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  Menu,
  MarkdownRenderChild,
} = require('obsidian');

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  direction: 'both',      // 'both' | 'right'
  maxHeight: 600,         // px cap for the rendered block
  fontSize: 15,           // px, root/branch sizes derive from this
  hGap: 46,               // horizontal gap between depth columns
  vGap: 12,               // vertical gap between sibling nodes
  maxNodeWidth: 260,      // px before node text wraps
  colorfulBranches: true, // give each top-level branch its own hue
};

// Hues chosen to stay legible on both light and dark Obsidian themes.
const PALETTE = [
  '#4a8fe7', '#e2795b', '#54b98a', '#b579d8',
  '#e0a33c', '#4bb3c4', '#dd6a94', '#8a9a4f',
];

const SVG_NS = 'http://www.w3.org/2000/svg';

// Auto-fit never shrinks a map below this, so text stays readable.
const MIN_FIT_SCALE = 0.45;

// Marker shapes a map may assign to its tiers.
const TIER_SHAPES = ['bar', 'circle', 'diamond', 'square', 'pill'];

/**
 * Parse a `tiers:` option into [{ shape, label }].
 *
 *   tiers: bar, circle, diamond
 *   tiers: bar=Hamlet, circle=Town, diamond=City
 *
 * Returns [] for anything unusable, which leaves tier notation switched
 * off and `{n}` in node text treated as the literal characters it is.
 */
function parseTiers(spec) {
  if (!spec) return [];
  const out = [];
  for (const part of String(spec).split(',')) {
    const [rawShape, ...rest] = part.split('=');
    const shape = rawShape.trim().toLowerCase();
    if (!TIER_SHAPES.includes(shape)) return [];
    out.push({
      shape,
      label: rest.join('=').trim() || 'Tier ' + (out.length + 1),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Turn the body of a mindmap block into { options, root, isEmpty }.
 *
 * Markdown headings and indented bullets may be mixed freely:
 *
 *   # Root
 *   - Branch
 *     - Leaf
 *
 * An optional `---` fenced `key: value` block at the very top sets
 * per-map options that override the plugin settings.
 */
function parseMindmap(source) {
  const lines = source.replace(/\t/g, '    ').split(/\r?\n/);
  const options = {};
  let i = 0;

  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] !== undefined && lines[i].trim() === '---') {
    i++;
    while (i < lines.length && lines[i].trim() !== '---') {
      const m = lines[i].match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (m) options[m[1]] = m[2].trim();
      i++;
    }
    i++; // consume the closing ---
  }

  // Tier notation is live only in a map that declares its tiers, so adding
  // it can never change how an existing map parses. A node reading
  // "Match two digits \d{2}" keeps its braces unless this map opted in.
  const tiers = parseTiers(options.tiers);

  let nextId = 0;
  const roots = [];
  // Open ancestors. 'h' entries key on heading level, 'b' entries on indent.
  const stack = [];

  for (; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;

    const heading = raw.match(/^\s*(#{1,6})\s+(.*\S)\s*$/);
    const bullet = raw.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/);

    let kind;
    let key;
    let text;
    if (heading) {
      kind = 'h';
      key = heading[1].length;
      text = heading[2];
    } else if (bullet) {
      kind = 'b';
      key = bullet[1].length;
      text = bullet[2];
    } else {
      // A bare line is a convenient way to name the root without a bullet.
      const bare = raw.match(/^(\s*)(.*\S)\s*$/);
      if (!bare) continue;
      kind = 'b';
      key = bare[1].length;
      text = bare[2];
    }

    if (kind === 'h') {
      // A heading closes any bullets under it and any heading at its level.
      while (stack.length && (stack[stack.length - 1].kind === 'b' ||
             stack[stack.length - 1].key >= key)) stack.pop();
    } else {
      while (stack.length && stack[stack.length - 1].kind === 'b' &&
             stack[stack.length - 1].key >= key) stack.pop();
    }

    // A trailing {n} picks a tier, but only within the declared range —
    // "{9}" against three tiers stays literal rather than silently vanishing.
    let tier = 0;
    if (tiers.length) {
      const tm = text.match(/\s*\{(\d+)\}$/);
      if (tm) {
        const n = parseInt(tm[1], 10);
        if (n >= 1 && n <= tiers.length) {
          tier = n;
          text = text.slice(0, tm.index);
        }
      }
    }

    const parent = stack.length ? stack[stack.length - 1].node : null;
    const node = {
      id: nextId++,
      text,
      tier,
      depth: stack.length,
      parent,
      children: [],
    };
    if (parent) parent.children.push(node);
    else roots.push(node);

    stack.push({ kind, key, node });
  }

  // One top-level node is the root; several share an invisible hub.
  let root;
  if (roots.length === 1) {
    root = roots[0];
  } else {
    root = {
      id: -1, text: null, tier: 0, depth: 0, parent: null, children: roots,
    };
    const redepth = (n, d) => {
      n.depth = d;
      n.children.forEach((c) => redepth(c, d + 1));
    };
    roots.forEach((r) => { r.parent = root; redepth(r, 1); });
  }

  return { options, tiers, root, isEmpty: roots.length === 0 };
}

/* ------------------------------------------------------------------ *
 * Inline markdown
 * ------------------------------------------------------------------ */

const INLINE_RE = new RegExp([
  '`([^`]+)`',                          // code
  '\\*\\*([\\s\\S]+?)\\*\\*',           // bold
  '__([\\s\\S]+?)__',                   // bold
  '~~([\\s\\S]+?)~~',                   // strikethrough
  '==([\\s\\S]+?)==',                   // highlight
  '\\*([^*\\n]+?)\\*',                  // italic
  '_([^_\\n]+?)_',                      // italic
  '\\[\\[([^\\]]+?)\\]\\]',             // wiki link
  '\\[([^\\]]*?)\\]\\(([^)\\s]+)\\)',   // markdown link
].map((s) => '(?:' + s + ')').join('|'), 'g');

/**
 * Render a small, safe subset of inline markdown into `el`.
 * Text always goes in as text nodes, never as HTML.
 */
function renderInline(text, el, onWikiLink) {
  const re = new RegExp(INLINE_RE.source, 'g');
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      el.appendChild(document.createTextNode(text.slice(last, m.index)));
    }
    last = m.index + m[0].length;

    if (m[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[1];
      el.appendChild(code);
    } else if (m[2] !== undefined || m[3] !== undefined) {
      const strong = document.createElement('strong');
      renderInline(m[2] !== undefined ? m[2] : m[3], strong, onWikiLink);
      el.appendChild(strong);
    } else if (m[4] !== undefined) {
      const del = document.createElement('del');
      renderInline(m[4], del, onWikiLink);
      el.appendChild(del);
    } else if (m[5] !== undefined) {
      const mark = document.createElement('mark');
      renderInline(m[5], mark, onWikiLink);
      el.appendChild(mark);
    } else if (m[6] !== undefined || m[7] !== undefined) {
      const em = document.createElement('em');
      renderInline(m[6] !== undefined ? m[6] : m[7], em, onWikiLink);
      el.appendChild(em);
    } else if (m[8] !== undefined) {
      const parts = m[8].split('|');
      const target = parts[0].trim();
      const a = document.createElement('a');
      a.className = 'mm-internal-link';
      a.textContent = (parts[1] || parts[0]).trim();
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        onWikiLink(target, ev);
      });
      el.appendChild(a);
    } else if (m[9] !== undefined) {
      const a = document.createElement('a');
      a.className = 'mm-external-link';
      a.setAttribute('href', m[10]);
      a.setAttribute('rel', 'noopener');
      a.textContent = m[9] || m[10];
      a.addEventListener('click', (ev) => ev.stopPropagation());
      el.appendChild(a);
    }
  }
  if (last < text.length) {
    el.appendChild(document.createTextNode(text.slice(last)));
  }
}

/* ------------------------------------------------------------------ *
 * Measuring
 * ------------------------------------------------------------------ */

/**
 * Nodes are measured in a hidden sandbox on <body>, so layout works even
 * when the block itself has not been attached or painted yet.
 */
let sandbox = null;
function getSandbox() {
  if (!sandbox || !sandbox.isConnected) {
    sandbox = document.createElement('div');
    sandbox.className = 'mindmap-blocks mm-sandbox';
    document.body.appendChild(sandbox);
  }
  return sandbox;
}

function releaseSandbox() {
  if (sandbox && sandbox.isConnected) sandbox.remove();
  sandbox = null;
}

/* ------------------------------------------------------------------ *
 * One rendered map
 * ------------------------------------------------------------------ */

class MindMapRenderer {
  constructor(plugin, source, containerEl, sourcePath) {
    this.plugin = plugin;
    this.source = source;
    this.el = containerEl;
    this.sourcePath = sourcePath || '';

    this.tx = 0;
    this.ty = 0;
    this.scale = 1;
    this.userAdjusted = false;

    this.build();
  }

  /* ---- configuration ---- */

  config() {
    const s = this.plugin.settings;
    const o = this.options || {};
    const num = (v, fallback) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const bool = (v, fallback) => (
      v === undefined ? fallback : /^(true|yes|on|1)$/i.test(String(v))
    );

    const dir = String(o.direction || '').toLowerCase();
    return {
      direction: dir === 'right' || dir === 'both' ? dir : s.direction,
      maxHeight: num(o.height, s.maxHeight),
      fontSize: num(o.fontSize !== undefined ? o.fontSize : o['font-size'], s.fontSize),
      hGap: num(o.hGap, s.hGap),
      vGap: num(o.vGap, s.vGap),
      maxNodeWidth: num(o.nodeWidth, s.maxNodeWidth),
      colorful: bool(o.color !== undefined ? o.color : o.colorful, s.colorfulBranches),
    };
  }

  /* ---- construction ---- */

  build() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.refitFrame) {
      cancelAnimationFrame(this.refitFrame);
      this.refitFrame = 0;
    }

    this.el.empty();
    this.el.addClass('mindmap-blocks');

    let parsed;
    try {
      parsed = parseMindmap(this.source);
    } catch (err) {
      console.error('[mindmap-blocks] parse failed', err);
      this.el.createDiv({ cls: 'mm-error', text: 'Could not parse this mind map.' });
      return;
    }

    this.options = parsed.options;
    this.tiers = parsed.tiers;
    this.root = parsed.root;
    this.cfg = this.config();

    if (parsed.isEmpty) {
      this.el.createDiv({
        cls: 'mm-empty',
        text: 'Empty mind map — add an indented markdown list.',
      });
      return;
    }

    this.el.style.setProperty('--mm-font-size', this.cfg.fontSize + 'px');
    this.el.style.setProperty('--mm-node-max-width', this.cfg.maxNodeWidth + 'px');

    this.viewport = this.el.createDiv({ cls: 'mm-viewport' });
    this.canvas = this.viewport.createDiv({ cls: 'mm-canvas' });
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'mm-edges');
    this.canvas.appendChild(this.svg);
    this.nodeLayer = this.canvas.createDiv({ cls: 'mm-nodes' });

    this.assignColors();
    this.createNodeElements();
    this.buildLegend();
    this.attachInteractions();
    this.relayout();

    // Refit when the note column changes width.
    //
    // Two things have to be avoided here. Only width is worth reacting to,
    // because syncHeight() writes the height of this very element and
    // responding to that would feed the observer its own output. And the
    // refit is deferred to an animation frame, because writing a size from
    // inside the observer's own delivery leaves notifications undelivered
    // ("ResizeObserver loop completed") whenever the new height changes the
    // page height enough to toggle a scrollbar, which changes width again.
    this.lastWidth = -1;
    this.refitFrame = 0;
    this.resizeObserver = new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === this.lastWidth) return;
      this.lastWidth = width;
      if (this.refitFrame) return;
      this.refitFrame = requestAnimationFrame(() => {
        this.refitFrame = 0;
        this.fitIfNeeded();
      });
    });
    this.resizeObserver.observe(this.viewport);
  }

  /**
   * A key for the tier shapes, below the map rather than floating over a
   * corner of it: it can then never sit on top of a node, and it stays put
   * while the map is panned. Suppressed with `legend: false`.
   */
  buildLegend() {
    if (!this.tiers.length) return;
    if (/^(false|no|off|0)$/i.test(String(this.options.legend || ''))) return;

    const bar = this.el.createDiv({ cls: 'mm-legend' });
    bar.createSpan({ cls: 'mm-legend-title', text: 'Key' });
    for (const tier of this.tiers) {
      const item = bar.createSpan({ cls: 'mm-legend-item' });
      item.createSpan({ cls: 'mm-marker mm-shape-' + tier.shape });
      item.createSpan({ cls: 'mm-legend-label', text: tier.label });
    }
  }

  assignColors() {
    const paint = (node, color) => {
      node.color = color;
      node.children.forEach((c) => paint(c, color));
    };
    this.root.children.forEach((branch, i) => {
      paint(branch, this.cfg.colorful
        ? PALETTE[i % PALETTE.length]
        : 'var(--interactive-accent)');
    });
    this.root.color = 'var(--interactive-accent)';
  }

  /* ---- node DOM ---- */

  allNodes() {
    const out = [];
    const walk = (n) => { out.push(n); n.children.forEach(walk); };
    walk(this.root);
    return out;
  }

  createNodeElements() {
    const sb = getSandbox();
    sb.style.setProperty('--mm-font-size', this.cfg.fontSize + 'px');
    sb.style.setProperty('--mm-node-max-width', this.cfg.maxNodeWidth + 'px');

    const rootIsHub = this.root.text === null;

    for (const node of this.allNodes()) {
      const el = document.createElement('div');
      el.className = 'mm-node mm-depth-' + Math.min(node.depth, 3);
      if (node === this.root) el.classList.add('mm-root-node');
      if (node === this.root && rootIsHub) el.classList.add('mm-hub');
      el.style.setProperty('--mm-branch-color', node.color);

      if (!(node === this.root && rootIsHub)) {
        // A tiered node shows its marker instead of the depth-based pill or
        // rule, so tier reads as a property of the thing, not of its position.
        if (node.tier) {
          el.classList.add('mm-tiered');
          const marker = document.createElement('span');
          marker.className = 'mm-marker mm-shape-' + this.tiers[node.tier - 1].shape;
          el.appendChild(marker);
        }
        const label = document.createElement('div');
        label.className = 'mm-label';
        renderInline(node.text, label, (target, ev) => this.openLink(target, ev));
        el.appendChild(label);
      }

      el.addEventListener('contextmenu', (ev) => this.showContextMenu(ev, node));

      node.el = el;

      // Measure at natural size in the sandbox, then move into the map.
      sb.appendChild(el);
      const rect = el.getBoundingClientRect();
      node.w = Math.max(1, Math.ceil(rect.width));
      node.h = Math.max(1, Math.ceil(rect.height));
      this.nodeLayer.appendChild(el);
    }
  }

  openLink(target, ev) {
    this.plugin.app.workspace.openLinkText(
      target, this.sourcePath, ev.ctrlKey || ev.metaKey,
    );
  }

  showContextMenu(ev, node) {
    if (!node.text) return;
    ev.preventDefault();
    ev.stopPropagation();

    const menu = new Menu();
    menu.addItem((it) => it
      .setTitle('Copy text')
      .setIcon('copy')
      .onClick(async () => {
        await navigator.clipboard.writeText(node.text);
        new Notice('Copied node text');
      }));
    menu.showAtMouseEvent(ev);
  }

  /* ---- layout ---- */

  relayout() {
    this.layout();
    this.paint();
    this.fitIfNeeded();
  }

  /** Leaf count, so the two wings can be balanced by visual mass. */
  weight(node) {
    if (!node.children.length) return 1;
    return node.children.reduce((sum, c) => sum + this.weight(c), 0);
  }

  layout() {
    const twoSided = this.cfg.direction === 'both' && this.root.children.length > 1;

    let left = [];
    let right = this.root.children.slice();

    if (twoSided) {
      left = [];
      right = [];
      let lw = 0;
      let rw = 0;
      // Greedy balance: each branch joins whichever wing is currently lighter.
      for (const branch of this.root.children) {
        const w = this.weight(branch);
        if (rw <= lw) { right.push(branch); rw += w; } else { left.push(branch); lw += w; }
      }
    }

    const sides = [{ dir: 1, roots: right }];
    if (twoSided) sides.push({ dir: -1, roots: left });

    const wings = [];
    for (const side of sides) {
      if (side.roots.length) wings.push(this.layoutSide(side.roots, side.dir));
    }

    // The root sits at the origin and each wing is centred against it.
    this.root.x = -this.root.w / 2;
    this.root.y = 0;

    for (const wing of wings) {
      const shift = -wing.height / 2;
      for (const node of wing.nodes) node.y += shift;
    }

    this.bbox = this.computeBBox();
  }

  /**
   * Lay out one wing. Columns are packed per depth so every level lines up,
   * and each parent is centred on the vertical span of its children.
   */
  layoutSide(rootsOfSide, dir) {
    const cfg = this.cfg;
    const nodes = [];
    const collect = (n) => {
      nodes.push(n);
      n.children.forEach(collect);
    };
    rootsOfSide.forEach(collect);

    const widthByDepth = new Map();
    for (const n of nodes) {
      widthByDepth.set(n.depth, Math.max(widthByDepth.get(n.depth) || 0, n.w));
    }

    const offsetByDepth = new Map();
    let cursor = this.root.w / 2 + cfg.hGap;
    const depths = Array.from(widthByDepth.keys()).sort((a, b) => a - b);
    for (const d of depths) {
      offsetByDepth.set(d, cursor);
      cursor += widthByDepth.get(d) + cfg.hGap;
    }

    for (const n of nodes) {
      const off = offsetByDepth.get(n.depth);
      n.x = dir > 0 ? off : -off - n.w;
      n.side = dir;
    }

    // Vertical packing; returns the bottom edge the subtree consumed.
    const place = (node, top) => {
      if (!node.children.length) {
        node.y = top + node.h / 2;
        return top + node.h + cfg.vGap;
      }
      let y = top;
      for (const child of node.children) y = place(child, y);
      const span = y - cfg.vGap - top;
      node.y = top + span / 2;
      // Keep the parent's own box inside the band it occupies.
      return Math.max(y, top + node.h + cfg.vGap);
    };

    let bottom = 0;
    for (const r of rootsOfSide) bottom = place(r, bottom);

    return { nodes, height: Math.max(0, bottom - cfg.vGap) };
  }

  computeBBox() {
    const pad = 16;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of this.allNodes()) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x + n.w);
      minY = Math.min(minY, n.y - n.h / 2);
      maxY = Math.max(maxY, n.y + n.h / 2);
    }

    return {
      minX: minX - pad,
      minY: minY - pad,
      width: (maxX - minX) + pad * 2,
      height: (maxY - minY) + pad * 2,
    };
  }

  /* ---- painting ---- */

  paint() {
    const b = this.bbox;
    const ox = -b.minX;
    const oy = -b.minY;

    this.canvas.style.width = b.width + 'px';
    this.canvas.style.height = b.height + 'px';

    for (const n of this.allNodes()) {
      n.el.style.transform =
        'translate(' + (n.x + ox) + 'px,' + (n.y + oy - n.h / 2) + 'px)';
      // Put the tier marker on the edge the branch arrives at, so the line
      // meets the shape rather than the far end of the label.
      n.el.classList.toggle('mm-side-left', n.side === -1);
    }

    this.svg.setAttribute('width', String(b.width));
    this.svg.setAttribute('height', String(b.height));
    this.svg.setAttribute('viewBox', '0 0 ' + b.width + ' ' + b.height);
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const draw = (parent) => {
      for (const child of parent.children) {
        this.svg.appendChild(this.edgePath(parent, child, ox, oy));
        draw(child);
      }
    };
    draw(this.root);
  }

  /**
   * Pills are met at their middle; deeper nodes are drawn as text sitting on
   * a coloured rule, so the branch joins that rule instead and the stroke
   * reads as one continuous line.
   */
  anchorY(node) {
    return node.depth >= 2 ? node.y + node.h / 2 - 1 : node.y;
  }

  edgePath(parent, child, ox, oy) {
    const dir = child.side || 1;
    const x1 = (dir > 0 ? parent.x + parent.w : parent.x) + ox;
    const x2 = (dir > 0 ? child.x : child.x + child.w) + ox;
    const y1 = this.anchorY(parent) + oy;
    const y2 = this.anchorY(child) + oy;
    const mid = (x1 + x2) / 2;

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d',
      'M' + x1 + ',' + y1 +
      ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2);
    path.setAttribute('class', 'mm-edge');
    path.setAttribute('stroke', child.color);
    // Strokes thin out with depth, the way a hand-drawn map tapers.
    path.setAttribute('stroke-width', String(Math.max(1.2, 3.2 - child.depth * 0.6)));
    return path;
  }

  /* ---- viewport ---- */

  fitIfNeeded() {
    if (this.userAdjusted) {
      this.applyTransform();
      this.syncHeight();
      return;
    }
    this.fit();
  }

  fit() {
    const b = this.bbox;
    if (!b || !b.width) return;
    const avail = this.viewport.clientWidth || this.el.clientWidth || 700;

    let scale = Math.min(1, avail / b.width);
    if (b.height * scale > this.cfg.maxHeight) {
      scale = Math.min(scale, this.cfg.maxHeight / b.height);
    }
    // A big map shrunk to fit becomes an unreadable thumbnail. Stop at a
    // legible floor and let the overflow be panned instead.
    this.scale = Math.max(scale, MIN_FIT_SCALE);

    const boxH = this.syncHeight();
    const contentW = b.width * this.scale;
    const contentH = b.height * this.scale;

    // Whatever does not fit opens centred on the root, which is where
    // reading a mind map starts — not pinned to the top-left corner.
    const clamp = (v, box, content) => Math.min(0, Math.max(box - content, v));
    this.tx = contentW <= avail
      ? (avail - contentW) / 2
      : clamp(avail / 2 - (this.root.x + this.root.w / 2 - b.minX) * this.scale,
              avail, contentW);
    this.ty = contentH <= boxH
      ? (boxH - contentH) / 2
      : clamp(boxH / 2 - (this.root.y - b.minY) * this.scale, boxH, contentH);

    this.applyTransform();
  }

  /** Size the block to its content, capped, and report the height used. */
  syncHeight() {
    const wanted = Math.max(
      60, Math.min(this.cfg.maxHeight, Math.ceil(this.bbox.height * this.scale)),
    );
    this.viewport.style.height = wanted + 'px';
    return wanted;
  }

  applyTransform() {
    this.canvas.style.transform =
      'translate(' + this.tx + 'px,' + this.ty + 'px) scale(' + this.scale + ')';
  }

  zoomBy(factor, originX, originY) {
    const rect = this.viewport.getBoundingClientRect();
    const ax = originX === undefined ? rect.width / 2 : originX;
    const ay = originY === undefined ? rect.height / 2 : originY;

    const next = Math.min(3, Math.max(0.15, this.scale * factor));
    const ratio = next / this.scale;
    this.tx = ax - (ax - this.tx) * ratio;
    this.ty = ay - (ay - this.ty) * ratio;
    this.scale = next;
    this.userAdjusted = true;
    this.applyTransform();
  }

  attachInteractions() {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originTx = 0;
    let originTy = 0;

    this.viewport.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      if (ev.target.closest('a')) return;
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      originTx = this.tx;
      originTy = this.ty;
      this.viewport.setPointerCapture(ev.pointerId);
      this.viewport.addClass('is-panning');
    });

    this.viewport.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      // Ignore jitter so a click on a node is not read as a pan.
      if (!this.userAdjusted && Math.abs(dx) + Math.abs(dy) < 3) return;
      this.userAdjusted = true;
      this.tx = originTx + dx;
      this.ty = originTy + dy;
      this.applyTransform();
    });

    const endDrag = (ev) => {
      if (!dragging) return;
      dragging = false;
      if (this.viewport.hasPointerCapture(ev.pointerId)) {
        this.viewport.releasePointerCapture(ev.pointerId);
      }
      this.viewport.removeClass('is-panning');
    };
    this.viewport.addEventListener('pointerup', endDrag);
    this.viewport.addEventListener('pointercancel', endDrag);

    this.viewport.addEventListener('wheel', (ev) => {
      // Plain scrolling belongs to the note; zoom only on an explicit modifier.
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      const rect = this.viewport.getBoundingClientRect();
      this.zoomBy(
        ev.deltaY < 0 ? 1.1 : 1 / 1.1,
        ev.clientX - rect.left,
        ev.clientY - rect.top,
      );
    }, { passive: false });

    this.viewport.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('a')) return;
      this.userAdjusted = false;
      this.fit();
    });
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.refitFrame) {
      cancelAnimationFrame(this.refitFrame);
      this.refitFrame = 0;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Render child — ties a renderer to the lifetime of its block
 * ------------------------------------------------------------------ */

class MindMapChild extends MarkdownRenderChild {
  constructor(containerEl, plugin, source, sourcePath) {
    super(containerEl);
    this.plugin = plugin;
    this.source = source;
    this.sourcePath = sourcePath;
  }

  onload() {
    this.renderer = new MindMapRenderer(
      this.plugin, this.source, this.containerEl, this.sourcePath,
    );
    this.plugin.children.add(this);
  }

  onunload() {
    if (this.renderer) this.renderer.destroy();
    this.plugin.children.delete(this);
  }

  rebuild() {
    if (this.renderer) this.renderer.build();
  }
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

class MindMapPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.children = new Set();

    this.registerMarkdownCodeBlockProcessor('mindmap', (source, el, ctx) => {
      ctx.addChild(new MindMapChild(el, this, source, ctx.sourcePath));
    });

    this.addSettingTab(new MindMapSettingTab(this.app, this));

    this.addCommand({
      id: 'insert-mindmap',
      name: 'Insert mind map block',
      editorCallback: (editor) => {
        editor.replaceSelection(
          '```mindmap\n- Central idea\n  - First branch\n    - Detail\n'
          + '  - Second branch\n    - Detail\n```\n',
        );
      },
    });
  }

  onunload() {
    releaseSandbox();
  }

  async saveSettings() {
    await this.saveData(this.settings);
    for (const child of this.children) {
      try {
        child.rebuild();
      } catch (err) {
        console.error('[mindmap-blocks] rebuild failed', err);
      }
    }
  }
}

class MindMapSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    const commit = () => this.plugin.saveSettings();

    new Setting(containerEl)
      .setName('Layout direction')
      .setDesc('Balanced spreads branches either side of the centre; rightward keeps one column.')
      .addDropdown((d) => d
        .addOption('both', 'Balanced (both sides)')
        .addOption('right', 'Rightward')
        .setValue(this.plugin.settings.direction)
        .onChange(async (v) => { this.plugin.settings.direction = v; await commit(); }));

    new Setting(containerEl)
      .setName('Colourful branches')
      .setDesc('Give each top-level branch its own hue. When off, everything uses the theme accent.')
      .addToggle((t) => t
        .setValue(this.plugin.settings.colorfulBranches)
        .onChange(async (v) => { this.plugin.settings.colorfulBranches = v; await commit(); }));

    new Setting(containerEl)
      .setName('Maximum height')
      .setDesc('Tallest a mind map may grow before it scales down to fit (px).')
      .addSlider((s) => s
        .setLimits(200, 1200, 20)
        .setValue(this.plugin.settings.maxHeight)
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.maxHeight = v; await commit(); }));

    new Setting(containerEl)
      .setName('Font size')
      .setDesc('Base text size for map nodes (px).')
      .addSlider((s) => s
        .setLimits(10, 24, 1)
        .setValue(this.plugin.settings.fontSize)
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.fontSize = v; await commit(); }));

    new Setting(containerEl)
      .setName('Horizontal spacing')
      .setDesc('Gap between depth columns (px).')
      .addSlider((s) => s
        .setLimits(16, 120, 2)
        .setValue(this.plugin.settings.hGap)
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.hGap = v; await commit(); }));

    new Setting(containerEl)
      .setName('Vertical spacing')
      .setDesc('Gap between sibling nodes (px).')
      .addSlider((s) => s
        .setLimits(2, 48, 1)
        .setValue(this.plugin.settings.vGap)
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.vGap = v; await commit(); }));

    new Setting(containerEl)
      .setName('Node width limit')
      .setDesc('Width at which node text starts wrapping (px).')
      .addSlider((s) => s
        .setLimits(120, 480, 10)
        .setValue(this.plugin.settings.maxNodeWidth)
        .setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.maxNodeWidth = v; await commit(); }));
  }
}

module.exports = MindMapPlugin;
