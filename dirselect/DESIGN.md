# DirSelect — TUI Directory Selection Manager (Design)

A terminal app for maintaining named sets of directories ("selections"). Each
selection is a list of directories that can be reopened later with the same
checkboxes ticked. Built with TypeScript on
[`@opentui/core`](https://opentui.com/docs) (v0.6.6), run with Bun.

This document is a design, not a finished app. Code blocks are illustrative
skeletons that map directly onto the real opentui API. Anything the prompt left
ambiguous is decided here and flagged in [§13](#13-interpreting-the-prompt).

---

## 1. Goals and non-goals

### Goals

- Show the list of saved selection **names** on startup.
- Let the user **rename** and **delete** selections.
- Let the user **open the explorer** with a selection's directories pre-checked.
- Show a lazily-loaded, collapsible tree whose roots are `$HOME` plus any
  directories passed as CLI arguments.
- Show **only directories initially**; a directory can be opened to reveal its
  **files**, and closed again.
- Give every directory a **checkbox**. Selecting a directory prevents any
  directory beneath it from being selected.
- On exit, offer to **save** the current selection under a user-supplied name.

### Non-goals (v1)

- Editing files, previewing contents, or launching external programs.
- Multi-select of arbitrary files (only directories are selectable).
- Watching the filesystem for live changes.
- Concurrent instances sharing one config file (last write wins; writes are
  atomic so the file never corrupts).

---

## 2. Runtime, project layout, dependencies

**Runtime.** `@opentui/core` requires Bun ≥ 1.3.14 (or Node ≥ 26.4 with
`--experimental-ffi`). We target Bun, which runs the TypeScript source directly.

```bash
bun add @opentui/core
bun add -d @types/bun typescript     # types only
```

```
dirselect/
├── package.json            # "bin": { "dirselect": "src/main.ts" }, type: module
├── tsconfig.json           # strict, moduleResolution: bundler, jsxImportSource not needed
├── src/
│   ├── main.ts             # bootstrap + shutdown
│   ├── cli.ts              # argv parsing
│   ├── config.ts           # load/save/normalize config file
│   ├── paths.ts            # expandHome, canonicalize, isDescendantOf, displayPath
│   ├── selection.ts        # selection-set invariants (pure, unit-tested)
│   ├── tree.ts             # lazy tree model + visible-row builder (pure-ish)
│   ├── app.ts              # state machine: Home / Explorer / modals
│   └── ui/
│       ├── renderer.ts     # createCliRenderer + root layout
│       ├── theme.ts        # colors
│       ├── home.ts         # selection list screen
│       ├── explorer.ts     # tree screen
│       └── dialogs.ts      # prompt + confirm modals
└── test/
    ├── selection.test.ts
    └── tree.test.ts
```

Rationale: everything that can be a **pure function over plain data**
(`selection.ts`, `tree.ts`, `paths.ts`) is separated from opentui renderables so
it can be unit-tested without a terminal. The `app.ts` layer owns opentui
objects and key routing.

`tsconfig.json` essentials:

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ESNext"],
    "types": ["bun"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

---

## 3. Command-line interface

```
dirselect [options] [ROOT...]

Roots are directories shown at the top of the tree. $HOME is always a root;
any ROOT arguments are shown in addition to it, in the order given.

Options
  --config <path>     config file to use (default: $XDG_CONFIG_HOME/dirselect/config.json)
  --files             start with files visible (default: directories only)
  --hidden            show dotfiles/dot-directories
  --follow-symlinks   follow symlinked directories (cycle-guarded)
  -h, --help
  -v, --version
```

Parsing (no dependency; the surface is tiny):

```ts
// src/cli.ts
import { homedir } from "node:os"
import { canonical } from "./paths"

export interface CliOptions {
  roots: string[]          // canonical absolute paths, in display order
  configPath?: string
  showFiles: boolean
  showHidden: boolean
  followSymlinks: boolean
}

export function parseArgs(argv: string[], home = homedir()): CliOptions {
  const opts: CliOptions = {
    roots: [], showFiles: false,
    showHidden: false, followSymlinks: false,
  }
  const positionals: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case "--config": opts.configPath = argv[++i]; break
      case "--files": opts.showFiles = true; break
      case "--hidden": opts.showHidden = true; break
      case "--follow-symlinks": opts.followSymlinks = true; break
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option: ${arg}`)
        positionals.push(arg)
    }
  }
  const extra = positionals.map((p) => canonical(p, home))  // expand ~, make absolute
  // $HOME is always the first root; ROOT arguments follow in order (deduplicated).
  opts.roots = [home, ...extra.filter((p) => p !== home)]
  return opts
}
```

> **Decision.** `$HOME` is **always** a root and is shown first. Positional ROOT
> arguments are rendered in addition to it, in the order given. See
> [§13](#13-interpreting-the-prompt).

---

## 4. Config file

### Location

`$XDG_CONFIG_HOME/dirselect/config.json`, falling back to
`~/.config/dirselect/config.json`. Overridable with `--config` (and an
optional `DIRSELECT_CONFIG` env var, checked before the default).

### Format

JSON, versioned, ordered (order is the display order and is user-meaningful):

```json
{
  "version": 1,
  "selections": [
    { "name": "work",    "paths": ["/home/alice/projects", "/home/alice/notes"] },
    { "name": "media",   "paths": ["/home/alice/media"] },
    { "name": "scratch", "paths": [] }
  ]
}
```

Invariants:

- `paths` are **absolute** and **canonical** (see [§5](#5-path-handling)).
- `paths` form an **antichain**: no path is an ancestor of another. An ancestor
  already covers its subtree, so storing both is redundant. Violations in
  hand-edited files are silently reduced on load, not rejected.
- Duplicate `name`s are not expected; on load, later entries win and a warning
  is surfaced in the status line.

### Load / save / normalize

```ts
// src/config.ts
import { promises as fs } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { canonical, isDescendantOf } from "./paths"

