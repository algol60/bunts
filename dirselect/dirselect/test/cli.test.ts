import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { UsageError, parseArgs } from "../src/cli"

const HOME = "/home/tester"

describe("parseArgs", () => {
  test("$HOME is always the first root", () => {
    expect(parseArgs([], HOME).roots).toEqual([HOME])
  })

  test("positional roots follow home, in order", () => {
    const opts = parseArgs(["/srv/data", "~/projects"], HOME)
    expect(opts.roots).toEqual([HOME, "/srv/data", join(HOME, "projects")])
  })

  test("duplicate and self-referential roots are dropped", () => {
    const opts = parseArgs([HOME, "~", "/srv/data", "/srv/data"], HOME)
    expect(opts.roots).toEqual([HOME, "/srv/data"])
  })

  test("flags are parsed", () => {
    const opts = parseArgs(["--files", "--hidden", "--follow-symlinks"], HOME)
    expect(opts.showFiles).toBe(true)
    expect(opts.showHidden).toBe(true)
    expect(opts.followSymlinks).toBe(true)
  })

  test("--config expands ~ and requires a value", () => {
    expect(parseArgs(["--config", "~/ds.json"], HOME).configPath).toBe(join(HOME, "ds.json"))
    expect(() => parseArgs(["--config"], HOME)).toThrow(UsageError)
  })

  test("--help and --version", () => {
    expect(parseArgs(["-h"], HOME).help).toBe(true)
    expect(parseArgs(["--help"], HOME).help).toBe(true)
    expect(parseArgs(["-v"], HOME).version).toBe(true)
  })

  test("unknown options are rejected", () => {
    expect(() => parseArgs(["--nope"], HOME)).toThrow(UsageError)
  })

  test("a bare dash is treated as a path", () => {
    expect(parseArgs(["-"], HOME).roots).toEqual([HOME, join(process.cwd(), "-")])
  })
})
