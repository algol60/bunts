import { describe, expect, test } from "bun:test"
import { symlink } from "node:fs/promises"
import { join } from "node:path"
import { buildRows, createNode, createRoot, findNode, guidePrefix, loadChildren, revealPath, type TreeOptions, type TreeNode } from "../src/tree"
import { fixturePaths, makeFixture } from "./fixture"

const opts: TreeOptions = { showHidden: false, followSymlinks: false, showFiles: false }

function dir(path: string, parent: TreeNode | null, depth: number): TreeNode {
  const node = createNode({ path, kind: "dir", depth, parent })
  node.loaded = true
  node.dirs = []
  return node
}

/** root("~") > { projects > { app, lib }, notes } with projects expanded. */
function sampleTree(): TreeNode {
  const root = createRoot("/r", "~", opts)
  const projects = dir("/r/projects", root, 1)
  const notes = dir("/r/notes", root, 1)
  projects.dirs = [dir("/r/projects/app", projects, 2), dir("/r/projects/lib", projects, 2)]
  projects.expanded = true
  root.dirs = [projects, notes]
  return root
}

describe("buildRows", () => {
  test("emits the visible rows in order with depth", () => {
    const rows = buildRows([sampleTree()], new Set())
    expect(rows.map((r) => r.node.path)).toEqual([
      "/r",
      "/r/projects",
      "/r/projects/app",
      "/r/projects/lib",
      "/r/notes",
    ])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1])
  })

  test("roots get no ancestors and children get guides", () => {
    const rows = buildRows([sampleTree()], new Set())
    const root = rows[0]!
    expect(root.ancestorLast).toEqual([])
    expect(root.isLast).toBe(true)

    const projects = rows[1]!
    expect(projects.ancestorLast).toEqual([])
    expect(projects.isLast).toBe(false)
    expect(guidePrefix(projects.ancestorLast, projects.isLast)).toBe("├─ ")

    const app = rows[2]!
    expect(guidePrefix(app.ancestorLast, app.isLast)).toBe("│  ├─ ")
    const lib = rows[3]!
    expect(guidePrefix(lib.ancestorLast, lib.isLast)).toBe("│  └─ ")

    const notes = rows[4]!
    expect(guidePrefix(notes.ancestorLast, notes.isLast)).toBe("└─ ")
  })

  test("an explicit selection marks descendants implied", () => {
    const rows = buildRows([sampleTree()], new Set(["/r/projects"]))
    const projects = rows.find((r) => r.node.path === "/r/projects")!
    expect(projects.selected).toBe(true)
    expect(projects.implied).toBe(false)

    const app = rows.find((r) => r.node.path === "/r/projects/app")!
    expect(app.selected).toBe(false)
    expect(app.implied).toBe(true)

    const root = rows[0]!
    expect(root.implied).toBe(false)
    expect(root.partial).toBe(true)
  })

  test("a selected descendant marks the ancestor partial, not implied", () => {
    const rows = buildRows([sampleTree()], new Set(["/r/projects/app"]))
    const projects = rows.find((r) => r.node.path === "/r/projects")!
    expect(projects.partial).toBe(true)
    expect(projects.implied).toBe(false)
    expect(projects.selected).toBe(false)
    const root = rows[0]!
    expect(root.partial).toBe(true)
  })

  test("partial is derived even when the descendant is not loaded", () => {
    const root = createRoot("/r", "~", opts)
    root.dirs = [dir("/r/projects", root, 1)] // collapsed, so nothing below is visible
    const rows = buildRows([root], new Set(["/r/projects/deep/inside"]))
    const projects = rows.find((r) => r.node.path === "/r/projects")!
    expect(projects.partial).toBe(true)
  })

  test("showFiles appends files after directories", () => {
    const root = createRoot("/r", "~", opts)
    root.showFiles = true
    const projects = dir("/r/projects", root, 1)
    projects.showFiles = true
    projects.files = [createNode({ path: "/r/projects/readme.md", kind: "file", depth: 2, parent: projects })]
    projects.expanded = true
    root.dirs = [projects]
    root.expanded = true

    const rows = buildRows([root], new Set())
    expect(rows.map((r) => r.node.name)).toEqual(["~", "projects", "readme.md"])
  })

  test("hidden roots are not special-cased", () => {
    const rows = buildRows([sampleTree()], new Set())
    expect(rows.length).toBe(5)
  })
})

