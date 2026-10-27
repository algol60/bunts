import { userInfo } from "node:os"
import { Plugin } from "@opencode/plugin"

/**
 * Literal placeholder replaced with the current OS username in every system
 * prompt part before the request is sent.
 */
const PLACEHOLDER = "{{REPLACE}}"

export default Plugin.define({
  id: "sysprompt2",
  async setup(ctx) {
    const username = userInfo().username

    // The "context" hook runs for the agent loop, including tool-driven
    // continuations, and receives an owned draft of the outgoing request.
    // Edits affect only that model call; persisted history is untouched.
    await ctx.session.hook("context", (event) => {
      for (const [index, part] of event.system.entries()) {
        if (part.type !== "text" || !part.text.includes(PLACEHOLDER)) continue

        event.system[index] = {
          ...part,
          text: part.text.replaceAll(PLACEHOLDER, username),
        }
      }
    })
  },
})
