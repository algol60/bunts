import {
  BoxRenderable,
  InputRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type CliRenderer,
  type PasteEvent,
} from '@opentui/core'
import type { Mark } from '../types'
import { validateThatElement, validateThisData } from '../validation'
import { ERROR_FG, FIELD_FG, HIGHLIGHT_BACKGROUND, PANE_BACKGROUND, PLACEHOLDER_COLOR } from './theme'

export class MarkEditor {
  renderer: CliRenderer
  container: BoxRenderable
  labelInput!: InputRenderable
  typeText!: TextRenderable
  thisDataInput!: InputRenderable
  thatDataContainer!: BoxRenderable
  thatDataScroll!: ScrollBoxRenderable
  thatDataInputs: InputRenderable[] = []
  errorText!: TextRenderable

  onLabelChange?: (value: string) => void
  onThisDataChange?: (value: string) => void
  onThatDataChange?: (index: number, value: string) => void
  onThatDataAdd?: () => void
  onThatDataDelete?: (index: number) => void

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.container = new BoxRenderable(renderer, {
      width: '60%',
      height: '100%',
      borderStyle: 'single',
      title: 'Edit Mark',
      padding: 1,
      flexDirection: 'column',
      gap: 1,
      backgroundColor: PANE_BACKGROUND,
    })

    // Label
    // The label row is width-flexible rather than sized to its contents. A fixed
    // input width plus the 'Label:' prompt and the gap overflows a narrow pane,
    // and the label then wraps over three lines and shoves everything below it
    // down the pane.
    const labelRow = new BoxRenderable(renderer, {
      width: '100%',
      flexDirection: 'row',
      gap: 2,
      alignItems: 'center',
    })
    labelRow.add(new TextRenderable(renderer, { content: 'Label:' }))
    this.labelInput = new InputRenderable(renderer, {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 8,
      placeholder: 'Enter label',
      placeholderColor: PLACEHOLDER_COLOR,
      backgroundColor: 'transparent', //PANE_BACKGROUND,
      focusedBackgroundColor: HIGHLIGHT_BACKGROUND,
    })
    labelRow.add(this.labelInput)
    this.container.add(labelRow)

    // Type
    const typeRow = new BoxRenderable(renderer, {
      flexDirection: 'row',
      gap: 2,
      alignItems: 'center',
    })
    typeRow.add(new TextRenderable(renderer, { content: 'Type:' }))
    this.typeText = new TextRenderable(renderer, { content: '' })
    typeRow.add(this.typeText)
    this.container.add(typeRow)

    // Data section
    const dataLabel = new TextRenderable(renderer, { content: 'Data:' })
    this.container.add(dataLabel)

    // This data input
    this.thisDataInput = new InputRenderable(renderer, {
      width: 20,
      placeholder: 'AAAA',
      placeholderColor: PLACEHOLDER_COLOR,
      backgroundColor: PANE_BACKGROUND,
      focusedBackgroundColor: HIGHLIGHT_BACKGROUND,
    })
    this.thisDataInput.onPaste = (event) => MarkEditor.foldPaste(this.thisDataInput, event)
    this.container.add(this.thisDataInput)

    // That data container
    // Must claim only the leftover height, not '100%' of the editor: in a column
    // flex box a 100% height overflows the pane and shifts the rows above it,
    // clipping the 'Label:' prompt off the top.
    this.thatDataContainer = new BoxRenderable(renderer, {
      flexDirection: 'column',
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      height: 'auto',
    })

    this.thatDataScroll = new ScrollBoxRenderable(renderer, {
      width: '100%',
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      height: 'auto',
      scrollY: true,
      backgroundColor: PANE_BACKGROUND,
    })
    this.thatDataContainer.add(this.thatDataScroll)

    this.container.add(this.thatDataContainer)

    // Error text
    this.errorText = new TextRenderable(renderer, {
      content: '',
      fg: ERROR_FG,
    })
    this.container.add(this.errorText)

