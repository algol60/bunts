import { describe, expect, test } from 'bun:test'
import { AppState } from '../src/state'
import { validateMarkData, validateThatElement, validateThisData } from '../src/validation'
import type { Mark, MarksFile } from '../src/types'

const THIS: Mark = { type: 'this', label: 'A', data: 'AAAA' }
const THAT: Mark = { type: 'that', label: 'B', data: ['A:B'] }

const mkThat = (data: string[]): Mark => ({ type: 'that', label: 'B', data })
const mkThis = (data: string): Mark => ({ type: 'this', label: 'A', data })

const withMarks = (...marks: unknown[]): MarksFile => ({ marks }) as MarksFile

describe('validateThisData', () => {
  test('accepts four upper-case alphanumerics', () => {
    for (const value of ['AAAA', '0000', 'A1B2']) expect(validateThisData(value)).toBeNull()
  })

  test('rejects everything else, including non-strings', () => {
    for (const value of ['', 'AAA', 'AAAAA', 'aaaa', 'A-A', 'AB CD', 1234, null, undefined, ['AAAA']]) {
      expect(validateThisData(value)).not.toBeNull()
    }
  })
})

describe('validateThatElement', () => {
  test('accepts WORDA:WORDB over A-Z . _', () => {
    for (const value of ['A:B', 'PP:QQ.RR', 'XXX:YYY_ZZZ']) expect(validateThatElement(value)).toBeNull()
  })

  test('rejects empty sides, missing colon and lower case', () => {
    for (const value of ['', '  ', ':B', 'A:', 'AB', 'a:b', 'A:b', 'A:B:C', null, 7]) {
      expect(validateThatElement(value)).not.toBeNull()
    }
  })
})

describe('validateMarkData', () => {
  test('valid marks produce no errors', () => {
    expect(validateMarkData(THIS)).toEqual({})
    expect(validateMarkData(THAT)).toEqual({})
  })

  // Regression: an unrecognised type used to return no errors at all, so a file
  // full of them passed the save check.
  test('an unknown type is an error', () => {
    expect(validateMarkData({ type: 'wat', data: 'AAAA' })['type']).toMatch(/Unknown mark type/)
    expect(validateMarkData({ type: undefined, data: 'AAAA' })['type']).toMatch(/Unknown mark type/)
  })

  test('a non-array "that" data is an error', () => {
    expect(validateMarkData({ type: 'that', data: 'A:B' })['data']).toMatch(/array/)
  })

  test('only failing fields are reported', () => {
    const errors = validateMarkData({ type: 'that', data: ['A:B', 'nope', 42] })
    expect(Object.keys(errors)).toEqual(['data[1]', 'data[2]'])
  })
})

describe('AppState construction', () => {
  // Regression: validate() only ran when the marks setter fired, so errors
  // already in the loaded file were invisible until the first edit.
  test('errors in the loaded file are reported before any edit', () => {
    const state = new AppState('f.json', withMarks({ type: 'this', label: 'A', data: 'nope' }))
    expect(state.hasErrors()).toBe(true)
    expect(state.errors['mark[0].data']).toMatch(/exactly 4/)
  })

  test('a clean document starts clean and not dirty', () => {
    const state = new AppState('f.json', withMarks(THIS))
    expect(state.hasErrors()).toBe(false)
    expect(state.dirty).toBe(false)
  })

  test('the loaded document is not aliased', () => {
    const data = withMarks(THIS)
    const state = new AppState('f.json', data)
    state.updateLabel(0, 'changed')
    expect((data.marks[0] as { label: string }).label).toBe('A')
  })
})

describe('typed setters', () => {
  test('updateLabel works on both variants', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.updateLabel(0, 'one')
    state.updateLabel(1, 'two')
    expect(state.marks.map((m) => m.label)).toEqual(['one', 'two'])
  })

  // Regression: one updateMark(index, Partial<Mark>) could put a string into a
  // 'that' mark's array data or vice versa.
  test("updateThisData refuses a 'that' mark", () => {
    const state = new AppState('/tmp/t.json', { version: 1, marks: [mkThat(['A:B'])] })
    state.updateThisData(0, 'ABCD')
    expect(state.marks[0]).toEqual(mkThat(['A:B']))
  })

  test("updateThatData refuses a 'this' mark", () => {
    const state = new AppState('f', withMarks(THIS))
    state.updateThatData(0, ['X:Y'])
    expect(state.marks[0]).toEqual(THIS)
  })

  test('out-of-range indices are ignored', () => {
    const state = new AppState('f', withMarks(THIS))
    state.updateLabel(5, 'nope')
    state.updateLabel(-1, 'nope')
    state.updateThisData(99, 'nope')
    expect(state.marks).toEqual([THIS])
  })
})

