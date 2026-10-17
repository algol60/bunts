import {
  bold,
  fg,
  t,
  type CliRenderer,
  type KeyEvent,
  type Renderable,
  type StyledText,
} from "@opentui/core"
import type { CliOptions } from "./cli"
import {
  findSelection,
  removeSelection,
  saveConfig,
  upsertSelection,
  type ConfigFile,
  type Selection,
} from "./config"
import { displayPath, isDescendantOf } from "./paths"
import { canonicalize, diff, samePaths, selectedAncestor, toggle } from "./selection"
import {
  buildRows,
  createRoot,
  loadChildren,
  revealPath,
  type Row,
  type TreeOptions,
  type TreeNode,
} from "./tree"
import { openConfirm, openPrompt, type Modal } from "./ui/dialogs"
import { ExplorerScreen } from "./ui/explorer"
import { HomeScreen } from "./ui/home"
import { createLayout, type Layout } from "./ui/renderer"
import { theme } from "./ui/theme"

export type Mode = "home" | "explorer" | "modal"

export interface ExplorerState {
  tree: TreeNode[]
  rows: Row[]
  cursor: number
  explicit: Set<string>
  /** `null` means a new, not-yet-named selection. */
  currentName: string | null
  /** Paths as loaded, for the dirty check. */
  baseline: string[]
}

export interface AppDeps {
  opts: CliOptions
  configPath: string
  config: ConfigFile
  warning?: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cloneConfig(config: ConfigFile): ConfigFile {
  return { version: 1, selections: config.selections.map((s) => ({ name: s.name, paths: [...s.paths] })) }
}

function describeChanges(current: readonly string[], baseline: readonly string[]): string {
  const { added, removed } = diff(baseline, current)
  const bits: string[] = []
  if (added.length > 0) bits.push(`+${added.length}`)
  if (removed.length > 0) bits.push(`-${removed.length}`)
  return bits.length > 0 ? `Save selection? (${bits.join(" ")})` : "Save selection?"
}

/**
 * Owns the single mutable application state, mounts one screen at a time, and
 * dispatches every keypress from one place.
 */
export class App {
  readonly home: HomeScreen
  readonly explorerView: ExplorerScreen

  private readonly layout: Layout
  private mode: Mode = "home"
  private config: ConfigFile
  private explorerState: ExplorerState | null = null
  private modal: Modal<unknown> | null = null
  private status: string | undefined
  private quitResolve: (() => void) | null = null
  /** True while an async explorer action is in flight, to keep key handling ordered. */
  private busy = false

  constructor(
    private readonly renderer: CliRenderer,
    private readonly deps: AppDeps,
  ) {
    this.config = deps.config
    this.layout = createLayout(renderer, theme)
    this.home = new HomeScreen(renderer, theme)
    this.explorerView = new ExplorerScreen(renderer, theme)
  }

  get currentMode(): Mode {
    return this.mode
  }

  get explorer(): ExplorerState | null {
    return this.explorerState
  }

  get configFile(): ConfigFile {
    return this.config
  }

  /** Mount the home screen and resolve when the user quits. */
  async start(): Promise<void> {
    const quit = new Promise<void>((resolve) => {
      this.quitResolve = resolve
    })
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => this.handleKey(key))
    this.mount(this.home.el)
    this.mode = "home"
    this.home.setSelections(this.config.selections)
    this.renderChrome()
    if (this.deps.warning) this.setStatus(this.deps.warning)
    await quit
  }

  // --- key routing ---------------------------------------------------------

  private handleKey(key: KeyEvent): void {
    if (key.ctrl && key.name === "c") {
      key.stopPropagation()
      this.requestQuit()
      return
    }
    if (this.mode === "modal") {
      this.modal?.onKey(key)
      return
    }

    if (this.status !== undefined) {
      this.status = undefined
      this.renderChrome()
    }

    if (this.mode === "home") {
      this.home.onKey(key)
      this.handleHomeKey(key)
    } else {
      this.handleExplorerKey(key)
    }

    // A key that opened a modal must not also reach the modal's input.
    if (this.modal !== null) key.stopPropagation()
  }

