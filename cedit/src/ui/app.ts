import {
  BoxRenderable,
  InputRenderable,
  TextRenderable,
  createCliRenderer,
  type CliRenderer,
} from '@opentui/core'
import { AppState } from '../state'
import { MarksList } from './marks-list'
import { MarkEditor } from './mark-editor'
import { SavePrompt, type SaveChoice } from './save-prompt'
import { PLACEHOLDER_COLOR, WARNING_FG } from './theme'
import { saveMarksFile } from '../file'

/**
 * Key hints for the footer. Kept inside 80 columns because the footer is a
 * single-row status line; the alternative is losing two rows of the layout to a
 * second line of help on a standard terminal.
 *
 * There is one set per mode, because the editor-mode bindings differ by mark
 * type and there is not room on one line to describe all three. The 'that' set
 * is the only place the element commands are mentioned, so it has to stay.
 */
const FOOTER_HELP_LIST = 'Esc Finish | Tab Pane | Up/Dn Select | a/o Add | d Delete | ^Up/^Dn Move'
const FOOTER_HELP_THIS = 'Esc Finish | Tab Pane | Up/Dn Field | ^Up/^Dn Move | a/o Add | d Delete'
const FOOTER_HELP_THAT = 'Esc Finish | ^A Add element | ^D Del element | ^Up/^Dn Move elem | Tab Pane'


export class App {
  renderer!: CliRenderer
  state: AppState
  root!: BoxRenderable
  header!: TextRenderable
  mainBox!: BoxRenderable
  marksList!: MarksList
  markEditor!: MarkEditor
  footer!: TextRenderable
  focusMode: 'list' | 'editor' = 'list'
  /** Non-null exactly while the Save Y/N box is on screen. */
  private savePrompt: SavePrompt | null = null
  /**
   * True from the moment a save starts until it settles. The write is async, so
   * without this the user could keep typing into a document that was already
   * being serialized.
   */
  private saving = false
  /** Load warnings, shown in the footer until the user dismisses them. */
  private warnings: string[]
  /**
   * How many entries the loader could not represent. Unlike the footer text this
   * does not go away when dismissed: those entries are not in the document, so
   * saving really would drop them, and the header has to keep saying so.
   */
  private readonly skipped: number

  constructor(state: AppState, warnings: string[] = []) {
    this.state = state
    this.warnings = warnings
    this.skipped = warnings.filter((w) => w.startsWith('Skipped ')).length
  }

  async init(injectedRenderer?: CliRenderer): Promise<void> {
    this.renderer = injectedRenderer ?? (await createCliRenderer({
      exitOnCtrlC: false,
      // Disambiguate escape codes so Esc reliably reaches us and so
      // Ctrl+Arrow / Ctrl+A / Ctrl+D are reported with their modifiers.
      useKittyKeyboard: { disambiguate: true, events: false },
    }))

    this.root = new BoxRenderable(this.renderer, {
      flexDirection: 'column',
      width: '100%',
      height: '100%',
    })

    // Header
    this.header = new TextRenderable(this.renderer, {
      content: this.headerText(),
    })
    this.root.add(this.header)

    // Main
    this.mainBox = new BoxRenderable(this.renderer, {
      flexDirection: 'row',
      width: '100%',
      height: '100%',
    })

    this.marksList = new MarksList(this.renderer)
    this.markEditor = new MarkEditor(this.renderer)

    this.setupEditorCallbacks()

    this.mainBox.add(this.marksList.container)
    this.mainBox.add(this.markEditor.container)
    this.root.add(this.mainBox)

    // Footer
    this.footer = new TextRenderable(this.renderer, {
      content: FOOTER_HELP_LIST,
      fg: PLACEHOLDER_COLOR,
      // One row, always. TextRenderable wraps on word boundaries by default, so a
      // long status message would push the panes up rather than scroll away.
      wrapMode: 'none',
      truncate: true,
    })
    this.root.add(this.footer)

    this.renderer.root.add(this.root)
    this.updateUI()
    this.restoreFooter()
    this.setupKeyboardHandlers()
  }

  setupEditorCallbacks(): void {
    this.markEditor.onLabelChange = (value: string) => {
      this.state.updateLabel(this.state.selectedIndex, value)
      this.updateUI()
    }

    this.markEditor.onThisDataChange = (value: string) => {
      this.state.updateThisData(this.state.selectedIndex, value)
      this.updateUI()
    }

    this.markEditor.onThatDataChange = (index: number, value: string) => {
      const mark = this.state.getSelectedMark()
      if (mark?.type !== 'that') return
      const newData = [...mark.data]
      newData[index] = value
      this.state.updateThatData(this.state.selectedIndex, newData)
      this.updateUI()
    }

    this.markEditor.onThatDataAdd = () => {
      const mark = this.state.getSelectedMark()
      if (mark?.type !== 'that') return
      this.state.updateThatData(this.state.selectedIndex, [...mark.data, 'AA:BB'])
      this.updateUI()
    }

    this.markEditor.onThatDataDelete = (index: number) => {
      const mark = this.state.getSelectedMark()
      if (mark?.type !== 'that' || mark.data.length <= 1) return
      this.state.updateThatData(this.state.selectedIndex, mark.data.filter((_, i) => i !== index))
      this.updateUI()
    }
  }

