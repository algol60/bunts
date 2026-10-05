import { App } from './ui/app'
import { AppState } from './state'
import { getDefaultPath, loadMarksFile } from './file'
import { createCliRenderer } from '@opentui/core'

const USAGE = `Usage: cedit [path]

Edits the 'marks' array of a JSON file, leaving every other key untouched.
Defaults to ~/cedit.json when no path is given.`

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) {
    console.log(USAGE)
    return
  }
  if (args.length > 1) {
    console.error(`cedit takes at most one path.\n\n${USAGE}`)
    process.exit(2)
  }

  const filePath = args[0] ?? getDefaultPath()
  const result = await loadMarksFile(filePath)

  if (result.kind === 'invalid') {
    // Refuse rather than start empty: an empty document would be written back
    // over the file on the next save, replacing whatever was really there.
    console.error(`${result.error}\n\nThe file was left untouched.`)
    process.exit(1)
  }

  // The renderer is created here rather than inside App.init so that a failure
  // partway through setup can still put the terminal back the way it was.
  // createCliRenderer switches the terminal to raw mode, and a raw terminal with
  // no renderer to restore it is unusable.
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    // Disambiguate escape codes so Esc reliably reaches us and so
    // Ctrl+Arrow / Ctrl+A / Ctrl+D are reported with their modifiers.
    useKittyKeyboard: { disambiguate: true, events: false },
  })

  const state = new AppState(filePath, result.data)
  const app = new App(state, result.warnings)

  try {
    await app.init(renderer)
  } catch (error) {
    renderer.destroy()
    console.error('Failed to start cedit:', error)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Failed to start cedit:', error)
  process.exit(1)
})
