import { Plugin } from "@opencode/plugin"

const PREFIX = "XYZZY "

export default Plugin.define({
  id: "rename2",
  async setup(ctx) {
    const controller = new AbortController()

    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "session.renamed") continue

        const { sessionID, title } = event.data
        if (title.startsWith(PREFIX)) continue

        try {
          await ctx.session.update({ sessionID, title: `${PREFIX}${title}` })
        } catch (error) {
          console.error(`[rename2] Failed to rename session ${sessionID}:`, error)
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) {
        console.error("[rename2] Session title subscription failed:", error)
      }
    })

    return () => controller.abort()
  },
})