  /**
   * Header line. The skipped-entry marker is not dismissible: those entries are
   * missing from the document, so it is the one signal that saving would lose
   * data that was in the file.
   */
  private headerText(): string {
    const skipped = this.skipped > 0
      ? ` [${this.skipped} entr${this.skipped === 1 ? 'y' : 'ies'} skipped - saving will drop ${this.skipped === 1 ? 'it' : 'them'}]`
      : ''
    return `cedit: ${this.state.filePath}${this.state.dirty ? ' [modified]' : ''}${skipped}`
  }

  updateUI(): void {
    this.header.content = this.headerText()
    this.marksList.render(this.state.marks, this.state.selectedIndex, this.focusMode === 'list')
    this.markEditor.render(this.state.getSelectedMark(), this.state.errors, this.state.selectedIndex)
    // The hints depend on the focused pane and the selected mark's type, so they
    // have to be refreshed whenever either could have changed.
    this.restoreFooter()
  }

  private focusMarkList(): void {
    this.focusMode = 'list'
    // Re-render so the selected row picks its highlight back up.
    this.updateUI()
    this.renderer.currentFocusedRenderable?.blur()
  }

  setupKeyboardHandlers(): void {
    this.renderer.keyInput.on('keypress', (key) => {
      const name = key.name.toLowerCase()

      // The Save Y/N box is modal: while it is up it swallows every key, so
      // nothing behind it can be edited and no command can fire behind its back.
      if (this.savePrompt) {
        key.preventDefault()
        this.savePrompt.handleKey(key)
        return
      }

      // A write is in flight. Swallow keys so the document cannot change while
      // it is being serialized.
      if (this.saving) {
        key.preventDefault()
        return
      }

      // Load warnings take priority over the key hints in the footer. Dismiss the
      // top one without swallowing the key, so the keystroke that dismissed it
      // still does what the user meant.
      this.dismissWarnings()

      // The data fields only ever accept A-Z (plus 0-9, '.', '_'), so fold typed
      // letters to upper case as they are inserted. Global listeners run before
      // the focused renderable's, so swallowing the key here is what stops the
      // lower-case letter from reaching the buffer.
      //
      // Reassigning `value` instead would be simpler but wrong: that setter
      // moves the cursor to the end and re-emits 'input', which would throw the
      // cursor to the end of the field on every keystroke.
      if (!key.ctrl && !key.meta && !key.super) {
        const char = key.sequence ?? ''
        if (/^\p{Ll}$/u.test(char) && this.markEditor.isDataInput(this.renderer.currentFocusedRenderable)) {
          if (typeof (key as any).preventDefault === 'function') {
            (key as any).preventDefault()
          }
          (this.renderer.currentFocusedRenderable as InputRenderable).insertText(char.toUpperCase())
          return
        }
      }

      // Tab crosses between the list and the editor in both directions, so it
      // must work while a field has focus - that is the usual way back out.
      if (name === 'tab') {
        key.preventDefault()
        if (this.focusMode === 'list') {
          this.enterEditor(0)
        } else {
          this.focusMarkList()
        }
        return
      }

      // Esc finishes, from either pane and from inside a field. The only
      // question it leaves open is what to do with unsaved edits, and that is
      // the Save Y/N box's job.
      if (name === 'escape') {
        key.preventDefault()
        this.finish()
        return
      }

      // Navigation
      if (this.focusMode === 'list') {
        // Reorder must be checked before plain up/down, since Ctrl+Up reports name='up'.
        if (key.ctrl && name === 'up') {
          this.state.moveMark(this.state.selectedIndex, 'up')
          this.updateUI()
          return
        }
        if (key.ctrl && name === 'down') {
          this.state.moveMark(this.state.selectedIndex, 'down')
          this.updateUI()
          return
        }
        // Wraps at both ends, so the list keeps scrolling round instead of
        // stopping at the first and last mark. Also swallowed, so a focused
        // renderable cannot react to the same arrow key.
        if (name === 'up' || name === 'down') {
          key.preventDefault()
          this.state.moveSelection(name)
          this.updateUI()
          return
        }
        // Bare keys only. Without this, Ctrl+A added a mark and Ctrl+D deleted
        // one, so two common shortcuts destroyed or added data. Shift is allowed
        // through on purpose: shift+D is a documented alias for delete.
        const bare = !key.ctrl && !key.meta && !key.super
        if (bare && name === 'a') {
          this.state.addMark('this')
          this.updateUI()
          return
        }
        if (bare && name === 'o') {
          this.state.addMark('that')
          this.updateUI()
          return
        }
        if (bare && name === 'd') {
          this.state.deleteMark(this.state.selectedIndex)
          this.updateUI()
          return
        }

      } else if (this.focusMode === 'editor') {
        // Element list actions use Ctrl so they never collide with typed text.
        // Every one of them must swallow the key: the focused input has its own
        // Ctrl bindings (Ctrl+D deletes a character, Ctrl+A selects all), and
        // without preventDefault both the command and the input would fire. That
        // is how Ctrl+D came to eat a character even while the app refused to
        // delete the row.
        if (key.ctrl && name === 'a') {
          key.preventDefault()
          this.addThatElement()
          return
        }
        if (key.ctrl && name === 'd') {
          key.preventDefault()
          const idx = this.markEditor.focusedElementIndex(this.renderer.currentFocusedRenderable)
          const last = this.state.getSelectedMark()
          this.deleteThatElement(idx >= 0 ? idx : last?.type === 'that' ? last.data.length - 1 : -1)
          return
        }
        // Reorder is checked before plain up/down, since Ctrl+Up reports name='up'.
        if (key.ctrl && (name === 'up' || name === 'down')) {
          key.preventDefault()
          this.moveFocusedElement(name === 'up' ? 'up' : 'down')
          return
        }
        if (name === 'up' || name === 'down') {
          // Fields are single-line, so up/down is never a cursor movement
          // here. Swallow it or the focused input would handle it too.
          key.preventDefault()
          this.moveEditorFocus(name === 'up' ? 'up' : 'down')
          return
        }
      }
    })
  }

