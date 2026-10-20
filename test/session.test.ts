import { describe, expect, it } from "vitest";

import { CaniasClient, MemorySessionStore, type CaniasSession } from "../src/index.js";
import { BASE_CONFIG, fixture, queueFetch } from "./helpers.js";

describe("MemorySessionStore", () => {
  it("stores, returns and clears a session", () => {
    const store = new MemorySessionStore();
    const session: CaniasSession = {
      sessionId: "S",
      securityKey: "K",
      contactNum: "",
      createdAt: 1,
      expiresAt: 2,
    };

    expect(store.get()).toBeNull();
    store.set(session);
    expect(store.get()).toBe(session);
    store.clear();
    expect(store.get()).toBeNull();
  });
});

describe("session TTL", () => {
  it("logs in for every call when sessionTtlMs is 0 and closes the old session", async () => {
    const { fn, calls } = queueFetch([
      fixture("login-success.xml"),
      fixture("call-success.xml"),
      fixture("logout.xml"),
      fixture("login-success.xml"),
      fixture("call-success.xml"),
    ]);

    const client = new CaniasClient({
      ...BASE_CONFIG,
      fetch: fn,
      sessionTtlMs: 0,
    });

    await client.call("A");
    await client.call("B");

    expect(calls).toHaveLength(5);
    expect(calls[2]?.body).toContain("<web:logout>");
    expect(calls[2]?.body).toContain("SESSION-123");
    expect(calls[3]?.body).toContain("<web:login>");
  });
});
