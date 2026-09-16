# Mindmap Blocks Demo

A quick tour of the Mindmap Blocks plugin. Everything below is plain
markdown inside `mindmap` code blocks.

## The basics

Indented bullets, split either side of the centre:

```mindmap
- Product Launch
  - Marketing
    - Social campaign
    - Email sequence
    - Press outreach
  - Engineering
    - API hardening
    - Frontend polish
    - Load testing
  - Operations
    - Support rota
    - Runbooks
  - Finance
    - Pricing review
```

Every map shows itself in full. Drag to pan, Ctrl+scroll to zoom,
double-click to refit.

## Inline markdown and links

Nodes accept bold, italic, code, highlights and links. Wiki links are
clickable and open the note.

```mindmap
- **Research** notes
  - Sources
    - [[Some Note]] (a wiki link — unresolved here, click it in your own vault)
    - [Obsidian docs](https://help.obsidian.md)
    - `api/reference.md`
  - Themes
    - *Emergence* in complex systems
    - ==Key insight== worth revisiting
    - ~~Discarded thread~~
```

## Headings work too

Headings and bullets can be mixed — a heading becomes a node and the bullets
beneath it become its children.

```mindmap
# Quarterly Plan
## Objectives
- Grow retention
- Ship the mobile client
## Risks
- Hiring timeline
- Vendor lock-in
```

## Per-map options

A `---` block at the top overrides the settings for that map alone. This one
runs rightward instead of balancing across both sides.

```mindmap
---
direction: right
---
- Knowledge Base
  - Concepts
    - Atomic notes
    - Linking
  - Guides
    - Setup
    - Troubleshooting
  - Reference
    - Hotkeys
```

## Several top-level ideas

With no single root, the branches meet at a small neutral hub.

```mindmap
- First idea
  - supporting detail
- Second idea
  - supporting detail
- Third idea
```