export interface Selection { name: string; paths: string[] }
export interface ConfigFile { version: 1; selections: Selection[] }

export function defaultConfigPath(env = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base, "dirselect", "config.json")
}

export async function loadConfig(path: string): Promise<ConfigFile> {
  try {
    return normalizeConfig(JSON.parse(await fs.readFile(path, "utf8")))
  } catch (err: any) {
    if (err?.code === "ENOENT") return { version: 1, selections: [] }
    throw new ConfigError(`cannot read ${path}: ${err.message}`)
  }
}

export async function saveConfig(path: string, config: ConfigFile): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8")
  await fs.rename(tmp, path)   // atomic replace on the same filesystem
}

/** Defense in depth: accept anything, emit a valid ConfigFile. */
export function normalizeConfig(input: unknown): ConfigFile {
  const raw = (input ?? {}) as any
  const list: any[] = Array.isArray(raw.selections) ? raw.selections : []
  const byName = new Map<string, Selection>()
  for (const item of list) {
    const name = String(item?.name ?? "").trim()
    if (!name) continue
    const paths = Array.isArray(item?.paths)
      ? item.paths.filter((p: unknown) => typeof p === "string").map((p: string) => canonical(p))
      : []
    byName.set(name, { name, paths: canonicalize(paths) })
  }
  return { version: 1, selections: [...byName.values()] }
}
```

Errors are non-fatal where possible: a corrupt config shows an error and starts
with an empty list rather than crashing.

---

## 5. Path handling

```ts
// src/paths.ts
import { homedir } from "node:os"
import { isAbsolute, normalize, resolve, sep } from "node:path"

export function expandHome(p: string, home = homedir()): string {
  if (p === "~") return home
  if (p.startsWith("~/")) return resolve(home, p.slice(2))
  return p
}

/** Absolute, normalized, no trailing slash. Does NOT resolve symlinks. */
export function canonical(p: string, home = homedir()): string {
  let out = expandHome(p, home)
  if (!isAbsolute(out)) out = resolve(out)
  out = normalize(out)
  if (out.length > 1 && out.endsWith(sep)) out = out.slice(0, -1)
  return out
}

export function isDescendantOf(child: string, ancestor: string): boolean {
  if (child === ancestor) return false
  const prefix = ancestor.endsWith(sep) ? ancestor : ancestor + sep
  return child.startsWith(prefix)
}

