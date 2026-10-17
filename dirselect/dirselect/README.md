# DirSelect

A terminal UI for keeping **named sets of directories**. Run it, pick a saved
name, and the explorer opens with that set's directories already checked — tweak
what you want, then save the result under a name.

Built with TypeScript on [Bun](https://bun.sh) using
[`@opentui/core`](https://github.com/sst/opentui) `0.6.6`.

## Requirements

- Bun 1.4+ (`bun --version`)
- A terminal. The TUI renders with the alternate screen buffer; Ctrl+C and `q`
  both exit cleanly.

## Running

```sh
bun install          # once
bun start            # or: bun run src/main.ts
```

Roots are the directories shown at the top of the tree. `$HOME` is **always** a
root; any positional arguments are shown in addition to it, in the order given.

```sh
dirselect                       # just $HOME
dirselect ~/code ~/work         # $HOME, then ~/code, then ~/work
dirselect --files ~/projects    # start with files visible
```

| Option | Effect |
| --- | --- |
| `--config <path>` | config file to use (default: `$XDG_CONFIG_HOME/dirselect/config.json`) |
| `--files` | start with files visible (default: directories only) |
| `--hidden` | show dotfiles and dot-directories |
| `--follow-symlinks` | follow symlinked directories (cycle-guarded) |
| `-h`, `--help` | show help |
| `-v`, `--version` | show the version |

## Keys

### Home screen (list of saved selections)

Each selection is shown as its name with its saved directories listed beneath it,
one per line. The cursor moves between selections (the directories are not
individually focusable); `Enter` opens the highlighted one.

| Key | Action |
| --- | --- |
| `↓` / `j`, `↑` / `k` | move the cursor |
| `PageUp` / `PageDown` | move a page |
| `Home` / `End` | jump to first / last |
| `Enter` | open the highlighted selection in the explorer, pre-checked |
| `n` | new selection (explorer opens with nothing checked) |
| `r` | rename the highlighted selection |
| `d` / `Delete` | delete the highlighted selection (confirmation) |
| `q` / `Esc` | quit |

### Explorer

| Key | Action |
| --- | --- |
| `↓` / `j`, `↑` / `k` | move the cursor |
| `PageUp` / `PageDown`, `Home` / `End` | paging and jumps |
| `Space` | toggle the checkbox on the focused directory |
| `Enter` | fold/unfold the focused directory |
| `→` / `l` | expand |
| `←` / `h` | collapse |
| `f` | toggle showing files for the focused directory |
| `s` | save now (prompts for a name; `Esc` cancels) |
| `q` / `Esc` | leave the explorer (offers to save when there are changes) |

The footer shows the current count of explicitly selected directories and any
status message (e.g. `saved 'work'`, `cannot select: …`).

## Selection semantics

- Every directory row has a checkbox. `Space` toggles the **explicit** set.
- **A selected directory forbids selecting anything below it.** Trying to check
  a descendant of a checked directory is rejected with
  `cannot select: ~/… is selected`.
- Conversely, checking a directory **clears all of its descendants** from the
  explicit set — an ancestor means "everything under here", so keeping child
  entries would be redundant.
- A row whose ancestor is selected shows as **checked but disabled** (implied),
  and a collapsed directory containing a checked descendant shows as **partial**.
  Both are derived live from the explicit set, so they remain correct for
  sub-trees that have not been loaded yet.
- When leaving the explorer, if the checked set differs from what was loaded
  from the saved selection, you are asked `Unsaved changes — Save selection?`
  before returning home or quitting.

## Config file

Default location: `$XDG_CONFIG_HOME/dirselect/config.json` (falling back to
`~/.config/dirselect/config.json`). Writes are atomic (temp file + rename). If
the file is missing it is treated as an empty config; if it exists but is
malformed, DirSelect reports the problem instead of overwriting it. Entries are
de-duplicated by name, and paths are canonicalized (absolute, normalized, no
trailing slash).

```json
{
  "version": 1,
  "selections": [
    { "name": "work", "paths": ["/home/me/work/api", "/home/me/work/web"] },
    { "name": "dotfiles", "paths": ["/home/me/.config"] }
  ]
}
```

## Development

```sh
bun test              # 70 tests across tree/selection/config/cli/app
bun run typecheck     # bunx tsc --noEmit
```

### Layout

```
src/
  main.ts        bootstrap: parse CLI, load config, start renderer + app
  cli.ts         argument parsing + help text
  config.ts      load/normalize/save the config file
  paths.ts       path canonicalization, `~` display, descendant checks
  selection.ts   explicit-set operations (toggle, canonicalize, diff)
  tree.ts        lazy directory tree: loadChildren, buildRows, revealPath
  app.ts         state machine, key routing, save/leave flow, modals
  ui/
    renderer.ts  layout (header/body/footer)
    home.ts      home screen (selection list with directories)
    explorer.ts  pooled tree rows, guides, checkboxes
    dialogs.ts   prompt / confirm modals
    theme.ts     colors
test/
  *.test.ts      unit + end-to-end tests (in-memory opentui renderer)
  fixture.ts     throwaway directory tree
  harness.ts     startApp() and key helpers
```

## Notable decisions

These differ slightly from the original design doc, deliberately:

- **Home menu shows directories, not counts.** Each selection lists its saved
  directories one per line instead of an `<n> directories` label, with no
  separate preview pane.
- **Single source of truth.** Selection state is one `Set<string>` of explicit
  absolute paths. Implied/partial checks and the dirty comparison are all
  derived from it — there is no per-node `selected` flag to keep in sync.
- **`toggle()` clears descendants.** Toggling a directory on removes every
  descendant from the set; there is no separate `descendants` argument.
- **Baseline = paths that actually loaded.** Opening a saved selection whose
  paths are missing or outside the roots does not immediately show as dirty.
- **Symlinks are skipped** unless `--follow-symlinks` is given, in which case a
  symlink that resolves onto one of its own ancestors is flagged as
  `symlink cycle` rather than recursed into.
- **`revealPath` expands the target itself** (not just its ancestors), so the
  contents of a revealed directory are visible immediately.
- **Async actions are serialized** behind a `busy` flag so rapid keypresses
  cannot interleave a load/expand with the change that depends on it.
- **`--always-save` is not implemented.**

A project-local `bunfig.toml` pins `registry = "https://registry.npmjs.org/"`
so installs do not depend on any machine-level Bun registry configuration.
