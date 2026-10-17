import { describe, expect, test } from "bun:test"
import { canonicalize, diff, hasSelectedDescendant, isImplied, samePaths, toggle } from "../src/selection"

describe("canonicalize", () => {
  test("keeps an antichain and drops covered descendants", () => {
    expect(canonicalize(["/a/b", "/a", "/c"])).toEqual(["/a", "/c"])
    expect(canonicalize(["/a/b/c", "/a/b", "/a"])).toEqual(["/a"])
  })

  test("dedupes and sorts", () => {
    expect(canonicalize(["/c", "/a", "/c", "/b"])).toEqual(["/a", "/b", "/c"])
  })

  test("does not treat a prefix of a path component as an ancestor", () => {
    expect(canonicalize(["/a-b", "/a/b"])).toEqual(["/a-b", "/a/b"])
  })

  test("empty input", () => {
    expect(canonicalize([])).toEqual([])
  })
})

describe("isImplied / hasSelectedDescendant", () => {
  test("implied only for strict descendants", () => {
    const explicit = new Set(["/a"])
    expect(isImplied(explicit, "/a/b")).toBe(true)
    expect(isImplied(explicit, "/a")).toBe(false)
    expect(isImplied(explicit, "/a-b")).toBe(false)
  })

  test("selected descendant detection", () => {
    const explicit = new Set(["/a/b/c"])
    expect(hasSelectedDescendant(explicit, "/a")).toBe(true)
    expect(hasSelectedDescendant(explicit, "/a/b/c")).toBe(false)
    expect(hasSelectedDescendant(explicit, "/a/b/c/d")).toBe(false)
  })
})

describe("toggle", () => {
  test("adds and removes an explicit selection", () => {
    const explicit = new Set<string>()
    expect(toggle(explicit, "/a")).toBe(true)
    expect([...explicit]).toEqual(["/a"])
    expect(toggle(explicit, "/a")).toBe(true)
    expect([...explicit]).toEqual([])
  })

  test("refuses a descendant of a selected directory", () => {
    const explicit = new Set(["/a"])
    expect(toggle(explicit, "/a/b")).toBe(false)
    expect([...explicit]).toEqual(["/a"])
  })

  test("selecting an ancestor clears explicit descendants", () => {
    const explicit = new Set(["/a/b", "/a/c/d", "/x"])
    expect(toggle(explicit, "/a")).toBe(true)
    expect([...explicit].sort()).toEqual(["/a", "/x"])
  })
})

describe("diff / samePaths", () => {
  test("reports added and removed paths", () => {
    expect(diff(["/a", "/b"], ["/b", "/c"])).toEqual({ added: ["/c"], removed: ["/a"] })
  })

  test("samePaths is order-insensitive", () => {
    expect(samePaths(["/a", "/b"], ["/b", "/a"])).toBe(true)
    expect(samePaths(["/a"], ["/a", "/b"])).toBe(false)
    expect(samePaths([], [])).toBe(true)
  })
})