/** `~`-shortened form for display. */
export function displayPath(p: string, home = homedir()): string {
  if (p === home) return "~"
  return p.startsWith(home + sep) ? "~" + p.slice(home.length) : p
}
```

> **Decision.** We canonicalize lexically and **do not** `realpath()` by default:
> resolving symlinks can make a stored path surprise the user later, and it is
> slow across deep trees. Comparison is therefore path-string based. Symlinked
> directories are not followed by default (avoids cycles); `--follow-symlinks`
> enables following with an ancestor-set cycle guard.

---

## 6. Data model

### 6.1 Tree node

```ts
// src/tree.ts
export type NodeKind = "dir" | "file"

export interface TreeNode {
  path: string             // absolute; also the stable id
  name: string             // basename (roots use displayPath)
  kind: NodeKind
  depth: number
  parent: TreeNode | null
  dirs: TreeNode[] | null  // sub-directories; null = not loaded yet
  files: TreeNode[]        // files in this directory; [] until loaded (dirs only)
  loaded: boolean
  expanded: boolean        // children are visible
  showFiles: boolean       // files included while expanded
  selected: boolean        // explicit selection (dirs only)
  error?: string           // e.g. EACCES / ENOENT, shown inline
}
```

Each node holds **directories and files separately**. This lets `expanded`
(show sub-directories) and `showFiles` (also show files) be independent, so we
can honour "initially only directories are shown" without discarding the file
list when the user toggles files on and off.

### 6.2 Visible row (derived, rebuilt on change)

```ts
export interface Row {
  node: TreeNode
  depth: number
  implied: boolean          // an ancestor is selected → checkbox checked, disabled
  partial: boolean          // not selected, but a descendant is → indeterminate
  isLast: boolean
  ancestorLast: boolean[]   // for drawing tree guides
}
```

`implied` and `partial` are **derived**, never stored. This is what makes the
"select a directory ⇒ nothing below may be selected" rule robust even for
subtrees that are not loaded yet: once an ancestor is `selected`, every
descendant computed later is `implied` and its checkbox is disabled.

---

## 7. Selection semantics

The rule from the prompt — *if a directory is selected, all directories below it
cannot be selected* — is implemented as an **antichain of explicit selections**:

- `selected` is an explicit flag on a directory only.
- Selecting directory `D`:
  1. is a **no-op if `D` is `implied`** (an ancestor is selected), and
  2. **clears explicit selection on all loaded descendants** (the ancestor now
     covers them), then sets `D.selected = true`.
- Deselecting `D` simply clears `D.selected`. Descendants are **not** restored;
  the user re-selects what they want. (Restoring would require remembering
  shadowed state, which is surprising and is out of scope.)
- Files are never selectable; their checkbox column is blank.

Rendered checkbox states:

| State | Glyph | Meaning |
|---|---|---|
| selectable, off | `[ ]` | can be toggled |
| selected | `[x]` | explicitly selected |
| implied | `[-]` (dim) | an ancestor is selected; toggling is refused |
| partial | `[~]` (amber) | has a selected descendant, itself unselected |

Pure helpers:

```ts
// src/selection.ts
import { isDescendantOf } from "./paths"

/** The saved set is the antichain of explicit selections. */
export function canonicalize(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort()       // ancestor sorts before descendant
  const out: string[] = []
  for (const p of sorted) {
    if (out.some((a) => isDescendantOf(p, a))) continue
    out.push(p)
  }
  return out
}

/** Attempt a checkbox toggle. `descendants` are loaded descendants of `dir`. */
export function toggle(
  explicit: Set<string>,
  dir: string,
  isImplied: boolean,
  descendants: string[],
): boolean {
  if (isImplied) return false           // ancestor selected → refused
  if (explicit.has(dir)) { explicit.delete(dir); return true }
  explicit.add(dir)
  for (const d of descendants) explicit.delete(d)
  return true
}

