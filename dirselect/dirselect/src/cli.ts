import { homedir } from "node:os"
import { canonical } from "./paths"

export class UsageError extends Error {}

export const VERSION = "1.0.0"

export interface CliOptions {
  /** Canonical absolute roots, in display order. `$HOME` is always first. */
  roots: string[]
  configPath?: string
  showFiles: boolean
  showHidden: boolean
  followSymlinks: boolean
  help: boolean
  version: boolean
}

/**
 * Parse argv (already stripped of the runtime and script name). `$HOME` is
 * always the first root; positional ROOT arguments are appended in order.
 */
export function parseArgs(argv: readonly string[], home: string = homedir()): CliOptions {
  const opts: CliOptions = {
    roots: [],
    showFiles: false,
    showHidden: false,
    followSymlinks: false,
    help: false,
    version: false,
  }
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    switch (arg) {
      case "--config": {
        const value = argv[++i]
        if (value === undefined || value === "") throw new UsageError("--config requires a path")
        opts.configPath = canonical(value, home)
        break
      }
      case "--files":
        opts.showFiles = true
        break
      case "--hidden":
        opts.showHidden = true
        break
      case "--follow-symlinks":
        opts.followSymlinks = true
        break
      case "-h":
      case "--help":
        opts.help = true
        break
      case "-v":
      case "--version":
        opts.version = true
        break
      default:
        if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown option: ${arg}`)
        positionals.push(arg)
    }
  }

  const homeCanonical = canonical(home, home)
  const extra: string[] = []
  for (const p of positionals) {
    const c = canonical(p, home)
    if (c !== homeCanonical && !extra.includes(c)) extra.push(c)
  }
  opts.roots = [homeCanonical, ...extra]
  return opts
}

export function helpText(): string {
  return `DirSelect — manage named sets of directories

Usage:
  dirselect [options] [ROOT...]

Roots are the directories shown at the top of the tree. $HOME is always a
root; any ROOT arguments are shown in addition to it, in the order given.

Options:
  --config <path>     config file to use (default: $XDG_CONFIG_HOME/dirselect/config.json)
  --files             start with files visible (default: directories only)
  --hidden            show dotfiles and dot-directories
  --follow-symlinks   follow symlinked directories (cycle-guarded)
  -h, --help          show this help
  -v, --version       show the version

Home screen:
  Enter open · n new · r rename · d delete · q quit

Explorer:
  space toggle · Enter/←/→ fold · f files · s save · q back`
}
