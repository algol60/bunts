#!/usr/bin/env bun
/**
 * A simple MCP server that reports fake weather.
 *
 * Run with:  WEATHER_MCP_TOKEN=<secret> bun run weather_server.ts
 *
 * It speaks MCP over Streamable HTTP on 127.0.0.1:8019 and requires an
 * `Authorization: Bearer <secret>` header on every request. The token is read
 * from WEATHER_MCP_TOKEN; the server refuses to start if it is unset or empty.
 */

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const INSTRUCTIONS =
  "A toy weather service. Conditions are randomly chosen from a fixed set.";

// Fixed set of weather descriptions; a random one is picked per request.
const DESCRIPTIONS = [
  "Sunny",
  "Clear",
  "Partly cloudy",
  "Overcast",
  "Light rain",
  "Heavy rain",
  "Thunderstorms",
  "Snow",
  "Foggy",
  "Windy",
] as const;

/**
 * Serialize a string the way Python's `json.dumps` does by default: ASCII-only
 * output, with non-ASCII code units escaped as lowercase `\uXXXX`.
 */
function pyJsonString(value: string): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function createServer(): McpServer {
  const server = new McpServer(
    { name: "weather", version: "" },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "get_weather",
    {
      description: `Get the current weather for a city.

Args:
    city: Name of the city to report on.

Returns:
    A JSON object with the city, a random description, temperature (C) and humidity (%).
`,
      inputSchema: { city: z.string().default("San Francisco") },
      outputSchema: { result: z.string() },
    },
    async ({ city }) => {
      const description =
        DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)]!;
      const temperatureC = Math.floor(Math.random() * 46) - 10;
      const humidityPct = Math.floor(Math.random() * 91) + 10;

      // Match Python's json.dumps separators (", " and ": ") exactly.
      const text =
        `{"city": ${pyJsonString(city)}, ` +
        `"description": ${pyJsonString(description)}, ` +
        `"temperature_c": ${temperatureC}, ` +
        `"humidity_pct": ${humidityPct}}`;

      return {
        content: [{ type: "text", text }],
        structuredContent: { result: text },
        isError: false,
      };
    },
  );

  return server;
}

/** HTTP 401 body/headers, matching the Python server. */
function unauthorizedResponse(): Response {
  return new Response('{"error":"unauthorized"}', {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="weather"',
      "cache-control": "no-store",
    },
  });
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
}

/**
 * Check `Authorization: Bearer <token>` with a timing-safe comparison.
 *
 * Hashing both sides first makes the comparison independent of input length,
 * which is the same property Python's `secrets.compare_digest` provides.
 */
function isAuthorized(request: Request, expectedTokenHash: Buffer): boolean {
  const header = request.headers.get("authorization");
  if (header === null) return false;

  const space = header.indexOf(" ");
  if (space === -1) return false;
  if (header.slice(0, space).toLowerCase() !== "bearer") return false;

  const suppliedHash = createHash("sha256")
    .update(header.slice(space + 1))
    .digest();
  return timingSafeEqual(suppliedHash, expectedTokenHash);
}

function main(): void {
  const token = process.env.WEATHER_MCP_TOKEN ?? "";
  if (token === "") {
    console.error(
      "WEATHER_MCP_TOKEN must be set; refusing to start without authentication",
    );
    process.exit(1);
  }

  const host = process.env.WEATHER_MCP_HOST ?? "127.0.0.1";
  const port = Number(process.env.WEATHER_MCP_PORT ?? "8019");
  const expectedTokenHash = createHash("sha256").update(token).digest();

  // One transport (and server) per MCP session, like the Python server.
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

  async function handleMcpRequest(request: Request): Promise<Response> {
    const sessionId = request.headers.get("mcp-session-id") ?? undefined;

    if (sessionId !== undefined) {
      const transport = transports.get(sessionId);
      if (transport === undefined) {
        return jsonRpcError(404, -32001, "Session not found");
      }
      return transport.handleRequest(request);
    }

    // No session yet: only an initialize POST may create one.
    if (request.method !== "POST") {
      return jsonRpcError(
        400,
        -32000,
        "Bad Request: Mcp-Session-Id header is required",
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonRpcError(400, -32700, "Parse error");
    }

    if (!isInitializeRequest(body)) {
      return jsonRpcError(
        400,
        -32000,
        "Bad Request: initialize request expected",
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
    });
    transport.onclose = () => {
      const id = transport.sessionId;
      if (id !== undefined) transports.delete(id);
    };

    await createServer().connect(transport);
    return transport.handleRequest(request, { parsedBody: body });
  }

  const server = Bun.serve({
    hostname: host,
    port,
    async fetch(request) {
      if (!isAuthorized(request, expectedTokenHash)) {
        return unauthorizedResponse();
      }

      if (new URL(request.url).pathname !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }

      try {
        return await handleMcpRequest(request);
      } catch (error) {
        console.error("MCP request failed:", error);
        return jsonRpcError(500, -32603, "Internal error");
      }
    },
  });

  console.log(`Weather MCP server listening on http://${host}:${server.port}/mcp`);
}

main();
