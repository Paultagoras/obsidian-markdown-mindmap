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
then tag nodes with `{n}`. Northreach and Crow's Rest are siblings here,
with different markers.

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

## Cross-links

Nested bullets only describe a tree, so a route that loops back has nowhere
to go. `link:` draws it anyway — here a road leaves west and returns from
the north, without either end losing its place in the hierarchy.

```mindmap
---
tiers: bar=Waypoint, circle=Town, diamond=City
link: Westgate Ford -> North Watch
---
- Stone River {3}
  - West Road {1}
    - Millbrook {2}
      - Westgate Ford {1}
  - North Road {1}
    - Highfell {2}
      - North Watch {1}
  - East Road {1}
    - Eastmarch {2}
```

Cross-links are dashed and dimmer than tree edges. Placement still comes
from the tree, so these work best between places that are already near each
other — which is what a local loop is.

## The full route map

The Settlement Route Map redrawn with the plugin: 34 settlements, three
tiers, placed by compass so it reads as a map rather than as columns by
distance. Portsmith is the hub — the northern road runs up through
Breakwater to Glasspoint and east to Stonewright, the southern road down
through Beachwood to Smithport, and the eastern road out through Redwater
and Clearwater to Stone River and the country beyond it.

`@N`, `@NE`, `@E` and so on set a bearing. Where a road simply carries on,
no bearing is needed: a node without one continues the way its parent went,
so you only write a bearing where the route turns.

```mindmap
---
direction: compass
edges: dashed
height: 720
tiers: bar=Tier 1 settlement, circle=Tier 2 settlement, diamond=Tier 3 settlement
---
- Portsmith {2}
  - Breakwater {1} @N
    - Glasspoint {2}
      - Northreach {2} @N
      - Crow's Rest {1} @E
        - Stonewright {2}
          - Slate Camp {1} @NE
          - Deepwell {1} @E
          - Farpoint {2} @SE
  - Beachwood {1} @S
    - Smithport {2}
      - Driftwood {1} @S
      - Southbay {2} @E
  - Redwater {1} @E3
    - Ash Hollow {1} @S
      - Duston {1}
        - Copperfield {2}
          - Scrapper's Rest {1} @SE
    - Clearwater {1} @E2
      - Fisher's Bend {1} @S
        - Greenbank {1}
          - Lakewood {2}
      - Stone River {3} @E
        - Tunnelmouth {1} @NE
          - Hearthdeep {2} @E
            - Iron Hollow {2} @NE
            - Cold Hollow {1} @E
        - Millstone {1} @E
          - Ironbank {2}
            - Highwater {1} @E
        - Reed Crossing {1} @SE
          - Old Ferry {1}
            - Blackwater {2}
              - Kingsford {3} @S
```

A number after the bearing multiplies the gap to the parent. Redwater runs
`@E3` because the road south from it — Ash Hollow, Duston, Copperfield —
would otherwise grow into Smithport's cluster; pushing Redwater further east
makes room for that road to run due south, as it should. Clearwater runs
`@E2` for the same reason.

That is the shape of the work: placing by hand means you own the collisions,
and the fixes are to change a bearing or to push something further out. Where
two places do share a bearing — both `@W` of the same hub, say — they are
fanned apart across it rather than stacked on one line.

One thing the original drawing still says that this cannot: the routes
named between settlements — *Ancient Tunnels* from Stone River to
Tunnelmouth, *Echo Delve* on to Hearthdeep — because labels attach to
nodes, and those belong to the road.
