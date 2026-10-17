import { promises as fs } from "node:fs"
import { baseName, joinPath, relativeParts } from "./paths"
import { hasSelectedDescendant } from "./selection"

export type NodeKind = "dir" | "file"

/**
 * One filesystem entry in the lazily-loaded tree. Directories keep their
 * sub-directories and files in separate lists so `expanded` (show
 * sub-directories) and `showFiles` (also show files) stay independent.
 */
export interface TreeNode {
  /** Absolute path; also the stable id used by the row pool. */
  readonly path: string
  /** Basename, except roots which carry their display path. */
  readonly name: string
  readonly kind: NodeKind
  readonly depth: number
  parent: TreeNode | null
  /** Sub-directories; `null` until loaded. */
  dirs: TreeNode[] | null
  files: TreeNode[]
  loaded: boolean
  expanded: boolean
  showFiles: boolean
  /** `EACCES`/`ENOENT`/`symlink cycle`, rendered inline. */
  error?: string
  /** Resolved path, only tracked while following symlinks (cycle guard). */
  realPath?: string
}

export interface TreeOptions {
  readonly showHidden: boolean
  readonly followSymlinks: boolean
  readonly showFiles: boolean
}

/** A visible line in the explorer, derived from the tree on every change. */
export interface Row {
  readonly node: TreeNode
  readonly depth: number
  readonly selected: boolean
  /** An ancestor is selected, so the checkbox is checked but disabled. */
  readonly implied: boolean
  /** Not selected itself, but a descendant is. */
  readonly partial: boolean
  readonly isLast: boolean
  /** `true` when the ancestor at that level is the last of its siblings. */
  readonly ancestorLast: readonly boolean[]
}

export function createNode(init: {
  path: string
  name?: string
  kind: NodeKind
  depth: number
  parent: TreeNode | null
  showFiles?: boolean
  error?: string
}): TreeNode {
  const isDir = init.kind === "dir"
  return {
    path: init.path,
    name: init.name ?? baseName(init.path),
    kind: init.kind,
    depth: init.depth,
    parent: init.parent,
    dirs: isDir ? null : [],
    files: [],
    loaded: !isDir,
    expanded: false,
    showFiles: init.showFiles ?? false,
    error: init.error,
  }
}

/** Roots are always directories, start expanded, and use their display path. */
export function createRoot(path: string, name: string, opts: TreeOptions): TreeNode {
  const node = createNode({ path, name, kind: "dir", depth: 0, parent: null, showFiles: opts.showFiles })
  node.expanded = true
  return node
}

function errorText(err: unknown): string {
  const e = err as NodeJS.ErrnoException
  if (e && typeof e === "object" && typeof e.code === "string") return e.code
  if (err instanceof Error) return err.message
  return String(err)
}

/** Real paths of `node` and every ancestor, for symlink cycle detection. */
async function ancestorRealPaths(node: TreeNode): Promise<Set<string>> {
  const set = new Set<string>()
  const chain: TreeNode[] = []
  for (let cur: TreeNode | null = node; cur; cur = cur.parent) chain.unshift(cur)
  for (const n of chain) {
    let rp = n.realPath
    if (!rp) {
      try {
        rp = await fs.realpath(n.path)
      } catch {
        continue
      }
      n.realPath = rp
    }
    set.add(rp)
  }
  return set
}

const byName = (a: TreeNode, b: TreeNode): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true })

/** Read one directory level into `node`. Idempotent; failures become `error`. */
export async function loadChildren(node: TreeNode, opts: TreeOptions): Promise<void> {
  if (node.loaded) return
  node.loaded = true
  if (node.kind !== "dir") {
    node.dirs = []
    return
  }

  try {
    const entries = await fs.readdir(node.path, { withFileTypes: true })
    const dirs: TreeNode[] = []
    const files: TreeNode[] = []
    const ancestors = opts.followSymlinks ? await ancestorRealPaths(node) : null

    for (const entry of entries) {
      const name = entry.name
      if (!opts.showHidden && name.startsWith(".")) continue
      const childPath = joinPath(node.path, name)

      let isDir = entry.isDirectory()
      let isFile = entry.isFile()
      if (entry.isSymbolicLink()) {
        if (!opts.followSymlinks) continue
        try {
          const stat = await fs.stat(childPath)
          isDir = stat.isDirectory()
          isFile = stat.isFile()
        } catch {
          continue
        }
      }

      if (isDir) {
        const child = createNode({
          path: childPath,
          kind: "dir",
          depth: node.depth + 1,
          parent: node,
          showFiles: opts.showFiles,
        })
        if (ancestors) {
          try {
            const real = await fs.realpath(childPath)
            child.realPath = real
            if (ancestors.has(real)) child.error = "symlink cycle"
          } catch {
            /* unreadable realpath: leave as a normal directory */
          }
        }
        dirs.push(child)
      } else if (isFile) {
        files.push(createNode({ path: childPath, kind: "file", depth: node.depth + 1, parent: node }))
      }
    }

    dirs.sort(byName)
    files.sort(byName)
    node.dirs = dirs
    node.files = files
  } catch (err) {
    node.error = errorText(err)
    node.dirs = []
    node.files = []
  }
}

