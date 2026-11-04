#!/usr/bin/env python3
"""A simple MCP server that reports fake weather.

Run with:  WEATHER_MCP_TOKEN=<secret> python3 weather_server.py

It speaks MCP over Streamable HTTP on 127.0.0.1:8019 and requires an
``Authorization: Bearer <secret>`` header on every request. The token is read
from WEATHER_MCP_TOKEN; the server refuses to start if it is unset or empty.
"""

import json
import os
import random
import secrets

from mcp.server.mcpserver import MCPServer

mcp = MCPServer(
    name="weather",
    instructions="A toy weather service. Conditions are randomly chosen from a fixed set.",
)

# Fixed set of weather descriptions; a random one is picked per request.
DESCRIPTIONS = [
    "Sunny",
    "Clear",
    "Partly cloudy",
    "Overcast",
    "Light rain",
    "Heavy rain",
    "Thunderstorms",
    "Snow",
    "Foggy",
    "Windy",
]


@mcp.tool()
def get_weather(city: str = "San Francisco") -> str:
    """Get the current weather for a city.

    Args:
        city: Name of the city to report on.

    Returns:
        A JSON object with the city, a random description, temperature (C) and humidity (%).
    """
    description = random.choice(DESCRIPTIONS)
    temperature_c = random.randint(-10, 35)
    return json.dumps(
        {
            "city": city,
            "description": description,
            "temperature_c": temperature_c,
            "humidity_pct": random.randint(10, 100),
        }
    )


class BearerAuthMiddleware:
    """Reject every HTTP request that does not carry the shared bearer token.

    A pure ASGI middleware, so it sees requests before the MCP app does and
    needs no Starlette request/response wrapping.
    """

    def __init__(self, app, token: str) -> None:
        self.app = app
        self._token = token.encode()

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        scheme, _, credentials = headers.get(b"authorization", b"").partition(b" ")
        if scheme.lower() != b"bearer" or not secrets.compare_digest(credentials, self._token):
            await self._reject(send)
            return

        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send) -> None:
        body = b'{"error":"unauthorized"}'
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"www-authenticate", b'Bearer realm="weather"'),
                    (b"cache-control", b"no-store"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


def main() -> None:
    token = os.environ.get("WEATHER_MCP_TOKEN", "")
    if not token:
        raise SystemExit(
            "WEATHER_MCP_TOKEN must be set; refusing to start without authentication"
        )

    host = os.environ.get("WEATHER_MCP_HOST", "127.0.0.1")
    port = int(os.environ.get("WEATHER_MCP_PORT", "8019"))

    import uvicorn

    app = BearerAuthMiddleware(mcp.streamable_http_app(host=host), token)
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    main()
