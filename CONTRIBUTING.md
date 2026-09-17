# Contributing

Thanks for looking. This is a small plugin with a deliberately small
surface, so most of what follows is about keeping it that way.

## The shape of the thing

There is no build step and there are no dependencies. Obsidian loads three
files — `manifest.json`, `main.js` and `styles.css` — and those three are
the source, not an output. Everything else in the repo is docs or tooling.

That is a constraint worth defending. It means anyone can read the code
that is actually running, and that a release is the repository rather than
an artefact of it.

- Plain JavaScript, no transpiler, no bundler, no runtime dependencies.
- Build DOM with Obsidian's helpers (`createDiv`, `createEl`, `createSpan`).
  Never `innerHTML` — it is a review rejection and an injection risk.
- Colours come from Obsidian theme variables or `--mm-branch-color`, so a
  map follows whatever theme is active. No hard-coded hex.
- Ask for no capability the plugin can do without. Clipboard access was
  removed for exactly this reason: it bought one convenience and cost a
  permission disclosure in the community directory.

## Getting set up

```bash
git clone https://github.com/Paultagoras/obsidian-markdown-mindmap
cd obsidian-markdown-mindmap
./install.sh "/path/to/your/vault"
```

Then enable **Mindmap Blocks** under *Settings → Community plugins*.

## Testing

`dev/preview.html` renders every feature against a stubbed Obsidian API in
a browser. It is far faster than reloading the app and it covers layout
cases that are tedious to reproduce by hand. It needs to be served over
HTTP rather than opened as a `file://` URL:

```bash
python -m http.server 8731
```

Then open <http://127.0.0.1:8731/dev/preview.html>. The page reports
`rendered N/N cases` at the top; anything less means a case threw.

**Add a case for what you change.** The harness has caught real bugs before
they reached a vault — a redeclared variable, a `NaN` scale that blanked
every map, a syntax error. It only does that because the cases exist.

### Measure, do not eyeball

Layout claims should be checked numerically. "It looks right" has been
wrong here more than once. The harness gives you real geometry, so use it:
sample a path with `getPointAtLength`, intersect node rectangles, compare a
road's angle against its bearing, count overlaps. A pull request that says
*no road crosses a name, verified across 21 cases* is worth more than a
screenshot.

### Reload Obsidian, every time

Obsidian loads a plugin's code **once**, when the plugin is enabled or the
app starts. Editing files on disk does nothing to a running app. After
`./install.sh`, reload with Ctrl+P → *Reload app without saving*, or you
will spend a while debugging the previous build. This has bitten us.

## Compatibility: new notation must be opt-in

Node text is user prose. Anything the parser treats as syntax is text
somebody has already written in a note — `{3}` is in a regex, `@N` is in a
sentence, `::` is a Dataview field. So:

**Every notation is gated behind a declaration in the map's own options
block, and is inert without it.**

- `{n}` does nothing unless that map has a `tiers:` line.
- `@N` does nothing unless that map sets `direction: compass`.
- `:: name` does nothing unless that map sets `edgeLabels: true`.

Rarity is not a gate. If you add notation, gate it the same way and add a
regression case proving the raw text survives in a map that has not opted
in. The `REGRESSION:` cases in the harness are there to be copied.

## Commits and pull requests

Write the commit message for someone reading it in a year with no memory of
the conversation: what was wrong, what changed, and how you know it works.
Say what you verified and what you did not.

If something in scope turned out to be blocked or you left it undone, say
so plainly in the pull request rather than leaving it to be discovered.

## Releasing

Releases are automated. Bump the version in `manifest.json`, record the
minimum Obsidian version in `versions.json`, then push a matching tag:

```bash
git tag 1.0.1
git push origin 1.0.1
```

`.github/workflows/release.yml` takes it from there: it refuses the release
if the tag and `manifest.json` disagree or if `versions.json` has no entry
for it, attests the assets, and publishes `main.js`, `manifest.json` and
`styles.css` as three individual files — which is the form Obsidian
requires. Do not attach a zip.

## Licence

By contributing you agree that your work is licensed under the
[MIT licence](LICENSE) that covers this project.