export function diff(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const A = new Set(a), B = new Set(b)
  return {
    added: b.filter((x) => !A.has(x)),
    removed: a.filter((x) => !B.has(x)),
  }
}
```

### Opening a preset

A preset stores canonical absolute paths. Loading it into the explorer:

1. If the explorer is already dirty, prompt first ([§9](#9-saving-and-leaving)).
2. Compute the target set = `canonicalize(preset.paths)`.
3. For each target path, find the containing root via `isDescendantOf`/equality.
   - No containing root → skip and count it; report "N saved paths are outside
     the current roots" in the status line.
4. **Expand the ancestor chain** from the root down to each target (async; may
   read several directories). Show a transient `loading…` status.
5. Set `selected = true` on each target; leave the rest unchecked.
6. Position the cursor on the first target and `scrollChildIntoView` it.

Missing paths (deleted since the preset was saved) are shown as an error row,
kept in the working set, and only dropped if the user saves (they are no longer
selectable, so they cannot be re-checked).

---

## 8. UI

Two full-screen "modes" plus modal overlays. Layout uses the renderer root as a
flex column: a header, a `flexGrow: 1` body, and a footer/status line.

### 8.1 Home — selection list

```
╭ DirSelect ────────────────────────────────────────────────╮
│ selections                                                 │
│                                                            │
│   ▸ work            3 directories                          │
│     media           1 directory                            │
│     scratch         0 directories                          │
│                                                            │
│ ┌ work ──────────────────────────────────────────────────┐ │
│ │ ~/projects                                             │ │
│ │ ~/notes                                                │ │
│ └────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────┤
│ roots: ~  /srv/data    Enter open  n new  r rename  d del  │
╰────────────────────────────────────────────────────────────╯
```

- Left: `SelectRenderable` of `{ name, description: "<n> directories" }`.
- Right/preview: on `SELECTION_CHANGED`, show the highlighted preset's `~`
  shortened paths in a bordered box. Zero-click verification of a name.
- The roots line shows exactly which roots this session will display.

### 8.2 Explorer

```
╭ work ──────────────────────────────────────────────────────╮
│ [ ] ~/projects                                             │
│   [x] ~/projects/app                                       │
│     [-] ~/projects/app/src                                 │
│     [ ] ~/projects/app/docs                                │
│   [~] ~/projects/lib                                       │
│     [x] ~/projects/lib/core                                │
│ [ ] /srv/data                                              │
│   ├─ notes/                                                │
│   └─ readme.md                                             │
│   [ ] reports/                                             │
├────────────────────────────────────────────────────────────┤
│ 3 selected · space toggle · ←/→ fold · f files · s save    │
╰────────────────────────────────────────────────────────────╯
```

- Title = current selection name (or `unsaved` for a new selection).
- Body = `ScrollBoxRenderable` containing one row renderable per visible row.
- Footer = live count of explicit selections plus a key hint / status message.

### 8.3 Row rendering

Each row is a `BoxRenderable` (height 1) holding one `TextRenderable`. The row
box's `backgroundColor` is the focus highlight. Content is built from a styled
template:

```ts
import { t, bold, fg } from "@opentui/core"

function rowText(row: Row, theme: Theme): StyledText {
  const { node } = row
  const guides = guidePrefix(row.ancestorLast, row.isLast)
  const box = node.kind === "file"
    ? "   "
    : node.selected ? fg(theme.selected)("[x]")
    : row.implied   ? fg(theme.dim)("[-]")
    : row.partial   ? fg(theme.partial)("[~]")
    :                 fg(theme.check)("[ ]")
  const suffix = node.error ? fg(theme.error)(`  (${node.error})`)
    : node.kind === "dir" ? "/"
    : ""
  const label = node.selected || row.implied
    ? fg(theme.selected)(node.name)
    : row.partial ? fg(theme.partial)(node.name)
    : fg(theme.text)(node.name)
  return t`${fg(theme.guide)(guides)}${box} ${label}${suffix ? fg(theme.dim)(suffix) : ""}`
}

/** ├─ │  └─ guides for the ancestors, then this node. */
function guidePrefix(ancestorLast: boolean[], isLast: boolean): string {
  let s = ""
  for (const last of ancestorLast) s += last ? "   " : "│  "
  return s + (isLast ? "└─ " : "├─ ")
}
```

Rows are pooled by `node.path` and re-ordered with `box.add(el, index)`
(opentui inserts at an index and reparents as needed), so we never rebuild the
whole list for a single checkbox flip:

```ts
// src/ui/explorer.ts (sketch)
class ExplorerView {
  private readonly rowEls = new Map<string, BoxRenderable>()

