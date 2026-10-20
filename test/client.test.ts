import { describe, expect, it, vi } from "vitest";

import {
  CaniasClient,
  CaniasConfigError,
  CaniasLoginError,
  CaniasProtocolError,
  CaniasServiceError,
  CaniasSoapFaultError,
  CaniasTransportError,
  type SessionStore,
  type CaniasSession,
} from "../src/index.js";
import { BASE_CONFIG, fixture, queueFetch } from "./helpers.js";

describe("CaniasClient", () => {
  it("logs in lazily, calls the service and parses the response", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const result = await client.call("ERCCONVERTSAVE", [
      "DIALOG|DEVT04D001|E",
    ]);

    expect(result).toMatchObject({
      ok: true,
      serviceId: "ERCCONVERTSAVE",
      value: "<RESULT>OK</RESULT>",
      messages: "Islem tamamlandi",
      extraVariables: "client=00",
      sysStatus: 0,
      sysStatusError: "",
      requestId: 7,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toContain("<web:login>");
    expect(calls[1]?.body).toContain("<web:callService>");
    expect(calls[1]?.body).toContain(
      '<SessionId xsi:type="xsd:string">SESSION-123</SessionId>',
    );
    expect(calls[1]?.body).toContain(
      '<SecurityKey xsi:type="xsd:string">SECURITY-456</SecurityKey>',
    );
    expect(calls[1]?.body).toContain("&lt;PARAMETERS&gt;");
    expect(calls[1]?.headers["SOAPAction"]).toBe('""');
  });

  it("reuses the session for consecutive calls", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-success.xml"),
      fixture("call-inline.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    await client.call("A");
    await client.call("B");

    expect(calls).toHaveLength(3);
    expect(calls[1]?.body).toContain("<web:callService>");
    expect(calls[2]?.body).toContain("<web:callService>");
  });

  it("logs in only once for concurrent calls", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const [first, second] = await Promise.all([
      client.call("A"),
      client.call("B"),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls.filter((call) => call.body.includes("<web:login>"))).toHaveLength(1);
  });

  it("throws CaniasLoginError when Success is false", async () => {
    const { fn } = queueFetch([fixture("login-failure.xml")]);
    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    await expect(client.call("A")).rejects.toBeInstanceOf(CaniasLoginError);
    await expect(client.call("A")).rejects.toThrow(
      "Login failed: login error: 2",
    );
    const error = await client.call("A").catch((reason: unknown) => reason);
    expect((error as CaniasLoginError).loginErrorCode).toBe(2);
  });

  it("lists services without the server-side suffix", async () => {
    const { fn } = queueFetch([
      fixture("login-success.xml"),
      fixture("list-services.xml"),
    ]);
    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    expect(await client.listServices()).toEqual(["ERCCONVERTSAVE", "ERCPING"]);
  });

  it("reads array members whatever their tag name (Axis style)", async () => {
    const { fn } = queueFetch([
      fixture("login-success.xml"),
      fixture("list-services-axis.xml"),
    ]);
    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    expect(await client.listServices()).toEqual(["ERCCONVERTSAVE", "ERCCONVERTSAVE5"]);
  });

  it("returns an empty list for the real empty listServices response", async () => {
    const { fn } = queueFetch([
      fixture("login-success.xml"),
      fixture("list-services-empty.xml"),
    ]);
    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    expect(await client.listServices()).toEqual([]);
  });

  it("returns ok=false for a TROIA-level error", async () => {
    const { fn } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-syserror.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const result = await client.call("ERCCONVERTSAVE");

    expect(result.ok).toBe(false);
    expect(result.sysStatus).toBe(1);
    expect(result.sysStatusError).toBe("Compile error at line 3");
    expect(result.messages).toBe("Compile error");
  });

  it("throws CaniasServiceError from callOrThrow", async () => {
    const { fn } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-syserror.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    const error = await client.callOrThrow("ERCCONVERTSAVE").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CaniasServiceError);
    expect((error as CaniasServiceError).result.sysStatus).toBe(1);
  });

  it("re-logs in and retries on the real expired-session response", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("session-expired.xml"),
      fixture("logout.xml"),
      fixture("login-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const result = await client.call("ERCCONVERTSAVE");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(5);
    expect(calls[2]?.body).toContain("<web:logout>");
    expect(calls[3]?.body).toContain("<web:login>");
  });

  it("keeps the sent requestId when the server answers RequestId 0", async () => {
    const { fn } = queueFetch([
      fixture("login-success.xml"),
      fixture("session-expired.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const result = await client.call("A", [], {
      requestId: 77,
      retryOnSessionExpiry: false,
    });

    expect(result.ok).toBe(false);
    expect(result.requestId).toBe(77);
  });

  it("re-logs in only once when concurrent calls hit an expired session", async () => {
    const ops: string[] = [];
    let logins = 0;
    const fn = (async (_input: unknown, init?: RequestInit) => {
      const op = /<web:(\w+)>/.exec(String(init?.body))?.[1] ?? "";
      ops.push(op);
      if (op === "login") {
        logins += 1;
        return new Response(
          fixture("login-success.xml").replace("SESSION-123", `SESSION-${logins}`),
        );
      }
      // The server rejects every call that still carries the first session.
      if (String(init?.body).includes("SESSION-1<")) {
        return new Response(fixture("session-expired.xml"));
      }
      return new Response(fixture("call-success.xml"));
    }) as typeof fetch;

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const results = await Promise.all([client.call("A"), client.call("B")]);

    expect(results.every((result) => result.ok)).toBe(true);
    // 1 initial login + 1 re-login shared by both callers
    expect(ops.filter((op) => op === "login")).toHaveLength(2);
    expect(ops.filter((op) => op === "logout")).toHaveLength(1);
  });

  it("re-logs in and retries on a session SOAP fault", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("fault.xml"),
      fixture("logout.xml"),
      fixture("login-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    const result = await client.call("ERCCONVERTSAVE");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(5);
  });

  it("throws a non-session SOAP fault without retrying", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("fault-access.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    await expect(client.call("ERCCONVERTSAVE")).rejects.toBeInstanceOf(
      CaniasSoapFaultError,
    );
    expect(calls).toHaveLength(2);
  });

  it("logs out and clears the session", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-success.xml"),
      fixture("logout.xml"),
      fixture("login-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });
    await client.call("A");
    await client.logout();

    expect(calls).toHaveLength(3);
    expect(calls[2]?.body).toContain("<web:logout>");
    expect(calls[2]?.body).toContain("SESSION-123");

    await client.call("B");
    expect(calls).toHaveLength(5);
    expect(calls[3]?.body).toContain("<web:login>");
  });

  it("keeps the session after withSession", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    await client.withSession(async (active) => {
      await active.call("A");
      await active.call("B");
    });

    expect(calls).toHaveLength(3);
    expect(calls.some((call) => call.body.includes("<web:logout>"))).toBe(false);
  });

  it("does not log in when the store already has a valid session", async () => {
    const now = Date.now();
    let stored: CaniasSession | null = {
      sessionId: "PRESET",
      securityKey: "PRESET-KEY",
      contactNum: "",
      createdAt: now,
      expiresAt: now + 60_000,
    };

    const store: SessionStore = {
      get: () => stored,
      set: (session) => {
        stored = session;
      },
      clear: () => {
        stored = null;
      },
    };

    const { fn, calls } = queueFetch([fixture("call-success.xml")]);
    const client = new CaniasClient({
      ...BASE_CONFIG,
      fetch: fn,
      sessionStore: store,
    });

    const result = await client.call("A");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toContain("PRESET");
  });

  it("rejects compressed responses before making a request", async () => {
    const client = new CaniasClient({ ...BASE_CONFIG });

    await expect(
      client.call("A", [], { compressed: true }),
    ).rejects.toBeInstanceOf(CaniasProtocolError);
  });

  it("wraps fetch failures as CaniasTransportError", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";

    const fn = vi.fn(async () => {
      throw timeout;
    }) as unknown as typeof fetch;

    const client = new CaniasClient({ ...BASE_CONFIG, fetch: fn });

    await expect(client.call("A")).rejects.toBeInstanceOf(CaniasTransportError);
    await expect(client.call("A")).rejects.toThrow("timed out");
  });

  it("wraps HTTP errors as CaniasTransportError", async () => {
    const fn = async () =>
      new Response("<html>bad gateway</html>", { status: 502 });

    const client = new CaniasClient({
      ...BASE_CONFIG,
      fetch: fn as unknown as typeof fetch,
    });

    const error = await client.call("A").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(CaniasTransportError);
    expect((error as CaniasTransportError).status).toBe(502);
  });

  it("validates the config", () => {
    expect(
      () => new CaniasClient({ ...BASE_CONFIG, url: "ftp://example.com" }),
    ).toThrow(CaniasConfigError);

    expect(
      () => new CaniasClient({ ...BASE_CONFIG, username: "" }),
    ).toThrow(CaniasConfigError);
  });
});