describe("loadChildren", () => {
  test("lists directories and files, skipping hidden entries", async () => {
    const { base } = await makeFixture()
    const root = createRoot(base, "~", opts)
    await loadChildren(root, opts)

    expect(root.error).toBeUndefined()
    expect((root.dirs ?? []).map((d) => d.name)).toEqual(["notes", "projects"])
    expect(root.files.map((f) => f.name)).toEqual([])
  })

  test("showHidden includes dot-directories", async () => {
    const { base } = await makeFixture()
    const hiddenOpts: TreeOptions = { ...opts, showHidden: true }
    const root = createRoot(base, "~", hiddenOpts)
    await loadChildren(root, hiddenOpts)
    expect((root.dirs ?? []).map((d) => d.name)).toContain(".hidden")
  })

  test("errors are captured, not thrown", async () => {
    const root = createRoot("/definitely/not/here", "gone", opts)
    await loadChildren(root, opts)
    expect(root.error).toBeTruthy()
    expect(root.dirs).toEqual([])
  })

  test("files are listed when a directory is loaded", async () => {
    const { base } = await makeFixture()
    const p = fixturePaths(base)
    const projects = createNode({ path: p.projects, kind: "dir", depth: 1, parent: null })
    await loadChildren(projects, opts)
    expect((projects.dirs ?? []).map((d) => d.name)).toEqual(["app", "lib"])
    expect(projects.files.map((f) => f.name)).toEqual(["readme.md"])
  })
})

describe("revealPath", () => {
  test("expands the ancestor chain down to the target", async () => {
    const { base } = await makeFixture()
    const p = fixturePaths(base)
    const root = createRoot(base, "~", opts)
    await loadChildren(root, opts)

    const node = await revealPath(root, p.core, opts)
    expect(node.path).toBe(p.core)
    expect(root.expanded).toBe(true)
    expect(findNode([root], p.lib)?.expanded).toBe(true)
    expect(node.expanded).toBe(true) // the target itself is expanded too
  })

  test("missing components become error rows", async () => {
    const { base } = await makeFixture()
    const p = fixturePaths(base)
    const root = createRoot(base, "~", opts)
    await loadChildren(root, opts)

    const node = await revealPath(root, join(p.projects, "nope", "deeper"), opts)
    expect(node.error).toBe("not found")
    expect(node.path).toBe(join(p.projects, "nope", "deeper"))
    // visible in the tree under projects
    expect(findNode([root], node.path)?.error).toBe("not found")
  })
})

describe("symlinks", () => {
  test("symlinked directories are skipped when not following", async () => {
    const { base } = await makeFixture()
    await symlink(join(base, "notes"), join(base, "link-to-notes"))

    const root = createRoot(base, "~", opts)
    await loadChildren(root, opts)
    expect((root.dirs ?? []).map((d) => d.name)).not.toContain("link-to-notes")
  })

  test("symlinked directories are followed when enabled", async () => {
    const { base } = await makeFixture()
    await symlink(join(base, "notes"), join(base, "link-to-notes"))
    const followOpts: TreeOptions = { ...opts, followSymlinks: true }

    const root = createRoot(base, "~", followOpts)
    await loadChildren(root, followOpts)
    const link = (root.dirs ?? []).find((d) => d.name === "link-to-notes")
    expect(link?.kind).toBe("dir")
    expect(link?.error).toBeUndefined() // points sideways, not at an ancestor
  })

  test("a symlink cycle is flagged instead of recursing", async () => {
    const { base } = await makeFixture()
    // notes/loop -> base, so resolving it lands on an ancestor.
    await symlink(base, join(base, "notes", "loop"))
    const followOpts: TreeOptions = { ...opts, followSymlinks: true }

    const root = createRoot(base, "~", followOpts)
    await loadChildren(root, followOpts)
    const notes = (root.dirs ?? []).find((d) => d.name === "notes")!
    await loadChildren(notes, followOpts)

    const loop = (notes.dirs ?? []).find((d) => d.name === "loop")
    expect(loop?.error).toBe("symlink cycle")
  })
})
