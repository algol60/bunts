import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadMarksFile, normalizeMarksFile, saveMarksFile } from '../src/file'
import type { MarksFile } from '../src/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cedit-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const write = (name: string, contents: string) => {
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

describe('loadMarksFile', () => {
  test('a missing file starts empty rather than erroring', async () => {
    const result = await loadMarksFile(join(dir, 'absent.json'))
    expect(result.kind).toBe('missing')
    expect(result.kind !== 'invalid' && result.data).toEqual({ marks: [] })
  })

  // Regression: a JSON syntax error used to be caught and reported as an empty
  // document, so saving overwrote the real file with {'marks': []}.
  test('invalid JSON is reported, never silently turned into an empty document', async () => {
    const path = write('broken.json', "{ 'marks': [ { 'type': 'this', 'data': 'KEE1' } ]")
    const result = await loadMarksFile(path)
    expect(result.kind).toBe('invalid')
    if (result.kind !== 'invalid') throw new Error('unreachable')
    expect(result.error).toContain('not valid JSON')
  })

  // Regression: an array parsed as a MarksFile lost every edit on save, because
  // JSON.stringify drops non-index properties. It is refused outright now.
  test('a non-object document is refused', async () => {
    for (const [name, body] of [['arr.json', '[]'], ['num.json', '42'], ['str.json', '"hi"'], ['null.json', 'null']]) {
      const result = await loadMarksFile(write(name, body))
      expect(result.kind).toBe('invalid')
    }
  })

  test('a valid document loads with its warnings empty', async () => {
    const path = write('ok.json', JSON.stringify({ marks: [{ type: 'this', label: 'A', data: 'AAAA' }] }))
    const result = await loadMarksFile(path)
    expect(result.kind).toBe('ok')
    if (result.kind === 'invalid') throw new Error('unreachable')
    expect(result.warnings).toEqual([])
    expect(result.data.marks).toHaveLength(1)
  })

  test('a path inside a missing directory is missing, not read as empty', async () => {
    expect((await loadMarksFile(join(dir, 'nope', 'deeper.json'))).kind).toBe('missing')
  })
})

describe('normalizeMarksFile', () => {
  const skip = (parsed: unknown) => {
    const result = normalizeMarksFile(parsed)
    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
    return result
  }
  const refuse = (parsed: unknown) => {
    const result = normalizeMarksFile(parsed)
    if (result.ok) throw new Error('expected a refusal')
    return result
  }

  test('carries every key other than marks through untouched', () => {
    const { data } = skip({ marks: [], version: 3, nested: { a: 1 }, list: [1, 2] })
    expect(data).toEqual({ marks: [], version: 3, nested: { a: 1 }, list: [1, 2] } as MarksFile)
  })

  test('a document with no marks key is valid and empty', () => {
    expect(skip({ version: 1 }).data).toEqual({ marks: [], version: 1 } as MarksFile)
  })

  test('a non-array marks key is reported', () => {
    const { data, warnings } = skip({ marks: 'nope' })
    expect(data.marks).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  test('refuses anything that is not an object', () => {
    expect(refuse([]).error).toContain('an array')
    expect(refuse(42).error).toContain('a number')
    expect(refuse(null).error).toContain('null')
  })

  // Each of these crashed the editor before normalization existed.
  test.each([
    ['a null mark', null],
    ['a non-object mark', 'nope'],
    ['an array mark', []],
    ['a missing label', { type: 'this', data: 'AAAA' }],
    ['a non-string label', { type: 'this', label: 7, data: 'AAAA' }],
    ['an unknown type', { type: 'wat', label: 'L', data: 'AAAA' }],
    ['a missing type', { label: 'L', data: 'AAAA' }],
    ["non-string 'this' data", { type: 'this', label: 'L', data: 42 }],
    ["string 'that' data", { type: 'that', label: 'L', data: 'AB:CD' }],
    ['a non-string element', { type: 'that', label: 'L', data: ['A:B', 9] }],
  ])('skips %s and explains why', (_label, bad) => {
    const { data, warnings } = skip({ marks: [bad] })
    expect(data.marks).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^Skipped marks\[0\]: /)
  })

  test('keeps good marks and skips only the bad ones', () => {
    const { data, warnings } = skip({
      marks: [
        { type: 'this', label: 'Good', data: 'AAAA' },
        { type: 'nope', label: 'Bad', data: 'AAAA' },
        { type: 'that', label: 'AlsoGood', data: ['A:B'] },
      ],
    })
    expect(data.marks.map((m) => m.label)).toEqual(['Good', 'AlsoGood'])
    expect(warnings).toHaveLength(1)
  })

  test('normalization does not alias the input', () => {
    const source = { marks: [{ type: 'that', label: 'L', data: ['A:B'] }] }
    const { data } = skip(source)
    data.marks[0]!.type === 'that' && (data.marks[0] as { data: string[] }).data.push('C:D')
    expect((source.marks[0] as { data: string[] }).data).toEqual(['A:B'])
  })
})

describe('saveMarksFile', () => {
  test('round-trips and ends with a newline', async () => {
    const path = join(dir, 'out.json')
    const data: MarksFile = { marks: [{ type: 'this', label: 'A', data: 'AAAA' }] }
    await saveMarksFile(path, data)
    const text = readFileSync(path, 'utf8')
    expect(text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(data)
  })

  test('preserves unrelated keys', async () => {
    const path = join(dir, 'out.json')
    await saveMarksFile(path, { version: 2, marks: [] } as MarksFile)
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(2)
  })

  // Regression: a plain Bun.write truncates the target first, so a failure mid-write
  // left an empty or half-written file behind.
  test('a failed write leaves the original file and no temp file behind', async () => {
    const path = write('out.json', "{'marks':[]}\n")
    const tempPath = `${path}.cedit-tmp`

    await expect(saveMarksFile(path, { marks: [{ type: 'this', label: 'A', data: 'AAAA' }] })).resolves.toBeUndefined()
    const afterGoodWrite = readFileSync(path, 'utf8')

    // Make the write fail by pointing the path inside a file rather than a dir.
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'not a directory')
    await expect(saveMarksFile(join(blocked, 'x.json'), { marks: [] })).rejects.toThrow()

    expect(readFileSync(path, 'utf8')).toBe(afterGoodWrite)
    expect(existsSync(tempPath)).toBe(false)
  })
})
