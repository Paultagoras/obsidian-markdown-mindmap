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
  minFontSize: 15,        // px, auto-fit never shrinks text below this
  colorfulBranches: true, // give each top-level branch its own hue
  edgeStyle: 'solid',     // 'solid' | 'dashed'
};

// Hues chosen to stay legible on both light and dark Obsidian themes.
const PALETTE = [
  '#4a8fe7', '#e2795b', '#54b98a', '#b579d8',
  '#e0a33c', '#4bb3c4', '#dd6a94', '#8a9a4f',
];

const SVG_NS = 'http://www.w3.org/2000/svg';

// Hard floor on the auto-fit scale, whatever the font settings say.
const MIN_FIT_SCALE = 0.2;

// Marker shapes a map may assign to its tiers.
const TIER_SHAPES = ['bar', 'circle', 'diamond', 'square', 'pill'];

// Compass bearings, as unit vectors in screen space (y grows downward).
const D = Math.SQRT1_2;
const COMPASS = {
  N: { x: 0, y: -1 }, NE: { x: D, y: -D }, E: { x: 1, y: 0 }, SE: { x: D, y: D },
  S: { x: 0, y: 1 }, SW: { x: -D, y: D }, W: { x: -1, y: 0 }, NW: { x: -D, y: -D },
};

/**
 * One vocabulary for the yes/no options, so `legend: off` and
 * `edgeLabels: off` mean the same thing wherever they are read. Anything
 * outside the vocabulary is neither, which leaves the setting on its default.
 */
const isTrue = (v) => /^(true|yes|on|1)$/i.test(String(v || '').trim());
const isFalse = (v) => /^(false|no|off|0)$/i.test(String(v || '').trim());

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
  const linkSpecs = [];
  let i = 0;

  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i] !== undefined && lines[i].trim() === '---') {
    i++;
    while (i < lines.length && lines[i].trim() !== '---') {
      const m = lines[i].match(/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (m) {
        // `link:` may repeat; everything else is a single value.
        if (m[1].toLowerCase() === 'link') linkSpecs.push(m[2].trim());
        else options[m[1]] = m[2].trim();
      }
      i++;
    }
    i++; // consume the closing ---
  }

  // Tier notation is live only in a map that declares its tiers, so adding
  // it can never change how an existing map parses. A node reading
  // "Match two digits \d{2}" keeps its braces unless this map opted in.
  const tiers = parseTiers(options.tiers);
  // Bearings are live only in a compass map, on the same principle as tiers:
  // elsewhere "@N" is the literal text it looks like.
  const compass = String(options.direction || '').toLowerCase() === 'compass';
  // Naming the road between two places, gated like the rest so "::" stays
  // literal in a map that has not asked for it.
  const edgeLabels = isTrue(options.edgeLabels);

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

    // Written last on the line, so it comes off first.
    let edgeLabel = null;
    if (edgeLabels) {
      const em = text.match(/\s*::\s*(\S.*?)\s*$/);
      if (em) {
        edgeLabel = em[1];
        text = text.slice(0, em.index);
      }
    }

    // Bearing comes off first: it is written after the tier marker. An
    // optional number multiplies the gap to the parent, which is how you
    // push one place further out to stop two branches meeting.
    let bearing = null;
    let gapScale = 1;
    if (compass) {
      const dm = text.match(/\s*@([A-Za-z]{1,2})\s*\*?\s*(\d+(?:\.\d+)?)?$/);
      if (dm && COMPASS[dm[1].toUpperCase()]) {
        bearing = dm[1].toUpperCase();
        const mul = dm[2] === undefined ? 1 : parseFloat(dm[2]);
        if (Number.isFinite(mul) && mul > 0) gapScale = mul;
        text = text.slice(0, dm.index);
      }
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
      bearing,
      gapScale,
      edgeLabel,
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
      id: -1, text: null, tier: 0, bearing: null, edgeLabel: null, depth: 0,
      parent: null, children: roots,
    };
    const redepth = (n, d) => {
      n.depth = d;
      n.children.forEach((c) => redepth(c, d + 1));
    };
    roots.forEach((r) => { r.parent = root; redepth(r, 1); });
  }

  const { links, unresolved } = resolveLinks(linkSpecs, root);

  return { options, tiers, links, unresolved, root, isEmpty: roots.length === 0 };
}

/**
 * Resolve `link: A -> B` specs against node names.
 *
 * Cross-links are the one thing a bullet list cannot say: nesting gives
 * every node exactly one parent, so a route that loops back has nowhere to
 * go. These are drawn on top of the tree rather than changing it — the tree
 * still decides where everything sits.
 *
 * Unresolved names are reported rather than dropped, so a typo does not
 * quietly turn into a missing road.
 */
