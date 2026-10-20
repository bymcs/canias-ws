# canias-ws

TypeScript client for the **CANIAS/TROIA ERP SOAP Web Service 2.0**
(`CaniasWS-v2/services/CaniasWebService`).

It handles the three calls every integration needs — `login`, `callService`,
`logout` — plus `listServices`, session reuse and typed errors, so application
code only sees `client.call("SERVICE_NAME", [...])`.

> **Disclaimer:** This is an unofficial community client. It is not affiliated
> with, endorsed by, or supported by IAS (CANIAS ERP). “CANIAS” is a trademark
> of its respective owner.

## Features

- **Four operations, no WSDL runtime.** The endpoint exposes `login`,
  `logout`, `listServices` and `callService`; new TROIA services are just rows
  in `IASWEBSERVICES`, so no WSDL parsing is required.
- **Session reuse.** Logs in lazily, caches `SessionId` + `SecurityKey`, and
  re-logs in once when the server reports an expired session.
- **Single-flight login.** Concurrent calls share one login request.
- **Typed errors.** Transport, SOAP fault, login and protocol failures are
  distinct classes; TROIA-level errors are returned as `ok: false`.
- **Pluggable `fetch` and `SessionStore`** for tests, proxies or Redis.
- **ESM + CJS + types.** Node.js 20 or newer (CI runs on 22 and 24).
  Server-side only.

## Install

```bash
npm install canias-ws
# or
pnpm add canias-ws
```

## Quick start

```ts
import { CaniasClient } from "canias-ws";

const client = new CaniasClient({
  url: "http://host:8080/CaniasWS-v2/services/CaniasWebService",
  client: "00",
  language: "T",
  dbServer: "DBS",
  dbName: "DB",
  applicationServer: "APP",
  username: process.env.CANIAS_WS_USER!,
  password: process.env.CANIAS_WS_PASSWORD!,
});

const services = await client.listServices();

// Any service registered in IASWEBSERVICES that this user may call.
const result = await client.call("MY_SERVICE", ["first", "second"]);

if (!result.ok) {
  console.error(result.sysStatusError);
} else {
  console.log(result.value);
}

await client.close(); // logout
```

### Registering a service

A TROIA class method becomes callable once it has a row in `IASWEBSERVICES`
(screen `WSRT01`) and the login user has a row in `IASWSRIGHTS` (`WSRT02`).
Both must exist in the database you log in to.

### From environment variables

```ts
import { CaniasClient, configFromEnv } from "canias-ws";

const client = new CaniasClient(configFromEnv());
```

Reads `CANIAS_WS_URL`, `CANIAS_WS_CLIENT`, `CANIAS_WS_LANGUAGE`,
`CANIAS_WS_DB_SERVER`, `CANIAS_WS_DB_NAME`, `CANIAS_WS_APP_SERVER`,
`CANIAS_WS_USER`, `CANIAS_WS_PASSWORD`.

## Configuration

| Option | Required | Default | Description |
|---|---|---|---|
| `url` | yes | — | Full v2 service URL |
| `client` | yes | — | Client (mandant) code, e.g. `"00"` |
| `language` | yes | — | Session language (`T`, `E`, `D`, ...) |
| `dbServer` | yes | — | Database server alias |
| `dbName` | yes | — | Database name. TROIA `SELECT`s run against this database, so log in to the repository database for services that read development objects (`SYSDIALOGS`, `SYSCLSHEAD`, ...) |
| `applicationServer` | yes | — | Application server alias |
| `username` | yes | — | Web service user |
| `password` | yes | — | Web service password |
| `timeoutMs` | no | `30000` | Per-request timeout |
| `sessionTtlMs` | no | `600000` | Session reuse window; `0` logs in per call |
| `fetch` | no | global `fetch` | Custom fetch (tests, proxy) |
| `sessionStore` | no | memory | `SessionStore` implementation |
| `userAgent` | no | `canias-ws/...` | `User-Agent` header |

## API

### `client.call(serviceId, params?, options?)`

Calls a service registered in `IASWEBSERVICES`.

```ts
const result = await client.call("MY_SERVICE", ["first", "second"]);
```

`params` can be:

- an array → converted to `<PARAMETERS><PARAM>...</PARAM></PARAMETERS>`
  (values are XML-escaped; each item is one positional method parameter)
- a string → sent as-is (for `TABLE`/`VECTOR` or base64 parameters)

Options:

| Option | Default | Description |
|---|---|---|
| `compressed` | `false` | Marks `Parameters` as compressed; not supported yet, `true` throws |
| `permanent` | `false` | Keep the server transaction open for the next call |
| `extraVariables` | `""` | Comma-separated TROIA variable names to return |
| `requestId` | auto | Override the request id |
| `retryOnSessionExpiry` | `true` | Re-login once on session errors |

Result:

```ts
interface CaniasCallResult {
  ok: boolean;            // sysStatus === 0
  serviceId: string;
  value: string;          // TROIA method return value
  messages: string;       // <TROIAMESSAGES> XML
  extraVariables: string; // <EXTRAVARIABLES> XML
  sysStatus: number;
  sysStatusError: string;
  requestId: number;
  durationMs: number;
}
```

