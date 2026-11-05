"""A ``requests`` transport adapter for Unix domain sockets.

The adapter plugs into a :class:`requests.Session` and sends HTTP requests
over a Unix domain socket instead of a TCP connection.  It supports two ways
of selecting the socket:

1. Pass the socket path to the adapter::

       session = requests.Session()
       session.mount("http://", UnixHTTPAdapter("/var/run/docker.sock"))
       session.get("http://localhost/version")

2. Encode the socket path in the URL host using the ``http+unix://`` scheme
   (the same convention used by the ``requests-unixsocket`` package)::

       session = requests.Session()
       session.mount("http+unix://", UnixHTTPAdapter())
       session.get("http+unix://%2Fvar%2Frun%2Fdocker.sock/version")

The URL path and query string are passed through to the server unchanged.
"""

from __future__ import annotations

import socket
import threading
from typing import Any
from urllib.parse import unquote, urlparse

from requests.adapters import HTTPAdapter
from requests.exceptions import InvalidURL
from urllib3.connection import HTTPConnection
from urllib3.connectionpool import HTTPConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError

__all__ = [
    "UnixHTTPConnection",
    "UnixHTTPConnectionPool",
    "UnixHTTPAdapter",
]

#: URL schemes that carry a percent-encoded Unix socket path in their host.
UNIX_SCHEMES = frozenset({"http+unix", "unix"})


class UnixHTTPConnection(HTTPConnection):
    """An HTTP connection that talks to a Unix domain socket."""

    def __init__(
        self,
        socket_path: str,
        host: str = "localhost",
        port: int | None = None,
        **kwargs: Any,
    ) -> None:
        self.socket_path = socket_path
        # ``host`` is only used for the ``Host`` header and for logging; the
        # actual connection is made to ``socket_path``.
        super().__init__(host=host, port=port, **kwargs)

    def _new_conn(self) -> socket.socket:
        """Create and connect an ``AF_UNIX`` socket."""
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)

        try:
            sock.connect(self.socket_path)
        except socket.timeout as exc:
            sock.close()
            raise ConnectTimeoutError(
                self,
                f"Connection to Unix socket {self.socket_path!r} timed out.",
            ) from exc
        except OSError as exc:
            sock.close()
            raise NewConnectionError(
                self,
                f"Failed to connect to Unix socket {self.socket_path!r}: {exc}",
            ) from exc

        return sock


class UnixHTTPConnectionPool(HTTPConnectionPool):
    """A urllib3 connection pool backed by a Unix domain socket."""

    ConnectionCls = UnixHTTPConnection

    def __init__(
        self,
        socket_path: str,
        host: str = "localhost",
        **kwargs: Any,
    ) -> None:
        self.socket_path = socket_path
        super().__init__(host=host, **kwargs)

    def _new_conn(self) -> UnixHTTPConnection:
        self.num_connections += 1
        return self.ConnectionCls(
            socket_path=self.socket_path,
            host=self.host,
            port=self.port,
            timeout=self.timeout.connect_timeout,
            **self.conn_kw,
        )


