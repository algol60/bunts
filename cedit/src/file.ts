import { rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { Mark, MarksFile } from './types'

/** Names a value's type the way a user would recognise it. */
function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  const type = typeof value
  if (type === 'object') return 'an object'
  if (type === 'string') return 'a string'
  if (type === 'undefined') return 'nothing'
  return `a ${type}`
}

export function getDefaultPath(): string {
  // os.homedir() rather than $HOME: HOME is unset on Windows, which would
  // otherwise silently redirect the default file into the working directory.
  return `${homedir()}/cedit.json`
}

/**
 * Result of loading a marks file.
 *
 * 'missing' and 'invalid' are deliberately distinct. A file that does not exist
 * is a normal first run and starts empty; a file that cannot be parsed or
 * normalized is somebody's data, and treating it as empty would overwrite it on
 * the next save.
 */
export type LoadResult =
  | { kind: 'ok'; data: MarksFile; warnings: string[] }
  | { kind: 'missing'; data: MarksFile; warnings: string[] }
  | { kind: 'invalid'; data: MarksFile; error: string }

/**
 * Coerces one entry of the `marks` array into a Mark the editor can render, or
 * returns null with the reason it was skipped.
 *
 * Nothing here invents values: an entry that cannot be represented faithfully is
 * skipped rather than guessed at, so it can never be silently rewritten into
 * something that looks valid.
 */
function normalizeMark(raw: unknown, index: number): { mark: Mark } | { reason: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { reason: `marks[${index}]: not an object` }
  }
  const entry = raw as Record<string, unknown>
  const where = `marks[${index}]`

  const type = entry['type']
  if (type !== 'this' && type !== 'that') {
    return { reason: `${where}: unknown type ${JSON.stringify(type) ?? 'undefined'}` }
  }

  const label = entry['label']
  if (typeof label !== 'string') {
    return { reason: `${where}: missing or non-string label` }
  }

  const data = entry['data']
  if (type === 'this') {
    if (typeof data !== 'string') {
      return { reason: `${where}: 'this' needs string data` }
    }
    return { mark: { type: 'this', label, data } }
  }

  if (!Array.isArray(data)) {
    return { reason: `${where}: 'that' needs an array of elements` }
  }
  const badElement = data.findIndex((elem) => typeof elem !== 'string')
  if (badElement >= 0) {
    return { reason: `${where}: data[${badElement}] is not a string` }
  }
  return { mark: { type: 'that', label, data: [...(data as string[])] } }
}

/**
 * Outcome of turning arbitrary parsed JSON into an editable document.
 *
 * `ok: false` covers documents that cannot be edited at all - a top-level array
 * or scalar. Those are refused rather than reduced to an empty mark list,
 * because editing them would mean saving a document that shares nothing with the
 * file on disk.
 */
export type NormalizeResult =
  | { ok: true; data: MarksFile; warnings: string[] }
  | { ok: false; error: string }

/**
 * Builds an editable MarksFile out of arbitrary parsed JSON.
 *
 * Every key other than `marks` is carried through untouched, which is what lets
 * the editor round-trip a file that holds more than marks. Anything in the file
 * that could not be read is reported as a warning rather than dropped silently.
 */
export function normalizeMarksFile(parsed: unknown): NormalizeResult {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: `Expected a JSON object, found ${describe(parsed)}` }
  }

  const source = parsed as Record<string, unknown>
  const carried: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key !== 'marks') carried[key] = value
  }

  const warnings: string[] = []
  const rawMarks = source['marks']
  let marks: Mark[] = []
  if (rawMarks === undefined) {
    // No marks key at all is fine: the file is simply not a cedit file yet.
  } else if (!Array.isArray(rawMarks)) {
    warnings.push(`The 'marks' key is ${describe(rawMarks)}, not an array; started with an empty mark list`)
  } else {
    rawMarks.forEach((raw, index) => {
      const result = normalizeMark(raw, index)
      if ('mark' in result) {
        marks.push(result.mark)
      } else {
        warnings.push(`Skipped ${result.reason}`)
      }
    })
  }

  return { ok: true, data: { ...carried, marks } as MarksFile, warnings }
}

export async function loadMarksFile(filePath: string): Promise<LoadResult> {
  let content: string
  try {
    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      return { kind: 'missing', data: { marks: [] }, warnings: [] }
    }
    content = await file.text()
  } catch (error) {
    return {
      kind: 'invalid',
      data: { marks: [] },
      error: `Cannot read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    // Never fall back to an empty document here: the caller would happily save
    // over a file it never understood.
    return {
      kind: 'invalid',
      data: { marks: [] },
      error: `${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const normalized = normalizeMarksFile(parsed)
  if (!normalized.ok) {
    return {
      kind: 'invalid',
      data: { marks: [] },
      error: `${filePath} is not a cedit file: ${normalized.error}`,
    }
  }
  return { kind: 'ok', data: normalized.data, warnings: normalized.warnings }
}

/**
 * Writes to a sibling temp file and renames it into place, so an interrupted or
 * failed write leaves the original file intact rather than truncated.
 */
export async function saveMarksFile(filePath: string, data: MarksFile): Promise<void> {
  const content = JSON.stringify(data, null, 2) + '\n'
  const tempPath = `${filePath}.cedit-tmp`
  try {
    await Bun.write(tempPath, content)
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {})
    throw error
  }
}
