import {
  BoxRenderable,
  ImageRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
} from '@opentui/core'
import {
  HIGHLIGHT_BACKGROUND,
  MARK_FG,
  MARK_SELECTED_FG,
  PANE_BACKGROUND,
  TRANSPARENT_BACKGROUND,
} from './theme'

/**
 * The backdrop, anchored to the pane's bottom-right content corner.
 *
 * The URL is built from import.meta.url rather than a bare path: the library
 * resolves a string source against the process CWD, which is not the source
 * directory whenever cedit is started from elsewhere.
 *
 * The size is in cells, not pixels. A 192x192 source over a cell aspect ratio
 * of 2 fills this 24x12 box exactly, so the corners land on cell boundaries
 * instead of being cut off mid-glyph.
 */
const BACKDROP_SOURCE = new URL('./taylorswift192.png', import.meta.url)
const BACKDROP_WIDTH = 24
const BACKDROP_HEIGHT = 12

/**
 * One list entry. The highlight is painted by the row box rather than the text,
 * because a TextRenderable is only as wide as its own glyphs - tinting the text
 * would leave the highlight hugging the label instead of spanning the pane.
 *
 * selected and highlighted are tracked separately: the selected mark is always
 * flagged with '> ' and a distinct colour so you can still tell which one you
 * are editing, but the background highlight is only painted while this pane is
 * the active one.
 */
interface MarkRow {
  box: BoxRenderable
  text: TextRenderable
  selected: boolean
  highlighted: boolean
}

export class MarksList {
  renderer: CliRenderer
  container: BoxRenderable
  backdrop: ImageRenderable
  scrollBox: ScrollBoxRenderable
  private rows: MarkRow[] = []
  private lastSelected: number = -1

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.container = new BoxRenderable(renderer, {
      width: '40%',
      height: '100%',
      borderStyle: 'single',
      title: 'Marks',
      padding: 1,
      flexDirection: 'column',
      backgroundColor: PANE_BACKGROUND,
    })

    // Taken out of flow so the list can scroll underneath it, and given a
    // negative z-index so it is painted before the scroll box and its rows.
    // Everything above it stays transparent, which is what lets the mark rows
    // show their glyphs on top of the image instead of over a solid pane.
    // Anchored bottom/right rather than top/left, so it sits in the opposite
    // corner and stays out of the way of the first few mark labels.
    this.backdrop = new ImageRenderable(renderer, {
      source: BACKDROP_SOURCE,
      width: BACKDROP_WIDTH,
      height: BACKDROP_HEIGHT,
      fit: 'fit',
      position: 'absolute',
      bottom: 0,
      right: 0,
      zIndex: -1,
      onError: () => {
        // A missing or unreadable file is cosmetic, so drop the backdrop and
        // carry on. Nothing is logged: writing to stderr would land in the
        // middle of the frame this renderer is drawing.
        this.backdrop.visible = false
      },
    })

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      width: '100%',
      height: '100%',
      scrollY: true,
      viewportCulling: false,
      backgroundColor: TRANSPARENT_BACKGROUND,
    })

    this.container.add(this.backdrop)
    this.container.add(this.scrollBox)
  }

  /**
   * Reconciles the rows in place. Rows are only created or destroyed when the
   * mark count changes, so ordinary updates (including every keystroke) do not
   * churn the renderable tree.
   *
   * `active` is whether this pane currently has the keyboard. Only then is the
   * selected row highlighted, so the highlight does not compete with the field
   * being edited in the other pane.
   */
  render(marks: Array<{ label: string; type: string }>, selectedIndex: number, active: boolean): void {
    while (this.rows.length < marks.length) {
      const text = new TextRenderable(this.renderer, { content: '' })
      const box = new BoxRenderable(this.renderer, {
        width: '100%',
        flexDirection: 'row',
        backgroundColor: TRANSPARENT_BACKGROUND,
      })
      box.add(text)
      this.rows.push({ box, text, selected: false, highlighted: false })
      this.scrollBox.add(box)
    }
    while (this.rows.length > marks.length) {
      const row = this.rows.pop()
      if (!row) break
      this.scrollBox.remove(row.box)
      row.box.destroyRecursively()
    }

    marks.forEach((mark, idx) => {
      const row = this.rows[idx]!
      const selected = idx === selectedIndex
      const highlight = selected && active

      // BoxRenderable's backgroundColor setter re-parses and re-renders without
      // an equality check, so only touch it when the highlight actually moves.
      if (row.highlighted !== highlight) {
        row.highlighted = highlight
        row.box.backgroundColor = highlight ? HIGHLIGHT_BACKGROUND : TRANSPARENT_BACKGROUND
      }
      if (row.selected !== selected) {
        row.selected = selected
        row.text.fg = selected ? MARK_SELECTED_FG : MARK_FG
      }
      row.text.content = `${selected ? '> ' : '  '}${mark.label} [${mark.type}]`
    })

    if (this.lastSelected !== selectedIndex) {
      this.lastSelected = selectedIndex
      this.revealSelected()
    }
  }

  /**
   * Scrolls the selected row into view. Without this, walking down past the last
   * visible row leaves the selection scrolled off-screen with nothing on screen
   * saying where it went.
   */
  private revealSelected(): void {
    const row = this.rows.find((r) => r.selected)
    if (row) this.scrollBox.scrollChildIntoView(row.box.id)
  }
}
