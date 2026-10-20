import { resolveConfig, type NormalizedConfig } from "./config.js";
import {
  CaniasConfigError,
  CaniasLoginError,
  CaniasProtocolError,
  CaniasServiceError,
  CaniasSoapFaultError,
  CaniasTransportError,
} from "./errors.js";
import type {
  CaniasCallOptions,
  CaniasCallResult,
  CaniasConfig,
  CaniasParams,
  CaniasSession,
} from "./types.js";
import {
  buildEnvelope,
  buildParameters,
  childNode,
  childText,
  childrenOf,
  parseOperationResponse,
  tagOf,
  textOf,
  type XmlNode,
} from "./xml.js";

// "failed to call service" is what CaniasWS-v2 returns for an unknown/expired
// session; an unregistered service answers "System can not find web service".
const SESSION_ERROR = /failed to call service|session|oturum|security\s*key/i;

function toInt(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringResponseValue(node: XmlNode | null): string {
  if (!node) return "";
  const value = childNode(node, "Value");
  return value ? textOf(value) : textOf(node);
}

function isTrue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function isCompressed(node: XmlNode | null): boolean {
  return node ? isTrue(childText(node, "Comressed")) : false;
}

/**
 * Client for the CANIAS/TROIA Web Service 2.0 endpoint
 * (`CaniasWS-v2/services/CaniasWebService`).
 *
 * The client logs in lazily, reuses the session until `sessionTtlMs`,
 * and re-logs in once when the server reports an invalid session.
 */
export class CaniasClient {
  readonly #config: NormalizedConfig;
  #loginPromise: Promise<CaniasSession> | null = null;
  readonly #invalidating = new Map<string, Promise<void>>();
  #requestId = 0;

  constructor(config: CaniasConfig) {
    this.#config = resolveConfig(config);
  }

  /**
   * Forces a new login and replaces the stored session.
   * Prefer leaving this to `call()`; use it only for explicit control.
   */
  async login(): Promise<CaniasSession> {
    const xml = buildEnvelope("login", [
      { name: "Client", type: "string", value: this.#config.client },
      { name: "Language", type: "string", value: this.#config.language },
      { name: "DBServer", type: "string", value: this.#config.dbServer },
      { name: "DBName", type: "string", value: this.#config.dbName },
      {
        name: "ApplicationServer",
        type: "string",
        value: this.#config.applicationServer,
      },
      { name: "Username", type: "string", value: this.#config.username },
      { name: "Password", type: "string", value: this.#config.password },
      { name: "Encrypted", type: "boolean", value: false },
      { name: "Compression", type: "boolean", value: false },
      { name: "LCheck", type: "string", value: "" },
      { name: "VKey", type: "string", value: "" },
    ]);

    const raw = await this.#post(xml);
    const parsed = parseOperationResponse(raw, "login");

    if (parsed.fault) {
      throw new CaniasSoapFaultError(parsed.fault.code, parsed.fault.message);
    }
    if (!parsed.returnNode) {
      throw new CaniasProtocolError("login response is missing loginReturn");
    }

    const node = parsed.returnNode;
    const sessionId = childText(node, "SessionId").trim();
    const securityKey = childText(node, "SecurityKey").trim();
    if (!isTrue(childText(node, "Success"))) {
      throw new CaniasLoginError(childText(node, "ErrorMessage").trim());
    }
    if (sessionId === "") {
      throw new CaniasProtocolError("login response is missing SessionId");
    }

    const now = Date.now();
    const session: CaniasSession = {
      sessionId,
      securityKey,
      contactNum: childText(node, "ContactNum").trim(),
      createdAt: now,
      expiresAt: now + this.#config.sessionTtlMs,
    };

    await this.#config.sessionStore.set(session);
    return session;
  }

  /** Lists the services the logged-in user is allowed to call. */
  async listServices(): Promise<string[]> {
    const session = await this.#ensureSession();
    const xml = buildEnvelope("listServices", [
      { name: "SessionId", type: "string", value: session.sessionId },
    ]);

    const raw = await this.#post(xml);
    const parsed = parseOperationResponse(raw, "listServices");

    if (parsed.fault) {
      throw new CaniasSoapFaultError(parsed.fault.code, parsed.fault.message);
    }
    if (!parsed.returnNode) {
      throw new CaniasProtocolError(
        "listServices response is missing listServicesReturn",
      );
    }

    // SOAP-encoded array member names are not significant (Axis may use
    // <item> or repeat <listServicesReturn>), so take every element child.
    // Items look like "NAME_..."; the official IAS connector keeps the part
    // before the first "_". An expired session also yields an empty list.
    return childrenOf(parsed.returnNode)
      .filter((child) => !tagOf(child)?.startsWith("#"))
      .map((item) => textOf(item).trim().split("_")[0] ?? "")
      .filter((item) => item !== "");
  }

  /**
   * Calls a service registered in `IASWEBSERVICES`.
   *
   * TROIA-level failures (`SYSStatus != 0`) are returned as `ok: false`
   * instead of being thrown. Transport, SOAP fault and login errors throw.
   */
  async call(
    serviceId: string,
    params: CaniasParams = [],
    options: CaniasCallOptions = {},
  ): Promise<CaniasCallResult> {
    if (typeof serviceId !== "string" || serviceId.trim() === "") {
      throw new CaniasConfigError("serviceId is required");
    }
    if (options.compressed) {
      throw new CaniasProtocolError(
        "Compressed responses are not supported yet; pass compressed: false",
      );
    }

    const retry = options.retryOnSessionExpiry ?? true;
    let session = await this.#ensureSession();

    try {
      let result = await this.#execute(serviceId, params, options, session);

      if (
        retry &&
        result.sysStatus !== 0 &&
        SESSION_ERROR.test(result.sysStatusError)
      ) {
        await this.#invalidate(session);
        session = await this.#ensureSession();
        result = await this.#execute(serviceId, params, options, session);
      }

      return result;
    } catch (error) {
      if (
        retry &&
        error instanceof CaniasSoapFaultError &&
        SESSION_ERROR.test(error.faultString)
      ) {
        await this.#invalidate(session);
        session = await this.#ensureSession();
        return this.#execute(serviceId, params, options, session);
      }
      throw error;
    }
  }

  /** Same as `call()`, but throws `CaniasServiceError` when `SYSStatus != 0`. */
  async callOrThrow(
    serviceId: string,
    params: CaniasParams = [],
    options: CaniasCallOptions = {},
  ): Promise<CaniasCallResult> {
    const result = await this.call(serviceId, params, options);
    if (!result.ok) throw new CaniasServiceError(result);
    return result;
  }

  /**
   * Ensures a session exists and runs `fn` with this client.
   * The session is kept afterwards; call `close()` for an explicit logout.
   */
  async withSession<T>(fn: (client: this) => Promise<T>): Promise<T> {
    await this.#ensureSession();
    return fn(this);
  }

  /** Logs out (best effort) and clears the local session. */
  async logout(): Promise<void> {
    const session = await this.#config.sessionStore.get();
    await this.#config.sessionStore.clear();
    if (session) await this.#logoutRemote(session);
  }

  /** Alias for `logout()`. */
  async close(): Promise<void> {
    await this.logout();
  }

  async #ensureSession(): Promise<CaniasSession> {
    const existing = await this.#config.sessionStore.get();
    if (existing && existing.expiresAt > Date.now()) return existing;
    if (this.#loginPromise) return this.#loginPromise;

    // Close the expired session first so the server does not keep it open.
    const promise = (async () => {
      if (existing) await this.#logoutRemote(existing);
      return this.login();
    })();
    this.#loginPromise = promise;
    try {
      return await promise;
    } finally {
      if (this.#loginPromise === promise) this.#loginPromise = null;
    }
  }

  /** Best-effort server logout; never throws. */
  async #logoutRemote(session: CaniasSession): Promise<void> {
    const xml = buildEnvelope("logout", [
      { name: "SessionId", type: "string", value: session.sessionId },
    ]);
    try {
      await this.#post(xml);
    } catch {
      // The local session is already gone; a failed logout must not throw.
    }
  }

  /**
   * Drops a session the server rejected, unless a concurrent call already
   * replaced it (avoids one re-login per parallel caller). It is also logged
   * out (best effort) in case the server still holds it.
   */
  #invalidate(session: CaniasSession): Promise<void> {
    // Single-flight per session: parallel callers would otherwise all pass
    // the async store check before the first one clears it.
    const pending = this.#invalidating.get(session.sessionId);
    if (pending) return pending;

    const promise = (async () => {
      const current = await this.#config.sessionStore.get();
      if (current?.sessionId === session.sessionId) {
        await this.#config.sessionStore.clear();
        await this.#logoutRemote(session);
      }
    })().finally(() => this.#invalidating.delete(session.sessionId));

    this.#invalidating.set(session.sessionId, promise);
    return promise;
  }

  #nextRequestId(): number {
    this.#requestId += 1;
    if (this.#requestId > 2_147_483_647) this.#requestId = 1;
    return this.#requestId;
  }

  async #execute(
    serviceId: string,
    params: CaniasParams,
    options: CaniasCallOptions,
    session: CaniasSession,
  ): Promise<CaniasCallResult> {
    const parameters =
      typeof params === "string" ? params : buildParameters(params);
    const requestId = options.requestId ?? this.#nextRequestId();

    const xml = buildEnvelope("callService", [
      { name: "SessionId", type: "string", value: session.sessionId },
      { name: "SecurityKey", type: "string", value: session.securityKey },
      { name: "ServiceId", type: "string", value: serviceId },
      { name: "Parameters", type: "string", value: parameters },
      {
        name: "Compressed",
        type: "boolean",
        value: options.compressed ?? false,
      },
      { name: "Permanent", type: "boolean", value: options.permanent ?? false },
      {
        name: "ExtraVariables",
        type: "string",
        value: options.extraVariables ?? "",
      },
      { name: "RequestId", type: "int", value: requestId },
    ]);

    const started = Date.now();
    const raw = await this.#post(xml);
    const parsed = parseOperationResponse(raw, "callService");

    if (parsed.fault) {
      throw new CaniasSoapFaultError(parsed.fault.code, parsed.fault.message);
    }
    if (!parsed.returnNode) {
      throw new CaniasProtocolError(
        "callService response is missing callServiceReturn",
      );
    }

    const node = parsed.returnNode;
    const responseNode = childNode(node, "Response");
    const messagesNode = childNode(node, "Messages");
    const extraNode = childNode(node, "ExtraVariables");

    if (
      isCompressed(responseNode) ||
      isCompressed(messagesNode) ||
      isCompressed(extraNode)
    ) {
      throw new CaniasProtocolError(
        "Server returned a compressed response; compression is not supported yet",
      );
    }

    const sysStatus = toInt(childText(node, "SYSStatus"), 0);

    return {
      ok: sysStatus === 0,
      serviceId,
      value: stringResponseValue(responseNode),
      messages: stringResponseValue(messagesNode),
      extraVariables: stringResponseValue(extraNode),
      sysStatus,
      sysStatusError: stringResponseValue(
        childNode(node, "SYSStatusError"),
      ).trim(),
      // The server echoes RequestId, but answers 0 when the call fails early.
      requestId: toInt(childText(node, "RequestId"), 0) || requestId,
      durationMs: Date.now() - started,
    };
  }

  async #post(body: string): Promise<string> {
    const { url, timeoutMs, fetch: fetchImpl, userAgent } = this.#config;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          SOAPAction: '""',
          Accept: "text/xml, application/soap+xml, text/plain",
          "User-Agent": userAgent,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      throw new CaniasTransportError(
        timedOut
          ? `Request timed out after ${timeoutMs}ms`
          : `Request to ${url} failed`,
        { cause },
      );
    }

    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw new CaniasTransportError("Failed to read response body", {
        status: response.status,
        cause,
      });
    }

    const trimmed = text.trimStart();
    const looksLikeXml = trimmed.startsWith("<");
    const looksLikeHtml = /^<(!doctype|html)/i.test(trimmed);

    if (!looksLikeXml || looksLikeHtml) {
      throw new CaniasTransportError(
        response.ok
          ? "Response is not XML"
          : `HTTP ${response.status} from ${url}`,
        { status: response.status, bodySnippet: text.slice(0, 500) },
      );
    }

    // AXIS sends SOAP faults with HTTP 500; keep those for the parser.
    if (!response.ok && !/<(\w+:)?Fault[\s>]/.test(text)) {
      throw new CaniasTransportError(`HTTP ${response.status} from ${url}`, {
        status: response.status,
        bodySnippet: text.slice(0, 500),
      });
    }

    return text;
  }
}
