# requests Unix socket adapter

A transport adapter for [requests](https://requests.readthedocs.io/) that sends
HTTP requests over a Unix domain socket.

## Usage

Copy `unix_socket_adapter.py` into your project, or import it from this
directory.

### Encode the socket path in the URL

Mount the adapter for the `http+unix://` scheme. The socket path is
percent-encoded in the URL host:

```python
import requests
from urllib.parse import quote

from unix_socket_adapter import UnixHTTPAdapter

session = requests.Session()
session.mount("http+unix://", UnixHTTPAdapter())

socket_path = "/var/run/docker.sock"
url = f"http+unix://{quote(socket_path, safe='')}/version"

response = session.get(url)
print(response.json())
```

### Pass a default socket path

If every request on the session should use the same socket, pass the path to
the adapter and use ordinary `http://` URLs:

```python
session = requests.Session()
session.mount("http://", UnixHTTPAdapter("/var/run/docker.sock"))

response = session.get("http://localhost/version")
```

## How it works

`UnixHTTPAdapter` subclasses `requests.adapters.HTTPAdapter` and returns a
`UnixHTTPConnectionPool` whose connection class opens an `AF_UNIX` socket
instead of a TCP socket. Each socket path gets its own connection pool, and
the URL path/query string is sent to the server unchanged.

## Notes

- HTTP only. TLS over a Unix socket is not implemented.
- Proxies are not used for Unix-socket requests.
- For ordinary `http://`/`https://` URLs, the URL host (including an explicit
  port) is sent in the `Host` header. A user-supplied `Host` header takes
  precedence. `http+unix://` URLs keep the default `localhost` host.
- `response.url` keeps the original `http+unix://` URL.
- The adapter works with requests >= 2.25 and urllib3 1.26/2.x. On requests
  >= 2.32.2 it uses `get_connection_with_tls_context`; on older versions it
  uses the legacy `get_connection` hook.

## Tests

```bash
python -m pytest
```
