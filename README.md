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
| `direction` | `both`, `right`, `compass` | Balanced, a single rightward column, or placed by bearing |
| `height` | px | Height cap for this map |
| `color` | `true`, `false` | Per-branch colours, or the theme accent throughout |
| `fontSize` | px | Base text size |
| `hGap`, `vGap` | px | Spacing between columns / siblings |
| `nodeWidth` | px | Width at which node text wraps |
| `tiers` | shape list | Turn on tier markers (see below) |
| `legend` | `true`, `false` | Show the key under a tiered map |
| `link` | `A -> B` | Connect two nodes across the tree; may repeat |
| `minFont` | px | Auto-fit will not shrink text below this |
| `edges` | `solid`, `dashed` | Route style; dashed suits a map |
| `edgeLabels` | `true`, `false` | Allow `:: name` to name a connection |

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
      - Crow's Rest {1}
  - Redwater {1}
    - Stone River {3}
```
~~~

`Northreach {2}` and `Crow's Rest {1}` are siblings with different markers,
which is the whole point — tier is a property of the thing, not of its
position. Shapes available: `bar`, `circle`, `diamond`, `square`, `pill`.
Names after `=` are optional and label the key; without them the key reads
"Tier 1", "Tier 2" and so on. A key renders under the map unless you set
`legend: false`.

A tiered node is a symbol over a caption: the name always sits under the
marker. Roads run along the **line of the markers**, because the marker is
the place and the name below it is only what the place is called — and they
they run right up to the symbol, standing off only where a name is
genuinely in the way. An east-west road meets the marker exactly, because
beside a marker there is nothing but empty space; a road heading south
clears the name below its origin, and one heading north clears the name
below its destination, because there the name really is in its path.
Nothing else is ever crossed. Bearings are measured marker to marker for
the same reason: measuring between box centres instead would tilt a road by
however much two nodes differ in height.
Nodes you leave unmarked keep the normal depth styling, so you can tag only
what matters.

**`{n}` is inert in a map with no `tiers:` line.** A node reading
`Match two digits \d{2}` keeps its braces, and adding tiers to one map can
never change how another one parses.

### Compass layout

The default layout arranges nodes in columns by depth, which is right for a
mind map and wrong for a map. `direction: compass` places each node on a
bearing from its parent instead:

~~~markdown
```mindmap
---
direction: compass
---
- Portsmith
  - Breakwater @N
    - Glasspoint
      - Northreach @N
      - Crow's Rest @E
  - Beachwood @S
  - Redwater @E
```
~~~

Bearings are `@N`, `@NE`, `@E`, `@SE`, `@S`, `@SW`, `@W` and `@NW`, written
after any tier marker. The full order on a line is
`text {tier} @bearing :: connection name`. A node without one continues in
the direction its parent went — so a road only needs a bearing where it
turns, and Glasspoint above needs none to keep heading north.

Siblings sharing a bearing are fanned apart across it, so two settlements
both `@W` of a hub sit one above the other rather than on top of each other.

A number after the bearing multiplies the gap to the parent — `@E3` places a
node three gaps east instead of one. This is usually the cleanest way out of
a collision: rather than bending a road onto a diagonal it does not take,
push the place it hangs from further out and let the road run true.

~~~markdown
- Portsmith
  - Redwater @E3      <- pushed east, making room below it
    - Ash Hollow @S   <- so this road can run due south
~~~

**The trade is that you own the collisions.** Nothing reflows to avoid
anything: two subtrees can grow into the same space, and the fix is to pick
different bearings. That is the price of deciding where things go — the
column layout never overlaps precisely because it never lets you choose.

**`@N` is inert in a map without `direction: compass`**, so a node reading
`Forward to @N` keeps its text.

### Cross-links

Nested bullets can only describe a tree — every node gets exactly one
parent — so a route that loops back has nowhere to go. `link:` draws that
connection on top of the tree:

~~~markdown
```mindmap
---
link: Westgate Ford -> North Watch
---
- Stone River
  - West Road
    - Millbrook
      - Westgate Ford
  - North Road
    - Highfell
      - North Watch
```
~~~

A road leaving west and returning from the north, without either end
losing its place in the hierarchy. Cross-links are dashed and dimmer than
tree edges, because the tree is still what explains the shape of the map.
`link:` may repeat, names match node text case-insensitively, and anything
that fails to resolve is reported under the map rather than silently
skipped.

Branches joined by a cross-link are placed on the same side of a balanced
map, and the arc bows away from the centre rather than back through the
tree, so a local loop stays a short visible hop instead of disappearing
under the node boxes it crosses.

**This does not make the layout a graph.** Placement still comes from the
tree: each node sits where its parent puts it. That suits loops between
nearby places — the roundabout route above draws as a 60px arc on a
1000px-wide map — but a link between two distant corners will be a long
line, because neither end can move to meet the other.

### Naming a connection

Some things belong to the link rather than to either end — the name of a
road, what a step depends on. `edgeLabels: true` turns on `:: name`, written
last on the line, naming the connection into that node:

~~~markdown
```mindmap
---
edgeLabels: true
---
- Stone River
  - Tunnelmouth :: Ancient Tunnels
    - Hearthdeep :: Echo Delve
```
~~~

The name sits at the midpoint of the connection, taken from the drawn path,
so it lands correctly on a curve as readily as on a straight road. Labels
take no part in layout: nothing moves to make room, so a long name on a
short link will overhang it.

**`::` is inert without `edgeLabels`**, so a Dataview-style `field:: value`
keeps its text.

### Edge style

`edges: dashed` draws the connections as dashed lines, which reads as a map
rather than a diagram; `solid` is the default and suits a mind map. Set it
per map, or for everything in settings. Cross-links keep a shorter dash of
their own so they stay distinguishable either way.

### Readability

A map wider than the note scales down to fit — but only until its text
reaches the **minimum text size** (15px by default, in settings or per map
with `minFont`). At the default this equals the base font size, so maps
never shrink at all: a wide one overflows and is panned. Lower `minFont` if
you would rather trade some legibility for seeing the whole map at once. Past that it stops shrinking, overflows its box, and is
panned instead. Shrinking without a floor turns a large map into an
unreadable thumbnail.

Edges with more map beyond them are faded, so an overflowing map looks
like it continues rather than like it was cut off. Drag to bring the rest
into view.

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
