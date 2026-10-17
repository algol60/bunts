import {
  BoxRenderable,
  InputRenderable,
  TextRenderable,
  fg,
  t,
  type CliRenderer,
  type KeyEvent,
} from "@opentui/core"
import type { Theme } from "./theme"

export type PromptResult = { ok: true; value: string } | { ok: false }
export type ConfirmResult = { ok: true } | { ok: false }

/**
 * A centered overlay that owns keyboard input while open. The promise never
 * rejects: cancellation resolves to a `{ ok: false }` result.
 */
export interface Modal<T> {
  readonly el: BoxRenderable
  onKey(key: KeyEvent): void
  /** Resolve as cancelled and tear down (used by the app on Ctrl+C). */
  cancel(): void
  close(): void
  readonly result: Promise<T>
}

interface OverlayParts {
  overlay: BoxRenderable
  panel: BoxRenderable
}

function createOverlay(
  renderer: CliRenderer,
  theme: Theme,
  title: string,
  width: number,
): OverlayParts {
  const overlay = new BoxRenderable(renderer, {
    position: "absolute",
    left: 0,
    top: 0,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
    backgroundColor: theme.bg,
  })
  const panel = new BoxRenderable(renderer, {
    width,
    flexDirection: "column",
    gap: 1,
    border: true,
    borderStyle: "rounded",
    borderColor: theme.accent,
    title,
    titleColor: theme.accent,
    padding: 1,
    backgroundColor: theme.panel,
  })
  overlay.add(panel)
  return { overlay, panel }
}

function panelWidth(renderer: CliRenderer, max = 60): number {
  const width = typeof renderer.width === "number" ? renderer.width : 80
  return Math.max(24, Math.min(max, width - 8))
}

export function openPrompt(
  renderer: CliRenderer,
  theme: Theme,
  opts: { title: string; initial?: string; placeholder?: string; hint?: string; error?: string },
): Modal<PromptResult> {
  const { overlay, panel } = createOverlay(renderer, theme, opts.title, panelWidth(renderer))

  const input = new InputRenderable(renderer, {
    width: "100%",
    value: opts.initial ?? "",
    placeholder: opts.placeholder ?? "",
  })
  panel.add(input)
  panel.add(
    new TextRenderable(renderer, {
      content: opts.error
        ? t`${fg(theme.error)(opts.error)}`
        : t`${fg(theme.dim)(opts.hint ?? "Enter accept · Esc cancel")}`,
      truncate: true,
    }),
  )

  let settle!: (result: PromptResult) => void
  const result = new Promise<PromptResult>((resolve) => {
    settle = resolve
  })
  let done = false

  const close = (): void => {
    if (done) return
    done = true
    overlay.destroyRecursively()
  }
  const finish = (value: PromptResult): void => {
    if (done) return
    close()
    settle(value)
  }

  const modal: Modal<PromptResult> = {
    el: overlay,
    result,
    close,
    cancel: () => finish({ ok: false }),
    onKey: (key: KeyEvent) => {
      if (key.name === "escape") {
        key.stopPropagation()
        finish({ ok: false })
        return
      }
      if (key.name === "return") {
        key.stopPropagation()
        finish({ ok: true, value: input.value })
        return
      }
      // Everything else falls through to the focused InputRenderable.
    },
  }

  overlay.add(panel)
  input.focus()
  return modal
}

export function openConfirm(
  renderer: CliRenderer,
  theme: Theme,
  opts: { title: string; message: string; hint?: string },
): Modal<ConfirmResult> {
  const { overlay, panel } = createOverlay(renderer, theme, opts.title, panelWidth(renderer, 52))

  panel.add(
    new TextRenderable(renderer, {
      content: t`${fg(theme.text)(opts.message)}`,
      width: "100%",
      truncate: false,
    }),
  )
  panel.add(
    new TextRenderable(renderer, {
      content: t`${fg(theme.dim)(opts.hint ?? "[y] yes · [n] no · Esc cancel")}`,
      truncate: true,
    }),
  )

  let settle!: (result: ConfirmResult) => void
  const result = new Promise<ConfirmResult>((resolve) => {
    settle = resolve
  })
  let done = false

  const close = (): void => {
    if (done) return
    done = true
    overlay.destroyRecursively()
  }
  const finish = (value: ConfirmResult): void => {
    if (done) return
    close()
    settle(value)
  }

  return {
    el: overlay,
    result,
    close,
    cancel: () => finish({ ok: false }),
    onKey: (key: KeyEvent) => {
      key.stopPropagation()
      if (key.name === "y" || key.name === "return") finish({ ok: true })
      else if (key.name === "n" || key.name === "escape") finish({ ok: false })
    },
  }
}