    this.setupEventHandlers()
  }

  setupEventHandlers(): void {
    this.labelInput.on('input', (value: string) => {
      if (this.onLabelChange) {
        this.onLabelChange(value)
      }
    })

    this.thisDataInput.on('input', (value: string) => {
      if (this.onThisDataChange) {
        this.onThisDataChange(value)
      }
      this.validate()
    })
  }

  validate(): void {
    const mark = this.currentMark
    if (!mark) return

    if (mark.type === 'this') {
      const err = validateThisData(this.thisDataInput.value)
      this.errorText.content = err || ''
      this.thisDataInput.textColor = err ? ERROR_FG : FIELD_FG
    } else if (mark.type === 'that') {
      let hasError = false
      this.thatDataInputs.forEach((input) => {
        const err = validateThatElement(input.value)
        input.textColor = err ? ERROR_FG : FIELD_FG
        if (err) hasError = true
      })
      this.errorText.content = hasError ? 'One or more elements are invalid' : ''
    }
  }

  private _currentMark: Mark | null = null
  get currentMark(): Mark | null {
    return this._currentMark
  }

  /**
   * Shows nothing editable, which is what both 'no mark selected' and 'this mark
   * has a type the editor does not understand' need.
   */
  private showEmpty(): void {
    this.labelInput.value = ''
    this.typeText.content = ''
    this.thisDataInput.visible = false
    this.thatDataContainer.visible = false
    this.errorText.content = ''
  }

  render(mark: Mark | null, errors: Record<string, string>, index: number = -1): void {
    this._currentMark = mark
    if (!mark) {
      this.showEmpty()
      return
    }

    // Both of these are read from a file, so they are not trusted to be strings.
    // Assigning undefined to an input's value throws inside the setter.
    this.labelInput.value = typeof mark.label === 'string' ? mark.label : ''
    this.typeText.content = String(mark.type)

    if (mark.type === 'this') {
      this.thisDataInput.visible = true
      this.thatDataContainer.visible = false
      this.thisDataInput.value = typeof mark.data === 'string' ? mark.data : ''
      const err = errors[`mark[${index}].data`]
      this.errorText.content = err || ''
      this.thisDataInput.textColor = err ? ERROR_FG : FIELD_FG
    } else if (mark.type === 'that') {
      this.thisDataInput.visible = false
      this.thatDataContainer.visible = true
      this.renderThatData(mark.data, errors, index)
    } else {
      // Unreachable for a well-typed Mark, and the compiler narrows it to
      // `never`. The document comes from a file, so an unrecognised type has to
      // be rendered as 'nothing editable' rather than falling through and
      // leaving the previous mark's data pane on screen.
      const type: unknown = (mark as { type: unknown }).type
      this.showEmpty()
      this.typeText.content = String(type)
      this.errorText.content = errors[`mark[${index}].type`] || 'Unsupported mark type'
    }
  }

  renderThatData(data: string[], errors: Record<string, string>, index: number = -1): void {
    const errorFor = (i: number) => errors[`mark[${index}].data[${i}]`]

    // When only the text changed, update the existing inputs in place. Rebuilding
    // them on every keystroke would blur and destroy the input being typed into,
    // dropping every character after the first.
    if (this.thatDataInputs.length === data.length && this.thatDataInputs.length > 0) {
      data.forEach((elem, i) => {
        const input = this.thatDataInputs[i]!
        if (input.value !== elem) input.value = elem
        input.textColor = errorFor(i) ? ERROR_FG : FIELD_FG
      })
      this.errorText.content = data.some((_e, i) => errorFor(i)) ? 'One or more elements are invalid' : ''
      return
    }

    // The element count changed, so rebuild the rows.
    // Rebuilding the inputs destroys their text buffers, so drop focus first
    // otherwise destroying a focused input throws 'TextBuffer is destroyed'.
    if (this.isEditorInput(this.renderer.currentFocusedRenderable)) {
      this.renderer.currentFocusedRenderable?.blur()
    }
    this.thatDataScroll.destroyRecursively()
    this.thatDataInputs = []
    this.thatDataScroll = new ScrollBoxRenderable(this.renderer, {
      width: '100%',
      // Same flex settings as the constructor's scroll box. Dropping flexBasis
      // here made the pane change height the first time rows were rebuilt.
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 1,
      height: 'auto',
      scrollY: true,
      backgroundColor: PANE_BACKGROUND,
    })
    this.thatDataContainer.add(this.thatDataScroll)

    data.forEach((elem, idx) => {
      const row = new BoxRenderable(this.renderer, {
        width: '100%',
        flexDirection: 'row',
        gap: 1,
        alignItems: 'center',
      })
      // Flexible for the same reason as the label input: a fixed width would
      // overflow the scroll box and wrap the row onto a second line.
      const input = new InputRenderable(this.renderer, {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 8,
        value: elem,
        backgroundColor: PANE_BACKGROUND,
        focusedBackgroundColor: HIGHLIGHT_BACKGROUND,
      })
      input.on('input', (value: string) => {
        if (this.onThatDataChange) {
          this.onThatDataChange(idx, value)
        }
        this.validate()
      })
      input.onPaste = (event) => MarkEditor.foldPaste(input, event)
      this.thatDataInputs.push(input)
      row.add(input)
      this.thatDataScroll.add(row)
    })

    this.errorText.content = data.some((_e, i) => errorFor(i)) ? 'One or more elements are invalid' : ''
  }

  /**
   * The inputs that up/down navigation steps through, in visual order:
   * label, then this-data, then one entry per 'that' element.
   *
   * Only the section the current mark actually uses is included. Element inputs
   * from a previously selected 'that' mark stay in `thatDataInputs` when the
   * mark switches to type 'this', and `visible` is a per-renderable flag that
   * does not consider ancestors, so the section containers gate them.
   */
  getFocusableInputs(): InputRenderable[] {
    const inputs: InputRenderable[] = [this.labelInput]
    if (this.thisDataInput.visible) inputs.push(this.thisDataInput)
    if (this.thatDataContainer.visible) inputs.push(...this.thatDataInputs)
    return inputs.filter((i) => i.visible)
  }

  /** True when the given renderable is one of this editor's text inputs. */
  isEditorInput(renderable: unknown): boolean {
    return this.getFocusableInputs().some((input) => input === renderable)
  }

  /**
   * True when the given renderable is a data field rather than the label.
   * These are the fields restricted to upper case by validation, so typed
   * letters get folded for them.
   */
  isDataInput(renderable: unknown): boolean {
    return renderable === this.thisDataInput || this.thatDataInputs.indexOf(renderable as InputRenderable) >= 0
  }

  /**
   * Upper-cases pasted text for the data fields. Keystrokes are folded as they
   * are inserted, but a paste lands as one lump, so it is upper-cased here
   * instead - at that point the cursor is already at the end of the pasted run,
   * so there is no cursor position to preserve.
   */
  private static foldPaste(input: InputRenderable, event: PasteEvent): void {
    const text = new TextDecoder().decode(event.bytes).replace(/[\n\r]/g, '')
    const upper = text.toUpperCase()
    if (upper === text) return
    event.preventDefault()
    input.insertText(upper)
  }

  /** Index of the focused 'that' data element, or -1 when focus is elsewhere. */
  focusedElementIndex(focused: unknown): number {
    return this.thatDataInputs.indexOf(focused as InputRenderable)
  }

  /**
   * Position of the currently focused input within the navigation order, or -1
   * when focus is outside the editor or nowhere at all.
   */
  focusedInputIndex(): number {
    return this.getFocusableInputs().indexOf(this.renderer.currentFocusedRenderable as InputRenderable)
  }

  /** Position of a 'that' data input within the navigation order, or -1. */
  elementFocusPosition(index: number): number {
    return this.getFocusableInputs().indexOf(this.thatDataInputs[index] as InputRenderable)
  }

  /**
   * Scrolls an element row into view. The rows live in a fixed-height
   * ScrollBox, so navigating past the last visible one would otherwise focus
   * a field the user cannot see.
   */
  revealInput(input: InputRenderable): void {
    const row = input.parent
    if (row) this.thatDataScroll.scrollChildIntoView(row.id)
  }
}