  private handleHomeKey(key: KeyEvent): void {
    switch (key.name) {
      case "return": {
        const selection = this.home.current()
        if (selection) void this.openSelection(selection.name, selection.paths)
        return
      }
      case "n":
        void this.openSelection(null, [])
        return
      case "r": {
        const selection = this.home.current()
        if (selection) void this.renameSelection(selection)
        return
      }
      case "d":
      case "delete": {
        const selection = this.home.current()
        if (selection) void this.deleteSelection(selection)
        return
      }
      case "q":
      case "escape":
        this.finishQuit()
        return
    }
  }

  private handleExplorerKey(key: KeyEvent): void {
    switch (key.name) {
      case "down":
      case "j":
        this.moveCursor(1)
        return
      case "up":
      case "k":
        this.moveCursor(-1)
        return
      case "pagedown":
        this.moveCursor(this.explorerView.pageSize())
        return
      case "pageup":
        this.moveCursor(-this.explorerView.pageSize())
        return
      case "home":
        this.setCursor(0)
        return
      case "end":
        this.setCursor(this.explorerState ? this.explorerState.rows.length - 1 : 0)
        return
      case "space":
        this.toggleFocused()
        return
      case "return":
        this.runExclusive(() => this.setExpanded(null))
        return
      case "left":
      case "h":
        this.runExclusive(() => this.setExpanded(false))
        return
      case "right":
      case "l":
        this.runExclusive(() => this.setExpanded(true))
        return
      case "f":
        this.runExclusive(() => this.toggleFiles())
        return
      case "s":
        void this.saveNow()
        return
      case "q":
      case "escape":
        void this.leaveExplorer("home")
        return
    }
  }

  private requestQuit(): void {
    if (this.mode === "modal") {
      this.modal?.cancel()
      return
    }
    if (this.mode === "explorer" && this.explorerState) {
      void this.leaveExplorer("quit")
      return
    }
    this.finishQuit()
  }

  private finishQuit(): void {
    this.quitResolve?.()
  }

  // --- screens -------------------------------------------------------------

  private mount(el: Renderable): void {
    for (const child of [...this.layout.body.getChildren()]) this.layout.body.remove(child)
    this.layout.body.add(el)
  }

  private showHome(): void {
    const keep = this.home.current()?.name
    this.explorerState = null
    this.mode = "home"
    this.mount(this.home.el)
    this.home.setSelections(this.config.selections, keep)
    this.renderChrome()
  }

  private async openSelection(name: string | null, paths: readonly string[]): Promise<void> {
    const opts = this.treeOptions()
    const roots = this.deps.opts.roots.map((root) => createRoot(root, displayPath(root), opts))
    const state: ExplorerState = {
      tree: roots,
      rows: [],
      cursor: 0,
      explicit: new Set<string>(),
      currentName: name,
      baseline: [],
    }
    this.explorerState = state

    this.explorerView.reset()
    this.mount(this.explorerView.el)
    this.mode = "explorer"
    this.setStatus("loading…")

    await Promise.all(roots.map((root) => loadChildren(root, opts)))

    const targets = canonicalize(paths)
    const kept: string[] = []
    let outside = 0
    let missing = 0

    for (const target of targets) {
      const root = roots.find((r) => target === r.path || isDescendantOf(target, r.path))
      if (!root) {
        outside++
        continue
      }
      const node = await revealPath(root, target, opts)
      if (node.error) {
        missing++
        continue
      }
      state.explicit.add(target)
      kept.push(target)
    }
    // Baseline is what actually loaded, so opening a preset with paths that are
    // gone or outside the roots does not by itself mark the session dirty.
    state.baseline = canonicalize(kept)

    this.afterChange()

    const first = kept[0]
    if (first) {
      const index = state.rows.findIndex((row) => row.node.path === first)
      if (index >= 0) {
        state.cursor = index
        this.explorerView.render(state.rows, state.cursor)
      }
    }

    const notes: string[] = []
    if (outside > 0) notes.push(`${outside} saved path${outside === 1 ? "" : "s"} outside the roots`)
    if (missing > 0) notes.push(`${missing} missing path${missing === 1 ? "" : "s"}`)
    this.setStatus(notes.length > 0 ? notes.join(" · ") : undefined)
  }

