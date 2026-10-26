import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadConfig, type Config } from "../src/config.ts"
import { MAX_RESPONSE_BYTES } from "../src/lib/http.ts"
import { cleanupOutputs, outputDirectory } from "../src/lib/output.ts"
import { NAME, VERSION } from "../src/version.ts"
import { fetchWeb } from "../src/webfetch.ts"

const servers: Array<ReturnType<typeof Bun.serve>> = []
const directories: string[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true)
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})

const serve = (handler: (request: Request) => Response | Promise<Response>) => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}`, server }
}

const testConfig = async (overrides: Partial<Config> = {}): Promise<Config> => {
  const dataDir = await mkdtemp(join(tmpdir(), "opencode-webfetch-test-"))
  directories.push(dataDir)
  return { ...loadConfig({}), dataDir, ...overrides }
}

const html = (value: string) => new Response(value, { headers: { "content-type": "text/html; charset=utf-8" } })

describe("fetchWeb", () => {
  test("sends the same request headers and accepts ordinary text", async () => {
    let received: Headers | undefined
    const { url } = serve((request) => {
      received = request.headers
      return new Response("hello", { headers: { "content-type": "text/plain" } })
    })
    const config = await testConfig()

    const result = await fetchWeb({ url, format: "text" }, config)

    expect(result).toMatchObject({ url, contentType: "text/plain", format: "text", output: "hello", truncated: false })
    expect(received?.get("accept")).toBe("text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1")
    expect(received?.get("accept-language")).toBe("en-US,en;q=0.9")
    expect(received?.get("user-agent")).toContain(`${NAME}/${VERSION}`)
  })

  test("defaults to markdown and converts HTML", async () => {
    const { url } = serve(() => html("<h1>Hello</h1><p>world</p><script>bad()</script>"))
    const config = await testConfig()

    const markdown = await fetchWeb({ url }, config)
    expect(markdown.format).toBe("markdown")
    expect(markdown.output).toBe("# Hello\n\nworld")

    const text = await fetchWeb({ url, format: "text" }, config)
    expect(text.output).toBe("Helloworld")

    const raw = await fetchWeb({ url, format: "html" }, config)
    expect(raw.output).toBe("<h1>Hello</h1><p>world</p><script>bad()</script>")
  })

  test("treats a missing content type as text", async () => {
    const { url } = serve(() => new Response("plain"))
    const config = await testConfig()
    expect((await fetchWeb({ url }, config)).output).toBe("plain")
  })

  test("rejects non-HTTP schemes and malformed URLs", async () => {
    const config = await testConfig()
    await expect(fetchWeb({ url: "file:///etc/passwd" }, config)).rejects.toThrow("URL must use http:// or https://")
    await expect(fetchWeb({ url: "not a url" }, config)).rejects.toThrow("Invalid URL")
  })

  test("reports HTTP failures without retrying ordinary 403s", async () => {
    let requests = 0
    const { url } = serve(() => {
      requests++
      return new Response("forbidden", { status: 403 })
    })
    const config = await testConfig()

    await expect(fetchWeb({ url }, config)).rejects.toThrow(/HTTP 403/)
    expect(requests).toBe(1)
  })

  test("follows redirects", async () => {
    const { url, server } = serve((request) => {
      if (new URL(request.url).pathname === "/redirect") {
        return Response.redirect(new URL("/target", request.url).toString(), 302)
      }
      return new Response("redirected", { headers: { "content-type": "text/plain" } })
    })
    const config = await testConfig()

    expect((await fetchWeb({ url: `${url}/redirect` }, config)).output).toBe("redirected")
    expect(server.url.pathname).toBe("/")
  })

  test("rejects images and binary files", async () => {
    const config = await testConfig()
    const image = serve(() => new Response("png", { headers: { "content-type": "image/png" } }))
    await expect(fetchWeb({ url: image.url }, config)).rejects.toThrow("Unsupported fetched image content type: image/png")

    const pdf = serve(() => new Response("pdf", { headers: { "content-type": "application/pdf" } }))
    await expect(fetchWeb({ url: pdf.url }, config)).rejects.toThrow(
      "Unsupported fetched file content type: application/pdf",
    )
  })

  test("retries a Cloudflare challenge with the honest user agent", async () => {
    const userAgents: string[] = []
    const { url } = serve((request) => {
      userAgents.push(request.headers.get("user-agent") ?? "")
      if (userAgents.length === 1) {
        return new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } })
      }
      return new Response("ok", { headers: { "content-type": "text/plain" } })
    })
    const config = await testConfig()

    expect((await fetchWeb({ url }, config)).output).toBe("ok")
    expect(userAgents).toHaveLength(2)
    expect(userAgents[0]).toContain("Mozilla/5.0")
    expect(userAgents[1]).toBe(`${NAME}/${VERSION}`)
  })

  test("times out stalled requests and validates the timeout", async () => {
    const { url } = serve(() => new Promise<Response>(() => undefined))
    const config = await testConfig()

    await expect(fetchWeb({ url, timeout: 0.05 }, config)).rejects.toThrow("Request timed out")
    await expect(fetchWeb({ url: "https://example.com", timeout: 121 }, config)).rejects.toThrow(
      "Timeout must be greater than 0 and at most 120 seconds",
    )
  })

  test("enforces the response size limit while streaming", async () => {
    const { url } = serve(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1))
          controller.close()
        },
      })
      return new Response(body, { headers: { "content-type": "text/plain" } })
    })
    const config = await testConfig()

    await expect(fetchWeb({ url }, config)).rejects.toThrow(
      `Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`,
    )
  })

  test("retains oversized output in a file and returns a preview", async () => {
    const body = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join("\n")
    const { url } = serve(() => new Response(body, { headers: { "content-type": "text/plain" } }))
    const config = await testConfig({ maxLines: 3, maxBytes: 1_000 })

    const result = await fetchWeb({ url }, config)

    expect(result.truncated).toBe(true)
    expect(result.output).toBe("line 1\nline 2\nline 3")
    expect(result.marker).toMatch(/^\[showing lines 1-3 of 10; full output saved to .+tool_[0-9a-f]{12}\.md\]$/)
    expect(result.outputPath).toBeString()
    expect(await readFile(result.outputPath!, "utf8")).toBe(body)
    expect(result.bytes).toBe(Buffer.byteLength(body))
    expect(result.lines).toBe(10)
  })

  test("applies the byte budget as well as the line budget", async () => {
    const { url } = serve(
      () => new Response("aaaaaaaaaa\nbbbbbbbbbb", { headers: { "content-type": "text/plain" } }),
    )
    const config = await testConfig({ maxLines: 100, maxBytes: 12 })

    const result = await fetchWeb({ url }, config)
    expect(result.output).toBe("aaaaaaaaaa")
    expect(result.marker).toContain("lines 1-1 of 2")
  })
})

describe("cleanupOutputs", () => {
  test("removes expired retained output only", async () => {
    const config = await testConfig()
    const directory = outputDirectory(config)
    await mkdir(directory, { recursive: true })
    const expired = join(directory, "tool_aaaaaaaaaaaa.md")
    const recent = join(directory, "tool_bbbbbbbbbbbb.md")
    const unrelated = join(directory, "notes.md")
    await writeFile(expired, "old")
    await writeFile(recent, "new")
    await writeFile(unrelated, "keep")
    await utimes(expired, new Date(0), new Date(0))

    await cleanupOutputs(config)

    expect(await Bun.file(expired).exists()).toBe(false)
    expect(await Bun.file(recent).exists()).toBe(true)
    expect(await Bun.file(unrelated).exists()).toBe(true)
  })
})
