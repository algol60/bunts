import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** A throwaway directory tree used as `$HOME`-equivalent for a test. */
export interface Fixture {
  base: string
  configPath: string
}

/**
 * Creates:
 *
 *   base/
 *     notes/                     (empty)
 *     projects/
 *       readme.md
 *       app/
 *         main.ts
 *         docs/                  (empty)
 *       lib/
 *         core/                  (empty)
 *     .hidden/                   (dot-directory)
 */
export async function makeFixture(): Promise<Fixture> {
  const base = await mkdtemp(join(tmpdir(), "dirselect-test-"))
  await mkdir(join(base, "notes"), { recursive: true })
  await mkdir(join(base, "projects", "app", "docs"), { recursive: true })
  await mkdir(join(base, "projects", "lib", "core"), { recursive: true })
  await mkdir(join(base, ".hidden"), { recursive: true })
  await writeFile(join(base, "projects", "readme.md"), "readme\n")
  await writeFile(join(base, "projects", "app", "main.ts"), "export {}\n")
  return { base, configPath: join(base, "config", "config.json") }
}

export const fixturePaths = (base: string) => ({
  root: base,
  notes: join(base, "notes"),
  projects: join(base, "projects"),
  app: join(base, "projects", "app"),
  appDocs: join(base, "projects", "app", "docs"),
  lib: join(base, "projects", "lib"),
  core: join(base, "projects", "lib", "core"),
  readme: join(base, "projects", "readme.md"),
  mainTs: join(base, "projects", "app", "main.ts"),
  hidden: join(base, ".hidden"),
})