  private afterChange(): void {
    const state = this.explorerState
    if (!state) return
    state.rows = buildRows(state.tree, state.explicit)
    state.cursor = clamp(state.cursor, 0, Math.max(0, state.rows.length - 1))
    this.explorerView.render(state.rows, state.cursor)
    this.renderChrome()
  }

  // --- explorer actions ----------------------------------------------------

  /** Run one async action at a time so rapid keys cannot interleave. */
  private runExclusive(action: () => Promise<void>): void {
    if (this.busy) return
    this.busy = true
    void action().finally(() => {
      this.busy = false
    })
  }

  private moveCursor(delta: number): void {
    const state = this.explorerState
    if (!state) return
    this.setCursor(state.cursor + delta)
  }

  private setCursor(index: number): void {
    const state = this.explorerState
    if (!state) return
    const next = clamp(index, 0, Math.max(0, state.rows.length - 1))
    if (next === state.cursor) return
    state.cursor = next
    this.explorerView.render(state.rows, state.cursor)
  }

  private toggleFocused(): void {
    const state = this.explorerState
    if (!state) return
    const row = state.rows[state.cursor]
    if (!row) return
    const node = row.node
    if (node.kind !== "dir" || node.error) return

    if (toggle(state.explicit, node.path)) {
      this.afterChange()
      return
    }
    const blocker = selectedAncestor(state.explicit, node.path)
    this.setStatus(blocker ? `cannot select: ${displayPath(blocker)} is selected` : "cannot select")
  }

  private async setExpanded(expand: boolean | null): Promise<void> {
    const state = this.explorerState
    if (!state) return
    const row = state.rows[state.cursor]
    if (!row) return
    const node = row.node
    if (node.kind !== "dir" || node.error) return

    const target = expand === null ? !node.expanded : expand
    if (target === node.expanded) return
    if (target && !node.loaded) await loadChildren(node, this.treeOptions())
    node.expanded = target
    this.afterChange()
  }

  private async toggleFiles(): Promise<void> {
    const state = this.explorerState
    if (!state) return
    const row = state.rows[state.cursor]
    if (!row) return
    const node = row.node
    if (node.kind !== "dir" || node.error) return

    if (!node.loaded) await loadChildren(node, this.treeOptions())
    node.expanded = true
    node.showFiles = !node.showFiles
    this.afterChange()
  }

  // --- save / leave --------------------------------------------------------

  private async saveNow(): Promise<void> {
    const state = this.explorerState
    if (!state) return
    const saved = await this.promptAndSave(state)
    if (saved) this.explorerView.render(state.rows, state.cursor)
  }

  private async leaveExplorer(action: "home" | "quit"): Promise<void> {
    const state = this.explorerState
    if (!state) {
      if (action === "quit") this.finishQuit()
      else this.showHome()
      return
    }

    const current = canonicalize([...state.explicit])
    if (!samePaths(current, state.baseline)) {
      const confirm = await this.showModal((renderer) =>
        openConfirm(renderer, theme, {
          title: "Unsaved changes",
          message: describeChanges(current, state.baseline),
        }),
      )
      if (confirm.ok) {
        const saved = await this.promptAndSave(state)
        if (!saved) return // name prompt cancelled: stay in the explorer
      }
    }

    if (action === "quit") this.finishQuit()
    else this.showHome()
  }

  private async promptAndSave(state: ExplorerState): Promise<boolean> {
    let initial = state.currentName ?? ""
    let error: string | undefined
    for (;;) {
      const prompt = await this.showModal((renderer) =>
        openPrompt(renderer, theme, {
          title: state.currentName ? "Save selection" : "Save new selection",
          initial,
          placeholder: "name",
          error,
        }),
      )
      if (!prompt.ok) return false

      const name = prompt.value.trim()
      if (!name) {
        initial = ""
        error = "a name is required"
        continue
      }
      error = undefined

      if (name !== state.currentName && findSelection(this.config, name)) {
        const overwrite = await this.showModal((renderer) =>
          openConfirm(renderer, theme, {
            title: "Name in use",
            message: `A selection named '${name}' already exists. Overwrite it?`,
          }),
        )
        if (!overwrite.ok) {
          initial = name
          continue
        }
      }

      const paths = canonicalize([...state.explicit])
      const next = cloneConfig(this.config)
      upsertSelection(next, name, paths)
      try {
        await saveConfig(this.deps.configPath, next)
      } catch (err) {
        this.setStatus(`could not save: ${(err as Error).message}`)
        return false
      }

      this.config = next
      state.currentName = name
      state.baseline = [...paths]
      this.home.setSelections(this.config.selections, name)
      this.setStatus(`saved '${name}'`)
      return true
    }
  }

