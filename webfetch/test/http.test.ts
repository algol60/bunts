import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { loadConfig, type Config, type HttpConfig } from "../src/config.ts"
import { isAllowedRequest, startHttp, type RunningHttpServer } from "../src/http.ts"

const origins: Array<ReturnType<typeof Bun.serve>> = []
const endpoints: RunningHttpServer[] = []
const directories: string[] = []

afterEach(async () => {
  for (const server of origins.splice(0)) await server.stop(true)
  for (const endpoint of endpoints.splice(0)) await endpoint.server.stop(true)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const httpConfig = (overrides: Partial<HttpConfig> = {}): HttpConfig => ({
  host: "127.0.0.1",
  port: 0,
  path: "/mcp",
  allowedHosts: new Set(["127.0.0.1", "localhost", "::1"]),
  ...overrides,
})

const testConfig = async (overrides: Partial<Config> = {}): Promise<Config> => {
  const dataDir = await mkdtemp(join(tmpdir(), "opencode-webfetch-http-"))
  directories.push(dataDir)
  return { ...loadConfig({}), dataDir, ...overrides }
}

const start = async (overrides: Partial<HttpConfig> = {}) => {
  const endpoint = startHttp(await testConfig({ maxLines: 5, maxBytes: 1_000 }), httpConfig(overrides))
  endpoints.push(endpoint)
  return endpoint
}

const texts = (result: unknown) => {
  const content = (result as { content?: unknown }).content
  return (Array.isArray(content) ? (content as Array<{ type: string; text?: string }>) : []).flatMap((part) =>
    part.type === "text" && part.text !== undefined ? [part.text] : [],
  )
}

const initializeBody = (id = 1) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "http-test", version: "1.1.0" } },
  })

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body,
  })

describe("MCP server over Streamable HTTP", () => {
  test("lists and calls the webfetch tool with a stateless client", async () => {
    const origin = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/lines") {
          return new Response("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight", {
            headers: { "content-type": "text/plain" },
          })
        }
        return new Response("<h1>Hello</h1><p>world</p>", { headers: { "content-type": "text/html" } })
      },
    })
    origins.push(origin)

    const endpoint = await start()
    const client = new Client({ name: "webfetch-http-test", version: "1.1.0" })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url)))

    try {
      const listed = await client.listTools()
      const tool = listed.tools.find((candidate) => candidate.name === "webfetch")
      expect(tool).toBeDefined()
      expect(tool?.annotations?.readOnlyHint).toBe(true)

      const result = await client.callTool({
        name: "webfetch",
        arguments: { url: `http://127.0.0.1:${origin.port}/html`, format: "markdown" },
      })
      expect(result.isError).toBeFalsy()
      expect(texts(result)).toEqual(["# Hello\n\nworld"])
      expect(result.structuredContent).toMatchObject({
        contentType: "text/html",
        format: "markdown",
        output: "# Hello\n\nworld",
        truncated: false,
      })

      const truncated = await client.callTool({
        name: "webfetch",
        arguments: { url: `http://127.0.0.1:${origin.port}/lines`, format: "text" },
      })
      const content = texts(truncated)
      expect(content).toHaveLength(2)
      expect(content[0]).toBe("one\ntwo\nthree\nfour\nfive")
      expect(content[1]).toMatch(/^\[showing lines 1-5 of 8; full output saved to .+\]$/)

      const outputPath = (truncated.structuredContent as { outputPath?: string }).outputPath
      expect(outputPath).toBeString()
      expect(await readFile(outputPath!, "utf8")).toBe("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight")

      const failed = await client.callTool({
        name: "webfetch",
        arguments: { url: "file:///etc/passwd" },
      })
      expect(failed.isError).toBe(true)
      expect(texts(failed).join("\n")).toContain("URL must use http:// or https://")
    } finally {
      await client.close()
    }
  })

  test("initializes without a session and returns JSON", async () => {
    const endpoint = await start()
    const response = await post(endpoint.url, initializeBody())

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(response.headers.get("mcp-session-id")).toBeNull()
    const body = await response.json()
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { serverInfo: { name: "opencode-webfetch-mcp" } },
    })
  })

  test("rejects unknown paths, non-POST methods, and malformed JSON", async () => {
    const endpoint = await start()
    const base = new URL(endpoint.url)
    const wrongPath = new URL("/elsewhere", base)

    const notFound = await post(wrongPath.toString(), initializeBody())
    expect(notFound.status).toBe(404)

    const get = await fetch(endpoint.url, { headers: { accept: "text/event-stream" } })
    expect(get.status).toBe(405)
    expect(get.headers.get("allow")).toBe("POST")

    const remove = await fetch(endpoint.url, { method: "DELETE" })
    expect(remove.status).toBe(405)

    const malformed = await post(endpoint.url, "{not json")
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toMatchObject({ error: { code: -32700 } })
  })

  test("rejects untrusted Host and Origin headers", async () => {
    const endpoint = await start()

    const host = await post(endpoint.url, initializeBody(), { Host: "attacker.example" })
    expect(host.status).toBe(403)

    const origin = await post(endpoint.url, initializeBody(), { Origin: "http://attacker.example" })
    expect(origin.status).toBe(403)

    const allowed = await post(endpoint.url, initializeBody(), { Origin: "http://localhost:3000" })
    expect(allowed.status).toBe(200)
  })

  test("accepts explicit extra allowed hosts", async () => {
    const endpoint = await start({ allowedHosts: new Set(["127.0.0.1", "localhost", "::1", "webfetch.lan"]) })
    const response = await post(endpoint.url, initializeBody(), { Host: "webfetch.lan:3000" })
    expect(response.status).toBe(200)
  })
})

describe("isAllowedRequest", () => {
  const config = httpConfig()

  test("requires a Host header in the allowlist", () => {
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp"), config)).toBe(false)
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp", { headers: { host: "127.0.0.1:3000" } }), config)).toBe(
      true,
    )
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp", { headers: { host: "evil.example" } }), config)).toBe(
      false,
    )
  })

  test("validates Origin only when it is present", () => {
    const headers = new Headers({ host: "127.0.0.1:3000" })
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp", { headers }), config)).toBe(true)

    headers.set("origin", "http://localhost:8080")
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp", { headers }), config)).toBe(true)

    headers.set("origin", "http://evil.example")
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp", { headers }), config)).toBe(false)

    headers.set("origin", "null")
    expect(isAllowedRequest(new Request("http://127.0.0.1/mcp", { headers }), config)).toBe(false)
  })
})
