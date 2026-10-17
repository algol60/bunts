import { afterEach, describe, expect, test } from "bun:test"
import type { ConfigFile } from "../src/config"
import { loadConfig } from "../src/config"
import { fixturePaths, makeFixture } from "./fixture"
import { startApp, type Harness } from "./harness"

let harness: Harness | null = null

afterEach(async () => {
  if (harness) {
    await harness.tick()
    await harness.dispose()
    harness = null
  }
})

describe("home screen", () => {
  test("lists saved selections with their directories beneath each name", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = {
      version: 1,
      selections: [
        { name: "work", paths: [p.projects, p.notes] },
        { name: "empty", paths: [] },
      ],
    }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    expect(harness.app.currentMode).toBe("home")
    const frame = harness.captureCharFrame()
    expect(frame).toContain("selections")
    expect(frame).toContain("work")
    expect(frame).toContain(p.projects) // each directory is shown, not counted
    expect(frame).toContain(p.notes)
    expect(frame).toContain("empty")
    expect(frame).toContain("(no directories)")
    expect(frame).not.toContain("2 directories")
  })

  test("opens the highlighted selection in the explorer", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = {
      version: 1,
      selections: [{ name: "work", paths: [p.app, p.notes] }],
    }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressEnter()
    await harness.tick()

    expect(harness.app.currentMode).toBe("explorer")
    expect(harness.explicit()).toEqual([p.app, p.notes].sort())
    expect(harness.rows()).toEqual([fx.base, p.notes, p.projects, p.app, p.appDocs, p.lib])
    expect(harness.app.explorer?.currentName).toBe("work")
  })
})

describe("explorer navigation and selection", () => {
  async function openWork(): Promise<{ fx: Awaited<ReturnType<typeof makeFixture>>; p: ReturnType<typeof fixturePaths> }> {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.app] }] }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })
    harness.mockInput.pressEnter()
    await harness.tick()
    return { fx, p }
  }

  test("cursor starts on the first target and moves with keys", async () => {
    const { p } = await openWork()
    expect(harness!.app.explorer?.rows[harness!.app.explorer!.cursor]?.node.path).toBe(p.app)

    harness!.mockInput.pressKey("k")
    await harness!.tick()
    expect(harness!.app.explorer?.rows[harness!.app.explorer!.cursor]?.node.path).toBe(p.projects)

    harness!.mockInput.pressKey("HOME")
    await harness!.tick()
    expect(harness!.app.explorer?.cursor).toBe(0)

    harness!.mockInput.pressKey("\u001b[6~") // page down
    await harness!.tick()
    expect(harness!.app.explorer!.cursor).toBe(harness!.app.explorer!.rows.length - 1)

    harness!.mockInput.pressKey("END")
    await harness!.tick()
    expect(harness!.app.explorer?.rows[harness!.app.explorer!.cursor]?.node.path).toBe(p.lib)
  })

  test("selecting a directory clears and blocks descendants", async () => {
    const { p } = await openWork()
    await harness!.focusPath(p.projects)
    harness!.mockInput.pressKey(" ")
    await harness!.tick()
    expect(harness!.explicit()).toEqual([p.projects])

    const appRow = harness!.app.explorer!.rows.find((r) => r.node.path === p.app)!
    expect(appRow.implied).toBe(true)

    await harness!.focusPath(p.app)
    harness!.mockInput.pressKey(" ")
    await harness!.tick()
    expect(harness!.explicit()).toEqual([p.projects])
    expect(harness!.captureCharFrame()).toContain("cannot select")
  })

  test("partially selected ancestors render as indeterminate", async () => {
    await openWork()
    const frame = harness!.captureCharFrame()
    expect(frame).toContain("[x]")
    expect(frame).toContain("[~]")
  })

  test("f toggles files for the focused directory", async () => {
    const { p } = await openWork()
    await harness!.focusPath(p.projects)
    harness!.mockInput.pressKey("f")
    await harness!.tick()
    expect(harness!.rows()).toContain(p.readme)
    expect(harness!.captureCharFrame()).toContain("readme.md")

    harness!.mockInput.pressKey("f")
    await harness!.tick()
    expect(harness!.rows()).not.toContain(p.readme)
  })

  test("Enter folds and unfolds the focused directory", async () => {
    const { p } = await openWork()
    await harness!.focusPath(p.projects)
    harness!.mockInput.pressKey("\r")
    await harness!.tick()
    expect(harness!.rows()).not.toContain(p.app)

    harness!.mockInput.pressKey("\r")
    await harness!.tick()
    expect(harness!.rows()).toContain(p.app)
  })

  test("--files starts with files visible", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.projects] }] }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config, showFiles: true })
    harness.mockInput.pressEnter()
    await harness.tick()
    expect(harness.rows()).toContain(p.readme)
  })

  test("--hidden reveals dot-directories", async () => {
    const fx = await makeFixture()
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, showHidden: true })
    harness.mockInput.pressKey("n")
    await harness.tick()
    expect(harness.rows()).toContain(fixturePaths(fx.base).hidden)
  })
})

