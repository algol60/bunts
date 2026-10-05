export const THIS_DATA_REGEX = /^[A-Z0-9]{4}$/
export const THAT_ELEMENT_REGEX = /^[A-Z._]+:[A-Z._]+$/

export function validateThisData(data: unknown): string | null {
  if (typeof data !== 'string' || !THIS_DATA_REGEX.test(data)) {
    return 'Data must be exactly 4 characters (A-Z, 0-9)'
  }
  return null
}

export function validateThatElement(element: unknown): string | null {
  if (typeof element !== 'string' || !element.trim()) {
    return 'Element cannot be empty'
  }
  if (!THAT_ELEMENT_REGEX.test(element)) {
    return 'Element must be in format WORDA:WORDB (A-Z, ., _ only)'
  }
  return null
}

export type MarkFields = { type: unknown, data: unknown }

/**
 * Returns one message per failing field, keyed by field name. Fields that pass
 * are omitted, so an empty result means the mark is valid.
 */
export function validateMarkData(mark: MarkFields): Record<string, string> {
  const errors: Record<string, string> = {}

  if (mark.type === 'this') {
    const err = validateThisData(mark.data)
    if (err) errors['data'] = err
  } else if (mark.type === 'that') {
    if (!Array.isArray(mark.data)) {
      errors['data'] = 'Data must be an array'
      return errors
    }
    if (mark.data.length === 0) {
      errors['data'] = 'A "that" mark needs at least one element'
      return errors
    }
    (mark.data as unknown[]).forEach((elem, idx) => {
      const err = validateThatElement(elem)
      if (err) {
        errors[`data[${idx}]`] = err
      }
    })
  } else {
    // An unrecognised type would otherwise sail through: the editor has no
    // branch to render it and no rule to check its data against.
    errors['type'] = `Unknown mark type ${JSON.stringify(mark.type) ?? 'undefined'} (expected "this" or "that")`
  }

  return errors
}
