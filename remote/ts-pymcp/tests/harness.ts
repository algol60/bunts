/**
 * Test helpers: drive the MCP server through a real client session.
 */

import {
  Client,
  InMemoryTransport,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";
import { expect } from "bun:test";

import type { Settings } from "../src/config.ts";
import { buildServer } from "../src/server.ts";
import { FakePyRunner, type FakePyRunnerOptions } from "./fake-pyrunner.ts";

/** Settings that point at the fake rather than a real service. */
export const TEST_SETTINGS: Settings = Object.freeze({
  baseUrl: "http://pyrunner.test",
  requestTimeout: 5,
  transport: "streamable-http",
  host: "127.0.0.1",
  port: 8765,
});

/**
 * Run `body` against an initialised client talking to `server` in-process.
 *
 * This goes through the real protocol layer, so tool dispatch, schema
 * validation and error conversion behave exactly as they do over a network
 * transport.
 */
export async function connectedSession<T>(
  server: McpServer,
  body: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  const client = new Client(
    { name: "ts-pymcp-test-client", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );

  try {
    await client.connect(clientTransport);
    return await body(client);
  } finally {
    await client.close();
    await server.close();
  }
}

/** Build a server wired to an in-process fake pyrunner. */
export function fakeServer(
  fake: FakePyRunner = new FakePyRunner(),
  settings: Settings = TEST_SETTINGS,
): { fake: FakePyRunner; server: ReturnType<typeof buildServer> } {
  return {
    fake,
    server: buildServer(settings, { fetch: fake.fetch }),
  };
}

/** Run a test body against a fresh fake-backed MCP session. */
export async function run<T>(
  body: (client: Client, fake: FakePyRunner) => Promise<T>,
): Promise<T> {
  const { fake, server } = fakeServer();
  return connectedSession(server, (client) => body(client, fake));
}

/** Like {@link run}, but against a pre-configured fake. */
export async function runWith<T>(
  options: FakePyRunnerOptions | FakePyRunner,
  body: (client: Client, fake: FakePyRunner) => Promise<T>,
): Promise<T> {
  const fake = options instanceof FakePyRunner ? options : new FakePyRunner(options);
  const { server } = fakeServer(fake);
  return connectedSession(server, (client) => body(client, fake));
}

/** Return the structured content of a tool result, failing loudly if absent. */
export function unwrap(result: CallToolResult): Record<string, unknown> {
  expect(result.isError).not.toBe(true);
  const structured = result.structuredContent;
  expect(structured).toBeDefined();
  if (structured === null || typeof structured !== "object" || Array.isArray(structured)) {
    throw new Error("expected structured content to be a JSON object");
  }
  return structured as Record<string, unknown>;
}

/** Concatenate every text block in a tool result. */
export function textOf(result: CallToolResult): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

/** Bind and immediately release a port so nothing is listening on it. */
export function closedPort(): number {
  const probe = Bun.serve({
    port: 0,
    fetch: () => new Response("probe"),
  });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) {
    throw new Error("Bun.serve did not report a bound port");
  }
  return port;
}
