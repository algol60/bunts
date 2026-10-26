# ts-pymcp

A **Bun + TypeScript MCP server** that exposes the [pyrunner](../pyrunner/)
service as tools, so a model can run Python and get `stdout` / `stderr` / exit
status back. It is the TypeScript equivalent of [`../pymcp`](../pymcp/).

Built on the MCP TypeScript SDK v2: `@modelcontextprotocol/server`'s
`McpServer`, `createMcpHandler` for streamable HTTP, and `serveStdio` for the
stdio transport. HTTP calls to pyrunner use Bun's global `fetch`.

The default transport is **streamable HTTP** on `http://127.0.0.1:8765/mcp`.
Set `PYRUNNER_MCP_TRANSPORT=stdio` if your client launches the server as a
subprocess instead.

## Design in one paragraph

The MCP server is a thin, well-behaved client of pyrunner, not a reimplementation
of it. Everything about execution semantics — the in-process `exec`, the
execution lock, the wall-clock timeout, the 30-second budget — stays where it
belongs, in pyrunner. This layer's only jobs are: turning tool arguments into
`POST /execute` requests, translating the response into a typed result, and
making failures legible.

### Error semantics

This is the decision that matters most, and it is deliberate:

| Situation                                   | Result |
| ------------------------------------------- | ------ |
| Script ran, printed, exited `0`              | `ok=true`, `exit_code=0` |
| Script raised an exception                   | **Success** `isError=false`, `ok=false`, `exit_code=1`, traceback in `stderr` |
| Script hit the runner's timeout              | **Success** `isError=false`, `ok=false`, `timed_out=true`, `exit_code=124` |
| Bad arguments (empty/oversized batch)        | Tool error, with the reason |
| pyrunner unreachable / slow / malformed reply | Tool error, with the reason |

A script that crashes is **data**, not a tool failure. The model gets a normal
successful tool call it can read, iterate on and fix. Only a failure to invoke
pyrunner at all becomes an MCP tool error. The TypeScript SDK forwards a thrown
`Error`'s message to the client with `isError: true`, so the actual cause is not
masked.

`runner_status` never raises. It reports reachability as data, so a model can
diagnose "the runner is down" instead of guessing.

## Tools

### `run_python(code)`

Run one script.

| Field              | Type     | Notes |
| ------------------ | -------- | ----- |
| `ok`               | boolean  | `exit_code == 0` and not timed out |
| `stdout`           | string   | everything written to stdout |
| `stderr`           | string   | everything written to stderr, incl. tracebacks |
| `exit_code`        | number   | `0` / `1` on error / `124` on timeout |
| `timed_out`        | boolean  | runner stopped it at its deadline |
| `defined_names`    | string[] | top-level names the script defined |
| `duration_seconds` | number   | round-trip time measured here, including queueing |

### `run_python_batch(scripts)`

Run up to 25 scripts in order, one round trip, and get one result per script
plus `succeeded` / `failed` counts.

The limit exists because pyrunner serialises executions behind a lock: one
runaway script would otherwise pin every other caller for the full budget.

Each script is a **separate** execution with a fresh namespace — imports,
variables and state do **not** carry over between entries. The tool description
says so, because models reliably assume otherwise.

They run sequentially on purpose. Since pyrunner holds a lock, firing them off
concurrently would not finish any sooner, and sequential order keeps results
predictable.

### `runner_status()`

`GET /health`, reported as `{reachable, base_url, status, detail}`. Never
raises.

## Setup

Requires **Bun 1.4+**:

```bash
cd ts-pymcp
bun install
```

Start pyrunner first (see [`../pyrunner`](../pyrunner/README.md)):

```bash
cd ../pyrunner && source .venv/bin/activate && python app.py
# http://127.0.0.1:8000
```

## Configuration

All optional; each is validated at startup, so a typo fails loudly at boot
rather than confusingly mid-call. Environment variable names match the Python
package, so existing client configurations keep working.

| Variable                       | Default                 | Meaning |
| ------------------------------ | ----------------------- | ------- |
| `PYRUNNER_MCP_URL`             | `http://127.0.0.1:8000` | pyrunner base URL; a bare `host:port` gets `http://` |
| `PYRUNNER_MCP_REQUEST_TIMEOUT` | `60`                    | HTTP timeout per call, seconds |
| `PYRUNNER_MCP_TRANSPORT`       | `streamable-http`       | `streamable-http` or `stdio` |
| `PYRUNNER_MCP_HOST`            | `127.0.0.1`             | bind address (HTTP transport) |
| `PYRUNNER_MCP_PORT`            | `8765`                  | bind port (HTTP transport) |

### On timeouts

