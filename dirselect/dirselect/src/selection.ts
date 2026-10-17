import { isDescendantOf } from "./paths"

/**
 * Reduce a path list to the antichain of explicit selections: sort (so an
 * ancestor always precedes its descendants), then drop anything already
 * covered by a kept ancestor.
 */
export function canonicalize(paths: readonly string[]): string[] {
  const sorted = [...new Set(paths)].sort()
  const out: string[] = []
  for (const p of sorted) {
    if (out.some((a) => isDescendantOf(p, a))) continue
    out.push(p)
  }
  return out
}

/** True when some ancestor of `dir` is explicitly selected. */
export function isImplied(explicit: ReadonlySet<string>, dir: string): boolean {
  for (const p of explicit) if (isDescendantOf(dir, p)) return true
  return false
}

/** The explicitly selected ancestor of `dir`, if any (handy for messages). */
export function selectedAncestor(explicit: ReadonlySet<string>, dir: string): string | undefined {
  for (const p of explicit) if (isDescendantOf(dir, p)) return p
  return undefined
}

/** True when some explicit selection lives strictly below `dir`. */
export function hasSelectedDescendant(explicit: ReadonlySet<string>, dir: string): boolean {
  for (const p of explicit) if (isDescendantOf(p, dir)) return true
  return false
}

/**
 * Toggle a directory's checkbox. Refused when an ancestor is selected
 * (implied). Selecting a directory drops every explicit selection beneath it,
 * which keeps the set an antichain.
 *
 * @returns `true` when the set changed, `false` when the toggle was refused.
 */
export function toggle(explicit: Set<string>, dir: string): boolean {
  if (isImplied(explicit, dir)) return false
  if (explicit.has(dir)) {
    explicit.delete(dir)
    return true
  }
  explicit.add(dir)
  for (const p of [...explicit]) {
    if (p !== dir && isDescendantOf(p, dir)) explicit.delete(p)
  }
  return true
}

export interface PathDiff {
  added: string[]
  removed: string[]
}

/** Set difference between two path lists (order-insensitive). */
export function diff(a: readonly string[], b: readonly string[]): PathDiff {
  const A = new Set(a)
  const B = new Set(b)
  return {
    added: b.filter((x) => !A.has(x)),
    removed: a.filter((x) => !B.has(x)),
  }
}

/** Order-insensitive equality, used for the dirty check. */
export function samePaths(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((p) => set.has(p))
}
