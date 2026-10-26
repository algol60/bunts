/** The pyrunner HTTP client, exercised against an in-process fake service. */

import { describe, expect, test } from "bun:test";

import {
  PyRunnerClient,
  PyRunnerProtocolError,
  PyRunnerUnavailable,
} from "../src/client.ts";
import { FakePyRunner } from "./fake-pyrunner.ts";
import { closedPort } from "./harness.ts";

function client(
  fake: FakePyRunner,
  options: { requestTimeout?: number } = {},
): PyRunnerClient {
  return new PyRunnerClient("http://pyrunner.test", {
    fetch: fake.fetch,
    ...options,
  });
}

describe("PyRunnerClient", () => {
  test("health reports the service status", async () => {
    const fake = new FakePyRunner();
    expect(await client(fake).health()).toEqual({ status: "ok" });
  });

  test("execute maps the documented response", async () => {
    const fake = new FakePyRunner().setResult("total = 6 * 7\nprint(total)", {
      stdout: "42\n",
      defined_names: ["total"],
    });

    const result = await client(fake).execute("total = 6 * 7\nprint(total)");
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("42\n");
    expect(result.exit_code).toBe(0);
    expect(result.timed_out).toBe(false);
    expect(result.defined_names).toEqual(["total"]);
    expect(result.duration_seconds).toBeGreaterThanOrEqual(0);
  });

  test("a failing script is a successful call with a nonzero exit", async () => {
    const fake = new FakePyRunner();
    const result = await client(fake).execute("raise ValueError('boom')");
    expect(result.ok).toBe(false);
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("ValueError: boom");
  });

  test("a timed-out script is reported with exit code 124", async () => {
    const fake = new FakePyRunner();
    const result = await client(fake).execute("TIMEOUT_ME");
    expect(result.ok).toBe(false);
    expect(result.timed_out).toBe(true);
    expect(result.exit_code).toBe(124);
  });

  test("an unreachable service raises unavailable", async () => {
    const port = closedPort();
    const unreachable = new PyRunnerClient(`http://127.0.0.1:${port}`, {
      requestTimeout: 1,
    });
    await expect(unreachable.execute("print(1)")).rejects.toThrow(
      PyRunnerUnavailable,
    );
    await expect(unreachable.execute("print(1)")).rejects.toThrow(
      /Could not reach pyrunner/,
    );
  });

  test("a slow service raises unavailable with a timeout hint", async () => {
    const fake = new FakePyRunner({ delayMs: 10_000 });
    const slow = client(fake, { requestTimeout: 0.05 });
    await expect(slow.execute("print(1)")).rejects.toThrow(
      /PYRUNNER_MCP_REQUEST_TIMEOUT/,
    );
  });

  test("missing fields raise a protocol error", async () => {
    const fake = new FakePyRunner({ garbage: true });
    await expect(client(fake).execute("print(1)")).rejects.toThrow(
      PyRunnerProtocolError,
    );
    await expect(client(fake).execute("print(1)")).rejects.toThrow(
      /missing expected field/,
    );
  });

  test("a non-JSON body raises a protocol error", async () => {
    const fake = new FakePyRunner({ nonJson: true });
    await expect(client(fake).execute("print(1)")).rejects.toThrow(
      /non-JSON/,
    );
  });

  test("an HTTP error status includes the response body", async () => {
    const fake = new FakePyRunner({ failHealth: true });
    await expect(client(fake).health()).rejects.toThrow(/HTTP 500/);
  });

  test("a non-object JSON body raises a protocol error", async () => {
    const fake = new FakePyRunner();
    const arrayBody = new PyRunnerClient("http://pyrunner.test", {
      fetch: async () => Response.json([1, 2, 3]),
    });
    await expect(arrayBody.execute("print(1)")).rejects.toThrow(
      /expected a JSON object/,
    );
    expect(fake.requests).toEqual([]);
  });

  test("the base URL trailing slash is normalised", () => {
    const normalised = new PyRunnerClient("http://pyrunner.test/");
    expect(normalised.baseUrl).toBe("http://pyrunner.test");
  });
});
