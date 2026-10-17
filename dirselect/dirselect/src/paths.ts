import { homedir } from "node:os"
import { basename as pathBasename, isAbsolute, normalize, resolve, sep } from "node:path"

/** Replace a leading `~` (alone or followed by `/`) with `home`. */
export function expandHome(p: string, home: string = homedir()): string {
  if (p === "~") return home
  if (p.startsWith("~/")) return resolve(home, p.slice(2))
  return p
}

/**
 * Absolute, normalized, no trailing slash. Does **not** resolve symlinks, so
 * comparison is purely lexical and fast.
 */
export function canonical(p: string, home: string = homedir()): string {
  let out = expandHome(p, home)
  if (!isAbsolute(out)) out = resolve(out)
  out = normalize(out)
  if (out.length > 1 && out.endsWith(sep)) out = out.slice(0, -1)
  return out
}

/** True when `child` is strictly below `ancestor` in the lexical tree. */
export function isDescendantOf(child: string, ancestor: string): boolean {
  if (child === ancestor) return false
  const prefix = ancestor.endsWith(sep) ? ancestor : ancestor + sep
  return child.startsWith(prefix)
}

/** `~`-shortened form for display. */
export function displayPath(p: string, home: string = homedir()): string {
  if (p === home) return "~"
  return p.startsWith(home + sep) ? "~" + p.slice(home.length) : p
}

/** Basename that falls back to the full path for filesystem roots. */
export function baseName(p: string): string {
  const b = pathBasename(p)
  return b === "" ? p : b
}

/** Join without normalizing, so `/` + `name` becomes `/name`. */
export function joinPath(parent: string, name: string): string {
  return parent.endsWith(sep) ? parent + name : parent + sep + name
}

/** Path components of `descendant` below `ancestor` (`[]` when equal). */
export function relativeParts(ancestor: string, descendant: string): string[] {
  if (descendant === ancestor) return []
  const prefix = ancestor.endsWith(sep) ? ancestor : ancestor + sep
  if (!descendant.startsWith(prefix)) return []
  return descendant
    .slice(prefix.length)
    .split(sep)
    .filter((part) => part.length > 0)
}
