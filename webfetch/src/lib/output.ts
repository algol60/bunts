import { randomBytes } from "node:crypto"
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { RETENTION_MS, type Config } from "../config.ts"

export type Format = "text" | "markdown" | "html"

export type BoundedOutput = {
  /** Text that fits in the inline budget. Never contains the truncation marker. */
  readonly output: string
  /** Marker to show after `output`, when the full text was saved to disk. */
  readonly marker?: string
  readonly truncated: boolean
  readonly outputPath?: string
  /** UTF-8 byte length of the complete converted output. */
  readonly bytes: number
  /** Line count of the complete converted output. */
  readonly lines: number
}

const extension = (format: Format) => (format === "markdown" ? ".md" : format === "html" ? ".html" : ".txt")

export const outputDirectory = (config: Config) => join(config.dataDir, "tool-output")

export const saveOutput = async (text: string, format: Format, config: Config) => {
  const directory = outputDirectory(config)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, `tool_${randomBytes(6).toString("hex")}${extension(format)}`)
  await writeFile(file, text, { encoding: "utf8", mode: 0o600 })
  return file
}

/**
 * Bound an output the same way OpenCode does: 2,000 lines / 50 KiB by default,
 * with the complete text retained in a file when either limit is exceeded.
 */
export const boundOutput = async (text: string, format: Format, config: Config): Promise<BoundedOutput> => {
  const bytes = Buffer.byteLength(text, "utf8")
  const lines = text.split("\n")
  if (text.endsWith("\n")) lines.pop()

  if (lines.length <= config.maxLines && bytes <= config.maxBytes) {
    return { output: text, truncated: false, bytes, lines: lines.length }
  }

  const kept: string[] = []
  let keptBytes = 0
  for (const line of lines.slice(0, config.maxLines)) {
    const size = Buffer.byteLength(line, "utf8") + (kept.length > 0 ? 1 : 0)
    if (keptBytes + size > config.maxBytes) break
    kept.push(line)
    keptBytes += size
  }

  const outputPath = await saveOutput(text, format, config)
  const shown = kept.length > 0 ? `lines 1-${kept.length}` : "0 lines"
  const marker = `[showing ${shown} of ${lines.length}; full output saved to ${outputPath}]`

  return {
    output: kept.join("\n"),
    marker,
    truncated: true,
    outputPath,
    bytes,
    lines: lines.length,
  }
}

/** Best-effort removal of outputs older than the retention window. */
export const cleanupOutputs = async (config: Config, now = Date.now()) => {
  const directory = outputDirectory(config)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^tool_[0-9a-f]{12}/.test(entry.name))
      .map(async (entry) => {
        const file = join(directory, entry.name)
        try {
          const info = await stat(file)
          if (now - info.mtimeMs > RETENTION_MS) await unlink(file)
        } catch {
          // Retention is best effort; another process may have removed the file.
        }
      }),
  )
}
