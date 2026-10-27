import { Plugin } from "@opencode/plugin"
import { appendFileSync } from "node:fs"

export default Plugin.define({
  id: "logprompt2",
  async setup(ctx) {

    // The "context" hook runs for the agent loop, including tool-driven
    // continuations, and receives an owned draft of the outgoing request.
    // Edits affect only that model call; persisted history is untouched.
    await ctx.session.hook("context", (event) => {
      appendFileSync('/tmp/syse.log', `@@ event\n${JSON.stringify(event, null, 2)}\n`)
      for (const [index, part] of event.system.entries()) {
        appendFileSync('/tmp/sysp.log', `@@ ${index}\n${JSON.stringify(part, null, 2)}\n`)
        //if (part.type !== "text" || !part.text.includes(PLACEHOLDER)) continue

        //event.system[index] = {
        //  ...part,
        //  text: part.text.replaceAll(PLACEHOLDER, username),
        //}
      }
    })
  },
})
