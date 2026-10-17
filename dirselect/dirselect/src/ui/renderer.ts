import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core"
import type { Theme } from "./theme"

export interface Layout {
  header: BoxRenderable
  headerText: TextRenderable
  body: BoxRenderable
  footer: BoxRenderable
  footerText: TextRenderable
}

/**
 * Root layout: a one-line header, the bordered body (whose title names the
 * current screen), and a one-line footer. Keeping both bars to a single line
 * means the body shrinks gracefully in small terminals.
 */
export function createLayout(renderer: CliRenderer, theme: Theme): Layout {
  const root = renderer.root
  root.flexDirection = "column"
  root.width = "100%"
  root.height = "100%"

  const header = new BoxRenderable(renderer, {
    height: 1,
    flexShrink: 0,
    paddingX: 1,
    backgroundColor: theme.headerBg,
  })
  const headerText = new TextRenderable(renderer, { content: "", truncate: true, width: "100%" })
  header.add(headerText)

  const body = new BoxRenderable(renderer, {
    flexGrow: 1,
    flexDirection: "column",
    border: true,
    borderStyle: "rounded",
    borderColor: theme.border,
    titleColor: theme.accent,
    paddingX: 1,
    backgroundColor: "transparent",
  })

  const footer = new BoxRenderable(renderer, {
    height: 1,
    flexShrink: 0,
    paddingX: 1,
    backgroundColor: theme.footerBg,
  })
  const footerText = new TextRenderable(renderer, { content: "", truncate: true, width: "100%" })
  footer.add(footerText)

  root.add(header)
  root.add(body)
  root.add(footer)

  return { header, headerText, body, footer, footerText }
}
