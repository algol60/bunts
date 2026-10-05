import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import type { InputRenderable } from '@opentui/core'
import { AppState } from '../src/state'
import { App } from '../src/ui/app'
import { normalizeMarksFile } from '../src/file'
import type { MarksFile } from '../src/types'

const KITTY = { disambiguate: true, events: false } as const

type Boot = {
  app: App
  state: AppState
  renderer: Awaited<ReturnType<typeof createTestRenderer>>['renderer']
  keys: Awaited<ReturnType<typeof createTestRenderer>>['mockInput']
  draw: () => Promise<void>
  capture: () => string
  focused: () => InputRenderable | undefined
  file: string
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cedit-ui-'))
  // shutdown() calls process.exit; tests must not take the runner down with them.
  process.exit = (() => undefined) as never
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function boot(raw: unknown = { marks: [] }, warnings: string[] = [], size: { width: number; height: number } = { width: 80, height: 24 }): Promise<Boot> {
  const normalized = normalizeMarksFile(raw)
  if (!normalized.ok) throw new Error(normalized.error)
  const file = join(dir, 'cedit.json')
  writeFileSync(file, JSON.stringify(normalized.data))

  const setup = await createTestRenderer({
    ...size,
    exitOnCtrlC: false,
    useKittyKeyboard: KITTY,
  })
  const state = new AppState(file, normalized.data)
  const app = new App(state, warnings.length > 0 ? warnings : normalized.warnings)
  await app.init(setup.renderer)
  await setup.renderOnce()

  return {
    app,
    state,
    renderer: setup.renderer,
    keys: setup.mockInput,
    draw: setup.renderOnce,
    capture: setup.captureCharFrame,
    focused: () => setup.renderer.currentFocusedRenderable as InputRenderable | undefined,
    file,
  }
}

/** Puts the cursor at the start of the field that currently has focus. */
function caretAtStart(input: InputRenderable | undefined): void {
  (input as unknown as { cursorOffset: number }).cursorOffset = 0
}

/**
 * A TextRenderable's `content` reads back as a StyledText rather than the string
 * that was assigned, and it has no toString, so the chunks have to be joined.
 */
function textOf(renderable: unknown): string {
  const content = (renderable as { content: unknown }).content
  if (typeof content === 'string') return content
  const chunks = (content as { chunks?: Array<{ text?: unknown }> }).chunks
  if (!chunks) return String(content)
  return chunks.map((chunk) => String(chunk.text ?? '')).join('')
}

const footerText = (b: Boot) => textOf(b.app.footer)

const thisMark = { type: 'this', label: 'A', data: 'AAAA' }
const thatMark = { type: 'that', label: 'B', data: ['AAAA:BBBB', 'CCCC:DDDD'] }

describe('malformed documents', () => {
  // Every one of these threw while rendering, before normalization existed.
  test.each([
    ['a null mark', { marks: [null] }],
    ['a non-object mark', { marks: ['nope'] }],
    ['a missing label', { marks: [{ type: 'this', data: 'AAAA' }] }],
    ["numeric 'this' data", { marks: [{ type: 'this', label: 'A', data: 42 }] }],
    ["string 'that' data", { marks: [{ type: 'that', label: 'B', data: 'A:B' }] }],
    ['a non-string element', { marks: [{ type: 'that', label: 'B', data: ['A:B', 9] }] }],
    ['a non-array marks key', { marks: 'nope' }],
    ['no marks key', { version: 1 }],
  ])('renders %s without throwing', async (_label, raw) => {
    const b = await boot(raw)
    expect(b.app.markEditor.errorText.content).toBeDefined()
    b.renderer.destroy()
  })

  test('unreadable entries become visible warnings rather than silent drops', async () => {
    const b = await boot({ marks: [thisMark, { type: 'wat', label: 'Bad', data: 'AAAA' }] })
    expect(b.state.marks.map((m) => m.label)).toEqual(['A'])
    expect(footerText(b)).toContain('Skipped marks[1]')
    // fg reads back as a parsed RGBA, not the hex string that was assigned.
    const fg = (b.app.footer as unknown as { fg: { toInts(): number[] } }).fg
    expect(fg.toInts().slice(0, 3)).toEqual([251, 191, 36])
    b.renderer.destroy()
  })

  // The warning can be dismissed, but the fact that the document is missing
  // entries cannot - saving really would drop them, so the header says so for
  // the rest of the session.
  test('the header keeps warning about skipped entries after they are dismissed', async () => {
    const b = await boot({ marks: [{ type: 'wat', label: 'Bad', data: 'AAAA' }] })
    expect(textOf(b.app.header)).toContain('skipped')
    b.keys.pressArrow('up')
    await b.draw()
    expect(footerText(b)).toContain('Esc Finish')
    expect(textOf(b.app.header)).toContain('skipped')
    expect(textOf(b.app.header)).toContain('saving will drop it')
    b.renderer.destroy()
  })

  test('a warning clears on the next key without swallowing that key', async () => {
    const b = await boot({ marks: [{ type: 'wat', label: 'Bad', data: 'AAAA' }] })
    b.keys.pressKey('a')
    await b.draw()
    expect(footerText(b)).toContain('Esc Finish')
    expect(b.state.marks).toHaveLength(1)
    b.renderer.destroy()
  })
})

describe('unknown mark type in the editor pane', () => {
  // Regression: render() had no branch for a third type, so the previous mark's
  // data pane stayed on screen.
  test('hides both data sections', async () => {
    const b = await boot({ marks: [thisMark] })
    const editor = b.app.markEditor
    expect(editor.thisDataInput.visible).toBe(true)
    expect(editor.thatDataContainer.visible).toBe(false)

    editor.render({ type: 'wat' } as never, { 'mark[0].type': 'Unknown mark type' }, 0)
    expect(editor.thisDataInput.visible).toBe(false)
    expect(editor.thatDataContainer.visible).toBe(false)
    expect(textOf(editor.errorText)).toContain('Unknown mark type')
    b.renderer.destroy()
  })
})

describe('modifier keys do not trigger commands', () => {
  // Regression: the list commands ignored modifiers, so Ctrl+A added a mark and
  // Ctrl+D deleted one.
  test('Ctrl+A in the list does not add a mark', async () => {
    const b = await boot({ marks: [thisMark] })
    b.keys.pressKey('a', { ctrl: true })
    await b.draw()
    expect(b.state.marks).toHaveLength(1)
    b.renderer.destroy()
  })

  test('Ctrl+D in the list does not delete a mark', async () => {
    const b = await boot({ marks: [thisMark, thisMark] })
    b.keys.pressKey('d', { ctrl: true })
    await b.draw()
    expect(b.state.marks).toHaveLength(2)
    b.renderer.destroy()
  })

  test('plain a and d still work', async () => {
    const b = await boot({ marks: [thisMark] })
    b.keys.pressKey('a')
    await b.draw()
    expect(b.state.marks).toHaveLength(2)
    b.keys.pressKey('d')
    await b.draw()
    expect(b.state.marks).toHaveLength(1)
    b.renderer.destroy()
  })
})

describe('Ctrl+D on a that element', () => {
  // Regression: the app refused to delete the only element, but the key was not
  // swallowed, so the focused input ran its own Ctrl+D and ate a character.
  test('does not edit the element when the row delete is refused', async () => {
    const b = await boot({ marks: [{ type: 'that', label: 'B', data: ['AAAA:BBBB'] }] })
    b.keys.pressTab()
    await b.draw()
    b.keys.pressArrow('down')
    await b.draw()

    caretAtStart(b.focused())
    b.keys.pressKey('d', { ctrl: true })
    await b.draw()

    expect(b.state.marks[0]).toEqual({ type: 'that', label: 'B', data: ['AAAA:BBBB'] })
    b.renderer.destroy()
  })

  test('still deletes the element when there is more than one', async () => {
    const b = await boot({ marks: [thatMark] })
    b.keys.pressTab()
    await b.draw()
    b.keys.pressArrow('down')
    await b.draw()

    caretAtStart(b.focused())
    b.keys.pressKey('d', { ctrl: true })
    await b.draw()

    expect(b.state.marks[0]).toEqual({ type: 'that', label: 'B', data: ['CCCC:DDDD'] })
    b.renderer.destroy()
  })
})

describe('Ctrl+A in the editor', () => {
  test('adds an element to a that mark', async () => {
    const b = await boot({ marks: [thatMark] })
    b.keys.pressTab()
    await b.draw()
    b.keys.pressKey('a', { ctrl: true })
    await b.draw()
    expect((b.state.marks[0] as { data: string[] }).data).toHaveLength(3)
    b.renderer.destroy()
  })

  test('on a this mark it explains itself instead of doing nothing', async () => {
    const b = await boot({ marks: [thisMark] })
    b.keys.pressTab()
    await b.draw()
    b.keys.pressKey('a', { ctrl: true })
    await b.draw()
    expect(footerText(b)).toMatch(/only a 'that' mark/i)
    expect(b.state.marks).toHaveLength(1)
    b.renderer.destroy()
  })
})

describe('marks list scrolling', () => {
  // Regression: the list never scrolled, so walking past the last visible row
  // left the selection off-screen with nothing indicating where it went.
  test('scrolls the selected row into view', async () => {
    const marks = Array.from({ length: 40 }, (_, i) => ({ type: 'this', label: `Mark${i}`, data: 'AAAA' }))
    const b = await boot({ marks })
    expect(b.app.marksList.scrollBox.scrollTop).toBe(0)
    for (let i = 0; i < 20; i++) {
      b.keys.pressArrow('down')
      await b.draw()
    }
    expect(b.state.selectedIndex).toBe(20)
    expect(b.app.marksList.scrollBox.scrollTop).toBeGreaterThan(0)
    b.renderer.destroy()
  })

  test('up from the first mark wraps to the last and scrolls down to it', async () => {
    const marks = Array.from({ length: 40 }, (_, i) => ({ type: 'this', label: `Mark${i}`, data: 'AAAA' }))
    const b = await boot({ marks })
    b.keys.pressArrow('up')
    await b.draw()
    expect(b.state.selectedIndex).toBe(39)
    expect(b.app.marksList.scrollBox.scrollTop).toBeGreaterThan(0)
    b.renderer.destroy()
  })

  test('down from the last mark wraps to the first and scrolls back up', async () => {
    const marks = Array.from({ length: 40 }, (_, i) => ({ type: 'this', label: `Mark${i}`, data: 'AAAA' }))
    const b = await boot({ marks })
    b.keys.pressArrow('up')
    await b.draw()
    b.keys.pressArrow('down')
    await b.draw()
    expect(b.state.selectedIndex).toBe(0)
    expect(b.app.marksList.scrollBox.scrollTop).toBe(0)
    b.renderer.destroy()
  })

  // A one-mark list would divide by zero, or select a mark that does not exist.
  test('arrow keys in an empty list leave the selection at 0', async () => {
    const b = await boot({ marks: [] })
    b.keys.pressArrow('up')
    await b.draw()
    b.keys.pressArrow('down')
    await b.draw()
    expect(b.state.selectedIndex).toBe(0)
    expect(b.state.getSelectedMark()).toBeNull()
    b.renderer.destroy()
  })

  // Reordering is a different command and must not follow the selection round.
  test('Ctrl+Up at the first mark does not wrap the mark to the end', async () => {
    const b = await boot({ marks: [{ ...thisMark }, { ...thisMark, label: 'B' }] })
    b.keys.pressArrow('up', { ctrl: true })
    await b.draw()
    expect(b.state.marks.map((m) => m.label)).toEqual(['A', 'B'])
    expect(b.state.selectedIndex).toBe(0)
    b.renderer.destroy()
  })
})

describe('saving', () => {
  const openPrompt = async (b: Boot) => {
    // A field has to have focus, or the keystroke goes nowhere and the document
    // stays clean and Esc exits without ever raising the prompt.
    b.keys.pressTab()
    await b.draw()
    await b.keys.typeText('X')
    await b.draw()
    b.keys.pressEscape()
    await new Promise((r) => setTimeout(r, 150))
    await b.draw()
  }

  test('Y writes the file and leaves it clean', async () => {
    const b = await boot({ marks: [thisMark] })
    await openPrompt(b)
    expect((b.app as unknown as { savePrompt: unknown }).savePrompt).not.toBeNull()
    b.keys.pressKey('y')
    await new Promise((r) => setTimeout(r, 250))
    await b.draw()

    expect(JSON.parse(readFileSync(b.file, 'utf8')).marks[0].label).toBe('AX')
    expect(b.state.dirty).toBe(false)
    b.renderer.destroy()
  })

  test('refuses to save a document that fails validation', async () => {
    const b = await boot({ marks: [thisMark] })
    b.state.updateThisData(0, 'nope')
    await b.draw()
    await openPrompt(b)
    b.keys.pressKey('y')
    await new Promise((r) => setTimeout(r, 250))
    await b.draw()

    expect(footerText(b)).toMatch(/Cannot save/)
    expect(JSON.parse(readFileSync(b.file, 'utf8')).marks[0].data).toBe('AAAA')
    b.renderer.destroy()
  })

  // Regression: the write is async and nothing stopped input meanwhile. The payload
  // is snapshotted before the write and markSaved records that snapshot, so a
  // change made mid-write can never be reported as saved. The dirty half of this
  // is asserted directly in state.test.ts; here the guard is what stops the
  // document changing at all while the write is outstanding.
  test('keys are swallowed while a write is in flight', async () => {
    const b = await boot({ marks: [thisMark] })
    b.keys.pressTab()
    await b.draw()
    await b.keys.typeText('-')
    await b.draw()
    expect((b.focused() as any).value).toBe('A-')

    ;(b.app as unknown as { saving: boolean }).saving = true
    await b.keys.typeText('XYZ')
    b.keys.pressArrow('down')
    await b.draw()

    expect((b.focused() as any).value).toBe('A-')
    expect((b.state.currentData.marks[0] as { label: string }).label).toBe('A-')
    b.renderer.destroy()
  })

  test('a save that fails validation leaves the document dirty and editable', async () => {
    const b = await boot({ marks: [thisMark] })
    b.state.updateThisData(0, 'nope')
    await b.draw()
    await openPrompt(b)
    b.keys.pressKey('y')
    await new Promise((r) => setTimeout(r, 250))
    await b.draw()

    expect((b.app as unknown as { saving: boolean }).saving).toBe(false)
    expect(b.state.dirty).toBe(true)
    expect(footerText(b)).toMatch(/Cannot save/)
    b.renderer.destroy()
  })

  test('writes keys other than marks back untouched', async () => {
    const b = await boot({ version: 7, nested: { a: [1, 2] }, marks: [thisMark] })
    await openPrompt(b)
    b.keys.pressKey('y')
    await new Promise((r) => setTimeout(r, 250))
    await b.draw()

    const written = JSON.parse(readFileSync(b.file, 'utf8'))
    expect(written.version).toBe(7)
    expect(written.nested).toEqual({ a: [1, 2] })
    b.renderer.destroy()
  })

  test('an invalid file is never overwritten', async () => {
    const file = join(dir, 'broken.json')
    const original = "{ 'marks': [ { 'type': 'this', 'label': 'keep', 'data': 'KEE1' } ]"
    writeFileSync(file, original)
    const { loadMarksFile } = await import('../src/file')
    const result = await loadMarksFile(file)
    expect(result.kind).toBe('invalid')
    expect(readFileSync(file, 'utf8')).toBe(original)
  })
})

describe('editing', () => {
  test('typing into the label updates state without moving the caret', async () => {
    const b = await boot({ marks: [{ type: 'this', label: 'hello', data: 'AAAA' }] })
    b.keys.pressTab()
    await b.draw()
    caretAtStart(b.focused())

    b.keys.typeText('AB')
    await b.draw()

    const input = b.focused()!
    expect(input.value).toBe('ABhello')
    expect((input as unknown as { cursorOffset: number }).cursorOffset).toBe(2)
    expect((b.state.currentData.marks[0] as { label: string }).label).toBe('ABhello')
    b.renderer.destroy()
  })

  test('lower case is folded to upper case in data fields only', async () => {
    const b = await boot({ marks: [thisMark] })
    b.keys.pressTab()
    await b.draw()
    b.keys.pressArrow('down')
    await b.draw()

    caretAtStart(b.focused())
    b.keys.typeText('ab')
    await b.draw()

    expect(b.focused()!.value).toBe('ABAAAA')
    b.renderer.destroy()
  })

  test('Tab and shift-Tab cross between the panes', async () => {
    const b = await boot({ marks: [thisMark] })
    expect((b.app as unknown as { focusMode: string }).focusMode).toBe('list')
    b.keys.pressTab()
    await b.draw()
    expect((b.app as unknown as { focusMode: string }).focusMode).toBe('editor')
    b.keys.pressTab()
    await b.draw()
    expect((b.app as unknown as { focusMode: string }).focusMode).toBe('list')
    b.renderer.destroy()
  })

  test('Ctrl+Up and Ctrl+Down reorder marks', async () => {
    const b = await boot({ marks: [{ ...thisMark }, { ...thisMark, label: 'B' }] })
    b.keys.pressArrow('down')
    await b.draw()
    b.keys.pressArrow('up', { ctrl: true })
    await b.draw()
    expect(b.state.marks.map((m) => m.label)).toEqual(['B', 'A'])
    b.renderer.destroy()
  })

  test('the that pane keeps its height after rows are rebuilt', async () => {
    const b = await boot({ marks: [thatMark] })
    const before = b.app.markEditor.thatDataContainer.height
    b.keys.pressTab()
    await b.draw()
    b.keys.pressKey('a', { ctrl: true })
    await b.draw()
    expect(b.app.markEditor.thatDataContainer.height).toBe(before)
    b.renderer.destroy()
  })
})

describe('footer hints', () => {
  // The [+] / [-] hints were decorative: they looked like buttons but nothing
  // could be clicked, and they were the only place the element commands appeared.
  test('no decorative add/delete hints are rendered', async () => {
    const b = await boot({ marks: [thatMark] })
    b.state.selectedIndex = 0
    b.app.updateUI()
    await b.draw()
    const frame = b.capture()
    expect(frame).not.toContain('[+]')
    expect(frame).not.toContain('[-]')
    b.renderer.destroy()
  })

  test('the hints name the element commands while a that mark is selected', async () => {
    const b = await boot({ marks: [thatMark] })
    b.keys.pressTab()
    await b.draw()
    expect(footerText(b)).toContain('^A Add element')
    expect(footerText(b)).toContain('^D Del element')
    b.renderer.destroy()
  })

  test('the list hints name the mark commands in the list pane', async () => {
    const b = await boot({ marks: [thatMark] })
    expect(footerText(b)).toContain('a/o Add')
    expect(footerText(b)).toContain('d Delete')
    expect(footerText(b)).not.toContain('^A Add element')
    b.renderer.destroy()
  })

  test('a this mark does not advertise element commands', async () => {
    const b = await boot({ marks: [thisMark] })
    b.keys.pressTab()
    await b.draw()
    expect(footerText(b)).not.toContain('^A Add element')
    b.renderer.destroy()
  })

  test('Tab switches between the list and editor hints', async () => {
    const b = await boot({ marks: [thatMark] })
    const listHints = footerText(b)
    b.keys.pressTab()
    await b.draw()
    const editorHints = footerText(b)
    expect(editorHints).not.toBe(listHints)
    b.keys.pressTab()
    await b.draw()
    expect(footerText(b)).toBe(listHints)
    b.renderer.destroy()
  })

  // A status message has to outrank the hints, and go away afterwards.
  test('a status message replaces the hints, then the hints return', async () => {
    // One element, so Ctrl+D is refused and the refusal is reported.
    const b = await boot({ marks: [{ type: 'that', label: 'Solo', data: ['AA:BB'] }] })
    b.keys.pressTab()
    await b.draw()
    b.keys.pressArrow('down')
    await b.draw()
    b.keys.pressKey('d', { ctrl: true })
    await b.draw()
    expect(footerText(b)).toMatch(/at least one element/)
    await new Promise((r) => setTimeout(r, 2200))
    b.draw()
    expect(footerText(b)).toContain('^A Add element')
    b.renderer.destroy()
  })

  // Every set has to fit on one row or it wraps and eats the layout, which is
  // what the original 168-character help string did.
  test.each([
    ['Esc Finish | Tab Pane | Up/Dn Select | a/o Add | d Delete | ^Up/^Dn Move'],
    ['Esc Finish | Tab Pane | Up/Dn Field | ^Up/^Dn Move | a/o Add | d Delete'],
    ['Esc Finish | ^A Add element | ^D Del element | ^Up/^Dn Move elem | Tab Pane'],
  ])('hint set fits in 80 columns: %s', async (help) => {
    expect(help.length).toBeLessThanOrEqual(80)
  })
})

describe('layout', () => {
  // Regression: the label input had a fixed width of 40, which plus the 'Label:'
  // prompt and the gap overflowed the 60%-wide pane. The label wrapped onto three
  // lines and pushed the rest of the form down.
  test.each([[80, 24], [100, 30], [60, 20]])('the label row is one line at %ix%i', async (width, height) => {
    const b = await boot({ marks: [{ type: 'this', label: 'A reasonably long label', data: 'AAAA' }] }, [], { width, height })
    const editor = b.app.markEditor as unknown as { labelInput: InputRenderable }
    expect(editor.labelInput.parent!.height).toBe(1)
    b.renderer.destroy()
  })

  test('the footer is fully on screen and exactly one row tall', async () => {
    const b = await boot({ marks: [thisMark] })
    const footer = b.app.footer as unknown as { y: number; height: number }
    expect(footer.height).toBe(1)
    expect(footer.y + footer.height).toBeLessThanOrEqual(b.renderer.height)
    b.renderer.destroy()
  })

  test('that element rows are one line each', async () => {
    const b = await boot({ marks: [thatMark] })
    b.state.selectedIndex = 0
    b.app.updateUI()
    await b.draw()
    const editor = b.app.markEditor
    for (const input of editor.thatDataInputs) {
      expect(input.parent!.height).toBe(1)
    }
    b.renderer.destroy()
  })

  test('no colours are hardcoded outside theme.ts', async () => {
    const source = await Bun.file(new URL('../src/ui/mark-editor.ts', import.meta.url)).text()
    expect(source).not.toMatch(/'#(ff0000|ffffff|00ffff)'/i)
  })
})

describe('document integrity', () => {
  test('round-trips a document with extra keys untouched', async () => {
    const original: MarksFile = {
      version: 2,
      note: { deep: { value: [1, { x: 'y' }] } },
      marks: [{ type: 'this', label: 'A', data: 'AAAA' }],
    }
    const b = await boot(original)
    await b.keys.typeText('')
    b.keys.pressKey('y')
    await new Promise((r) => setTimeout(r, 250))

    const written = JSON.parse(readFileSync(b.file, 'utf8'))
    expect(written['note']).toEqual(original['note'])
    expect(written.version).toBe(2)
    b.renderer.destroy()
  })
})