`call()` **does not throw** when `SYSStatus != 0`; check `result.ok`.
Transport, login and SOAP fault errors are thrown.

`ok` only reflects `SYSStatus`. Many TROIA services report their own
business result inside `value` (for example a status field in returned XML)
while `SYSStatus` stays `0`, so check that too. An unregistered service
returns `ok: false` with `System can not find web service: <name>`.

### `client.callOrThrow(...)`

Same as `call()`, but throws `CaniasServiceError` when `ok` is `false`.

### `client.listServices()`

Returns the service names visible to the logged-in user. Useful to verify
registration and permissions. The server sends `NAME_...` items; like IAS's
Java connector, the part before the first `_` is returned.

### `client.withSession(fn)`

Ensures a session and runs `fn`. The session is kept afterwards; call
`close()` for an explicit logout.

```ts
await client.withSession(async (active) => {
  await active.call("A");
  await active.call("B");
});
```

### `client.login()` / `client.logout()` / `client.close()`

`login()` forces a new session. `logout()` and `close()` clear the local
session and send a best-effort logout.

## Errors

| Class | When |
|---|---|
| `CaniasConfigError` | Missing or invalid configuration |
| `CaniasTransportError` | Network failure, timeout, non-XML or HTTP error |
| `CaniasSoapFaultError` | Server returned a SOAP `<Fault>` |
| `CaniasLoginError` | `login` returned `Success = false`; `loginErrorCode` holds `n` from `login error: n` |
| `CaniasServiceError` | `callOrThrow` saw `SYSStatus != 0` |
| `CaniasProtocolError` | Response did not match the expected AXIS shape |

All extend `CaniasError` and expose a `code` such as `"CANIAS_LOGIN"`.

## Session behaviour

1. The first call logs in and stores `SessionId`, `SecurityKey` and an
   expiry (`now + sessionTtlMs`).
2. Later calls reuse the session until it expires; the expired session is
   logged out (best effort) before the new login, so the server does not
   accumulate open sessions.
3. If the server reports an invalid session, the client clears the session,
   logs in once and retries the call. CaniasWS-v2 answers an unknown session
   with `SYSStatus=1` and `failed to call service: null`.
   Pass `retryOnSessionExpiry: false` to turn this off.
4. Concurrent calls share a single login request.
5. `close()` logs out and clears the local session.

## Security notes

- Passwords, `SessionId` and `SecurityKey` are never written to logs or error
  messages by this library.
- The client is intended for **server-side** code. Do not bundle it into
  browser code: credentials and CORS make that unsafe.
- The endpoint in this version is plain HTTP unless you put it behind a TLS
  terminator or VPN. With `Encrypted=false` the login password travels in
  clear text.
- `password` is sent as given. CaniasWS-v2 accepted the plain password in our
  tests (as IAS's own Java tester sends it); the official TROIA docs mention an
  MD5 hash, so pass the hash if your server expects it.
- `listServices()` returns an empty array both when the user has no rights
  and when the session is no longer valid.

## Scope

- **v2 only.** The legacy `CaniasWS-v1/services/iasWebService` operations
  (`callIASService`, plain-string login) are not implemented yet.
- Compression and encrypted payloads are not supported yet; both login flags
  are sent as `false`.
- Works with the AXIS 1.4 `rpc/encoded` responses, including `multiRef` /
  `href` resolution.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm check:package
```

Live smoke test (needs a real endpoint and credentials in `.env`):

```bash
cp .env.example .env
pnpm smoke
```

## Türkçe hızlı başlangıç

```ts
import { CaniasClient } from "canias-ws";

const client = new CaniasClient({
  url: "http://SUNUCU:8080/CaniasWS-v2/services/CaniasWebService",
  client: "00",
  language: "T",
  dbServer: "DBS",
  dbName: "DB",
  applicationServer: "APP",
  username: process.env.CANIAS_WS_USER!,
  password: process.env.CANIAS_WS_PASSWORD!,
});

const sonuc = await client.call("SERVIS_ADI", ["param1", "param2"]);

if (!sonuc.ok) {
  console.error("Hata:", sonuc.sysStatusError);
} else {
  console.log(sonuc.value);
}

await client.close();
```

- `call()` iş hatasında fırlatmaz; `sonuc.ok` kontrol edilir. `ok` yalnız
  `SYSStatus` değerini yansıtır; servis kendi başarı bilgisini `value`
  içinde dönüyorsa onu da kontrol edin.
- `dbName`: TROIA `SELECT`'leri giriş yapılan veritabanında çalışır; geliştirme
  nesnelerini (`SYSDIALOGS`, `SYSCLSHEAD`) okuyan servisler için repository
  veritabanına giriş yapın. Servis kaydı (`IASWEBSERVICES`) ve yetki
  (`IASWSRIGHTS`) de o veritabanında olmalıdır.
- `callOrThrow()` hata durumunda `CaniasServiceError` fırlatır.
- Oturum otomatik açılır, yeniden kullanılır ve gerekirse bir kez yenilenir.
- `listServices()` ile servis kaydı ve yetki kontrol edilebilir.
- Yalnız sunucu tarafında kullanılmalıdır; tarayıcıya paketlenmemelidir.

## License

MIT
