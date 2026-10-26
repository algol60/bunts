/**
 * Public package surface for embedders.
 *
 * The entry point is deliberately not imported here: importing `main.ts` can
 * start a transport when it is executed directly.
 */

export {
  DEFAULT_BASE_URL,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT,
  VALID_TRANSPORTS,
  ConfigError,
  describeSettings,
  settingsFromEnv,
  type Env,
  type Settings,
  type Transport,
} from "./config.ts";
export {
  BatchOutcomeSchema,
  ExecutionOutcomeSchema,
  RunnerStatusSchema,
  TIMEOUT_EXIT_CODE,
  type BatchOutcome,
  type ExecutionOutcome,
  type RunnerStatus,
} from "./models.ts";
export {
  PyRunnerClient,
  PyRunnerError,
  PyRunnerProtocolError,
  PyRunnerUnavailable,
  buildClient,
  type FetchLike,
  type PyRunnerClientOptions,
} from "./client.ts";
export {
  INSTRUCTIONS,
  MAX_BATCH_SIZE,
  SERVER_NAME,
  SERVER_VERSION,
  buildServer,
  createServer,
  type BuildServerOptions,
  type PyRunnerServer,
  type ServerState,
} from "./server.ts";
export { main } from "./main.ts";
