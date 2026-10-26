import type { Config } from "./config.ts"
import { cleanupOutputs } from "./lib/output.ts"

/**
 * Clean retained outputs at startup and hourly. Returns a function that stops
 * the interval; the timer is unref'd so it never keeps the process alive.
 */
export const startMaintenance = (config: Config) => {
  const run = () => void cleanupOutputs(config).catch(() => undefined)
  run()
  const timer = setInterval(run, 60 * 60 * 1_000)
  timer.unref()
  return () => clearInterval(timer)
}