  render(rows: Row[], cursor: number): void {
    const seen = new Set<string>()
    rows.forEach((row, i) => {
      seen.add(row.node.path)
      let el = this.rowEls.get(row.node.path)
      if (!el) {
        el = new BoxRenderable(this.renderer, { height: 1, flexShrink: 0 })
        el.add(new TextRenderable(this.renderer, { content: "" }))
        this.rowEls.set(row.node.path, el)
      }
      updateRow(el, row, i === cursor)
      this.content.add(el, i)              // idempotent ordering
    })
    for (const [path, el] of this.rowEls) {
      if (!seen.has(path)) { el.destroyRecursively(); this.rowEls.delete(path) }
    }
    const focused = rows[cursor]
    if (focused) this.scroll.scrollChildIntoView(focused.node.path)
  }
}
```

`ScrollBoxRenderable` culls off-screen paint automatically (its
`viewportCulling` default), and `scrollChildIntoView(id)` uses the node path as
the child id, so keyboard navigation keeps the cursor visible without manual
scroll math.

> **Alternative for very large trees.** Render the entire tree into a single
> `TextRenderable` (multi-line content) and translate the cursor row into a
> `scrollTo(y)` call. Fewer renderables, but per-row backgrounds and clipping
> become manual. The per-row pool above is preferred up to a few thousand
> visible rows, which covers normal use.

### 8.4 Modals

`dialogs.ts` provides two centered, absolute-positioned overlays with a high
`zIndex`:

- **prompt** — title, an `InputRenderable`, a hint line. Resolves to a trimmed
  string on `InputRenderableEvents.ENTER`, rejects on `escape`.
- **confirm** — title, message, `[y] yes / [n] no`.

```ts
export function openPrompt(
  renderer: CliRenderer,
  opts: { title: string; initial?: string; placeholder?: string },
): { promise: Promise<string>; close: () => void } {
  const overlay = new BoxRenderable(renderer, {
    position: "absolute", left: 0, top: 0, width: "100%", height: "100%",
    alignItems: "center", justifyContent: "center", zIndex: 100,
  })
  const panel = new BoxRenderable(renderer, {
    width: 48, border: true, borderStyle: "rounded", title: opts.title,
    padding: 1, flexDirection: "column", gap: 1, backgroundColor: theme.panel,
  })
  const input = new InputRenderable(renderer, {
    width: 44, value: opts.initial ?? "", placeholder: opts.placeholder ?? "",
  })
  panel.add(input)
  panel.add(new TextRenderable(renderer, { content: "Enter accept · Esc cancel", fg: theme.dim }))
  overlay.add(panel)
  renderer.root.add(overlay)
  input.focus()
  // ...resolve on ENTER, reject on escape, close() destroys overlay recursively
}
```

While a modal is open it is the single owner of keyboard input
([§10](#10-key-routing)); the underlying screen stays mounted but inert.

---

## 9. Saving and leaving

The save prompt is triggered by **leaving** — either going back from the
explorer to the home list or quitting the app while the explorer is open.

```
        ╭ Save selection ───────────────────────╮
        │ Name: work▏                            │
        │ Enter save · Esc cancel                │
        ╰────────────────────────────────────────╯
```

Flow:

1. Compute `current = canonicalize(explicitSelections)`.
2. **Dirty check**: if `current` deep-equals the loaded preset's original paths
   and the name is unchanged, skip the prompt (or still offer, per
   `--always-save`; default is skip when clean).
3. Show `confirm("Save selection?")`. If *no*, continue leaving (unsaved changes
   are discarded; a copy of the last saved state is retained in memory in case
   the user returns).
4. Show `prompt("Save selection", initial = currentName)`. Empty name is
   rejected. If the name already exists, show a second confirm: *"Overwrite
   'work'?"*.
5. Replace or append the entry in `config.selections`, call `saveConfig`
   (atomic rename), update the in-memory config, and refresh the home list.
6. Continue the leave action.

If the user is **new** (came from "n new"), the name prompt is always shown and
the entry is appended after any existing entries.

---

## 10. Key routing

A single `renderer.keyInput.on("keypress", …)` handler owns dispatch, so
behaviour is deterministic and testable. It runs **before** the focused
renderable (opentui guarantees this), which lets it intercept keys and
`key.stopPropagation()` to keep them from the focused component.

```ts
type Mode = "home" | "explorer" | "modal"

