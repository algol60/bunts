import { Plugin } from '@opencode-ai/plugin'
import { appendFileSync } from 'fs';

function log(line: string) {
  appendFileSync('/tmp/plugin.log', `${line}\n`)
}

const PREFIX = '● '

export default Plugin.define({
  id: 'local.session-rename',
  setup: async (ctx) => {
    const controller = new AbortController()

    // The promise API type for SessionDomain omits `rename`, but the server
    // runtime provides it (confirmed by the effect API types and plugin docs).
    // A narrow cast keeps the rest of the code type-safe.
    const session = ctx.session as typeof ctx.session & {
      rename(input: { sessionID: string; title: string }): Promise<void>
    }

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          log(`=> ${event.type}\n${JSON.stringify(event, null, 2)}`)
          if (event.type !== 'session.renamed') continue

          const { sessionID, title } = event.data

          // Guard: if the title already has our prefix, do nothing.
          // This prevents the infinite loop that would otherwise occur when our
          // own rename below fires another session.renamed event.
          if (title.startsWith(PREFIX)) continue

          const newTitle = `${PREFIX}${title}`

          try {
            await session.rename({ sessionID, title: newTitle })
          } catch (err) {
            console.error(
              `[session-rename] failed to rename session ${sessionID}:`,
              err,
            )
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('[session-rename] event subscription failed:', error)
        }
      }
    })()

    return () => controller.abort()
  },
})
