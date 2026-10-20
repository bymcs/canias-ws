import { CaniasConfigError } from "./errors.js";
import { MemorySessionStore } from "./session.js";
import type { CaniasConfig, SessionStore } from "./types.js";
import { VERSION } from "./version.js";

export interface NormalizedConfig {
  url: string;
  client: string;
  language: string;
  dbServer: string;
  dbName: string;
  applicationServer: string;
  username: string;
  password: string;
  timeoutMs: number;
  sessionTtlMs: number;
  fetch: typeof fetch;
  sessionStore: SessionStore;
  userAgent: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SESSION_TTL_MS = 10 * 60_000;

function required(value: string | undefined, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CaniasConfigError(`Missing required config: ${name}`);
  }
  return value;
}

function positiveNumber(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) {
    throw new CaniasConfigError(`${name} must be a positive number`);
  }
  return value;
}

/** Validates user config and applies defaults. */
export function resolveConfig(config: CaniasConfig): NormalizedConfig {
  if (!config || typeof config !== "object") {
    throw new CaniasConfigError("Config object is required");
  }

  const url = required(config.url, "url");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CaniasConfigError(`Invalid url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CaniasConfigError("url must use http or https");
  }

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CaniasConfigError(
      "Global fetch is not available; use Node.js 20+ or pass a fetch implementation",
    );
  }

  const sessionTtlMs = config.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  if (!Number.isFinite(sessionTtlMs) || sessionTtlMs < 0) {
    throw new CaniasConfigError("sessionTtlMs must be zero or a positive number");
  }

  return {
    url,
    client: required(config.client, "client"),
    language: required(config.language, "language"),
    dbServer: required(config.dbServer, "dbServer"),
    dbName: required(config.dbName, "dbName"),
    applicationServer: required(config.applicationServer, "applicationServer"),
    username: required(config.username, "username"),
    password: required(config.password, "password"),
    timeoutMs: positiveNumber(config.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs"),
    sessionTtlMs,
    fetch: fetchImpl,
    sessionStore: config.sessionStore ?? new MemorySessionStore(),
    userAgent:
      config.userAgent ?? `canias-ws/${VERSION} (+https://www.npmjs.com/package/canias-ws)`,
  };
}

/**
 * Reads connection settings from `CANIAS_WS_*` environment variables.
 *
 * ```
 * CANIAS_WS_URL, CANIAS_WS_CLIENT, CANIAS_WS_LANGUAGE,
 * CANIAS_WS_DB_SERVER, CANIAS_WS_DB_NAME, CANIAS_WS_APP_SERVER,
 * CANIAS_WS_USER, CANIAS_WS_PASSWORD
 * ```
 */
export function configFromEnv(
  env: Record<string, string | undefined> = process.env,
): CaniasConfig {
  const read = (name: string): string => env[`CANIAS_WS_${name}`] ?? "";

  return {
    url: read("URL"),
    client: read("CLIENT") || "00",
    language: read("LANGUAGE") || "T",
    dbServer: read("DB_SERVER"),
    dbName: read("DB_NAME"),
    applicationServer: read("APP_SERVER"),
    username: read("USER"),
    password: read("PASSWORD"),
  };
}
