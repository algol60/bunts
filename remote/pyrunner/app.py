"""A small Litestar server that runs Python scripts in its own process.

POST a Python script to ``/execute`` and get back a JSON object containing the
``stdout`` and ``stderr`` produced by running it.

The script is executed with ``exec`` inside the server's single Python process,
so there is no subprocess involved. ``sys.stdout``/``sys.stderr`` are redirected
to in-memory buffers for the duration of the run. Because those streams are
process-global, runs are serialized with a lock so concurrent requests cannot
cross-contaminate each other.
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
import threading
import time
import traceback
from dataclasses import dataclass, field

from litestar import Litestar, get, post
from litestar.di import NamedDependency, Provide

# Only one script may redirect the global stdout/stderr at a time.
_execution_lock = threading.Lock()

#: Exit code reported when a script is stopped by the execution timeout.
#: 124 mirrors the convention used by GNU ``timeout``.
TIMEOUT_EXIT_CODE = 124

DEFAULT_TIMEOUT_SECONDS = 30.0

#: Environment variable used to override the default timeout at startup.
TIMEOUT_ENV_VAR = "PYRUNNER_TIMEOUT"


class ScriptTimeout(Exception):
    """Raised inside a script when it runs past its allotted time."""


@dataclass
class ScriptRequest:
    """Request body: the Python source to execute."""

    code: str


@dataclass
class ScriptResult:
    """Result of executing a script."""

    stdout: str
    stderr: str
    exit_code: int
    #: True when the script was stopped because it exceeded the timeout.
    timed_out: bool
    #: Names of the globals the script defined (handy for debugging).
    defined_names: list[str] = field(default_factory=list)


@dataclass
class RunnerConfig:
    """Runtime configuration for the code runner."""

    #: Seconds a single script may run before it is interrupted.
    #: ``None`` or a non-positive value disables the timeout.
    timeout: float | None = DEFAULT_TIMEOUT_SECONDS

    @classmethod
    def from_env(cls) -> RunnerConfig:
        raw = os.environ.get(TIMEOUT_ENV_VAR)
        if raw is None or raw.strip() == "":
            return cls()
        try:
            return cls(timeout=float(raw))
        except ValueError:
            return cls()


def _make_deadline_tracer(deadline: float):
    """Build a ``sys.settrace`` hook that raises once ``deadline`` passes."""

    def tracer(frame, event, arg):  # noqa: ANN001 - matches the stdlib trace signature
        if time.monotonic() > deadline:
            raise ScriptTimeout
        return tracer

    return tracer


def run_script(code: str, timeout: float | None = DEFAULT_TIMEOUT_SECONDS) -> ScriptResult:
    """Execute ``code`` in-process and capture its output.

    The code runs as if it were the ``__main__`` module of a fresh interpreter:
    an uncaught exception is formatted to stderr and produces ``exit_code`` 1,
    and ``sys.exit(...)`` behaves like a normal process exit.

    If ``timeout`` is a positive number, the script is interrupted once that
    many seconds have elapsed and reported with ``timed_out=True``.
    """
    stdout = io.StringIO()
    stderr = io.StringIO()
    exit_code = 0
    timed_out = False

    # Compile first so syntax errors are reported without touching stdout.
    try:
        compiled = compile(code, "<script>", "exec")
    except SyntaxError:
        traceback.print_exc(file=stderr)
        return ScriptResult(
            stdout="", stderr=stderr.getvalue(), exit_code=1, timed_out=False
        )

    namespace: dict[str, object] = {"__name__": "__main__"}
    use_timeout = timeout is not None and timeout > 0

    with _execution_lock:
        saved_stdout, saved_stderr = sys.stdout, sys.stderr
        sys.stdout, sys.stderr = stdout, stderr
        try:
            if use_timeout:
                # Traces only this worker thread, so the event loop is unaffected.
                sys.settrace(_make_deadline_tracer(time.monotonic() + timeout))
            exec(compiled, namespace)  # noqa: S102 - intentional, this is a code runner
        except ScriptTimeout:
            timed_out = True
            exit_code = TIMEOUT_EXIT_CODE
            print(f"Execution timed out after {timeout} seconds.", file=sys.stderr)
        except SystemExit as exc:
            if exc.code is None:
                exit_code = 0
            elif isinstance(exc.code, int):
                exit_code = exc.code
            else:
                print(exc.code, file=sys.stderr)
                exit_code = 1
        except BaseException:  # noqa: BLE001 - mirror the interpreter's behaviour
            exit_code = 1
            traceback.print_exc(file=sys.stderr)
        finally:
            sys.settrace(None)
            sys.stdout, sys.stderr = saved_stdout, saved_stderr

    return ScriptResult(
        stdout=stdout.getvalue(),
        stderr=stderr.getvalue(),
        exit_code=exit_code,
        timed_out=timed_out,
        defined_names=sorted(k for k in namespace if not k.startswith("__")),
    )


@get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@post("/execute", status_code=200)
async def execute(data: ScriptRequest, config: NamedDependency[RunnerConfig]) -> ScriptResult:
    # Run the (blocking) script in a worker thread so the event loop keeps
    # serving requests. It is still the same Python process.
    return await asyncio.to_thread(run_script, data.code, config.timeout)


def create_app(timeout: float | None = None) -> Litestar:
    """Build the application.

    ``timeout`` overrides the ``PYRUNNER_TIMEOUT`` environment variable when
    given. Pass ``None`` or ``0`` to disable the timeout entirely.
    """
    config = RunnerConfig.from_env()
    if timeout is not None:
        config.timeout = timeout
    return Litestar(
        route_handlers=[health, execute],
        # sync_to_thread=False: this provider just returns a cached object.
        dependencies={"config": Provide(lambda: config, sync_to_thread=False)},
    )


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.environ.get("PYRUNNER_HOST", "127.0.0.1"), port=8000)