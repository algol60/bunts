import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import type { Config } from "./config.ts"
import { createServer } from "./server.ts"

export const startStdio = async (config: Config) => {
  const server = createServer(config)
  await server.connect(new StdioServerTransport())
  return server
}
