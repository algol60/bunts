import {
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type KeyEvent,
} from '@opentui/core'
import { PANE_BACKGROUND } from './theme'

/** The only two ways out of the prompt. */
export type SaveChoice = 'save' | 'discard'

const TITLE = 'Unsaved changes'
const CHOICES = 'Y save    N discard'

/** Left and right border, plus one column of padding on each side. */
const HORIZONTAL_CHROME = 4

/** Top and bottom border. */
const VERTICAL_CHROME = 2

/**
 * The 'Save Y/N' box shown when Esc finishes a modified document.
 *
 * Modal by contract: App hands every key to the open prompt instead of routing
 * it, so the editor behind it cannot be typed into. There is deliberately no
 * third 'go back' answer - Esc already means finish, and finish-without-saving
 * is exactly what N does, so a second Esc discards and leaves.
 */
export class SavePrompt {
  container: BoxRenderable
  onChoice?: (choice: SaveChoice) => void
  private renderer: CliRenderer
  private lines: string[]
  /** How wide the box wants to be, which is what centring has to measure. */
  private idealWidth: number
  private readonly recenter = () => this.place()

  constructor(renderer: CliRenderer, filePath: string) {
    this.renderer = renderer
    this.lines = [`Save changes to ${filePath}?`, CHOICES]
    // Width is fixed rather than left to 'auto': centring needs to know how far
    // to shift the box, and the content is known up front. The title counts too
    // - it is drawn in the top border, so a box narrower than the title would
    // have its own name clipped.
    this.idealWidth = HORIZONTAL_CHROME + Math.max(TITLE.length, ...this.lines.map((l) => l.length))

    this.container = new BoxRenderable(renderer, {
      // Absolutely positioned so the box floats over the panes instead of
      // displacing them, and zIndex'd high so it lands on top of what it covers.
      position: 'absolute',
      border: true,
      borderStyle: 'single',
      title: TITLE,
      paddingX: 1,
      zIndex: 100,
      backgroundColor: PANE_BACKGROUND,
    })
    for (const line of this.lines) {
      this.container.add(new TextRenderable(renderer, {
        content: line,
        // One row each, whatever the content. TextRenderable wraps on word
        // boundaries by default, so a path too long for the terminal would
        // spill onto the row below and collide with the choices; truncate then
        // shortens it in the middle, keeping the filename.
        wrapMode: 'none',
        truncate: true,
      }))
    }

    this.place()
    // A resize can leave the box off-centre, so it is placed again rather than
    // only at construction.
    renderer.on('resize', this.recenter)
  }

  /**
   * Centres the box in the terminal, clamped to fit. Yoga can only offset an
   * absolutely positioned box from a parent's edge, so the leftover space is
   * halved here rather than with a percentage offset.
   *
   * The size is recomputed into locals rather than read back off the box:
   * `width`/`height` getters report what layout last produced, which is 0 for
   * a box that has not been laid out yet.
   */
  private place(): void {
    const width = Math.min(this.idealWidth, this.renderer.width)
    const height = Math.min(VERTICAL_CHROME + this.lines.length, this.renderer.height)
    this.container.width = width
    this.container.height = height
    this.container.left = Math.max(0, Math.floor((this.renderer.width - width) / 2))
    this.container.top = Math.max(0, Math.floor((this.renderer.height - height) / 2))
  }

  /** Y saves, N and Esc discard. Any other key is left to nobody. */
  handleKey(key: KeyEvent): void {
    // Ctrl+Y reports name 'y' just as a bare y does, and must not count.
    if (key.ctrl || key.meta || key.super) return
    const name = key.name.toLowerCase()
    if (name === 'y') {
      this.onChoice?.('save')
      return
    }
    if (name === 'n' || name === 'escape') {
      this.onChoice?.('discard')
    }
  }

  destroy(): void {
    this.renderer.off('resize', this.recenter)
    // Detached before it goes: destroy() removes itself from its parent, which
    // is a stricter operation than dropping the reference outright.
    this.container.parent?.remove(this.container)
    this.container.destroyRecursively()
  }
}