  /** Focuses the input at `index`, scrolling it into view. */
  private focusEditorInput(index: number): void {
    const input = this.markEditor.getFocusableInputs()[index]
    if (!input) return
    input.focus()
    this.markEditor.revealInput(input)
  }

  /** Steps focus to the next or previous field, stopping at either end. */
  private moveEditorFocus(direction: 'up' | 'down'): void {
    const count = this.markEditor.getFocusableInputs().length
    if (count === 0) return
    // Focus can be missing (a rebuild drops it), in which case -1 steps to 0.
    const current = this.markEditor.focusedInputIndex()
    const next = Math.min(Math.max(current + (direction === 'down' ? 1 : -1), 0), count - 1)
    if (next === current) return
    this.focusEditorInput(next)
  }

  private enterEditor(focusIndex: number): void {
    this.focusMode = 'editor'
    // Re-render while the old pane still has focus, so the list drops its
    // highlight before anything moves.
    this.updateUI()
    this.focusEditorInput(focusIndex)
  }

  private moveFocusedElement(direction: 'up' | 'down'): void {
    const idx = this.markEditor.focusedElementIndex(this.renderer.currentFocusedRenderable)
    if (idx < 0) {
      this.setStatus('Move onto an element first to reorder it')
      return
    }
    const newIdx = this.state.moveThatElement(this.state.selectedIndex, idx, direction)
    if (newIdx === idx) return
    // updateUI rebuilds the element inputs, so restore focus onto the moved one.
    this.updateUI()
    this.focusEditorInput(this.markEditor.elementFocusPosition(newIdx))
  }

  private addThatElement(): void {
    const mark = this.state.getSelectedMark()
    if (mark?.type !== 'that') {
      this.setStatus('Only a \'that\' mark has elements to add')
      return
    }
    this.markEditor.onThatDataAdd?.()
    // Re-render replaced the inputs, so focus the newly appended element.
    this.focusEditorInput(this.markEditor.getFocusableInputs().length - 1)
  }

  private deleteThatElement(index: number): void {
    const mark = this.state.getSelectedMark()
    if (mark?.type !== 'that' || index < 0) return
    if (mark.data.length <= 1) {
      // A 'that' mark must keep at least one element.
      this.setStatus('A \'that\' mark must keep at least one element')
      return
    }
    this.markEditor.onThatDataDelete?.(index)
    this.focusEditorInput(Math.min(index, this.markEditor.getFocusableInputs().length - 1))
  }

  private statusTimer: ReturnType<typeof setTimeout> | null = null
  /** Transient message, tracked as state so a re-render cannot stomp on it. */
  private status: string | null = null
  private shuttingDown = false

