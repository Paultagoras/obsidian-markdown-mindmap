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

## Tiers

Mark what a node *is*, independently of how deep it sits. Declare the tiers,
then tag nodes with `{n}`. Northreach and Saltwatch are siblings here, with
different markers.

```mindmap
---
tiers: bar=Tier 1 settlement, circle=Tier 2 settlement, diamond=Tier 3 settlement
---
- Portsmith {2}
  - Breakwater {1}
    - Glasspoint {2}
      - Northreach {2}
      - Saltwatch {1}
      - Greyhaven {1}
  - Redwater {1}
    - Clearwater {1}
      - Stone River {3}
        - Millstone {1}
          - Ironbank {2}
        - Reed Crossing {1}
          - Blackwater {2}
            - Kingsford {3}
```

Shapes: `bar`, `circle`, `diamond`, `square`, `pill`. Unmarked nodes keep the
normal depth styling, so you can tag only what matters.
