/**
 * Runtime configuration for the pyrunner MCP server.
 *
 * Every setting can be supplied through an environment variable so the server
 * can be dropped into a client config without editing code. Values are parsed
 * and validated here, once, at startup, so a typo fails loudly at boot instead
 * of producing confusing errors mid-tool-call.
 */

/** Where the pyrunner HTTP server lives unless told otherwise. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

/**
 * Wall-clock budget for a single HTTP call to pyrunner.
 *
 * This must stay comfortably *above* the runner's own execution timeout
 * (`PYRUNNER_TIMEOUT`, 30s by default). If the HTTP timeout were smaller we
 * would abandon the request while the script was still running, and would throw
 * away the output it eventually produced.
 */
export const DEFAULT_REQUEST_TIMEOUT = 60.0;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8765;

export const VALID_TRANSPORTS = ["stdio", "streamable-http"] as const;
export type Transport = (typeof VALID_TRANSPORTS)[number];

export type Env = Record<string, string | undefined>;

/** Raised when the environment holds an unusable configuration value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface Settings {
  /** Root URL of the pyrunner service, without a trailing slash. */
  readonly baseUrl: string;
  /** Seconds to wait for a single pyrunner HTTP call. */
  readonly requestTimeout: number;
  /** How MCP clients connect to this server. */
  readonly transport: Transport;
  /** Bind address, used by the HTTP transport only. */
  readonly host: string;
  /** Bind port, used by the HTTP transport only. */
  readonly port: number;
}

function quote(value: string | undefined): string {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const INTEGER_RE = /^[+-]?\d+$/;

function readFloat(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new ConfigError(`${key} must be a number, got ${quote(raw)}`);
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    throw new ConfigError(`${key} must be a number, got ${quote(raw)}`);
  }
  if (value <= 0) {
    throw new ConfigError(`${key} must be greater than 0, got ${value}`);
  }
  return value;
}

function readPort(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const trimmed = raw.trim();
  if (!INTEGER_RE.test(trimmed)) {
    throw new ConfigError(`${key} must be an integer, got ${quote(raw)}`);
  }
  return Number(trimmed);
}

/**
 * Build settings from `env` (defaults to `process.env`).
 *
 * @throws {ConfigError} If a value is present but cannot be parsed.
 */
export function settingsFromEnv(env: Env = process.env): Settings {
  const rawUrl = env.PYRUNNER_MCP_URL;
  let baseUrl =
    rawUrl === undefined || rawUrl.trim() === "" ? DEFAULT_BASE_URL : rawUrl.trim();

  if (!baseUrl.includes("://")) {
    baseUrl = `http://${baseUrl}`;
  }

  // Reject a scheme with no host, e.g. "http://", before normalising.
  const afterScheme = baseUrl.split("://", 2)[1] ?? "";
  const netloc = afterScheme.split("/", 2)[0] ?? "";
  if (netloc === "") {
    throw new ConfigError(`PYRUNNER_MCP_URL has no host: ${quote(rawUrl)}`);
  }

  // Normalise so URL joining never produces a double slash.
  baseUrl = baseUrl.replace(/\/+$/, "");

  const rawTransport = env.PYRUNNER_MCP_TRANSPORT ?? "streamable-http";
  const transport = rawTransport.trim().toLowerCase();
  if (!(VALID_TRANSPORTS as readonly string[]).includes(transport)) {
    throw new ConfigError(
      `PYRUNNER_MCP_TRANSPORT must be one of ${VALID_TRANSPORTS.join(", ")}; ` +
        `got ${quote(transport)}`,
    );
  }

  const port = readPort(env, "PYRUNNER_MCP_PORT", DEFAULT_PORT);
  if (port < 1 || port > 65535) {
    throw new ConfigError(`PYRUNNER_MCP_PORT must be in 1-65535, got ${port}`);
  }

  return Object.freeze({
    baseUrl,
    requestTimeout: readFloat(
      env,
      "PYRUNNER_MCP_REQUEST_TIMEOUT",
      DEFAULT_REQUEST_TIMEOUT,
    ),
    transport: transport as Transport,
    host: env.PYRUNNER_MCP_HOST?.trim() || DEFAULT_HOST,
    port,
  });
}

/** Return a JSON-friendly view, used by the `runner_status` tool. */
export function describeSettings(settings: Settings): Record<string, unknown> {
  return {
    base_url: settings.baseUrl,
    request_timeout_seconds: settings.requestTimeout,
    transport: settings.transport,
  };
}
