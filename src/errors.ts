import type { CaniasCallResult } from "./types.js";

export type CaniasErrorCode =
  | "CANIAS_CONFIG"
  | "CANIAS_TRANSPORT"
  | "CANIAS_SOAP_FAULT"
  | "CANIAS_LOGIN"
  | "CANIAS_SERVICE"
  | "CANIAS_PROTOCOL";

/** Base class for every error thrown by this library. */
export class CaniasError extends Error {
  readonly code: CaniasErrorCode;

  constructor(message: string, code: CaniasErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Invalid client configuration. */
export class CaniasConfigError extends CaniasError {
  constructor(message: string) {
    super(message, "CANIAS_CONFIG");
  }
}

/** Network failure, timeout, non-2xx response or a non-XML body. */
export class CaniasTransportError extends CaniasError {
  readonly status: number | undefined;
  readonly bodySnippet: string | undefined;

  constructor(
    message: string,
    details?: { status?: number; bodySnippet?: string; cause?: unknown },
  ) {
    super(
      message,
      "CANIAS_TRANSPORT",
      details?.cause === undefined ? undefined : { cause: details.cause },
    );
    this.status = details?.status;
    this.bodySnippet = details?.bodySnippet;
  }
}

/** The server answered with a SOAP `<Fault>`. */
export class CaniasSoapFaultError extends CaniasError {
  readonly faultCode: string;
  readonly faultString: string;

  constructor(faultCode: string, faultString: string) {
    super(
      `SOAP fault${faultCode ? ` ${faultCode}` : ""}: ${faultString || "unknown error"}`,
      "CANIAS_SOAP_FAULT",
    );
    this.faultCode = faultCode;
    this.faultString = faultString;
  }
}

/**
 * `login` returned `Success = false`.
 *
 * The server reports `login error: n`; `loginErrorCode` is that `n`
 * (2 invalid credentials, 7 user blocked, 20 max session count, ...),
 * see https://troia.readthedocs.io/en/latest/70WebServices.html
 */
export class CaniasLoginError extends CaniasError {
  readonly errorMessage: string;
  readonly loginErrorCode: number | undefined;

  constructor(errorMessage: string) {
    super(
      errorMessage ? `Login failed: ${errorMessage}` : "Login failed",
      "CANIAS_LOGIN",
    );
    this.errorMessage = errorMessage;
    const match = /login error:\s*(\d+)/i.exec(errorMessage);
    this.loginErrorCode = match ? Number(match[1]) : undefined;
  }
}

/**
 * A TROIA service returned `SYSStatus != 0`.
 *
 * `call()` returns this as a result instead of throwing; `callOrThrow()`
 * throws this error.
 */
export class CaniasServiceError extends CaniasError {
  readonly result: CaniasCallResult;

  constructor(result: CaniasCallResult) {
    super(
      `Service ${result.serviceId} failed (SYSStatus=${result.sysStatus}): ${
        result.sysStatusError || "unknown error"
      }`,
      "CANIAS_SERVICE",
    );
    this.result = result;
  }
}

/** The response XML did not match the expected AXIS/RPC shape. */
export class CaniasProtocolError extends CaniasError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, "CANIAS_PROTOCOL", options);
  }
}
