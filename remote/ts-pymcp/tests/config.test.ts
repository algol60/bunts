/** Configuration parsing and validation. */

import { describe, expect, test } from "bun:test";

import {
  ConfigError,
  DEFAULT_BASE_URL,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT,
  describeSettings,
  settingsFromEnv,
} from "../src/config.ts";

describe("settingsFromEnv", () => {
  test("defaults apply when the environment is empty", () => {
    const settings = settingsFromEnv({});
    expect(settings.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(settings.requestTimeout).toBe(DEFAULT_REQUEST_TIMEOUT);
    expect(settings.transport).toBe("streamable-http");
    expect(settings.host).toBe(DEFAULT_HOST);
    expect(settings.port).toBe(DEFAULT_PORT);
  });

  test("URL is read and a trailing slash is stripped", () => {
    const settings = settingsFromEnv({
      PYRUNNER_MCP_URL: "http://runner.internal:9000/",
    });
    expect(settings.baseUrl).toBe("http://runner.internal:9000");
  });

  test("a bare host and port get an http scheme", () => {
    const settings = settingsFromEnv({ PYRUNNER_MCP_URL: "localhost:1234" });
    expect(settings.baseUrl).toBe("http://localhost:1234");
  });

  test("blank values fall back to defaults", () => {
    const settings = settingsFromEnv({
      PYRUNNER_MCP_URL: "  ",
      PYRUNNER_MCP_REQUEST_TIMEOUT: "",
    });
    expect(settings.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(settings.requestTimeout).toBe(DEFAULT_REQUEST_TIMEOUT);
  });

  test("stdio remains available as an explicit opt-in", () => {
    expect(
      settingsFromEnv({ PYRUNNER_MCP_TRANSPORT: "stdio" }).transport,
    ).toBe("stdio");
  });

  test("transport and bind options are read", () => {
    const settings = settingsFromEnv({
      PYRUNNER_MCP_TRANSPORT: "STREAMABLE-HTTP",
      PYRUNNER_MCP_HOST: "0.0.0.0",
      PYRUNNER_MCP_PORT: "9001",
    });
    expect(settings.transport).toBe("streamable-http");
    expect(settings.host).toBe("0.0.0.0");
    expect(settings.port).toBe(9001);
  });

  test("an empty host falls back to the default", () => {
    expect(settingsFromEnv({ PYRUNNER_MCP_HOST: "" }).host).toBe(DEFAULT_HOST);
  });

  test.each([
    { PYRUNNER_MCP_REQUEST_TIMEOUT: "soon" },
    { PYRUNNER_MCP_REQUEST_TIMEOUT: "0" },
    { PYRUNNER_MCP_REQUEST_TIMEOUT: "-1" },
    { PYRUNNER_MCP_REQUEST_TIMEOUT: "Infinity" },
    { PYRUNNER_MCP_REQUEST_TIMEOUT: "0x10" },
    { PYRUNNER_MCP_PORT: "http" },
    { PYRUNNER_MCP_PORT: "1.5" },
    { PYRUNNER_MCP_PORT: "1e3" },
    { PYRUNNER_MCP_PORT: "0x10" },
    { PYRUNNER_MCP_PORT: "70000" },
    { PYRUNNER_MCP_TRANSPORT: "carrier-pigeon" },
    { PYRUNNER_MCP_URL: "http://" },
  ])("bad values are rejected at startup: %j", (env) => {
    expect(() => settingsFromEnv(env)).toThrow(ConfigError);
  });

  test("describeSettings is JSON friendly", () => {
    const described = describeSettings(
      settingsFromEnv({ PYRUNNER_MCP_URL: "http://x:8000" }),
    );
    expect(described.base_url).toBe("http://x:8000");
    expect(typeof described.request_timeout_seconds).toBe("number");
    expect(described.transport).toBe("streamable-http");
  });
});
