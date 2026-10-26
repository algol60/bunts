import type { Config } from "./config.ts"
import { convertHTMLToMarkdown, extractTextFromHTML } from "./lib/html.ts"
import { FetchError, readBoundedBody } from "./lib/http.ts"
import { isTextual } from "./lib/mime.ts"
import { boundOutput, type Format } from "./lib/output.ts"

export const DEFAULT_TIMEOUT_SECONDS = 30
export const MAX_TIMEOUT_SECONDS = 120

export const description = `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default.

Use a more targeted tool when one is available. This tool is read-only. Large text results may be replaced with a preview while the complete output is retained in a local file. When that happens, the result includes the file path, which can be read with a file-reading tool.`

export type WebfetchInput = {
  url: string
  format?: Format
  timeout?: number
}

export type WebfetchResult = {
  url: string
  contentType: string
  format: Format
  output: string
  truncated: boolean
  outputPath?: string
  marker?: string
  bytes: number
  lines: number
}

const acceptHeader = (format: Format) => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
  }
}

const requestHeaders = (format: Format, userAgent: string) => ({
  "User-Agent": userAgent,
  Accept: acceptHeader(format),
  "Accept-Language": "en-US,en;q=0.9",
})

const isCloudflareChallenge = (response: Response) =>
  response.status === 403 && (response.headers.get("cf-mitigated") ?? "").trim().toLowerCase() === "challenge"

const mimeOf = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? ""

// SVG is deliberately not treated as an attachment: OpenCode rejects it as a
// non-textual file instead, and this server keeps that behavior.
const isImageAttachment = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet"

const convert = (content: string, contentType: string, format: Format) => {
  if (!contentType.toLowerCase().includes("text/html")) return content
  if (format === "markdown") return convertHTMLToMarkdown(content)
  if (format === "text") return extractTextFromHTML(content)
  return content
}

const timedOut = () => new FetchError("Request timed out")

const describeError = (error: unknown) => {
  if (error instanceof FetchError) return error
  if (error instanceof Error) {
    const cause = error.cause as { code?: unknown; message?: unknown } | undefined
    const detail =
      typeof cause?.code === "string" ? cause.code : typeof cause?.message === "string" ? cause.message : undefined
    return new FetchError(detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message, {
      cause: error,
    })
  }
  return new FetchError(String(error))
}

const fetchResponse = (url: string, format: Format, userAgent: string, signal: AbortSignal) =>
  fetch(url, {
    method: "GET",
    headers: requestHeaders(format, userAgent),
    redirect: "follow",
    signal,
  })

export const fetchWeb = async (input: WebfetchInput, config: Config): Promise<WebfetchResult> => {
  let target: URL
  try {
    target = new URL(input.url)
  } catch {
    throw new FetchError("Invalid URL")
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new FetchError("URL must use http:// or https://")
  }

  const format = input.format ?? "markdown"
  if (format !== "text" && format !== "markdown" && format !== "html") {
    throw new FetchError("Format must be text, markdown, or html")
  }
  const seconds = input.timeout ?? DEFAULT_TIMEOUT_SECONDS
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_TIMEOUT_SECONDS) {
    throw new FetchError(`Timeout must be greater than 0 and at most ${MAX_TIMEOUT_SECONDS} seconds`)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(timedOut()), Math.max(1, Math.ceil(seconds * 1_000)))

  try {
    let response = await fetchResponse(input.url, format, config.userAgent, controller.signal)

    // Cloudflare's managed challenge rejects browser-shaped clients. Retry once
    // with an honest product user agent, within the same timeout budget.
    if (isCloudflareChallenge(response)) {
      void response.body?.cancel().catch(() => undefined)
      response = await fetchResponse(input.url, format, config.honestUserAgent, controller.signal)
    }

    if (!response.ok) {
      const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`
      void response.body?.cancel().catch(() => undefined)
      throw new FetchError(`${status} for GET ${input.url}`)
    }

    const contentType = response.headers.get("content-type") ?? ""
    const mime = mimeOf(contentType)
    if (isImageAttachment(mime)) throw new FetchError(`Unsupported fetched image content type: ${mime}`)
    if (!isTextual(mime)) throw new FetchError(`Unsupported fetched file content type: ${mime}`)

    const body = await readBoundedBody(response)
    const content = new TextDecoder().decode(body)
    const converted = convert(content, contentType, format)
    const bounded = await boundOutput(converted, format, config)

    const result: WebfetchResult = {
      url: input.url,
      contentType,
      format,
      output: bounded.output,
      truncated: bounded.truncated,
      bytes: bounded.bytes,
      lines: bounded.lines,
    }
    if (bounded.outputPath) result.outputPath = bounded.outputPath
    if (bounded.marker) result.marker = bounded.marker
    return result
  } catch (error) {
    if (controller.signal.aborted) throw timedOut()
    throw describeError(error)
  } finally {
    clearTimeout(timer)
  }
}
