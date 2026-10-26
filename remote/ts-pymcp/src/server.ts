/**
 * MCP v2 server exposing pyrunner as tools.
 *
 * Tools exposed:
 *
 * * `run_python` — run one script, return its output and exit status.
 * * `run_python_batch` — run several scripts in order, one round trip.
 * * `runner_status` — check that pyrunner is reachable, and report config.
 *
 * A script that raises is *data*, not a tool failure. It comes back as a
 * successful tool call with `ok=false` and a populated `stderr`. Only problems
 * reaching pyrunner itself (unreachable, slow, malformed reply) become MCP tool
 * errors. The SDK catches a thrown `Error` in a tool handler and forwards its
 * message verbatim with `isError: true`, so the model sees the actual reason
 * rather than a generic failure string.
 */

import {
  McpServer,
  type CallToolResult,
  type ToolAnnotations,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  PyRunnerError,
  buildClient,
  type FetchLike,
  type PyRunnerClient,
} from "./client.ts";
import { settingsFromEnv, type Settings } from "./config.ts";
import {
  BatchOutcomeSchema,
  ExecutionOutcomeSchema,
  RunnerStatusSchema,
  type BatchOutcome,
  type ExecutionOutcome,
  type RunnerStatus,
} from "./models.ts";

export const SERVER_NAME = "pyrunner";
export const SERVER_VERSION = "1.0.0";

/**
 * Upper bound on scripts per `run_python_batch` call. Keeps a single tool call
 * from pinning the runner's execution lock for an unbounded time.
 */
export const MAX_BATCH_SIZE = 25;

export const INSTRUCTIONS = `Execute Python code on the pyrunner service and get stdout/stderr back.

Tools:
- \`run_python\`: run one script. This is the one you want almost always.
- \`run_python_batch\`: run several scripts in order, for when one round trip is
  preferable to several. Each script runs as a *separate* execution, so
  variables do not carry over between them; re-import anything you need.
- \`runner_status\`: confirm pyrunner is reachable before debugging a failure.

How to read results:
- \`ok\` is True only when the script exited cleanly. \`exit_code\` is 0 on
  success, 1 on an uncaught exception, and 124 when the runner stopped the
  script at its execution timeout.
- A failing script is still a successful tool call, with the traceback in
  \`stderr\`. A tool error means pyrunner could not be reached at all - call
  \`runner_status\` if you see one.
- Scripts share one interpreter process and are serialised, so runs queue up
  behind each other. Keep scripts small, and prefer printing a final summary
  over streaming lots of output.`;

// Tools that execute arbitrary code: never read-only, never idempotent, and
// free to touch the outside world (files, network, subprocesses).
const EXECUTOR_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

const STATUS_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Process-wide handles shared by every tool call. */
export interface ServerState {
  readonly settings: Settings;
  readonly client: PyRunnerClient;
}

export type PyRunnerServer = McpServer & { readonly state: ServerState };

export interface BuildServerOptions {
  /** Optional fetch override, used by tests to route at an in-process fake. */
  fetch?: FetchLike;
}

function logInfo(message: string): void {
  // stderr, never stdout: the stdio transport owns stdout for JSON-RPC frames.
  // A single stray console.log there corrupts the protocol stream.
  console.error(`${new Date().toISOString()} INFO pyrunner: ${message}`);
}

function success<T>(value: T, text: string): CallToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: value as Record<string, unknown>,
  };
}

function renderExecution(outcome: ExecutionOutcome): string {
  const lines = [
    `ok: ${outcome.ok}`,
    `exit_code: ${outcome.exit_code}`,
    `timed_out: ${outcome.timed_out}`,
    `duration_seconds: ${outcome.duration_seconds}`,
    `defined_names: ${JSON.stringify(outcome.defined_names)}`,
  ];
  if (outcome.stdout !== "") {
    const stdout = outcome.stdout.endsWith("\n")
      ? outcome.stdout.slice(0, -1)
      : outcome.stdout;
    lines.push("", "stdout:", stdout);
  }
  if (outcome.stderr !== "") {
    const stderr = outcome.stderr.endsWith("\n")
      ? outcome.stderr.slice(0, -1)
      : outcome.stderr;
    lines.push("", "stderr:", stderr);
  }
  return lines.join("\n");
}

function renderBatch(batch: BatchOutcome): string {
  return JSON.stringify(batch, null, 2);
}

function renderStatus(status: RunnerStatus): string {
  return JSON.stringify(status, null, 2);
}

