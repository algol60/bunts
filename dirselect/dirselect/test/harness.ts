import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"
import { App } from "../src/app"
import type { CliOptions } from "../src/cli"
import { emptyConfig, type ConfigFile } from "../src/config"

export interface Harness extends TestRendererSetup {
  app: App
  /** Let queued frames and pending microtasks settle. */
  tick: () => Promise<void>
  /** Resolves when the app quits (never rejects). */
  done: Promise<void>
  explicit: () => string[]
  rows: () => string[]
  /** Move the explorer cursor onto the row for `path`. */
  focusPath: (path: string) => Promise<void>
}

export interface StartOptions {
  roots: string[]
  configPath: string
  config?: ConfigFile
  showFiles?: boolean
  showHidden?: boolean
  followSymlinks?: boolean
  width?: number
  height?: number
  /** Enable the kitty keyboard protocol (needed for a bare Escape key). */
  kittyKeyboard?: boolean
}

/** Boot the real app on opentui's in-memory renderer. */
export async function startApp(options: StartOptions): Promise<Harness> {
  const setup = await createTestRenderer({
    width: options.width ?? 80,
    height: options.height ?? 24,
    kittyKeyboard: options.kittyKeyboard ?? false,
    // Match production: Ctrl+C is a key we handle, not an instant destroy.
    exitOnCtrlC: false,
  })

  const cli: CliOptions = {
    roots: options.roots,
    showFiles: options.showFiles ?? false,
    showHidden: options.showHidden ?? false,
    followSymlinks: options.followSymlinks ?? false,
    help: false,
    version: false,
  }

  const app = new App(setup.renderer, {
    opts: cli,
    configPath: options.configPath,
    config: options.config ?? emptyConfig(),
  })

  const done = app.start()
  void done.catch(() => undefined)

  const tick = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await setup.flush()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  await tick()

  const state = () => app.explorer

  const focusPath = async (path: string): Promise<void> => {
    const current = app.explorer
    if (!current) throw new Error("explorer is not open")
    const index = current.rows.findIndex((row) => row.node.path === path)
    if (index < 0) throw new Error(`no visible row for ${path}`)
    const delta = index - current.cursor
    const key = delta > 0 ? "j" : "k"
    for (let i = 0; i < Math.abs(delta); i++) setup.mockInput.pressKey(key)
    await tick()
  }

  return {
    ...setup,
    app,
    tick,
    done,
    explicit: () => [...(state()?.explicit ?? [])].sort(),
    rows: () => (state()?.rows ?? []).map((row) => row.node.path),
    focusPath,
  }
}
