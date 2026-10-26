/**
 * A stand-in for the pyrunner HTTP service.
 *
 * Runs in-process through the client's injectable `fetch`, so the MCP server
 * can be exercised end to end without binding a port or depending on a
 * particular Python environment for pyrunner.
 *
 * It deliberately does not execute Python: executing scripts is pyrunner's job.
 * Results are canned, with a few triggers that mirror the real runner's
 * interesting outcomes.
 */

import type { FetchLike } from "../src/index.ts";

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
  defined_names: string[];
}

export type PartialScriptResult = Partial<ScriptResult>;

export interface FakePyRunnerOptions {
  results?: Record<string, PartialScriptResult>;
  delayMs?: number;
  garbage?: boolean;
  nonJson?: boolean;
  failHealth?: boolean;
  health?: Record<string, string>;
}

function complete(partial: PartialScriptResult = {}): ScriptResult {
  return {
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    exit_code: partial.exit_code ?? 0,
    timed_out: partial.timed_out ?? false,
    defined_names: partial.defined_names ?? [],
  };
}

/** Configurable in-process pyrunner. */
export class FakePyRunner {
  delayMs: number;
  garbage: boolean;
  nonJson: boolean;
  failHealth: boolean;
  health: Record<string, string>;
  readonly requests: string[] = [];
  readonly fetch: FetchLike;

  readonly #results = new Map<string, ScriptResult>();

  constructor(options: FakePyRunnerOptions = {}) {
    this.delayMs = options.delayMs ?? 0;
    this.garbage = options.garbage ?? false;
    this.nonJson = options.nonJson ?? false;
    this.failHealth = options.failHealth ?? false;
    this.health = options.health ?? { status: "ok" };
    for (const [code, result] of Object.entries(options.results ?? {})) {
      this.#results.set(code, complete(result));
    }
    this.fetch = this.#handle.bind(this);
  }

  setResult(code: string, result: PartialScriptResult): this {
    this.#results.set(code, complete(result));
    return this;
  }

  async #handle(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const request =
      input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      if (this.failHealth) {
        return Response.json({ error: "boom" }, { status: 500 });
      }
      return Response.json(this.health);
    }

    if (url.pathname !== "/execute" || request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ detail: "invalid json" }, { status: 422 });
    }

    const code = (payload as { code?: unknown } | null)?.code;
    if (typeof code !== "string") {
      return Response.json(
        { detail: "code must be a string" },
        { status: 422 },
      );
    }
    this.requests.push(code);

    if (this.garbage) {
      return Response.json({ unexpected: "shape" });
    }
    if (this.nonJson) {
      return new Response("<html>nope</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (this.delayMs > 0) {
      await delayAbortable(this.delayMs, request.signal);
    }

    return Response.json(this.#resultFor(code));
  }

  #resultFor(code: string): ScriptResult {
    if (code.includes("TIMEOUT_ME")) {
      return {
        stdout: "",
        stderr: "Execution timed out after 1 seconds.\n",
        exit_code: 124,
        timed_out: true,
        defined_names: [],
      };
    }

    const canned = this.#results.get(code);
    if (canned !== undefined) {
      return canned;
    }

    const raised = /raise\s+([A-Za-z_]\w*)(?:\(\s*(['"])(.*?)\2\s*\))?/.exec(
      code,
    );
    if (raised !== null) {
      const type = raised[1] ?? "Exception";
      const message = raised[3] ?? "";
      const detail = message === "" ? type : `${type}: ${message}`;
      return {
        stdout: "",
        stderr:
          `Traceback (most recent call last):\n` +
          `  File "<script>", line 1, in <module>\n` +
          `${detail}\n`,
        exit_code: 1,
        timed_out: false,
        defined_names: [],
      };
    }

    return complete();
  }
}

function delayAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
