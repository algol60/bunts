export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

export class FetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "FetchError"
  }
}

/**
 * Read a response body while enforcing a hard byte limit. Content-Length is
 * checked up front, and the stream is enforced as well so chunked or lying
 * responses cannot exhaust memory.
 */
export const readBoundedBody = async (response: Response, maximumBytes = MAX_RESPONSE_BYTES) => {
  const declared = response.headers.get("content-length")
  const declaredSize = declared ? Number.parseInt(declared, 10) : Number.NaN
  if (Number.isSafeInteger(declaredSize) && declaredSize > maximumBytes) {
    throw new FetchError(`Response too large (exceeds ${maximumBytes} byte limit)`)
  }

  if (!response.body) return new Uint8Array()

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      if (size + value.byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw new FetchError(`Response too large (exceeds ${maximumBytes} byte limit)`)
      }
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
