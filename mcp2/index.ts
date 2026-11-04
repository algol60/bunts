import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const HOST = "127.0.0.1" as const;
const DEFAULT_PORT = 8020;
const TOOL_NAME = "get_weather2";
const CLIENT_ID = "static-bearer-demo";
const SCOPE = "weather:read";

const WEATHER_DESCRIPTIONS = [
  "Sunny and warm, around 24°C, with a light breeze.",
  "Partly cloudy and mild, around 19°C.",
  "Light rain showers, around 15°C.",
  "Overcast and cool, around 12°C.",
  "Hot and humid, around 30°C.",
  "Clear skies and chilly, around 8°C.",
  "Windy with scattered clouds, around 20°C.",
  "Thunderstorms likely, around 22°C.",
] as const;

function fatal(message: string): never {
  console.error(`[weather-mcp] ${message}`);
  process.exit(1);
}

function readConfig(): { token: string; port: number } {
  const token = process.env.WEATHER_MCP_TOKEN?.trim() ?? "";

  if (token.length < 32) {
    fatal(
      "WEATHER_MCP_TOKEN must be set to at least 32 characters. See .env.example.",
    );
  }

  if (/\s/.test(token)) {
    fatal("WEATHER_MCP_TOKEN must not contain whitespace.");
  }

  const portText = process.env.WEATHER_MCP_PORT ?? String(DEFAULT_PORT);
  const port = Number(portText);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fatal(
      `WEATHER_MCP_PORT must be an integer between 1 and 65535 (got "${portText}").`,
    );
  }

  return { token, port };
}

const { token, port } = readConfig();
const expectedTokenDigest = createHash("sha256").update(token, "utf8").digest();

/** Compare digests so the check is constant-time regardless of token length. */
function isAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header) {
    return false;
  }

  const match = /^Bearer +([^\s]+)$/i.exec(header.trim());
  if (!match?.[1]) {
    return false;
  }

  const presentedDigest = createHash("sha256")
    .update(match[1], "utf8")
    .digest();

  return timingSafeEqual(expectedTokenDigest, presentedDigest);
}

function unauthorizedResponse(missingCredentials: boolean): Response {
  const challenge = missingCredentials
    ? 'Bearer realm="weather-mcp"'
    : 'Bearer realm="weather-mcp", error="invalid_token"';

  return Response.json(
    {
      error: "unauthorized",
      error_description: "A valid bearer token is required.",
    },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": challenge,
        "Cache-Control": "no-store",
      },
    },
  );
}

function createWeatherServer(): McpServer {
  const server = new McpServer(
    { name: "weather-mcp", version: "1.0.0" },
    {
      instructions:
        "Call get_weather to receive a randomly selected, made-up current weather description.",
    },
  );

  server.registerTool(
    TOOL_NAME,
    {
      title: "Get current weather",
      description:
        "Return a randomly selected, made-up current weather description. No location is used.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const description =
        WEATHER_DESCRIPTIONS[randomInt(WEATHER_DESCRIPTIONS.length)]!;

      return {
        content: [{ type: "text", text: description }],
      };
    },
  );

  return server;
}

async function handleMcpRequest(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");

  if (!isAuthorized(request)) {
    return unauthorizedResponse(authorization === null);
  }

  if (request.method !== "POST") {
    return Response.json(
      {
        error: "method_not_allowed",
        error_description:
          "This stateless MCP endpoint accepts POST requests only.",
      },
      { status: 405, headers: { Allow: "POST" } },
    );
  }

  const server = createWeatherServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode: the SDK requires a fresh transport for every request.
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  const authInfo: AuthInfo = {
    token,
    clientId: CLIENT_ID,
    scopes: [SCOPE],
  };

  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { authInfo });
  } catch (error) {
    console.error("[weather-mcp] request failed:", error);
    return Response.json(
      {
        error: "internal_error",
        error_description: "The MCP request could not be processed.",
      },
      { status: 500 },
    );
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

const httpServer = Bun.serve({
  hostname: HOST,
  port,
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return Response.json({ ok: true });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not Found", { status: 404 });
    }

    return handleMcpRequest(request);
  },
  error(error) {
    console.error("[weather-mcp] unhandled error:", error);
    return Response.json(
      {
        error: "internal_error",
        error_description: "The request could not be processed.",
      },
      { status: 500 },
    );
  },
});

console.log(
  `[weather-mcp] listening on http://${HOST}:${httpServer.port}/mcp`,
);
console.log(
  `[weather-mcp] bearer auth required; tool "${TOOL_NAME}" is ready`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`\n[weather-mcp] ${signal} received, shutting down`);
    httpServer.stop(true);
    process.exit(0);
  });
}