/**
 * Create the MCP server with its tools registered.
 *
 * @param settings Configuration to use. Defaults to reading the environment.
 * @param deps Optional dependencies, primarily the fetch override for tests.
 */
export function buildServer(
  settings: Settings = settingsFromEnv(),
  deps: BuildServerOptions = {},
): PyRunnerServer {
  const state: ServerState = {
    settings,
    client: buildClient(settings, { fetch: deps.fetch }),
  };

  const server = new McpServer(
    {
      name: SERVER_NAME,
      title: "Python Runner",
      version: SERVER_VERSION,
      icons: [
        {
          src: "https://www.python.org/static/community_logos/python-logo.png",
        },
      ],
    },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    "run_python",
    {
      title: "Run Python script",
      description:
        "Execute a Python script on the pyrunner service and return its " +
        "captured stdout, stderr, exit code and defined names. Use this to " +
        "compute, prototype, or verify code without leaving the session. " +
        "An uncaught exception is reported as exit_code 1 with the " +
        "traceback in stderr; exceeding the runner's timeout gives " +
        "exit_code 124.",
      inputSchema: z.object({
        code: z.string().describe("Python source to execute."),
      }),
      outputSchema: ExecutionOutcomeSchema,
      annotations: EXECUTOR_ANNOTATIONS,
    },
    async ({ code }) => {
      logInfo(`run_python: ${code.length} characters of source`);
      const outcome = await state.client.execute(code);
      return success(outcome, renderExecution(outcome));
    },
  );

  server.registerTool(
    "run_python_batch",
    {
      title: "Run several Python scripts",
      description:
        `Execute up to ${MAX_BATCH_SIZE} Python scripts on the pyrunner ` +
        "service, in order, and return one result per script. Use this when a " +
        "single round trip is better than several separate calls. Each script " +
        "is an independent execution with a fresh namespace: variables, " +
        "imports and state do NOT carry over between entries, so each script " +
        "must be self-contained.",
      inputSchema: z.object({
        scripts: z.array(z.string()).describe("Python sources to execute in order."),
      }),
      outputSchema: BatchOutcomeSchema,
      annotations: EXECUTOR_ANNOTATIONS,
    },
    async ({ scripts }) => {
      if (scripts.length === 0) {
        throw new Error("scripts must contain at least one script");
      }
      if (scripts.length > MAX_BATCH_SIZE) {
        throw new Error(
          `scripts contains ${scripts.length} entries; the limit is ` +
            `${MAX_BATCH_SIZE}`,
        );
      }

      logInfo(`run_python_batch: ${scripts.length} scripts`);
      const started = performance.now();

      // Deliberately sequential. pyrunner serialises executions behind a
      // lock, so firing these off concurrently would not finish any sooner,
      // and sequential order keeps output predictable.
      const results: ExecutionOutcome[] = [];
      for (const script of scripts) {
        results.push(await state.client.execute(script));
      }

      const succeeded = results.filter((result) => result.ok).length;
      const batch: BatchOutcome = {
        ok: succeeded === results.length,
        results,
        succeeded,
        failed: results.length - succeeded,
        duration_seconds:
          Math.round(((performance.now() - started) / 1000) * 1_000_000) /
          1_000_000,
      };
      return success(batch, renderBatch(batch));
    },
  );

  server.registerTool(
    "runner_status",
    {
      title: "Check pyrunner status",
      description:
        "Check whether the pyrunner service behind this MCP server is " +
        "reachable, and report the URL and request timeout in use. Call " +
        "this first when a run fails unexpectedly, to tell an unreachable " +
        "runner apart from a script that genuinely failed.",
      inputSchema: z.object({}),
      outputSchema: RunnerStatusSchema,
      annotations: STATUS_ANNOTATIONS,
    },
    async () => {
      try {
        const status = await state.client.health();
        const report: RunnerStatus = {
          reachable: true,
          base_url: state.settings.baseUrl,
          status,
          detail: "",
        };
        return success(report, renderStatus(report));
      } catch (error) {
        if (!(error instanceof PyRunnerError)) {
          throw error;
        }
        const report: RunnerStatus = {
          reachable: false,
          base_url: state.settings.baseUrl,
          status: null,
          detail: error.message,
        };
        return success(report, renderStatus(report));
      }
    },
  );

  // Convenience handle for embedders and tests.
  return Object.assign(server, { state }) as PyRunnerServer;
}

/** Alias for {@link buildServer}. */
export function createServer(
  settings?: Settings,
  deps: BuildServerOptions = {},
): PyRunnerServer {
  return buildServer(settings, deps);
}
