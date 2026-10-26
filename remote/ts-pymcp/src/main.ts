#!/usr/bin/env bun

/**
 * Entry point for the pyrunner MCP server.
 *
 * Streamable HTTP is the default transport and is served by Bun on
 * `http://host:port/mcp`. Set `PYRUNNER_MCP_TRANSPORT=stdio` to opt into stdio.
 *
 * Logs go to stderr only. Under stdio, stdout belongs to JSON-RPC frames and a
 * single stray print there corrupts the protocol stream.
 */

import { createMcpHandler } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { ConfigError, settingsFromEnv, type Settings } from "./config.ts";
import { SERVER_VERSION, buildServer } from "./server.ts";

function logInfo(message: string): void {
  console.error(`${new Date().toISOString()} INFO pyrunner: ${message}`);
}

function logError(message: string): void {
  console.error(`${new Date().toISOString()} ERROR pyrunner: ${message}`);
}

function installSignalHandlers(shutdown: () => Promise<void>): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void shutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function runStdio(settings: Settings): number {
  const handle = serveStdio(() => buildServer(settings), {
    onerror: (error) => logError(error.message),
  });

  installSignalHandlers(async () => {
    await handle.close();
  });

  logInfo(
    `MCP server ${SERVER_VERSION} targeting ${settings.baseUrl} over stdio`,
  );
  return 0;
}

function runHttp(settings: Settings): number {
  const handler = createMcpHandler(() => buildServer(settings), {
    legacy: "stateless",
    // Keep SSE framing: some clients cannot handle JSON-only responses.
    responseMode: "sse",
    onerror: (error) => logError(error.message),
  });

  const http = Bun.serve({
    hostname: settings.host,
    port: settings.port,
    // A script may run for the runner's full budget with no bytes flowing.
    // Bun's default idle timeout would cut that request off; give it headroom
    // beyond the HTTP call timeout, up to Bun's 255-second maximum.
    idleTimeout: Math.min(255, Math.max(60, Math.ceil(settings.requestTimeout * 2))),
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }
      return handler.fetch(request);
    },
  });

  installSignalHandlers(async () => {
    http.stop(true);
    await handler.close();
  });

  logInfo(
    `MCP server ${SERVER_VERSION} targeting ${settings.baseUrl} at ` +
      `http://${http.hostname}:${http.port}/mcp`,
  );
  return 0;
}

/**
 * Run the server over the configured transport.
 *
 * Returns a process exit code for startup failures. Once a transport is
 * running, `Bun.serve` or the stdio listener keeps the process alive, so a
 * successful start returns immediately.
 */
export function main(_argv: string[] = process.argv.slice(2)): number {
  let settings: Settings;
  try {
    settings = settingsFromEnv();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`ts-pymcp: configuration error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  if (settings.transport === "stdio") {
    return runStdio(settings);
  }
  return runHttp(settings);
}

if (import.meta.main) {
  const code = main();
  if (code !== 0) {
    process.exitCode = code;
  }
}
