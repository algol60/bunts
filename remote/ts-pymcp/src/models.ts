/**
 * Result models returned by the pyrunner MCP tools.
 *
 * These are the MCP `outputSchema` of the tools, so every field is documented
 * and typed. Keep them plain: they travel to whatever client is on the other
 * end.
 */

import { z } from "zod";

/** Mirrors `pyrunner.app.TIMEOUT_EXIT_CODE` (GNU `timeout` convention). */
export const TIMEOUT_EXIT_CODE = 124;

/**
 * Result of running one script through pyrunner.
 *
 * A script that raised is reported as `ok=false` with `exit_code=1` — that is
 * script output, not a failure of this tool.
 */
export const ExecutionOutcomeSchema = z.object({
  ok: z.boolean().describe("True only when the script exited cleanly."),
  stdout: z.string().describe("Captured standard output."),
  stderr: z.string().describe("Captured standard error."),
  exit_code: z.number().int().describe("Process-style exit code for the script."),
  timed_out: z
    .boolean()
    .describe("True if the runner stopped the script on timeout."),
  defined_names: z.array(z.string()).describe("Top-level names the script defined."),
  duration_seconds: z
    .number()
    .describe("Round-trip time for this execution, in seconds."),
});

export type ExecutionOutcome = z.infer<typeof ExecutionOutcomeSchema>;

/** Result of running several scripts in order. */
export const BatchOutcomeSchema = z.object({
  ok: z.boolean().describe("True only when every script succeeded."),
  results: z
    .array(ExecutionOutcomeSchema)
    .describe("Per-script outcomes, in the order the scripts were given."),
  succeeded: z.number().int().describe("How many scripts exited cleanly."),
  failed: z.number().int().describe("How many scripts failed or timed out."),
  duration_seconds: z
    .number()
    .describe("Total wall-clock time for the batch, in seconds."),
});

export type BatchOutcome = z.infer<typeof BatchOutcomeSchema>;

/** Connectivity report for the configured pyrunner service. */
export const RunnerStatusSchema = z.object({
  reachable: z.boolean().describe("True when pyrunner answered GET /health."),
  base_url: z.string().describe("The pyrunner URL that was probed."),
  status: z
    .record(z.string(), z.string())
    .nullable()
    .describe("Parsed /health response body."),
  detail: z.string().describe("Failure reason, empty when reachable."),
});

export type RunnerStatus = z.infer<typeof RunnerStatusSchema>;