  private async renameSelection(selection: Selection): Promise<void> {
    const prompt = await this.showModal((renderer) =>
      openPrompt(renderer, theme, {
        title: "Rename selection",
        initial: selection.name,
        placeholder: "name",
      }),
    )
    if (!prompt.ok) return

    const name = prompt.value.trim()
    if (!name) {
      this.setStatus("name cannot be empty")
      return
    }
    if (name === selection.name) return

    const next = cloneConfig(this.config)
    if (findSelection(next, name)) {
      const overwrite = await this.showModal((renderer) =>
        openConfirm(renderer, theme, {
          title: "Name in use",
          message: `'${name}' already exists. Overwrite it?`,
        }),
      )
      if (!overwrite.ok) return
      removeSelection(next, name)
    }
    const entry = findSelection(next, selection.name)
    if (entry) entry.name = name
    if (await this.persist(next, name)) this.setStatus(`renamed to '${name}'`)
  }

  private async deleteSelection(selection: Selection): Promise<void> {
    const confirm = await this.showModal((renderer) =>
      openConfirm(renderer, theme, {
        title: "Delete selection",
        message: `Delete '${selection.name}'? This cannot be undone.`,
      }),
    )
    if (!confirm.ok) return

    const next = cloneConfig(this.config)
    removeSelection(next, selection.name)
    if (await this.persist(next)) this.setStatus(`deleted '${selection.name}'`)
  }

  private async persist(next: ConfigFile, focusName?: string): Promise<boolean> {
    try {
      await saveConfig(this.deps.configPath, next)
    } catch (err) {
      this.setStatus(`could not save: ${(err as Error).message}`)
      return false
    }
    this.config = next
    this.home.setSelections(this.config.selections, focusName)
    this.renderChrome()
    return true
  }

  // --- modals & chrome -----------------------------------------------------

  private async showModal<T>(open: (renderer: CliRenderer) => Modal<T>): Promise<T> {
    const modal = open(this.renderer)
    this.modal = modal as Modal<unknown>
    this.mode = "modal"
    this.renderer.root.add(modal.el)
    this.renderChrome()

    const result = await modal.result

    this.modal = null
    if (!modal.el.isDestroyed) modal.el.destroyRecursively()
    this.mode = this.explorerState ? "explorer" : "home"
    this.renderChrome()
    return result
  }

  private setStatus(status: string | undefined): void {
    this.status = status
    this.renderChrome()
  }

  private renderChrome(): void {
    const rootsLabel = this.deps.opts.roots.map((root) => displayPath(root)).join("  ")
    this.layout.headerText.content = t`${bold(fg(theme.accent)("DirSelect"))}  ${fg(theme.dim)(
      `roots: ${rootsLabel}`,
    )}`

    this.layout.body.title =
      this.mode === "home" ? "selections" : (this.explorerState?.currentName ?? "unsaved")

    this.layout.footerText.content = this.footerContent()
    this.renderer.requestRender()
  }

  private footerContent(): StyledText {
    const hints =
      this.mode === "home"
        ? "Enter open · n new · r rename · d delete · q quit"
        : "space toggle · Enter/←/→ fold · f files · s save · q back"
    const status = this.status !== undefined ? fg(theme.partial)(`${this.status}  ·  `) : ""
    const count =
      this.mode === "explorer" && this.explorerState
        ? fg(theme.text)(`${this.explorerState.explicit.size} selected  ·  `)
        : ""
    return t`${status}${count}${fg(theme.dim)(hints)}`
  }

  private treeOptions(): TreeOptions {
    return {
      showHidden: this.deps.opts.showHidden,
      followSymlinks: this.deps.opts.followSymlinks,
      showFiles: this.deps.opts.showFiles,
    }
  }
}
