# Changelog

All notable changes to this project are documented here.

## 0.1.0 — 2026-10-20

### Added

- `CaniasClient` for CANIAS/TROIA Web Service 2.0:
  `login`, `callService`, `listServices`, `logout`.
- Lazy login, session reuse with TTL, single-flight login and one automatic
  re-login/retry on expired sessions (`SYSStatus=1`,
  `failed to call service: null`); concurrent callers share one re-login.
- Expired sessions are logged out before a new login, so the server does not
  accumulate open sessions.
- `listServices()` reads SOAP-encoded arrays with any member tag name and
  returns the part before the first `_`, like IAS's Java connector.
- `requestId` keeps the sent value when the server answers `RequestId=0`.
- `CaniasLoginError.loginErrorCode` (parsed from `login error: n`).
- AXIS `rpc/encoded` response parsing, including nested
  `multiRef` / `href` resolution.
- Typed errors: `CaniasConfigError`, `CaniasTransportError`,
  `CaniasSoapFaultError`, `CaniasLoginError`, `CaniasServiceError`,
  `CaniasProtocolError`.
- `call()` (returns `ok: false` on `SYSStatus != 0`) and `callOrThrow()`.
- `configFromEnv()` for `CANIAS_WS_*` variables.
- Pluggable `fetch` and `SessionStore`; `MemorySessionStore` default.
- ESM + CJS builds with type declarations.

### Known limitations

- v1 (`iasWebService`) is not supported yet.
- Compression and encrypted payloads are not supported yet.
