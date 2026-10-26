import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { hostnameOf } from "./lib/host.ts"
import { NAME, VERSION } from "./version.ts"

export const DEFAULT_MAX_LINES = 2_000
export const DEFAULT_MAX_BYTES = 50 * 1024
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
export const DEFAULT_HTTP_HOST = "127.0.0.1"
export const DEFAULT_HTTP_PORT = 3000
export const DEFAULT_HTTP_PATH = "/mcp"

export type Config = {
  /** Browser-compatible user agent used for the first request. */
  readonly userAgent: string
  /** Honest product user agent used when a Cloudflare challenge rejects the first request. */
  readonly honestUserAgent: string
  /** Directory that retains full tool outputs which were too large for the model. */
  readonly dataDir: string
  /** Maximum lines returned inline before the output is written to disk. */
  readonly maxLines: number
  /** Maximum UTF-8 bytes returned inline before the output is written to disk. */
  readonly maxBytes: number
}

export type Environment = Record<string, string | undefined>

export type HttpConfig = {
  /** Interface to bind. Defaults to 127.0.0.1. */
  readonly host: string
  /** Port to bind. 0 asks the operating system for a free port. */
  readonly port: number
  /** Exact request path for the MCP endpoint. */
  readonly path: string
  /** Hostnames accepted in Host and Origin headers. */
  readonly allowedHosts: ReadonlySet<string>
}

const positiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

const expandHome = (value: string) => {
  if (value === "~") return homedir()
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2))
  return value
}

export const defaultDataDir = (env: Environment = process.env) => {
  const configured = env.WEBFETCH_DATA_DIR?.trim()
  if (configured) return resolve(expandHome(configured))

  const xdg = env.XDG_DATA_HOME?.trim()
  if (xdg) return join(resolve(expandHome(xdg)), NAME)
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", NAME)
  if (process.platform === "win32") return join(env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), NAME)
  return join(homedir(), ".local", "share", NAME)
}

export const loadConfig = (env: Environment = process.env): Config => {
  const userAgent =
    env.WEBFETCH_USER_AGENT?.trim() ||
    `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ${NAME}/${VERSION}`
  const honestUserAgent = env.WEBFETCH_HONEST_USER_AGENT?.trim() || `${NAME}/${VERSION}`

  return {
    userAgent,
    honestUserAgent,
    dataDir: defaultDataDir(env),
    maxLines: positiveInteger(env.WEBFETCH_MAX_LINES, DEFAULT_MAX_LINES),
    maxBytes: positiveInteger(env.WEBFETCH_MAX_BYTES, DEFAULT_MAX_BYTES),
  }
}

const httpPort = (value: string | undefined) => {
  if (!value?.trim()) return DEFAULT_HTTP_PORT
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("WEBFETCH_PORT must be an integer between 0 and 65535")
  }
  return port
}

const httpPath = (value: string | undefined) => {
  const path = value?.trim() || DEFAULT_HTTP_PATH
  if (!path.startsWith("/")) throw new Error("WEBFETCH_PATH must start with /")
  if (path.includes("?") || path.includes("#")) throw new Error("WEBFETCH_PATH must not include a query or fragment")
  return path.replace(/\/+$/, "") || "/"
}

export const loadHttpConfig = (env: Environment = process.env): HttpConfig => {
  const host = env.WEBFETCH_HOST?.trim() || DEFAULT_HTTP_HOST
  const allowedHosts = new Set(["127.0.0.1", "localhost", "::1"])

  // Loopback aliases are always accepted. Additional hostnames can be listed
  // for LAN access, and the bind host itself is accepted when it is specific.
  for (const value of [host, ...(env.WEBFETCH_ALLOWED_HOSTS?.split(",") ?? [])]) {
    const name = hostnameOf(value)
    if (name && name !== "0.0.0.0" && name !== "::") allowedHosts.add(name)
  }

  return {
    host,
    port: httpPort(env.WEBFETCH_PORT),
    path: httpPath(env.WEBFETCH_PATH),
    allowedHosts,
  }
}
