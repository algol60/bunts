import { promises as fs } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { canonical } from "./paths"
import { canonicalize } from "./selection"

export interface Selection {
  name: string
  paths: string[]
}

export interface ConfigFile {
  version: 1
  selections: Selection[]
}

export class ConfigError extends Error {}

export function emptyConfig(): ConfigFile {
  return { version: 1, selections: [] }
}

export function defaultConfigPath(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config")
  return join(base, "dirselect", "config.json")
}

export async function loadConfig(path: string): Promise<ConfigFile> {
  let text: string
  try {
    text = await fs.readFile(path, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig()
    throw new ConfigError(`cannot read ${path}: ${(err as Error).message}`)
  }
  try {
    return normalizeConfig(JSON.parse(text))
  } catch (err) {
    if (err instanceof SyntaxError) throw new ConfigError(`cannot parse ${path}: ${err.message}`)
    throw err
  }
}

/** Atomic replace: write a temp file in the same directory, then rename. */
export async function saveConfig(path: string, config: ConfigFile): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8")
  await fs.rename(tmp, path)
}

/** Defense in depth: accept anything, emit a valid `ConfigFile`. */
export function normalizeConfig(input: unknown): ConfigFile {
  const raw = (input ?? {}) as Record<string, unknown>
  const list = Array.isArray(raw.selections) ? raw.selections : []
  const byName = new Map<string, Selection>()

  for (const item of list) {
    const entry = (item ?? {}) as Record<string, unknown>
    const name = String(entry.name ?? "").trim()
    if (!name) continue
    const paths = Array.isArray(entry.paths)
      ? canonicalize(
          entry.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => canonical(p)),
        )
      : []
    byName.set(name, { name, paths })
  }

  return { version: 1, selections: [...byName.values()] }
}

/** Insert or replace a selection by name, preserving display order. */
export function upsertSelection(config: ConfigFile, name: string, paths: readonly string[]): void {
  const normalized = canonicalize(paths)
  const index = config.selections.findIndex((s) => s.name === name)
  if (index >= 0) config.selections[index] = { name, paths: normalized }
  else config.selections.push({ name, paths: normalized })
}

export function removeSelection(config: ConfigFile, name: string): boolean {
  const index = config.selections.findIndex((s) => s.name === name)
  if (index < 0) return false
  config.selections.splice(index, 1)
  return true
}

export function renameSelection(config: ConfigFile, from: string, to: string): boolean {
  const entry = config.selections.find((s) => s.name === from)
  if (!entry) return false
  entry.name = to
  return true
}

export function findSelection(config: ConfigFile, name: string): Selection | undefined {
  return config.selections.find((s) => s.name === name)
}
