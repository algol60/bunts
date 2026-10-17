import { createCliRenderer } from "@opentui/core"
import { App } from "./app"
import { UsageError, VERSION, helpText, parseArgs } from "./cli"
import { defaultConfigPath, emptyConfig, loadConfig, type ConfigFile } from "./config"

async function main(): Promise<void> {
  let opts
  try {
    opts = parseArgs(Bun.argv.slice(2))
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`dirselect: ${err.message}\n\n${helpText()}\n`)
      process.exitCode = 2
      return
    }
    throw err
  }

  if (opts.help) {
    process.stdout.write(helpText() + "\n")
    return
  }
  if (opts.version) {
    process.stdout.write(`dirselect ${VERSION}\n`)
    return
  }

  const configPath = opts.configPath ?? process.env.DIRSELECT_CONFIG ?? defaultConfigPath()

  let config: ConfigFile
  let warning: string | undefined
  try {
    config = await loadConfig(configPath)
  } catch (err) {
    // A corrupt config must not stop the app: start empty and warn.
    config = emptyConfig()
    warning = `${(err as Error).message} (starting with an empty list)`
  }

  // exitOnCtrlC is false so our handler can run the save flow before quitting.
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    exitSignals: ["SIGTERM", "SIGQUIT", "SIGHUP"],
  })

  try {
    const app = new App(renderer, { opts, configPath, config, warning })
    await app.start()
  } finally {
    renderer.destroy()
    await renderer.closed
  }
}

main().catch((err) => {
  process.stderr.write(`dirselect: ${err?.message ?? err}\n`)
  process.exitCode = 1
})
