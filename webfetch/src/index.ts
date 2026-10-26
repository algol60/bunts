#!/usr/bin/env bun
import { loadConfig, loadHttpConfig, type Environment } from "./config.ts"
import { startHttp } from "./http.ts"
import { startMaintenance } from "./maintenance.ts"
import { startStdio } from "./stdio.ts"
import { NAME, VERSION } from "./version.ts"

type Transport = "http" | "stdio"

const usage = `${NAME} ${VERSION}

A stateless Streamable HTTP MCP server that replaces OpenCode's built-in webfetch tool.

Usage:
  ${NAME} [--http] [options]   Start the HTTP server (default)
  ${NAME} --stdio              Start the stdio server

HTTP options:
  --host <host>    Interface to bind (default: 127.0.0.1)
  --port <port>    Port to bind, 0 for a free port (default: 3000)
  --path <path>    MCP endpoint path (default: /mcp)

Other:
  --help, -h       Show this help
  --version, -v    Show the version

Environment:
  WEBFETCH_HOST, WEBFETCH_PORT, WEBFETCH_PATH, WEBFETCH_ALLOWED_HOSTS
  WEBFETCH_USER_AGENT, WEBFETCH_HONEST_USER_AGENT
  WEBFETCH_DATA_DIR, WEBFETCH_MAX_LINES, WEBFETCH_MAX_BYTES
`

const parseArgs = (args: string[]) => {
  const env: Environment = { ...process.env }
  let transport: Transport = "http"
  let selected: Transport | undefined

  const select = (next: Transport) => {
    if (selected && selected !== next) throw new Error("--http and --stdio cannot be used together")
    selected = next
    transport = next
  }
  const value = (index: number, flag: string) => {
    const next = args[index + 1]
    if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value`)
    return next
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    switch (arg) {
      case "--http":
        select("http")
        break
      case "--stdio":
        select("stdio")
        break
      case "--host":
        env.WEBFETCH_HOST = value(index, "--host")
        index++
        break
      case "--port":
        env.WEBFETCH_PORT = value(index, "--port")
        index++
        break
      case "--path":
        env.WEBFETCH_PATH = value(index, "--path")
        index++
        break
      case "--":
        break
      case "--help":
      case "-h":
        return { help: true, version: false, transport, env }
      case "--version":
      case "-v":
        return { help: false, version: true, transport, env }
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return { help: false, version: false, transport, env }
}

const main = async () => {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${NAME}: ${detail}\n\n${usage}`)
    process.exitCode = 2
    return
  }

  if (args.help) {
    process.stdout.write(usage)
    return
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`)
    return
  }

  const config = loadConfig(args.env)
  const httpConfig = args.transport === "http" ? loadHttpConfig(args.env) : undefined
  const stopMaintenance = startMaintenance(config)

  let stop: () => void | Promise<void>
  if (args.transport === "http") {
    const running = startHttp(config, httpConfig)
    process.stderr.write(`${NAME}: listening on ${running.url}\n`)
    stop = () => running.server.stop(true)
  } else {
    const server = await startStdio(config)
    stop = () => server.close()
  }

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    process.stderr.write(`${NAME}: ${signal}, shutting down\n`)
    stopMaintenance()
    await Promise.resolve(stop()).catch(() => undefined)
    process.exit(0)
  }

  process.on("SIGINT", () => void shutdown("SIGINT"))
  process.on("SIGTERM", () => void shutdown("SIGTERM"))
}

main().catch((error) => {
  process.stderr.write(`${NAME}: fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