function resolveLinks(specs, root) {
  const links = [];
  const unresolved = [];
  if (!specs.length) return { links, unresolved };

  const byName = new Map();
  const walk = (n) => {
    if (n.text) {
      const key = n.text.trim().toLowerCase();
      if (!byName.has(key)) byName.set(key, n);
    }
    n.children.forEach(walk);
  };
  walk(root);

  for (const spec of specs) {
    const parts = spec.split('->');
    if (parts.length !== 2) { unresolved.push(spec); continue; }
    const a = byName.get(parts[0].trim().toLowerCase());
    const b = byName.get(parts[1].trim().toLowerCase());
    if (a && b && a !== b) links.push({ a, b });
    else unresolved.push(spec);
  }
  return { links, unresolved };
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
    const bool = (v, fallback) => (v === undefined ? fallback : isTrue(v));
    // Several options answer to two spellings, the hyphenated one for
    // anyone who writes the rest of their front matter that way.
    const alias = (a, b) => (a !== undefined ? a : b);

    const dir = String(o.direction || '').toLowerCase();
    const named = dir === 'right' || dir === 'both' || dir === 'compass';
    return {
      direction: named ? dir : s.direction,
      maxHeight: num(o.height, s.maxHeight),
      fontSize: num(alias(o.fontSize, o['font-size']), s.fontSize),
      hGap: num(o.hGap, s.hGap),
      vGap: num(o.vGap, s.vGap),
      maxNodeWidth: num(o.nodeWidth, s.maxNodeWidth),
      minFontSize: num(alias(o.minFont, o['min-font']), s.minFontSize),
      colorful: bool(alias(o.color, o.colorful), s.colorfulBranches),
      edgeStyle: /^(dashed|solid)$/i.test(o.edges || '')
        ? o.edges.toLowerCase() : s.edgeStyle,
      // Compass maps space themselves out unless asked not to. `manual`
      // is for someone who wants the gaps exactly as they wrote them.
      autoSpace: !(isFalse(o.spacing) || /^manual$/i.test(String(o.spacing || '').trim())),
    };
  }

  /* ---- construction ---- */

  build() {
    // A rebuild replaces everything the last one wired up.
    this.destroy();

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
    this.links = parsed.links;
    this.unresolvedLinks = parsed.unresolved;
    this.root = parsed.root;
    this.nodes = null;
    this.cfg = this.config();

    if (parsed.isEmpty) {
      this.el.createDiv({
        cls: 'mm-empty',
        text: 'Empty mind map — add an indented markdown list.',
      });
      return;
    }

    this.el.classList.toggle('mm-dashed', this.cfg.edgeStyle === 'dashed');
    this.el.style.setProperty('--mm-font-size', this.cfg.fontSize + 'px');
    this.el.style.setProperty('--mm-node-max-width', this.cfg.maxNodeWidth + 'px');

    this.viewport = this.el.createDiv({ cls: 'mm-viewport' });
    this.canvas = this.viewport.createDiv({ cls: 'mm-canvas' });
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.setAttribute('class', 'mm-edges');
    this.canvas.appendChild(this.svg);
    this.nodeLayer = this.canvas.createDiv({ cls: 'mm-nodes' });
    this.labelLayer = this.canvas.createDiv({ cls: 'mm-edge-labels' });
    // Sits above the canvas so the fades can actually cover clipped nodes;
    // an inset shadow on the viewport itself would paint under them.
    this.viewport.createDiv({ cls: 'mm-fade' });

    this.resolveBearings();
    this.assignColors();
    this.createNodeElements();
    this.buildLegend();

    // A mistyped name would otherwise just be a road that never appears.
    if (this.unresolvedLinks.length) {
      this.el.createDiv({
        cls: 'mm-warning',
        text: 'Unresolved link' + (this.unresolvedLinks.length > 1 ? 's' : '')
          + ': ' + this.unresolvedLinks.join('; '),
      });
    }
    this.attachInteractions();
    this.relayout();

    // Spacing works by sending a subtree further along a bearing it already
    // has. Where no bearing out of a fork leads apart, nothing can be done
    // without tilting a road, so say so rather than overlap in silence.
    if (this.crowded) {
      this.el.createDiv({
        cls: 'mm-warning',
        text: 'Some places still overlap: no bearing out of the fork they'
          + ' share leads them apart. Change one of the bearings, or add a'
          + ' gap multiplier such as @E3.',
      });
    }

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
    if (isFalse(this.options.legend)) return;

    const bar = this.el.createDiv({ cls: 'mm-legend' });
    bar.createSpan({ cls: 'mm-legend-title', text: 'Key' });
    for (const tier of this.tiers) {
      const item = bar.createSpan({ cls: 'mm-legend-item' });
      item.createSpan({ cls: 'mm-marker mm-shape-' + tier.shape });
      item.createSpan({ cls: 'mm-legend-label', text: tier.label });
    }
  }

  /**
   * Work out the bearing each node was actually placed on, following the
   * same inheritance the layout uses. Needed before the elements exist,
   * because it decides where a node's name sits relative to its marker.
   */
  resolveBearings() {
    const walk = (node, inherited) => {
      for (const child of node.children) {
        child.dirName = child.bearing || inherited || 'E';
        walk(child, child.dirName);
      }
    };
    walk(this.root, null);
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

  /**
   * Every node, in reading order. The tree is fixed once parsed — layout
   * moves nodes but never adds or removes one — so this is walked once and
   * handed out, rather than rebuilt on each of the four callers.
   */
  allNodes() {
    if (!this.nodes) {
      const out = [];
      const walk = (n) => { out.push(n); n.children.forEach(walk); };
      walk(this.root);
      this.nodes = out;
    }
    return this.nodes;
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
          // The name always sits under the marker, so a node is a symbol
          // over a caption and a road meets the symbol, stepping around
          // the caption only where it would otherwise cross it.
          const marker = document.createElement('span');
          marker.className = 'mm-marker mm-shape-' + this.tiers[node.tier - 1].shape;
          el.appendChild(marker);
          node.markerEl = marker;
        }
        const label = document.createElement('div');
        label.className = 'mm-label';
        renderInline(node.text, label, (target, ev) => this.openLink(target, ev));
        el.appendChild(label);
        node.labelEl = label;
      }

      el.addEventListener('contextmenu', (ev) => this.showContextMenu(ev, node));

      node.el = el;

      // Measure at natural size in the sandbox, then move into the map.
      sb.appendChild(el);
      const rect = el.getBoundingClientRect();
      node.w = Math.max(1, Math.ceil(rect.width));
      node.h = Math.max(1, Math.ceil(rect.height));

      // The marker is the place; the name underneath it is only its caption.
      // Roads run along the line of the markers, which is not the middle of
      // the box, and they leave the marker rather than the box — so the two
      // parts are measured separately, each as a rect offset from the box
      // centre. A rotated diamond reports its rotated size here, which is
      // the size that matters for keeping a road off it.
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const part = (child) => {
        if (!child) return null;
        const r = child.getBoundingClientRect();
        return {
          dx: (r.left + r.width / 2) - cx,
          dy: (r.top + r.height / 2) - cy,
          w: r.width,
          h: r.height,
        };
      };
      node.markerBox = part(node.markerEl);
      node.labelBox = node.markerEl ? part(node.labelEl) : null;
      node.markerDy = node.markerBox ? node.markerBox.dy : 0;

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

  /** The top-level branch a node belongs to, or null for the root itself. */
  branchOf(node) {
    let n = node;
    while (n && n.parent && n.parent !== this.root) n = n.parent;
    return n && n.parent === this.root ? n : null;
  }

  /**
   * Top-level branches grouped so that cross-linked ones travel together,
   * heaviest group first so the greedy balance has the best chance of
   * evening out. Without links this is just one branch per group.
   */
  linkGroups() {
    const branches = this.root.children;
    const owner = new Map(branches.map((b, i) => [b, i]));
    const find = (b) => {
      let i = owner.get(b);
      while (branches[i] !== undefined && owner.get(branches[i]) !== i) i = owner.get(branches[i]);
      return i;
    };

    for (const { a, b } of this.links) {
      const ba = this.branchOf(a);
      const bb = this.branchOf(b);
      if (!ba || !bb || ba === bb) continue;
      const ra = find(ba);
      const rb = find(bb);
      if (ra !== rb) owner.set(branches[rb], ra);
    }

    const groups = new Map();
    for (const b of branches) {
      const key = find(b);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    return [...groups.values()].sort(
      (x, y) => y.reduce((s, b) => s + this.weight(b), 0)
              - x.reduce((s, b) => s + this.weight(b), 0),
    );
  }

  /**
   * Place every node on a bearing from its parent, so a map reads
   * geographically instead of as columns by depth.
   *
   * A child with no bearing continues in the direction its parent was
   * placed, which is what a road does — you only write a bearing where the
   * route turns. Children sharing a bearing are fanned apart across it.
   * Beyond that, two distant subtrees can still grow into the same space;
   * that is the author's to resolve by choosing different bearings, which is
   * the trade for placing things by hand.
   */
  layoutCompass() {
    const cfg = this.cfg;

    // A bearing is between two places, and a place is its marker, so a
    // bearing offsets one marker from another and the box hangs off that.
    // Measuring centre to centre instead would tilt every road by however
    // much two boxes differ in height.
    this.root.x = -this.root.w / 2;
    this.root.y = 0;
    this.root.side = 1;

    const place = (node) => {
      const groups = new Map();
      for (const child of node.children) {
        if (!groups.has(child.dirName)) groups.set(child.dirName, []);
        groups.get(child.dirName).push(child);
      }

      const from = this.markerPoint(node);

      for (const [name, kids] of groups) {
        const u = COMPASS[name];
        const px = -u.y;   // across the bearing, for fanning siblings
        const py = u.x;
        const extent = (n, vx, vy) => Math.abs(vx) * n.w + Math.abs(vy) * n.h;

        const sizes = kids.map((k) => extent(k, px, py));
        const span = sizes.reduce((a, b) => a + b, 0) + (kids.length - 1) * cfg.vGap;
        let cursor = -span / 2;

        for (let i = 0; i < kids.length; i++) {
          const child = kids[i];
          const across = cursor + sizes[i] / 2;
          cursor += sizes[i] + cfg.vGap;

          const along = cfg.hGap * (child.gapScale || 1)
            + (child.autoGap || 0)
            + extent(node, u.x, u.y) / 2
            + extent(child, u.x, u.y) / 2;

          // Solve for the box centre that puts this child's marker there.
          child.x = from.x + u.x * along + px * across - child.w / 2;
          child.y = from.y + u.y * along + py * across - (child.markerDy || 0);
          child.side = u.x < -0.01 ? -1 : 1;
          place(child);
        }
      }
    };

    const nodes = this.allNodes();
    for (const n of nodes) n.autoGap = 0;
    place(this.root);

    this.crowded = cfg.autoSpace
      ? !this.spaceOut(nodes, () => place(this.root))
      : false;
  }

  /**
   * Push apart subtrees that have grown into each other.
   *
   * A bearing is a promise about direction, so nothing may be nudged
   * sideways to make room — that would tilt a road off the compass, which
   * is the one thing this layout exists to get right. The move that keeps
   * every bearing exact is to send a whole subtree further along a bearing
   * it already has, which is what writing `@E3` does by hand.
   *
   * So: take the worst overlap, walk up to the fork where the two boxes'
   * branches part company, and lengthen whichever of the two roads leaving
   * that fork does most to separate them. Everything below that road moves
   * with it and keeps its shape. Repeat until the map is clear.
   */
  spaceOut(nodes, place) {
    const MARGIN = 10;                      // clear air between two boxes
    const ROAD = 5;                         // and between a road and a name
    const PASSES = 120;
    const CEILING = this.cfg.hGap * 60;     // never push a road off the map

    // Boxes first: two names on top of each other is worse than a road
    // clipping one, and settling the boxes often moves the roads clear too.
    const next = () => this.worstOverlap(nodes, MARGIN)
      || this.worstRoadOverlap(nodes, ROAD);

    for (let pass = 0; pass < PASSES; pass++) {
      const clash = next();
      if (!clash) return true;
      if (!this.pushApart(clash, CEILING)) return false;
      place();
    }
    return !next();
  }

  /**
   * Where a road passes through a box that is not one of its own ends.
   *
   * Spacing the boxes apart does not by itself keep the roads clear: two
   * subtrees can stand well clear of each other and still have a road from
   * one run straight over a name in the other.
   */
  worstRoadOverlap(nodes, margin) {
    let worst = null;
    for (const child of nodes) {
      const from = child.parent;
      if (!from) continue;

      const pm = this.markerPoint(from);
      const cm = this.markerPoint(child);
      const A = this.boxAnchor(from, cm.x, cm.y);
      const B = this.boxAnchor(child, pm.x, pm.y);
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const nx = -uy;         // unit normal: the way off the road
      const ny = ux;

      for (const n of nodes) {
        if (n === child || n === from) continue;
        const cx = n.x + n.w / 2;
        const cy = n.y;

        // Alongside this stretch of road at all, or past one of its ends?
        const along = (cx - A.x) * ux + (cy - A.y) * uy;
        const reach = Math.abs(ux) * n.w / 2 + Math.abs(uy) * n.h / 2;
        if (along < -reach - margin || along > len + reach + margin) continue;

        const dist = (cx - A.x) * nx + (cy - A.y) * ny;
        const half = Math.abs(nx) * n.w / 2 + Math.abs(ny) * n.h / 2;
        const need = half + margin - Math.abs(dist);
        if (need <= 0) continue;
        if (worst && need <= worst.amount) continue;

        // Off the near side of the road, or the whole way across it.
        const s = dist >= 0 ? 1 : -1;
        worst = {
          a: n,
          b: child,
          amount: need,
          ways: [
            { sep: { x: nx * s, y: ny * s }, amount: need },
            { sep: { x: -nx * s, y: -ny * s }, amount: half + margin + Math.abs(dist) },
          ],
        };
      }
    }
    return worst;
  }

  /** The worst-overlapping pair, with how far each axis is penetrated. */
  worstOverlap(nodes, margin) {
    let worst = null;
    // Every pair is tested on every pass, so the boxes are worked out once
    // here rather than twice for each of the n-squared pairs.
    const rects = nodes.map((n) => this.nodeRect(n));
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      const ra = rects[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const rb = rects[j];
        const ox = Math.min(ra.r, rb.r) - Math.max(ra.l, rb.l) + margin;
        if (ox <= 0) continue;
        const oy = Math.min(ra.b, rb.b) - Math.max(ra.t, rb.t) + margin;
        if (oy <= 0) continue;

        const amount = Math.min(ox, oy);
        if (worst && amount <= worst.amount) continue;
        worst = {
          a,
          b,
          amount,
          ways: [
            { sep: { x: a.x + a.w / 2 <= b.x + b.w / 2 ? -1 : 1, y: 0 }, amount: ox },
            { sep: { x: 0, y: a.y <= b.y ? -1 : 1 }, amount: oy },
          ],
        };
      }
    }
    return worst;
  }

  /**
   * Lengthen one road out of the fork these two boxes share.
   *
   * There is more than one way out — either axis for two boxes, either side
   * for a road — and more than one road that can carry the push, so every
   * combination is costed and the cheapest real one wins. Taking the
   * shortest way out first would be wrong: two subtrees can be a hair apart
   * vertically and still only be separable east, because no bearing at
   * their fork runs north.
   */
  pushApart(clash, ceiling) {
    const chain = (n) => {
      const out = [];
      for (let x = n; x; x = x.parent) out.push(x);
      return out.reverse();
    };
    const ca = chain(clash.a);
    const cb = chain(clash.b);

    let k = 0;
    while (k < ca.length && k < cb.length && ca[k] === cb[k]) k++;

    // Pushing a road moves its whole subtree; what separates the pair is
    // the bearing's component along the axis they are coming apart on.
    const dot = (u, s) => u.x * s.x + u.y * s.y;

    // Every road below the fork on either chain is a candidate: each moves
    // one of the pair and not the other. The first road out of the fork
    // carries the whole subtree, a deeper one carries less of it — which
    // matters when a place has looped back onto its own ancestor, where the
    // roads between the two are the only levers there are.
    const roads = [];
    for (let i = k; i < ca.length; i++) roads.push({ node: ca[i], sign: 1, rank: i });
    for (let i = k; i < cb.length; i++) roads.push({ node: cb[i], sign: -1, rank: i });

    let best = null;
    for (const way of clash.ways) {
      for (const road of roads) {
        const gain = road.sign * dot(COMPASS[road.node.dirName], way.sep);
        // A road running square across the way out cannot help, however far
        // it goes. If none of them can, the bearings themselves are what
        // contradict each other.
        if (gain < 0.2) continue;
        const add = way.amount / gain;
        // Cheapest push wins, so the map moves as little as it can; on a
        // tie take the deeper road, which disturbs fewer places.
        if (!best || add < best.add - 0.01
          || (add < best.add + 0.01 && road.rank > best.rank)) {
          best = { node: road.node, add, rank: road.rank };
        }
      }
    }
    if (!best) return false;

    const total = (best.node.autoGap || 0) + best.add;
    if (total > ceiling) return false;
    best.node.autoGap = total;
    return true;
  }

  layout() {
    this.crowded = false;
    if (this.cfg.direction === 'compass') {
      this.layoutCompass();
      this.bbox = this.computeBBox();
      return;
    }

    const twoSided = this.cfg.direction === 'both' && this.root.children.length > 1;

    let left = [];
    let right = this.root.children.slice();

    if (twoSided) {
      left = [];
      right = [];
      let lw = 0;
      let rw = 0;
      // Greedy balance, but over groups rather than single branches: two
      // branches joined by a cross-link are placed on the same wing so the
      // link stays a short hop instead of spanning the whole map.
      for (const group of this.linkGroups()) {
        const w = group.reduce((sum, b) => sum + this.weight(b), 0);
        if (rw <= lw) { right.push(...group); rw += w; } else { left.push(...group); lw += w; }
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
    // Cross-links bow outward past their endpoints, so leave them room.
    const pad = this.links.length ? 16 + 60 : 16;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of this.allNodes()) {
      const r = this.nodeRect(n);
      minX = Math.min(minX, r.l);
      maxX = Math.max(maxX, r.r);
      minY = Math.min(minY, r.t);
      maxY = Math.max(maxY, r.b);
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
      const r = this.nodeRect(n, ox, oy);
      n.el.style.transform = 'translate(' + r.l + 'px,' + r.t + 'px)';
    }

    this.svg.setAttribute('width', String(b.width));
    this.svg.setAttribute('height', String(b.height));
    this.svg.setAttribute('viewBox', '0 0 ' + b.width + ' ' + b.height);
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    // Edge labels ride on their road, so they are rebuilt with the edges.
    this.labelLayer.empty();

    const draw = (parent) => {
      for (const child of parent.children) {
        const path = this.edgePath(parent, child, ox, oy);
        this.svg.appendChild(path);
        if (child.edgeLabel) this.placeEdgeLabel(path, child);
        draw(child);
      }
    };
    draw(this.root);

    // Cross-links go on last so they sit above the tree they bridge.
    for (const link of this.links) {
      this.svg.appendChild(this.crossLinkPath(link.a, link.b, ox, oy));
    }
  }

  /**
   * A tiered node is met on the line of its marker, because the marker is
   * the place and the name under it is only a caption. Otherwise: pills are
   * met at their middle, and deeper nodes are drawn as text sitting on a
   * coloured rule, so the branch joins that rule and the stroke reads as
   * one continuous line.
   */
  anchorY(node) {
    if (node.markerEl) return node.y + (node.markerDy || 0);
    return node.depth >= 2 ? node.y + node.h / 2 - 1 : node.y;
  }

  /**
   * Name a road at its midpoint, taken from the path itself so it lands on
   * the curve as readily as on a straight line. The label is opaque, like a
   * marker, so the road passes behind the words rather than through them.
   *
   * Edge labels do not take part in layout — nothing moves to make room for
   * one — so a long name on a short road will overhang it.
   */
  placeEdgeLabel(path, child) {
    let mid;
    try {
      mid = path.getPointAtLength(path.getTotalLength() / 2);
    } catch (e) {
      return; // no geometry yet; nothing sensible to place against
    }
    const el = this.labelLayer.createDiv({ cls: 'mm-edge-label' });
    el.style.left = mid.x + 'px';
    el.style.top = mid.y + 'px';
    el.style.setProperty('--mm-branch-color', child.color);
    renderInline(child.edgeLabel, el, (target, ev) => this.openLink(target, ev));
  }

  /**
   * An edge as an SVG path. Strokes thin out with depth, the way a
   * hand-drawn map tapers; a cross-link keeps one weight throughout,
   * because it belongs to no one depth.
   */
  svgPath(d, cls, node, depth) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', cls);
    path.setAttribute('stroke', node.color || 'var(--interactive-accent)');
    if (depth !== undefined) {
      path.setAttribute('stroke-width', String(Math.max(1.2, 3.2 - depth * 0.6)));
    }
    return path;
  }

  /** The node's marker, in canvas coordinates: where the place actually is. */
  markerPoint(node, ox = 0, oy = 0) {
    return {
      x: node.x + node.w / 2 + ox,
      y: node.y + (node.markerDy || 0) + oy,
    };
  }

  /**
   * A node's whole box in canvas coordinates. Worth saying in one place: a
   * node records x as its left edge but y as the line of its marker, not
   * the top of its box, so the two axes do not read alike.
   */
  nodeRect(node, ox = 0, oy = 0) {
    return {
      l: node.x + ox, r: node.x + node.w + ox,
      t: node.y - node.h / 2 + oy, b: node.y + node.h / 2 + oy,
    };
  }

  /** A measured part of a node, as a rect in canvas coordinates. */
  partRect(node, part, ox = 0, oy = 0) {
    if (!part) return null;
    const cx = node.x + node.w / 2 + ox + part.dx;
    const cy = node.y + oy + part.dy;
    return {
      l: cx - part.w / 2, r: cx + part.w / 2,
      t: cy - part.h / 2, b: cy + part.h / 2,
    };
  }

  /**
   * How far along a ray from p it finally leaves rect, or 0 if it never
   * enters it. Used to push a road clear of something in its way.
   */
  rayExit(rect, p, dx, dy) {
    if (!rect) return 0;
    let enter = -Infinity;
    let leave = Infinity;
    const slab = (lo, hi, o, d) => {
      if (!d) return o > lo && o < hi;   // parallel: either inside or missing
      const t1 = (lo - o) / d;
      const t2 = (hi - o) / d;
      enter = Math.max(enter, Math.min(t1, t2));
      leave = Math.min(leave, Math.max(t1, t2));
      return true;
    };
    if (!slab(rect.l, rect.r, p.x, dx)) return 0;
    if (!slab(rect.t, rect.b, p.y, dy)) return 0;
    if (leave < Math.max(enter, 0)) return 0;
    return Math.max(leave, 0);
  }

  /**
   * Where a road leaves a node on its way to (tx, ty).
   *
   * It starts at the marker, because that is the place, and is pushed out
   * only by whatever it would otherwise cross. Clipping to the whole box
   * instead made an east-west road stop thirty-odd pixels short of the
   * symbol: a box is as wide as the name below the marker, but at the
   * height of the marker that width is empty. A road heading south does
   * still clear the name, because there the name really is in the way.
   */
  boxAnchor(node, tx, ty, ox = 0, oy = 0) {
    const p = this.markerPoint(node, ox, oy);
    const dx = tx - p.x;
    const dy = ty - p.y;
    if (!dx && !dy) return p;

    const t = node.markerBox
      ? Math.max(
        this.rayExit(this.partRect(node, node.markerBox, ox, oy), p, dx, dy),
        this.rayExit(this.partRect(node, node.labelBox, ox, oy), p, dx, dy),
      )
      // Untiered: the node is one undivided block, so the box is the shape.
      : this.rayExit(this.nodeRect(node, ox, oy), p, dx, dy);

    return { x: p.x + dx * t, y: p.y + dy * t };
  }

  /**
   * A cross-link bows away from the straight line between its endpoints, so
   * it stays distinguishable from the tree edges it crosses and from a
   * second link running the other way between the same pair.
   */
  crossLinkPath(a, b, ox, oy) {
    const rootX = this.root.x + this.root.w / 2 + ox;
    const outward = (n) => n.side || (n.x + n.w / 2 + ox >= rootX ? 1 : -1);
    const outA = outward(a);
    const outB = outward(b);

    if (outA === outB) {
      // The common case: both ends on the same wing, often stacked in one
      // column a dozen pixels apart behind labels several times that wide.
      // Aiming the curve at the other node just drives it through the text,
      // so leave from the outer edge of each and swing round outside both.
      const p1 = this.edgeAnchor(a, outA, ox, oy);
      const p2 = this.edgeAnchor(b, outB, ox, oy);
      const bow = Math.max(28, Math.min(70, Math.abs(p2.y - p1.y) * 0.8));

      return this.svgPath(
        'M' + p1.x + ',' + p1.y
        + ' C' + (p1.x + outA * bow) + ',' + p1.y
        + ' ' + (p2.x + outB * bow) + ',' + p2.y
        + ' ' + p2.x + ',' + p2.y,
        'mm-edge mm-crosslink', a,
      );
    }

    // Opposite wings: no shared outside to route along, so head across.
    const ac = this.markerPoint(a, ox, oy);
    const bc = this.markerPoint(b, ox, oy);
    const p1 = this.boxAnchor(a, bc.x, bc.y, ox, oy);
    const p2 = this.boxAnchor(b, ac.x, ac.y, ox, oy);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.hypot(dx, dy) || 1;
    // A bow proportional to a short gap is a tick rather than a route.
    const bow = Math.max(34, Math.min(80, dist * 0.35));

    // Bow away from the root. The two perpendiculars are equally valid, but
    // the inward one dives back through the tree, where the node boxes cover
    // it — which is what makes a loop fail to read as a loop.
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const rootY = this.root.y + oy;
    const away = ((midX - rootX) * -dy + (midY - rootY) * dx) >= 0 ? 1 : -1;

    // Two control points rather than one: the curve leaves and rejoins each
    // node closer to square-on, which reads as a road going round rather
    // than a line clipping past.
    const nx = (-dy / dist) * bow * away;
    const ny = (dx / dist) * bow * away;
    const c1x = p1.x + dx * 0.25 + nx;
    const c1y = p1.y + dy * 0.25 + ny;
    const c2x = p1.x + dx * 0.75 + nx;
    const c2y = p1.y + dy * 0.75 + ny;

    return this.svgPath(
      'M' + p1.x + ',' + p1.y
      + ' C' + c1x + ',' + c1y + ' ' + c2x + ',' + c2y + ' ' + p2.x + ',' + p2.y,
      'mm-edge mm-crosslink', a,
    );
  }

  /**
   * Where an edge meets a node: the boundary of the box holding its marker
   * and name. Roads stop at the box rather than running into it, so neither
   * the symbol nor the caption is ever crossed.
   */
  edgeAnchor(node, dir, ox, oy) {
    const y = this.anchorY(node) + oy;
    if (node.markerBox) {
      // Beside a marker the box is only the width of the name below it, so
      // meet the symbol itself rather than the far edge of that name.
      const p = this.markerPoint(node, ox, oy);
      return { x: p.x + dir * node.markerBox.w / 2, y };
    }
    return { x: (dir > 0 ? node.x + node.w : node.x) + ox, y };
  }

  edgePath(parent, child, ox, oy) {
    const dir = child.side || 1;

    if (this.cfg.direction === 'compass') {
      // Roads on a map run straight between places, and the bearing already
      // decided where those places are, so there is nothing for a curve to
      // express here.
      const pc = this.markerPoint(parent, ox, oy);
      const cc = this.markerPoint(child, ox, oy);
      const a = this.boxAnchor(parent, cc.x, cc.y, ox, oy);
      const b = this.boxAnchor(child, pc.x, pc.y, ox, oy);

      return this.svgPath(
        'M' + a.x + ',' + a.y + ' L' + b.x + ',' + b.y,
        'mm-edge', child, child.depth,
      );
    }

    const from = this.edgeAnchor(parent, dir, ox, oy);
    // The child is met from the side facing its parent.
    const to = this.edgeAnchor(child, -dir, ox, oy);

    const x1 = from.x;
    const y1 = from.y;
    const x2 = to.x;
    const y2 = to.y;
    const mid = (x1 + x2) / 2;

    return this.svgPath(
      'M' + x1 + ',' + y1
      + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2,
      'mm-edge', child, child.depth,
    );
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
    // A big map shrunk to fit becomes an unreadable thumbnail. The floor is
    // expressed as a readable text size rather than a bare scale factor, so
    // it means the same thing whatever the font is set to; past that point
    // the map overflows and is panned instead of shrinking further.
    // Guarded: a non-finite value here would turn every node transform into
    // NaN and blank the map, with nothing thrown to say why.
    const minFont = Number.isFinite(this.cfg.minFontSize) ? this.cfg.minFontSize : 0;
    const legible = this.cfg.fontSize > 0 ? Math.min(1, minFont / this.cfg.fontSize) : 0;
    this.scale = Math.max(scale, legible, MIN_FIT_SCALE);

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
    this.updateClipHints();
  }

  /**
   * Fade the edges that have content beyond them. Once auto-fit stops at a
   * readable size a wide map has to overflow, and without this the branches
   * simply stop at the border with no sign there is more to pan to.
   */
  updateClipHints() {
    if (!this.bbox) return;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    if (!vw) return;
    const contentW = this.bbox.width * this.scale;
    const contentH = this.bbox.height * this.scale;

    this.viewport.classList.toggle('mm-clip-left', this.tx < -1);
    this.viewport.classList.toggle('mm-clip-right', this.tx + contentW > vw + 1);
    this.viewport.classList.toggle('mm-clip-top', this.ty < -1);
    this.viewport.classList.toggle('mm-clip-bottom', this.ty + contentH > vh + 1);
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

/**
 * Every setting is the same shape: a name, a note on what it is for, and
 * one control writing one key. Kept as a table so adding a setting is a
 * row rather than another nine lines of the same wiring.
 */
const SETTINGS_UI = [
  {
    key: 'direction',
    name: 'Layout direction',
    desc: 'Balanced spreads branches either side of the centre; rightward keeps one column.',
    dropdown: [['both', 'Balanced (both sides)'], ['right', 'Rightward']],
  },
  {
    key: 'colorfulBranches',
    name: 'Colourful branches',
    desc: 'Give each top-level branch its own hue. When off, everything uses the theme accent.',
    toggle: true,
  },
  {
    key: 'maxHeight',
    name: 'Maximum height',
    desc: 'Tallest a mind map may grow before it scales down to fit (px).',
    slider: [200, 1200, 20],
  },
  {
    key: 'fontSize',
    name: 'Font size',
    desc: 'Base text size for map nodes (px).',
    slider: [10, 24, 1],
  },
  {
    key: 'hGap',
    name: 'Horizontal spacing',
    desc: 'Gap between depth columns (px).',
    slider: [16, 120, 2],
  },
  {
    key: 'vGap',
    name: 'Vertical spacing',
    desc: 'Gap between sibling nodes (px).',
    slider: [2, 48, 1],
  },
  {
    key: 'maxNodeWidth',
    name: 'Node width limit',
    desc: 'Width at which node text starts wrapping (px).',
    slider: [120, 480, 10],
  },
  {
    key: 'edgeStyle',
    name: 'Edge style',
    desc: 'Dashed suits a route map; solid suits a mind map.',
    dropdown: [['solid', 'Solid'], ['dashed', 'Dashed']],
  },
  {
    key: 'minFontSize',
    name: 'Minimum text size',
    desc: 'A large map scales down to fit, but never below this. Past it, '
      + 'the map overflows its box and can be panned instead (px).',
    slider: [6, 20, 1],
  },
];

class MindMapSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    for (const spec of SETTINGS_UI) {
      const setting = new Setting(containerEl).setName(spec.name).setDesc(spec.desc);
      const value = this.plugin.settings[spec.key];
      const commit = async (v) => {
        this.plugin.settings[spec.key] = v;
        await this.plugin.saveSettings();
      };

      if (spec.dropdown) {
        setting.addDropdown((d) => {
          for (const [v, label] of spec.dropdown) d.addOption(v, label);
          return d.setValue(value).onChange(commit);
        });
      } else if (spec.toggle) {
        setting.addToggle((t) => t.setValue(value).onChange(commit));
      } else {
        setting.addSlider((sl) => sl
          .setLimits(spec.slider[0], spec.slider[1], spec.slider[2])
          .setValue(value)
          .setDynamicTooltip()
          .onChange(commit));
      }
    }
  }
}

module.exports = MindMapPlugin;
