# Markdown Mind Map

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
collapse: 1
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
| `collapse` | number | Collapse everything below this depth (`1` shows only branches) |
| `height` | px | Height cap for this map |
| `color` | `true`, `false` | Per-branch colours, or the theme accent throughout |
| `fontSize` | px | Base text size |
| `hGap`, `vGap` | px | Spacing between columns / siblings |
| `nodeWidth` | px | Width at which node text wraps |
| `toolbar` | `true`, `false` | Show the hover toolbar |

### Interacting

- **Click the badge** on a node to collapse or expand it. A collapsed node
  keeps its badge visible, showing how many descendants are hidden.
- **Drag** to pan, **Ctrl/Cmd + scroll** to zoom, **double-click** to refit.
  Plain scrolling is left to the note.
- **Right-click** a node for collapse, expand-subtree, focus and copy.
- The **hover toolbar** has zoom, fit, expand-all and collapse-to-branches.

Plugin-wide defaults for all of the above live in
*Settings → Community plugins → Markdown Mind Map*.

## Install

Copy `manifest.json`, `main.js` and `styles.css` into
`<vault>/.obsidian/plugins/markdown-mindmap/`, then enable the plugin under
*Settings → Community plugins*. `install.sh` does the copy for you:

```bash
./install.sh "/c/Repos/Notes"
```

## Development

There is no build. Edit `main.js` or `styles.css`, then reload Obsidian
(Ctrl+R) to pick up the change.

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
