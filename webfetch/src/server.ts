import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { loadConfig, type Config } from "./config.ts"
import { NAME, VERSION } from "./version.ts"
import { DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS, description, fetchWeb } from "./webfetch.ts"

const instructions = `Use the webfetch tool to read an HTTP or HTTPS URL. It returns markdown by default.
When a page is very large, the result is a preview and the complete output is saved to a local file whose path is included in the result.`

export const createServer = (config: Config = loadConfig()) => {
  const server = new McpServer(
    { name: NAME, version: VERSION, title: "OpenCode Webfetch" },
    { instructions },
  )

  server.registerTool(
    "webfetch",
    {
      title: "Web Fetch",
      description,
      inputSchema: {
        url: z.string().describe("The HTTP or HTTPS URL to fetch content from"),
        format: z
          .enum(["text", "markdown", "html"])
          .default("markdown")
          .describe("The format to return the content in. Defaults to markdown."),
        timeout: z
          .number()
          .gt(0)
          .lte(MAX_TIMEOUT_SECONDS)
          .optional()
          .describe(
            `Optional timeout in seconds (default: ${DEFAULT_TIMEOUT_SECONDS}, maximum: ${MAX_TIMEOUT_SECONDS})`,
          ),
      },
      outputSchema: {
        url: z.string(),
        contentType: z.string(),
        format: z.enum(["text", "markdown", "html"]),
        output: z.string(),
        truncated: z.boolean(),
        outputPath: z.string().optional(),
        bytes: z.number().int().nonnegative(),
        lines: z.number().int().nonnegative(),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const result = await fetchWeb(input, config)
        const content = [{ type: "text" as const, text: result.output }]
        if (result.marker) content.push({ type: "text" as const, text: result.marker })

        return {
          content,
          structuredContent: {
            url: result.url,
            contentType: result.contentType,
            format: result.format,
            output: result.output,
            truncated: result.truncated,
            ...(result.outputPath ? { outputPath: result.outputPath } : {}),
            bytes: result.bytes,
            lines: result.lines,
          },
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return {
          content: [{ type: "text" as const, text: `Unable to fetch ${input.url}: ${detail}` }],
          isError: true,
        }
      }
    },
  )

  return server
}