`PYRUNNER_MCP_REQUEST_TIMEOUT` **must** exceed pyrunner's own `PYRUNNER_TIMEOUT`
(30s by default). Set it smaller and the MCP client gives up while the script is
still running, throwing away output the runner was about to produce. The error
message for this case names the variable.

Remember pyrunner's timeout is best-effort and cooperative: it cannot interrupt
a blocking C call, so `time.sleep(60)` overshoots the deadline. Keep the HTTP
timeout with headroom for that.

## Running

```bash
# streamable HTTP on http://127.0.0.1:8765/mcp (default)
bun run src/main.ts

# or, after `bun link`
ts-pymcp

# opt into stdio, for clients that launch the server themselves
PYRUNNER_MCP_TRANSPORT=stdio bun run src/main.ts
```

Logs go to **stderr** only. stdout is reserved for JSON-RPC frames under the
stdio transport, and a single stray `console.log()` there corrupts the stream.

The HTTP transport serves MCP at `/mcp`; other paths return `404`. HTTP serving
is stateless per request, which is fine here because no tool holds session
state.

## Client configuration

Streamable HTTP (the default transport):

```json
{
  "mcp": {
    "servers": {
      "pyrunner": {
        "type": "remote",
        "url": "http://127.0.0.1:8765/mcp"
      }
    }
  }
}
```

OpenCode / MCP clients, stdio — this must opt in explicitly, because HTTP is the
default:

```json
{
  "mcp": {
    "servers": {
      "pyrunner": {
        "type": "local",
        "command": [
          "bun",
          "run",
          "/absolute/path/to/ts-pymcp/src/main.ts"
        ],
        "environment": {
          "PYRUNNER_MCP_URL": "http://127.0.0.1:8000",
          "PYRUNNER_MCP_TRANSPORT": "stdio"
        }
      }
    }
  }
}
```

From a linked package, use `["ts-pymcp"]` as the command.

The same HTTP config is included in [`opencode.json`](./opencode.json).

## Tests

```bash
bun test
bun run typecheck
```

Coverage is layered:

- **Unit** — config parsing, and the HTTP client against an in-process fake
  covering stdout/stderr capture, non-zero exits, timeouts, malformed replies,
  non-JSON bodies, HTTP 500s and an unreachable port.
- **Tool behaviour** — every tool through a live in-process client session over
  `InMemoryTransport`, asserting the error semantics in the table above actually
  hold on the wire.
- **HTTP transport** — a real `Bun.serve` handler on an ephemeral port, driven
  by `StreamableHTTPClientTransport`.
- **Integration** — this package launched as a real stdio subprocess (with
  `PYRUNNER_MCP_TRANSPORT=stdio`) speaking MCP to the real pyrunner, asserting
  tool discovery, script execution, timeout propagation and that stdout stays
  clean.

Integration tests skip automatically when no pyrunner is listening; set
`PYRUNNER_MCP_URL` to point elsewhere.

To run the integration tests explicitly:

```bash
cd ../pyrunner && source .venv/bin/activate && python app.py &
cd ../ts-pymcp && PYRUNNER_MCP_URL=http://127.0.0.1:8000 bun test tests/integration.test.ts
```

## Security

pyrunner executes arbitrary code with the full privileges of its process, and
this MCP server is a convenient front door to it. Neither the execution timeout
nor anything here is a security boundary. Do not expose this to an untrusted
model or an untrusted network. See the security warning in
[`../pyrunner/README.md`](../pyrunner/README.md).

## Layout

| File | Role |
| ---- | ---- |
| `src/server.ts` | `McpServer`, tools, result shaping |
| `src/main.ts` | transport selection and process entry point |
| `src/client.ts` | pyrunner HTTP client and its error taxonomy |
| `src/config.ts` | environment parsing and validation |
| `src/models.ts` | zod tool `outputSchema` models |
| `tests/fake-pyrunner.ts` | in-process pyrunner double |
| `tests/harness.ts` | real in-process MCP client session |

The split is deliberate: `client.ts` knows the pyrunner wire format and nothing
about MCP, so the tool layer stays declarative and tests can swap the transport
without touching tool code.

### Bun-specific notes

- Bun runs the TypeScript sources directly; there is no build step.
- `PyRunnerClient` owns no connection pool: Bun's global `fetch` manages
  connections, so there is no lifespan/close hook to mirror Python's
  `httpx.AsyncClient.aclose()`.
- `Bun.serve` takes the web-standard `fetch` handler returned by
  `createMcpHandler`, so no Node HTTP adapter is needed.
- The test fake does not execute Python. Executing scripts is pyrunner's job;
  the tests verify this layer's wire translation with canned results.
