# pyrunner

A [Litestar](https://litestar.dev/) server that accepts Python scripts and runs
them **in its own single process**. The `stdout` and `stderr` produced by a
script are returned in a JSON object.

## How it works

- `POST /execute` takes a JSON body `{"code": "<python source>"}` and returns
  **200 OK**.
- The source is compiled and run with `exec` inside the server process — no
  subprocess, no second interpreter.
- For the duration of the run, `sys.stdout` and `sys.stderr` are swapped for
  in-memory buffers, and their contents are returned in the response.
- Because those streams are process-global, executions are serialized with a
  `threading.Lock` so concurrent requests can't mix their output. The blocking
  run happens in a worker thread via `asyncio.to_thread`, so the event loop
  stays responsive.
- An uncaught exception is formatted to `stderr` and reported as `exit_code: 1`,
  mirroring how a normal Python process behaves. `sys.exit(n)` sets the exit
  code accordingly.

## Endpoints

| Method | Path       | Description                          |
| ------ | ---------- | ------------------------------------ |
| GET    | `/health`  | Liveness check.                      |
| POST   | `/execute` | Run a Python script and capture I/O. |

### Response shape

```json
{
  "stdout": "hello\n",
  "stderr": "",
  "exit_code": 0,
  "timed_out": false,
  "defined_names": ["total"]
}
```

| Field           | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `stdout`        | Everything the script wrote to stdout.                     |
| `stderr`        | Everything it wrote to stderr, plus any traceback/timeout.  |
| `exit_code`     | `0` normally, `1` on uncaught error, `124` on timeout.      |
| `timed_out`     | `true` if the script was stopped by the execution timeout.  |
| `defined_names` | Top-level names the script defined (useful for debugging).  |

## Execution timeout

Scripts are limited to a configurable wall-clock budget so one runaway script
can't block the runner forever. Default: **30 seconds**.

Configure it in one of three ways (highest precedence first):

```bash
# 1. Explicitly, when building the app
create_app(timeout=2.5)

# 2. Environment variable
PYRUNNER_TIMEOUT=5 python app.py

# 3. Default when neither is set
#    DEFAULT_TIMEOUT_SECONDS = 30.0
```

Pass `timeout=0` or `timeout=None` to disable it. An unparseable
`PYRUNNER_TIMEOUT` value falls back to the default rather than crashing.

Implementation: a `sys.settrace` hook installed on the worker thread checks the
deadline on every Python line event and raises when it passes. Tracing is scoped
to that thread, so the event loop is unaffected, and `sys.settrace(None)` is
always restored in a `finally` block.

### Timeout limitations (best effort)

Python offers no way to preempt a running thread, so this is cooperative:

- **Pure-Python code** is cut off on time — a `while True:` loop is stopped at
  the deadline (measured: 2.03s with a 2s limit).
- **Blocking C calls** are *not* interrupted mid-call. `time.sleep(60)`,
  `subprocess.wait()`, socket reads, or a long native computation run to
  completion; the script is only flagged *after* control returns to Python, and
  any lines after that call are lost. Measured overshoot equals the duration of
  the blocking call (4.00s for a `time.sleep(4)` under a 2s limit).
- A script wrapping its own work in a bare `except:` can swallow the timeout.
- The lock is always released after a timeout, so the server stays usable.

## Running

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

python app.py                 # http://127.0.0.1:8000
# or: litestar --app app:app run
# or: uvicorn app:app --port 8000
```

## Example

```bash
curl -X POST http://127.0.0.1:8000/execute \
  -H 'Content-Type: application/json' \
  -d '{"code": "import sys\nprint(\"out\")\nprint(\"err\", file=sys.stderr)"}'
```

```json
{"stdout":"out\n","stderr":"err\n","exit_code":0,"timed_out":false,"defined_names":["sys"]}
```

## Tests

```bash
pip install -r requirements.txt
python -m pytest -q     # or: python test_app.py
```

## Security warning

This server executes arbitrary, untrusted Python code with the full privileges
of the process. It is a code-execution service by design. Do **not** expose it
publicly or run it on a machine you care about without sandboxing (containers,
VMs, resource limits, dropped privileges, etc.). The execution timeout is a
usability guard, **not** a security boundary.