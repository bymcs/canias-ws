/**
 * Connection settings for a CANIAS/TROIA Web Service 2.0 endpoint.
 *
 * Every value maps 1:1 to the `login` operation of
 * `CaniasWebService` (WSDL v2).
 */
export interface CaniasConfig {
  /**
   * Full service URL, for example:
   * `http://host:8080/CaniasWS-v2/services/CaniasWebService`
   */
  url: string;
  /** Client (mandant) code, for example `"00"`. */
  client: string;
  /** Session language, for example `"T"`, `"E"` or `"D"`. */
  language: string;
  /** Database server alias expected by the application server. */
  dbServer: string;
  /** Database name. */
  dbName: string;
  /** Application server alias. */
  applicationServer: string;
  /** Web service user. */
  username: string;
  /**
   * Web service password, sent as given. The official TROIA docs say it must
   * be the MD5 hash of the password; IAS's own Java tester sends it as typed.
   * Never logged by this library.
   */
  password: string;
  /** Per-request timeout in milliseconds. Default: 30_000. */
  timeoutMs?: number;
  /**
   * How long a login session is reused before a new login is forced.
   * Default: 10 minutes. Set to 0 to log in for every call.
   */
  sessionTtlMs?: number;
  /** Custom fetch implementation (tests, proxies, undici dispatcher). */
  fetch?: typeof fetch;
  /** Session storage. Defaults to an in-memory store. */
  sessionStore?: SessionStore;
  /** Replaces the default `User-Agent` header. */
  userAgent?: string;
}

/** A live CANIAS session. */
export interface CaniasSession {
  sessionId: string;
  securityKey: string;
  contactNum: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * Session storage contract.
 *
 * The default implementation keeps the session in memory. Implement this
 * interface to share a session across processes (Redis, database, ...).
 */
export interface SessionStore {
  get(): Promise<CaniasSession | null> | CaniasSession | null;
  set(session: CaniasSession): Promise<void> | void;
  clear(): Promise<void> | void;
}

export type CaniasParamValue = string | number | boolean;

/**
 * Parameters passed to `callService`.
 *
 * - An array is turned into `<PARAMETERS><PARAM>...</PARAM></PARAMETERS>`.
 * - A string is sent as-is (useful for pre-built XML payloads).
 */
export type CaniasParams = readonly CaniasParamValue[] | string;

export interface CaniasCallOptions {
  /**
   * Marks `Parameters` as compressed.
   * Not supported in 0.1.0; passing `true` throws `CaniasProtocolError`.
   */
  compressed?: boolean;
  /**
   * Keep the server transaction open so the next call runs in the same
   * scope. Default: false.
   */
  permanent?: boolean;
  /** Comma-separated TROIA variable names to return. Default: "". */
  extraVariables?: string;
  /** Override the auto-incrementing request id. */
  requestId?: number;
  /**
   * Re-login once and retry when the server reports an invalid session.
   * Default: true.
   */
  retryOnSessionExpiry?: boolean;
}

export interface CaniasCallResult {
  /** `true` when `SYSStatus === 0`. */
  ok: boolean;
  serviceId: string;
  /** Value returned by the TROIA service. */
  value: string;
  /** Messages produced by the TROIA service. */
  messages: string;
  extraVariables: string;
  sysStatus: number;
  sysStatusError: string;
  requestId: number;
  durationMs: number;
}
