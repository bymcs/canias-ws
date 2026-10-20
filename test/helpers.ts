import { readFileSync } from "node:fs";

import type { CaniasConfig } from "../src/index.js";

export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export const BASE_CONFIG: CaniasConfig = {
  url: "http://localhost:8080/CaniasWS-v2/services/CaniasWebService",
  client: "00",
  language: "T",
  dbServer: "DBS",
  dbName: "DB",
  applicationServer: "APP",
  username: "user",
  password: "secret",
};

export interface FetchCall {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/**
 * Returns a fetch stub that answers with the given XML bodies in order and
 * repeats the last body once the queue is exhausted.
 */
export function queueFetch(bodies: readonly string[]): {
  fn: typeof fetch;
  calls: FetchCall[];
} {
  let index = 0;
  const calls: FetchCall[] = [];

  const fn = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({
      url: String(input),
      body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const next = bodies[index] ?? bodies.at(-1);
    index += 1;

    if (next === undefined) {
      throw new Error("fetch queue is empty");
    }

    return new Response(next, {
      status: 200,
      headers: { "content-type": "text/xml" },
    });
  };

  return { fn: fn as typeof fetch, calls };
}
