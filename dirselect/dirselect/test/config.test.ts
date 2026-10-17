import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  ConfigError,
  emptyConfig,
  findSelection,
  loadConfig,
  normalizeConfig,
  removeSelection,
  renameSelection,
  saveConfig,
  upsertSelection,
} from "../src/config"

describe("normalizeConfig", () => {
  test("accepts a well-formed config", () => {
    const config = normalizeConfig({
      version: 1,
      selections: [{ name: "work", paths: ["/a/b", "/c"] }],
    })
    expect(config).toEqual({ version: 1, selections: [{ name: "work", paths: ["/a/b", "/c"] }] })
  })

  test("survives garbage", () => {
    expect(normalizeConfig(null)).toEqual(emptyConfig())
    expect(normalizeConfig(42)).toEqual(emptyConfig())
    expect(normalizeConfig({ selections: "nope" })).toEqual(emptyConfig())
    expect(normalizeConfig({ selections: [null, 7, {}, { name: "  " }] })).toEqual(emptyConfig())
  })

  test("drops non-string paths and reduces ancestors", () => {
    const config = normalizeConfig({
      selections: [{ name: "x", paths: ["/a", 5, null, "/a/b", "/c"] }],
    })
    expect(config.selections[0]!.paths).toEqual(["/a", "/c"])
  })

  test("trims names and keeps the last duplicate", () => {
    const config = normalizeConfig({
      selections: [
        { name: "work", paths: ["/one"] },
        { name: " work ", paths: ["/two"] },
      ],
    })
    expect(config.selections).toEqual([{ name: "work", paths: ["/two"] }])
  })

  test("missing paths become an empty list", () => {
    const config = normalizeConfig({ selections: [{ name: "empty" }] })
    expect(config.selections).toEqual([{ name: "empty", paths: [] }])
  })
})

describe("loadConfig / saveConfig", () => {
  test("missing file loads as empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dirselect-cfg-"))
    expect(await loadConfig(join(dir, "nope.json"))).toEqual(emptyConfig())
  })

  test("round-trips through an atomic write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dirselect-cfg-"))
    const path = join(dir, "nested", "config.json")
    const config = { version: 1 as const, selections: [{ name: "work", paths: ["/a", "/b"] }] }
    await saveConfig(path, config)
    expect(await loadConfig(path)).toEqual(config)
    expect(await readFile(path, "utf8")).toContain('\n  "selections"')
  })

  test("a corrupt file raises ConfigError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dirselect-cfg-"))
    const path = join(dir, "config.json")
    await writeFile(path, "{ not json")
    await expect(loadConfig(path)).rejects.toBeInstanceOf(ConfigError)
  })

  test("unknown top-level keys are ignored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dirselect-cfg-"))
    const path = join(dir, "config.json")
    await writeFile(path, JSON.stringify({ version: 9, extra: true, selections: [{ name: "a", paths: [] }] }))
    expect(await loadConfig(path)).toEqual({ version: 1, selections: [{ name: "a", paths: [] }] })
  })
})

describe("config mutations", () => {
  test("upsert appends then replaces in place", () => {
    const config = emptyConfig()
    upsertSelection(config, "a", ["/a"])
    upsertSelection(config, "b", ["/b"])
    upsertSelection(config, "a", ["/a2"])
    expect(config.selections).toEqual([
      { name: "a", paths: ["/a2"] },
      { name: "b", paths: ["/b"] },
    ])
  })

  test("upsert canonicalizes paths", () => {
    const config = emptyConfig()
    upsertSelection(config, "a", ["/x", "/x/y", "/z"])
    expect(config.selections[0]!.paths).toEqual(["/x", "/z"])
  })

  test("remove and rename", () => {
    const config = emptyConfig()
    upsertSelection(config, "a", [])
    upsertSelection(config, "b", [])
    expect(removeSelection(config, "a")).toBe(true)
    expect(removeSelection(config, "a")).toBe(false)
    expect(renameSelection(config, "b", "c")).toBe(true)
    expect(findSelection(config, "c")?.name).toBe("c")
    expect(findSelection(config, "b")).toBeUndefined()
  })
})
