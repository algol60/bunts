/** End-to-end tool behaviour, driven through a real MCP client session. */

import { describe, expect, test } from "bun:test";

import { MAX_BATCH_SIZE, buildServer } from "../src/server.ts";
import { TIMEOUT_EXIT_CODE } from "../src/models.ts";
import {
  TEST_SETTINGS,
  closedPort,
  connectedSession,
  fakeServer,
  run,
  runWith,
  textOf,
  unwrap,
} from "./harness.ts";

describe("tools/list", () => {
  test("tools are advertised with schemas and annotations", async () => {
    await run(async (client) => {
      const { tools } = await client.listTools();
      const byName = new Map(tools.map((tool) => [tool.name, tool]));
      expect(new Set(byName.keys())).toEqual(
        new Set(["run_python", "run_python_batch", "runner_status"]),
      );

      const runTool = byName.get("run_python");
      expect(runTool?.description).toBeTruthy();
      expect(
        (runTool?.inputSchema as { properties?: Record<string, unknown> })
          .properties?.code,
      ).toBeDefined();
      expect(runTool?.outputSchema).toBeDefined();
      expect(runTool?.annotations?.readOnlyHint).toBe(false);
      expect(runTool?.annotations?.destructiveHint).toBe(true);

      const batchTool = byName.get("run_python_batch");
      const batchSchema = batchTool?.inputSchema as {
        properties?: { scripts?: { type?: string } };
      };
      expect(batchSchema.properties?.scripts?.type).toBe("array");

      const statusTool = byName.get("runner_status");
      expect(statusTool?.annotations?.readOnlyHint).toBe(true);
      expect(statusTool?.annotations?.destructiveHint).toBe(false);
    });
  });
});

describe("run_python", () => {
  test("returns stdout, stderr and defined names", async () => {
    const code =
      "import sys\nprint('out')\nprint('err', file=sys.stderr)\ntotal = 6*7";
    const result = await runWith(
      {
        results: {
          [code]: {
            stdout: "out\n",
            stderr: "err\n",
            defined_names: ["sys", "total"],
          },
        },
      },
      async (client) =>
        unwrap(
          await client.callTool({
            name: "run_python",
            arguments: { code },
          }),
        ),
    );

    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(result.exit_code).toBe(0);
    expect(result.defined_names).toEqual(["sys", "total"]);
    expect(typeof result.duration_seconds).toBe("number");
  });

  test("a failing script is not a tool error", async () => {
    const result = await run(async (client) =>
      client.callTool({
        name: "run_python",
        arguments: { code: "raise ValueError('boom')" },
      }),
    );
    expect(result.isError).not.toBe(true);
    const data = unwrap(result);
    expect(data.ok).toBe(false);
    expect(data.exit_code).toBe(1);
    expect(data.stderr).toContain("ValueError: boom");
  });

  test("a timeout is surfaced as a result, not an error", async () => {
    const result = await run(async (client) =>
      client.callTool({
        name: "run_python",
        arguments: { code: "TIMEOUT_ME" },
      }),
    );
    const data = unwrap(result);
    expect(data.ok).toBe(false);
    expect(data.timed_out).toBe(true);
    expect(data.exit_code).toBe(TIMEOUT_EXIT_CODE);
    expect(data.stderr).toContain("timed out");
  });

  test("the result is also readable as text", async () => {
    const code = "print('plain text view')";
    const result = await runWith(
      { results: { [code]: { stdout: "plain text view\n" } } },
      async (client) =>
        client.callTool({
          name: "run_python",
          arguments: { code },
        }),
    );
    expect(result.isError).not.toBe(true);
    expect(textOf(result)).toContain("plain text view");
  });

  test("the tool input schema requires code", async () => {
    const result = await run(async (client) =>
      client.callTool({ name: "run_python", arguments: {} }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("code");
  });
});

describe("run_python_batch", () => {
  test("preserves order and counts", async () => {
    const result = await runWith(
      {
        results: {
          "print('one')": { stdout: "one\n" },
          "print('three')": { stdout: "three\n" },
        },
      },
      async (client) =>
        client.callTool({
          name: "run_python_batch",
          arguments: {
            scripts: [
              "print('one')",
              "raise RuntimeError('two')",
              "print('three')",
            ],
          },
        }),
    );

    const data = unwrap(result);
    expect(data.ok).toBe(false);
    expect(data.succeeded).toBe(2);
    expect(data.failed).toBe(1);
    const results = data.results as Array<Record<string, unknown>>;
    expect(results.map((entry) => entry.stdout)).toEqual([
      "one\n",
      "",
      "three\n",
    ]);
    expect(results[1]?.exit_code).toBe(1);
  });

  test("reaches pyrunner in order", async () => {
    const requests = await run(async (client, fake) => {
      await client.callTool({
        name: "run_python_batch",
        arguments: { scripts: ["a = 1", "b = 2", "c = 3"] },
      });
      return fake.requests;
    });
    expect(requests).toEqual(["a = 1", "b = 2", "c = 3"]);
  });

  test("rejects an empty list", async () => {
    const result = await run(async (client) =>
      client.callTool({
        name: "run_python_batch",
        arguments: { scripts: [] },
      }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("at least one");
  });

  test("enforces the size limit", async () => {
    const result = await run(async (client) =>
      client.callTool({
        name: "run_python_batch",
        arguments: {
          scripts: Array.from({ length: MAX_BATCH_SIZE + 1 }, () => "pass"),
        },
      }),
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(String(MAX_BATCH_SIZE));
  });
});

describe("runner_status", () => {
  test("reports a healthy service", async () => {
    const data = await run(async (client) =>
      unwrap(
        await client.callTool({ name: "runner_status", arguments: {} }),
      ),
    );
    expect(data.reachable).toBe(true);
    expect(data.status).toEqual({ status: "ok" });
    expect(data.detail).toBe("");
    expect(data.base_url).toBe("http://pyrunner.test");
  });

  test("reports an unhealthy service without raising", async () => {
    const result = await runWith({ failHealth: true }, async (client) =>
      client.callTool({ name: "runner_status", arguments: {} }),
    );
    expect(result.isError).not.toBe(true);
    const data = unwrap(result);
    expect(data.reachable).toBe(false);
    expect(data.detail).toContain("HTTP 500");
  });

  test("an unreachable runner is a tool error for run_python", async () => {
    const port = closedPort();
    const server = buildServer({
      ...TEST_SETTINGS,
      baseUrl: `http://127.0.0.1:${port}`,
      requestTimeout: 1,
    });

    const result = await connectedSession(server, (client) =>
      client.callTool({
        name: "run_python",
        arguments: { code: "print(1)" },
      }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Could not reach pyrunner");
  });
});

describe("server identity and state", () => {
  test("exposes instructions and identity", async () => {
    const identity = await run(async (client) => ({
      instructions: client.getInstructions(),
      version: client.getServerVersion(),
    }));
    expect(identity.version?.name).toBe("pyrunner");
    expect(identity.version?.version).toBeTruthy();
    expect(identity.instructions).toContain("run_python");
  });

  test("state settings match what was built", () => {
    const settings = { ...TEST_SETTINGS, baseUrl: "http://elsewhere:9999" };
    const { server } = fakeServer(undefined, settings);
    expect(server.state.settings.baseUrl).toBe("http://elsewhere:9999");
  });
});
