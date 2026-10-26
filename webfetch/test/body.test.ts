import { expect, test } from "bun:test"
import { MAX_RESPONSE_BYTES, readBoundedBody } from "../src/lib/http.ts"

test("rejects an oversized declared Content-Length before reading", async () => {
  const response = new Response("small", {
    headers: { "content-type": "text/plain", "content-length": String(MAX_RESPONSE_BYTES + 1) },
  })
  await expect(readBoundedBody(response)).rejects.toThrow(
    `Response too large (exceeds ${MAX_RESPONSE_BYTES} byte limit)`,
  )
})

test("reads a body at the limit and tolerates an empty body", async () => {
  const body = new Uint8Array([104, 105])
  expect(await readBoundedBody(new Response(body), 2)).toEqual(body)
  expect(await readBoundedBody(new Response(null), 2)).toEqual(new Uint8Array())
})
