import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
  CaniasClient,
  CaniasSoapFaultError,
  type CaniasCallResult,
} from "../src/index.js";
import { BASE_CONFIG, fixture } from "./helpers.js";

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  const active = server;
  server = undefined;
  active.closeAllConnections();
  await new Promise<void>((resolve) => active.close(() => resolve()));
});

async function startServer(
  handler: (body: string) => { status: number; xml: string },
): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];

  const active = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      received.push({ headers: request.headers, body });
      const answer = handler(body);
      response.writeHead(answer.status, {
        "content-type": "text/xml; charset=utf-8",
      });
      response.end(answer.xml);
    });
  });

  server = active;

  await new Promise<void>((resolve) => active.listen(0, "127.0.0.1", resolve));

  const address = active.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not expose a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/CaniasWS-v2/services/CaniasWebService`,
    received,
  };
}

describe("HTTP transport", () => {
  it("posts a SOAP envelope and parses a real HTTP response", async () => {
    const { url, received } = await startServer((body) => ({
      status: 200,
      xml: body.includes("<web:login>")
        ? fixture("login-success.xml")
        : fixture("call-success.xml"),
    }));

    const client = new CaniasClient({ ...BASE_CONFIG, url });
    const result: CaniasCallResult = await client.call("ERCCONVERTSAVE", ["X"]);

    expect(result.ok).toBe(true);
    expect(result.value).toBe("<RESULT>OK</RESULT>");
    expect(received).toHaveLength(2);

    expect(received[0]?.headers["content-type"]).toBe("text/xml; charset=utf-8");
    expect(received[0]?.headers["soapaction"]).toBe('""');
    expect(received[0]?.body).toContain("<web:login>");
    expect(received[1]?.body).toContain("<web:callService>");
  });

  it("surfaces a SOAP fault sent with HTTP 500", async () => {
    const { url } = await startServer((body) => ({
      status: body.includes("<web:login>") ? 200 : 500,
      xml: body.includes("<web:login>")
        ? fixture("login-success.xml")
        : fixture("fault-access.xml"),
    }));

    const client = new CaniasClient({ ...BASE_CONFIG, url });

    await expect(client.call("ERCCONVERTSAVE")).rejects.toBeInstanceOf(
      CaniasSoapFaultError,
    );
  });
});
