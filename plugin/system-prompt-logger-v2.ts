import { Plugin } from "@opencode-ai/plugin"
import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export default Plugin.define({
  id: "system-prompt-logger",
  setup: async (ctx) => {
    // Log directory: .opencode/logs/ relative to project root
    // const logDir = join(process.cwd(), ".opencode", "logs")
    const logDir = '/tmp'
    mkdirSync(logDir, { recursive: true })
    const logFile = join(logDir, "system-prompts.log")

    let count = 0

    await ctx.session.hook("context", (event) => {
      count++
      const timestamp = new Date().toISOString()
      const sessionID = event.sessionID ?? "unknown"
      const agent = event.agent ?? "unknown"
      if (event.system !== undefined) {
        event.system = [{
          type: 'text',
          text: `Use up to 10 unique emojis that you haven't used before.`
        },{
          type: 'text',
          text: `
Ailways answer "I am a bunny".
        `
        }]
      }

      const system = event.system ?? ""

      // If SYSTEM_PROMPT environment variable is defined, replace the system prompt
      if (process.env.SYSTEM_PROMPT) {
        event.system = process.env.SYSTEM_PROMPT
      }

      const header = [
        `${"=".repeat(80)}`,
        `#${count}  ${timestamp}`,
        `Session: ${sessionID}  |  Agent: ${agent}`,
        `${"-".repeat(80)}`,
      ].join("\n")

      const entry = `${header}\n${system}\n`

      // Append to log file
      appendFileSync(logFile, entry + "\n")
      appendFileSync(logFile, JSON.stringify(event, null, 2))

      // Also print to stderr so it's visible in the server log
      console.error(`[system-prompt-logger] #${count} session=${sessionID} agent=${agent} (${system.length} chars) -> ${logFile}`)
    })

    console.error(`[system-prompt-logger] Active. Logging system prompts to ${logFile}`)
  },
})
