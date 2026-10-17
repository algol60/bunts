import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  fg,
  t,
  type CliRenderer,
  type KeyEvent,
  type StyledText,
} from "@opentui/core"
import type { Selection } from "../config"
import { displayPath } from "../paths"
import type { Theme } from "./theme"

/** Directories are nested under their selection name by this many columns. */
const INDENT = "    "

/**
 * Home screen: the saved selections, each rendered as its name followed by its
 * directories (one per line). The cursor moves between **selections**, not the
 * individual directory lines, and the focused selection is kept scrolled into
 * view. `ScrollBoxRenderable` is driven programmatically (`focusable = false`)
 * so the app owns key routing.
 */
export class HomeScreen {
  readonly el: ScrollBoxRenderable
  private selections: Selection[] = []
  private cursor = 0

  constructor(
    private readonly renderer: CliRenderer,
    private readonly theme: Theme,
  ) {
    this.el = new ScrollBoxRenderable(renderer, {
      flexGrow: 1,
      width: "100%",
      scrollX: false,
      scrollY: true,
      viewportCulling: true,
      backgroundColor: "transparent",
    })
    this.el.focusable = false
    this.el.content.flexDirection = "column"
    this.render()
  }

  /** Replace the list, keeping the cursor on the same selection when possible. */
  setSelections(selections: readonly Selection[], focusName?: string): void {
    const previousName = focusName ?? this.current()?.name
    this.selections = selections.map((s) => ({ name: s.name, paths: [...s.paths] }))

    const index = previousName ? this.selections.findIndex((s) => s.name === previousName) : 0
    this.cursor = index >= 0 ? index : 0
    this.render()
  }

  current(): Selection | undefined {
    return this.selections[this.cursor]
  }

  isEmpty(): boolean {
    return this.selections.length === 0
  }

  onKey(key: KeyEvent): void {
    switch (key.name) {
      case "down":
      case "j":
        this.setCursor(this.cursor + 1)
        return
      case "up":
      case "k":
        this.setCursor(this.cursor - 1)
        return
      case "pagedown":
        this.setCursor(this.cursor + this.pageStep())
        return
      case "pageup":
        this.setCursor(this.cursor - this.pageStep())
        return
      case "home":
        this.setCursor(0)
        return
      case "end":
        this.setCursor(this.selections.length - 1)
        return
    }
  }

  private setCursor(index: number): void {
    const next = Math.max(0, Math.min(this.selections.length - 1, index))
    if (next === this.cursor) return
    this.cursor = next
    this.render()
  }

  private pageStep(): number {
    const height = typeof this.el.viewport.height === "number" ? this.el.viewport.height : 10
    return Math.max(1, height - 1)
  }

  /** Tear down every rendered line before rebuilding the list. */
  private clear(): void {
    const children = [...this.el.content.getChildren()]
    for (const child of children) this.el.content.remove(child)
    for (const child of children) child.destroyRecursively()
  }

  private render(): void {
    this.clear()

    if (this.selections.length === 0) {
      this.el.content.add(
        this.line(t`${fg(this.theme.dim)("No selections yet — press n to create one.")}`),
      )
    } else {
      this.selections.forEach((selection, index) => {
        this.el.content.add(this.buildGroup(selection, index === this.cursor))
      })
    }

    const current = this.selections[this.cursor]
    if (current) this.el.scrollChildIntoView(groupId(current.name))
    else this.el.scrollTo(0)
    this.renderer.requestRender()
  }

  /** One selection: a highlighted name line, then its directories beneath it. */
  private buildGroup(selection: Selection, focused: boolean): BoxRenderable {
    const group = new BoxRenderable(this.renderer, {
      id: groupId(selection.name),
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: "transparent",
    })

    const marker = focused ? "▸ " : "  "
    const nameColor = focused ? this.theme.selectionFg : this.theme.text
    const header = this.line(t`${fg(nameColor)(marker + selection.name)}`)
    if (focused) header.bg = this.theme.selectionBg
    group.add(header)

    if (selection.paths.length === 0) {
      group.add(this.line(t`${fg(this.theme.dim)(`${INDENT}(no directories)`)}`))
    } else {
      for (const path of selection.paths) {
        group.add(this.line(t`${fg(this.theme.dim)(INDENT + displayPath(path))}`))
      }
    }

    return group
  }

  private line(content: StyledText): TextRenderable {
    return new TextRenderable(this.renderer, {
      content,
      width: "100%",
      height: 1,
      truncate: true,
    })
  }
}

function groupId(name: string): string {
  return `selection:${name}`
}