describe('dirty tracking', () => {
  test('edits set dirty and saving clears it', () => {
    const state = new AppState('f', withMarks(THIS))
    state.updateLabel(0, 'changed')
    expect(state.dirty).toBe(true)
    state.markSaved(structuredClone(state.currentData))
    expect(state.dirty).toBe(false)
  })

  test('a round-trip back to the original clears dirty', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.moveMark(0, 'down')
    expect(state.dirty).toBe(true)
    state.moveMark(1, 'up')
    expect(state.dirty).toBe(false)
  })

  test('deleting and re-adding is still dirty', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.deleteMark(1)
    expect(state.dirty).toBe(true)
  })

  // Regression: markSaved() snapshotted the live document. Edits made while the
  // write was in flight were then recorded as saved even though they never
  // reached the file.
  test('edits made after the payload was captured stay dirty', () => {
    const state = new AppState('f', withMarks(THIS))
    const payload = structuredClone(state.currentData)
    state.updateLabel(0, 'typed during the write')
    state.markSaved(payload)
    expect(state.dirty).toBe(true)
    expect((state.currentData.marks[0] as { label: string }).label).toBe('typed during the write')
  })
})

describe('list operations', () => {
  test('deleteMark clamps the selection', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.selectedIndex = 1
    state.deleteMark(1)
    expect(state.marks).toEqual([THIS])
    expect(state.selectedIndex).toBe(0)
  })

  test('deleting the last mark resets the selection', () => {
    const state = new AppState('f', withMarks(THIS))
    state.deleteMark(0)
    expect(state.selectedIndex).toBe(0)
    expect(state.getSelectedMark()).toBeNull()
  })

  test('addMark selects the new mark', () => {
    const state = new AppState('f', withMarks(THIS))
    state.addMark('that')
    expect(state.selectedIndex).toBe(1)
    expect(state.marks[1]!.type).toBe('that')
  })

  test('moveSelection wraps at both ends', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.moveSelection('down')
    expect(state.selectedIndex).toBe(1)
    state.moveSelection('down')
    expect(state.selectedIndex).toBe(0)
    state.moveSelection('up')
    expect(state.selectedIndex).toBe(1)
    expect(state.getSelectedMark()).toEqual(THAT)
  })

  test('moveSelection on an empty document leaves the selection alone', () => {
    const state = new AppState('f', withMarks())
    state.moveSelection('down')
    state.moveSelection('up')
    expect(state.selectedIndex).toBe(0)
    expect(state.getSelectedMark()).toBeNull()
  })

  test('moveMark keeps the same marks in the new order', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.moveMark(0, 'down')
    expect(state.marks.map((m) => m.type)).toEqual(['that', 'this'])
    expect(state.selectedIndex).toBe(1)
  })

  test('moveMark at the edges is a no-op', () => {
    const state = new AppState('f', withMarks(THIS, THAT))
    state.moveMark(0, 'up')
    state.moveMark(1, 'down')
    expect(state.marks.map((m) => m.type)).toEqual(['this', 'that'])
  })

  test('moveThatElement reorders and reports the new index', () => {
    const state = new AppState('f', withMarks({ type: 'that', label: 'B', data: ['A:B', 'C:D', 'E:F'] }))
    expect(state.moveThatElement(0, 2, 'up')).toBe(1)
    expect((state.marks[0] as { data: string[] }).data).toEqual(['A:B', 'E:F', 'C:D'])
  })

  test('moveThatElement reports the original index at the edges', () => {
    const state = new AppState('f', withMarks({ type: 'that', label: 'B', data: ['A:B', 'C:D'] }))
    expect(state.moveThatElement(0, 0, 'up')).toBe(0)
    expect(state.moveThatElement(0, 1, 'down')).toBe(1)
    expect(state.moveThatElement(0, 0, 'down')).toBe(1)
    expect(state.moveThatElement(0, 9, 'up')).toBe(9)
    expect(state.moveThatElement(0, -1, 'up')).toBe(-1)
  })

  test("moveThatElement refuses a 'this' mark", () => {
    const state = new AppState('f', withMarks(THIS))
    const res = state.moveThatElement(0, 0, 'down')
    expect(res).toBe(0)
    expect(state.marks[0]).toEqual(THIS)
  })
})

describe('hasErrors', () => {
  test('is false when nothing failed', () => {
    expect(new AppState('f', withMarks(THIS, THAT)).hasErrors()).toBe(false)
  })

  test('is true once a field goes bad, and false again when fixed', () => {
    const state = new AppState('f', withMarks(THIS))
    state.updateThisData(0, 'bad')
    expect(state.hasErrors()).toBe(true)
    state.updateThisData(0, 'ABCD')
    expect(state.hasErrors()).toBe(false)
  })

  test('reindexes errors when marks are reordered', () => {
    const state = new AppState('f', withMarks(THIS, { type: 'that', label: 'B', data: ['nope'] }))
    expect(state.errors['mark[1].data[0]']).toBeDefined()
    state.moveMark(1, 'up')
    expect(state.errors['mark[0].data[0]']).toBeDefined()
    expect(state.errors['mark[1].data[0]']).toBeUndefined()
  })
})