renderer.keyInput.on("keypress", (key: KeyEvent) => {
  // 1. Global quit paths
  if (key.ctrl && key.name === "c") { app.requestQuit(key); return }

  // 2. Modal owns everything except its own escape handling
  if (app.mode === "modal") { app.modal?.onKey(key); return }

  // 3. Mode-specific
  if (app.mode === "home") app.home.onKey(key)
  else app.explorer.onKey(key)
})
```

### Home

| Key | Action |
|---|---|
| `↑`/`k`, `↓`/`j`, `PgUp`/`PgDn`, `Home`/`End` | move in the list (delegated to `SelectRenderable`) |
| `Enter` | open the highlighted selection in the explorer (`SelectRenderableEvents.ITEM_SELECTED`) |
| `n` | new empty selection → explorer |
| `r` | rename highlighted selection (prompt) |
| `d` / `Delete` | delete highlighted selection (confirm) |
| `q` / `Escape` | quit |

### Explorer

| Key | Action |
|---|---|
| `↑`/`k`, `↓`/`j` | move the cursor over visible rows |
| `PgUp`/`PgDn` | move by a viewport |
| `Home`/`End` | jump to first/last row |
| `Space` | toggle checkbox on the focused directory (refused if implied) |
| `Enter` / `←`/`h` / `→`/`l` | collapse / expand the focused directory |
| `f` | toggle *files visible* for the focused directory (opens it if needed) |
| `s` | save now (prompt for name) |
| `q` / `Escape` | leave → save flow (§9) → home |
| `Ctrl+C` | quit app → save flow if dirty |

### Modals

| Key | Action |
|---|---|
| text keys | forwarded to the focused `InputRenderable` |
| `Enter` | submit (input's `ENTER` event) |
| `Escape` | cancel |
| `y`/`n` | confirm/cancel (confirm dialog) |

---

## 11. Application state machine

`app.ts` holds one mutable `AppState` and swaps a mounted `Screen`:

```ts
interface AppState {
  mode: "home" | "explorer" | "modal"
  config: ConfigFile
  roots: string[]
  // explorer
  tree: TreeNode[]              // one per root
  rows: Row[]                   // derived from tree
  cursor: number
  explicit: Set<string>         // canonical selected dirs
  currentName: string | null    // null = new/unsaved
  baseline: string[]            // preset paths as opened (for dirty check)
  loading: boolean
  status?: string
}
```

Transitions:

```
Home ──Enter(name)──▶ Explorer(baseline = config[name].paths)
Home ──n────────────▶ Explorer(baseline = [], currentName = null)
Home ──r────────────▶ Modal(prompt) ──▶ Home
Home ──d────────────▶ Modal(confirm) ──▶ Home
Explorer ──f/s/q────▶ (async load | Modal) ──▶ Explorer | Home
Explorer ──q/Esc/Ctrl+C─▶ Save flow ──▶ Home | exit
```

Key routines:

```ts
// Expand a directory: lazy-load then reveal.
async function expand(node: TreeNode, state: AppState): Promise<void> {
  if (!node.loaded) {
    await loadChildren(node, state.options)   // readdir, sorted, cycle-guarded
  }
  node.expanded = true
  state.rows = buildRows(state.tree)          // pure; recomputes implied/partial
}

