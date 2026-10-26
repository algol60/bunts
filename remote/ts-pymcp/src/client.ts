/**
 * Async HTTP client for the pyrunner service.
 *
 * This layer knows about pyrunner's wire format (`POST /execute` with
 * `{"code": ...}`) and nothing about MCP. Keeping it separate means the tool
 * layer stays declarative and the transport can be swapped in tests without
 * touching any tool code.
 */

import { DEFAULT_REQUEST_TIMEOUT, type Settings } from "./config.ts";
import type { ExecutionOutcome } from "./models.ts";

/** The subset of `fetch` this client needs, injectable for tests. */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Shape pyrunner returns for a completed run. */
const REQUIRED_FIELDS = ["stdout", "stderr", "exit_code", "timed_out"] as const;

/**
 * Base class for every failure talking to pyrunner.
 *
 * Raised as a tool error: it means the *request* could not be fulfilled, not
 * that the submitted script failed.
 */
export class PyRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PyRunnerError";
  }
}

/** pyrunner could not be reached, or did not answer in time. */
export class PyRunnerUnavailable extends PyRunnerError {
  constructor(message: string) {
    super(message);
    this.name = "PyRunnerUnavailable";
  }
}

/** pyrunner answered with something that is not a documented response. */
export class PyRunnerProtocolError extends PyRunnerError {
  constructor(message: string) {
    super(message);
    this.name = "PyRunnerProtocolError";
  }
}

export interface PyRunnerClientOptions {
  /** Per-request timeout in seconds. */
  requestTimeout?: number;
  /** Optional fetch override, used by tests to route at an in-process fake. */
  fetch?: FetchLike;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message !== "") {
    return error.message;
  }
  return String(error);
}

function jsonTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function requireStringField(
  payload: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new PyRunnerProtocolError(
      `pyrunner response field ${key} for ${label} must be a string, ` +
        `got ${jsonTypeName(value)}.`,
    );
  }
  return value;
}

function requireExitCode(
  payload: Record<string, unknown>,
  label: string,
): number {
  const value = payload.exit_code;
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(parsed)) {
    throw new PyRunnerProtocolError(
      `pyrunner response field exit_code for ${label} must be an integer, ` +
        `got ${JSON.stringify(value)}.`,
    );
  }
  return parsed;
}

function requireBoolean(
  payload: Record<string, unknown>,
  key: string,
  label: string,
): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") {
    throw new PyRunnerProtocolError(
      `pyrunner response field ${key} for ${label} must be a boolean, ` +
        `got ${jsonTypeName(value)}.`,
    );
  }
  return value;
}

function readDefinedNames(
  payload: Record<string, unknown>,
  label: string,
): string[] {
  const value = payload.defined_names;
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new PyRunnerProtocolError(
      `pyrunner response field defined_names for ${label} must be an array, ` +
        `got ${jsonTypeName(value)}.`,
    );
  }
  return value.map((name) => String(name));
}

/** Thin async wrapper around the two pyrunner endpoints. */
export class PyRunnerClient {
  readonly baseUrl: string;
  readonly requestTimeout: number;
  readonly #fetch: FetchLike;

  /**
   * Create a client.
   *
   * @param baseUrl Root URL of pyrunner, with or without a trailing slash.
   * @param options Timeout and optional fetch override.
   */
  constructor(baseUrl: string, options: PyRunnerClientOptions = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.requestTimeout = options.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Call `GET /health`.
   *
   * @throws {PyRunnerUnavailable} The service is unreachable or slow.
   * @throws {PyRunnerProtocolError} The response was not valid JSON.
   */
  async health(): Promise<Record<string, string>> {
    const response = await this.#request("GET", "/health");
    const payload = await this.#asObject(response, "GET /health");
    const status: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      status[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
    return status;
  }

  /**
   * Run one script and capture its output.
   *
   * @throws {PyRunnerUnavailable} The service is unreachable or slow.
   * @throws {PyRunnerProtocolError} The response did not match the documented
   *   shape.
   */
  async execute(code: string): Promise<ExecutionOutcome> {
    const started = performance.now();
    const response = await this.#request("POST", "/execute", { code });

    const label = "POST /execute";
    const payload = await this.#asObject(response, label);
    const durationSeconds = (performance.now() - started) / 1000;

    const missing = REQUIRED_FIELDS.filter((key) => !(key in payload));
    if (missing.length > 0) {
      throw new PyRunnerProtocolError(
        `pyrunner response is missing expected field(s): ${missing.join(", ")}`,
      );
    }

    const exitCode = requireExitCode(payload, label);
    const timedOut = requireBoolean(payload, "timed_out", label);

    return {
      ok: exitCode === 0 && !timedOut,
      stdout: requireStringField(payload, "stdout", label),
      stderr: requireStringField(payload, "stderr", label),
      exit_code: exitCode,
      timed_out: timedOut,
      defined_names: readDefinedNames(payload, label),
      duration_seconds: Math.round(durationSeconds * 1_000_000) / 1_000_000,
    };
  }

  // -- internals ---------------------------------------------------------

  async #request(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeout * 1000);

    const headers: Record<string, string> = { accept: "application/json" };
    const init: RequestInit = { method, headers, signal: controller.signal };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await this.#fetch(url, init);
    } catch (error) {
      if (timedOut) {
        throw new PyRunnerUnavailable(this.#timeoutMessage(method, path));
      }
      throw new PyRunnerUnavailable(
        `Could not reach pyrunner at ${this.baseUrl} (${method} ${path}): ` +
          errorMessage(error),
      );
    } finally {
      clearTimeout(timer);
    }

    await this.#raiseForStatus(response, `${method} ${path}`);
    return response;
  }

  #timeoutMessage(method: "GET" | "POST", path: string): string {
    const base =
      `pyrunner at ${this.baseUrl} did not answer within ` +
      `${this.requestTimeout} seconds (${method} ${path}).`;
    if (method === "POST") {
      return (
        `${base} Raise PYRUNNER_MCP_REQUEST_TIMEOUT if the runner's own ` +
        "PYRUNNER_TIMEOUT is set higher."
      );
    }
    return base;
  }

  async #raiseForStatus(response: Response, label: string): Promise<void> {
    if (response.ok) {
      return;
    }
    // Surface pyrunner's own error body, it is usually the actual cause.
    let body = "";
    try {
      body = (await response.text()).trim();
    } catch {
      // Ignore a body we cannot read; the status is still useful.
    }
    if (body.length > 500) {
      body = `${body.slice(0, 500)}...`;
    }
    throw new PyRunnerProtocolError(
      `pyrunner returned HTTP ${response.status} for ${label}` +
        (body === "" ? "" : `: ${body}`),
    );
  }

  async #asObject(
    response: Response,
    label: string,
  ): Promise<Record<string, unknown>> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new PyRunnerProtocolError(
        `pyrunner returned a non-JSON body for ${label}: ${errorMessage(error)}`,
      );
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new PyRunnerProtocolError(
        `pyrunner returned a ${jsonTypeName(payload)} for ${label}, ` +
          "expected a JSON object.",
      );
    }
    return payload as Record<string, unknown>;
  }
}

/** Create a {@link PyRunnerClient} from settings. */
export function buildClient(
  settings: Settings,
  options: PyRunnerClientOptions = {},
): PyRunnerClient {
  return new PyRunnerClient(settings.baseUrl, {
    ...options,
    requestTimeout: options.requestTimeout ?? settings.requestTimeout,
  });
}
