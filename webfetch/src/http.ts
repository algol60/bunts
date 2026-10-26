import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { loadHttpConfig, type Config, type HttpConfig } from "./config.ts"
import { formatHost, hostnameOf } from "./lib/host.ts"
import { createServer } from "./server.ts"
import { NAME } from "./version.ts"

const MAX_REQUEST_BODY_BYTES = 1_000_000

export type RunningHttpServer = {
  server: ReturnType<typeof Bun.serve>
  url: string
}

const jsonRpcError = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status,
    headers: {
      ...(status === 405 ? { allow: "POST" } : {}),
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  })

/** Reject requests whose Host or Origin does not belong to an allowed hostname. */
export const isAllowedRequest = (request: Request, config: HttpConfig) => {
  const host = request.headers.get("host")
  if (!host || !config.allowedHosts.has(hostnameOf(host))) return false

  // Browsers send Origin on cross-origin requests. Non-browser MCP clients
  // normally omit it. Reject "null" and any origin outside the allowlist.
  const origin = request.headers.get("origin")
  if (origin !== null) {
    try {
      if (!config.allowedHosts.has(hostnameOf(new URL(origin).hostname))) return false
    } catch {
      return false
    }
  }
  return true
}

const displayHost = (host: string) => (host === "0.0.0.0" || host === "::" ? "localhost" : host)

export const startHttp = (config: Config, http: HttpConfig = loadHttpConfig()): RunningHttpServer => {
  const handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname !== http.path) return new Response("Not Found\n", { status: 404 })
    if (!isAllowedRequest(request, http)) return jsonRpcError(403, "Forbidden")
    if (request.method !== "POST") return jsonRpcError(405, "Method Not Allowed")

    // Stateless Streamable HTTP: a fresh server and transport per request. No
    // session state is kept, so parallel clients cannot collide and nothing
    // leaks if a client disappears.
    const server = createServer(config)
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    })

    try {
      await server.connect(transport)
      const response = await transport.handleRequest(request)
      response.headers.set("cache-control", "no-store")
      response.headers.set("x-content-type-options", "nosniff")
      return response
    } catch (error) {
      console.error(`${NAME}: MCP request failed:`, error)
      return jsonRpcError(500, "Internal server error")
    } finally {
      await server.close().catch(() => undefined)
    }
  }

  const server = Bun.serve({
    hostname: http.host,
    port: http.port,
    // Tool calls may run for up to 120 seconds, so keep the connection open
    // longer than Bun's default idle timeout.
    idleTimeout: 255,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    fetch: handle,
  })

  return {
    server,
    url: `http://${formatHost(displayHost(http.host))}:${server.port}${http.path}`,
  }
}
