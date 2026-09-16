# Mindmap Blocks

An Obsidian plugin that renders indented markdown lists as clean mind maps,
inline in your notes.

No build step and no dependencies — the plugin is plain JavaScript, so
`manifest.json`, `main.js` and `styles.css` are the whole thing.

## Usage

Put a list inside a `mindmap` code block:

~~~markdown
```mindmap
- Product Launch
  - Marketing
    - Social campaign
    - Email sequence
  - Engineering
    - API hardening
    - Load testing
```
~~~

The first level becomes the centre, top-level branches are split either side
of it and coloured, and deeper levels sit on a coloured rule. Maps render in
both Reading view and Live Preview. The command palette has
**Insert mind map block** for a starter template.

For a worked reference covering every feature, copy
[`examples/Mindmap Blocks Demo.md`](examples/Mindmap%20Blocks%20Demo.md)
into your vault and open it in Reading view.

### What the block accepts

- **Bullets** (`-`, `*`, `+` or `1.`), nested by indentation.
- **Headings** (`#`, `##`, …), which may be mixed with bullets — a heading
  becomes a node and the bullets under it become its children.
- **Several top-level items**, which are joined by a small neutral hub.
- **Inline markdown** in any node: `**bold**`, `*italic*`, `` `code` ``,
  `~~strike~~`, `==highlight==`, `[[wiki links]]` (clickable — they open the
  note) and `[text](url)`.

### Per-map options

An optional `---` block at the top overrides the settings for that one map:

~~~markdown
```mindmap
---
direction: right
height: 400
---
- Knowledge Base
  - Concepts
  - Guides
```
~~~

| Key | Values | Meaning |
| --- | --- | --- |
| `direction` | `both`, `right` | Balanced on both sides, or a single rightward column |
| `height` | px | Height cap for this map |
| `color` | `true`, `false` | Per-branch colours, or the theme accent throughout |
| `fontSize` | px | Base text size |
| `hGap`, `vGap` | px | Spacing between columns / siblings |
| `nodeWidth` | px | Width at which node text wraps |
| `tiers` | shape list | Turn on tier markers (see below) |
| `legend` | `true`, `false` | Show the key under a tiered map |

### Tiers

Depth styling says where a node sits in the tree. Sometimes you want to say
what a node *is* — a settlement's size, a task's priority — independently of
how deep it happens to be. Declare the tiers, then mark nodes with `{n}`:

~~~markdown
```mindmap
---
tiers: bar=Tier 1 settlement, circle=Tier 2 settlement, diamond=Tier 3 settlement
---
- Portsmith {2}
  - Breakwater {1}
    - Glasspoint {2}
      - Northreach {2}
      - Saltwatch {1}
  - Redwater {1}
    - Stone River {3}
```
~~~

`Northreach {2}` and `Saltwatch {1}` are siblings with different markers,
which is the whole point — tier is a property of the thing, not of its
position. Shapes available: `bar`, `circle`, `diamond`, `square`, `pill`.
Names after `=` are optional and label the key; without them the key reads
"Tier 1", "Tier 2" and so on. A key renders under the map unless you set
`legend: false`.

Markers sit on the side the branch arrives from, so the line meets the
shape. Nodes you leave unmarked keep the normal depth styling, so you can
tag only what matters.

**`{n}` is inert in a map with no `tiers:` line.** A node reading
`Match two digits \d{2}` keeps its braces, and adding tiers to one map can
never change how another one parses.

### Interacting

A map always shows itself in full — there is nothing to expand and no
controls to find, which keeps it readable on a phone as well as a desktop.

- **Drag** to pan, **double-click** to refit. Both work with touch.
- **Ctrl/Cmd + scroll** to zoom on desktop. Plain scrolling is left to the
  note, so the page never traps your wheel.
- **Right-click** a node to copy its text (a desktop convenience only —
  nothing is only reachable this way).

Plugin-wide defaults live in
*Settings → Community plugins → Mindmap Blocks*.

## Install

Obsidian needs exactly three files. Copy `manifest.json`, `main.js` and `styles.css` into
`<vault>/.obsidian/plugins/mindmap-blocks/`, then enable the plugin under
*Settings → Community plugins*. `install.sh` does the copy for you:

```bash
./install.sh "/c/Repos/Notes"
```

## Syncing across machines

Obsidian loads only three files: `manifest.json`, `main.js` and
`styles.css`. Everything else in this repo is source, docs or tooling.

On a new machine:

```bash
git clone <your-repo-url> ObsidianMindMap
cd ObsidianMindMap
./install.sh "/path/to/vault"
```

Then enable the plugin under *Settings → Community plugins*. Plugin
settings live in `data.json` inside the installed folder — that is per-vault
state, not source, so it is gitignored and each machine keeps its own.

## Development

There is no build. Edit `main.js` or `styles.css`, run `./install.sh`, then
**reload Obsidian** — Ctrl+P → *Reload app without saving*.

The reload is not optional. Obsidian loads a plugin's code once, when the
plugin is enabled or the app starts; editing the files on disk does nothing
to a running app, and you will keep seeing the previous build.

`dev/preview.html` renders the plugin in a browser against a stubbed Obsidian
API, which is a much faster loop than reloading the app, and covers layout
cases that are tedious to reproduce by hand. It needs the files served over
HTTP rather than opened as `file://`:

```bash
python -m http.server 8731
```

Then open <http://127.0.0.1:8731/dev/preview.html>.

## How it works

1. **Parse** — `parseMindmap()` walks the block line by line, keeping a stack
   of open ancestors keyed on heading level or indent width, so headings and
   bullets nest against each other correctly.
2. **Measure** — each node is built as a real DOM element and measured in a
   hidden sandbox on `<body>`, so layout is correct even before the block is
   attached and painted.
3. **Lay out** — branches are split between the two wings by leaf count, each
   depth gets a column sized to its widest node, and every parent is centred
   on the vertical span of its children.
4. **Paint** — nodes are positioned with transforms over a single SVG layer of
   bezier edges. Pan and zoom are one transform on the container, so neither
   re-runs layout.

## Licence

MIT — see [LICENSE](LICENSE).