/** Tree guides for a non-root row: `│  ` per ancestor, then `├─ `/`└─ `. */
export function guidePrefix(ancestorLast: readonly boolean[], isLast: boolean): string {
  let s = ""
  for (const last of ancestorLast) s += last ? "   " : "│  "
  return s + (isLast ? "└─ " : "├─ ")
}

/**
 * Flatten the tree into the visible rows. `implied` and `partial` are derived
 * from the explicit selection set, never stored, so unloaded subtrees are
 * handled correctly for free.
 */
export function buildRows(roots: readonly TreeNode[], explicit: ReadonlySet<string>): Row[] {
  const rows: Row[] = []

  const visit = (node: TreeNode, ancestorLast: boolean[], isLast: boolean, ancestorSelected: boolean): void => {
    const isDir = node.kind === "dir"
    const selected = isDir && explicit.has(node.path)
    const implied = isDir && ancestorSelected
    const partial = isDir && !selected && !implied && hasSelectedDescendant(explicit, node.path)

    rows.push({ node, depth: node.depth, selected, implied, partial, isLast, ancestorLast })

    if (isDir && node.expanded && node.dirs) {
      const kids = node.showFiles ? [...node.dirs, ...node.files] : node.dirs
      const childAncestorLast = node.depth === 0 ? [] : [...ancestorLast, isLast]
      kids.forEach((kid, i) => visit(kid, childAncestorLast, i === kids.length - 1, ancestorSelected || selected))
    }
  }

  roots.forEach((root, i) => visit(root, [], i === roots.length - 1, false))
  return rows
}

export function findNode(roots: readonly TreeNode[], path: string): TreeNode | undefined {
  const stack: TreeNode[] = [...roots]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.path === path) return node
    if (node.dirs) stack.push(...node.dirs)
  }
  return undefined
}

/** Append an error chain beneath `parent` for path components that are gone. */
function ensureErrorChain(parent: TreeNode, parts: readonly string[], reason = "not found"): TreeNode {
  let node = parent
  for (const part of parts) {
    node.expanded = true
    const dirs = node.dirs ?? []
    const child =
      dirs.find((d) => d.name === part) ??
      createNode({
        path: joinPath(node.path, part),
        name: part,
        kind: "dir",
        depth: node.depth + 1,
        parent: node,
        error: reason,
      })
    if (!dirs.includes(child)) node.dirs = [...dirs, child]
    node = child
  }
  return node
}

/**
 * Expand the ancestor chain from `root` down to `target` and return the node
 * for `target`. Missing/unreadable levels become error rows so the target is
 * still visible (and reported) rather than silently dropped.
 */
export async function revealPath(root: TreeNode, target: string, opts: TreeOptions): Promise<TreeNode> {
  if (target === root.path) return root

  const parts = relativeParts(root.path, target)
  let node = root
  for (let i = 0; i < parts.length; i++) {
    if (!node.loaded && !node.error) await loadChildren(node, opts)
    if (node.error) return ensureErrorChain(node, parts.slice(i), node.error)
    const child = (node.dirs ?? []).find((d) => d.name === parts[i])
    if (!child) return ensureErrorChain(node, parts.slice(i))
    node.expanded = true
    node = child
  }
  // Expand the target too, so its contents are visible once the preset loads.
  if (!node.loaded && !node.error) await loadChildren(node, opts)
  if (!node.error) node.expanded = true
  return node
}
