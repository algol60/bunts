# opencode-webfetch-mcp

A standalone [Model Context Protocol](https://modelcontextprotocol.io/) server that replaces OpenCode's built-in `webfetch` tool. It is written in TypeScript, runs on [Bun](https://bun.sh/), and serves MCP over **Streamable HTTP by default**, with stdio available as an option.

It mirrors OpenCode's behavior (tracking OpenCode 2.1.4, core commit `ed74ec8`):

- `url`, `format` (`text`, `markdown`, `html`), and `timeout` (seconds) inputs.
- Markdown by default, with HTML converted to Markdown or visible text.
- Browser-compatible request headers, redirect following, and a Cloudflare-challenge retry with an honest user agent.
- A 5 MiB response cap, MIME validation, and rejection of images and binary files.
- Inline output bounded to 2,000 lines / 50 KiB. Larger results are written to a local file and a preview plus the file path are returned.
- Read-only, with no JavaScript execution.

## Requirements

- Bun 1.2 or newer (developed against Bun 1.4).

## Run

```sh
bun install
bun run start        # HTTP server on http://127.0.0.1:3000/mcp
bun run start:stdio  # stdio server, for clients that launch their servers
```

The process stays in the foreground and logs its endpoint to stderr. Stop it with Ctrl+C or `SIGTERM`.

Options:

| Flag | Default | Description |
| --- | --- | --- |
| `--http` | selected | Use Streamable HTTP. This is the default. |
| `--stdio` | | Use stdio instead of HTTP. Cannot be combined with `--http`. |
| `--host <host>` | `127.0.0.1` | Interface to bind. |
| `--port <port>` | `3000` | Port to bind. `0` asks the OS for a free port. |
| `--path <path>` | `/mcp` | Exact MCP endpoint path. |
| `--help`, `-h` | | Show help. |
| `--version`, `-v` | | Show the version. |

`--host`, `--port`, and `--path` override the corresponding environment variables. `--port 0` is useful for tests; the chosen port is printed at startup.

You can also build a single-file executable:

```sh
bun run build        # dist/opencode-webfetch-mcp
./dist/opencode-webfetch-mcp              # HTTP (default)
./dist/opencode-webfetch-mcp --stdio      # stdio
```

The binary uses the same defaults and flags as the source entry point.

## Use with OpenCode

Start the server first, then point OpenCode at it. OpenCode does **not** launch remote MCP servers, so the HTTP server must already be running (for example under systemd, launchd, or a terminal session). If OpenCode is already running, reload its configuration (`opencode reload`) after adding the server.

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "web": {
        "type": "remote",
        "url": "http://127.0.0.1:3000/mcp",
        "oauth": false,
        "codemode": false
      }
    }
  },
  "permissions": [
    { "action": "webfetch", "resource": "*", "effect": "deny" },
    { "action": "web_webfetch", "resource": "*", "effect": "allow" }
  ]
}
```

OpenCode prefixes MCP tool names with the server name, so this tool appears as `web_webfetch`. The first permission rule disables the built-in `webfetch`; the second allows the replacement without prompting. Rename the server if you prefer a different prefix.

`oauth` is disabled because this server does not implement authorization. Keep `codemode` disabled to expose the tool directly, matching the built-in behavior.

Check connectivity with:

```sh
opencode mcp list
```

Remote servers connect in the background, so the CLI may report `pending` because it exits before the handshake finishes. A `failed` status usually means the HTTP server is not running or the URL is wrong.

A complete example is in [`examples/opencode.jsonc`](examples/opencode.jsonc).

### stdio alternative

If you prefer OpenCode to launch the process itself, use a local server and pass `--stdio`:

```jsonc
{
  "mcp": {
    "servers": {
      "web": {
        "type": "local",
        "command": ["/home/frogger/webfetch/dist/opencode-webfetch-mcp", "--stdio"],
        "codemode": false
      }
    }
  }
}
```

To run from source instead of the compiled binary:

```jsonc
"command": ["bun", "run", "/home/frogger/webfetch/src/index.ts", "--stdio"]
```

A complete stdio example is in [`examples/opencode-stdio.jsonc`](examples/opencode-stdio.jsonc).

## Generic MCP clients

Connect any Streamable HTTP client to the endpoint:

```text
http://127.0.0.1:3000/mcp
```

The server is stateless and returns JSON responses. It does not issue an `Mcp-Session-Id`, does not offer an SSE stream, and accepts only `POST`. `GET`, `DELETE`, and other methods return `405 Method Not Allowed` with `Allow: POST`.

For stdio clients, launch the binary with `--stdio`:

```json
{
  "mcpServers": {
    "web": {
      "command": "/home/frogger/webfetch/dist/opencode-webfetch-mcp",
      "args": ["--stdio"]
    }
  }
}
```

## Tool reference

### Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `url` | string | yes | HTTP or HTTPS URL to fetch. Other schemes are rejected. |
| `format` | `text` \| `markdown` \| `html` | no | Output format. Defaults to `markdown`. |
| `timeout` | number | no | Timeout in seconds, greater than 0 and at most 120. Defaults to 30. |

### Result

The text content is the converted page. When the output is too large, a second text block contains:

```text
[showing lines 1-2000 of 5000; full output saved to /home/you/.local/share/opencode-webfetch/tool-output/tool_0123456789ab.md]
```

Structured content contains:

| Field | Description |
| --- | --- |
| `url` | Requested URL. |
| `contentType` | Response `Content-Type` header, or an empty string. |
| `format` | Format actually used. |
| `output` | The inline text (the preview when truncated). |
| `truncated` | Whether the full output was saved to disk. |
| `outputPath` | Path to the full output, when `truncated` is true. |
| `bytes` | UTF-8 byte length of the complete converted output. |
| `lines` | Line count of the complete converted output. |

Errors are returned as MCP tool errors (`isError: true`) with a readable message, for example `Unable to fetch https://example.com: HTTP 404 Not Found for GET https://example.com`.

