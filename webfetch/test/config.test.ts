import { describe, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PATH,
  DEFAULT_HTTP_PORT,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  defaultDataDir,
  loadConfig,
  loadHttpConfig,
} from "../src/config.ts"
import { formatHost, hostnameOf } from "../src/lib/host.ts"
import { NAME, VERSION } from "../src/version.ts"

describe("config", () => {
  test("uses environment overrides", () => {
    const config = loadConfig({
      WEBFETCH_USER_AGENT: "custom-agent",
      WEBFETCH_HONEST_USER_AGENT: "honest-agent",
      WEBFETCH_DATA_DIR: "/tmp/webfetch-data",
      WEBFETCH_MAX_LINES: "12",
      WEBFETCH_MAX_BYTES: "34",
    })

    expect(config).toMatchObject({
      userAgent: "custom-agent",
      honestUserAgent: "honest-agent",
      dataDir: "/tmp/webfetch-data",
      maxLines: 12,
      maxBytes: 34,
    })
  })

  test("ignores invalid limits and provides product defaults", () => {
    const config = loadConfig({ WEBFETCH_MAX_LINES: "0", WEBFETCH_MAX_BYTES: "not-a-number" })

    expect(config.maxLines).toBe(DEFAULT_MAX_LINES)
    expect(config.maxBytes).toBe(DEFAULT_MAX_BYTES)
    expect(config.userAgent).toContain(`${NAME}/${VERSION}`)
    expect(config.honestUserAgent).toBe(`${NAME}/${VERSION}`)
  })

  test("resolves the data directory from XDG and ~", () => {
    expect(defaultDataDir({ XDG_DATA_HOME: "/tmp/xdg" })).toBe(join("/tmp/xdg", NAME))
    expect(defaultDataDir({ WEBFETCH_DATA_DIR: "~/webfetch" })).toBe(join(homedir(), "webfetch"))
  })

  test("keeps the advertised version in sync with package.json", async () => {
    const pkg = await Bun.file(join(import.meta.dir, "..", "package.json")).json()
    expect(VERSION).toBe(pkg.version)
  })
})

describe("HTTP config", () => {
  test("binds to loopback and accepts only loopback hosts by default", () => {
    const config = loadHttpConfig({})

    expect(config.host).toBe(DEFAULT_HTTP_HOST)
    expect(config.port).toBe(DEFAULT_HTTP_PORT)
    expect(config.path).toBe(DEFAULT_HTTP_PATH)
    expect([...config.allowedHosts].sort()).toEqual(["127.0.0.1", "::1", "localhost"])
  })

  test("reads host, port, path, and extra allowed hosts", () => {
    const config = loadHttpConfig({
      WEBFETCH_HOST: "192.168.1.5",
      WEBFETCH_PORT: "0",
      WEBFETCH_PATH: "/api/mcp///",
      WEBFETCH_ALLOWED_HOSTS: "webfetch.lan:3000, 10.0.0.2",
    })

    expect(config.host).toBe("192.168.1.5")
    expect(config.port).toBe(0)
    expect(config.path).toBe("/api/mcp")
    expect(config.allowedHosts.has("192.168.1.5")).toBe(true)
    expect(config.allowedHosts.has("webfetch.lan")).toBe(true)
    expect(config.allowedHosts.has("10.0.0.2")).toBe(true)
  })

  test("never allowlists wildcard bind addresses", () => {
    const config = loadHttpConfig({ WEBFETCH_HOST: "0.0.0.0" })
    expect(config.allowedHosts.has("0.0.0.0")).toBe(false)
    expect(config.allowedHosts.has("localhost")).toBe(true)
  })

  test("validates the port", () => {
    for (const port of ["-1", "65536", "1.5", "not-a-port"]) {
      expect(() => loadHttpConfig({ WEBFETCH_PORT: port })).toThrow(
        "WEBFETCH_PORT must be an integer between 0 and 65535",
      )
    }
    expect(loadHttpConfig({ WEBFETCH_PORT: "65535" }).port).toBe(65535)
  })

  test("validates and normalizes the path", () => {
    expect(() => loadHttpConfig({ WEBFETCH_PATH: "mcp" })).toThrow("WEBFETCH_PATH must start with /")
    expect(() => loadHttpConfig({ WEBFETCH_PATH: "/mcp?x=1" })).toThrow("must not include a query or fragment")
    expect(loadHttpConfig({ WEBFETCH_PATH: "/" }).path).toBe("/")
    expect(loadHttpConfig({ WEBFETCH_PATH: "/mcp/" }).path).toBe("/mcp")
  })
})

describe("host helpers", () => {
  test("normalizes Host and Origin values", () => {
    expect(hostnameOf("LocalHost:3000")).toBe("localhost")
    expect(hostnameOf("[::1]:3000")).toBe("::1")
    expect(hostnameOf("127.0.0.1")).toBe("127.0.0.1")
    expect(hostnameOf("  ")).toBe("")
  })

  test("brackets IPv6 addresses for URLs", () => {
    expect(formatHost("127.0.0.1")).toBe("127.0.0.1")
    expect(formatHost("::1")).toBe("[::1]")
    expect(formatHost("[::1]")).toBe("[::1]")
  })
})
