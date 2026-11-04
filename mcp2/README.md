# Weather MCP server (bearer-token demo)

A small TypeScript MCP server that speaks Streamable HTTP on the loopback
interface and returns a randomly selected weather description. Every request
to `/mcp` must carry a valid bearer token.

## Requirements

- [Bun](https://bun.com) 1.4 or newer

## Setup

```bash
cd ~/mcp2
bun install
```

Create `.env` if it does not exist, then set a token of at least 32 characters:

```bash
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
# Paste the generated value after WEATHER_MCP_TOKEN= in .env
```

The server refuses to start when `WEATHER_MCP_TOKEN` is missing, shorter than 32
characters, or contains whitespace. It always binds to `127.0.0.1`.

## Run

```bash
bun run start
```

The endpoint is `http://127.0.0.1:8020/mcp` by default. Set `WEATHER_MCP_PORT` to
use another port. The endpoint is stateless and accepts `POST` requests only;
`GET /mcp` returns `405 Method Not Allowed`.

The only MCP tool is `get_weather`. It takes no arguments and returns one
randomly chosen, made-up weather description, for example:

```text
Light rain showers, around 15°C.
```

## Authentication

Send `Authorization: Bearer <token>` on every `/mcp` request. A missing or
incorrect token receives `401 Unauthorized` with a `WWW-Authenticate` header.
Tokens are compared in constant time and are never logged.

`GET /healthz` is unauthenticated and only returns `{ "ok": true }`.

## Try it with curl

Load the token without printing it:

```bash
export WEATHER_MCP_TOKEN="$(grep '^WEATHER_MCP_TOKEN=' .env | cut -d= -f2-)"
```

Initialize:

```bash
curl -sS http://127.0.0.1:8020/mcp \
  -H "Authorization: Bearer $WEATHER_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "1.0.0" }
    }
  }'
```

List tools:

```bash
curl -sS http://127.0.0.1:8020/mcp \
  -H "Authorization: Bearer $WEATHER_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

Call the weather tool:

```bash
curl -sS http://127.0.0.1:8020/mcp \
  -H "Authorization: Bearer $WEATHER_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_weather","arguments":{}}}'
```

The server is stateless, so no `Mcp-Session-Id` header is needed after
initialization.

Confirm that the same endpoint is protected without the token:

```bash
curl -i http://127.0.0.1:8020/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
# HTTP/1.1 401 Unauthorized
```

## Notes

- This static bearer token is a deliberately small authorization demo. A
  production MCP server should use the MCP authorization specification
  (OAuth 2.1, protected resource metadata, token audience checks, and TLS).
- Loopback binding keeps the listener off external interfaces. Keep `.env` at
  mode `600` so other local OS users cannot read the token.
- `bun run typecheck` type-checks the project.
