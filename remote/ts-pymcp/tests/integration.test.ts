/**
 * Integration tests against the real pyrunner service.
 *
 * These prove the wiring actually works, not just that the pieces behave in
 * isolation:
 *
 * * launch this package as a real stdio subprocess and speak MCP to it
 * * talk to a live pyrunner over HTTP
 *
 * Point them at a runner with `PYRUNNER_MCP_URL` (default
 * `http://127.0.0.1:8000`).
 */

import { describe, expect, test } from "bun:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const MAIN = new URL("../src/main.ts", import.meta.url).pathname;
const BASE_URL = process.env.PYRUNNER_MCP_URL ?? "http://127.0.0.1:8000";

const pyrunnerUp = await fetch(`${BASE_URL}/health`, {
  signal: AbortSignal.timeout(2000),
})
  .then((response) => response.ok)
  .catch(() => false);

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function params(
  overrides: Record<string, string> = {},
): ConstructorParameters<typeof StdioClientTransport>[0] {
  return {
    command: process.execPath,
    args: [MAIN],
    env: cleanEnv({
      PYRUNNER_MCP_URL: BASE_URL,
      // HTTP is the default; these tests exercise the stdio opt-in.
      PYRUNNER_MCP_TRANSPORT: "stdio",
      ...overrides,
    }),
    stderr: "inherit",
  };
}

async function withStdio<T>(
  body: (client: Client) => Promise<T>,
  overrides: Record<string, string> = {},
): Promise<T> {
  const transport = new StdioClientTransport(params(overrides));
  const client = new Client(
    { name: "ts-pymcp-integration", version: "1.0.0" },
    { versionNegotiation: { mode: "legacy" } },
  );

  try {
    await client.connect(transport);
    return await body(client);
  } finally {
    await client.close();
  }
}

describe("stdio subprocess", () => {
  test.skipIf(!pyrunnerUp)(
    "runs a script and captures output",
    async () => {
      const { structured, tools, version } = await withStdio(async (client) => {
        const tools = await client.listTools();
        const result = await client.callTool({
          name: "run_python",
          arguments: {
            code:
              "import sys\nprint('from stdio')\n" +
              "print('e', file=sys.stderr)\nx = 1 + 1",
          },
        });
        return {
          structured: result.structuredContent as Record<string, unknown>,
          tools: tools.tools.map((tool) => tool.name).sort(),
          version: client.getServerVersion(),
        };
      });

      expect(tools).toEqual(["run_python", "run_python_batch", "runner_status"]);
      expect(structured.stdout).toBe("from stdio\n");
      expect(structured.stderr).toBe("e\n");
      expect(structured.exit_code).toBe(0);
      expect(structured.ok).toBe(true);
      expect(structured.defined_names).toEqual(["sys", "x"]);
      expect(version?.version).toBeTruthy();
    },
    60_000,
  );

  test.skipIf(!pyrunnerUp)(
    "reports a script failure without erroring",
    async () => {
      const result = await withStdio((client) =>
        client.callTool({
          name: "run_python",
          arguments: { code: "raise KeyError('k')" },
        }),
      );
      expect(result.isError).not.toBe(true);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.exit_code).toBe(1);
      expect(structured.stderr).toContain("KeyError");
    },
    60_000,
  );

  test.skipIf(!pyrunnerUp)(
    "does not write noise to stdout",
    async () => {
      // Reaching this point already proves it: the stdio client parses every
      // stdout line as a JSON-RPC message.
      const tools = await withStdio(async (client) => client.listTools());
      expect(tools.tools).toHaveLength(3);
    },
    60_000,
  );

  test.skipIf(!pyrunnerUp)(
    "reports a live runner as reachable",
    async () => {
      const result = await withStdio((client) =>
        client.callTool({ name: "runner_status", arguments: {} }),
      );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ reachable: true });
    },
    60_000,
  );

  test.skipIf(!pyrunnerUp)(
    "reports the runner's timeout exit code unchanged",
    async () => {
      const result = await withStdio((client) =>
        client.callTool({
          name: "run_python",
          arguments: { code: "while True:\n    pass" },
        }),
      );
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        timed_out: true,
        exit_code: 124,
        ok: false,
      });
    },
    60_000,
  );

  test("bad configuration exits with a clear error", async () => {
    const proc = Bun.spawn({
      cmd: [process.execPath, MAIN],
      env: cleanEnv({ PYRUNNER_MCP_TRANSPORT: "carrier-pigeon" }),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [code, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    expect(code).toBe(1);
    expect(stderr).toContain("PYRUNNER_MCP_TRANSPORT");
  });
});
