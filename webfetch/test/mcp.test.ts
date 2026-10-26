import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const entry = join(import.meta.dir, "..", "src", "index.ts")
const servers: Array<ReturnType<typeof Bun.serve>> = []
const directories: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const environment = (dataDir: string) => {
  const merged = {
    ...process.env,
    WEBFETCH_DATA_DIR: dataDir,
    WEBFETCH_MAX_LINES: "5",
    WEBFETCH_MAX_BYTES: "1000",
  }
  return Object.fromEntries(Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined))
}

const texts = (result: unknown) => {
  const content = (result as { content?: unknown }).content
  return (Array.isArray(content) ? (content as Array<{ type: string; text?: string }>) : []).flatMap((part) =>
    part.type === "text" && part.text !== undefined ? [part.text] : [],
  )
}

describe("MCP server over stdio", () => {
  test("lists and calls the webfetch tool", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "opencode-webfetch-mcp-"))
    directories.push(dataDir)
    const server = Bun.serve({
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
    servers.push(server)

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry, "--stdio"],
      env: environment(dataDir),
      stderr: "pipe",
    })
    const client = new Client({ name: "webfetch-test", version: "1.0.0" })
    await client.connect(transport)

    try {
      const listed = await client.listTools()
      const tool = listed.tools.find((candidate) => candidate.name === "webfetch")
      expect(tool).toBeDefined()
      expect(tool?.annotations?.readOnlyHint).toBe(true)
      expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["url", "format", "timeout"])

      const result = await client.callTool({
        name: "webfetch",
        arguments: { url: `http://127.0.0.1:${server.port}/html`, format: "markdown" },
      })
      expect(result.isError).toBeFalsy()
      expect(texts(result)).toEqual(["# Hello\n\nworld"])
      expect(result.structuredContent).toMatchObject({
        url: `http://127.0.0.1:${server.port}/html`,
        contentType: "text/html",
        format: "markdown",
        output: "# Hello\n\nworld",
        truncated: false,
      })

      const truncated = await client.callTool({
        name: "webfetch",
        arguments: { url: `http://127.0.0.1:${server.port}/lines`, format: "text" },
      })
      const content = texts(truncated)
      expect(content).toHaveLength(2)
      expect(content[0]).toBe("one\ntwo\nthree\nfour\nfive")
      expect(content[1]).toMatch(/^\[showing lines 1-5 of 8; full output saved to .+\]$/)
      expect(truncated.structuredContent).toMatchObject({ truncated: true, lines: 8 })

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
})
