"""Smoke tests for the in-process Python runner."""

import pytest
from litestar.testing import TestClient

from app import TIMEOUT_EXIT_CODE, create_app


def run(code: str, timeout: float | None = 5.0) -> tuple[int, dict]:
    with TestClient(app=create_app(timeout=timeout)) as client:
        response = client.post("/execute", json={"code": code})
        return response.status_code, response.json()


def test_stdout_and_stderr_are_captured() -> None:
    status, body = run("import sys\nprint('hello out')\nprint('hello err', file=sys.stderr)")
    assert status == 200
    assert body["stdout"] == "hello out\n"
    assert body["stderr"] == "hello err\n"
    assert body["exit_code"] == 0
    assert body["timed_out"] is False


def test_uncaught_exception_goes_to_stderr() -> None:
    _, body = run("raise ValueError('boom')")
    assert body["stdout"] == ""
    assert "ValueError: boom" in body["stderr"]
    assert body["exit_code"] == 1
    assert body["timed_out"] is False


def test_syntax_error() -> None:
    _, body = run("def broken(:")
    assert "SyntaxError" in body["stderr"]
    assert body["exit_code"] == 1


def test_sys_exit_code() -> None:
    _, body = run("import sys\nprint('bye')\nsys.exit(3)")
    assert body["stdout"] == "bye\n"
    assert body["exit_code"] == 3


def test_sys_exit_message() -> None:
    _, body = run("import sys\nsys.exit('stopped')")
    assert body["stderr"] == "stopped\n"
    assert body["exit_code"] == 1


def test_state_shared_within_one_script() -> None:
    _, body = run("x = 41\nprint(x + 1)")
    assert body["stdout"] == "42\n"


def test_defined_names_reports_globals() -> None:
    _, body = run("alpha = 1\nbeta = 2")
    assert body["defined_names"] == ["alpha", "beta"]
    assert "globals" not in body


def test_timeout_stops_a_runaway_script() -> None:
    _, body = run("while True:\n    pass", timeout=0.25)
    assert body["timed_out"] is True
    assert body["exit_code"] == TIMEOUT_EXIT_CODE
    assert "timed out" in body["stderr"]


def test_timeout_keeps_output_produced_before_stopping() -> None:
    _, body = run("print('partial')\nwhile True:\n    pass", timeout=0.25)
    assert body["stdout"] == "partial\n"
    assert body["timed_out"] is True


def test_timeout_does_not_leak_into_later_runs() -> None:
    app = create_app(timeout=0.25)
    with TestClient(app=app) as client:
        client.post("/execute", json={"code": "while True:\n    pass"})
        response = client.post("/execute", json={"code": "print('still works')"})
    body = response.json()
    assert body["stdout"] == "still works\n"
    assert body["timed_out"] is False


def test_timeout_disabled_with_zero() -> None:
    _, body = run("print('no limit')", timeout=0)
    assert body["stdout"] == "no limit\n"
    assert body["timed_out"] is False


def test_timeout_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import RunnerConfig, create_app as _create_app  # noqa: F401

    monkeypatch.setenv("PYRUNNER_TIMEOUT", "1.5")
    assert RunnerConfig.from_env().timeout == 1.5

    monkeypatch.setenv("PYRUNNER_TIMEOUT", "not-a-number")
    assert RunnerConfig.from_env().timeout == 30.0

    app = _create_app()
    with TestClient(app=app) as client:
        response = client.post("/execute", json={"code": "print('ok')"})
    assert response.json()["stdout"] == "ok\n"