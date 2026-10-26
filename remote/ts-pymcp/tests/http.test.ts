/** The streamable HTTP transport, served by Bun and driven by a real client. */

import { afterAll, describe, expect, test } from "bun:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { buildServer } from "../src/server.ts";
import { FakePyRunner } from "./fake-pyrunner.ts";
import { TEST_SETTINGS } from "./harness.ts";

describe("streamable HTTP", () => {
  const fake = new FakePyRunner().setResult("print('http')", {
    stdout: "http\n",
  });
  const handler = createMcpHandler(
    () => buildServer(TEST_SETTINGS, { fetch: fake.fetch }),
    { legacy: "stateless", responseMode: "sse" },
  );
  const http = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path !== "/mcp") {
        return new Response("Not Found", { status: 404 });
      }
      return handler.fetch(request);
    },
  });

  afterAll(async () => {
    await handler.close();
    http.stop(true);
  });

  test("lists tools and calls one over /mcp", async () => {
    const client = new Client(
      { name: "ts-pymcp-http-test", version: "1.0.0" },
      { versionNegotiation: { mode: "legacy" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${http.port ?? 0}/mcp`),
    );

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "run_python",
        "run_python_batch",
        "runner_status",
      ]);

      const result = await client.callTool({
        name: "run_python",
        arguments: { code: "print('http')" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: true,
        stdout: "http\n",
      });
    } finally {
      await client.close();
    }
  });

  test("other paths return 404", async () => {
    const response = await fetch(`http://127.0.0.1:${http.port}/nope`);
    expect(response.status).toBe(404);
  });
});
