import {
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  fg,
  t,
  type CliRenderer,
  type StyledText,
  type TextChunk,
} from "@opentui/core"
import { guidePrefix, type Row } from "../tree"
import type { Theme } from "./theme"

/** Checkbox glyph for a row, styled by its derived state. */
function checkbox(row: Row, theme: Theme): TextChunk | string {
  const { node } = row
  if (node.kind === "file") return "   "
  if (node.error) return fg(theme.error)("[!]")
  if (row.implied) return fg(theme.dim)("[-]")
  if (row.selected) return fg(theme.selected)("[x]")
  if (row.partial) return fg(theme.partial)("[~]")
  return fg(theme.check)("[ ]")
}

/**
 * Styled content for one row: guides, checkbox, name, and an optional error
 * suffix. Roots have no guides; every other row indents by its ancestry.
 */
export function rowText(row: Row, theme: Theme, focused: boolean): StyledText {
  const { node } = row
  const guides = node.depth === 0 ? "" : guidePrefix(row.ancestorLast, row.isLast)
  const suffix = node.error
    ? fg(theme.error)(`  (${node.error})`)
    : node.kind === "dir"
      ? fg(theme.dim)("/")
      : ""
  const labelColor = focused
    ? theme.selectionFg
    : row.selected || row.implied
      ? theme.selected
      : row.partial
        ? theme.partial
        : theme.text
  return t`${fg(theme.guide)(guides)}${checkbox(row, theme)} ${fg(labelColor)(node.name)}${suffix}`
}

interface RowMeta {
  el: BoxRenderable
  text: TextRenderable
  signature: string
  focused: boolean
}

/**
 * Explorer view: a `ScrollBoxRenderable` of pooled one-line rows, keyed by
 * node path. Rows are only re-ordered when the visible set changes, and only
 * repainted when their rendered content actually differs.
 */
export class ExplorerScreen {
  readonly el: ScrollBoxRenderable
  private readonly rowMeta = new Map<string, RowMeta>()
  private structureKey = ""

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
  }

  /** Drop every pooled row; call before opening a fresh session. */
  reset(): void {
    for (const child of [...this.el.content.getChildren()]) this.el.content.remove(child)
    for (const meta of this.rowMeta.values()) meta.el.destroyRecursively()
    this.rowMeta.clear()
    this.structureKey = ""
  }

  render(rows: readonly Row[], cursor: number): void {
    const key = rows.map((r) => r.node.path).join("\u0000")
    if (key !== this.structureKey) {
      this.structureKey = key
      for (const child of [...this.el.content.getChildren()]) this.el.content.remove(child)
      const live = new Set<string>()
      for (const row of rows) {
        live.add(row.node.path)
        this.el.content.add(this.getMeta(row.node.path).el)
      }
      for (const [path, meta] of this.rowMeta) {
        if (live.has(path)) continue
        meta.el.destroyRecursively()
        this.rowMeta.delete(path)
      }
    }

    rows.forEach((row, i) => this.updateRow(row, i === cursor))

    const focused = rows[cursor]
    if (focused) this.el.scrollChildIntoView(focused.node.path)
    else this.el.scrollTo(0)
    this.renderer.requestRender()
  }

  /** Rows visible at once, minus one line of context. */
  pageSize(): number {
    const height = typeof this.el.viewport.height === "number" ? this.el.viewport.height : 10
    return Math.max(1, height - 1)
  }

  private getMeta(path: string): RowMeta {
    const existing = this.rowMeta.get(path)
    if (existing) return existing
    const el = new BoxRenderable(this.renderer, {
      id: path,
      height: 1,
      flexShrink: 0,
      width: "100%",
      backgroundColor: "transparent",
    })
    const text = new TextRenderable(this.renderer, { content: "", width: "100%", truncate: true })
    el.add(text)
    const meta: RowMeta = { el, text, signature: "", focused: false }
    this.rowMeta.set(path, meta)
    return meta
  }

  private updateRow(row: Row, focused: boolean): void {
    const meta = this.getMeta(row.node.path)
    const signature = [
      row.selected ? "s" : "-",
      row.implied ? "i" : "-",
      row.partial ? "p" : "-",
      row.node.error ?? "",
      row.ancestorLast.map((b) => (b ? "1" : "0")).join(""),
      row.isLast ? "1" : "0",
      row.node.name,
      row.node.kind,
    ].join("|")

    if (meta.signature !== signature || meta.focused !== focused) {
      meta.text.content = rowText(row, this.theme, focused)
      meta.el.backgroundColor = focused ? this.theme.selectionBg : "transparent"
      meta.signature = signature
      meta.focused = focused
    }
  }
}