describe("saving and leaving", () => {
  test("leaving a clean selection does not prompt", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.projects] }] }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressEnter()
    await harness.tick()
    harness.mockInput.pressKey("q")
    await harness.tick()

    expect(harness.app.currentMode).toBe("home")
    expect(harness.captureCharFrame()).not.toContain("Unsaved changes")
  })

  test("a new selection can be saved under a new name", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath })

    harness.mockInput.pressKey("n")
    await harness.tick()
    expect(harness.app.explorer?.currentName).toBeNull()

    await harness.focusPath(p.notes)
    harness.mockInput.pressKey(" ")
    await harness.focusPath(p.projects)
    harness.mockInput.pressKey(" ")
    await harness.tick()
    expect(harness.explicit()).toEqual([p.notes, p.projects].sort())

    harness.mockInput.pressKey("q")
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("Unsaved changes")

    harness.mockInput.pressKey("y")
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("Save new selection")

    await harness.mockInput.pressKeys(["f", "r", "e", "s", "h"])
    harness.mockInput.pressEnter()
    await harness.tick()

    expect(harness.app.currentMode).toBe("home")
    const saved = await loadConfig(fx.configPath)
    expect(saved.selections.map((s) => s.name)).toEqual(["fresh"])
    expect(saved.selections[0]!.paths).toEqual([p.notes, p.projects].sort())
    expect(harness.captureCharFrame()).toContain("fresh")
  })

  test("a key that opens the save prompt is not typed into it", async () => {
    const fx = await makeFixture()
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath })

    harness.mockInput.pressKey("n")
    await harness.tick()
    harness.mockInput.pressKey("s")
    await harness.tick()

    const frame = harness.captureCharFrame()
    expect(frame).toContain("Save new selection")
    expect(frame).toContain("name") // the placeholder, i.e. the field is empty
    expect(frame).not.toContain("sname")
  })

  test("Escape cancels the save prompt", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.projects] }] }
    harness = await startApp({
      roots: [fx.base],
      configPath: fx.configPath,
      config,
      kittyKeyboard: true,
    })

    harness.mockInput.pressEnter()
    await harness.tick()
    await harness.focusPath(p.notes)
    harness.mockInput.pressKey(" ")
    await harness.tick()
    harness.mockInput.pressKey("s")
    await harness.tick()
    expect(harness.app.currentMode).toBe("modal")

    harness.mockInput.pressEscape()
    await harness.tick()
    expect(harness.app.currentMode).toBe("explorer")
  })

  test("saving over an existing name asks for confirmation", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = {
      version: 1,
      selections: [
        { name: "work", paths: [p.projects] },
        { name: "other", paths: [] },
      ],
    }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressEnter()
    await harness.tick()
    await harness.focusPath(p.notes)
    harness.mockInput.pressKey(" ")
    await harness.tick()
    harness.mockInput.pressKey("s")
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("Save selection")

    // replace the prefilled "work" with "other"
    await harness.mockInput.pressKeys(["BACKSPACE", "BACKSPACE", "BACKSPACE", "BACKSPACE", "o", "t", "h", "e", "r"])
    harness.mockInput.pressEnter()
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("already exists")

    harness.mockInput.pressKey("y")
    await harness.tick()
    const saved = await loadConfig(fx.configPath)
    expect(saved.selections.map((s) => s.name)).toEqual(["work", "other"])
    expect(saved.selections.find((s) => s.name === "other")!.paths).toEqual([p.notes, p.projects].sort())
    expect(saved.selections.find((s) => s.name === "work")!.paths).toEqual([p.projects])
  })

  test("an empty name is rejected inside the dialog", async () => {
    const fx = await makeFixture()
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath })

    harness.mockInput.pressKey("n")
    await harness.tick()
    harness.mockInput.pressKey("s")
    await harness.tick()
    harness.mockInput.pressEnter()
    await harness.tick()

    expect(harness.app.currentMode).toBe("modal")
    expect(harness.captureCharFrame()).toContain("a name is required")
  })

  test("quitting from the explorer runs the save flow, then exits", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.projects] }] }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressEnter()
    await harness.tick()
    await harness.focusPath(p.notes)
    harness.mockInput.pressKey(" ")
    await harness.tick()

    harness.mockInput.pressCtrlC()
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("Unsaved changes")
    harness.mockInput.pressKey("n") // discard
    await harness.tick()
    await harness.done // the app resolved

    // Discarded changes are not written back.
    const saved = await loadConfig(fx.configPath)
    expect(saved.selections).toEqual([])
  })

  test("q on home quits", async () => {
    const fx = await makeFixture()
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath })
    harness.mockInput.pressKey("q")
    await harness.tick()
    await harness.done
    expect(harness.app.currentMode).toBe("home")
  })
})

