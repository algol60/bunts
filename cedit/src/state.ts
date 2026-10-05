import type { Mark, MarksFile } from './types'
import { validateMarkData } from './validation'

/** Validation failures, keyed by 'mark[i].field'. Holds only real failures. */
export type ValidationErrors = Record<string, string>

export class AppState {
  originalData: MarksFile
  currentData: MarksFile
  selectedIndex: number = 0
  filePath: string
  dirty: boolean = false
  errors: ValidationErrors = {}

  constructor(filePath: string, data: MarksFile) {
    this.filePath = filePath
    this.originalData = structuredClone(data)
    this.currentData = structuredClone(data)
    this.updateDirty()
    // Validate up front: errors already present in the file being edited have to
    // be visible before the first keystroke, not after it.
    this.validate()
  }

  get marks(): Mark[] {
    return this.currentData.marks
  }

  set marks(value: Mark[]) {
    this.currentData.marks = value
    this.updateDirty()
    this.validate()
  }

  /**
   * The `marks` array is the only part of the document this editor mutates, so
   * only that is compared. Stringifying the whole document on every keystroke
   * made editing cost grow with the size of the file.
   */
  updateDirty(): void {
    this.dirty = JSON.stringify(this.currentData.marks) !== JSON.stringify(this.originalData.marks)
  }

  validate(): void {
    this.errors = {}
    this.marks.forEach((mark, idx) => {
      const markErrors = validateMarkData(mark)
      Object.entries(markErrors).forEach(([key, err]) => {
        if (err) {
          this.errors[`mark[${idx}].${key}`] = err
        }
      })
    })
  }

  hasErrors(): boolean {
    return Object.keys(this.errors).length > 0
  }

  addMark(type: 'this' | 'that'): void {
    const newMark: Mark = type === 'this'
      ? { type: 'this', label: 'New Mark', data: 'AAAA' }
      : { type: 'that', label: 'New Mark', data: ['AA:BB'] }
    this.marks = [...this.marks, newMark]
    this.selectedIndex = this.marks.length - 1
  }

  deleteMark(index: number): void {
    if (index < 0 || index >= this.marks.length) return
    const newMarks = this.marks.filter((_, i) => i !== index)
    this.marks = newMarks
    if (this.marks.length === 0) {
      this.selectedIndex = 0
    } else if (this.selectedIndex >= this.marks.length) {
      this.selectedIndex = this.marks.length - 1
    }
  }

  /**
   * Moves the selection one mark, wrapping at either end: up from the first mark
   * lands on the last, down from the last lands on the first, so the list scrolls
   * round instead of stopping at its edges.
   *
   * An empty document is left alone - there is nothing to select, and any index
   * would be out of range for every reader of selectedIndex.
   */
  moveSelection(direction: 'up' | 'down'): void {
    const count = this.marks.length
    if (count === 0) return
    const step = direction === 'down' ? 1 : -1
    // The + count keeps the modulo non-negative when stepping up past index 0.
    this.selectedIndex = (this.selectedIndex + step + count) % count
  }

  moveMark(index: number, direction: 'up' | 'down'): void {
    if (index < 0 || index >= this.marks.length) return
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= this.marks.length) return
    const newMarks = [...this.marks]
    const [mark] = newMarks.splice(index, 1)
    newMarks.splice(newIndex, 0, mark)
    this.marks = newMarks
    this.selectedIndex = newIndex
  }

  /**
   * Move one element inside a 'that' mark. Returns the element's new index,
   * or the original index when the move is out of bounds.
   */
  moveThatElement(markIndex: number, elementIndex: number, direction: 'up' | 'down'): number {
    const mark = this.marks[markIndex]
    if (!mark || mark.type !== 'that') return elementIndex
    if (elementIndex < 0 || elementIndex >= mark.data.length) return elementIndex
    const target = direction === 'up' ? elementIndex - 1 : elementIndex + 1
    if (target < 0 || target >= mark.data.length) return elementIndex
    const data = [...mark.data]
    const [element] = data.splice(elementIndex, 1)
    data.splice(target, 0, element)
    this.updateThatData(markIndex, data)
    return target
  }

  /**
   * `data` has a different shape per mark type, so a single Partial<Mark> would
   * allow a 'that' mark to be handed a string. These setters are the only way
   * into a mark, which keeps each write inside one variant's shape.
   */
  private replaceMark(index: number, next: Mark): void {
    if (index < 0 || index >= this.marks.length) return
    const newMarks = [...this.marks]
    newMarks[index] = next
    this.marks = newMarks
  }

  updateLabel(index: number, label: string): void {
    const mark = this.marks[index]
    if (!mark) return
    this.replaceMark(index, { ...mark, label })
  }

  updateThisData(index: number, data: string): void {
    const mark = this.marks[index]
    if (!mark || mark.type !== 'this') return
    this.replaceMark(index, { ...mark, data })
  }

  updateThatData(index: number, data: string[]): void {
    const mark = this.marks[index]
    if (!mark || mark.type !== 'that') return
    this.replaceMark(index, { ...mark, data })
  }

  /**
   * Records what actually reached the disk. `saved` is the payload that was
   * written, not a clone of the live document, so edits made while the write was
   * in flight still count as unsaved instead of being marked clean.
   */
  markSaved(saved: MarksFile): void {
    this.originalData = structuredClone(saved)
    this.updateDirty()
  }

  getSelectedMark(): Mark | null {
    if (this.selectedIndex < 0 || this.selectedIndex >= this.marks.length) {
      return null
    }
    return this.marks[this.selectedIndex]
  }
}