// Recompute derived state and re-render. Cheap and uniform: every mutation
// funnels through here.
function afterChange(state: AppState): void {
  state.rows = buildRows(state.tree)
  state.cursor = Math.min(state.cursor, Math.max(0, state.rows.length - 1))
  view.render(state.rows, state.cursor)
  // status: `${state.explicit.size} selected` + transient messages
}
```

`buildRows` is the one function that turns the tree plus explicit selections
into everything the UI needs (visible rows, guides, implied/partial flags). It
is pure and unit-tested:

```ts
export function buildRows(roots: TreeNode[], showFilesDefault: boolean): Row[] {
  const rows: Row[] = []
  const visit = (node: TreeNode, depth: number, ancestorLast: boolean[], implied: boolean): boolean => {
    const row: Row = {
      node, depth, implied, partial: false,
      isLast: ancestorLast[ancestorLast.length - 1] ?? true,
      ancestorLast: ancestorLast.slice(0, -1),
    }
    const idx = rows.push(row) - 1

    let subtreeSelected = node.selected
    if (node.kind === "dir" && node.expanded && node.dirs) {
      const kids = node.showFiles ? [...node.dirs, ...node.files] : node.dirs
      kids.forEach((kid, i) =>
        subtreeSelected = visit(kid, depth + 1, [...ancestorLast, i === kids.length - 1], implied || node.selected) || subtreeSelected,
      )
    }
    rows[idx]!.partial = !node.selected && subtreeSelected
    return subtreeSelected
  }
  roots.forEach((r, i) => visit(r, 0, [i === roots.length - 1], false))
  return rows
}
```

---

## 12. Bootstrap and shutdown

```ts
// src/main.ts
import { createCliRenderer } from "@opentui/core"

async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2))
  const configPath = opts.configPath ?? process.env.DIRSELECT_CONFIG ?? defaultConfigPath()
  const config = await loadConfig(configPath)

  // exitOnCtrlC = false: we intercept Ctrl+C to offer the save prompt.
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: ["SIGTERM", "SIGQUIT", "SIGHUP"],
  })

  const app = new App(renderer, { opts, configPath, config })
  try {
    await app.start()          // mounts Home, waits for quit
  } finally {
    renderer.destroy()
    await renderer.closed      // let terminal restoration flush before exit
  }
}

main().catch((err) => {
  // Renderer may not exist yet; write a plain message and exit non-zero.
  process.stderr.write(`dirselect: ${err?.message ?? err}\n`)
  process.exitCode = 1
})
```

Notes:

- `exitOnCtrlC: false` plus removing `SIGINT` from `exitSignals` means our
  handler decides whether to prompt before quitting. Ctrl+C while dirty still
  runs the save flow.
- The process owns the renderer, so **every** exit path funnels through the
  `finally` block: `renderer.destroy()`, then `await renderer.closed`.
- `app.start()` resolves when the user quits; it never calls
  `renderer.destroy()` itself (`root.unmount` analogue), keeping ownership in
  one place.

---

## 13. Interpreting the prompt

A few requirements can be read two ways. Decisions taken here:

1. **`$HOME` vs CLI roots.** `$HOME` is **always** a root and is rendered
   first; positional ROOT arguments are additional roots shown after it, in the
   order given. The roots line always shows what is in effect.
2. **"Only directories initially … opened to show its files."** Modelled as two
   independent per-directory booleans: `expanded` (shows sub-directories) and
   `showFiles` (also shows files). Initial state: roots expanded, `showFiles`
   false, so only directories appear. `f` opens a directory's files; pressing
   `f` again closes them. A global `--files` starts with files visible.
3. **Selection is an antichain.** Selecting a directory clears explicit
   selection on loaded descendants and blocks future selection below it;
   unselected descendants that get an ancestor selected become `implied`
   (checked but disabled). Deselecting an ancestor does not restore shadowed
   selections.
4. **Preset paths outside the roots.** Skipped, counted, and reported, rather
   than silently dropped or auto-added as roots. Because `$HOME` is always a
   root, presets under the home directory are always visible; others need a
   matching CLI root.
5. **Missing paths.** Preserved and shown with an error marker; not silently
   pruned (only a save can drop them, and only because they can't be
   re-checked).
6. **Hidden entries and symlinked directories.** Hidden by default
   (`--hidden`); symlinked dirs not followed by default (`--follow-symlinks`,
   cycle-guarded).
7. **Config format.** Versioned JSON at the XDG path, ordered list of
   `{ name, paths }`.

---

## 14. Error handling and edge cases

| Situation | Behaviour |
|---|---|
| `readdir` EACCES/ENOENT mid-tree | node gets `error`; row shows `(message)`; node cannot expand; the rest of the tree still works |
| Root does not exist | rendered as an error root; other roots unaffected |
| Config file corrupt | start with empty list + status warning; do not overwrite until the user saves |
| Duplicate preset names in config | last wins on load; warned |
| Preset contains ancestor+descendant | reduced by `canonicalize` on load |
| Name prompt empty | rejected with an inline hint |
| Overwrite existing name | second confirm |
| Terminal too small | opentui clips; keep the header/footer to one line each so the body shrinks gracefully |
| Symlink cycle (with `--follow-symlinks`) | ancestor set per path prevents revisiting |
| Very large directory | lazy load; `ScrollBox` culls paint; cursor changes rebuild only derived rows |

---

## 15. Testing

Pure logic is tested without a terminal:

- `selection.test.ts` — `canonicalize` (prefix/edge cases like `/a-b` vs
  `/a/b`), `toggle` (implied refusal, descendant clearing), `diff`.
- `tree.test.ts` — `buildRows` over a fixture tree: guides, `implied`
  propagation, `partial` marking, `showFiles` toggling.
- `config.test.ts` — `normalizeConfig` on malformed input; atomic save (write,
  re-read, round-trip).

UI/behaviour uses opentui's in-memory renderer:

```ts
import { createTestRenderer } from "@opentui/core"