describe("home mutations", () => {
  test("n starts an unsaved selection", async () => {
    const fx = await makeFixture()
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath })
    harness.mockInput.pressKey("n")
    await harness.tick()
    expect(harness.app.currentMode).toBe("explorer")
    expect(harness.app.explorer?.currentName).toBeNull()
    expect(harness.captureCharFrame()).toContain("unsaved")
  })

  test("rename saves the new name", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.projects] }] }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressKey("r")
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("Rename selection")
    await harness.mockInput.pressKeys(["BACKSPACE", "BACKSPACE", "BACKSPACE", "BACKSPACE", "j", "o", "b"])
    harness.mockInput.pressEnter()
    await harness.tick()

    expect(harness.app.currentMode).toBe("home")
    const saved = await loadConfig(fx.configPath)
    expect(saved.selections.map((s) => s.name)).toEqual(["job"])
    expect(saved.selections[0]!.paths).toEqual([p.projects])
    expect(harness.captureCharFrame()).toContain("job")
  })

  test("delete removes the selection after confirmation", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = {
      version: 1,
      selections: [
        { name: "work", paths: [p.projects] },
        { name: "keep", paths: [] },
      ],
    }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressKey("d")
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("Delete selection")
    harness.mockInput.pressKey("y")
    await harness.tick()

    const saved = await loadConfig(fx.configPath)
    expect(saved.selections.map((s) => s.name)).toEqual(["keep"])
  })
})

describe("preset edge cases", () => {
  test("paths outside the roots are reported and skipped", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.app] }] }
    harness = await startApp({ roots: [p.notes], configPath: fx.configPath, config })

    harness.mockInput.pressEnter()
    await harness.tick()
    expect(harness.explicit()).toEqual([])
    expect(harness.captureCharFrame()).toContain("outside the roots")
  })

  test("missing paths become error rows and are not selected", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const gone = `${p.projects}/ghost/deeper`
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [gone] }] }
    harness = await startApp({ roots: [fx.base], configPath: fx.configPath, config })

    harness.mockInput.pressEnter()
    await harness.tick()
    expect(harness.explicit()).toEqual([])
    expect(harness.rows()).toContain(gone)
    expect(harness.captureCharFrame()).toContain("not found")
    expect(harness.captureCharFrame()).toContain("missing path")
  })

  test("an unwritable config path reports an error instead of throwing", async () => {
    const fx = await makeFixture()
    const p = fixturePaths(fx.base)
    const config: ConfigFile = { version: 1, selections: [{ name: "work", paths: [p.projects] }] }
    harness = await startApp({
      roots: [fx.base],
      configPath: "/proc/definitely/not/writable/config.json",
      config,
    })
    harness.mockInput.pressEnter()
    await harness.tick()
    await harness.focusPath(p.notes)
    harness.mockInput.pressKey(" ")
    await harness.tick()
    harness.mockInput.pressKey("s")
    await harness.tick()
    harness.mockInput.pressEnter()
    await harness.tick()
    expect(harness.captureCharFrame()).toContain("could not save")
  })
})
