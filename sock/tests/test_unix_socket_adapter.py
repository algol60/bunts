from __future__ import annotations

import json
import os
import socketserver
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler
from typing import Iterator
from urllib.parse import quote

import pytest
import requests

from unix_socket_adapter import UnixHTTPAdapter


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _respond(self, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        self._respond(
            {
                "method": self.command,
                "path": self.path,
                "host": self.headers.get("Host"),
                "body": None,
            }
        )

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        self._respond(
            {
                "method": self.command,
                "path": self.path,
                "host": self.headers.get("Host"),
                "body": body,
            }
        )

    def log_message(self, *args) -> None:
        pass

    def address_string(self) -> str:
        return "unix"


class _UnixHTTPServer(socketserver.UnixStreamServer):
    def get_request(self):
        request, _ = super().get_request()
        return request, ("unix", 0)


@contextmanager
def unix_http_server(socket_path: str) -> Iterator[None]:
    server = _UnixHTTPServer(socket_path, _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def unix_url(socket_path: str, path: str = "/") -> str:
    return f"http+unix://{quote(socket_path, safe='')}{path}"


def test_get_over_unix_socket(tmp_path):
    socket_path = str(tmp_path / "http.sock")

    with unix_http_server(socket_path):
        session = requests.Session()
        session.mount("http+unix://", UnixHTTPAdapter())
        try:
            response = session.get(unix_url(socket_path, "/hello?name=world"))
        finally:
            session.close()

    assert response.status_code == 200
    assert response.json() == {
        "method": "GET",
        "path": "/hello?name=world",
        "host": "localhost",
        "body": None,
    }
    # The original URL is preserved on the response.
    assert response.url == unix_url(socket_path, "/hello?name=world")


def test_post_body_over_unix_socket(tmp_path):
    socket_path = str(tmp_path / "http.sock")

    with unix_http_server(socket_path):
        session = requests.Session()
        session.mount("http+unix://", UnixHTTPAdapter())
        try:
            response = session.post(
                unix_url(socket_path, "/echo"),
                data="hello socket",
                headers={"Content-Type": "text/plain"},
            )
        finally:
            session.close()

    assert response.status_code == 200
    assert response.json()["method"] == "POST"
    assert response.json()["path"] == "/echo"
    assert response.json()["body"] == "hello socket"


def test_adapter_with_default_socket_path(tmp_path):
    socket_path = str(tmp_path / "http.sock")

    with unix_http_server(socket_path):
        session = requests.Session()
        session.mount("http://", UnixHTTPAdapter(socket_path))
        try:
            response = session.get("http://localhost/status")
        finally:
            session.close()

    assert response.status_code == 200
    assert response.json()["path"] == "/status"


def test_adapter_sends_url_host_in_host_header(tmp_path):
    socket_path = str(tmp_path / "http.sock")

    with unix_http_server(socket_path):
        session = requests.Session()
        session.mount("http://", UnixHTTPAdapter(socket_path))
        try:
            response = session.get("http://example.com:8080/status")
        finally:
            session.close()

    assert response.status_code == 200
    assert response.json()["host"] == "example.com:8080"


def test_adapter_keeps_explicit_host_header(tmp_path):
    socket_path = str(tmp_path / "http.sock")

    with unix_http_server(socket_path):
        session = requests.Session()
        session.mount("http://", UnixHTTPAdapter(socket_path))
        try:
            response = session.get(
                "http://example.com/status",
                headers={"Host": "override.example"},
            )
        finally:
            session.close()

    assert response.status_code == 200
    assert response.json()["host"] == "override.example"


def test_socket_path_is_case_sensitive(tmp_path):
    directory = tmp_path / "CaseSensitiveDir"
    directory.mkdir()
    socket_path = str(directory / "MySocket.sock")

    with unix_http_server(socket_path):
        session = requests.Session()
        session.mount("http+unix://", UnixHTTPAdapter())
        try:
            response = session.get(unix_url(socket_path, "/case"))
        finally:
            session.close()

    assert response.status_code == 200


def test_missing_socket_raises_connection_error(tmp_path):
    socket_path = str(tmp_path / "does-not-exist.sock")

    session = requests.Session()
    session.mount("http+unix://", UnixHTTPAdapter())
    try:
        with pytest.raises(requests.exceptions.ConnectionError):
            session.get(unix_url(socket_path, "/"), timeout=1)
    finally:
        session.close()


def test_adapter_requires_socket_path_for_regular_url():
    session = requests.Session()
    session.mount("http://", UnixHTTPAdapter())
    try:
        with pytest.raises(requests.exceptions.InvalidURL):
            session.get("http://localhost/")
    finally:
        session.close()


def test_adapter_reuses_pool_per_socket_path(tmp_path):
    adapter = UnixHTTPAdapter()
    first = adapter._pool_for("/tmp/one.sock")
    second = adapter._pool_for("/tmp/one.sock")
    third = adapter._pool_for("/tmp/two.sock")

    assert first is second
    assert first is not third

    adapter.close()