## Behavior details

- **Headers:** sends `User-Agent`, `Accept` (per format), and `Accept-Language: en-US,en;q=0.9`, matching OpenCode.
- **Cloudflare:** a `403` with `cf-mitigated: challenge` is retried once with `opencode-webfetch-mcp/<version>` instead of the browser-compatible user agent, inside the same timeout budget.
- **Redirects:** followed automatically (up to the runtime's limit). The final response's content type is used.
- **Content types:** textual types (`text/*`, `application/json`, `*+json`, `application/xml`, `*+xml`, JavaScript) are accepted. Images and other binaries are rejected rather than silently decoded. `image/svg+xml` is rejected as a non-textual file, matching OpenCode.
- **HTML conversion:** Markdown conversion and text extraction use a bounded, non-executing HTML parser ported from OpenCode. Scripts, styles, iframes, objects, embeds, hidden elements, and closed `<details>` content are omitted.
- **Size limits:** response bodies are capped at 5 MiB (streamed), and converted Markdown is capped at 5 MiB. Inputs are decoded as UTF-8 regardless of a declared charset, matching OpenCode.
- **Local addresses:** `localhost` and private IPs are allowed because the built-in tool allows them. See [Security](#security).
- **No cookies or credentials:** the server does not send cookies, authorization headers, or client certificates, and only performs `GET`.
- **No JavaScript:** dynamic pages that require a browser will not render. PDFs and images are not supported.

## HTTP transport details

- **Stateless:** every `POST` gets a fresh MCP server and transport, so clients cannot collide and a disconnected client leaves no session behind. No `Mcp-Session-Id` is issued.
- **JSON responses:** `enableJsonResponse` is on, so responses are single JSON bodies rather than SSE streams. This keeps the server usable by simple HTTP clients.
- **POST only:** `GET` and `DELETE` return `405` because sessions and standalone SSE streams are not supported.
- **Request limit:** request bodies larger than 1 MB are rejected before they reach the handler.
- **Idle timeout:** HTTP connections are kept open for up to 255 seconds so tool calls can use the full 120-second fetch timeout.
- **Host and Origin checks:** requests are rejected with `403` unless the `Host` (and, when present, `Origin`) hostname is loopback or in `WEBFETCH_ALLOWED_HOSTS`. This mitigates DNS-rebinding attacks from browsers; it is not authentication.
- **Cache headers:** responses set `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.

## Configuration

| Environment variable | Default | Description |
| --- | --- | --- |
| `WEBFETCH_HOST` | `127.0.0.1` | HTTP interface to bind. Use `0.0.0.0` or `::` to listen on all interfaces. |
| `WEBFETCH_PORT` | `3000` | HTTP port, `0`–`65535`. `0` selects a free port. |
| `WEBFETCH_PATH` | `/mcp` | MCP endpoint path. Must start with `/`; a trailing slash is removed. |
| `WEBFETCH_ALLOWED_HOSTS` | empty | Comma-separated extra hostnames accepted in `Host` and `Origin`. Loopback names are always accepted. |
| `WEBFETCH_DATA_DIR` | Platform data directory: `$XDG_DATA_HOME/opencode-webfetch`, `~/.local/share/opencode-webfetch` (Linux), `~/Library/Application Support/opencode-webfetch` (macOS), or `%LOCALAPPDATA%\opencode-webfetch` (Windows) | Directory for retained full outputs. |
| `WEBFETCH_MAX_LINES` | `2000` | Inline line budget before saving to a file. |
| `WEBFETCH_MAX_BYTES` | `51200` | Inline UTF-8 byte budget before saving to a file. |
| `WEBFETCH_USER_AGENT` | Browser-compatible string ending in `opencode-webfetch-mcp/1.1.0` | User agent for the first request. |
| `WEBFETCH_HONEST_USER_AGENT` | `opencode-webfetch-mcp/1.1.0` | User agent used after a Cloudflare challenge. |

Retained outputs live in `<data dir>/tool-output/`, are written with owner-only permissions, and are removed after 7 days. Cleanup runs at startup and hourly. Do not rely on retained files surviving beyond the retention window.

### Listening beyond loopback

The default bind is loopback only. To serve another machine on your LAN, bind to all interfaces and allow the hostname clients will use:

```sh
WEBFETCH_ALLOWED_HOSTS=webfetch.lan bun run start --host 0.0.0.0
```

`Host` must match an allowed name exactly (the port is ignored), so add every DNS name or IP address that clients use. Loopback names remain allowed.

There is no authentication. Prefer an SSH tunnel or a reverse proxy that terminates TLS and enforces authentication instead of exposing the port directly, and never publish it to the internet.

## Security

This is an unauthenticated, read-only fetcher that runs with your user's network access.

- **Network exposure:** by default only `127.0.0.1` can connect. Binding to `0.0.0.0` lets anyone who can reach the port use it as a fetcher and as a probe into your network. The Host/Origin allowlist blocks naive browser and DNS-rebinding attacks, but non-browser clients can set those headers freely. Treat a non-loopback bind as a trusted-network deployment.
- **SSRF:** for parity with OpenCode, it will fetch `http://localhost`, private IPs, and cloud metadata endpoints. Do not expose this MCP server to untrusted clients. If you need a stricter policy, add an allow/deny layer in front of it (for example, an MCP proxy or network sandbox), or modify `src/webfetch.ts` to reject non-public addresses.
- **Untrusted content:** fetched pages are attacker-controlled text. Treat them like any other web input and be alert to prompt injection.
- **Permissions:** in OpenCode, the MCP tool is governed by the `web_webfetch` permission action. Use `ask` instead of `allow` if you want approval for every fetch.
- **Secrets:** the server never reads credentials or sends them to remote hosts. URLs passed by the model may themselves contain tokens, so review them as you would any outbound request.

## Development

```sh
bun test          # unit, HTTP transport, and end-to-end MCP tests
bun run typecheck # tsc --noEmit
bun run build     # standalone binary
```

Layout:

```text
src/
  index.ts        CLI, default HTTP transport, shutdown
  http.ts         stateless Streamable HTTP server and request checks
  stdio.ts        stdio transport
  server.ts       MCP registration and result shaping
  maintenance.ts  startup/hourly retained-output cleanup
  webfetch.ts     fetch, MIME handling, timeout, Cloudflare retry
  config.ts       environment and HTTP configuration
  lib/host.ts     Host/Origin hostname normalization
  lib/html.ts     bounded HTML to Markdown/text conversion
  lib/http.ts     bounded response-body reader
  lib/mime.ts     textual/binary classification
  lib/output.ts   inline truncation, retention, cleanup
test/
  html.test.ts
  body.test.ts
  config.test.ts
  http.test.ts
  webfetch.test.ts
  mcp.test.ts
```

The HTML converter, MIME classifier, and several tests are ported from OpenCode. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## License

MIT.