  private get torndown(): boolean {
    return this.shuttingDown || this.renderer === undefined || this.renderer.isDestroyed
  }

  private setStatus(message: string, ms = 2000): void {
    if (this.torndown || !this.footer) return
    this.status = message
    this.restoreFooter()
    if (this.statusTimer) clearTimeout(this.statusTimer)
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null
      this.status = null
      this.restoreFooter()
    }, ms)
  }

  /**
   * Key hints for the current context. The editor-mode commands differ by mark
   * type, and the element commands are only reachable from the 'that' pane, so
   * that is where they are advertised.
   */
  private contextualHelp(): string {
    if (this.focusMode !== 'editor') return FOOTER_HELP_LIST
    return this.state.getSelectedMark()?.type === 'that' ? FOOTER_HELP_THAT : FOOTER_HELP_THIS
  }

  /**
   * Startup warnings outrank the key hints until dismissed: they can mean entries
   * were skipped on load, which a transient status message would hide.
   */
  private restoreFooter(): void {
    if (this.torndown || !this.footer) return
    if (this.warnings.length > 0) {
      const more = this.warnings.length > 1 ? ` (+${this.warnings.length - 1} more, press a key)` : ' (press a key)'
      this.footer.content = `${this.warnings[0]!}${more}`
      this.footer.fg = WARNING_FG
      return
    }
    if (this.status !== null) {
      this.footer.content = this.status
      this.footer.fg = WARNING_FG
      return
    }
    this.footer.content = this.contextualHelp()
    this.footer.fg = PLACEHOLDER_COLOR
  }

  private dismissWarnings(): boolean {
    if (this.warnings.length === 0) return false
    this.warnings.shift()
    this.restoreFooter()
    return true
  }

  /**
   * Esc: leave the editor. A clean document just goes; a modified one asks
   * first, because that is the only decision Esc cannot make on its own.
   */
  finish(): void {
    if (!this.state.dirty) {
      this.shutdown(0)
      return
    }
    this.openSavePrompt()
  }

  private openSavePrompt(): void {
    if (this.savePrompt) return
    const prompt = new SavePrompt(this.renderer, this.state.filePath)
    prompt.onChoice = (choice) => void this.answerSavePrompt(choice)
    this.savePrompt = prompt
    this.root.add(prompt.container)
  }

  /**
   * Takes the box down first and only then acts on the answer: the prompt is a
   * mode of its own, and the write is async, so leaving it up would leave the
   * editor accepting nothing while it waited.
   */
  private async answerSavePrompt(choice: SaveChoice): Promise<void> {
    const prompt = this.savePrompt
    if (!prompt) return
    this.savePrompt = null
    prompt.destroy()

    if (choice === 'discard') {
      this.shutdown(0)
      return
    }
    const failure = await this.writeFile()
    if (failure) {
      // Nothing was written and the edits are still here, so go back to
      // editing rather than leaving on a file that does not match the screen.
      this.setStatus(failure)
      return
    }
    // Edits typed while the write was in flight would not be on disk. The dirty
    // flag is computed against what was actually written, so this catches them.
    if (this.state.dirty) {
      this.setStatus('Saved, but the document changed while writing - press Esc to save again', 4000)
      return
    }
    this.shutdown(0)
  }

  /**
   * Writes the document. Returns an error message on failure and null on
   * success, so the caller can decide whether to keep editing - validation
   * failures in particular need the user to go and fix a field.
   */
  private async writeFile(): Promise<string | null> {
    // Snapshot first. Everything after this point works on the snapshot, so the
    // bytes written and the document treated as saved are the same thing even if
    // the document changes underneath us.
    const payload = structuredClone(this.state.currentData)
    this.state.validate()
    if (this.state.hasErrors()) {
      return 'Cannot save: fix validation errors first'
    }
    this.saving = true
    // Held for the duration of the write rather than on a timer: `saving` is what
    // blocks input, so the message should last exactly as long as that does.
    this.status = 'Saving...'
    this.restoreFooter()
    try {
      await saveMarksFile(this.state.filePath, payload)
    } catch (error) {
      this.endSave()
      return `Save failed: ${error instanceof Error ? error.message : String(error)}`
    }
    this.endSave()
    this.state.markSaved(payload)
    this.updateUI()
    return null
  }

  private endSave(): void {
    this.saving = false
    this.status = null
    this.restoreFooter()
  }

  /** Tear down cleanly: drop pending timers before releasing the renderer. */
  private shutdown(exitCode: number): void {
    this.shuttingDown = true
    if (this.statusTimer) {
      clearTimeout(this.statusTimer)
      this.statusTimer = null
    }
    this.renderer.destroy()
    process.exit(exitCode)
  }
}