class UnixHTTPAdapter(HTTPAdapter):
    """A ``requests`` adapter that sends requests over a Unix domain socket.

    :param socket_path:
        Optional default socket path.  When omitted, the path is taken from
        the request URL, which must use the ``http+unix://`` scheme with the
        socket path percent-encoded in the host component.

    All remaining arguments are forwarded to :class:`requests.adapters.HTTPAdapter`.
    """

    def __init__(self, socket_path: str | None = None, *args: Any, **kwargs: Any) -> None:
        self.socket_path = socket_path
        self._unix_pools: dict[str, UnixHTTPConnectionPool] = {}
        self._unix_pools_lock = threading.Lock()
        super().__init__(*args, **kwargs)

    # ------------------------------------------------------------------
    # requests integration
    # ------------------------------------------------------------------
    def get_connection_with_tls_context(
        self,
        request: Any,
        verify: Any,
        proxies: dict[str, str] | None = None,
        cert: Any = None,
    ) -> UnixHTTPConnectionPool:
        """Return a Unix-socket pool for *request*.

        This is the hook used by requests >= 2.32.2.
        """
        return self._pool_for(self._socket_path_for(request.url))

    def get_connection(
        self,
        url: str,
        proxies: dict[str, str] | None = None,
    ) -> UnixHTTPConnectionPool:
        """Return a Unix-socket pool for *url*.

        Kept for compatibility with requests < 2.32.2.
        """
        return self._pool_for(self._socket_path_for(url))

    def request_url(self, request: Any, proxies: dict[str, str] | None) -> str:
        """Return only the path and query string for the request.

        Unix-socket requests never go through an HTTP proxy, so the absolute
        URL must not be sent in the request line.
        """
        url = request.path_url
        if not url.startswith("/"):
            url = "/" + url
        return url

    def send(
        self,
        request: Any,
        stream: bool = False,
        timeout: Any = None,
        verify: Any = True,
        cert: Any = None,
        proxies: dict[str, str] | None = None,
    ) -> Any:
        """Send *request*, preserving the URL host in the ``Host`` header.

        urllib3 normally derives ``Host`` from the connection pool's host.
        Unix-socket pools are keyed by socket path and default to
        ``localhost``, so use the host from the request URL instead.  An
        explicitly supplied ``Host`` header is left untouched.
        """
        if "Host" not in request.headers:
            host = self._host_for(request.url)
            if host:
                request.headers["Host"] = host

        return super().send(
            request,
            stream=stream,
            timeout=timeout,
            verify=verify,
            cert=cert,
            proxies=proxies,
        )

    def close(self) -> None:
        """Close all Unix-socket pools owned by this adapter."""
        with self._unix_pools_lock:
            pools = list(self._unix_pools.values())
            self._unix_pools.clear()

        for pool in pools:
            pool.close()

        super().close()

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _host_for(self, url: str) -> str | None:
        """Return the host (and optional port) to use in the ``Host`` header."""
        parsed = urlparse(url)

        if parsed.scheme.lower() in UNIX_SCHEMES:
            # The URL host is the percent-encoded socket path, not a hostname.
            return None

        # Keep an explicit port and IPv6 brackets, but drop any userinfo.
        host = parsed.netloc.rsplit("@", 1)[-1]
        return host or None

    def _socket_path_for(self, url: str) -> str:
        if self.socket_path is not None:
            return self.socket_path

        parsed = urlparse(url)
        scheme = parsed.scheme.lower()

        if scheme not in UNIX_SCHEMES:
            raise InvalidURL(
                "UnixHTTPAdapter needs a socket path.  Pass socket_path to the "
                "adapter or use an http+unix:// URL such as "
                "'http+unix://%2Fvar%2Frun%2Fdocker.sock/version'."
            )

        # ``urlparse`` lowercases ``.hostname`` but not ``.netloc``.  Unix
        # socket paths are case-sensitive, so use ``netloc`` and decode it.
        encoded_path = parsed.netloc
        if not encoded_path:
            raise InvalidURL(
                f"Invalid Unix socket URL {url!r}: the host must be the "
                "percent-encoded socket path."
            )

        socket_path = unquote(encoded_path)
        if not socket_path:
            raise InvalidURL(
                f"Invalid Unix socket URL {url!r}: empty socket path."
            )

        return socket_path

    def _pool_for(self, socket_path: str) -> UnixHTTPConnectionPool:
        with self._unix_pools_lock:
            pool = self._unix_pools.get(socket_path)
            if pool is None:
                pool = UnixHTTPConnectionPool(
                    socket_path,
                    maxsize=self._pool_maxsize,
                    block=self._pool_block,
                )
                self._unix_pools[socket_path] = pool
            return pool