const { renderer, mockInput } = await createTestRenderer({ width: 80, height: 24 })
const app = new App(renderer, { opts, configPath, config })
await app.start()
await mockInput.pressKey("n")            // new selection
await mockInput.pressKey("down")
await mockInput.pressKey("space")        // toggle a checkbox
expect(app.state.explicit.size).toBe(1)
```

Assertions can target `app.state.rows` / `app.state.explicit` (data) and, where
useful, a rendered snapshot.

---

## 16. Milestones

1. **M1 — skeleton.** Renderer, root layout, key router, quit/shutdown, plain
   text. Verify terminal restoration via `await renderer.closed`.
2. **M2 — config + home.** Load/save config, `SelectRenderable` list, preview
   pane, rename/delete modals.
3. **M3 — tree.** Lazy loading, expand/collapse, files toggle, guides,
   `ScrollBox`, cursor + `scrollChildIntoView`.
4. **M4 — selection.** Checkboxes, implied/partial, antichain invariants.
5. **M5 — preset open + save.** Expand-to-path, dirty tracking, save prompt,
   atomic write, home refresh.
6. **M6 — polish.** Hidden/symlink flags, error rows, status messages,
   unit tests, `--help`.

---

## Appendix A — opentui API used (v0.6.6)

| Need | API |
|---|---|
| Terminal app | `createCliRenderer({ exitOnCtrlC, exitSignals })`, `renderer.root`, `renderer.destroy()`, `await renderer.closed`, `renderer.idle()` |
| Layout/paint | `BoxRenderable` (`width`, `height`, `flexDirection`, `flexGrow`, `padding`, `gap`, `border`, `borderStyle`, `title`, `backgroundColor`, `zIndex`, `position`, `onMouseDown`) |
| Text | `TextRenderable` (`content`, `fg`), styled templates `t`, `bold`, `fg` |
| Input | `InputRenderable` (`value`, `placeholder`, `focus()`), `InputRenderableEvents.{CHANGE,ENTER,INPUT}` |
| Selection list | `SelectRenderable` (`options`, `selectedIndex`, `moveUp/moveDown`, `getSelectedOption`), `SelectRenderableEvents.{ITEM_SELECTED,SELECTION_CHANGED}` |
| Scrolling | `ScrollBoxRenderable` (`scrollChildIntoView(id)`, `scrollTo`, `scrollBy`, `viewportCulling`, `stickyScroll`) |
| Keyboard | `renderer.keyInput.on("keypress", (key: KeyEvent) => …)`, `key.{name,ctrl,shift,meta,sequence}`, `key.stopPropagation()`, `key.preventDefault()` |
| Tests | `createTestRenderer()` → `{ renderer, mockInput }` |

## Appendix B — sample config and session

```json
{
  "version": 1,
  "selections": [
    { "name": "work",  "paths": ["/home/alice/projects", "/home/alice/notes"] },
    { "name": "media", "paths": ["/srv/media/photos"] }
  ]
}
```

```bash
# $HOME is the only root
dirselect

# $HOME plus two more roots; files visible, dotfiles shown
dirselect --files --hidden ~/projects /srv/data

# custom config; roots are $HOME and /srv/data
dirselect --config ~/.config/dirselect/work.json /srv/data
```
